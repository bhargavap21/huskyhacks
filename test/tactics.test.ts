import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tacticsIn } from '../src/tactics.ts';

test('names pressure tactics in the member’s own words', () => {
  const keys = (t: string) => tacticsIn(t).map(x => x.key);
  assert.deepEqual(keys('My grandson is in jail and he said not to tell mom, I need to send bail today'), ['secrecy', 'urgency', 'family']);
  assert.deepEqual(keys('Someone from the fraud team wants the code I got by text'), ['authority', 'code']);
  assert.deepEqual(keys('Paying my contractor for the kitchen'), []);
});

test('the code tactic fires only when someone wants a code handed over (issue #5)', () => {
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
  for (const t of asks) assert.ok(tacticsIn(t).some(x => x.key === 'code'), `should flag: ${t}`);
  for (const t of ordinary) assert.ok(!tacticsIn(t).some(x => x.key === 'code'), `should not flag: ${t}`);
});
