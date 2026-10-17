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

export function audit(actor: string, action: string, detail = '') {
  db.prepare('INSERT INTO audit_log (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(Date.now(), actor, action, detail);
}
