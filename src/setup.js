// First-run wizard in the browser: https://<server>/setup. No terminal needed.
// It is on only while SETUP_CODE is set in .env (the secret phrase the owner wrote into the server's
// start script) and the setup is not finished. After «Готово» it switches itself off for good.
// Steps: who you are and the time zone, the model (Claude login or a provider key), the Telegram bot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, config } from './config.js';
import { kvGet, kvSet, addLog } from './db.js';
import { modelState, saveModelSettings, testModel } from './models.js';
import { currentMode, MODES } from './modes.js';

const ENV_FILE = path.join(ROOT, '.env');
const code = () => String(process.env.SETUP_CODE || '').trim();
export const setupOpen = () => Boolean(code()) && !kvGet('setup_done', false);

function writeEnv(pairs) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${String(v).replace(/[\r\n]/g, '')}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
    process.env[k] = String(v);
  }
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

// ---------- access: the phrase from the start script, a few tries, then a session cookie ----------
const sessions = new Set();
const tries = new Map(); // ip -> { n, at }
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function setupLogin(ip, phrase) {
  if (!setupOpen()) throw new Error('Настройка уже завершена');
  // The phrase from the template, left unchanged, is public (it is in the repo): not a lock at all.
  if (norm(code()) === 'придумай свою фразу' || norm(code()).length < 6) throw new Error('Фраза в SETUP_CODE осталась из примера или слишком короткая. Её знают все, поэтому мастер закрыт. Пересоздай сервер со своей фразой (3–4 слова)');
  const t = tries.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 10 * 60000) { t.n = 0; t.at = Date.now(); }
  if (t.n >= 6) throw new Error('Слишком много попыток. Подожди 10 минут');
  t.n++; tries.set(ip, t);
  if (!safeEq(norm(phrase), norm(code()))) throw new Error('Не то слово. Это фраза, которую ты вписал в SETUP_CODE при создании сервера');
  const s = crypto.randomBytes(24).toString('hex');
  sessions.add(s);
  addLog('system', 'Мастер настройки: вход');
  return s;
}
export const setupAuthorized = (cookie) => setupOpen() && Boolean(cookie) && sessions.has(cookie);

// ---------- state ----------
export function setupState() {
  return {
    owner: config.owner.name && config.owner.name !== 'владелец' ? config.owner.name : '',
    tz: process.env.OWNER_TZ || '',
    russia: process.env.OWNER_COUNTRY === 'RU',
    bot: kvGet('setup_bot', null),
    model: modelState(),
    claudeToken: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) || fs.existsSync(path.join(process.env.HOME || '', '.claude', '.credentials.json')),
    mode: currentMode(), modeChosen: Boolean(process.env.MF_MODE), modes: MODES, platform: process.platform,
    connectDone: Boolean(kvGet('setup_connect_done', false)),
  };
}

export function connectDone() { kvSet('setup_connect_done', true); return setupState(); }

// The long-lived token pasted as is (from `claude setup-token` run by the owner himself).
export function claudeTokenPaste({ token }) {
  const t = String(token || '').replace(/\s+/g, '');
  if (!/^sk-ant-oat01-[A-Za-z0-9_-]{60,}$/.test(t)) throw new Error('Это не похоже на токен Claude: он начинается с sk-ant-oat01-');
  writeEnv({ CLAUDE_CODE_OAUTH_TOKEN: t, MODEL_PROVIDER: 'claude' });
  return setupState();
}

export function saveProfile({ name, tz, russia }) {
  const pairs = {};
  if (name) pairs.OWNER_NAME = String(name).trim().slice(0, 60);
  if (tz) {
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new Error('Не знаю такой часовой пояс'); }
    pairs.OWNER_TZ = tz;
  }
  if (russia !== undefined) { pairs.OWNER_COUNTRY = russia ? 'RU' : ''; if (russia) pairs.CURRENCY = 'RUB'; }
  writeEnv(pairs);
  if (pairs.OWNER_NAME) config.owner.name = pairs.OWNER_NAME;
  return setupState();
}

// The bot token: checked with Telegram before it is saved.
export async function saveBot({ token }) {
  const t = String(token || '').trim();
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t)) throw new Error('Это не похоже на токен бота. Он выглядит так: 1234567890:AAH…');
  let me;
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/getMe`, { signal: AbortSignal.timeout(15000) });
    me = await r.json();
  } catch { throw new Error('Telegram не ответил с сервера. Если сервер в России, Telegram может быть недоступен: выбери сервер в другой стране'); }
  if (!me.ok) throw new Error('Telegram не принял токен: скопируй его у @BotFather целиком');
  writeEnv({ BOT_TOKEN: t });
  kvSet('setup_bot', { username: me.result.username, name: me.result.first_name });
  return setupState();
}

export const saveModel = (body) => { saveModelSettings(body); return setupState(); };
export const checkModel = (body) => testModel(body);

// ---------- Claude login without a terminal: `claude setup-token` behind the scenes ----------
// It prints a sign-in link; the owner signs in, copies the code, the wizard passes it back and
// gets a long-lived token, which goes to .env as CLAUDE_CODE_OAUTH_TOKEN.
let login = null; // { child, out }
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b[=>]/g, '');
const claudeBin = () => {
  const official = path.join(process.env.HOME || '', '.local', 'bin', 'claude');
  if (fs.existsSync(official)) return official;
  const dir = path.join(ROOT, 'node_modules', '@anthropic-ai');
  const sub = fs.existsSync(dir) ? fs.readdirSync(dir).find((d) => /^claude-agent-sdk-linux-/.test(d) && !/musl/.test(d)) : null;
  return sub ? path.join(dir, sub, 'claude') : 'claude';
};

export function claudeStart() {
  if (login) { try { login.child.kill(); } catch { /* gone */ } }
  // `script` gives the CLI a terminal, it will not draw its screen into a plain pipe.
  if (process.platform === 'win32') throw new Error('На Windows: открой PowerShell, выполни claude setup-token и вставь токен в поле ниже');
  const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: '' };
  const child = process.platform === 'darwin'
    ? spawn('script', ['-q', '/dev/null', claudeBin(), 'setup-token'], { env })
    : spawn('script', ['-qfc', `${claudeBin()} setup-token`, '/dev/null'], { env });
  login = { child, out: '' };
  child.stdout.on('data', (d) => { if (login?.child === child) login.out += d.toString(); });
  child.on('exit', () => { if (login?.child === child) login.done = true; });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      const flat = strip(login?.out || '').replace(/\s+/g, '');
      const m = /(https:\/\/claude\.(?:com|ai)\/[^\s]*?oauth\/authorize\?[^\s]*?state=[A-Za-z0-9_-]+)/.exec(flat);
      if (m) { clearInterval(timer); resolve({ url: m[1] }); }
      else if (Date.now() - t0 > 25000 || login?.done) { clearInterval(timer); reject(new Error('Не получилось открыть вход в Claude. Попробуй ещё раз')); }
    }, 300);
  });
}

export function claudeCode({ code: c }) {
  if (!login || login.done) throw new Error('Сначала нажми «Войти в Claude»');
  const text = String(c || '').trim();
  if (text.length < 10) throw new Error('Вставь код целиком');
  login.child.stdin.write(`${text}\r`);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      const flat = strip(login.out).replace(/[\s│|]+/g, '');
      const m = /sk-ant-oat01-[A-Za-z0-9_-]{60,}/.exec(flat);
      if (m) {
        clearInterval(timer);
        writeEnv({ CLAUDE_CODE_OAUTH_TOKEN: m[0], MODEL_PROVIDER: 'claude' });
        try { login.child.kill(); } catch { /* done */ }
        login = null;
        addLog('system', 'Мастер настройки: вход в Claude выполнен');
        resolve(setupState());
      } else if (Date.now() - t0 > 30000 || login.done) {
        clearInterval(timer);
        reject(new Error('Claude не принял код. Нажми «Войти в Claude» ещё раз и вставь новый код'));
      }
    }, 400);
  });
}

// ---------- finish: switch the wizard off, start the bot, hand over the bot link ----------
export function finish(restart) {
  const s = setupState();
  if (!s.bot) throw new Error('Сначала подключи бота');
  if (!s.model.ready || (s.model.provider === 'claude' && !s.claudeToken)) throw new Error('Сначала настрой модель: вход в Claude или ключ провайдера');
  kvSet('setup_done', true);
  addLog('system', 'Мастер настройки завершён, перезапуск с ботом');
  // The bot starts with the new token after a restart (systemd brings the service back).
  setTimeout(restart, 1500);
  return { link: `https://t.me/${s.bot.username}?start=${config.pairingCode}`, bot: s.bot.username };
}
