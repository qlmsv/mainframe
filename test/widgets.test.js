import './_env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
const w = await import('../src/widgets.js');

test('every widget fits Telegram limits: 32 KB of HTML, 4 KB compressed', () => {
  for (const [name, html] of Object.entries(w._html)) {
    assert.ok(Buffer.byteLength(html) <= 32768, `${name} too big`);
    const z = zlib.deflateSync(Buffer.from(html), { level: 9 }).length;
    assert.ok(z <= 4096, `${name}: ${z} bytes compressed`);
  }
});

test('widget data fits chat_data (1024 bytes)', async () => {
  for (const [name, f] of Object.entries(w._data)) {
    const s = await f().catch(() => '{}');
    assert.ok(Buffer.byteLength(s) <= 1024, name);
    JSON.parse(s);
  }
});

test('commands and menu buttons: today, work, money, spin; old names hidden', () => {
  const k = Object.fromEntries(w.widgetKinds().map((x) => [x.kind, x]));
  for (const n of ['today', 'work', 'money', 'spin']) assert.ok(k[n] && !k[n].hidden, n);
  assert.ok(k.day.hidden && k.board.hidden);
  assert.ok(k.work.menu && k.spin.menu && k.money.menu);
});

const fakeApi = (fail) => {
  const log = [];
  return { log,
    raw: { sendWidget: async (p) => { log.push(['widget', p]); if (fail) throw new Error('400: WIDGETS_DISABLED'); return { message_id: 1 }; }, answerWidgetQuery: async (p) => { log.push(['answer', p]); return true; } },
    sendMessage: async (chat, text, o) => { log.push(['card', text, o]); return { message_id: 2 }; },
    editMessageText: async (chat, id, text, o) => { log.push(['edit', text, o]); return true; },
  };
};

test('auto mode: a refused widget becomes a card with buttons; cards mode never tries HTML', async () => {
  let api = fakeApi(true); w.setWidgetApi(api);
  delete process.env.WIDGETS;
  const m = await w.sendWidget(1, 'spin');
  assert.equal(m.message_id, 2);
  assert.equal(api.log[0][0], 'widget');
  assert.equal(api.log[1][0], 'card');
  assert.ok(JSON.stringify(api.log[1][2].reply_markup).includes('wg:spin'));
  process.env.WIDGETS = 'cards';
  api = fakeApi(false); w.setWidgetApi(api);
  await w.sendWidget(1, 'today');
  assert.deepEqual(api.log.map((x) => x[0]), ['card']);
  process.env.WIDGETS = 'html';
  api = fakeApi(true); w.setWidgetApi(api);
  await assert.rejects(() => w.sendWidget(1, 'today'));
  delete process.env.WIDGETS;
});

test('card buttons edit the same message; widget queries are answered only for the owner', async () => {
  const api = fakeApi(false); w.setWidgetApi(api);
  const toast = await w.cardButton(1, 5, 'wg:money');
  assert.equal(toast, 'Обновила');
  assert.equal(api.log[0][0], 'edit');
  await w.answerQuery({ id: 'q1', data: 'work' }, false);
  assert.equal(api.log.at(-1)[1].data, undefined);
  await w.answerQuery({ id: 'q2', data: 'work' }, true);
  assert.ok(JSON.parse(api.log.at(-1)[1].data).tm);
});

// Optional modules loaded by src/modules.js keep timers and sockets open.
after(() => setTimeout(() => process.exit(0), 100).unref());
