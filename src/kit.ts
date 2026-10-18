// Loads the kit's synthetic EVENTS file only. The Member Key is the answer key
// and must never be read by the app (HANDOFF section 6; test/leakage.test.ts).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The official kit files aren't in the repo (hackathon materials, not for public release). See README, "Getting the kit data".
export const EVENTS_PATH = process.env.KIT_EVENTS_PATH ?? join(import.meta.dirname, '..', 'data', 'HuskyHack_Synthetic_Events_v2.csv');
export const kitAvailable = () => existsSync(EVENTS_PATH);

// Canonical, case-sensitive labels from the data dictionary (HANDOFF section 9).
export const CANON = {
  recipient_status: ['New', 'Existing', 'Not Applicable'],
  yes_no: ['Yes', 'No'],
  amount_vs_member_baseline: ['Typical', 'Above Typical', 'Significantly Above Typical', 'Not Applicable'],
  payment_velocity_band: ['Low', 'Medium', 'High', 'Not Applicable'],
  payment_rail: ['Wire', 'ACH', 'P2P', 'External Transfer', 'Cash', 'Bill Pay', 'Debit Card', 'Not Applicable'],
  payment_status: ['Pending', 'Held', 'Completed', 'Cancelled by Member', 'Stopped by Sound', 'Not Applicable'],
} as const;

export type KitEvent = {
  event_id: string;
  member: string;
  seq: number;
  ts: number; // ms since epoch, kit local time treated as UTC wall clock
  ts_text: string;
  event_type: string;
  channel: string;
  payment_id: string;
  rail: string;
  amount: number;
  recipient_id: string;
  recipient_status: string;
  recipient_age_days: number | null;
  days_since_last_same_rail: number | null; // null = no prior use on record
  ratio: number | null;
  baseline_band: string;
  velocity_band: string;
  available_balance_after: number | null;
  profile_change_recent: string;
  password_reset_recent: string;
  trusted_contact_enrolled: string;
  payment_status: string;
  event_note: string;
};

/** Minimal RFC 4180 parser (quoted fields, embedded commas/quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { q = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Trim only; never lowercase or partial-match. Unknown labels throw so they can't silently miss. */
export function canon(kind: keyof typeof CANON, raw: string): string {
  const v = raw.trim();
  if (v === '') return v;
  if (!(CANON[kind] as readonly string[]).includes(v)) throw new Error(`Non-canonical ${kind} label: "${raw}"`);
  return v;
}

/** "10/20/2026 14:11" -> ms (wall clock as UTC so display never shifts). */
export function parseKitTime(s: string): number {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Bad kit timestamp: ${s}`);
  return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]);
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

export function toEvent(h: string[], r: string[]): KitEvent {
  const g = (k: string) => r[h.indexOf(k)] ?? '';
  return {
    event_id: g('event_id'),
    member: g('synthetic_member_id'),
    seq: Number(g('event_sequence')),
    ts: parseKitTime(g('event_timestamp')),
    ts_text: g('event_timestamp'),
    event_type: g('event_type'),
    channel: g('channel'),
    payment_id: g('payment_id'),
    rail: canon('payment_rail', g('payment_rail')),
    amount: Number(g('amount') || 0),
    recipient_id: g('recipient_id'),
    recipient_status: canon('recipient_status', g('recipient_status')),
    recipient_age_days: num(g('recipient_age_days')),
    days_since_last_same_rail: num(g('days_since_last_same_rail')),
    ratio: num(g('amount_to_baseline_ratio')),
    baseline_band: canon('amount_vs_member_baseline', g('amount_vs_member_baseline')),
    velocity_band: canon('payment_velocity_band', g('payment_velocity_band')),
    available_balance_after: num(g('available_balance_after')),
    profile_change_recent: canon('yes_no', g('profile_change_recent')),
    password_reset_recent: canon('yes_no', g('password_reset_recent')),
    trusted_contact_enrolled: canon('yes_no', g('trusted_contact_enrolled')),
    payment_status: canon('payment_status', g('payment_status')),
    event_note: g('event_note'),
  };
}

let cache: Map<string, KitEvent[]> | null = null;

/** All events grouped by member, in kit order (event_sequence). */
export function loadEvents(path = EVENTS_PATH): Map<string, KitEvent[]> {
  if (cache && path === EVENTS_PATH) return cache;
  if (!existsSync(path)) throw new Error(`Kit data not found at ${path}. The hackathon files aren't in the repo; see README, "Getting the kit data" (or set KIT_EVENTS_PATH).`);
  const [h, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  const by = new Map<string, KitEvent[]>();
  for (const r of rows) {
    if (r.length < h.length) continue;
    const e = toEvent(h, r);
    (by.get(e.member) ?? by.set(e.member, []).get(e.member)!).push(e);
  }
  for (const list of by.values()) list.sort((a, b) => a.seq - b.seq);
  if (path === EVENTS_PATH) cache = by;
  return by;
}

export function memberEvents(member: string): KitEvent[] {
  return loadEvents().get(member) ?? [];
}

/** The only view a rule may see: this member's events at or before the scored event (no future data). */
export function historyUpTo(events: KitEvent[], scored: KitEvent): KitEvent[] {
  return events.filter(e => e.seq <= scored.seq && e.ts <= scored.ts);
}
