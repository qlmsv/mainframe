import './_env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const t = await import('../src/todos.js');

test('add, dedupe, list by column, done', () => {
  const a = t.addTodo({ title: 'Позвонить Ане', status: 'today' });
  assert.equal(a.added, true);
  assert.equal(t.addTodo({ title: 'позвонить ане' }).added, false);
  t.addTodo({ title: 'Счёт Мише', status: 'waiting', who: 'assistant' });
  t.addTodo({ title: 'Идея поста' });
  assert.deepEqual(t.listTodos().map((x) => x.status), ['today', 'inbox', 'waiting']);
  const d = t.doneTodo(a.id);
  assert.equal(d.status, 'done');
  assert.ok(d.done_at > 0);
  assert.equal(t.listTodos().length, 2);
  assert.equal(t.listTodos({ done: true }).length, 3);
  assert.equal(t.todoCounts().done, 1);
});

test('due words, overdue goes to the top 3, bad input', () => {
  const x = t.addTodo({ title: 'Завтрашнее', due: 'завтра', status: 'week' });
  assert.equal(x.due, new Date(Date.now() + 86400000).toLocaleDateString('sv'));
  const old = t.addTodo({ title: 'Просрочено', due: '2026-01-01', status: 'week' });
  assert.ok(t.topTodos(3).some((y) => y.id === old.id));
  assert.ok(!t.topTodos(3).some((y) => y.id === x.id));
  assert.throws(() => t.addTodo({ title: '  ' }));
  assert.throws(() => t.updateTodo(old.id, { status: 'nope' }));
  assert.match(t.todoLine(old), /№\d+ Просрочено · до 1 янв\. ⚠️/);
});

test('mainframe MCP server builds with the todo tools', async () => {
  const { buildMcpServers } = await import('../src/mcp.js');
  const s = buildMcpServers({ mac: false });
  const names = Object.keys(s.mainframe.instance?._registeredTools || {});
  for (const n of ['todo_add', 'todo_list', 'todo_update', 'todo_done']) assert.ok(names.includes(n), n);
});

test('widgets «Сегодня» and the wheel take the tasks', async () => {
  t.addTodo({ title: 'Задача для виджета', status: 'today' });
  const { _data } = await import('../src/widgets.js');
  assert.ok(JSON.parse(await _data.todayData()).rm.includes('Задача для виджета'));
  assert.ok(JSON.parse(await _data.spinData()).t.includes('Задача для виджета'));
});

test('bot screen: tasks by column with done buttons', async () => {
  const { todosScreen } = await import('../src/botui.js');
  const s = todosScreen();
  assert.match(s.text, /☀️ <b>Сегодня<\/b>/);
  const cb = s.kb.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(cb.some((c) => /^td:d:\d+$/.test(c)) && cb.some((c) => /^td:t:\d+$/.test(c)));
});

// The widgets open a calendar connection that keeps the process alive: end it like widgets.test.js.
after(() => setTimeout(() => process.exit(0), 100).unref());
