// Local speech-to-text: a whisper.cpp server on this Mac (Metal GPU), see
// scripts/install-whisper.sh. Audio never leaves the machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config, ROOT, DATA_DIR } from './config.js';

export const voiceEnabled = () => Boolean(config.whisper.url);

// Transcribes an audio file (Telegram .oga/.ogg, mp3, m4a, wav...). The server
// converts it with ffmpeg (--convert), so any format ffmpeg reads is fine.
export async function transcribeAudio(bytes, filename = 'voice.ogg') {
  if (!voiceEnabled()) throw new Error('Расшифровка голосовых выключена (WHISPER_URL=off)');
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename.replace(/\.oga$/i, '.ogg'));
  form.append('response_format', 'json');
  if (config.whisper.language) form.append('language', config.whisper.language);
  // whisper runs on the Mac behind the tunnel: a network change on the Mac drops it for
  // a minute or two. Connection errors are retried for about 3 minutes before giving up.
  // With a local fallback on this server the Mac gets one short retry, not three minutes.
  let res;
  const waits = localWhisperReady() ? [0, 5] : [0, 5, 10, 20, 30, 45, 60];
  for (const wait of waits) {
    if (wait) await new Promise((r) => setTimeout(r, wait * 1000));
    try {
      res = await fetch(`${config.whisper.url}/v1/audio/transcriptions`, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
      break;
    } catch (e) {
      if (e.name === 'TimeoutError' || wait === waits[waits.length - 1]) {
        if (localWhisperReady()) return transcribeLocal(bytes, filename);
        throw new Error(e.name === 'TimeoutError' ? 'расшифровка не уложилась в 3 минуты' : 'Mac не на связи 3 минуты, расшифровка на нём');
      }
    }
  }
  if (!res.ok && res.status >= 500 && localWhisperReady()) return transcribeLocal(bytes, filename);
  if (!res.ok) throw new Error(`whisper ответил ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.text || '').trim();
  if (!text) throw new Error('Пустая расшифровка');
  return text;
}

// Fallback when the Mac is away: whisper.cpp built on this server (scripts/install-whisper-server.sh),
// run per file so the model takes memory only while it works. The "small" model is much better
// in Russian but needs ~470 MB; with less free memory the "base" one (~200 MB) is used.
const LOCAL_BIN = path.join(ROOT, 'vendor/whisper.cpp/build/bin/whisper-cli');
const model = (name) => path.join(DATA_DIR, 'models', `ggml-${name}-q5_1.bin`);
export const localWhisperReady = () => fs.existsSync(LOCAL_BIN) && (fs.existsSync(model('small')) || fs.existsSync(model('base')));
const sh = (cmd, args, timeout) => new Promise((res, rej) => execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (e, out, err) => (e ? rej(new Error(String(err || e.message).slice(-300))) : res(String(out)))));
let localBusy = Promise.resolve();

function freeMb() {
  try { return Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024; } catch { return os.freemem() / 1048576; }
}

export function transcribeLocal(bytes, filename = 'voice.ogg') {
  // One file at a time: two models at once would not fit in memory.
  const job = localBusy.then(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));
    try {
      const src = path.join(dir, path.basename(filename).replace(/\.oga$/i, '.ogg') || 'voice.ogg');
      fs.writeFileSync(src, bytes);
      const wav = path.join(dir, 'v.wav');
      await sh('ffmpeg', ['-loglevel', 'error', '-y', '-i', src, '-ar', '16000', '-ac', '1', wav], 60000);
      // Long recordings (over ~1 minute of Opus) take the fast model: small runs ~2.5x real time on 2 cores.
      const name = fs.existsSync(model('small')) && freeMb() > 650 && bytes.length < 150000 ? 'small' : (fs.existsSync(model('base')) ? 'base' : 'small');
      const lang = config.whisper.language || 'auto';
      const out = await sh(LOCAL_BIN, ['-m', model(name), '-l', lang, '-t', String(Math.max(1, os.cpus().length)), '-nt', '-np', '-f', wav], 600000);
      const text = out.replace(/\s+/g, ' ').trim();
      if (!text) throw new Error('Пустая расшифровка');
      return text;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  localBusy = job.catch(() => {});
  return job;
}

// Shown on the System page: is the whisper.cpp service answering?
export const voiceState = { status: 'off', checkedAt: null };
async function checkVoice() {
  if (!voiceEnabled()) { voiceState.status = 'off'; return; }
  try {
    const res = await fetch(`${config.whisper.url}/`, { signal: AbortSignal.timeout(3000) });
    voiceState.status = res.ok ? 'running' : 'error';
  } catch {
    voiceState.status = 'down';
  }
  voiceState.checkedAt = Date.now();
}
checkVoice();
setInterval(checkVoice, 30000).unref();
