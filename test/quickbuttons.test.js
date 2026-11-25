import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const qb = await import('../src/quickbuttons.js');
const { modules } = await import('../src/modules.js');
const { mainKeyboard } = await import('../src/botui.js');

test('default set is neutral and has a new-session button', () => {
  const list = qb.quickButtons();
  assert.ok(list.length >= 6 && list.length <= 8);
  assert.ok(list.some((b) => b.action === 'new'));
  assert.ok(!JSON.stringify(list).match(/Миш|курс|Trello|Вердикт/i));
});

test('module set wins over default, owner set wins over module, empty resets', () => {
  modules.push({ quickButtons: [{ label: '🅰 Модуль', prompt: 'запрос модуля' }] });
  assert.equal(qb.quickButtons()[0].label, '🅰 Модуль');
  qb.setQuickButtons([{ label: '🅱 Своё', prompt: 'мой запрос' }, { label: 'плохая' }]);
  assert.deepEqual(qb.quickButtons(), [{ label: '🅱 Своё', prompt: 'мой запрос' }]);
  assert.equal(qb.quickFor(' 🅱 Своё ').prompt, 'мой запрос');
  assert.equal(qb.quickFor('просто текст'), null);
  qb.setQuickButtons([]);
  assert.equal(qb.quickButtons()[0].label, '🅰 Модуль');
  modules.pop();
});

test('menu: quick buttons two in a row, then the screens row', () => {
  const kb = mainKeyboard({ name: 'Проект' });
  const rows = kb.keyboard.map((r) => r.map((b) => (typeof b === 'string' ? b : b.text)));
  assert.ok(rows.slice(0, -1).every((r) => r.length <= 2));
  assert.deepEqual(rows.at(-1), ['🏠 Пульт', '📥 Входящие', '⚙️ Ещё']);
  assert.equal(rows.slice(0, -1).flat().length, qb.quickButtons().length);
});
