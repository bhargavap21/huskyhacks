// Vantis's own phone number (AgentPhone). Three ways a member uses it:
//   1. Add Vantis to a call (three-way merge): it says hello, then listens and warns.
//   2. Call Vantis: talk through a call or text that felt off.
//   3. "Have Vantis call me": it rings the member's linked phone, with context.
// Calls are spotted by polling AgentPhone; each live call's transcript streams (SSE) into the same
// call guardian the speaker mode uses, so warnings appear in the member's app and, if shared, on the console.
// Vantis's own lines are shown but never checked for tactics (its advice mentions gift cards etc.).
import { db } from './db.ts';
import { startCall, addText, stopCall, callState } from './guardian.ts';
import { client, MODEL } from './chat.ts';
import { fileReport, normalize, extractIntake } from './reports.ts';
import { sidsWhere, settings, assess, record, notifyMember, onCritical, detection, updateDetection, type Detection } from './monitor.ts';
import { decide, input as screenInput, logScreened, finishScreened, TOOL_SECRET } from './screening.ts';
import { timingSafeEqual } from 'node:crypto';
import { sendEmail } from './email.ts';
import { scrub } from './redact.ts';

const KEY = process.env.AGENTPHONE_API_KEY;
const NUMBER_ID = process.env.AGENTPHONE_NUMBER_ID;
const AGENT = process.env.AGENTPHONE_AGENT_ID;
export const NUMBER = process.env.AGENTPHONE_NUMBER ?? null;
// Public demo link: outbound calls only go to phones the team listed, so the button can't be used to ring strangers.
const ALLOWED_TO = new Set((process.env.AGENTPHONE_ALLOWED_TO ?? '').split(',').map(s => s.trim()).filter(Boolean));
const API = 'https://api.agentphone.ai';
export const phoneEnabled = !!(KEY && AGENT && NUMBER);

db.exec(`CREATE TABLE IF NOT EXISTS phone_links (number TEXT PRIMARY KEY, sid TEXT NOT NULL, share INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL)`);
// A link only counts once verified: the member calls Vantis once from that phone (caller ID proves it).
// The team's own numbers (AGENTPHONE_ALLOWED_TO) are trusted from config.
try { db.exec('ALTER TABLE phone_links ADD COLUMN verified INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }

export class PhoneError extends Error {}

export function e164(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/[^\d+]/g, '');
  if (/^\+1\d{10}$/.test(d)) return d;
  if (/^1\d{10}$/.test(d)) return '+' + d;
  if (/^\d{10}$/.test(d)) return '+1' + d;
  return null;
}

export function link(sid: string, raw: unknown, share: boolean) {
  const n = e164(raw);
  if (!n) throw new PhoneError('Enter a 10-digit US phone number');
  db.prepare('DELETE FROM phone_links WHERE sid = ?').run(sid);
  db.prepare('DELETE FROM phone_links WHERE number = ?').run(n); // a number belongs to one member; re-linking needs a fresh verification
  db.prepare('INSERT INTO phone_links (number, sid, share, ts, verified) VALUES (?, ?, ?, ?, ?)').run(n, sid, share ? 1 : 0, Date.now(), ALLOWED_TO.has(n) ? 1 : 0);
}
export function unlink(sid: string) { db.prepare('DELETE FROM phone_links WHERE sid = ?').run(sid); }
const linkFor = (sid: string) => db.prepare('SELECT number, share, verified FROM phone_links WHERE sid = ?').get(sid) as { number: string; share: number; verified: number } | undefined;
const sidFor = (number: string) => (db.prepare('SELECT sid, share FROM phone_links WHERE number = ? AND verified = 1').get(number) as { sid: string; share: number } | undefined);
export const phoneVerified = (sid: string) => !!linkFor(sid)?.verified;
/** An inbound call (or WhatsApp message: WhatsApp authenticates the sender) from a number that's linked but not yet verified proves the member has that phone. */
export function verifyPhone(number: string, how = 'their call') {
  const r = db.prepare('UPDATE phone_links SET verified = 1 WHERE number = ? AND verified = 0').run(number);
  if (r.changes) console.log(`phone: verified a member's phone (…${number.slice(-4)}) by ${how}`);
}
const verifyByCall = (number: string) => verifyPhone(number);
/** The member who linked this number (verified or not), for channels whose sender ID is itself authenticated. */
export const linkedMember = (number: string) => db.prepare('SELECT sid, verified FROM phone_links WHERE number = ?').get(number) as { sid: string; verified: number } | undefined;

// What the member's app shows: Vantis's number and their own (masked).
export function phoneState(sid: string) {
  if (!phoneEnabled) return null;
  const l = linkFor(sid);
  return { number: NUMBER, screening_number: screeningNumber(sid), linked: l ? `•••-•••-${l.number.slice(-4)}` : null, verified: !!l?.verified, share: !!l?.share, can_call_me: !!l?.verified && ALLOWED_TO.has(l.number) };
}

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PhoneError(j?.error?.message ?? j?.detail ?? `AgentPhone ${r.status}`);
  return j;
}

// ---- "Have Vantis call me" ----
let lastOutbound = 0;
export async function callMe(sid: string, context: string) {
  if (!phoneEnabled) throw new PhoneError('Vantis’s phone line isn’t set up');
  const l = linkFor(sid);
  if (!l) throw new PhoneError('Link your phone first');
  if (!l.verified) throw new PhoneError('Confirm your phone first: call Vantis once from it');
  if (!ALLOWED_TO.has(l.number)) throw new PhoneError('In this demo, Vantis only calls phones on the team’s list');
  if (Date.now() - lastOutbound < 60_000) throw new PhoneError('Vantis just placed a call. Try again in a minute.');
  lastOutbound = Date.now();
  await api('POST', '/v1/calls', {
    agentId: AGENT, toNumber: l.number,
    initialGreeting: 'Hi, this is Vantis from Sound. You asked me to call. I’m an AI helper, and I can’t move money or ask for codes. Do you have a minute to talk it through?',
    systemPrompt: `${CALL_RULES}\n\nWhy you are calling: the member tapped "Have Vantis call me" in the Sound app.\n${scrub(context)}\nStart by asking how they are and what happened. Use the context above; don't read it out word for word.`,
  });
}

// ---- Level 4 (critical) threats: Vantis calls the member right away ----
// Same limits as "call me": a verified phone on the team's list (demo), and at most one such call per member every
// 2 minutes. The call coaches the member and offers, once, to tell Sound's fraud team; if they say yes, the case is
// filed after the call (reportIfAgreed) with the evidence Vantis already had.
const CHANNEL_NAME: Record<Detection['channel'], string> = { email: 'email', gmail: 'email', text: 'text message', whatsapp: 'WhatsApp message', 'call screening': 'phone call Vantis screened' };
const lastThreatCall = new Map<string, number>();
const pendingThreat = new Map<string, { id: number; at: number }>(); // sid -> the detection the call is about
export async function callAboutThreat(sid: string, id: number, d: Detection) {
  if (!phoneEnabled) return;
  const l = linkFor(sid);
  if (!l?.verified || !ALLOWED_TO.has(l.number)) { console.log('phone: critical threat, but the member’s phone isn’t verified or on the demo list; no call'); return; }
  if (Date.now() - (lastThreatCall.get(sid) ?? 0) < 120_000) return;
  lastThreatCall.set(sid, Date.now()); lastOutbound = Date.now();
  pendingThreat.set(sid, { id, at: Date.now() });
  const what = CHANNEL_NAME[d.channel] ?? 'message';
  const evidence = (d.signals ?? []).slice(0, 4).map(x => `- ${x.label}: "${x.span}"`).join('\n');
  await api('POST', '/v1/calls', {
    agentId: AGENT, toNumber: l.number,
    initialGreeting: `Hi, this is Vantis from Sound, calling about a ${what} you just got. It has the signs of a scam that’s happening right now, so I wanted to reach you straight away. Do you have a moment?`,
    systemPrompt: `${CALL_RULES}

Why you are calling: Vantis rated a ${what} the member received as Level 4, critical: someone is asking for money, a code or access right now while posing as someone trusted or using fear or secrecy. You are calling to protect them before they act. This call was placed automatically by Vantis, not requested by the member.
What it was: ${d.title}${d.summary ? `. ${d.summary}` : ''}
From: ${d.from}
Warning signs, with the words used:
${evidence || '- (see summary)'}
${d.other?.length ? `Other checks: ${d.other.join('; ')}` : ''}

Talk them through it, in this order, briefly and calmly:
1. Ask whether they have replied, clicked a link, called a number from it, sent money or shared a code. If they have, tell them to call Sound now on the number on the back of their card, and offer to tell Sound's fraud team right away.
2. Say what the message claims and what it asks for, quoting one or two of its phrases. Never call the sender a scammer; say "this has the signs of a scam."
3. Tell them how to respond: don't reply, don't click, don't call any number in it. If it says it's from Sound: Sound never asks for codes or to move money. To check, call Sound on the number on their card. They can block the sender.
4. Offer once: "Would you like me to tell Sound's fraud team now? I'll pass on what I saw, and someone will call you." Their yes is enough.
Keep it under two minutes unless they want to talk.`,
  });
  console.log(`phone: called a member about a critical ${what}`);
}
if (phoneEnabled) onCritical(callAboutThreat);

// ---- Persona for every call (also set on the agent for inbound calls) ----
export const CALL_RULES = `You are Vantis, the scam-protection helper from Sound Credit Union, on the phone. This is a hackathon concept demo; say so if asked.
Rules you never break:
- You never move, send or release money, and never ask for passwords, one-time codes, PINs or full account or card numbers. If someone starts to read one out, stop them kindly.
- Never say something is definitely a scam or definitely safe, and never call any person a scammer. Talk about the request and the warning signs.
- Name pressure patterns gently: urgency, secrecy, someone claiming to be family in trouble, the credit union, the government, tech support or a romantic partner, requests for codes or remote access, gift cards, crypto, wires or cash couriers, moving money to a "safe account".
- Suggest independent checks: hang up and call the number on the back of the card, call family on a number they already had, visit a branch.
- If money already went out, tell them to call Sound right away on the number on their card; recalls can be requested but aren't guaranteed.
- You can report it to Sound's fraud team for them. When you hear warning signs, money already sent, or a shared code, offer once: "Would you like me to tell Sound's fraud team? I'll pass on what you told me, and someone from Sound will call you back." Never say it's sent if they didn't agree.
- If they say yes, gather only what's still missing. First, silently go through everything the member has said in this call, including before they agreed. Rules for follow-ups:
  - Never ask about something they already told you, even in passing. If an item is answered, skip it. Don't re-ask it to "confirm" either; the one exception is reading back the callback number at the end.
  - Skip items that don't apply: if they said no money was sent, don't ask how much or how; if the contact came by email, ask for the email address, not a phone number; if they said they shared nothing, don't ask again.
  - Ask at most four questions in total, one at a time, most important first. If everything is already covered, ask nothing and go straight to the closing line.
  The checklist (only the parts still unknown):
  1. Their name, and whether the number they're calling from is the best one to call back (if not, which number). Whether it's safe to call back now.
  2. Who contacted them, who they claimed to be, and how (call, text, email, website).
  3. The phone number, email address, website or name the person used.
  4. What they asked for: how much, how to pay (wire, gift cards, crypto, Zelle, cash), and any deadline.
  5. Whether any money was already sent: how much, how, when, and to whom.
  6. Whether they shared any codes, passwords or card numbers, or let anyone into their computer or phone. Ask only what type, never the actual numbers.
  7. Whether that person is still in contact with them.
  If money already went out or a code was shared, keep it to the essentials (1, 5, 6) and move fast. Never ask for full card or account numbers, Social Security numbers, PINs, passwords or codes. Then say: "Thank you. I'll send this to Sound's fraud team as soon as we hang up, and someone will call you back." Briefly repeat back the callback number to confirm it.
- Don't repeat yourself. Give each warning or piece of advice once; later turns add something new or stay brief. Don't read the member's words back to them (except the callback number, once, at the end). Offer the report only once; if they decline, don't bring it up again.
- Calm, warm, plain words. One or two sentences per turn, then one question. The member decides.`;

export const SCREEN_RULES = `Sometimes the caller is not a Sound member but someone trying to reach one: the member forwarded calls they didn't answer (unknown callers) to you.
- Then say: "Hi, this call is being screened by Vantis, an AI assistant for a Sound member. Who's calling, and what's it about?"
- Ask for their name, the organization they're with (if any), what it's about, and a callback number. One short question at a time.
- Then call the screening_decision tool with what they told you, including their own words. Always call it before putting anyone through.
- Say the tool's "say" line exactly as given. If its decision is "connect", transfer the call. If it is "hold", never transfer: end the call politely.
- If the tool fails or gives no answer, never transfer: say "Thanks, I'll pass your message on." and end the call.
- Never confirm the member's name, accounts or any details. Never agree to anything, take payment details, or promise a callback time.`;

export const LISTEN_RULES = `Sometimes the member adds you to a call that is already happening (a merged three-way call) so you can listen. If you hear the member talking with someone else, or they say they added you:
- Stay quiet and let them talk. Do not reply to ordinary conversation. If you must produce a reply, make it a single short "Mm-hm." at most.
- Speak up only if someone asks for a code, password or PIN, asks for gift cards, crypto, a wire or cash, says to move money to a safe account, or tells the member to keep it secret. Then say one sentence, for example: "This is Vantis from Sound, listening at the member's request: Sound will never ask for a code or to move money to a safe account."
- If the member speaks to you by name, answer briefly.`;

export async function configureAgent() {
  if (!phoneEnabled) return;
  await api('PATCH', `/v1/agents/${AGENT}`, {
    name: 'Vantis', voiceMode: 'hosted', enableBackchannel: false,
    systemPrompt: `${CALL_RULES}\n\n${LISTEN_RULES}\n\n${SCREEN_RULES}\n\nIf the member called you directly, ask what happened and help them check it.`,
    beginMessage: 'Hi, this is Vantis from Sound, an AI assistant. If you’re a member, tell me what’s going on. If you’re calling for a Sound member, tell me who you are and what it’s about, and I’ll pass it on.',
    voicemailMessage: 'Hi, this is Vantis from Sound, the scam-protection helper. If something feels off, call me back on this number, and please don’t share any codes or passwords in the meantime.',
    customTools: [SCREEN_TOOL],
  });
  await syncTransfer();
}

// ---- Screen-then-connect (issue #25) ----
// The agent asks our server (screening.ts) whether to put an unknown caller through. AgentPhone has one
// transfer number per agent, so on the shared number only one member at a time can have it on.
const BASE = (process.env.PUBLIC_BASE_URL ?? 'https://second-look-demo.vercel.app').replace(/\/$/, '');
const SCREEN_TOOL = {
  name: 'screening_decision',
  description: 'Ask Vantis whether to put a screened caller through to the member. Call it once you know who is calling and why, before any transfer. Returns {decision: "connect"|"hold", say}.',
  url: `${BASE}/hooks/screening-decision`, method: 'POST', headers: { 'x-second-look-secret': TOOL_SECRET },
  parameters: { type: 'object', properties: {
    name: { type: 'string', description: 'The caller’s name, as they said it' },
    organization: { type: 'string', description: 'Who they are calling from, if anyone' },
    reason: { type: 'string', description: 'What the call is about, in a sentence' },
    callback: { type: 'string', description: 'Callback number, if given' },
    what_they_said: { type: 'string', description: 'The caller’s own words so far, as close to verbatim as you can' },
  }, required: ['reason', 'what_they_said'] },
  timeoutMs: 8000, speakDuringExecution: true, executionMessage: 'One moment, please.',
};
/** The member who asked for legitimate unknown callers to be put through (verified phone only). */
export function connectTarget(): { sid: string; number: string } | null {
  const on = sidsWhere(x => x.screening && x.screen_connect).map(x => ({ sid: x.sid, l: linkFor(x.sid) })).filter(x => x.l?.verified);
  return on[0] ? { sid: on[0].sid, number: on[0].l!.number } : null;
}
export async function syncTransfer() {
  if (!phoneEnabled) return;
  const t = connectTarget();
  if (!t) return; // nobody to put calls through to: the server answers "hold" to every call anyway
  await api('PATCH', `/v1/agents/${AGENT}`, { transferNumber: t.number }).catch(e => console.error('phone: could not set the transfer number:', e.message));
}

const screening = new Map<string, { sid: string; from: string; started: number }>(); // live screened calls
const lastTransfer = new Map<string, number>(); // `${sid}|${caller}` -> when we last put them through
/** The agent's custom tool. Checks the secret, then decides; never throws (the agent treats errors as "hold"). */
export async function handleScreeningTool(secret: string | undefined, body: any) {
  const a = Buffer.from(secret ?? ''), b = Buffer.from(TOOL_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { status: 401, json: { decision: 'hold', say: 'Thanks, I’ll pass your message on.' } };
  const i = screenInput(body?.args ?? body?.arguments ?? body?.parameters ?? body);
  const live = [...screening.entries()].filter(([, v]) => Date.now() - v.started < 15 * 60_000).sort((x, y) => y[1].started - x[1].started)[0];
  const callId = String(body?.call?.call_id ?? body?.call_id ?? live?.[0] ?? '') || null;
  const caller = e164(body?.call?.from_number ?? body?.from_number ?? live?.[1].from) ?? '';
  const t = screeningTarget(), sid = live?.[1].sid ?? (t && t !== 'ambiguous' ? t : null);
  if (!sid) return { status: 200, json: { decision: 'hold', say: 'Thanks, I’ll pass your message on.' } };
  const ct = connectTarget();
  const key = `${sid}|${caller}`;
  const r = await decide(i, { target: ct && ct.sid === sid ? ct.number : null, lastTransfer: caller ? lastTransfer.get(key) : undefined });
  logScreened(sid, callId, caller, i, r);
  if (r.decision === 'connect') {
    if (caller) lastTransfer.set(key, Date.now());
    void notifyMember(sid, `Putting a call through: ${[i.name, i.organization].filter(Boolean).join(', ')} about ${i.reason}`.slice(0, 160));
  }
  console.log(`phone: screening decision ${r.decision} (${scrub(r.why)})`);
  return { status: 200, json: { decision: r.decision, say: r.say } };
}

// ---- Watching live calls ----
// Call screening: an unknown caller on an inbound call is someone trying to reach a member who forwarded
// unanswered calls here. AgentPhone doesn't say which number forwarded a call, and the caller's number says
// nothing about the member, so the number dialed is the only reliable link.
// With AGENTPHONE_SCREENING_POOL (spare numbers bought in the AgentPhone console and attached to the same
// agent), each member who turns screening on gets their own number, and a call to it is theirs. A number
// stays with its member even if they turn screening off: their phone may still forward to it, so handing it
// to someone else would show them the first member's callers. Without a pool (or once it runs out), members
// share Vantis's main number, and a call there is routed only when exactly one of them has screening on.
const POOL = (process.env.AGENTPHONE_SCREENING_POOL ?? '').split(',').map(e164).filter((n): n is string => !!n);
db.exec(`CREATE TABLE IF NOT EXISTS screening_numbers (number TEXT PRIMARY KEY, sid TEXT UNIQUE NOT NULL, ts INTEGER NOT NULL)`);

export function screeningNumber(sid: string) {
  return (db.prepare('SELECT number FROM screening_numbers WHERE sid = ?').get(sid) as { number: string } | undefined)?.number ?? null;
}
/** Give the member their own screening number from the pool, if one is free. Returns it, or null (shared number). */
export function assignScreeningNumber(sid: string) {
  const mine = screeningNumber(sid);
  if (mine) return mine;
  const taken = new Set((db.prepare('SELECT number FROM screening_numbers').all() as { number: string }[]).map(r => r.number));
  const free = POOL.find(n => !taken.has(n));
  if (free) db.prepare('INSERT INTO screening_numbers (number, sid, ts) VALUES (?, ?, ?)').run(free, sid, Date.now());
  return free ?? null;
}
export function screeningTarget(dialed?: string): string | 'ambiguous' | null {
  const n = dialed ? e164(dialed) : null;
  const owner = n ? (db.prepare('SELECT sid FROM screening_numbers WHERE number = ?').get(n) as { sid: string } | undefined)?.sid : undefined;
  if (owner) return settings(owner).screening && phoneVerified(owner) ? owner : null;
  if (n && POOL.includes(n)) return null; // a pool number nobody has yet
  // Only members with a verified phone can have screening on (issue #23); members with their own number forward there.
  const on = sidsWhere(s => s.screening).filter(x => phoneVerified(x.sid) && !screeningNumber(x.sid));
  return on.length === 1 ? on[0].sid : on.length > 1 ? 'ambiguous' : null;
}
const tracked = new Set<string>();
type KeyFor = (sid: string) => string;

export async function follow(call: any, keyFor: KeyFor) {
  const member = call.direction === 'inbound' ? call.fromNumber : call.toNumber;
  if (call.direction === 'inbound') verifyByCall(member);
  const who = sidFor(member);
  if (!who) console.log(`phone: ${call.direction} call with an unlinked number (…${String(member).slice(-4)}): no live view, report-only`);
  const key = who ? keyFor(who.sid) : '';
  if (who) startCall(key, !!who.share, call.direction === 'outbound' ? 'phone-out' : 'phone-in');
  const turns: { role: string; content: string }[] = [];
  const screenFor = !who && call.direction === 'inbound' ? screeningTarget(call.toNumber) : null;
  if (screenFor && screenFor !== 'ambiguous') screening.set(call.id, { sid: screenFor, from: member, started: Date.now() });
  const done = async () => {
    screening.delete(call.id); finishScreened(call.id);
    if (who && callState(key)?.live) await stopCall(key);
    if (screenFor === 'ambiguous') console.log('phone: screened call, but more than one member has screening on; not routed');
    else if (screenFor) await screened(screenFor, member, turns);
    else await reportIfAgreed(who?.sid ?? null, member, turns);
  };
  try {
    const r = await fetch(`${API}/v1/calls/${call.id}/transcript/stream`, { headers: { Authorization: `Bearer ${KEY}` } });
    if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body as any) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: ?(.*)$/m.exec(block)?.[1]?.trim();
        const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
        if (ev === 'turn' && data) { const t = JSON.parse(data); if (t.content?.trim()) { turns.push({ role: t.role, content: t.content.trim() }); if (who) addText(key, t.content.trim(), t.role === 'agent' ? 'second-look' : 'caller'); } }
        if (ev === 'ended') { await done(); return; }
      }
    }
  } catch (e) { console.error('phone: transcript stream failed:', (e as Error).message); }
  await done();
}

// After a call: did the caller agree to a report? Claude reads the transcript and answers in a fixed shape.
// A screened call: check what the caller said and alert the member if it's worth a look.
async function screened(sid: string, caller: string, turns: { role: string; content: string }[]) {
  const said = turns.filter(t => t.role === 'user').map(t => t.content).join('\n');
  if (!said.trim()) return;
  try {
    const transcript = turns.map(t => `${t.role === 'agent' ? 'Vantis' : 'Caller'}: ${t.content}`).join('\n');
    const d = await assess('call screening', caller, 'Call Vantis screened for you', transcript);
    if (!d) { console.log('phone: screened call looked ordinary; nothing kept'); return; }
    await record(sid, d, emailFor(sid), sendEmail);
  } catch (e) { console.error('phone: screening check failed:', (e as Error).message); }
}
const emailFor = (sid: string) => (db.prepare('SELECT address FROM email_links WHERE sid = ? AND verified = 1').get(sid) as { address: string } | undefined)?.address ?? null;

// Texts a member forwards to Vantis's number (inbound works without carrier registration; we reply in the app).
const seenTexts = new Set<string>();
let textsPrimed = false;
async function checkTexts() {
  if (!NUMBER_ID) return;
  const { data } = await api('GET', `/v1/numbers/${NUMBER_ID}/messages?limit=20`);
  for (const m of (data ?? []).slice().reverse()) {
    if (seenTexts.has(m.id)) continue;
    seenTexts.add(m.id);
    if (!textsPrimed || m.direction !== 'inbound') continue;
    const from = e164(m.from ?? m.from_);
    const who = from ? sidFor(from) : undefined;
    if (!who || !settings(who.sid).texts) { console.log('phone: text from an unlinked number or texts not on; ignored'); continue; }
    const d = await assess('text', `forwarded by the member (…${from!.slice(-4)})`, 'Text the member forwarded', String(m.body ?? '').slice(0, 4000));
    if (d) await record(who.sid, d, emailFor(who.sid), sendEmail);
    else console.log('phone: forwarded text looked ordinary; nothing kept');
  }
  textsPrimed = true;
}

export async function reportIfAgreed(sid: string | null, member: string, turns: { role: string; content: string }[]) {
  if (!turns.some(t => t.role === 'user')) return;
  try {
    const d = await extractIntake(
      'You read a phone call between Vantis (a credit union scam-protection helper) and a member. Decide whether the member clearly agreed to a fraud report to Sound, or asked for one. If so, fill the fraud case from what the member said.',
      turns.map(t => `${t.role === 'agent' ? 'Vantis' : 'Member'}: ${t.content}`).join('\n'), true);
    if (!d?.agreed) return;
    // A call about a Level 4 threat: the case carries what Vantis saw, with its quotes.
    const p = sid ? pendingThreat.get(sid) : undefined, det = p && Date.now() - p.at < 30 * 60_000 ? detection(sid!, p.id) : null;
    if (det) Object.assign(d, { signals: det.signals ?? [], tactics: [...new Set([...(d.tactics ?? []), ...(det.signals ?? []).map(x => x.label)])], contact_method: d.contact_method || CHANNEL_NAME[det.channel], scammer_phone: d.scammer_phone || det.numbers?.[0] || '' });
    const out = await fileReport(sid, normalize(d, 'phone', { phone: member, linked: !!sid }));
    if (det && p) { det.reported = true; updateDetection(sid!, p.id, det); pendingThreat.delete(sid!); }
    console.log(`phone: case ${out.case_id} filed (queue: ${out.queued}, emailed: ${out.emailed})`);
  } catch (e) { console.error('phone: could not check for a report:', (e as Error).message); }
}

export function watchCalls(keyFor: KeyFor) {
  if (!phoneEnabled) return;
  configureAgent().catch(e => console.error('phone: could not configure agent:', e.message));
  setInterval(async () => {
    try {
      const { data } = await api('GET', '/v1/calls?limit=10');
      for (const call of data ?? []) {
        if (tracked.has(call.id)) continue;
        if (call.status !== 'in-progress' && call.status !== 'ringing') { tracked.add(call.id); continue; } // old calls: ignore
        tracked.add(call.id);
        follow(call, keyFor);
      }
    } catch (e) { console.error('phone: poll failed:', (e as Error).message); }
    checkTexts().catch(e => console.error('phone: text check failed:', (e as Error).message));
  }, 2500);
}
