import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chooseTools, chooseModel, TG_RARE_TOOLS } = await import('../src/routing.js');
const { INBOX_BLOCKED } = await import('../src/agent.js');

test('owner chat always has Telegram, background only by words', () => {
  assert.equal(chooseTools({ prompt: 'посчитай 2+2', origin: 'bot' }).telegram, true);
  assert.equal(chooseTools({ prompt: 'посчитай 2+2', origin: 'cron' }).telegram, false);
  assert.equal(chooseTools({ prompt: 'разбери каналы конкурентов в telegram', origin: 'cron' }).telegram, true);
});
test('Composio only by meaning and only when configured', () => {
  assert.equal(chooseTools({ prompt: 'что в почте?', composioOn: true }).composio, true);
  assert.equal(chooseTools({ prompt: 'что в почте?', composioOn: false }).composio, false);
  assert.equal(chooseTools({ prompt: 'посчитай 2+2', composioOn: true }).composio, false);
  assert.equal(chooseTools({ prompt: 'что в почте?', composioOn: true }).mac, false);
  assert.equal(chooseTools({ prompt: 'что в почте?', composioOn: false }).mac, true);
});
test('rare Telegram tools only when asked', () => {
  assert.equal(chooseTools({ prompt: 'что пишут в чате', origin: 'bot' }).tgRare, false);
  assert.equal(chooseTools({ prompt: 'создай канал в телеграм', origin: 'bot' }).tgRare, true);
  assert.ok(TG_RARE_TOOLS.every((t) => t.startsWith('mcp__telegram__')));
});
test('inbox runs cannot write, run commands or send', () => {
  for (const t of ['Bash', 'Write', 'Edit', 'NotebookEdit', 'mcp__telegram__send_message', 'mcp__mainframe__start_run', 'mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL']) {
    assert.ok(INBOX_BLOCKED.includes(t), t);
  }
  assert.ok(!INBOX_BLOCKED.includes('Read'));
});
test('model choice returns a model', () => {
  assert.ok(chooseModel({ prompt: 'привет', origin: 'bot' }));
});
