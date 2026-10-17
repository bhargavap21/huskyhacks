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
    const okOrigin = !origin || new URL(origin).host === c.req.header('host');
    if (!okToken || !okOrigin) return c.json({ error: 'Request blocked (CSRF/Origin check)' }, 403);
  }
  await next();
});

// Every API call acts on this browser's own simulation.
app.use('/api/*', async (c, next) => { useWorld(c.get('sid')); await next(); });

app.onError((err, c) => {
  if (err instanceof TransitionError) return c.json({ error: err.message }, 409);
  console.error(err);
  return c.json({ error: 'Something went wrong' }, 500);
});

app.get('/api/state', c => c.json({ ...snapshot(), csrf: csrfFor(c.get('sid')) }));
app.post('/api/scene/:id', c => { loadScene(c.req.param('id'), c.get('sid')); return c.json({ ok: true }); });
app.post('/api/control/:cmd', c => { control(c.req.param('cmd'), c.get('sid')); return c.json({ ok: true }); });
app.post('/api/member/:action', async c => { member(c.req.param('action'), await c.req.json().catch(() => ({}))); return c.json({ ok: true }); });
app.post('/api/employee/:action', async c => { employee(c.req.param('action'), await c.req.json().catch(() => ({}))); return c.json({ ok: true }); });
const chatKey = (c: any) => `${c.get('sid')}:${snapshot().scene.id}`;
app.post('/api/callback', async c => { const b = await c.req.json().catch(() => ({})); return c.json({ ok: true, id: requestCallback(String(b.kind), Number(b.caseId) || 0) }); });
app.post('/api/callback/:id/done', async c => { const b = await c.req.json().catch(() => ({})); callbackDone(Number(c.req.param('id')), String(b.note ?? '')); return c.json({ ok: true }); });
const caseParam = (c: any) => (c.req.param('caseId') === 'general' ? GENERAL : Number(c.req.param('caseId')));
app.get('/api/chat/:caseId', c => c.json(chatHistory(chatKey(c), caseParam(c))));
app.post('/api/chat/:caseId', async c => {
  const b = await c.req.json().catch(() => ({}));
  return c.json(await chat(chatKey(c), caseParam(c), String(b.text ?? '')));
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
