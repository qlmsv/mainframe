// Failures should not drown in the journal. Important ones (a bot message that never left,
// indexing down, a session that failed, the Mac gone for 30+ minutes) reach the owner at once,
// one line, at most once per 30 minutes per kind. Everything else: one short digest at 21:00.
import { Cron } from 'croner';
import { all, get, kvGet, kvSet } from './db.js';
import { config } from './config.js';
import { macOnline } from './agent.js';

const THROTTLE_MS = 30 * 60000;
const MAC_DOWN_MS = 30 * 60000;

const KINDS = [
  { key: 'bot', title: 'Бот не отправил сообщение', re: /^(Уведомление|onRunFinished|Бот|Память, карточка|Карточка дня):.*(send|failed|Forbidden|blocked)|^Бот не запустился/i },
  { key: 'index', title: 'Сбой индексации поиска', re: /^Поиск по (смыслу|истории)/i },
  { key: 'session', title: 'Ошибка сессии', re: /^Запуск \d+:|^onRunFinished:/i },
];

// Same error, different ids and numbers: one group.
export const errorKey = (msg) => String(msg || '')
  .replace(/\d+/g, '#')
  .replace(/«[^»]*»|"[^"]*"/g, '…')
  .slice(0, 70);

const kindOf = (msg) => KINDS.find((k) => k.re.test(msg));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const esc = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function group(rows) {
  const g = new Map();
  for (const r of rows) {
    const k = errorKey(r.message);
    const x = g.get(k) || { sample: r.message, n: 0 };
    x.n++;
    g.set(k, x);
  }
  return [...g.values()].sort((a, b) => b.n - a.n);
}

export function startAlerts(send) {
  const notify = (text) => send(text).catch(() => {}); // a failed alert must not log another error
  if (kvGet('alerts_last_log', null) == null) kvSet('alerts_last_log', get('SELECT MAX(id) m FROM log')?.m || 0);
  if (kvGet('alerts_last_run', null) == null) kvSet('alerts_last_run', get('SELECT MAX(id) m FROM runs')?.m || 0);

  async function tick() {
    const sent = kvGet('alerts_sent', {});
    const due = (key) => Date.now() - (sent[key] || 0) > THROTTLE_MS;
    const lastLog = kvGet('alerts_last_log', 0);
    const rows = all("SELECT id, message FROM log WHERE id > ? AND kind = 'error' ORDER BY id", lastLog);
    const maxLog = get('SELECT MAX(id) m FROM log')?.m || lastLog;
    const byKind = new Map();
    for (const r of rows) {
      const k = kindOf(r.message);
      if (k) byKind.set(k.key, [...(byKind.get(k.key) || []), r]);
    }
    // Sessions that ended with an error (not stopped by hand).
    const lastRun = kvGet('alerts_last_run', 0);
    const failed = all("SELECT r.id, r.result, p.name FROM runs r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id > ? AND r.status = 'error' AND r.finished_at IS NOT NULL ORDER BY r.id", lastRun);
    const doneUpTo = get("SELECT MAX(id) m FROM runs WHERE id > ? AND status NOT IN ('queued','running')", lastRun)?.m;
    const openRun = get("SELECT MIN(id) m FROM runs WHERE id > ? AND status IN ('queued','running')", lastRun)?.m;
    // Move the run cursor only past finished runs, so a long one is checked when it ends.
    const runCursor = openRun ? openRun - 1 : (doneUpTo || lastRun);
    for (const f of failed) {
      if (openRun && f.id > openRun) continue;
      byKind.set('session', [...(byKind.get('session') || []), { message: `${f.name || 'Проект'}: ${String(f.result || '').replace(/\s+/g, ' ')}` }]);
    }
    for (const k of KINDS) {
      const list = byKind.get(k.key);
      if (!list?.length || !due(k.key)) continue;
      const g = group(list);
      const more = g.length > 1 ? ` (+ ещё ${g.length - 1} вида)` : '';
      notify(`⚠️ <b>${k.title}</b>${list.length > 1 ? ` ×${list.length}` : ''}: ${esc(clip(g[0].sample, 160))}${more}`);
      sent[k.key] = Date.now();
    }
    // The Mac: silent for 30+ minutes.
    if (config.macRunner) {
      const up = await macOnline();
      const st = kvGet('alerts_mac', { downSince: null, told: false });
      if (up) {
        if (st.told) notify(`✅ Mac снова на связи (не было ${Math.round((Date.now() - st.downSince) / 60000)} мин).`);
        kvSet('alerts_mac', { downSince: null, told: false });
      } else {
        const downSince = st.downSince || Date.now();
        let told = st.told;
        if (!told && Date.now() - downSince > MAC_DOWN_MS && due('mac')) {
          notify('⚠️ Mac не отвечает больше 30 минут: задачи с файлами на Mac, голос и почта ждут. Проверь, что он включён и на зарядке.');
          sent.mac = Date.now();
          told = true;
        }
        kvSet('alerts_mac', { downSince, told });
      }
    }
    kvSet('alerts_sent', sent);
    kvSet('alerts_last_log', maxLog);
    kvSet('alerts_last_run', runCursor);
  }

  // Once a day: the rest, grouped, only if something broke.
  function digest() {
    const since = Date.now() - 86400000;
    const rows = all("SELECT message FROM log WHERE kind = 'error' AND created_at > ?", since).filter((r) => !kindOf(r.message));
    if (!rows.length) return;
    const g = group(rows);
    const lines = g.slice(0, 8).map((x) => `- ${esc(clip(x.sample, 110))}${x.n > 1 ? ` ×${x.n}` : ''}`);
    if (g.length > 8) lines.push(`- и ещё ${g.length - 8} видов, всего ${rows.length} ошибок`);
    notify(`🧾 <b>Что сломалось за день</b> · ошибок: ${rows.length}\n${lines.join('\n')}`);
  }

  setInterval(() => tick().catch(() => {}), 60000).unref();
  new Cron('0 21 * * *', { protect: true }, digest);
  return { tick, digest };
}
