// Optional email module (HANDOFF section 10). Not imported by the core demo.
import Database from 'better-sqlite3';

export const db = new Database(process.env.EMAIL_DB_PATH ?? 'email-module.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  enc_refresh_token TEXT,
  connected_at INTEGER,
  last_history_id TEXT,
  last_checkpoint_at INTEGER,
  watch_expiry INTEGER,
  status TEXT NOT NULL DEFAULT 'active' -- active | disconnecting | disconnected
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' -- active | gone
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  thread_id TEXT,
  received_at INTEGER NOT NULL,
  from_header TEXT,
  reply_to TEXT,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  auth_results TEXT,
  link_list_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL CHECK (source IN ('gmail','simulated')),
  fixture_id TEXT,
  UNIQUE(account_id, gmail_message_id)
);

CREATE TABLE IF NOT EXISTS processed_messages (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, gmail_message_id)
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,
  confidence TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  signals_json TEXT NOT NULL DEFAULT '[]',
  analysis_source TEXT NOT NULL DEFAULT 'live', -- live | cached
  should_push INTEGER NOT NULL DEFAULT 0,
  notified_at INTEGER,
  user_label TEXT NOT NULL DEFAULT 'none' CHECK (user_label IN ('none','looks_fine','reported','asked_for_help')),
  label_seconds REAL,
  notes TEXT NOT NULL DEFAULT '',
  shared_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL
);

-- No tokens, email bodies or quotes are ever written here.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);

-- Counts only: mail dropped by the sender allowlist or label rules (DECISIONS #2).
CREATE TABLE IF NOT EXISTS skipped_counts (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, reason)
);
`);

export function audit(actor: string, action: string, detail = '') {
  db.prepare('INSERT INTO audit_log (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(Date.now(), actor, action, detail);
}
