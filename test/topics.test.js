import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const t = await import('../src/topics.js');

const G = '-1001234567890';
const setup = () => {
  t.setTopicGroup(G);
  t.saveTopic({ threadId: 1, title: 'Главное', projectId: 4 });
  t.saveTopic({ threadId: 10, title: 'Задачи', projectId: 4, role: 'todos', match: '^Задачи' });
  t.saveTopic({ threadId: 11, title: 'Клиент', projectId: 11 });
  t.saveTopic({ threadId: 12, title: 'Сайты', projectId: 3 });
  t.saveTopic({ threadId: 13, title: 'Соцсети', projectId: 6 });
  t.saveTopic({ threadId: 14, title: 'Входящие', projectId: 4, role: 'inbox' });
  t.saveTopic({ threadId: 15, title: 'Сводки', projectId: 12, role: 'summary' });
  t.saveTopic({ threadId: 16, title: 'Рынок', projectId: 4, match: 'Биржа|рынок' });
};

test('no group: everything stays in the private chat', () => {
  t.setTopicGroup(null);
  assert.equal(t.destFor('inbox'), null);
  assert.equal(t.destFor('run', { projectId: 11 }), null);
  assert.equal(t.isTopicGroup(G), false);
});

test('notifications go to their topics', () => {
  setup();
  assert.equal(t.destFor('inbox'), `${G}#14`);
  assert.equal(t.destFor('summary'), `${G}#15`);
  assert.equal(t.destFor('todos'), `${G}#10`);
  assert.equal(t.destFor('run', { projectId: 11 }), `${G}#11`, 'клиент');
  assert.equal(t.destFor('run', { projectId: 3 }), `${G}#12`, 'Сайты');
  assert.equal(t.destFor('run', { projectId: 12, taskName: 'Утренняя сводка' }), `${G}#15`, 'сводки по проекту 12');
  assert.equal(t.destFor('run', { projectId: 1, taskName: 'Задачи: 3 главных дела на утро' }), `${G}#10`, 'задачи по имени');
  assert.equal(t.destFor('run', { projectId: 1, taskName: 'Биржа: сводка' }), `${G}#16`, 'рынок по имени');
  assert.equal(t.destFor('run', { projectId: 4 }), `${G}#1`, 'главная сессия в «Главное»');
  assert.equal(t.destFor('run', { projectId: 999 }), `${G}#1`, 'неизвестный проект в «Главное»');
});

test('a message in a topic works in the topic project', () => {
  setup();
  assert.equal(t.topicProject(G, 11, 4), 11);
  assert.equal(t.topicProject(G, 12, 4), 3);
  assert.equal(t.topicProject(G, 777, 4), 4);
  assert.equal(t.isTopicGroup(Number(G)), true);
});

test('«chat#thread» becomes chat_id + message_thread_id for sends only', async () => {
  const calls = [];
  const prev = (method, payload) => { calls.push([method, payload]); return Promise.resolve({ ok: true }); };
  await t.topicTransformer(prev, 'sendMessage', { chat_id: `${G}#11`, text: 'x' });
  await t.topicTransformer(prev, 'editMessageText', { chat_id: `${G}#11`, message_id: 5, text: 'y' });
  await t.topicTransformer(prev, 'sendSticker', { chat_id: `${G}#1`, sticker: 's' });
  await t.topicTransformer(prev, 'sendMessage', { chat_id: 42, text: 'z' });
  assert.deepEqual(calls[0][1], { chat_id: Number(G), message_thread_id: 11, text: 'x' });
  assert.deepEqual(calls[1][1], { chat_id: Number(G), message_id: 5, text: 'y' });
  assert.deepEqual(calls[2][1], { chat_id: Number(G), sticker: 's' }, 'General без thread id');
  assert.deepEqual(calls[3][1], { chat_id: 42, text: 'z' });
});

test('«эта тема для …» ties a topic to a project or a role', () => {
  setup();
  const projects = [{ id: 3, name: 'Сайт компании' }, { id: 11, name: 'Клиентский проект' }, { id: 4, name: 'Главная сессия' }];
  assert.equal(t.bindByWords(G, 20, 'клиентский проект', projects).what, 'Клиентский проект');
  assert.equal(t.getTopic(G, 20).project_id, 11);
  assert.equal(t.bindByWords(G, 21, 'входящих', projects).what, 'Входящие');
  assert.equal(t.getTopic(G, 21).role, 'inbox');
  assert.equal(t.bindByWords(G, 22, 'чего-то неизвестного', projects), null);
});
