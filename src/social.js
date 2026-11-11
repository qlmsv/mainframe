// Social: the Telegram channel live (through the account, free) and a daily Metricool
// report that a scheduled Claude session writes with the save_social_report tool
// (Metricool is a claude.ai connector, so only a session can reach it).
import { config } from './config.js';
import { get, run, now, kvGet, kvSet, addLog } from './db.js';
import { bus } from './bus.js';
import { tgCall } from './telegram-mcp.js';
import { createTask, fireTask } from './scheduler.js';
import { onRunFinished } from './agent.js';

const channelName = () => config.social.channel;

let cache = { at: 0, data: null };
export async function channelStats(force = false) {
  if (!config.tg.enabled || !channelName()) return null;
  if (!force && cache.data && Date.now() - cache.at < 5 * 60000) return cache.data;
  // Stale but present: answer at once with it and refresh in the background (the dashboard waited 2 s).
  if (!force && cache.data && !cache.refreshing) {
    cache.refreshing = true;
    channelStats(true).catch(() => {}).finally(() => { cache.refreshing = false; });
    return cache.data;
  }
  if (!force && cache.data) return cache.data;
  const ch = channelName();
  const [full, msgs] = await Promise.all([
    tgCall('get_full_chat', { chat_id: ch }),
    tgCall('list_messages', { chat_id: ch, limit: 15 }),
  ]);
  const posts = (msgs?.results || []).map((m) => ({
    id: m.id,
    date: m.date ? Date.parse(m.date) : null,
    text: String(m.text || (m.media ? `[${m.media}]` : '')).slice(0, 280),
    media: m.media || null,
    views: m.engagement?.views ?? null,
    reactions: m.engagement?.reactions ?? 0,
    forwards: m.engagement?.forwards ?? 0,
    comments: m.comments ?? 0,
    link: full?.username ? `https://t.me/${full.username}/${m.id}` : null,
  }));
  const withViews = posts.filter((p) => typeof p.views === 'number');
  const avgViews = withViews.length ? Math.round(withViews.reduce((s, p) => s + p.views, 0) / withViews.length) : null;
  const subs = full?.participants_count ?? null;
  const reach = avgViews && subs ? Math.round((avgViews / subs) * 100) : null;
  const er = withViews.length ? Math.round((withViews.reduce((s, p) => s + p.reactions + p.forwards + p.comments, 0) / Math.max(1, withViews.reduce((s, p) => s + p.views, 0))) * 1000) / 10 : null;
  // Subscriber history: one point per day, so the tab can show the trend.
  const hist = kvGet('channel_history', []);
  const day = new Date().toISOString().slice(0, 10);
  if (subs !== null && hist[hist.length - 1]?.day !== day) { hist.push({ day, subs }); kvSet('channel_history', hist.slice(-120)); }
  const weekAgo = hist.find((h) => h.day >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  cache = {
    at: Date.now(),
    data: { title: full?.title, username: full?.username, about: full?.about, subscribers: subs, subs_change_7d: weekAgo && subs !== null && weekAgo.day !== day ? subs - weekAgo.subs : null, avg_views: avgViews, reach_pct: reach, er_pct: er, posts },
  };
  return cache.data;
}

const REPORT_PROMPT = () => `Собери сводку по соцсетям владельца и сохрани её инструментом mainframe save_social_report. Только чтение: ничего не публикуй, не планируй и не меняй.

1. Если подключён коннектор Metricool (инструменты getBrandSettings и др.; если его нет, пропусти пункты 1-3): getBrandSettings даст brandId и timezone. Для каждой подключённой сети (instagram, tiktok, youtube, threads, facebook) возьми последние 7 дней и предыдущие 7 дней: подписчиков (последнее значение), прирост за неделю, просмотры или охват, число публикаций, вовлечённость. Метрики ищи через getAnalyticsAvailableMetrics (connector evolution), данные через getAnalyticsDataByMetrics. Сеть без данных оставь с note.
2. Лучшее время публикаций на ближайшие 7 дней: getBestTimeToPostByNetwork для instagram и tiktok, по 3 лучших слота.
3. Запланированные посты на 7 дней вперёд: getScheduledPosts.
4. Telegram-канал @${channelName()} (если он задан в SOCIAL_TG_CHANNEL): get_full_chat и list_messages (последние 15 постов). Подписчики, средние просмотры, какие посты сработали лучше и хуже.
5. 3-5 советов: конкретно, из цифр (что публиковать, где и когда, что повторить, от чего отказаться). Без общих слов и без длинных тире.

Числа передавай числами. В конце коротко напиши итог.`;

export function ensureSocialTask() {
  let pid = kvGet('social_project_id', null);
  if (!pid || !get('SELECT id FROM projects WHERE id = ?', pid)) {
    pid = Number(run('INSERT INTO projects (name, cwd, description, created_at) VALUES (?, ?, ?, ?)', 'Соцсети', config.workspaceDir, 'Ежедневная сводка по соцсетям: Metricool и Telegram-канал', now()).lastInsertRowid);
    kvSet('social_project_id', pid);
  }
  let tid = kvGet('social_task_id', null);
  if (!tid || !get('SELECT id FROM tasks WHERE id = ?', tid)) {
    tid = createTask({ name: 'Сводка по соцсетям', cron: '0 9 * * *', prompt: REPORT_PROMPT(), project_id: pid });
    kvSet('social_task_id', tid);
  }
  return { pid, tid };
}

// Each report starts a fresh session: yesterday's numbers must not pile up in the context.
onRunFinished((r) => {
  const pid = kvGet('social_project_id', null);
  const briefs = get("SELECT id FROM projects WHERE name = 'Сводки'")?.id;
  if ((pid && r.project_id === pid) || (briefs && r.project_id === briefs)) run('UPDATE projects SET session_id = NULL WHERE id = ?', r.project_id);
});

export function refreshReport() {
  const { tid } = ensureSocialTask();
  return fireTask(tid, true);
}

export function saveReport(report) {
  kvSet('social_report', { ...report, generated_at: Date.now() });
  addLog('system', 'Сводка по соцсетям обновлена');
  bus.change('social');
}

export function socialState() {
  const { pid, tid } = ensureSocialTask();
  const running = get("SELECT id FROM runs WHERE project_id = ? AND status IN ('running', 'queued') ORDER BY id DESC LIMIT 1", pid);
  return { report: kvGet('social_report', null), taskId: tid, projectId: pid, running: Boolean(running) };
}
