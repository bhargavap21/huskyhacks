// Synthetic stand-in for the hackathon kit (issue #18). The official kit files are not for public
// release, so they stay out of git; a fresh checkout runs on this instead (src/kit.ts falls back to it).
// Anchor members reproduce only the kit facts this repo already states publicly (DEMO.md, about.html,
// the tests): IDs, the payments the demo shows, their timestamps, amounts and rule fields. Every other
// row is invented. Background members are routine activity from a seeded generator.
// Deterministic: the same output on every run, and a test checks the committed files match.
// Run: npm run kit:synthetic   (writes fixtures/synthetic-kit/)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseKitTime } from '../src/kit.ts';

export const OUT_DIR = join(import.meta.dirname, '..', 'fixtures', 'synthetic-kit');
export const HEADER = ['event_id', 'synthetic_member_id', 'event_sequence', 'event_timestamp', 'event_type', 'channel', 'payment_id', 'payment_rail', 'amount', 'recipient_id', 'recipient_status', 'recipient_age_days', 'days_since_last_same_rail', 'amount_to_baseline_ratio', 'amount_vs_member_baseline', 'payment_velocity_band', 'available_balance_after', 'profile_change_recent', 'password_reset_recent', 'trusted_contact_enrolled', 'payment_status', 'event_note'];
const KEY_HEADER = ['synthetic_member_id', 'scenario_type', 'is_legitimate_lookalike', 'journey_outcome', 'net_member_loss'];

const DAY = 86_400_000, MIN = 60_000;
const fmt = (ms: number) => { const d = new Date(ms); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const money = (n: number) => n.toFixed(2);

// One authored event. Payment follow-ups (Held, Completed...) inherit the payment's fields from its initiation.
type Ev = {
  ts: number; type: string; channel?: string; note?: string;
  pid?: string; rail?: string; amount?: number; to?: string; recipient?: 'New' | 'Existing';
  gap?: number | null; ratio?: number; velocity?: 'Low' | 'Medium' | 'High'; status?: string;
};

// Account activity that is not a payment to a recipient: rail and direction of the money.
const FLOWS: Record<string, { rail: string; sign: 1 | -1; channel: string }> = {
  'Deposit': { rail: 'ACH', sign: 1, channel: 'ACH' },
  'Debit Purchase': { rail: 'Debit Card', sign: -1, channel: 'Card' },
  'ATM Withdrawal': { rail: 'Cash', sign: -1, channel: 'ATM' },
  'Bill Payment': { rail: 'Bill Pay', sign: -1, channel: 'Online Banking' },
  'Automatic Payment': { rail: 'ACH', sign: -1, channel: 'ACH' },
};
const CHANGES = new Set(['Email Change', 'Phone Change', 'Address Change']);
// Payment follow-ups that put the money back.
const REFUND = new Set(['Cancelled by Member', 'Stopped by Sound']);

class Member {
  evs: Ev[] = [];
  constructor(readonly id: string, readonly opening: number, readonly trusted = false) {}
  at(when: string | number, type: string, f: Omit<Ev, 'ts' | 'type'> = {}) { this.evs.push({ ts: typeof when === 'number' ? when : parseKitTime(when), type, ...f }); return this; }
  /** A routine payment to a saved recipient: initiated, completed two minutes later. */
  paid(when: string, pid: string, rail: string, amount: number, to: string, ratio: number) {
    this.at(when, 'Payment Initiated', { pid, rail, amount, to, recipient: 'Existing', ratio, channel: 'Mobile App' });
    return this.at(parseKitTime(when) + 2 * MIN, 'Payment Completed', { pid, status: 'Completed' });
  }
}

const band = (r: number) => (r < 1.5 ? 'Typical' : r < 3 ? 'Above Typical' : 'Significantly Above Typical');
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Turn a member's authored events into kit rows, deriving the fields the kit precomputes. */
function rows(m: Member): string[][] {
  const evs = m.evs.map((e, i) => ({ e, i })).sort((a, b) => a.e.ts - b.e.ts || a.i - b.i).map(x => x.e);
  const init = new Map<string, Ev>();
  let balance = m.opening;
  return evs.map((e, n) => {
    const recent = (types: (t: string) => boolean) => (evs.some(x => types(x.type) && x.ts <= e.ts && e.ts - x.ts <= 7 * DAY) ? 'Yes' : 'No');
    const trusted = m.trusted || evs.some(x => x.type === 'Trusted Contact Enrolled' && x.ts <= e.ts) ? 'Yes' : 'No';
    const base = [m.id, String(n + 1), fmt(e.ts), e.type, e.channel ?? FLOWS[e.type]?.channel ?? 'Online Banking'];
    const flags = [recent(t => CHANGES.has(t)), recent(t => t === 'Password Reset'), trusted];

    if (e.pid) {
      if (e.type === 'Payment Initiated') { init.set(e.pid, e); balance -= e.amount!; }
      else if (REFUND.has(e.status ?? '')) balance += init.get(e.pid)!.amount!;
      const p = init.get(e.pid)!;
      const prior = evs.filter(x => x.type === 'Payment Initiated' && x.rail === p.rail && x.ts < p.ts).at(-1);
      const gap = 'gap' in p ? p.gap! : prior ? Math.floor((p.ts - prior.ts) / DAY) : null;
      const added = evs.find(x => x.type === 'Recipient Added' && x.to === p.to && x.ts <= e.ts);
      const age = added ? Math.floor((e.ts - added.ts) / DAY) : p.recipient === 'New' ? 0 : 420;
      return [...base, e.pid, p.rail!, money(p.amount!), p.to ?? '', p.to ? p.recipient ?? 'Existing' : 'Not Applicable', p.to ? String(age) : '',
        gap === null ? '' : String(gap), p.ratio === undefined ? '' : p.ratio.toFixed(2), p.ratio === undefined ? 'Not Applicable' : band(p.ratio),
        p.velocity ?? 'Low', money(balance), ...flags, e.type === 'Payment Initiated' ? 'Pending' : e.status ?? 'Not Applicable', e.note ?? ''];
    }
    const flow = FLOWS[e.type];
    if (flow) {
      balance += flow.sign * e.amount!;
      return [...base, '', flow.rail, money(e.amount!), '', 'Not Applicable', '', '', '', 'Not Applicable', 'Not Applicable', money(balance), ...flags, 'Completed', e.note ?? ''];
    }
    const to = e.type === 'Recipient Added' ? e.to ?? '' : '';
    return [...base, '', 'Not Applicable', '', to, to ? 'New' : 'Not Applicable', to ? '0' : '', '', '', 'Not Applicable', 'Not Applicable', '', ...flags, 'Not Applicable', e.note ?? ''];
  });
}

// Small seeded PRNG (mulberry32) so background activity is identical on every run.
function prng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Everyday account activity from `from` up to (not including) `until`: logins, card, payroll, bills, ATM. */
function background(m: Member, seed: number, from: string, until: string, payees = 0) {
  const r = prng(seed), pick = (a: number, b: number) => a + r() * (b - a), round = (x: number) => Math.round(x * 100) / 100;
  const start = parseKitTime(from), end = parseKitTime(until);
  const payday = Math.floor(r() * 14);
  let pid = 0;
  for (let day = start, i = 0; day < end; day += DAY, i++) {
    const at = (h0: number, h1: number) => day + Math.floor(pick(h0, h1) * 60) * MIN;
    if (r() < 0.55) m.at(at(7, 21), 'Login', { channel: r() < 0.7 ? 'Mobile App' : 'Online Banking' });
    for (let k = r() < 0.6 ? 1 : r() < 0.4 ? 2 : 0; k > 0; k--) m.at(at(8, 21), 'Debit Purchase', { amount: round(pick(4, 140)) });
    if (i % 14 === payday) m.at(at(5, 7), 'Deposit', { amount: round(pick(1200, 3200)), note: 'Payroll' });
    if (new Date(day).getUTCDate() === 3) m.at(at(9, 12), 'Bill Payment', { amount: round(pick(80, 260)), note: 'Utilities' });
    if (new Date(day).getUTCDate() === 15) m.at(at(1, 3), 'Automatic Payment', { amount: round(pick(40, 180)), note: 'Insurance' });
    if (r() < 0.05) m.at(at(10, 19), 'ATM Withdrawal', { amount: 20 * Math.ceil(pick(2, 10)) });
    // Payments to saved recipients only (never new ones), so routine members stay quiet under every rule.
    if (payees && r() < 0.07) {
      const id = `P${m.id.slice(1)}-${String(++pid).padStart(3, '0')}`, t = at(9, 20);
      m.at(t, 'Payment Initiated', { pid: id, rail: 'P2P', amount: round(pick(20, 200)), to: `R${m.id.slice(1)}-0${1 + Math.floor(r() * payees)}`, recipient: 'Existing', ratio: round(pick(0.6, 1.4)), channel: 'Mobile App' });
      m.at(t + 2 * MIN, 'Payment Completed', { pid: id, status: 'Completed' });
    }
  }
  return m;
}

// ---- Anchor members (the demo scenes and tests depend on these exact rows) ----

function linda() { // M1001: family emergency. Wire held 14:21, outreach 15:42, released 17:04; next-day cash cancelled.
  const m = background(new Member('M1001', 6400), 1001, '9/1/2026 0:00', '10/20/2026 0:00');
  m.paid('9/14/2026 10:05', 'P1001-001', 'P2P', 120, 'R1001-01', 0.95).paid('10/12/2026 9:30', 'P1001-002', 'Bill Pay', 310, 'R1001-03', 1.1);
  m.at('10/20/2026 13:58', 'Branch Visit', { channel: 'Branch', note: 'Member at branch to send money to family' })
    .at('10/20/2026 14:04', 'Recipient Added', { channel: 'Branch', to: 'R1001-02' })
    .at('10/20/2026 14:11', 'Payment Initiated', { channel: 'Branch', pid: 'P1001-003', rail: 'Wire', amount: 8500, to: 'R1001-02', recipient: 'New', gap: 2411, ratio: 4.77 })
    .at('10/20/2026 14:21', 'Payment Held', { channel: 'Branch', pid: 'P1001-003', status: 'Held', note: 'Held for amount review' })
    .at('10/20/2026 14:26', 'Trusted Contact Offered', { channel: 'Branch', pid: 'P1001-003', status: 'Held', note: 'Member declined' })
    .at('10/20/2026 15:42', 'Employee Outreach', { channel: 'Contact Center', pid: 'P1001-003', status: 'Held', note: 'Member confirmed the payment is intended' })
    .at('10/20/2026 17:04', 'Payment Released', { channel: 'Branch', pid: 'P1001-003', status: 'Completed' })
    .at('10/21/2026 10:20', 'Branch Visit', { channel: 'Branch', note: 'Member asks to withdraw cash for a second bail payment' })
    .at('10/21/2026 10:24', 'Payment Initiated', { channel: 'Branch', pid: 'P1001-004', rail: 'Cash', amount: 4250, ratio: 6.1 })
    .at('10/21/2026 10:41', 'Employee Outreach', { channel: 'Branch', pid: 'P1001-004', status: 'Pending', note: 'Escalated: second bail request' })
    .at('10/21/2026 10:55', 'Payment Cancelled', { channel: 'Branch', pid: 'P1001-004', status: 'Cancelled by Member' })
    .at('10/21/2026 11:30', 'Scam Reported', { channel: 'Branch', note: 'Case created; wire recall requested' })
    .at('10/23/2026 15:10', 'Recovery Update', { channel: 'Contact Center', note: 'Wire recall unsuccessful' });
  return m;
}

function michael() { // M1002: romance. Growing P2P to one new recipient, then a first-ever wire (R3).
  const m = background(new Member('M1002', 5200), 1002, '9/1/2026 0:00', '10/15/2026 0:00');
  m.paid('9/5/2026 18:20', 'P1002-001', 'P2P', 60, 'R1002-01', 0.8).at('9/20/2026 21:14', 'Recipient Added', { channel: 'Mobile App', to: 'R1002-05' });
  [['9/21/2026 21:30', 200, 1.6], ['9/27/2026 22:02', 450, 3.4], ['10/3/2026 21:45', 900, 6.8], ['10/9/2026 22:10', 1500, 11.3]].forEach(([when, amount, ratio], i) => {
    const pid = `P1002-00${i + 2}`;
    m.at(when as string, 'Payment Initiated', { channel: 'Mobile App', pid, rail: 'P2P', amount: amount as number, to: 'R1002-05', recipient: 'New', ratio: ratio as number, velocity: i > 1 ? 'Medium' : 'Low' })
      .at(parseKitTime(when as string) + 2 * MIN, 'Payment Completed', { pid, status: 'Completed' });
  });
  m.at('10/14/2026 12:02', 'Recipient Added', { channel: 'Online Banking', to: 'R1002-06' })
    .at('10/14/2026 12:09', 'Payment Initiated', { channel: 'Online Banking', pid: 'P1002-006', rail: 'Wire', amount: 4800, to: 'R1002-06', recipient: 'New', gap: null, ratio: 3.6, velocity: 'High' })
    .at('10/14/2026 12:30', 'Payment Completed', { pid: 'P1002-006', status: 'Completed' });
  return m;
}

function sarah() { // M1003: takeover pattern. Password reset + phone change + new recipient, then two P2P (R2).
  const m = background(new Member('M1003', 4800), 1003, '9/1/2026 0:00', '10/15/2026 0:00');
  [['9/4/2026 12:10', 45, 'R1003-01', 0.7], ['9/11/2026 19:02', 80, 'R1003-02', 1.0], ['9/19/2026 13:40', 60, 'R1003-01', 0.9],
    ['9/26/2026 18:15', 110, 'R1003-03', 1.2], ['10/4/2026 11:25', 75, 'R1003-02', 0.9], ['10/11/2026 17:50', 90, 'R1003-01', 1.1]]
    .forEach(([when, amt, to, ratio], i) => m.paid(when as string, `P1003-00${i + 1}`, 'P2P', amt as number, to as string, ratio as number));
  m.at('10/15/2026 21:47', 'Failed Login', { note: 'New device' })
    .at('10/15/2026 21:49', 'Failed Login', { note: 'New device' })
    .at('10/15/2026 21:52', 'Password Reset', { note: 'Reset by email link' })
    .at('10/15/2026 21:58', 'Phone Change')
    .at('10/15/2026 22:18', 'Login', { note: 'New device' })
    .at('10/15/2026 22:21', 'Recipient Added', { to: 'R1003-09' })
    .at('10/15/2026 22:24', 'Payment Initiated', { pid: 'P1003-007', rail: 'P2P', amount: 950, to: 'R1003-09', recipient: 'New', ratio: 3.2, velocity: 'Medium' })
    .at('10/15/2026 22:31', 'Payment Completed', { pid: 'P1003-007', status: 'Completed' })
    .at('10/15/2026 22:41', 'Payment Initiated', { pid: 'P1003-008', rail: 'P2P', amount: 1400, to: 'R1003-09', recipient: 'New', ratio: 4.7, velocity: 'High' })
    .at('10/15/2026 22:44', 'Payment Completed', { pid: 'P1003-008', status: 'Completed' })
    .at('10/16/2026 8:05', 'Contact Center Call', { channel: 'Contact Center', note: 'Member says she did not make these changes' });
  return m;
}

function james() { // M1004: government impersonation. Branch cash soon after asking about limits (R4).
  const m = background(new Member('M1004', 14200), 1004, '9/1/2026 0:00', '9/30/2026 0:00');
  m.paid('9/8/2026 10:00', 'P1004-001', 'Bill Pay', 220, 'R1004-01', 1.0).paid('9/16/2026 15:20', 'P1004-002', 'P2P', 150, 'R1004-02', 1.1);
  m.at('9/24/2026 10:12', 'Contact Center Call', { channel: 'Contact Center', note: 'Asked about daily cash withdrawal limits' })
    .at('9/26/2026 11:40', 'Branch Visit', { channel: 'Branch', note: 'Asked about limits for a large cash withdrawal' })
    .at('9/29/2026 11:05', 'Payment Initiated', { channel: 'Branch', pid: 'P1004-003', rail: 'Cash', amount: 9000, ratio: 6.0 })
    .at('9/29/2026 11:20', 'Payment Completed', { channel: 'Branch', pid: 'P1004-003', status: 'Completed' });
  return m;
}

function m1037() { // Legitimate look-alike: urgent P2P to a grandchild's new account, typical amount. Standard banner only.
  const m = background(new Member('M1037', 3900), 1037, '9/1/2026 0:00', '10/6/2026 0:00');
  m.paid('9/28/2026 16:10', 'P1037-001', 'P2P', 150, 'R1037-01', 0.9);
  m.at('10/6/2026 9:33', 'Login', { channel: 'Mobile App' })
    .at('10/6/2026 9:36', 'Recipient Added', { channel: 'Mobile App', to: 'R1037-02' })
    .at('10/6/2026 9:41', 'Payment Initiated', { channel: 'Mobile App', pid: 'P1037-002', rail: 'P2P', amount: 1188.37, to: 'R1037-02', recipient: 'New', ratio: 1.14 })
    .at('10/6/2026 9:41', 'Warning Displayed', { channel: 'Mobile App', pid: 'P1037-002', status: 'Pending', note: 'Generic new-recipient warning' })
    .at('10/6/2026 9:43', 'Payment Completed', { channel: 'Mobile App', pid: 'P1037-002', status: 'Completed', note: 'Member confirmed' });
  return m;
}

function m1057() { // Legitimate look-alike: home-closing wire trips R1; held, then released after a callback.
  const m = background(new Member('M1057', 68000), 1057, '9/1/2026 0:00', '10/19/2026 0:00');
  [['9/3/2026 9:15', 'Bill Pay', 1850, 'R1057-01', 1.0], ['9/12/2026 14:00', 'P2P', 200, 'R1057-02', 0.9], ['9/24/2026 11:30', 'P2P', 150, 'R1057-03', 0.8],
    ['10/3/2026 9:10', 'Bill Pay', 1850, 'R1057-01', 1.0], ['10/10/2026 16:45', 'P2P', 250, 'R1057-02', 1.1]]
    .forEach(([when, rail, amt, to, ratio], i) => m.paid(when as string, `P1057-00${i + 1}`, rail as string, amt as number, to as string, ratio as number));
  m.at('10/19/2026 9:38', 'Login', { channel: 'Online Banking' })
    .at('10/19/2026 9:44', 'Recipient Added', { to: 'R1057-07', note: 'Title and escrow company' })
    .at('10/19/2026 9:52', 'Payment Initiated', { pid: 'P1057-006', rail: 'Wire', amount: 51586.52, to: 'R1057-07', recipient: 'New', gap: null, ratio: 42.63, note: 'Closing funds' })
    .at('10/19/2026 10:02', 'Payment Held', { pid: 'P1057-006', status: 'Held', note: 'Held for amount review' })
    .at('10/19/2026 13:31', 'Employee Outreach', { channel: 'Contact Center', pid: 'P1057-006', status: 'Held', note: 'Callback: member confirmed a home closing' })
    .at('10/19/2026 13:40', 'Payment Released', { pid: 'P1057-006', status: 'Completed' });
  return m;
}

function m1102() { // Government impersonation we miss: a $5,000 wire, not unusual enough for R1; R4 covers cash only.
  const m = background(new Member('M1102', 9100), 1102, '9/1/2026 0:00', '10/17/2026 0:00');
  [['9/9/2026 12:00', 'Bill Pay', 140, 'R1102-01', 1.0], ['9/22/2026 17:30', 'P2P', 90, 'R1102-02', 0.9], ['10/7/2026 12:05', 'Bill Pay', 140, 'R1102-01', 1.0]]
    .forEach(([when, rail, amt, to, ratio], i) => m.paid(when as string, `P1102-00${i + 1}`, rail as string, amt as number, to as string, ratio as number));
  m.at('10/17/2026 15:22', 'Contact Center Call', { channel: 'Contact Center', note: 'Asked about wire transfer limits' })
    .at('10/19/2026 13:40', 'Branch Visit', { channel: 'Branch', note: 'Wire request' })
    .at('10/19/2026 13:46', 'Recipient Added', { channel: 'Branch', to: 'R1102-03' })
    .at('10/19/2026 13:52', 'Payment Initiated', { channel: 'Branch', pid: 'P1102-004', rail: 'Wire', amount: 5000, to: 'R1102-03', recipient: 'New', gap: 412, ratio: 2.35 })
    .at('10/19/2026 13:52', 'Warning Displayed', { channel: 'Branch', pid: 'P1102-004', status: 'Pending', note: 'Generic new-recipient warning' })
    .at('10/19/2026 14:05', 'Payment Completed', { channel: 'Branch', pid: 'P1102-004', status: 'Completed' })
    .at('10/22/2026 9:40', 'Scam Reported', { channel: 'Contact Center', note: 'Caller claimed to be a federal agent' });
  return m;
}

const ANCHOR_KEY: string[][] = [
  ['M1001', 'Family Emergency', 'No', 'Wire held, member confirmed, released; next-day cash cancelled; recall unsuccessful', '8500.00'],
  ['M1002', 'Romance', 'No', 'Growing P2P payments, then a first wire', '7850.00'],
  ['M1003', 'Account Takeover', 'No', 'Two P2P payments after a password reset and phone change; reported next morning', '2350.00'],
  ['M1004', 'Government Impersonation', 'No', 'Branch cash withdrawal after asking about limits', '9000.00'],
  ['M1037', 'Normal Activity', 'Yes', 'Urgent P2P to a grandchild; generic banner; confirmed and completed', '0.00'],
  ['M1057', 'Normal Activity', 'Yes', 'Closing wire held by an amount rule; released after a callback', '0.00'],
  ['M1102', 'Government Impersonation', 'No', 'Wire to a "federal agent" after asking about limits; generic banner only', '5000.00'],
];
const ROUTINE = Array.from({ length: 16 }, (_, i) => `M${1010 + i}`);

/** Both files as CSV text. */
export function build() {
  const members = [linda(), michael(), sarah(), james(), m1037(), m1057(), m1102(),
    ...ROUTINE.map((id, i) => background(new Member(id, 3000 + i * 400, i % 4 === 0), Number(id.slice(1)), '9/1/2026 0:00', '11/1/2026 0:00', 3))];
  let n = 0;
  const events = [HEADER, ...members.flatMap(m => rows(m).map(r => [`E${String(++n).padStart(6, '0')}`, ...r]))];
  const key = [KEY_HEADER, ...ANCHOR_KEY, ...ROUTINE.map(id => [id, 'Normal Activity', 'No', 'No incident', '0.00'])];
  const csv = (t: string[][]) => t.map(r => r.map(esc).join(',')).join('\n') + '\n';
  return { events: csv(events), key: csv(key) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { events, key } = build();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'events.csv'), events);
  writeFileSync(join(OUT_DIR, 'member-key.csv'), key);
  console.log(`Wrote ${events.split('\n').length - 2} events and ${key.split('\n').length - 2} key rows to fixtures/synthetic-kit/`);
}
