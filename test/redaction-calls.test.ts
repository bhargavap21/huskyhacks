// End to end: every real model call site, with the real SDK and a fake network. What leaves the server is
// checked for raw PII, and so is everything logged while it runs (issue #11 acceptance criteria).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.DETECTION_MODE = 'hybrid';

const sent: string[] = [];
globalThis.fetch = (async (url: any, init: any) => {
  if (!String(url).includes('anthropic')) throw new Error(`unexpected request to ${url}`);
  const body = JSON.parse(init.body);
  sent.push(JSON.stringify({ system: body.system, messages: body.messages }));
  const forced = body.tool_choice?.name;
  const content = forced === 'classify'
    ? [{ type: 'tool_use', id: 'tu_c', name: 'classify', input: { alert: true, risk: 'high', title: '[NAME_1] asks for a code', summary: 'Someone says they are [NAME_1].', advice: 'Don’t share [CODE_1].', signals: { credential_request: { score: 0.9, quote: 'the code we texted you: [CODE_1]' } } } }]
    : forced === 'file_case'
      ? [{ type: 'tool_use', id: 'tu_f', name: 'file_case', input: { summary: '[NAME_1] called from [PHONE_1] asking for [CODE_1].', scammer_name: '[NAME_1]', scammer_phone: '[PHONE_1]' } }]
      : [{ type: 'text', text: 'I hear you. Please keep [CODE_1] to yourself and don’t call [PHONE_1].' }];
  return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content, stop_reason: forced ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const logged: string[] = [];
for (const k of ['log', 'error', 'warn'] as const) { const orig = console[k]; console[k] = (...a: any[]) => { logged.push(a.map(String).join(' ')); if (process.env.SHOW_LOGS) orig(...a); }; }

const RAW = ['Rosalind', 'Okafor', 'rosalind.okafor88', '(206) 555-0142', '+14255550111', '123-45-6789', '482913', '4111 1111 1111 1111', '00123456789', '1420 Pine St', 'hunter2', 'Davis'];
const MSG = `Hi Grandma, it's Rosalind Okafor. Officer Davis says I need bail. Call me at (206) 555-0142 or +14255550111.
He wants your SSN 123-45-6789 and the code we texted you: 482913. Your card 4111 1111 1111 1111 and account number 00123456789 are frozen.
Your password is hunter2. Send $3,000 cash to 1420 Pine St, Seattle, WA 98101. Don't tell anyone.`;
const leaks = (s: string) => RAW.filter(v => s.includes(v));

const { assess } = await import('../src/monitor.ts');
const { chat, GENERAL } = await import('../src/chat.ts');
const { extractIntake } = await import('../src/reports.ts');
const { draftReply } = await import('../src/email.ts');
const { startCall, addText, stopCall } = await import('../src/guardian.ts');
const { decide } = await import('../src/screening.ts');
const { prepare, stopOcr } = await import('../src/media.ts');
after(stopOcr);
const fixture = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f)).toString('base64');

test('connected-channel detection (classifier): no raw PII sent; quotes come back masked', async () => {
  const n = sent.length;
  const d = await assess('email', 'Rosalind Okafor <rosalind.okafor88@gmail.com>', 'Help, Grandma', MSG);
  assert.equal(sent.length, n + 1);
  assert.deepEqual(leaks(sent.at(-1)!), []);
  assert.ok(d!.signals!.some(s => s.span === 'the code we texted you: ••••••'), JSON.stringify(d!.signals));
  assert.equal(d!.summary, 'Someone says they are Rosalind Okafor.');
});

test('member chat: history and reply', async () => {
  const n = sent.length;
  await chat('s1:chat', GENERAL, 'My grandson Rosalind called from (206) 555-0142 and asked for the code 482913.');
  const out = await chat('s1:chat', GENERAL, `He also sent this: ${MSG}`, [{ kind: 'audio', name: 'note.webm', seconds: 3, transcript: 'Officer Davis said read the code 482913', via: 'local' } as any]);
  assert.equal(sent.length, n + 2);
  for (const s of sent.slice(n)) assert.deepEqual(leaks(s), []);
  assert.equal(out.reply, 'I hear you. Please keep •••••• to yourself and don’t call (206) 555-0142.');
});

test('chat photos and PDFs: read on this server, sent only as redacted text, never as files', async () => {
  const png = fixture('scam-text.png'), pdf = fixture('invoice.pdf');
  const att = await prepare([{ kind: 'image', name: 'screenshot.png', media_type: 'image/png', data: png }, { kind: 'pdf', name: 'invoice.pdf', data: pdf }]);
  assert.match((att[0] as any).text, /read me\s+the code 482913/, 'OCR read the screenshot');
  assert.match((att[1] as any).text, /gift cards today/, 'the PDF text layer was read');
  assert.ok(!('data' in att[1]), 'the PDF file itself is not kept');
  const n = sent.length;
  await chat('s2:chat', GENERAL, 'Is this real?', att);
  const body = sent.at(-1)!;
  assert.equal(sent.length, n + 1);
  assert.deepEqual(leaks(body), []);
  assert.ok(!body.includes(png.slice(0, 200)) && !body.includes(pdf.slice(0, 200)), 'no file data sent');
  assert.doesNotMatch(body, /"type":"(image|document)"/);
  assert.match(body, /Text read on Vantis's server from a photo/);
  assert.match(body, /the code \[CODE_1\] within the hour/);
});

test('a member name is redacted even with no context around it', async () => {
  await chat('s3:chat', GENERAL, 'Linda says the money is for rent.'); // "Linda" is a demo member (fixtures/demo-members.json)
  assert.ok(!sent.at(-1)!.includes('Linda'));
});

test('fraud-case intake reader', async () => {
  const x = await extractIntake('You read a call transcript.', MSG);
  assert.deepEqual(leaks(sent.at(-1)!), []);
  assert.equal(x.scammer_phone, '(206) 555-0142');
  assert.equal(x.summary, 'Rosalind Okafor called from (206) 555-0142 asking for ••••••.');
});

test('email reply drafter (including the facts it lists)', async () => {
  const r = await draftReply('Fwd: Help, Grandma', `---------- Forwarded message ----------\nFrom: Rosalind Okafor <rosalind.okafor88@gmail.com>\n${MSG}`);
  assert.deepEqual(leaks(sent.at(-1)!), []);
  assert.ok(!r.reply.includes('482913'));
});

test('call guardian end-of-call summary', async () => {
  startCall('s1:call', false);
  addText('s1:call', 'This is Officer Davis. Read me the code we texted you, 482913, and confirm 1420 Pine St.');
  addText('s1:call', 'Call me back at (206) 555-0142.');
  await stopCall('s1:call');
  assert.deepEqual(leaks(sent.at(-1)!), []);
});

test('call screening classifier', async () => {
  const n = sent.length;
  await decide({ name: 'Rosalind Okafor', organization: 'Dr. Davis’s office', reason: 'appointment reminder', callback: '(206) 555-0142', said: 'Hi, this is Rosalind Okafor from Dr. Davis’s office, call us at (206) 555-0142.' }, { target: 'member', budgetMs: 5000 });
  assert.equal(sent.length, n + 1);
  assert.deepEqual(leaks(sent.at(-1)!), []);
});

test('nothing logged along the way contains raw PII', () => {
  assert.ok(sent.length >= 6);
  assert.deepEqual(leaks(logged.join('\n')), []);
});
