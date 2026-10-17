import 'dotenv/config';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { tick, loadScene, control, member, employee, snapshot } from './sim.ts';
import { TransitionError } from './payments.ts';
import { chat, chatHistory } from './chat.ts';
import { db } from './db.ts';

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

app.onError((err, c) => {
  if (err instanceof TransitionError) return c.json({ error: err.message }, 409);
  console.error(err);
  return c.json({ error: 'Something went wrong' }, 500);
});

app.get('/api/state', c => c.json({ ...snapshot(), csrf: csrfFor(c.get('sid')) }));
app.post('/api/scene/:id', c => { loadScene(c.req.param('id')); return c.json({ ok: true }); });
app.post('/api/control/:cmd', c => { control(c.req.param('cmd')); return c.json({ ok: true }); });
app.post('/api/member/:action', async c => { member(c.req.param('action'), await c.req.json().catch(() => ({}))); return c.json({ ok: true }); });
app.post('/api/employee/:action', async c => { employee(c.req.param('action'), await c.req.json().catch(() => ({}))); return c.json({ ok: true }); });
app.get('/api/chat/:caseId', c => c.json(chatHistory(snapshot().scene.id, Number(c.req.param('caseId')))));
app.post('/api/chat/:caseId', async c => {
  const b = await c.req.json().catch(() => ({}));
  return c.json(await chat(snapshot().scene.id, Number(c.req.param('caseId')), String(b.text ?? '')));
});
app.get('/api/audit', c => c.json(db.prepare('SELECT ts, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 60').all()));

const page = (f: string) => readFileSync(join(import.meta.dirname, '..', 'public', f), 'utf8');
app.get('/', c => c.html(page('index.html')));
app.get('/about', c => c.html(page('about.html')));
app.use('/static/*', serveStatic({ root: './public', rewriteRequestPath: p => p.replace(/^\/static/, '') }));

let last = Date.now();
setInterval(() => { const now = Date.now(); tick(now - last); last = now; }, 250);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`Second Look demo on http://localhost:${port}`));
