// Мейнфрейм: один интерфейс для браузера на Mac, телефона и Telegram Mini App.
const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);

// ---------- theme ----------
function applyTheme() {
  const dark = inTelegram ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0f1012' : '#f4f2ee';
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
if (inTelegram) {
  tg.ready();
  tg.expand();
  tg.onEvent('themeChanged', applyTheme);
}

// ---------- icons ----------
const ICONS = {
  home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  sessions: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 10 3 2-3 2"/><path d="M13 14h4"/>',
  tasks: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  log: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  system: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3"/><path d="M3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 12h-4a2 2 0 0 0 0 4h4z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const initials = (name) => ((name || '').match(/[\p{L}\p{N}]+/gu) || ['?']).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
// Minimal markdown for Claude's replies: headings, bold, inline code, bullets. Input is escaped first.
// Bot-only markup in answers: buttons markers, <details>/<summary> and task boxes read as plain text here.
const plainBot = (t) => String(t ?? '').replace(/^\s*\[\[(кнопки|buttons|копировать|copy):.*\]\]\s*$/gim, '').replace(/<\/?details[^>]*>/g, '').replace(/<summary>(.*?)<\/summary>/g, '**$1**').replace(/^(\s*)- \[x\]/gim, '$1✅').replace(/^(\s*)- \[ \]/gm, '$1⬜').replace(/==([^=\n]+)==/g, '**$1**').replace(/!\[([^\]]+)\]\(tg:\/\/time[^)]*\)/g, '$1');
const md = (s) => esc(plainBot(s))
  .replace(/^#{1,4} (.+)$/gm, '<b>$1</b>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/^[-*] /gm, '• ');
const shortPath = (p) => (p || '').replace(/^\/Users\/[^/]+/, '~');

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 1000;
  if (diff < 0) {
    const t = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? `сегодня в ${t}` : `${d.toLocaleDateString('ru', { weekday: 'short', day: 'numeric', month: 'short' })}, ${t}`;
  }
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  const t = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return t;
  return `${d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })}, ${t}`;
}

const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
function cronHuman(expr) {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [m, h, dom, mon, dow] = p;
  const time = /^\d+$/.test(m) && /^\d+$/.test(h) ? `${h.padStart(2, '0')}:${m.padStart(2, '0')}` : null;
  if (/^\*\/\d+$/.test(m) && h === '*' && dom === '*' && dow === '*') return `каждые ${m.slice(2)} мин`;
  if (/^\d+$/.test(m) && h === '*' && dom === '*' && dow === '*') return m === '0' ? 'каждый час' : `каждый час в :${m.padStart(2, '0')}`;
  if (time && dom === '*' && mon === '*') {
    if (dow === '*') return `каждый день в ${time}`;
    if (dow === '1-5') return `по будням в ${time}`;
    if (dow === '0,6' || dow === '6,0') return `по выходным в ${time}`;
    if (/^\d$/.test(dow)) return `${DAYS[Number(dow)]} в ${time}`;
    if (/^[\d,]+$/.test(dow)) return `${dow.split(',').map((d) => DAYS[Number(d)]).join(', ')} в ${time}`;
  }
  if (time && /^\d+$/.test(dom) && mon === '*' && dow === '*') return `${dom} числа в ${time}`;
  return expr;
}

// Telegram's own dialog inside the Mini App: some clients ignore window.confirm there.
function ask(text) {
  if (inTelegram && tg.showConfirm) return new Promise((resolve) => tg.showConfirm(text, (ok) => resolve(Boolean(ok))));
  return Promise.resolve(confirm(text));
}

function toast(text, bad = false, action = null) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = text;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', () => { el.remove(); action.run(); });
    el.append(b);
  }
  $('#toast-root').append(el);
  setTimeout(() => el.remove(), action ? 6000 : Math.min(12000, Math.max(3200, text.length * 45)));
  if (inTelegram) tg.HapticFeedback?.notificationOccurred(bad ? 'error' : 'success');
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'x-mf-client': '1' };
  if (inTelegram) headers['x-tg-init-data'] = tg.initData;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

async function act(fn, okText) {
  try {
    const out = await fn();
    if (okText) toast(okText);
    await refresh();
    return out;
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

// ---------- state ----------
const VIEWS = [
  { id: 'home', title: 'Главная', icon: 'home', tab: true },
  { id: 'sessions', title: 'Сессии', icon: 'sessions', tab: true },
  { id: 'money', title: 'Деньги', icon: 'wallet', tab: true },
  { id: 'reach', title: 'Рост', icon: 'chart', tab: true },
  { id: 'memory', title: 'Память', icon: 'spark', more: 'Что агент знает о тебе и поиск по всей истории' },
  { id: 'people', title: 'Люди и сообщения', icon: 'people', more: 'Кто что писал: поиск и последние сообщения' },
  { id: 'system', title: 'Система', icon: 'system', more: 'Подключения, журнал, бот и пульт' },
  { id: 'more', title: 'Ещё', icon: 'more', tab: true, mobileOnly: true },
];
const MORE_VIEWS = ['more', 'memory', 'people', 'system'];
// Sections with segments. Optional modules add theirs (MF.view with section: 'money' or 'reach').
const SEGMENTS = {
  sessions: [['chats', 'Чаты'], ['schedule', 'Расписание']],
  money: [['finance', 'Финансы']],
  reach: [['social', 'Соцсети']],
};
// Old section ids (saved in the browser, links in the bot) open their new place.
// Modules add their own ids here when they register a segment.
const LEGACY = { inbox: ['home'], today: ['home'], notes: ['home'], tasks: ['sessions', 'schedule'], log: ['system'], finance: ['money', 'finance'], social: ['reach', 'social'], growth: ['reach'] };
const SEG = (() => { try { return JSON.parse(localStorage.getItem('mf_seg') || '{}'); } catch { return {}; } })();
function resolveView(id) {
  const l = LEGACY[id];
  if (!l) return id;
  if (l[1]) SEG[l[0]] = l[1];
  return l[0];
}
const segOf = (host) => {
  const list = SEGMENTS[host] || [];
  return list.some(([k]) => k === SEG[host]) ? SEG[host] : list[0]?.[0];
};
const S = {
  socTab: (() => { try { return localStorage.getItem('mf_soctab') || 'overview'; } catch { return 'overview'; } })(),
  view: resolveView(localStorage.getItem('mf_view') || 'home'),
  project: Number(localStorage.getItem('mf_project')) || null,
  detail: false,
  inboxFilter: 'open',
  logFilter: 'all',
  state: null,
  data: {},
  authFailed: false,
  panel: {}, // inbox id -> 'reply' | 'forward' | 'none'
  history: {}, // inbox id -> { open, items, loading, error }
  busy: {}, // inbox id -> 'suggest'
  focus: null, // inbox id selected from the keyboard
  past: {}, // project id -> earlier transcript of an attached session
  openSteps: {}, // unfolded "steps" lines in the chat
  attach: {}, // project id -> files attached to the next message
};
const OPEN_STATUSES = ['new', 'routed', 'error', 'done'];

// ---------- data loading ----------
async function load(view) {
  const d = S.data;
  // Composite sections load the data of their open segment.
  if (view === 'home') return loadHome(d);
  if (view === 'sessions') {
    api('/api/home').then((h) => { d.home = h; }).catch(() => {});
    if (segOf('sessions') === 'schedule') return load('tasks');
  }
  if (view === 'money') {
    const seg = segOf('money');
    await Promise.all([load('finance'), seg !== 'finance' ? load(seg) : null]);
    return;
  }
  if (view === 'reach') return load(segOf('reach'));
  if (view === 'people') {
    [d.inboxAll, d.contacts, d.projects, d.inboxRules] = await Promise.all([api('/api/inbox?filter=all'), api('/api/contacts'), api('/api/projects'), api('/api/inbox-rules').catch(() => [])]);
    return;
  }
  if (view === 'system') { d.log = await api('/api/log').catch(() => []); return; }
  if (view === 'inbox') [d.inbox, d.projects, d.inboxRules] = await Promise.all([api(`/api/inbox?filter=${S.inboxFilter}`), api('/api/projects'), api('/api/inbox-rules').catch(() => [])]);
  if (view === 'sessions') {
    const want = S.project;
    const [projects, timeline] = await Promise.all([api('/api/projects'), want ? api(`/api/projects/${want}/timeline`).catch(() => null) : null]);
    d.projects = projects;
    if (!S.project || !d.projects.some((p) => p.id === S.project)) S.project = d.projects[0]?.id ?? null;
    d.timeline = S.project === want && timeline ? timeline : (S.project ? await api(`/api/projects/${S.project}/timeline`) : []);
    // An attached session's history from before the mainframe: read once per project.
    const cur = d.projects.find((p) => p.id === S.project);
    if (cur?.session_id && S.past[cur.id]?.session !== cur.session_id) {
      S.past[cur.id] = { session: cur.session_id, ...(await api(`/api/projects/${cur.id}/past`).catch(() => ({ items: [], total: 0 }))) };
    }
  }
  if (view === 'tasks') [d.tasks, d.projects] = await Promise.all([api('/api/tasks'), api('/api/projects')]);
  if (view === 'people') [d.contacts, d.projects] = await Promise.all([api('/api/contacts'), api('/api/projects')]);
  if (view === 'log') d.log = await api('/api/log');
  if (MOD_VIEWS[view]?.load) {
    try { await MOD_VIEWS[view].load(d, view); d[`${view}Error`] = null; } catch (e) { d[`${view}Error`] = e.message; }
  }
  if (view === 'finance') {
    try { d.finance = await api('/api/finance'); d.financeError = null; } catch (e) { d.financeError = e.message; }
  }
  if (view === 'social') {
    try { [d.social, d.content] = await Promise.all([api('/api/social'), api('/api/content')]); d.socialError = null; } catch (e) { d.socialError = e.message; }
    const part = { overview: 'analysis', rivals: 'rivals' }[S.socTab || 'overview'];
    d.ins = d.ins || {};
    if (part && (!d.ins[part] || Date.now() - (d.ins[part]._at || 0) > 5 * 60000)) {
      api(`/api/content/insights?part=${part}`).catch((e) => ({ error: e.message })).then((x) => { d.ins[part] = { ...x, _at: Date.now() }; if (S.view === 'social') render(); });
    }
  }
  if (view === 'today') {
    try { d.agenda = await api('/api/agenda'); d.agendaError = null; } catch (e) { d.agendaError = e.message; }
  }
  if (view === 'memory') {
    try { d.memory = await api('/api/memory'); d.memoryError = null; } catch (e) { d.memoryError = e.message; }
  }
}

let refreshing = false;
let pending = false;
// A tap changes the screen at once from the data already in hand (or shows a light placeholder);
// fresh data replaces it a moment later. Waiting for the server before any change felt like a dead button.
const loadedViews = new Set();
const PH = '<div class="loading-ph"><span></span><span></span><span></span></div>';
function instant({ fresh = false } = {}) {
  // A section never opened (or another session's chat) would flash old or empty data: a placeholder instead.
  if (fresh || !loadedViews.has(S.view)) {
    try { renderShell(); } catch { /* shell is optional here */ }
    $('#view').innerHTML = PH;
    return;
  }
  try { render(); } catch { $('#view').innerHTML = PH; }
}

async function refresh() {
  if (refreshing) { pending = true; return; }
  refreshing = true;
  try {
    // The counters and the section's data come in parallel: one round trip instead of two.
    const view = S.view;
    const [st] = await Promise.all([api('/api/state'), load(view)]);
    S.state = st;
    // A module's tab opened before its script arrived: load its data now.
    if (await ensureModules(st.modules)) {
      // A saved module id (old link) points into its section now that the module is known.
      if (LEGACY[S.view]) { S.view = resolveView(S.view); localStorage.setItem('mf_view', S.view); }
      await load(S.view);
    }
    // An id nobody knows (a module that is not installed here): open the home screen.
    if (!VIEWS.some((v) => v.id === S.view)) { S.view = 'home'; localStorage.setItem('mf_view', 'home'); await load('home'); }
    S.authFailed = false;
    loadedViews.add(view);
    render();
  } catch (e) {
    if (/Нет доступа/.test(e.message)) { S.authFailed = true; render(); }
    else toast(e.message, true);
  } finally {
    refreshing = false;
    if (pending) { pending = false; refresh(); }
  }
}

// Do not re-render under the user's cursor: wait until they leave the field.
let dirty = false;
function softRefresh() {
  const a = document.activeElement;
  if (a && $('#view').contains(a) && ['TEXTAREA', 'INPUT', 'SELECT'].includes(a.tagName)) {
    dirty = true;
    refreshChatOnly();
    return;
  }
  refresh();
}
document.addEventListener('focusout', () => setTimeout(() => { if (dirty && !$('#view').contains(document.activeElement)) { dirty = false; refresh(); } }, 50));

async function refreshChatOnly() {
  if (S.view !== 'sessions' || !S.project) return;
  try {
    S.data.timeline = await api(`/api/projects/${S.project}/timeline`);
    const body = $('#chat-body');
    if (body) {
      const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      body.innerHTML = chatBody();
      if (atBottom) body.scrollTop = body.scrollHeight;
    }
  } catch { /* next refresh will retry */ }
}

// Live updates over a streamed fetch (EventSource cannot send our auth headers).
// Internal bookkeeping (feed position, journal lines) must not redraw the page every second.
const VIEW_EVENTS = { home: ['run', 'memory', 'inbox', 'finance', 'task'], money: ['finance'], reach: ['social', 'content'], inbox: ['inbox', 'project'], sessions: ['project', 'run', 'run_event', 'task'], tasks: ['task', 'project'], people: ['contact', 'project', 'inbox'], log: ['log'], system: ['telegram', 'tunnel', 'mail'], social: ['social', 'content'], memory: ['memory'], finance: ['finance'] };
function relevant(e) {
  if (e.type === 'kv') return ['paused', 'auth_error'].includes(e.id);
  if (e.type === 'run') return true; // counters and the "working" badge
  return (VIEW_EVENTS[S.view] || []).includes(e.type);
}

async function stream() {
  for (;;) {
    try {
      const headers = { 'x-mf-client': '1' };
      if (inTelegram) headers['x-tg-init-data'] = tg.initData;
      const res = await fetch('/api/events', { headers, credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let timer = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        const events = parts.filter((p) => p.startsWith('data:')).map((p) => { try { return JSON.parse(p.slice(5)); } catch { return {}; } });
        if (events.some(relevant)) {
          clearTimeout(timer);
          timer = setTimeout(softRefresh, 250);
        }
      }
    } catch { /* reconnect below */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ---------- shell ----------
function counts() {
  return { home: S.state?.counts?.inbox || 0, sessions: S.state?.running?.length || 0 };
}

function renderShell() {
  const c = counts();
  const nav = VIEWS.filter((v) => !v.mobileOnly).map((v) => `<button class="${S.view === v.id ? 'active' : ''}" data-nav="${v.id}">${icon(v.icon)}<span>${v.title}</span>${c[v.id] ? `<span class="count">${c[v.id]}</span>` : ''}</button>`).join('');
  $('#nav').innerHTML = nav;
  $('#tabbar').innerHTML = VIEWS.filter((v) => v.tab).map((v) => `<button class="${S.view === v.id || (v.id === 'more' && MORE_VIEWS.includes(S.view)) ? 'active' : ''}" data-nav="${v.id}">${icon(v.icon)}<span>${v.title}</span>${c[v.id] ? `<span class="count">${c[v.id]}</span>` : ''}</button>`).join('');
  $('#top-title').textContent = VIEWS.find((v) => v.id === S.view)?.title || 'Мейнфрейм';
  const paused = Boolean(S.state?.paused);
  // No stop buttons: the top button only appears to switch automation back on after a pause.
  $('#top-stop').innerHTML = `${icon('play')}<span>Включить</span>`;
  $('#top-stop').hidden = !paused;
  $('#top-stop').classList.toggle('paused', paused);
  $('#top-stop').setAttribute('aria-label', paused ? 'Включить автоматику' : 'Остановить всё');
  // The assistant's face shows what it is doing: a problem, work in progress, or calm.
  const face = S.state?.authError ? 'error' : c.sessions ? 'working' : 'idle';
  document.querySelectorAll('mf-spark.face').forEach((f) => { if (f.getAttribute('state') !== face) f.setAttribute('state', face); });
  $('#top-live').innerHTML = c.sessions ? `<span class="dot live"></span>${c.sessions} в работе` : '';

  const st = S.state;
  if (!st) return;
  const rows = [
    ['Claude', st.authError ? 'bad' : 'ok', st.authError ? 'нужен вход' : 'на связи'],
    ['Telegram', !st.telegram.enabled ? '' : st.telegram.process === 'running' ? 'ok' : st.telegram.error ? 'bad' : 'warn', !st.telegram.enabled ? 'не настроен' : st.telegram.process],
    ['Бот', !st.bot.configured ? '' : st.bot.status === 'running' ? 'ok' : 'bad', !st.bot.configured ? 'не настроен' : st.bot.username ? `@${st.bot.username}` : st.bot.status],
    ['Работает', st.running.length ? 'live' : '', st.running.length ? `${st.running.length} сесс.` : 'тихо'],
  ];
  $('#side-status').innerHTML = `
    ${rows.map(([k, cls, v]) => `<div class="status-row"><span class="dot ${cls}"></span><span>${k}</span><span class="grow"></span><span class="faint">${esc(v)}</span></div>`).join('')}
    ${st.paused ? `<button class="btn primary" data-action="resume" style="margin-top:6px">${icon('play')}Включить автоматику</button>` : ''}`;
  $('#brand-sub').textContent = st.paused ? 'автоматика на паузе' : 'личный пульт';
}

function renderBanner() {
  const st = S.state;
  const parts = [];
  if (st?.authError) {
    parts.push(`<div class="banner bad">${icon('system')}<div><b>Claude не авторизован</b>Сессии не запустятся, пока не войдёшь в аккаунт. На Mac в терминале выполни <span class="kbd">claude auth login</span> и нажми «Проверить». Для работы 24/7 лучше <span class="kbd">claude setup-token</span>, а токен вписать в .env как CLAUDE_CODE_OAUTH_TOKEN.</div><button class="btn small" data-action="clear-auth">Проверить</button></div>`);
  }
  if (st?.paused) parts.push(`<div class="banner warn">${icon('stop')}<div><b>Автоматика на паузе</b>Входящие собираются, но ничего не отправляется само и задачи по расписанию пропускаются.</div><button class="btn small" data-action="resume">Включить</button></div>`);
  $('#banner').innerHTML = parts.join('');
}

// Draft replies, the chosen forward project and the chat box survive a live update.
function keepInputs() {
  const kept = { fields: {}, chatScroll: null, pageScroll: window.scrollY, unfolded: [...$('#view').querySelectorAll('.clamp.open[data-key]')].map((el) => el.dataset.key) };
  for (const el of $('#view').querySelectorAll('[data-draft], [data-task], [data-fwd-project], [data-keep], [data-form="send"] textarea')) {
    const key = el.dataset.keep ? `K:${el.dataset.keep}` : el.dataset.draft ? `d${el.dataset.draft}` : el.dataset.task ? `k${el.dataset.task}` : el.dataset.fwdProject ? `f${el.dataset.fwdProject}` : `p${S.project}`;
    if (el.dataset.touched || el.tagName === 'TEXTAREA') kept.fields[key] = el.value;
  }
  const body = $('#chat-body');
  if (body) kept.chatScroll = { atBottom: body.scrollHeight - body.scrollTop - body.clientHeight < 60, top: body.scrollTop, project: S.project };
  return kept;
}
function restoreInputs(kept) {
  for (const el of $('#view').querySelectorAll('[data-draft], [data-task], [data-fwd-project], [data-keep], [data-form="send"] textarea')) {
    const key = el.dataset.keep ? `K:${el.dataset.keep}` : el.dataset.draft ? `d${el.dataset.draft}` : el.dataset.task ? `k${el.dataset.task}` : el.dataset.fwdProject ? `f${el.dataset.fwdProject}` : `p${S.project}`;
    if (key in kept.fields && kept.fields[key] !== '') { el.value = kept.fields[key]; el.dataset.touched = '1'; }
  }
  for (const key of kept.unfolded || []) $(`.clamp[data-key="${key}"]`)?.classList.add('open');
  window.scrollTo(0, kept.pageScroll);
}
// Follow new output only when the user is already at the bottom of the chat.
function stickToBottom(prev) {
  const body = $('#chat-body');
  if (!body) return;
  if (!prev || prev.project !== S.project || prev.atBottom) body.scrollTop = body.scrollHeight;
  else body.scrollTop = prev.top;
}
document.addEventListener('change', (e) => { if (e.target.dataset?.fwdProject) e.target.dataset.touched = '1'; });

function render() {
  if (S.authFailed) {
    $('#view').innerHTML = `<div class="empty"><div class="em-face"><mf-spark size="56"></mf-spark></div><div class="em-title">Нет доступа</div>Открой мейнфрейм через бота в Telegram или по ссылке с токеном со страницы «Система» на Mac.</div>`;
    return;
  }
  renderShell();
  renderBanner();
  const views = { home: viewHome, sessions: viewSessionsHost, money: viewMoney, reach: viewReach, memory: viewMemory, more: viewMore, people: viewPeopleMessages, system: viewSystemHost };
  const kept = keepInputs();
  $('#view').innerHTML = (MOD_VIEWS[S.view]?.render || views[S.view] || viewHome)();
  restoreInputs(kept);
  // Chat history opens on the latest messages.
  document.querySelectorAll('.history').forEach((h) => { h.scrollTop = h.scrollHeight; });
  if (S.view === 'sessions') stickToBottom(kept.chatScroll);
  if (inTelegram) {
    const back = tg.BackButton;
    if (S.view === 'sessions' && S.detail) back.show(); else back.hide();
  }
}

// ---------- hero: the big card at the top of each section ----------
function hero({ label, value, note = '', tiles = [], tone = '' }) {
  return `<section class="hero ${tone}"><div class="hero-top"><span class="hero-l">${label}</span><span class="hero-note">${note}</span></div>
    <div class="hero-v">${value}</div>
    ${tiles.length ? `<div class="hero-tiles">${tiles.map((t) => `<div class="hero-tile${t.nav || t.action ? ' tap' : ''}"${t.nav ? ` data-nav="${t.nav}"` : ''}${t.action ? ` data-action="${t.action}"` : ''}><span class="hero-ico" style="${t.bg ? `background:${t.bg}` : ''}">${t.icon}</span><span class="grow"><span class="hero-tn">${t.title}</span>${t.sub ? `<span class="hero-ts">${t.sub}</span>` : ''}</span>${t.value != null ? `<span class="hero-tv">${t.value}</span>` : ''}</div>`).join('')}</div>` : ''}
  </section>`;
}
const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many}`; };

// ---------- optional modules (src/modules.js): their tabs come as scripts that call MF.view ----------
const MOD_VIEWS = {};
const MOD_ACTIONS = {};
const MOD_FORMS = {};
const loadedModules = new Set();
window.MF = {
  get S() { return S; }, api, esc, icon, hero, plural, when, toast, act, ask, render, refresh, $,
  // MF.view({ id, title, icon, more, events: ['bus type'], load: async (data) => {}, render: () => html,
  //   actions: { name: (id, el) => {} }, forms: { name: (fields, form) => {} } })
  view(def) {
    MOD_VIEWS[def.id] = def;
    Object.assign(MOD_ACTIONS, def.actions || {});
    Object.assign(MOD_FORMS, def.forms || {});
    if (def.events) VIEW_EVENTS[def.id] = def.events;
    if (def.section && SEGMENTS[def.section]) {
      // A segment inside an existing section (a module's part of «Деньги» or «Рост»).
      LEGACY[def.id] = [def.section, def.id];
      if (!SEGMENTS[def.section].some(([k]) => k === def.id)) SEGMENTS[def.section].push([def.id, def.segTitle || def.title]);
      if (def.events) VIEW_EVENTS[def.section] = [...new Set([...(VIEW_EVENTS[def.section] || []), ...def.events])];
      return;
    }
    if (!VIEWS.some((v) => v.id === def.id)) {
      const at = VIEWS.findIndex((v) => v.id === 'more');
      VIEWS.splice(at < 0 ? VIEWS.length : at, 0, { id: def.id, title: def.title, icon: def.icon || 'spark', more: def.more || def.title });
      MORE_VIEWS.push(def.id);
    }
  },
};
// Loads the scripts and styles of modules the server has; true when something new arrived.
async function ensureModules(list = []) {
  let fresh = false;
  for (const m of list) {
    if (loadedModules.has(m.name)) continue;
    loadedModules.add(m.name);
    if (m.style) document.head.insertAdjacentHTML('beforeend', `<link rel="stylesheet" href="${esc(m.style)}">`);
    if (m.script) {
      await new Promise((resolve) => { const sc = document.createElement('script'); sc.src = m.script; sc.onload = resolve; sc.onerror = resolve; document.head.appendChild(sc); });
      fresh = true;
    }
  }
  return fresh;
}
// A stable colour per name for avatars.
const tint = (name = '') => { let h = 0; for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360; return `hsl(${h} 62% 52%)`; };

// ---------- views ----------
function projectOptions(selected, withEmpty = false) {
  const list = S.data.projects || [];
  return `${withEmpty ? '<option value="">Без проекта</option>' : ''}${list.map((p) => `<option value="${p.id}" ${Number(selected) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
}

const STATUS = {
  new: ['Новое', 'info'], routed: ['Ждёт решения', 'accent'], forwarded: ['В работе', 'warn'], done: ['Готово, ответить?', 'ok'],
  replied: ['Отвечено', 'ok'], sending: ['Отправляю…', 'warn'], ignored: ['Пропущено', ''], noted: ['Учтено', ''], error: ['Ошибка', 'bad'],
};
const ACTION = { forward: 'в сессию', reply: 'ответ по базе', note: 'без действий', ask: 'нужно твоё решение' };

function viewInbox() {
  const items = S.data.inbox || [];
  const head = `<div class="page-head"><div><h1>Входящие</h1><p>Сообщения из Telegram. Диспетчер предлагает, ты решаешь. <span class="kbd-hint"><kbd>J</kbd><kbd>K</kbd> выбрать · <kbd>R</kbd> ответить · <kbd>F</kbd> в сессию · <kbd>S</kbd> пропустить · <kbd>⌘↵</kbd> отправить</span></p></div>
    <div class="seg"><button class="${S.inboxFilter === 'open' ? 'on' : ''}" data-inbox-filter="open">Открытые</button><button class="${S.inboxFilter === 'all' ? 'on' : ''}" data-inbox-filter="all">Все</button></div></div>`;
  const all = S.data.inbox || [];
  const openAll = all.filter((i) => OPEN_STATUSES.includes(i.status));
  const today = all.filter((i) => i.created_at >= new Date().setHours(0, 0, 0, 0)).length;
  const bySrc = (src) => openAll.filter((i) => (i.source || 'telegram') === src).length;
  const top = hero({
    label: 'Ждут твоего решения', tone: 'warm',
    value: openAll.length ? plural(openAll.length, 'сообщение', 'сообщения', 'сообщений') : 'Всё разобрано ✨',
    note: today ? `сегодня пришло ${today}` : '',
    tiles: [
      { icon: '💬', title: 'Личка', sub: 'Telegram', value: bySrc('telegram') },
      { icon: '👥', title: 'Группы', sub: 'рабочие чаты', value: bySrc('group') },
      { icon: '✉️', title: 'Почта', sub: 'iCloud и Gmail', value: bySrc('mail') },
    ],
  });
  if (!items.length) {
    const tgOff = !S.state?.telegram?.enabled;
    return `${head}${top}<div class="card"><div class="empty"><div class="em-face"><mf-spark size="56"></mf-spark></div><div class="em-title">${tgOff ? 'Telegram-аккаунт ещё не подключён' : 'Пока тихо'}</div>${tgOff ? 'Заполни TELEGRAM_API_ID, TELEGRAM_API_HASH и TELEGRAM_SESSION_STRING в .env и перезапусти мейнфрейм.' : 'Как только кто-то напишет в личку, сообщение появится здесь.'}</div></div>`;
  }
  // Open items first and in full; handled ones below as short rows.
  // Urgent first, then today, then the rest; newest first inside each group.
  const open = items.filter((i) => OPEN_STATUSES.includes(i.status) || i.status === 'forwarded' || i.status === 'sending')
    .sort((a, b) => (URG_RANK[a.urgency] ?? 1) - (URG_RANK[b.urgency] ?? 1) || b.id - a.id);
  const closed = items.filter((i) => !open.includes(i));
  return `${head}${top}
    ${open.length ? `<div class="stack">${open.map(inboxCard).join('')}</div>` : ''}
    ${closed.length ? `${open.length ? '<div class="section-label">Разобрано</div>' : ''}<div class="card list" style="padding:0">${closed.map(inboxRow).join('')}</div>` : ''}
    ${rulesBlock()}`;
}

const URG_RANK = { 'срочно': 0, 'сегодня': 1, 'подождёт': 2 };
const URG_BADGE = { 'срочно': ['Срочно', 'bad'], 'сегодня': ['Сегодня', 'warn'], 'подождёт': ['Подождёт', ''] };
const RULE_ACTION = { show: 'показывать', quiet: 'тихо', skip: 'пропускать', batch: 'пакетом', urgent: 'срочно' };

// The owner's inbox rules: what each one does, how often it fired, a delete button.
function rulesBlock() {
  const rules = S.data.inboxRules || [];
  const rows = rules.map((r) => `<article class="msg compact li">
    <div class="li-main">
      <div class="msg-head"><span class="msg-name">${esc(r.description)}</span><span class="grow"></span><span class="badge">${RULE_ACTION[r.action] || r.action}</span><button class="btn small ghost" data-action="rule-del" data-id="${r.id}" title="Удалить правило" aria-label="Удалить">${icon('trash')}</button></div>
      <div class="faint">${esc([r.except_keywords?.length ? `кроме слов: ${r.except_keywords.join(', ')}` : '', r.except_text ? `кроме: ${r.except_text}` : ''].filter(Boolean).join(' · '))}${r.hits ? ` · сработало ${r.hits}` : ''}</div>
    </div></article>`).join('');
  return `<div class="section-label">Правила входящих</div><div class="card list" style="padding:0">${rows || '<div class="faint" style="padding:12px">Правил пока нет. Напиши в бот, например: «GitHub показывай тихо, кроме упоминаний меня».</div>'}</div>`;
}

function inboxRow(i) {
  const [label, cls] = STATUS[i.status] || [i.status, ''];
  const project = (S.data.projects || []).find((p) => p.id === i.project_id);
  const mail = mailParts(i);
  return `<article class="msg compact li">
    <div class="avatar">${mail ? icon('mail') : esc(initials(i.name))}</div>
    <div class="li-main">
      <div class="msg-head"><span class="msg-name">${esc(i.name || i.chat_id)}</span><span class="faint">${when(i.created_at)}</span><span class="grow"></span>${i.run_id && project ? `<button class="btn small ghost" data-open-project="${project.id}" title="Открыть сессию">${icon('sessions')}</button>` : ''}${['ignored', 'noted'].includes(i.status) ? `<button class="btn small ghost" data-action="restore" data-id="${i.id}" title="Вернуть в открытые" aria-label="Вернуть">${icon('undo')}</button>` : ''}<span class="badge ${cls}">${label}</span></div>
      <div class="msg-text clamp" data-key="r${i.id}">${esc(mail ? `${mail.subject} · ${mail.body}` : i.text)}</div>
    </div>
  </article>`;
}

const tgLink = (u) => (u ? `https://t.me/${encodeURIComponent(u)}` : null);
// Letters are stored as "subject\n\nbody": show the subject as a title.
function mailParts(i) {
  if (i.source !== 'mail') return null;
  let meta = {};
  try { meta = JSON.parse(i.meta || '{}'); } catch { /* old row */ }
  const subject = meta.subject || (i.text || '').split('\n')[0];
  const body = (i.text || '').startsWith(subject) ? (i.text || '').slice(subject.length).trim() : i.text || '';
  return { subject, body, email: meta.email || i.username || '' };
}

function defaultPanel(i, d) {
  if (i.status === 'done' || i.draft || d.action === 'reply') return 'reply';
  if (d.action === 'forward') return 'forward';
  return 'none';
}

function historyBlock(i) {
  const h = S.history[i.id];
  if (!h?.open) return '';
  if (h.loading) return '<div class="history"><div class="faint">Загружаю переписку…</div></div>';
  if (h.error) return `<div class="history"><div class="faint" style="color:var(--bad)">${esc(h.error)}</div></div>`;
  if (!h.items?.length) return '<div class="history"><div class="faint">Пусто</div></div>';
  return `<div class="history">${h.items.map((m) => `<div class="hmsg ${m.out ? 'out' : ''}"><span class="clamp" style="--lines:4">${esc(m.text)}</span><span class="htime">${m.date ? when(m.date) : ''}</span></div>`).join('')}</div>`;
}

function inboxCard(i) {
  const d = i.decision || {};
  const [label, cls] = STATUS[i.status] || [i.status, ''];
  const open = OPEN_STATUSES.includes(i.status);
  const project = (S.data.projects || []).find((p) => p.id === i.project_id);
  const panel = open ? (S.panel[i.id] || defaultPanel(i, d)) : 'none';
  const mail = mailParts(i);
  const link = mail ? null : tgLink(i.username);
  const h = S.history[i.id];
  const suggesting = S.busy[i.id] === 'suggest';
  const replyPanel = `<div class="panel full">
      <textarea class="input" rows="3" data-draft="${i.id}" placeholder="${mail ? 'Ответ письмом, в той же цепочке' : 'Ответ от твоего имени'}. Или пара слов, о чём ответить, и «Написать за меня»">${esc(i.draft || '')}</textarea>
      <div class="row">
        <button class="btn small" data-action="suggest" data-id="${i.id}" ${suggesting ? 'disabled' : ''}>${icon('spark')}${suggesting ? 'Пишу…' : i.draft ? 'Переписать' : 'Написать за меня'}</button>
        <span class="grow"></span>
        <button class="btn primary" data-action="reply" data-id="${i.id}">${icon('send')}Отправить</button>
      </div>
    </div>`;
  const forwardPanel = `<div class="panel full">
      <div class="row"><span class="faint">Проект</span><select class="input" data-fwd-project="${i.id}" aria-label="Проект">${projectOptions(i.project_id || d.project_id)}</select></div>
      <textarea class="input" rows="3" data-task="${i.id}" placeholder="Что сделать сессии. Пусто: выполнить правки из сообщения">${esc(d.task || '')}</textarea>
      <div class="row"><span class="faint">Сессия не напишет человеку сама: ответ придёт тебе на одобрение.</span><span class="grow"></span>
        <button class="btn primary" data-action="forward" data-id="${i.id}">${icon('sessions')}Отправить в сессию</button></div>
    </div>`;
  return `<article class="card raised msg ${S.focus === i.id ? 'focused' : ''}" data-item="${i.id}">
    <div class="avatar" style="background:${tint(i.name)};color:#fff">${esc(initials(i.name))}</div>
    <div class="msg-body">
      <div class="msg-head">${mail ? `<span class="src-mail" title="Письмо">${icon('mail')}</span>` : ''}<span class="msg-name">${esc(i.name || i.chat_id)}</span>${link ? `<a class="faint" href="${link}" data-tg-link="${link}" target="_blank" rel="noopener">@${esc(i.username)}</a>` : mail?.email && mail.email !== i.name ? `<span class="faint">${esc(mail.email)}</span>` : ''}<span class="faint">${when(i.created_at)}</span><span class="grow"></span>${open && URG_BADGE[i.urgency]?.[1] ? `<span class="badge ${URG_BADGE[i.urgency][1]}">${URG_BADGE[i.urgency][0]}</span>` : ''}<span class="badge ${cls}">${label}</span></div>
      ${mail ? `<div class="msg-subject">${esc(mail.subject)}</div>` : ''}
      <div class="msg-text clamp" data-key="t${i.id}">${esc(mail ? mail.body : i.text)}</div>
      ${d.summary ? `<div class="msg-summary"><div class="sum-text clamp" data-key="s${i.id}"><b>Диспетчер:</b>${esc(d.summary)}</div><div class="sum-tags">${d.action ? `<span class="badge ${d.action === 'ask' ? 'accent' : d.action === 'forward' ? 'info' : d.action === 'reply' ? 'ok' : ''}">${ACTION[d.action] || d.action}${d.action === 'forward' && project ? `: ${esc(project.name)}` : ''}</span>` : ''}${typeof d.confidence === 'number' ? `<span class="faint">уверен на ${Math.round(d.confidence * 100)}%</span>` : ''}</div></div>` : ''}
      ${d.error ? `<div class="msg-summary bad">${esc(d.error)}</div>` : ''}
      ${historyBlock(i)}
      ${i.status === 'forwarded' && project ? `<div class="row"><span class="dot live"></span><span class="muted">Сессия «${esc(project.name)}» работает</span><span class="grow"></span><button class="btn small" data-open-project="${project.id}">${icon('sessions')}Открыть</button></div>` : ''}
    </div>
      ${open ? `<div class="msg-tabs full">
        <button class="tabbtn ${panel === 'reply' ? 'on' : ''}" data-panel="reply" data-id="${i.id}">${icon('reply')}Ответить</button>
        ${i.status !== 'done' ? `<button class="tabbtn ${panel === 'forward' ? 'on' : ''}" data-panel="forward" data-id="${i.id}">${icon('sessions')}В сессию</button>` : ''}
        ${mail ? '' : `<button class="tabbtn ${h?.open ? 'on' : ''}" data-action="history" data-id="${i.id}">${icon('chat')}<span class="hide-xs">Переписка</span></button>`}
        <span class="grow"></span>
        ${i.status === 'error' ? `<button class="tabbtn" data-action="reclassify" data-id="${i.id}">${icon('refresh')}</button>` : ''}
        <button class="tabbtn" data-action="ignore" data-id="${i.id}">Пропустить</button>
      </div>
      ${panel === 'reply' ? replyPanel : panel === 'forward' ? forwardPanel : ''}` : ''}
  </article>`;
}

function viewSessions() {
  const projects = S.data.projects || [];
  const p = projects.find((x) => x.id === S.project);
  const running = p?.running;
  const list = `<div class="plist-wrap">
    <div class="row" style="margin-bottom:10px"><button class="btn primary small" data-action="new-project">${icon('plus')}Проект</button><button class="btn small" data-action="attach">${icon('link')}Из Claude Code</button></div>
    <div class="plist">${projects.map((x) => `<button class="pitem ${x.id === S.project ? 'active' : ''}" data-project="${x.id}">
      <span class="dot ${x.running ? 'live' : x.last?.status === 'error' ? 'bad' : x.session_id ? 'ok' : ''}"></span>
      <span class="grow"><span class="pitem-name">${esc(x.name)}</span><span class="pitem-sub" style="display:block">${esc(x.last?.prompt ? x.last.prompt.slice(0, 70) : shortPath(x.cwd))}</span></span>
      <span class="faint">${x.last ? when(x.last.started_at) : ''}</span>
    </button>`).join('')}</div></div>`;

  const chat = p ? `<div class="chat-wrap"><section class="card raised chat">
    <div class="chat-head">
      <button class="icon-btn mobile-only" data-action="back" aria-label="Назад" style="display:${S.detail ? '' : 'none'}">${icon('back')}</button>
      <div class="grow"><div style="font-weight:600">${esc(p.name)}</div><div class="faint mono">${esc(shortPath(p.cwd))}${p.session_id ? ` · ${p.session_id.slice(0, 8)}` : ' · новая сессия'}</div></div>
      <button class="btn small ghost" data-action="edit-project">${icon('edit')}</button>
      <button class="btn small ghost" data-action="new-session" title="Следующее сообщение начнёт новую сессию">Новая сессия</button>
    </div>
    <div class="chat-body" id="chat-body">${chatBody()}</div>
    <div class="attach-row" id="attach-row">${attachChips()}</div>
    <form class="chat-foot" data-form="send">
      <label class="icon-btn attach-btn" title="Прикрепить скриншот или файл">${icon('clip')}<input type="file" multiple hidden data-attach-input accept="image/*,application/pdf,.txt,.md,.csv,.json,.docx,.xlsx"></label>
      <textarea class="input" name="prompt" rows="1" placeholder="Задача для «${esc(p.name)}». Скриншот можно вставить ⌘V"></textarea>
      <button class="btn primary" type="submit" aria-label="Отправить">${icon('send')}</button>
    </form>
  </section></div>` : `<div class="card"><div class="empty"><div class="em-title">Нет проектов</div>Создай проект или подключи сессию Claude Code.</div></div>`;

  const nRunning = (S.state?.running || []).length;
  const last = projects.filter((x) => x.last).sort((a, b) => b.last.started_at - a.last.started_at)[0];
  const top = S.detail ? '' : hero({
    label: 'Сессии Claude Code', tone: 'violet',
    value: nRunning ? `${plural(nRunning, 'работает', 'работают', 'работают')} сейчас` : 'Все свободны',
    note: last ? `последняя активность ${when(last.last.started_at)}` : '',
    tiles: [
      { icon: '🧠', title: 'Проектов', value: projects.length },
      { icon: '⚡', title: 'Работают', value: nRunning },
      ...(last ? [{ icon: '🕐', title: esc(last.name), sub: esc((last.last.prompt || '').slice(0, 60)) }] : []),
    ],
  });
  return `${top}<div class="page-head"><div><h1>Сессии</h1><p>Каждый проект это своя папка и своя сессия Claude Code.</p></div></div>
    <div class="split ${S.detail ? 'detail' : ''}">${list}${chat}</div>`;
}

const ORIGIN = { ui: 'из мейнфрейма', bot: 'из бота', cron: 'по расписанию', inbox: 'из Telegram' };
// Like Claude Code: the request, one folded "steps" line (tools and thinking-out-loud), the answer.
const toolName = (n) => String(n || '').replace(/^mcp__/, '').replace(/^claude_ai_/, '').replace(/__/g, ' · ');
function stepsBlock(key, steps, { live = false, took = '' } = {}) {
  if (!steps.length && !live) return '';
  const tools = steps.filter((x) => x.kind === 'tool').length;
  const last = steps[steps.length - 1];
  const label = live
    ? `<mf-spark size="24" state="${last?.kind === 'tool' ? 'working' : 'thinking'}"></mf-spark>${last ? esc(last.kind === 'tool' ? toolName(last.name) : 'думает') : 'Начинаю'}…`
    : `${tools ? `${tools} ${tools === 1 ? 'шаг' : tools < 5 ? 'шага' : 'шагов'}` : 'Ход работы'}${took ? ` · ${took}` : ''}`;
  const rows = steps.map((x) => (x.kind === 'tool'
    ? `<div class="tool">${icon('tool')}<b>${esc(toolName(x.name))}</b><span>${esc(x.input || '')}</span></div>`
    : x.kind === 'sys' ? `<div class="sys">${esc(x.text)}</div>`
      : `<div class="thought">${md(x.text)}</div>`)).join('');
  return `<details class="steps" data-steps="${key}" ${S.openSteps[key] ? 'open' : ''}><summary>${label}</summary><div class="steps-body">${rows}</div></details>`;
}

function pastBlock(hasRuns = true) {
  const past = S.past[S.project];
  if (!past?.items?.length) return '';
  const more = past.total > past.items.length ? `<button class="btn small ghost" data-action="past-all">Показать всё (${past.total})</button>` : '';
  // Group each request with what followed it; the last text of the group is the answer.
  const out = [];
  let group = [];
  const flush = (i) => {
    if (!group.length) return;
    const lastText = [...group].reverse().find((x) => x.role === 'ai');
    const steps = group.filter((x) => x !== lastText).map((x) => (x.role === 'tool' ? { kind: 'tool', name: x.text, input: x.count ? `× ${x.count}` : '' } : { kind: 'text', text: x.text }));
    out.push(stepsBlock(`past${S.project}-${i}`, steps));
    if (lastText) out.push(`<div class="bubble ai"><span class="clamp" style="--lines:14">${md(lastText.text)}</span></div>`);
    group = [];
  };
  past.items.forEach((m, i) => {
    if (m.role === 'user') { flush(i); out.push(`<div class="bubble me"><span class="clamp" style="--lines:8">${esc(m.text)}</span></div>`); } else group.push(m);
  });
  flush('end');
  return `<div class="past"><div class="run-sep">Раньше в этой сессии · из терминала или приложения Claude</div>${more}${out.join('')}
    ${hasRuns ? '<div class="run-sep">дальше: из мейнфрейма</div>' : ''}</div>`;
}

function chatBody() {
  const runs = S.data.timeline || [];
  if (!runs.length && S.past[S.project]?.items?.length) return pastBlock(false);
  if (!runs.length) return `<div class="empty"><div class="em-face"><mf-spark size="56"></mf-spark></div><div class="em-title">Сессия пустая</div>Напиши задачу внизу. Claude работает в папке проекта с полными правами.</div>`;
  return pastBlock() + runs.map((r) => {
    const out = [`<div class="run-sep">${when(r.started_at)}</div>`];
    out.push(`<div class="bubble me"><span class="origin">${ORIGIN[r.origin] || r.origin}</span>${esc(r.prompt)}</div>`);
    const live = ['running', 'queued'].includes(r.status);
    const texts = r.events.filter((e) => e.kind === 'text');
    // The answer: the run's result, or its last text. Everything before it is "steps".
    const answer = !live ? (r.result || texts[texts.length - 1]?.content || '') : '';
    const answerEvent = !live && texts.length && (!r.result || r.result.trim() === texts[texts.length - 1].content.trim()) ? texts[texts.length - 1] : null;
    const steps = [];
    const errors = [];
    for (const e of r.events) {
      if (e === answerEvent) continue;
      if (e.kind === 'tool') { let t = {}; try { t = JSON.parse(e.content); } catch { /* raw */ } steps.push({ kind: 'tool', name: t.name, input: t.input }); }
      else if (e.kind === 'text') steps.push({ kind: 'text', text: e.content });
      else if (e.kind === 'system') steps.push({ kind: 'sys', text: e.content });
      else if (e.kind === 'notify') steps.push({ kind: 'sys', text: `🔔 ${e.content}` });
      else if (e.kind === 'error') errors.push(e.content);
    }
    const took = r.finished_at && r.started_at ? (() => { const sec = Math.round((r.finished_at - r.started_at) / 1000); return sec < 60 ? `${sec} с` : `${Math.floor(sec / 60)} мин ${sec % 60} с`; })() : '';
    out.push(stepsBlock(`run${r.id}`, steps, { live, took }));
    if (r.status === 'queued') out.push('<div class="sys">В очереди</div>');
    if (answer && r.status !== 'error') out.push(`<div class="bubble ai">${md(answer)}</div>`);
    for (const err of errors.slice(-1)) out.push(`<div class="bubble err">${esc(err)}</div>`);
    if (r.status === 'stopped') out.push('<div class="sys">Остановлено</div>');
    return out.join('');
  }).join('');
}

// ---------- today: meetings and reminders ----------
const dayKey = (ts) => new Date(ts).toDateString();
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === tomorrow.toDateString()) return 'Завтра';
  return d.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
}
// "22:00–00:00" on the event's day → is it happening now?
function eventNow(e) {
  const m = (e.time || '').match(/^(\d{1,2}):(\d{2})[–-](\d{1,2}):(\d{2})$/);
  if (!m || !e.start) return false;
  const end = new Date(e.start); end.setHours(Number(m[3]), Number(m[4]), 0, 0);
  if (end <= e.start) end.setDate(end.getDate() + 1);
  return Date.now() >= e.start && Date.now() < end;
}

function viewToday() {
  const a = S.data.agenda;
  const now = new Date();
  const head = `<div class="page-head"><div><h1>Сегодня</h1><p>${now.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' })}. Встречи на неделю и напоминания из приложений Apple.</p></div>
    <div class="row"><button class="btn small" data-action="new-event">${icon('plus')}Встреча</button></div></div>`;
  if (S.data.agendaError) return `${head}<div class="card"><div class="empty"><div class="em-title">Календарь недоступен</div>${esc(S.data.agendaError)}</div></div>`;
  if (!a) return `${head}<div class="card"><div class="empty">Загружаю…</div></div>`;
  const groups = [];
  for (const e of a.events) {
    const k = e.start ? dayKey(e.start) : 'x';
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, label: e.start ? dayLabel(e.start) : 'Без даты', items: [] });
    groups[groups.length - 1].items.push(e);
  }
  const events = groups.length ? groups.map((g) => `<div class="day"><div class="day-label">${esc(g.label)}</div>
      ${g.items.map((e) => `<div class="ev ${eventNow(e) ? 'now' : ''} ${e.start && e.start < Date.now() && !eventNow(e) ? 'past' : ''}"><span class="ev-time">${esc(e.time || 'весь день')}</span><span class="ev-title">${esc(e.title)}</span>${eventNow(e) ? '<span class="badge accent">сейчас</span>' : ''}</div>`).join('')}</div>`).join('')
    : '<div class="empty" style="padding:18px">Встреч на неделе нет</div>';
  const rems = a.reminders.length ? a.reminders.map((r) => `<div class="rem ${r.kind}"><button class="check" data-action="complete-reminder" data-id="${esc(r.id)}" aria-label="Выполнено"></button><span class="grow">${esc(r.title)}</span>${r.kind === 'overdue' ? '<span class="badge bad">просрочено</span>' : ''}</div>`).join('')
    : '<div class="faint" style="padding:6px 2px">На сегодня ничего</div>';
  const upcoming = a.events.find((e) => e.start && (e.start > Date.now() || eventNow(e)));
  const inH = upcoming ? Math.round((upcoming.start - Date.now()) / 3600000) : null;
  const top = hero({
    label: upcoming ? (eventNow(upcoming) ? 'Идёт сейчас' : 'Ближайшая встреча') : 'Встречи', tone: 'teal',
    value: upcoming ? `${esc(upcoming.title)}` : 'Неделя свободна',
    note: upcoming ? `${esc(dayLabel(upcoming.start))}, ${esc(upcoming.time || 'весь день')}${!eventNow(upcoming) && inH != null ? ` · через ${inH < 24 ? plural(Math.max(1, inH), 'час', 'часа', 'часов') : plural(Math.round(inH / 24), 'день', 'дня', 'дней')}` : ''}` : '',
    tiles: [
      { icon: '📅', title: 'Встреч', sub: 'на неделе', value: a.events.length },
      { icon: '✅', title: 'Напоминаний', sub: a.reminders.some((r) => r.kind === 'overdue') ? 'есть просроченные' : 'на сегодня', value: a.reminders.length },
    ],
  });
  return `${head}${top}
    <div class="today-grid">
      <section class="card raised"><div class="sec-title">${icon('calendar')}Встречи</div>${events}</section>
      <section class="card raised"><div class="sec-title">${icon('check')}Напоминания</div>
        ${rems}
        <form class="quick-add" data-form="reminder"><input class="input" name="title" placeholder="Напомнить…" autocomplete="off">
          <select class="input" name="due"><option value="">без срока</option><option value="today">сегодня</option><option value="tomorrow">завтра</option></select>
          <button class="btn small primary" aria-label="Добавить">${icon('plus')}</button></form>
      </section>
    </div>`;
}

// ---------- social ----------
const NET = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', threads: 'Threads', facebook: 'Facebook', telegram: 'Telegram', twitter: 'X', linkedin: 'LinkedIn' };
const num = (n) => (typeof n === 'number' ? n.toLocaleString('ru') : '—');
const delta = (n) => (typeof n === 'number' && n !== 0 ? `<span class="delta ${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : ''}${n.toLocaleString('ru')}</span>` : '');

function socialOverview() {
  const d = S.data.social;
  const c = d.channel;
  const channel = c ? `<section class="card raised">
      <div class="sec-title">${icon('send')}${esc(c.title || 'Канал')}<a class="faint" href="https://t.me/${esc(c.username)}" data-tg-link="https://t.me/${esc(c.username)}" target="_blank" rel="noopener">@${esc(c.username)}</a></div>
      <div class="kpis">
        <div class="kpi"><span class="kpi-v">${num(c.subscribers)}${delta(c.subs_change_7d)}</span><span class="kpi-l">подписчиков</span></div>
        <div class="kpi"><span class="kpi-v">${num(c.avg_views)}</span><span class="kpi-l">просмотров на пост</span></div>
        <div class="kpi"><span class="kpi-v">${c.reach_pct != null ? `${c.reach_pct}%` : '—'}</span><span class="kpi-l">доходит до подписчиков</span></div>
        <div class="kpi"><span class="kpi-v">${c.er_pct != null ? `${c.er_pct}%` : '—'}</span><span class="kpi-l">реакций от просмотров</span></div>
      </div>
      <div class="posts">${c.posts.slice(0, 8).map((p) => `<div class="post">
        <div class="post-text clamp" style="--lines:2" data-key="p${p.id}">${esc(p.text || '(без текста)')}</div>
        <div class="post-meta"><span class="faint">${p.date ? when(p.date) : ''}</span><span class="grow"></span>
          <span title="Просмотры">${icon('eye')}${num(p.views)}</span><span title="Реакции">${icon('heart')}${p.reactions}</span><span title="Репосты">${icon('share')}${p.forwards}</span>
          <button class="btn small ghost" data-action="repack" data-id="${p.id}" data-src="ch" title="Перепаковать под другие сети">${icon('spark')}</button>${p.link ? `<a href="${esc(p.link)}" data-tg-link="${esc(p.link)}" target="_blank" rel="noopener" class="faint">открыть</a>` : ''}</div>
      </div>`).join('')}</div>
    </section>` : `<section class="card"><div class="empty">${esc(d.channelError || 'Telegram-канал не подключён')}</div></section>`;

  const r = d.report;
  const report = !r ? `<section class="card raised"><div class="empty"><div class="em-face"><mf-spark size="56"></mf-spark></div><div class="em-title">Сводки из Metricool ещё нет</div>Нажми «Обновить сводку»: сессия соберёт цифры по Instagram, TikTok, YouTube, Threads и Facebook и даст советы. Это одна сессия Claude, 1–3 минуты.</div></section>`
    : `<section class="card raised"><div class="sec-title">${icon('chart')}Сводка за ${esc(r.period || 'неделю')}<span class="grow"></span><span class="faint">${when(r.generated_at)}</span></div>
        ${r.summary ? `<p class="muted" style="margin:0 0 10px">${esc(r.summary)}</p>` : ''}
        <div class="nets">${(r.networks || []).map((n) => `<div class="net">
          <div class="net-name">${esc(NET[n.network] || n.network)}${n.handle ? ` <span class="faint">${esc(n.handle)}</span>` : ''}</div>
          <div class="net-big">${num(n.followers)}${delta(n.followers_change)}</div>
          <div class="net-row">${n.views != null ? `<span>${num(n.views)} просм.</span>` : ''}${n.reach != null ? `<span>${num(n.reach)} охват</span>` : ''}${n.posts != null ? `<span>${num(n.posts)} публ.</span>` : ''}${n.engagement != null ? `<span>${n.engagement}% вовлеч.</span>` : ''}</div>
          ${n.change_note || n.note ? `<div class="faint clamp" style="--lines:3" data-key="n${esc(n.network)}">${esc(n.change_note || n.note)}</div>` : ''}
        </div>`).join('')}</div>
      </section>
      ${(r.advice || []).length ? `<section class="card raised"><div class="sec-title">${icon('spark')}Советы</div><ol class="advice">${r.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ol></section>` : ''}
      ${(r.best_times || []).length ? `<section class="card raised"><div class="sec-title">${icon('tasks')}Лучшее время для постов</div>${r.best_times.map((b) => `<div class="row" style="margin-bottom:6px"><span class="li-title" style="min-width:90px">${esc(NET[b.network] || b.network)}</span><div class="chips">${b.slots.map((x) => `<span class="badge">${esc(x)}</span>`).join('')}</div></div>`).join('')}</section>` : ''}
      ${(r.scheduled || []).length ? `<section class="card raised"><div class="sec-title">${icon('calendar')}Запланировано</div>${r.scheduled.map((x) => `<div class="ev"><span class="ev-time">${esc(x.when)}</span><span class="ev-title clamp" style="--lines:2">${esc(NET[x.network] || x.network)}: ${esc(x.text)}</span></div>`).join('')}</section>` : ''}`;
  // All networks at the top: Telegram live plus the latest Metricool report.
  const NET_ICON = { telegram: ['✈️', '#2aabee'], instagram: ['📸', 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af)'], tiktok: ['🎵', '#111'], youtube: ['▶️', '#ff0000'], threads: ['🧵', '#333'], facebook: ['📘', '#1877f2'], linkedin: ['in', '#0a66c2'] };
  const nets = [];
  if (c) nets.push({ key: 'telegram', name: 'Telegram', followers: c.subscribers, change: c.subs_change_7d, sub: c.avg_views != null ? `${num(c.avg_views)} просм. на пост` : '' });
  for (const n of d.report?.networks || []) {
    if (n.network === 'telegram') continue;
    nets.push({ key: n.network, name: NET[n.network] || n.network, followers: n.followers, change: n.followers_change, sub: n.views != null ? `${num(n.views)} просм. за неделю` : n.note ? 'нет данных' : '' });
  }
  const li = d.linkedin;
  const liReport = (d.report?.networks || []).find((n) => n.network === 'linkedin');
  if (li && li.state !== 'not_configured' && !liReport) nets.push({ key: 'linkedin', name: 'LinkedIn', followers: null, sub: li.state === 'connected' ? `подключён · ${li.posts?.length || 0} публ. отсюда` : 'не подключён' });
  const total = nets.reduce((sum, n) => sum + (typeof n.followers === 'number' ? n.followers : 0), 0);
  const totalChange = nets.reduce((sum, n) => sum + (typeof n.change === 'number' ? n.change : 0), 0);
  const top = nets.length ? hero({
    label: 'Аудитория во всех соцсетях', tone: 'blue',
    value: `${num(total)} подписчиков`,
    note: [totalChange ? `${totalChange > 0 ? '+' : ''}${totalChange} за неделю` : '', d.report?.generated_at ? `сводка ${when(d.report.generated_at)}` : 'сводки Metricool ещё нет'].filter(Boolean).join(' · '),
    tiles: nets.sort((a, b) => (b.followers || 0) - (a.followers || 0)).map((n) => ({
      icon: (NET_ICON[n.key] || ['🌐'])[0], bg: (NET_ICON[n.key] || [, 'rgba(255,255,255,.14)'])[1],
      title: n.name, sub: n.sub,
      value: `${typeof n.followers === 'number' ? num(n.followers) : '—'}${typeof n.change === 'number' && n.change ? ` <small class="${n.change > 0 ? 'up' : 'down'}">${n.change > 0 ? '+' : ''}${n.change}</small>` : ''}`,
    })),
  }) : '';
  const linkedinCard = li && li.state !== 'not_configured' ? `<section class="card raised">
      <div class="sec-title"><span class="li-badge">in</span>LinkedIn${li.name ? ` <span class="faint">${esc(li.name)}</span>` : ''}<span class="grow"></span>${li.state === 'connected' ? `<span class="faint">доступ ещё ${li.daysLeft} дн.</span>` : ''}</div>
      ${li.state === 'connected'
        ? `<p class="muted" style="margin:0 0 8px">Посты публикуются отсюда от твоего имени, только после твоего «да» на итоговый текст. Напиши в боте: «пост в линкедин про …». Подписчиков и охваты LinkedIn по этому доступу не отдаёт: для цифр добавь LinkedIn в Metricool, и он появится в ежедневной сводке.</p>
           ${(li.posts || []).length ? `<div class="posts">${li.posts.map((p) => `<div class="post"><div class="post-text clamp" style="--lines:2" data-key="li${esc(p.id || p.at)}">${esc(p.text)}</div><div class="post-meta"><span class="faint">${when(p.at)}</span><span class="grow"></span>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="faint">открыть</a>` : ''}</div></div>`).join('')}</div>` : '<div class="faint">Отсюда ещё ничего не публиковалось.</div>'}`
        : `<p class="muted" style="margin:0">${li.state === 'expired' ? 'Доступ истёк.' : 'Не подключён.'} Подключи на Mac: «Система» → «Подключить LinkedIn».</p>`}
    </section>` : '';
  return `${top}<div class="social-grid"><div class="stack">${goalCard()}${analysisCard()}${channel}${linkedinCard}</div><div class="stack">${report}</div></div>`;
}


// ---------- social: tabs (overview, studio, calendar, ideas, rivals) ----------
const SOC_TABS = [['overview', 'Обзор'], ['studio', 'Студия'], ['calendar', 'Календарь'], ['ideas', 'Идеи'], ['rivals', 'Конкуренты']];
const PST = { draft: ['черновик', ''], sending: ['отправляю…', 'info'], scheduled: ['запланирован', 'accent'], metricool_draft: ['черновик в Metricool', 'warn'], published: ['вышел', 'ok'], failed: ['ошибка', 'bad'] };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const hm = (t) => new Date(t).toTimeString().slice(0, 5);
const localInput = (t) => { const d = new Date(t); return `${isoDay(d)}T${hm(t)}`; };
const netBadge = (n) => `<span class="net-badge n-${n}">${esc((S.data.content?.networks || {})[n] || n)}</span>`;

function viewSocial() {
  const tab = S.socTab || 'overview';
  const d = S.data.social;
  const c = S.data.content;
  const tabs = `<div class="soc-tabs">${SOC_TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-action="soc-tab" data-id="${k}">${l}${k === 'studio' && c?.posts?.filter((p) => ['draft', 'failed'].includes(p.status)).length ? ` <small>${c.posts.filter((p) => ['draft', 'failed'].includes(p.status)).length}</small>` : ''}${k === 'ideas' && c?.ideas?.length ? ` <small>${c.ideas.length}</small>` : ''}</button>`).join('')}</div>`;
  const head = `<div class="page-head"><div><h1>Соцсети</h1><p>Цифры, посты, идеи и конкуренты.</p></div>
    ${tab === 'overview' ? `<button class="btn small" data-action="social-refresh" ${d?.running ? 'disabled' : ''}>${icon('refresh')}${d?.running ? 'Собираю сводку…' : 'Обновить сводку'}</button>` : ''}</div>${tabs}`;
  if (S.data.socialError) return `${head}<div class="card"><div class="empty">${esc(S.data.socialError)}</div></div>`;
  if (!d || !c) return `${head}<div class="card"><div class="empty">Загружаю…</div></div>`;
  const body = { overview: socialOverview, studio: socStudio, calendar: socCalendar, ideas: socIdeas, rivals: socRivals }[tab] || socialOverview;
  return head + body();
}

function insight(part) {
  const x = S.data.ins?.[part];
  if (!x) return { wait: `<section class="card raised"><div class="empty">Считаю…</div></section>` };
  if (x.error) return { wait: `<section class="card raised"><div class="empty">${esc(x.error)}</div></section>` };
  return { x };
}

function goalCard() {
  const g = S.data.social?.goal || S.data.content?.goal;
  const form = `<form class="row goal-form" data-form="goal"><input class="input" name="target" type="number" min="1" placeholder="Сколько подписчиков" value="${g?.target || ''}"><input class="input" name="deadline" type="date" value="${g?.deadline || ''}"><button class="btn small primary">${g ? 'Изменить' : 'Поставить цель'}</button></form>`;
  if (!g) return `<section class="card raised"><div class="sec-title">${icon('spark')}Цель по Telegram-каналу</div><p class="muted" style="margin:0 0 8px">Поставь цель, например 1 000 подписчиков к 31 декабря: покажу темп и успеваешь ли.</p>${form}</section>`;
  const pct = g.current != null ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
  return `<section class="card raised"><div class="sec-title">${icon('spark')}Цель: ${num(g.target)} подписчиков к ${new Date(g.deadline).toLocaleDateString('ru', { day: 'numeric', month: 'long' })}<span class="grow"></span>${g.pace != null ? `<span class="badge ${g.onTrack ? 'ok' : 'warn'}">${g.onTrack ? 'успеваешь' : 'не успеваешь'}</span>` : ''}</div>
    <div class="goal-bar"><span style="width:${pct}%"></span></div>
    <div class="kpis">
      <div class="kpi"><span class="kpi-v">${num(g.current)}</span><span class="kpi-l">сейчас, ${pct}%</span></div>
      <div class="kpi"><span class="kpi-v">${g.pace ?? '—'}</span><span class="kpi-l">в день сейчас</span></div>
      <div class="kpi"><span class="kpi-v">${g.need ?? '—'}</span><span class="kpi-l">в день нужно</span></div>
      <div class="kpi"><span class="kpi-v">${g.forecast ? new Date(g.forecast).toLocaleDateString('ru', { day: 'numeric', month: 'short' }) : '—'}</span><span class="kpi-l">дойдёшь при этом темпе</span></div>
    </div>
    <details style="margin-top:8px"><summary class="faint">Изменить цель</summary>${form}</details></section>`;
}

function analysisCard() {
  const { x, wait } = insight('analysis');
  if (wait) return wait;
  if (!x.count) return `<section class="card raised"><div class="sec-title">${icon('chart')}Разбор постов</div><div class="empty">В канале пока нет постов старше суток.</div></section>`;
  const post = (p, good) => `<div class="post"><div class="post-text clamp" style="--lines:2" data-key="an${p.id}">${esc(p.text || '(без текста)')}</div>
    <div class="post-meta"><span class="badge ${good ? 'ok' : 'bad'}">${p.vs > 0 ? '+' : ''}${p.vs}% к среднему</span><span title="Просмотры">${icon('eye')}${num(p.views)}</span><span title="Реакции, репосты, комментарии от просмотров">${p.er}%</span><span class="grow"></span>
    ${good ? `<button class="btn small ghost" data-action="repack" data-id="${p.id}" data-src="an">${icon('spark')}Перепаковать</button>` : ''}<a href="${esc(p.link)}" data-tg-link="${esc(p.link)}" target="_blank" rel="noopener" class="faint">открыть</a></div></div>`;
  const factor = (f) => { const max = Math.max(...f.rows.map((r) => r.avg || 0), 1); return `<div class="factor"><div class="faint">${f.title}</div>${f.rows.map((r) => `<div class="factor-row"><span>${r.label}</span><span class="factor-bar"><span style="width:${Math.round(((r.avg || 0) / max) * 100)}%"></span></span><b>${num(r.avg)}</b><span class="faint">${plural(r.n, 'пост', 'поста', 'постов')}</span></div>`).join('')}</div>`; };
  return `<section class="card raised"><div class="sec-title">${icon('chart')}Разбор постов канала<span class="grow"></span><span class="faint">последние ${plural(x.count, 'пост', 'поста', 'постов')} · в среднем ${num(x.avgViews)} просм.</span></div>
    <div class="faint" style="margin:2px 0 6px">Что сработало лучше всего</div><div class="posts">${x.best.map((p) => post(p, true)).join('')}</div>
    ${x.worst.length ? `<div class="faint" style="margin:10px 0 6px">Что не зашло</div><div class="posts">${x.worst.map((p) => post(p, false)).join('')}</div>` : ''}
    <div class="factors">${x.factors.filter((f) => f.rows.length > 1).map(factor).join('')}</div></section>`;
}

function socStudio() {
  const c = S.data.content;
  const nets = Object.entries(c.networks);
  const chosen = S.studioNets || ['telegram', 'linkedin', 'instagram'];
  const form = `<form class="card raised studio" data-form="studio">
    <div class="sec-title">${icon('spark')}Новый пост${S.studioIdea ? ' <span class="badge accent">из банка идей</span>' : ''}</div>
    <textarea class="input" name="topic" rows="4" data-keep="studio-topic" placeholder="О чём пост: тема, мысль, история, голосовое текстом. Я напишу версии под каждую сеть в твоём стиле.">${esc(S.studioTopic || '')}</textarea>
    <div class="net-pick">${nets.map(([k, l]) => `<label class="net-chk"><input type="checkbox" name="net" value="${k}" ${chosen.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <label class="net-chk"><input type="checkbox" name="link" ${S.studioLink ? 'checked' : ''}><span>Ссылка на бесплатный урок с меткой поста (будет видно во «Продажах»)</span></label>
    <div class="row" style="margin-top:8px"><button class="btn primary" ${c.generating ? 'disabled' : ''}>${icon('spark')}${c.generating ? `Пишу под ${plural(c.generating.networks.length, 'сеть', 'сети', 'сетей')}…` : 'Написать посты'}</button>${c.genError ? `<span class="badge bad">${esc(c.genError.slice(0, 120))}</span>` : ''}</div>
  </form>`;
  const drafts = c.posts.filter((p) => ['draft', 'failed', 'sending'].includes(p.status));
  const card = (p) => `<div class="card raised dpost" data-post="${p.id}">
    <div class="row">${netBadge(p.network)}<span class="badge ${PST[p.status]?.[1] || ''}">${PST[p.status]?.[0] || p.status}</span><span class="faint clamp" style="--lines:1">${esc(p.topic || '')}</span><span class="grow"></span><span class="faint" data-count="${p.id}">${p.text.length} зн.</span></div>
    ${p.error ? `<div class="badge bad" style="margin-top:6px">${esc(p.error)}</div>` : ''}
    <textarea class="input" rows="7" data-keep="post-${p.id}" data-post-text="${p.id}">${esc(p.text)}</textarea>
    ${p.notes ? `<details><summary class="faint">Сценарий или слайды</summary><div class="muted pre">${esc(p.notes)}</div></details>` : ''}
    <div class="row dpost-actions">
      <input class="input" type="datetime-local" data-sched="${p.id}" value="${localInput(Date.now() + 3600000).slice(0, 14)}00">
      <button class="btn small" data-action="post-schedule" data-id="${p.id}">${icon('calendar')}Запланировать</button>
      <button class="btn small primary" data-action="post-publish" data-id="${p.id}">${icon('send')}Опубликовать</button>
      <span class="grow"></span>
      <button class="btn small ghost" data-copy="${esc(p.text)}" title="Скопировать">${icon('copy')}</button>
      <button class="btn small ghost" data-action="post-delete" data-id="${p.id}" title="Удалить">${icon('trash')}</button>
    </div>
    <div class="faint">${c.direct.includes(p.network) ? 'Выйдет напрямую от твоего имени.' : 'Уйдёт в Metricool; если сеть просит видео или фото, встанет черновиком, медиа добавишь там.'}</div>
  </div>`;
  return `${form}${drafts.length ? `<div class="stack">${drafts.map(card).join('')}</div>` : `<section class="card"><div class="empty">Черновиков нет. Напиши тему выше, возьми идею из «Идей» или нажми «Перепаковать» у удачного поста.</div></section>`}`;
}

function socCalendar() {
  const c = S.data.content;
  const r = S.data.social.report;
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
  const sched = c.posts.filter((p) => ['scheduled', 'metricool_draft', 'sending'].includes(p.status) && p.scheduled_at);
  const col = (d) => {
    const end = d.getTime() + 86400000;
    const items = sched.filter((p) => p.scheduled_at >= d.getTime() && p.scheduled_at < end).sort((a, b) => a.scheduled_at - b.scheduled_at);
    const slots = (r?.best_times || []).flatMap((b) => b.slots.filter((s) => s.toLowerCase().startsWith(WD[d.getDay()])).map((s) => `${NET[b.network] || b.network} ${s.replace(/^\S+\s*/, '')}`));
    const today = isoDay(d) === isoDay(new Date());
    return `<div class="cal-day${items.length ? '' : ' empty-day'}${today ? ' today' : ''}">
      <div class="cal-date"><b>${d.getDate()}</b><span>${today ? 'сегодня' : WD[d.getDay()]}</span></div>
      <div class="cal-body">
        ${items.map((p) => `<div class="cal-post"><span class="cal-time">${hm(p.scheduled_at)}</span>${netBadge(p.network)}<span class="cal-text clamp pre-line" style="--lines:1" data-key="cal${p.id}" title="Нажми, чтобы прочитать целиком">${esc(p.text)}${p.url ? `<br><a href="${esc(p.url)}" target="_blank" rel="noopener">${c.direct.includes(p.network) ? 'Открыть пост' : 'Открыть в Metricool'}</a>` : ''}</span>${p.status === 'scheduled' && c.direct.includes(p.network) ? `<button class="btn small ghost" data-action="post-unschedule" data-id="${p.id}" title="Снять с расписания">${icon('undo')}</button>` : `<span class="badge ${PST[p.status][1]}">${PST[p.status][0]}</span>`}</div>`).join('') || '<span class="faint">ничего не запланировано</span>'}
        ${slots.length ? `<div class="cal-slots">${slots.map((s) => `<span>⏱ ${esc(s)}</span>`).join('')}</div>` : ''}
      </div></div>`;
  };
  const pub = c.posts.filter((p) => p.status === 'published').sort((a, b) => b.published_at - a.published_at);
  return `<section class="card raised"><div class="sec-title">${icon('calendar')}Неделя<span class="grow"></span><span class="faint">⏱ лучшее время из Metricool</span></div><div class="cal">${days.map(col).join('')}</div>
      <div class="faint" style="margin-top:8px">В 8:30 бот пришлёт, что выйдет сегодня, с кнопками «Всё ок», «Снять» и «Сейчас».</div></section>
    ${(r?.scheduled || []).length ? `<section class="card raised"><div class="sec-title">${icon('calendar')}Уже стоит в Metricool</div>${r.scheduled.map((x) => `<div class="ev"><span class="ev-time">${esc(x.when)}</span><span class="ev-title clamp" style="--lines:2">${esc(NET[x.network] || x.network)}: ${esc(x.text)}</span></div>`).join('')}</section>` : ''}
    <section class="card raised"><div class="sec-title">${icon('send')}Вышло за 3 недели</div>${pub.length ? pub.map((p) => `<div class="cal-item"><span class="cal-time">${new Date(p.published_at).toLocaleDateString('ru', { day: 'numeric', month: 'short' })}</span>${netBadge(p.network)}<span class="clamp grow pre-line" style="--lines:1" data-key="pub${p.id}" title="Нажми, чтобы прочитать целиком">${esc(p.text)}</span>${p.url ? `<a class="btn small" href="${esc(p.url)}" target="_blank" rel="noopener">Открыть</a>` : ''}</div>`).join('') : '<div class="empty">Из студии ещё ничего не выходило.</div>'}</section>`;
}

function socIdeas() {
  const c = S.data.content;
  return `<section class="card raised"><div class="sec-title">${icon('spark')}Банк идей<span class="grow"></span><button class="btn small" data-action="ideas-refresh" ${c.ideasBusy ? 'disabled' : ''}>${icon('refresh')}${c.ideasBusy ? 'Собираю…' : 'Собрать идеи'}</button></div>
      <p class="muted" style="margin:0 0 8px">Каждое утро в 7:00 собираю темы из твоих лучших постов, голосовых и сообщений в бот и того, что заходит у конкурентов.</p>
      <form class="row" data-form="idea"><input class="input grow" name="title" placeholder="Своя идея одной строкой" autocomplete="off"><button class="btn small">${icon('plus')}Добавить</button></form></section>
    ${c.ideas.length ? `<div class="stack">${c.ideas.map((i) => `<div class="card raised idea">
      <div class="row"><b class="grow">${esc(i.title)}</b>${i.score ? `<span class="badge ${i.score >= 8 ? 'ok' : i.score >= 6 ? 'accent' : ''}">${i.score}/10</span>` : ''}</div>
      ${i.angle ? `<div class="muted">${esc(i.angle)}</div>` : ''}${i.why ? `<div class="faint" style="margin-top:4px">${esc(i.why)}</div>` : ''}
      <div class="row" style="margin-top:8px"><span class="badge">${esc(i.source || '')}</span><span class="grow"></span><button class="btn small ghost" data-action="idea-drop" data-id="${i.id}">Убрать</button><button class="btn small primary" data-action="idea-use" data-id="${i.id}">${icon('spark')}Написать посты</button></div></div>`).join('')}</div>`
    : `<section class="card"><div class="empty">Идей пока нет. Нажми «Собрать идеи».</div></section>`}`;
}

function socRivals() {
  const c = S.data.content;
  const { x, wait } = insight('rivals');
  const head = `<section class="card raised"><div class="sec-title">${icon('eye')}Похожие каналы<span class="grow"></span><button class="btn small" data-action="rivals-find">${icon('search')}Подобрать похожие</button></div>
    <p class="muted" style="margin:0 0 8px">Лучшие посты за неделю у каналов, на которые стоит смотреть. Удачное можно взять в банк идей.</p>
    <form class="row" data-form="rival"><input class="input grow" name="username" placeholder="@канал или ссылка t.me/…" autocomplete="off"><button class="btn small">${icon('plus')}Добавить</button></form></section>
    <section class="card raised"><div class="sec-title">${icon('spark')}Автопосты по мотивам<span class="grow"></span><label class="net-chk"><input type="checkbox" data-action="auto-toggle" ${c.auto?.enabled ? 'checked' : ''}><span>${c.auto?.enabled ? 'включены' : 'выключены'}</span></label></div>
      <p class="muted" style="margin:0 0 8px">В 11:00 и 17:00 смотрю свежие посты этих каналов. Если пост заходит лучше их среднего, пишу на эту тему твой пост: в твоём стиле по примерам из канала, с проверкой на штампы. Черновик приходит в бот с кнопкой «Опубликовать». Сам ничего не публикую.</p>
      <div class="row" style="flex-wrap:wrap;gap:6px"><span class="faint">В день до</span><div class="seg">${[1, 2, 3, 5].map((n) => `<button class="${c.auto?.perDay === n ? 'on' : ''}" data-action="auto-per" data-id="${n}">${n}</button>`).join('')}</div>
      <span class="faint">Сети:</span>${['telegram', 'linkedin', 'threads'].map((n) => `<label class="net-chk"><input type="checkbox" data-action="auto-net" data-id="${n}" ${c.auto?.networks?.includes(n) ? 'checked' : ''}><span>${c.networks[n]}</span></label>`).join('')}
      <span class="grow"></span><span class="faint">сегодня ${c.auto?.today || 0} из ${c.auto?.perDay}</span><button class="btn small" data-action="auto-run" ${c.auto?.busy ? 'disabled' : ''}>${icon('refresh')}${c.auto?.busy ? 'Пишу…' : 'Проверить сейчас'}</button></div></section>`;
  if (!c.competitors.length) return `${head}<section class="card"><div class="empty">Список пуст. Нажми «Подобрать похожие»: сессия найдёт 6–8 каналов про ИИ для работы и бизнеса.</div></section>`;
  if (wait) return head + wait;
  return head + `<div class="stack">${x.items.map((r) => `<section class="card raised">
    <div class="sec-title">${esc(r.title)} <a class="faint" href="${esc(r.url || `https://t.me/${r.username}`)}" data-tg-link="${esc(r.url || `https://t.me/${r.username}`)}" target="_blank" rel="noopener">${/^-?\d+$/.test(r.username) ? 'закрытая ссылка' : `@${esc(r.username)}`}</a><span class="grow"></span><button class="btn small ghost" data-action="rival-del" data-id="${esc(r.username)}" title="Убрать">${icon('trash')}</button></div>
    ${r.error ? `<div class="badge bad">${esc(r.error)}</div>` : `<div class="kpis"><div class="kpi"><span class="kpi-v">${num(r.subscribers)}</span><span class="kpi-l">подписчиков</span></div><div class="kpi"><span class="kpi-v">${r.posts7}</span><span class="kpi-l">постов за неделю</span></div><div class="kpi"><span class="kpi-v">${num(r.avgViews)}</span><span class="kpi-l">просмотров на пост</span></div></div>
    <div class="posts">${r.top.map((p) => `<div class="post"><div class="post-text clamp" style="--lines:3" data-key="rv${esc(r.username)}${p.id}">${esc(p.text)}</div><div class="post-meta"><span>${icon('eye')}${num(p.views)}</span><span>${icon('heart')}${p.reactions}</span><span class="grow"></span><button class="btn small ghost" data-action="rival-idea" data-id="${esc(r.username)}:${p.id}">${icon('plus')}В идеи</button><a class="faint" href="${esc(p.link)}" data-tg-link="${esc(p.link)}" target="_blank" rel="noopener">открыть</a></div></div>`).join('') || '<div class="faint">За неделю постов нет.</div>'}</div>`}
  </section>`).join('')}</div>`;
}


// ---------- memory: what the agent knows about the owner, the approval queue, search over all history ----------
const MEM_KIND = { session: 'сессия', telegram: 'Telegram', mail: 'почта', group: 'группа', chat: 'переписка', memory: 'память' };
const hl = (s) => esc(s || '').replace(/«/g, '<mark>').replace(/»/g, '</mark>');
function viewMemory() {
  const d = S.data.memory;
  const head = `<div class="page-head"><div><h1>Память</h1><p>Что агент знает о тебе. Это видят все сессии, и бот, и задачи.</p></div></div>`;
  if (S.data.memoryError) return `${head}<div class="card"><div class="empty">${esc(S.data.memoryError)}</div></div>`;
  if (!d) return `${head}<div class="card"><div class="empty">Загружаю…</div></div>`;
  const st = d.stats || { total: 0, byKind: [] };
  const search = `<section class="card raised">
    <form class="row mem-search" data-form="recall"><input class="input grow" name="q" placeholder="Поиск по всей истории: «договор оплата», «цена в октябре»…" value="${esc(S.recallQ || '')}" autocomplete="off"><button class="btn primary small">${icon('search')}Найти</button></form>
    <div class="chips" style="margin-top:8px">${[['', 'везде'], ...Object.entries(MEM_KIND)].map(([k, l]) => `<button class="chip-btn ${(S.recallKind || '') === k ? 'on' : ''}" data-action="recall-kind" data-id="${k}">${l}</button>`).join('')}</div>
    <div class="faint" style="margin-top:6px">В поиске ${num(st.total)} записей: ${st.byKind.map((k) => `${MEM_KIND[k.kind] || k.kind} ${num(k.n)}`).join(', ') || 'пока пусто, индекс собирается'}${st.tgMessages ? ` · ${num(st.tgMessages)} сообщений из ${st.tgChats} чатов Telegram` : ''}.</div>
    ${S.recallRes ? `<div class="recall-list">${S.recallRes.length ? S.recallRes.map((r) => `<div class="recall-item">
        <div class="row"><span class="badge">${MEM_KIND[r.kind] || r.kind}</span><span class="faint">${r.at ? new Date(r.at).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span><b class="grow clamp" style="--lines:1">${esc(r.title)}</b>
          <button class="btn small ghost" data-action="recall-open" data-id="${esc(r.ref)}">${S.recallOpen?.ref === r.ref ? 'Свернуть' : 'Открыть'}</button></div>
        <div class="recall-snip">${hl(r.snip)}</div>
        ${S.recallOpen?.ref === r.ref ? `<div class="recall-full">${esc(S.recallOpen.body)}</div>` : ''}</div>`).join('') : '<div class="empty">Ничего не нашлось.</div>'}</div>` : ''}
  </section>`;
  const pending = d.pending.length ? `<section class="card raised mem-pending"><div class="sec-title">${icon('spark')}На проверку <span class="badge accent">${d.pending.length}</span><span class="grow"></span><span class="faint">агент записал это ночью из разговоров дня</span></div>
    ${d.pending.map((n) => `<div class="mem-note"><div class="row"><span class="badge">${esc(d.types[n.type] || n.type)}</span><b class="grow">${esc(n.title)}</b></div>
      <div class="faint">${esc(n.description)}</div><div class="mem-body">${esc(n.body)}</div>
      <div class="row" style="margin-top:6px"><span class="grow"></span><button class="btn small ghost" data-action="mem-reject" data-id="${esc(n.name)}">Отклонить</button><button class="btn small primary" data-action="mem-approve" data-id="${esc(n.name)}">${icon('check')}Запомнить</button></div></div>`).join('')}</section>` : '';
  const groups = Object.entries(d.types).map(([t, label]) => {
    const xs = d.notes.filter((n) => n.type === t);
    if (!xs.length) return '';
    return `<section class="card raised"><div class="sec-title">${label} <span class="faint">${xs.length}</span></div>${xs.map((n) => {
      const editing = S.memEdit === n.name;
      const hist = S.memHist?.name === n.name ? S.memHist.items : null;
      return `<div class="mem-note">
        <div class="row"><b class="grow">${esc(n.title)}</b><span class="faint">${esc(n.updated || '')}</span>
          <button class="btn small ghost" data-action="mem-edit" data-id="${esc(n.name)}" title="Поправить">${icon('edit')}</button>
          <button class="btn small ghost" data-action="mem-history" data-id="${esc(n.name)}" title="Что было раньше">${icon('undo')}</button>
          <button class="btn small ghost" data-action="mem-delete" data-id="${esc(n.name)}" title="Забыть">${icon('trash')}</button></div>
        <div class="faint">${esc(n.description)}</div>
        ${editing ? `<form class="mem-form" data-form="mem-edit" data-name="${esc(n.name)}">
            <input class="input" name="title" value="${esc(n.title)}"><input class="input" name="description" value="${esc(n.description)}">
            <select class="input" name="type">${Object.entries(d.types).map(([k, l]) => `<option value="${k}" ${k === n.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <textarea class="input" name="body" rows="8" data-keep="mem-${esc(n.name)}">${esc(n.body)}</textarea>
            <div class="row"><span class="grow"></span><button type="button" class="btn small ghost" data-action="mem-edit" data-id="${esc(n.name)}">Отмена</button><button class="btn small primary">Сохранить</button></div></form>`
          : `<div class="mem-body clamp pre-line" style="--lines:3" data-key="mem${esc(n.name)}">${esc(n.body)}</div>`}
        ${hist ? `<div class="mem-hist">${hist.length ? hist.map((h) => `<details><summary class="faint">Версия ${esc(h.version.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2}).*/, '$3.$2.$1 $4:$5'))}${/удалена/.test(h.version) ? ' (удалена)' : ''}</summary><div class="mem-body pre-line">${esc(h.body)}</div></details>`).join('') : '<div class="faint">Раньше не менялась.</div>'}</div>` : ''}
      </div>`;
    }).join('')}</section>`;
  }).join('');
  const tip = `<section class="card"><div class="faint">В боте: «запомни, что…», «что ты помнишь про Аню?», «забудь про…». Голосом тоже работает. Каждую ночь в 23:00 агент выбирает новое из разговоров дня и кладёт сюда на проверку.</div></section>`;
  return head + search + pending + groups + tip;
}

// ---------- finance ----------
const CUR = { RUB: '₽', USD: '$', EUR: '€', KZT: '₸', GBP: '£', UAH: '₴', TRY: '₺', VND: '₫', THB: '฿' };
const money = (n, cur) => {
  const crypto = ['USDT', 'USDC', 'USD'].includes(cur);
  const v = Number(n).toLocaleString('ru', { maximumFractionDigits: crypto ? 2 : 0 });
  return cur === 'USD' ? `$${v}` : `${v} ${CUR[cur] || cur}`;
};
const totals = (rows) => (rows?.length ? rows.map((r) => money(r.total, r.currency)).join(' + ') : '0');
const CAT_EMOJI = { 'транспорт и доставка': '🚕', 'кафе': '☕', 'еда': '🍜', 'продукты и магазины': '🛒', 'сервисы и подписки': '💻', 'здоровье': '💊', 'спорт': '🏋️', 'переводы': '↗️', 'поступления': '↙️', 'прочее': '🧾' };
// Account colors by name: add your banks here if you like, e.g. [/мой банк/i, '#ffdd2d', '#1a1a1a'].
const BRAND = [];
const brand = (name) => BRAND.find(([re]) => re.test(name)) || [null, 'var(--accent)', '#fff'];

function viewFinance() {
  const f = S.data.finance;
  const head = `<div class="page-head"><div><h1>Финансы</h1><p>Траты из писем банков учитываются сами, чеки и скриншоты балансов присылай в бот.</p></div>
    <button class="btn small" data-action="fin-add-toggle">${icon('plus')}Добавить</button></div>`;
  if (S.data.financeError) return `${head}<div class="card"><div class="empty">${esc(S.data.financeError)}</div></div>`;
  if (!f) return `${head}<div class="card"><div class="empty">Загружаю…</div></div>`;
  // Totals in the main currency (CURRENCY in .env).
  const base = S.state?.currency || 'RUB';
  const rub = f.rates?.base || f.rates?.rub || { RUB: 1 };
  const toRub = (n, cur) => (rub[cur] ? n * rub[cur] : null);
  const rubSum = (rows) => (rows || []).reduce((s, r) => s + (toRub(r.total, r.currency) || 0), 0);
  const approx = (n) => `≈ ${Math.round(n).toLocaleString('ru')} ${CUR[base] || base}`;

  // Balances
  const bal = f.balances || [];
  const balRub = bal.reduce((s, b) => s + (toRub(b.amount, b.currency) || 0), 0);
  const hero = `<section class="fin-hero">
    <div class="fin-hero-top"><span class="fin-hero-l">Всего на счетах</span><span class="faint">${f.rates?.date ? `курс ЦБ на ${new Date(f.rates.date).toLocaleDateString('ru', { day: 'numeric', month: 'short' })}` : ''}</span></div>
    <div class="fin-hero-v">${bal.length ? approx(balRub) : '—'}</div>
    <div class="fin-accounts">${bal.length ? bal.map((b) => { const [, bg, fg] = brand(b.account); return `<div class="fin-acc"><span class="fin-acc-dot" style="background:${bg};color:${fg}">${esc(b.account.slice(0, 1))}</span><span class="grow"><span class="fin-acc-n">${esc(b.account)}</span><span class="fin-acc-t">обновлено ${when(b.at)}</span></span><span class="fin-acc-v">${money(b.amount, b.currency)}${b.currency !== 'RUB' && toRub(b.amount, b.currency) ? `<small>${approx(toRub(b.amount, b.currency))}</small>` : ''}</span></div>`; }).join('') : '<div class="faint">Пришли боту скриншот баланса банка или биржи, и я его запишу.</div>'}</div>
  </section>`;

  const kpi = (label, rows, cls = '') => `<div class="kpi ${cls}"><span class="kpi-l">${label}</span><span class="kpi-v">${rows?.length ? approx(rubSum(rows)) : `0 ${CUR[base] || base}`}</span><span class="kpi-s">${totals(rows)}</span></div>`;
  const kpis = `<div class="fin-kpis">${kpi('Сегодня', f.today)}${kpi('7 дней', f.week)}${kpi('Этот месяц', f.month)}${kpi('Поступления за месяц', f.incomeMonth, 'in')}</div>`;

  // Categories as bars
  const cats = {};
  for (const c of f.categories || []) { const k = c.category || 'прочее'; cats[k] = (cats[k] || 0) + (toRub(c.total, c.currency) || 0); }
  const catList = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const catMax = catList[0]?.[1] || 1;
  const catTotal = catList.reduce((s, [, v]) => s + v, 0) || 1;
  const catsHtml = catList.length ? catList.map(([k, v]) => `<div class="fin-cat"><span class="fin-cat-e">${CAT_EMOJI[k] || '🧾'}</span><span class="grow"><span class="fin-cat-n">${esc(k)}<span class="faint"> · ${Math.round((v / catTotal) * 100)}%</span></span><span class="fin-bar"><i style="width:${Math.max(3, (v / catMax) * 100)}%"></i></span></span><b>${approx(v)}</b></div>`).join('') : '<div class="faint">Пока пусто</div>';

  // Operations by day
  const byDay = [];
  for (const e of f.items) {
    const k = new Date(e.at).toDateString();
    if (!byDay.length || byDay[byDay.length - 1].k !== k) byDay.push({ k, at: e.at, items: [] });
    byDay[byDay.length - 1].items.push(e);
  }
  const days = S.finDays || 7;
  const since = Date.now() - days * 86400000;
  const shown = byDay.filter((g) => g.at >= since);
  const ops = shown.length ? shown.map((g) => {
    const out = g.items.filter((e) => e.direction !== 'in').reduce((s, e) => s + (toRub(e.amount, e.currency) || 0), 0);
    return `<div class="fin-day"><div class="fin-day-h"><span>${esc(dayLabel(g.at))}</span><span>${out ? `−${approx(out).slice(2)}` : ''}</span></div>
      ${g.items.map((e) => { const inc = e.direction === 'in'; return `<div class="fin-op ${inc ? 'in' : ''}"><span class="fin-op-e">${CAT_EMOJI[e.category] || (inc ? '↙️' : '🧾')}</span><span class="grow"><span class="fin-op-n">${esc((e.merchant || e.note || '—').replace(/^Grab\* .*/i, 'Grab'))}</span><span class="fin-op-s">${new Date(e.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} · ${esc(e.category || '')} · ${esc(e.source || '')}</span></span><span class="fin-op-v">${inc ? '+' : '−'}${money(e.amount, e.currency)}</span><button class="icon-btn fin-del" data-action="del-expense" data-id="${e.id}" aria-label="Удалить">${icon('trash')}</button></div>`; }).join('')}</div>`;
  }).join('') + (byDay.length > shown.length ? `<button class="btn small ghost fin-more" data-action="fin-more">Показать ещё 2 недели</button>` : '') : `<div class="empty" style="padding:16px">За ${days} дней операций нет</div>${byDay.length ? '<button class="btn small ghost fin-more" data-action="fin-more">Показать раньше</button>' : ''}`;

  const form = S.finAdd ? `<form class="card raised fin-form" data-form="expense">
      <input class="input" name="amount" inputmode="decimal" placeholder="Сумма" required>
      <select class="input" name="currency">${[...new Set([S.state?.currency || 'RUB', 'RUB', 'USD', 'EUR', 'USDT', 'KZT'])].map((c) => `<option>${c}</option>`).join('')}</select>
      <input class="input" name="merchant" placeholder="Где или за что">
      <button class="btn primary">Записать</button>
    </form>` : '';

  return `${head}${form}${hero}${kpis}
    <div class="today-grid fin-grid">
      <section class="card raised fin-ops"><div class="sec-title">${icon('wallet')}Операции<span class="grow"></span><span class="faint">${days} дн.</span></div>${ops}</section>
      <section class="card raised fin-cats"><div class="sec-title">${icon('chart')}Месяц по категориям</div>${catsHtml}</section>
    </div>`;
}

// ---------- more (phone) ----------
function viewMore() {
  return `<div class="card raised list" style="padding:0">${VIEWS.filter((v) => v.more).map((v) => `<button class="more-item" data-nav="${v.id}">${icon(v.icon)}<span class="grow"><span class="li-title">${v.title}</span><span class="li-sub" style="display:block">${v.more}</span></span>${icon('back')}</button>`).join('')}</div>`;
}

const saveSeg = () => { try { localStorage.setItem('mf_seg', JSON.stringify(SEG)); } catch { /* private mode */ } };
// Segment switch at the top of a section; hidden when the section has only one part.
function segBar(host) {
  const list = SEGMENTS[host] || [];
  if (list.length < 2) return '';
  const cur = segOf(host);
  return `<div class="seg seg-main">${list.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-seg="${host}:${k}">${esc(l)}</button>`).join('')}</div>`;
}
// Modules can put one summary tile on the home screen: summary(data) → { icon, title, value, note, nav }.
const homeMods = () => Object.values(MOD_VIEWS).filter((m) => m.summary);

// ---------- home: one screen with what matters now ----------
async function loadHome(d) {
  const mods = homeMods();
  const [home, finance] = await Promise.all([
    api('/api/home').catch((e) => ({ error: e.message })),
    api('/api/finance').catch(() => null),
    ...mods.map((m) => (m.homeLoad || m.load)?.(d, m.id)?.catch?.(() => {})),
  ]);
  d.home = home; d.finance = finance || d.finance;
  // The calendar lives on the Mac: it comes when it comes, the screen does not wait for it.
  if (!d.agendaAt || Date.now() - d.agendaAt > 5 * 60000) {
    d.agendaAt = Date.now();
    api('/api/agenda').then((a) => { d.agenda = a; d.agendaError = null; if (S.view === 'home') render(); }).catch((e) => { d.agendaError = e.message; });
  }
}

function moneyNow(f) {
  if (!f) return null;
  const base = S.state?.currency || 'RUB';
  const r = f.rates?.base || f.rates?.rub || {};
  const toBase = (n, c) => (r[c] ? n * r[c] : 0);
  const sum = (rows) => (rows || []).reduce((a, x) => a + toBase(x.total, x.currency), 0);
  const cap = (f.balances || []).reduce((a, b) => a + toBase(b.amount, b.currency), 0);
  const fmt = (n) => `${Math.round(n).toLocaleString('ru')} ${CUR[base] || base}`;
  return { cap: f.balances?.length ? `≈ ${fmt(cap)}` : null, today: fmt(sum(f.today)), month: fmt(sum(f.month)), accounts: f.balances?.length || 0 };
}

function runCard(r) {
  const p = r.progress || {};
  const pct = p.m ? Math.round((p.n / p.m) * 100) : null;
  return `<div class="run-item">
    <div class="row"><mf-spark size="30" state="${r.status === 'running' ? 'working' : r.status === 'done' ? 'done' : r.status === 'error' ? 'error' : 'idle'}"></mf-spark><b class="grow clamp" style="--lines:1">${esc(r.project)}</b><span class="faint">${r.status === 'queued' ? 'в очереди' : r.finished_at ? when(r.finished_at) : when(r.started_at)}</span>
      ${['running', 'queued'].includes(r.status) ? `<button class="icon-btn" data-action="run-stop" data-id="${r.id}" aria-label="Отменить" title="Отменить">${icon('stop')}</button>` : ''}</div>
    <div class="faint clamp" style="--lines:2">${esc(r.prompt)}</div>
    ${r.finished_at ? `<div class="run-sub faint">${r.status === 'done' ? 'готово' : 'не получилось, открой сессию'}</div>` : pct != null ? `<div class="run-bar"><i style="width:${pct}%"></i></div><div class="run-sub"><b>${p.n} из ${p.m}</b> · ${esc(String(p.text).replace(/^\s*\d+\s*\/\s*\d+\s*(готово|сделано|done)?\s*[:.,-]?\s*/i, ''))}</div>`
      : `<div class="run-sub faint">${r.status === 'queued' ? 'начнётся, когда освободится сессия' : p.text ? esc(p.text) : p.steps ? `шаг ${p.steps}` : 'начинаю'}</div>`}
  </div>`;
}

function viewHome() {
  const d = S.data;
  const h = d.home;
  const m = moneyNow(d.finance);
  const sums = homeMods().map((x) => { try { return x.summary(d); } catch { return null; } }).filter((x) => x && x.title);
  const tiles = [
    m ? { icon: '🧾', title: 'Сегодня', sub: 'траты', value: m.today, nav: 'money' } : null,
    m ? { icon: '📅', title: 'Месяц', sub: 'траты', value: m.month, nav: 'money' } : null,
  ].filter(Boolean);
  const top = hero({ label: 'Деньги', tone: 'green', value: m?.cap || (m ? 'Счета не заданы' : 'Загружаю…'), note: m?.cap ? `по ${plural(m.accounts, 'счёту', 'счетам', 'счетам')}, в основной валюте` : m ? 'пришли скриншот банка в бот, и остаток появится здесь' : '', tiles });
  const running = [...(h?.running || []), ...(h?.recent || [])];
  const work = `<section class="card raised"><div class="sec-title">${icon('sessions')}Сейчас в работе${h?.running?.length ? ` <span class="badge accent">${h.running.length}</span>` : ''}</div>
    ${running.length ? running.map(runCard).join('') : '<div class="faint">Сейчас ничего не идёт</div>'}</section>`;
  const wait = [];
  for (const a of h?.asked || []) {
    wait.push(`<div class="wait-item"><div class="row"><span class="badge">${esc(a.project)}</span><span class="faint">${when(a.at)}</span></div>
      <div class="clamp" style="--lines:2">${esc(a.question || a.title)}</div>
      <div class="chips">${a.choices.map((c) => `<button class="chip-btn" data-action="home-answer" data-id="${a.project_id}" data-text="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>`);
  }
  if (h?.pendingMemory?.length) wait.push(`<button class="wait-item tap" data-nav="memory"><div class="row"><span class="badge accent">память</span><b class="grow">${plural(h.pendingMemory.length, 'заметка ждёт', 'заметки ждут', 'заметок ждут')} проверки</b>${icon('back')}</div><div class="faint clamp" style="--lines:1">${esc(h.pendingMemory.map((n) => n.title).join(', '))}</div></button>`);
  if (h?.inboxOpen) wait.push(`<button class="wait-item tap" data-nav="people"><div class="row"><span class="badge info">сообщения</span><b class="grow">${plural(h.inboxOpen, 'сообщение ждёт', 'сообщения ждут', 'сообщений ждут')} решения</b>${icon('back')}</div></button>`);
  const waitBlock = `<section class="card raised"><div class="sec-title"><mf-spark size="26" state="${wait.length ? 'waiting' : 'idle'}"></mf-spark>Ждёт тебя${wait.length ? ` <span class="badge accent">${wait.length}</span>` : ''}</div>${wait.join('') || '<div class="faint">Ничего не ждёт ✨</div>'}</section>`;
  const a = d.agenda;
  const today = new Date().toDateString();
  const evs = (a?.events || []).filter((e) => e.start && new Date(e.start).toDateString() === today);
  const rems = (a?.reminders || []).slice(0, 5);
  const agendaBlock = evs.length || rems.length ? `<section class="card raised"><div class="sec-title">${icon('calendar')}Сегодня</div>
    ${evs.map((e) => `<div class="ev ${eventNow(e) ? 'now' : ''}"><span class="ev-time">${esc(e.time || 'весь день')}</span><span class="ev-title">${esc(e.title)}</span></div>`).join('')}
    ${rems.map((r) => `<div class="rem ${r.kind}"><button class="check" data-action="complete-reminder" data-id="${esc(r.id)}" aria-label="Выполнено"></button><span class="grow">${esc(r.title)}</span></div>`).join('')}</section>` : '';
  const modBlock = sums.length ? `<section class="mod-sums">${sums.map((x) => `<button class="mod-sum" ${x.nav ? `data-nav="${esc(x.nav)}"` : ''}><span class="ms-t">${esc(x.icon || '•')} ${esc(x.title)}</span><b class="ms-v">${esc(String(x.value ?? '·'))}</b>${x.note ? `<span class="ms-n">${esc(x.note)}</span>` : ''}</button>`).join('')}</section>` : '';
  return `${top}${modBlock}${work}${waitBlock}${agendaBlock}`;
}

// ---------- sections with segments ----------
function viewSessionsHost() {
  const seg = segOf('sessions');
  if (seg === 'schedule') return `${segBar('sessions')}${viewTasks()}`;
  // Background work with progress above the chats (not inside an open chat).
  const running = S.detail ? [] : (S.data.home?.running || []);
  const work = running.length ? `<section class="card raised"><div class="sec-title">${icon('sessions')}Сейчас в работе <span class="badge accent">${running.length}</span></div>${running.map(runCard).join('')}</section>` : '';
  return `${S.detail ? '' : segBar('sessions')}${work}${viewSessions()}`;
}
function viewMoney() {
  const seg = segOf('money');
  const body = seg === 'finance' ? viewFinance() : (MOD_VIEWS[seg]?.render?.() || viewFinance());
  return `${segBar('money')}${body}`;
}
function viewReach() {
  const seg = segOf('reach');
  const body = seg === 'social' ? viewSocial() : (MOD_VIEWS[seg]?.render?.() || viewSocial());
  return `${segBar('reach')}${body}`;
}

// ---------- people and messages: search, the latest messages, contacts folded ----------
// A plain line: who, when, what. Decisions are made in the bot, not here.
function messageRow(i) {
  const mail = mailParts(i);
  return `<article class="msg compact li">
    <div class="avatar">${mail ? icon('mail') : esc(initials(i.name))}</div>
    <div class="li-main">
      <div class="msg-head"><span class="msg-name">${esc(i.name || i.chat_id)}</span><span class="grow"></span><span class="faint">${when(i.created_at)}</span></div>
      <div class="msg-text clamp" data-key="m${i.id}">${esc(mail ? `${mail.subject} · ${mail.body}` : i.text)}</div>
    </div>
  </article>`;
}
function viewPeopleMessages() {
  const d = S.data;
  const head = `<div class="page-head"><div><h1>Люди и сообщения</h1><p>Кто что писал: поиск по всей переписке и последние сообщения.</p></div></div>`;
  const search = `<section class="card raised">
    <form class="row mem-search" data-form="recall"><input class="input grow" name="q" placeholder="Например: Аня договор" value="${esc(S.recallQ || '')}" autocomplete="off"><button class="btn primary small">${icon('search')}Найти</button></form>
    ${S.recallRes ? `<div class="recall-list">${S.recallRes.length ? S.recallRes.map((r) => `<div class="recall-item">
        <div class="row"><span class="badge">${MEM_KIND[r.kind] || r.kind}</span><span class="faint">${r.at ? new Date(r.at).toLocaleDateString('ru', { day: 'numeric', month: 'short' }) : ''}</span><b class="grow clamp" style="--lines:1">${esc(r.title)}</b>
          <button class="btn small ghost" data-action="recall-open" data-id="${esc(r.ref)}">${S.recallOpen?.ref === r.ref ? 'Свернуть' : 'Открыть'}</button></div>
        <div class="recall-snip">${hl(r.snip)}</div>
        ${S.recallOpen?.ref === r.ref ? `<div class="recall-full">${esc(S.recallOpen.body)}</div>` : ''}</div>`).join('') : '<div class="empty">Ничего не нашлось.</div>'}</div>` : ''}
  </section>`;
  const items = (d.inboxAll || []).slice(0, 40);
  const latest = `<div class="section-label">Последние сообщения</div><div class="card list" style="padding:0">${items.length ? items.map(messageRow).join('') : '<div class="faint" style="padding:12px">Пока пусто</div>'}</div>`;
  const people = viewPeople().replace(/<div class="page-head">[\s\S]*?<\/div><\/div>/, '');
  return `${head}${search}${latest}
    <details class="card raised fold"><summary class="sec-title">${icon('people')}Люди: проекты и режимы</summary>${people}</details>
    ${rulesBlock()}`;
}

// ---------- model provider: Claude login or any Anthropic-compatible API (src/models.js) ----------
function modelBlock() {
  const m = S.state?.model;
  if (!m) return '';
  const f = S.modelForm || {};
  const pid = f.provider || m.provider;
  const p = m.providers.find((x) => x.id === pid) || m.providers[0];
  const same = pid === m.provider;
  const t = S.modelTest;
  const res = t ? (t.busy ? '<div class="faint">Проверяю…</div>' : t.ok ? `<div class="ok-line">✓ Ответ «${esc(t.text)}» за ${(t.ms / 1000).toFixed(1)} с · ${esc(t.model || '')}</div>` : `<div class="bad-line">Не получилось: ${esc(t.error || 'пустой ответ')}</div>`) : '';
  return `<section class="card raised">
    <div class="sec-title">${icon('spark')}Модель<span class="grow"></span><span class="badge ${m.ready ? 'ok' : 'warn'}">${esc(m.name)}</span></div>
    <div class="faint" style="margin:-4px 0 10px">Сейчас: ${esc(m.main || '')}${m.fast && m.fast !== m.main ? `, быстрая ${esc(m.fast)}` : ''}. Смена действует на новые сообщения, перезапуск не нужен.</div>
    ${!m.connectors ? '<div class="banner warn" style="margin:0 0 10px">Не через Claude: коннекторы claude.ai (Gmail, Календарь, Drive, Metricool) не работают. Почта и Google ниже, а также Mac, работают с любой моделью.</div>' : ''}
    <form class="model-form" data-form="model">
      <label class="field">Провайдер<select class="input" name="provider" data-model-provider>${m.providers.map((x) => `<option value="${x.id}" ${x.id === pid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${pid === 'claude' ? '<div class="faint">Работает на твоей подписке Claude: вход через <span class="kbd">claude auth login</span> на сервере.</div>' : `
      <label class="field">Ключ API<input class="input" name="key" type="password" autocomplete="off" data-keep="m-key" placeholder="${same && m.keySet ? 'задан, вставь новый для замены' : 'вставь ключ'}"></label>
      ${p.keys ? `<div class="faint">Где взять ключ: <a href="${esc(p.keys)}" target="_blank" rel="noopener">${esc(p.keys.replace(/^https?:\/\//, '').split('/')[0])}</a>${p.docs ? ` · <a href="${esc(p.docs)}" target="_blank" rel="noopener">инструкция</a>` : ''}</div>` : ''}
      ${pid === 'custom' ? `<label class="field">Адрес API (Anthropic-совместимый)<input class="input" name="baseUrl" data-keep="m-base" placeholder="https://…/anthropic" value="${esc(same ? m.baseUrl || '' : '')}"></label>` : ''}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <label class="field grow">Основная модель<input class="input" name="main" data-keep="m-main" placeholder="${esc(p.main || 'название модели')}" value="${esc(same && m.main !== p.main ? m.main || '' : '')}"></label>
        <label class="field grow">Быстрая<input class="input" name="fast" data-keep="m-fast" placeholder="${esc(p.fast || 'как основная')}" value="${esc(same && m.fast !== p.fast && m.fast !== m.main ? m.fast || '' : '')}"></label>
      </div>`}
      <div class="row" style="gap:8px;margin-top:4px"><button class="btn primary small">${icon('check')}Сохранить</button><button type="button" class="btn small" data-action="model-test">${icon('play')}Проверить</button></div>
      ${res}
    </form>
  </section>`;
}


// ---------- where it works, the computer, mail and Google (src/modes.js, mailbox.js, google.js) ----------
async function loadConn() {
  if (S.connLoading) return;
  S.connLoading = true;
  try { S.conn = await api('/api/connect'); } catch { S.conn = null; } finally { S.connLoading = false; }
  render();
}
function connectBlock() {
  const c = S.conn;
  if (!c) { loadConn(); return ''; }
  const dot = (on) => `<span class="badge ${on ? 'ok' : ''}">${on ? 'на связи' : 'нет связи'}</span>`;
  const m = c.modes[c.mode];
  const modeChips = ['server', 'computer', 'both'].map((id) => `<button type="button" class="chip-btn ${id === c.mode ? 'on' : ''}" data-action="conn-mode" data-id="${id}">${esc(c.modes[id].title)}</button>`).join('');
  const b = S.bridgeCmd;
  const comp = c.computer;
  const computer = c.mode === 'server' ? '' : `<div class="sec-sub">Компьютер${comp ? `: ${comp.os === 'mac' ? 'Mac' : 'Windows'} ${esc(comp.hostname || '')}` : ''}</div>
    ${comp ? `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="faint">браузер</span>${dot(c.bridge.chrome)}<span class="faint">управление</span>${dot(c.bridge.computer)}${comp.os === 'mac' ? `<span class="faint">приложения</span>${dot(c.bridge.apple)}` : ''}</div>` : '<div class="faint">Ещё не подключён.</div>'}
    ${b ? `<div class="faint" style="margin-top:8px"><b>Mac</b>, в «Терминале»:</div><pre class="cmd">${esc(b.mac)}</pre><div class="faint"><b>Windows</b>, в PowerShell:</div><pre class="cmd">${esc(b.windows)}</pre><div class="faint">Команда действует час и один раз.</div>`
      : `<button class="btn small" data-action="conn-bridge" style="margin-top:8px">${icon('plus')}${comp ? 'Подключить заново' : 'Подключить компьютер'}</button>`}`;
  const mail = c.mail.configured
    ? `<div class="row"><span class="grow">${esc(c.mail.address)} · ${esc(c.mail.provider || '')}</span><button class="btn small ghost" data-action="conn-mail-forget">Отключить</button></div>`
    : `<form data-form="conn-mail" class="model-form">
        <label class="field">Адрес<input class="input" name="address" type="email" data-keep="c-mail" placeholder="you@yandex.ru" required></label>
        <label class="field">Пароль приложения<input class="input" name="password" type="password" autocomplete="off" data-keep="c-pass" required></label>
        <div class="faint">${esc(c.mailPreset?.help || 'Gmail, Яндекс, Mail.ru, iCloud: серверы подставятся сами. Для своего домена впиши IMAP и SMTP.')}</div>
        <div class="row" style="gap:8px"><label class="field grow">IMAP<input class="input" name="imap" data-keep="c-imap" placeholder="imap.example.com:993"></label><label class="field grow">SMTP<input class="input" name="smtp" data-keep="c-smtp" placeholder="smtp.example.com:465"></label></div>
        <button class="btn primary small">${icon('check')}Проверить и подключить</button></form>`;
  const g = c.google;
  const gl = S.googleUrl;
  const google = g.connected
    ? `<div class="row"><span class="grow">${esc(g.email)} · ${esc(g.services.join(', '))}</span><button class="btn small ghost" data-action="conn-google-forget">Отключить</button></div>`
    : !g.clientSet
      ? `<div class="faint">Нужен свой клиент Google: console.cloud.google.com → проект → включи Calendar, Drive, Docs, Sheets API → экран входа «External» и «Publish app» → клиент «Desktop app». Подробно: docs/connectors.md.</div>
         <form data-form="conn-google-client" class="model-form"><input class="input" name="clientId" data-keep="c-gid" placeholder="Client ID" required><input class="input" name="clientSecret" type="password" data-keep="c-gsec" placeholder="Client secret" required><button class="btn small primary">Сохранить</button></form>`
      : `<button class="btn small primary" data-action="conn-google-start">Войти в Google</button>
         ${gl ? `<div class="faint" style="margin-top:6px"><a href="${esc(gl)}" target="_blank" rel="noopener">Открыть вход в Google</a>. После входа откроется пустая страница: скопируй её адрес (http://127.0.0.1:8085/…) сюда.</div>
         <form data-form="conn-google-finish" class="row" style="gap:6px"><input class="input grow" name="pasted" data-keep="c-gpaste" placeholder="http://127.0.0.1:8085/?code=…" required><button class="btn small primary">Готово</button></form>` : ''}`;
  return `<section class="card raised">
    <div class="sec-title">${icon('system')}Где работает<span class="grow"></span><span class="badge">${esc(m.title)}</span></div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${modeChips}</div>
    <div class="faint">Работает: ${esc(m.works.join(', '))}. Не будет: ${esc(m.not.join(', '))}.</div>
    ${computer}
    <div class="sec-sub">На сервере</div>
    <div class="faint">Браузер: ${c.serverBrowser ? 'есть' : c.platform === 'linux' ? 'не установлен (команда обновления поставит)' : 'не нужен'} · Claude Code: ${esc(c.claudeCli || 'не установлен')}</div>
    <div class="sec-sub">Почта (с любой моделью)</div>${mail}
    <div class="sec-sub">Google Календарь и Диск (с любой моделью)</div>${google}
  </section>`;
}

// ---------- system: one light, details on tap ----------
function viewSystemHost() {
  const st = S.state;
  if (!st) return PH;
  const checks = [
    ['Claude', !st.authError],
    ['Telegram', !st.telegram.enabled || ['running', 'external'].includes(st.telegram.process)],
    ['Бот', !st.bot.configured || st.bot.status === 'running'],
    ['Почта', !st.mail?.enabled || st.mail.status !== 'error'],
    ['Голосовые', st.voice?.status !== 'down' && st.voice?.status !== 'error'],
  ];
  const bad = checks.filter((c) => !c[1]).map((c) => c[0]);
  const lamp = st.authError || bad.includes('Бот') ? 'bad' : bad.length || st.paused ? 'warn' : 'ok';
  const text = lamp === 'ok' ? 'Всё работает' : st.paused && !bad.length ? 'Автоматика на паузе' : `Нужна проверка: ${bad.join(', ')}`;
  return `<div class="page-head"><div><h1>Система</h1></div></div>
    <section class="card raised sys-lamp"><mf-spark size="44" state="${lamp === 'bad' ? 'error' : lamp === 'warn' ? 'waiting' : 'idle'}"></mf-spark><div class="grow"><b>${esc(text)}</b><div class="faint">${st.running.length ? `в работе ${st.running.length}` : 'сейчас тихо'} · ${st.paused ? 'автоматика на паузе' : 'автоматика включена'}</div></div></section>
    ${modelBlock()}
    ${connectBlock()}
    <details class="card raised fold"><summary class="sec-title">${icon('system')}Подключения и настройки</summary>${viewSystem()}</details>
    <details class="card raised fold"><summary class="sec-title">${icon('log')}Журнал</summary>${viewLog()}</details>`;
}

const PRESETS = [
  ['Каждый день 9:00', '0 9 * * *'], ['По будням 9:00', '0 9 * * 1-5'], ['Каждый час', '0 * * * *'],
  ['Пн 10:00', '0 10 * * 1'], ['Пт 18:00', '0 18 * * 5'], ['Каждые 15 мин', '*/15 * * * *'],
];

function viewTasks() {
  const tasks = S.data.tasks || [];
  const head = `<div class="page-head"><div><h1>Задачи по расписанию</h1><p>Мейнфрейм сам запускает их в нужной сессии и присылает итог в бот.</p></div><button class="btn primary" data-action="new-task">${icon('plus')}Задача</button></div>`;
  if (!tasks.length) return `${head}<div class="card"><div class="empty"><div class="em-face"><mf-spark size="56"></mf-spark></div><div class="em-title">Задач пока нет</div>Например: каждое утро сводка по календарю и почте, по пятницам разбор заметок.<div style="margin-top:14px"><button class="btn primary" data-action="new-task">Создать задачу</button></div></div></div>`;
  const projects = S.data.projects || [];
  const nextT = tasks.filter((t) => t.enabled && t.next_run).sort((a, b) => a.next_run - b.next_run)[0];
  const top = hero({
    label: 'Ближайший запуск', tone: 'violet',
    value: nextT ? esc(nextT.name) : 'Ничего не запланировано',
    note: nextT ? when(nextT.next_run) : '',
    tiles: [
      { icon: '🟢', title: 'Включено', value: tasks.filter((t) => t.enabled).length },
      { icon: '⏸', title: 'Выключено', value: tasks.filter((t) => !t.enabled).length },
    ],
  });
  return `${head}${top}<div class="card raised list">${tasks.map((t) => `<div class="li">
    <button class="switch ${t.enabled ? 'on' : ''}" data-action="toggle-task" data-id="${t.id}" aria-label="Включить или выключить"></button>
    <div class="li-main"><div class="li-title">${esc(t.name)}</div><div class="li-sub">${esc(cronHuman(t.cron))} · ${esc(projects.find((p) => p.id === t.project_id)?.name || 'Мейнфрейм')}${t.enabled && t.next_run ? ` · следующий ${when(t.next_run)}` : ''}${t.last_status ? ` · прошлый: ${t.last_status === 'done' ? 'ок' : t.last_status}` : ''}</div></div>
    <button class="btn small" data-action="run-task" data-id="${t.id}">${icon('play')}Сейчас</button>
    <button class="btn small ghost" data-action="edit-task" data-id="${t.id}">${icon('edit')}</button>
    <button class="btn small ghost danger" data-action="delete-task" data-id="${t.id}" aria-label="Удалить">${icon('trash')}</button>
  </div>`).join('')}</div>`;
}

function viewPeople() {
  const list = S.data.contacts || [];
  const head = `<div class="page-head"><div><h1>Люди</h1><p>Кто тебе пишет и что с этим делать. «Авто» значит действовать без подтверждения, если диспетчер уверен.</p></div></div>`;
  if (!list.length) return `${head}<div class="card"><div class="empty"><div class="em-face"><mf-spark size="56"></mf-spark></div><div class="em-title">Пока никого</div>Люди появятся, когда напишут в Telegram.</div></div>`;
  return `${head}<div class="card raised list">${list.map((c) => `<div class="li">
    <div class="avatar">${esc(initials(c.name))}</div>
    <div class="li-main"><div class="li-title">${esc(c.name || c.chat_id)}</div><div class="li-sub">${c.username ? `@${esc(c.username)}` : esc(c.chat_id)}</div></div>
    <select class="input" style="width:auto" data-contact-project="${esc(c.chat_id)}">${projectOptions(c.project_id, true)}</select>
    <div class="seg">${['ask', 'auto', 'ignore'].map((m) => `<button class="${c.mode === m ? 'on' : ''}" data-contact-mode="${esc(c.chat_id)}" data-mode="${m}">${{ ask: 'Спрашивать', auto: 'Авто', ignore: 'Игнор' }[m]}</button>`).join('')}</div>
  </div>`).join('')}</div>`;
}

const LOG_KIND = { tool: ['инструмент', ''], run: ['сессия', 'accent'], inbox: ['входящее', 'info'], telegram: ['telegram', 'info'], mail: ['почта', 'info'], cron: ['расписание', 'warn'], system: ['система', ''], error: ['ошибка', 'bad'] };
function viewLog() {
  const all = S.data.log || [];
  const list = S.logFilter === 'all' ? all : all.filter((l) => l.kind === S.logFilter);
  const filters = ['all', 'run', 'tool', 'inbox', 'cron', 'error'];
  return `<div class="page-head"><div><h1>Журнал</h1><p>Каждое действие агента и системы. Последние 200 записей.</p></div>
    <div class="seg">${filters.map((f) => `<button class="${S.logFilter === f ? 'on' : ''}" data-log-filter="${f}">${f === 'all' ? 'Всё' : LOG_KIND[f][0]}</button>`).join('')}</div></div>
    <div class="card raised" style="padding:6px 12px">${list.length ? list.map((l) => {
      const [k, cls] = LOG_KIND[l.kind] || [l.kind, ''];
      const t = new Date(l.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
      return `<div class="log-li"><span class="t">${t}</span><span class="k"><span class="badge ${cls}">${k}</span></span><span class="m clamp" style="--lines:3" data-key="l${l.id}">${esc(l.message)}</span></div>`;
    }).join('') : '<div class="empty">Пусто</div>'}</div>`;
}

function viewSystem() {
  const st = S.state;
  if (!st) return '';
  const tgText = !st.telegram.enabled
    ? 'Не настроен. Нужны TELEGRAM_API_ID, TELEGRAM_API_HASH (my.telegram.org) и TELEGRAM_SESSION_STRING (scripts/telegram-login.sh).'
    : `${st.telegram.account ? `Аккаунт ${st.telegram.account}. ` : ''}Процесс: ${st.telegram.process}. Связь: ${st.telegram.client}.${st.telegram.error ? ` ${st.telegram.error}` : ''}`;
  let botText = 'Не настроен. Создай бота у @BotFather и впиши BOT_TOKEN в .env.';
  if (st.bot.configured) botText = st.bot.owner ? `@${st.bot.username || '…'} привязан к тебе.` : 'Бот запущен, но ещё не привязан.';
  const checks = [
    ['🤖', 'Claude', !st.authError],
    ['💬', 'Telegram', !st.telegram.enabled || ['running', 'external'].includes(st.telegram.process)],
    ['🛎', 'Бот', !st.bot.configured || st.bot.status === 'running'],
    ['✉️', 'Почта', !st.mail?.enabled || st.mail.status !== 'error'],
    ['🎤', 'Голосовые', st.voice?.status !== 'down' && st.voice?.status !== 'error'],
    ['📱', 'Mini App', Boolean(st.tunnel?.url)],
  ];
  const bad = checks.filter((c) => !c[2]).length;
  const top = hero({
    label: 'Состояние мейнфрейма', tone: bad ? 'warm' : 'green',
    value: bad ? `${plural(bad, 'проблема', 'проблемы', 'проблем')}` : 'Всё работает',
    note: st.paused ? 'автоматика на паузе' : 'автоматика включена',
    tiles: checks.map(([ic, name, ok]) => ({ icon: ic, title: name, sub: ok ? 'на связи' : 'нужна проверка', value: ok ? '<span style="color:#6be3a0">●</span>' : '<span style="color:#ff8a7a">●</span>' })),
  });
  return `${top}<div class="page-head"><div><h1>Система</h1><p>Состояние мейнфрейма и подключения.</p></div><button class="btn" data-nav="people">${icon('people')}Люди</button></div>
  <div class="grid2">
    <div class="card raised"><div class="stat-title"><span class="dot ${st.authError ? 'bad' : 'ok'}"></span>Claude</div>
      <div class="muted">${st.authError ? `Нужен вход: ${esc(st.authError.message)}` : 'Работает на твоей подписке через claude login.'}</div>
      ${st.authError ? '<div class="copy-line"><span class="kbd">claude auth login</span></div>' : ''}</div>

    <div class="card raised"><div class="stat-title"><span class="dot ${!st.bot.configured ? '' : st.bot.owner ? 'ok' : 'warn'}"></span>Бот управления</div>
      <div class="muted">${esc(botText)}</div>
      ${st.pairingCode && st.bot.configured ? `<div class="copy-line"><span class="kbd">/start ${esc(st.pairingCode)}</span><button class="btn small" data-copy="/start ${esc(st.pairingCode)}">${icon('copy')}</button></div><div class="faint" style="margin-top:6px">Отправь эту команду своему боту, чтобы привязать его.</div>` : ''}</div>

    <div class="card raised"><div class="stat-title"><span class="dot ${!st.telegram.enabled ? '' : st.telegram.process === 'running' ? 'ok' : 'bad'}"></span>Telegram-аккаунт</div>
      <div class="muted">${esc(tgText)}</div></div>

    <div class="card raised"><div class="stat-title"><span class="dot ${st.tunnel.url ? 'ok' : ''}"></span>Mini App и телефон</div>
      <div class="muted">${st.tunnel.url ? 'Доступен по https. В боте есть кнопка «Мейнфрейм».' : 'Нет https-адреса. Нужен cloudflared или PUBLIC_URL.'}</div>
      ${st.dashboardLink ? `<div class="copy-line"><span class="kbd">${esc(st.dashboardLink)}</span><button class="btn small" data-copy="${esc(st.dashboardLink)}">${icon('copy')}</button></div><div class="faint" style="margin-top:6px">Личная ссылка для браузера на телефоне. Никому не отправляй.</div>` : ''}</div>

    <div class="card raised"><div class="stat-title"><span class="dot ${st.voice?.status === 'running' ? 'ok' : st.voice?.status === 'off' ? '' : 'bad'}"></span>Голосовые</div>
      <div class="muted">${{ running: 'Расшифровываются на этом Mac (whisper.cpp, видеокарта). Голосовые боту выполняются как команды.', off: 'Выключено (WHISPER_URL=off).', down: 'Служба расшифровки не отвечает. Запусти scripts/install-whisper.sh.', error: 'Служба расшифровки отвечает с ошибкой, смотри data/logs/whisper.log.' }[st.voice?.status] || 'Проверяю…'}</div></div>

    <div class="card raised"><div class="stat-title"><span class="dot ${!st.mail?.enabled ? '' : st.mail.status === 'running' ? 'ok' : st.mail.status === 'error' ? 'bad' : 'warn'}"></span>Почта</div>
      <div class="muted">${!st.mail?.enabled ? 'Выключена (MAIL=off).' : st.mail.status === 'error' ? `Ошибка: ${esc(st.mail.error)}` : 'Новые письма из приложения Почта (iCloud, Gmail и другие ящики там) приходят во Входящие. Рассылки и уведомления сервисов уходят в «Разобрано» без вопросов.'}</div>
      ${st.mail?.lastCheck ? `<div class="faint" style="margin-top:6px">Проверено ${when(st.mail.lastCheck)}</div>` : ''}</div>

    <div class="card raised"><div class="stat-title"><span class="dot ${({ connected: 'ok', expired: 'bad', not_connected: 'warn' })[st.linkedin?.state] || ''}"></span>LinkedIn</div>
      <div class="muted">${({
        not_configured: 'Нет ключей приложения в .env (LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET).',
        not_connected: 'Ключи есть, вход не выполнен. Нажми на Mac: откроется LinkedIn, разреши доступ.',
        expired: 'Доступ истёк. Подключи заново на Mac.',
        connected: `Подключён: ${esc(st.linkedin?.name || '')}. Посты публикуются только после твоего «да». Переподключить через ${st.linkedin?.daysLeft} дн.`,
      })[st.linkedin?.state] || '…'} Сообщения LinkedIn приходят во Входящие из писем-уведомлений.</div>
      ${st.linkedin && st.linkedin.state !== 'not_configured' && st.linkedin.state !== 'connected' ? `<a class="btn small primary" style="margin-top:8px" href="/oauth/linkedin/start" target="_blank">Подключить LinkedIn</a><div class="faint" style="margin-top:6px">Открывай пульт по личной ссылке в браузере, не из Telegram.</div>` : ''}</div>

    <div class="card raised"><div class="stat-title">${icon('tool')}MCP-серверы</div>
      <div class="chips" style="margin-top:6px">${st.mcp.map((m) => `<span class="badge">${esc(m)}</span>`).join('')}</div>
      <div class="faint" style="margin-top:8px">Список в mcp.json. Подключаются к каждой сессии.</div></div>

    <div class="card raised"><div class="stat-title">${icon(st.paused ? 'play' : 'stop')}Автоматика</div>
      <div class="muted">${st.paused ? 'На паузе. Ничего не отправляется само.' : 'Включена. Рабочая папка: '}<span class="mono">${st.paused ? '' : esc(shortPath(st.workspace))}</span></div>
      ${st.paused ? '<div style="margin-top:10px"><button class="btn primary" data-action="resume">Включить</button></div>' : ''}</div>
  </div>`;
}

// ---------- modals ----------
function modal(html, onSubmit) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay"><form class="modal">${html}</form></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.overlay').addEventListener('click', (e) => { if (e.target.classList.contains('overlay') || e.target.dataset.close !== undefined) close(); });
  root.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if ((await onSubmit(data, e.target)) !== false) close();
  });
  root.querySelector('input, textarea')?.focus();
  return root;
}

function projectModal(p = null) {
  modal(`<h2>${p ? 'Проект' : 'Новый проект'}</h2><div class="stack">
    <label class="field">Название<input class="input" name="name" required value="${esc(p?.name || '')}" placeholder="Лендинг кофейни"></label>
    <label class="field">Папка<input class="input mono" name="cwd" value="${esc(p?.cwd || '')}" placeholder="${esc(S.state?.workspace || '')}/Название"></label>
    <label class="field">О чём проект (для диспетчера)<textarea class="input" name="description" placeholder="Лендинг кофейни, правки от клиента">${esc(p?.description || '')}</textarea></label>
    <label class="field">Ключевые слова<input class="input" name="keywords" value="${esc(p?.keywords || '')}" placeholder="лендинг, заголовок, отзывы, сайт"></label>
  </div><div class="actions">${p && !p.is_default ? '<button type="button" class="btn ghost danger" data-del>Удалить</button><span class="grow"></span>' : ''}<button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">${p ? 'Сохранить' : 'Создать'}</button></div>`,
  async (data) => {
    const out = await act(() => (p ? api(`/api/projects/${p.id}`, { method: 'PATCH', body: data }) : api('/api/projects', { method: 'POST', body: data })), p ? 'Сохранено' : 'Проект создан');
    if (!out) return false;
    if (!p) { S.project = out.id; localStorage.setItem('mf_project', out.id); S.detail = true; await refresh(); }
  });
  $('#modal-root [data-del]')?.addEventListener('click', async () => {
    if (!await ask(`Удалить проект «${p.name}» из мейнфрейма? Папка и сессия Claude Code останутся.`)) return;
    $('#modal-root').innerHTML = '';
    S.project = null;
    await act(() => api(`/api/projects/${p.id}`, { method: 'DELETE' }), 'Удалено');
  });
}

async function attachModal() {
  const root = modal(`<h2>Подключить из Claude Code</h2><div class="faint" style="margin-bottom:10px">Всё с этого Mac: терминал, приложение, SDK. Проект продолжит свою последнюю сессию, а писать ему можно отсюда и из бота.</div>
    <div class="row" style="margin-bottom:8px"><div class="seg"><button type="button" class="on" data-attach-mode="projects">Проекты</button><button type="button" data-attach-mode="sessions">Сессии</button></div>
    <input class="input grow" placeholder="Поиск" data-search></div>
    <div class="list" id="sess-list"><div class="empty">Загружаю…</div></div><div class="actions"><button type="button" class="btn ghost" data-close>Закрыть</button></div>`, () => {});
  let sessions = [];
  let mode = 'projects';
  try { sessions = await api('/api/claude-sessions?limit=600'); } catch (e) { $('#sess-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const base = (p) => (p || '').split('/').filter(Boolean).pop() || p;
  // Claude Code keeps sessions per folder: one project = one folder, its newest session first.
  const projects = [...sessions.reduce((m, s) => {
    const g = m.get(s.cwd) || { cwd: s.cwd, name: base(s.cwd), sessions: [], last: 0 };
    g.sessions.push(s);
    g.last = Math.max(g.last, s.lastModified || 0);
    return m.set(s.cwd, g);
  }, new Map()).values()].sort((a, b) => b.last - a.last);
  const draw = (q = '') => {
    const ql = q.toLowerCase();
    let html;
    if (mode === 'projects') {
      const f = projects.filter((p) => !q || `${p.name} ${p.cwd}`.toLowerCase().includes(ql));
      html = f.map((p) => {
        const latest = p.sessions[0];
        const linked = p.sessions.find((s) => s.projectId)?.projectId || latest.folderProjectId;
        return `<div class="li"><div class="li-main"><div class="li-title">${esc(p.name)}</div><div class="li-sub mono">${esc(shortPath(p.cwd))} · ${p.sessions.length} сесс. · ${when(p.last)}</div><div class="li-sub">${esc((latest.title || '').slice(0, 80))}</div></div>${linked ? `<button type="button" class="btn small" data-open-linked="${linked}">Открыть</button>` : `<button type="button" class="btn small primary" data-attach="${latest.sessionId}" data-name="${esc(p.name)}">Подключить</button>`}</div>`;
      }).join('');
    } else {
      const f = sessions.filter((s) => !q || `${s.title} ${s.cwd}`.toLowerCase().includes(ql));
      html = f.slice(0, 150).map((s) => `<div class="li"><div class="li-main"><div class="li-title">${esc(s.title.slice(0, 90))}</div><div class="li-sub mono">${esc(shortPath(s.cwd))} · ${when(s.lastModified)}</div></div>${s.projectId ? '<span class="badge ok">подключена</span>' : `<button type="button" class="btn small" data-attach="${s.sessionId}">Подключить</button>`}</div>`).join('');
    }
    $('#sess-list').innerHTML = html || '<div class="empty">Ничего не нашёл</div>';
  };
  draw();
  const search = root.querySelector('[data-search]');
  search.addEventListener('input', (e) => draw(e.target.value));
  root.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-attach-mode]');
    if (m) {
      mode = m.dataset.attachMode;
      root.querySelectorAll('[data-attach-mode]').forEach((b) => b.classList.toggle('on', b === m));
      return draw(search.value);
    }
    const linked = e.target.closest('[data-open-linked]')?.dataset.openLinked;
    if (linked) { root.innerHTML = ''; S.view = 'sessions'; S.project = Number(linked); S.detail = true; localStorage.setItem('mf_project', linked); return refresh(); }
    const btn = e.target.closest('[data-attach]');
    if (!btn) return;
    const s = sessions.find((x) => x.sessionId === btn.dataset.attach);
    const name = btn.dataset.name || s.title.slice(0, 40);
    const out = await act(() => api('/api/claude-sessions/attach', { method: 'POST', body: { sessionId: s.sessionId, cwd: s.cwd, name } }), 'Подключено');
    if (out) { root.innerHTML = ''; S.view = 'sessions'; S.project = out.id; S.detail = true; localStorage.setItem('mf_project', out.id); await refresh(); }
  });
}

function eventModal() {
  const d = new Date(Date.now() + 3600000);
  const h = String(d.getHours()).padStart(2, '0');
  modal(`<h2>Новая встреча</h2><div class="stack">
    <label class="field">Название<input class="input" name="title" required placeholder="Созвон с клиентом"></label>
    <div class="row" style="flex-wrap:nowrap"><label class="field grow">День<input class="input" type="date" name="day" required value="${isoDay(d)}"></label>
      <label class="field">С<input class="input" type="time" name="from" required value="${h}:00"></label>
      <label class="field">До<input class="input" type="time" name="to" required value="${String((d.getHours() + 1) % 24).padStart(2, '0')}:00"></label></div>
    <label class="field">Место или ссылка<input class="input" name="location" placeholder="Zoom, адрес"></label>
  </div><div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Создать</button></div>`,
  async (f) => {
    let end = `${f.day}T${f.to}:00`;
    if (f.to <= f.from) { const n = new Date(`${f.day}T00:00:00`); n.setDate(n.getDate() + 1); end = `${isoDay(n)}T${f.to}:00`; }
    const out = await act(() => api('/api/events', { method: 'POST', body: { title: f.title, start: `${f.day}T${f.from}:00`, end, location: f.location } }), 'Встреча в календаре');
    return out ? undefined : false;
  });
}

function noteModal() {
  modal(`<h2>Новая заметка</h2><div class="stack">
    <label class="field">Заголовок<input class="input" name="title" required></label>
    <label class="field">Текст<textarea class="input" name="body" rows="8"></textarea></label>
  </div><div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Сохранить</button></div>`,
  async (f) => {
    const out = await act(() => api('/api/notes', { method: 'POST', body: f }), 'Заметка создана');
    return out ? undefined : false;
  });
}

function taskModal(t = null) {
  const root = modal(`<h2>${t ? 'Задача' : 'Новая задача'}</h2><div class="stack">
    <label class="field">Название<input class="input" name="name" required value="${esc(t?.name || '')}" placeholder="Утренняя сводка"></label>
    <div class="field" style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-2);font-weight:500">Когда
      <div class="chips">${PRESETS.map(([l, c]) => `<button type="button" class="chip" data-preset="${c}">${l}</button>`).join('')}</div>
      <input class="input mono" name="cron" required value="${esc(t?.cron || '0 9 * * *')}"><span class="faint" data-cron-hint></span></div>
    <label class="field">Проект<select class="input" name="project_id">${projectOptions(t?.project_id, true)}</select></label>
    <label class="field">Что сделать<textarea class="input" name="prompt" required rows="4" placeholder="Посмотри мой календарь на сегодня, непрочитанную почту и Telegram. Пришли короткую сводку в бот через notify_owner.">${esc(t?.prompt || '')}</textarea></label>
  </div><div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">${t ? 'Сохранить' : 'Создать'}</button></div>`,
  async (data) => {
    data.project_id = data.project_id ? Number(data.project_id) : null;
    const out = await act(() => (t ? api(`/api/tasks/${t.id}`, { method: 'PATCH', body: data }) : api('/api/tasks', { method: 'POST', body: data })), t ? 'Сохранено' : 'Задача создана');
    return out ? undefined : false;
  });
  const input = root.querySelector('[name=cron]');
  const hint = root.querySelector('[data-cron-hint]');
  const check = async () => {
    try {
      const { next } = await api('/api/tasks/validate', { method: 'POST', body: { cron: input.value } });
      hint.textContent = `${cronHuman(input.value)} · следующий запуск ${when(next)}`;
      hint.style.color = '';
    } catch (e) { hint.textContent = e.message; hint.style.color = 'var(--bad)'; }
  };
  input.addEventListener('input', check);
  root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.preset; check(); }));
  check();
}

// ---------- inbox helpers ----------
async function toggleHistory(id) {
  const h = S.history[id] || {};
  if (h.open) { S.history[id] = { ...h, open: false }; return render(); }
  S.history[id] = { open: true, loading: !h.items, items: h.items };
  render();
  try {
    S.history[id] = { open: true, items: await api(`/api/inbox/${id}/history`) };
  } catch (e) {
    S.history[id] = { open: true, error: e.message };
  }
  render();
}

async function suggest(id) {
  const ta = $(`[data-draft="${id}"]`);
  const item = (S.data.inbox || []).find((x) => x.id === id);
  // Text that differs from the saved draft is the owner's hint: a few words of what to say.
  const hint = ta && ta.value.trim() && ta.value.trim() !== (item?.draft || '').trim() ? ta.value.trim() : '';
  S.busy[id] = 'suggest';
  render();
  try {
    const { draft, warning } = await api(`/api/inbox/${id}/suggest`, { method: 'POST', body: { hint } });
    if (warning) toast(`Проверь: ${warning}`, true);
    if (item) item.draft = draft;
    delete S.busy[id];
    S.panel[id] = 'reply';
    await refresh();
    const box = $(`[data-draft="${id}"]`);
    if (box) { box.value = draft; box.dataset.touched = ''; box.focus(); }
  } catch (e) {
    delete S.busy[id];
    render();
    toast(e.message, true);
  }
}

// Desktop keys: J/K or arrows pick a message, R reply, F forward, S skip, H history, G draft.
document.addEventListener('keydown', (e) => {
  if (S.view !== 'inbox' || e.metaKey || e.ctrlKey || e.altKey || $('#modal-root').innerHTML) return;
  const t = e.target;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  const cards = [...document.querySelectorAll('.msg[data-item]')].map((c) => Number(c.dataset.item));
  if (!cards.length) return;
  const idx = cards.indexOf(S.focus);
  const k = e.key.toLowerCase();
  const pick = (n) => { S.focus = cards[Math.max(0, Math.min(cards.length - 1, n))]; render(); $(`[data-item="${S.focus}"]`)?.scrollIntoView({ block: 'nearest' }); };
  if (k === 'j' || k === 'о' || e.key === 'ArrowDown') { e.preventDefault(); return pick(idx + 1); }
  if (k === 'k' || k === 'л' || e.key === 'ArrowUp') { e.preventDefault(); return pick(idx < 0 ? 0 : idx - 1); }
  const id = idx < 0 ? cards[0] : S.focus;
  const click = (sel) => $(`[data-item="${id}"] ${sel}`)?.click();
  const openPanel = (name) => {
    e.preventDefault();
    if (!$(`[data-item="${id}"] [data-panel="${name}"]`)) return;
    S.focus = id; S.panel[id] = name; render();
    $(`[data-${name === 'reply' ? 'draft' : 'task'}="${id}"]`)?.focus();
  };
  if (k === 'r' || k === 'к') openPanel('reply');
  else if (k === 'f' || k === 'а') openPanel('forward');
  else if (k === 's' || k === 'ы') { e.preventDefault(); click('[data-action="ignore"]'); }
  else if (k === 'h' || k === 'р') { e.preventDefault(); click('[data-action="history"]'); }
  else if (k === 'g' || k === 'п') { e.preventDefault(); click('[data-action="suggest"]'); }
});

// ---------- events ----------
document.addEventListener('click', (e) => {
  const sum = e.target.closest('details.steps > summary');
  if (sum) { const key = sum.parentElement.dataset.steps; S.openSteps[key] = !sum.parentElement.open; }
});
// Tap on a folded text unfolds it (only when it is actually cut off).
document.addEventListener('click', (e) => {
  const el = e.target.closest('.clamp');
  if (el && !el.classList.contains('open') && el.scrollHeight > el.clientHeight + 2 && !e.target.closest('button, a, select, textarea')) el.classList.add('open');
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-nav],[data-seg],[data-action],[data-project],[data-inbox-filter],[data-log-filter],[data-contact-mode],[data-copy],[data-open-project],[data-panel],[data-tg-link]');
  if (!el) return;
  const { dataset: d } = el;
  if (d.tgLink) {
    if (inTelegram && tg.openTelegramLink) { e.preventDefault(); tg.openTelegramLink(d.tgLink); }
    return;
  }
  if (d.panel) {
    const cur = $(`[data-item="${d.id}"] .tabbtn.on[data-panel]`)?.dataset.panel;
    S.panel[d.id] = cur === d.panel ? 'none' : d.panel;
    S.focus = Number(d.id);
    render();
    if (S.panel[d.id] !== 'none') $(`[data-${d.panel === 'reply' ? 'draft' : 'task'}="${d.id}"]`)?.focus();
    return;
  }
  if (d.nav) {
    S.view = resolveView(d.nav); S.detail = false; localStorage.setItem('mf_view', S.view); saveSeg();
    window.scrollTo(0, 0);
    instant();
    return refresh();
  }
  if (d.project) { S.project = Number(d.project); S.detail = true; localStorage.setItem('mf_project', d.project); instant({ fresh: true }); return refresh(); }
  if (d.openProject) { S.view = 'sessions'; S.project = Number(d.openProject); S.detail = true; instant({ fresh: true }); return refresh(); }
  if (d.inboxFilter) { S.inboxFilter = d.inboxFilter; instant(); return refresh(); }
  if (d.logFilter) { S.logFilter = d.logFilter; return render(); }
  if (d.seg) { const [host, id] = d.seg.split(':'); SEG[host] = id; saveSeg(); window.scrollTo(0, 0); instant({ fresh: true }); return refresh(); }
  if (d.copy) { await navigator.clipboard.writeText(d.copy).catch(() => {}); return toast('Скопировано'); }
  if (d.contactMode) return act(() => api(`/api/contacts/${encodeURIComponent(d.contactMode)}`, { method: 'PATCH', body: { mode: d.mode, project_id: Number($(`[data-contact-project="${CSS.escape(d.contactMode)}"]`).value) || null } }));

  const id = d.id;
  const p = (S.data.projects || []).find((x) => x.id === S.project);
  switch (d.action) {
    case 'stop-all':
      if (await ask('Остановить все сессии и поставить автоматику на паузу?')) await act(() => api('/api/stop-all', { method: 'POST' }), 'Всё остановлено');
      break;
    case 'resume': await act(() => api('/api/resume', { method: 'POST' }), 'Автоматика включена'); break;
    case 'clear-auth': await act(() => api('/api/projects/1/message', { method: 'POST', body: { prompt: 'Проверка связи. Ответь одним словом: на связи.' } }), 'Проверяю…'); break;
    case 'forward': {
      const projectId = Number($(`[data-fwd-project="${id}"]`)?.value);
      const task = $(`[data-task="${id}"]`)?.value;
      await act(() => api(`/api/inbox/${id}/forward`, { method: 'POST', body: { project_id: projectId, task } }), 'Отправлено в сессию');
      break;
    }
    case 'reply': {
      const text = $(`[data-draft="${id}"]`)?.value;
      await act(() => api(`/api/inbox/${id}/reply`, { method: 'POST', body: { text } }), 'Ответ отправлен');
      break;
    }
    case 'ignore': {
      const out = await act(() => api(`/api/inbox/${id}/ignore`, { method: 'POST' }));
      if (out) toast('Пропущено', false, { label: 'Вернуть', run: () => act(() => api(`/api/inbox/${id}/restore`, { method: 'POST' }), 'Вернул') });
      break;
    }
    case 'restore': await act(() => api(`/api/inbox/${id}/restore`, { method: 'POST' }), 'Вернул в открытые'); break;
    case 'rule-del': if (await ask('Удалить это правило?')) await act(() => api(`/api/inbox-rules/${id}`, { method: 'DELETE' }), 'Правило удалено'); break;
    case 'history': await toggleHistory(Number(id)); break;
    case 'suggest': await suggest(Number(id)); break;
    case 'reclassify': await act(() => api(`/api/inbox/${id}/reclassify`, { method: 'POST' }), 'Разбираю заново'); break;
    case 'new-project': projectModal(); break;
    case 'edit-project': if (p) projectModal(p); break;
    case 'attach': attachModal(); break;
    case 'back': S.detail = false; render(); break;
    case 'new-session':
      if (p && await ask('Следующее сообщение начнёт новую сессию Claude Code. Старая останется на диске.')) await act(() => api(`/api/projects/${p.id}/new-session`, { method: 'POST' }), 'Готово');
      break;
    case 'stop-project': {
      const r = (S.data.timeline || []).filter((x) => ['running', 'queued'].includes(x.status));
      await act(() => Promise.all(r.map((x) => api(`/api/runs/${x.id}/stop`, { method: 'POST' }))), 'Остановлено');
      break;
    }
    case 'past-all':
      if (p) { S.past[p.id] = { session: p.session_id, ...(await api(`/api/projects/${p.id}/past?limit=200`)) }; render(); }
      break;
    case 'complete-reminder':
      el.classList.add('done');
      await act(() => api('/api/reminders/complete', { method: 'POST', body: { id } }), 'Выполнено');
      break;
    case 'social-refresh':
      await act(() => api('/api/social/refresh', { method: 'POST' }), 'Собираю сводку, это 1–3 минуты');
      break;
    case 'soc-tab': S.socTab = id; try { localStorage.setItem('mf_soctab', id); } catch {} window.scrollTo(0, 0); await refresh(); break;
    case 'post-publish': {
      const post = S.data.content.posts.find((x) => x.id === Number(id));
      if (!post || !await ask(`Опубликовать в ${S.data.content.networks[post.network]} от твоего имени прямо сейчас?`)) break;
      await savePostText(id);
      await act(() => api(`/api/content/posts/${id}/publish`, { method: 'POST' }), S.data.content.direct.includes(post.network) ? 'Опубликовано' : 'Передал в Metricool');
      break;
    }
    case 'post-schedule': {
      const v = $(`[data-sched="${id}"]`)?.value;
      const at = v ? new Date(v).getTime() : NaN;
      if (!(at > Date.now())) return toast('Выбери дату и время в будущем', true);
      await savePostText(id);
      await act(() => api(`/api/content/posts/${id}/schedule`, { method: 'POST', body: { at } }), `Запланировано на ${new Date(at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
      break;
    }
    case 'post-unschedule': await act(() => api(`/api/content/posts/${id}/unschedule`, { method: 'POST' }), 'Вернул в черновики'); break;
    case 'post-delete': if (await ask('Удалить черновик?')) await act(() => api(`/api/content/posts/${id}`, { method: 'DELETE' }), 'Удалено'); break;
    case 'repack': {
      const src = d.src === 'an' ? S.data.ins?.analysis?.best?.find((x) => x.id === Number(id)) : S.data.social?.channel?.posts?.find((x) => x.id === Number(id));
      if (!src) break;
      const full = await api(`/api/content/generate`, { method: 'POST', body: { source: src.text, topic: `Перепаковка: ${src.text.slice(0, 80)}`, networks: ['linkedin', 'instagram', 'threads', 'tiktok'], link: false } }).then(() => true).catch((e) => { toast(e.message, true); return false; });
      if (full) { toast('Перепаковываю под LinkedIn, Instagram, Threads и TikTok, это около минуты'); S.socTab = 'studio'; await refresh(); }
      break;
    }
    case 'ideas-refresh': await act(() => api('/api/content/ideas/refresh', { method: 'POST' }), 'Собираю идеи, это 1–2 минуты'); break;
    case 'idea-drop': await act(() => api(`/api/content/ideas/${id}`, { method: 'PATCH', body: { status: 'dropped' } })); break;
    case 'idea-use': {
      const idea = S.data.content.ideas.find((x) => x.id === Number(id));
      if (!idea) break;
      S.studioTopic = [idea.title, idea.angle].filter(Boolean).join('. '); S.studioIdea = idea.id; S.studioLink = true; S.socTab = 'studio';
      const ta = $('[data-keep="studio-topic"]'); if (ta) ta.value = '';
      window.scrollTo(0, 0); render();
      const t2 = $('[data-keep="studio-topic"]'); if (t2) t2.value = S.studioTopic;
      break;
    }
    case 'auto-toggle': await act(() => api('/api/content/auto', { method: 'POST', body: { enabled: el.checked } }), el.checked ? 'Автопосты включены' : 'Автопосты выключены'); break;
    case 'auto-per': await act(() => api('/api/content/auto', { method: 'POST', body: { perDay: Number(id) } })); break;
    case 'auto-net': {
      const nets = new Set(S.data.content.auto.networks); if (el.checked) nets.add(id); else nets.delete(id);
      await act(() => api('/api/content/auto', { method: 'POST', body: { networks: [...nets] } }));
      break;
    }
    case 'auto-run': await act(() => api('/api/content/auto/run', { method: 'POST' }), 'Смотрю свежие посты конкурентов, черновики придут в бот'); break;
    case 'rivals-find': await act(() => api('/api/content/competitors/find', { method: 'POST' }), 'Ищу похожие каналы, это 2–4 минуты'); break;
    case 'rival-del': await act(() => api(`/api/content/competitors/${encodeURIComponent(id)}`, { method: 'DELETE' })); if (S.data.ins) S.data.ins.rivals = null; await refresh(); break;
    case 'rival-idea': {
      const [u, pid] = id.split(':');
      const post = S.data.ins?.rivals?.items?.find((r) => r.username === u)?.top.find((x) => String(x.id) === pid);
      if (post) await act(() => api('/api/content/ideas', { method: 'POST', body: { title: `Как у @${u}: ${post.text.slice(0, 160)}` } }), 'Добавил в идеи');
      break;
    }
    case 'recall-kind': S.recallKind = id; if (S.recallQ) await runRecall(); else render(); break;
    case 'recall-open':
      if (S.recallOpen?.ref === id) S.recallOpen = null;
      else { try { S.recallOpen = await api(`/api/recall/open?ref=${encodeURIComponent(id)}`); } catch (e) { toast(e.message, true); } }
      render(); break;
    case 'mem-approve': await act(() => api(`/api/memory/pending/${encodeURIComponent(id)}/approve`, { method: 'POST' }), 'Запомнил'); break;
    case 'mem-reject': await act(() => api(`/api/memory/pending/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Отклонено'); break;
    case 'mem-edit': S.memEdit = S.memEdit === id ? null : id; render(); break;
    case 'mem-history':
      if (S.memHist?.name === id) S.memHist = null;
      else { try { S.memHist = { name: id, items: await api(`/api/memory/${encodeURIComponent(id)}/history`) }; } catch (e) { toast(e.message, true); } }
      render(); break;
    case 'mem-delete': if (await ask('Забыть эту заметку? Её можно будет вернуть из истории.')) await act(() => api(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Забыл'); break;
    case 'fin-more': S.finDays = (S.finDays || 7) + 14; render(); break;
    case 'fin-add-toggle': S.finAdd = !S.finAdd; render(); break;
    case 'del-expense':
      if (await ask('Удалить этот расход?')) await act(() => api(`/api/finance/${id}`, { method: 'DELETE' }), 'Удалено');
      break;
    case 'new-event': eventModal(); break;
    case 'new-note': noteModal(); break;
    case 'new-task': taskModal(); break;
    case 'edit-task': taskModal((S.data.tasks || []).find((t) => t.id === Number(id))); break;
    case 'toggle-task': {
      const t = (S.data.tasks || []).find((x) => x.id === Number(id));
      await act(() => api(`/api/tasks/${id}`, { method: 'PATCH', body: { enabled: !t.enabled } }));
      break;
    }
    case 'run-task': await act(() => api(`/api/tasks/${id}/run`, { method: 'POST' }), 'Запущено'); break;
    case 'conn-mode': S.conn = await act(() => api('/api/connect/mode', { method: 'POST', body: { mode: id } }), 'Режим сохранён') || S.conn; render(); break;
    case 'conn-bridge': S.bridgeCmd = await act(() => api('/api/connect/bridge', { method: 'POST' })); render(); break;
    case 'conn-mail-forget': if (await ask('Отключить почту?')) { S.conn = await act(() => api('/api/connect/mail/forget', { method: 'POST' }), 'Почта отключена') || S.conn; render(); } break;
    case 'conn-google-forget': if (await ask('Отключить Google?')) { S.conn = await act(() => api('/api/connect/google/forget', { method: 'POST' }), 'Google отключён') || S.conn; render(); } break;
    case 'conn-google-start': { const r = await act(() => api('/api/connect/google/start', { method: 'POST', body: {} })); if (r) { S.googleUrl = r.url; window.open(r.url, '_blank', 'noopener'); render(); } break; }
    case 'model-test': {
      const form = $('[data-form="model"]');
      const body = Object.fromEntries(new FormData(form).entries());
      S.modelTest = { busy: true }; render();
      try { S.modelTest = await api('/api/model/test', { method: 'POST', body }); } catch (err) { S.modelTest = { ok: false, error: err.message }; }
      render();
      break;
    }
    case 'run-stop': if (await ask('Отменить эту задачу?')) await act(() => api(`/api/runs/${id}/stop`, { method: 'POST' }), 'Отменено'); break;
    case 'home-answer': {
      const out = await act(() => api(`/api/projects/${id}/message`, { method: 'POST', body: { prompt: el.dataset.text } }), 'Ответ ушёл в сессию');
      if (out) { S.view = 'sessions'; SEG.sessions = 'chats'; saveSeg(); S.project = Number(id); S.detail = true; localStorage.setItem('mf_view', 'sessions'); instant({ fresh: true }); await refresh(); }
      break;
    }
    case 'delete-task': if (await ask('Удалить задачу?')) await act(() => api(`/api/tasks/${id}`, { method: 'DELETE' }), 'Удалено'); break;
    default: if (MOD_ACTIONS[d.action]) await MOD_ACTIONS[d.action](id, el); break;
  }
});

document.addEventListener('change', (e) => {
  const cp = e.target.dataset.contactProject;
  if (cp) {
    const mode = $(`[data-contact-mode="${CSS.escape(cp)}"].on`)?.dataset.mode || 'ask';
    act(() => api(`/api/contacts/${encodeURIComponent(cp)}`, { method: 'PATCH', body: { mode, project_id: Number(e.target.value) || null } }), 'Сохранено');
  }
});

// Manual expense from the Finance view.
document.addEventListener('submit', async (e) => {
  if (e.target.dataset.form !== 'expense') return;
  e.preventDefault();
  const f = e.target.elements;
  const amount = Number(String(f.amount.value).replace(/\s/g, '').replace(',', '.'));
  if (!amount) return toast('Нужна сумма', true);
  await act(() => api('/api/finance', { method: 'POST', body: { amount, currency: f.currency.value, merchant: f.merchant.value } }), 'Записано');
});

// Quick reminder from the Today view.
document.addEventListener('submit', async (e) => {
  if (e.target.dataset.form !== 'reminder') return;
  e.preventDefault();
  const f = e.target;
  const title = f.elements.title.value.trim();
  if (!title) return;
  const day = f.elements.due.value === 'today' ? 0 : f.elements.due.value === 'tomorrow' ? 1 : null;
  let due;
  if (day !== null) { const d = new Date(Date.now() + day * 86400000); due = `${isoDay(d)}T${day === 0 ? String(Math.min(23, new Date().getHours() + 1)).padStart(2, '0') : '09'}:00:00`; }
  f.elements.title.value = '';
  await act(() => api('/api/reminders', { method: 'POST', body: { title, due } }), 'Напоминание добавлено');
});
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------- attachments in the session chat ----------
function attachChips() {
  const list = S.attach[S.project] || [];
  return list.map((f, i) => `<span class="attach-chip">${f.preview ? `<img src="${f.preview}" alt="">` : icon('note')}<span>${esc(f.name)}</span>${f.path ? '' : '<span class="faint">…</span>'}<button type="button" data-unattach="${i}" aria-label="Убрать">×</button></span>`).join('');
}
const drawAttach = () => { const row = $('#attach-row'); if (row) row.innerHTML = attachChips(); };
async function addFiles(files) {
  const pid = S.project;
  for (const file of files) {
    if (file.size > 20_000_000) { toast(`${file.name}: больше 20 МБ`, true); continue; }
    const item = { name: file.name || 'screenshot.png', preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, path: null };
    (S.attach[pid] ||= []).push(item);
    drawAttach();
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      item.path = (await api('/api/upload', { method: 'POST', body: { name: item.name, data } })).path;
    } catch (err) {
      S.attach[pid] = (S.attach[pid] || []).filter((x) => x !== item);
      toast(`Не загрузилось: ${err.message}`, true);
    }
    drawAttach();
  }
}
document.addEventListener('change', (e) => { if (e.target.dataset?.attachInput !== undefined) { addFiles([...e.target.files]); e.target.value = ''; } });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-unattach]');
  if (b) { (S.attach[S.project] || []).splice(Number(b.dataset.unattach), 1); drawAttach(); }
});
document.addEventListener('paste', (e) => {
  if (!e.target.closest?.('[data-form="send"]')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
});
document.addEventListener('dragover', (e) => { if (e.target.closest?.('.chat')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!e.target.closest?.('.chat')) return;
  e.preventDefault();
  addFiles([...(e.dataTransfer?.files || [])]);
});

document.addEventListener('submit', async (e) => {
  if (e.target.dataset.form !== 'send') return;
  e.preventDefault();
  const ta = e.target.prompt;
  const text = ta.value.trim();
  const files = S.attach[S.project] || [];
  if (files.some((f) => !f.path)) return toast('Файлы ещё загружаются', true);
  if (!text && !files.length) return;
  const prompt = files.length
    ? `${text || 'Посмотри вложение.'}\n\nВложения (открой через Read, это скриншоты или файлы от владельца):\n${files.map((f) => `- ${f.path}`).join('\n')}`
    : text;
  ta.value = '';
  ta.style.height = '';
  const kept = S.attach[S.project];
  S.attach[S.project] = [];
  drawAttach();
  const out = await act(() => api(`/api/projects/${S.project}/message`, { method: 'POST', body: { prompt } }));
  if (!out) { ta.value = text; S.attach[S.project] = kept; drawAttach(); }
});

document.addEventListener('keydown', (e) => {
  if (e.target.name === 'prompt' && e.target.closest('[data-form="send"]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const id = e.target.dataset?.draft || e.target.dataset?.task;
    if (id) { e.preventDefault(); $(`[data-item="${id}"] [data-action="${e.target.dataset.draft ? 'reply' : 'forward'}"]`)?.click(); }
  }
  if (e.key === 'Escape') $('#modal-root').innerHTML = '';
});
document.addEventListener('input', (e) => {
  if (e.target.name === 'prompt' && e.target.closest('[data-form="send"]')) {
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
  }
});

$('#top-stop').addEventListener('click', async () => {
  if (!S.state?.paused) return;
  if (S.state?.paused) return act(() => api('/api/resume', { method: 'POST' }), 'Автоматика включена');
  if (await ask('Остановить все сессии и поставить автоматику на паузу?')) await act(() => api('/api/stop-all', { method: 'POST' }), 'Всё остановлено');
});

if (inTelegram) tg.BackButton.onClick(() => { S.detail = false; render(); });

refresh();
stream();
setInterval(() => { if (!document.hidden) softRefresh(); }, 30000);

// ---------- content studio forms ----------
async function savePostText(id) {
  const ta = $(`[data-post-text="${id}"]`);
  const post = S.data.content?.posts?.find((x) => x.id === Number(id));
  if (ta && post && ta.value !== post.text) { await api(`/api/content/posts/${id}`, { method: 'PATCH', body: { text: ta.value } }); post.text = ta.value; }
}
document.addEventListener('change', (e) => { const id = e.target.dataset?.postText; if (id) savePostText(id).catch((err) => toast(err.message, true)); });
document.addEventListener('input', (e) => { const id = e.target.dataset?.postText; if (id) { const c = $(`[data-count="${id}"]`); if (c) c.textContent = `${e.target.value.length} зн.`; } });
document.addEventListener('submit', async (e) => {
  const form = e.target.dataset.form;
  if (MOD_FORMS[form]) { e.preventDefault(); await MOD_FORMS[form](e.target.elements, e.target); return; }
  if (!['studio', 'idea', 'rival', 'goal'].includes(form)) return;
  e.preventDefault();
  const f = e.target.elements;
  if (form === 'studio') {
    const networks = [...e.target.querySelectorAll('input[name=net]:checked')].map((x) => x.value);
    const topic = f.topic.value.trim();
    S.studioNets = networks; S.studioLink = f.link.checked;
    const ok = await act(() => api('/api/content/generate', { method: 'POST', body: { topic, networks, link: f.link.checked, idea_id: S.studioIdea || null } }), 'Пишу посты, это около минуты');
    if (ok) { S.studioTopic = ''; S.studioIdea = null; f.topic.value = ''; }
  } else if (form === 'idea') {
    if (!f.title.value.trim()) return;
    if (await act(() => api('/api/content/ideas', { method: 'POST', body: { title: f.title.value } }), 'Добавил')) f.title.value = '';
  } else if (form === 'rival') {
    if (await act(() => api('/api/content/competitors', { method: 'POST', body: { username: f.username.value } }), 'Добавил')) { f.username.value = ''; if (S.data.ins) S.data.ins.rivals = null; await refresh(); }
  } else if (form === 'goal') {
    await act(() => api('/api/content/goal', { method: 'POST', body: { target: Number(f.target.value), deadline: f.deadline.value } }), 'Цель сохранена');
  }
});

// Inside the Telegram Mini App a plain link to another site does nothing: open it through
// Telegram (t.me links in the app, everything else in the browser).
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="http"]');
  if (!a || !inTelegram || a.dataset.tgLink) return;
  e.preventDefault();
  const href = a.href;
  if (/^https:\/\/t\.me\//.test(href) && tg.openTelegramLink) tg.openTelegramLink(href);
  else if (tg.openLink) tg.openLink(href);
  else window.open(href, '_blank');
}, true);

// ---------- memory forms ----------
async function runRecall() {
  if (!S.recallQ) { S.recallRes = null; return render(); }
  try { S.recallRes = await api(`/api/recall?q=${encodeURIComponent(S.recallQ)}${S.recallKind ? `&kind=${S.recallKind}` : ''}`); S.recallOpen = null; } catch (e) { toast(e.message, true); }
  render();
}
document.addEventListener('submit', async (e) => {
  const form = e.target.dataset.form;
  if (form === 'recall') { e.preventDefault(); S.recallQ = e.target.elements.q.value.trim(); await runRecall(); }
  if (form === 'mem-edit') {
    e.preventDefault();
    const f = e.target.elements;
    const ok = await act(() => api(`/api/memory/${encodeURIComponent(e.target.dataset.name)}`, { method: 'PUT', body: { title: f.title.value, description: f.description.value, type: f.type.value, body: f.body.value } }), 'Сохранено');
    if (ok) { S.memEdit = null; render(); }
  }
});

// iOS shows :active (the pressed look) only when the page listens to touches.
document.addEventListener('touchstart', () => {}, { passive: true });

// Model settings: switching the provider redraws the form; saving writes .env on the server.
document.addEventListener('change', (e) => {
  if (e.target.dataset?.modelProvider === undefined) return;
  S.modelForm = { provider: e.target.value };
  S.modelTest = null;
  render();
});
document.addEventListener('submit', async (e) => {
  if (e.target.dataset.form !== 'model') return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  const ok = await act(() => api('/api/model', { method: 'POST', body }), 'Сохранено: новые сообщения пойдут через эту модель');
  if (ok) { e.target.querySelectorAll('[data-keep]').forEach((i) => { i.value = ''; delete i.dataset.touched; }); S.modelForm = null; await refresh(); }
});

// Mail and Google forms in «Система».
document.addEventListener('submit', async (e) => {
  const f = e.target.dataset.form;
  const urls = { 'conn-mail': ['/api/connect/mail', 'Почта подключена'], 'conn-google-client': ['/api/connect/google/client', 'Сохранено'], 'conn-google-finish': ['/api/connect/google/finish', 'Google подключён'] };
  if (!urls[f]) return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  const out = await act(() => api(urls[f][0], { method: 'POST', body }), urls[f][1]);
  if (out) { e.target.querySelectorAll('[data-keep]').forEach((i) => { i.value = ''; delete i.dataset.touched; }); S.conn = out; if (f === 'conn-google-finish') S.googleUrl = null; render(); }
});

// Typed values in kept fields survive the live redraws.
document.addEventListener('input', (e) => { if (e.target.dataset?.keep) e.target.dataset.touched = '1'; });
