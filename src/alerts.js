// Failures should not drown in the journal. Only what needs the owner reaches him at once (one
// line, at most once per 30 minutes per kind): the bot cannot send, a site is down, payments
// broke, the Mac silent for 2+ hours in the daytime. Everything else (failed sessions, search
// indexing...) goes into the evening message (alertsDigest), or a digest at 21:00 without one.
import { Cron } from 'croner';
import { all, get, kvGet, kvSet } from './db.js';
import { config } from './config.js';
import { macOnline } from './agent.js';

const THROTTLE_MS = 30 * 60000;
const MAC_DOWN_MS = 2 * 3600000;
const DAY_HOURS = [9, 22]; // the Mac's silence matters only while the owner is up (local time)
const SITE_FAILS = 3; // a site counts as down after this many failed checks in a row (5 min apart)

// Sent at once. The rest of the errors wait for the evening.
const KINDS = [
  { key: 'bot', title: 'Бот не отправил сообщение', re: /^(Уведомление|onRunFinished|Бот|Память, карточка|Карточка дня):.*(send|failed|Forbidden|blocked)|^Бот не запустился/i },
  { key: 'pay', title: 'Сбой оплаты', re: /^(Оплата|Платёж|Payment)[^:]*:/i }, // modules log payment failures with this prefix
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
    for (const k of KINDS) {
      const list = byKind.get(k.key);
      if (!list?.length || !due(k.key)) continue;
      const g = group(list);
      const more = g.length > 1 ? ` (+ ещё ${g.length - 1} вида)` : '';
      notify(`⚠️ <b>${k.title}</b>${list.length > 1 ? ` ×${list.length}` : ''}: ${esc(clip(g[0].sample, 160))}${more}`);
      sent[k.key] = Date.now();
    }
    // Sites (kv alerts_urls): down for several checks in a row.
    const urls = kvGet('alerts_urls', []);
    if (urls.length && new Date().getMinutes() % 5 === 0) {
      const st = kvGet('alerts_sites', {});
      for (const u of urls) {
        const ok = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) }).then((r) => r.status < 500).catch(() => false);
        const s = st[u] || { fails: 0, told: false };
        if (ok) {
          if (s.told) notify(`✅ Сайт снова открывается: ${esc(u)}`);
          st[u] = { fails: 0, told: false };
        } else {
          s.fails++;
          if (s.fails >= SITE_FAILS && !s.told) { notify(`⚠️ <b>Сайт не открывается</b> ${s.fails * 5} мин: ${esc(u)}`); s.told = true; }
          st[u] = s;
        }
      }
      kvSet('alerts_sites', st);
    }
    // The Mac: silent for 2+ hours while the owner is up.
    const h = new Date().getHours();
    if (config.macRunner) {
      const up = await macOnline();
      const st = kvGet('alerts_mac', { downSince: null, told: false });
      if (up) {
        if (st.told) notify(`✅ Mac снова на связи (не было ${Math.round((Date.now() - st.downSince) / 60000)} мин).`);
        kvSet('alerts_mac', { downSince: null, told: false });
      } else {
        const downSince = st.downSince || Date.now();
        let told = st.told;
        if (!told && Date.now() - downSince > MAC_DOWN_MS && h >= DAY_HOURS[0] && h < DAY_HOURS[1] && due('mac')) {
          notify('⚠️ Mac не отвечает больше 2 часов: задачи с файлами на Mac, голос и почта ждут. Проверь, что он включён и на зарядке.');
          sent.mac = Date.now();
          told = true;
        }
        kvSet('alerts_mac', { downSince, told });
      }
    }
    kvSet('alerts_sent', sent);
    kvSet('alerts_last_log', maxLog);
  }

  // Without an evening digest task: the day's failures as their own message at 21:00.
  function digest() {
    if (kvGet('digest_tasks', {}).evening) return;
    const d = dayFailures();
    if (d) notify(`🧾 <b>Что сломалось за день</b> · ${d.total}\n${d.lines.map((l) => `- ${esc(l)}`).join('\n')}`);
  }

  setInterval(() => tick().catch(() => {}), 60000).unref();
  new Cron('0 21 * * *', { protect: true }, digest);
  return { tick, digest };
}

// The last 24 hours: errors that did not ring at once, and sessions that ended with an error.
function dayFailures() {
  const since = Date.now() - 86400000;
  const rows = all("SELECT message FROM log WHERE kind = 'error' AND created_at > ?", since).filter((r) => !kindOf(r.message));
  const failed = all("SELECT r.result, p.name FROM runs r LEFT JOIN projects p ON p.id = r.project_id WHERE r.status = 'error' AND r.finished_at > ?", since)
    .map((f) => ({ message: `Сессия «${f.name || 'Проект'}»: ${String(f.result || '').replace(/\s+/g, ' ')}` }));
  const allRows = [...failed, ...rows];
  if (!allRows.length) return null;
  const g = group(allRows);
  const lines = g.slice(0, 8).map((x) => `${clip(x.sample.replace(/<[^>]+>/g, ''), 110)}${x.n > 1 ? ` ×${x.n}` : ''}`);
  if (g.length > 8) lines.push(`и ещё ${g.length - 8} видов`);
  return { total: `ошибок: ${allRows.length}`, lines };
}

// A folded block for the evening message (Telegram rich Markdown).
export function alertsDigest() {
  const d = dayFailures();
  if (!d) return '';
  return `<details><summary>⚠️ Сбои за день, ${d.total}</summary>\n\n${d.lines.map((l) => `- ${l.replace(/[<>]/g, ' ')}`).join('\n')}\n\n</details>`;
}
