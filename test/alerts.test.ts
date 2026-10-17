import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPolicy, decide, dismiss, type Item } from '../src/alerts.ts';

const T0 = Date.UTC(2026, 9, 20, 14, 0);
const H = 3_600_000;
const item = (o: Partial<Item> = {}): Item => ({ key: 'thread-1', ts: T0, tier: 'T2', evidence: ['asks for secrecy', 'wire today'], evidence_types: ['secrecy', 'urgency'], payment_active: false, ...o });

test('12 messages from one sender: one case, at most one interruption', () => {
  const s = newPolicy();
  const ds = Array.from({ length: 12 }, (_, i) => decide(s, item({ ts: T0 + i * 60_000 })));
  assert.equal(new Set(ds.map(d => d.case_key)).size, 1);
  assert.equal(ds.filter(d => d.interrupt).length, 1);
});

test('T2 respects the daily budget outside a payment session', () => {
  const s = newPolicy();
  assert.equal(decide(s, item({ key: 'a' })).interrupt, true);
  const d = decide(s, item({ key: 'b', ts: T0 + H }));
  assert.equal(d.interrupt, false); assert.match(d.suppressed!, /budget/);
  assert.equal(decide(s, item({ key: 'c', ts: T0 + 25 * H })).interrupt, true);
});

test('T1 banners: at most 3 per week outside a payment session', () => {
  const s = newPolicy();
  const ds = ['a', 'b', 'c', 'd'].map((k, i) => decide(s, item({ key: k, tier: 'T1', ts: T0 + i * H })));
  assert.deepEqual(ds.map(d => d.tier), ['T1', 'T1', 'T1', 'T0']);
});

test('quiet hours suppress interruptions, except an active payment', () => {
  const s = newPolicy(); s.quiet = { start_hour: 21, end_hour: 7 };
  const night = Date.UTC(2026, 9, 20, 23, 0);
  assert.equal(decide(s, item({ key: 'a', ts: night })).interrupt, false);
  assert.equal(decide(s, item({ key: 'b', ts: night, payment_active: true })).interrupt, true);
});

test('budget and quiet hours never suppress an active-payment checkpoint', () => {
  const s = newPolicy(); s.quiet = { start_hour: 0, end_hour: 24 };
  decide(s, item({ key: 'a', payment_active: true }));
  const d = decide(s, item({ key: 'b', ts: T0 + 60_000, payment_active: true }));
  assert.equal(d.interrupt, true); assert.equal(d.banner_in_place, true);
});

test('a dismissed case re-alerts only on material change, once per change type', () => {
  const triggers: [string, Partial<Item>][] = [
    ['new evidence type', { evidence_types: ['secrecy', 'urgency', 'gift_cards'] }],
    ['higher amount', { amount: 9000 }],
    ['new recipient', { recipient: 'R-2' }],
    ['payment initiated', { payment_active: true }],
  ];
  for (const [name, change] of triggers) {
    const s = newPolicy();
    decide(s, item({ amount: 8500, recipient: 'R-1', ts: T0 - 2 * 86_400_000 }));
    dismiss(s, 'thread-1');
    assert.equal(decide(s, item({ amount: 8500, recipient: 'R-1' })).interrupt, false, `${name}: no change stays quiet`);
    const d = decide(s, item({ amount: 8500, recipient: 'R-1', ts: T0 + 60_000, ...change }));
    assert.equal(d.interrupt, true, `${name}: re-alerts`);
    assert.match(d.why, /re-alert/);
    assert.equal(decide(s, item({ amount: 8500, recipient: 'R-1', ts: T0 + 120_000, ...change })).interrupt, false, `${name}: only once`);
  }
});

test('every promotion names its evidence; no evidence stays quiet', () => {
  const s = newPolicy();
  assert.equal(decide(s, item({ evidence: [] })).tier, 'T0');
  const d = decide(s, item({ key: 'x' }));
  assert.match(d.why, /because: asks for secrecy \+ wire today/);
});

test('sensitivity: "fewer" quiets out-of-session T1, never an in-session banner', () => {
  const s = newPolicy('fewer');
  assert.equal(decide(s, item({ key: 'a', tier: 'T1' })).tier, 'T0');
  assert.equal(decide(s, item({ key: 'b', tier: 'T1', payment_active: true })).banner_in_place, true);
});
