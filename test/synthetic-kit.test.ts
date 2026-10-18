import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, OUT_DIR } from '../scripts/synthetic-kit.ts';

// The committed stand-in must be exactly what the generator produces (run `npm run kit:synthetic` after editing it).
test('committed synthetic kit matches the generator', () => {
  const { events, key } = build();
  assert.equal(readFileSync(join(OUT_DIR, 'events.csv'), 'utf8'), events, 'events.csv is stale');
  assert.equal(readFileSync(join(OUT_DIR, 'member-key.csv'), 'utf8'), key, 'member-key.csv is stale');
});
