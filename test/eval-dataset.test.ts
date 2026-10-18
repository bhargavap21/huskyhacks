import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, SIGNALS } from '../scripts/eval.ts';

test('eval dataset: unique ids, consistent labels, known signals', () => {
  const data = load(), ids = new Set<string>();
  for (const c of data) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`); ids.add(c.id);
    assert.equal(c.expected.flag, c.label === 'scam', `${c.id}: flag must match label`);
    if (c.label === 'scam') assert.ok(c.expected.signals.length, `${c.id}: a scam needs at least one signal`);
    for (const s of c.expected.signals) assert.ok((SIGNALS as readonly string[]).includes(s), `${c.id}: unknown signal ${s}`);
    assert.ok(c.turns.length && c.turns.every(t => (t.role === 'contact' || t.role === 'member') && t.text.trim()), `${c.id}: bad turns`);
  }
  assert.ok(data.filter(c => c.label === 'scam').length >= 25 && data.filter(c => c.label === 'legit').length >= 25);
});
