// «Что сделано»: a short register of finished work across projects (date, project, task, where it
// lives, status), so any session knows what is already on develop, what waits for a check, what is out.
// Filled by sessions (mainframe work_log_add) and, after a run that clearly produced something
// (a commit, a branch, a link, «выложил»), by a cheap model call over its result (WORK_LOG_AUTO).
import { config } from './config.js';
import { all, get, run, now, addLog } from './db.js';
import { bus } from './bus.js';

export const STATUSES = ['сделано', 'на проверке', 'выложено', 'ждёт'];
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function addWork({ project = '', title, location = '', status = 'сделано', at = null, run_id = null, source = 'session' }) {
  if (!String(title || '').trim()) throw new Error('Нужно короткое название задачи');
  const st = STATUSES.includes(status) ? status : 'сделано';
  const t = clip(title, 140);
  // The same task again (status moved on): update the row instead of adding a duplicate.
  const same = get('SELECT id FROM work_log WHERE lower(title) = lower(?) AND COALESCE(project, \'\') = ? AND at > ?', t, clip(project, 60), Date.now() - 14 * 86400000);
  if (same) {
    run('UPDATE work_log SET status = ?, location = COALESCE(NULLIF(?, \'\'), location), updated_at = ? WHERE id = ?', st, clip(location, 240), now(), same.id);
    bus.change('worklog');
    return { id: same.id, updated: true };
  }
  const res = run('INSERT INTO work_log (at, project, title, location, status, run_id, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    at || now(), clip(project, 60), t, clip(location, 240), st, run_id, source, now());
  bus.change('worklog');
  return { id: Number(res.lastInsertRowid), updated: false };
}

export function updateWork(id, { status, location, title }) {
  const row = get('SELECT * FROM work_log WHERE id = ?', Number(id));
  if (!row) throw new Error('Нет такой записи');
  run('UPDATE work_log SET status = ?, location = ?, title = ?, updated_at = ? WHERE id = ?',
    STATUSES.includes(status) ? status : row.status, location != null ? clip(location, 240) : row.location, title ? clip(title, 140) : row.title, now(), row.id);
  bus.change('worklog');
  return get('SELECT * FROM work_log WHERE id = ?', row.id);
}

export const listWork = ({ days = 30, limit = 100 } = {}) => all('SELECT * FROM work_log WHERE COALESCE(updated_at, at) > ? ORDER BY COALESCE(updated_at, at) DESC LIMIT ?', Date.now() - days * 86400000, limit);

const day = (t) => new Date(t).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
// The compact tail for a request: the last ~15 entries of WORK_LOG_DAYS days, within WORK_LOG_MAX_CHARS.
export function workLogTail({ max = config.workLog.max, days = config.workLog.days, limit = 15 } = {}) {
  const rows = all('SELECT * FROM work_log WHERE COALESCE(updated_at, at) > ? ORDER BY COALESCE(updated_at, at) DESC LIMIT ?', Date.now() - days * 86400000, limit);
  if (!rows.length) return '';
  const lines = [];
  let size = 0;
  for (const r of rows) {
    const l = `- ${day(r.at)} ${r.project ? `${r.project}: ` : ''}${r.title}${r.location ? ` (${clip(r.location, 90)})` : ''}: ${r.status} [#${r.id}]`;
    if (size + l.length > max) break;
    lines.push(l); size += l.length + 1;
  }
  return lines.join('\n');
}
export const workLogBlock = (tail = workLogTail()) => (tail ? `<mainframe-worklog>\nРеестр «что сделано» (свежее сверху; обновить: mainframe work_log_add, статус по номеру: work_log_update):\n${tail}\n</mainframe-worklog>\n\n` : '');

// ---------- automatic entries from run results ----------
const SIGNAL_RE = /(коммит|commit|ветк|branch|develop|в main|смерж|merge|выложил|выкатил|задеплоил|опубликовал|вышел пост|поставил в metricool|черновик[иа]? в metricool|pull request|PR #|\b[0-9a-f]{7,12}\b|https?:\/\/)/i;
const DONE_RE = /(готово|сделал|сделано|выложил|выкатил|закоммитил|отправил|поставил|опубликовал|собрал|починил|исправил)/i;
export function worthLogging(r) {
  if (!config.workLog.auto || r.status !== 'done' || !['bot', 'ui', 'cron', 'system'].includes(r.origin)) return false;
  const t = String(r.result || '');
  return t.length > 160 && SIGNAL_RE.test(t) && DONE_RE.test(t) && !/^\s*\[\[(?:тихо|quiet)\]\]\s*$/im.test(t);
}

export async function logFromRun(r, project, structured) {
  if (!worthLogging(r)) return 0;
  const recent = workLogTail({ max: 1200 });
  const out = await structured({
    prompt: `Проект мейнфрейма: ${project?.name || ''}\nЗапрос владельца:\n"""${String(r.prompt || '').replace(/<mainframe-[a-z]+>[\s\S]*?<\/mainframe-[a-z]+>/g, '').slice(0, 1200)}"""\n\nИтог работы:\n"""${String(r.result || '').slice(0, 5000)}"""\n\nУже в реестре:\n${recent || 'пусто'}`,
    system: 'Ты ведёшь реестр «что сделано». Верни только реально сделанные в этой работе результаты (код, выкладка, пост, документ, настройка, отправленное сообщение), 0–3 записи. Не записывай ответы на вопросы, планы, советы и то, что уже есть в реестре с тем же статусом. title: коротко по-русски, с номером карточки, если есть (#38). project: короткое имя проекта или продукта. location: ветка, коммит, путь, ссылка, только если они есть в тексте. status: «выложено» (на проде, опубликовано), «на проверке» (ждёт проверки человека, на develop), «ждёт» (ждёт решения владельца или заблокировано), иначе «сделано».',
    schema: { type: 'object', additionalProperties: false, required: ['entries'], properties: { entries: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['title', 'status'], properties: { project: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' }, status: { type: 'string', enum: STATUSES } } } } } },
    tools: [], maxTurns: 2,
  });
  let n = 0;
  for (const e of out?.entries || []) { try { addWork({ ...e, project: e.project || project?.name, run_id: r.id, source: 'auto' }); n++; } catch { /* empty title */ } }
  if (n) addLog('system', `Реестр работ: +${n} из задачи №${r.id}`, r.id);
  return n;
}
