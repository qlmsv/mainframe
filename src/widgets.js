// Telegram HTML widgets (Bot API 10.4): live mini-screens inside message bubbles, private chat only.
// A widget is one HTML document run by the app (no network); its state is chat_data (≤1024 bytes),
// and it can ask the bot for fresh data with TelegramWidget.request() → update widget_query,
// answered by answerWidgetQuery (≤1024 bytes). Every widget also gets a text caption for old apps.
import net from 'node:net';
import { LOCAL_OFFSET, config } from './config.js';
import { all, get, kvGet, kvSet, addLog } from './db.js';
import { financeSummary, rates } from './finance.js';
import { agenda } from './apple.js';
import { activeRuns } from './agent.js';
import { moduleWidgets, modules } from './modules.js';

// ---------- shared look ----------
const CSS = `:root{--t:#111;--m:#8a8f98;--c:rgba(127,127,127,.12);--a:#ff7a45;--g:#21a366;--r:#e5484d}
@media(prefers-color-scheme:dark){:root{--t:#f2f3f5;--m:#9aa0aa;--c:rgba(255,255,255,.08)}}
body{margin:0;font:14px/1.35 -apple-system,system-ui,sans-serif;color:var(--t)}
.w{padding:12px 14px}.m{color:var(--m);font-size:12px}.b{font-weight:650}.g{color:var(--g)}.r{color:var(--r)}
.row{display:flex;align-items:center;gap:8px}.sp{flex:1}.big{font-size:24px;font-weight:750;letter-spacing:-.02em}
.tile{background:var(--c);border-radius:10px;padding:7px 9px;flex:1;min-width:0}.tile b{display:block;font-size:15px;line-height:20px;white-space:nowrap}
.tile .m,.nw{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{height:6px;border-radius:4px;background:var(--c);overflow:hidden;flex:1}.bar i{display:block;height:100%;background:var(--a);border-radius:4px;transition:width .8s}
.btn{border:0;border-radius:9px;padding:7px 10px;background:var(--c);color:var(--t);font:600 13px system-ui}
.l{padding:5px 0;border-top:1px solid var(--c)}.l:first-child{border-top:0}
.fade{animation:f .4s ease both}@keyframes f{from{opacity:0;transform:translateY(4px)}}`;


// The assistant's face (same drop as public/spark.js), for widgets: plain SVG, state by class.
const SPARK_CSS = `.spk{flex:none;overflow:visible}.spk *{transform-box:fill-box;transform-origin:center}
.spk .bz{transform-box:view-box;transform-origin:50% 88%;animation:sb 3.4s ease-in-out infinite}@keyframes sb{50%{transform:scale(1.03,.98)}}
.spk .gl{animation:sg 3.4s ease-in-out infinite}@keyframes sg{50%{opacity:.55;transform:scale(1.06)}}
.spk .fx,.spk .hp{opacity:0;transition:opacity .3s}.spk .ey{transition:opacity .2s}
.spk.thinking .ft,.spk.working .fw,.spk.done .hp,.spk.done .fd,.spk.waiting .fr,.spk.error .fe{opacity:1}.spk.done .ey{opacity:0}
.spk .ft circle{animation:sd 1.1s infinite}.spk .ft circle:nth-child(2){animation-delay:.15s}.spk .ft circle:nth-child(3){animation-delay:.3s}@keyframes sd{50%{transform:translateY(-3px);opacity:.35}}
.spk .ob{transform-box:view-box;transform-origin:50px 58px;animation:so 2.2s linear infinite}@keyframes so{to{transform:rotate(360deg)}}
.spk.working .bz{animation:sw .9s ease-in-out infinite}@keyframes sw{50%{transform:translateY(-2px) rotate(-2deg)}}
.spk.error .cr{filter:saturate(.35)}.spk.error .bz{transform:rotate(-8deg);animation:none}
.spk .rg{animation:sr 1.6s ease-out infinite}@keyframes sr{0%{transform:scale(.7);opacity:.7}100%{transform:scale(1.35);opacity:0}}
.spk .ey ellipse{animation:bl 4.5s infinite}@keyframes bl{0%,96%,100%{transform:scaleY(1)}98%{transform:scaleY(.12)}}`;
const SPARK = (size, id = 'spk') => `<svg id="${id}" class="spk" width="${size}" height="${size}" viewBox="0 0 100 100"><defs><radialGradient id="${id}a" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff6ee"/><stop offset=".45" stop-color="#fbe6da"/><stop offset="1" stop-color="#e2602b"/></radialGradient><radialGradient id="${id}b"><stop offset=".55" stop-color="#e2602b" stop-opacity=".35"/><stop offset="1" stop-color="#e2602b" stop-opacity="0"/></radialGradient></defs>
<circle class="gl" cx="50" cy="56" r="44" fill="url(#${id}b)"/><circle class="fx fr rg" cx="50" cy="58" r="30" fill="none" stroke="#e2602b" stroke-width="3"/>
<g class="bz"><path class="cr" d="M50 20q22 22 22 38a22 22 0 0 1-44 0q0-16 22-38z" fill="url(#${id}a)"/><path d="M38 50q2-8 8-12" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/>
<g class="ey"><ellipse cx="43" cy="60" rx="3.8" ry="5.2" fill="#141414"/><ellipse cx="57" cy="60" rx="3.8" ry="5.2" fill="#141414"/></g>
<g class="hp" stroke="#141414" stroke-width="3.2" stroke-linecap="round" fill="none"><path d="M38.5 62q4.5-6 9 0"/><path d="M52.5 62q4.5-6 9 0"/></g>
<path d="M47 69q3 2.5 6 0" stroke="#141414" stroke-width="2.2" stroke-linecap="round" fill="none"/></g>
<g class="fx ft" fill="#8a8f98"><circle cx="68" cy="22" r="3.2"/><circle cx="76" cy="22" r="3.2"/><circle cx="84" cy="22" r="3.2"/></g>
<g class="fx fw"><g class="ob"><circle cx="50" cy="20" r="3.6" fill="#e2602b"/><circle cx="83" cy="66" r="3" fill="#21a366"/><circle cx="18" cy="70" r="2.6" fill="#e2602b"/></g></g>
<g class="fx fd" fill="#e2602b"><path d="M14 26l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M86 22l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z"/></g>
<text class="fx fe" x="70" y="30" font-family="system-ui" font-weight="800" font-size="22" fill="#e2602b">?</text></svg>`;

// Live data: render(d) draws; on open and every `every` seconds the widget asks the bot for kind.
export const page = (body, render, kind, every) => `<!doctype html><html><head><style>${CSS}${SPARK_CSS}</style></head><body><div class="w" id="w">${body}</div><script>
const W=TelegramWidget;let D={};try{D=JSON.parse(W.chatData||'{}')}catch(e){}
${render}
function fitTiles(){document.querySelectorAll('.tile b').forEach(b=>{let f=15;b.style.fontSize='';while(b.scrollWidth>b.clientWidth+1&&f>10){f-=.5;b.style.fontSize=f+'px'}})}
function draw(){try{render(D);fitTiles()}catch(e){document.getElementById('w').textContent='…'}}
addEventListener('resize',fitTiles);
${kind ? `function pull(){W.request('${kind}').then(a=>{if(a&&a.result){D=JSON.parse(a.result);draw()}},()=>{})}
W.onEvent('activated',pull);setInterval(()=>{if(W.isActive)pull()},${every * 1000});` : ''}
W.onEvent('chatDataChanged',()=>{try{D=JSON.parse(W.chatData||'{}')}catch(e){}draw()});
draw();W.ready&&W.ready();
</script></body></html>`;

// Sums in the owner's main currency (CURRENCY in .env).
const SIGN = { RUB: '₽', USD: '$', EUR: '€', KZT: '₸', GBP: '£', UAH: '₴', TRY: '₺' };
export const rub = (n) => `${Math.round(n).toLocaleString('ru')} ${SIGN[config.currency] || config.currency}`;
export const cut = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));
export const fit = (obj) => { let s = JSON.stringify(obj); while (Buffer.byteLength(s) > 1000 && s.length > 50) { obj = shrink(obj); s = JSON.stringify(obj); } return s; };
function shrink(o) { for (const k of Object.keys(o)) if (Array.isArray(o[k]) && o[k].length > 1) { o[k] = o[k].slice(0, -1); return o; } return o; }

// ---------- 1. «Работаю…» while a session runs ----------
export const PROGRESS = page(`<div class="row">${SPARK(40)}
<div class="sp"><div class="b" id="what"></div><div class="m" id="sub"></div></div><div class="big" id="clock" style="font-size:18px"></div></div>
<div class="m fade" id="last" style="margin-top:6px"></div>`,
`function render(d){const e=document.getElementById.bind(document);e('spk').setAttribute('class','spk '+(d.n?'working':'thinking'));e('what').textContent=d.w||'Думаю';
e('sub').textContent=(d.p?d.p+' · ':'')+(d.n?'шаг '+d.n:'начинаю');const l=e('last');if(l.textContent!==(d.l||'')){l.textContent=d.l||'';l.classList.remove('fade');void l.offsetWidth;l.classList.add('fade')}}
setInterval(()=>{const s=Math.max(0,Math.floor((Date.now()-(D.t0||Date.now()))/1000));document.getElementById('clock').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0')},1000);`, null, 0);

// ---------- 2. Card of the day ----------
const DAY = page('', `function render(d){const w=document.getElementById('w');w.innerHTML='<div class="row"><div class="sp"><div class="m">'+(d.dt||'')+'</div><div class="big">☀️ '+(d.h||'Сегодня')+'</div></div><button class="btn" onclick="pull()">↻</button></div>'
+'<div class="row" style="margin:8px 0">'+[['Встреч',d.ne],['Ждут ответа',d.wi],['Вчера',d.sp]].map(x=>'<div class="tile"><span class="m">'+x[0]+'</span><b>'+(x[1]??'·')+'</b></div>').join('')+'</div>'
+(d.ev||[]).map(e=>'<div class="l fade"><span class="b">'+e[0]+'</span> '+e[1]+'</div>').join('')
+((d.rm||[]).length?'<div class="m" style="margin-top:6px">Напоминания</div>'+d.rm.map(r=>'<div class="l">⚪️ '+r+'</div>').join(''):'')
+(d.x||[]).map(x=>'<div class="m" style="margin-top:6px">'+x+'</div>').join('')
}`, 'day', 300);

export async function dayData() {
  const d = new Date(Date.now() + LOCAL_OFFSET());
  const dt = d.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  let ev = [], rm = [], ne = 0;
  try {
    const a = await agenda();
    const today = new Date().toDateString();
    const evs = a.events.filter((e) => e.start && new Date(e.start).toDateString() === today);
    ne = evs.length;
    ev = evs.slice(0, 5).map((e) => [e.time || 'весь день', cut(e.title, 34)]);
    rm = a.reminders.slice(0, 4).map((r) => cut(r.title, 34));
  } catch { /* the Mac is off: no calendar */ }
  const wi = get("SELECT COUNT(*) n FROM inbox WHERE status IN ('new','routed')").n;
  let sp = '·';
  try {
    const r = (await rates()).base; const y0 = new Date(); y0.setHours(0, 0, 0, 0);
    const rows = all("SELECT currency, SUM(amount) t FROM expenses WHERE at >= ? AND at < ? AND COALESCE(direction,'out')='out' AND COALESCE(category,'')!='обмен' GROUP BY currency", y0.getTime() - 86400000, y0.getTime());
    sp = rub(rows.reduce((a, x) => a + (r[x.currency] ? x.t * r[x.currency] : 0), 0));
  } catch { /* no rates */ }
  // One-line extras from optional modules (dayLine), e.g. new leads.
  const x = modules.map((m) => { try { return m.dayLine?.() || null; } catch { return null; } }).filter(Boolean).map((t) => cut(t, 60));
  return fit({ dt, h: 'Доброе утро', ne, wi, sp, ev, rm, x });
}

// ---------- 3. Money ----------
const MONEY = page('', `function render(d){const w=document.getElementById('w');const mx=Math.max(1,...(d.c||[]).map(c=>c[1]));w.innerHTML='<div class="m">Всего на счетах</div><div class="big">'+(d.tot||'·')+'</div>'
+'<div class="row" style="margin:8px 0">'+[['Сегодня',d.td],['7 дней',d.wk],['Месяц',d.mo]].map(x=>'<div class="tile"><span class="m">'+x[0]+'</span><b>'+(x[1]||'0')+'</b></div>').join('')+'</div>'
+(d.c||[]).map(c=>'<div class="row l"><span class="nw" style="width:112px;flex:none">'+c[0]+'</span><span class="bar"><i style="width:'+Math.max(4,c[1]/mx*100)+'%"></i></span><span class="m" style="width:80px;flex:none;text-align:right;white-space:nowrap">'+c[2]+'</span></div>').join('')}`, 'money', 120);

export async function moneyData() {
  const f = financeSummary(); const r = (await rates()).base;
  const toRub = (rows) => rows.reduce((a, x) => a + (r[x.currency] ? x.total * r[x.currency] : 0), 0);
  const tot = f.balances.reduce((a, b) => a + (r[b.currency] ? b.amount * r[b.currency] : 0), 0);
  const cats = {};
  for (const c of f.categories) { const k = c.category || 'прочее'; cats[k] = (cats[k] || 0) + (r[c.currency] ? c.total * r[c.currency] : 0); }
  const c = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [cut(k, 14), Math.round(v), rub(v)]);
  return fit({ tot: f.balances.length ? `≈ ${rub(tot)}` : '·', td: rub(toRub(f.today)), wk: rub(toRub(f.week)), mo: rub(toRub(f.month)), c });
}

// ---------- 5. «Мейнфрейм сейчас» board ----------
const BOARD = page('', `const SPK=${JSON.stringify(SPARK(30))};function render(d){const w=document.getElementById('w');const dot=(ok,t)=>'<span class="tile" style="flex:none;padding:4px 8px">'+(ok?'🟢':'🔴')+' '+t+'</span>';w.innerHTML='<div class="row">'+SPK.replace('class="spk"','class="spk '+(d.r?'working':d.i?'waiting':'')+'"')+'<div class="sp b">Мейнфрейм сейчас</div><span class="m">'+(d.tm||'')+'</span></div>'
+'<div class="row" style="margin:8px 0">'+[['В работе',d.r],['Ждут тебя',d.i],['За сегодня',d.d]].map(x=>'<div class="tile"><span class="m">'+x[0]+'</span><b>'+(x[1]??0)+'</b></div>').join('')+'</div>'
+(d.n||[]).map(x=>'<div class="l fade">⚙️ '+x+'</div>').join('')
+'<div class="row" style="flex-wrap:wrap;margin-top:6px">'+dot(d.mac,'Mac')+dot(d.tg,'Telegram')+dot(d.cl,'Claude')+'</div>'}`, 'board', 15);

const portUp = (port) => new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port }); s.setTimeout(1500, () => { s.destroy(); res(false); }); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
export async function boardData() {
  const ids = activeRuns();
  const n = ids.map((id) => get('SELECT r.prompt, p.name FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.id=?', id)).filter(Boolean)
    .slice(0, 3).map((r) => cut(`${r.name}: ${String(r.prompt).replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ')}`, 60));
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  return fit({
    tm: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
    r: ids.length, i: get("SELECT COUNT(*) n FROM inbox WHERE status IN ('new','routed')").n,
    d: get('SELECT COUNT(*) n FROM runs WHERE started_at >= ?', d0.getTime()).n, n,
    mac: await portUp(2222), tg: true, cl: !kvGet('auth_error', null),
  });
}

// ---------- sending and answering ----------
const KINDS = {
  day: { html: DAY, data: dayData, caption: '☀️ Карточка дня', h: 0 },
  money: { html: MONEY, data: moneyData, caption: '💳 Деньги', h: 0 },
  board: { html: BOARD, data: boardData, caption: '🧠 Мейнфрейм сейчас', h: 0 },
};

export const _html = { DAY, MONEY, BOARD };
// Built-in widgets plus the ones optional modules bring (/kind commands in the bot).
const kinds = () => ({ ...KINDS, ...moduleWidgets() });
export const widgetKinds = () => Object.entries(kinds()).map(([kind, k]) => ({ kind, description: k.description || k.caption }));
let api = null; // grammy bot.api, set by the bot
export const setWidgetApi = (a) => { api = a; };

export async function sendWidget(chatId, kind) {
  const k = kinds()[kind];
  const data = await k.data().catch(() => '{}');
  const m = await api.raw.sendWidget({ chat_id: chatId, html: k.html, chat_data: data, caption: k.caption, allow_queries: true, disable_notification: true });
  return m;
}

export async function answerQuery(q, isOwner) {
  const k = kinds()[String(q.data || '').split(':')[0]];
  if (!isOwner || !k) return api.raw.answerWidgetQuery({ widget_query_id: q.id }).catch(() => {});
  const data = await k.data().catch((e) => { addLog('error', `Виджет ${q.data}: ${e.message.slice(0, 120)}`); return null; });
  return api.raw.answerWidgetQuery({ widget_query_id: q.id, ...(data ? { data } : {}) }).catch(() => {});
}

// The live status of a run: a widget with its own clock, edited only when the step changes.
export async function sendProgress(chatId, state) {
  const m = await api.raw.sendWidget({ chat_id: chatId, html: PROGRESS, chat_data: JSON.stringify(state), caption: `${state.e} ${state.w}…`, height: 84, disable_notification: true });
  return m.message_id;
}
export const editProgress = (chatId, msgId, state) => api.raw.editMessageWidgetData({ chat_id: chatId, message_id: msgId, chat_data: JSON.stringify(state) });

// The card of the day comes by itself at 8:00 local time, unless a morning digest task does the
// morning (kv digest_tasks.morning): then it is only on /day.
export function startDayCard(ownerId) {
  setInterval(async () => {
    const d = new Date(Date.now() + LOCAL_OFFSET());
    const key = d.toISOString().slice(0, 10);
    if (d.getUTCHours() !== 8 || kvGet('widget_day_sent', '') === key || !ownerId() || kvGet('digest_tasks', {}).morning) return;
    kvSet('widget_day_sent', key);
    await sendWidget(Number(ownerId()), 'day').catch((e) => addLog('error', `Карточка дня: ${e.message.slice(0, 120)}`));
  }, 60000).unref();
}
