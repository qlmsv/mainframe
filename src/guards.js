// Safe releases (25.11.2026: the owner wants no stops for his own sites). A push to main/master or a
// production deploy goes by itself once the tests ran in this run: without a test run the command is
// refused once with a hint to run them, and goes through on the next try (no tests in the project).
// The owner's «да» is needed only where a mistake cannot be undone or the product is not his:
// DEPLOY_ASK_RE (the Verdict prod by default) and rewriting git history (force push, filter-repo).
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
// Rewriting history: force push, +ref, filter-branch/filter-repo.
export const FORCE_RE = /\bgit\s+push\b[^\n;|&]*(?:\s--force(?:-with-lease)?\b|\s-f\b|\s\+\S+)|\bgit\s+(?:filter-branch|filter-repo)\b/i;
const NEG_RE = /(не\s+(выкат|выклад|пуш|деплой|публик|мерж)|пока\s+не|стоп|подожди)/i;

// What the owner agreed to in this run: from his message (and the answer it replies to).
export function consentOf({ prompt, origin, prevResult = '' }) {
  // system: a task the owner's own session handed to another project (start_run).
  if (!['bot', 'ui', 'cron', 'system'].includes(origin)) return { release: false, noTests: false };
  const p = String(prompt || '').replace(/<mainframe-[a-z]+>[\s\S]*?<\/mainframe-[a-z]+>/g, '').replace(/<handoff>[\s\S]*?<\/handoff>/g, '');
  const release = !NEG_RE.test(p) && (CONSENT_RE.test(p) || (YES_RE.test(p) && p.length < 200 && CONSENT_RE.test(String(prevResult).slice(-1500))));
  // direct: the owner's own words, not a task another session wrote (needed for the Verdict prod).
  return { release, noTests: NO_TESTS_RE.test(p), direct: ['bot', 'ui'].includes(origin) };
}

// state: { consent, testsPassed, warnings: [] }, one per run.
export function deployHooks(state, onEvent = () => {}, cwd = '') {
  if (config.deployGuard === 'off') return {};
  const pre = async (input) => {
    if (input.tool_name !== 'Bash') return {};
    const cmd = String(input.tool_input?.command || '');
    const force = FORCE_RE.test(cmd);
    if (!DEPLOY_RE.test(cmd) && !force) return {};
    const missing = [];
    const ask = config.deployAsk;
    const needsYes = force || (!!ask && (ask.test(cmd) || ask.test(String(cwd))));
    if (needsYes && !(state.consent.release && state.consent.direct !== false)) missing.push(force ? 'переписывание истории git (force push) только после прямого «да» владельца: спроси его' : 'это прод Вердикта: нужно прямое «да» владельца на выкладку, спроси его');
    // Tests: a hint once, never a question to the owner.
    if (!force && !state.testsPassed && !state.consent.noTests && !state.testsHinted) {
      state.testsHinted = true;
      missing.push('в этой задаче ещё не было успешного прогона тестов: запусти тесты проекта сам; если тестов в проекте нет, проверь сборку и повтори команду, после выкладки открой сайт и проверь. Владельца не спрашивай');
    }
    if (!missing.length) { onEvent(`Выкладка разрешена: тесты ${state.testsPassed ? 'прошли' : 'не найдены, проверено иначе'}${needsYes ? ', есть согласие' : ''}`); return {}; }
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
const SYS_OK_RE = /(выклад|выкат|выложи|собери|до конца|переключ|разреша|разрешено|делай|сделай|исправь|почини|чини|удали|почисти|очисти|перезапус|перезагруз|обнови|поставь|установи|настрой|выключи|включи|закрой|sudo|(?<!\p{L})да(?!\p{L})|давай|можно|продолжай|доделай|го(?!\p{L}))/iu;

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
      // Build folders, worktrees, caches: a named folder at least four levels deep, or $VAR/name.
      // Still refused: /, ~, a bare $VAR, short paths, .., a wildcard, the memory, the mainframe
      // and its data, keys, .git, a whole top-level project in ~/Assistant.
      const precious = /(Память|\/mainframe\/?$|mainframe\/(data|src)|\.ssh|\.env|\.git(?:\/|$)|\/Assistant\/[^/]+\/?$)/.test(a);
      const depth = a.replace(/^~|^\$\{?HOME\}?/, '/h/u').split('/').filter(Boolean).length;
      if (!precious && !a.includes('..') && !/[*]$/.test(a) && (depth >= 4 || /^\$\{?\w+\}?\/[\w.-]+/.test(a))) continue;
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
  if (!['bot', 'ui', 'system'].includes(origin)) return false;
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
    const why = `Системная команда (${risks.join(', ')}) только по прямой просьбе владельца в его последнем сообщении. Если можно обойтись без неё (папка внутри проекта, без sudo), сделай так; иначе спроси владельца одной строкой.`;
    onEvent(`Заблокировано: ${cmd.slice(0, 160)}. ${why}`);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } };
  };
}
// The answer ends asking for a «да» the owner gave in advance (25.11.2026): a question about the
// next step, or a first (recommended) button that just says «yes, do it».
const NL = '(?!\\p{L})';
export const ASK_END_RE = new RegExp([
  `(выкладыва(ю|ть|ем)|выкатыва(ю|ть|ем)|выложить|выкатить|продолжа(ть|ю|ем)|пуша(ть|ю|ем)|коммит(ить|им)?|запуска(ть|ю|ем)|запустить|начина(ть|ю|ем)|начать|начн(у|ём)|сделать|сделаю|сделаем|делаю|делаем|делать|доделать|доделаю|переключ\\p{L}*|включ(ить|аю|аем)|исправ(ить|лю|ляю)|поправ(ить|лю)|почин(ить|ю)|собира(ть|ю)|собрать|ставить|поставить)${NL}[^?\\n]{0,90}\\?`,
  `(после|жд[уё]т?|нужно|нужен)\\s[^\\n]{0,20}тво(его|ё|й)\\s«?(да|ок|продолжай|выкладывай)`,
  `^\\s*\\[\\[кнопки:\\s*(да${NL}|делай|сделай|продолжай|доделай|выкладывай|выкатывай|запускай|пушь|переключай|включай|поехали|го${NL})`,
].join('|'), 'imu');
// Kept: the five cases that still need the owner (people, money, deletion and git history, the
// Verdict prod, unrequested posts), and a real choice between different things.
export const KEEP_ASK_RE = /(вердикт|verdeect|миш[аиуеой](?!\p{L})|письм|напиш(у|ем)\s+(ему|ей|им|клиент)|ответ(ить|ь|им)\s+(ему|ей|им|клиент)|разосла|рассылк|реклам|бюджет|оплатить|заплатить|списать|удал(ить|ю|яю|им)|истори[юи]\s+git|force|опубликовать|публикую|публикуем|публикац|рилс|пост(ы|ов)?(?!\p{L}))/iu;
// A real choice: asked in the last question itself.
export const CHOICE_RE = /(какой\s|какую\s|какие\s|выбери|или\s[^?\n]{0,60}\?)/iu;
export function asksNeedlessly(text) {
  const lines = String(text || '').trim().split('\n');
  const buttons = lines.filter((l) => /^\s*\[\[кнопки:/i.test(l)).join('\n');
  const body = lines.filter((l) => !/^\s*\[\[.*\]\]\s*$/.test(l)).join('\n').trim().slice(-400);
  const t = `${body}\n${buttons}`;
  const lastQ = body.split('\n').filter((l) => l.includes('?')).pop() || '';
  return ASK_END_RE.test(t) && !KEEP_ASK_RE.test(body) && !CHOICE_RE.test(lastQ);
}
