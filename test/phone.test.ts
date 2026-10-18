import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { screeningTarget } = await import('../src/phone.ts');
const { saveSettings } = await import('../src/monitor.ts');

test('call screening routes only when exactly one member could have forwarded the call', () => {
  assert.equal(screeningTarget(), null);
  saveSettings('alice', { screening: true });
  assert.equal(screeningTarget(), 'alice');
  saveSettings('bob', { screening: true }); // turned on later: no longer "most recent wins"
  assert.equal(screeningTarget(), 'ambiguous');
  saveSettings('alice', { screening: false });
  assert.equal(screeningTarget(), 'bob');
});
