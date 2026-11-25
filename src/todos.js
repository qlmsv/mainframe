// The owner's tasks, kept by the mainframe itself (no outside tracker needed).
// Columns: inbox (just written down), today, week, waiting (for someone's answer), done.
// who: owner (the owner does it) or assistant (the assistant does it). due: 'YYYY-MM-DD' or ISO time.
import { db, all, get, run } from './db.js';
import { bus } from './bus.js';

db.exec(`CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'inbox',
  who TEXT NOT NULL DEFAULT 'owner',
  due TEXT,
  created_at INTEGER NOT NULL,
  done_at INTEGER,
  source TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status)');

export const STATUSES = { today: 'Сегодня', inbox: 'Входящие', week: 'На неделе', waiting: 'Ждёт ответа', done: 'Готово' };
export const WHO = { owner: 'я', assistant: 'помощник' };
const ORDER = "CASE status WHEN 'today' THEN 0 WHEN 'inbox' THEN 1 WHEN 'week' THEN 2 WHEN 'waiting' THEN 3 ELSE 4 END";

// Today in the owner's time zone (the process runs in OWNER_TZ).
export const todayStr = () => new Date().toLocaleDateString('sv');

function clean(p, partial = false) {
  const out = {};
  if (p.title !== undefined) {
    const t = String(p.title || '').trim().slice(0, 300);
    if (!t) throw new Error('Пустая задача');
    out.title = t;
  } else if (!partial) throw new Error('Пустая задача');
  if (p.notes !== undefined) out.notes = p.notes ? String(p.notes).slice(0, 4000) : null;
  if (p.status !== undefined) {
    if (!STATUSES[p.status]) throw new Error(`Колонка: ${Object.keys(STATUSES).join(', ')}`);
    out.status = p.status;
  }
  if (p.who !== undefined) {
    if (!WHO[p.who]) throw new Error('Кто делает: owner или assistant');
    out.who = p.who;
  }
  if (p.due !== undefined) {
    const d = p.due ? String(p.due).trim() : null;
    if (d && Number.isNaN(Date.parse(d))) throw new Error('Срок: дата вида 2026-11-26 или 2026-11-26T14:00');
    out.due = d || null;
  }
  if (p.source !== undefined) out.source = p.source ? String(p.source).slice(0, 200) : null;
  return out;
}

export function addTodo(p) {
  const c = clean(p);
  const r = run('INSERT INTO todos (title, notes, status, who, due, created_at, done_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    c.title, c.notes ?? null, c.status || 'inbox', c.who || 'owner', c.due ?? null, Number(p.created_at) || Date.now(),
    c.status === 'done' ? (Number(p.done_at) || Date.now()) : null, c.source ?? 'chat');
  bus.change('todos');
  return getTodo(Number(r.lastInsertRowid));
}

export const getTodo = (id) => get('SELECT * FROM todos WHERE id = ?', Number(id)) || null;

export function listTodos({ status, who, done = false, limit = 200 } = {}) {
  const where = []; const args = [];
  if (status) { where.push('status = ?'); args.push(status); } else if (!done) where.push("status != 'done'");
  if (who) { where.push('who = ?'); args.push(who); }
  // Done ones: the latest first; open ones: by column, then the nearest due date, then the oldest.
  const order = status === 'done' || (done && !status) ? `${ORDER}, done_at DESC` : `${ORDER}, due IS NULL, due, id`;
  return all(`SELECT * FROM todos ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`, ...args, Math.min(Number(limit) || 200, 500));
}

export function updateTodo(id, patch) {
  const t = getTodo(id);
  if (!t) throw new Error(`Нет задачи №${id}`);
  const c = clean(patch, true);
  if (c.status === 'done' && t.status !== 'done') c.done_at = Date.now();
  if (c.status && c.status !== 'done') c.done_at = null;
  const keys = Object.keys(c);
  if (keys.length) run(`UPDATE todos SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => c[k]), t.id);
  bus.change('todos', t.id);
  return getTodo(t.id);
}

export const doneTodo = (id) => updateTodo(id, { status: 'done' });

export function deleteTodo(id) {
  const t = getTodo(id);
  if (!t) throw new Error(`Нет задачи №${id}`);
  run('DELETE FROM todos WHERE id = ?', t.id);
  bus.change('todos', t.id);
  return t;
}

const overdue = (t, day = todayStr()) => Boolean(t.due && t.due.slice(0, 10) <= day);

// The main things for today: the «today» column first, then overdue or due today from the others.
export function topTodos(n = 3) {
  const open = listTodos();
  const day = todayStr();
  const first = open.filter((t) => t.status === 'today');
  const rest = open.filter((t) => t.status !== 'today' && t.status !== 'waiting' && overdue(t, day));
  return [...first, ...rest].slice(0, n);
}

export function todoCounts() {
  const c = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, 0]));
  for (const r of all('SELECT status, COUNT(*) n FROM todos GROUP BY status')) c[r.status] = r.n;
  const day = todayStr();
  c.overdue = listTodos().filter((t) => t.status !== 'waiting' && overdue(t, day) && t.due.slice(0, 10) < day).length;
  return c;
}

// One line for a list: «№12 Позвонить Ане · до 26 нояб · помощник».
export function todoLine(t, { col = false } = {}) {
  const due = t.due ? new Date(t.due.length <= 10 ? `${t.due}T12:00` : t.due).toLocaleDateString('ru', { day: 'numeric', month: 'short' }) : '';
  return [`№${t.id} ${t.title}`, col ? STATUSES[t.status] : '', due ? `до ${due}${overdue(t) && t.status !== 'done' && t.due.slice(0, 10) < todayStr() ? ' ⚠️' : ''}` : '', t.who === 'assistant' ? 'помощник' : ''].filter(Boolean).join(' · ');
}
