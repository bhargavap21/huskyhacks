import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
process.env.AGENTPHONE_SCREENING_POOL = '+12065550101,+12065550102';
const { screeningTarget, assignScreeningNumber, screeningNumber, link, verifyPhone } = await import('../src/phone.ts');
const { saveSettings } = await import('../src/monitor.ts');
// Only a member with a verified phone can have screening on (issue #23).
let n = 0;
for (const sid of ['ann', 'ben', 'cat', 'dee']) { const num = `+1425555010${n++}`; link(sid, num, false); verifyPhone(num, 'test'); }

test('with a number pool, a forwarded call goes to the member who owns the number dialed', () => {
  saveSettings('ann', { screening: true }); saveSettings('ben', { screening: true });
  assert.equal(assignScreeningNumber('ann'), '+12065550101');
  assert.equal(assignScreeningNumber('ben'), '+12065550102');
  assert.equal(assignScreeningNumber('ann'), '+12065550101', 'same number every time');
  assert.equal(screeningTarget('(206) 555-0101'), 'ann');
  assert.equal(screeningTarget('+12065550102'), 'ben');
});

test('a number stays with its member; calls to it stop when they turn screening off', () => {
  saveSettings('ann', { screening: false });
  assert.equal(screeningTarget('+12065550101'), null);
  saveSettings('cat', { screening: true });
  assert.equal(assignScreeningNumber('cat'), null, 'pool used up: cat shares the main number');
  assert.equal(screeningNumber('ann'), '+12065550101', 'not handed to anyone else');
});

test('on the shared main number, only members without their own number are candidates', () => {
  assert.equal(screeningTarget('+12065559999'), 'cat'); // ann is off, ben forwards to his own number
  saveSettings('dee', { screening: true });
  assert.equal(screeningTarget('+12065559999'), 'ambiguous');
});

test('a member whose phone isn’t verified is never routed a call', () => {
  saveSettings('dee', { screening: false });
  saveSettings('eve', { screening: true }); // no verified phone
  assert.equal(screeningTarget('+12065559999'), 'cat');
});
