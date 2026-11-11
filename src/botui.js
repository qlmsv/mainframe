// Telegram bot screens: HTML layout (expandable quotes, <tg-time>, code), styled inline
// buttons, copy buttons. Screens are edited in place; the reply keyboard opens them.
import { InlineKeyboard, Keyboard } from 'grammy';
import { config } from './config.js';
import { all, get, run, db, kvGet, defaultProject } from './db.js';
import { activeRuns, isPaused } from './agent.js';
import { tgState } from './telegram-mcp.js';
import { mailState } from './mail.js';
import { agenda } from './apple.js';
import { channelStats, socialState } from './social.js';

// ---------- formatting ----------
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LIMIT = 3900;

// Telegram renders <tg-time> in the reader's own time zone and language; the inner text
// is the fallback for old clients.
export function tgTime(ms, format = 'r') {
  if (!ms) return '';
  const fallback = new Date(ms).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<tg-time unix="${Math.floor(ms / 1000)}" format="${format}">${esc(fallback)}</tg-time>`;
}

// Claude's Markdown → Telegram HTML: headings, bold, italic, code, fenced blocks, links, bullets.
const plainBot = (t) => String(t ?? '').replace(/<\/?details[^>]*>/g, '').replace(/<summary>(.*?)<\/summary>/g, '**$1**').replace(/^(\s*)- \[x\]/gim, '$1✅').replace(/^(\s*)- \[ \]/gm, '$1⬜').replace(/==([^=\n]+)==/g, '**$1**').replace(/!\[([^\]]+)\]\(tg:\/\/time[^)]*\)/g, '$1');
export function mdToHtml(md = '') {
  md = plainBot(md);
  const blocks = [];
  let s = String(md).replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(lang ? `<pre><code class="language-${esc(lang)}">${esc(code.trimEnd())}</code></pre>` : `<pre>${esc(code.trimEnd())}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = esc(s)
    .replace(/^\|[\s:|-]+\|\n?/gm, '')
    .replace(/^\|.*\|$/gm, (row) => row.split('|').slice(1, -1).map((c) => c.trim()).join(' · '))
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]).trim();
}

// Long text folds into an expandable quote; short text stays as it is.
export function body(md, { fold = 650, max = LIMIT } = {}) {
  let html = mdToHtml(md);
  if (html.length > max) html = `${html.slice(0, max).replace(/<[^>]*$/, '')}…`;
  if (html.length <= fold || /<pre/.test(html)) return html;
  return `<blockquote expandable>${html}</blockquote>`;
}

// An answer in the chat: the first paragraph (the point) stays open, the rest folds under it when
// it is long, so a phone screen shows the answer, not a wall of text.
export function answer(md, { fold = 700, max = LIMIT } = {}) {
  const text = String(md || '').trim();
  const cut = text.search(/\n\s*\n/);
  if (cut < 0 || text.length <= fold) return body(text, { fold, max });
  const lead = mdToHtml(text.slice(0, cut));
  let rest = mdToHtml(text.slice(cut).trim());
  if (lead.length + rest.length > max) rest = `${rest.slice(0, Math.max(0, max - lead.length)).replace(/<[^>]*$/, '')}…`;
  if (/<pre/.test(rest)) return `${lead}\n\n${rest}`;
  return `${lead}\n<blockquote expandable>${rest}</blockquote>`;
}

const quote = (text, n = 1200, expandable = true) => {
  const t = esc(String(text || '').slice(0, n)) + (String(text || '').length > n ? '…' : '');
  return `<blockquote${expandable && t.length > 280 ? ' expandable' : ''}>${t}</blockquote>`;
};

const num = (n) => (typeof n === 'number' ? n.toLocaleString('ru') : '—');
// m:ss, never split across lines on a phone.
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export { dur };

// Short tokens for long ids (reminders, notes) inside 64-byte callback data.
// Button payloads live in the database, so buttons keep working after a restart (for 60 days).
db.exec('CREATE TABLE IF NOT EXISTS bot_tokens (key TEXT PRIMARY KEY, value TEXT, at INTEGER)');
run('DELETE FROM bot_tokens WHERE at < ?', Date.now() - 60 * 86400000);
export function tok(value) {
  const key = Math.random().toString(36).slice(2, 10);
  run('INSERT OR REPLACE INTO bot_tokens (key, value, at) VALUES (?, ?, ?)', key, JSON.stringify(value), Date.now());
  return key;
}
export const untok = (key) => { const r = get('SELECT value FROM bot_tokens WHERE key = ?', key); return r ? JSON.parse(r.value) : undefined; };

// ---------- reply keyboard (main menu) ----------
export const MENU = { home: '🏠 Пульт', inbox: '📥 Входящие', today: '📅 Сегодня', sessions: '🧠 Сессии', social: '📊 Соцсети', more: '⚙️ Ещё' };
export const menuFor = (text) => Object.entries(MENU).find(([, v]) => v === text)?.[0] || null;

export function mainKeyboard(project) {
  return new Keyboard()
    .text(MENU.inbox).text(MENU.today).text(MENU.sessions).row()
    .text(MENU.social).text(MENU.more).text(MENU.home)
    // Not persistent: on a phone two rows of buttons took a third of the screen. The ▦ button
    // in the input field opens it, and it hides again after a tap.
    .resized().oneTime()
    .placeholder(`Задача для «${project.name}»`.slice(0, 64));
}

const appUrl = () => (config.publicUrl?.startsWith('https://') ? config.publicUrl : null);
// A new row only after a non-empty one: Telegram rejects empty button rows.
const newRow = (kb) => { const rows = kb.inline_keyboard; if (rows.length && rows[rows.length - 1].length) kb.row(); return kb; };
const backRow = (kb, to = 'home') => newRow(kb).text('← Пульт', `n:${to}`);

// ---------- screens: each returns { text, kb } ----------
export const currentProject = () => get('SELECT * FROM projects WHERE id = ?', kvGet('bot_project', 0)) || defaultProject();
const openItems = () => all("SELECT * FROM inbox WHERE status IN ('new','routed','error','done') ORDER BY id DESC LIMIT 8");

export function homeScreen() {
  const p = currentProject();
  const running = activeRuns().length;
  const waiting = get("SELECT COUNT(*) c FROM inbox WHERE status IN ('new','routed','error','done')").c;
  const auth = kvGet('auth_error', null);
  const dot = (ok) => (ok ? '🟢' : '🔴');
  const lines = [
    '<b>Мейнфрейм</b>',
    '',
    `📥 Ждут решения: <b>${waiting}</b>`,
    `🧠 Работает сессий: <b>${running}</b>`,
    `🎯 Команды идут в: <b>${esc(p.name)}</b>`,
    isPaused() ? '⏸ <b>Автоматика на паузе</b>' : '',
    '',
    `<blockquote>${dot(!auth)} Claude  ${dot(tgState.process === 'running')} Telegram  ${dot(mailState.status === 'running' || mailState.status === 'off')} Почта</blockquote>`,
    auth ? `⚠️ Claude не авторизован: на Mac <code>claude auth login</code>` : '',
    '<i>Пиши или говори задачу прямо сюда. Свайп по сообщению бота: ответить человеку или продолжить сессию.</i>',
  ].filter((l) => l !== '');
  const kb = new InlineKeyboard()
    .text(`📥 Входящие${waiting ? ` · ${waiting}` : ''}`, 'n:inbox').primary().text('📅 Сегодня', 'n:today').row()
    .text('🧠 Сессии', 'n:sess').text('📊 Соцсети', 'n:soc').row()
    .text('⏰ Задачи', 'n:tasks').text('⚙️ Система', 'n:sys');
  if (appUrl()) kb.row().webApp('📱 Открыть пульт', appUrl());
  return { text: lines.join('\n'), kb };
}

const SRC = (i) => (i.source === 'mail' ? '✉️' : i.source === 'group' ? '👥' : '💬');
export function inboxScreen() {
  const items = openItems();
  if (!items.length) return { text: '📥 <b>Входящие</b>\n\nВсё разобрано. Новые сообщения придут сюда карточками.', kb: backRow(new InlineKeyboard()) };
  const lines = ['📥 <b>Входящие</b> · ждут решения', ''];
  const kb = new InlineKeyboard();
  items.forEach((i, n) => {
    const d = i.decision ? JSON.parse(i.decision) : {};
    lines.push(`${n + 1}. ${SRC(i)} <b>${esc(i.name || i.chat_id)}</b> · ${tgTime(i.created_at)}`);
    lines.push(`<i>${esc(String(d.summary || i.text || '').slice(0, 140))}</i>`);
    kb.text(`${n + 1}. ${String(i.name || '').slice(0, 18)}`, `c:${i.id}`);
    if (n % 2 === 1) kb.row();
  });
  return { text: lines.join('\n'), kb: backRow(kb) };
}

const STATUS = { new: 'новое', routed: 'ждёт решения', forwarded: 'в работе', done: 'готово, ответить?', replied: 'отвечено', ignored: 'пропущено', noted: 'учтено', error: 'ошибка', sending: 'отправляю' };
const URGENT = { 'срочно': '🔴 <b>Срочно</b> · ', 'сегодня': '🟡 ', 'подождёт': '' };
const HEAD = { batch: '📦 Пакет', routed: '📥 Новое', auto_forwarded: '⚙️ Сам отправил в сессию', auto_replied: '✅ Сам ответил', run_done: '✅ Сессия закончила', run_failed: '⚠️ Сессия не справилась', error: '⚠️ Не разобрал', view: '📥' };

export function inboxCard(item, reason = 'view') {
  const d = item.decision ? JSON.parse(item.decision) : {};
  const project = item.project_id ? get('SELECT id, name FROM projects WHERE id = ?', item.project_id) : null;
  let subject = '';
  let text = item.text || '';
  if (item.source === 'mail') {
    try { subject = JSON.parse(item.meta || '{}').subject || ''; } catch { /* old row */ }
    if (subject && text.startsWith(subject)) text = text.slice(subject.length).trim();
  }
  const who = item.source === 'mail' ? (item.username ? ` · ${esc(item.username)}` : '') : item.username ? ` · @${esc(item.username)}` : '';
  // 2-3 earlier messages of the chat, so the new one reads in context.
  let before = [];
  if (item.source === 'telegram') { try { before = JSON.parse(item.meta || '{}').before || []; } catch { /* old row */ } }
  const ctxLines = before.map((m) => `<i>${m.me ? 'Ты' : esc(String(item.name || '').split(' ')[0] || 'Он')}: ${esc(m.text.length > 160 ? `${m.text.slice(0, 160)}…` : m.text)}</i>`);
  const lines = [
    `${URGENT[item.urgency] || ''}${HEAD[reason] || '📥'}${d.batch ? ` · ${d.batch.count} сообщ.` : ''} ${SRC(item)} <b>${esc(item.name || item.chat_id)}</b>${who} · ${tgTime(item.created_at)}`,
    ctxLines.length ? `<blockquote>${ctxLines.join('\n')}</blockquote>` : '',
    subject ? `<b>${esc(subject)}</b>` : '',
    quote(text),
  ];
  if (d.summary) lines.push(`💡 <i>${esc(d.summary)}</i>`);
  if (d.need) lines.push(`👉 Нужно от тебя: <b>${esc(d.need)}</b>`);
  if (d.action === 'forward' && project && ['routed', 'view'].includes(reason)) lines.push(`→ Предлагаю в <b>${esc(project.name)}</b>${typeof d.confidence === 'number' ? ` · ${Math.round(d.confidence * 100)}%` : ''}`);
  if (d.error) lines.push(`⚠️ <code>${esc(String(d.error).slice(0, 300))}</code>`);
  if (item.draft) lines.push('', `✍️ <b>Черновик ответа</b>${item.source === 'mail' ? ' (уйдёт письмом)' : ''}`, quote(item.draft, 1500, false));
  if (reason === 'view') lines.push('', `<i>Статус: ${STATUS[item.status] || item.status}</i>`);
  const open = ['new', 'routed', 'error', 'done'].includes(item.status);
  if (open) lines.push(`<i>↩️ Свайпни, чтобы ответить ${item.source === 'mail' ? 'письмом' : 'в Telegram'}.</i>`);

  const kb = new InlineKeyboard();
  if (open && item.draft) {
    kb.text('✅ Отправить черновик', `r:${item.id}`).success();
    if (item.draft.length <= 256) kb.copyText('📋 Копировать', item.draft);
    kb.row();
  }
  if (open && item.status !== 'done') {
    if (project) kb.text(`🧠 В «${project.name.slice(0, 22)}»`, `f:${item.id}:${project.id}`).primary();
    kb.text(project ? '📂 Другая' : '📂 В сессию', `pick:${item.id}`).row();
  }
  if (open) kb.text(item.status === 'done' ? 'Не отвечать' : 'Пропустить', `i:${item.id}`);
  if (reason === 'view') newRow(kb).text('← Входящие', 'n:inbox');
  return { text: lines.filter((l) => l !== '').join('\n'), kb };
}

export async function todayScreen() {
  let a;
  try { a = await agenda(); } catch (e) { return { text: `📅 <b>Сегодня</b>\n\nКалендарь недоступен: ${esc(e.message)}`, kb: backRow(new InlineKeyboard()) }; }
  const lines = ['📅 <b>Встречи на неделю</b>', ''];
  let day = '';
  for (const e of a.events) {
    const k = e.start ? new Date(e.start).toDateString() : '';
    if (k !== day) { day = k; lines.push(`<b>${e.start ? tgTime(e.start, 'wD') : 'Без даты'}</b>`); }
    lines.push(`<code>${esc(e.time || 'весь день')}</code>  ${esc(e.title)}`);
  }
  if (!a.events.length) lines.push('<i>Встреч нет</i>');
  lines.push('', '✅ <b>Напоминания</b>');
  const kb = new InlineKeyboard();
  if (!a.reminders.length) lines.push('<i>На сегодня ничего</i>');
  a.reminders.forEach((r) => {
    lines.push(`${r.kind === 'overdue' ? '🔴' : '⚪️'} ${esc(r.title)}`);
    kb.text(`✓ ${r.title.slice(0, 28)}`, `rc:${tok(r.id)}`).row();
  });
  lines.push('', '<i>Новое напоминание: напиши «напомни …», встречу: «поставь встречу …».</i>');
  return { text: lines.join('\n'), kb: backRow(kb) };
}

export function sessionsScreen() {
  const cur = currentProject();
  const running = new Set(activeRuns().map((id) => get('SELECT project_id FROM runs WHERE id = ?', id)?.project_id));
  const projects = all('SELECT p.*, (SELECT MAX(started_at) FROM runs r WHERE r.project_id = p.id) last FROM projects p ORDER BY is_default DESC, last DESC NULLS LAST');
  const lines = ['🧠 <b>Сессии</b> · куда идут команды', ''];
  const kb = new InlineKeyboard();
  projects.forEach((p) => {
    const mark = running.has(p.id) ? '🟠' : p.id === cur.id ? '🎯' : '⚪️';
    lines.push(`${mark} <b>${esc(p.name)}</b>${p.last ? ` · ${tgTime(p.last)}` : ''}`);
    kb.text(`${p.id === cur.id ? '🎯 ' : ''}${p.name.slice(0, 26)}`, `s:${p.id}`).row();
  });
  lines.push('', '<i>🎯 текущая · 🟠 работает сейчас</i>');
  return { text: lines.join('\n'), kb: backRow(kb) };
}

export function projectScreen(pid) {
  const p = get('SELECT * FROM projects WHERE id = ?', pid);
  if (!p) return sessionsScreen();
  const last = get('SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 1', pid);
  const isRunning = last && ['running', 'queued'].includes(last.status);
  const lines = [
    `🧠 <b>${esc(p.name)}</b>`,
    `<code>${esc(p.cwd.replace(/^\/Users\/[^/]+/, '~'))}</code>${p.session_id ? ` · сессия <code>${p.session_id.slice(0, 8)}</code>` : ' · новая сессия'}`,
  ];
  if (last) {
    lines.push('', `<b>Последнее</b> · ${tgTime(last.started_at)}`, quote(last.prompt, 300, false));
    if (last.result) lines.push(body(last.result, { fold: 300, max: 2500 }));
    if (isRunning) lines.push('🟠 <i>Работает…</i>');
  }
  const kb = new InlineKeyboard();
  if (currentProject().id !== p.id) kb.text('🎯 Слать команды сюда', `sel:${p.id}`).primary().row();
  kb.text('🆕 Новая сессия', `ns:${p.id}`);
  newRow(kb).text('← Сессии', 'n:sess');
  return { text: lines.join('\n'), kb };
}

const NET = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', threads: 'Threads', facebook: 'Facebook', telegram: 'Telegram' };
export async function socialScreen() {
  const lines = ['📊 <b>Соцсети</b>', ''];
  try {
    const c = await channelStats();
    if (c) {
      lines.push(`✈️ <b>${esc(c.title)}</b> · @${esc(c.username)}`,
        `<blockquote>👥 ${num(c.subscribers)}${c.subs_change_7d ? ` (${c.subs_change_7d > 0 ? '+' : ''}${c.subs_change_7d})` : ''} · 👁 ${num(c.avg_views)} на пост · охват ${c.reach_pct ?? '—'}% · ER ${c.er_pct ?? '—'}%</blockquote>`);
      const last = c.posts[0];
      if (last) lines.push(`Последний пост ${tgTime(last.date)}: 👁 ${num(last.views)} · ❤️ ${last.reactions} · 🔁 ${last.forwards}`);
    }
  } catch (e) { lines.push(`<i>Канал недоступен: ${esc(e.message)}</i>`); }
  const { report: r, running } = socialState();
  if (r) {
    lines.push('', `<b>Сводка за ${esc(r.period || 'неделю')}</b> · ${tgTime(r.generated_at)}`);
    for (const n of r.networks || []) {
      const ch = typeof n.followers_change === 'number' && n.followers_change ? ` (${n.followers_change > 0 ? '+' : ''}${n.followers_change})` : '';
      lines.push(`<b>${NET[n.network] || esc(n.network)}</b>: ${num(n.followers)}${ch}${n.views != null ? ` · 👁 ${num(n.views)}` : ''}${n.posts != null ? ` · ${num(n.posts)} публ.` : ''}`);
    }
    if (r.summary) lines.push('', `<i>${esc(r.summary)}</i>`);
    if (r.advice?.length) lines.push('', '💡 <b>Советы</b>', `<blockquote expandable>${r.advice.map((a, i) => `${i + 1}. ${esc(a)}`).join('\n\n')}</blockquote>`);
    if (r.best_times?.length) lines.push('', `🕐 ${r.best_times.map((b) => `<b>${NET[b.network] || esc(b.network)}</b>: ${b.slots.map(esc).join(', ')}`).join(' · ')}`);
  } else lines.push('', '<i>Сводки из Metricool ещё нет.</i>');
  const kb = new InlineKeyboard().text(running ? '⏳ Собираю сводку…' : '🔄 Обновить сводку', running ? 'n:soc' : 'soc:r');
  return { text: lines.join('\n'), kb: backRow(kb) };
}

export function tasksScreen() {
  const tasks = all('SELECT * FROM tasks ORDER BY id');
  const lines = ['⏰ <b>Задачи по расписанию</b>', ''];
  const kb = new InlineKeyboard();
  if (!tasks.length) lines.push('<i>Задач нет. Напиши: «каждый день в 9 присылай сводку по почте».</i>');
  tasks.forEach((t) => {
    lines.push(`${t.enabled ? '🟢' : '⚪️'} <b>${esc(t.name)}</b> · <code>${esc(t.cron)}</code>${t.last_run_at ? ` · был ${tgTime(t.last_run_at)}` : ''}`);
    kb.text(`▶ ${t.name.slice(0, 20)}`, `t:${t.id}`).text(t.enabled ? 'Выключить' : 'Включить', `tt:${t.id}`).row();
  });
  return { text: lines.join('\n'), kb: backRow(kb) };
}

export function systemScreen() {
  const auth = kvGet('auth_error', null);
  const row = (ok, name, state) => `${ok ? '🟢' : '🔴'} ${name}: ${state}`;
  const lines = [
    '⚙️ <b>Система</b>', '',
    row(!auth, 'Claude', auth ? 'нужен вход' : 'на связи'),
    row(tgState.process === 'running', 'Telegram', tgState.account || tgState.process),
    row(mailState.status !== 'error', 'Почта', mailState.status),
    row(Boolean(appUrl()), 'Mini App', appUrl() ? 'доступен' : 'нет адреса'),
    '', isPaused() ? '⏸ Автоматика на паузе: ничего не отправляется само, задачи пропускаются.' : '▶️ Автоматика включена.',
  ];
  const kb = new InlineKeyboard();
  if (isPaused()) kb.text('▶️ Включить автоматику', 'sys:resume').success();
  newRow(kb).text('⏰ Задачи', 'n:tasks');
  return { text: lines.join('\n'), kb: backRow(kb) };
}

export async function screen(name, arg) {
  switch (name) {
    case 'inbox': return inboxScreen();
    case 'today': return todayScreen();
    case 'sess': return sessionsScreen();
    case 'soc': return socialScreen();
    case 'tasks': return tasksScreen();
    case 'sys': return systemScreen();
    case 'proj': return projectScreen(Number(arg));
    default: return homeScreen();
  }
}

// ---------- live progress of a session (sendMessageDraft) ----------
// What the session is doing, in words, not tool names and file paths.
const ACTIVITY = [
  [/^(Read|NotebookRead)$/, '📖', 'Читаю файлы'],
  [/^(Grep|Glob|LS)$/, '🔎', 'Ищу в файлах'],
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, '✏️', 'Правлю'],
  [/^Bash$/, '⚙️', 'Работаю на Mac'],
  [/^(WebSearch|WebFetch)$/, '🌐', 'Ищу в интернете'],
  [/^(Agent|Task)$/, '🤝', 'Подключил помощника'],
  [/telegram/i, '💬', 'Работаю в Telegram'],
  [/apple.*(mail|reply|send)|gmail/i, '✉️', 'Смотрю почту'],
  [/apple.*(event|calendar|free_busy)|calendar/i, '📅', 'Смотрю календарь'],
  [/apple.*(note)|notion/i, '🗒', 'Смотрю заметки'],
  [/apple.*remind/i, '✅', 'Смотрю напоминания'],
  [/browser/i, '🌐', 'Работаю в браузере'],
  [/computer/i, '🖥', 'Управляю Mac'],
  [/Metricool/i, '📊', 'Смотрю соцсети'],
  [/mainframe.*(expense|balance)/i, '💸', 'Записываю в финансы'],
  [/mainframe/i, '🧩', 'Работаю с мейнфреймом'],
  [/trello/i, '📋', 'Смотрю Trello'],
];
const DOTS = ['', '.', '..', '...'];
// What a run is doing now, for the live status widget: [emoji, words].
export function activityOf(events) {
  const lastTool = [...events].reverse().find((e) => e.kind === 'tool');
  let name = '';
  if (lastTool) { try { name = JSON.parse(lastTool.content).name || ''; } catch { /* raw */ } }
  const hit = name && ACTIVITY.find(([re]) => re.test(name));
  return hit ? [hit[1], hit[2]] : name ? ['⚙️', 'Работаю'] : ['💭', 'Думаю'];
}
export function progressText(project, runRow, events, steps = 0, tick = 0) {
  const lastTool = [...events].reverse().find((e) => e.kind === 'tool');
  let name = '';
  if (lastTool) { try { name = JSON.parse(lastTool.content).name || ''; } catch { /* raw */ } }
  const hit = name && ACTIVITY.find(([re]) => re.test(name));
  const [emoji, what] = hit ? [hit[1], hit[2]] : name ? ['⚙️', 'Работаю'] : ['💭', 'Думаю'];
  const lastErr = [...events].reverse().find((e) => e.kind === 'error');
  return [
    `${emoji} <b>${what}${DOTS[tick % DOTS.length]}</b>`,
    `<i>${currentProject().id === project.id ? '' : `${esc(project.name)} · `}${dur(Date.now() - runRow.started_at)}${steps ? ` · шаг ${steps}` : ''}</i>`,
    lastErr ? '⚠️ <i>была ошибка, пробую иначе</i>' : '',
  ].filter(Boolean).join('\n');
}
