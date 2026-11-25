// Which result message answers the owner. The SDK can start several turns in one run (a background
// agent finishing starts another one); the first turn sometimes ends with an empty result while the
// real answer comes in the next turn. The answer is the first non-empty successful result; later
// non-empty results are background reports.
const text = (m) => String(m?.result || '').trim();
const okText = (m) => m?.subtype === 'success' && !m.is_error && Boolean(text(m));

// Returns { final, report } where report is a later result to show separately (or null).
export function pickFinal(final, m) {
  if (!final) return { final: m, report: null };
  if (!okText(final) && okText(m)) return { final: m, report: null };
  return { final, report: okText(m) ? m.result : null };
}
