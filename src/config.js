import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
// Slow routes (servers in Russia from Singapore) took longer than Node's 250 ms per address family
// and every fetch to them failed with ETIMEDOUT: give each attempt 3 s.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
// An empty token in .env must not shadow the normal `claude auth login` credentials.
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const flag = (k, d = false) => {
  const v = env(k, d ? '1' : '0').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
};
const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

export const DATA_DIR = path.resolve(ROOT, expandHome(env('DATA_DIR', 'data')));
fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });

function secret(name, bytes = 18) {
  const file = path.join(DATA_DIR, `${name}.secret`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const value = crypto.randomBytes(bytes).toString('base64url');
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

export const config = {
  host: env('HOST', '127.0.0.1'),
  port: Number(env('PORT', '7777')),
  dashboardToken: env('DASHBOARD_TOKEN') || secret('dashboard-token'),
  pairingCode: secret('pairing-code', 6),

  botToken: env('BOT_TOKEN'),
  ownerTgId: env('OWNER_TG_ID'),
  publicUrl: env('PUBLIC_URL'),
  tunnel: env('TUNNEL', 'cloudflared'),

  dispatchModel: env('DISPATCH_MODEL', 'haiku'),
  workModel: env('WORK_MODEL'),
  // Short replies and simple questions from the owner go to the fast model; MODEL_ROUTING=0 turns it off.
  fastModel: env('FAST_MODEL', 'claude-sonnet-5-5'),
  modelRouting: flag('MODEL_ROUTING', true),
  // Mac/browser MCP servers and claude.ai connectors load only when the request needs them; TOOL_ROUTING=0 loads all.
  toolRouting: flag('TOOL_ROUTING', true),
  permissionMode: env('PERMISSION_MODE', 'bypassPermissions'),
  autoForward: flag('AUTO_FORWARD'),
  autoReply: flag('AUTO_REPLY'),

  workspaceDir: path.resolve(expandHome(env('WORKSPACE_DIR', path.join(os.homedir(), 'Assistant')))),
  kbDir: path.resolve(ROOT, expandHome(env('KB_DIR', 'kb'))),
  mcpFile: path.resolve(ROOT, expandHome(env('MCP_CONFIG', 'mcp.json'))),

  tg: {
    apiId: env('TELEGRAM_API_ID'),
    apiHash: env('TELEGRAM_API_HASH'),
    session: env('TELEGRAM_SESSION_STRING'),
    autostart: flag('TG_MCP_AUTOSTART', true),
    dir: path.resolve(ROOT, expandHome(env('TG_MCP_DIR', 'vendor/telegram-mcp'))),
    port: Number(env('TG_MCP_PORT', '8765')),
    feedFile: path.join(DATA_DIR, 'tg-feed.jsonl'),
  },
};
// Server mode: projects outside SERVER_DIRS live on the owner's Mac and run there through MAC_RUNNER
// (scripts/mac-claude.sh over the SSH tunnel). Empty on the Mac itself: everything is local.
config.macRunner = env('MAC_RUNNER');
config.serverDirs = env('SERVER_DIRS').split(',').map((d) => d.trim()).filter(Boolean);
// LinkedIn app (self-serve products): see src/linkedin.js.
config.linkedin = { clientId: env('LINKEDIN_CLIENT_ID'), clientSecret: env('LINKEDIN_CLIENT_SECRET') };
// Social tab: the Telegram channel shown live (username without @).
config.social = { channel: env('SOCIAL_TG_CHANNEL').replace(/^@/, '') };
// Who the mainframe works for, and what their posts lead to. Everything personal lives here and
// in the memory folder, not in the code.
// Main currency for totals in «Финансы» and the money widget (ISO code), and the owner's time zone.
config.currency = env('CURRENCY', 'RUB').toUpperCase();
// OWNER_TZ moves the whole process to that zone: schedules, «today», day cards.
if (env('OWNER_TZ')) process.env.TZ = env('OWNER_TZ');
config.timezone = env('OWNER_TZ') || env('TZ') || Intl.DateTimeFormat().resolvedOptions().timeZone;
config.owner = {
  name: env('OWNER_NAME', 'владелец'),
  about: env('OWNER_ABOUT'),
  siteUrl: env('OFFER_URL').replace(/\/?$/, '/').replace(/^\/$/, ''),
  offerCta: env('OFFER_CTA', 'ссылка на мой продукт'),
  // The owner's Telegram @username: work groups pass on messages that mention it.
  username: env('OWNER_TG_USERNAME').replace(/^@/, ''),
};
// Apple Mail (all accounts added in Mail, Gmail included) into the inbox; MAIL=off disables.
config.mail = { enabled: !['off', '0', 'no', 'false'].includes(env('MAIL', 'on').toLowerCase()), pollSec: Math.max(30, Number(env('MAIL_POLL_SEC', '90')) || 90) };
// Local whisper.cpp server for voice messages; WHISPER_URL=off disables transcription.
config.whisper = {
  url: ['off', 'none', '0'].includes(env('WHISPER_URL').toLowerCase()) ? '' : env('WHISPER_URL', 'http://127.0.0.1:8178').replace(/\/+$/, ''),
  language: env('WHISPER_LANGUAGE'),
};
config.tg.url = env('TG_MCP_URL', `http://127.0.0.1:${config.tg.port}/mcp`);
config.tg.enabled = Boolean(config.tg.apiId && config.tg.apiHash && config.tg.session) || Boolean(env('TG_MCP_URL'));

// The server's own time zone (the installer sets it to the owner's): shift for "local" dates.
export const LOCAL_OFFSET = () => -new Date().getTimezoneOffset() * 60000;
