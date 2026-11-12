import { Bot, InlineKeyboard, API_CONSTANTS } from 'grammy';
import * as widgets from './widgets.js';
import { config } from './config.js';
import { all, get, run, now, kvGet, kvSet, addLog } from './db.js';
import { bus } from './bus.js';
import { startRun, stopAll, resumeAll, stopRun, onRunFinished, addEvent } from './agent.js';
import { onInboxUpdate, forwardItem, replyItem, ignoreItem, getItem } from './dispatcher.js';
import { fireTask, updateTask } from './scheduler.js';
import { alertsDigest } from './alerts.js';
import { setMainframeHandlers } from './mcp.js';
import { transcribeAudio, voiceEnabled } from './voice.js';
import { setMailApprover, decideSend } from './mailbox.js';
import * as chatsetup from './chatsetup.js';
import { saveUpload, withAttachments } from './uploads.js';
import { completeReminder } from './apple.js';
import { refreshReport } from './social.js';
import { contentCallback, todayPosts } from './content.js';
import { modelState, saveModelSettings } from './models.js';
import { listMemory, listPending, approvePending, rejectPending, markAnnounced, announced } from './memory.js';
import {
  activityOf, esc, body, answer, tgTime, dur, tok, untok, MENU, menuFor, mainKeyboard, currentProject,
  homeScreen, inboxCard, screen, projectScreen, progressText,
} from './botui.js';

export const botState = { status: 'off', username: null, error: null };
let bot = null;

export const ownerId = () => config.ownerTgId || kvGet('owner_tg_id', null);
const cut = (s, n = 3800) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');
const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
const EFFECT_DONE = '5046509860389126442'; // 🎉

// Bot message -> what replying to it should do. Old links are pruned after 30 days.
function remember(msg, { inboxId = null, projectId = null }) {
  if (!msg?.message_id) return;
  run('INSERT OR REPLACE INTO bot_msgs (message_id, inbox_id, project_id, created_at) VALUES (?, ?, ?, ?)', msg.message_id, inboxId, projectId, now());
  run('DELETE FROM bot_msgs WHERE created_at < ?', now() - 30 * 86400000);
}

// A network blip or a short flood wait should not lose a message: retry 3 times (2, 5, 15 s)
// or after the wait Telegram asks for, up to 2 minutes.
async function withRetry(fn) {
  const waits = [2000, 5000, 15000];
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const ra = Number(e.parameters?.retry_after || e.message.match(/retry after (\d+)/)?.[1] || 0);
      const net = /Network request|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|socket hang up/i.test(e.message);
      if (i >= waits.length || (!net && !ra) || ra > 120) throw e;
      await new Promise((r) => setTimeout(r, ra ? ra * 1000 + 500 : waits[i]));
    }
  }
}

// HTML first; if Telegram rejects the markup (or the effect), send it again plainly.
async function send(chatId, html, extra = {}) {
  try {
    return await withRetry(() => bot.api.sendMessage(chatId, html, { ...HTML, ...extra }));
  } catch (e) {
    if (extra.message_effect_id && /effect/i.test(e.message)) {
      const { message_effect_id, ...rest } = extra;
      return send(chatId, html, rest);
    }
    if (/parse entities|can't parse|unsupported start tag|Unexpected end tag/i.test(e.message)) {
      const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return bot.api.sendMessage(chatId, cut(plain), { ...extra, parse_mode: undefined, message_effect_id: undefined });
    }
    throw e;
  }
}

export async function sendOwner(html, extra = {}) {
  // The owner's channel can be MAX instead of Telegram (src/max.js).
  if (config.channel === 'max') { const { maxSendOwner } = await import('./max.js'); return maxSendOwner(html, extra); }
  const id = ownerId();
  if (!bot || !id) throw new Error('Бот не подключён или владелец не привязан');
  return send(id, html, extra);
}

async function edit(ctx, { text, kb }) {
  try {
    await ctx.editMessageText(text, { ...HTML, reply_markup: kb });
  } catch (e) {
    if (/message is not modified/i.test(e.message)) return;
    if (/can't be edited|message to edit not found/i.test(e.message)) { await ctx.reply(text, { ...HTML, reply_markup: kb }); return; }
    throw e;
  }
}

export async function updateMenuButton() {
  const id = ownerId();
  const url = config.publicUrl;
  if (!bot || !id || !url?.startsWith('https://')) return;
  try {
    await bot.api.setChatMenuButton({ chat_id: Number(id), menu_button: { type: 'web_app', text: 'Пульт', web_app: { url } } });
  } catch (e) {
    addLog('error', `Кнопка Mini App: ${e.message}`);
  }
}

// The reply keyboard carries the input placeholder, so it is re-sent when the target changes.
async function sendMenu(chatId, note) {
  const p = currentProject();
  await bot.api.sendMessage(chatId, note || `🎯 Команды идут в <b>${esc(p.name)}</b>`, { ...HTML, reply_markup: mainKeyboard(p) });
}

async function showScreen(ctx, name, arg) {
  const s = await screen(name, arg);
  return ctx.reply(s.text, { ...HTML, reply_markup: s.kb });
}

// ---------- live progress of runs started from the bot ----------
const live = new Map(); // runId -> { chatId, userMsgId, draft: bool, timer, last }

async function react(chatId, msgId, emoji) {
  if (!msgId) return;
  try { await bot.api.setMessageReaction(chatId, msgId, [{ type: 'emoji', emoji }]); } catch { /* reactions are cosmetic */ }
}

// Live status of a run: one ordinary message, edited in place, deleted when the result comes.
// (Telegram's message drafts made the iPhone app lift the chat and leave an empty area.)
async function pushDraft(runId) {
  const t = live.get(runId);
  if (!t || t.done || !t.msgId || Date.now() < (t.pauseUntil || 0)) return;
  const r = get('SELECT * FROM runs WHERE id = ?', runId);
  if (t.widget) {
    // The widget runs its own clock: edit it only when the step or the words change.
    if (!r || !['running', 'queued'].includes(r.status)) return;
    const ev = all("SELECT kind, content FROM run_events WHERE run_id = ? AND kind IN ('tool','text','error') ORDER BY id DESC LIMIT 8", runId).reverse();
    const [e, w] = activityOf(ev);
    const lastText = [...ev].reverse().find((x) => x.kind === 'text')?.content || '';
    const state = { ...t.state, e, w, n: get("SELECT COUNT(*) c FROM run_events WHERE run_id = ? AND kind = 'tool'", runId).c, l: String(lastText).replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').slice(0, 90) };
    const key = JSON.stringify(state);
    if (key === t.lastText) return;
    t.lastText = key; t.state = state;
    t.inflight = widgets.editProgress(Number(t.chatId), t.msgId, state).then(() => { t.last = Date.now(); }).catch((err) => {
      if (/not found|MESSAGE_ID_INVALID/i.test(err.message)) t.msgId = null;
      const wait = Number(err.parameters?.retry_after || 0); if (wait) t.pauseUntil = Date.now() + wait * 1000;
    }).finally(() => { t.inflight = null; });
    return t.inflight;
  }
  if (!r || !['running', 'queued'].includes(r.status)) return;
  const p = get('SELECT * FROM projects WHERE id = ?', r.project_id);
  const events = all("SELECT kind, content FROM run_events WHERE run_id = ? AND kind IN ('tool','text','error') ORDER BY id DESC LIMIT 5", runId).reverse();
  const steps = get("SELECT COUNT(*) c FROM run_events WHERE run_id = ? AND kind = 'tool'", runId).c;
  t.tick = (t.tick || 0) + 1;
  const text = progressText(p, r, events, steps, t.tick);
  if (text === t.lastText) return;
  t.lastText = text;
  t.inflight = bot.api.editMessageText(Number(t.chatId), t.msgId, text, { parse_mode: 'HTML' })
    .then(() => { t.last = Date.now(); })
    .catch((e) => {
      if (/not modified/i.test(e.message)) return;
      // The status message is gone (deleted or replaced): stop editing it instead of retrying every 3 s.
      if (/not found|can't be edited|MESSAGE_ID_INVALID/i.test(e.message)) { t.msgId = null; return; }
      // Telegram flood limit: wait as long as it asks, without piling more calls on top.
      const wait = Number(e.parameters?.retry_after || e.message.match(/retry after (\d+)/)?.[1] || 0);
      if (wait) { t.pauseUntil = Date.now() + wait * 1000; return; }
      addLog('error', `Статус работы: ${e.message.slice(0, 120)}`);
    })
    .finally(() => { t.inflight = null; });
  await t.inflight;
}

async function trackRun(runId, chatId, userMsgId, project) {
  const t = { chatId, userMsgId, timer: null, last: 0, pending: null, msgId: null };
  live.set(runId, t);
  react(chatId, userMsgId, '👀');
  try {
    // A live widget with its own clock; old apps and errors fall back to a text message.
    t.state = { e: '💭', w: 'Думаю', p: currentProject().id === project.id ? '' : project.name, t0: Date.now(), n: 0, l: '' };
    t.msgId = await widgets.sendProgress(chatId, t.state);
    t.widget = true;
  } catch {
    try {
      const m = await bot.api.sendMessage(chatId, `💭 <b>Думаю</b>\n<i>${esc(project.name)} · 0:00</i>`, { ...HTML, disable_notification: true });
      t.msgId = m.message_id;
    } catch (e) {
      addLog('error', `Статус работы: ${e.message.slice(0, 120)}`);
    }
  }
  t.timer = setInterval(() => pushDraft(runId), 3000);
}

bus.on('change', (e) => {
  if (e.type !== 'run_event' || !live.has(e.id)) return;
  const t = live.get(e.id);
  if (t.pending) return;
  const wait = Math.max(0, 1500 - (Date.now() - t.last));
  t.pending = setTimeout(() => { t.pending = null; pushDraft(e.id); }, wait);
});

function untrack(runId) {
  const t = live.get(runId);
  if (!t) return null;
  t.done = true;
  clearInterval(t.timer);
  clearTimeout(t.pending);
  live.delete(runId);
  return t;
}

// Memory: how much is known and what waits for approval.
function memoryScreen() {
  const notes = listMemory();
  const pending = listPending();
  const lines = [`🧠 <b>Память</b> · ${notes.length} заметок`, '<i>Полный список и поиск по истории: пульт → «Память».</i>'];
  if (pending.length) {
    lines.push('', `<b>На проверку: ${pending.length}</b>`);
    for (const n of pending.slice(0, 12)) lines.push(`• <b>${esc(n.title)}</b>\n<blockquote expandable>${esc(cut(n.body, 600))}</blockquote>`);
  } else lines.push('', 'Новых заметок на проверку нет. Скажи «запомни, что…», и я сохраню сразу.');
  const kb = new InlineKeyboard();
  if (pending.length) kb.text('✅ Запомнить всё', 'mem:ok').success().text('❌ Отклонить всё', 'mem:no');
  return { text: lines.join('\n'), kb };
}

// New notes waiting for approval: one card, a ✅/❌ pair per note. Tapped notes show their
// outcome; untouched ones are saved anyway after 3 days, marked «не проверено».
function pendingCard(files) {
  const size = Math.max(120, Math.min(450, Math.floor(3000 / files.length)));
  const pend = new Map(listPending().map((n) => [n.file, n]));
  const kept = new Set(listMemory().map((n) => n.file));
  const memo = kvGet('memory_card_text', {});
  const lines = ['🧠 <b>Запомнить?</b> <i>Без ответа сохраню через 3 дня с пометкой «не проверено».</i>'];
  const kb = new InlineKeyboard();
  for (const f of files) {
    const n = pend.get(f);
    if (n) {
      memo[f] = n.title;
      lines.push('', `<b>${esc(n.title)}</b>\n<blockquote expandable>${esc(cut(n.body, size))}</blockquote>`);
      kb.text(`✅ ${cut(n.title, 26)}`, `mem:y:${tok({ f, files })}`).success().text('❌', `mem:n:${tok({ f, files })}`).row();
    } else lines.push('', `${kept.has(f) ? '✅' : '❌'} <s>${esc(memo[f] || f)}</s>`);
  }
  kvSet('memory_card_text', memo);
  return { text: lines.join('\n'), kb, open: files.some((f) => pend.has(f)) };
}

// The owner's day comes in two messages (morning and evening digest tasks, kv digest_tasks
// {morning: taskId, evening: taskId}). With an evening digest, notes to approve wait for it.
const digestTasks = () => kvGet('digest_tasks', {});
const digestKind = (taskName) => {
  if (!taskName) return null;
  const d = digestTasks();
  for (const k of ['morning', 'evening']) if (d[k] && get('SELECT name FROM tasks WHERE id = ?', Number(d[k]))?.name === taskName) return k;
  return null;
};

// All notes not yet shown, as one card (bodies get shorter the more notes there are).
async function sendPendingCard() {
  const seen = announced();
  const fresh = listPending().map((n) => n.file).filter((f) => !seen[f]).slice(0, 12);
  if (!fresh.length || !ownerId()) return;
  const { text, kb } = pendingCard(fresh);
  await sendOwner(text, { reply_markup: kb, disable_notification: true });
  markAnnounced(fresh);
}

let pendingTimer = null;
function announcePending() {
  clearTimeout(pendingTimer);
  if (digestTasks().evening) return; // shown with the evening message
  // A minute of quiet, so the nightly digest's several notes come as one card.
  pendingTimer = setTimeout(async () => {
    const seen = announced();
    const fresh = listPending().map((n) => n.file).filter((f) => !seen[f]);
    if (!fresh.length || !ownerId()) return;
    try {
      // Three notes per card: a Telegram message holds 4096 characters.
      for (let i = 0; i < fresh.length; i += 3) {
        const part = fresh.slice(i, i + 3);
        const { text, kb } = pendingCard(part);
        await sendOwner(text, { reply_markup: kb, disable_notification: true });
        markAnnounced(part);
      }
    } catch (e) { addLog('error', `Память, карточка: ${e.message.slice(0, 120)}`); }
  }, 60000);
}

function resultMessage(r, project) {
  const icon = r.status === 'done' ? '✅' : r.status === 'stopped' ? '⏹' : '⚠️';
  const took = r.finished_at && r.started_at ? ` · ${dur(r.finished_at - r.started_at)}` : '';
  const task = /^\[Задача по расписанию «(.+?)»\]/.exec(r.prompt || '')?.[1];
  // The session the owner talks to needs no title: just the answer. Other projects and scheduled
  // tasks keep a short label so it is clear where the message came from.
  const own = currentProject().id === project.id && !task;
  const head = own ? (r.status === 'done' ? '' : `${icon} <b>${r.status === 'stopped' ? 'Остановлено' : 'Ошибка'}</b>`) : `${icon} <b>${esc(project.name)}</b>${task ? ` · ⏰ ${esc(task)}` : ''}${took}`;
  const { text: raw, choices, copies } = extractButtons(String(r.result || (r.status === 'stopped' ? 'Остановлено' : r.status)));
  const text = `${head ? `${head}\n\n` : ''}${answer(raw)}`;
  // The same answer as Telegram rich Markdown (tables, headings, lists rendered by Telegram itself).
  const mdHead = own ? (r.status === 'done' ? '' : `${icon} **${r.status === 'stopped' ? 'Остановлено' : 'Ошибка'}**`) : `${icon} **${project.name}**${task ? ` · ⏰ ${task}` : ''}${took}`;
  const md = `${mdHead ? `${mdHead}\n\n` : ''}${raw}`.slice(0, 32000);
  const kb = new InlineKeyboard();
  // Answer buttons the session asked for: a tap sends that text back to the same session.
  choices.forEach((c, i) => { kb.text(c.slice(0, 40), `ask:${tok({ text: c, projectId: project.id })}`); if (i === 0) kb.primary(); if (i % 2 === 1) kb.row(); });
  if (choices.length % 2 === 1) kb.row();
  for (const c of copies) kb.copyText(`📋 ${c.label.slice(0, 30)}`, c.text.slice(0, 256)).row();
  if (currentProject().id !== project.id) kb.text('🎯 Продолжать здесь', `sel:${project.id}`);
  // Only the project switch: a new session and the dashboard are in the menu, not under every answer.
  return { text, md, kb };
}

// The session ends an answer with [[кнопки: Да | Поправить | Нет]] when it waits for a decision,
// and [[копировать: Подпись | текст]] for something to copy. These lines become buttons.
function extractButtons(text) {
  const choices = []; const copies = [];
  const out = text.split('\n').filter((line) => {
    const b = line.trim().match(/^\[\[(?:кнопки|buttons):\s*(.+?)\]\]$/i);
    if (b) { choices.push(...b[1].split('|').map((x) => x.trim()).filter(Boolean).slice(0, 6)); return false; }
    const c = line.trim().match(/^\[\[(?:копировать|copy):\s*(.+?)\s*\|\s*(.+)\]\]$/i);
    if (c) { copies.push({ label: c[1], text: c[2] }); return false; }
    if (/^\[\[(?:тихо|quiet)\]\]$/i.test(line.trim())) return false;
    return true;
  });
  return { text: out.join('\n').trim(), choices, copies };
}
// A background run with nothing new ends its answer with [[тихо]]: kept in the dashboard only.
const QUIET_RE = /^\s*\[\[(?:тихо|quiet)\]\]\s*$/im;
// Background runs: their notify_owner calls wait for the end (one message per run).
const BACKGROUND = new Set(['ui', 'cron', 'system', 'marketing']);

// Rich message first (Bot API 10.1+, real tables); the old HTML message if Telegram refuses it.
async function sendAnswer(chatId, md, html, extra = {}) {
  try {
    // ==marker== renders pale yellow under white text in the dark theme: unreadable, so it becomes bold.
    const clean = String(md).replace(/==([^=\n]+)==/g, '**$1**');
    return await withRetry(() => bot.api.raw.sendRichMessage({ chat_id: chatId, rich_message: { markdown: clean }, ...extra }));
  } catch (e) {
    addLog('error', `Rich-сообщение не ушло, отправляю обычным: ${e.message.slice(0, 150)}`);
    return send(chatId, html, extra);
  }
}

// First-run interview: the session asks one question at a time and saves the answers to the
// shared memory, so every later session already knows who it works for.
export const ONBOARDING_PROMPT = `Это первое знакомство с владельцем мейнфрейма. Проведи короткое интервью, чтобы потом работать без лишних вопросов.
Правила: задавай по одному вопросу за сообщение, коротко и по-человечески. После каждого ответа сразу сохраняй факт через mainframe memory_save (без pending) и задавай следующий вопрос. Не больше 10 вопросов. Если человек пишет «хватит» или «потом», заканчивай.
Темы по порядку:
1. Как к нему обращаться, где живёт (город и часовой пояс), на каком языке общаться. (type user)
2. Чем занимается: работа, проекты, компании, роль. (type user и project)
3. Что продаёт или чем зарабатывает, цены и ссылки, куда вести людей. (type user, name offer)
4. Как писать от его имени: тон, длина, что нельзя (слова, тире, эмодзи), примеры его фраз. (type feedback, с «Почему» и «Как применять»)
5. Ключевые люди: партнёры, клиенты, семья, кому отвечать быстро. (type people, одна заметка на человека)
6. Что ему не нравится в работе помощников и что делать только после его «да». (type feedback)
7. Какие рутины он хочет отдать: сводки, напоминания, разбор почты, посты. Предложи поставить 1–3 задачи по расписанию через mainframe create_cron_task и поставь, если он согласен.
8. Есть ли Telegram-канал и соцсети, сайт, бот продаж. (type reference)
В конце коротко перечисли, что запомнил, и подскажи 3 первые команды: «запомни, что…», задача голосом, /memory.
Начни с короткого приветствия в одну строку и первого вопроса.`;

export function startBot() {
  if (config.channel === 'max') {
    botState.status = 'running'; // the owner's channel is MAX (src/max.js has its own state)
    import('./max.js').then(({ startMax }) => startMax()).catch((e) => addLog('error', `MAX: ${e.message}`));
    return;
  }
  if (!config.botToken) {
    botState.status = 'not_configured';
    return;
  }
  // TELEGRAM_API_ROOT: a relay to api.telegram.org (where Telegram is blocked) or a test stub.
  bot = new Bot(config.botToken, process.env.TELEGRAM_API_ROOT ? { client: { apiRoot: process.env.TELEGRAM_API_ROOT.replace(/\/$/, '') } } : undefined);
  // A letter from a session leaves only after the owner's button (src/mailbox.js).
  setMailApprover(async (id, m) => {
    const kb = new InlineKeyboard().text('📤 Отправить', `ms:${id}:1`).text('Отмена', `ms:${id}:0`);
    const head = `✉️ <b>Письмо ждёт твоего «да»</b>\nКому: ${esc(m.to)}${m.cc ? `\nКопия: ${esc(m.cc)}` : ''}\nТема: ${esc(m.subject)}`;
    await sendOwner(`${head}\n<blockquote expandable>${esc(cut(m.body, 3000))}</blockquote>`, { reply_markup: kb, disable_notification: false });
  });

  // Widgets ask for fresh data (Bot API 10.4): only the owner gets answers.
  bot.use(async (ctx, next) => {
    const q = ctx.update.widget_query || ctx.update.shared_widget_query;
    if (!q) return next();
    await widgets.answerQuery(q, String(q.from?.id) === String(ownerId()));
  });
  // Setup in the chat (src/chatsetup.js): the port the setup talks through.
  const tgPort = (chatId) => ({
    canDelete: true,
    send: async (text, rows) => (await bot.api.sendMessage(chatId, text, { ...HTML, link_preview_options: { is_disabled: true }, ...(rows ? { reply_markup: { inline_keyboard: rows.map((r) => r.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))) } } : {}) })).message_id,
    del: async (id) => { await bot.api.deleteMessage(chatId, id); return true; },
  });
  const claimOwner = async (ctx, text) => {
    if (!(await chatsetup.claim(tgPort(ctx.chat.id), ctx.from, text))) return;
    kvSet('owner_tg_id', String(ctx.from.id));
    await updateMenuButton().catch(() => {});
  };
  // A fresh bot installed with CHAT_SETUP=on: the first person who writes in private is the owner.
  bot.use(async (ctx, next) => {
    if (ownerId() || !chatsetup.chatSetupOn() || ctx.chat?.type !== 'private' || !ctx.message || !ctx.from) return next();
    return claimOwner(ctx, ctx.message.text || '');
  });

  bot.command('start', async (ctx) => {
    const code = (ctx.match || '').trim();
    if (!ownerId()) {
      if (code && code === config.pairingCode) {
        kvSet('owner_tg_id', String(ctx.from.id));
        addLog('system', `Бот привязан к ${ctx.from.username || ctx.from.id}`);
        await updateMenuButton();
        const hi = config.owner?.name && config.owner.name !== 'владелец' ? `, ${esc(config.owner.name)}` : '';
        await sendMenu(ctx.chat.id, `👋 <b>Привет${hi}! Я твой помощник.</b> Теперь я слушаюсь только тебя. Меню внизу, задачи пиши прямо сюда текстом или голосом.`);
        // A fresh install: get to know the owner right away.
        if (!listMemory().length) {
          const p = currentProject();
          const runId = startRun({ projectId: p.id, prompt: ONBOARDING_PROMPT, origin: 'bot' });
          await trackRun(runId, ctx.chat.id, null, p);
          return;
        }
        return showScreen(ctx, 'home');
      }
      return ctx.reply('Чтобы привязать бота, отправь /start и код с дашборда.');
    }
    if (String(ctx.from.id) !== String(ownerId())) return;
    await sendMenu(ctx.chat.id);
    return showScreen(ctx, 'home');
  });

  bot.use(async (ctx, next) => {
    // The user pressed "stop" on a live draft: stop that run.
    const stopped = ctx.update.stopped_message_generation;
    if (stopped) {
      const runId = Number(stopped.draft_id);
      if (live.has(runId)) stopRun(runId);
      return;
    }
    if (!ctx.from || String(ctx.from.id) !== String(ownerId())) return;
    // Only the private chat with the owner: in a group, results would leak to other members.
    if (ctx.chat && ctx.chat.type !== 'private') return;
    // Messages sent while the Mac was asleep or restarting arrive late. A few minutes is
    // fine; an hour-old command is likely stale, so it is shown, not executed.
    const sent = ctx.message?.date;
    if (sent && Date.now() / 1000 - sent > 600) {
      const what = ctx.message.text ? `«${esc(cut(ctx.message.text, 200))}»` : 'голосовое';
      return ctx.reply(`⏸ Пропустил старое сообщение ${what}: мейнфрейм был недоступен. Если ещё актуально, отправь заново.`, HTML);
    }
    return next();
  });

  // While the setup in the chat runs, the owner's messages and its buttons go to it.
  bot.use(async (ctx, next) => {
    if (!chatsetup.chatSetupOn() || chatsetup.setupStep() === 'done') return next();
    const port = tgPort(ctx.chat.id);
    const data = ctx.callbackQuery?.data;
    try {
      if (data?.startsWith('cs:')) { await ctx.answerCallbackQuery().catch(() => {}); await chatsetup.onButton(port, data); return; }
      if (ctx.callbackQuery) return next();
      const text = ctx.message?.text;
      if (!text) { if (ctx.message) await ctx.reply('Пока идёт настройка, ответь, пожалуйста, текстом.'); return; }
      const r = await chatsetup.onText(port, text, ctx.message.message_id);
      if (r?.done) {
        await sendMenu(ctx.chat.id, '⌨️ Меню внизу, задачи пиши прямо сюда.');
        const p = currentProject();
        const runId = startRun({ projectId: p.id, prompt: ONBOARDING_PROMPT, origin: 'bot' });
        await trackRun(runId, ctx.chat.id, null, p);
      }
    } catch (e) { await ctx.reply(`⚠️ ${esc(e.message)}`, HTML).catch(() => {}); }
  });

  bot.command('menu', async (ctx) => { await sendMenu(ctx.chat.id); return showScreen(ctx, 'home'); });
  bot.command('app', (ctx) => (config.publicUrl?.startsWith('https://')
    ? ctx.reply('📱 Пульт:', { reply_markup: new InlineKeyboard().webApp('Открыть пульт', config.publicUrl) })
    : ctx.reply('Нет https-адреса для Mini App. Включи туннель (TUNNEL=cloudflared) или задай PUBLIC_URL.')));
  bot.command('status', (ctx) => showScreen(ctx, 'home'));
  bot.command('inbox', (ctx) => showScreen(ctx, 'inbox'));
  bot.command('today', (ctx) => showScreen(ctx, 'today'));
  for (const { kind } of widgets.widgetKinds()) {
    bot.command(kind, async (ctx) => {
      try {
        const m = await widgets.sendWidget(ctx.chat.id, kind);
        if (kind === 'board') await bot.api.pinChatMessage(ctx.chat.id, m.message_id, { disable_notification: true }).catch(() => {});
      } catch (e) { await ctx.reply(`Виджет не открылся: ${esc(e.message.slice(0, 150))}`, HTML); }
    });
  }
  bot.command('projects', (ctx) => showScreen(ctx, 'sess'));
  bot.command('social', (ctx) => showScreen(ctx, 'soc'));
  bot.command('tasks', (ctx) => showScreen(ctx, 'tasks'));
  bot.command('setup', async (ctx) => {
    const p = currentProject();
    const runId = startRun({ projectId: p.id, prompt: `${ONBOARDING_PROMPT}\nВ памяти уже есть заметки (mainframe memory_list): не спрашивай то, что там уже есть, уточни только пробелы.`, origin: 'bot' });
    await trackRun(runId, ctx.chat.id, null, p);
  });
  // Which model works now, and a switch between providers. Keys are never sent here: only in the
  // dashboard (System → Model) or .env, a key in a chat would stay in its history.
  const modelScreen = () => {
    const m = modelState();
    const lines = [`🧠 <b>Модель:</b> ${esc(m.name)}`, `Основная: <code>${esc(m.main || '·')}</code>${m.fast && m.fast !== m.main ? `\nБыстрая: <code>${esc(m.fast)}</code>` : ''}`];
    if (!m.ready) lines.push('', '⚠️ Не хватает ключа или модели: задай их в пульте, «Система → Модель».');
    if (!m.connectors) lines.push('', 'Коннекторы claude.ai (Gmail, Календарь, Drive, Metricool) с этим провайдером не работают.');
    lines.push('', '<i>Ключ вводится только в пульте, не присылай его сюда.</i>');
    const kb = new InlineKeyboard();
    m.providers.filter((x) => x.id !== 'custom').forEach((x, i) => { kb.text(`${x.id === m.provider ? '✓ ' : ''}${x.name.replace(/\s*\(.*\)/, '')}`, `mdl:${x.id}`); if (i % 2 === 1) kb.row(); });
    return { text: lines.join('\n'), kb };
  };
  bot.command('model', async (ctx) => { const m = modelScreen(); return ctx.reply(m.text, { ...HTML, reply_markup: m.kb }); });
  bot.command('memory', async (ctx) => { const m = memoryScreen(); return ctx.reply(m.text, { ...HTML, ...(m.kb.inline_keyboard.length ? { reply_markup: m.kb } : {}) }); });
  bot.command('stop', async (ctx) => { stopAll(); return ctx.reply('⏹ <b>Всё остановил.</b> Автоматика на паузе.', { ...HTML, reply_markup: new InlineKeyboard().text('▶️ Включить', 'sys:resume').success() }); });
  bot.command('resume', async (ctx) => { resumeAll(); return ctx.reply('▶️ Автоматика включена.'); });

  bot.command('new', async (ctx) => {
    const [name, rawCwd] = (ctx.match || '').split('|').map((s) => s.trim());
    if (!name) return ctx.reply('Формат: <code>/new Название | /путь/к/папке</code>', HTML);
    const cwd = rawCwd?.replace(/^~(?=\/)/, process.env.HOME);
    if (cwd && !cwd.startsWith('/')) return ctx.reply('Папка должна быть полным путём: /Users/… или ~/…');
    const res = run('INSERT INTO projects (name, cwd, created_at) VALUES (?, ?, ?)', name, cwd || `${config.workspaceDir}/${name}`, now());
    kvSet('bot_project', Number(res.lastInsertRowid));
    return sendMenu(ctx.chat.id, `🆕 Проект <b>${esc(name)}</b> создан, команды идут туда.`);
  });

  // What a reply (swipe) to one of the bot's messages means: a reply to an inbox card goes
  // to that person, a reply to a session result continues that session.
  async function handleOwnerText(ctx, text, heard = '', { files = false } = {}) {
    const replyTo = ctx.message.reply_to_message?.message_id;
    const link = replyTo ? get('SELECT * FROM bot_msgs WHERE message_id = ?', replyTo) : null;
    // Files never go to a person: a swipe-reply with a screenshot goes to the session.
    // A swipe on an inbox card is never sent at once: it may be a note to the mainframe,
    // not a reply (two notes once went to a bank as e-mails). Ask first; service senders
    // (banks, no-reply, notifications) get no "send" button at all.
    if (link?.inbox_id && !files) {
      const item = getItem(link.inbox_id);
      run('UPDATE inbox SET draft = ?, updated_at = ? WHERE id = ?', text, now(), item.id);
      const service = /no-?reply|notif|alert|bank|care@|support@|mailer|info@|billing|receipt/i.test(item.username || '') || /^(777000)$/.test(String(item.chat_id));
      const kb = new InlineKeyboard();
      if (!service) kb.text(`✅ Отправить ${String(item.name || '').slice(0, 20)}`, `r:${item.id}`).success().row();
      kb.text('🧠 Это задача мейнфрейму', `tk:${item.id}`).primary();
      return ctx.reply(`${heard}${service ? `Это сервисная рассылка (${esc(item.username || item.name)}), отвечать туда нельзя.` : `Отправить это ${esc(item.name)}${item.source === 'mail' ? ' письмом' : ''} или это задача мне?`}\n\n<blockquote>${esc(text.slice(0, 800))}</blockquote>`, { ...HTML, reply_markup: kb });
    }
    const p = (link?.project_id && get('SELECT * FROM projects WHERE id = ?', link.project_id)) || currentProject();
    if (heard) await ctx.reply(heard, HTML);
    const runId = startRun({ projectId: p.id, prompt: text, origin: 'bot' });
    await trackRun(runId, ctx.chat.id, ctx.message.message_id, p);
    return null;
  }

  bot.on('message:text', async (ctx) => {
    const menu = menuFor(ctx.message.text);
    if (menu) {
      const map = { home: 'home', inbox: 'inbox', today: 'today', sessions: 'sess', social: 'soc', more: 'sys' };
      return showScreen(ctx, map[menu]).catch((e) => ctx.reply(`Не открылось: ${e.message}`));
    }
    try {
      await handleOwnerText(ctx, ctx.message.text);
    } catch (e) {
      await ctx.reply(`⚠️ Не получилось: ${esc(e.message)}`, HTML);
    }
  });

  // Voice commands: transcribe locally, show what was heard, then handle it like text.
  // Updates are handled one at a time, so the transcription runs in the background:
  // /stop must not wait behind a long voice message.
  bot.on(['message:voice', 'message:audio', 'message:video_note'], (ctx) => {
    handleVoice(ctx).catch((e) => addLog('error', `Голосовое боту: ${e.message}`));
  });

  async function handleVoice(ctx) {
    if (!voiceEnabled()) return ctx.reply('Расшифровка голосовых выключена (WHISPER_URL=off).');
    const started = Date.now();
    let text;
    try {
      await ctx.replyWithChatAction('typing');
      const file = await ctx.getFile();
      const url = `${(process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\/$/, '')}/file/bot${config.botToken}/${file.file_path}`;
      const res = await fetch(url).catch(() => new Promise((r) => setTimeout(r, 3000)).then(() => fetch(url)));
      if (!res.ok) throw new Error(`Telegram не отдал файл (${res.status})`);
      const typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 5000);
      try { text = await transcribeAudio(Buffer.from(await res.arrayBuffer()), file.file_path.split('/').pop()); } finally { clearInterval(typing); }
    } catch (e) {
      addLog('error', `Голосовое боту: ${e.message}`);
      return ctx.reply(`⚠️ Не смог расшифровать: ${esc(e.message)}`, HTML);
    }
    addLog('bot', `Голосовое расшифровано за ${((Date.now() - started) / 1000).toFixed(1)} с`);
    try {
      await handleOwnerText(ctx, text, `🎤 <i>${esc(text)}</i>`);
    } catch (e) {
      await ctx.reply(`🎤 <i>${esc(text)}</i>\n\n⚠️ Не получилось: ${esc(e.message)}`, HTML);
    }
  }

  // Screenshots and files: saved on the Mac, the session gets their paths. An album arrives
  // as several messages, so they are collected for a moment and sent as one task.
  const albums = new Map();
  bot.on(['message:photo', 'message:document'], async (ctx) => {
    let file;
    try {
      const f = await ctx.getFile();
      const res = await fetch(`${(process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\/$/, '')}/file/bot${config.botToken}/${f.file_path}`);
      if (!res.ok) throw new Error(`Telegram не отдал файл (${res.status})`);
      const name = ctx.message.document?.file_name || f.file_path.split('/').pop();
      file = saveUpload(name, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      return ctx.reply(`⚠️ Не смог сохранить файл: ${esc(e.message)}`, HTML);
    }
    const caption = ctx.message.caption || '';
    const group = ctx.message.media_group_id;
    if (!group) {
      try { await handleOwnerText(ctx, withAttachments(caption, [file]), '', { files: true }); } catch (e) { await ctx.reply(`⚠️ Не получилось: ${esc(e.message)}`, HTML); }
      return;
    }
    const a = albums.get(group) || { files: [], caption: '', ctx };
    a.files.push(file);
    if (caption) a.caption = caption;
    clearTimeout(a.timer);
    a.timer = setTimeout(async () => {
      albums.delete(group);
      try { await handleOwnerText(a.ctx, withAttachments(a.caption, a.files), '', { files: true }); } catch (e) { await a.ctx.reply(`⚠️ Не получилось: ${esc(e.message)}`, HTML); }
    }, 1500);
    albums.set(group, a);
  });

  bot.on('callback_query:data', async (ctx) => {
    const [kind, a, b] = ctx.callbackQuery.data.split(':');
    let toast;
    try {
      if (kind === 'n') {
        await edit(ctx, await screen(a));
      } else if (kind === 'c') {
        const item = getItem(Number(a));
        if (item) await edit(ctx, inboxCard(item, 'view'));
      } else if (kind === 's') {
        await edit(ctx, projectScreen(Number(a)));
      } else if (kind === 'sel' || kind === 'p') {
        kvSet('bot_project', Number(a));
        toast = `Команды идут в «${currentProject().name}»`;
        if (kind === 'sel' && ctx.callbackQuery.message?.text?.startsWith('🧠')) await edit(ctx, projectScreen(Number(a)));
        await sendMenu(ctx.chat.id);
      } else if (kind === 'ns') {
        run('UPDATE projects SET session_id = NULL WHERE id = ?', Number(a));
        bus.change('project', Number(a));
        toast = 'Следующее сообщение начнёт новую сессию';
      } else if (kind === 'f') {
        await forwardItem(Number(a), { projectId: Number(b) });
        toast = `Отправил в «${get('SELECT name FROM projects WHERE id = ?', Number(b))?.name}»`;
        await edit(ctx, inboxCard(getItem(Number(a)), 'view'));
      } else if (kind === 'pick') {
        const kb = new InlineKeyboard();
        for (const p of all('SELECT id, name FROM projects ORDER BY is_default DESC, name')) kb.text(p.name.slice(0, 30), `f:${a}:${p.id}`).row();
        kb.text('← Назад', `c:${a}`);
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
      } else if (kind === 'tk') {
        // The swipe text is an instruction about this item, for the current project.
        const item = getItem(Number(a));
        const p = currentProject();
        const prompt = `Владелец написал про ${item.source === 'mail' ? 'письмо' : 'сообщение'} от ${item.name}${item.username ? ` (${item.username})` : ''}:\n«${item.draft || ''}»\n\nСамо ${item.source === 'mail' ? 'письмо' : 'сообщение'}:\n\"\"\"\n${String(item.text || '').slice(0, 2000)}\n\"\"\"\n\nЭто указание тебе, а не ответ отправителю. Отправителю ничего не пиши.`;
        run('UPDATE inbox SET draft = NULL WHERE id = ?', item.id);
        const runId = startRun({ projectId: p.id, prompt, origin: 'bot' });
        await ctx.editMessageReplyMarkup().catch(() => {});
        await trackRun(runId, ctx.chat.id, ctx.callbackQuery.message?.message_id, p);
        toast = `Задача ушла в «${p.name}»`;
      } else if (kind === 'r') {
        const item = await replyItem(Number(a));
        toast = `Ответил ${item.name}`;
        await edit(ctx, inboxCard(getItem(Number(a)), 'view'));
      } else if (kind === 'i') {
        ignoreItem(Number(a));
        await edit(ctx, inboxCard(getItem(Number(a)), 'view'));
      } else if (kind === 'ms') {
        const { sent, m } = await decideSend(a, b === '1');
        toast = sent ? `Отправил: ${m.to}` : 'Письмо не отправлено';
        await ctx.editMessageReplyMarkup().catch(() => {});
        await ctx.reply(sent ? `📤 Отправлено: ${esc(m.to)}, «${esc(m.subject)}»` : '🗑 Письмо отменено', HTML);
      } else if (kind === 'x') {
        stopRun(Number(a));
        toast = 'Остановлено';
        await ctx.editMessageReplyMarkup().catch(() => {});
      } else if (kind === 't') {
        fireTask(Number(a), true);
        toast = 'Запустил, итог пришлю';
      } else if (kind === 'tt') {
        const t = get('SELECT * FROM tasks WHERE id = ?', Number(a));
        if (t) updateTask(t.id, { enabled: t.enabled ? 0 : 1 });
        await edit(ctx, await screen('tasks'));
      } else if (kind === 'soc') {
        refreshReport();
        toast = 'Собираю сводку, 1–3 минуты';
        await edit(ctx, await screen('soc'));
      } else if (kind === 'rc') {
        const id = untok(a);
        if (!id) throw new Error('Кнопка устарела, открой «Сегодня» заново');
        await completeReminder(id);
        toast = 'Выполнено';
        await edit(ctx, await screen('today'));
      } else if (kind === 'ask') {
        // An answer button from before tokens were stored: its own text on the message is the answer.
        const btn = (ctx.callbackQuery.message?.reply_markup?.inline_keyboard || []).flat().find((b) => b.callback_data === ctx.callbackQuery.data);
        const v = untok(a) || (btn?.text ? { text: btn.text, projectId: currentProject().id } : null);
        if (!v) throw new Error('Кнопка устарела, напиши ответ текстом');
        await ctx.editMessageReplyMarkup().catch(() => {});
        const p = get('SELECT * FROM projects WHERE id = ?', v.projectId) || currentProject();
        const runId = startRun({ projectId: p.id, prompt: v.text, origin: 'bot' });
        await trackRun(runId, ctx.chat.id, null, p);
        toast = `Ответ: ${v.text}`.slice(0, 190);
      } else if (kind === 'mem' && (a === 'y' || a === 'n')) {
        const v = untok(b) || {};
        try { (a === 'y' ? approvePending : rejectPending)(v.f); toast = a === 'y' ? 'Запомнил' : 'Не запоминаю'; } catch { toast = 'Уже решено'; }
        const { text, kb } = pendingCard(v.files || [v.f]);
        await ctx.editMessageText(text, { ...HTML, reply_markup: kb }).catch(() => {});
      } else if (kind === 'mem') {
        const items = listPending();
        for (const n of items) (a === 'ok' ? approvePending : rejectPending)(n.name);
        toast = a === 'ok' ? `Запомнил: ${items.length}` : `Отклонил: ${items.length}`;
        await edit(ctx, memoryScreen());
      } else if (kind === 'cpok' || kind === 'cpx' || kind === 'cpn' || kind === 'cpd') {
        toast = await contentCallback(kind, a);
        // In the morning message only the tapped post's row goes; other buttons stay.
        const rows = (ctx.callbackQuery.message?.reply_markup?.inline_keyboard || []).filter((r) => !r.some((x) => /^cp[xn]:/.test(x.callback_data || '') && x.callback_data.split(':')[1] === String(a)));
        const keep = kind !== 'cpok' && kind !== 'cpd' && rows.length;
        await ctx.editMessageReplyMarkup(keep ? { reply_markup: { inline_keyboard: rows } } : undefined).catch(() => {});
      } else if (kind === 'mdl') {
        const cur = modelState();
        if (a !== 'claude' && a !== cur.provider && !cur.keySet) throw new Error('Сначала введи ключ этого провайдера в пульте: Система → Модель');
        saveModelSettings({ provider: a });
        const m = modelScreen();
        toast = a === 'claude' ? 'Модель: Claude' : 'Провайдер сменён. Проверь ключ кнопкой «Проверить» в пульте';
        await ctx.editMessageText(m.text, { ...HTML, reply_markup: m.kb }).catch(() => {});
      } else if (kind === 'sys') {
        if (a === 'stop') { stopAll(); toast = 'Всё остановлено'; } else { resumeAll(); toast = 'Автоматика включена'; }
        await edit(ctx, await screen('sys'));
      }
      await ctx.answerCallbackQuery(toast ? { text: toast } : undefined);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: cut(e.message, 190), show_alert: true }).catch(() => {});
    }
  });

  bot.catch((e) => {
    botState.error = e.message;
    addLog('error', `Бот: ${e.message}`);
  });

  onInboxUpdate(async (item, reason) => {
    if (!ownerId()) return;
    if (reason === 'noted') {
      const d = item.decision ? JSON.parse(item.decision) : {};
      if (d.finance) return;
      const msg = await sendOwner(`<i>· ${item.source === 'mail' ? '✉️' : '💬'} ${esc(item.name)}: ${esc(cut(item.text, 140))}${d.summary ? ' · без действий' : ''}</i>`, { disable_notification: true });
      return remember(msg, { inboxId: item.id });
    }
    const { text, kb } = inboxCard(item, reason);
    // Urgent rings; "can wait" and batches arrive silently.
    const quiet = item.urgency === 'подождёт' || (reason === 'batch' && item.urgency !== 'срочно');
    const msg = await sendOwner(text, { ...(kb.inline_keyboard.length ? { reply_markup: kb } : {}), ...(quiet ? { disable_notification: true } : {}) });
    remember(msg, { inboxId: item.id });
  });

  // Memory: new notes to approve, and a warning when the rules stop fitting in full.
  bus.on('change', (e) => {
    if (e.type === 'memory' && e.pending) announcePending();
    if (e.type === 'memory_overflow') sendOwner(`🧠 <b>Память переполнена.</b> Правила и люди больше ${Number(e.max).toLocaleString("ru")} символов, эти заметки идут в сессии только заголовком: ${esc(e.titles.join(', '))}.\nНапиши «сожми память», и я объединю похожие заметки.`).catch(() => {});
  });
  announcePending();

  onRunFinished(async (r0, project) => {
    let r = r0;
    const t = untrack(r.id);
    if (t?.inflight) await t.inflight.catch(() => {});
    if (t?.msgId) await bot.api.deleteMessage(Number(t.chatId), t.msgId).catch(() => {});
    if (!ownerId() || r.inbox_id) return;
    // Messages a background run kept back (notify_owner without urgent): they end in this one message.
    const held = BACKGROUND.has(r.origin) ? all("SELECT content FROM run_events WHERE run_id = ? AND kind = 'notify' ORDER BY id", r.id).map((x) => x.content) : [];
    // A run from the dashboard answers there; Telegram hears from it only if it meant to tell the owner.
    if (r.origin === 'ui' && !held.length) return;
    if (r.origin !== 'bot' && r.status === 'done' && QUIET_RE.test(r.result || '')) {
      addLog('run', `[${project.name}] итог без новостей, в чат не отправляю`, r.id);
      return;
    }
    if (held.length && !String(r.result || '').trim()) r = { ...r, result: held[held.length - 1] };
    const chat = t?.chatId || ownerId();
    if (t) react(chat, t.userMsgId, r.status === 'done' ? '👍' : r.status === 'stopped' ? '🤷' : '😢');
    // A scheduled task that says exactly the same as its last report within a day stays quiet.
    const task = r.origin === 'cron' && /^\[Задача по расписанию «(.+?)»\]/.exec(r.prompt || '')?.[1];
    if (task && r.status === 'done') {
      const norm = String(r.result || '').replace(/\s+/g, ' ').trim();
      const sent = kvGet('cron_last_report', {});
      if (sent[task] && sent[task].text === norm && Date.now() - sent[task].at < 86400000) {
        addLog('cron', `«${task}»: тот же отчёт, что и раньше за сутки, не присылаю повтор`);
        return;
      }
      kvSet('cron_last_report', { ...sent, [task]: { text: norm, at: Date.now() } });
    }
    const digest = digestKind(task);
    const { text, md: md0, kb } = resultMessage(r, project);
    let md = md0;
    if (digest === 'morning') {
      // Today's posts with their buttons (they used to come as a separate card at 8:30).
      const p = todayPosts();
      if (p) { md += `\n\n${p.md}`; kb.inline_keyboard = [...kb.inline_keyboard.filter((x) => x.length), ...p.rows]; }
    }
    if (digest === 'evening') {
      const a = alertsDigest();
      if (a) md += `\n\n${a}`;
      // The memory digest task (digest_tasks.memory) runs before it: its first line joins the evening.
      const memTask = digestTasks().memory && get('SELECT name FROM tasks WHERE id = ?', Number(digestTasks().memory))?.name;
      const mem = memTask && get("SELECT result FROM runs WHERE origin = 'cron' AND status = 'done' AND started_at > ? AND prompt LIKE ? ORDER BY id DESC LIMIT 1", Date.now() - 12 * 3600000, `[Задача по расписанию «${memTask}»]%`);
      const memLine = String(mem?.result || '').split('\n').map((x) => x.trim()).find((x) => x && !QUIET_RE.test(x));
      if (memLine) md += `\n\n${memLine.slice(0, 400)}`;
    }
    const long = r.finished_at - r.started_at > 60000;
    const msg = await sendAnswer(chat, md, text, { ...(kb.inline_keyboard.length ? { reply_markup: kb } : {}), ...(r.status === 'done' && long ? { message_effect_id: EFFECT_DONE } : {}) });
    remember(msg, { projectId: project.id });
    if (digest === 'evening') await sendPendingCard().catch((e) => addLog('error', `Память, карточка: ${e.message.slice(0, 120)}`));
  });

  setMainframeHandlers({ notify: async (md, { runId = null, urgent = false } = {}) => {
    const r = runId ? get('SELECT origin, status FROM runs WHERE id = ?', runId) : null;
    if (r && BACKGROUND.has(r.origin) && !urgent && ['running', 'queued'].includes(r.status)) {
      addEvent(runId, 'notify', String(md).slice(0, 4000));
      return 'held';
    }
    const { text, choices, copies } = extractButtons(String(md));
    const kb = new InlineKeyboard();
    choices.forEach((c, i) => { kb.text(c.slice(0, 40), `ask:${tok({ text: c, projectId: currentProject().id })}`); if (i % 2 === 1) kb.row(); });
    for (const c of copies) kb.copyText(`📋 ${c.label.slice(0, 30)}`, c.text.slice(0, 256)).row();
    return sendAnswer(ownerId(), `🔔 ${text}`, `🔔 ${body(text)}`, kb.inline_keyboard.length ? { reply_markup: kb } : {});
  } });

  bot.api.setMyCommands([
    { command: 'menu', description: 'Пульт и меню' },
    { command: 'inbox', description: 'Входящие' },
    { command: 'day', description: 'Карточка дня' },
    { command: 'board', description: 'Табло: что сейчас делает мейнфрейм' },
    { command: 'money', description: 'Деньги: счета и траты' },
    { command: 'today', description: 'Встречи и напоминания' },
    { command: 'projects', description: 'Сессии: куда идут команды' },
    { command: 'social', description: 'Соцсети и советы' },
    { command: 'tasks', description: 'Задачи по расписанию' },
    { command: 'memory', description: 'Память: что я знаю, одобрить новое' },
    { command: 'model', description: 'Модель: какая работает, сменить провайдера' },
    { command: 'setup', description: 'Знакомство: рассказать о себе' },
    { command: 'app', description: 'Открыть пульт' },
    { command: 'new', description: 'Новый проект: Название | путь' },
    { command: 'resume', description: 'Включить автоматику' },
    // Widgets that optional modules bring, for example /trade.
    ...widgets.widgetKinds().filter((k) => !['day', 'money', 'board'].includes(k.kind)).map((k) => ({ command: k.kind, description: String(k.description || k.kind).slice(0, 60) })),
  ]).catch(() => {});
  bot.api.setMyShortDescription('Личный мейнфрейм владельца: входящие, сессии Claude Code, календарь, соцсети.').catch(() => {});
  bot.api.setMyDescription('Пульт мейнфрейма. Пиши или говори задачу, разбирай входящие, смотри встречи и соцсети. Работает только для владельца.').catch(() => {});

  widgets.setWidgetApi(bot.api);
  widgets.startDayCard(ownerId);
  bot.start({
    drop_pending_updates: false,
    allowed_updates: [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, 'message_reaction', 'widget_query', 'shared_widget_query'],
    onStart: (me) => {
      botState.status = 'running';
      botState.username = me.username;
      addLog('system', `Бот @${me.username} запущен`);
      updateMenuButton();
      // Once: replace the old always-open keyboard with the compact one.
      if (ownerId() && kvGet('menu_version', 0) < 2) {
        kvSet('menu_version', 2);
        bot.api.sendMessage(ownerId(), '⌨️ Меню теперь открывается кнопкой ▦ в поле ввода и не занимает экран.', { reply_markup: mainKeyboard(currentProject()), disable_notification: true }).catch(() => {});
      }
    },
  }).catch((e) => {
    botState.status = 'error';
    botState.error = e.message;
    addLog('error', `Бот не запустился: ${e.message}`);
  });
}

export function stopBot() {
  return bot?.stop();
}
