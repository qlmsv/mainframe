// Every test file imports this first: a throwaway data folder, no bot, no Telegram, no tunnel.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-test-'));
process.env.BOT_TOKEN = '';
process.env.TELEGRAM_SESSION_STRING = '';
process.env.TUNNEL = 'off';
process.env.TOOL_ROUTING = 'true';
