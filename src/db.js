import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, config } from './config.js';
import { bus } from './bus.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'mainframe.db'));
// busy_timeout: a helper script or backup holding the file must make writes wait, not crash the mainframe.
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 8000;');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  session_id TEXT,
  description TEXT DEFAULT '',
  keywords TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  chat_id TEXT PRIMARY KEY,
  name TEXT,
  username TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  mode TEXT DEFAULT 'ask',
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  chat_id TEXT,
  name TEXT,
  username TEXT,
  text TEXT,
  last_message_id INTEGER,
  status TEXT DEFAULT 'new',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  decision TEXT,
  draft TEXT,
  run_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT,
  prompt TEXT,
  origin TEXT,
  status TEXT DEFAULT 'queued',
  result TEXT,
  cost REAL,
  inbox_id INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT,
  content TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  enabled INTEGER DEFAULT 1,
  last_run_at INTEGER,
  last_status TEXT
);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  message TEXT,
  run_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS bot_msgs (
  message_id INTEGER PRIMARY KEY,
  inbox_id INTEGER,
  project_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
`);

// Columns added after the first release.
const runCols = db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
if (!runCols.includes('model')) db.exec('ALTER TABLE runs ADD COLUMN model TEXT');
const inboxCols = db.prepare('PRAGMA table_info(inbox)').all().map((c) => c.name);
if (!inboxCols.includes('external_id')) db.exec('ALTER TABLE inbox ADD COLUMN external_id TEXT');
if (!inboxCols.includes('meta')) db.exec('ALTER TABLE inbox ADD COLUMN meta TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_inbox_ext ON inbox(source, external_id)');

export const now = () => Date.now();

// Keys and tokens never get stored: chats with BotFather, pasted configs and tool output are
// copied into the history, so they are masked on the way in (first characters stay for recognition).
const SECRET_RE = /(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|\bAKIA[A-Z0-9]{16}\b|xox[abpr]-[0-9A-Za-z-]{20,}|\b\d{8,10}:AA[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;
const SECRET_KV_RE = /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD|PASS)[A-Z0-9_]*\s*[=:]\s*)(["']?)([^\s"']{12,})/g;
export const redact = (s) => (s == null ? s : String(s).replace(SECRET_RE, (m) => `${m.slice(0, 6)}…[скрыто]`).replace(SECRET_KV_RE, (_, k, q) => `${k}${q}[скрыто]`));

export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);

export function kvGet(key, fallback = null) {
  const row = get('SELECT value FROM kv WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}
export function kvSet(key, value) {
  run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  bus.change('kv', key);
}

export function addLog(kind, message, runId = null) {
  const text = redact(String(message).slice(0, 2000));
  // The journal must never take the process down (it is called from the crash handlers too).
  try { run('INSERT INTO log (kind, message, run_id, created_at) VALUES (?, ?, ?, ?)', kind, text, runId, now()); } catch (e) { console.error(`log: ${e.message}`); return; }
  bus.change('log');
}

export function defaultProject() {
  let p = get('SELECT * FROM projects WHERE is_default = 1');
  if (!p) {
    run('INSERT INTO projects (name, cwd, description, is_default, created_at) VALUES (?, ?, ?, 1, ?)',
      'Мейнфрейм', config.workspaceDir, 'Общие задачи, команды из бота, cron без проекта', now());
    p = get('SELECT * FROM projects WHERE is_default = 1');
  }
  return p;
}
defaultProject();

// Keep the database small: 30 days of journal and session details are enough.
export function pruneOld() {
  const cutoff = now() - 30 * 86400000;
  run('DELETE FROM log WHERE created_at < ?', cutoff);
  run('DELETE FROM run_events WHERE created_at < ?', cutoff);
}
pruneOld();
setInterval(pruneOld, 86400000).unref();

// Interrupted runs from a previous process are no longer alive. Called by the main process only:
// a helper script that imports this module must not mark the live mainframe's queue as stopped.
export function recoverInterrupted() {
  // Background work cut off by a crash or restart is returned so it can be picked up again.
  const cut = all("SELECT id, project_id, prompt, origin, inbox_id, status FROM runs WHERE status IN ('running', 'queued')");
  run("UPDATE runs SET status = 'stopped', finished_at = ? WHERE status IN ('running', 'queued')", now());
  // Messages whose session was cut off go back to the owner instead of hanging "in progress".
  run("UPDATE inbox SET status = 'routed' WHERE status = 'forwarded' AND run_id IN (SELECT id FROM runs WHERE status = 'stopped')");
  return cut;
}
