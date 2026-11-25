import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFinal } from '../src/finalpick.js';

const ok = (t) => ({ subtype: 'success', is_error: false, result: t });
test('first result is kept', () => {
  const a = ok('ответ');
  assert.deepEqual(pickFinal(null, a), { final: a, report: null });
});
test('an empty first answer is replaced by the next non-empty one', () => {
  const empty = ok('   ');
  const full = ok('настоящий ответ');
  assert.equal(pickFinal(empty, full).final, full);
});
test('an error first answer is replaced by a good one', () => {
  const err = { subtype: 'error_during_execution', is_error: true, result: '' };
  assert.equal(pickFinal(err, ok('готово')).final.result, 'готово');
});
test('a later answer after a good one becomes a background report', () => {
  const a = ok('ответ');
  const r = pickFinal(a, ok('итог фоновой задачи'));
  assert.equal(r.final, a);
  assert.equal(r.report, 'итог фоновой задачи');
  assert.equal(pickFinal(a, ok('')).report, null);
});
