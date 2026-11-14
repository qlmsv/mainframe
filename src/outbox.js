// Sends to the outside world that the mainframe makes itself (a letter after «Отправить», a reply
// from «Входящие», a post «Сейчас»):
//   - a repeat key: hash(channel, recipient, text) + run id. The same key within 24 hours is not sent
//     again, the earlier result comes back (double taps, retries after a restart);
//   - an undo window: after the button the send waits SEND_UNDO_SEC seconds (default 15) with an
//     «Отменить» button. The pending send is a row in the database, so a restart does not lose it.
// Not covered: what a session sends directly through the telegram MCP server (an outside Python
// process) or other MCP tools; those go through the owner's «да» in the conversation instead.
import crypto from 'node:crypto';
import { config } from './config.js';
import { get, run, all, now, addLog } from './db.js';
import { bus } from './bus.js';

const DAY = 86400000;
const executors = {}; // kind -> async (payload) => result
export const registerSender = (kind, fn) => { executors[kind] = fn; };

export const sendKey = (channel, target, text, runId = null) => crypto.createHash('sha256')
  .update(`${channel}\n${target}\n${String(text || '').replace(/\s+/g, ' ').trim()}\n${runId ?? ''}`).digest('hex').slice(0, 32);

// The earlier send with this key in the last 24 hours (sent or about to be).
export function previousSend(key) {
  return get("SELECT * FROM outbox WHERE key = ? AND status IN ('pending', 'sending', 'sent') AND created_at > ? ORDER BY id DESC LIMIT 1", key, Date.now() - DAY);
}

// Send once per key: a repeat returns the earlier result instead of sending again.
export async function sendOnce({ kind, channel, target, text, runId = null, payload = {} }, fn) {
  const key = sendKey(channel, target, text, runId);
  const prev = previousSend(key);
  if (prev?.status === 'sent') {
    addLog('system', `Повтор отправки (${channel} → ${target}) за сутки не отправляю`);
    return { ...(prev.result ? JSON.parse(prev.result) : {}), repeated: true };
  }
  if (prev && prev.status !== 'pending') throw new Error('Это уже отправляется');
  const id = prev?.id || Number(run('INSERT INTO outbox (key, kind, channel, target, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    key, kind, channel, String(target || ''), JSON.stringify(payload), 'sending', now()).lastInsertRowid);
  run("UPDATE outbox SET status = 'sending' WHERE id = ?", id);
  try {
    const result = await fn();
    run("UPDATE outbox SET status = 'sent', result = ?, done_at = ? WHERE id = ?", JSON.stringify(result ?? {}), now(), id);
    return result;
  } catch (e) {
    run("UPDATE outbox SET status = 'failed', error = ?, done_at = ? WHERE id = ?", e.message.slice(0, 300), now(), id);
    throw e;
  }
}

// ---------- the undo window ----------
const timers = new Map();
// Queue a send for SEND_UNDO_SEC seconds. Returns { id, dueAt, repeated } (repeated: the same key is
// already pending or sent, nothing new is queued).
export function queueSend({ kind, channel, target, text, runId = null, payload, delaySec = config.sendUndoSec }) {
  if (!executors[kind]) throw new Error(`Нет отправщика ${kind}`);
  const key = sendKey(channel, target, text, runId);
  const prev = previousSend(key);
  if (prev) return { id: prev.id, dueAt: prev.due_at, repeated: true, status: prev.status };
  const dueAt = Date.now() + delaySec * 1000;
  const id = Number(run('INSERT INTO outbox (key, kind, channel, target, payload, status, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    key, kind, channel, String(target || ''), JSON.stringify(payload ?? {}), 'pending', dueAt, now()).lastInsertRowid);
  arm(id, dueAt);
  bus.change('outbox', id);
  return { id, dueAt, repeated: false };
}
export function attachMessage(id, chatId, messageId) {
  run('UPDATE outbox SET chat_id = ?, message_id = ? WHERE id = ?', String(chatId), messageId, id);
}

const listeners = new Set(); // fn(row) after a queued send finished (sent, failed)
export const onSendDone = (fn) => listeners.add(fn);

function arm(id, dueAt) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => fire(id).catch(() => {}), Math.max(0, dueAt - Date.now())));
}
async function fire(id) {
  timers.delete(id);
  // Claim the row: a cancel or a second process can't send it twice.
  if (!run("UPDATE outbox SET status = 'sending' WHERE id = ? AND status = 'pending'", id).changes) return;
  const row = get('SELECT * FROM outbox WHERE id = ?', id);
  try {
    const result = await executors[row.kind](JSON.parse(row.payload || '{}'));
    run("UPDATE outbox SET status = 'sent', result = ?, done_at = ? WHERE id = ?", JSON.stringify(result ?? {}), now(), id);
  } catch (e) {
    run("UPDATE outbox SET status = 'failed', error = ?, done_at = ? WHERE id = ?", e.message.slice(0, 300), now(), id);
    addLog('error', `Отправка (${row.channel} → ${row.target}): ${e.message.slice(0, 200)}`);
  }
  bus.change('outbox', id);
  const done = get('SELECT * FROM outbox WHERE id = ?', id);
  for (const fn of listeners) Promise.resolve().then(() => fn(done)).catch(() => {});
}

export function cancelSend(id) {
  const ok = run("UPDATE outbox SET status = 'cancelled', done_at = ? WHERE id = ? AND status = 'pending'", now(), Number(id)).changes;
  clearTimeout(timers.get(Number(id)));
  timers.delete(Number(id));
  bus.change('outbox', Number(id));
  return Boolean(ok);
}
export const getSend = (id) => get('SELECT * FROM outbox WHERE id = ?', Number(id));

// After a restart: pending sends wait out their window (or go at once, if it already passed).
// A send cut off mid-way ('sending') is not repeated blindly: it is marked for the owner to check.
export function resumeOutbox() {
  for (const r of all("SELECT id, due_at FROM outbox WHERE status = 'pending'")) arm(r.id, r.due_at || Date.now());
  const cut = run("UPDATE outbox SET status = 'failed', error = 'Прервано перезапуском: проверь, ушло ли' WHERE status = 'sending'").changes;
  if (cut) addLog('error', `Отправка: ${cut} прервано перезапуском, проверь, ушло ли`);
  run('DELETE FROM outbox WHERE created_at < ?', Date.now() - 30 * DAY);
}
