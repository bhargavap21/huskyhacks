// Per-signal evidence for connected-channel alerts. Schema "signals/v1", documented in docs/signals.md;
// how it feeds detection is DECISIONS.md #10. Every signal carries a 0-1 score AND a span quoted from the
// message; a signal whose span isn't found in the message is dropped, so no score is ever shown bare.
// Risk comes from the verified signals by fixed rules (tier()), never from the model's own say-so.
import { tacticSpans } from './tactics.ts';

export const SIGNALS_VERSION = 'signals/v1';
export const SIGNAL_KEYS = ['urgency', 'secrecy', 'impersonation', 'threats', 'coaching', 'payment_pressure', 'credential_request'] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];
export const SIGNAL_LABELS: Record<SignalKey, string> = {
  urgency: 'Pressure to hurry',
  secrecy: 'Asked to keep it secret',
  impersonation: 'Claims to be someone trusted',
  threats: 'Threats or fear',
  coaching: 'Told what to say or do',
  payment_pressure: 'Pushed toward an unusual payment',
  credential_request: 'Asks for a code or password',
};
export const SIGNAL_HELP: Record<SignalKey, string> = {
  urgency: 'a deadline or pressure to act now',
  secrecy: 'told not to tell the bank, family or anyone; isolation; told not to check or call back',
  impersonation: 'claims to be the bank or credit union, the IRS, police, a federal agent, a company, or a family member',
  threats: 'arrest, account closure, fines, harm to a loved one, or other fear',
  coaching: 'told what to say to the bank or what to do step by step, kept on the line',
  payment_pressure: 'gift cards, crypto, wire or cash to a "safe" account, courier pickup, fees to release money',
  credential_request: 'asks for a one-time code, password, PIN, or to sign in through a link',
};
export type Signal = { key: SignalKey; label: string; score: number; span: string; source: 'model' | 'rules' };
export type Risk = 'high' | 'medium' | 'low';

// Pattern matches are not judgments, so rules get fixed, modest scores: a specific ask scores higher
// than wording that's common in ordinary mail ("today", "your bank").
const RULE_SCORE: Record<SignalKey, number> = { urgency: 0.5, impersonation: 0.5, threats: 0.5, secrecy: 0.7, coaching: 0.7, payment_pressure: 0.7, credential_request: 0.7 };
const TACTIC_TO_SIGNAL: Record<string, SignalKey | undefined> = { urgency: 'urgency', secrecy: 'secrecy', authority: 'impersonation', family: 'threats', payment: 'payment_pressure', code: 'credential_request', coached: 'coaching' };

export function ruleSignals(text: string): Signal[] {
  const out: Signal[] = [];
  for (const t of tacticSpans(text)) {
    const key = TACTIC_TO_SIGNAL[t.key];
    if (key && !out.some(s => s.key === key)) out.push({ key, label: SIGNAL_LABELS[key], score: RULE_SCORE[key], span: t.span, source: 'rules' });
  }
  return out;
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

/** Keep model signals only when their quoted span is really in the message; one signal per key, strongest wins. */
export function verify(text: string, raw: unknown, rules: Signal[] = []): { signals: Signal[]; dropped: number } {
  const best = new Map<SignalKey, Signal>();
  let dropped = 0;
  for (const r of Array.isArray(raw) ? raw : []) {
    const key = r?.key as SignalKey;
    const score = Number(r?.score);
    const span = typeof r?.span === 'string' ? locate(text, r.span.slice(0, 300)) : null;
    if (!SIGNAL_KEYS.includes(key) || !Number.isFinite(score) || !span) { dropped++; continue; }
    const s: Signal = { key, label: SIGNAL_LABELS[key], score: Math.round(Math.min(1, Math.max(0, score)) * 100) / 100, span: span.slice(0, 200), source: 'model' };
    if (s.score > (best.get(key)?.score ?? -1)) best.set(key, s);
  }
  // Rules fill in signals the model didn't report. Where both found one, the model's reading of context wins.
  for (const r of rules) if (!best.has(r.key)) best.set(r.key, r);
  return { signals: [...best.values()].sort((a, b) => b.score - a.score), dropped };
}

/**
 * Risk from evidence (calibrated against fixtures/emails.json, see docs/signals.md):
 * - high: two clear signals (>= 0.7), or a clear code/payment ask plus another sign, or a hard check (look-alike link,
 *   failed sender authentication) plus a signal.
 * - medium: one signal at 0.5 or more, or a hard check alone.
 * - low: only faint signals. Shown in the app, never pushed.
 */
export function tier(signals: Signal[], hardChecks: number): Risk {
  const clear = signals.filter(s => s.score >= 0.7);
  const moderate = signals.filter(s => s.score >= 0.5);
  if (clear.length >= 2) return 'high';
  if (clear.some(s => s.key === 'credential_request' || s.key === 'payment_pressure') && moderate.length >= 2) return 'high';
  if (hardChecks && moderate.length) return 'high';
  if (moderate.length || hardChecks) return 'medium';
  return 'low';
}
export const strength = (score: number) => (score >= 0.7 ? 'Clear' : score >= 0.5 ? 'Likely' : 'Faint');
