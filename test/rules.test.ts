import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitTest } from './kit.ts';
import { memberEvents, historyUpTo, canon, type KitEvent } from '../src/kit.ts';
import { score, primary } from '../src/rules.ts';

const at = (m: string, pid: string) => {
  const evs = memberEvents(m);
  const e = evs.find(x => x.payment_id === pid && x.event_type === 'Payment Initiated')!;
  return { e, f: score(e, historyUpTo(evs, e)) };
};
const rules = (m: string) => { const evs = memberEvents(m); return evs.flatMap(e => score(e, historyUpTo(evs, e)).map(f => ({ ...f, pid: e.payment_id }))); };

kitTest('R1 fires on Linda’s wire at initiation with her kit evidence', () => {
  const { e, f } = at('M1001', 'P1001-003');
  assert.equal(e.ts_text, '10/20/2026 14:11');
  const r1 = f.find(x => x.rule === 'R1')!;
  assert.equal(r1.output, 'HOLD');
  const vals = r1.evidence.map(x => x.value).join(' ');
  assert.match(vals, /2,411 days/); assert.match(vals, /4\.77x/); assert.match(vals, /New/);
});
kitTest('R1 also fires on M1057’s legitimate closing wire (expected catch)', () => {
  assert.ok(at('M1057', 'P1057-006').f.some(x => x.rule === 'R1'));
});
kitTest('M1037’s P2P gets at most the standard banner, never a hold', () => {
  const all = rules('M1037');
  assert.ok(all.every(x => x.rule === 'STD' && x.output === 'BANNER'));
  assert.ok(all.some(x => x.pid === 'P1037-002'));
});
kitTest('R2 routes M1003’s P2P cluster to pre-submit review (P2P is never held)', () => {
  const r2 = rules('M1003').filter(x => x.rule === 'R2');
  assert.ok(r2.length >= 1);
  assert.ok(r2.every(x => x.output === 'PRESUBMIT_REVIEW'));
});
kitTest('R4 fires on M1004’s branch cash with the conversation output (no timer)', () => {
  const r4 = rules('M1004').filter(x => x.rule === 'R4');
  assert.ok(r4.length >= 1 && r4.every(x => x.output === 'BRANCH_CONVERSATION'));
});
kitTest('R3 fires on M1002 as a banner, not a hold', () => {
  const r3 = rules('M1002').filter(x => x.rule === 'R3');
  assert.ok(r3.length >= 1 && r3.every(x => x.output === 'BANNER'));
});
kitTest('primary picks the strongest output', () => {
  assert.equal(primary(at('M1001', 'P1001-003').f)!.output, 'HOLD');
});
kitTest('canonical labels: exact match only; variants throw instead of silently matching or missing', () => {
  assert.equal(canon('recipient_status', ' New '), 'New');
  assert.throws(() => canon('recipient_status', 'new'));
  assert.throws(() => canon('recipient_status', 'Ne'));
  assert.throws(() => canon('payment_rail', 'wire'));
});
kitTest('rules reject future data', () => {
  const evs = memberEvents('M1001');
  const e = evs.find(x => x.payment_id === 'P1001-003' && x.event_type === 'Payment Initiated')!;
  assert.throws(() => score(e, evs));
});
