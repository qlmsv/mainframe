// Google login for Calendar, Drive, Docs and Sheets (and Gmail over IMAP if wanted) with any model.
// The owner makes his own OAuth client in Google Cloud («Desktop app»), pastes its ID and secret,
// signs in by the link; Google then opens http://127.0.0.1:8085/?code=… which shows an error page
// on a server: the owner copies that address back. The tokens stay on this server (data/google/),
// in the format the workspace-mcp server reads (github.com/taylorwilsdon/google_workspace_mcp).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, DATA_DIR } from './config.js';
import { kvGet, kvSet, addLog } from './db.js';

const DIR = path.join(DATA_DIR, 'google');
const REDIRECT = 'http://127.0.0.1:8085/';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const BASE = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
const SERVICES = {
  calendar: ['https://www.googleapis.com/auth/calendar'],
  drive: ['https://www.googleapis.com/auth/drive'],
  docs: ['https://www.googleapis.com/auth/documents'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
};
const GMAIL = 'https://mail.google.com/';

const env = (k) => String(process.env[k] ?? '').trim();
const clientId = () => env('GOOGLE_OAUTH_CLIENT_ID');
const clientSecret = () => env('GOOGLE_OAUTH_CLIENT_SECRET');
const credFile = (email) => path.join(DIR, `${encodeURIComponent(email).replace(/%40/g, '@')}.json`);

export function googleState() {
  const email = kvGet('google_email', null);
  const scopes = kvGet('google_scopes', []);
  return {
    clientSet: Boolean(clientId() && clientSecret()),
    connected: Boolean(email && fs.existsSync(credFile(email))),
    email, gmail: scopes.includes(GMAIL),
    services: Object.keys(SERVICES).filter((s) => SERVICES[s].every((x) => scopes.includes(x))),
  };
}

// ---------- login ----------
let pending = null; // { state, verifier, scopes, at }

export function googleStart({ gmail = false } = {}) {
  if (!clientId() || !clientSecret()) throw new Error('Сначала вставь Client ID и Client secret из Google Cloud');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(12).toString('hex');
  const scopes = [...BASE, ...Object.values(SERVICES).flat(), ...(gmail ? [GMAIL] : [])];
  pending = { state, verifier, scopes, at: Date.now() };
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: REDIRECT, response_type: 'code', scope: scopes.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    code_challenge: challenge, code_challenge_method: 'S256', state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
}

// The pasted address (or the bare code) from the browser's address bar after the login.
export async function googleFinish({ pasted }) {
  if (!pending || Date.now() - pending.at > 15 * 60000) throw new Error('Начни вход заново: нажми «Войти в Google»');
  const raw = String(pasted || '').trim();
  let code = raw;
  let state = null;
  try {
    const u = new URL(raw);
    code = u.searchParams.get('code');
    state = u.searchParams.get('state');
    if (u.searchParams.get('error')) throw new Error(`Google: ${u.searchParams.get('error')}`);
  } catch (e) { if (/^Google:/.test(e.message)) throw e; }
  if (code && code === raw && !/^4\/[\w-]{10,}$/.test(code)) code = null;
  if (!code) throw new Error('В адресе нет кода. Скопируй адрес страницы целиком, он начинается с http://127.0.0.1:8085/');
  if (state && state !== pending.state) throw new Error('Адрес от другой попытки входа. Нажми «Войти в Google» ещё раз');
  const r = await fetch(TOKEN_URI, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: REDIRECT, grant_type: 'authorization_code', code_verifier: pending.verifier }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(`Google не выдал доступ: ${t.error_description || t.error || r.status}`);
  if (!t.refresh_token) throw new Error('Google не выдал постоянный доступ. Удали доступ на myaccount.google.com/permissions и войди ещё раз');
  const info = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } })).json();
  const email = String(info.email || '').toLowerCase();
  if (!email) throw new Error('Google не сообщил адрес почты');
  const scopes = String(t.scope || '').split(' ').filter(Boolean);
  save(email, { token: t.access_token, refresh_token: t.refresh_token, expiry: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), scopes });
  kvSet('google_email', email);
  kvSet('google_scopes', scopes);
  pending = null;
  addLog('system', `Google подключён: ${email}`);
  return googleState();
}

function save(email, { token, refresh_token, expiry, scopes }) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const data = { token, refresh_token, token_uri: TOKEN_URI, client_id: clientId(), client_secret: clientSecret(), scopes, expiry: expiry.replace(/Z$/, '') };
  fs.writeFileSync(credFile(email), JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function googleForget() {
  const email = kvGet('google_email', null);
  if (email) fs.rmSync(credFile(email), { force: true });
  kvSet('google_email', null);
  kvSet('google_scopes', []);
  return googleState();
}

// A fresh access token (for Gmail over IMAP/SMTP with MAIL_AUTH=google).
export async function accessToken() {
  const email = kvGet('google_email', null);
  if (!email || !fs.existsSync(credFile(email))) throw new Error('Google не подключён');
  const c = JSON.parse(fs.readFileSync(credFile(email), 'utf8'));
  if (c.token && c.expiry && new Date(`${c.expiry}Z`).getTime() > Date.now() + 60000) return c.token;
  const r = await fetch(TOKEN_URI, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(`Google: ${t.error_description || t.error}. Войди в Google заново в пульте`);
  save(email, { token: t.access_token, refresh_token: c.refresh_token, expiry: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), scopes: c.scopes });
  return t.access_token;
}

// The MCP server for the sessions: workspace-mcp in single-user mode, Calendar, Drive, Docs, Sheets.
// Gmail goes through the «mail» tools (src/mailbox.js), where sending waits for the owner's button.
export function googleMcp() {
  const s = googleState();
  if (!s.connected || !s.clientSet) return null;
  return {
    command: env('UVX_PATH') || 'uvx',
    args: ['workspace-mcp@latest', '--single-user', '--tool-tier', 'core', '--tools', ...s.services],
    env: {
      ...Object.fromEntries(['PATH', 'HOME', 'LANG'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
      GOOGLE_OAUTH_CLIENT_ID: clientId(), GOOGLE_OAUTH_CLIENT_SECRET: clientSecret(),
      USER_GOOGLE_EMAIL: s.email, WORKSPACE_MCP_CREDENTIALS_DIR: DIR,
    },
  };
}

export function saveGoogleClient({ clientId: id, clientSecret: secret }) {
  const pairs = {};
  if (typeof id === 'string' && id.trim()) {
    if (!/\.apps\.googleusercontent\.com$/.test(id.trim())) throw new Error('Client ID выглядит так: 1234-abc.apps.googleusercontent.com');
    pairs.GOOGLE_OAUTH_CLIENT_ID = id.trim();
  }
  if (typeof secret === 'string' && secret.trim()) pairs.GOOGLE_OAUTH_CLIENT_SECRET = secret.trim();
  const file = path.join(ROOT, '.env');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  for (const [k, v] of Object.entries(pairs)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\n*$/, '\n')}${k}=${v}\n`;
    process.env[k] = v;
  }
  fs.writeFileSync(file, text, { mode: 0o600 });
  return googleState();
}
