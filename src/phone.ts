// Second Look's own phone number (AgentPhone). Three ways a member uses it:
//   1. Add Second Look to a call (three-way merge): it says hello, then listens and warns.
//   2. Call Second Look: talk through a call or text that felt off.
//   3. "Have Second Look call me": it rings the member's linked phone, with context.
// Calls are spotted by polling AgentPhone; each live call's transcript streams (SSE) into the same
// call guardian the speaker mode uses, so warnings appear in the member's app and, if shared, on the console.
// Second Look's own lines are shown but never checked for tactics (its advice mentions gift cards etc.).
import { db } from './db.ts';
import { startCall, addText, stopCall, callState } from './guardian.ts';
import { client, MODEL } from './chat.ts';
import { fileReport, normalize, extractIntake } from './reports.ts';
import { sidsWhere, settings, assess, record } from './monitor.ts';
import { sendEmail } from './email.ts';

const KEY = process.env.AGENTPHONE_API_KEY;
const NUMBER_ID = process.env.AGENTPHONE_NUMBER_ID;
const AGENT = process.env.AGENTPHONE_AGENT_ID;
export const NUMBER = process.env.AGENTPHONE_NUMBER ?? null;
// Public demo link: outbound calls only go to phones the team listed, so the button can't be used to ring strangers.
const ALLOWED_TO = new Set((process.env.AGENTPHONE_ALLOWED_TO ?? '').split(',').map(s => s.trim()).filter(Boolean));
const API = 'https://api.agentphone.ai';
export const phoneEnabled = !!(KEY && AGENT && NUMBER);

db.exec(`CREATE TABLE IF NOT EXISTS phone_links (number TEXT PRIMARY KEY, sid TEXT NOT NULL, share INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL)`);
// A link only counts once verified: the member calls Second Look once from that phone (caller ID proves it).
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
/** An inbound call from a number that's linked but not yet verified proves the member has that phone. */
function verifyByCall(number: string) {
  const r = db.prepare('UPDATE phone_links SET verified = 1 WHERE number = ? AND verified = 0').run(number);
  if (r.changes) console.log(`phone: verified a member's phone (…${number.slice(-4)}) by their call`);
}

// What the member's app shows: Second Look's number and their own (masked).
export function phoneState(sid: string) {
  if (!phoneEnabled) return null;
  const l = linkFor(sid);
  return { number: NUMBER, linked: l ? `•••-•••-${l.number.slice(-4)}` : null, verified: !!l?.verified, share: !!l?.share, can_call_me: !!l?.verified && ALLOWED_TO.has(l.number) };
}

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PhoneError(j?.error?.message ?? j?.detail ?? `AgentPhone ${r.status}`);
  return j;
}

// ---- "Have Second Look call me" ----
let lastOutbound = 0;
export async function callMe(sid: string, context: string) {
  if (!phoneEnabled) throw new PhoneError('Second Look’s phone line isn’t set up');
  const l = linkFor(sid);
  if (!l) throw new PhoneError('Link your phone first');
  if (!l.verified) throw new PhoneError('Confirm your phone first: call Second Look once from it');
  if (!ALLOWED_TO.has(l.number)) throw new PhoneError('In this demo, Second Look only calls phones on the team’s list');
  if (Date.now() - lastOutbound < 60_000) throw new PhoneError('Second Look just placed a call. Try again in a minute.');
  lastOutbound = Date.now();
  await api('POST', '/v1/calls', {
    agentId: AGENT, toNumber: l.number,
    initialGreeting: 'Hi, this is Second Look from Sound. You asked me to call. I’m an AI helper, and I can’t move money or ask for codes. Do you have a minute to talk it through?',
    systemPrompt: `${CALL_RULES}\n\nWhy you are calling: the member tapped "Have Second Look call me" in the Sound app.\n${context}\nStart by asking how they are and what happened. Use the context above; don't read it out word for word.`,
  });
}

// ---- Persona for every call (also set on the agent for inbound calls) ----
export const CALL_RULES = `You are Second Look, the scam-protection helper from Sound Credit Union, on the phone. This is a hackathon concept demo; say so if asked.
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

export const SCREEN_RULES = `Sometimes the caller is not a Sound member but someone trying to reach one: the member turned on call screening and forwarded a call they didn't answer to you.
- Then say: "Hi, this is Second Look, an AI assistant screening calls for a Sound member. Who's calling, and what is this about?"
- Ask for their name, the organization they represent, what it's about, and a callback number. One question at a time.
- Never confirm the member's name, accounts or any details. Never agree to anything, take payment details, or promise a callback time. If they press, say you'll pass the message on.
- End with: "Thanks, I'll pass this on." Then stop.`;

export const LISTEN_RULES = `Sometimes the member adds you to a call that is already happening (a merged three-way call) so you can listen. If you hear the member talking with someone else, or they say they added you:
- Stay quiet and let them talk. Do not reply to ordinary conversation. If you must produce a reply, make it a single short "Mm-hm." at most.
- Speak up only if someone asks for a code, password or PIN, asks for gift cards, crypto, a wire or cash, says to move money to a safe account, or tells the member to keep it secret. Then say one sentence, for example: "This is Second Look from Sound, listening at the member's request: Sound will never ask for a code or to move money to a safe account."
- If the member speaks to you by name, answer briefly.`;

export async function configureAgent() {
  if (!phoneEnabled) return;
  await api('PATCH', `/v1/agents/${AGENT}`, {
    name: 'Second Look', voiceMode: 'hosted', enableBackchannel: false,
    systemPrompt: `${CALL_RULES}\n\n${LISTEN_RULES}\n\n${SCREEN_RULES}\n\nIf the member called you directly, ask what happened and help them check it.`,
    beginMessage: 'Hi, this is Second Look from Sound, an AI assistant. If you’re a member, tell me what’s going on. If you’re calling for a Sound member, tell me who you are and what it’s about, and I’ll pass it on.',
    voicemailMessage: 'Hi, this is Second Look from Sound, the scam-protection helper. If something feels off, call me back on this number, and please don’t share any codes or passwords in the meantime.',
  });
}

// ---- Watching live calls ----
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
  // Call screening: an unknown caller on an inbound call, while a member has screening on (most recent wins in this demo).
  // Only a verified phone can turn on screening. Forwarded calls don't tell us which member forwarded them, so we
  // route only when exactly one member has screening on; otherwise we don't guess (issue #23). In production each
  // member gets their own forwarding number, and the number dialed identifies them.
  let screenFor: string | null = null;
  if (!who && call.direction === 'inbound') {
    const on = sidsWhere(s => s.screening).filter(x => phoneVerified(x.sid));
    if (on.length === 1) screenFor = on[0].sid;
    else if (on.length > 1) console.log(`phone: unknown caller, but ${on.length} members have screening on; not attributing the call`);
  }
  const done = async () => {
    if (who && callState(key)?.live) await stopCall(key);
    if (screenFor) await screened(screenFor, member, turns);
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
    const transcript = turns.map(t => `${t.role === 'agent' ? 'Second Look' : 'Caller'}: ${t.content}`).join('\n');
    const d = await assess('call screening', caller, 'Call Second Look screened for you', transcript);
    if (!d) { console.log('phone: screened call looked ordinary; nothing kept'); return; }
    await record(sid, d, emailFor(sid), sendEmail);
  } catch (e) { console.error('phone: screening check failed:', (e as Error).message); }
}
const emailFor = (sid: string) => (db.prepare('SELECT address FROM email_links WHERE sid = ? AND verified = 1').get(sid) as { address: string } | undefined)?.address ?? null;

// Texts a member forwards to Second Look's number (inbound works without carrier registration; we reply in the app).
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
      'You read a phone call between Second Look (a credit union scam-protection helper) and a member. Decide whether the member clearly agreed to a fraud report to Sound, or asked for one. If so, fill the fraud case from what the member said.',
      turns.map(t => `${t.role === 'agent' ? 'Second Look' : 'Member'}: ${t.content}`).join('\n'), true);
    if (!d?.agreed) return;
    const out = await fileReport(sid, normalize(d, 'phone', { phone: member, linked: !!sid }));
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
