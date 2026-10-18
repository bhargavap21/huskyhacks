import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { kitTest } from './kit.ts';

// A stand-in for Meta's Graph API: records what Vantis sends, serves one image.
const sent: any[] = [];
let srv: Server;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
before(async () => {
  srv = createServer((req, res) => {
    let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401).end('{}'); return; }
      if (req.method === 'POST') { sent.push(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }).end('{"messages":[{"id":"wamid.out"}]}'); return; }
      if (req.url === '/media-1') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ url: `http://127.0.0.1:${(srv.address() as any).port}/file-1`, mime_type: 'image/png', file_size: PNG.length })); return; }
      if (req.url === '/file-1') { res.writeHead(200, { 'content-type': 'image/png' }).end(PNG); return; }
      res.writeHead(404).end('{}');
    });
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  Object.assign(process.env, {
    DB_PATH: ':memory:', WHATSAPP_TOKEN: 'test-token', WHATSAPP_PHONE_NUMBER_ID: 'pn-1', WHATSAPP_APP_SECRET: 'app-secret',
    WHATSAPP_VERIFY_TOKEN: 'verify-me', WHATSAPP_NUMBER: '+12065550199', WHATSAPP_GRAPH_BASE: `http://127.0.0.1:${(srv.address() as any).port}`,
  });
  delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_API_KEY; delete process.env.AGENTMAIL_API_KEY;
});
after(async () => { srv.close(); await (await import('../src/media.ts')).stopOcr(); }); // screenshots start the OCR worker

const wa = () => import('../src/whatsapp.ts');
const payload = (msg: any, from = '12065550100') => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: from, profile: { name: 'Pat' } }], messages: [{ from, timestamp: '1760700000', ...msg }] } }] }] });

test('signature: only the exact bytes signed with the app secret pass', async () => {
  const { signatureOk } = await wa();
  const raw = Buffer.from(JSON.stringify(payload({ id: 'x', type: 'text', text: { body: 'hi' } })));
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
  assert.equal(signatureOk(raw, sig), true);
  assert.equal(signatureOk(Buffer.concat([raw, Buffer.from(' ')]), sig), false);
  assert.equal(signatureOk(raw, 'sha256=' + createHmac('sha256', 'wrong').update(raw).digest('hex')), false);
  assert.equal(signatureOk(raw, undefined), false);
  assert.equal(signatureOk(raw, 'sha256=abc'), false);
});

test('handshake echoes the challenge only for our verify token', async () => {
  const { verifyHandshake } = await wa();
  assert.equal(verifyHandshake('subscribe', 'verify-me', '123'), '123');
  assert.equal(verifyHandshake('subscribe', 'nope', '123'), null);
  assert.equal(verifyHandshake('unsubscribe', 'verify-me', '123'), null);
});

test('normalizes text, forwarded, image, voice and document messages; ignores status updates', async () => {
  const { normalize } = await wa();
  assert.deepEqual(normalize({ entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 's' }] } }] }] }), []);
  const [t] = normalize(payload({ id: 'a', type: 'text', text: { body: 'Is this real?' }, context: { forwarded: true } }));
  assert.equal(t.from, '+12065550100'); assert.equal(t.name, 'Pat'); assert.equal(t.forwarded, true); assert.equal(t.text, 'Is this real?');
  const [i] = normalize(payload({ id: 'b', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'got this' } }));
  assert.deepEqual([i.media[0].kind, i.text], ['image', 'got this']);
  const [v] = normalize(payload({ id: 'c', type: 'audio', audio: { id: 'm2', mime_type: 'audio/ogg; codecs=opus', voice: true } }));
  assert.deepEqual([v.media[0].kind, v.media[0].mime, v.media[0].voice], ['audio', 'audio/ogg', true]);
  const [d] = normalize(payload({ id: 'd', type: 'document', document: { id: 'm3', mime_type: 'application/pdf', filename: 'invoice.pdf' } }));
  assert.deepEqual([d.media[0].kind, d.media[0].filename], ['pdf', 'invoice.pdf']);
});

test('a number nobody linked gets one how-to reply; nothing is read or kept', async () => {
  const { onWebhook } = await wa();
  const { db } = await import('../src/db.ts');
  sent.length = 0;
  await onWebhook(payload({ id: 'u1', type: 'text', text: { body: 'Send $500 in gift cards today, keep it secret' } }, '12065550111'));
  await onWebhook(payload({ id: 'u2', type: 'text', text: { body: 'hello?' } }, '12065550111'));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text.body, /link this phone number/);
  assert.equal(sent[0].context.message_id, 'u1');
  assert.equal((db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE text LIKE '%gift cards%'").get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM detections').get() as any).n, 0);
});

test('linked member with WhatsApp on: checked, replied to in the thread, evidence kept; phone confirmed by WhatsApp', async () => {
  const { onWebhook } = await wa();
  const { link } = await import('../src/phone.ts');
  const { saveSettings, detections } = await import('../src/monitor.ts');
  link('member-1', '2065550100', false);
  saveSettings('member-1', { whatsapp: true });
  sent.length = 0;
  await onWebhook(payload({ id: 'w1', type: 'text', context: { forwarded: true }, text: { body: 'Grandma it’s me, I’m in jail. Please do NOT tell mom. Wire the money today, gift cards are fine too.' } }));
  await onWebhook(payload({ id: 'w1', type: 'text', text: { body: 'duplicate delivery' } })); // Meta retry: handled once
  const replies = sent.filter(x => x.type === 'text');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].to, '12065550100');
  assert.equal(replies[0].context.message_id, 'w1');
  assert.ok(sent.some(x => x.status === 'read' && x.message_id === 'w1'));
  const [d] = detections('member-1');
  assert.equal(d.channel, 'whatsapp');
  assert.ok(d.signals!.some(s => s.key === 'secrecy' && /do NOT tell mom/.test(s.span)));
  assert.deepEqual(d.alerted_by, ['app', 'WhatsApp reply']);
  const { db } = await import('../src/db.ts');
  assert.equal((db.prepare('SELECT verified FROM phone_links WHERE sid = ?').get('member-1') as any).verified, 1);
});

test('a screenshot is downloaded, validated like app attachments, and listed on the detection', async () => {
  const { onWebhook } = await wa();
  const { detections } = await import('../src/monitor.ts');
  sent.length = 0;
  await onWebhook(payload({ id: 'w2', type: 'image', image: { id: 'media-1', mime_type: 'image/png', caption: 'They said my account is suspended in 2 hours unless I read them the code' } }));
  assert.equal(sent.filter(x => x.type === 'text').length, 1);
  const [d] = detections('member-1');
  assert.deepEqual(d.files?.map(f => f.kind), ['screenshot']);
});

kitTest('member says yes: the case is filed from WhatsApp with the signals and files as evidence', async () => {
  const { onWebhook } = await wa();
  const { db } = await import('../src/db.ts');
  const { detections } = await import('../src/monitor.ts');
  sent.length = 0;
  await onWebhook(payload({ id: 'w4', type: 'text', text: { body: 'Yes, please report it to Sound' } }));
  const row = db.prepare('SELECT json FROM fraud_cases ORDER BY rowid DESC LIMIT 1').get() as { json: string } | undefined;
  assert.ok(row, 'a case was filed');
  const c = JSON.parse(row!.json);
  assert.equal(c.channel, 'whatsapp');
  assert.ok(c.signals.length > 0 && c.signals.every((s: any) => s.span));
  assert.deepEqual(c.files.map((f: any) => f.kind), ['screenshot']);
  assert.equal(detections('member-1')[0].reported, true);
  assert.match(sent.find(x => x.type === 'text').text.body, /fraud team/);
});

test('WhatsApp off: the member’s messages are not read', async () => {
  const { onWebhook } = await wa();
  const { saveSettings, detections } = await import('../src/monitor.ts');
  saveSettings('member-1', { whatsapp: false });
  const before = detections('member-1').length;
  sent.length = 0;
  await onWebhook(payload({ id: 'w3', type: 'text', text: { body: 'Pay the fee with gift cards today' } }));
  assert.equal(detections('member-1').length, before);
  assert.ok(sent.every(x => x.type !== 'text' || /link this phone number/.test(x.text.body)));
});
