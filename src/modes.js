// Where the assistant works:
//   server   — everything on the server, no computer needed (browser without a screen, mail, Google);
//   computer — the mainframe runs on a Mac or Windows PC, works while it is on;
//   both     — the server is the main one, the computer joins through a bridge (browser with your
//              logins, control of the computer, apps, voice). MF_MODE in .env, guessed when not set.
// The bridge: the dashboard or the wizard gives a one-line command with a one-time code; the
// computer sends its SSH key, the server lets that key open only the bridge ports, nothing else.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, DATA_DIR, config } from './config.js';
import { kvGet, kvSet, addLog } from './db.js';

// MF_PORT_SHIFT moves them all (a test copy next to a working bridge).
const SHIFT = Number(process.env.MF_PORT_SHIFT) || 0;
export const BRIDGE_PORTS = Object.fromEntries(Object.entries({ apple: 8801, computer: 8802, chrome: 8803, whisper: 8178, ssh: 2222 }).map(([k, p]) => [k, p + SHIFT]));
const env = (k) => String(process.env[k] ?? '').trim();

function readMcpFile() {
  try { return JSON.parse(fs.readFileSync(config.mcpFile, 'utf8')); } catch { return { mcpServers: {} }; }
}

export function currentMode() {
  const m = env('MF_MODE');
  if (['server', 'computer', 'both'].includes(m)) return m;
  if (process.platform === 'darwin' || process.platform === 'win32') return 'computer';
  const servers = readMcpFile().mcpServers || {};
  const bridged = Object.values(servers).some((s) => /^http:\/\/127\.0\.0\.1:(88\d\d|8178)\//.test(s?.url || ''));
  return env('MAC_RUNNER') || bridged ? 'both' : 'server';
}

// What works in each mode, in plain words (the wizard and «Система» show it).
export const MODES = {
  server: {
    title: 'Только сервер', short: 'Компьютер не нужен, работает круглые сутки',
    works: ['бот, память, задачи по расписанию', 'браузер на сервере (без твоих входов на сайты)', 'почта (любая, по паролю приложения)', 'Google Календарь и Диск', 'голосовые'],
    not: ['управление программами компьютера', 'сайты, где нужно быть залогиненным (входишь заново в браузере сервера)'],
  },
  computer: {
    title: 'Только компьютер', short: 'Ставится на Mac или Windows, работает, пока компьютер включён',
    works: ['всё, что на сервере', 'твой Chrome со всеми входами', 'управление программами', 'на Mac: Почта, Календарь, Заметки, Напоминания'],
    not: ['когда компьютер выключен или спит, помощник молчит'],
  },
  both: {
    title: 'Сервер + компьютер', short: 'Сервер главный, компьютер подключается мостом',
    works: ['всё, что на сервере, круглые сутки', 'когда компьютер включён: твой Chrome со входами, управление программами, голос на компьютере', 'на Mac: Почта, Календарь, Заметки, задачи с кодом на Mac'],
    not: ['пока компьютер выключен, его инструменты ждут, остальное работает'],
  },
};

export function saveMode(mode) {
  if (!MODES[mode]) throw new Error('Нет такого режима');
  writeEnv({ MF_MODE: mode });
  return modeState();
}

// ---------- is the bridge alive (cached, checked in the background) ----------
const alive = {};
const probe = (port) => new Promise((res) => {
  const s = net.connect({ host: '127.0.0.1', port });
  const end = (v) => { s.destroy(); res(v); };
  s.setTimeout(2000, () => end(false));
  s.once('connect', () => end(true));
  s.once('error', () => end(false));
});
async function refresh() { for (const [k, p] of Object.entries(BRIDGE_PORTS)) alive[k] = await probe(p); }
let started = false;
export function watchBridge() {
  if (started) return;
  started = true;
  refresh();
  setInterval(refresh, 60000).unref();
}
export const bridgeOnline = (name) => Boolean(alive[name]);

// ---------- the browser on the server (chrome-devtools-mcp + Chromium without a screen) ----------
export function serverBrowserMcp() {
  const exe = env('BROWSER_PATH');
  const link = path.join(ROOT, 'vendor', 'browser', 'node_modules', '.bin', 'chrome-devtools-mcp');
  if (!exe || !fs.existsSync(exe) || !fs.existsSync(link)) return null;
  const bin = fs.realpathSync(link);
  const profile = path.join(DATA_DIR, 'browser-profile');
  const args = [bin, '--headless', '--executablePath', exe, '--userDataDir', profile, '--usageStatistics', 'false', '--performanceCrux', 'false', '--screenshotFormat', 'jpeg', '--viewport', '1280x900'];
  // Root or a container has no user namespaces for Chrome's sandbox.
  if (process.getuid?.() === 0 || fs.existsSync('/.dockerenv')) args.push('--chromeArg=--no-sandbox');
  return { command: process.execPath, args };
}

// ---------- one-time codes for connecting a computer ----------
export function bridgeToken() {
  const t = crypto.randomBytes(18).toString('base64url');
  const all = Object.fromEntries(Object.entries(kvGet('bridge_tokens', {})).filter(([, v]) => v.exp > Date.now()));
  all[t] = { exp: Date.now() + 60 * 60000 };
  kvSet('bridge_tokens', all);
  return t;
}
const tokenOk = (t) => { const v = kvGet('bridge_tokens', {})[String(t || '')]; return v && v.exp > Date.now() && !v.used; };

export function bridgeCommands(baseUrl) {
  const t = bridgeToken();
  return {
    mac: `curl -fsSL ${baseUrl}/bridge/${t}/mac.sh | bash`,
    windows: `irm ${baseUrl}/bridge/${t}/windows.ps1 | iex`,
    expires: Date.now() + 60 * 60000,
  };
}

// The install script for the computer, with this server's address and the code inside.
export function bridgeScript(token, kind, baseUrl) {
  if (!tokenOk(token)) return null;
  const file = path.join(ROOT, 'scripts', kind === 'windows' ? 'bridge-windows.ps1' : 'bridge-mac.sh');
  return fs.readFileSync(file, 'utf8').replaceAll('__MF_URL__', baseUrl).replaceAll('__MF_TOKEN__', token);
}

const sshHost = () => {
  const u = config.publicUrl || env('PUBLIC_URL');
  const m = /^https?:\/\/(\d+)-(\d+)-(\d+)-(\d+)\.sslip\.io/.exec(u || '');
  if (m) return m.slice(1, 5).join('.');
  try { return new URL(u).hostname; } catch { return null; }
};

// The computer registers its key. Only the bridge ports may be forwarded with it.
export function bridgeRegister({ token, os: kind, user, pubkey, hostname, features = {} }) {
  if (!tokenOk(token)) throw new Error('Код устарел или уже использован. Возьми новую команду в пульте');
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]{60,100}( .*)?$/.test(String(pubkey || '').trim())) throw new Error('Неверный ключ');
  if (!['mac', 'windows'].includes(kind)) throw new Error('Неизвестная система');
  const safeUser = String(user || '').replace(/[^\w.@-]/g, '').slice(0, 64);
  const name = String(hostname || kind).replace(/[^\w.-]/g, '').slice(0, 40);
  const tokens = kvGet('bridge_tokens', {});
  tokens[token].used = Date.now();
  kvSet('bridge_tokens', tokens);

  const home = os.homedir();
  const sshDir = path.join(home, '.ssh');
  fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  const ak = path.join(sshDir, 'authorized_keys');
  const listen = Object.values(BRIDGE_PORTS).map((p) => `permitlisten="127.0.0.1:${p}"`).join(',');
  const key = String(pubkey).trim().split(' ').slice(0, 2).join(' ');
  // restrict + port-forwarding would still allow commands and -L into the server: a forced no-op command
  // and a dead permitopen leave only the remote forwards to the bridge ports (-R).
  const opts = `restrict,port-forwarding,command="/bin/false",permitopen="127.0.0.1:9",${listen}`;
  const old = (fs.existsSync(ak) ? fs.readFileSync(ak, 'utf8') : '').split('\n').filter((l) => l && !l.includes(key));
  fs.writeFileSync(ak, `${[...old, `${opts} ${key} mainframe-bridge-${kind}-${name}`].join('\n')}\n`, { mode: 0o600 });

  // The key the server uses to start sessions on the Mac (through the forwarded port 2222).
  const toMac = path.join(sshDir, 'to_mac');
  if (!fs.existsSync(toMac)) execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'mainframe-server-to-computer', '-f', toMac, '-q']);
  let hostKey = '';
  for (const f of ['/etc/ssh/ssh_host_ed25519_key.pub']) if (fs.existsSync(f)) hostKey = fs.readFileSync(f, 'utf8').trim().split(' ').slice(0, 2).join(' ');

  // Tools for the sessions: merged into mcp.json, the owner's other servers stay.
  const file = readMcpFile();
  file.mcpServers = file.mcpServers || {};
  const url = (p) => ({ type: 'http', url: `http://127.0.0.1:${p}/mcp` });
  if (features.apple && kind === 'mac') file.mcpServers.apple = url(BRIDGE_PORTS.apple);
  if (features.computer) file.mcpServers.computer = url(BRIDGE_PORTS.computer);
  if (features.chrome) file.mcpServers.chrome = url(BRIDGE_PORTS.chrome);
  fs.writeFileSync(config.mcpFile, `${JSON.stringify(file, null, 2)}\n`);

  const pairs = { MF_MODE: 'both', BRIDGE_OS: kind };
  if (features.whisper) pairs.WHISPER_URL = `http://127.0.0.1:${BRIDGE_PORTS.whisper}`;
  if (kind === 'mac' && features.ssh) { pairs.MAC_USER = safeUser; pairs.MAC_RUNNER = path.join(ROOT, 'scripts', 'mac-claude.sh'); }
  writeEnv(pairs);
  kvSet('bridge_computer', { os: kind, user: safeUser, hostname: name, features, at: Date.now() });
  addLog('system', `Подключён компьютер (${kind === 'mac' ? 'Mac' : 'Windows'}, ${name}): ${Object.keys(features).filter((k) => features[k]).join(', ')}`);
  setTimeout(refresh, 15000);
  return {
    sshUser: os.userInfo().username, sshHost: sshHost(), sshPort: 22, hostKey,
    serverKey: fs.readFileSync(`${toMac}.pub`, 'utf8').trim(), ports: BRIDGE_PORTS,
  };
}

let cli = { at: 0, v: null };
function claudeVersion() {
  if (Date.now() - cli.at < 10 * 60000) return cli.v;
  let v = null;
  for (const bin of [path.join(os.homedir(), '.local', 'bin', 'claude'), 'claude']) {
    try { v = execFileSync(bin, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().replace(/ \(Claude Code\)$/, ''); break; } catch { /* next */ }
  }
  cli = { at: Date.now(), v };
  return v;
}

export function modeState() {
  const mode = currentMode();
  return {
    mode, platform: process.platform, modes: MODES,
    computer: kvGet('bridge_computer', null),
    bridge: Object.fromEntries(Object.keys(BRIDGE_PORTS).map((k) => [k, bridgeOnline(k)])),
    serverBrowser: Boolean(serverBrowserMcp()),
    claudeCli: claudeVersion(),
  };
}

const ENV_FILE = path.join(ROOT, '.env');
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
