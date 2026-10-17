import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { useWorld, loadScene, control, employee, member, snapshot, tickAll } = await import('../src/sim.ts');

const run = (ms = 60_000) => tickAll(ms);

test('one case per situation: M1003’s two takeover payments share a case; verified takeover carries over', () => {
  useWorld('a'); loadScene('m1003', 'a'); control('play', 'a'); run();
  useWorld('a'); assert.equal(snapshot().awaiting, 'P1003-007');
  employee('verify_ato', { caseId: 1 }); employee('stop', { caseId: 1 });
  run(); useWorld('a');
  const s = snapshot();
  assert.equal(s.cases.length, 1);
  assert.deepEqual(s.cases[0].pids, ['P1003-007', 'P1003-008']);
  assert.ok(s.cases[0].actions.some((x: any) => x.action === 'ato_carried_over'));
  employee('stop', { caseId: 1 });
  useWorld('a'); assert.ok(snapshot().payments.filter((p: any) => p.pid.startsWith('P1003-00')).slice(0, 2).every((p: any) => p.status === 'Stopped by Sound'));
});

test('each browser session has its own simulation', () => {
  useWorld('x'); loadScene('m1037', 'x');
  useWorld('y'); loadScene('m1057', 'y');
  useWorld('x'); assert.equal(snapshot().scene.id, 'm1037');
  useWorld('y'); assert.equal(snapshot().scene.id, 'm1057');
});

test('M1037: one standard banner, one tap, completed', () => {
  useWorld('b'); loadScene('m1037', 'b'); control('play', 'b'); run(); useWorld('b');
  assert.equal(snapshot().awaiting, 'P1037-002');
  member('looks_fine', { pid: 'P1037-002' });
  const s = snapshot();
  assert.equal(s.payments.find((p: any) => p.pid === 'P1037-002')?.status, 'Completed');
  assert.equal(s.cases[0].rule, 'STD');
});

test('alert policy in the sim: Linda’s hold interrupts once (content-safe); M1037’s standard banner never notifies', () => {
  useWorld('n'); loadScene('linda-sl', 'n'); control('play', 'n'); run(); useWorld('n');
  const s = snapshot();
  assert.equal(s.notifications.length, 1);
  assert.doesNotMatch(s.notifications[0].text, /\$|8,500|R1001|Linda/);
  assert.equal(s.cases[0]?.alert?.interrupt, true);
  useWorld('m'); loadScene('m1037', 'm'); control('play', 'm'); run(); useWorld('m');
  const t = snapshot();
  assert.equal(t.notifications.length, 0);
  assert.equal(t.cases[0]?.alert?.banner_in_place, true);
});

test('members can ask for a person from any chat; one request per reason; employee closes it', async () => {
  const { requestCallback, callbackDone } = await import('../src/sim.ts');
  useWorld('cb'); loadScene('m1037', 'cb');
  const a = requestCallback('sent', 0);
  assert.equal(requestCallback('sent', 0), a);
  requestCallback('talk', 0);
  let s = snapshot();
  assert.equal(s.callbacks.length, 2);
  assert.ok(s.callbacks.find((x: any) => x.id === a)?.urgent);
  callbackDone(a, 'Recovery request started');
  s = snapshot();
  assert.equal(s.callbacks.find((x: any) => x.id === a)?.status, 'done');
  assert.throws(() => requestCallback('wire it for me', 0));
});
