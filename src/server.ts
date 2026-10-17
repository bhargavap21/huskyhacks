import 'dotenv/config';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { tickAll, useWorld, loadScene, control, member, employee, snapshot, requestCallback, callbackDone } from './sim.ts';
import { TransitionError } from './payments.ts';
import { chat, chatHistory, GENERAL } from './chat.ts';
import { prepare, loadAsr, AttachmentError } from './media.ts';
import { bodyLimit } from 'hono/body-limit';
import { tacticsIn } from './tactics.ts';

const SECRET = process.env.SESSION_SECRET ?? randomBytes(32).toString('hex');
const PROD = process.env.NODE_ENV === 'production';
const csrfFor = (sid: string) => createHmac('sha256', SECRET).update(sid).digest('hex');

const app = new Hono<{ Variables: { sid: string } }>();

// Demo session cookie (role switch is a labeled demo control, not real auth; HANDOFF section 13).
app.use('*', async (c, next) => {
  let sid = getCookie(c, 'sl_sid');
  if (!sid) { sid = randomBytes(24).toString('hex'); setCookie(c, 'sl_sid', sid, { httpOnly: true, sameSite: 'Lax', secure: PROD, path: '/' }); }
  c.set('sid', sid);
  await next();
});

// CSRF + Origin check on every state-changing request.
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') {
    const sid = getCookie(c, 'sl_sid') ?? ''; // must come from the browser, not this request's new cookie
    const sent = c.req.header('x-csrf') ?? '';
    const want = csrfFor(sid);
    const okToken = sid && sent.length === want.length && timingSafeEqual(Buffer.from(sent), Buffer.from(want));
    const origin = c.req.header('origin');
    // Same host, or a public front door we put in front of this server (e.g. the Vercel proxy), listed in ALLOWED_ORIGIN_HOSTS.
    const allowed = [c.req.header('host'), ...(process.env.ALLOWED_ORIGIN_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean)];
    const okOrigin = !origin || allowed.includes(new URL(origin).host);
    if (!okToken || !okOrigin) return c.json({ error: 'Request blocked (CSRF/Origin check)' }, 403);
  }
  await next();
});

// Every API call acts on this browser's own simulation.
app.use('/api/*', async (c, next) => { useWorld(c.get('sid')); await next(); });

app.onError((err, c) => {
  if (err instanceof TransitionError) return c.json({ error: err.message }, 409);
  if (err instanceof AttachmentError) return c.json({ error: err.message }, 400);
  console.error(err);
  return c.json({ error: 'Something went wrong' }, 500);
});

// "Live in the room": a phone joins this browser's simulation by a short code (synthetic data only).
const rooms = new Map<string, string>(); // code -> sid
const roomOf = new Map<string, string>(); // sid -> code
app.post('/api/room', c => {
  const sid = c.get('sid');
  let code = roomOf.get(sid);
  if (!code) { do code = randomBytes(4).toString('hex').slice(0, 6); while (rooms.has(code)); rooms.set(code, sid); roomOf.set(sid, code); }
  return c.json({ ok: true, code });
});
app.get('/join/:code', c => {
  const sid = rooms.get(c.req.param('code').toLowerCase());
  if (!sid) return c.text('That join link has expired. Ask the presenter for a new one.', 404);
  setCookie(c, 'sl_sid', sid, { httpOnly: true, sameSite: 'Lax', secure: PROD, path: '/' });
  return c.redirect('/?page=home&joined=1');
});

// Chats the member chose to share with Sound staff (off unless the member turns it on).
const shared = new Map<string, boolean>(); // `${sid}:${scene}:${case}` -> on
const chatId = (c: any, caseId: number) => `${chatKey(c)}:${caseId}`;
function sharedChats(c: any) {
  const snap = snapshot(), out: Record<string, { messages: { text: string; tactics: { key: string; label: string }[] }[] }> = {};
  for (const id of [GENERAL, ...snap.cases.map((k: any) => k.id)]) {
    if (!shared.get(chatId(c, id))) continue;
    // The member's typed words plus any voice-note transcripts (screenshots and PDFs aren't quoted here).
    const msgs = (chatHistory(chatKey(c), id) as { role: string; text: string; att?: { kind: string; transcript?: string }[] }[])
      .filter(m => m.role === 'user')
      .map(m => [m.text, ...(m.att ?? []).filter(a => a.kind === 'audio' && a.transcript).map(a => `(voice note) ${a.transcript}`)].filter(Boolean).join(' ').trim())
      .filter(Boolean);
    out[id === GENERAL ? 'general' : String(id)] = { messages: msgs.map(text => ({ text, tactics: tacticsIn(text) })) };
  }
  return out;
}

app.get('/api/state', c => {
  const ids = Object.fromEntries([...shared].filter(([k, v]) => v && k.startsWith(chatKey(c) + ':')).map(([k]) => [k.slice(chatKey(c).length + 1), true]));
  return c.json({ ...snapshot(), shared: sharedChats(c), share_on: ids, csrf: csrfFor(c.get('sid')) });
});
app.post('/api/scene/:id', c => { loadScene(c.req.param('id'), c.get('sid')); return c.json({ ok: true }); });
app.post('/api/control/:cmd', c => { control(c.req.param('cmd'), c.get('sid')); return c.json({ ok: true }); });
app.post('/api/member/:action', async c => { member(c.req.param('action'), await c.req.json().catch(() => ({}))); return c.json({ ok: true }); });
app.post('/api/employee/:action', async c => { employee(c.req.param('action'), await c.req.json().catch(() => ({}))); return c.json({ ok: true }); });
const chatKey = (c: any) => `${c.get('sid')}:${snapshot().scene.id}`;
app.post('/api/callback', async c => { const b = await c.req.json().catch(() => ({})); return c.json({ ok: true, id: requestCallback(String(b.kind), Number(b.caseId) || 0) }); });
app.post('/api/callback/:id/done', async c => { const b = await c.req.json().catch(() => ({})); callbackDone(Number(c.req.param('id')), String(b.note ?? '')); return c.json({ ok: true }); });
const caseParam = (c: any) => (c.req.param('caseId') === 'general' ? GENERAL : Number(c.req.param('caseId')));
app.post('/api/chat/:caseId/share', async c => { const b = await c.req.json().catch(() => ({})); shared.set(chatId(c, caseParam(c)), !!b.on); return c.json({ ok: true }); });
app.get('/api/chat/:caseId', c => c.json(chatHistory(chatKey(c), caseParam(c))));
// Photos, PDFs and voice notes ride along as base64; 30 MB covers three max-size attachments.
app.post('/api/chat/:caseId', bodyLimit({ maxSize: 30 * 1024 * 1024, onError: c => c.json({ error: 'Those files are too large to send together' }, 413) }), async c => {
  const b = await c.req.json().catch(() => ({}));
  const att = await prepare(b.attachments);
  const text = String(b.text ?? '').trim();
  if (!text && !att.length) return c.json({ error: 'Type a message or add a file' }, 400);
  return c.json(await chat(chatKey(c), caseParam(c), text, att));
});

const page = (f: string) => readFileSync(join(import.meta.dirname, '..', 'public', f), 'utf8');
app.get('/', c => c.html(page('index.html')));
app.get('/about', c => c.html(page('about.html')));
app.use('/ds/*', serveStatic({ root: './design-system', rewriteRequestPath: p => p.replace(/^\/ds/, '') }));
app.use('/static/*', serveStatic({ root: './public', rewriteRequestPath: p => p.replace(/^\/static/, '') }));

let last = Date.now();
setInterval(() => { const now = Date.now(); tickAll(now - last); last = now; }, 250);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`Second Look demo on http://localhost:${port}`));
if (process.env.NODE_ENV !== 'test') loadAsr(); // warm up on-device voice-note transcription
