import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locate, verify, tier, ruleSignals, type Signal } from '../src/signals.ts';

const sig = (key: Signal['key'], score: number): Signal => ({ key, label: key, score, span: 'x', source: 'model' });
const MSG = 'Grandma it’s me. Please do NOT tell mom or dad.\nYou need to wire $8,500 today before 4pm.';

test('a quoted span must really be in the message (curly quotes and spacing are forgiven)', () => {
  assert.equal(locate(MSG, "Grandma it's me"), 'Grandma it’s me');
  assert.equal(locate(MSG, 'please do not  tell mom'), 'Please do NOT tell mom');
  assert.equal(locate(MSG, 'wire $9,000 today'), null);
  assert.equal(locate(MSG, 'ok'), null);
});

test('model signals without a real quote are dropped; scores are clamped; one per key, strongest wins', () => {
  const { signals, dropped } = verify(MSG, [
    { key: 'secrecy', score: 0.9, span: 'do NOT tell mom or dad' },
    { key: 'secrecy', score: 0.4, span: 'Please do NOT tell mom' },
    { key: 'urgency', score: 7, span: 'today before 4pm' },
    { key: 'threats', score: 0.8, span: 'or I stay in jail' }, // not in the message
    { key: 'made_up', score: 0.9, span: 'wire $8,500' },
  ]);
  assert.equal(dropped, 2);
  assert.deepEqual(signals.map(s => [s.key, s.score]), [['urgency', 1], ['secrecy', 0.9]]);
  assert.ok(signals.every(s => MSG.includes(s.span)));
});

test('rules fill in what the model left out, but never override it', () => {
  const rules = ruleSignals(MSG);
  const { signals } = verify(MSG, [{ key: 'urgency', score: 0.95, span: 'today before 4pm' }], rules);
  assert.equal(signals.find(s => s.key === 'urgency')?.source, 'model');
  assert.equal(signals.find(s => s.key === 'secrecy')?.source, 'rules');
});

test('every rule signal quotes the sentence it matched', () => {
  for (const s of ruleSignals(MSG)) assert.ok(MSG.replace(/\s+/g, ' ').includes(s.span), s.span);
  assert.deepEqual(ruleSignals(MSG).map(s => s.key).sort(), ['payment_pressure', 'secrecy', 'urgency']);
});

test('risk tiers come from evidence: low exists, and one generic word never reaches high', () => {
  assert.equal(tier([sig('urgency', 0.3)], 0), 'low');
  assert.equal(tier([sig('urgency', 0.5)], 0), 'medium');
  assert.equal(tier([sig('urgency', 0.9)], 0), 'medium');
  assert.equal(tier([sig('urgency', 0.9), sig('secrecy', 0.8)], 0), 'high');
  assert.equal(tier([sig('credential_request', 0.7), sig('urgency', 0.5)], 0), 'high');
  assert.equal(tier([], 1), 'medium'); // look-alike link alone
  assert.equal(tier([sig('impersonation', 0.5)], 1), 'high'); // look-alike link plus a sign
});

test('rules-only path: every scam fixture alerts, no benign fixture interrupts', async () => {
  delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_API_KEY;
  process.env.DB_PATH ??= ':memory:';
  const { assess } = await import('../src/monitor.ts');
  const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'emails.json'), 'utf8'));
  for (const f of fixtures) {
    const d = await assess('email', f.from_header, f.subject, f.body_text);
    if (f.expected.verdict === 'needs_human_review') assert.ok(d && d.risk !== 'low', `${f.fixture_id} should alert`);
    if (f.expected.verdict === 'no_concern_or_low') assert.ok(!d || d.risk === 'low', `${f.fixture_id} should not interrupt`);
    for (const s of d?.signals ?? []) assert.ok(s.span.length >= 3 && s.score >= 0 && s.score <= 1);
  }
});

test('ADR #10: classifier output never reaches the payment state machine', () => {
  for (const f of ['payments.ts', 'rules.ts', 'sim.ts']) {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');
    assert.doesNotMatch(src, /from '\.\/(monitor|signals|gmail|whatsapp)\.ts'/, `${f} must not import classifier code`);
  }
});
