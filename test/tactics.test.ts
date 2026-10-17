import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tacticsIn } from '../src/tactics.ts';

test('names pressure tactics in the member’s own words', () => {
  const keys = (t: string) => tacticsIn(t).map(x => x.key);
  assert.deepEqual(keys('My grandson is in jail and he said not to tell mom, I need to send bail today'), ['secrecy', 'urgency', 'family']);
  assert.deepEqual(keys('Someone from the fraud team wants the code I got by text'), ['authority', 'code']);
  assert.deepEqual(keys('Paying my contractor for the kitchen'), []);
});
