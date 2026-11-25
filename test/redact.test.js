import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRedactor, collectLiterals } from '../src/secrets.js';

const r = makeRedactor(collectLiterals({
  envText: 'MY_API_KEY=supersecretvalue123456\nPORT=8080',
  mcpText: '{"mcpServers":{"x":{"headers":{"Authorization":"Bearer literalheader987654321"}}}}',
}));
test('known key shapes are masked', () => {
  const fake = {
    composio: 'ck_' + 'A1b2C3d4E5f6G7h8I9j0',
    yandex: 'y0__' + 'xDabcdefGHIJ1234567890klmnop',
    github: 'ghp_' + 'a'.repeat(20) + '1'.repeat(16),
    bot: '123456789:' + 'AAH' + 'x'.repeat(32),
    aws: 'AKIA' + 'ABCDEFGH12345678',
  };
  for (const [k, v] of Object.entries(fake)) {
    const out = r(`ключ ${v} тут`);
    assert.ok(!out.includes(v), k);
    assert.ok(out.includes('***'), k);
  }
});
test('literals from .env and mcp.json are masked', () => {
  assert.equal(r('x supersecretvalue123456 y'), 'x *** y');
  assert.ok(!r('h literalheader987654321').includes('literalheader987654321'));
});
test('NAME=value pairs are masked, plain text is not', () => {
  assert.ok(!r('SOME_TOKEN=abc123def456ghi789').includes('abc123def456ghi789'));
  assert.ok(!r('Authorization: Bearer abcdef1234567890abcdef').includes('abcdef1234567890abcdef'));
  assert.equal(r('обычный текст про 2026 год и PORT=8080'), 'обычный текст про 2026 год и PORT=8080');
  assert.equal(r(null), null);
});
test('masking is stable (running twice changes nothing)', () => {
  const once = r('SOME_TOKEN=abc123def456ghi789 ck_' + 'Q'.repeat(20));
  assert.equal(r(once), once);
});
