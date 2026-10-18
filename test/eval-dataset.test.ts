import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, SIGNALS, DATASET, HOLDOUT } from '../scripts/eval.ts';

test('eval datasets: unique ids, consistent labels, known signals', () => {
  const data = [...load(DATASET), ...load(HOLDOUT)], ids = new Set<string>();
  for (const c of data) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`); ids.add(c.id);
    assert.equal(c.expected.flag, c.label === 'scam', `${c.id}: flag must match label`);
    if (c.label === 'scam') assert.ok(c.expected.signals.length, `${c.id}: a scam needs at least one signal`);
    for (const s of c.expected.signals) assert.ok((SIGNALS as readonly string[]).includes(s), `${c.id}: unknown signal ${s}`);
    assert.ok(c.turns.length && c.turns.every(t => (t.role === 'contact' || t.role === 'member') && t.text.trim()), `${c.id}: bad turns`);
  }
  const tuning = load(DATASET), holdout = load(HOLDOUT), n = (d: typeof data, l: string) => d.filter(c => c.label === l).length;
  assert.ok(n(tuning, 'scam') >= 25 && n(tuning, 'legit') >= 25 && n(holdout, 'scam') >= 10 && n(holdout, 'legit') >= 10);
});
