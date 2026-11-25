// Yandex Metrika reports with the owner's own token (YANDEX_METRIKA_TOKEN in .env).
// The token never leaves this process: sessions get only the numbers.
const API = 'https://api-metrika.yandex.net';

export const metrikaConfigured = () => Boolean(process.env.YANDEX_METRIKA_TOKEN?.trim());

async function call(pathname, params = {}) {
  const token = process.env.YANDEX_METRIKA_TOKEN?.trim();
  if (!token) throw new Error('Нет YANDEX_METRIKA_TOKEN в .env');
  const url = new URL(pathname, API);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(30_000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Метрика ответила ${r.status}: ${body.message || body.errors?.[0]?.message || 'ошибка'}`);
  return body;
}

export async function metrikaCounters() {
  const b = await call('/management/v1/counters', { per_page: 100 });
  return (b.counters || []).map((c) => ({ id: c.id, name: c.name, site: c.site2?.site || c.site, status: c.status }));
}

// counter: id or part of the site name; metrics/dimensions in Metrika API syntax (ym:s:visits, ym:s:date).
export async function metrikaReport({ counter, date1 = '7daysAgo', date2 = 'today', metrics = 'ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate', dimensions = '', filters = '', limit = 20, sort = '' } = {}) {
  let id = String(counter || '').trim();
  if (!/^\d+$/.test(id)) {
    const list = await metrikaCounters();
    const hit = list.find((c) => !id || `${c.site} ${c.name}`.toLowerCase().includes(id.toLowerCase()));
    if (!hit) throw new Error(`Счётчик «${id}» не найден. Есть: ${list.map((c) => `${c.id} ${c.site}`).join(', ')}`);
    id = String(hit.id);
  }
  const b = await call('/stat/v1/data', { ids: id, date1, date2, metrics, dimensions, filters, limit: Math.min(Number(limit) || 20, 100), sort, accuracy: 'full' });
  return {
    counter: Number(id),
    period: `${b.query?.date1} … ${b.query?.date2}`,
    metrics: b.query?.metrics,
    totals: b.totals,
    rows: (b.data || []).map((d) => ({ dims: d.dimensions.map((x) => x.name ?? x.id), values: d.metrics })),
    sampled: Boolean(b.sampled),
  };
}
