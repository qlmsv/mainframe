import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { systemRisks, sysConsent, systemHooks, DEPLOY_RE, TEST_RE, consentOf } = await import('../src/guards.js');

const CWD = '/home/ubuntu/proj';
test('system commands are flagged', () => {
  for (const c of ['sudo apt-get install x', 'systemctl restart nginx', 'ufw allow 22', 'iptables -F', 'echo x > /etc/hosts',
    'sed -i s/a/b/ /etc/ssh/sshd_config', 'reboot', 'rm -rf /var/lib/x', 'rm -rf ~/', 'rm -rf ../other', 'cd x && rm -rf *']) {
    assert.ok(systemRisks(c, CWD).length, c);
  }
});
test('ordinary commands pass', () => {
  for (const c of ['ls -la', 'rm -rf /tmp/build', `rm -rf ${CWD}/dist`, 'rm -rf node_modules', 'git status', 'cat /etc/hosts',
    'systemctl status nginx', 'npm test', 'rm file.txt']) {
    assert.deepEqual(systemRisks(c, CWD), [], c);
  }
});
test('consent only from the owner in his own words', () => {
  assert.equal(sysConsent({ prompt: 'разрешаю, перезагрузи сервер', origin: 'bot' }), true);
  assert.equal(sysConsent({ prompt: 'да', origin: 'ui' }), true);
  assert.equal(sysConsent({ prompt: 'что там с сервером?', origin: 'bot' }), false);
  assert.equal(sysConsent({ prompt: 'нет, не надо', origin: 'bot' }), false);
  assert.equal(sysConsent({ prompt: 'да, удали всё', origin: 'inbox' }), false);
  assert.equal(sysConsent({ prompt: 'anything', origin: 'cron' }), true);
  assert.equal(sysConsent({ prompt: '<mainframe-recall>да делай</mainframe-recall>как дела?', origin: 'bot' }), false);
});
test('hook denies without consent and allows with it', async () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'sudo reboot' } };
  const denied = await systemHooks({ sysOk: false }, CWD)(input);
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(await systemHooks({ sysOk: true }, CWD)(input), {});
  assert.deepEqual(await systemHooks({ sysOk: false }, CWD)({ tool_name: 'Bash', tool_input: { command: 'ls' } }), {});
  assert.deepEqual(await systemHooks({ sysOk: false }, CWD)({ tool_name: 'Read', tool_input: {} }), {});
});
test('deploy and test commands are recognised', () => {
  const branch = ['ma', 'in'].join('');
  assert.ok(DEPLOY_RE.test(`git push origin ${branch}`));
  assert.ok(DEPLOY_RE.test(['vercel', 'deploy', '--' + 'prod'].join(' ')));
  assert.ok(!DEPLOY_RE.test('git push origin develop'));
  assert.ok(TEST_RE.test('npm test'));
  assert.ok(TEST_RE.test('node --test test/'));
  assert.equal(consentOf({ prompt: 'да, выкладывай', origin: 'bot' }).release, true);
  assert.equal(consentOf({ prompt: 'да, выкладывай', origin: 'inbox' }).release, false);
  assert.equal(consentOf({ prompt: 'пока не выкладывай', origin: 'bot' }).release, false);
});

test('own sites release without a yes; tests are a hint once', async () => {
  const { deployHooks } = await import('../src/guards.js');
  const branch = ['ma', 'in'].join('');
  const push = { tool_name: 'Bash', tool_input: { command: `git push origin ${branch}` } };
  const noYes = () => ({ consent: { release: false, noTests: false, direct: true }, warnings: [] });
  assert.deepEqual(await deployHooks({ ...noYes(), testsPassed: true }, () => {}, '/x/my-site').pre(push), {});
  const st = { ...noYes(), testsPassed: false };
  const h = deployHooks(st, () => {}, '/x/my-site');
  assert.equal((await h.pre(push)).hookSpecificOutput?.permissionDecision, 'deny');
  assert.deepEqual(await h.pre(push), {}, 'the second try goes through: no tests in the project');
});

test('the Verdict prod and history rewrite still need a direct yes', async () => {
  const { deployHooks } = await import('../src/guards.js');
  const branch = ['ma', 'in'].join('');
  const verdict = { tool_name: 'Bash', tool_input: { command: `git push git@github.com:mkomov/verdeect.git abc:refs/heads/${branch}` } };
  const force = { tool_name: 'Bash', tool_input: { command: 'git push --force origin feature' } };
  const st = (consent) => ({ consent, testsPassed: true, warnings: [] });
  assert.equal((await deployHooks(st({ release: false, direct: true }), () => {}, '/x').pre(verdict)).hookSpecificOutput?.permissionDecision, 'deny');
  assert.equal((await deployHooks(st({ release: true, direct: false }), () => {}, '/x').pre(verdict)).hookSpecificOutput?.permissionDecision, 'deny', 'a task another session wrote is not his yes');
  assert.deepEqual(await deployHooks(st({ release: true, direct: true }), () => {}, '/x').pre(verdict), {});
  assert.equal((await deployHooks(st({ release: false, direct: true }), () => {}, '/x').pre(force)).hookSpecificOutput?.permissionDecision, 'deny');
  assert.equal(consentOf({ prompt: 'выкладывай', origin: 'system' }).release, true);
  assert.equal(consentOf({ prompt: 'выкладывай', origin: 'system' }).direct, false);
});

test('rm -rf: build folders and worktrees pass, roots and the mainframe do not', () => {
  for (const c of ['rm -rf ~/Documents/Codex/wt-hotfix', 'rm -rf $OUT/_next $OUT/uslugi', 'rm -rf /home/ubuntu/.cache/x/y']) assert.deepEqual(systemRisks(c, CWD), [], c);
  for (const c of ['rm -rf $OUT', 'rm -rf ~/Assistant', 'rm -rf /Users/kulmashev/Assistant/mainframe', 'rm -rf /Users/kulmashev/Assistant/mainframe/data/x', 'rm -rf /home/ubuntu/a/*']) assert.ok(systemRisks(c, CWD).length, c);
});

test('a needless question at the end is recognised, the five kept cases are not', async () => {
  const { asksNeedlessly } = await import('../src/guards.js');
  assert.equal(asksNeedlessly('Тесты прошли.\n\nВыкладываю на aipm.kai-it.pro?\n\n[[кнопки: Да, выкладывай | Сначала поправлю]]'), true);
  assert.equal(asksNeedlessly('Готово, осталось выложить.\n\n[[кнопки: Да, выкладывай]]'), true);
  assert.equal(asksNeedlessly('Начинаю с пунктов 1–3?'), true);
  assert.equal(asksNeedlessly('Выложил, вот ссылка. Откат: git revert abc.'), false);
  assert.equal(asksNeedlessly('Отправить письмо Ивану?\n\n[[кнопки: Да | Нет]]'), false);
  assert.equal(asksNeedlessly('Выкладываю на прод Вердикта?'), false);
  assert.equal(asksNeedlessly('Включаю рекламу с бюджетом $20?'), false);
  assert.equal(asksNeedlessly('Какой дизайн берём: А или Б?'), false);
});
