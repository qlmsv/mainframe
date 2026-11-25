// Keys and tokens never get stored: chats with BotFather, pasted configs and tool output are copied
// into the history, so they are masked on the way in. No imports: the tests and the scrub script
// (scripts/scrub-secrets.mjs) use the same rules as the mainframe.

// Known shapes of keys. Each keeps only its public prefix (what kind of key it was), the rest is ***.
export const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk-ant-)[A-Za-z0-9_-]{20,}/g, // Anthropic
  /(?<![A-Za-z0-9_-])(sk-(?:proj-|svcacct-|or-v1-)?)[A-Za-z0-9_-]{20,}/g, // OpenAI, OpenRouter and the like
  /\b(gh[pousr]_)[A-Za-z0-9]{30,}/g, /\b(github_pat_)[A-Za-z0-9_]{30,}/g, /\b(glpat-)[A-Za-z0-9_-]{20,}/g,
  /\b(xox[abprse]-)[0-9A-Za-z-]{10,}/g, // Slack
  /\b(ck_)[A-Za-z0-9_-]{16,}/g, // Composio
  /\b(y0_{1,2})[A-Za-z0-9_-]{20,}/g, // Yandex OAuth (Метрика, Директ)
  /\b(AQAAAA)[A-Za-z0-9_-]{20,}/g, // older Yandex OAuth
  /\b(ya29\.)[A-Za-z0-9_.-]{20,}/g, /\b(1\/\/0)[A-Za-z0-9_-]{30,}/g, /\b(AIza)[0-9A-Za-z_-]{35}\b/g, // Google
  /\b(AKIA)[A-Z0-9]{16}\b/g, // AWS
  /\b(\d{8,10}:)[A-Za-z0-9_-]{35}\b/g, // Telegram bot token
  /\b(eyJ)[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b((?:Bearer|OAuth)\s+)(?!\*\*\*)(?=[A-Za-z0-9_\-.~+/]*\d)[A-Za-z0-9_\-.~+/]{16,}=*/g, // Authorization header values
];
// NAME=value, "Authorization": "...", x-api-key: ...
export const SECRET_KV_RE = /\b([A-Za-z0-9_-]*(?:TOKEN|SECRET|API_KEY|APIKEY|ACCESS_KEY|PASSWORD|PASSWD|PASS|SESSION_STRING|API_HASH|Authorization|x-api-key)[A-Za-z0-9_-]*["']?\s*[=:]\s*)(["']?)(?!\*\*\*)((?:Bearer\s+|OAuth\s+)?(?=[^\s"',}]*\d)(?=[^\s"',}]*[A-Za-z])[^\s"',}]{12,})/gi;

// The exact values from .env and mcp.json: names that look secret, header and env values of MCP
// servers, and stray .env lines without a name (a pasted piece of a key), commented out or not.
export function collectLiterals({ envText = '', mcpText = '' } = {}) {
  const out = new Set();
  for (const raw of String(envText).split('\n')) {
    const line = raw.replace(/^\s*#\s?/, '').trim();
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?(.*?)["']?\s*$/.exec(line);
    if (kv) { if (/TOKEN|SECRET|KEY|PASS|SESSION|HASH|COOKIE|AUTH/i.test(kv[1]) && kv[2].length >= 12) out.add(kv[2]); continue; }
    if (/^[A-Za-z0-9_\-+/=.]{16,}$/.test(line)) out.add(line);
  }
  try {
    const j = JSON.parse(mcpText || '{}');
    for (const s of Object.values(j.mcpServers || j || {})) {
      if (!s || typeof s !== 'object') continue;
      for (const v of [...Object.values(s.headers || {}), ...Object.values(s.env || {})]) {
        const val = String(v).replace(/^(Bearer|OAuth|Token|Basic)\s+/i, '').trim();
        if (val.length >= 12 && !val.includes('${')) out.add(val);
      }
    }
  } catch { /* not JSON: nothing to add */ }
  return out;
}

export function makeRedactor(literals = []) {
  const list = [...literals].filter((v) => v && v.length >= 8).sort((a, b) => b.length - a.length);
  return (s) => {
    if (s == null) return s;
    let t = String(s);
    for (const v of list) if (t.includes(v)) t = t.split(v).join('***');
    for (const re of SECRET_PATTERNS) t = t.replace(re, (m, pre) => (typeof pre === 'string' && pre.length < m.length ? `${pre}***` : '***'));
    return t.replace(SECRET_KV_RE, (m, k, q, v) => (/^\*+$/.test(v) || /\*\*\*$/.test(v) ? m : `${k}${q}***`));
  };
}
