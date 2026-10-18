import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tacticsIn } from '../src/tactics.ts';

const keys = (t: string) => tacticsIn(t).map(x => x.key);

test('names pressure tactics in the member’s own words, by signal', () => {
  assert.deepEqual(keys('My grandson is in jail and he said not to tell mom, I need to send bail today'), ['secrecy', 'urgency', 'threats']);
  assert.deepEqual(keys('Someone from the fraud team wants the code I got by text'), ['impersonation', 'credential_request']);
  assert.deepEqual(keys('Paying my contractor for the kitchen'), []);
});

test('a code request fires only when someone wants a code handed over (issue #5)', () => {
  const asks = [
    'We just sent a six digit code to your phone. Can you read it to me?',
    'Please have your one-time code ready when our agent calls.',
    'They asked me for the PIN on my card.',
    'I read them the code that was texted to me.',
    'Reply with the 6-digit code we sent to keep your account open.',
    'What is the verification code you just received?',
    'Someone from the fraud team wants the code I got by text',
  ];
  const ordinary = [
    'Your verification code is 482913. Don’t share it with anyone.',
    'Use code SAVE20 at checkout for 20% off.',
    'Your tracking code is 1Z999AA10123456784.',
    'Enter this code to finish signing in: 551204. Sound will never ask you for this code.',
    'Your new card has arrived. Set your PIN in the app.',
    'Never share your password with anyone, including Sound staff.',
    'Here is the discount code for your next order.',
  ];
  for (const t of asks) assert.ok(tacticsIn(t).some(x => x.key === 'credential_request'), `should flag: ${t}`);
  for (const t of ordinary) assert.ok(!tacticsIn(t).some(x => x.key === 'credential_request'), `should not flag: ${t}`);
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
