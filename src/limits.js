// When the Claude subscription stops answering.
//   Limit («You've hit your 5-hour limit · resets 9:50pm»): runs wait for the reset (deferred_runs in the
//   database, so a restart keeps them) and continue by themselves; the owner hears one line once.
//   Payment or login («payment is past due», «Please run /login»): one urgent line at most every 3 hours
//   (src/alerts.js, kind «claude»); after BREAKER_FAILS such errors in a row the breaker opens: scheduled
//   and other background work pauses instead of failing in a loop, and a cheap request checks every
//   BREAKER_PROBE_MIN minutes whether Claude answers again.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from './config.js';
import { kvGet, kvSet, addLog, now } from './db.js';
import { bus } from './bus.js';
import { sessionEnv, resolveModel, isClaude } from './models.js';

export const LIMIT_RE = /hit your [\w -]*limit|usage limit|limit reached|out of (?:extra )?usage/i;
export const ACCESS_RE = /payment is past due|past due|can't use your Claude subscription|cannot use your Claude subscription|settings\/billing|subscription (?:has )?(?:expired|ended|is inactive|was cancel)|Failed to authenticate|OAuth session expired|login reached its time limit|Invalid API key|Please run \/login/i;

export function failureKind(text) {
  const t = String(text || '');
  if (ACCESS_RE.test(t)) return 'access';
  if (LIMIT_RE.test(t)) return 'limit';
  return null;
}

// ---------- the reset time from the message ----------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function partsIn(tz, t) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, mo: p.month - 1, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}
// Wall-clock time in a zone to a timestamp.
function zoned(tz, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo, d, h, mi);
  const p = partsIn(tz, guess);
  const offset = Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - guess;
  return guess - offset;
}
export function parseReset(text, t0 = Date.now()) {
  const s = String(text || '');
  const unix = /limit reached\|(\d{10})/i.exec(s);
  if (unix) return Number(unix[1]) * 1000;
  const m = /resets?\s+(?:at\s+|on\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i.exec(s);
  if (!m) return null;
  let tz = m[6] || config.timezone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = config.timezone || 'UTC'; }
  let h = Number(m[3]);
  const mi = Number(m[4] || 0);
  if (m[5]) { const pm = m[5].toLowerCase() === 'pm'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || mi > 59) return null;
  const today = partsIn(tz, t0);
  const mon = m[1] ? MONTHS[m[1].toLowerCase()] : undefined;
  if (mon !== undefined) {
    let at = zoned(tz, today.y, mon, Number(m[2]), h, mi);
    if (at < t0 - 86400000) at = zoned(tz, today.y + 1, mon, Number(m[2]), h, mi);
    return at;
  }
  let at = zoned(tz, today.y, today.mo, today.d, h, mi);
  if (at <= t0) at += 86400000;
  return at;
}

const hm = (t) => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (t) => (new Date(t).toDateString() === new Date().toDateString() ? hm(t) : `${new Date(t).toLocaleDateString('ru', { day: 'numeric', month: 'long' })}, ${hm(t)}`);
export { dayLabel as whenLabel };

// ---------- limit ----------
// Returns { until, first }: first is true when this is news (the owner has not been told yet).
export function noteLimit(text, resetAt = null) {
  const reset = resetAt || parseReset(text);
  // A minute or two after the reset; without a time in the message, try again in 30 minutes.
  const until = (reset && reset > Date.now() ? reset : Date.now() + 30 * 60000) + 90000;
  const st = kvGet('claude_limit', {});
  const first = !(st.until && Date.now() < st.until && st.told);
  kvSet('claude_limit', { until, told: true, at: now() });
  if (first) addLog('system', `Лимит подписки Claude: продолжу в ${dayLabel(until)}`);
  bus.change('claude_health');
  return { until, first };
}
export function limitUntil() {
  const st = kvGet('claude_limit', {});
  return st.until && Date.now() < st.until ? st.until : 0;
}

// ---------- payment / login: the breaker ----------
const breaker = () => kvGet('claude_breaker', { fails: 0, open: false });
export const breakerOpen = () => Boolean(breaker().open);
export function noteAccessFailure(text) {
  const b = breaker();
  b.fails = (b.fails || 0) + 1;
  b.last = String(text || '').slice(0, 200);
  // alerts.js sends this kind of line at once, at most every 3 hours.
  addLog('error', `Claude недоступен: подписка не работает (оплата или вход). ${b.last}`);
  if (!b.open && b.fails >= config.breakerFails) {
    b.open = true; b.since = now(); b.lastProbe = now();
    addLog('system', `Предохранитель: ${b.fails} ошибки подписки подряд, фоновые задачи на паузе до восстановления (проверка раз в ${config.breakerProbeMin} мин)`);
  }
  kvSet('claude_breaker', b);
  bus.change('claude_health');
  return b;
}
const recovered = new Set();
export const onClaudeRecovered = (fn) => recovered.add(fn);
export function noteSuccess() {
  const b = breaker();
  const lim = kvGet('claude_limit', {});
  if (lim.until && Date.now() >= lim.until) kvSet('claude_limit', {});
  if (!b.fails && !b.open) return;
  const wasOpen = b.open;
  kvSet('claude_breaker', { fails: 0, open: false });
  if (wasOpen) {
    addLog('system', `Предохранитель снят: Claude снова отвечает (пауза ${Math.round((Date.now() - (b.since || Date.now())) / 60000)} мин)`);
    for (const fn of recovered) Promise.resolve().then(() => fn(b)).catch(() => {});
  }
  bus.change('claude_health');
}

// One cheap request: does the subscription answer?
export async function probeClaude() {
  const options = {
    model: resolveModel(config.dispatchModel || 'haiku'), maxTurns: 1, persistSession: false, settingSources: [], tools: [], allowedTools: [],
    systemPrompt: 'Ответь одним словом.', permissionMode: 'dontAsk',
  };
  const env = sessionEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: 'false' });
  if (env && !isClaude()) options.env = env;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60000);
  options.abortController = ac;
  let ok = false; let err = '';
  try {
    for await (const m of query({ prompt: 'ок?', options })) {
      if (m.type === 'result') { ok = m.subtype === 'success' && !m.is_error; if (!ok) err = m.result || m.subtype; }
    }
  } catch (e) { err = e.message; } finally { clearTimeout(timer); }
  return { ok, err };
}

let probing = false;
export function startBreakerProbe() {
  setInterval(async () => {
    const b = breaker();
    if (!b.open || probing || Date.now() - (b.lastProbe || 0) < config.breakerProbeMin * 60000) return;
    probing = true;
    try {
      kvSet('claude_breaker', { ...b, lastProbe: now() });
      const r = await probeClaude();
      if (r.ok) noteSuccess();
      else addLog('system', `Предохранитель: Claude всё ещё не отвечает (${String(r.err).slice(0, 120)})`);
    } finally { probing = false; }
  }, 60000).unref();
}

// For the dashboard and the session's context.
export function healthState() {
  const b = breaker();
  return { limitUntil: limitUntil() || null, breaker: b.open ? { since: b.since, fails: b.fails, last: b.last } : null };
}
