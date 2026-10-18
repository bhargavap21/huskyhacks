// WhatsApp forwarding (WhatsApp Business Cloud API). Members forward a message that feels off (or send a
// screenshot, a voice note, or a question) to Vantis's WhatsApp number. Vantis checks it with the
// same checks as other connected channels, replies in the same thread with the Vantis chat, and can
// report it to Sound with the evidence when the member says yes.
// Inbound only: Vantis never starts a WhatsApp conversation; it only replies to a message just received.
// Consent: content is read only from a number the member linked in the app, with WhatsApp turned on under
// Connected channels. Anything else gets one short how-to reply and is neither stored nor sent to a model.
// Turns on when WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN are set.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './db.ts';
import { chat, GENERAL } from './chat.ts';
import { prepare, AttachmentError, type Attachment } from './media.ts';
import { settings, assess, record, type Detection } from './monitor.ts';
import { linkedMember, verifyPhone, e164 } from './phone.ts';
import { sendEmail } from './email.ts';

const TOKEN = process.env.WHATSAPP_TOKEN ?? '';
const NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? '';
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
const GRAPH = (process.env.WHATSAPP_GRAPH_BASE ?? 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
export const WA_NUMBER = e164(process.env.WHATSAPP_NUMBER) ?? process.env.WHATSAPP_NUMBER ?? null; // shown to members
export const whatsappEnabled = !!(TOKEN && NUMBER_ID && APP_SECRET && VERIFY_TOKEN);

db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_seen (id TEXT PRIMARY KEY, ts INTEGER NOT NULL)`);

// ---- Webhook security ----
/** Meta's subscription handshake (GET): echo the challenge only for our verify token. */
export function verifyHandshake(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
  if (!VERIFY_TOKEN || mode !== 'subscribe' || !token || !challenge) return null;
  const a = Buffer.from(token), b = Buffer.from(VERIFY_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}
/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, exact request bytes). Checked before anything is parsed. */
export function signatureOk(raw: Buffer, header: string | undefined, secret = APP_SECRET): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---- Normalized message ----
export type WaMedia = { id: string; mime: string; kind: 'image' | 'audio' | 'pdf' | 'other'; caption: string; filename: string; voice: boolean };
export type WaMessage = { id: string; from: string; name: string; ts: number; text: string; media: WaMedia[]; forwarded: boolean };

const kindOf = (mime: string): WaMedia['kind'] => (/^image\/(jpeg|png|webp|gif)$/.test(mime) ? 'image' : /^audio\//.test(mime) ? 'audio' : mime === 'application/pdf' ? 'pdf' : 'other');
/** Meta's webhook payload -> messages (status updates and other events are ignored). */
export function normalize(payload: any): WaMessage[] {
  const out: WaMessage[] = [];
  for (const entry of payload?.entry ?? []) for (const ch of entry?.changes ?? []) {
    const v = ch?.value;
    if (ch?.field !== 'messages' || !Array.isArray(v?.messages)) continue;
    for (const m of v.messages) {
      const from = e164('+' + String(m.from ?? '').replace(/\D/g, ''));
      if (!from || !m.id) continue;
      const name = String(v.contacts?.find((c: any) => c.wa_id === m.from)?.profile?.name ?? '').slice(0, 80);
      const media: WaMedia[] = [];
      let text = '';
      if (m.type === 'text') text = String(m.text?.body ?? '');
      else if (m.type === 'image' || m.type === 'audio' || m.type === 'document' || m.type === 'video' || m.type === 'sticker') {
        const x = m[m.type] ?? {};
        const mime = String(x.mime_type ?? '').split(';')[0].trim().toLowerCase();
        media.push({ id: String(x.id ?? ''), mime, kind: m.type === 'video' || m.type === 'sticker' ? 'other' : kindOf(mime), caption: String(x.caption ?? ''), filename: String(x.filename ?? `${m.type}`), voice: !!x.voice });
        text = String(x.caption ?? '');
      } else if (m.type === 'button') text = String(m.button?.text ?? '');
      else if (m.type === 'interactive') text = String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '');
      out.push({ id: String(m.id), from, name, ts: Number(m.timestamp) * 1000 || Date.now(), text: text.slice(0, 4000), media: media.filter(x => x.id), forwarded: !!(m.context?.forwarded || m.context?.frequently_forwarded) });
    }
  }
  return out;
}

// ---- Graph API ----
async function graph(method: string, path: string, body?: unknown) {
  const r = await fetch(`${GRAPH}/${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `WhatsApp API ${r.status}`);
  return j;
}
// Reply in the same thread (quoting the member's message). Allowed only because the member just wrote to us.
async function reply(to: string, inReplyTo: string, text: string) {
  const body = text.replace(/\*\*(.+?)\*\*/g, '*$1*').slice(0, 4000); // WhatsApp bold is *one star*
  await graph('POST', `${NUMBER_ID}/messages`, { messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace('+', ''), context: { message_id: inReplyTo }, type: 'text', text: { body, preview_url: false } });
}
const markRead = (id: string) => graph('POST', `${NUMBER_ID}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: id }).catch(() => {});

const MAX = { image: 5, pdf: 8, audio: 12 }; // MB, same limits as the app's chat
async function download(m: WaMedia): Promise<any | null> {
  if (m.kind === 'other') return null;
  const meta = await graph('GET', encodeURIComponent(m.id));
  if (Number(meta.file_size) > MAX[m.kind] * 1024 * 1024) throw new AttachmentError(`That ${m.kind === 'audio' ? 'voice note' : m.kind === 'pdf' ? 'PDF' : 'photo'} is too large`);
  const r = await fetch(String(meta.url), { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`media download ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer()).toString('base64');
  const name = m.kind === 'audio' ? (m.voice ? 'WhatsApp voice note' : 'WhatsApp audio') : m.filename || `whatsapp-${m.kind}`;
  return { kind: m.kind, media_type: m.kind === 'image' ? (m.mime === 'image/jpg' ? 'image/jpeg' : m.mime) : m.mime, data, name };
}

// ---- Handling ----
const HOW_TO = 'Hi, this is Vantis from Sound Credit Union (a concept demo). To check messages here, first link this phone number in the Sound app and turn on WhatsApp under Connected channels. Until then I don’t read what you send.';
const toldHowTo = new Map<string, number>(); // number -> last how-to reply (once a day)
const evidence = new Map<string, { at: number; detection: Detection | null; detectionId: number | null; files: { kind: string; name: string; note: string }[] }>();

const NOTE = `You're replying on WhatsApp, in the member's chat with Vantis's WhatsApp number. The member linked this number in the Sound app and turned WhatsApp on. They may forward a message that felt off (it arrives as their message), or send a screenshot, a voice note, or a question. Plain text for WhatsApp: no markdown except *bold* with single stars; short lines; 100 words max. Never ask them to forward anything to anyone other than Vantis.`;

export async function handle(m: WaMessage) {
  if (db.prepare('SELECT 1 FROM whatsapp_seen WHERE id = ?').get(m.id)) return; // Meta retries; handle once
  db.prepare('INSERT OR IGNORE INTO whatsapp_seen (id, ts) VALUES (?, ?)').run(m.id, Date.now());
  const who = linkedMember(m.from);
  if (!who || !settings(who.sid).whatsapp) {
    console.log('whatsapp: message from a number not linked or with WhatsApp off; not read');
    if (Date.now() - (toldHowTo.get(m.from) ?? 0) > 86_400_000) { toldHowTo.set(m.from, Date.now()); await reply(m.from, m.id, HOW_TO); }
    return;
  }
  if (!who.verified) verifyPhone(m.from, 'a WhatsApp message (WhatsApp authenticates the sender)');
  void markRead(m.id);
  const sid = who.sid;

  // Media: the same validation and voice-note transcription as the app's chat.
  let att: Attachment[] = [];
  const skipped: string[] = [];
  try {
    const raw = (await Promise.all(m.media.slice(0, 3).map(download))).filter(Boolean);
    skipped.push(...m.media.filter(x => x.kind === 'other').map(() => 'a video or sticker'));
    att = await prepare(raw);
  } catch (e) {
    console.error('whatsapp: media failed:', (e as Error).message);
    await reply(m.from, m.id, e instanceof AttachmentError ? `${e.message}. Could you send a screenshot instead, or tell me what it says?` : 'I couldn’t open that file. Could you send a screenshot instead, or tell me what it says?');
    return;
  }
  const heard = att.flatMap(a => (a.kind === 'audio' && a.transcript ? [a.transcript] : []));
  const files = att.map(a => ({ kind: a.kind === 'audio' ? 'voice note' : a.kind === 'pdf' ? 'PDF' : 'screenshot', name: a.name, note: a.kind === 'audio' ? `transcript: ${a.transcript.slice(0, 280)}` : '' }));

  // Same checks as every connected channel (signals/v1). Kept in the app; the member is reading our reply already.
  const body = [m.text, ...heard].filter(Boolean).join('\n');
  let d: Detection | null = null, detectionId: number | null = null;
  if (body.trim()) {
    d = await assess('whatsapp', m.forwarded ? `WhatsApp message the member forwarded (…${m.from.slice(-4)})` : `the member on WhatsApp (…${m.from.slice(-4)})`, m.forwarded ? 'Forwarded WhatsApp message' : 'WhatsApp message', body);
    if (d) { d.files = files; detectionId = await record(sid, d, null, sendEmail, false); }
  }
  const prev = evidence.get(sid);
  const fresh = prev && Date.now() - prev.at < 3_600_000 ? prev : null;
  evidence.set(sid, { at: Date.now(), detection: d ?? fresh?.detection ?? null, detectionId: detectionId ?? fresh?.detectionId ?? null, files: [...(fresh?.files ?? []), ...files].slice(-6) });

  const checks = d?.signals?.length ? `\n[Vantis's automatic checks found: ${d.signals.map(s => `${s.label} (“${s.span}”)`).join('; ')}${d.other?.length ? `; ${d.other.join('; ')}` : ''}]` : '';
  const text = `${m.forwarded ? '[Forwarded message]\n' : ''}${m.text}${skipped.length ? `\n[Also sent ${skipped.join(', ')}, which Vantis can't open]` : ''}${checks}`.trim();
  const out = await chat(`${sid}:whatsapp`, GENERAL, text, att, {
    channel: 'whatsapp', maxLen: 4000, note: NOTE,
    evidence: () => {
      const ev = evidence.get(sid);
      const det = ev?.detection;
      return { contact_method: 'WhatsApp (member forwarded to Vantis)', signals: det?.signals ?? [], tactics: det?.signals?.map(s => s.label) ?? [], files: ev?.files ?? [] };
    },
  });
  if (out.reported) {
    const ev = evidence.get(sid);
    if (ev?.detectionId && ev.detection) { ev.detection.reported = true; db.prepare('UPDATE detections SET json = ? WHERE id = ? AND sid = ?').run(JSON.stringify(ev.detection), ev.detectionId, sid); }
  }
  await reply(m.from, m.id, out.reply);
  console.log(`whatsapp: replied to a member (${out.source}${d ? `, ${d.risk} detection` : ''}${out.reported ? ', reported to Sound' : ''})`);
}

/** POST body from Meta, after the signature check. Never throws: Meta gets a 200 regardless. */
export async function onWebhook(payload: any) {
  for (const m of normalize(payload)) await handle(m).catch(e => console.error('whatsapp: handling failed:', (e as Error).message));
}
