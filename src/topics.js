// A Telegram group with topics (a forum) for working with the assistant: every topic is its own
// thread of work. A topic is tied to a project (its session and context) and may have a role for
// notifications: inbox (incoming messages), summary (morning and evening), todos (the task list).
// Scheduled tasks can be caught by name (match, a regular expression), e.g. «^Задачи» or «Биржа».
//
// Where to send is written as one string «chatId#threadId»: the bot's API transformer (topicTransformer)
// splits it, so every existing send/edit/delete call works in a topic without changes.
import { db, all, get, run, kvGet, kvSet } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS topics (
  chat_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  title TEXT,
  project_id INTEGER,
  role TEXT,
  match TEXT,
  PRIMARY KEY (chat_id, thread_id)
)`);

export const ROLES = { inbox: 'Входящие', summary: 'Сводки', todos: 'Задачи' };
const GENERAL = 1; // the «General» topic of a forum

export const topicGroup = () => kvGet('topic_group', null);
export const setTopicGroup = (chatId) => kvSet('topic_group', chatId ? String(chatId) : null);
export const isTopicGroup = (chatId) => Boolean(topicGroup()) && String(chatId) === String(topicGroup());

export const destOf = (chatId, threadId) => `${chatId}#${Number(threadId) || GENERAL}`;
export function parseDest(d) {
  const m = /^(-?\d+)#(\d+)$/.exec(String(d ?? ''));
  return m ? { chatId: Number(m[1]), threadId: Number(m[2]) } : null;
}

export function saveTopic({ chatId = topicGroup(), threadId, title, projectId = null, role = null, match = null }) {
  if (!chatId) throw new Error('Группа с темами не задана');
  if (role && !ROLES[role]) throw new Error(`Роль: ${Object.keys(ROLES).join(', ')}`);
  run(`INSERT INTO topics (chat_id, thread_id, title, project_id, role, match) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, thread_id) DO UPDATE SET title = COALESCE(excluded.title, title), project_id = excluded.project_id, role = excluded.role, match = excluded.match`,
  String(chatId), Number(threadId) || GENERAL, title ?? null, projectId, role, match);
  return getTopic(chatId, threadId);
}
export const getTopic = (chatId, threadId) => get('SELECT * FROM topics WHERE chat_id = ? AND thread_id = ?', String(chatId), Number(threadId) || GENERAL) || null;
export const listTopics = (chatId = topicGroup()) => (chatId ? all('SELECT * FROM topics WHERE chat_id = ? ORDER BY thread_id', String(chatId)) : []);
export function updateTopic(chatId, threadId, patch) {
  const t = getTopic(chatId, threadId) || { chat_id: String(chatId), thread_id: Number(threadId) || GENERAL };
  return saveTopic({ chatId, threadId, title: patch.title ?? t.title, projectId: 'projectId' in patch ? patch.projectId : t.project_id, role: 'role' in patch ? patch.role : t.role, match: 'match' in patch ? patch.match : t.match });
}

// The project a message in a topic works in (its own session).
export function topicProject(chatId, threadId, fallbackId) {
  return getTopic(chatId, threadId)?.project_id || fallbackId;
}

// Where a notification goes: a topic of the group, or null (then the private chat, as before).
//   kind 'inbox' | 'summary' | 'todos' : the topic with that role;
//   kind 'run' : a scheduled task caught by name, else the topic of its project, else «General».
export function destFor(kind, { projectId = null, taskName = '', text = '' } = {}) {
  const g = topicGroup();
  if (!g) return null;
  const topics = listTopics(g);
  if (!topics.length) return null;
  if (ROLES[kind]) { const t = topics.find((x) => x.role === kind); return t ? destOf(g, t.thread_id) : null; }
  if (kind === 'run') {
    const byName = taskName && topics.find((x) => x.match && safeRe(x.match)?.test(taskName));
    if (byName) return destOf(g, byName.thread_id);
    if (/mainframe todo_list|todo_list/.test(text) && topics.some((x) => x.role === 'todos')) return destOf(g, topics.find((x) => x.role === 'todos').thread_id);
    // A project's own topic: the one tied to it that is not a notification channel first.
    const own = topics.filter((x) => projectId && x.project_id === projectId);
    const t = own.find((x) => !x.role && !x.match) || own.find((x) => !x.role) || own[0];
    if (t) return destOf(g, t.thread_id);
    return destOf(g, GENERAL);
  }
  return null;
}
function safeRe(s) { try { return new RegExp(s, 'i'); } catch { return null; } }

// grammY API transformer: chat_id «-100…#7» → chat_id and, for sending, message_thread_id.
// General (1) gets no thread id: Telegram expects none there.
const SENDS = /^(send|copyMessage|forwardMessage|copyMessages|forwardMessages)/;
export function topicTransformer(prev, method, payload, signal) {
  const d = payload && parseDest(payload.chat_id);
  if (!d) return prev(method, payload, signal);
  const p = { ...payload, chat_id: d.chatId };
  if (SENDS.test(method) && d.threadId !== GENERAL && p.message_thread_id === undefined) p.message_thread_id = d.threadId;
  return prev(method, p, signal);
}

// «эта тема для …»: a role (входящие, сводки, задачи) or a project by its name.
export function bindByWords(chatId, threadId, words, projects) {
  const w = String(words || '').trim().toLowerCase().replace(/[«»"".!]/g, '');
  const role = /входящ/.test(w) ? 'inbox' : /сводк/.test(w) ? 'summary' : /задач/.test(w) ? 'todos' : null;
  if (role) return { topic: updateTopic(chatId, threadId, { role }), what: ROLES[role] };
  const p = projects.find((x) => x.name.toLowerCase() === w) || projects.find((x) => x.name.toLowerCase().includes(w) || w.includes(x.name.toLowerCase()));
  if (!p) return null;
  return { topic: updateTopic(chatId, threadId, { projectId: p.id, role: null }), what: p.name };
}
