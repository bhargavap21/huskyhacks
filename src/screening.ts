// Screen-then-connect for unknown callers (issue #25). Silence Unknown Callers + forward-unanswered sends unknown
// callers to Vantis; it asks who's calling and why, then asks THIS code whether to put them through.
// The decision is made here, from what the caller said, with evidence (DECISIONS.md, ADR 10), never by the
// voice model. Anything that looks like a scam is held back: the caller leaves a message and the member is alerted.
// Fails closed: no answer from here means the agent takes a message.
import { randomBytes } from 'node:crypto';
import { db } from './db.ts';
import { tacticsIn, type Signal } from './tactics.ts';
import { classify } from './classifier.ts';
import { client as defaultClient } from './chat.ts';

/** Shared secret the agent's custom tool sends; set per server start unless SCREENING_TOOL_SECRET is configured. */
export const TOOL_SECRET = process.env.SCREENING_TOOL_SECRET || randomBytes(24).toString('hex');
export const LOOP_MS = 3 * 60_000;

db.exec(`CREATE TABLE IF NOT EXISTS screened_calls (id INTEGER PRIMARY KEY, sid TEXT NOT NULL, ts INTEGER NOT NULL, call_id TEXT, json TEXT NOT NULL)`);

export type ScreenInput = { name: string; organization: string; reason: string; callback: string; said: string };
export type Decision = 'connect' | 'hold';
export type ScreenResult = { decision: Decision; why: string; say: string; evidence: { key: string; label: string; quote: string }[] };
export type ScreenedCall = ScreenInput & ScreenResult & { id: number; ts: number; caller: string; outcome: 'connecting' | 'put through' | 'held back' };

// Organizations whose calls Vantis never puts through: the member should call them back on a number they
// already have. Delivery companies, pharmacies and doctors are fine; banks, government and "tech support" are not.
export const NEVER_CONNECT = /\b(sound(?: credit union)?|credit union|bank|fraud (?:department|team|unit|prevention)|security (?:team|department)|irs|internal revenue|fbi|federal|sheriff|police|social security|ssa|medicare|government|tech(?:nical)? support|microsoft|apple support|geek squad|norton|mcafee)\b/i;
// Signals that always hold a call back. Urgency alone ("can you call me back today") doesn't.
const HOLD_ON: Signal[] = ['credential_request', 'payment_pressure', 'secrecy', 'remote_access', 'coaching', 'threats', 'impersonation', 'online_relationship'];

const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function input(args: any): ScreenInput {
  return { name: clean(args?.name, 80), organization: clean(args?.organization, 100), reason: clean(args?.reason, 300), callback: clean(args?.callback, 40), said: clean(args?.what_they_said ?? args?.said, 2000) };
}

const SAY = {
  connect: (i: ScreenInput) => `Thanks${i.name ? `, ${i.name.split(' ')[0]}` : ''}. I'll put you through now.`,
  authority: 'Thanks. I don’t put through calls from banks, government agencies or tech support. I’ll let them know you called, and they’ll contact your organization on a number they already have.',
  unknown: 'I can only put a call through when I know who’s calling and why. I’ll let them know someone called.',
  message: 'Thanks, I’ll pass your message on.',
  loop: 'They didn’t pick up, so I’ll pass your message on.',
};

/**
 * The connect-or-hold rules. `ctx.target` is the member who asked for legitimate callers to be put through
 * (null: nobody, so take a message). `ctx.lastTransfer` is when this member last got a transfer from this caller.
 */
export async function decide(i: ScreenInput, ctx: { target: string | null; lastTransfer?: number; client?: any; budgetMs?: number }): Promise<ScreenResult> {
  const text = [i.organization, i.reason, i.said].filter(Boolean).join('. ');
  const hold = (why: string, say: string, evidence: ScreenResult['evidence'] = []): ScreenResult => ({ decision: 'hold', why, say, evidence });
  const claim = NEVER_CONNECT.exec(`${i.organization} ${i.reason} ${i.said}`);
  // "Calling from UPS" is an ordinary delivery call; an impersonation match holds only for banks, agencies, tech support, or family in trouble.
  const rules = tacticsIn(text).filter(t => HOLD_ON.includes(t.key) && (t.key !== 'impersonation' || NEVER_CONNECT.test(t.quote) || /family/i.test(t.label)))
    .map(t => ({ key: t.key, label: t.label, quote: t.quote }));
  if (rules.length) return hold(rules.map(r => r.label.toLowerCase()).join(', '), SAY.message, rules);
  if (claim) return hold(`said they were calling from ${claim[0].replace(/^\w/, c => c.toUpperCase())}`, SAY.authority, [{ key: 'impersonation', label: 'Claims to be a bank, agency or company', quote: claim[0] }]);
  if (!i.name || !i.reason) return hold('wouldn’t say who they are or why they’re calling', SAY.unknown);
  if (ctx.lastTransfer && Date.now() - ctx.lastTransfer < LOOP_MS) return hold('called back after an unanswered transfer', SAY.loop);
  // The rules found nothing: let the classifier read it, within the time a caller will wait. Past the budget, the rules stand.
  const c = ctx.client === undefined ? defaultClient : ctx.client;
  if (c && text) {
    const v = await Promise.race([
      classify({ channel: 'call screening', from: i.callback || 'caller', subject: 'Call Vantis is screening', body: `Name: ${i.name}\nOrganization: ${i.organization || 'none given'}\nReason: ${i.reason}\nTheir words: ${i.said}` }, c).catch(() => null),
      new Promise<null>(r => setTimeout(() => r(null), ctx.budgetMs ?? 2500)),
    ]);
    const flagged = v?.alert ? v.signals.filter(s => HOLD_ON.includes(s.signal)) : [];
    if (flagged.length) return hold(flagged.map(s => s.label.toLowerCase()).join(', '), SAY.message, flagged.map(s => ({ key: s.signal, label: s.label, quote: s.quote })));
  }
  if (!ctx.target) return hold('the member takes messages from unknown callers', SAY.message);
  return { decision: 'connect', why: [i.organization, i.reason].filter(Boolean).join(': '), say: SAY.connect(i), evidence: [] };
}

// ---- Log of screened calls, for the member's Calls card ----
export function logScreened(sid: string, callId: string | null, caller: string, i: ScreenInput, r: ScreenResult) {
  const row: Omit<ScreenedCall, 'id' | 'ts'> = { ...i, ...r, caller: caller ? `…${caller.replace(/\D/g, '').slice(-4)}` : 'unknown number', outcome: r.decision === 'connect' ? 'connecting' : 'held back' };
  return Number(db.prepare('INSERT INTO screened_calls (sid, ts, call_id, json) VALUES (?, ?, ?, ?)').run(sid, Date.now(), callId, JSON.stringify(row)).lastInsertRowid);
}
/** After the call: a "connecting" call that ended is recorded as put through (AgentPhone transfers are cold). */
export function finishScreened(callId: string) {
  for (const r of db.prepare('SELECT id, json FROM screened_calls WHERE call_id = ?').all(callId) as { id: number; json: string }[]) {
    const c = JSON.parse(r.json);
    if (c.outcome === 'connecting') { c.outcome = 'put through'; db.prepare('UPDATE screened_calls SET json = ? WHERE id = ?').run(JSON.stringify(c), r.id); }
  }
}
export function screenedCalls(sid: string): ScreenedCall[] {
  return (db.prepare('SELECT id, ts, json FROM screened_calls WHERE sid = ? ORDER BY id DESC LIMIT 10').all(sid) as { id: number; ts: number; json: string }[])
    .map(r => ({ id: r.id, ts: r.ts, ...JSON.parse(r.json) }));
}
