// Vega's video stickers next to the live status of a run (public/spark/<state>.webm).
// On first start the bot makes its own sticker set vega_by_<bot> owned by the owner and keeps the
// file_ids in data/spark-stickers.json. Off with SPARK_STICKERS=0; without file_ids nothing changes.
import fs from 'node:fs';
import path from 'node:path';
import { InputFile } from 'grammy';
import { ROOT, DATA_DIR, config } from './config.js';
import { addLog } from './db.js';

export const STATES = ['thinking', 'working', 'done', 'error', 'waiting'];
const EMOJI = { thinking: '🤔', working: '⚡', done: '🎉', error: '😳', waiting: '👀' };
const FILE = path.join(DATA_DIR, 'spark-stickers.json');
export const enabled = () => !/^(0|false|off|no)$/i.test(String(process.env.SPARK_STICKERS ?? '1').trim());

let ids = null;
let cachedSet = '';
export function stickerIds() {
  if (ids) return ids;
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); ids = j.ids || {}; cachedSet = j.set || ''; } catch { ids = {}; }
  return ids;
}
export const setStickerIds = (x) => { ids = x; };
// The older set iskra_by_<bot> stays in Telegram; a new name means a new set.
export const setName = (botUsername) => `vega_by_${botUsername}`;

// The set of this bot: found if it is there, otherwise made from the webm files. Never throws.
export async function ensureStickerSet(api, ownerId, botUsername) {
  if (!enabled() || !ownerId || !botUsername) return null;
  const name = setName(botUsername);
  const have = stickerIds();
  if (cachedSet === name && STATES.every((s) => have[s])) return name;
  const byEmoji = (set) => Object.fromEntries(STATES.map((s) => [s, set.stickers.find((x) => x.emoji === EMOJI[s])?.file_id]).filter(([, v]) => v));
  try {
    let set = await api.getStickerSet(name).catch(() => null);
    if (!set) {
      const stickers = STATES.map((s) => ({ sticker: new InputFile(path.join(ROOT, 'public/spark', `${s}.webm`)), format: 'video', emoji_list: [EMOJI[s]] }));
      await api.raw.createNewStickerSet({ user_id: Number(ownerId), name, title: config.assistantName.slice(0, 64), stickers });
      set = await api.getStickerSet(name);
    }
    const found = byEmoji(set);
    fs.writeFileSync(FILE, JSON.stringify({ set: name, ids: found }, null, 1));
    ids = found; cachedSet = name;
    addLog('system', `Наклейки ${config.assistantName}: набор ${name}, ${Object.keys(found).length} шт.`);
    return name;
  } catch (e) {
    addLog('error', `Наклейки ${config.assistantName}: ${e.message.slice(0, 160)}`);
    return null;
  }
}

// One sticker per live status: a new state replaces the old sticker (delete, then send), at most
// once per `gap` ms; close() removes it. Every Telegram error is swallowed: the status still works.
export class LiveSticker {
  constructor(api, chatId, { gap = 5000, now = Date.now } = {}) {
    Object.assign(this, { api, chatId, gap, now, msgId: null, state: null, at: 0, busy: null, closed: false });
  }
  set(state) {
    const id = enabled() && stickerIds()[state];
    if (!id || this.closed || this.busy || state === this.state || this.now() - this.at < this.gap) return this.busy;
    this.busy = (async () => {
      if (this.msgId) { await this.api.deleteMessage(this.chatId, this.msgId).catch(() => {}); this.msgId = null; }
      this.state = state; this.at = this.now();
      const m = await this.api.sendSticker(this.chatId, id, { disable_notification: true });
      this.msgId = m.message_id;
    })().catch(() => {}).finally(() => { this.busy = null; });
    return this.busy;
  }
  async close() {
    this.closed = true;
    if (this.busy) await this.busy;
    if (this.msgId) { const id = this.msgId; this.msgId = null; await this.api.deleteMessage(this.chatId, id).catch(() => {}); }
  }
}
