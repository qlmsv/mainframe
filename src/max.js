// MAX messenger as the owner's channel instead of Telegram (CHANNEL=max, MAX_TOKEN in .env).
// Official Bot API: https://dev.max.ru/docs-api (base https://platform-api2.max.ru, the token in the
// Authorization header, long polling GET /updates, POST /messages, inline keyboards, POST /answers).
// What works: setup in the chat, tasks by text and voice, answers (long ones split), choice and copy
// buttons, files and photos to the assistant, notifications, the mail «Отправить» button.
// What MAX does not have (Telegram only): live progress of a task, the menu and screens (Сегодня,
// Входящие, Задачи), widgets, the Mini App dashboard button, reactions, deleting the owner's messages.
import { config } from './config.js';
import { kvGet, kvSet, addLog, get } from './db.js';
import { startRun, onRunFinished } from './agent.js';
import * as chatsetup from './chatsetup.js';
import { setMailApprover, decideSend } from './mailbox.js';
import { setMainframeHandlers } from './mcp.js';
import { saveUpload, withAttachments } from './uploads.js';
import { transcribeAudio, voiceEnabled } from './voice.js';

const API = (process.env.MAX_API_URL || 'https://platform-api2.max.ru').replace(/\/$/, '');
const token = () => String(process.env.MAX_TOKEN || '').trim();
export const maxState = { status: 'off', error: null, me: null };
export const maxOwnerId = () => kvGet('owner_max_id', null);
const LIMIT = 3900;

async function call(method, path, { query = {}, body } = {}) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`${API}${path}${q.size ? `?${q}` : ''}`, {
    method, headers: { Authorization: token(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(method === 'GET' && path === '/updates' ? 100000 : 30000),
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
  // Some methods answer 200 with success: false.
  if (!r.ok || data.success === false) throw new Error(`MAX ${method} ${path}: ${data.code || r.status} ${data.message || ''}`.trim());
  return data;
}

// ---------- text: the assistant writes Telegram-flavoured Markdown, MAX has a smaller set ----------
export function toMax(md) {
  return String(md || '')
    .replace(/<details>\s*<summary>([\s\S]*?)<\/summary>/g, '**$1**').replace(/<\/details>/g, '')
    .replace(/==([^=\n]+)==/g, '**$1**')
    .replace(/!\[([^\]]+)\]\(tg:\/\/time[^)]*\)/g, '$1')
    .replace(/^\s*- \[x\]\s*/gim, '✅ ').replace(/^\s*- \[ \]\s*/gm, '⬜ ')
    // Tables are not in MAX: rows become lines, the separator row goes.
    .split('\n').filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l))
    .map((l) => (/^\s*\|.*\|\s*$/.test(l) ? l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(' · ') : l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const htmlToMax = (html) => String(html || '').replace(/<blockquote[^>]*>/g, '<blockquote>').replace(/<\/?tg-[^>]*>/g, '').replace(/<\/?(span|tg-spoiler)[^>]*>/g, '');

function chunks(text) {
  const out = [];
  let rest = text;
  while (rest.length > LIMIT) {
    let cut = rest.lastIndexOf('\n\n', LIMIT);
    if (cut < LIMIT / 2) cut = rest.lastIndexOf('\n', LIMIT);
    if (cut < LIMIT / 2) cut = LIMIT;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.length ? out : [''];
}

// Buttons: rows of { text, data } / { text, url } / { text, copy }.
const keyboard = (rows) => (rows?.length ? [{ type: 'inline_keyboard', payload: { buttons: rows.map((r) => r.map((b) => (b.url ? { type: 'link', text: b.text.slice(0, 128), url: b.url } : b.copy ? { type: 'clipboard', text: b.text.slice(0, 128), payload: b.copy.slice(0, 1024) } : { type: 'callback', text: b.text.slice(0, 128), payload: String(b.data).slice(0, 1024) }))) } }] : undefined);

export async function maxSend(userId, text, rows, format = 'markdown') {
  const parts = chunks(text);
  let last = null;
  for (let i = 0; i < parts.length; i++) {
    const res = await call('POST', '/messages', { query: { user_id: userId, disable_link_preview: true }, body: { text: parts[i], format, attachments: i === parts.length - 1 ? keyboard(rows) : undefined } });
    last = res.message?.body?.mid || null;
    if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 600)); // 2 messages a second per dialog
  }
  return last;
}
const maxEdit = (mid, text, rows, format = 'markdown') => call('PUT', '/messages', { query: { message_id: mid }, body: { text, format, attachments: rows ? keyboard(rows) : [] } });
const maxDelete = (mid) => call('DELETE', '/messages', { query: { message_id: mid } });

// grammY InlineKeyboard (from shared code like sendOwner) → MAX rows.
const fromTelegramKb = (kb) => (kb?.inline_keyboard || []).map((r) => r.map((b) => (b.url ? { text: b.text, url: b.url } : b.copy_text ? { text: b.text, copy: b.copy_text.text } : { text: b.text, data: b.callback_data })));

export async function maxSendOwner(html, extra = {}) {
  const id = maxOwnerId();
  if (!token() || !id) throw new Error('MAX не подключён или владелец не привязан');
  const mid = await maxSend(id, htmlToMax(html), fromTelegramKb(extra.reply_markup), 'html');
  return { message_id: mid };
}

// ---------- answers to the owner's tasks ----------
const tracked = new Map(); // runId → thinking message mid
const project = () => get('SELECT * FROM projects WHERE id = ?', kvGet('bot_project', 0)) || get('SELECT * FROM projects ORDER BY is_default DESC, id LIMIT 1');

function extract(text) {
  const rows = []; const copies = [];
  const body = String(text || '').split('\n').filter((line) => {
    const b = line.trim().match(/^\[\[(?:кнопки|buttons):\s*(.+?)\]\]$/i);
    if (b) { rows.push(...b[1].split('|').map((x) => x.trim()).filter(Boolean).slice(0, 6).map((x) => [{ text: x, data: `ask:${x}` }])); return false; }
    const c = line.trim().match(/^\[\[(?:копировать|copy):\s*(.+?)\s*\|\s*(.+)\]\]$/i);
    if (c) { copies.push([{ text: `📋 ${c[1].slice(0, 30)}`, copy: c[2] }]); return false; }
    return true;
  }).join('\n');
  return { body, rows: [...rows, ...copies] };
}

async function runTask(userId, text) {
  const p = project();
  if (!p) throw new Error('Нет проекта');
  const runId = startRun({ projectId: p.id, prompt: text, origin: 'bot' });
  const mid = await maxSend(userId, '💭 Думаю…').catch(() => null);
  tracked.set(runId, mid);
}

async function deliver(r) {
  const id = maxOwnerId();
  if (!id) return;
  const mid = tracked.get(r.id);
  tracked.delete(r.id);
  if (mid === undefined && (r.inbox_id || r.origin === 'ui')) return;
  if (mid === undefined && r.origin !== 'cron') return;
  const { body, rows } = extract(r.result || (r.status === 'done' ? 'Готово.' : 'Не получилось.'));
  const text = toMax(r.status === 'error' ? `⚠️ ${body}` : body) || 'Готово.';
  if (mid && text.length <= LIMIT) {
    try { await maxEdit(mid, text, rows); return; } catch { /* the thinking message is gone: send anew */ }
  }
  if (mid) await maxDelete(mid).catch(() => {});
  await maxSend(id, text, rows);
}

// ---------- incoming ----------
const port = (userId) => ({
  canDelete: false, // MAX: in a dialog a bot deletes only its own messages
  send: (text, rows) => maxSend(userId, text, rows, 'html'),
  del: async () => false,
});

async function download(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`файл не скачался (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

async function onMessage(m) {
  if (m.recipient?.chat_type && m.recipient.chat_type !== 'dialog') return; // only the private dialog
  const userId = m.sender?.user_id;
  if (!userId || m.sender?.is_bot) return;
  const text = m.body?.text || '';
  const owner = maxOwnerId();
  if (!owner) {
    if (chatsetup.chatSetupOn()) {
      if (await chatsetup.claim(port(userId), { id: userId, username: m.sender.username || m.sender.first_name }, text)) kvSet('owner_max_id', String(userId));
      return;
    }
    const code = text.replace(/^\/start\s*/, '').trim();
    if (code && code === config.pairingCode) {
      kvSet('owner_max_id', String(userId));
      addLog('system', `MAX: бот привязан к ${m.sender.first_name || userId}`);
      await maxSend(userId, '👋 **Привет! Я твой помощник.** Теперь я слушаюсь только тебя. Пиши задачи сюда текстом или голосом.');
      return;
    }
    await maxSend(userId, 'Чтобы привязать бота, пришли код привязки из установки.');
    return;
  }
  if (String(userId) !== String(owner)) return;
  if (chatsetup.chatSetupOn() && chatsetup.setupStep() !== 'done') {
    if (!text) { await maxSend(userId, 'Пока идёт настройка, ответь, пожалуйста, текстом.'); return; }
    const r = await chatsetup.onText(port(userId), text, m.body?.mid);
    if (r?.done) {
      const { ONBOARDING_PROMPT } = await import('./bot.js');
      await runTask(userId, ONBOARDING_PROMPT);
    }
    return;
  }
  // Voice: MAX may send its own transcription; otherwise our whisper.
  const atts = m.body?.attachments || [];
  const audio = atts.find((a) => a.type === 'audio');
  if (audio) {
    let heard = audio.payload?.transcription || '';
    if (!heard) {
      if (!voiceEnabled()) { await maxSend(userId, 'Голосовые сейчас не расшифровываются: напиши текстом.'); return; }
      heard = await transcribeAudio(await download(audio.payload.url), 'voice.ogg');
    }
    await maxSend(userId, `🎙 _${heard.slice(0, 500)}_`);
    return runTask(userId, `${text ? `${text}\n\n` : ''}${heard}`);
  }
  const files = [];
  for (const a of atts.filter((x) => ['image', 'file', 'video'].includes(x.type) && x.payload?.url)) {
    const name = a.payload.filename || `${a.type}-${Date.now()}.${a.type === 'image' ? 'jpg' : a.type === 'video' ? 'mp4' : 'bin'}`;
    files.push(saveUpload(name, await download(a.payload.url)));
  }
  if (!text && !files.length) return;
  return runTask(userId, files.length ? withAttachments(text, files) : text);
}

async function onCallback(u) {
  const cb = u.callback || {};
  const userId = cb.user?.user_id;
  if (!userId || String(userId) !== String(maxOwnerId())) return;
  const data = String(cb.payload || '');
  await call('POST', '/answers', { query: { callback_id: cb.callback_id }, body: { notification: '✓' } }).catch(() => {});
  if (data.startsWith('cs:')) return chatsetup.onButton(port(userId), data);
  if (data.startsWith('ask:')) return runTask(userId, data.slice(4));
  if (data.startsWith('ms:')) {
    const [, id, ok] = data.split(':');
    const { sent, m } = await decideSend(id, ok === '1');
    return maxSend(userId, sent ? `📤 Отправлено: ${m.to}, «${m.subject}»` : '🗑 Письмо отменено');
  }
  return null;
}

// ---------- start ----------
let stopping = false;
export async function startMax() {
  if (!token()) { maxState.status = 'not_configured'; return; }
  try {
    maxState.me = await call('GET', '/me');
    maxState.status = 'running';
    addLog('system', `MAX: бот ${maxState.me.name || maxState.me.username || ''} запущен`);
  } catch (e) {
    maxState.status = 'error'; maxState.error = e.message;
    addLog('error', `MAX: ${e.message}`);
    setTimeout(startMax, 60000).unref();
    return;
  }
  setMailApprover(async (id, m) => {
    await maxSendOwner(`✉️ <b>Письмо ждёт твоего «да»</b>\nКому: ${m.to}${m.cc ? `\nКопия: ${m.cc}` : ''}\nТема: ${m.subject}\n\n${String(m.body).slice(0, 3000)}`,
      { reply_markup: { inline_keyboard: [[{ text: '📤 Отправить', callback_data: `ms:${id}:1` }, { text: 'Отмена', callback_data: `ms:${id}:0` }]] } });
  });
  onRunFinished((r) => deliver(r).catch((e) => addLog('error', `MAX ответ: ${e.message}`)));
  // notify_owner from sessions: the same text with its buttons.
  setMainframeHandlers({ notify: async (md) => {
    const id = maxOwnerId();
    if (!id) throw new Error('Владелец в MAX не привязан');
    const { body, rows } = extract(String(md));
    await maxSend(id, `🔔 ${toMax(body)}`, rows);
  } });
  let marker = kvGet('max_marker', null);
  (async function loop() {
    while (!stopping) {
      try {
        const res = await call('GET', '/updates', { query: { marker, timeout: 30, limit: 100, types: 'message_created,message_callback,bot_started' } });
        for (const u of res.updates || []) {
          try {
            if (u.update_type === 'message_created') await onMessage(u.message);
            else if (u.update_type === 'message_callback') await onCallback(u);
            else if (u.update_type === 'bot_started') await onMessage({ sender: u.user, recipient: { chat_type: 'dialog' }, body: { text: `/start ${u.payload || ''}`.trim() } });
          } catch (e) { addLog('error', `MAX: ${e.message}`); }
        }
        if (res.marker !== undefined && res.marker !== null) { marker = res.marker; kvSet('max_marker', marker); }
        maxState.status = 'running'; maxState.error = null;
      } catch (e) {
        maxState.status = 'error'; maxState.error = e.message;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
}
export const stopMax = () => { stopping = true; };
export const maxConfigured = () => Boolean(token());
