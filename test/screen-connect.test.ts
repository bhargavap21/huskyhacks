import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_API_KEY;
const { decide, input, LOOP_MS, TOOL_SECRET, screenedCalls } = await import('../src/screening.ts');
const { handleScreeningTool, connectTarget, link, verifyPhone } = await import('../src/phone.ts');
const { saveSettings } = await import('../src/monitor.ts');

const call = (o: Record<string, string>) => input({ name: 'Dana', organization: '', reason: '', callback: '', what_they_said: '', ...o });
const T = '+14255550199';

test('ordinary callers are put through when the member asked for it, else a message is taken', async () => {
  for (const c of [
    call({ organization: 'Dr. Lee’s office', reason: 'appointment reminder for tomorrow', what_they_said: 'Hi, this is Dana from Dr. Lee’s office, calling to confirm tomorrow at 10.' }),
    call({ name: 'Mike', organization: 'UPS', reason: 'delivery needs a signature', what_they_said: 'This is Mike calling from UPS, I have a package that needs a signature.' }),
    call({ organization: 'Walgreens pharmacy', reason: 'prescription is ready', what_they_said: 'Your prescription is ready for pickup.' }),
  ]) {
    assert.equal((await decide(c, { target: T, client: null })).decision, 'connect', c.said);
    assert.equal((await decide(c, { target: null, client: null })).decision, 'hold', 'no target: take a message');
  }
});

test('scam signs, authority claims and anonymous callers are held back, with evidence', async () => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ organization: 'Sound Credit Union fraud department', reason: 'suspicious charge', what_they_said: 'We need you to read me the code we just texted you.' }, /code/i],
    [{ organization: 'IRS', reason: 'back taxes', what_they_said: 'You owe back taxes and a warrant will be issued.' }, /threat|irs/i],
    [{ organization: 'Microsoft', reason: 'computer virus', what_they_said: 'I need to connect to your computer to remove the virus.' }, /remote|microsoft/i],
    [{ reason: 'your grandson', what_they_said: 'Grandma it’s me, I lost my phone. Please don’t tell mom, I need bail money.' }, /secret|family/i],
    [{ organization: 'Amazon', reason: 'refund', what_they_said: 'Pay the processing fee with gift cards to get your refund.' }, /pay/i],
  ];
  for (const [o, want] of cases) {
    const r = await decide(call(o), { target: T, client: null });
    assert.equal(r.decision, 'hold', o.what_they_said);
    assert.match(r.why + r.evidence.map(e => e.label).join(' '), want);
    assert.doesNotMatch(r.say, /scam/i, 'never accuses the caller');
  }
  assert.equal((await decide(call({ name: '', reason: '', what_they_said: 'Is she there?' }), { target: T, client: null })).decision, 'hold');
});

test('loop guard: a caller back within 3 minutes of an unanswered transfer leaves a message', async () => {
  const c = call({ organization: 'Dr. Lee’s office', reason: 'appointment', what_they_said: 'Calling about the appointment.' });
  assert.equal((await decide(c, { target: T, lastTransfer: Date.now() - 60_000, client: null })).decision, 'hold');
  assert.equal((await decide(c, { target: T, lastTransfer: Date.now() - LOOP_MS - 1, client: null })).decision, 'connect');
});

test('a slow classifier never delays the caller past the budget', async () => {
  const slow = { messages: { create: () => new Promise(() => {}) } };
  const t0 = Date.now();
  const r = await decide(call({ organization: 'Dr. Lee’s office', reason: 'appointment', what_they_said: 'Calling about the appointment.' }), { target: T, client: slow, budgetMs: 200 });
  assert.equal(r.decision, 'connect');
  assert.ok(Date.now() - t0 < 1000);
});

test('the tool endpoint: wrong secret is refused; transfers only to the opted-in member’s verified phone', async () => {
  assert.equal((await handleScreeningTool('nope', { name: 'Dana', reason: 'x', what_they_said: 'x' })).status, 401);
  link('ann', '4255550111', false); verifyPhone('+14255550111', 'test');
  saveSettings('ann', { screening: true, screen_connect: true });
  assert.deepEqual(connectTarget(), { sid: 'ann', number: '+14255550111' });
  const ok = await handleScreeningTool(TOOL_SECRET, { args: { name: 'Dana', organization: 'Dr. Lee’s office', reason: 'appointment', what_they_said: 'Calling to confirm tomorrow.' }, call: { call_id: 'c1', from_number: '+12065550123' } });
  assert.deepEqual([ok.status, ok.json.decision], [200, 'connect']);
  const again = await handleScreeningTool(TOOL_SECRET, { args: { name: 'Dana', organization: 'Dr. Lee’s office', reason: 'appointment', what_they_said: 'Calling again.' }, call: { call_id: 'c2', from_number: '+12065550123' } });
  assert.equal(again.json.decision, 'hold', 'bounced back: no second transfer');
  const scam = await handleScreeningTool(TOOL_SECRET, { name: 'Mark', organization: 'Sound fraud team', reason: 'your account', what_they_said: 'Read me the code we texted.' });
  assert.equal(scam.json.decision, 'hold');
  assert.deepEqual(screenedCalls('ann').map(c => c.outcome), ['held back', 'held back', 'connecting']);
  // Unverified phone: never a transfer target.
  saveSettings('ann', { screen_connect: false });
  link('bob', '4255550112', false); saveSettings('bob', { screening: true, screen_connect: true });
  assert.equal(connectTarget(), null);
});

test('a screened caller claiming to be the credit union and asking for a wire is Level 4, even if the model calls it ordinary', async () => {
  const { assess } = await import('../src/monitor.ts');
  const { NEVER_CONNECT } = await import('../src/screening.ts');
  const said = 'This is Sound Credit Union. My name is Max. I need to call him to get five thousand dollars wired from him. Just put me on the call with him.';
  const extra = [`The caller said they were calling from “${NEVER_CONNECT.exec(said)![0]}”.`];
  const ordinary = { messages: { create: async () => ({ content: [{ type: 'tool_use', name: 'classify', input: { alert: false, risk: 'low', signals: {}, title: '', summary: '', advice: '' } }] }) } };
  assert.equal((await assess('call screening', 'a hidden number', 'x', said, extra, { mode: 'rules', client: null }))?.risk, 'critical');
  assert.equal((await assess('call screening', 'a hidden number', 'x', said, extra, { mode: 'gate', client: ordinary }))?.risk, 'critical');
});
