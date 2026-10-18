// Who the member is, from what they set up: the name they gave once, plus the phone and email they linked
// and verified. The live member view, Vantis's calls and the fraud cases all read it, so Vantis never has
// to ask a member who they are. (The demo world keeps the kit's synthetic members.)
import { db } from './db.ts';

db.exec(`CREATE TABLE IF NOT EXISTS profiles (sid TEXT PRIMARY KEY, name TEXT NOT NULL, ts INTEGER NOT NULL)`);

const clean = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

export function setName(sid: string, raw: unknown) {
  const name = clean(raw);
  if (!name) throw new Error('Enter your name');
  db.prepare('INSERT INTO profiles (sid, name, ts) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET name = excluded.name, ts = excluded.ts').run(sid, name, Date.now());
}

export type Profile = { name: string; phone: string; email: string };
/** The member's name and verified contact details ('' when not given or not verified). */
export function profile(sid: string | null): Profile {
  if (!sid) return { name: '', phone: '', email: '' };
  const name = (db.prepare('SELECT name FROM profiles WHERE sid = ?').get(sid) as { name: string } | undefined)?.name ?? '';
  const phone = (db.prepare('SELECT number FROM phone_links WHERE sid = ? AND verified = 1').get(sid) as { number: string } | undefined)?.number ?? '';
  let email = '';
  try { email = (db.prepare('SELECT address FROM email_links WHERE sid = ? AND verified = 1').get(sid) as { address: string } | undefined)?.address ?? ''; } catch { /* email links not set up */ }
  return { name, phone, email };
}

/** For the member's own screen: the phone shows only its last four digits. */
export function profileState(sid: string) {
  const p = profile(sid);
  return { name: p.name, phone: p.phone ? `•••-•••-${p.phone.slice(-4)}` : '', email: p.email };
}
