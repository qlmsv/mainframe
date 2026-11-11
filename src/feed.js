// Tails telegram-mcp's incoming_feed.jsonl: one line per settled burst of private messages.
import fs from 'node:fs';
import { config } from './config.js';
import { kvGet, kvSet, addLog } from './db.js';

export function watchFeed(onEvent) {
  const file = config.tg.feedFile;
  let offset = kvGet('feed_offset', null);
  let busy = false;

  let failures = 0;
  let retryAt = 0;

  async function readNew() {
    if (busy || Date.now() < retryAt || !fs.existsSync(file)) return;
    busy = true;
    try {
      const size = fs.statSync(file).size;
      if (offset === null || offset > size) { offset = offset === null ? size : 0; kvSet('feed_offset', offset); } // first run: skip history
      if (size <= offset) return;
      const start = offset;
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      // Only whole lines; the position moves past a line once it is handled, so a crash
      // or a temporary error (telegram-mcp restarting) retries it instead of losing it.
      let pos = 0;
      for (;;) {
        const nl = buf.indexOf(10, pos);
        if (nl === -1) break;
        const line = buf.subarray(pos, nl).toString('utf8').trim();
        if (line) {
          try {
            await onEvent(JSON.parse(line));
            failures = 0;
          } catch (e) {
            failures += 1;
            addLog('error', `Лента Telegram (попытка ${failures}): ${e.message}`);
            // Retry after 3, 6, 12, 24, 48 s (telegram-mcp may be restarting), then give up on it.
            if (failures <= 5 && !(e instanceof SyntaxError)) { retryAt = Date.now() + 1500 * 2 ** failures; return; }
            failures = 0;
          }
        }
        pos = nl + 1;
        offset = start + pos;
        kvSet('feed_offset', offset);
      }
    } finally {
      busy = false;
    }
  }

  setInterval(readNew, 1500);
  readNew();
}
