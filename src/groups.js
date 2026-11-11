// Work groups → inbox. Polls each watched group for new messages and turns a
// run of messages into one inbox card. "mentions" groups only pass messages addressed to
// the owner (a bot floods the back-office group with service posts).
import { config } from './config.js';
import { kvGet, kvSet, addLog } from './db.js';
import { tgCall, tgState } from './telegram-mcp.js';

// Set from the dashboard or by a session (kv watch_groups); nothing is watched by default.
export const DEFAULT_GROUPS = [];
export const watchedGroups = () => kvGet('watch_groups', DEFAULT_GROUPS);

let timer = null;
let busy = false;

export function watchGroups(onBatch, everyMs = 60000) {
  const tick = async () => {
    if (busy || !['running', 'external'].includes(tgState.process)) return;
    busy = true;
    try {
      const last = kvGet('groups_last', {});
      for (const g of watchedGroups()) {
        const key = String(g.id);
        let data;
        try {
          data = await tgCall('get_messages_after', last[key] ? { chat_id: g.id, after_id: last[key], limit: 50 } : { chat_id: g.id, limit: 1 });
        } catch (e) { addLog('error', `Группа ${g.title}: ${e.message.slice(0, 150)}`); continue; }
        const msgs = Array.isArray(data?.messages) ? data.messages : [];
        if (!msgs.length) continue;
        const maxId = Math.max(...msgs.map((m) => m.id));
        // First look at a group: start from now, not from its history.
        if (!last[key]) { last[key] = maxId; kvSet('groups_last', last); continue; }
        last[key] = maxId;
        kvSet('groups_last', last);
        const keep = msgs.filter((m) => !m.out && !m.action && (m.text || m.media) && !(g.skip || []).includes(m.sender) && (g.mode === 'all' || m.addressed || m.mentioned || (config.owner.username && new RegExp(`@${config.owner.username}\\b`, 'i').test(m.text || ''))));
        if (!keep.length) continue;
        const topics = data.topics || {};
        await onBatch({ group: g, messages: keep.map((m) => ({ id: m.id, sender: m.sender || 'Без имени', username: m.username || null, text: m.text || (m.transcript ? `🎤 ${m.transcript}` : `[${m.media}]`), topic: topics[String(m.topic)] || null, date: m.date })) });
      }
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 15000);
  timer = setInterval(tick, everyMs);
  timer.unref();
}

export const stopGroups = () => clearInterval(timer);
