// Runs chigwell/telegram-mcp as one long-lived HTTP server (one Telegram connection
// shared by every session) and gives the gateway a direct MCP client to it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config, DATA_DIR } from './config.js';
import { addLog } from './db.js';
import { bus } from './bus.js';
import { localWhisperReady, transcribeLocal } from './voice.js';

export const tgState = { process: 'off', client: 'off', error: null, account: null };
let child = null;
let client = null;
let restartDelay = 2000;

function setState(patch) {
  Object.assign(tgState, patch);
  bus.change('telegram');
}

export function startTelegramMcp() {
  if (!config.tg.enabled) {
    setState({ process: 'not_configured' });
    return;
  }
  if (!config.tg.autostart) {
    setState({ process: 'external' });
    return;
  }
  if (!fs.existsSync(path.join(config.tg.dir, 'main.py'))) {
    setState({ process: 'missing', error: `Нет ${config.tg.dir}. Запусти scripts/setup.sh` });
    return;
  }
  const logFile = fs.createWriteStream(path.join(DATA_DIR, 'logs', 'telegram-mcp.log'), { flags: 'a' });
  child = spawn('uv', ['run', '--directory', config.tg.dir, 'main.py'], {
    env: {
      ...process.env,
      MCP_TRANSPORT: 'http',
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(config.tg.port),
      TELEGRAM_API_ID: config.tg.apiId,
      TELEGRAM_API_HASH: config.tg.apiHash,
      TELEGRAM_SESSION_STRING: config.tg.session,
      TELEGRAM_EVENT_FEED: '1',
      TELEGRAM_EVENT_FEED_FILE: config.tg.feedFile,
      // Downloads go here; the SDK clients do not answer roots/list, so the server roots are used.
      // Big uploads (lesson videos, 50–100 MB) need more than the default 55 s per tool call.
      TELEGRAM_TOOL_TIMEOUT_SECONDS: process.env.TELEGRAM_TOOL_TIMEOUT_SECONDS || '600',
      TELEGRAM_ALLOWED_ROOTS: path.join(DATA_DIR, 'telegram-files'),
      TELEGRAM_SERVER_ROOTS_ONLY: '1',
      // Voice and video notes go to the local whisper.cpp server, never to a third party.
      ...(config.whisper.url ? {
        TELEGRAM_TRANSCRIBE: 'auto',
        TELEGRAM_TRANSCRIBE_ENGINE: 'openai',
        TELEGRAM_TRANSCRIBE_OPENAI_URL: `${config.whisper.url}/v1`,
        TELEGRAM_TRANSCRIBE_OPENAI_MODEL: 'large-v3-turbo',
        TELEGRAM_TRANSCRIBE_OPENAI_API_KEY: '',
        ...(config.whisper.language ? { TELEGRAM_TRANSCRIBE_LANGUAGE: config.whisper.language } : {}),
      } : { TELEGRAM_TRANSCRIBE: 'off' }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  setState({ process: 'starting', error: null });
  child.stdout.pipe(logFile);
  child.stderr.pipe(logFile);
  child.stderr.on('data', (d) => {
    const s = d.toString();
    if (/Uvicorn running|Application startup complete/i.test(s) && tgState.process !== 'running') {
      setState({ process: 'running' });
      restartDelay = 2000;
      enableFeed();
    }
    const m = s.match(/(AuthKey\w+Error|SessionLockError|Invalid MCP_TRANSPORT[^\n]*|ERROR[^\n]*)/);
    if (m) setState({ error: m[1].slice(0, 300) });
  });
  // A missing `uv` must not crash the whole app (launchd would loop it).
  child.on('error', (e) => {
    setState({ process: 'error', error: `Не запустился telegram-mcp: ${e.message}` });
    addLog('error', `telegram-mcp: ${e.message}`);
  });
  child.on('exit', (code) => {
    child = null;
    client = null;
    setState({ process: 'stopped', client: 'off' });
    addLog('telegram', `telegram-mcp завершился (код ${code}), перезапуск через ${restartDelay / 1000} с`);
    setTimeout(startTelegramMcp, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 120000);
  });
}

// The feed otherwise starts only on the first incoming message; turn it on right away
// and learn which account we are connected to.
async function enableFeed(attempt = 1) {
  try {
    await tgCall('enable_incoming_feed', {});
    const me = await tgCall('get_me', {});
    setState({ account: me?.username ? `@${me.username}` : [me?.first_name, me?.last_name].filter(Boolean).join(' ') || null });
    addLog('telegram', `Аккаунт ${tgState.account || ''} подключён, лента входящих включена`);
  } catch (e) {
    if (attempt < 5) setTimeout(() => enableFeed(attempt + 1), attempt * 3000);
    else addLog('error', `Не удалось включить ленту Telegram: ${e.message}`);
  }
}

export function stopTelegramMcp() {
  if (child) {
    child.removeAllListeners('exit');
    child.kill('SIGTERM');
    child = null;
  }
}

async function getClient() {
  if (client) return client;
  const c = new Client({ name: 'mainframe-gateway', version: '0.1.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(config.tg.url)));
  client = c;
  // A fresh connection clears the old «no link» error: it stayed on the dashboard after recovery.
  setState({ client: 'connected', error: null });
  return client;
}

// Calls a telegram-mcp tool and returns its text output (parsed as JSON when possible).
export async function tgCall(name, args = {}) {
  let c;
  try {
    c = await getClient();
  } catch (e) {
    client = null;
    setState({ client: 'error', error: `Нет связи с telegram-mcp: ${e.message}` });
    throw e;
  }
  try {
    const res = await c.callTool({ name, arguments: args });
    const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (res.isError) throw new Error(text || `${name} вернул ошибку`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (e) {
    if (/fetch failed|ECONNREFUSED|session/i.test(e.message)) client = null;
    throw e;
  }
}

// Incoming texts of a settled burst, oldest first.
export async function fetchBurst(event) {
  const afterId = Math.max(0, Number(event.first_message_id || event.last_message_id) - 1);
  const data = await tgCall('get_messages_after', {
    chat_id: Number(event.chat_id),
    after_id: afterId,
    limit: Math.min(50, Number(event.message_count || 1) + 5),
  });
  const msgs = Array.isArray(data?.messages) ? data.messages : [];
  const texts = await Promise.all(msgs.filter((m) => !m.out).map(async (m) => {
    const text = m.text || m.message;
    if (text) return text;
    if (m.media === 'voice' || m.media === 'video_note') return voiceText(event.chat_id, m);
    return m.media ? `[${m.media}]` : '';
  }));
  return texts.filter(Boolean);
}

// A voice or video note as text, so the dispatcher can read it like any message.
async function voiceText(chatId, m) {
  const label = m.media === 'video_note' ? 'Кружок' : 'Голосовое';
  if (!config.whisper.url) return `[${label.toLowerCase()}, расшифровка выключена]`;
  const started = Date.now();
  try {
    const res = await tgCall('transcribe_voice', { chat_id: Number(chatId), message_id: m.id, engine: 'openai' });
    const text = (res?.text || '').trim();
    if (!text) throw new Error(res?.error || res?.reason || (typeof res === 'string' ? res : 'пустой ответ'));
    addLog('telegram', `${label} расшифровано за ${((Date.now() - started) / 1000).toFixed(1)} с`);
    return `🎤 ${label}: ${text}`;
  } catch (e) {
    // The Mac's whisper is away: download the audio and transcribe it on this server.
    if (localWhisperReady()) {
      try {
        const res = await tgCall('download_media', { chat_id: Number(chatId), message_id: m.id });
        const file = /downloaded to (.+?)\.?$/.exec(typeof res === 'string' ? res : (res?.result || res?.path || ''))?.[1]?.trim();
        if (file && fs.existsSync(file)) {
          const text = await transcribeLocal(fs.readFileSync(file), path.basename(file)).finally(() => fs.rmSync(file, { force: true }));
          addLog('telegram', `${label} расшифровано на сервере за ${((Date.now() - started) / 1000).toFixed(1)} с (Mac недоступен)`);
          return `🎤 ${label}: ${text}`;
        }
      } catch (e2) { e = new Error(`${e.message}; на сервере: ${e2.message}`); }
    }
    addLog('error', `Расшифровка голосового: ${String(e.message || e).slice(0, 200)}`);
    return `[${label.toLowerCase()}, не удалось расшифровать]`;
  }
}

export async function tgSend(chatId, text) {
  return tgCall('send_message', { chat_id: Number(chatId), message: text });
}
