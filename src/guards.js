// Safe releases: a push to main/master or a production deploy goes only when, in this same run,
//   1) the tests passed (a test command finished without an error), unless the owner wrote «без тестов»;
//   2) the owner's last message agreed to the release (or was a short «да» to an answer that offered it).
// DEPLOY_GUARD=block (default) refuses the command and tells the model why; warn lets it through and
// adds a warning to the answer; off does nothing. Commands are matched as text, so a deploy hidden in
// a script file is not seen: the prompt rule (set -euo pipefail, tests first) covers the rest.
import { config } from './config.js';

export const DEPLOY_RE = /\bgit\s+push\b[^\n;|&]*?(?:\s|:|\+)(?:refs\/heads\/)?(?:main|master|prod|production)(?![\w\-/.])|\bvercel\b[^\n;|&]*\s--prod\b|\bvercel\s+deploy\b[^\n;|&]*\s--prod|\bnetlify\s+deploy\b[^\n;|&]*\s--prod\b|\bfly(?:ctl)?\s+deploy\b|\bwrangler\s+(?:deploy|publish|pages\s+deploy)\b|\bfirebase\s+deploy\b|\bnpm\s+publish\b|\bgh\s+pr\s+merge\b|\bkubectl\s+(?:apply|rollout)\b|\bdocker\s+push\b|\bcap\s+production\s+deploy\b|\bdeploy[-_:]?prod\w*\b/i;
export const TEST_RE = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|e2e|test:\w+|check|ci)\b|\bnpx\s+(?:vitest|jest|playwright\s+test|mocha|ava)\b|\b(?:vitest|jest|pytest|phpunit|rspec|mocha)\b|\bgo\s+test\b|\bcargo\s+test\b|\bnode\s+--test\b|\bmake\s+(?:test|check)\b|\bplaywright\s+test\b|\bpython3?\s+-m\s+(?:pytest|unittest)\b|\bdeno\s+test\b|\bmvn\s+test\b|\bgradle\w*\s+test\b/i;
// Cyrillic words: \b does not work for them in JS, so letters are checked with \p{L}.
const CONSENT_RE = /(выкат|выклад|выложи|выложить|задеплой|деплой|в прод|на прод|(?<!\p{L})прод(?!\p{L})|запуш|(?<!\p{L})пуш|\bpush\b|смерж|мерж|\bmerge\b|релиз|release|залей|заливай|публикуй)/iu;
const YES_RE = /^\s*(да|ага|ок|окей|ok|го|давай|поехали|делай|выкатывай|выкладывай|пушь|согласен|подтверждаю|можно|👍)(?!\p{L})/iu;
const NO_TESTS_RE = /без\s+тест/i;
const NEG_RE = /(не\s+(выкат|выклад|пуш|деплой|публик|мерж)|пока\s+не|стоп|подожди)/i;

// What the owner agreed to in this run: from his message (and the answer it replies to).
export function consentOf({ prompt, origin, prevResult = '' }) {
  if (!['bot', 'ui', 'cron'].includes(origin)) return { release: false, noTests: false };
  const p = String(prompt || '').replace(/<mainframe-[a-z]+>[\s\S]*?<\/mainframe-[a-z]+>/g, '').replace(/<handoff>[\s\S]*?<\/handoff>/g, '');
  const release = !NEG_RE.test(p) && (CONSENT_RE.test(p) || (YES_RE.test(p) && p.length < 200 && CONSENT_RE.test(String(prevResult).slice(-1500))));
  return { release, noTests: NO_TESTS_RE.test(p) };
}

// state: { consent, testsPassed, warnings: [] }, one per run.
export function deployHooks(state, onEvent = () => {}, cwd = '') {
  if (config.deployGuard === 'off') return {};
  const pre = async (input) => {
    if (input.tool_name !== 'Bash') return {};
    const cmd = String(input.tool_input?.command || '');
    if (!DEPLOY_RE.test(cmd)) return {};
    const missing = [];
    if (!state.testsPassed && !state.consent.noTests) missing.push('в этой задаче ещё не было успешного прогона тестов (запусти тесты проекта; если тестов нет, спроси владельца, можно ли выкладывать без тестов)');
    const trusted = !!config.deployTrusted && (config.deployTrusted.test(cmd) || config.deployTrusted.test(String(cwd)));
    if (!state.consent.release && !trusted) missing.push('в последнем сообщении владельца нет явного согласия на выкладку (спроси его и дождись «да, выкладывай»)');
    if (!missing.length) { onEvent(`Выкладка разрешена: тесты ${state.testsPassed ? 'прошли' : 'пропущены по слову владельца'}, ${state.consent.release ? 'есть согласие' : 'проект с постоянным разрешением владельца'}`); return {}; }
    const why = `Защита выкладки: ${missing.join('; ')}.`;
    if (config.deployGuard === 'warn') {
      state.warnings.push(why);
      onEvent(`Предупреждение: ${why}`);
      return {};
    }
    onEvent(`Заблокировано: ${cmd.slice(0, 160)}. ${why}`);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } };
  };
  // PostToolUse fires only for a command that succeeded (failures go to PostToolUseFailure).
  const post = async (input) => {
    if (input.tool_name === 'Bash' && TEST_RE.test(String(input.tool_input?.command || ''))) {
      const out = JSON.stringify(input.tool_response || '').slice(-4000);
      // A runner that prints failures but exits 0 (piped into tail, for example) does not count.
      if (!/\b[1-9]\d* (?:failed|failing|errors?)\b|FAILED|✗ \d|Tests:\s+\d+ failed/i.test(out)) { state.testsPassed = true; onEvent('Тесты прошли'); }
    }
    return {};
  };
  return { pre, post };
}

// ---------- system commands ----------
// sudo, rm -rf outside /tmp and the project folder, writes to /etc, systemctl, firewall (iptables, ufw,
// nft, pfctl): only when the owner's last message asks for work (or agrees to it). Someone else's
// message never gets them (inbox runs have no Bash at all). Scheduled tasks were written by the owner.
const SYS_PATTERNS = [
  [/(?:^|[\s;&|(`$])sudo\s/, 'sudo'],
  [/(?:^|[\s;&|(`$])(?:systemctl|service)\s+(?:start|stop|restart|reload|enable|disable|mask|kill|daemon-reload|isolate)\b/, 'управление службами'],
  [/(?:^|[\s;&|(`$])(?:iptables|ip6tables|nft|ufw|pfctl|firewall-cmd)\b/, 'брандмауэр'],
  [/(?:>\s*|\btee\s+(?:-a\s+)?|\bsed\s+-i\S*\s+(?:[^\n;|&]*\s)?|\bcp\s+[^\n;|&]*\s|\bmv\s+[^\n;|&]*\s|\bchmod\s+[^\n;|&]*\s|\bchown\s+[^\n;|&]*\s)\/etc\//, 'правка /etc'],
  [/(?:^|[\s;&|(`$])(?:reboot|shutdown|poweroff|halt)\b/, 'перезагрузка'],
];
const RM_RE = /(?:^|[\s;&|(`$])rm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b([^\n;|&]*)/g;
// A real request or agreement in the owner's own words.
const SYS_OK_RE = /(разреша|разрешено|делай|сделай|исправь|почини|чини|удали|почисти|очисти|перезапус|перезагруз|обнови|поставь|установи|настрой|выключи|включи|закрой|sudo|(?<!\p{L})да(?!\p{L})|давай|можно|продолжай|доделай|го(?!\p{L}))/iu;

// Paths an rm -rf may touch freely: /tmp, the project folder and relative paths inside it.
function rmOutside(cmd, cwd) {
  const bad = [];
  for (const m of cmd.matchAll(RM_RE)) {
    const args = m[2].trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
    for (let a of args) {
      a = a.replace(/^["']|["']$/g, '');
      if (/^(\/tmp\/|\/private\/tmp\/|\/var\/folders\/)/.test(a)) continue;
      if (cwd && (a === cwd || a.startsWith(`${cwd}/`))) continue;
      if (!a.startsWith('/') && !a.startsWith('~') && !a.startsWith('$') && !a.includes('..') && a !== '*' && a !== '.') continue;
      bad.push(a);
    }
  }
  return bad;
}

export function systemRisks(cmd, cwd = '') {
  const c = String(cmd || '');
  const found = SYS_PATTERNS.filter(([re]) => re.test(c)).map(([, why]) => why);
  const rm = rmOutside(c, cwd);
  if (rm.length) found.push(`удаление вне проекта (${rm.slice(0, 3).join(', ')})`);
  return found;
}

export function sysConsent({ prompt, origin }) {
  if (origin === 'cron') return true;
  if (!['bot', 'ui'].includes(origin)) return false;
  const p = String(prompt || '').replace(/<mainframe-[a-z]+>[\s\S]*?<\/mainframe-[a-z]+>/g, '').replace(/<handoff>[\s\S]*?<\/handoff>/g, '');
  return SYS_OK_RE.test(p) && !NEG_RE.test(p);
}

// state: the run's guard ({ origin, sysOk }); cwd: the project folder.
export function systemHooks(state, cwd, onEvent = () => {}) {
  return async (input) => {
    if (input.tool_name !== 'Bash') return {};
    const cmd = String(input.tool_input?.command || '');
    const risks = systemRisks(cmd, cwd);
    if (!risks.length || state.sysOk) return {};
    const why = `Системная команда (${risks.join(', ')}) только по прямой просьбе владельца в его последнем сообщении. Спроси его и дождись ответа.`;
    onEvent(`Заблокировано: ${cmd.slice(0, 160)}. ${why}`);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } };
  };
}
