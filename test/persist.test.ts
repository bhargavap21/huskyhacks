import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_API_KEY;
await import('../src/chat.ts'); // load order matters: chat.ts and reports.ts import each other
const { fileReport, normalize } = await import('../src/reports.ts');
const { useLive, snapshot, dropWorld, callbackDone, demoKey } = await import('../src/sim.ts');

const mine = () => { useLive('me'); return snapshot().callbacks.filter((c: any) => c.report); };

test('filed cases come back after a restart or an idle session; done stays done; demo cases stay out of the live queue', async () => {
  const a = await fileReport('me', normalize({ summary: 'A caller claiming to be Sound’s fraud team asked for a $5,000 wire.' }, 'phone'));
  await fileReport(demoKey('me'), normalize({ summary: 'Demo walkthrough report.' }, 'chat'));
  assert.equal(mine().length, 1);
  dropWorld('me');
  const back = mine();
  assert.deepEqual(back.map((c: any) => [c.report.case_id, c.status]), [[a.case_id, 'waiting']], 'restored from the database, demo case left out');
  callbackDone(back[0].id, 'Called the member back');
  dropWorld('me');
  assert.deepEqual(mine().map((c: any) => [c.status, c.note]), [['done', 'Called the member back']]);
});

test('each filed case gets its own row, even two from the same channel, live and after a restart', async () => {
  useLive('two'); const before = snapshot().callbacks.filter((c: any) => c.report).length;
  const a = await fileReport('two', normalize({ summary: 'First screened call: bank fraud team asking for a wire.' }, 'phone'));
  const b = await fileReport('two', normalize({ summary: 'Second screened call: same caller, now asking for a code.' }, 'phone'));
  const ids = () => { useLive('two'); return snapshot().callbacks.filter((c: any) => c.report).map((c: any) => c.report.case_id); };
  assert.deepEqual(ids().slice(0, 2), [b.case_id, a.case_id]);
  assert.equal(ids().length, before + 2);
  dropWorld('two');
  assert.deepEqual(ids(), [b.case_id, a.case_id]);
});
