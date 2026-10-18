// Core storage: audit log and chat (scene state is rebuilt from the kit file on each scene load).
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
// Which console wrote the row: 'live' (the product) or 'demo' (the guided walkthrough). Every row from before this
// column came from the scene simulation, so the one-time backfill marks them demo.
try { db.exec("ALTER TABLE audit_log ADD COLUMN world TEXT NOT NULL DEFAULT 'live'"); db.exec("UPDATE audit_log SET world = 'demo'"); } catch { /* already there */ }

export type AuditWorld = 'live' | 'demo';
export function audit(actor: string, action: string, detail = '', world: AuditWorld = 'live') {
  db.prepare('INSERT INTO audit_log (ts, actor, action, detail, world) VALUES (?, ?, ?, ?, ?)').run(Date.now(), actor, action, detail, world);
}
/** The audit log one console sees: demo rows never appear in the live log, and the reverse. */
export function auditLog(world: AuditWorld, limit = 200) {
  return db.prepare('SELECT id, ts, actor, action, detail FROM audit_log WHERE world = ? ORDER BY id DESC LIMIT ?').all(world, limit) as { id: number; ts: number; actor: string; action: string; detail: string }[];
}
