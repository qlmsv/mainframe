import fs from 'node:fs';
import { memoryPrompt } from './memory.js';
import { recallContext } from './recall.js';
import path from 'node:path';
import net from 'node:net';
import { query, listSessions, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { config, ROOT } from './config.js';
import { all, get, run, now, addLog, kvGet, kvSet, redact } from './db.js';
import { bus } from './bus.js';
import { buildMcpServers, composioConfigured } from './mcp.js';
import { chooseModel, chooseTools, TG_RARE_TOOLS } from './routing.js';
import { sessionEnv, resolveModel, isClaude, mainModel } from './models.js';
import { failureKind, noteLimit, limitUntil, breakerOpen, noteAccessFailure, noteSuccess, whenLabel, checkLimitNow } from './limits.js';
import { workLogTail, workLogBlock } from './worklog.js';
import { bridgesDown } from './bridges.js';
import { deployHooks, consentOf, systemHooks, sysConsent, asksNeedlessly } from './guards.js';
import { pickFinal } from './finalpick.js';

const active = new Map(); // runId -> { abort, projectId, fork, startedAt }
const forks = new Set(); // runIds started beside a busy session (owner's bot messages)
const FORK_AFTER_MS = 30000;
const queues = new Map(); // projectId -> [runId]
const listeners = new Set(); // fn(run) on finish

export const onRunFinished = (fn) => listeners.add(fn);
// The answer to the owner went out while background work (agents) keeps the run going.
const answeredListeners = new Set();
export const onRunAnswered = (fn) => answeredListeners.add(fn);
const EARLY_AFTER_MS = 3000;
export const isPaused = () => kvGet('paused', false);
export const activeRuns = () => [...active.keys()];

const MAINFRAME_PROMPT = `
Ты работаешь внутри личного мейнфрейма владельца (${config.owner.name}). Мейнфрейм это шлюз на Claude Agent SDK.
Тебе доступны MCP-серверы: ${config.tg.enabled ? 'telegram (аккаунт владельца через Telethon), ' : ''}mainframe (уведомить владельца, поставить cron-задачу, список проектов) и те, что подключены в mcp.json (Apple-приложения, управление Mac, браузер).
Пиши по-русски, коротко и по делу. Без длинных тире. Только реальные цифры.
Доводи до конца: владелец хочет результат, а не вопросы.
- Получил задачу: делай все шаги сам, пока она не закончена: правки, тесты, коммит, пуш, выкладка, проверка на живом сайте. Не заканчивай ход планом («сделаю», «пришлю итог») и не спрашивай «продолжать?», «выкладываю?», «сделать?», «коммит и пуш?».
- Есть несколько путей и один ты советуешь: иди по нему сам и напиши в итоге, что выбрал и как откатить. Спрашивай, только если без владельца нельзя сделать ни одного следующего шага (нужен его вход в аккаунт, его файл, выбор по сути: цена, дизайн, кому писать).
- Что-то мешает (нет доступа, упали тесты, Mac не на связи): обойди, почини или сделай всё остальное. Остановись только на этом одном шаге и скажи, что нужно от владельца.
- Короткое «да», «делай», «продолжай», «ну и» значит: сделай всё, что предлагал в прошлом ответе, целиком.
- В конце одна короткая сводка: что сделано, ссылка, как откатить, что осталось за владельцем.
«Да» владельца спрашивай только в пяти случаях, в остальных действуй: 1) письмо или сообщение человеку, если владелец не просил его отправить (попросил «ответь», «отправь»: отправляй и покажи текст в итоге); 2) трата денег: реклама, бюджет, оплаты, сделки; 3) удаление без копии, переписывание истории git, force push; 4) прод Вердикта и репозиторий Миши; 5) публикация в каналах и соцсетях, о которой владелец не просил («опубликуй», «выложи ролики»: публикуй).
Сначала ответ на последнее сообщение владельца. Итоги фоновой работы (агенты и подзадачи, прошлые задачи) не подменяют этот ответ: дай их отдельно и коротко после него.
У тебя есть терминал на Mac владельца: команды выполняй сам, не проси владельца запускать их, кроме тех, что требуют его пароля (sudo) или входа в аккаунт.
Чеки, квитанции и переводы, которые владелец присылает фото или текстом, записывай в его финансы через mainframe add_expense (сумма, валюта, где, категория, дата из чека). Скриншоты банков и бирж с балансом: обнови остаток через mainframe set_balance.
Формат ответа: он приходит владельцу в Telegram rich-сообщением, Markdown рендерит сам Telegram. Первая строка или абзац: суть, коротко. Сравнения таблицей. Статусы чек-листом: «- [x] сделано», «- [ ] осталось». Главное выделяй жирным (жёлтое ==выделение== не используй: в тёмной теме его не видно). Длинные подробности прячь в <details><summary>Подробнее</summary> ... </details> (пустая строка после summary и перед </details>). Дату и время встречи пиши так: ![17 ноября, 14:00](tg://time?unix=<unix>&format=wDT), чтобы каждый видел своё время.
Кнопки: только когда нужен настоящий выбор владельца или одно из пяти «да» выше. Для шага, который ты можешь сделать сам, кнопку не ставь, а сделай шаг; кнопок «Да, выкладывай», «Продолжай», «Сделай всё» не бывает. Тогда последней строкой напиши [[кнопки: Вариант 1 | Вариант 2 | Вариант 3]] (до 4 коротких вариантов, первый рекомендуемый; нажатие пришлёт этот текст тебе как ответ). Для ссылки или текста, который удобно скопировать: отдельной строкой [[копировать: Подпись | текст]]. Сам вопрос оставь в тексте. Если сообщение владельца не требует ответа текстом (принял к сведению, «ок», короткое указание, которое ты просто выполнил или запомнил), ответ целиком одной строкой [[реакция: 👌]]: в чат уйдёт только реакция на его сообщение (можно 👍 ❤ 🔥 🤝 ✍).
Входящие: на «не показывай / тихо / пакетом / срочно про X» сначала mainframe inbox_rule_preview, покажи владельцу, сколько и что отсеется за 7 дней (с примерами), и сохраняй inbox_rule_add только после его «да». Список и удаление: inbox_rule_list, inbox_rule_delete.
Кнопки меню бота: на «поменяй кнопки / добавь кнопку / убери кнопку» посмотри mainframe quick_buttons_list и сохрани полный новый список через quick_buttons_set (без лишних вопросов, если понятно, что нужно).
Память и история: если не уверен, что помнишь договорённость, цифру или решение, сначала mainframe recall, потом отвечай, не угадывай. Новый факт, который отменяет старый (цена, решение, срок), сохраняй через memory_save с replaces: [старая заметка] или исправь старую заметку. «запомни…» от владельца сохраняй сразу через mainframe memory_save и отвечай одной строкой, что запомнил; «забудь…» через memory_delete; «что ты помнишь про X» и вопросы о прошлом («что решили», «что писал», «когда обсуждали») сначала ищи через mainframe recall (история всех сессий, входящих, почты и переписки в Telegram), потом отвечай с датами.
Фоновые задачи (по расписанию, из пульта, из другой сессии): этапы и «готово» через notify_owner не шли, владелец получит одно сообщение с итогом задачи, когда она закончится. notify_owner с urgent: true только когда нужно решение владельца прямо сейчас или сломалось важное. Если у задачи по расписанию нет новостей для владельца (всё как обычно, ничего не случилось), последней строкой ответа напиши [[тихо]]: итог останется в пульте, в чат не придёт.
Долгая работа в чате с владельцем (его сообщение из бота): если задача займёт больше 2-3 минут (правки кода, выкладка, проверка сайта, поиск, много шагов), не держи владельца. Отдай её фоновому агенту (Agent с run_in_background: true; задание целиком, агент не видит разговор) и сразу ответь одной строкой, что взял. Задание агенту давай целиком, с разрешением выкладывать. Перед тем как закончить ход, убедись, что агент действительно запущен: ответ «взял» без запущенной работы запрещён. Этот ответ уйдёт владельцу сразу, а когда агент закончит, проверь результат (на живом сайте, если выкладывал) и перескажи итог коротко: он придёт отдельным сообщением. Агент остановился на полпути (лимит, обрыв связи): запусти его снова сам, владельца не жди. Работу, отданную агенту или другому проекту, сам не повторяй. Вопросы, уточнения и дела на минуту делай сразу, без фона.
Передать задачу другому проекту мейнфрейма (там нужная папка, сессия или коннекторы, например Metricool в проекте соцсетей): mainframe start_run {project_id, prompt} (id через list_projects), итог через run_status {run_id, wait_sec}. Из чата с владельцем ставь долгую задачу с quiet: false (проект сам пришлёт итог владельцу) и не жди её через run_status. Локальный API пульта для этого не вызывай.
Реестр «что сделано» приходит перед сообщением блоком <mainframe-worklog>. Получил результат (коммит, ветка, выкладка, пост, документ) или сменился статус (на проверке, выложено): mainframe work_log_add или work_log_update, коротко.
Выкладка: скрипты выкладки начинай с set -euo pipefail и не строй цепочки a && b под set -e (сбой внутри цепочки не останавливает скрипт). Сайты и боты владельца (aipm, kurs, кабинет, everydayagent.app, kai-it.pro), коммит и пуш в его репозитории: выкладывай сам после зелёных тестов в этой же задаче, владельца не спрашивай (тестов в проекте нет: проверь сборку). Выкладывай только свою правку: перед пушем посмотри, что ещё лежит в ветке; чужие изменения есть, выложи свою правку отдельной веткой от main. Прод Вердикта и переписывание истории git только после прямого «да» владельца: мейнфрейм иначе не пропустит команду.
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
  'mcp__mainframe__start_run',
  // Read only: someone else's text must not reach the terminal, files, the scheduler or a write in Composio.
  'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'KillShell', 'Task', 'Agent',
  'mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', 'mcp__composio__COMPOSIO_PROXY_EXECUTE', 'mcp__composio__COMPOSIO_REMOTE_BASH_TOOL',
  'mcp__composio__COMPOSIO_REMOTE_WORKBENCH', 'mcp__composio__COMPOSIO_MANAGE_CONNECTIONS', 'mcp__composio__COMPOSIO_MANAGE_SKILL',
  'mcp__composio__COMPOSIO_USE_SKILL', 'mcp__composio__COMPOSIO_SUBMIT_FEEDBACK',
  'mcp__mainframe__restart_mainframe', 'mcp__mainframe__memory_delete', 'mcp__mainframe__inbox_rule_add', 'mcp__mainframe__inbox_rule_delete',
  'mcp__mainframe__add_expense', 'mcp__mainframe__set_balance', 'mcp__mainframe__linkedin_post', 'mcp__mainframe__content_mark',
];
export { INBOX_BLOCKED };

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

function baseOptions({ cwd, abortController, runId, tools = { mac: true, connectors: true }, guard = null }) {
  const deploy = guard ? deployHooks(guard, (t) => addEvent(runId, 'system', t), cwd) : {};
  const sys = guard ? systemHooks(guard, cwd, (t) => addEvent(runId, 'system', t)) : null;
  // Bridges known to be down are left out: the session hears it in one line instead of failing tools.
  const skip = tools.mac && config.bridges.skipDown ? bridgesDown() : [];
  const options = {
    cwd,
    abortController,
    mcpServers: buildMcpServers({ mac: tools.mac, connectors: tools.connectors, telegram: tools.telegram !== false, composio: tools.composio !== false, runId, skip }),
    settingSources: ['user', 'project', 'local'],
    // Shared memory is read at every run start, so a note saved in one project reaches the next run anywhere.
    systemPrompt: { type: 'preset', preset: 'claude_code', append: `${MAINFRAME_PROMPT}\n${memoryPrompt()}` },
    permissionMode: config.permissionMode,
    hooks: {
      PostToolUse: [{
        hooks: [async (input) => {
          addLog('tool', `${input.tool_name}: ${briefInput(input.tool_name, input.tool_input)}`, runId);
          if (deploy.post) await deploy.post(input);
          return {};
        }],
      }],
      // Releases: git push to main, vercel --prod... only after tests and the owner's «да» (src/guards.js).
      // System commands (sudo, rm -rf outside the project, /etc, systemctl, firewall): only with the owner's word.
      ...(deploy.pre || sys ? { PreToolUse: [{ matcher: 'Bash', hooks: [...(deploy.pre ? [deploy.pre] : []), ...(sys ? [sys] : [])] }] } : {}),
    },
    stderr: (d) => {
      if (AUTH_RE.test(d)) setAuthError(d);
    },
  };
  if (config.permissionMode === 'bypassPermissions') options.allowDangerouslySkipPermissions = true;
  // MCP_DENY: servers never to connect (a dead claude.ai connector failing every session start).
  if (config.mcpDeny.length) options.managedSettings = { deniedMcpServers: config.mcpDeny.map((serverName) => ({ serverName })) };
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
export function startRun({ projectId, prompt, origin = 'ui', inboxId = null, parentRunId = null }) {
  const project = get('SELECT * FROM projects WHERE id = ?', projectId);
  if (!project) throw new Error('Проект не найден');
  if (!prompt || !prompt.trim()) throw new Error('Пустое сообщение');
  const res = run(
    'INSERT INTO runs (project_id, session_id, prompt, origin, status, inbox_id, started_at, parent_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    projectId, project.session_id, prompt.trim(), origin, 'queued', inboxId, now(), parentRunId,
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
  if (main) return main.answered || Date.now() - main.startedAt > FORK_AFTER_MS;
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
  const clean = (t) => String(t || '').replace(/<mainframe-(recall|worklog|status)>[\s\S]*?<\/mainframe-\1>/g, '').replace(/\s+/g, ' ').trim();
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
  const work = config.workLog.inject ? workLogTail({ max: 1000 }) : '';
  return `<handoff>\nЭто новая сессия этого чата: прошлая закрыта (${project.name}). Передача дел из неё, это контекст, а не новое задание. Если владелец отвечает кнопкой или коротким «да», ориентируйся на «Ждём ответа» и последние обмены. Дословно любой обмен открывается через mainframe recall_open по ref.\n${summary ? `${summary}\n` : ''}${buttons ? `Последний ответ предлагал кнопки: ${buttons}\n` : ''}Последние обмены:\n${lastLines}${refs ? `\nРаньше в этой сессии: ${refs}` : ''}${work ? `\nРеестр «что сделано»:\n${work}` : ''}\n</handoff>\n\n`;
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

// Spend: the SDK reports running totals of the whole conversation (a resumed or copied conversation
// starts from what its transcript saved). A run's own share is the difference with the totals the
// previous run of the same conversation ended with.
function usageTotals(m) {
  const t = { in: 0, out: 0, cr: 0, cw: 0 };
  for (const u of Object.values(m.modelUsage || {})) {
    t.in += u.inputTokens || 0; t.out += u.outputTokens || 0; t.cr += u.cacheReadInputTokens || 0; t.cw += u.cacheCreationInputTokens || 0;
  }
  return t;
}
function usageBase(projectId, sessionId, runId) {
  if (!sessionId) return { cost: 0, usage: { in: 0, out: 0, cr: 0, cw: 0 }, known: true };
  const prev = get('SELECT cost_total, usage_total FROM runs WHERE session_id = ? AND id < ? AND cost_total IS NOT NULL ORDER BY id DESC LIMIT 1', sessionId, runId);
  let usage = { in: 0, out: 0, cr: 0, cw: 0 };
  try { if (prev?.usage_total) usage = { ...usage, ...JSON.parse(prev.usage_total) }; } catch { /* old row */ }
  // A conversation from before token accounting: its totals are unknown, this run's tokens too.
  return { cost: prev?.cost_total || 0, usage, known: !prev || Boolean(prev.usage_total) };
}
const minus = (a, b) => (a >= b ? a - b : a); // a reset (/clear, a crash) starts the totals again

// ---------- the subscription's limit: runs wait for the reset (deferred_runs, survives a restart) ----------
// Work that goes on by itself (25.11.2026: the owner wants long tasks finished without «продолжай»).
const BG_RESUME = '(Фоновая работа по этой задаче оборвалась после твоего ответа. Проверь, что уже сделано, и доделай до конца. Владельцу напиши только итог.)';
const AUTO_GO = '(Автопродолжение. Владелец заранее разрешил делать до конца и не ждать его «да». Не спрашивай: сделай то, что предложил в прошлом ответе (рекомендуемый вариант), целиком: тесты, коммит, пуш, выкладка своих сайтов, проверка. В итоге коротко: что сделано и как откатить.)';
const CONTINUE = '(Лимит подписки Claude сбросился. Продолжи эту задачу с того места, где остановился, сделанное не повторяй.)';
function deferRun(r, { reason, until, started }) {
  const prompt = started && !String(r.prompt).startsWith(CONTINUE) ? `${CONTINUE}\n\n${r.prompt}` : r.prompt;
  run('INSERT INTO deferred_runs (run_id, project_id, origin, inbox_id, prompt, reason, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    r.id, r.project_id, r.origin, r.inbox_id, prompt, reason, until || 0, now());
}
// Every 30 s: limit runs whose reset came, access runs once the breaker closed.
let deferredTimer = null;
export function startDeferred() {
  if (deferredTimer) return;
  const tick = () => {
    if (isPaused()) return;
    for (const d of all("SELECT * FROM deferred_runs WHERE status = 'waiting' ORDER BY id")) {
      const ready = d.reason === 'limit' ? Date.now() >= d.due_at && !limitUntil() : !breakerOpen();
      if (!ready) continue;
      try {
        if (!get('SELECT id FROM projects WHERE id = ?', d.project_id)) { run("UPDATE deferred_runs SET status = 'dropped' WHERE id = ?", d.id); continue; }
        const id = startRun({ projectId: d.project_id, prompt: d.prompt, origin: d.origin, inboxId: d.inbox_id });
        run("UPDATE deferred_runs SET status = 'started', new_run_id = ? WHERE id = ?", id, d.id);
        if (d.inbox_id) run('UPDATE inbox SET run_id = ? WHERE id = ?', id, d.inbox_id);
        addLog('run', `Отложенная задача №${d.run_id} продолжена как №${id}`, id);
      } catch (e) { addLog('error', `Отложенная задача №${d.run_id}: ${e.message}`); }
    }
  };
  deferredTimer = setInterval(tick, 30000);
  deferredTimer.unref();
  setTimeout(tick, 5000).unref();
}

// One line about what is down, in front of a run that needs the Mac.
function statusNote(tools) {
  const lines = [];
  if (tools.mac) {
    const down = bridgesDown();
    if (down.length) lines.push(`Сейчас недоступно на Mac: ${down.join(', ')} (мост не отвечает). Если задача требует их, сразу скажи владельцу об этом, не жди и не повторяй вызовы.`);
  }
  return lines.length ? `<mainframe-status>\n${lines.join('\n')}\n</mainframe-status>\n\n` : '';
}

async function execute(runId, { fork = false } = {}) {
  const r = get('SELECT * FROM runs WHERE id = ?', runId);
  if (!r || r.status !== 'queued') return;
  const project = get('SELECT * FROM projects WHERE id = ?', r.project_id);
  if (!project) {
    run("UPDATE runs SET status = 'error', result = 'Проект удалён', finished_at = ? WHERE id = ?", now(), runId);
    bus.change('run', runId);
    return;
  }
  // The subscription is at its limit, or broken (payment, login): don't spend a call that will fail.
  const live = LIVE.has(r.origin);
  // Kai writes himself: check the subscription for real, the limit may already be reset.
  if (live && limitUntil()) await checkLimitNow();
  const until = config.limitResume ? limitUntil() : 0;
  if (until || (breakerOpen() && !live)) {
    const reason = until ? 'limit' : 'access';
    if (reason === 'access' && r.origin === 'cron') {
      // A scheduled task comes again by its schedule: skip this one instead of piling them up.
      return finishWithout(r, project, 'stopped', 'Пропущено: подписка Claude не работает (оплата или вход), фоновые задачи на паузе.\n[[тихо]]');
    }
    deferRun(r, { reason, until, started: false });
    const line = reason === 'limit'
      ? `Лимит подписки Claude до ${whenLabel(until)}: выполню это сразу после сброса.${live ? '' : '\n[[тихо]]'}`
      : 'Подписка Claude не работает (оплата или вход): задача ждёт восстановления и запустится сама.\n[[тихо]]';
    return finishWithout(r, project, 'deferred', line);
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
  const tools = chooseTools({ prompt: r.prompt, recent, projectId: project.id, origin: r.origin, composioOn: composioConfigured() });
  // A resumed (or forked) session keeps the model its last run used: switching loses the cache.
  const resume = Boolean(project.session_id);
  const lastModel = resume ? get('SELECT model FROM runs WHERE project_id = ? AND session_id = ? AND model IS NOT NULL AND id < ? ORDER BY id DESC LIMIT 1', project.id, project.session_id, runId)?.model : null;
  const pick = chooseModel({ prompt: r.prompt, origin: r.origin, resume, lastModel });
  // The last exchange of this chat: a short «да» is read together with what it answers.
  const prev = get("SELECT prompt, result FROM runs WHERE project_id = ? AND id < ? AND status = 'done' ORDER BY id DESC LIMIT 1", project.id, runId);
  const guard = { consent: consentOf({ prompt: r.prompt, origin: r.origin, prevResult: prev?.result || '' }), testsPassed: false, warnings: [], origin: r.origin, sysOk: sysConsent({ prompt: r.prompt, origin: r.origin }) };
  const options = baseOptions({ cwd: project.cwd, abortController, runId, tools, guard });
  if (pick.model) options.model = pick.model;
  run('UPDATE runs SET model = ? WHERE id = ?', options.model || null, runId);
  addEvent(runId, 'system', `Модель: ${modelName(options.model)} (${pick.why}) · инструменты: ${tools.why}`);
  if (onMac) options.pathToClaudeCodeExecutable = config.macRunner;
  if (project.session_id) options.resume = project.session_id;
  // A fork copies the conversation into a new session; the project keeps its main session.
  if (fork && project.session_id) options.forkSession = true;
  // Work started by someone else's Telegram message: their text is untrusted, so the session
  // cannot message anyone, send mail or schedule itself. Replies go through the owner.
  const deny = [...(r.origin === 'inbox' ? INBOX_BLOCKED : []), ...(tools.telegram !== false && !tools.tgRare ? TG_RARE_TOOLS : [])];
  if (deny.length) options.disallowedTools = deny;

  let status = 'error';
  let result = '';
  let sessionId = project.session_id;
  let lastCtx = 0;
  let final = null; // the result message of the first turn: the answer to the owner's message
  const later = []; // results of turns that background work (agents, subtasks) started afterwards
  let limitReset = null;
  let afterAnswerError = null; // background work failed after the answer went out
  let lastUsage = null; // the last result message: running totals of spend
  let earlyTimer = null; // sends the answer early when background work keeps the run going
  const base = usageBase(project.id, project.session_id, runId);
  try {
    if (!path.isAbsolute(project.cwd || '')) throw new Error(`Папка проекта должна быть полным путём, сейчас: «${project.cwd || ''}»`);
    if (!fs.existsSync(project.cwd)) fs.mkdirSync(project.cwd, { recursive: true });
    // Related notes and history go in front of the message (not into the system prompt, which
    // would break the prompt cache of the whole conversation). Other people's work is skipped.
    let prompt = r.prompt;
    if (fork && !project.session_id) prompt = `${recentSummary(project.id, runId)}${prompt}`;
    if (r.origin !== 'inbox') {
      const ctx = await recallContext(r.prompt, { project: project.name, context: prev ? `${prev.prompt}\n${prev.result}` : '' }).catch(() => '');
      if (ctx) { prompt = `${ctx}${prompt}`; addEvent(runId, 'system', `Подсказки из памяти: ${(ctx.match(/^- /gm) || []).length}`); }
      // The work register: sent when the conversation has not seen this version of it yet.
      if (config.workLog.inject) {
        const tail = workLogTail();
        const seen = kvGet('worklog_seen', {});
        const key = project.session_id || `new:${runId}`;
        if (tail && (handoff || seen[key] !== tail.length + tail.slice(0, 200))) {
          if (!handoff) prompt = `${workLogBlock(tail)}${prompt}`;
          if (project.session_id) { seen[key] = tail.length + tail.slice(0, 200); const ks = Object.keys(seen); for (const k of ks.slice(0, Math.max(0, ks.length - 200))) delete seen[k]; kvSet('worklog_seen', seen); }
        }
      }
    }
    prompt = `${statusNote(tools)}${prompt}`;
    if (handoff) prompt = `${handoff}${prompt}`;
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
      } else if (m.type === 'rate_limit_event' && m.rate_limit_info?.status === 'rejected' && m.rate_limit_info.resetsAt) {
        const t = Number(m.rate_limit_info.resetsAt);
        limitReset = t < 1e12 ? t * 1000 : t;
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
        // A background agent finishing after the answer starts another turn with its own result:
        // the answer to the owner stays the first one, the later ones are reported separately.
        // An empty first result is replaced by the first non-empty one (src/finalpick.js).
        const picked = pickFinal(final, m);
        final = picked.final;
        if (picked.report) { later.push(picked.report); addEvent(runId, 'bg_report', picked.report); }
        // The owner's message is answered but the run goes on (a background agent): the answer
        // goes out now instead of after all the background work.
        if (live && !fork && !earlyTimer && final.subtype === 'success' && !final.is_error && String(final.result || '').trim()) {
          const answer = final.result;
          earlyTimer = setTimeout(() => {
            const a = active.get(runId);
            if (a) a.answered = true;
            addEvent(runId, 'system', 'Ответ отправлен, фоновая работа продолжается');
            const row = get('SELECT * FROM runs WHERE id = ?', runId);
            for (const fn of answeredListeners) Promise.resolve().then(() => fn({ ...row, status: 'done', result: answer, finished_at: now() }, project)).catch((e) => addLog('error', `onRunAnswered: ${e.message}`));
          }, EARLY_AFTER_MS);
        }
        // Spend counts every turn: the last result carries the running total.
        lastUsage = m;
      }
    }
    if (final) {
      result = final.subtype === 'success' ? (final.result || '') : `Ошибка: ${final.subtype}`;
      status = final.subtype === 'success' && !final.is_error ? 'done' : 'error';
      if (final.is_error && final.result) result = final.result;
    }
  } catch (e) {
    if (abortController.signal.aborted) {
      status = 'stopped';
      result = 'Остановлено';
    } else if (final && final.subtype === 'success' && !final.is_error) {
      // The answer was already given; only the background work after it failed.
      status = 'done';
      result = final.result || '';
      addEvent(runId, 'error', `После ответа: ${e.message}`);
      afterAnswerError = e.message;
    } else {
      status = 'error';
      result = e.message;
    }
  } finally {
    if (earlyTimer) clearTimeout(earlyTimer);
    active.delete(runId);
    if (lastCtx && sessionId) saveCtxTokens(sessionId, lastCtx);
  }
  const spend = lastUsage ? (() => {
    const tot = usageTotals(lastUsage);
    const costTotal = lastUsage.total_cost_usd ?? null;
    return {
      costTotal, cost: costTotal == null ? null : Math.round(minus(costTotal, base.cost) * 10000) / 10000,
      tot, own: base.known ? { in: minus(tot.in, base.usage.in), out: minus(tot.out, base.usage.out), cr: minus(tot.cr, base.usage.cr), cw: minus(tot.cw, base.usage.cw) } : {},
    };
  })() : null;

  // The subscription: limit (wait for the reset, continue by itself), payment or login (the breaker).
  const kind = status === 'error' ? failureKind(result) : null;
  if (status === 'done') noteSuccess();
  if (kind === 'access') {
    setAuthError(result);
    noteAccessFailure(result);
    result = `Подписка Claude не работает: оплата или вход (${result.replace(/^Claude Code returned an error result:\s*/i, '').slice(0, 160)}). Проверь claude.ai/settings/billing. Как заработает, задачи по расписанию продолжатся сами.`;
  } else if (kind === 'limit' && config.limitResume) {
    const { until: at, first } = noteLimit(result, limitReset);
    deferRun(r, { reason: 'limit', until: at, started: true });
    // One line to the owner, once per limit; the rest wait quietly.
    result = `Упёрся в лимит подписки, продолжу в ${whenLabel(at)}.${first || live ? '' : '\n[[тихо]]'}`;
    status = 'deferred';
  } else if (status === 'error' && AUTH_RE.test(result)) setAuthError(result);
  else if (status === 'done') setAuthError(null);

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

  // Background work cut off after the answer went out (limit, the Mac link, a crash): it goes on
  // without the owner, once. A limit waits for the reset like any other run.
  if (afterAnswerError && !String(r.prompt).startsWith(BG_RESUME) && !String(r.prompt).startsWith(CONTINUE)) {
    const again = { ...r, prompt: `${BG_RESUME}\n\n${r.prompt}` };
    const why = failureKind(afterAnswerError);
    if (why === 'limit' && config.limitResume) {
      const { until: at } = noteLimit(afterAnswerError, limitReset);
      deferRun(again, { reason: 'limit', until: at, started: false });
      addLog('run', `[${project.name}] фоновая работа упёрлась в лимит после ответа, продолжу в ${whenLabel(at)}`, runId);
    } else if (why !== 'access') {
      addLog('run', `[${project.name}] фоновая работа оборвалась после ответа, продолжаю сам`, runId);
      setTimeout(() => { try { startRun({ projectId: project.id, origin: r.origin, inboxId: r.inbox_id, prompt: again.prompt }); } catch (e) { addLog('error', `Продолжение фоновой работы: ${e.message}`); } }, 30000);
    }
  }

  // The answer ends asking for a «да» the owner gave in advance («выкладываю?», «сделать?», a first
  // button «Да, …»): it goes on by itself, once in a row. People, money, deletion and git history,
  // the Verdict prod and unrequested posts still wait (guards.js asksNeedlessly). The continuation
  // runs as 'system': not the owner's own words, so it cannot release the Verdict prod.
  const autoGo = status === 'done' && !fork && ['bot', 'ui', 'system'].includes(r.origin) && config.autoContinue
    && !String(r.prompt).startsWith(AUTO_GO) && !(config.deployAsk && config.deployAsk.test(String(project.cwd || '')))
    && asksNeedlessly(result);
  if (autoGo) {
    result = appendLine(result.split('\n').filter((l) => !/^\s*\[\[кнопки:/i.test(l)).join('\n'), '_Не жду ответа, продолжаю сам._');
    addEvent(runId, 'system', 'Автопродолжение: ответ кончился вопросом, на который владелец уже ответил «да»');
    setTimeout(() => { try { startRun({ projectId: project.id, origin: 'system', prompt: AUTO_GO, parentRunId: runId }); } catch (e) { addLog('error', `Автопродолжение: ${e.message}`); } }, 1500);
  }

  // A resumed session that no longer exists on disk: forget it so the next message starts fresh.
  if (status === 'error' && project.session_id && /No conversation found|session.*not found/i.test(result)) {
    run('UPDATE projects SET session_id = NULL WHERE id = ?', project.id);
    result += '\nСессия не найдена на диске. Следующее сообщение начнёт новую.';
  }
  if (guard.warnings.length) result += `\n\n⚠️ ${[...new Set(guard.warnings)].join(' ')}`;
  // The conversation is big and automatic rotation is off: suggest /new once per conversation.
  if (status === 'done' && live && !fork && config.sessionSoftTokens > 0 && sessionId && lastCtx > config.sessionSoftTokens) {
    const hinted = kvGet('session_soft_hinted', {});
    if (!hinted[sessionId]) {
      hinted[sessionId] = Date.now();
      const ks = Object.keys(hinted); for (const k of ks.slice(0, Math.max(0, ks.length - 200))) delete hinted[k];
      kvSet('session_soft_hinted', hinted);
      result = appendLine(result, `_Разговор большой (≈${Math.round(lastCtx / 1000)} тыс.), напиши /new: начну новый с передачей дел._`);
    }
  }
  const lastText = get("SELECT content FROM run_events WHERE run_id = ? AND kind = 'text' ORDER BY id DESC LIMIT 1", runId)?.content || '';
  if (status === 'error' && (!lastText || !result.includes(lastText.slice(0, 60)))) addEvent(runId, 'error', result);
  run(`UPDATE runs SET status = ?, result = ?, cost = ?, cost_total = ?, usage_total = ?, tokens_in = ?, tokens_out = ?, tokens_cache_read = ?, tokens_cache_write = ?, ctx_tokens = ?, finished_at = ? WHERE id = ?`,
    status, redact(result), spend?.cost ?? null, spend?.costTotal ?? null, spend ? JSON.stringify(spend.tot) : null,
    spend?.own.in ?? null, spend?.own.out ?? null, spend?.own.cr ?? null, spend?.own.cw ?? null, lastCtx || null, now(), runId);
  addLog('run', `[${project.name}] ${status === 'done' ? 'готово' : status}: ${result.slice(0, 200)}`, runId);
  if (later.length) addLog('run', `[${project.name}] отчёты фоновой работы после ответа: ${later.length}`, runId);
  bus.change('run', runId);
  const finished = get('SELECT * FROM runs WHERE id = ?', runId);
  // Notifications and reply drafts run in the background: the next queued run starts now.
  for (const fn of listeners) {
    Promise.resolve().then(() => fn(finished, project)).catch((e) => addLog('error', `onRunFinished: ${e.message}`));
  }
}
// A line at the end of an answer, above its button lines ([[...]]), so the buttons stay last.
function appendLine(text, line) {
  const lines = String(text || '').split('\n');
  let i = lines.length;
  while (i > 0 && /^\s*(\[\[.*\]\])?\s*$/.test(lines[i - 1])) i--;
  return [...lines.slice(0, i), '', line, ...lines.slice(i)].join('\n');
}

// A run that ends without calling the model (deferred, skipped): same bookkeeping as a normal finish.
function finishWithout(r, project, status, result) {
  run('UPDATE runs SET status = ?, result = ?, finished_at = ? WHERE id = ?', status, result, now(), r.id);
  addLog('run', `[${project.name}] ${status}: ${result.split('\n')[0].slice(0, 200)}`, r.id);
  bus.change('run', r.id);
  const finished = get('SELECT * FROM runs WHERE id = ?', r.id);
  for (const fn of listeners) Promise.resolve().then(() => fn(finished, project)).catch((e) => addLog('error', `onRunFinished: ${e.message}`));
}

export function stopRun(runId) {
  // A run waiting for the subscription limit: its continuation is dropped.
  if (run("UPDATE deferred_runs SET status = 'dropped' WHERE run_id = ? AND status = 'waiting'", Number(runId)).changes) {
    run("UPDATE runs SET status = 'stopped' WHERE id = ? AND status = 'deferred'", Number(runId));
    bus.change('run', Number(runId));
    return true;
  }
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
  run("UPDATE deferred_runs SET status = 'dropped' WHERE status = 'waiting'");
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
  // The subscription is down or at its limit: fail at once instead of a call that cannot work.
  if (breakerOpen()) throw new Error('Claude недоступен (оплата или вход): жду восстановления');
  if (limitUntil()) throw new Error(`Лимит подписки Claude до ${whenLabel(limitUntil())}`);
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
    const kind = failureKind(err);
    if (kind === 'access') noteAccessFailure(err);
    else if (kind === 'limit') noteLimit(err);
    if (err && AUTH_RE.test(err)) setAuthError(err);
    throw new Error(err || 'Пустой ответ');
  }
  setAuthError(null);
  noteSuccess();
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

const SERVICE_TAGS = 'mainframe-recall|mainframe-worklog|mainframe-status|handoff|task-notification|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook|tool-use-id|output-file';
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
