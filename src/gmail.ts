// "Connect Gmail" (read-only). Turns on when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
// Once a minute Second Look checks new inbox mail for each connected member, with the same checks as
// forwarded mail: ordinary mail is discarded after the check, flagged mail becomes an alert.
// Scope is gmail.readonly: Second Look can't send, delete, or change anything in the member's mailbox.
import { randomBytes } from 'node:crypto';
import { db } from './db.ts';
import { sidsWhere, saveSettings, settings, assess, record } from './monitor.ts';
import { sendEmail } from './email.ts';

const ID = process.env.GOOGLE_CLIENT_ID ?? '';
const SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const BASE = (process.env.PUBLIC_BASE_URL ?? 'https://second-look-demo.vercel.app').replace(/\/$/, '');
const REDIRECT = `${BASE}/auth/google/callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const gmailEnabled = !!(ID && SECRET);

db.exec(`CREATE TABLE IF NOT EXISTS gmail_seen (id TEXT PRIMARY KEY, ts INTEGER NOT NULL)`);
const pending = new Map<string, { sid: string; ts: number }>(); // OAuth state -> member

export function authUrl(sid: string) {
  const state = randomBytes(18).toString('hex');
  pending.set(state, { sid, ts: Date.now() });
  const q = new URLSearchParams({ client_id: ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state, include_granted_scopes: 'false' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(body: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: ID, client_secret: SECRET, ...body }), signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(j.error_description ?? j.error ?? 'token exchange failed');
  return j;
}

export async function callback(state: string, code: string) {
  const p = pending.get(state); pending.delete(state);
  if (!p || Date.now() - p.ts > 10 * 60_000) throw new Error('That sign-in link expired. Try Connect Gmail again.');
  const t = await token({ code, redirect_uri: REDIRECT, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new Error('Google did not grant offline access. Try again.');
  const prof: any = await (await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
  saveSettings(p.sid, { gmail: { address: String(prof.emailAddress ?? ''), refresh: t.refresh_token, since: Date.now() } });
}

export async function disconnect(sid: string) {
  const g = settings(sid).gmail;
  if (g) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(g.refresh)}`, { method: 'POST' }).catch(() => {});
  saveSettings(sid, { gmail: null });
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
function bodyOf(part: any): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return b64(part.body.data);
  for (const p of part.parts ?? []) { const t = bodyOf(p); if (t) return t; }
  if (part.mimeType === 'text/html' && part.body?.data) return b64(part.body.data).replace(/<[^>]+>/g, ' ');
  return '';
}

async function checkMember(sid: string) {
  const g = settings(sid).gmail!;
  const { access_token } = await token({ refresh_token: g.refresh, grant_type: 'refresh_token' });
  const auth = { Authorization: `Bearer ${access_token}` };
  const list: any = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=${encodeURIComponent(`in:inbox after:${Math.floor(g.since / 1000)}`)}`, { headers: auth })).json();
  for (const { id } of list.messages ?? []) {
    if (db.prepare('SELECT 1 FROM gmail_seen WHERE id = ?').get(id)) continue;
    db.prepare('INSERT OR IGNORE INTO gmail_seen (id, ts) VALUES (?, ?)').run(id, Date.now());
    const m: any = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth })).json();
    const h = (n: string) => (m.payload?.headers ?? []).find((x: any) => x.name.toLowerCase() === n)?.value ?? '';
    if (h('from').toLowerCase().includes(g.address.toLowerCase())) continue; // the member's own mail
    const extra = /dmarc=fail|spf=fail/i.test(h('authentication-results')) ? ['The sender failed email authentication checks'] : [];
    const d = await assess('gmail', h('from'), h('subject'), (bodyOf(m.payload) || m.snippet || '').slice(0, 8000), extra);
    if (d) await record(sid, d, g.address, sendEmail);
  }
}

export function watchGmail() {
  if (!gmailEnabled) return;
  setInterval(() => {
    for (const { sid } of sidsWhere(s => !!s.gmail)) checkMember(sid).catch(e => console.error('gmail: check failed:', (e as Error).message));
  }, 60_000);
}
