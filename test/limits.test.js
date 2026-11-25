import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { failureKind, parseReset } = await import('../src/limits.js');

test('limit and access errors are told apart', () => {
  assert.equal(failureKind("You've hit your 5-hour limit · resets 9:50pm"), 'limit');
  assert.equal(failureKind('Your payment is past due'), 'access');
  assert.equal(failureKind('Please run /login'), 'access');
  assert.equal(failureKind('обычная ошибка сети'), null);
});
test('reset time is read from the message', () => {
  const t0 = Date.UTC(2026, 10, 15, 10, 0);
  const at = parseReset('limit reached · resets 9pm (UTC)', t0);
  assert.equal(new Date(at).toISOString(), '2026-11-15T21:00:00.000Z');
  const early = parseReset('resets 9am (UTC)', t0);
  assert.equal(new Date(early).toISOString(), '2026-11-16T09:00:00.000Z');
  assert.equal(parseReset('limit reached|1763200000', t0), 1763200000000);
  assert.equal(parseReset('нет времени', t0), null);
});
