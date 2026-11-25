import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { sendOnce, sendKey } = await import('../src/outbox.js');

test('the same send within a day goes out once', async () => {
  let calls = 0;
  const msg = { kind: 'test', channel: 'tg', target: '42', text: 'привет' };
  const a = await sendOnce(msg, async () => { calls++; return { id: 1 }; });
  const b = await sendOnce(msg, async () => { calls++; return { id: 2 }; });
  assert.equal(calls, 1);
  assert.equal(a.id, 1);
  assert.equal(b.repeated, true);
});
test('the key ignores spacing but not the recipient', () => {
  assert.equal(sendKey('tg', '1', 'a  b'), sendKey('tg', '1', 'a b'));
  assert.notEqual(sendKey('tg', '1', 'a'), sendKey('tg', '2', 'a'));
});
test('a failed send can be retried', async () => {
  const msg = { kind: 'test', channel: 'tg', target: '43', text: 'x' };
  await assert.rejects(sendOnce(msg, async () => { throw new Error('сеть'); }));
  const ok = await sendOnce(msg, async () => ({ ok: true }));
  assert.equal(ok.ok, true);
});
