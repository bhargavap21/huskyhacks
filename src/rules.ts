// Detection rules R1-R4 (HANDOFF section 9). Each returns the field evidence it matched; no bare scores.
// Thresholds are PROPOSED, not validated. Rules receive only history up to the scored event.
import type { KitEvent } from './kit.ts';

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'STD';
/** Rail-specific output (must match the payment state machine, section 7). */
export type Output = 'HOLD' | 'PRESUBMIT_REVIEW' | 'BRANCH_CONVERSATION' | 'BANNER';
export type Evidence = { field: string; value: string; why: string };
export type Finding = { rule: RuleId; title: string; output: Output; tier: 'T1' | 'T2'; evidence: Evidence[] };

const DAY = 86_400_000;
export const HOLDABLE = new Set(['Wire', 'ACH', 'External Transfer']);
const CHANGE_EVENTS = new Set(['Password Reset', 'Email Change', 'Phone Change', 'Address Change']);

const within = (a: KitEvent, b: KitEvent, days: number) => b.ts - a.ts >= 0 && b.ts - a.ts <= days * DAY;
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gapText = (g: number | null) => (g === null ? 'no prior use on record' : `${g.toLocaleString('en-US')} days`);

/** R1 Family-emergency shape (Wire only) -> HOLD. Anchor M1001. */
function r1(p: KitEvent): Finding | null {
  const g = p.days_since_last_same_rail;
  if (p.recipient_status === 'New' && p.rail === 'Wire' && (g === null || g >= 365) && (p.ratio ?? 0) >= 3.0) {
    return {
      rule: 'R1', title: 'First wire in a long time, to a brand-new recipient, well above usual', output: 'HOLD', tier: 'T2',
      evidence: [
        { field: 'recipient_status', value: p.recipient_status, why: 'This recipient was just added' },
        { field: 'days_since_last_same_rail', value: gapText(g), why: 'Wires are rare for this member' },
        { field: 'amount_to_baseline_ratio', value: `${p.ratio}x (${usd(p.amount)})`, why: 'Much larger than this member usually sends' },
      ],
    };
  }
  return null;
}

/** R2 ATO cluster -> verification first. Output depends on rail: holdable rails HOLD, P2P stops at pre-submit. */
function r2(p: KitEvent, h: KitEvent[]): Finding | null {
  if (!(p.password_reset_recent === 'Yes' || p.profile_change_recent === 'Yes')) return null;
  const changes = h.filter(e => CHANGE_EVENTS.has(e.event_type) && within(e, p, 7));
  const added = h.filter(e => e.event_type === 'Recipient Added' && within(e, p, 7));
  if (!changes.length || !added.length) return null;
  const output: Output = HOLDABLE.has(p.rail) ? 'HOLD' : 'PRESUBMIT_REVIEW';
  return {
    rule: 'R2', title: 'Recent sign-in or contact changes, then a new recipient and a payment', output, tier: 'T2',
    evidence: [
      ...changes.map(e => ({ field: 'event_type', value: `${e.event_type} (${e.ts_text})`, why: 'Account access or contact details changed recently' })),
      { field: 'event_type', value: `Recipient Added (${added[added.length - 1].ts_text})`, why: 'A new recipient was added after the change' },
      { field: 'payment_rail', value: p.rail, why: output === 'HOLD' ? 'Can be held up to 4 hours' : 'P2P cannot be recalled once sent, so it waits before submit' },
    ],
  };
}

/** R3 Escalating pattern -> T1 banner + human outreach. Anchor M1002. Includes External Transfer (DECISIONS #8). */
function r3(p: KitEvent, h: KitEvent[]): Finding | null {
  if (!(p.rail === 'Wire' || p.rail === 'External Transfer') || p.days_since_last_same_rail !== null) return null;
  if (h.some(e => e.seq < p.seq && e.event_type === 'Payment Initiated' && e.rail === p.rail)) return null;
  const byRecipient = new Map<string, KitEvent[]>();
  for (const e of h) {
    if (e.seq >= p.seq || e.event_type !== 'Payment Initiated' || e.rail !== 'P2P' || e.recipient_status !== 'New' || !within(e, p, 30)) continue;
    (byRecipient.get(e.recipient_id) ?? byRecipient.set(e.recipient_id, []).get(e.recipient_id)!).push(e);
  }
  for (const [rid, xs] of byRecipient) {
    const amts = xs.map(x => x.amount);
    if (amts.length >= 3 && amts.every((a, i) => i === 0 || a > amts[i - 1])) {
      return {
        rule: 'R3', title: 'Payments to one new recipient kept growing, now a first-ever ' + p.rail.toLowerCase(), output: 'BANNER', tier: 'T1',
        evidence: [
          { field: 'P2P series', value: `${amts.length} payments to ${rid}: ${amts.map(usd).join(' → ')}`, why: 'Each payment was larger than the last' },
          { field: 'days_since_last_same_rail', value: `no prior ${p.rail.toLowerCase()} on record`, why: 'A new way of sending money' },
          { field: 'amount', value: usd(p.amount), why: 'The amount is moving up again' },
        ],
      };
    }
  }
  return null;
}

/** R4 Branch cash after a limits question -> branch conversation (no timer). Anchor M1004.
 *  Reads event_note, which the dictionary marks "Partly" observable: disclosed as an employee-recorded call topic. */
function r4(p: KitEvent, h: KitEvent[]): Finding | null {
  const above = (p.ratio ?? 0) >= 3.0 || p.baseline_band === 'Above Typical' || p.baseline_band === 'Significantly Above Typical';
  if (!(p.rail === 'Cash' && p.channel === 'Branch' && above)) return null;
  const ask = h.filter(e => (e.event_type === 'Contact Center Call' || e.event_type === 'Branch Visit') && within(e, p, 30) && /limit/i.test(e.event_note));
  if (!ask.length) return null;
  return {
    rule: 'R4', title: 'Large branch cash withdrawal soon after asking about limits', output: 'BRANCH_CONVERSATION', tier: 'T2',
    evidence: [
      { field: 'amount_vs_member_baseline', value: `${p.baseline_band} (${p.ratio}x, ${usd(p.amount)})`, why: 'Larger than usual cash' },
      { field: 'event_note (employee-recorded call topic)', value: `${ask[0].event_type} ${ask[0].ts_text}: "${ask[0].event_note}"`, why: 'Asked about limits shortly before' },
    ],
  };
}

/** Standard new-recipient banner (the kit's generic warning, made specific). Not a hold. */
function std(p: KitEvent): Finding | null {
  if (p.recipient_status !== 'New') return null;
  return {
    rule: 'STD', title: 'New recipient', output: 'BANNER', tier: 'T1',
    evidence: [
      { field: 'recipient_status', value: 'New', why: 'You have not paid this recipient before' },
      { field: 'amount_vs_member_baseline', value: `${p.baseline_band}${p.ratio !== null ? ` (${p.ratio}x)` : ''}`, why: p.baseline_band === 'Typical' ? 'The amount is in line with your usual' : 'The amount is above your usual' },
    ],
  };
}

/** Score a Payment Initiated event against its history (must already be cut at the event). */
export function score(p: KitEvent, history: KitEvent[]): Finding[] {
  if (p.event_type !== 'Payment Initiated') return [];
  if (history.some(e => e.ts > p.ts || e.seq > p.seq)) throw new Error('Future data passed to rules');
  const found = [r1(p), r2(p, history), r3(p, history), r4(p, history)].filter((f): f is Finding => !!f);
  if (!found.length) { const s = std(p); if (s) found.push(s); }
  return found;
}

/** The strongest output wins for the payment's gate. */
export function primary(findings: Finding[]): Finding | null {
  const order: Output[] = ['HOLD', 'PRESUBMIT_REVIEW', 'BRANCH_CONVERSATION', 'BANNER'];
  return [...findings].sort((a, b) => order.indexOf(a.output) - order.indexOf(b.output))[0] ?? null;
}
