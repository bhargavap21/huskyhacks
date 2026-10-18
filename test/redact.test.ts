import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
process.env.DB_PATH = ':memory:';
const { Redactor, guard, scrub, maskSecrets, namesIn } = await import('../src/redact.ts');
const { classify } = await import('../src/classifier.ts');

// One of each kind, as it shows up in a scam message.
const PII = {
  name: 'Rosalind Okafor', email: 'rosalind.okafor88', phone: '(206) 555-0142', e164: '+14255550111', ssn: '123-45-6789',
  code: '482913', card: '4111 1111 1111 1111', account: '00123456789', address: '1420 Pine St, Apt 5, Seattle, WA 98101', password: 'hunter2',
};
const MSG = `From: "Rosalind Okafor" <rosalind.okafor88@gmail.com>
Hi Grandma, it's Rosalind. I'm in jail and need $3,000 in gift cards by 5pm today. Don't tell anyone.
Call me at (206) 555-0142 or +14255550111. Officer Davis needs your SSN 123-45-6789 and the code we texted you: 482913.
Your card 4111 1111 1111 1111 and account number 00123456789 are frozen. Your password is hunter2.
Send cash to 1420 Pine St, Apt 5, Seattle, WA 98101.`;
const leaks = (s: string) => Object.values(PII).filter(v => s.includes(v)).concat(['Rosalind', 'Okafor', 'Davis'].filter(v => s.includes(v)));

test('every kind of PII becomes a token; what detection needs stays', () => {
  const out = new Redactor().redact(MSG);
  assert.deepEqual(leaks(out), []);
  for (const t of ['[NAME_1]', '[EMAIL_1]@gmail.com', '[PHONE_1]', '[PHONE_2]', '[SSN_1]', '[CODE_1]', '[CARD_1]', '[ACCOUNT_1]', '[PASSWORD_1]', '[ADDRESS_1]']) assert.ok(out.includes(t), `${t} in ${out}`);
  for (const kept of ['$3,000', 'gift cards', '5pm today', "Don't tell anyone", 'Officer', 'code we texted you', 'Grandma']) assert.ok(out.includes(kept), kept);
});

test('amounts, dates, times, case and kit IDs, domains and organizations are left alone', () => {
  const s = "This is Sound's fraud department about case SL-20261018-0004 on 10/20/2026 at 14:21: a $51,586.52 wire (4.77x) for M1001, P1001-003. Visit soundcu-verify.com. Your zip code is 98105. This is Comcast billing; this is Acme Services. Email support@paypa1.com.";
  assert.equal(new Redactor().redact(s), s);
});

test('tokens are stable: the same value gets the same token, and a name part maps on its own', () => {
  const r = new Redactor();
  const out = r.redact('Call (206) 555-0142. Again: (206) 555-0142. Dear Rosalind Okafor, Rosalind here.');
  assert.equal(out.match(/\[PHONE_1\]/g)?.length, 2);
  assert.ok(!out.includes('[PHONE_2]'));
  assert.ok(!out.includes('Rosalind'));
  assert.equal(r.restore(out), 'Call (206) 555-0142. Again: (206) 555-0142. Dear Rosalind Okafor, Rosalind here.');
});

test('restore puts identity back and masks secrets; unknown tokens stay', () => {
  const r = new Redactor();
  r.redact(MSG);
  assert.equal(r.restore('[NAME_1] at [PHONE_1], [EMAIL_1]@gmail.com, [ADDRESS_1]'), `${PII.name} at ${PII.phone}, ${PII.email}@gmail.com, ${PII.address}`);
  assert.equal(r.restore('code [CODE_1], card [CARD_1], account [ACCOUNT_1], SSN [SSN_1], password [PASSWORD_1]'), 'code ••••••, card •••• 1111, account •••• 6789, SSN •••-••-••••, password ••••••');
  assert.equal(r.restore('[NAME_9] and NAME_1'), '[NAME_9] and Rosalind Okafor', 'a token the model wrote without brackets still restores');
});

test('names are found from context, not from every capitalized word', () => {
  assert.deepEqual(namesIn('This is Mark from the Sound fraud department'), ['Mark']);
  assert.deepEqual(namesIn('Dear Linda,\nThanks,\nSarah Chen\nSound Credit Union'), ['Linda', 'Sarah Chen']);
  assert.deepEqual(namesIn('my grandson Jake and Special Agent Ray Moss'), ['Jake', 'Ray Moss']);
  assert.deepEqual(namesIn('Invoice from Rosalind Okafor. A note from Amazon, from New York, from Puget Sound Energy.'), ['Rosalind Okafor']);
  assert.deepEqual(namesIn('This is Sound. This is Comcast billing. Hello Everyone. Dear Valued Customer. Best Buy order.'), []);
  // Known names (the member's) are redacted even without context.
  assert.equal(new Redactor(['Theodora Quinn (demo member)']).redact('Theodora asked about Quinn.'), '[NAME_1] asked about [NAME_2].');
});

test('member names we hold are redacted anywhere; labels that are not names are skipped', async () => {
  const { c, seen } = recorder(() => [{ type: 'text', text: 'ok' }]);
  await guard(c, () => ['Linda', 'Home buyer', 'Member', 'Sarah Chen']).messages.create({ messages: [{ role: 'user', content: 'Linda and Chen met a Home buyer, a Member.' }] });
  assert.equal(seen[0].req.messages[0].content, '[NAME_1] and [NAME_2] met a Home buyer, a Member.');
});

test('photos and PDFs are read on this server; anything else gives no text', async () => {
  const { readImage, readPdf, stopOcr } = await import('../src/media.ts');
  const read = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f)).toString('base64');
  assert.match(await readImage(read('scam-text.png')), /This is Officer Davis/);
  assert.match(await readPdf(read('invoice.pdf')), /Invoice from Rosalind Okafor/);
  assert.equal(await readImage(Buffer.from('not an image').toString('base64')), '');
  assert.equal(await readPdf(Buffer.from('not a pdf').toString('base64')), '');
  await stopOcr();
});

test('scrub, for listeners nothing comes back from, says what was there', () => {
  assert.equal(scrub('Officer Davis asked for the code 482913 at (206) 555-0142'), 'Officer [a name] asked for the code [a code] at [a phone number]');
  assert.equal(maskSecrets('the code 482913, from Officer Davis'), 'the code ••••••, from Officer Davis');
});

// A fake client that records what it was sent and answers with what the test gives it.
const recorder = (answer: (req: any) => any[]) => {
  const seen: any[] = [];
  const c = { messages: { async create(req: any, opts: any) { seen.push({ req, opts }); return { stop_reason: 'end_turn', content: answer(req) }; } } };
  return { c, seen };
};

test('guard redacts system, text, tool calls and results; passes file data; restores the answer', async () => {
  const img = 'iVBORw0KGgo' + 'A'.repeat(40);
  const { c, seen } = recorder(() => [
    { type: 'text', text: 'Thanks, [NAME_2]. Please keep [CODE_1] private.' },
    { type: 'tool_use', id: 'tu_1', name: 'report_to_sound', input: { scammer_name: '[NAME_1]', scammer_phone: '[PHONE_1]', member_name: '[NAME_2]', quotes: ['code is [CODE_1]'] } },
  ]);
  const res = await guard(c).messages.create({
    model: 'm', system: 'Member on file: Theodora Quinn.',
    messages: [
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: img } }, { type: 'text', text: 'This is Officer Davis, call (206) 555-0142, the code is 482913' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_0', name: 'report_to_sound', input: { scammer_phone: '(206) 555-0142' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_0', content: 'Filed as case SL-20261018-0004 for Theodora Quinn.' }] },
    ],
  }, { timeout: 5, redact: { names: ['Theodora Quinn'] } });
  const sent = JSON.stringify(seen[0].req);
  for (const v of ['Davis', '(206) 555-0142', '482913', 'Theodora', 'Quinn']) assert.ok(!sent.includes(v), `${v} reached the model`);
  assert.ok(sent.includes(img), 'image data is passed unchanged');
  assert.ok(sent.includes('SL-20261018-0004'));
  assert.deepEqual(seen[0].opts, { timeout: 5 }, 'the redact option is not passed to the SDK');
  assert.equal(res.content[0].text, 'Thanks, Theodora Quinn. Please keep •••••• private.');
  assert.deepEqual(res.content[1].input, { scammer_name: 'Davis', scammer_phone: '(206) 555-0142', member_name: 'Theodora Quinn', quotes: ['code is ••••••'] });
  const g = guard(c);
  assert.equal(guard(g), g, 'guarding twice is a no-op');
});

test('classify: the model sees tokens; its quotes come back restored, and a masked secret still counts as found', async () => {
  const body = 'This is Officer Davis. Read me the code we texted you: 482913. Call (206) 555-0142 now.';
  const { c, seen } = recorder(() => [{ type: 'tool_use', name: 'classify', input: {
    alert: true, risk: 'high', title: '[NAME_1] asks for your code', summary: 'A caller named [NAME_1] at [PHONE_1].', advice: 'Don’t share [CODE_1].',
    signals: { impersonation: { score: 0.9, quote: 'This is Officer [NAME_1]' }, credential_request: { score: 0.95, quote: 'Read me the code we texted you: [CODE_1]' } },
  } }]);
  const v = await classify({ channel: 'email', from: 'Davis <davis.ofc@gmail.com>', subject: 'Urgent', body }, c);
  assert.deepEqual(leaks(JSON.stringify(seen[0].req.messages) + seen[0].req.system), []);
  assert.ok(!JSON.stringify(seen[0].req).includes('davis.ofc'));
  assert.deepEqual(v!.signals.map(s => s.quote), ['This is Officer Davis', 'Read me the code we texted you: ••••••']);
  assert.equal(v!.summary, 'A caller named Davis at (206) 555-0142.');
  assert.equal(v!.advice, 'Don’t share ••••••.');
  assert.deepEqual(v!.dropped, []);
});

test('only chat.ts makes a model client, and it is guarded; every other model call uses it or guard()', () => {
  const dir = join(import.meta.dirname, '..', 'src');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const s = readFileSync(join(dir, f), 'utf8');
    if (f === 'chat.ts') assert.match(s, /guard\(new Anthropic\(/);
    else assert.doesNotMatch(s, /new Anthropic\(/, `${f} makes its own client`);
    if (/\.messages\.create\(/.test(s) && f !== 'chat.ts' && f !== 'redact.ts') assert.match(s, /import \{[^}]*\bclient\b[^}]*\} from '\.\/chat\.ts'|guard\(/, `${f} calls a model without the guarded client`);
  }
});
