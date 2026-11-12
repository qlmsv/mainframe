// Which model the sessions use. By default Claude through the owner's own Claude login (as before).
// Any provider with an Anthropic-compatible API works too: Claude Code (inside the Agent SDK) talks to
// it through ANTHROPIC_BASE_URL and a key. Useful where Claude is not available, or to save money.
// Settings live in .env (MODEL_PROVIDER, MODEL_API_KEY, MODEL_BASE_URL, MODEL_MAIN, MODEL_FAST) and can be
// changed from the dashboard; new sessions pick them up without a restart.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

// Endpoints checked against each provider's own docs (12.11.2026). Model names change often:
// the presets are a starting point, MODEL_MAIN / MODEL_FAST override them.
export const PROVIDERS = {
  claude: { name: 'Claude (подписка)', base: null },
  // https://docs.z.ai/devpack/tool/claude , https://docs.z.ai/scenario-example/develop-tools/claude
  glm: { name: 'GLM (Z.ai)', base: 'https://api.z.ai/api/anthropic', main: 'glm-5.2', fast: 'glm-4.7', keys: 'https://z.ai/manage-apikey/apikey-list', docs: 'https://docs.z.ai/devpack/tool/claude' },
  // https://platform.kimi.ai/docs/guide/claude-code-kimi
  kimi: { name: 'Kimi (Moonshot)', base: 'https://api.moonshot.ai/anthropic', main: 'kimi-k2.7-code', fast: 'kimi-k2.7-code', keys: 'https://platform.kimi.ai/console/api-keys', docs: 'https://platform.kimi.ai/docs/guide/claude-code-kimi' },
  // https://api-docs.deepseek.com/guides/anthropic_api
  deepseek: { name: 'DeepSeek', base: 'https://api.deepseek.com/anthropic', main: 'deepseek-v4-pro', fast: 'deepseek-v4-flash', keys: 'https://platform.deepseek.com/api_keys', docs: 'https://api-docs.deepseek.com/guides/anthropic_api' },
  // https://www.alibabacloud.com/help/en/model-studio/claude-code
  qwen: { name: 'Qwen (Alibaba)', base: 'https://dashscope-intl.aliyuncs.com/apps/anthropic', main: 'qwen3.6-plus', fast: 'qwen3.6-plus', keys: 'https://modelstudio.console.alibabacloud.com/', docs: 'https://www.alibabacloud.com/help/en/model-studio/claude-code' },
  // https://platform.minimax.io/docs/coding-plan/claude-code
  minimax: { name: 'MiniMax', base: 'https://api.minimax.io/anthropic', main: 'MiniMax-M3', fast: 'MiniMax-M3', keys: 'https://platform.minimax.io/user-center/basic-information/interface-key', docs: 'https://platform.minimax.io/docs/coding-plan/claude-code' },
  // https://openrouter.ai/docs/guides/guides/claude-code-integration (ANTHROPIC_API_KEY must be empty)
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api', main: '', fast: '', emptyApiKey: true, keys: 'https://openrouter.ai/keys', docs: 'https://openrouter.ai/docs/guides/guides/claude-code-integration' },
  // Payable in rubles from Russia, Claude itself and others behind one key (short Claude names map to
  // anthropic/… on /v1/messages). https://proxyapi.ru/docs/claude-code , prices https://proxyapi.ru/pricing
  proxyapi: { name: 'ProxyAPI (оплата в рублях)', base: 'https://api.proxyapi.ru', main: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5', keys: 'https://console.proxyapi.ru/keys', docs: 'https://proxyapi.ru/docs/claude-code' },
  custom: { name: 'Свой адрес API', base: '', main: '', fast: '' },
};

const env = (k) => String(process.env[k] ?? '').trim();
const current = () => ({
  provider: PROVIDERS[env('MODEL_PROVIDER')] ? env('MODEL_PROVIDER') : 'claude',
  key: env('MODEL_API_KEY'),
  baseUrl: env('MODEL_BASE_URL'),
  main: env('MODEL_MAIN'),
  fast: env('MODEL_FAST'),
});

export const isClaude = () => current().provider === 'claude';

// What the dashboard and the bot may see (never the key itself).
export function modelState() {
  const c = current();
  const p = PROVIDERS[c.provider];
  const r = resolved(c);
  return {
    provider: c.provider, name: p.name, keySet: Boolean(c.key), baseUrl: r.base || null,
    main: c.provider === 'claude' ? (env('WORK_MODEL') || 'по умолчанию Claude Code') : (r.main || null),
    fast: c.provider === 'claude' ? (env('FAST_MODEL') || 'claude-sonnet-5-5') : (r.fast || null),
    // claude.ai connectors (Gmail, Calendar, Drive, Metricool...) exist only with the Claude login.
    connectors: c.provider === 'claude',
    ready: c.provider === 'claude' || Boolean(c.key && r.base && r.main),
    providers: Object.entries(PROVIDERS).map(([id, x]) => ({ id, name: x.name, base: x.base, main: x.main || '', fast: x.fast || '', keys: x.keys || null, docs: x.docs || null })),
  };
}

function resolved(c) {
  const p = PROVIDERS[c.provider];
  // MODEL_BASE_<ID> (e.g. MODEL_BASE_DEEPSEEK) moves a preset to a mirror or a test stub.
  const base = c.provider === 'custom' ? c.baseUrl : (c.baseUrl || env(`MODEL_BASE_${c.provider.toUpperCase()}`) || p.base);
  const main = c.main || p.main || '';
  return { base, main, fast: c.fast || p.fast || main };
}

// Environment for a Claude Code session on another provider; null means «as before» (Claude login).
export function providerEnv(over = null) {
  const c = { ...current(), ...(over || {}) };
  if (c.provider === 'claude') return null;
  const p = PROVIDERS[c.provider];
  const r = resolved(c);
  if (!c.key || !r.base || !r.main) throw new Error(`Провайдер ${p.name}: не задан ${!c.key ? 'ключ' : !r.base ? 'адрес' : 'название модели'}`);
  return {
    ANTHROPIC_BASE_URL: r.base,
    ANTHROPIC_AUTH_TOKEN: c.key,
    ANTHROPIC_API_KEY: p.emptyApiKey ? '' : c.key,
    ANTHROPIC_MODEL: r.main,
    ANTHROPIC_DEFAULT_OPUS_MODEL: r.main,
    ANTHROPIC_DEFAULT_SONNET_MODEL: r.main,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: r.fast,
    ANTHROPIC_SMALL_FAST_MODEL: r.fast,
    CLAUDE_CODE_SUBAGENT_MODEL: r.fast,
    API_TIMEOUT_MS: '3000000',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
  };
}

// The env object a session gets: the process env plus the provider (the Claude login token is
// removed when another provider is used, so the request cannot fall back to Claude by accident).
export function sessionEnv(extra = {}, over = null) {
  const pe = providerEnv(over);
  if (!pe && !Object.keys(extra).length) return null;
  const e = { ...process.env, ...(pe || {}), ...extra };
  if (pe) delete e.CLAUDE_CODE_OAUTH_TOKEN;
  return e;
}

// Model names used in the code (aliases or Claude ids) mapped to the provider's models.
export function resolveModel(name) {
  const c = current();
  if (c.provider === 'claude') return name;
  const r = resolved(c);
  if (!name) return r.main;
  return /haiku|fast|small/i.test(name) ? r.fast : r.main;
}
export const mainModel = (claudeDefault) => (isClaude() ? claudeDefault : resolved(current()).main);
export const fastModel = (claudeDefault) => (isClaude() ? claudeDefault : resolved(current()).fast);

// Save to .env and apply at once (new sessions use it, running ones keep theirs).
const ENV_FILE = path.join(ROOT, '.env');
function writeEnv(pairs) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${String(v).replace(/[\r\n]/g, '')}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
    process.env[k] = String(v);
  }
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

export function saveModelSettings({ provider, key, baseUrl, main, fast }) {
  if (provider && !PROVIDERS[provider]) throw new Error('Нет такого провайдера');
  const pairs = {};
  if (provider) pairs.MODEL_PROVIDER = provider;
  if (typeof key === 'string' && key.trim()) pairs.MODEL_API_KEY = key.trim(); // empty field keeps the saved key
  if (typeof baseUrl === 'string') pairs.MODEL_BASE_URL = baseUrl.trim();
  if (typeof main === 'string') pairs.MODEL_MAIN = main.trim();
  if (typeof fast === 'string') pairs.MODEL_FAST = fast.trim();
  // Switching provider: the old one's model names make no sense for the new one.
  if (provider && provider !== current().provider) {
    if (typeof main !== 'string') pairs.MODEL_MAIN = '';
    if (typeof fast !== 'string') pairs.MODEL_FAST = '';
    if (typeof baseUrl !== 'string' && provider !== 'custom') pairs.MODEL_BASE_URL = '';
  }
  writeEnv(pairs);
  return modelState();
}

// A short real request through the chosen provider (settings from the form or the saved ones).
export async function testModel(over = {}) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const c = { ...current(), ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined && v !== '')) };
  const r = c.provider === 'claude' ? { main: process.env.WORK_MODEL || undefined } : resolved(c);
  // A wrong key makes Claude Code retry for a minute: ask the provider directly first, it answers at once.
  if (c.provider !== 'claude' && c.key && r.base) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${r.base.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': c.key, authorization: `Bearer ${c.key}` },
        body: JSON.stringify({ model: r.main, max_tokens: 8, messages: [{ role: 'user', content: 'Ответь одним словом: работаю' }] }),
        signal: AbortSignal.timeout(30000),
      });
      const why = { 401: 'ключ не подошёл', 403: 'ключ не подошёл или нет доступа к модели', 402: 'на балансе нет денег', 404: `модель ${r.main} не найдена` }[res.status];
      if (why) return { ok: false, text: '', error: why, ms: Date.now() - t0, model: r.main, provider: c.provider };
    } catch { /* no answer: the full check below will say so */ }
  }
  const options = { model: r.main || undefined, maxTurns: 1, persistSession: false, settingSources: [], tools: [], permissionMode: 'dontAsk' };
  const e = sessionEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }, c);
  if (e) options.env = e;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60000);
  options.abortController = ac;
  const t0 = Date.now();
  let text = ''; let model = null; let error = null;
  try {
    for await (const m of query({ prompt: 'Ответь одним словом: работаю', options })) {
      if (m.type === 'system' && m.subtype === 'init') model = m.model;
      if (m.type === 'result') { if (m.subtype === 'success' && !m.is_error) text = m.result || ''; else error = m.result || m.subtype; }
    }
  } catch (err) { error = ac.signal.aborted ? 'нет ответа за 60 секунд' : err.message; } finally { clearTimeout(timer); }
  return { ok: !error && Boolean(text), text: text.slice(0, 200), error: error ? String(error).slice(0, 300) : null, ms: Date.now() - t0, model, provider: c.provider };
}
