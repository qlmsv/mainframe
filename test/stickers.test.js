import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { LiveSticker, setStickerIds, enabled, setName, STATES } = await import('../src/stickers.js');

const fakeApi = () => {
  const log = []; let n = 100;
  return { log, sendSticker: async (chat, id) => { log.push(['send', id]); return { message_id: ++n }; }, deleteMessage: async (chat, id) => { log.push(['del', id]); } };
};
const ids = Object.fromEntries(STATES.map((s) => [s, `id-${s}`]));

test('one sticker, replaced on a new state, not more often than the gap', async () => {
  setStickerIds(ids);
  let clock = 0;
  const api = fakeApi();
  const s = new LiveSticker(api, 1, { gap: 5000, now: () => clock });
  clock = 10000; await s.set('thinking');
  await s.set('thinking');
  clock += 2000; await s.set('working'); // too soon
  assert.deepEqual(api.log, [['send', 'id-thinking']]);
  clock += 4000; await s.set('working');
  assert.deepEqual(api.log.slice(1), [['del', 101], ['send', 'id-working']]);
  await s.close();
  assert.deepEqual(api.log.at(-1), ['del', 102]);
  await s.set('done');
  assert.equal(api.log.length, 4, 'nothing after close');
});

test('close waits for a sticker still being sent and removes it', async () => {
  setStickerIds(ids);
  const api = fakeApi();
  const s = new LiveSticker(api, 1);
  s.set('thinking');
  await s.close();
  assert.deepEqual(api.log, [['send', 'id-thinking'], ['del', 101]]);
});

test('without file_ids or with SPARK_STICKERS=0 nothing is sent', async () => {
  setStickerIds({});
  const api = fakeApi();
  await new LiveSticker(api, 1).set('thinking');
  setStickerIds(ids);
  process.env.SPARK_STICKERS = '0';
  assert.equal(enabled(), false);
  await new LiveSticker(api, 1).set('thinking');
  delete process.env.SPARK_STICKERS;
  assert.equal(enabled(), true);
  assert.deepEqual(api.log, []);
});

test('a failing Telegram call does not break the status', async () => {
  setStickerIds(ids);
  const s = new LiveSticker({ sendSticker: async () => { throw new Error('flood'); }, deleteMessage: async () => {} }, 1);
  await s.set('thinking');
  await s.close();
  assert.equal(s.msgId, null);
});

test('set name and the sticker files', () => {
  assert.equal(setName('kai_mf_bot'), 'nekit_by_kai_mf_bot');
  for (const st of STATES) {
    const size = fs.statSync(new URL(`../public/spark/${st}.webm`, import.meta.url)).size;
    assert.ok(size > 1000 && size <= 256 * 1024, `${st}.webm ${size} bytes`);
  }
});
