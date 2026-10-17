// Payment state machine (HANDOFF section 7). Enforced inside the simulation only.
import { HOLDABLE } from './rules.ts';

export const HOLD_MS = 4 * 3_600_000;

export type Status = 'Pending' | 'Held' | 'Completed' | 'Cancelled by Member' | 'Stopped by Sound' | 'Returned Unsent';
/** Pending gates: what must be cleared before submit. */
export type Gate = 'none' | 'banner_confirm' | 'presubmit_review' | 'branch_conversation';

export type Payment = {
  rail: string;
  status: Status;
  gate: Gate;
  hold_started_at: number | null;
  hold_expires_at: number | null;
  member_reconfirmed: boolean;
  ato_verified: boolean; // set only by the scripted ATO review beat (R2), labeled as a premise
  member_authorized: boolean; // false only once ATO is verified
};

export type Action =
  | { kind: 'clear_gate'; actor: 'member' | 'employee' }
  | { kind: 'submit' }
  | { kind: 'hold'; now: number }
  | { kind: 'release'; actor: 'member' | 'employee'; reason: string }
  | { kind: 'reconfirm' }
  | { kind: 'cancel' }
  | { kind: 'verify_ato' }
  | { kind: 'stop' }
  | { kind: 'expire'; now: number };

export const TERMINAL: Status[] = ['Completed', 'Cancelled by Member', 'Stopped by Sound', 'Returned Unsent'];

export class TransitionError extends Error {}
const no = (msg: string): never => { throw new TransitionError(msg); };

export function newPayment(rail: string, gate: Gate = 'none'): Payment {
  return { rail, status: 'Pending', gate, hold_started_at: null, hold_expires_at: null, member_reconfirmed: false, ato_verified: false, member_authorized: true };
}

/** Returns the next payment state or throws TransitionError. Never mutates the input. */
export function transition(p: Payment, a: Action): Payment {
  if (TERMINAL.includes(p.status)) no(`Payment is ${p.status}; no further changes`);
  const n = { ...p };
  switch (a.kind) {
    case 'clear_gate':
      if (p.status !== 'Pending' || p.gate === 'none') no('Nothing to clear');
      if (p.gate === 'presubmit_review' && a.actor !== 'employee') no('Pre-submit review is cleared by an employee after verification');
      n.gate = 'none';
      return n;
    case 'submit':
      if (p.status !== 'Pending') no('Only a pending payment can be submitted');
      if (p.gate !== 'none') no(`Cannot submit: ${p.gate.replace('_', ' ')} not cleared`);
      n.status = 'Completed';
      return n;
    case 'hold':
      if (!HOLDABLE.has(p.rail)) no(`${p.rail} cannot be held${p.rail === 'P2P' ? ' (P2P cannot be recalled; intervene before submit)' : p.rail === 'Cash' ? ' (cash is a branch conversation, no timer)' : ''}`);
      if (p.status !== 'Pending') no('Only a pending payment can be held');
      if (p.hold_started_at !== null) no('This payment was already held once; holds cannot be extended past 4 hours');
      n.status = 'Held'; n.hold_started_at = a.now; n.hold_expires_at = a.now + HOLD_MS;
      return n;
    case 'release':
      if (p.status !== 'Held') no('Only a held payment can be released');
      if (!a.reason.trim()) no('Release requires a reason');
      if (!p.member_authorized) no('Takeover verified: this payment is not the member’s and cannot be released');
      n.status = 'Completed';
      return n;
    case 'reconfirm':
      if (p.status !== 'Held') no('Reconfirm applies to a held payment');
      n.member_reconfirmed = true;
      return n;
    case 'cancel':
      if (p.status !== 'Pending' && p.status !== 'Held') no('Nothing to cancel');
      n.status = 'Cancelled by Member';
      return n;
    case 'verify_ato':
      n.ato_verified = true; n.member_authorized = false;
      return n;
    case 'stop':
      if (!p.ato_verified) no('Stop is only for verified account takeover. For the member’s own payment, Sound can delay and advise; the member decides.');
      n.status = 'Stopped by Sound';
      return n;
    case 'expire':
      if (p.status !== 'Held' || p.hold_expires_at === null) return no('No hold to expire');
      if (a.now < p.hold_expires_at) no('Hold has not reached 4 hours');
      // PROPOSED disposition (kit is silent): execute only on a recorded reconfirm; otherwise return unsent. Never auto-send.
      n.status = p.member_reconfirmed && p.member_authorized ? 'Completed' : 'Returned Unsent';
      return n;
  }
}
