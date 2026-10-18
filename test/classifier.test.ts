import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { classify, validate, TOOL, SCHEMA_VERSION } = await import('../src/classifier.ts');
const { assess } = await import('../src/monitor.ts');
const { SIGNALS } = await import('../src/tactics.ts');

const MSG = 'This is Mark from the Sound fraud department. Read me the code we just texted you, right now.';
const raw = {
  alert: true, risk: 'high', title: 'A caller says they are Sound and asks for your code', summary: 's', advice: 'a',
  signals: {
    impersonation: { score: 0.9, quote: 'Mark from the Sound fraud department' },
    credential_request: { score: 0.95, quote: '“Read me the code we just texted you”' },
    urgency: { score: 0.7, quote: 'within the hour' },  // not in the message: dropped
    threats: { score: 0.3, quote: '' },                  // below threshold: ignored
    secrecy: { score: 0.8, quote: '' },                  // no evidence: dropped
  },
};
const fake = (input: unknown) => ({ messages: { async create(req: any) { fake.last = req; return { content: [{ type: 'tool_use', name: 'classify', input }] }; } } });
fake.last = null as any;

test('schema: versioned, every signal required with a score and a quote', () => {
  assert.equal(SCHEMA_VERSION, 1);
  const props = (TOOL.input_schema.properties.signals as any).properties;
  assert.deepEqual(Object.keys(props), [...SIGNALS]);
  for (const s of SIGNALS) assert.deepEqual(props[s].required, ['score', 'quote']);
});

test('validate keeps only signals whose quote really appears in the message', () => {
  const c = validate(raw, MSG, 'test-model');
  assert.deepEqual(c.signals.map(s => s.signal), ['impersonation', 'credential_request']);
  assert.equal(c.signals[1].quote, 'Read me the code we just texted you'); // curly quotes stripped
  assert.deepEqual(c.dropped, [{ signal: 'urgency', reason: 'quote not in message' }, { signal: 'secrecy', reason: 'no quote' }]);
  assert.equal(validate({ ...raw, signals: {} }, MSG).alert, false, 'no evidence, no alert');
  assert.equal(validate({ ...raw, risk: 'catastrophic' }, MSG).risk, 'medium');
});

test('classify asks for the tool and returns the validated result; null without a client', async () => {
  const c = await classify({ channel: 'email', from: 'x', subject: '', body: MSG }, fake(raw));
  assert.equal(fake.last.tool_choice.name, 'classify');
  assert.equal(c!.signals.length, 2);
  assert.equal(await classify({ channel: 'email', from: 'x', subject: '', body: MSG }, null), null);
});

test('assess turns classifier evidence into quoted, per-signal reasons', async () => {
  const d = await assess('email', 'x', '', MSG, [], { mode: 'classifier', client: fake(raw) });
  assert.equal(d!.source, 'classifier');
  assert.deepEqual(d!.why, ['Claims to be someone you trust: “Mark from the Sound fraud department”', 'Asked for a code or password: “Read me the code we just texted you”']);
  const r = await assess('email', 'x', '', MSG, [], { mode: 'rules', client: fake(raw) });
  assert.equal(r!.source, 'rules');
  assert.ok(r!.signals!.every(s => MSG.includes(s.quote)), 'rule evidence quotes the message too');
  assert.equal(await assess('email', 'x', '', MSG, [], { mode: 'classifier', client: fake({ ...raw, alert: false }) }), null);
});
