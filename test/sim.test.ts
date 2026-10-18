import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitTest } from './kit.ts';
process.env.DB_PATH = ':memory:';
const { useWorld, loadScene, control, employee, member, snapshot, tickAll } = await import('../src/sim.ts');

const run = (ms = 60_000) => tickAll(ms);

kitTest('one case per situation: M1003’s two takeover payments share a case; verified takeover carries over', () => {
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

kitTest('each browser session has its own simulation', () => {
  useWorld('x'); loadScene('m1037', 'x');
  useWorld('y'); loadScene('m1057', 'y');
  useWorld('x'); assert.equal(snapshot().scene.id, 'm1037');
  useWorld('y'); assert.equal(snapshot().scene.id, 'm1057');
});

kitTest('M1037: one standard banner, one tap, completed', () => {
  useWorld('b'); loadScene('m1037', 'b'); control('play', 'b'); run(); useWorld('b');
  assert.equal(snapshot().awaiting, 'P1037-002');
  member('looks_fine', { pid: 'P1037-002' });
  const s = snapshot();
  assert.equal(s.payments.find((p: any) => p.pid === 'P1037-002')?.status, 'Completed');
  assert.equal(s.cases[0].rule, 'STD');
});

kitTest('alert policy in the sim: Linda’s hold interrupts once (content-safe); M1037’s standard banner never notifies', () => {
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

kitTest('members can ask for a person from any chat; one request per reason; employee closes it', async () => {
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

kitTest('live console: seeded sample cases for three members, on a real-time clock, flagged sample; nothing audited by seeding', async () => {
  const { useLive } = await import('../src/sim.ts');
  const { auditLog } = await import('../src/db.ts');
  const before = auditLog('live').length;
  useLive('live1');
  const s = snapshot();
  assert.equal(s.live, true);
  assert.equal(s.member.id, 'M1001');
  assert.deepEqual(Object.keys(s.members ?? {}).sort(), ['M1001', 'M1003', 'M1057']);
  assert.ok(s.cases.length >= 3 && s.cases.every((c: any) => c.sample === true && c.member_id));
  assert.deepEqual(new Set(s.cases.map((c: any) => c.id)).size, s.cases.length);
  const held = s.payments.find((p: any) => p.pid === s.awaiting);
  assert.equal(held?.status, 'Held');
  assert.ok(Math.abs((held?.hold_expires_at ?? 0) - (Date.now() + 4 * 3_600_000)) < 60_000, 'the hold runs four real hours from now');
  assert.equal(auditLog('live').length, before);
});

kitTest('live console: another member’s case can be worked by staff, settles and closes; members can’t act on it', async () => {
  const { useLive } = await import('../src/sim.ts');
  useLive('live2');
  const k = snapshot().cases.find((c: any) => c.member_id === 'M1057')!;
  assert.throws(() => member('cancel', { pid: k.pid }), /Unknown payment/);
  employee('release', { caseId: k.id, reason: 'Member confirmed by phone: legitimate' });
  const s = snapshot();
  assert.equal(s.payments.find((p: any) => p.pid === k.pid)?.status, 'Completed');
  assert.equal(s.cases.find((c: any) => c.id === k.id)?.status, 'closed');
});

kitTest('demo and live never share state: demo actions stay out of the live queue and the live audit log', async () => {
  const { useLive, demoKey } = await import('../src/sim.ts');
  const { auditLog } = await import('../src/db.ts');
  useLive('sep'); const liveCases = JSON.stringify(snapshot().cases);
  const d = demoKey('sep');
  useWorld(d); loadScene('m1057', d); control('play', d); run(); useWorld(d);
  const k = snapshot().cases[0];
  employee('release', { caseId: k.id, reason: 'demo release' });
  useLive('sep');
  assert.equal(JSON.stringify(snapshot().cases), liveCases);
  assert.ok(!auditLog('live').some(r => /demo release/.test(r.detail)));
  assert.ok(auditLog('demo').some(r => /demo release/.test(r.detail)));
  employee('outreach', { caseId: snapshot().cases[0].id, reason: 'live call' });
  assert.ok(auditLog('live').some(r => /live call/.test(r.detail)));
  assert.ok(!auditLog('demo').some(r => /live call/.test(r.detail)));
});

kitTest('live: a real caller’s report is filed under what they said, never the sample member; demo keeps the scene member', async () => {
  delete process.env.AGENTMAIL_API_KEY; // no fraud-team email from tests
  const { useLive, demoKey } = await import('../src/sim.ts');
  await import('../src/chat.ts'); // chat and reports import each other; load in the server's order
  const { fileReport, normalize } = await import('../src/reports.ts');
  await fileReport('rep', normalize({ summary: 'A caller said he was from Sound and asked for a code.', member_name: 'Bhargava', threat_type: 'bank or credit union impersonation' }, 'phone', { phone: '+12065550100', linked: true }));
  useLive('rep');
  const r = snapshot().callbacks[0].report!;
  assert.equal(r.member.name, 'Bhargava');
  assert.equal(r.member.member_id, '');
  assert.equal(r.member.phone, '(206) 555-0100');
  await fileReport('rep2', normalize({ summary: 'No name given.' }, 'phone', { phone: '+12065550101', linked: true }));
  useLive('rep2');
  const r2 = snapshot().callbacks[0].report!;
  assert.equal(r2.member.name, '');
  assert.ok(r2.missing.includes('member’s name'));
  await fileReport(demoKey('rep'), normalize({ summary: 'From the demo.' }, 'chat', { linked: true }));
  useWorld(demoKey('rep'));
  assert.match(snapshot().callbacks[0].report!.member.name, /\(demo member\)$/);
});
