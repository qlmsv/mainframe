import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { collectLiterals } from './secrets.js';
// Slow routes (servers in Russia from Singapore) took longer than Node's 250 ms per address family
// and every fetch to them failed with ETIMEDOUT: give each attempt 3 s.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
// Exact secret values to mask in journals and history (src/db.js redact): values of secret-looking
// variables in .env, header and env values in mcp.json, stray key pieces (src/secrets.js).
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
export const SECRET_LITERALS = collectLiterals({
  envText: readText(envFile),
  mcpText: readText(path.resolve(ROOT, (process.env.MCP_CONFIG || 'mcp.json').replace(/^~/, os.homedir()))),
});
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
  // Where the owner talks to the assistant: telegram (BOT_TOKEN) or max (MAX_TOKEN, src/max.js).
  channel: env('CHANNEL', env('MAX_TOKEN') && !env('BOT_TOKEN') ? 'max' : 'telegram').toLowerCase(),
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
  // A live chat starts a fresh session (with a short handoff from the old one) after a long pause
  // or once the context grows big. SESSION_ROTATE=0 keeps one session forever.
  sessionRotate: flag('SESSION_ROTATE', true),
  sessionGapHours: Number(env('SESSION_GAP_HOURS', '3')),
  sessionMaxTokens: Number(env('SESSION_MAX_TOKENS', '80000')),
  // Without automatic rotation: once a finished answer's conversation is bigger than this, one line
  // at its end suggests /new (once per conversation). 0 turns the hint off.
  sessionSoftTokens: Number(env('SESSION_SOFT_TOKENS', '250000')),
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
// The subscription hit its limit: the run waits for the reset and continues by itself (LIMIT_RESUME=0: just fail).
// Payment or login broken: after BREAKER_FAILS errors in a row background work pauses, a cheap check
// runs every BREAKER_PROBE_MIN minutes until Claude answers again.
config.limitResume = flag('LIMIT_RESUME', true);
config.breakerFails = Math.max(1, Number(env('BREAKER_FAILS', '2')) || 2);
config.breakerProbeMin = Math.max(5, Number(env('BREAKER_PROBE_MIN', '15')) || 15);
// git push to main/master, vercel --prod and the like: block (default), warn, or off. Allowed when this
// run passed its tests and the owner's last message agreed to the release.
config.deployGuard = ['block', 'warn', 'off'].includes(env('DEPLOY_GUARD', 'block').toLowerCase()) ? env('DEPLOY_GUARD', 'block').toLowerCase() : 'block';
// Projects where the owner allowed releases without asking each time (a regex matched against the run's
// folder and the push command, e.g. DEPLOY_TRUSTED_RE=my-site). Tests are still required there.
config.deployTrusted = (() => { const v = env('DEPLOY_TRUSTED_RE', ''); try { return v ? new RegExp(v, 'i') : null; } catch { return null; } })();
// Where a release still needs the owner's «да»: someone else's product (the Verdict prod).
config.deployAsk = (() => { const v = env('DEPLOY_ASK_RE', 'verdeect|verdict|вердикт|Business AI OS'); try { return v ? new RegExp(v, 'i') : null; } catch { return null; } })();
// An answer that ends asking for a «да» the owner gave in advance goes on by itself (AUTO_CONTINUE=0: off).
config.autoContinue = env('AUTO_CONTINUE', '1') !== '0';
// The first answer waits this long while background work goes on (at least 3 s).
config.earlyAnswerMs = (() => { const v = Number(env('EARLY_ANSWER_SEC', '60')); return Math.max(3, Number.isFinite(v) ? v : 60) * 1000; })();
// Work log («что сделано»): its tail goes in front of requests; WORK_LOG_AUTO=0 stops filling it from run results.
config.workLog = { inject: flag('WORK_LOG_INJECT', true), auto: flag('WORK_LOG_AUTO', true), days: Number(env('WORK_LOG_DAYS', '7')) || 7, max: Number(env('WORK_LOG_MAX_CHARS', '1500')) || 1500 };
// The computer's bridges (local http MCP servers from mcp.json): checked every minute, restarted over
// SSH when down (BRIDGE_REPAIR=0: only check), one message after BRIDGE_ALERT_MIN minutes of downtime by day.
config.bridges = { watch: flag('BRIDGE_WATCH', true), repair: flag('BRIDGE_REPAIR', true), skipDown: flag('BRIDGE_SKIP_DOWN', true), alertMin: Number(env('BRIDGE_ALERT_MIN', '10')) || 10 };
// claude.ai connectors or other MCP servers never to connect (exact names, comma separated),
// e.g. MCP_DENY=claude.ai Old connector
config.mcpDeny = env('MCP_DENY').split(',').map((s) => s.trim()).filter(Boolean);
// claude.ai connectors always on for these project ids (comma separated), not only when named.
config.connectorProjects = env('CONNECTOR_PROJECTS').split(',').map((s) => Number(s.trim())).filter(Boolean);
// Sends the mainframe does itself (mail «Отправить», inbox reply, post «Сейчас»): wait this many seconds
// with an «Отменить» button first (0: send at once). The same text to the same place goes once a day.
config.sendUndoSec = Math.max(0, Number(env('SEND_UNDO_SEC', '15')) || 0);
// Nightly memory cleanup («сон») in the default project: cron in the owner's time zone, MEMORY_SLEEP=0 off.
config.memorySleep = { on: flag('MEMORY_SLEEP', true), cron: env('MEMORY_SLEEP_CRON', '30 3 * * *'), keep: Number(env('MEMORY_BACKUP_KEEP', '14')) || 14 };
config.tg.url = env('TG_MCP_URL', `http://127.0.0.1:${config.tg.port}/mcp`);
config.tg.enabled = Boolean(config.tg.apiId && config.tg.apiHash && config.tg.session) || Boolean(env('TG_MCP_URL'));

// The server's own time zone (the installer sets it to the owner's): shift for "local" dates.
export const LOCAL_OFFSET = () => -new Date().getTimezoneOffset() * 60000;
