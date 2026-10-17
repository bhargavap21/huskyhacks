import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPayment, transition, TransitionError, HOLD_MS, type Payment } from '../src/payments.ts';

const T0 = Date.UTC(2026, 9, 20, 14, 11);
const held = (rail = 'Wire'): Payment => transition(newPayment(rail), { kind: 'hold', now: T0 });
const bad = (p: Payment, a: any) => assert.throws(() => transition(p, a), TransitionError);

test('Wire, ACH, External Transfer can be held for exactly 4 hours', () => {
  for (const r of ['Wire', 'ACH', 'External Transfer']) {
    const p = held(r);
    assert.equal(p.status, 'Held');
    assert.equal(p.hold_expires_at! - p.hold_started_at!, HOLD_MS);
  }
});
test('P2P can never enter Held; Cash never gets a timer', () => {
  bad(newPayment('P2P'), { kind: 'hold', now: T0 });
  bad(newPayment('Cash'), { kind: 'hold', now: T0 });
});
test('a hold cannot be re-placed to extend past 4 hours', () => {
  const p = { ...held(), status: 'Pending' as const };
  bad(p, { kind: 'hold', now: T0 + 1 });
});
test('Held leaves only via release / cancel / stop / expiry; never plain submit', () => {
  bad(held(), { kind: 'submit' });
  assert.equal(transition(held(), { kind: 'release', actor: 'member', reason: 'I confirmed with my grandson' }).status, 'Completed');
  assert.equal(transition(held(), { kind: 'cancel' }).status, 'Cancelled by Member');
});
test('release requires a reason', () => bad(held(), { kind: 'release', actor: 'employee', reason: ' ' }));
test('expiry never auto-sends: without reconfirm the payment returns unsent', () => {
  bad(held(), { kind: 'expire', now: T0 + HOLD_MS - 1 });
  assert.equal(transition(held(), { kind: 'expire', now: T0 + HOLD_MS }).status, 'Returned Unsent');
  const r = transition(held(), { kind: 'reconfirm' });
  assert.equal(transition(r, { kind: 'expire', now: T0 + HOLD_MS }).status, 'Completed');
});
test('stop is blocked for member-authorized payments; allowed after verified ATO; Stopped never completes', () => {
  bad(held(), { kind: 'stop' });
  bad(newPayment('P2P', 'presubmit_review'), { kind: 'stop' });
  const v = transition(newPayment('P2P', 'presubmit_review'), { kind: 'verify_ato' });
  const s = transition(v, { kind: 'stop' });
  assert.equal(s.status, 'Stopped by Sound');
  for (const a of [{ kind: 'submit' }, { kind: 'release', actor: 'employee', reason: 'x' }, { kind: 'cancel' }]) bad(s, a);
});
test('verified-ATO hold cannot be released or executed at expiry', () => {
  const v = transition(transition(held(), { kind: 'reconfirm' }), { kind: 'verify_ato' });
  bad(v, { kind: 'release', actor: 'employee', reason: 'x' });
  assert.equal(transition(v, { kind: 'expire', now: T0 + HOLD_MS }).status, 'Returned Unsent');
});
test('gated pending payment cannot submit until cleared; presubmit review is employee-only', () => {
  bad(newPayment('P2P', 'banner_confirm'), { kind: 'submit' });
  const c = transition(newPayment('P2P', 'banner_confirm'), { kind: 'clear_gate', actor: 'member' });
  assert.equal(transition(c, { kind: 'submit' }).status, 'Completed');
  bad(newPayment('P2P', 'presubmit_review'), { kind: 'clear_gate', actor: 'member' });
});
