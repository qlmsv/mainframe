import fs from 'node:fs';
import { memoryPrompt } from './memory.js';
import { recallContext } from './recall.js';
import path from 'node:path';
import net from 'node:net';
import { query, listSessions, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { config, ROOT } from './config.js';
import { all, get, run, now, addLog, kvGet, kvSet, redact } from './db.js';
import { bus } from './bus.js';
import { buildMcpServers } from './mcp.js';
import { chooseModel, chooseTools } from './routing.js';
import { sessionEnv, resolveModel, isClaude, mainModel } from './models.js';

const active = new Map(); // runId -> { abort, projectId, fork, startedAt }
const forks = new Set(); // runIds started beside a busy session (owner's bot messages)
const FORK_AFTER_MS = 30000;
const queues = new Map(); // projectId -> [runId]
const listeners = new Set(); // fn(run) on finish

export const onRunFinished = (fn) => listeners.add(fn);
export const isPaused = () => kvGet('paused', false);
export const activeRuns = () => [...active.keys()];

const MAINFRAME_PROMPT = `
Ты работаешь внутри личного мейнфрейма владельца (${config.owner.name}). Мейнфрейм это шлюз на Claude Agent SDK.
Тебе доступны MCP-серверы: ${config.tg.enabled ? 'telegram (аккаунт владельца через Telethon), ' : ''}mainframe (уведомить владельца, поставить cron-задачу, список проектов) и те, что подключены в mcp.json (Apple-приложения, управление Mac, браузер).
Пиши по-русски, коротко и по делу. Без длинных тире. Только реальные цифры.
Когда задача сделана, закончи ответ короткой сводкой: что сделано и что осталось.
У тебя есть терминал на Mac владельца: команды выполняй сам, не проси владельца запускать их, кроме тех, что требуют его пароля (sudo) или входа в аккаунт.
Чеки, квитанции и переводы, которые владелец присылает фото или текстом, записывай в его финансы через mainframe add_expense (сумма, валюта, где, категория, дата из чека). Скриншоты банков и бирж с балансом: обнови остаток через mainframe set_balance.
Формат ответа: он приходит владельцу в Telegram rich-сообщением, Markdown рендерит сам Telegram. Первая строка или абзац: суть, коротко. Сравнения таблицей. Статусы чек-листом: «- [x] сделано», «- [ ] осталось». Главное выделяй жирным (жёлтое ==выделение== не используй: в тёмной теме его не видно). Длинные подробности прячь в <details><summary>Подробнее</summary> ... </details> (пустая строка после summary и перед </details>). Дату и время встречи пиши так: ![17 ноября, 14:00](tg://time?unix=<unix>&format=wDT), чтобы каждый видел своё время.
Кнопки: если в конце ты ждёшь решения владельца с понятными вариантами, последней строкой напиши [[кнопки: Вариант 1 | Вариант 2 | Вариант 3]] (до 4 коротких вариантов, первый рекомендуемый; нажатие пришлёт этот текст тебе как ответ). Для ссылки или текста, который удобно скопировать: отдельной строкой [[копировать: Подпись | текст]]. Сам вопрос оставь в тексте.
Входящие: на «не показывай / тихо / пакетом / срочно про X» сначала mainframe inbox_rule_preview, покажи владельцу, сколько и что отсеется за 7 дней (с примерами), и сохраняй inbox_rule_add только после его «да». Список и удаление: inbox_rule_list, inbox_rule_delete.
Память и история: если не уверен, что помнишь договорённость, цифру или решение, сначала mainframe recall, потом отвечай, не угадывай. Новый факт, который отменяет старый (цена, решение, срок), сохраняй через memory_save с replaces: [старая заметка] или исправь старую заметку. «запомни…» от владельца сохраняй сразу через mainframe memory_save и отвечай одной строкой, что запомнил; «забудь…» через memory_delete; «что ты помнишь про X» и вопросы о прошлом («что решили», «что писал», «когда обсуждали») сначала ищи через mainframe recall (история всех сессий, входящих, почты и переписки в Telegram), потом отвечай с датами.
Фоновые задачи (по расписанию, из пульта, из другой сессии): этапы и «готово» через notify_owner не шли, владелец получит одно сообщение с итогом задачи, когда она закончится. notify_owner с urgent: true только когда нужно решение владельца прямо сейчас или сломалось важное. Если у задачи по расписанию нет новостей для владельца (всё как обычно, ничего не случилось), последней строкой ответа напиши [[тихо]]: итог останется в пульте, в чат не придёт.
Если менял код самого мейнфрейма (${ROOT}/src), проверь синтаксис (node --check) и вызови mainframe restart_mainframe: он перезапустит мейнфрейм после твоего ответа. Сам службу мейнфрейма не перезапускай (launchctl или systemctl): это оборвёт текущую задачу.
`.trim();

const INBOX_BLOCKED = [
  'mcp__telegram__send_message', 'mcp__telegram__reply_to_message', 'mcp__telegram__forward_message',
  'mcp__telegram__forward_messages', 'mcp__telegram__send_file', 'mcp__telegram__send_album',
  'mcp__telegram__send_voice', 'mcp__telegram__send_gif', 'mcp__telegram__send_sticker',
  'mcp__telegram__send_contact', 'mcp__telegram__send_scheduled_message', 'mcp__telegram__create_poll',
  'mcp__telegram__edit_message', 'mcp__telegram__delete_message', 'mcp__telegram__delete_messages_bulk',
  'mcp__telegram__delete_chat_history', 'mcp__telegram__block_user', 'mcp__telegram__invite_to_group',
  'mcp__apple__send_mail', 'mcp__apple__reply_all', 'mcp__apple__forward_mail', 'mcp__apple__mail_reply',
  'mcp__apple__trash_mail', 'mcp__mainframe__create_cron_task',
  'mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward',
  'mcp__mail__mail_send', 'mcp__google__manage_event', 'mcp__google__create_event', 'mcp__google__delete_event',
];

const AUTH_RE = /Failed to authenticate|OAuth session expired|login reached its time limit|Invalid API key|Please run \/login|auth login/i;

export function addEvent(runId, kind, content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  run('INSERT INTO run_events (run_id, kind, content, created_at) VALUES (?, ?, ?, ?)', runId, kind, redact(text.slice(0, 20000)), now());
  bus.change('run_event', runId, { kind });
}

function briefInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = input.command || input.file_path || input.path || input.url || input.pattern || input.query || input.message || input.text || input.prompt;
  const s = pick ? String(pick) : JSON.stringify(input);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

export function setAuthError(message) {
  kvSet('auth_error', message ? { message: message.slice(0, 300), at: now() } : null);
}

function baseOptions({ cwd, abortController, runId, tools = { mac: true, connectors: true } }) {
  const options = {
    cwd,
    abortController,
    mcpServers: buildMcpServers({ mac: tools.mac, connectors: tools.connectors, runId }),
    settingSources: ['user', 'project', 'local'],
    // Shared memory is read at every run start, so a note saved in one project reaches the next run anywhere.
    systemPrompt: { type: 'preset', preset: 'claude_code', append: `${MAINFRAME_PROMPT}\n${memoryPrompt()}` },
    permissionMode: config.permissionMode,
    hooks: {
      PostToolUse: [{
        hooks: [async (input) => {
          addLog('tool', `${input.tool_name}: ${briefInput(input.tool_name, input.tool_input)}`, runId);
          return {};
        }],
      }],
    },
    stderr: (d) => {
      if (AUTH_RE.test(d)) setAuthError(d);
    },
  };
  if (config.permissionMode === 'bypassPermissions') options.allowDangerouslySkipPermissions = true;
  options.model = mainModel(config.workModel || undefined);
  if (!options.model) delete options.model;
  // claude.ai connectors (Notion, Trello, Gmail...) take seconds to connect: off unless named.
  // Another model provider (MODEL_PROVIDER): its address and key go into the session's environment.
  const env = sessionEnv(tools.connectors ? {} : { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' });
  if (env) options.env = env;
  return options;
}

// ---------- projects that live on the Mac (server mode) ----------
export const isMacProject = (cwd) => Boolean(config.macRunner) && !config.serverDirs.some((d) => cwd === d || String(cwd || '').startsWith(`${d}/`));
export function macOnline() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: Number(process.env.MAC_SSH_PORT || 2222) });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(2500, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
const waitingNoted = new Set();

// Queue a prompt for a project session. Returns the run id at once; work happens in the background.
export function startRun({ projectId, prompt, origin = 'ui', inboxId = null }) {
  const project = get('SELECT * FROM projects WHERE id = ?', projectId);
  if (!project) throw new Error('Проект не найден');
  if (!prompt || !prompt.trim()) throw new Error('Пустое сообщение');
  const res = run(
    'INSERT INTO runs (project_id, session_id, prompt, origin, status, inbox_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    projectId, project.session_id, prompt.trim(), origin, 'queued', inboxId, now(),
  );
  const runId = Number(res.lastInsertRowid);
  addLog('run', `[${project.name}] ${origin}: ${prompt.trim().slice(0, 200)}`, runId);
  bus.change('run', runId);
  // The owner writes from the bot while this chat is busy with a long run: don't make the new
  // message wait. It runs at once in a fork of the session; cron and inbox keep the queue.
  if (origin === 'bot' && shouldFork(projectId)) {
    forks.add(runId);
    addEvent(runId, 'system', 'Сессия занята долгой задачей: отвечаю параллельно в копии сессии.');
    runFork(runId, projectId);
    return runId;
  }
  const q = queues.get(projectId) || [];
  q.push(runId);
  queues.set(projectId, q);
  pump(projectId);
  return runId;
}

function shouldFork(projectId) {
  const main = [...active.values()].find((a) => a.projectId === projectId && !a.fork);
  if (main) return Date.now() - main.startedAt > FORK_AFTER_MS;
  // Nothing running yet, but the queue holds work: the new message would still wait behind it.
  return false;
}

function runFork(runId, projectId) {
  execute(runId, { fork: true })
    .then((r) => {
      // The Mac is off: a fork can't start either, so it joins the normal queue.
      if (r === 'wait') {
        forks.delete(runId);
        const q = queues.get(projectId) || [];
        q.push(runId);
        queues.set(projectId, q);
        pump(projectId);
      }
    })
    .catch((e) => addLog('error', `Запуск ${runId}: ${e.message}`))
    .finally(() => forks.delete(runId));
}

// What the chat was busy with, for a fork that has no session to copy.
function recentSummary(projectId, exceptId) {
  const rows = all("SELECT prompt, result, status FROM runs WHERE project_id = ? AND id != ? AND status IN ('done','error','running') ORDER BY id DESC LIMIT 4", projectId, exceptId).reverse();
  if (!rows.length) return '';
  const lines = rows.map((x) => `- Запрос: ${String(x.prompt || '').replace(/\s+/g, ' ').slice(0, 300)}${x.result ? `\n  Ответ: ${String(x.result).replace(/\s+/g, ' ').slice(0, 400)}` : ' (ещё идёт)'}`);
  return `(Контекст: в этом чате параллельно идёт другая задача. Последние запросы и ответы:\n${lines.join('\n')})\n\n`;
}

// ---------- session rotation ----------
// A live chat (the owner's messages from the bot or the dashboard) does not carry the whole
// conversation forever: after a long pause, once the context is big, or on /new, the next message
// starts a fresh session that begins with a short handoff written from the old one.
const LIVE = new Set(['bot', 'ui']);
export function requestNewSession(projectId) {
  const p = get('SELECT session_id FROM projects WHERE id = ?', Number(projectId));
  if (!p?.session_id) return false;
  kvSet('session_rotate', { ...kvGet('session_rotate', {}), [projectId]: true });
  return true;
}
const ctxTokens = (sid) => kvGet('session_ctx', {})[sid] || 0;
function saveCtxTokens(sid, tokens) {
  const all0 = kvGet('session_ctx', {});
  all0[sid] = tokens;
  // Keep the newest 200 sessions.
  const keys = Object.keys(all0);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete all0[k];
  kvSet('session_ctx', all0);
}
function rotateReason(project, runId) {
  const forced = kvGet('session_rotate', {})[project.id];
  if (forced) return 'по команде';
  if (!config.sessionRotate) return null;
  const last = get('SELECT MAX(COALESCE(finished_at, started_at)) t FROM runs WHERE project_id = ? AND session_id = ? AND id != ?', project.id, project.session_id, runId)?.t;
  if (last && Date.now() - last > config.sessionGapHours * 3600000) return `перерыв больше ${config.sessionGapHours} ч`;
  const tokens = ctxTokens(project.session_id);
  if (tokens > config.sessionMaxTokens) return `разговор вырос до ${Math.round(tokens / 1000)} тыс. токенов`;
  return null;
}
// What the new session needs to go on: decisions, open items, the last exchanges, awaited buttons.
export async function makeHandoff(project, runId) {
  const rows = all("SELECT id, prompt, result, status, finished_at FROM runs WHERE project_id = ? AND session_id = ? AND id != ? AND status IN ('done','error','stopped') ORDER BY id DESC LIMIT 14", project.id, project.session_id, runId).reverse();
  if (!rows.length) return '';
  const clean = (t) => String(t || '').replace(/<mainframe-recall>[\s\S]*?<\/mainframe-recall>/g, '').replace(/\s+/g, ' ').trim();
  const history = rows.map((x) => `Владелец: ${clean(x.prompt).slice(0, 1200)}\nОтвет: ${clean(x.result).slice(0, 1600)}`).join('\n\n');
  let summary = '';
  try {
    const out = await structured({
      prompt: `Разговор владельца с помощником (последние обмены, старые сверху):\n\n${history}`,
      system: 'Ты пишешь передачу дел для новой сессии того же помощника. По-русски, коротко, только факты из разговора, без длинных тире. Разделы: «Решили» (решения и договорённости), «Открыто» (что не доделано, что обещано сделать, что ждёт ответа владельца), «Ждём ответа» (если последний ответ помощника предлагал кнопки или вопрос: какие варианты). Пустой раздел пропусти. Не больше 1500 символов.',
      schema: { type: 'object', properties: { handoff: { type: 'string' } }, required: ['handoff'] },
      tools: [], maxTurns: 2,
    });
    summary = String(out?.handoff || '');
    // Too long: cut at a line end, never mid-sentence.
    if (summary.length > 2200) summary = `${summary.slice(0, 2200).replace(/\n[^\n]*$/, '')}\n…`;
  } catch (e) { addLog('error', `Передача дел: ${e.message.slice(0, 120)}`); }
  const last = rows.slice(-3);
  const lastLines = last.map((x) => `- Владелец: ${clean(x.prompt).slice(0, 300)}\n  Ты: ${clean(x.result).replace(/\[\[[^\]]*\]\]/g, '').slice(0, 400)} (ref: run:${x.id})`).join('\n');
  // Buttons the last answer offered: the owner may tap one of them next.
  const buttons = /\[\[(?:кнопки|buttons):\s*(.+?)\]\]/i.exec(String(last[last.length - 1]?.result || ''))?.[1];
  const refs = rows.slice(0, -3).map((x) => `run:${x.id}`).join(', ');
  return `<handoff>\nЭто новая сессия этого чата: прошлая закрыта (${project.name}). Передача дел из неё, это контекст, а не новое задание. Если владелец отвечает кнопкой или коротким «да», ориентируйся на «Ждём ответа» и последние обмены. Дословно любой обмен открывается через mainframe recall_open по ref.\n${summary ? `${summary}\n` : ''}${buttons ? `Последний ответ предлагал кнопки: ${buttons}\n` : ''}Последние обмены:\n${lastLines}${refs ? `\nРаньше в этой сессии: ${refs}` : ''}\n</handoff>\n\n`;
}

function pump(projectId) {
  if ([...active.values()].some((a) => a.projectId === projectId && !a.fork)) return;
  const q = queues.get(projectId) || [];
  const next = q.shift();
  if (!next) return;
  execute(next)
    .then((r) => {
      // The Mac is off: put the run back at the head of the queue and look again in a minute.
      if (r === 'wait') { (queues.get(projectId) || queues.set(projectId, []).get(projectId)).unshift(next); setTimeout(() => pump(projectId), 60000); return 'wait'; }
      return null;
    })
    .catch((e) => addLog('error', `Запуск ${next}: ${e.message}`))
    .then((r) => { if (r !== 'wait') pump(projectId); });
}

const modelName = (m) => (/sonnet/i.test(m || '') ? 'Sonnet' : /haiku/i.test(m || '') ? 'Haiku' : /opus/i.test(m || '') || !m ? 'Opus' : m);

async function execute(runId, { fork = false } = {}) {
  const r = get('SELECT * FROM runs WHERE id = ?', runId);
  if (!r || r.status !== 'queued') return;
  const project = get('SELECT * FROM projects WHERE id = ?', r.project_id);
  if (!project) {
    run("UPDATE runs SET status = 'error', result = 'Проект удалён', finished_at = ? WHERE id = ?", now(), runId);
    bus.change('run', runId);
    return;
  }
  const onMac = isMacProject(project.cwd);
  if (onMac && !(await macOnline())) {
    if (!waitingNoted.has(runId)) {
      waitingNoted.add(runId);
      addEvent(runId, 'system', 'Жду Mac: файлы этого проекта на Mac, а он сейчас выключен. Запущу сам, как только он включится.');
      addLog('run', `[${project.name}] ждёт Mac`, runId);
    }
    return 'wait';
  }
  waitingNoted.delete(runId);
  const abortController = new AbortController();
  active.set(runId, { abort: abortController, projectId: project.id, fork, startedAt: Date.now() });
  run("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?", now(), runId);
  bus.change('run', runId);

  // A fresh session for a live chat that paused long or grew big (see rotateReason).
  let handoff = '';
  if (!fork && project.session_id && LIVE.has(r.origin)) {
    const why = rotateReason(project, runId);
    if (why) {
      handoff = await makeHandoff(project, runId).catch(() => '');
      const flags = kvGet('session_rotate', {});
      if (flags[project.id]) { delete flags[project.id]; kvSet('session_rotate', flags); }
      run('UPDATE projects SET session_id = NULL WHERE id = ?', project.id);
      project.session_id = null;
      addEvent(runId, 'system', `Новая сессия (${why}), передача дел: ${handoff.length} симв.`);
      addLog('run', `[${project.name}] новая сессия: ${why}`, runId);
    }
  }
  // Model and tools by the task: a short "да" doesn't need Opus, a question about money doesn't need the browser.
  const recent = all('SELECT prompt FROM runs WHERE project_id = ? AND id < ? AND started_at > ? ORDER BY id DESC LIMIT 3', project.id, runId, Date.now() - 6 * 3600000)
    .map((x) => String(x.prompt || '').slice(0, 2000)).join('\n');
  const tools = chooseTools({ prompt: r.prompt, recent });
  // A resumed (or forked) session keeps the model its last run used: switching loses the cache.
  const resume = Boolean(project.session_id);
  const lastModel = resume ? get('SELECT model FROM runs WHERE project_id = ? AND session_id = ? AND model IS NOT NULL AND id < ? ORDER BY id DESC LIMIT 1', project.id, project.session_id, runId)?.model : null;
  const pick = chooseModel({ prompt: r.prompt, origin: r.origin, resume, lastModel });
  const options = baseOptions({ cwd: project.cwd, abortController, runId, tools });
  if (pick.model) options.model = pick.model;
  run('UPDATE runs SET model = ? WHERE id = ?', options.model || null, runId);
  addEvent(runId, 'system', `Модель: ${modelName(options.model)} (${pick.why}) · инструменты: ${tools.why}`);
  if (onMac) options.pathToClaudeCodeExecutable = config.macRunner;
  if (project.session_id) options.resume = project.session_id;
  // A fork copies the conversation into a new session; the project keeps its main session.
  if (fork && project.session_id) options.forkSession = true;
  // Work started by someone else's Telegram message: their text is untrusted, so the session
  // cannot message anyone, send mail or schedule itself. Replies go through the owner.
  if (r.origin === 'inbox') options.disallowedTools = INBOX_BLOCKED;

  let status = 'error';
  let result = '';
  let cost = null;
  let sessionId = project.session_id;
  let lastCtx = 0;
  try {
    if (!path.isAbsolute(project.cwd || '')) throw new Error(`Папка проекта должна быть полным путём, сейчас: «${project.cwd || ''}»`);
    if (!fs.existsSync(project.cwd)) fs.mkdirSync(project.cwd, { recursive: true });
    // Related notes and history go in front of the message (not into the system prompt, which
    // would break the prompt cache of the whole conversation). Other people's work is skipped.
    let prompt = r.prompt;
    if (fork && !project.session_id) prompt = `${recentSummary(project.id, runId)}${prompt}`;
    if (handoff) prompt = `${handoff}${prompt}`;
    if (r.origin !== 'inbox') {
      // The last exchange of this chat: a short «да» is searched together with what it answers.
      const prev = get("SELECT prompt, result FROM runs WHERE project_id = ? AND id < ? AND status = 'done' ORDER BY id DESC LIMIT 1", project.id, runId);
      const ctx = await recallContext(r.prompt, { project: project.name, context: prev ? `${prev.prompt}\n${prev.result}` : '' }).catch(() => '');
      if (ctx) { prompt = `${ctx}${r.prompt}`; addEvent(runId, 'system', `Подсказки из памяти: ${(ctx.match(/^- /gm) || []).length}`); }
    }
    const q = query({ prompt, options });
    for await (const m of q) {
      if (m.session_id && m.session_id !== sessionId) {
        sessionId = m.session_id;
        run('UPDATE runs SET session_id = ? WHERE id = ?', sessionId, runId);
        if (!fork) {
          run('UPDATE projects SET session_id = ? WHERE id = ?', sessionId, project.id);
          bus.change('project', project.id);
        }
      }
      if (m.type === 'system' && m.subtype === 'init') {
        const failed = (m.mcp_servers || []).filter((s) => s.status !== 'connected').map((s) => `${s.name}: ${s.status}`);
        addEvent(runId, 'system', `Сессия запущена · ${m.model}${failed.length ? ` · MCP не подключены: ${failed.join(', ')}` : ''}`);
      } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        // How big the conversation is now: everything the model read for this step.
        const u = m.message?.usage;
        if (u && sessionId) lastCtx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        for (const b of m.message?.content || []) {
          if (b.type === 'text' && b.text.trim()) addEvent(runId, 'text', b.text);
          else if (b.type === 'tool_use') addEvent(runId, 'tool', { name: b.name, input: briefInput(b.name, b.input) });
        }
        if (m.error && m.error !== 'authentication_failed') addEvent(runId, 'error', String(m.error));
      } else if (m.type === 'result') {
        cost = m.total_cost_usd ?? null;
        result = m.subtype === 'success' ? (m.result || '') : `Ошибка: ${m.subtype}`;
        status = m.subtype === 'success' && !m.is_error ? 'done' : 'error';
        if (AUTH_RE.test(result)) setAuthError(result);
        else if (status === 'done') setAuthError(null);
      }
    }
  } catch (e) {
    if (abortController.signal.aborted) {
      status = 'stopped';
      result = 'Остановлено';
    } else {
      status = 'error';
      result = e.message;
      if (AUTH_RE.test(e.message)) setAuthError(e.message);
    }
  } finally {
    active.delete(runId);
    if (lastCtx && sessionId) saveCtxTokens(sessionId, lastCtx);
  }

  // The link to the Mac dropped mid-run (tunnel restart, Mac asleep): put the work back once, it
  // resumes the same session as soon as the Mac answers again.
  const linkLost = onMac && status === 'error' && /exited with code 255|closed by remote host|Connection reset|Broken pipe/i.test(result);
  if (linkLost && !String(r.prompt).startsWith('(Связь с Mac прервалась')) {
    addLog('run', `[${project.name}] связь с Mac прервалась, задача вернётся в очередь`, runId);
    setTimeout(() => {
      try { startRun({ projectId: project.id, origin: r.origin, inboxId: r.inbox_id, prompt: `(Связь с Mac прервалась посреди работы. Продолжи эту задачу с того места, где остановился, сделанное не повторяй.)\n\n${r.prompt}` }); } catch (e) { addLog('error', `Повтор после обрыва: ${e.message}`); }
    }, 30000);
    result += '\nСвязь с Mac прервалась. Задача сама продолжится, когда Mac снова ответит.';
  }

  // A resumed session that no longer exists on disk: forget it so the next message starts fresh.
  if (status === 'error' && project.session_id && /No conversation found|session.*not found/i.test(result)) {
    run('UPDATE projects SET session_id = NULL WHERE id = ?', project.id);
    result += '\nСессия не найдена на диске. Следующее сообщение начнёт новую.';
  }
  const lastText = get("SELECT content FROM run_events WHERE run_id = ? AND kind = 'text' ORDER BY id DESC LIMIT 1", runId)?.content || '';
  if (status === 'error' && (!lastText || !result.includes(lastText.slice(0, 60)))) addEvent(runId, 'error', result);
  run('UPDATE runs SET status = ?, result = ?, cost = ?, finished_at = ? WHERE id = ?', status, redact(result), cost, now(), runId);
  addLog('run', `[${project.name}] ${status === 'done' ? 'готово' : status}: ${result.slice(0, 200)}`, runId);
  bus.change('run', runId);
  const finished = get('SELECT * FROM runs WHERE id = ?', runId);
  // Notifications and reply drafts run in the background: the next queued run starts now.
  for (const fn of listeners) {
    Promise.resolve().then(() => fn(finished, project)).catch((e) => addLog('error', `onRunFinished: ${e.message}`));
  }
}

export function stopRun(runId) {
  const a = active.get(Number(runId));
  if (a) {
    a.abort.abort();
    return true;
  }
  const r = get("SELECT * FROM runs WHERE id = ? AND status = 'queued'", Number(runId));
  if (r) {
    const q = queues.get(r.project_id) || [];
    queues.set(r.project_id, q.filter((id) => id !== r.id));
    run("UPDATE runs SET status = 'stopped', finished_at = ? WHERE id = ?", now(), r.id);
    bus.change('run', r.id);
    return true;
  }
  return false;
}

// Kill switch: stop everything and pause automatic actions until resumed.
export function stopAll() {
  for (const [id] of active) stopRun(id);
  for (const [pid, q] of queues) {
    for (const id of q) run("UPDATE runs SET status = 'stopped', finished_at = ? WHERE id = ?", now(), id);
    queues.set(pid, []);
  }
  kvSet('paused', true);
  addLog('system', 'Всё остановлено. Автоматика на паузе.');
}

export function resumeAll() {
  kvSet('paused', false);
  addLog('system', 'Автоматика снова включена.');
}

// Files the dispatcher must never read, even inside the knowledge base: incoming
// Telegram text is untrusted and could ask it to quote them into a reply draft.
const SECRET_RE = /(^|\/)(\.env[^/]*|.*\.secret|.*\.pem|.*\.key|id_[a-z0-9]+|\.ssh|\.aws|\.gnupg|\.git|node_modules|data|vendor|mainframe\.db[^/]*|Library|Keychains?)(\/|$)/i;

const DOC_GLOB_RE = /^(\*\*\/)?\*\.(md|markdown|txt)$|^(\*\*\/)?\*\.\{(md|markdown|txt)(,(md|markdown|txt))*\}$/;

// Read/Grep/Glob stay inside `root` and away from secrets. Everything else is denied.
export function kbGuard(root) {
  const base = path.resolve(root);
  const inside = (p) => {
    const abs = path.resolve(base, String(p || '.'));
    const rel = path.relative(base, abs);
    return (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) && !SECRET_RE.test(rel);
  };
  return async (hookInput) => {
    const name = hookInput.tool_name;
    const input = hookInput.tool_input || {};
    if (!['Read', 'Grep', 'Glob'].includes(name)) return {};
    const target = name === 'Read' ? input.file_path : input.path;
    const deny = (why) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } });
    if (target !== undefined && !inside(target)) return deny('Можно читать только файлы базы знаний.');
    if (name === 'Read') return target === undefined ? deny('Нужен file_path.') : {};
    if (name === 'Glob') {
      const pattern = String(input.pattern || '');
      const ok = !pattern.startsWith('/') && !pattern.split('/').includes('..') && !SECRET_RE.test(pattern);
      return ok ? {} : deny('Такой шаблон нельзя: только файлы базы знаний.');
    }
    // Grep searches hidden files too, so a folder search must be limited to documents,
    // otherwise .env files and databases under the folder would be searched.
    const abs = path.resolve(base, String(target || '.'));
    const isFile = fs.existsSync(abs) && fs.statSync(abs).isFile();
    const docsOnly = DOC_GLOB_RE.test(String(input.glob || '')) || ['md', 'markdown', 'txt'].includes(String(input.type || ''));
    return isFile || docsOnly ? {} : deny('Ищи по документам: добавь glob "**/*.md" (или "*.txt"), либо укажи конкретный файл.');
  };
}

// One-shot structured call (dispatcher, drafts). Read-only tools, confined to the knowledge base.
export async function structured({ prompt, schema, system, cwd = config.kbDir, tools = ['Read', 'Grep', 'Glob'], maxTurns = 8, model = config.dispatchModel }) {
  const root = fs.existsSync(cwd) ? cwd : config.workspaceDir;
  const options = {
    model: resolveModel(model),
    cwd: root,
    maxTurns,
    persistSession: false,
    settingSources: [],
    tools,
    allowedTools: tools,
    permissionMode: 'dontAsk',
    // Hooks run before any permission rule, so the path check cannot be skipped.
    hooks: { PreToolUse: [{ matcher: 'Read|Grep|Glob', hooks: [kbGuard(root)] }] },
    systemPrompt: system,
    outputFormat: { type: 'json_schema', schema },
    stderr: (d) => { if (AUTH_RE.test(d)) setAuthError(d); },
  };
  const env = sessionEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: 'false' });
  if (env && !isClaude()) options.env = env;
  let out = null;
  let err = null;
  // A hung model call must not block the inbox: give up after 2 minutes.
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 120000);
  options.abortController = abortController;
  try {
    for await (const m of query({ prompt, options })) {
      if (m.type === 'result') {
        if (m.subtype === 'success' && m.structured_output) out = m.structured_output;
        else err = m.result || m.subtype;
      }
    }
  } catch (e) {
    err = abortController.signal.aborted ? 'Диспетчер не ответил за 2 минуты' : e.message;
  } finally {
    clearTimeout(timer);
  }
  if (!out) {
    if (err && AUTH_RE.test(err)) setAuthError(err);
    throw new Error(err || 'Пустой ответ');
  }
  setAuthError(null);
  return out;
}

export async function claudeSessions(limit = 60) {
  const list = await listSessions({ limit, includeProgrammatic: false });
  const attached = new Map(all('SELECT id, session_id FROM projects WHERE session_id IS NOT NULL').map((p) => [p.session_id, p.id]));
  const byCwd = new Map(all('SELECT id, cwd FROM projects').map((p) => [p.cwd, p.id]));
  return list.map((s) => ({
    sessionId: s.sessionId,
    title: s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8),
    cwd: s.cwd,
    lastModified: s.lastModified,
    branch: s.gitBranch || null,
    projectId: attached.get(s.sessionId) || null,
    folderProjectId: byCwd.get(s.cwd) || null,
  }));
}

// What happened in an attached Claude Code session before the mainframe took it over:
// the transcript up to the first prompt the mainframe sent, as plain chat items.
const blockText = (content) => (typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '');

const SERVICE_TAGS = 'mainframe-recall|task-notification|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook|tool-use-id|output-file';
function cleanUserText(raw) {
  let t = String(raw || '');
  t = t.replace(new RegExp(`<(${SERVICE_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'g'), '');
  t = t.replace(/<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content>/g, '📋 $1');
  t = t.replace(/^\s*Caveat: The messages below were generated[\s\S]*?\n\n/, '');
  t = t.replace(/<[a-z_-]+\s*\/>/gi, '');
  if (/This session is being continued from a previous conversation/.test(t.slice(0, 800))) return '⋯ контекст сессии сжат, начало ниже не показано';
  t = t.trim();
  if (/^<[a-z_-]+[\s>]/i.test(t) && !/^📋/.test(t)) return '';
  return t;
}

export async function pastMessages(project, limit = 60) {
  if (!project?.session_id) return [];
  let msgs;
  try {
    msgs = await getSessionMessages(project.session_id, { dir: project.cwd });
  } catch {
    msgs = null;
  }
  if (!msgs?.length) msgs = await getSessionMessages(project.session_id).catch(() => []);
  const first = get('SELECT prompt FROM runs WHERE project_id = ? AND session_id = ? ORDER BY id LIMIT 1', project.id, project.session_id)
    || get('SELECT prompt FROM runs WHERE project_id = ? ORDER BY id LIMIT 1', project.id);
  const items = [];
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue; // subagent chatter
    const content = m.message?.content;
    if (m.type === 'user') {
      // Service blocks Claude Code injects as "user" turns: background task notices,
      // reminders, slash-command echoes. Pasted text keeps its content, without the wrapper.
      const text = cleanUserText(blockText(content));
      if (!text) continue;
      if (first?.prompt && text === first.prompt.trim()) break; // the mainframe's own runs start here
      items.push({ role: 'user', text: text.slice(0, 4000) });
    } else if (m.type === 'assistant' && Array.isArray(content)) {
      const text = blockText(content).trim();
      if (text) items.push({ role: 'ai', text: text.slice(0, 6000) });
      for (const b of content.filter((x) => x?.type === 'tool_use')) {
        items.push({ role: 'tool', text: `${String(b.name || '').replace(/^mcp__/, '').replace(/__/g, ' · ')}` });
      }
    }
  }
  // Runs of tool calls collapse into one line.
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (it.role === 'tool' && prev?.role === 'tool') { prev.count = (prev.count || 1) + 1; if (!prev.text.includes(it.text)) prev.text += `, ${it.text}`; continue; }
    out.push({ ...it });
  }
  return { total: out.length, items: out.slice(-limit) };
}
