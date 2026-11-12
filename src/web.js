import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { ROOT, config } from './config.js';
import { all, get, run, now, kvGet, addLog } from './db.js';
import { bus } from './bus.js';
import { startRun, stopRun, stopAll, resumeAll, isPaused, activeRuns, claudeSessions, pastMessages } from './agent.js';
import { forwardItem, replyItem, ignoreItem, classify, restoreItem, chatHistory, suggestReply } from './dispatcher.js';
import { createTask, updateTask, deleteTask, fireTask, nextRuns, validateCron } from './scheduler.js';
import { mcpSummary } from './mcp.js';
import { tgState } from './telegram-mcp.js';
import { botState, ownerId } from './bot.js';
import { tunnelState } from './tunnel.js';
import { voiceState } from './voice.js';
import { mailState } from './mail.js';
import { financeSummary, addExpense, deleteExpense, rates } from './finance.js';
import * as linkedin from './linkedin.js';
import { clientModules, clientFile } from './modules.js';
import { modelState, saveModelSettings, testModel } from './models.js';
import * as content from './content.js';
import * as memory from './memory.js';
import { recallHybrid, recallOpen, recallStats } from './recall.js';
import { saveUpload } from './uploads.js';
import { channelStats, socialState, refreshReport } from './social.js';
import { agenda, upcomingReminders, completeReminder, createReminder, createEvent, notesList, noteBody, createNote } from './apple.js';

import * as setup from './setup.js';
import * as modes from './modes.js';
import * as mailbox from './mailbox.js';
import * as google from './google.js';
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// ---------- auth ----------
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k));
}

function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  const proxied = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['cf-ray'];
  return !proxied && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
}

// Telegram Mini App initData: HMAC-SHA256 with key HMAC("WebAppData", bot_token).
function telegramUser(initData) {
  if (!initData || !config.botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calc = crypto.createHmac('sha256', key).update(dataCheck).digest('hex');
  if (!safeEq(calc, hash)) return null;
  if (now() / 1000 - Number(params.get('auth_date') || 0) > 86400) return null;
  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

// Blocks DNS rebinding and cross-site requests from other pages open in the browser:
// a foreign page cannot set custom headers without a CORS preflight, which we never allow.
function sameOrigin(req) {
  if (req.headers['x-mf-client'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function authorized(req) {
  if (!sameOrigin(req)) return null;
  const host = (req.headers.host || '').split(':')[0];
  if (isLocal(req) && ['127.0.0.1', 'localhost'].includes(host)) return 'local';
  const token = req.headers['x-mf-token'] || cookies(req).mf_token;
  if (token && safeEq(String(token), config.dashboardToken)) return 'token';
  const user = telegramUser(req.headers['x-tg-init-data']);
  if (user && ownerId() && String(user.id) === String(ownerId())) return 'telegram';
  return null;
}

// ---------- helpers ----------
function send(res, code, body, headers = {}) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(code, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}

async function readBody(req, max = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new Error('Слишком большой запрос');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function state(req) {
  const local = isLocal(req);
  return {
    paused: isPaused(),
    authError: kvGet('auth_error', null),
    running: activeRuns(),
    counts: {
      inbox: get("SELECT COUNT(*) c FROM inbox WHERE status IN ('new','routed','error')").c,
      projects: get('SELECT COUNT(*) c FROM projects').c,
      tasks: get('SELECT COUNT(*) c FROM tasks WHERE enabled = 1').c,
    },
    telegram: { enabled: config.tg.enabled, ...tgState },
    bot: { configured: Boolean(config.botToken), owner: Boolean(ownerId()), ...botState },
    tunnel: tunnelState,
    voice: { ...voiceState, language: config.whisper.language || 'ru' },
    mail: { ...mailState, enabled: config.mail.enabled },
    linkedin: linkedin.status(),
    mcp: mcpSummary(),
    workspace: config.workspaceDir,
    // Secrets are shown only on the Mac itself.
    pairingCode: local && !ownerId() ? config.pairingCode : null,
    // Only the owner gets here (the API is authorized), so the personal link can be shown.
    dashboardLink: config.publicUrl ? `${config.publicUrl}/?token=${config.dashboardToken}` : null,
    offerUrl: config.owner.siteUrl || null,
    owner: config.owner.name,
    currency: config.currency,
    model: modelState(),
    modules: clientModules(),
  };
}

const projectWithStatus = (p) => ({
  ...p,
  running: Boolean(get("SELECT id FROM runs WHERE project_id = ? AND status IN ('running','queued') LIMIT 1", p.id)),
  last: get('SELECT id, status, prompt, result, finished_at, started_at FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 1', p.id) || null,
});

// ---------- routes ----------
const routes = [];
export const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/state', ({ req }) => state(req));

route('GET', '/api/inbox', ({ url }) => {
  const filter = url.searchParams.get('filter') || 'open';
  const where = filter === 'open' ? "WHERE status IN ('new','routed','error','done','forwarded')" : '';
  return all(`SELECT * FROM inbox ${where} ORDER BY id DESC LIMIT 100`).map((i) => ({ ...i, decision: i.decision ? JSON.parse(i.decision) : null }));
});
route('GET', '/api/inbox-rules', async () => (await import('./inbox-rules.js')).listRules());
route('DELETE', '/api/inbox-rules/:id', async ({ p }) => (await import('./inbox-rules.js')).deleteRule(Number(p.id)));
route('POST', '/api/inbox/:id/forward', async ({ p, body }) => ({ runId: await forwardItem(Number(p.id), { projectId: body.project_id, task: typeof body.task === 'string' ? body.task.trim() : undefined }) }));
route('POST', '/api/inbox/:id/restore', ({ p }) => restoreItem(Number(p.id)));
route('GET', '/api/inbox/:id/history', async ({ p }) => chatHistory(Number(p.id)));
route('POST', '/api/inbox/:id/suggest', async ({ p, body }) => suggestReply(Number(p.id), String(body.hint || '').slice(0, 1000)));
route('POST', '/api/inbox/:id/reply', async ({ p, body }) => replyItem(Number(p.id), { text: body.text }));
route('POST', '/api/inbox/:id/ignore', ({ p }) => ignoreItem(Number(p.id)));
route('POST', '/api/inbox/:id/reclassify', async ({ p }) => { await classify(Number(p.id)); return { ok: true }; });

route('GET', '/api/projects', () => all('SELECT * FROM projects ORDER BY is_default DESC, name').map(projectWithStatus));
route('POST', '/api/projects', ({ body }) => {
  if (!body.name?.trim()) throw new Error('Нужно название');
  if (body.cwd?.trim()) { checkCwd(body.cwd); body.cwd = body.cwd.trim().replace(/^~(?=\/)/, process.env.HOME); }
  const cwd = body.cwd?.trim() || path.join(config.workspaceDir, body.name.trim());
  const res = run('INSERT INTO projects (name, cwd, session_id, description, keywords, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    body.name.trim(), cwd, body.session_id || null, body.description || '', body.keywords || '', now());
  addLog('system', `Новый проект «${body.name.trim()}»`);
  bus.change('project');
  return { id: Number(res.lastInsertRowid) };
});
const checkCwd = (cwd) => {
  if (cwd !== undefined && !path.isAbsolute(String(cwd).trim().replace(/^~(?=\/)/, process.env.HOME))) throw new Error('Папка должна быть полным путём, например /Users/… или ~/…');
};
route('PATCH', '/api/projects/:id', ({ p, body }) => {
  checkCwd(body.cwd);
  if (body.cwd) body.cwd = String(body.cwd).trim().replace(/^~(?=\/)/, process.env.HOME);
  const keys = ['name', 'cwd', 'description', 'keywords', 'session_id'].filter((k) => k in body);
  if (keys.length) run(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => body[k] || (k === 'session_id' ? null : '')), Number(p.id));
  bus.change('project', Number(p.id));
  return { ok: true };
});
route('DELETE', '/api/projects/:id', ({ p }) => {
  const pr = get('SELECT * FROM projects WHERE id = ?', Number(p.id));
  if (pr?.is_default) throw new Error('Общий проект удалить нельзя');
  run('DELETE FROM projects WHERE id = ?', Number(p.id));
  bus.change('project');
  return { ok: true };
});
route('POST', '/api/projects/:id/message', ({ p, body }) => ({ runId: startRun({ projectId: Number(p.id), prompt: body.prompt, origin: 'ui' }) }));
route('POST', '/api/projects/:id/new-session', ({ p }) => {
  run('UPDATE projects SET session_id = NULL WHERE id = ?', Number(p.id));
  bus.change('project', Number(p.id));
  return { ok: true };
});
route('GET', '/api/projects/:id/timeline', ({ p }) => {
  const runs = all('SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 15', Number(p.id)).reverse();
  return runs.map((r) => ({ ...r, events: all('SELECT id, kind, content, created_at FROM run_events WHERE run_id = ? ORDER BY id', r.id) }));
});
// Reading a session's history from disk takes 1-2 s: keep it until the next run in that project.
const pastCache = new Map(); // `${id}:${limit}` -> { session, out }
bus.on('change', (e) => { if (e.type === 'run' || e.type === 'project') pastCache.clear(); });
route('GET', '/api/projects/:id/past', async ({ p, url }) => {
  const project = get('SELECT * FROM projects WHERE id = ?', Number(p.id));
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || 60);
  const key = `${p.id}:${limit}`;
  const hit = pastCache.get(key);
  if (hit && hit.session === project?.session_id) return hit.out;
  const out = await pastMessages(project, limit);
  pastCache.set(key, { session: project?.session_id, out });
  return out;
});
route('POST', '/api/runs/:id/stop', ({ p }) => ({ ok: stopRun(Number(p.id)) }));

// A screenshot or file for a session: base64 in, saved path out.
route('POST', '/api/upload', ({ body }) => {
  const data = String(body.data || '').replace(/^data:[^,]*,/, '');
  if (!data) throw new Error('Пустой файл');
  return { path: saveUpload(body.name || 'file', Buffer.from(data, 'base64')) };
});
route('GET', '/api/claude-sessions', ({ url }) => claudeSessions(Math.min(1000, Number(url.searchParams.get('limit')) || 60)));
route('POST', '/api/claude-sessions/attach', ({ body }) => {
  const existing = get('SELECT id FROM projects WHERE session_id = ?', body.sessionId);
  if (existing) return { id: existing.id };
  const res = run('INSERT INTO projects (name, cwd, session_id, created_at) VALUES (?, ?, ?, ?)', (body.name || 'Сессия').slice(0, 60), body.cwd || config.workspaceDir, body.sessionId, now());
  bus.change('project');
  return { id: Number(res.lastInsertRowid) };
});

// Social: the Telegram channel live plus the latest Metricool report.
route('GET', '/api/social', async ({ url }) => {
  let channel = null;
  let channelError = null;
  try { channel = await channelStats(url.searchParams.get('force') === '1'); } catch (e) { channelError = e.message; }
  return { ...socialState(), channel, channelError, goal: content.goalState(channel?.subscribers ?? null), linkedin: { ...linkedin.status(), posts: linkedin.posts().slice(0, 10) } };
});
route('POST', '/api/social/refresh', () => ({ runId: refreshReport() }));

// Content studio (src/content.js).
route('GET', '/api/content', () => content.contentState());
route('GET', '/api/content/insights', async ({ url }) => {
  const part = url.searchParams.get('part');
  const safe = (p) => p.catch((e) => ({ error: e.message }));
  if (part === 'analysis') return safe(content.analysis());
  if (part === 'rivals') return safe(content.competitorStats());
  throw new Error('part: analysis или rivals');
});
route('POST', '/api/content/generate', ({ body }) => content.generate({ topic: body.topic, networks: body.networks, link: Boolean(body.link), ideaId: body.idea_id ? Number(body.idea_id) : null, source: body.source || null }));
route('PATCH', '/api/content/posts/:id', ({ p, body }) => content.updatePost(Number(p.id), body));
route('DELETE', '/api/content/posts/:id', ({ p }) => content.deletePost(Number(p.id)));
route('POST', '/api/content/posts/:id/publish', ({ p }) => content.publishNow(Number(p.id)));
route('POST', '/api/content/posts/:id/schedule', ({ p, body }) => content.schedule(Number(p.id), Number(body.at)));
route('POST', '/api/content/posts/:id/unschedule', ({ p }) => content.unschedule(Number(p.id)));
route('POST', '/api/content/ideas', ({ body }) => content.addIdea({ title: body.title }));
route('POST', '/api/content/ideas/refresh', () => { content.refreshIdeas().catch((e) => addLog('error', `Банк идей: ${e.message}`)); return { ok: true }; });
route('PATCH', '/api/content/ideas/:id', ({ p, body }) => content.setIdeaStatus(Number(p.id), body.status === 'dropped' ? 'dropped' : 'new'));
route('POST', '/api/content/competitors', ({ body }) => content.addCompetitor(body.username));
route('POST', '/api/content/competitors/find', () => ({ runId: content.findCompetitors() }));
route('DELETE', '/api/content/competitors/:u', ({ p }) => content.removeCompetitor(decodeURIComponent(p.u)));
route('POST', '/api/content/goal', ({ body }) => content.setGoal(body));
route('POST', '/api/content/auto', ({ body }) => content.setAutoConfig(body));
route('POST', '/api/content/auto/run', () => { content.autoFromRivals(6).catch((e) => addLog('error', `Автопосты: ${e.message}`)); return { ok: true }; });

// Finance: expenses from bank mails, receipts and manual entries.
route('GET', '/api/finance', async () => ({ ...financeSummary(), rates: await rates() }));

// The home screen in one request: money, what runs now (with progress), what waits for the owner.
const PROGRESS_RE = /(\d+)\s*\/\s*(\d+)\s*(готов|сделан|done)?/i;
function runProgress(runId) {
  // The session reports «N/M готово» through notify_owner: the latest such message is the progress.
  const ev = all("SELECT content FROM run_events WHERE run_id = ? AND kind = 'tool' AND content LIKE '%notify_owner%' ORDER BY id DESC LIMIT 20", runId);
  for (const e of ev) {
    let text = '';
    try { text = JSON.parse(e.content).input || ''; } catch { text = e.content; }
    const m = PROGRESS_RE.exec(text);
    if (m && Number(m[2]) > 1 && Number(m[1]) <= Number(m[2])) return { n: Number(m[1]), m: Number(m[2]), text: text.replace(/[*_#`]/g, '').replace(/\s+/g, ' ').slice(0, 140) };
  }
  const steps = get("SELECT COUNT(*) c FROM run_events WHERE run_id = ? AND kind = 'tool'", runId).c;
  // A background run's last held message (notify_owner kept for the end) shows as its stage.
  const held = get("SELECT content FROM run_events WHERE run_id = ? AND kind = 'notify' ORDER BY id DESC LIMIT 1", runId)?.content;
  return held ? { steps, text: held.replace(/\[\[[^\]]*\]\]/g, '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140) } : { steps };
}
// Model provider (src/models.js): the key is written to .env and never sent back.
route('GET', '/api/model', () => modelState());
route('POST', '/api/model', ({ body }) => saveModelSettings({ provider: body.provider, key: body.key, baseUrl: body.baseUrl, main: body.main, fast: body.fast }));
route('POST', '/api/model/test', ({ body }) => testModel({ provider: body.provider, key: body.key, baseUrl: body.baseUrl, main: body.main, fast: body.fast }));
route('GET', '/api/home', async () => {
  const running = all(`SELECT r.id, r.status, r.prompt, r.origin, r.started_at, p.name project, p.id project_id FROM runs r JOIN projects p ON p.id = r.project_id
    WHERE r.status IN ('running', 'queued') ORDER BY r.status = 'running' DESC, r.id`).map((r) => ({
    ...r, prompt: /^\[Задача по расписанию «(.+?)»\]/.test(r.prompt || '') ? `⏰ ${/^\[Задача по расписанию «(.+?)»\]/.exec(r.prompt)[1]}` : String(r.prompt || '').replace(/^\[[^\]]*\]\s*/, '').replace(/^Фоновая задача[^:]*:\s*/i, '').replace(/\s+/g, ' ').slice(0, 160), progress: runProgress(r.id),
  }));
  // Answers that ended with buttons and got no reply in that project afterwards (24 hours).
  const asked = all(`SELECT r.id, r.result, r.finished_at, p.name project, p.id project_id FROM runs r JOIN projects p ON p.id = r.project_id
    WHERE r.status = 'done' AND r.finished_at > ? AND r.result LIKE '%[[кнопки:%' ORDER BY r.id DESC LIMIT 20`, Date.now() - 86400000)
    .filter((r) => !get("SELECT id FROM runs WHERE project_id = ? AND id > ? AND origin IN ('bot', 'ui') LIMIT 1", r.project_id, r.id))
    .map((r) => {
      const body = String(r.result || '').split('\n').filter((l) => l.trim() && !/^\[\[/.test(l.trim()));
      const choices = (/\[\[кнопки:\s*(.+?)\]\]/.exec(r.result || '')?.[1] || '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 4);
      return { id: r.id, project: r.project, project_id: r.project_id, at: r.finished_at, title: (body[0] || '').replace(/[*_#`=]/g, '').slice(0, 140), question: (body[body.length - 1] || '').replace(/[*_#`=]/g, '').slice(0, 160), choices };
    });
  // Just finished (20 minutes): the home screen shows them as done or failed for a while.
  const recent = all(`SELECT r.id, r.status, r.prompt, r.started_at, r.finished_at, p.name project, p.id project_id FROM runs r JOIN projects p ON p.id = r.project_id
    WHERE r.status IN ('done', 'error') AND r.finished_at > ? AND r.origin != 'inbox' ORDER BY r.finished_at DESC LIMIT 3`, Date.now() - 20 * 60000)
    .map((r) => ({ ...r, prompt: /^\[Задача по расписанию «(.+?)»\]/.test(r.prompt || '') ? `⏰ ${/^\[Задача по расписанию «(.+?)»\]/.exec(r.prompt)[1]}` : String(r.prompt || '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').slice(0, 160), progress: {} }));
  return {
    running, asked, recent,
    pendingMemory: memory.listPending().map((n) => ({ name: n.name, title: n.title })),
    inboxOpen: get("SELECT COUNT(*) c FROM inbox WHERE status IN ('new','routed','error','done')").c,
  };
});
route('POST', '/api/finance', ({ body }) => {
  if (!(Number(body.amount) > 0)) throw new Error('Нужна сумма');
  return addExpense({ amount: Number(body.amount), currency: body.currency || config.currency, merchant: String(body.merchant || '').slice(0, 120), category: body.category || undefined, note: String(body.note || '').slice(0, 300), at: body.at ? Date.parse(body.at) : undefined, source: 'вручную' });
});
route('DELETE', '/api/finance/:id', ({ p }) => deleteExpense(Number(p.id)));

// Day view and notes (Apple apps through macos-apps-mcp).
route('GET', '/api/agenda', () => agenda());
route('GET', '/api/reminders', () => upcomingReminders());
route('POST', '/api/reminders', ({ body }) => {
  if (!String(body.title || '').trim()) throw new Error('Пустое напоминание');
  return createReminder({ title: String(body.title).trim().slice(0, 300), due: body.due || undefined });
});
route('POST', '/api/reminders/complete', ({ body }) => completeReminder(String(body.id)));
route('POST', '/api/events', ({ body }) => {
  if (!body.title || !body.start || !body.end) throw new Error('Нужны название, начало и конец');
  return createEvent({ title: String(body.title).slice(0, 200), start: body.start, end: body.end, location: body.location });
});
// Memory tab: shared notes, the approval queue, history, and search over all history.
route('GET', '/api/memory', () => ({ notes: memory.listMemory(), pending: memory.listPending(), types: memory.MEMORY_TYPES, stats: recallStats(), dir: memory.MEMORY_DIR }));
route('PUT', '/api/memory/:name', ({ p, body }) => memory.saveMemory({ name: decodeURIComponent(p.name), title: body.title, description: body.description, type: body.type, body: body.body }));
route('DELETE', '/api/memory/:name', ({ p }) => memory.deleteMemory(decodeURIComponent(p.name)));
route('GET', '/api/memory/:name/history', ({ p }) => memory.memoryHistory(decodeURIComponent(p.name)));
route('POST', '/api/memory/pending/:name/approve', ({ p }) => memory.approvePending(decodeURIComponent(p.name)));
route('DELETE', '/api/memory/pending/:name', ({ p }) => memory.rejectPending(decodeURIComponent(p.name)));
route('GET', '/api/recall', ({ url }) => recallHybrid({ query: url.searchParams.get('q'), kind: url.searchParams.get('kind') || null, limit: 20 }));
route('GET', '/api/recall/open', ({ url }) => recallOpen(String(url.searchParams.get('ref') || '')));
route('GET', '/api/notes', ({ url }) => notesList(String(url.searchParams.get('q') || '').slice(0, 100)));
route('GET', '/api/notes/body', ({ url }) => noteBody(String(url.searchParams.get('id') || '')));
route('POST', '/api/notes', ({ body }) => {
  if (!String(body.title || '').trim()) throw new Error('Нужен заголовок');
  return createNote({ title: String(body.title).slice(0, 200), body: String(body.body || '').slice(0, 20000) });
});

route('GET', '/api/tasks', () => {
  const next = nextRuns();
  return all('SELECT * FROM tasks ORDER BY id').map((t) => ({ ...t, next_run: next[t.id] ?? null }));
});
route('POST', '/api/tasks', ({ body }) => ({ id: createTask(body) }));
route('POST', '/api/tasks/validate', ({ body }) => ({ next: validateCron(body.cron) }));
route('PATCH', '/api/tasks/:id', ({ p, body }) => { updateTask(p.id, body); return { ok: true }; });
route('DELETE', '/api/tasks/:id', ({ p }) => { deleteTask(p.id); return { ok: true }; });
route('POST', '/api/tasks/:id/run', ({ p }) => ({ runId: fireTask(p.id, true) }));

route('GET', '/api/contacts', () => all('SELECT * FROM contacts ORDER BY updated_at DESC'));
route('PATCH', '/api/contacts/:id', ({ p, body }) => {
  if (body.mode && !['ask', 'auto', 'ignore'].includes(body.mode)) throw new Error('Неверный режим');
  if (body.mode) run('UPDATE contacts SET mode = ?, updated_at = ? WHERE chat_id = ?', body.mode, now(), p.id);
  if ('project_id' in body) run('UPDATE contacts SET project_id = ?, updated_at = ? WHERE chat_id = ?', body.project_id || null, now(), p.id);
  bus.change('contact');
  return { ok: true };
});

route('GET', '/api/log', () => all('SELECT * FROM log ORDER BY id DESC LIMIT 200'));
route('POST', '/api/stop-all', () => { stopAll(); return { ok: true }; });
route('POST', '/api/resume', () => { resumeAll(); return { ok: true }; });

// ---------- where it works, the computer bridge, mail and Google (any model) ----------
const baseUrl = (req) => config.publicUrl || `${isLocal(req) ? 'http' : 'https'}://${req.headers.host}`;
export function connectState() {
  const m = mailbox.mailboxState();
  return { ...modes.modeState(), mail: m, mailPreset: mailbox.presetFor(m.address), google: google.googleState() };
}
async function saveMail(body) {
  const t = await mailbox.testMailbox(body);
  if (!t.ok) throw new Error(`Почта не подключилась: ${t.error}`);
  mailbox.saveMailbox(body);
  return { ...connectState(), test: t };
}
route('GET', '/api/connect', () => connectState());
route('POST', '/api/connect/mode', ({ body }) => { modes.saveMode(body.mode); return connectState(); });
route('POST', '/api/connect/bridge', ({ req }) => modes.bridgeCommands(baseUrl(req)));
route('POST', '/api/connect/mail', ({ body }) => saveMail(body));
route('POST', '/api/connect/mail/preset', ({ body }) => ({ preset: mailbox.presetFor(body.address) }));
route('POST', '/api/connect/mail/forget', () => { mailbox.forgetMailbox(); return connectState(); });
route('POST', '/api/connect/google/client', ({ body }) => { google.saveGoogleClient(body); return connectState(); });
route('POST', '/api/connect/google/start', ({ body }) => google.googleStart(body));
route('POST', '/api/connect/google/finish', async ({ body }) => { await google.googleFinish(body); return connectState(); });
route('POST', '/api/connect/google/forget', () => { google.googleForget(); return connectState(); });

// ---------- server ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function serveStatic(res, pathname) {
  // A folder in public/ opens its index.html (/tour and /tour/ both work).
  const dir = path.normalize(path.join(PUBLIC, pathname));
  if (pathname !== '/' && dir.startsWith(PUBLIC + path.sep) && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    if (!pathname.endsWith('/')) return send(res, 301, '', { location: `${pathname}/` });
    pathname = `${pathname}index.html`;
  }
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Не найдено');
  const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  // The page holds the key to the Mac: scripts only from here and from Telegram's Mini App SDK.
  if (file.endsWith('.html')) headers['content-security-policy'] = CSP;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function sse(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const onChange = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  bus.on('change', onChange);
  req.on('close', () => { clearInterval(ping); bus.off('change', onChange); });
}

// ---------- first-run wizard (src/setup.js) ----------
const SETUP_API = {
  'GET state': () => setup.setupState(),
  'POST profile': (b) => setup.saveProfile(b),
  'POST bot': (b) => setup.saveBot(b),
  'POST model': (b) => setup.saveModel(b),
  'POST model-test': (b) => setup.checkModel(b),
  'POST claude-start': () => setup.claudeStart(),
  'POST claude-code': (b) => setup.claudeCode(b),
  'GET connect': () => connectState(),
  'POST connect-done': () => setup.connectDone(),
  'POST claude-token': (b) => setup.claudeTokenPaste(b),
  'POST mode': (b) => { modes.saveMode(b.mode); return setup.setupState(); },
  'POST mail': (b) => saveMail(b),
  'POST mail-preset': (b) => ({ preset: mailbox.presetFor(b.address) }),
  'POST google-client': (b) => { google.saveGoogleClient(b); return connectState(); },
  'POST google-start': (b) => google.googleStart(b),
  'POST google-finish': async (b) => { await google.googleFinish(b); return connectState(); },
  'POST finish': () => {
    const out = setup.finish(() => process.kill(process.pid, 'SIGTERM'));
    const bridge = modes.currentMode() === 'both' && config.publicUrl ? modes.bridgeCommands(config.publicUrl) : null;
    return { ...out, bridge, dashboard: config.publicUrl ? `${config.publicUrl}/?token=${config.dashboardToken}` : null };
  },
};
async function handleSetup(req, res, url) {
  if (!setup.setupOpen()) {
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Настройка уже завершена' });
    return send(res, 404, 'Настройка уже завершена. Пульт открывается по ссылке из бота.');
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
  if (!sameOrigin(req)) return send(res, 403, { error: 'Нет доступа' });
  const body = req.method === 'POST' ? await readBody(req, 100_000) : {};
  const name = url.pathname.slice('/api/setup/'.length);
  if (req.method === 'POST' && name === 'login') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const sid = setup.setupLogin(ip, body.code);
    return send(res, 200, { ok: true }, { 'set-cookie': `mf_setup=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${isLocal(req) ? '' : '; Secure'}` });
  }
  if (!setup.setupAuthorized(cookies(req).mf_setup)) return send(res, 401, { error: 'Сначала введи фразу' });
  const h = SETUP_API[`${req.method} ${name}`];
  if (!h) return send(res, 404, { error: 'Нет такого шага' });
  return send(res, 200, (await h(body)) ?? { ok: true });
}

export function startWeb() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      // ?token=... sets a long-lived cookie, then strips the token from the address bar.
      const t = url.searchParams.get('token');
      if (t && safeEq(t, config.dashboardToken)) {
        return send(res, 302, '', { location: '/', 'set-cookie': `mf_token=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${isLocal(req) ? '' : '; Secure'}` });
      }
      // LinkedIn login: only from this Mac (the registered callback is localhost).
      if (url.pathname.startsWith('/oauth/linkedin/')) {
        // Start: only the owner (this machine or the dashboard cookie). Callback: guarded by the one-time state.
        const tok = cookies(req).mf_token;
        const owner = isLocal(req) || (tok && safeEq(String(tok), config.dashboardToken));
        if (url.pathname === '/oauth/linkedin/start' && !owner) return send(res, 403, 'Открой пульт по личной ссылке, потом нажми «Подключить LinkedIn» в «Системе».');
        const page = (title, text) => send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;background:#0f1012;color:#eee"><div style="text-align:center;max-width:420px"><h2>${title}</h2><p style="color:#aaa">${text}</p><a href="/" style="color:#ec7a48">Вернуться в пульт</a></div>`, { 'content-type': 'text/html; charset=utf-8' });
        if (url.pathname === '/oauth/linkedin/start') {
          if (!linkedin.configured()) return page('LinkedIn не настроен', 'Впиши LINKEDIN_CLIENT_ID и LINKEDIN_CLIENT_SECRET в .env и перезапусти мейнфрейм.');
          return send(res, 302, '', { location: linkedin.authUrl() });
        }
        if (url.pathname === '/oauth/linkedin/callback') {
          if (url.searchParams.get('error')) return page('LinkedIn не подключён', url.searchParams.get('error_description') || url.searchParams.get('error'));
          try {
            const me = await linkedin.handleCallback(url.searchParams.get('code'), url.searchParams.get('state'));
            return page('LinkedIn подключён ✅', `Аккаунт ${me.name || ''}. Теперь сессии могут публиковать посты от твоего имени (только после твоего «да»).`);
          } catch (e) { return page('Не получилось', e.message); }
        }
      }
      // Dashboard files of optional modules (only the ones each module declared).
      const mf = url.pathname.match(/^\/modules\/([\w-]+)\/([\w.-]+)$/);
      if (mf) {
        const file = clientFile(mf[1], mf[2]);
        if (!file) return send(res, 404, 'Не найдено');
        res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        return fs.createReadStream(file).pipe(res);
      }
      // Connecting a computer: the script with a one-time code, then the computer's key (src/modes.js).
      const br = url.pathname.match(/^\/bridge\/([\w-]{20,40})\/(mac\.sh|windows\.ps1)$/);
      if (br && req.method === 'GET') {
        const script = modes.bridgeScript(br[1], br[2] === 'windows.ps1' ? 'windows' : 'mac', baseUrl(req));
        if (!script) return send(res, 404, 'echo "Код устарел или уже использован. Возьми новую команду в пульте: Ещё → Система → Компьютер"');
        return send(res, 200, script, { 'content-type': 'text/plain; charset=utf-8' });
      }
      if (url.pathname === '/bridge/register' && req.method === 'POST') {
        return send(res, 200, modes.bridgeRegister(await readBody(req, 20_000)));
      }
      // First-run wizard: only while SETUP_CODE is set and the setup is not finished.
      if (url.pathname === '/setup' || url.pathname.startsWith('/setup/') || url.pathname.startsWith('/api/setup/')) return await handleSetup(req, res, url);
      if (url.pathname === '/' && setup.setupOpen() && !cookies(req).mf_token) return send(res, 302, '', { location: '/setup/' });
      if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
      const who = authorized(req);
      if (!who) return send(res, 401, { error: 'Нет доступа. Открой через бота или по ссылке с токеном.' });
      if (url.pathname === '/api/events') return sse(req, res);
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Нет такого метода' });
      const m = url.pathname.match(r.re);
      const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req, req.url.startsWith('/api/upload') ? 30_000_000 : 1_000_000) : {};
      const out = await r.handler({ req, url, p, body, who });
      return send(res, 200, out ?? { ok: true });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
  // Resolves once the port is ours. A second copy (e.g. launchd plus a manual `npm start`)
  // fails here, before it can start a duplicate bot, tunnel or Telegram connection.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      console.log(`\n  Мейнфрейм: http://${config.host}:${config.port}`);
      if (!ownerId() && config.botToken) console.log(`  Код привязки бота: /start ${config.pairingCode}`);
      resolve(server);
    });
  });
}
