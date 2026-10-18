import 'dotenv/config';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { db } from './db.ts';
import { getCookie, setCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { tickAll, useWorld, loadScene, control, member, employee, snapshot, requestCallback, callbackDone } from './sim.ts';
import { TransitionError } from './payments.ts';
import { chat, chatHistory, GENERAL } from './chat.ts';
import { prepare, loadAsr, AttachmentError } from './media.ts';
import { bodyLimit } from 'hono/body-limit';
import { tacticsIn } from './tactics.ts';
import { startCall, addChunk, stopCall, callState, clearCall } from './guardian.ts';
import { phoneState, link, unlink, callMe, watchCalls, PhoneError, phoneVerified } from './phone.ts';
import { emailState, linkEmail, unlinkEmail, watchInbox, EmailError, reportEmailById, sendLinkCode, verifyLinkCode } from './email.ts';
import { fileReport, normalize, extractIntake } from './reports.ts';
import { settings, saveSettings, detections, pushKey, addPushSub, removePushSubs, reportDetection, record } from './monitor.ts';
import { gmailEnabled, authUrl, callback as gmailCallback, disconnect as gmailDisconnect, watchGmail } from './gmail.ts';
import { sendEmail } from './email.ts';
import { SIGNALS_VERSION, SIGNAL_LABELS } from './signals.ts';

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
  if (err instanceof AttachmentError || err instanceof PhoneError || err instanceof EmailError) return c.json({ error: err.message }, 400);
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
  return c.json({ ...snapshot(), shared: sharedChats(c), share_on: ids, guardian: callState(chatKey(c)), phone: phoneState(c.get('sid')), email: emailState(c.get('sid')), channels: channelState(c.get('sid')), csrf: csrfFor(c.get('sid')) });
});
app.post('/api/scene/:id', c => { loadScene(c.req.param('id'), c.get('sid')); return c.json({ ok: true }); });
app.post('/api/control/:cmd', c => { control(c.req.param('cmd'), c.get('sid')); return c.json({ ok: true }); });
app.post('/api/member/:action', async c => { member(c.req.param('action'), await c.req.json().catch(() => ({}))); return c.json({ ok: true }); });
app.post('/api/employee/:action', async c => { employee(c.req.param('action'), await c.req.json().catch(() => ({}))); return c.json({ ok: true }); });
const chatKey = (c: any) => `${c.get('sid')}:${snapshot().scene.id}`;
app.post('/api/callback', async c => { const b = await c.req.json().catch(() => ({})); return c.json({ ok: true, id: requestCallback(String(b.kind), Number(b.caseId) || 0) }); });
app.post('/api/callback/:id/done', async c => { const b = await c.req.json().catch(() => ({})); callbackDone(Number(c.req.param('id')), String(b.note ?? '')); return c.json({ ok: true }); });
// Call guardian: ~4 s audio chunks from the member's browser, transcribed here; audio is not kept.
app.post('/api/guardian/start', async c => { const b = await c.req.json().catch(() => ({})); startCall(chatKey(c), !!b.share, b.source === 'sample' ? 'sample' : 'speaker'); return c.json({ ok: true }); });
app.post('/api/guardian/chunk', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: c => c.json({ error: 'Audio chunk too large' }, 413) }), async c => {
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.data !== 'string' || !b.data) return c.json({ error: 'No audio' }, 400);
  return c.json(await addChunk(chatKey(c), b.data));
});
app.post('/api/guardian/reset', c => { clearCall(chatKey(c)); return c.json({ ok: true }); });
app.post('/api/guardian/stop', async c => c.json(await stopCall(chatKey(c)) ?? { error: 'No call' }));
// Second Look's phone line: link the member's phone, and "Have Second Look call me" (with what the app knows).
app.post('/api/phone/link', async c => { const b = await c.req.json().catch(() => ({})); link(c.get('sid'), b.number, !!b.share); return c.json({ ok: true }); });
app.post('/api/email/link', async c => { const b = await c.req.json().catch(() => ({})); linkEmail(c.get('sid'), b.address, !!b.share); await sendLinkCode(c.get('sid')); return c.json({ ok: true }); });
app.post('/api/email/code', async c => { await sendLinkCode(c.get('sid')); return c.json({ ok: true }); });
app.post('/api/email/verify', async c => { const b = await c.req.json().catch(() => ({})); verifyLinkCode(c.get('sid'), b.code); return c.json({ ok: true }); });
// "Report to Sound" from the app: Second Look files the report for what it already saw (a call or a forwarded email).
app.post('/api/report', async c => {
  const b = await c.req.json().catch(() => ({})), sid = c.get('sid');
  if (b.channel === 'email') { await reportEmailById(sid, Number(b.id)); return c.json({ ok: true }); }
  const g = callState(chatKey(c));
  if (!g || !g.lines.length) return c.json({ error: 'Nothing to report yet' }, 400);
  const base = { summary: g.summary ?? 'The member used Call guardian on a call with warning signs.', contact_method: 'phone call (Call guardian listened)', tactics: g.alerts.map(a => a.label), quotes: g.alerts.map(a => a.quote).slice(0, 3) };
  const d = await extractIntake('You read the automatic transcript of a phone call a credit union member let Second Look listen to. The other voice is the caller who contacted the member. Fill the fraud case: the threat details come from what the caller said.', g.lines.map(l => (l.who === 'second-look' ? 'Second Look: ' : '') + l.text).join('\n')).catch(() => null);
  await fileReport(sid, normalize({ ...base, ...(d ?? {}), tactics: [...new Set([...(d?.tactics ?? []), ...base.tactics])] }, 'call guardian', { linked: true }));
  return c.json({ ok: true });
});
// Connected channels: what the member turned on, recent alerts, and how alerts reach them.
function channelState(sid: string) {
  const s = settings(sid);
  return { email_watch: s.email_watch, screening: s.screening, texts: s.texts, push: s.push, forward_confirm: s.forward_confirm, gmail: s.gmail ? { address: s.gmail.address } : null, gmail_available: gmailEnabled, push_key: pushKey(), detections: detections(sid) };
}
app.post('/api/channels', async c => {
  const b = await c.req.json().catch(() => ({})), sid = c.get('sid'), patch: any = {};
  for (const k of ['email_watch', 'screening', 'texts'] as const) if (typeof b[k] === 'boolean') patch[k] = b[k];
  if (patch.email_watch && !emailState(sid)?.verified) return c.json({ error: 'Confirm your email first on Email check' }, 400);
  if (patch.screening && !phoneVerified(sid)) return c.json({ error: 'Confirm your phone first: link it on Call guardian and call Second Look once from it' }, 400);
  if (patch.screening) patch.screening_since = Date.now();
  if (b.dismiss_confirm) patch.forward_confirm = null;
  saveSettings(sid, patch);
  return c.json({ ok: true });
});
app.post('/api/push/subscribe', async c => { const b = await c.req.json().catch(() => ({})); addPushSub(c.get('sid'), b.sub); return c.json({ ok: true }); });
app.post('/api/push/unsubscribe', c => { removePushSubs(c.get('sid')); return c.json({ ok: true }); });
// A sample alert, so the member (and judges) can see what one looks like before anything real arrives.
app.post('/api/push/test', async c => {
  const sid = c.get('sid'), em = (emailState(sid)?.linked ? (db.prepare('SELECT address FROM email_links WHERE sid = ? AND verified = 1').get(sid) as any)?.address : null) ?? null;
  await record(sid, { channel: 'email', risk: 'high', title: 'Sample alert: an email from “Sound Security” asks you to confirm a code', summary: 'This is a sample of what a Second Look alert looks like. Nothing real happened.', signals_version: SIGNALS_VERSION,
    signals: [{ key: 'credential_request', label: SIGNAL_LABELS.credential_request, score: 0.9, span: 'reply with the 6-digit code we just texted you', source: 'model' }, { key: 'urgency', label: SIGNAL_LABELS.urgency, score: 0.8, span: 'or your account will be locked within 1 hour', source: 'model' }, { key: 'impersonation', label: SIGNAL_LABELS.impersonation, score: 0.6, span: 'Sound Security Team', source: 'model' }],
    other: ['sound-secure-login.com: Uses Sound’s name, but it isn’t soundcu.com.'], why: ['Asks for a code or password: “reply with the 6-digit code we just texted you”', 'Pressure to hurry: “or your account will be locked within 1 hour”'], advice: 'Don’t click links or share codes. Check by typing soundcu.com yourself.', from: 'Sample', subject: 'Sample alert' }, em, sendEmail);
  return c.json({ ok: true });
});
app.post('/api/detections/:id/report', async c => { const out = await reportDetection(c.get('sid'), Number(c.req.param('id'))); return c.json({ ok: true, case_id: out.case_id }); });
app.get('/auth/google/start', c => (gmailEnabled ? c.redirect(authUrl(c.get('sid'))) : c.text('Gmail sign-in isn’t set up on this server.', 404)));
app.get('/auth/google/callback', async c => {
  try { await gmailCallback(c.req.query('state') ?? '', c.req.query('code') ?? ''); return c.redirect('/?page=channels&gmail=connected'); }
  catch (e) { return c.redirect('/?page=channels&gmail=' + encodeURIComponent((e as Error).message)); }
});
app.post('/api/gmail/disconnect', async c => { await gmailDisconnect(c.get('sid')); return c.json({ ok: true }); });
app.post('/api/email/unlink', c => { unlinkEmail(c.get('sid')); return c.json({ ok: true }); });
app.post('/api/phone/unlink', c => { unlink(c.get('sid')); return c.json({ ok: true }); });
app.post('/api/phone/call_me', async c => {
  const b = await c.req.json().catch(() => ({}));
  const g = callState(chatKey(c)), snap = snapshot();
  const ctx = [
    g && g.alerts.length ? `The member just used the call guardian on a call. Warning signs heard: ${g.alerts.map(a => `${a.label} ("${a.quote}")`).join('; ')}.` : '',
    b.caseId ? (() => { const k = snap.cases.find((x: any) => x.id === Number(b.caseId)); const p = k && snap.payments.find((x: any) => x.pid === k.pid); return k && p ? `A ${p.rail} payment of $${p.amount} is ${p.status === 'Held' ? 'on hold' : p.status} because: ${k.evidence.map((e: any) => e.why).join('; ')}.` : ''; })() : '',
  ].filter(Boolean).join('\n') || 'No payment is flagged; the member wants to talk something through.';
  await callMe(c.get('sid'), ctx);
  return c.json({ ok: true });
});
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
// The push service worker must be served from the root to cover the whole app.
app.get('/sw.js', c => c.body(page('sw.js'), 200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' }));
app.use('/ds/*', serveStatic({ root: './design-system', rewriteRequestPath: p => p.replace(/^\/ds/, '') }));
app.use('/static/*', serveStatic({ root: './public', rewriteRequestPath: p => p.replace(/^\/static/, '') }));

let last = Date.now();
setInterval(() => { const now = Date.now(); tickAll(now - last); last = now; }, 250);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`Second Look demo on http://localhost:${port}`));
if (process.env.NODE_ENV !== 'test') {
  loadAsr(); // warm up on-device voice-note transcription
  watchCalls(sid => { useWorld(sid); return `${sid}:${snapshot().scene.id}`; }); // Second Look's phone line
  watchInbox(sid => sid); // Second Look's inbox
  watchGmail(); // Connected Gmail accounts (if Google sign-in is configured)
}
