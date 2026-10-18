import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tacticsIn } from '../src/tactics.ts';

const keys = (t: string) => tacticsIn(t).map(x => x.key);

test('names pressure tactics in the member’s own words, by signal', () => {
  assert.deepEqual(keys('My grandson is in jail and he said not to tell mom, I need to send bail today'), ['secrecy', 'urgency', 'threats']);
  assert.deepEqual(keys('Someone from the fraud team wants the code I got by text'), ['impersonation', 'credential_request']);
  assert.deepEqual(keys('Paying my contractor for the kitchen'), []);
});

test('codes and PINs in ordinary mail are not a request for one (issue #5)', () => {
  for (const t of [
    'Your Sound verification code is 482913. It expires in 10 minutes. Don’t share it with anyone.',
    'Your order shipped today. Tracking code: 1Z999AA10123456784.',
    'Your prescription is ready. Use your PIN at the pharmacy kiosk.',
    'Did you attempt a $45.20 purchase? We will never ask for your PIN or a code.',
    'Your online banking password was changed today. If this wasn’t you, call the number on the back of your card.',
  ]) assert.ok(!keys(t).includes('credential_request'), t);
  assert.deepEqual(keys('We texted you a code, read it back to me'), ['credential_request']);
  assert.ok(keys('Please confirm your password and the one-time code').includes('credential_request'));
});

test('negation in the same clause cancels a match; the next sentence does not', () => {
  assert.deepEqual(keys('We will never ask you to buy gift cards.'), []);
  assert.deepEqual(keys('We will never call you. Buy gift cards and send me the numbers.'), ['payment_pressure']);
});
