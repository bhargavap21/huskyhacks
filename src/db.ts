// Core demo storage: audit log and chat (scene state is rebuilt from the kit file on each scene load).
import Database from 'better-sqlite3';

export const db = new Database(process.env.DB_PATH ?? 'second-look.sqlite');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY, scene TEXT NOT NULL, case_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')), text TEXT NOT NULL, source TEXT, ts INTEGER NOT NULL
);
`);
// Chat attachments (photos, PDFs, voice-note transcripts) as JSON; added after the first demo build.
try { db.exec('ALTER TABLE chat_messages ADD COLUMN att TEXT'); } catch { /* already there */ }

// Which world audit rows belong to: 'live', 'demo' (the guided walkthrough) or 'sample' (seeding the live sample case).
// Older rows predate the split and default to 'live'.
try { db.exec("ALTER TABLE audit_log ADD COLUMN world TEXT NOT NULL DEFAULT 'live'"); } catch { /* already there */ }
let world = 'live';
export function setAuditWorld(x: string) { world = x; }

export function audit(actor: string, action: string, detail = '', inWorld = world) {
  db.prepare('INSERT INTO audit_log (ts, actor, action, detail, world) VALUES (?, ?, ?, ?, ?)').run(Date.now(), actor, action, detail, inWorld);
}
