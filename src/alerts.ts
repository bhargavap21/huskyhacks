// Alert policy (HANDOFF section 8). PROPOSED thresholds, explicitly assumptions to validate in the pilot.
// Decides how a finding is presented to the member: T0 quiet inbox, T1 in-place banner, T2 interruption.
// Budgets, cooldowns and quiet hours govern member interruptions only. They never suppress an active
// payment checkpoint, the employee queue, or the hold-expiry path (those don't go through here).

export type Tier = 'T0' | 'T1' | 'T2';
export type Sensitivity = 'fewer' | 'standard' | 'more';
export type Item = {
  key: string;                 // situation key: thread, recipient or payment (one case per situation)
  ts: number;                  // ms
  tier: Tier;                  // tier the evidence supports
  evidence: string[];          // named evidence; empty means stay quiet
  evidence_types: string[];    // e.g. rule ids or pattern ids, for material-change checks
  amount?: number;
  recipient?: string;
  payment_active: boolean;     // a payment is being initiated or is held right now
  rule?: string;
};
export type Decision = { case_key: string; tier: Tier; interrupt: boolean; banner_in_place: boolean; why: string; suppressed?: string };

type CaseMem = { first: number; last_alert: number | null; dismissed: boolean; types: Set<string>; max_amount: number; recipients: Set<string>; payments: number };
export type PolicyState = {
  sensitivity: Sensitivity;
  quiet: { start_hour: number; end_hour: number } | null; // kit wall-clock hours, e.g. 21 -> 7
  cases: Map<string, CaseMem>;
  t2_log: number[];
  t1_log: number[];
};

export const BUDGET = { t2_per_day: 1, t1_per_week: 3 };
const DAY = 86_400_000;

export function newPolicy(sensitivity: Sensitivity = 'standard'): PolicyState {
  return { sensitivity, quiet: null, cases: new Map(), t2_log: [], t1_log: [] };
}

export function inQuietHours(s: PolicyState, ts: number) {
  if (!s.quiet) return false;
  const h = new Date(ts).getUTCHours();
  const { start_hour: a, end_hour: b } = s.quiet;
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

/** Member dismissed or overrode the case: start the cooldown. */
export function dismiss(s: PolicyState, key: string) {
  const c = s.cases.get(key);
  if (c) c.dismissed = true;
}

/** What counts as a material change on a dismissed case. Returns the reason, or null. */
export function materialChange(c: CaseMem, it: Item): string | null {
  const newType = it.evidence_types.find(t => !c.types.has(t));
  if (newType) return `new evidence type (${newType})`;
  if (it.amount !== undefined && it.amount > c.max_amount) return 'higher amount';
  if (it.recipient && !c.recipients.has(it.recipient)) return 'new recipient';
  if (it.payment_active && c.payments === 0) return 'a payment was initiated';
  return null;
}

export function decide(s: PolicyState, it: Item): Decision {
  // Every promotion must name its evidence; with none, the item stays quiet.
  if (!it.evidence.length) return { case_key: it.key, tier: 'T0', interrupt: false, banner_in_place: false, why: 'no named evidence' };

  let tier = it.tier;
  if (s.sensitivity === 'fewer' && tier === 'T1' && !it.payment_active) tier = 'T0';
  if (s.sensitivity === 'more' && tier === 'T0') tier = 'T1';

  const why = `because: ${it.evidence.join(' + ')}`;
  let c = s.cases.get(it.key);
  const isNew = !c;
  let change: string | null = null;
  if (!c) {
    c = { first: it.ts, last_alert: null, dismissed: false, types: new Set(), max_amount: 0, recipients: new Set(), payments: 0 };
    s.cases.set(it.key, c);
  } else {
    change = materialChange(c, it);
  }
  const remember = () => {
    it.evidence_types.forEach(t => c!.types.add(t));
    if (it.amount !== undefined) c!.max_amount = Math.max(c!.max_amount, it.amount);
    if (it.recipient) c!.recipients.add(it.recipient);
    if (it.payment_active) c!.payments++;
  };

  // During an active payment session the relevant banner always shows: that is context, not an interruption.
  const banner = it.payment_active && tier !== 'T0';

  // Cooldown: a dismissed case is quiet unless something materially changed (then it re-alerts once).
  if (!isNew && c.dismissed && !change) { remember(); return { case_key: it.key, tier: 'T0', interrupt: false, banner_in_place: banner, why, suppressed: 'cooldown: dismissed, no material change' }; }
  // Same situation already alerted and nothing material changed: accumulate evidence on the case, no new alert.
  if (!isNew && !c.dismissed && c.last_alert !== null && !change) { remember(); return { case_key: it.key, tier, interrupt: false, banner_in_place: banner, why, suppressed: 'same situation, already alerted' }; }
  remember();
  if (change) c.dismissed = false;

  if (tier === 'T2') {
    const quiet = inQuietHours(s, it.ts);
    const used = s.t2_log.filter(t => it.ts - t < DAY).length;
    if (it.payment_active) { // active money risk: never suppressed by budget or quiet hours
      s.t2_log.push(it.ts); c.last_alert = it.ts;
      return { case_key: it.key, tier, interrupt: true, banner_in_place: true, why: why + (change ? `; re-alert: ${change}` : '') };
    }
    if (quiet) return { case_key: it.key, tier: 'T1', interrupt: false, banner_in_place: false, why, suppressed: 'quiet hours (no payment in progress)' };
    if (used >= BUDGET.t2_per_day) return { case_key: it.key, tier: 'T1', interrupt: false, banner_in_place: false, why, suppressed: 'daily interruption budget used' };
    s.t2_log.push(it.ts); c.last_alert = it.ts;
    return { case_key: it.key, tier, interrupt: true, banner_in_place: false, why: why + (change ? `; re-alert: ${change}` : '') };
  }
  if (tier === 'T1') {
    if (banner) { c.last_alert = it.ts; return { case_key: it.key, tier, interrupt: false, banner_in_place: true, why }; }
    const used = s.t1_log.filter(t => it.ts - t < 7 * DAY).length;
    if (used >= BUDGET.t1_per_week) return { case_key: it.key, tier: 'T0', interrupt: false, banner_in_place: false, why, suppressed: 'weekly banner budget used' };
    s.t1_log.push(it.ts); c.last_alert = it.ts;
    return { case_key: it.key, tier, interrupt: false, banner_in_place: false, why };
  }
  return { case_key: it.key, tier: 'T0', interrupt: false, banner_in_place: false, why };
}
