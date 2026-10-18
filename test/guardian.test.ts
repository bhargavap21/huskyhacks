import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { startCall, addText, stopCall, callState, closeInterrupted } = await import('../src/guardian.ts');

test('call guardian keeps the call in storage and names each tactic once', async () => {
  startCall('s:1', false);
  assert.deepEqual(addText('s:1', 'This is the fraud department, read me the code').alerts.map(a => a.key).sort(), ['credential_request', 'impersonation']);
  assert.deepEqual(addText('s:1', 'We need that code right now').alerts.map(a => a.key), ['urgency']);
  addText('s:1', 'Never share a code', 'second-look'); // Vantis's own words are never checked
  const v = callState('s:1')!;
  assert.equal(v.lines.length, 3); assert.equal(v.level, 'high'); assert.equal(v.live, true);
  const done = await stopCall('s:1');
  assert.equal(done!.live, false); assert.equal(done!.summary_source, 'offline');
  assert.equal(addText('s:1', 'more words').line, null); // ended calls take no more lines
});

test('a call left open by a restart is closed with a note, not shown as still listening', () => {
  startCall('s:2', false);
  closeInterrupted();
  const v = callState('s:2')!;
  assert.equal(v.live, false); assert.match(v.summary!, /restarted/);
});
