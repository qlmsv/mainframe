// Telegram HTML widgets (Bot API 10.4): live mini-screens inside message bubbles, private chat only.
// A widget is one HTML document run by the app (no network); its state is chat_data (≤1024 bytes),
// and it can ask the bot for fresh data with TelegramWidget.request() → update widget_query,
// answered by answerWidgetQuery (≤1024 bytes). Every widget also gets a text caption for old apps.
import net from 'node:net';
import { LOCAL_OFFSET, config } from './config.js';
import { topTodos, listTodos, doneTodo, updateTodo, todoCounts } from './todos.js';
import { all, get, kvGet, kvSet, addLog } from './db.js';
import { financeSummary, rates } from './finance.js';
import { agenda } from './apple.js';
import { activeRuns, stopAll } from './agent.js';
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


// The assistant's face (the Некит cat of public/spark.js), for widgets: plain SVG, state by class.
const SPARK_CSS = `.spk{flex:none;overflow:visible}.spk *{transform-box:fill-box;transform-origin:center}
.spk .all,.spk .hpos{transform-box:view-box;transform-origin:0 0}.spk .hpos{transform:translate(50px,44px) scale(.84) translate(-50px,-50px)}
.spk[data-xs] .bodyg,.spk[data-xs] .dt,.spk[data-xs] .fd{display:none}.spk[data-xs] .hpos{transform:translate(50px,54px) scale(1.12) translate(-50px,-50px)}
.spk .gl{animation:sg 3.4s ease-in-out infinite}@keyframes sg{50%{opacity:.55;transform:scale(1.06)}}
.spk .torso{animation:sb 3.4s ease-in-out infinite}@keyframes sb{50%{transform:scale(1.04,.97)}}
.spk .tail{transform-origin:10% 80%;animation:sy 3s ease-in-out infinite}@keyframes sy{50%{transform:rotate(-14deg)}}
.spk .ear.el{transform-origin:85% 90%}.spk .ear.er{transform-origin:15% 90%}.spk .eh,.spk .ee{opacity:0}.spk .blush{opacity:.4}
.spk .eo{animation:sk 4s linear infinite}@keyframes sk{0%,90%,96%,100%{transform:scaleY(1)}93%{transform:scaleY(.12)}}
.spk .fx{opacity:0;transition:opacity .3s}
.spk.thinking .ft,.spk.working .fw,.spk.done .fd,.spk.error .fe{opacity:1}
.spk .dt circle{animation:sd 1.1s infinite}.spk .dt circle:nth-child(2){animation-delay:.15s}.spk .dt circle:nth-child(3){animation-delay:.3s}@keyframes sd{50%{transform:translateY(-3px);opacity:.35}}
.spk.thinking .look{transform:translate(2px,-3px)}.spk.thinking .head{transform:rotate(-6deg)}.spk.thinking .pr{opacity:0}
.spk.working .look{transform:translateY(2.5px)}.spk.working .pl{animation:sw .36s ease-in-out infinite}.spk.working .pr{animation:sw .36s ease-in-out -.18s infinite}@keyframes sw{50%{transform:translateY(-4px)}}
.spk.done .eo{opacity:0}.spk.done .eh{opacity:1}.spk.done .all{animation:sp 1s cubic-bezier(.3,.7,.3,1) 2}@keyframes sp{35%{transform:translateY(-7px)}}.spk.done .tail{animation-duration:.5s}
.spk.error .ear.el{transform:rotate(-42deg)}.spk.error .ear.er{transform:rotate(42deg)}.spk.error .eo{opacity:0}.spk.error .ee{opacity:1}.spk.error .blush{opacity:.85}.spk.error .tail{animation:none;transform:rotate(30deg)}
.spk.waiting .head{transform:rotate(8deg)}.spk.waiting .eo{animation:sl 3s ease-in-out infinite}@keyframes sl{0%,60%,100%{transform:scaleY(1)}70%,78%{transform:scaleY(.12)}}`;
const SPARK = (size, id = 'spk') => `<svg id="${id}" class="spk"${size < 34 ? ' data-xs' : ''} width="${size}" height="${size}" viewBox="0 0 100 100"><defs><radialGradient id="${id}b"><stop offset="0" stop-color="#e2602b" stop-opacity=".5"/><stop offset=".55" stop-color="#e2602b" stop-opacity=".14"/><stop offset="1" stop-color="#e2602b" stop-opacity="0"/></radialGradient><radialGradient id="${id}a" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#ffc79c"/><stop offset=".55" stop-color="#f39256"/><stop offset="1" stop-color="#d9602a"/></radialGradient></defs>
<circle class="gl" cx="50" cy="52" r="46" fill="url(#${id}b)"/>
<g class="all">
<g class="bodyg">
<path class="tail" d="M64 90C80 95 90 86 87 72C86 67 82 65 80 67" fill="none" stroke="url(#${id}a)" stroke-width="7" stroke-linecap="round"/>
<ellipse class="torso" cx="50" cy="83" rx="20" ry="14" fill="url(#${id}a)"/>
<ellipse cx="50" cy="87" rx="10" ry="8.5" fill="#fff1e6"/>
<g class="fx fw"><rect x="27" y="92" width="46" height="7" rx="2.5" fill="#3a3d44"/><path d="M32 95.5h4M39 95.5h4M46 95.5h8M57 95.5h4M64 95.5h4" stroke="#6b6f78" stroke-width="1.6" stroke-linecap="round"/></g>
<ellipse class="paw pl" cx="41" cy="94" rx="6" ry="4.2" fill="#ffe0c8"/>
<ellipse class="paw pr" cx="59" cy="94" rx="6" ry="4.2" fill="#ffe0c8"/>
</g>
<g class="hpos"><g class="head">
<g class="ear el"><path d="M21 44Q18 22 24 12Q27 9 31 12L47 27Z" fill="url(#${id}a)"/><path d="M27 35Q26 24 28 18L39 28Z" fill="#ffb4a2"/></g>
<g class="ear er"><path d="M79 44Q82 22 76 12Q73 9 69 12L53 27Z" fill="url(#${id}a)"/><path d="M73 35Q74 24 72 18L61 28Z" fill="#ffb4a2"/></g>
<ellipse class="face" cx="50" cy="52" rx="32" ry="27" fill="url(#${id}a)"/>
<path d="M50 26v7M43 27l1.6 5.6M57 27l-1.6 5.6" stroke="#c4541f" stroke-width="2.6" stroke-linecap="round"/>
<ellipse cx="50" cy="65" rx="12.5" ry="8.5" fill="#fff1e6"/>
<g class="blush"><ellipse cx="31" cy="62" rx="4.5" ry="2.6" fill="#ff6f6f"/><ellipse cx="69" cy="62" rx="4.5" ry="2.6" fill="#ff6f6f"/></g>
<g class="eyes eo"><g class="look"><ellipse cx="38.5" cy="52" rx="5" ry="6.4" fill="#1b1410"/><ellipse cx="61.5" cy="52" rx="5" ry="6.4" fill="#1b1410"/><circle cx="40.3" cy="49.6" r="1.9" fill="#fff"/><circle cx="63.3" cy="49.6" r="1.9" fill="#fff"/></g></g>
<path class="eyes eh" d="M33 54Q38.5 46 44 54M56 54Q61.5 46 67 54" fill="none" stroke="#1b1410" stroke-width="3.2" stroke-linecap="round"/>
<path class="eyes ee" d="M33.5 53Q38.5 57 43.5 53M56.5 53Q61.5 57 66.5 53" fill="none" stroke="#1b1410" stroke-width="3" stroke-linecap="round"/>
<path d="M46.6 60.5h6.8q.6 0 .2.6l-3 3.2q-.6.6-1.2 0l-3-3.2q-.4-.6.2-.6z" fill="#ff7d86"/>
<path class="mouth" d="M44.5 66q2.7 3 5.5.2q2.8 2.8 5.5-.2" stroke="#1b1410" stroke-width="1.8" stroke-linecap="round" fill="none"/>
<path d="M28 60 13 57M28 65 13 66M72 60 87 57M72 65 87 66" stroke="#fff1e6" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>
<path class="fx fe" d="M80 30q-4 6 0 8q4-2 0-8z" fill="#8fd3ff"/>
</g></g>
<ellipse class="fx ft" cx="62" cy="73" rx="6" ry="4.6" fill="#ffe0c8"/>
</g>
<g class="fx ft dt" fill="#f6a77c"><circle cx="76" cy="12" r="3.2"/><circle cx="85" cy="12" r="3.2"/><circle cx="94" cy="12" r="3.2"/></g>
<g class="fx fd"><path class="s" d="M10 14 l2.2 5.5 5.5 2.2 -5.5 2.2 -2.2 5.5 -2.2 -5.5 -5.5 -2.2 5.5 -2.2z" fill="#ffb020"/><path class="s" d="M90 10 l1.8 4.5 4.5 1.8 -4.5 1.8 -1.8 4.5 -1.8 -4.5 -4.5 -1.8 4.5 -1.8z" fill="#1f9d55"/><path class="s" d="M92 78 l1.5 3.8 3.8 1.5 -3.8 1.5 -1.5 3.8 -1.5 -3.8 -3.8 -1.5 3.8 -1.5z" fill="#f6a77c"/></g></svg>`;

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
`function render(d){const e=document.getElementById.bind(document);e('spk').setAttribute('class','spk '+(d.s||(d.n?'working':'thinking')));e('what').textContent=d.s==='error'?'Споткнулась, пробую иначе':d.s==='waiting'?'Жду тебя':(d.w||'Думаю');
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
const BOARD = page('', `const SPK=${JSON.stringify(SPARK(30))};function render(d){const w=document.getElementById('w');const dot=(ok,t)=>'<span class="tile" style="flex:none;padding:4px 8px">'+(ok?'🟢':'🔴')+' '+t+'</span>';w.innerHTML='<div class="row">'+SPK.replace('class="spk"','class="spk '+(d.r?'working':d.i?'waiting':'')+'"')+'<div class="sp b">${config.assistantName.replace(/['\\<]/g, '')} сейчас</div><span class="m">'+(d.tm||'')+'</span></div>'
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

// ---------- 6. «Сегодня»: встречи, кто ждёт ответа, дела ----------
const NAME = config.assistantName.replace(/['\\<"]/g, '');
const TODAY = page('', `const SPK=${JSON.stringify(SPARK(34, 'st'))};const L=(t,a)=>a&&a.length?'<div class="m" style="margin-top:8px">'+t+'</div>'+a.map(x=>'<div class="l fade nw">'+x+'</div>').join(''):'';
function render(d){const w=document.getElementById('w');w.innerHTML='<div class="row">'+SPK.replace('class="spk"','class="spk '+((d.ne||0)+(d.wi||0)?'working':'done')+'"')+'<div class="sp"><div class="m">'+(d.dt||'')+'</div><div class="b">'+(d.h||'Сегодня')+'</div></div><button class="btn" onclick="pull()">↻</button></div>'
+'<div class="row" style="margin:8px 0">'+[['Встречи',d.ne],['Ждут ответа',d.wi],['Дела',(d.rm||[]).length]].map(x=>'<div class="tile"><span class="m">'+x[0]+'</span><b>'+(x[1]??0)+'</b></div>').join('')+'</div>'
+L('Встречи',(d.ev||[]).map(e=>'<span class="b">'+e[0]+'</span> '+e[1]))+L('Ждут ответа',(d.wn||[]).map(x=>'💬 '+x))+L('Дела',(d.rm||[]).map(x=>'⚪️ '+x))
+(d.x||[]).map(x=>'<div class="m" style="margin-top:6px">'+x+'</div>').join('')+(!(d.ne||d.wi||(d.rm||[]).length)?'<div class="m" style="margin-top:6px">Свободный день. Можно выдохнуть 🌿</div>':'')}`, 'today', 300);

const waitingRows = () => all("SELECT name, username, text FROM inbox WHERE status IN ('new','routed') ORDER BY id DESC LIMIT 4");
export async function todayData() {
  const d = new Date(Date.now() + LOCAL_OFFSET());
  const dt = d.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const hr = d.getUTCHours();
  let ev = [], rm = [], ne = 0;
  try {
    const a = await agenda();
    const today = new Date().toDateString();
    const evs = a.events.filter((e) => e.start && new Date(e.start).toDateString() === today);
    ne = evs.length;
    ev = evs.slice(0, 4).map((e) => [e.time || 'весь день', cut(e.title, 30)]);
    rm = a.reminders.slice(0, 4).map((r) => cut(r.title, 34));
  } catch { /* the Mac is off: no calendar */ }
  // «Дела»: the owner's tasks for today (src/todos.js) first, then reminders from the Mac.
  const td = topTodos(6);
  rm = [...td.map((t) => cut(t.title, 34)), ...rm].slice(0, 6);
  const wi = get("SELECT COUNT(*) n FROM inbox WHERE status IN ('new','routed')").n;
  const wn = waitingRows().slice(0, 3).map((r) => cut(r.name || r.username || 'кто-то', 18) + ': ' + cut(String(r.text || '').replace(/\s+/g, ' '), 26));
  const x = modules.map((m) => { try { return m.dayLine?.() || null; } catch { return null; } }).filter(Boolean).map((t) => cut(t, 60));
  return fit({ dt, h: hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер', ne, wi, ev, wn, rm, x });
}

// ---------- 7. «В работе»: что Некит делает сейчас, с кнопкой «Стоп» ----------
const WORK = page('', `const SPK=${JSON.stringify(SPARK(44, 'sw'))};function render(d){const w=document.getElementById('w');const n=(d.r||[]).length;w.innerHTML='<div class="row">'+SPK.replace('class="spk"','class="spk '+(d.st?'waiting':n?'working':'done')+'"')+'<div class="sp"><div class="b">'+(d.st?'${NAME} на паузе':n?'${NAME} работает':'${NAME} отдыхает')+'</div><div class="m">'+(n?'дел сейчас: '+n:'новых дел нет')+(d.q?' · в очереди '+d.q:'')+'</div></div><span class="m">'+(d.tm||'')+'</span></div>'
+'<div class="row" style="margin:8px 0">'+[['Сейчас',n],['Ждут тебя',d.i],['Сделано',d.d]].map(x=>'<div class="tile"><span class="m">'+x[0]+'</span><b>'+(x[1]??0)+'</b></div>').join('')+'</div>'
+(d.r||[]).map(r=>'<div class="row l fade"><span>'+(r[2]?'⏰':'⚙️')+'</span><span class="sp nw">'+r[0]+'</span><span class="m">'+r[1]+' мин</span></div>').join('')
+'<div class="row" style="margin-top:8px"><span class="m sp">'+(d.mac?'🟢':'🔴')+' Mac '+(d.cl?'🟢':'🔴')+' Claude</span>'+(n&&!d.st?'<button class="btn r" onclick="stop(this)">⏹ Стоп</button>':'')+'</div>'}
function stop(b){b.disabled=true;b.textContent='Останавливаю…';W.request('work:stop').then(a=>{if(a&&a.result){D=JSON.parse(a.result);draw()}W.HapticFeedback&&W.HapticFeedback.notificationOccurred('success')},()=>{b.disabled=false;b.textContent='⏹ Стоп'})}`, 'work', 10);

export async function workData() {
  const ids = activeRuns();
  const r = ids.map((id) => get('SELECT r.prompt, r.origin, r.started_at, p.name FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.id=?', id)).filter(Boolean)
    .slice(0, 4).map((x) => [cut(`${x.name}: ${String(x.prompt).replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ')}`, 44), Math.max(0, Math.round((Date.now() - (x.started_at || Date.now())) / 60000)), x.origin === 'cron' ? 1 : 0]);
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  return fit({
    tm: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }), r,
    q: get("SELECT COUNT(*) n FROM runs WHERE status='queued'").n,
    i: get("SELECT COUNT(*) n FROM inbox WHERE status IN ('new','routed')").n,
    d: get("SELECT COUNT(*) n FROM runs WHERE started_at >= ? AND status='done'", d0.getTime()).n,
    st: kvGet('paused', false) ? 1 : 0, mac: await portUp(2222), cl: !kvGet('auth_error', null),
  });
}

// ---------- 8. Рулетка «Что сделать первым» ----------
const SPIN = page('', `const C=['#ff7a45','#21a366','#4c8dff','#e5484d','#f5b301','#9b6bff','#14b8a6','#ec4899'];const SPK=${JSON.stringify(SPARK(36, 'sr'))};let A=0,P=-1;
function render(d){const w=document.getElementById('w');const t=d.t||[];const n=t.length;if(!n){w.innerHTML='<div class="row">'+SPK.replace('class="spk"','class="spk done"')+'<div class="b sp">На сегодня дел нет. Отдыхай!</div></div>';return}
const s=360/n;w.innerHTML='<div class="row">'+SPK.replace('class="spk"','class="spk thinking" ')+'<div class="sp"><div class="b">Что сделать первым?</div><div class="m">Крути, ${NAME} выберет</div></div></div>'
+'<div class="row" style="margin:10px 0;justify-content:center"><div style="position:relative;width:170px;height:170px"><div style="position:absolute;left:77px;top:-6px;z-index:2;font-size:18px">▼</div><div id="wh" style="width:170px;height:170px;border-radius:50%;background:conic-gradient('+t.map((x,i)=>C[i%8]+' '+i*s+'deg '+(i+1)*s+'deg').join(',')+');transition:transform 3s cubic-bezier(.2,.8,.1,1);transform:rotate('+A+'deg)">'
+t.map((x,i)=>'<b style="position:absolute;left:78px;top:6px;width:14px;text-align:center;color:#fff;transform-origin:7px 79px;transform:rotate('+(i*s+s/2)+'deg)">'+(i+1)+'</b>').join('')+'</div></div></div>'
+'<div id="res" class="b" style="text-align:center;min-height:20px">'+(P>=0?'👉 '+t[P]:'')+'</div>'
+t.map((x,i)=>'<div class="l nw" style="'+(i===P?'font-weight:700':'')+'"><span style="color:'+C[i%8]+'">●</span> '+(i+1)+'. '+x+'</div>').join('')
+'<div class="row" style="margin-top:8px"><button class="btn sp" id="go" onclick="spin()">🎡 Крутить!</button><button class="btn" onclick="pull()">↻</button></div>'}
function spin(){const t=D.t||[];if(!t.length)return;const n=t.length,s=360/n;const k=Math.floor(Math.random()*n);A+=1440+(360-(k*s+s/2))-(A%360);P=-1;draw();document.getElementById('go').disabled=true;
requestAnimationFrame(()=>{document.getElementById('wh').style.transform='rotate('+A+'deg)'});setTimeout(()=>{P=k;draw();W.HapticFeedback&&W.HapticFeedback.notificationOccurred('success')},3100)}`, 'spin', 600);

export async function spinData() {
  // Today's tasks first, then the rest of the open ones, reminders, people waiting for an answer.
  const t = topTodos(8).map((x) => cut(x.title, 26));
  for (const x of listTodos()) if (t.length < 6 && x.status !== 'waiting' && !t.includes(cut(x.title, 26))) t.push(cut(x.title, 26));
  try { (await agenda()).reminders.slice(0, 6).forEach((r) => t.push(cut(r.title, 26))); } catch { /* no Mac */ }
  for (const r of waitingRows()) if (t.length < 8) t.push(cut(`Ответить: ${r.name || r.username || 'кто-то'}`, 26));
  return fit({ t: t.slice(0, 8) });
}

// ---------- 9. «Задачи»: the owner's open tasks, «готово» in one tap ----------
const TODO = page('', `const SPK=${JSON.stringify(SPARK(36, 'sq'))};const IC={today:'☀️',week:'📆',waiting:'⏳',inbox:'📥'};
function render(d){const w=document.getElementById('w');const t=d.t||[];w.innerHTML='<div class="row">'+SPK.replace('class="spk"','class="spk '+(t.length?'working':'done')+'"')+'<div class="sp"><div class="b">Задачи</div><div class="m">сегодня '+(d.c?d.c[0]:0)+' · неделя '+(d.c?d.c[1]:0)+' · ждут '+(d.c?d.c[2]:0)+'</div></div><button class="btn" onclick="pull()">↻</button></div>'
+(t.length?t.map(x=>'<div class="row l fade" id="t'+x[0]+'"><button class="btn" style="padding:4px 8px" onclick="done('+x[0]+',this)">✓</button><span class="sp nw">'+(IC[x[2]]||'')+' '+x[1]+'</span>'+(x[3]?'<span class="m">'+x[3]+'</span>':'')+(x[2]!=='today'?'<button class="btn" style="padding:4px 8px" onclick="today('+x[0]+',this)">→☀️</button>':'')+'</div>').join(''):'<div class="m" style="margin-top:8px">Открытых задач нет 🌿</div>')}
function act(a,b){b.disabled=true;W.request('todo:'+a).then(r=>{if(r&&r.result){D=JSON.parse(r.result);draw()}W.HapticFeedback&&W.HapticFeedback.notificationOccurred('success')},()=>{b.disabled=false})}
function done(id,b){const r=document.getElementById('t'+id);if(r)r.style.opacity=.35;act('done.'+id,b)}function today(id,b){act('today.'+id,b)}`, 'todo', 60);

export async function todoData() {
  const c = todoCounts();
  const day = (due) => (due ? new Date(due.length <= 10 ? `${due}T12:00` : due).toLocaleDateString('ru', { day: 'numeric', month: 'short' }) : '');
  return fit({ c: [c.today, c.week, c.waiting, c.inbox], t: listTodos().slice(0, 10).map((x) => [x.id, cut(x.title, 34), x.status, day(x.due)]) });
}

// ---------- cards: the same widgets as ordinary messages, for apps or bots without HTML widgets ----------
const e = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CARDS = {
  today: (d) => [`☀️ <b>${e(d.h)}</b> · ${e(d.dt)}`, `📅 ${d.ne || 0} встреч · 💬 ждут ${d.wi || 0} · ⚪️ дел ${(d.rm || []).length}`,
    ...(d.ev || []).map((x) => `<b>${e(x[0])}</b> ${e(x[1])}`), ...(d.wn || []).map((x) => `💬 ${e(x)}`), ...(d.rm || []).map((x) => `⚪️ ${e(x)}`), ...(d.x || []).map((x) => `<i>${e(x)}</i>`)].join('\n'),
  work: (d) => [`${(d.r || []).length ? '⚡' : '😴'} <b>${NAME} ${d.st ? 'на паузе' : (d.r || []).length ? 'работает' : 'отдыхает'}</b> · ${e(d.tm)}`,
    `Сейчас ${(d.r || []).length} · ждут тебя ${d.i || 0} · сделано ${d.d || 0}${d.q ? ` · в очереди ${d.q}` : ''}`, ...(d.r || []).map((r) => `${r[2] ? '⏰' : '⚙️'} ${e(r[0])} · ${r[1]} мин`)].join('\n'),
  money: (d) => [`💳 <b>Всего: ${e(d.tot)}</b>`, `Траты: сегодня ${e(d.td)} · 7 дней ${e(d.wk)} · месяц ${e(d.mo)}`, ...(d.c || []).map((c) => `• ${e(c[0])}: ${e(c[2])}`)].join('\n'),
  todo: (d) => ((d.t || []).length ? [`📋 <b>Задачи</b> · сегодня ${(d.c || [])[0] || 0} · неделя ${(d.c || [])[1] || 0}`, ...(d.t || []).map((x) => `• ${e(x[1])}${x[3] ? ` · ${e(x[3])}` : ''}`)].join('\n') : '📋 Открытых задач нет'),
  spin: (d) => ((d.t || []).length ? [`🎡 <b>Что сделать первым?</b>`, ...(d.t || []).map((x, i) => `${i === d.p ? '👉 <b>' : ''}${i + 1}. ${e(x)}${i === d.p ? '</b>' : ''}`)].join('\n') : '🎡 На сегодня дел нет. Отдыхай!'),
};
CARDS.day = CARDS.today; CARDS.board = CARDS.work;

// ---------- sending and answering ----------
// WIDGETS in .env: auto (HTML widget, a card if Telegram refuses), html (widgets only), cards (cards only).
export const widgetMode = () => { const m = String(process.env.WIDGETS || 'auto').toLowerCase(); return ['html', 'cards'].includes(m) ? m : 'auto'; };
const KINDS = {
  today: { html: TODAY, data: todayData, caption: '☀️ Сегодня', description: 'Сегодня: встречи, дела, кто ждёт ответа' },
  work: { html: WORK, data: workData, caption: `⚡ ${NAME} в работе`, description: `В работе: что делает ${NAME}, кнопка «Стоп»`, menu: '⚡ В работе', actions: { stop: () => stopAll() } },
  money: { html: MONEY, data: moneyData, caption: '💳 Деньги', description: 'Деньги: остатки и траты', menu: '💳 Деньги' },
  spin: { html: SPIN, data: spinData, caption: '🎡 Что сделать первым', description: 'Рулетка: что сделать первым', menu: '🎡 Рулетка' },
  todo: { html: TODO, data: todoData, caption: '📋 Задачи', description: 'Задачи: сегодня, неделя, ждут ответа', menu: '📋 Задачи',
    actions: { done: (id) => doneTodo(Number(id)), today: (id) => updateTodo(Number(id), { status: 'today' }) } },
  // Old names, kept for the commands people already know.
  day: { html: TODAY, data: todayData, caption: '☀️ Сегодня', hidden: true },
  board: { html: WORK, data: workData, caption: `⚡ ${NAME} в работе`, hidden: true, actions: { stop: () => stopAll() } },
};

export const _html = { DAY, MONEY, BOARD, TODAY, WORK, SPIN, TODO };
export const _data = { todayData, workData, spinData, moneyData, todoData };
// Built-in widgets plus the ones optional modules bring (/kind commands in the bot).
const kinds = () => ({ ...KINDS, ...moduleWidgets() });
export const widgetKinds = () => Object.entries(kinds()).map(([kind, k]) => ({ kind, description: k.description || k.caption, menu: k.menu || null, hidden: !!k.hidden }));
let api = null; // grammy bot.api, set by the bot
export const setWidgetApi = (a) => { api = a; };
let botUser = null; // the bot's @username, for t.me links from groups
export const setWidgetBot = (u) => { botUser = u || null; };
// Does Telegram let this bot send HTML widgets? null: not known yet, false: refused
// (INPUT_MEDIA_WIDGET_NOT_ALLOWED: Telegram opens them «gradually»), true: allowed.
// While refused, auto mode sends the same design as a Mini App; a daily probe notices when they open.
export const widgetsAllowed = () => kvGet('widgets_allowed', null);
const refused = (err) => /WIDGET_NOT_ALLOWED|INPUT_MEDIA_WIDGET|method not found|Not Found/i.test(String(err?.message || err));
// The Mini App address of a widget, or null without a public https address.
export const miniUrl = (kind) => (config.publicUrl?.startsWith('https://') ? `${config.publicUrl.replace(/\/$/, '')}/w/${kind}` : null);
// web_app buttons work only in the private chat («-100…#7» topics and groups get a card).
const isPrivate = (chatId) => /^\d+$/.test(String(chatId));

// A card: the same data as a message with buttons, edited in place by the buttons.
export function cardOf(kind, dataStr, extra = {}) {
  const k = kinds()[kind];
  let d = {}; try { d = { ...JSON.parse(dataStr || '{}'), ...extra }; } catch { /* empty card */ }
  const draw = k.card || CARDS[kind];
  const text = draw ? draw(d) : `${k.caption}\n<i>Открой в пульте, чтобы увидеть всё.</i>`;
  const rows = [[{ text: '↻ Обновить', callback_data: `wg:${kind}` }]];
  if (kind === 'spin' && (d.t || []).length) rows[0].unshift({ text: '🎡 Крутить!', callback_data: 'wg:spin:go' });
  if ((kind === 'work' || kind === 'board') && (d.r || []).length && !d.st) rows[0].push({ text: '⏹ Стоп', callback_data: `wg:${kind}:stop` });
  if (config.publicUrl?.startsWith('https://')) rows.push([{ text: '📱 Открыть в пульте', web_app: { url: config.publicUrl } }]);
  return { text: text.slice(0, 4000), reply_markup: { inline_keyboard: rows } };
}

// The Mini App message: the card's first line and one «Открыть» button that opens the live screen.
export function miniMessage(kind, dataStr) {
  const k = kinds()[kind];
  const head = String((k.card || CARDS[kind])?.(JSON.parse(dataStr || '{}')) || k.caption).split('\n')[0];
  return { text: `${head}\n<i>Живой экран: открой и смотри, данные обновляются сами.</i>`, reply_markup: { inline_keyboard: [[{ text: `✨ Открыть ${k.caption.replace(/^\S+\s/, '')}`, web_app: { url: miniUrl(kind) } }]] } };
}

export async function sendWidget(chatId, kind) {
  const k = kinds()[kind];
  const data = await k.data().catch(() => '{}');
  const mode = widgetMode();
  if (mode === 'html' || (mode === 'auto' && widgetsAllowed() !== false)) {
    try {
      const m = await api.raw.sendWidget({ chat_id: chatId, html: k.html, chat_data: data, caption: k.caption, allow_queries: true, disable_notification: true });
      if (widgetsAllowed() !== true) kvSet('widgets_allowed', true);
      return m;
    } catch (err) {
      if (mode === 'html') throw err;
      if (refused(err)) kvSet('widgets_allowed', false);
      addLog('error', `Виджет ${kind} не ушёл, открою мини-приложением: ${err.message.slice(0, 120)}`);
    }
  }
  // The same design as a Mini App (private chat and a public https address), else a card.
  if (mode === 'auto' && miniUrl(kind) && isPrivate(chatId)) {
    const mm = miniMessage(kind, data);
    return api.sendMessage(chatId, mm.text, { parse_mode: 'HTML', reply_markup: mm.reply_markup, disable_notification: true, link_preview_options: { is_disabled: true } });
  }
  const c = cardOf(kind, data);
  // In a group (a topic) Telegram rejects web_app buttons: those rows go, a link opens the screen in the private chat.
  if (!isPrivate(chatId)) {
    c.reply_markup.inline_keyboard = c.reply_markup.inline_keyboard.filter((r) => !r.some((x) => x.web_app));
    if (botUser && mode === 'auto' && miniUrl(kind)) c.reply_markup.inline_keyboard.push([{ text: '✨ Открыть живой экран', url: `https://t.me/${botUser}?start=w_${kind}` }]);
  }
  return api.sendMessage(chatId, c.text, { parse_mode: 'HTML', reply_markup: c.reply_markup, disable_notification: true, link_preview_options: { is_disabled: true } });
}

// A card's button: wg:<kind>[:<action>]. Returns the toast text.
export async function cardButton(chatId, msgId, cb) {
  const [, kind, action] = cb.split(':');
  const k = kinds()[kind];
  if (!k) return 'Этой карточки больше нет';
  let toast = 'Обновила';
  if (action && (await runAction(k, action))) toast = 'Готово';
  const data = await k.data().catch(() => '{}');
  let extra = {};
  if (kind === 'spin' && action === 'go') { const n = (JSON.parse(data).t || []).length; extra = { p: Math.floor(Math.random() * n) }; toast = '🎡 Выбрала!'; }
  const c = cardOf(kind, data, extra);
  await api.editMessageText(chatId, msgId, c.text, { parse_mode: 'HTML', reply_markup: c.reply_markup, link_preview_options: { is_disabled: true } })
    .catch((err) => { if (!/not modified/i.test(err.message)) throw err; });
  return toast;
}

// A widget's request: "<kind>" for fresh data, "<kind>:<action>" for a button (only the owner).
export async function answerQuery(q, isOwner) {
  const [kind, action] = String(q.data || '').split(':');
  const k = kinds()[kind];
  if (!isOwner || !k) return api.raw.answerWidgetQuery({ widget_query_id: q.id }).catch(() => {});
  if (action) { try { await runAction(k, action); } catch (err) { addLog('error', `Виджет ${q.data}: ${err.message.slice(0, 120)}`); } }
  const data = await k.data().catch((err) => { addLog('error', `Виджет ${q.data}: ${err.message.slice(0, 120)}`); return null; });
  return api.raw.answerWidgetQuery({ widget_query_id: q.id, ...(data ? { data } : {}) }).catch(() => {});
}

// «stop», «done.12»: an action of a widget with an optional argument after the dot.
async function runAction(k, action) {
  const [name, arg] = String(action).split('.');
  if (!k.actions?.[name]) return false;
  await k.actions[name](arg);
  return true;
}

// The same request from the Mini App (src/miniapp.js; the caller has checked the owner). → data string.
export async function miniQuery(q) {
  const [kind, action] = String(q || '').split(':');
  const k = kinds()[kind];
  if (!k) throw new Error('Нет такого экрана');
  if (action) await runAction(k, action);
  return k.data();
}
export const widgetHtml = (kind) => kinds()[kind]?.html || null;

// Once a day: a test widget to the owner. If Telegram took it, it is deleted at once, widgets are
// switched on and the owner hears it once. If not, nothing is said.
export async function probeWidgets(chatId, tell) {
  if (widgetMode() !== 'auto' || widgetsAllowed() === true || !chatId) return null;
  try {
    const m = await api.raw.sendWidget({ chat_id: chatId, html: '<!doctype html><html><body>ok</body></html>', chat_data: '{}', caption: '·', disable_notification: true });
    await api.deleteMessage(chatId, m.message_id).catch(() => {});
    kvSet('widgets_allowed', true);
    addLog('system', 'Telegram разрешил HTML-виджеты: переключаюсь на них');
    await tell?.('✨ Telegram открыл виджеты, теперь они прямо в чате.');
    return true;
  } catch (err) {
    if (refused(err)) kvSet('widgets_allowed', false);
    return false;
  }
}
export function startWidgetProbe(ownerId, tell) {
  const tick = () => {
    const day = new Date(Date.now() + LOCAL_OFFSET()).toISOString().slice(0, 10);
    if (kvGet('widget_probe_day', '') === day) return;
    kvSet('widget_probe_day', day);
    probeWidgets(Number(ownerId()), tell).catch(() => {});
  };
  setTimeout(tick, 60000).unref();
  setInterval(tick, 3600000).unref();
}

// The live status of a run: a widget with its own clock, edited only when the step changes.
export async function sendProgress(chatId, state) {
  if (widgetMode() === 'cards' || (widgetMode() === 'auto' && widgetsAllowed() === false)) throw new Error('виджеты выключены');
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
