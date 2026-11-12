// Content studio for the Social tab: drafts per network, calendar and publishing, idea bank,
// post analysis, competitors and a subscriber goal.
// Telegram and LinkedIn are published directly; other networks go through Metricool, which
// only a Claude session can reach, so they are handed to the «Соцсети» project.
import { config } from './config.js';
import { all, get, run, now, kvGet, kvSet, addLog } from './db.js';
import { bus } from './bus.js';
import { tgCall } from './telegram-mcp.js';
import { structured, startRun } from './agent.js';
import * as linkedin from './linkedin.js';
import { ensureSocialTask, channelStats } from './social.js';
import { watchedGroups } from './groups.js';
import { ownerContext } from './memory.js';

run(`CREATE TABLE IF NOT EXISTS content_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch TEXT, topic TEXT, network TEXT NOT NULL, text TEXT NOT NULL, notes TEXT,
  idea_id INTEGER, status TEXT NOT NULL DEFAULT 'draft', scheduled_at INTEGER, published_at INTEGER,
  url TEXT, ext_id TEXT, error TEXT, track TEXT, created_at INTEGER, updated_at INTEGER)`);
run(`CREATE TABLE IF NOT EXISTS content_ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, angle TEXT, why TEXT, source TEXT, score INTEGER, status TEXT NOT NULL DEFAULT 'new', created_at INTEGER)`);

export const NETWORKS = {
  telegram: 'Telegram', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube Shorts', facebook: 'Facebook',
};
const DIRECT = new Set(['telegram', 'linkedin']);
const contentModel = () => process.env.CONTENT_MODEL || 'sonnet';
const change = () => bus.change('content');
const day = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const trackedLink = (network, track) => `${config.owner.siteUrl}?utm_source=${network}&utm_campaign=mf&utm_content=${track}`;

const STYLE = () => `Ты пишешь посты от имени ${config.owner.name}${config.social.channel ? ` (Telegram-канал @${config.social.channel})` : ''}.${config.owner.about ? ` ${config.owner.about}` : ''} Кто он, что продаёт и как говорит, смотри в разделе «О владельце» ниже.
Стиль: от первого лица, просто и живо, как владелец говорит. Короткие абзацы. Без длинных тире (символ — запрещён, ставь запятую, точку или двоеточие). Без канцелярита и штампов вроде «в современном мире», «давайте разберёмся», «погрузимся», «не просто X, а Y». Без лишних англицизмов. Только факты и цифры из исходных данных, ничего не выдумывай: ни кейсов, ни цифр, ни отзывов. Без обещаний и гарантий результата.
Под сети:
- telegram: 400–1200 знаков, 0–2 эмодзи. Концовка разная: короткий вывод, совет, мнение, иногда вопрос. Не заканчивай каждый пост вопросом «А у вас…?» и смайликом.
- linkedin: деловой тон, 700–1500 знаков, первая строка цепляет, до 3 хэштегов в конце.
- instagram: подпись до 900 знаков; в notes сценарий рилс на 30–45 секунд по кадрам или 5–7 слайдов карусели.
- threads: до 450 знаков, одна мысль.
- tiktok и youtube: в text подпись до 150 знаков; в notes сценарий 30–45 секунд: хук в первые 3 секунды, суть, призыв.
- facebook: как telegram.
Поле notes заполняй только для instagram, tiktok и youtube (сценарий или слайды), для остальных сетей оставь пустым.
Ссылку (${config.owner.offerCta}) ставь меткой {{link}} (ровно одна на пост), только если её просят.`;

const DRAFTS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['posts'],
  properties: { posts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['network', 'text'], properties: { network: { type: 'string', enum: Object.keys(NETWORKS) }, text: { type: 'string' }, notes: { type: 'string' } } } } },
};

// ---------- the owner's voice and the anti-slop pass ----------
// Real posts from the channel are the style reference; every draft is checked for the usual
// machine-text tells and rewritten once if any are found, then dashes are removed mechanically.
const SLOP = [
  [/—|\s–\s/, 'длинное тире'],
  [/не просто [^.,!?]{1,50}, а /i, 'конструкция «не просто X, а Y»'],
  [/давайте|разберёмся|разберемся|погрузимся|погружаемся/i, '«давайте», «разберёмся», «погрузимся»'],
  [/в современном мире|в эпоху|в наше время|стремительно развива/i, 'вступление про «современный мир»'],
  [/важно (отметить|понимать|помнить)|стоит отметить|следует отметить/i, '«важно отметить»'],
  [/ключев(ой|ая|ое|ые) (роль|момент|фактор)|играет (важную|ключевую) роль/i, '«ключевая роль»'],
  [/революци|прорыв|меняет правила игры|game.?changer|игра ?чейнджер|новая эра/i, 'громкие слова («революция», «прорыв», «новая эра»)'],
  [/уникальн|инновацион|беспрецедент/i, '«уникальный», «инновационный»'],
  [/в заключение|подводя итог|итак,|таким образом,/i, '«в заключение», «итак», «таким образом»'],
  [/(^|\n)\s*(💡|🔥|✅|👉|🚀|📌|⚡️?)[^\n]*\n\s*(💡|🔥|✅|👉|🚀|📌|⚡️?)/u, 'эмодзи в начале строк списком'],
  [/(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}].*){4,}/su, 'больше трёх эмодзи'],
  [/это (не )?(просто )?(магия|волшебство)|звучит как магия/i, '«это магия»'],
  [/представьте(,| себе)/i, '«представьте себе»'],
  [/не секрет, что|ни для кого не секрет/i, '«не секрет, что»'],
  [/[🤔🙂😊👇]\s*$/u, 'смайлик в самом конце поста'],
  [/что я бы делал на вашем месте/i, 'шаблон «что я бы делал на вашем месте»'],
];
export const slopCheck = (text) => SLOP.filter(([re]) => re.test(String(text))).map(([, name]) => name);

let styleCache = { at: 0, text: '' };
async function styleExamples() {
  if (styleCache.text && Date.now() - styleCache.at < 24 * 3600000) return styleCache.text;
  try {
    const res = await tgCall('list_messages', { chat_id: config.social.channel, limit: 80 });
    const posts = (res?.results || []).filter((m) => String(m.text || '').length > 250).sort((a, b) => (b.engagement?.views || 0) - (a.engagement?.views || 0)).slice(0, 8);
    styleCache = { at: Date.now(), text: posts.map((m, i) => `Пример ${i + 1}:\n${String(m.text).slice(0, 900)}`).join('\n\n') };
  } catch { /* the style rules still apply without examples */ }
  return styleCache.text;
}
async function styleSystem() {
  const ex = await styleExamples();
  return `${STYLE()}${ownerContext() ? `\n\nО владельце (из его памяти):\n${ownerContext()}` : ''}${ex ? `\n\nНастоящие посты владельца из его канала. Пиши так же: такая же длина фраз, такие же слова, такая же интонация, так же мало пафоса. Не копируй их содержание.\n\n${ex}` : ''}`;
}
const REWRITE_SCHEMA = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } };
export async function writeClean(prompt) {
  const system = await styleSystem();
  const out = await structured({ prompt, schema: DRAFTS_SCHEMA, system, tools: [], maxTurns: 3, model: contentModel() });
  for (const p of out.posts) {
    const issues = slopCheck(p.text);
    if (issues.length) {
      try {
        const r = await structured({ system, tools: [], maxTurns: 3, model: contentModel(), schema: REWRITE_SCHEMA,
          prompt: `Перепиши пост для ${p.network} так, чтобы он звучал как живой владелец, а не как текст нейросети. Убери: ${issues.join('; ')}. Мысль, факты, ссылки и длину сохрани, остальное не трогай.\n\n"""\n${p.text}\n"""` });
        if (r.text && slopCheck(r.text).length < issues.length) p.text = r.text;
      } catch { /* keep the first version */ }
    }
    p.text = p.text.replace(/\s*—\s*/g, ', ').replace(/\s–\s/g, ', ');
  }
  return out;
}

// ---------- drafts ----------
export function saveDrafts({ topic, posts, ideaId = null, batch = `b${Date.now()}` }) {
  const ids = [];
  for (const p of posts) {
    if (!NETWORKS[p.network] || !String(p.text || '').trim()) continue;
    const id = Number(run('INSERT INTO content_posts (batch, topic, network, text, notes, idea_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      batch, String(topic || '').slice(0, 300), p.network, p.text, ['instagram', 'tiktok', 'youtube'].includes(p.network) ? p.notes || null : null, ideaId, 'draft', now(), now()).lastInsertRowid);
    const track = `p${id}`;
    const text = String(p.text).replace(/—/g, ',').replace(/\{\{link\}\}/g, trackedLink(p.network, track));
    run('UPDATE content_posts SET text = ?, track = ? WHERE id = ?', text, track, id);
    ids.push(id);
  }
  if (ideaId) run("UPDATE content_ideas SET status = 'used' WHERE id = ?", ideaId);
  change();
  return ids;
}

let generating = null;
export function generate({ topic, networks, link = false, ideaId = null, source = null }) {
  const nets = (networks || []).filter((n) => NETWORKS[n]);
  if (!nets.length) throw new Error('Выбери хотя бы одну сеть');
  if (!String(topic || source || '').trim()) throw new Error('Напиши тему или вставь текст');
  if (generating) throw new Error('Уже пишу посты, подожди минуту');
  generating = { topic: String(topic || source).slice(0, 120), networks: nets, at: Date.now() };
  change();
  const prompt = `${source ? `Перепакуй этот пост владельца под другие сети. Сохрани мысль и факты, меняй форму под сеть.\n\nИсходный пост:\n"""\n${String(source).slice(0, 4000)}\n"""\n` : `Тема или черновик мысли от владельца:\n"""\n${String(topic).slice(0, 4000)}\n"""\n`}
Сети: ${nets.join(', ')}. По одному посту на каждую сеть.${link ? ` В каждый пост поставь {{link}}: ${config.owner.offerCta}, с понятным призывом перед ней.` : ' Ссылку на продукт не ставь.'}`;
  writeClean(prompt)
    .then((out) => { saveDrafts({ topic: generating.topic, posts: out.posts, ideaId }); addLog('system', `Студия: ${out.posts.length} черновиков «${generating.topic.slice(0, 60)}»`); })
    .catch((e) => { addLog('error', `Студия: ${e.message}`); kvSet('content_gen_error', { message: e.message, at: Date.now() }); })
    .finally(() => { generating = null; change(); });
  return { ok: true };
}

export function updatePost(id, patch) {
  const p = get('SELECT * FROM content_posts WHERE id = ?', id);
  if (!p) throw new Error('Пост не найден');
  if (['published', 'sending'].includes(p.status)) throw new Error('Этот пост уже ушёл');
  if (patch.text != null) run('UPDATE content_posts SET text = ?, updated_at = ? WHERE id = ?', String(patch.text).replace(/—/g, ','), now(), id);
  change();
  return { ok: true };
}
export function deletePost(id) { run("DELETE FROM content_posts WHERE id = ? AND status NOT IN ('published', 'sending')", id); change(); return { ok: true }; }

// ---------- publishing ----------
async function notifyOwner(text, extra) {
  try { const { sendOwner } = await import('./bot.js'); return await sendOwner(text, extra); } catch { return null; }
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function viaMetricool(p, at) {
  const { pid } = ensureSocialTask();
  const when = new Date(at || Date.now() + 10 * 60000);
  startRun({ projectId: pid, origin: 'system', prompt: `Владелец подтвердил публикацию кнопкой в пульте. Поставь пост в Metricool, больше ничего не публикуй и не меняй.
1. getBrandSettings: brand и часовой пояс.
2. createScheduledPost в сеть ${p.network} на ${when.toISOString()} (переведи в часовой пояс бренда). Текст ниже без изменений.${p.notes ? ' Сценарий из заметок не публикуй, это подсказка для съёмки.' : ''}
   Если сеть требует фото или видео (Instagram, TikTok, YouTube), а их нет, создай пост черновиком на эту дату, чтобы владелец добавил медиа в Metricool.
3. Вызови mainframe content_mark: id ${p.id}, status "scheduled" (или "metricool_draft", если черновик), при ошибке status "failed" и error.

Текст:
"""
${p.text}
"""` });
  run("UPDATE content_posts SET status = 'sending', scheduled_at = ?, updated_at = ? WHERE id = ?", when.getTime(), now(), p.id);
  change();
}

export async function publishNow(id) {
  const p = get('SELECT * FROM content_posts WHERE id = ?', id);
  if (!p) throw new Error('Пост не найден');
  if (['published', 'sending'].includes(p.status)) throw new Error('Пост уже ушёл');
  if (!DIRECT.has(p.network)) { viaMetricool(p, null); return { ok: true, via: 'metricool' }; }
  run("UPDATE content_posts SET status = 'sending', updated_at = ? WHERE id = ?", now(), id);
  change();
  try {
    let url = null; let ext = null;
    if (p.network === 'telegram') {
      await tgCall('send_message', { chat_id: config.social.channel, message: p.text });
      const last = await tgCall('list_messages', { chat_id: config.social.channel, limit: 1 }).catch(() => null);
      ext = last?.results?.[0]?.id ?? null;
      url = ext ? `https://t.me/${config.social.channel}/${ext}` : `https://t.me/${config.social.channel}`;
    } else {
      const r = await linkedin.post({ text: p.text });
      url = r.url; ext = r.id;
    }
    run("UPDATE content_posts SET status = 'published', published_at = ?, url = ?, ext_id = ?, error = NULL, updated_at = ? WHERE id = ?", now(), url, ext ? String(ext) : null, now(), id);
    addLog('system', `Опубликован пост #${id} в ${NETWORKS[p.network]}`);
    change();
    return { ok: true, url };
  } catch (e) {
    run("UPDATE content_posts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", e.message.slice(0, 300), now(), id);
    change();
    throw e;
  }
}

export function schedule(id, at) {
  const p = get('SELECT * FROM content_posts WHERE id = ?', id);
  if (!p) throw new Error('Пост не найден');
  if (['published', 'sending'].includes(p.status)) throw new Error('Пост уже ушёл');
  if (!(at > Date.now() + 60000)) throw new Error('Выбери время в будущем');
  if (!DIRECT.has(p.network)) { viaMetricool(p, at); return { ok: true, via: 'metricool' }; }
  run("UPDATE content_posts SET status = 'scheduled', scheduled_at = ?, error = NULL, updated_at = ? WHERE id = ?", at, now(), id);
  change();
  return { ok: true };
}
export function unschedule(id) {
  const p = get('SELECT * FROM content_posts WHERE id = ?', id);
  if (!p || p.status !== 'scheduled') throw new Error('Пост не запланирован');
  if (!DIRECT.has(p.network)) throw new Error('Этот пост стоит в Metricool: отмени его там');
  run("UPDATE content_posts SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?", now(), id);
  change();
  return { ok: true };
}
export function markPost({ id, status, url, error }) {
  run('UPDATE content_posts SET status = ?, url = COALESCE(?, url), error = ?, updated_at = ? WHERE id = ?', status, url || null, error || null, now(), id);
  change();
}

// ---------- ideas ----------
const IDEAS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ideas'],
  properties: { ideas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'why', 'source', 'score'], properties: { title: { type: 'string' }, angle: { type: 'string' }, why: { type: 'string' }, source: { type: 'string' }, score: { type: 'integer', minimum: 1, maximum: 10 } } } } },
};
let ideasBusy = false;
export function addIdea({ title, angle = null, why = null, source = 'вручную', score = null }) {
  if (!String(title || '').trim()) throw new Error('Пустая идея');
  run('INSERT INTO content_ideas (title, angle, why, source, score, created_at) VALUES (?, ?, ?, ?, ?, ?)', String(title).slice(0, 300), angle, why, source, score, now());
  change();
  return { ok: true };
}
export function setIdeaStatus(id, status) { run('UPDATE content_ideas SET status = ? WHERE id = ?', status, id); change(); return { ok: true }; }

export async function refreshIdeas() {
  if (ideasBusy) throw new Error('Уже собираю идеи');
  ideasBusy = true;
  change();
  try {
    const ch = await channelStats().catch(() => null);
    const top = (ch?.posts || []).filter((p) => p.views).sort((a, b) => b.views - a.views).slice(0, 5);
    const thoughts = all("SELECT prompt FROM runs WHERE origin = 'bot' AND started_at > ? ORDER BY id DESC LIMIT 40", Date.now() - 14 * 86400000)
      .map((r) => r.prompt.replace(/\s+/g, ' ').slice(0, 250)).filter((t) => t.length > 40);
    const rivals = (await competitorStats().catch(() => ({ items: [] }))).items.flatMap((c) => c.top.slice(0, 2).map((p) => `${c.title}: ${p.text.slice(0, 200)} (${p.views} просм.)`));
    const existing = all("SELECT title FROM content_ideas WHERE created_at > ? ", Date.now() - 30 * 86400000).map((i) => i.title);
    const out = await structured({
      system: await styleSystem(), tools: [], maxTurns: 3, model: contentModel(), schema: IDEAS_SCHEMA,
      prompt: `Предложи 8 тем для постов владельца на ближайшую неделю. Опирайся только на данные ниже. Для каждой: title (тема в одну строку, как заголовок), angle (с какой стороны зайти, 1 предложение), why (почему сработает, со ссылкой на данные), source (откуда: «лучшие посты», «мысли владельца», «конкуренты»), score 1–10 (сила темы для продаж владельца и роста канала).
Не повторяй темы: ${existing.join('; ').slice(0, 1500) || 'нет'}.

Лучшие посты канала по просмотрам:
${top.map((p) => `- ${p.views} просм.: ${p.text.slice(0, 200)}`).join('\n') || 'нет данных'}

Мысли и задачи владельца за 2 недели (голосовые и сообщения в бот, не всё про контент, выбирай подходящее):
${thoughts.join('\n') || 'нет'}

Что заходит у похожих каналов:
${rivals.join('\n') || 'нет данных'}`,
    });
    for (const i of out.ideas) addIdea(i);
    kvSet('ideas_day', day());
    addLog('system', `Банк идей: +${out.ideas.length}`);
    return { added: out.ideas.length };
  } finally {
    ideasBusy = false;
    change();
  }
}

// ---------- analysis of the channel's posts ----------
let analysisCache = { at: 0, data: null };
export async function analysis() {
  if (analysisCache.data && Date.now() - analysisCache.at < 30 * 60000) return analysisCache.data;
  const ch = config.social.channel;
  const res = await tgCall('list_messages', { chat_id: ch, limit: 50 });
  const posts = (res?.results || []).map((m) => ({
    id: m.id, at: Date.parse(m.date), text: String(m.text || '').slice(0, 300), len: String(m.text || '').length, media: Boolean(m.media),
    views: m.engagement?.views ?? null, reactions: m.engagement?.reactions ?? 0, forwards: m.engagement?.forwards ?? 0, comments: m.comments ?? 0,
    link: `https://t.me/${ch}/${m.id}`,
  })).filter((p) => typeof p.views === 'number' && Date.now() - p.at > 86400000);
  if (!posts.length) return (analysisCache = { at: Date.now(), data: { count: 0 } }).data;
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, p) => s + p.views, 0) / xs.length) : null);
  const base = avg(posts);
  const group = (fn, labels) => labels.map(([key, label]) => { const xs = posts.filter((p) => fn(p) === key); return { label, n: xs.length, avg: avg(xs) }; }).filter((g) => g.n);
  const hour = (p) => new Date(p.at).getHours();
  const sorted = [...posts].sort((a, b) => b.views - a.views);
  const withEr = (p) => ({ ...p, vs: Math.round((p.views / base - 1) * 100), er: Math.round(((p.reactions + p.forwards + p.comments) / Math.max(1, p.views)) * 1000) / 10 });
  const data = {
    count: posts.length, avgViews: base,
    best: sorted.slice(0, 3).map(withEr), worst: sorted.length >= 6 ? sorted.slice(-3).reverse().map(withEr) : [],
    factors: [
      { title: 'Формат', rows: group((p) => (p.media ? 'm' : 't'), [['m', 'с фото или видео'], ['t', 'только текст']]) },
      { title: 'Длина', rows: group((p) => (p.len < 500 ? 's' : p.len < 1500 ? 'm' : 'l'), [['s', 'до 500 знаков'], ['m', '500–1500'], ['l', 'больше 1500']]) },
      { title: 'Время выхода', rows: group((p) => { const h = hour(p); return h < 6 ? 'n' : h < 12 ? 'm' : h < 18 ? 'd' : 'e'; }, [['m', 'утро 6–12'], ['d', 'день 12–18'], ['e', 'вечер 18–24'], ['n', 'ночь 0–6']]) },
    ],
  };
  analysisCache = { at: Date.now(), data };
  return data;
}

// ---------- competitors ----------
export const competitors = () => kvGet('content_competitors', []);
let compCache = { at: 0, data: null, key: '' };
export async function addCompetitor(username) {
  const u = String(username || '').trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '').split(/[/?]/)[0];
  if (!u) throw new Error('Нужен @username канала');
  const list = competitors();
  if (list.some((c) => c.username.toLowerCase() === u.toLowerCase())) return { ok: true };
  // Channels without a public @username are followed by their numeric id (the owner is subscribed).
  const full = await tgCall('get_full_chat', { chat_id: /^-?\d+$/.test(u) ? Number(u) : u });
  const info = typeof full?.result === 'string' ? JSON.parse(full.result) : full;
  if (!info?.title) throw new Error('Канал не найден');
  list.push({ username: info.username || String(info.id || u), title: info.title });
  kvSet('content_competitors', list);
  compCache.at = 0;
  change();
  return { ok: true };
}
export function removeCompetitor(u) { kvSet('content_competitors', competitors().filter((c) => c.username !== u)); compCache.at = 0; change(); return { ok: true }; }
export async function competitorStats() {
  const list = competitors();
  const key = list.map((c) => c.username).join(',');
  if (compCache.data && compCache.key === key && Date.now() - compCache.at < 6 * 3600000) return compCache.data;
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const items = [];
  for (const c of list) {
    try {
      const chat = /^-?\d+$/.test(c.username) ? Number(c.username) : c.username;
      const base = typeof chat === 'number' ? `https://t.me/c/${String(chat).replace(/^-100/, '')}` : `https://t.me/${c.username}`;
      const [full, msgs] = await Promise.all([tgCall('get_full_chat', { chat_id: chat }), tgCall('list_messages', { chat_id: chat, limit: 50 })]);
      const info = typeof full?.result === 'string' ? JSON.parse(full.result) : full;
      const posts = (msgs?.results || []).filter((m) => m.engagement?.views && Date.parse(m.date) > Date.now() - 7 * 86400000).map((m) => ({ id: m.id, text: String(m.text || (m.media ? `[${m.media}]` : '')).slice(0, 220), views: m.engagement.views, reactions: m.engagement.reactions || 0, link: `${base}/${m.id}` }));
      const avg = posts.length ? Math.round(posts.reduce((s, p) => s + p.views, 0) / posts.length) : null;
      items.push({ ...c, url: base, subscribers: info?.participants_count ?? null, posts7: posts.length, avgViews: avg, top: posts.sort((a, b) => b.views - a.views).slice(0, 3) });
    } catch (e) { items.push({ ...c, error: e.message.slice(0, 120), top: [] }); }
  }
  compCache = { at: Date.now(), key, data: { items } };
  return compCache.data;
}
export function findCompetitors() {
  const { pid } = ensureSocialTask();
  return startRun({ projectId: pid, origin: 'system', prompt: `Подбери владельцу 6–8 похожих Telegram-каналов для наблюдения. Его канал @${config.social.channel}. О чём канал и что владелец продаёт, посмотри в общей памяти и в последних постах канала (list_messages).
Ищи через telegram search_public_chats (запросы вроде «ИИ для бизнеса», «нейросети для работы», «AI автоматизация», «Claude», «ChatGPT для работы», «вайбкодинг»), проверяй каждого через get_full_chat и list_messages: русскоязычный авторский канал (не агрегатор промтов, не магазин ботов, не вакансии), 2 000–300 000 подписчиков, посты за последнюю неделю.
Уже в списке: ${competitors().map((c) => c.username).join(', ') || 'никого'}.
Сохрани найденных инструментом mainframe content_add_competitors (usernames без @). Ничего не публикуй, ни на что не подписывайся. В конце одной строкой: кого добавил и почему.` });
}

// ---------- automatic drafts from competitors' strong new posts ----------
export const autoConfig = () => kvGet('content_auto', { enabled: true, perDay: 3, networks: ['telegram'] });
export function setAutoConfig(patch) {
  const cfg = { ...autoConfig(), ...patch };
  cfg.perDay = Math.max(1, Math.min(6, Number(cfg.perDay) || 3));
  cfg.networks = (cfg.networks || ['telegram']).filter((n) => NETWORKS[n]);
  if (!cfg.networks.length) cfg.networks = ['telegram'];
  kvSet('content_auto', cfg);
  change();
  return cfg;
}
const words = (t) => new Set(String(t).toLowerCase().replace(/[^a-zа-яё0-9 ]/gi, ' ').split(/\s+/).filter((w) => w.length > 4));
const similar = (a, b) => { const A = words(a); const B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
const AD_RE = /erid|#реклама|реклама\b|партн[её]рский материал|розыгрыш|giveaway|промокод/i;
let autoBusy = false;
export async function autoFromRivals(max = 2) {
  const cfg = autoConfig();
  if (!cfg.enabled || autoBusy) return { added: 0 };
  const today = day();
  const count = kvGet('content_auto_day', { day: today, n: 0 });
  if (count.day !== today) { count.day = today; count.n = 0; }
  const room = Math.min(max, cfg.perDay - count.n);
  if (room <= 0) return { added: 0 };
  autoBusy = true;
  change();
  try {
    const used = kvGet('content_auto_used', []);
    const cands = [];
    for (const c of competitors()) {
      try {
        const chat = /^-?\d+$/.test(c.username) ? Number(c.username) : c.username;
        const base = typeof chat === 'number' ? `https://t.me/c/${String(chat).replace(/^-100/, '')}` : `https://t.me/${c.username}`;
        // Without from_date the newest messages come back (with it, the oldest ones of the window).
        const res = await tgCall('list_messages', { chat_id: chat, limit: 50 });
        const posts = (res?.results || []).filter((m) => m.engagement?.views && Date.parse(m.date) > Date.now() - 7 * 86400000).map((m) => ({ id: m.id, at: Date.parse(m.date), text: String(m.text || ''), views: m.engagement.views }));
        const old = posts.filter((p) => Date.now() - p.at > 86400000);
        const avg = old.length ? old.reduce((s, p) => s + p.views, 0) / old.length : null;
        if (!avg) continue;
        for (const p of posts) {
          const age = Date.now() - p.at;
          if (age < 4 * 3600000 || age > 48 * 3600000 || p.text.length < 250 || AD_RE.test(p.text)) continue;
          const key = `${c.username}:${p.id}`;
          if (used.some((u) => u.key === key)) continue;
          const ratio = p.views / avg;
          // Young posts are still gathering views: a lower bar before they are a day old.
          if (ratio < (age < 86400000 ? 0.75 : 1)) continue;
          cands.push({ key, channel: c.title, link: `${base}/${p.id}`, text: p.text, views: p.views, ratio: Math.round(ratio * 10) / 10 });
        }
      } catch (e) { addLog('error', `Автопосты: ${c.title}: ${e.message.slice(0, 120)}`); }
    }
    cands.sort((a, b) => b.ratio - a.ratio);
    const recentMine = all('SELECT text FROM content_posts WHERE created_at > ?', Date.now() - 5 * 86400000).map((r) => r.text);
    const picked = [];
    for (const cnd of cands) {
      if (picked.length >= room) break;
      // One news story often runs in several channels at once: take it once.
      if ([...picked.map((x) => x.text), ...used.slice(-60).map((u) => u.text || ''), ...recentMine].some((t) => similar(t, cnd.text) > 0.35)) continue;
      picked.push(cnd);
    }
    let added = 0;
    for (const cnd of picked) {
      const prompt = `Повод для поста владельца: свежий пост в похожем канале «${cnd.channel}» набрал ${cnd.views} просмотров, в ${cnd.ratio} раза больше их среднего. Значит, тема сейчас интересна аудитории.

Чужой пост (это только повод, не пересказывай его и не бери оттуда формулировки):
"""
${cnd.text.slice(0, 3500)}
"""

Напиши свой пост владельца на эту тему: коротко суть (только факты из поста выше, без новых цифр), потом взгляд владельца: что это значит для его аудитории (кто она, смотри в данных о владельце) и что с этим делать. Не приписывай владельцу опыт, которого нет в данных: не пиши «я попробовал», «я протестировал», «у меня клиенты». Можно «по-моему», «я бы», «мой совет». Не упоминай чужой канал. Ссылку на продукт не ставь.
Сети: ${cfg.networks.join(', ')}. По одному посту на сеть.`;
      try {
        const out = await writeClean(prompt);
        const ids = saveDrafts({ topic: `По мотивам «${cnd.channel}» (${cnd.views} просм., ×${cnd.ratio}): ${cnd.link}`, posts: out.posts });
        used.push({ key: cnd.key, text: cnd.text.slice(0, 400), at: Date.now() });
        kvSet('content_auto_used', used.slice(-300));
        count.n += 1; kvSet('content_auto_day', count);
        added += 1;
        // One message per network: each version gets its own publish button.
        await notifyOwner(`✍️ <b>Новый пост по мотивам «${esc(cnd.channel)}»</b>\nУ них ${cnd.views} просм., в ${cnd.ratio} раза выше среднего. <a href="${esc(cnd.link)}">Исходник</a>. Версий: ${ids.length}. Поправить или запланировать: пульт → «Соцсети» → «Студия».`, { disable_notification: true, link_preview_options: { is_disabled: true } });
        for (const pid of ids) {
          const post = get('SELECT * FROM content_posts WHERE id = ?', pid);
          if (!post) continue;
          const kb = { inline_keyboard: [[{ text: `🚀 Опубликовать в ${NETWORKS[post.network]}`, callback_data: `cpn:${post.id}` }, { text: '🗑 Не надо', callback_data: `cpd:${post.id}` }]] };
          await notifyOwner(`<b>${NETWORKS[post.network]}</b>${DIRECT.has(post.network) ? '' : ' · через Metricool'}\n\n${esc(post.text.slice(0, 3800))}`, { reply_markup: kb, disable_notification: true, link_preview_options: { is_disabled: true } });
        }
      } catch (e) { addLog('error', `Автопосты: ${e.message.slice(0, 200)}`); }
    }
    if (added) addLog('system', `Автопосты: ${added} черновиков по мотивам конкурентов`);
    return { added, candidates: cands.length };
  } finally {
    autoBusy = false;
    change();
  }
}

// ---------- subscriber goal ----------
export function setGoal({ target, deadline }) {
  if (!(Number(target) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(deadline || '')) throw new Error('Нужны цель и дата');
  kvSet('social_goal', { target: Number(target), deadline, set_at: Date.now() });
  change();
  return { ok: true };
}
export function goalState(subs) {
  const g = kvGet('social_goal', null);
  if (!g) return null;
  const hist = kvGet('channel_history', []);
  const cur = subs ?? hist[hist.length - 1]?.subs ?? null;
  if (cur == null) return { ...g };
  const weekAgo = hist.find((h) => h.day >= day(Date.now() - 7 * 86400000)) || hist[0];
  const days = weekAgo ? Math.max(1, Math.round((Date.now() - Date.parse(weekAgo.day)) / 86400000)) : 0;
  const pace = days ? Math.round(((cur - weekAgo.subs) / days) * 10) / 10 : null;
  const daysLeft = Math.max(0, Math.ceil((Date.parse(g.deadline) - Date.now()) / 86400000));
  const need = daysLeft ? Math.round(((g.target - cur) / daysLeft) * 10) / 10 : null;
  const forecast = pace && pace > 0 ? day(Date.now() + ((g.target - cur) / pace) * 86400000) : null;
  return { ...g, current: cur, left: Math.max(0, g.target - cur), daysLeft, pace, need, forecast, onTrack: pace != null && need != null && pace >= need };
}

// ---------- state for the tab ----------
export function contentState() {
  const posts = all(`SELECT * FROM content_posts WHERE status != 'published' OR published_at > ? ORDER BY COALESCE(scheduled_at, published_at, created_at) DESC LIMIT 80`, Date.now() - 21 * 86400000);
  const ideas = all("SELECT * FROM content_ideas WHERE status = 'new' ORDER BY COALESCE(score, 0) DESC, id DESC LIMIT 40");
  const err = kvGet('content_gen_error', null);
  return { posts, ideas, generating, ideasBusy, genError: err && Date.now() - err.at < 10 * 60000 ? err.message : null, networks: NETWORKS, direct: [...DIRECT], competitors: competitors(), goal: goalState(null), auto: { ...autoConfig(), today: (kvGet('content_auto_day', {}).day === day() ? kvGet('content_auto_day', {}).n : 0), busy: autoBusy } };
}

// ---------- background: due posts, morning confirmation, daily ideas, channel comments ----------
export function startContent() {
  // Comments under the channel's posts come into the inbox like the work groups: the linked
  // discussion chat is looked up once from the channel itself.
  if (config.social.channel && !kvGet('comments_chat_done', false)) {
    tgCall('get_full_chat', { chat_id: config.social.channel }).then((x) => {
      const info = typeof x?.result === 'string' ? JSON.parse(x.result) : x;
      kvSet('comments_chat_done', true);
      if (!info?.linked_chat_id) return;
      const id = Number(`-100${info.linked_chat_id}`);
      const groups = watchedGroups();
      if (groups.some((g) => g.id === id)) return;
      kvSet('watch_groups', [...groups, { id, title: `${info.title}: комментарии`, mode: 'all', skip: [info.title] }]);
      const { pid } = ensureSocialTask();
      run('INSERT OR IGNORE INTO contacts (chat_id, name, updated_at) VALUES (?, ?, ?)', String(id), `${info.title}: комментарии`, now());
      run('UPDATE contacts SET project_id = ? WHERE chat_id = ?', pid, String(id));
    }).catch(() => {});
  }
  const tick = async () => {
    for (const p of all("SELECT id FROM content_posts WHERE status = 'scheduled' AND scheduled_at <= ? AND network IN ('telegram', 'linkedin')", Date.now())) {
      try {
        const r = await publishNow(p.id);
        const post = get('SELECT network FROM content_posts WHERE id = ?', p.id);
        await notifyOwner(`📣 Вышел пост в ${NETWORKS[post.network]}${r.url ? `: <a href="${esc(r.url)}">открыть</a>` : ''}`, { disable_notification: true });
      } catch (e) { await notifyOwner(`⚠️ Пост #${p.id} не вышел: ${esc(e.message.slice(0, 200))}`); }
    }
    const d = new Date();
    // With a morning digest task, today's posts come inside it (todayPosts), not as their own card.
    if (!kvGet('digest_tasks', {}).morning && d.getHours() === 8 && d.getMinutes() >= 30 && kvGet('content_digest_day', '') !== day()) {
      kvSet('content_digest_day', day());
      const end = new Date(d); end.setHours(23, 59, 59, 999);
      const today = all("SELECT * FROM content_posts WHERE status IN ('scheduled', 'metricool_draft') AND scheduled_at BETWEEN ? AND ? ORDER BY scheduled_at", Date.now(), end.getTime());
      if (today.length) {
        const lines = today.map((p) => `<b>${new Date(p.scheduled_at).toTimeString().slice(0, 5)} · ${NETWORKS[p.network]}</b>${DIRECT.has(p.network) ? '' : ' (Metricool)'}\n<blockquote expandable>${esc(p.text.slice(0, 600))}</blockquote>`);
        const kb = { inline_keyboard: [[{ text: '✅ Всё ок', callback_data: 'cpok' }], ...today.filter((p) => DIRECT.has(p.network) && p.status === 'scheduled').map((p) => [{ text: `⏸ Снять ${NETWORKS[p.network]} ${new Date(p.scheduled_at).toTimeString().slice(0, 5)}`, callback_data: `cpx:${p.id}` }, { text: '🚀 Сейчас', callback_data: `cpn:${p.id}` }])] };
        await notifyOwner(`🗓 <b>Сегодня выйдет</b>\n\n${lines.join('\n\n')}`, { reply_markup: kb });
      }
    }
    if ([11, 17].includes(d.getHours()) && kvGet('content_auto_slot', '') !== `${day()}-${d.getHours()}`) {
      kvSet('content_auto_slot', `${day()}-${d.getHours()}`);
      autoFromRivals(d.getHours() === 11 ? 2 : 6).catch((e) => addLog('error', `Автопосты: ${e.message}`));
    }
    if (d.getHours() === 7 && kvGet('ideas_day', '') !== day() && !ideasBusy) refreshIdeas().catch((e) => addLog('error', `Банк идей: ${e.message}`));
  };
  setTimeout(tick, 20000);
  setInterval(tick, 60000).unref();
}

// Today's posts for the morning digest: a Markdown block and the «Снять» / «Сейчас» buttons.
export function todayPosts() {
  const d = new Date();
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  const today = all("SELECT * FROM content_posts WHERE status IN ('scheduled', 'metricool_draft') AND scheduled_at BETWEEN ? AND ? ORDER BY scheduled_at", d.getTime(), end.getTime());
  if (!today.length) return null;
  kvSet('content_digest_day', day());
  const hm = (t) => new Date(t).toTimeString().slice(0, 5);
  const md = `**🗓 Посты на сегодня**\n${today.map((p) => `- ${hm(p.scheduled_at)} ${NETWORKS[p.network]}${DIRECT.has(p.network) ? '' : ' (Metricool)'}: ${p.text.replace(/\s+/g, ' ').slice(0, 90)}…`).join('\n')}`;
  const rows = today.filter((p) => DIRECT.has(p.network) && p.status === 'scheduled')
    .map((p) => [{ text: `⏸ Снять ${NETWORKS[p.network]} ${hm(p.scheduled_at)}`, callback_data: `cpx:${p.id}` }, { text: '🚀 Сейчас', callback_data: `cpn:${p.id}` }]);
  return { md, rows };
}

// Buttons of the morning message.
export async function contentCallback(kind, id) {
  if (kind === 'cpok') return 'Принято';
  if (kind === 'cpx') { unschedule(Number(id)); return 'Снято, пост вернулся в черновики'; }
  if (kind === 'cpd') { for (const x of String(id).split(',')) deletePost(Number(x)); return 'Удалил черновик'; }
  if (kind === 'cpn') { const r = await publishNow(Number(id)); return r.url ? 'Опубликовано' : 'Отправлено'; }
  return null;
}
