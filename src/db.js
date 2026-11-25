import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, config, SECRET_LITERALS } from './config.js';
import { bus } from './bus.js';
import { makeRedactor } from './secrets.js';

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
// Spend per run: cost is this run's own share (the SDK reports the running total of the whole
// conversation, kept in cost_total), tokens the same way (usage_total holds the running totals).
for (const [c, t] of [['cost_total', 'REAL'], ['tokens_in', 'INTEGER'], ['tokens_out', 'INTEGER'], ['tokens_cache_read', 'INTEGER'], ['tokens_cache_write', 'INTEGER'], ['usage_total', 'TEXT'], ['ctx_tokens', 'INTEGER'], ['parent_run_id', 'INTEGER']]) {
  if (!runCols.includes(c)) db.exec(`ALTER TABLE runs ADD COLUMN ${c} ${t}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS deferred_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  project_id INTEGER,
  origin TEXT,
  inbox_id INTEGER,
  prompt TEXT,
  reason TEXT,
  due_at INTEGER NOT NULL,
  status TEXT DEFAULT 'waiting',
  new_run_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS work_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  project TEXT,
  title TEXT NOT NULL,
  location TEXT,
  status TEXT DEFAULT 'сделано',
  run_id INTEGER,
  source TEXT,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT,
  kind TEXT NOT NULL,
  channel TEXT,
  target TEXT,
  payload TEXT,
  status TEXT DEFAULT 'pending',
  due_at INTEGER,
  result TEXT,
  error TEXT,
  chat_id TEXT,
  message_id INTEGER,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outbox_key ON outbox(key);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
`);
// Before 14.11.2026 cost held the conversation's running total: turn it into each run's own share once.
if (!runCols.includes('cost_total')) {
  db.exec('UPDATE runs SET cost_total = cost WHERE cost IS NOT NULL');
  const rows = db.prepare('SELECT id, project_id, session_id, cost_total FROM runs WHERE cost_total IS NOT NULL ORDER BY id').all();
  const lastBySession = new Map();
  const lastByProject = new Map(); // the project's main conversation, for runs in a copy of it
  const forkIds = new Set(db.prepare("SELECT DISTINCT run_id FROM run_events WHERE kind = 'system' AND content LIKE 'Сессия занята%'").all().map((x) => x.run_id));
  const upd = db.prepare('UPDATE runs SET cost = ? WHERE id = ?');
  for (const r of rows) {
    let base = lastBySession.get(r.session_id);
    // A copy starts from the main conversation's total at the moment it was copied: the largest
    // earlier total of that project not above its own.
    if (base == null && forkIds.has(r.id)) base = Math.max(-1, ...(lastByProject.get(r.project_id) || []).filter((x) => x <= r.cost_total));
    if (base === -1) base = null;
    const own = base != null && r.cost_total >= base ? r.cost_total - base : r.cost_total;
    upd.run(Math.round(own * 10000) / 10000, r.id);
    lastBySession.set(r.session_id, r.cost_total);
    if (!forkIds.has(r.id)) lastByProject.set(r.project_id, [...(lastByProject.get(r.project_id) || []).slice(-50), r.cost_total]);
  }
}
const inboxCols = db.prepare('PRAGMA table_info(inbox)').all().map((c) => c.name);
if (!inboxCols.includes('external_id')) db.exec('ALTER TABLE inbox ADD COLUMN external_id TEXT');
if (!inboxCols.includes('meta')) db.exec('ALTER TABLE inbox ADD COLUMN meta TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_inbox_ext ON inbox(source, external_id)');

export const now = () => Date.now();

// Keys and tokens never get stored: chats with BotFather, pasted configs and tool output are
// copied into the history, so they are masked on the way in (src/secrets.js).
export const redact = makeRedactor(SECRET_LITERALS);

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
  const cut = all("SELECT id, project_id, prompt, origin, inbox_id, status, started_at FROM runs WHERE status IN ('running', 'queued')");
  run("UPDATE runs SET status = 'stopped', finished_at = ? WHERE status IN ('running', 'queued')", now());
  // Messages whose session was cut off go back to the owner instead of hanging "in progress".
  run("UPDATE inbox SET status = 'routed' WHERE status = 'forwarded' AND run_id IN (SELECT id FROM runs WHERE status = 'stopped')");
  return cut;
}
