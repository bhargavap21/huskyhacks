// Simulated Sound environment: replays one member's kit timeline on a compressed clock and,
// in "with Vantis" mode, runs the rules and the enforced payment state machine.
// Each browser session has two worlds: the live console (real-time clock, seeded sample cases flagged `sample`, and
// reports from the member's real channels) and, behind "View demo", the scene replay. They never share state.
// Nothing here touches real money, accounts, or Sound systems.
import type { FraudCase } from './reports.ts';
import { memberEvents, historyUpTo, type KitEvent } from './kit.ts';
import { score, primary, type Finding, HOLDABLE } from './rules.ts';
import { newPayment, transition, TERMINAL, TransitionError, type Payment, type Gate } from './payments.ts';
import { audit, db, type AuditWorld } from './db.ts';
import { newPolicy, decide, dismiss, type PolicyState, type Decision, type Sensitivity } from './alerts.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Fictional demo identities (name and contact on file) live in seed data, not code: fixtures/demo-members.json.
type Identity = { name: string; contact: string; on_file_since?: string; changed_to: string };
const IDENTITIES: Record<string, Partial<Identity>> = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'demo-members.json'), 'utf8'));
const identity = (member: string) => ({ ...IDENTITIES.default, ...IDENTITIES[member] }) as Identity;
/** Every member name we hold, for the redaction before model calls (src/redact.ts). Labels like "Home buyer" are skipped there. */
export const memberNames = () => Object.values(IDENTITIES).flatMap(i => (typeof i?.name === 'string' ? [i.name] : []));

export type Mode = 'as_is' | 'second_look';
export type Scene = { id: string; member: string; mode: Mode; start: string; title: string; blurb: string };

const KIT_DAY_SECONDS = 20; // 1 kit-day = 20 s (HANDOFF section 12)
export const NORMAL_SPEED = 86_400 / KIT_DAY_SECONDS;
export const HOLD_SPEED = 60; // while a payment waits on people: 4 h hold = 4 real minutes

export const SCENES: Scene[] = [
  { id: 'linda-asis', member: 'M1001', mode: 'as_is', start: '10/20/2026 13:58', title: 'Linda (M1001): what happened in the kit', blurb: 'Kit rows only. The wire was held at 14:21, outreach at 15:42, Linda confirmed, it released at 17:04.' },
  { id: 'linda-sl', member: 'M1001', mode: 'second_look', start: '10/20/2026 13:58', title: 'Linda (M1001): with Vantis (proposed alternative)', blurb: 'Same kit signals. R1 fires at initiation and the hold lands with evidence and a conversation guide. A design hypothesis, not a historical claim.' },
  { id: 'm1037', member: 'M1037', mode: 'second_look', start: '10/6/2026 9:33', title: 'M1037: restraint (legitimate look-alike)', blurb: 'Urgent $1,188.37 P2P to a grandchild’s new account. Typical amount. R1 does not fire: one standard banner, one tap, done.' },
  { id: 'm1057', member: 'M1057', mode: 'second_look', start: '10/19/2026 9:38', title: 'M1057: same trigger, legitimate (false positive)', blurb: 'Closing wire of $51,586.52. R1 fires exactly as for Linda. The answer is a fast confirm-and-release, in minutes.' },
  { id: 'm1003', member: 'M1003', mode: 'second_look', start: '10/15/2026 22:18', title: 'Sarah (M1003): takeover pattern (scripted premise)', blurb: 'Password reset + contact change + new recipient. P2P waits before submit for verification to pre-change contact details.' },
  { id: 'm1102', member: 'M1102', mode: 'second_look', start: '10/19/2026 13:40', title: 'M1102: a scam we miss', blurb: 'A $5,000 wire for a “federal agent”. Not unusual enough for R1, and R4 covers cash only. Only the standard banner shows.' },
];

export type CaseRec = {
  id: number; pid: string; pids: string[]; recipient: string; rule: string; title: string; tier: 'T0' | 'T1' | 'T2'; output: string;
  evidence: Finding['evidence']; findings: Finding[]; status: 'open' | 'closed'; created_sim: number; created_real: number;
  member_id?: string; sample?: boolean; // live console: whose case, and whether it is a seeded sample
  member_label: 'none' | 'looks_fine' | 'reported'; label_seconds: number | null; callback_requested: boolean;
  actions: { ts: number; actor: string; action: string; detail: string }[];
  alert: Decision | null;
};
export type PayRec = {
  pid: string; rail: string; amount: number; recipient: string; channel: string; initiated_sim: number;
  state: Payment; kit_status?: string; case_id: number | null; row: KitEvent;
  member_id?: string; settled?: boolean;
};
export type Member = {
  id: string; name: string; enrolled: boolean; trusted_contact: { name: string; relation: string; when: string } | null;
  contact_changed_sim: number | null; pre_change_contact: string; current_contact: string;
};

type World = {
  kind: AuditWorld; live: boolean; members: Record<string, Member>; // live: several members' cases in one queue
  scene: Scene; mode: Mode; sim: number; speed: number; running: boolean; cursor: number; events: KitEvent[];
  timeline: { ts: number; text: string; kind: 'kit' | 'suppressed' | 'system' }[];
  payments: Map<string, PayRec>; cases: CaseRec[]; awaiting: string | null; member: Member;
  confirm_code: { code: string; pid: string; sent_to: string; why: string } | null; ended: boolean;
  next_case: number; seen: number;
  policy: PolicyState; notifications: { ts: number; text: string; case_id: number }[];
  callbacks: { id: number; ts: number; reason: string; source: string; urgent: boolean; status: 'waiting' | 'done'; note: string; report?: FraudReport }[];
};

// Worlds per browser session so viewers don't interfere with each other: the live console under the session id,
// the demo walkthrough under demoKey(sid).
const worlds = new Map<string, World>();
const MAX_WORLDS = 300, IDLE_MS = 3 * 3_600_000;
let w: World;
export const DEMO_SUFFIX = '~demo';
export const demoKey = (sid: string) => sid + DEMO_SUFFIX;
export const isDemoKey = (key: string) => key.endsWith(DEMO_SUFFIX);

function select(key: string, make: (key: string) => World) {
  let x = worlds.get(key);
  if (!x) {
    if (worlds.size >= MAX_WORLDS) {
      const oldest = [...worlds.entries()].sort((a, b) => a[1].seen - b[1].seen)[0];
      worlds.delete(oldest[0]);
    }
    x = make(key);
    worlds.set(key, x);
  }
  x.seen = Date.now();
  w = x;
}
/** Select (or create) a scene world by key. All exported functions act on the selected world. */
export function useWorld(key: string) { select(key, () => blank(SCENES[1])); }
/** Forget a session's world, as a restart or idle eviction would (tests). */
export function dropWorld(key: string) { worlds.delete(key); }
/** Select (or create) this session's live console world. */
export function useLive(sid: string) { select(sid, liveWorld); }

/** Advance every active world's clock. */
export function tickAll(realMs: number) {
  const now = Date.now();
  for (const [sid, x] of worlds) {
    if (now - x.seen > IDLE_MS) { worlds.delete(sid); continue; }
    w = x; tick(realMs);
  }
}

function blank(scene: Scene): World {
  const events = memberEvents(scene.member);
  const start = toMs(scene.start), who = identity(scene.member);
  const w0: World = {
    kind: 'demo', live: false, members: {},
    scene, mode: scene.mode, sim: start, speed: NORMAL_SPEED, running: false, cursor: 0, events, timeline: [],
    payments: new Map(), cases: [], awaiting: null, ended: false, confirm_code: null, next_case: 1, seen: Date.now(), policy: newPolicy(), notifications: [], callbacks: [],
    member: { id: scene.member, name: who.name, enrolled: scene.mode === 'second_look', trusted_contact: null, contact_changed_sim: null, pre_change_contact: who.contact + (who.on_file_since ? ` (on file since ${who.on_file_since})` : ''), current_contact: who.contact },
  };
  // Fast-forward silently to the scene start so balances, recipients and flags are in place.
  while (w0.cursor < events.length && events[w0.cursor].ts < start) applyRow(w0, events[w0.cursor++], true);
  return w0;
}

function toMs(s: string) { const [d, t] = s.split(' '); const [m, dd, y] = d.split('/').map(Number); const [h, mi] = t.split(':').map(Number); return Date.UTC(y, m - 1, dd, h, mi); }
export const fmt = (ms: number) => { const d = new Date(ms); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

export function loadScene(id: string, sid: string) {
  const s = SCENES.find(x => x.id === id);
  if (!s) throw new Error('Unknown scene');
  w = blank(s);
  worlds.set(sid, w);
  db.prepare('DELETE FROM chat_messages WHERE scene = ?').run(`${sid}:${s.id}`);
  audit('demo', 'scene_loaded', s.id, 'demo');
}

// ---- The live console: seeded sample cases on a real-time clock ----
// The kit is synthetic, so the live queue starts with sample cases taken from the with-Vantis scenes, each stopped
// at the moment its case opens and flagged `sample`. Linda (the first) is the member the member view shows.
const LIVE_SCENE: Scene = { id: 'live', member: 'M1001', mode: 'second_look', start: '', title: 'Live', blurb: '' };
const SAMPLE_SEEDS = ['linda-sl', 'm1003', 'm1057'];
let seeding = false; // seeding replays kit rows; those aren't actions anyone took, so they aren't audited

function runToCase(scene: Scene) {
  const x = blank(scene), prev = w; w = x;
  while (!x.awaiting && x.cursor < x.events.length) { x.sim = Math.max(x.sim, x.events[x.cursor].ts); applyRow(x, x.events[x.cursor++]); }
  w = prev;
  return x;
}
/** Move a seed world's clock (and every time in it) so its case opened just now. */
function shiftTo(x: World, now: number) {
  const d = now - x.sim;
  for (const p of x.payments.values()) {
    p.initiated_sim += d;
    if (p.state.hold_started_at !== null) p.state = { ...p.state, hold_started_at: p.state.hold_started_at + d, hold_expires_at: (p.state.hold_expires_at ?? 0) + d };
  }
  for (const c of x.cases) { c.created_sim += d; for (const a of c.actions) a.ts += d; }
  for (const n of x.notifications) n.ts += d;
  if (x.member.contact_changed_sim !== null) x.member.contact_changed_sim += d;
  x.sim = now;
}
function liveWorld(sid: string): World {
  const now = Date.now();
  seeding = true;
  let seeds: World[];
  try { seeds = SAMPLE_SEEDS.map(id => runToCase(SCENES.find(s => s.id === id)!)); } finally { seeding = false; }
  seeds.forEach(x => shiftTo(x, now));
  const [base, ...rest] = seeds;
  const L: World = { ...base, kind: 'live', live: true, scene: LIVE_SCENE, members: { [base.member.id]: base.member }, running: true, ended: false, speed: 1, timeline: [], cursor: base.events.length, seen: now };
  for (const c of L.cases) Object.assign(c, { member_id: base.member.id, sample: true });
  for (const p of L.payments.values()) p.member_id = base.member.id;
  for (const x of rest) {
    L.members[x.member.id] = x.member;
    for (const c of x.cases.slice().reverse()) {
      const id = L.next_case++;
      for (const pid of c.pids) { const p = x.payments.get(pid)!; p.case_id = id; p.member_id = x.member.id; L.payments.set(pid, p); }
      L.cases.push({ ...c, id, member_id: x.member.id, sample: true });
    }
  }
  restoreReports(L, sid);
  return L;
}

// Fraud cases are kept in SQLite (fraud_cases); the work queue is rebuilt from them whenever this session's live world
// is created, so a server restart or an idle session doesn't lose them. Same one-open-report-per-channel rule as
// fraudReport; not audited again (they were audited when filed).
function restoreReports(L: World, sid: string) {
  let rows: { ts: number; json: string }[] = [];
  try { rows = db.prepare('SELECT ts, json FROM fraud_cases WHERE sid = ? ORDER BY id').all(sid) as typeof rows; } catch { return; } // no reports module loaded yet: nothing filed
  for (const row of rows) {
    let r: FraudReport & { world?: string; queue_status?: 'waiting' | 'done'; queue_note?: string };
    try { r = JSON.parse(row.json); } catch { continue; }
    if (!r?.case_id || r.world === 'demo') continue;
    const status = r.queue_status === 'done' ? 'done' : 'waiting';
    const open = status === 'waiting' && L.callbacks.find(x => x.status === 'waiting' && x.report && x.report.channel === r.channel);
    if (open) { open.report = r; open.urgent = open.urgent || r.money_sent; continue; }
    L.callbacks.unshift({ id: L.callbacks.length + 1, ts: row.ts, reason: r.money_sent ? 'Vantis report: money may already be gone, start recovery' : 'Vantis report: member facing a possible scam', source: `Filed by Vantis from ${r.channel}, at the member’s request`, urgent: true, status, note: r.queue_note ?? '', report: r });
  }
}

const SKIP = new Set(['Login', 'Debit Purchase', 'ATM Withdrawal', 'Deposit', 'Automatic Payment', 'Bill Payment']);
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const line = (e: KitEvent) => `${e.event_type}${e.payment_id ? ` · ${e.payment_id}` : ''}${e.amount ? ` · ${e.rail} ${usd(e.amount)}` : ''}${e.channel ? ` · ${e.channel}` : ''}${e.event_note ? ` — “${e.event_note}”` : ''}`;

function act(c: CaseRec, actor: string, action: string, detail = '') {
  c.actions.push({ ts: w.sim, actor, action, detail });
  if (!seeding) audit(actor, action, `case ${c.id} ${c.pid}${detail ? ': ' + detail : ''}`, w.kind);
}

/** Apply one kit row. In second_look mode, rows for a payment Vantis took over are suppressed. */
function applyRow(W: World, e: KitEvent, silent = false) {
  if (['Email Change', 'Phone Change'].includes(e.event_type)) { W.member.contact_changed_sim = e.ts; W.member.current_contact = `${identity(W.member.id).changed_to} (changed ${e.ts_text})`; }
  if (e.event_type === 'Trusted Contact Enrolled') W.member.trusted_contact = { name: 'Enrolled contact', relation: 'from kit', when: 'any hold' };
  const owned = e.payment_id && W.payments.get(e.payment_id)?.case_id != null && W.mode === 'second_look';
  if (owned && e.event_type !== 'Payment Initiated') {
    if (!silent && !SKIP.has(e.event_type)) W.timeline.push({ ts: e.ts, text: `Kit history diverges here: ${line(e)}`, kind: 'suppressed' });
    return;
  }
  if (W.mode === 'second_look' && W.awaiting && ['Trusted Contact Offered', 'Employee Outreach', 'Confirmation Requested', 'Warning Displayed'].includes(e.event_type) && !e.payment_id) {
    if (!silent) W.timeline.push({ ts: e.ts, text: `Kit history diverges here: ${line(e)}`, kind: 'suppressed' });
    return;
  }
  if (e.event_type === 'Payment Initiated' && e.payment_id) {
    const p: PayRec = { pid: e.payment_id, rail: e.rail, amount: e.amount, recipient: e.recipient_id, channel: e.channel, initiated_sim: e.ts, state: newPayment(e.rail), case_id: null, row: e };
    W.payments.set(e.payment_id, p);
    if (W.mode === 'second_look' && !silent && W.member.enrolled) {
      W.timeline.push({ ts: e.ts, text: line(e), kind: 'kit' });
      W.sim = e.ts; // the case and any hold start at initiation
      openCase(W, p, e);
      return;
    }
  } else if (e.payment_id && W.payments.has(e.payment_id)) {
    const p = W.payments.get(e.payment_id)!;
    if (p.case_id == null) p.kit_status = e.payment_status; // kit-driven status for payments Vantis did not take over
  }
  if (!silent && !SKIP.has(e.event_type)) W.timeline.push({ ts: e.ts, text: line(e), kind: 'kit' });
}

const SITUATION_MS = 24 * 3_600_000;

function openCase(W: World, p: PayRec, e: KitEvent) {
  const findings = score(e, historyUpTo(W.events, e));
  const f = primary(findings);
  if (!f) return;
  const gate: Gate = f.output === 'PRESUBMIT_REVIEW' ? 'presubmit_review' : f.output === 'BRANCH_CONVERSATION' ? 'branch_conversation' : f.output === 'BANNER' ? 'banner_confirm' : 'none';
  p.state = newPayment(p.rail, gate);
  const prev = w; w = W;
  // One case per situation (HANDOFF section 8): same rule and same recipient, or same rule within 24 h, accumulates on the existing case.
  const same = W.cases.find(x => x.rule === f.rule && (x.recipient === p.recipient || W.sim - x.created_sim <= SITUATION_MS));
  let c: CaseRec;
  if (same) {
    c = same;
    c.pids.push(p.pid); c.pid = p.pid; c.status = 'open'; c.evidence = f.evidence; c.findings = findings; c.created_real = Date.now();
    act(c, 'system', 'payment_added', `another ${p.rail} ${usd(p.amount)} in the same situation; material change (a payment initiated), so the member sees it once`);
    if (W.payments.get(c.pids[0])?.state.ato_verified) { p.state = transition(p.state, { kind: 'verify_ato' }); act(c, 'system', 'ato_carried_over', 'takeover already verified on this case'); }
  } else {
    c = {
      id: W.next_case++, pid: p.pid, pids: [p.pid], recipient: p.recipient, rule: f.rule, title: f.title, tier: f.tier, output: f.output, evidence: f.evidence, findings,
      status: 'open', created_sim: W.sim, created_real: Date.now(), member_label: 'none', label_seconds: null, callback_requested: false, actions: [], alert: null,
    };
    W.cases.unshift(c);
    act(c, 'system', 'case_opened', `${f.rule} → ${f.output}; tier ${f.tier}; promoted because: ${f.evidence.map(x => x.value).join(' + ')}`);
  }
  p.case_id = c.id;
  // Alert policy: how the member is told (T0/T1/T2). The in-session banner always shows; interruptions are budgeted.
  const d = decide(W.policy, { key: `${f.rule}:${c.recipient}`, ts: W.sim, tier: f.tier, evidence: f.evidence.map(x => x.value), evidence_types: findings.map(x => x.rule), amount: p.amount, recipient: p.recipient, payment_active: true, rule: f.rule });
  c.alert = d;
  act(c, 'system', 'alert_decision', `${d.tier}${d.interrupt ? ', interrupt' : ''}${d.banner_in_place ? ', banner in place' : ''}${d.suppressed ? `; ${d.suppressed}` : ''}; ${d.why}`);
  if (d.interrupt) W.notifications.unshift({ ts: W.sim, case_id: c.id, text: f.output === 'HOLD' ? 'Sound: a payment is paused. Open the app to review.' : 'Sound: a payment needs a quick check before it goes.' });
  if (f.output === 'HOLD') { p.state = transition(p.state, { kind: 'hold', now: W.sim }); act(c, 'system', 'hold_placed', 'up to 4 hours; employee notified'); }
  w = prev;
  W.awaiting = p.pid;
  W.speed = HOLD_SPEED;
  W.timeline.push({ ts: W.sim, text: `Vantis: ${f.rule} — ${f.title} → ${f.output.replace('_', ' ').toLowerCase()}`, kind: 'system' });
}

// Live: any member's payment settles (the queue holds several members). Demo: only the one the scene waits on.
function settle(p: PayRec) {
  if (TERMINAL.includes(p.state.status) && !p.settled && (w.awaiting === p.pid || w.live)) {
    p.settled = true;
    if (w.awaiting === p.pid) { w.awaiting = null; w.speed = w.live ? 1 : NORMAL_SPEED; }
    const c = w.cases.find(x => x.id === p.case_id);
    if (c) {
      act(c, 'system', 'payment_final', `${p.pid}: ${p.state.status}`);
      if (c.pids.every(id => TERMINAL.includes(w.payments.get(id)!.state.status))) c.status = 'closed';
    }
    w.timeline.push({ ts: w.sim, text: `Payment ${p.pid}: ${p.state.status}`, kind: 'system' });
  }
}

/** Advance the clock. Called by the server loop (real ms elapsed). */
export function tick(realMs: number) {
  if (!w.running || w.ended) return;
  w.sim = w.live ? Date.now() : w.sim + realMs * w.speed;
  for (const p of w.payments.values()) {
    if (p.state.status === 'Held' && p.state.hold_expires_at !== null && w.sim >= p.state.hold_expires_at) {
      w.sim = p.state.hold_expires_at;
      p.state = transition(p.state, { kind: 'expire', now: w.sim });
      const c = w.cases.find(x => x.id === p.case_id)!;
      act(c, 'system', 'hold_expired', p.state.status === 'Completed' ? 'member had reconfirmed: executed' : 'no reconfirm: returned unsent, member notified, can resubmit');
      settle(p);
    }
  }
  if (w.live || w.awaiting) return; // live has no replay; in a scene the journey waits on people and only the hold clock runs
  while (w.cursor < w.events.length && w.events[w.cursor].ts <= w.sim) {
    applyRow(w, w.events[w.cursor++]);
    if (w.awaiting) break;
  }
  if (w.cursor >= w.events.length) { w.ended = true; w.running = false; }
}

export function control(cmd: string, sid: string) {
  if (cmd === 'play') w.running = true;
  else if (cmd === 'pause') w.running = false;
  else if (cmd === 'next') {
    if (w.awaiting) throw new TransitionError('Waiting on the member or an employee');
    while (w.cursor < w.events.length && SKIP.has(w.events[w.cursor].event_type)) applyRow(w, w.events[w.cursor++]);
    if (w.cursor < w.events.length) { w.sim = Math.max(w.sim, w.events[w.cursor].ts); applyRow(w, w.events[w.cursor++]); }
  } else if (cmd === 'faster') w.speed *= 4;
  else if (cmd === 'reset') loadScene(w.scene.id, sid);
}

const pay = (pid: string) => { const p = w.payments.get(pid); if (!p) throw new TransitionError('Unknown payment'); return p; };
const caseOf = (id: number) => { const c = w.cases.find(x => x.id === id); if (!c) throw new TransitionError('Unknown case'); return c; };
const caseFor = (p: PayRec) => caseOf(p.case_id!);

/** Member-side actions (the member app). */
export function member(action: string, b: any) {
  if (action === 'enroll') { w.member.enrolled = !!b.on; audit('member', b.on ? 'second_look_on' : 'second_look_off', w.member.id, w.kind); return; }
  if (action === 'alert_settings') {
    if (['fewer', 'standard', 'more'].includes(b.sensitivity)) w.policy.sensitivity = b.sensitivity as Sensitivity;
    if (b.quiet !== undefined) w.policy.quiet = b.quiet ? { start_hour: 21, end_hour: 7 } : null;
    audit('member', 'alert_settings', `${w.policy.sensitivity}; quiet hours ${w.policy.quiet ? 'on' : 'off'}`, w.kind); return;
  }
  if (action === 'trusted_contact') { w.member.trusted_contact = b.remove ? null : { name: String(b.name || '').slice(0, 60), relation: String(b.relation || '').slice(0, 40), when: 'a payment is held' }; audit('member', b.remove ? 'trusted_contact_revoked' : 'trusted_contact_enrolled', w.member.id, w.kind); return; }
  const p = pay(b.pid); const c = caseFor(p);
  if (p.member_id && p.member_id !== w.member.id) throw new TransitionError('Unknown payment'); // another member's case in the live queue
  switch (action) {
    case 'looks_fine': // banner path: one tap
      p.state = transition(p.state, { kind: 'clear_gate', actor: 'member' });
      p.state = transition(p.state, { kind: 'submit' });
      c.member_label = 'looks_fine'; c.label_seconds = Math.round((Date.now() - c.created_real) / 100) / 10;
      dismiss(w.policy, `${c.rule}:${c.recipient}`);
      act(c, 'member', 'this_is_fine', `confirmed in ${c.label_seconds}s; recorded as member feedback, not silent training`);
      break;
    case 'cancel':
      p.state = transition(p.state, { kind: 'cancel' }); act(c, 'member', 'cancelled_payment'); break;
    case 'request_code': {
      const changed = w.member.contact_changed_sim !== null && w.sim - w.member.contact_changed_sim <= 7 * 86_400_000;
      w.confirm_code = { code: String(100000 + Math.floor(Math.random() * 900000)), pid: p.pid, sent_to: changed ? w.member.pre_change_contact : w.member.current_contact, why: changed ? 'Your contact details changed in the last 7 days, so we sent this to the details you had before the change.' : 'Sent to the contact details on file.' };
      act(c, 'system', 'confirmation_sent', `to ${w.confirm_code.sent_to}`); break;
    }
    case 'override_release':
      if (!w.confirm_code || w.confirm_code.pid !== p.pid || String(b.code) !== w.confirm_code.code) throw new TransitionError('That code does not match. Request a new one.');
      p.state = transition(p.state, { kind: 'release', actor: 'member', reason: 'Member override after step-up confirmation' });
      w.confirm_code = null; c.member_label = 'looks_fine'; dismiss(w.policy, `${c.rule}:${c.recipient}`); c.label_seconds = Math.round((Date.now() - c.created_real) / 100) / 10;
      act(c, 'member', 'override_release', `member's decision, confirmed in ${c.label_seconds}s`); break;
    case 'reconfirm':
      p.state = transition(p.state, { kind: 'reconfirm' }); act(c, 'member', 'reconfirmed', 'send when the hold window ends'); break;
    case 'callback':
      c.callback_requested = true; act(c, 'member', 'asked_to_talk', 'member requested a call from Sound'); break;
    case 'report':
      if (!TERMINAL.includes(p.state.status)) p.state = transition(p.state, { kind: 'cancel' });
      c.member_label = 'reported'; act(c, 'member', 'reported_scam', 'case created; recovery request started if money already moved');
      if (p.state.status === 'Completed') act(c, 'system', 'recovery_request', HOLDABLE.has(p.rail) ? 'recall/return requested: possible, not guaranteed' : 'P2P cannot be recalled; reported to the receiving institution');
      break;
    default: throw new TransitionError('Unknown member action');
  }
  settle(p);
}

const REASONS: Record<string, { text: string; urgent: boolean }> = {
  talk: { text: 'Member asked to talk to a person', urgent: false },
  sent: { text: 'Member says money already went out: start recovery now', urgent: true },
  report: { text: 'Member is reporting a possible scam', urgent: true },
};
/** Member asks for a person (from any chat). Lands in the employee queue; never budgeted or quieted. */
export function requestCallback(kind: string, caseId: number) {
  const r = REASONS[kind];
  if (!r) throw new TransitionError('Unknown request');
  const open = w.callbacks.find(x => x.status === 'waiting' && x.reason === r.text);
  if (open) return open.id; // one request per reason
  const id = w.callbacks.length + 1;
  const source = caseId ? `chat about case ${caseId}` : 'Something feels off chat';
  w.callbacks.unshift({ id, ts: w.sim, reason: r.text, source, urgent: r.urgent, status: 'waiting', note: '' });
  audit('member', 'callback_requested', `${kind} from ${source}`, w.kind);
  if (caseId) { const c = w.cases.find(x => x.id === caseId); if (c) { c.callback_requested = true; act(c, 'member', 'asked_to_talk', r.text); } }
  return id;
}
/** What Vantis tells Sound's fraud team when the member agrees (from chat, a phone call, email or the app). */
export type FraudReport = FraudCase;
export function fraudReport(r: FraudReport) {
  const open = w.callbacks.find(x => x.status === 'waiting' && x.report && x.report.channel === r.channel);
  if (open) { open.report = r; open.urgent = open.urgent || r.money_sent; return open.id; } // one open report per channel, kept up to date
  const id = w.callbacks.length + 1;
  w.callbacks.unshift({ id, ts: w.sim, reason: r.money_sent ? 'Vantis report: money may already be gone, start recovery' : 'Vantis report: member facing a possible scam', source: `Filed by Vantis from ${r.channel}, at the member’s request`, urgent: true, status: 'waiting', note: '', report: r });
  audit('second-look', 'fraud_report', `${r.channel}: ${r.summary.slice(0, 200)}`, w.kind);
  return id;
}
export function callbackDone(id: number, note: string) {
  const cb = w.callbacks.find(x => x.id === id);
  if (!cb) throw new TransitionError('Unknown request');
  cb.status = 'done'; cb.note = note.slice(0, 300) || 'Called member';
  if (cb.report?.case_id) db.prepare(`UPDATE fraud_cases SET json = json_set(json, '$.queue_status', 'done', '$.queue_note', ?) WHERE json_extract(json, '$.case_id') = ?`).run(cb.note, cb.report.case_id);
  audit('employee', 'callback_done', `request ${id}: ${cb.note}`, w.kind);
}

/** Employee console actions. Every one is audited. */
export function employee(action: string, b: any) {
  const c = caseOf(Number(b.caseId)); const p = pay(c.pid);
  const reason = String(b.reason ?? '').slice(0, 300);
  switch (action) {
    case 'outreach': act(c, 'employee', 'outreach', reason || 'called member using the conversation guide'); break;
    case 'escalate': act(c, 'employee', 'escalated', reason || 'escalated to fraud team'); break;
    case 'member_cancel': // employee records the member's own decision (the member decides)
      p.state = transition(p.state, { kind: 'cancel' }); act(c, 'employee', 'member_cancelled', reason || 'member chose to cancel during the call'); break;
    case 'release':
      p.state = transition(p.state, { kind: 'release', actor: 'employee', reason }); act(c, 'employee', 'released', reason); break;
    case 'clear_review': // after verification shows the member is in control
      p.state = transition(p.state, { kind: 'clear_gate', actor: 'employee' }); p.state = transition(p.state, { kind: 'submit' });
      act(c, 'employee', 'review_cleared', reason || 'verified with member via pre-change contact'); break;
    case 'branch_outcome':
      if (b.outcome === 'cancel') { p.state = transition(p.state, { kind: 'cancel' }); act(c, 'employee', 'branch_conversation', 'member decided not to proceed'); }
      else { p.state = transition(p.state, { kind: 'clear_gate', actor: 'employee' }); p.state = transition(p.state, { kind: 'submit' }); act(c, 'employee', 'branch_conversation', 'member decided to proceed (their decision)'); }
      break;
    case 'verify_ato':
      if (c.rule !== 'R2') throw new TransitionError('Takeover verification applies to the R2 pattern only');
      p.state = transition(p.state, { kind: 'verify_ato' }); act(c, 'employee', 'ato_verified', `${w.live ? '' : 'SCRIPTED PREMISE: '}member confirmed via pre-change phone that they did not make these changes`); break;
    case 'stop':
      p.state = transition(p.state, { kind: 'stop' }); act(c, 'employee', 'stopped', 'verified account takeover'); break;
    case 'trusted_notify': {
      const m = (c.member_id && w.members[c.member_id]) || w.member;
      if (!m.trusted_contact) throw new TransitionError('No trusted contact enrolled. The member can add one in Settings.');
      act(c, 'employee', 'trusted_contact_notified', `informational message to ${m.trusted_contact.name}: no balances, no account access`); break;
    }
    case 'recovery':
      act(c, 'employee', 'recovery_request', HOLDABLE.has(p.rail) ? 'recall/return requested: not guaranteed, faster is better' : 'P2P cannot be recalled'); break;
    default: throw new TransitionError('Unknown employee action');
  }
  settle(p);
}

export function caseForChat(id: number) {
  const c = caseOf(id); const p = pay(c.pid);
  return { c, p, member: w.member };
}

export function snapshot() {
  const pays = [...w.payments.values()].map(p => ({
    pid: p.pid, rail: p.rail, amount: p.amount, recipient: p.recipient, channel: p.channel, initiated: fmt(p.initiated_sim), initiated_at: p.initiated_sim,
    status: p.case_id != null ? p.state.status : (p.kit_status ?? p.state.status), gate: p.state.gate,
    hold_expires_at: p.state.hold_expires_at, hold_started_at: p.state.hold_started_at, reconfirmed: p.state.member_reconfirmed,
    ato_verified: p.state.ato_verified, case_id: p.case_id, member_id: p.member_id,
    row: { ratio: p.row.ratio, gap: p.row.days_since_last_same_rail, recipient_status: p.row.recipient_status, recipient_age_days: p.row.recipient_age_days, band: p.row.baseline_band, profile_change_recent: p.row.profile_change_recent, password_reset_recent: p.row.password_reset_recent, trusted_contact_enrolled: p.row.trusted_contact_enrolled, balance_after: p.row.available_balance_after },
  }));
  return {
    live: w.live, members: w.live ? w.members : undefined,
    scene: w.scene, scenes: SCENES.map(s => ({ id: s.id, title: s.title })), mode: w.mode, sim: w.sim, sim_text: fmt(w.sim),
    speed: w.speed, running: w.running, ended: w.ended, awaiting: w.awaiting, member: w.member,
    callbacks: w.callbacks.map(c => ({ ...c, ts_text: fmt(c.ts) })),
    alerts: { sensitivity: w.policy.sensitivity, quiet: !!w.policy.quiet }, notifications: w.notifications.slice(0, 5).map(n => ({ ...n, ts_text: fmt(n.ts) })),
    timeline: w.timeline.slice(-40).map(t => ({ ...t, ts_text: fmt(t.ts) })), payments: pays.reverse(), cases: w.cases,
    confirm_code: w.confirm_code ? { sent_to: w.confirm_code.sent_to, why: w.confirm_code.why, pid: w.confirm_code.pid, demo_code: w.confirm_code.code } : null,
  };
}
