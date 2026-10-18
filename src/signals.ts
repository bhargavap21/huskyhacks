// Per-signal evidence for connected-channel alerts, and the risk tier computed from it (DECISIONS.md, ADR 10;
// docs/signals.md). Signal names are the shared taxonomy in src/tactics.ts; the model's scores come from
// src/classifier.ts (docs/classifier-schema.md). Every signal carries a 0-1 score AND words quoted from the
// message, verified to be in it, so no score is ever shown bare. Risk comes from the evidence by fixed rules,
// never from the model's own say-so.
import { tacticsIn, SIGNALS, SIGNAL_LABELS, type Signal as SignalKey } from './tactics.ts';
import type { Classification } from './classifier.ts';

export const SIGNALS_VERSION = 'signals/v1';
export { SIGNALS as SIGNAL_KEYS, SIGNAL_LABELS, type SignalKey };
export type Signal = { key: SignalKey; label: string; score: number; span: string; source: 'model' | 'rules' };
export type Risk = 'critical' | 'high' | 'medium' | 'low';
/** Threat levels as members and slides see them (0 = nothing kept). Each level has its own action (monitor.ts). */
export const LEVEL: Record<Risk, number> = { low: 1, medium: 2, high: 3, critical: 4 };

// A pattern match is not a judgment, so rules get fixed, modest scores: a specific ask scores higher than
// wording that's common in ordinary mail ("today", "your bank"), which on its own only makes a low alert.
const RULE_SCORE: Record<SignalKey, number> = {
  urgency: 0.4, impersonation: 0.4, threats: 0.4, online_relationship: 0.4,
  secrecy: 0.7, coaching: 0.7, payment_pressure: 0.7, credential_request: 0.7, remote_access: 0.7,
};

export function ruleSignals(text: string): Signal[] {
  return tacticsIn(text).map(t => ({ key: t.key, label: t.label, score: RULE_SCORE[t.key], span: t.quote, source: 'rules' as const }));
}

const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').toLowerCase();
/** The span as it appears in the message (original casing), or null if the message doesn't contain it. */
export function locate(text: string, span: string): string | null {
  const want = norm(span.trim().replace(/^["'“”‘’]+|["'“”‘’.…]+$/g, ''));
  if (want.length < 3) return null;
  const flat = text.replace(/\s+/g, ' ');
  const i = norm(flat).indexOf(want);
  return i < 0 ? null : flat.slice(i, i + want.length);
}

/**
 * Merge the classifier's verified signals (strong and faint) with rule signals: one per key. Where both found
 * one, the model's reading of context wins; rules fill in what it left out.
 */
export function merge(v: Classification | null, rules: Signal[]): Signal[] {
  const best = new Map<SignalKey, Signal>();
  for (const x of [...(v?.signals ?? []), ...(v?.faint ?? [])]) {
    if (!SIGNALS.includes(x.signal) || best.has(x.signal)) continue;
    best.set(x.signal, { key: x.signal, label: x.label, score: x.score, span: x.quote, source: 'model' });
  }
  for (const r of rules) if (!best.has(r.key)) best.set(r.key, r);
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * Risk from evidence (calibrated against fixtures/emails.json; docs/signals.md):
 * - critical: a clear code, payment or remote-access ask plus impersonation, threats, secrecy or a hard check.
 * - high: two clear signals (>= 0.7); or a clear code, payment or remote-access ask plus another sign at 0.5+;
 *   or a hard check (look-alike link, failed sender authentication, quoted prompt injection) plus a sign at 0.5+.
 * - medium: one sign at 0.5 or more, or a hard check alone.
 * - low: only faint signs. Shown in the app, never pushed.
 */
export function tier(signals: Signal[], hardChecks: number): Risk {
  const clear = signals.filter(s => s.score >= 0.7);
  const moderate = signals.filter(s => s.score >= 0.5);
  // Critical: a clear ask for a code, money or device access, from someone posing as trusted or using fear or
  // secrecy (or behind a look-alike link). The scam is live and the member may act in minutes.
  const ask = clear.some(s => s.key === 'credential_request' || s.key === 'payment_pressure' || s.key === 'remote_access');
  const pressure = moderate.some(s => s.key === 'impersonation' || s.key === 'threats' || s.key === 'secrecy') || hardChecks > 0;
  if (ask && pressure && moderate.length >= 2) return 'critical';
  if (clear.length >= 2) return 'high';
  if (clear.some(s => s.key === 'credential_request' || s.key === 'payment_pressure' || s.key === 'remote_access') && moderate.length >= 2) return 'high';
  if (hardChecks && moderate.length) return 'high';
  if (moderate.length || hardChecks) return 'medium';
  return 'low';
}
export const strength = (score: number) => (score >= 0.7 ? 'Clear' : score >= 0.5 ? 'Likely' : 'Faint');
