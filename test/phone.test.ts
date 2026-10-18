import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { screeningTarget, link, verifyPhone } = await import('../src/phone.ts');
const { saveSettings } = await import('../src/monitor.ts');

test('call screening routes only when exactly one member could have forwarded the call', () => {
  for (const [sid, num] of [['alice', '+14255550111'], ['bob', '+14255550112']]) { link(sid, num, false); verifyPhone(num, 'test'); }
  assert.equal(screeningTarget(), null);
  saveSettings('alice', { screening: true });
  assert.equal(screeningTarget(), 'alice');
  saveSettings('bob', { screening: true }); // turned on later: no longer "most recent wins"
  assert.equal(screeningTarget(), 'ambiguous');
  saveSettings('alice', { screening: false });
  assert.equal(screeningTarget(), 'bob');
});

test('the email reply limit (10 per sender per hour) is kept in storage', async () => {
  const { underReplyLimit } = await import('../src/email.ts');
  for (let i = 0; i < 10; i++) assert.equal(underReplyLimit('a@example.com'), true);
  assert.equal(underReplyLimit('a@example.com'), false);
  assert.equal(underReplyLimit('b@example.com'), true);
});
