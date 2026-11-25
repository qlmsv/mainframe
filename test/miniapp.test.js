import './_env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.PUBLIC_URL = 'https://mf.example.test';
process.env.WIDGETS = 'auto';
const m = await import('../src/miniapp.js');
const w = await import('../src/widgets.js');
const { kvSet, kvGet } = await import('../src/db.js');

const TOKEN = '123456:TEST-token-for-tests';
const user = { id: 777, first_name: 'Owner' };
const now = Date.now();
const signed = m.signInitData({ auth_date: String(Math.floor(now / 1000)), query_id: 'AAA', user }, TOKEN);

test('initData: a valid signature gives the user', () => {
  assert.equal(m.verifyInitData(signed, TOKEN, { now }).id, 777);
});
test('initData: a wrong token, a changed field, an old date or no hash are refused', () => {
  assert.equal(m.verifyInitData(signed, '999:other', { now }), null);
  assert.equal(m.verifyInitData(signed.replace('Owner', 'Hacker'), TOKEN, { now }), null);
  assert.equal(m.verifyInitData(signed, TOKEN, { now: now + 2 * 86400000 }), null);
  assert.equal(m.verifyInitData(signed.replace(/&?hash=[0-9a-f]+/, ''), TOKEN, { now }), null);
  assert.equal(m.verifyInitData('', TOKEN), null);
});

test('the Mini App page: every script carries the nonce, the widget API is played by fetch', () => {
  const html = m.miniPage(w.widgetHtml('today'), 'today', 'N0NCE');
  assert.ok(!/<script>/.test(html), 'нет скриптов без nonce');
  assert.match(html, /<script nonce="N0NCE" src="https:\/\/telegram\.org\/js\/telegram-web-app\.js">/);
  assert.match(html, /window\.TelegramWidget=/);
  assert.match(html, /fetch\('\/w\/api'/);
  assert.match(m.miniCsp('N0NCE'), /script-src 'nonce-N0NCE' https:\/\/telegram\.org/);
});

// A fake Telegram API: sendWidget refused like for @notkotkitbot (400 INPUT_MEDIA_WIDGET_NOT_ALLOWED).
function fakeApi({ allow = false } = {}) {
  const log = [];
  return {
    log,
    raw: {
      sendWidget: async (p) => { log.push(['sendWidget', p]); if (!allow) throw new Error('Call to \'sendWidget\' failed! (400: Bad Request: INPUT_MEDIA_WIDGET_NOT_ALLOWED)'); return { message_id: 55 }; },
      answerWidgetQuery: async () => {},
    },
    sendMessage: async (chat, text, extra) => { log.push(['sendMessage', chat, text, extra]); return { message_id: 9 }; },
    deleteMessage: async (chat, id) => { log.push(['deleteMessage', chat, id]); return true; },
  };
}

test('refused widget → a message with one «Открыть» Mini App button, then no more widget tries', async () => {
  kvSet('widgets_allowed', null);
  const api = fakeApi();
  w.setWidgetApi(api);
  await w.sendWidget(777, 'today');
  assert.equal(kvGet('widgets_allowed'), false);
  const msg = api.log.find((x) => x[0] === 'sendMessage');
  const rows = msg[3].reply_markup.inline_keyboard;
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].web_app.url, 'https://mf.example.test/w/today');
  assert.match(rows[0][0].text, /Открыть/);
  api.log.length = 0;
  await w.sendWidget(777, 'todo');
  assert.ok(!api.log.some((x) => x[0] === 'sendWidget'), 'known refusal: straight to the Mini App');
  assert.equal(api.log[0][3].reply_markup.inline_keyboard[0][0].web_app.url, 'https://mf.example.test/w/todo');
});

test('in a group topic: a card without web_app, a t.me link to the private chat', async () => {
  const api = fakeApi();
  w.setWidgetApi(api);
  w.setWidgetBot('test_bot');
  await w.sendWidget('-1001234#5', 'today');
  const rows = api.log.find((x) => x[0] === 'sendMessage')[3].reply_markup.inline_keyboard.flat();
  assert.ok(!rows.some((b) => b.web_app));
  assert.ok(rows.some((b) => b.url === 'https://t.me/test_bot?start=w_today'));
});

test('WIDGETS=cards: always the plain card', async () => {
  process.env.WIDGETS = 'cards';
  const api = fakeApi({ allow: true });
  w.setWidgetApi(api);
  await w.sendWidget(777, 'today');
  assert.ok(!api.log.some((x) => x[0] === 'sendWidget'));
  assert.ok(!JSON.stringify(api.log).includes('/w/today'));
  process.env.WIDGETS = 'auto';
});

test('daily probe: refused stays quiet; allowed deletes the test, switches on, tells once', async () => {
  kvSet('widgets_allowed', false);
  let told = [];
  w.setWidgetApi(fakeApi());
  assert.equal(await w.probeWidgets(777, (t) => told.push(t)), false);
  assert.equal(told.length, 0);
  const api = fakeApi({ allow: true });
  w.setWidgetApi(api);
  assert.equal(await w.probeWidgets(777, (t) => told.push(t)), true);
  assert.deepEqual(api.log.find((x) => x[0] === 'deleteMessage'), ['deleteMessage', 777, 55]);
  assert.equal(kvGet('widgets_allowed'), true);
  assert.equal(told.length, 1);
  assert.equal(await w.probeWidgets(777, (t) => told.push(t)), null, 'already allowed: no probe');
  api.log.length = 0;
  await w.sendWidget(777, 'today');
  assert.ok(api.log.some((x) => x[0] === 'sendWidget'), 'allowed: real widget');
});

test('Mini App requests: data and the «done» action of the task list', async () => {
  const { addTodo, getTodo } = await import('../src/todos.js');
  const t = addTodo({ title: 'Проверить мини-приложение', status: 'week' });
  assert.ok(JSON.parse(await w.miniQuery('todo')).t.some((x) => x[0] === t.id));
  await w.miniQuery(`todo:today.${t.id}`);
  assert.equal(getTodo(t.id).status, 'today');
  await w.miniQuery(`todo:done.${t.id}`);
  assert.equal(getTodo(t.id).status, 'done');
  await assert.rejects(() => w.miniQuery('nope'));
});

after(() => setTimeout(() => process.exit(0), 100).unref());
