// Telegram HTML widgets (Bot API 10.4): live mini-screens inside message bubbles, private chat only.
// A widget is one HTML document run by the app (no network); its state is chat_data (≤1024 bytes),
// and it can ask the bot for fresh data with TelegramWidget.request() → update widget_query,
// answered by answerWidgetQuery (≤1024 bytes). Every widget also gets a text caption for old apps.
import net from 'node:net';
import { LOCAL_OFFSET, config } from './config.js';
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
  const wi = get("SELECT COUNT(*) n FROM inbox WHERE status IN ('new','routed')").n;
  const wn = waitingRows().slice(0, 3).map((r) => cut(r.name || r.username || 'кто-то', 18) + ': ' + cut(String(r.text || '').replace(/\s+/g, ' '), 26));
  const x = modules.map((m) => { try { return m.dayLine?.() || null; } catch { return null; } }).filter(Boolean).map((t) => cut(t, 60));
  return fit({ dt, h: hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер', ne, wi, ev, wn, rm, x });
}

// ---------- 7. «В работе»: что Vega делает сейчас, с кнопкой «Стоп» ----------
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
  const t = [];
  try { (await agenda()).reminders.slice(0, 6).forEach((r) => t.push(cut(r.title, 26))); } catch { /* no Mac */ }
  for (const r of waitingRows()) if (t.length < 8) t.push(cut(`Ответить: ${r.name || r.username || 'кто-то'}`, 26));
  return fit({ t: t.slice(0, 8) });
}

// ---------- cards: the same widgets as ordinary messages, for apps or bots without HTML widgets ----------
const e = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CARDS = {
  today: (d) => [`☀️ <b>${e(d.h)}</b> · ${e(d.dt)}`, `📅 ${d.ne || 0} встреч · 💬 ждут ${d.wi || 0} · ⚪️ дел ${(d.rm || []).length}`,
    ...(d.ev || []).map((x) => `<b>${e(x[0])}</b> ${e(x[1])}`), ...(d.wn || []).map((x) => `💬 ${e(x)}`), ...(d.rm || []).map((x) => `⚪️ ${e(x)}`), ...(d.x || []).map((x) => `<i>${e(x)}</i>`)].join('\n'),
  work: (d) => [`${(d.r || []).length ? '⚡' : '😴'} <b>${NAME} ${d.st ? 'на паузе' : (d.r || []).length ? 'работает' : 'отдыхает'}</b> · ${e(d.tm)}`,
    `Сейчас ${(d.r || []).length} · ждут тебя ${d.i || 0} · сделано ${d.d || 0}${d.q ? ` · в очереди ${d.q}` : ''}`, ...(d.r || []).map((r) => `${r[2] ? '⏰' : '⚙️'} ${e(r[0])} · ${r[1]} мин`)].join('\n'),
  money: (d) => [`💳 <b>Всего: ${e(d.tot)}</b>`, `Траты: сегодня ${e(d.td)} · 7 дней ${e(d.wk)} · месяц ${e(d.mo)}`, ...(d.c || []).map((c) => `• ${e(c[0])}: ${e(c[2])}`)].join('\n'),
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
  // Old names, kept for the commands people already know.
  day: { html: TODAY, data: todayData, caption: '☀️ Сегодня', hidden: true },
  board: { html: WORK, data: workData, caption: `⚡ ${NAME} в работе`, hidden: true, actions: { stop: () => stopAll() } },
};

export const _html = { DAY, MONEY, BOARD, TODAY, WORK, SPIN };
export const _data = { todayData, workData, spinData, moneyData };
// Built-in widgets plus the ones optional modules bring (/kind commands in the bot).
const kinds = () => ({ ...KINDS, ...moduleWidgets() });
export const widgetKinds = () => Object.entries(kinds()).map(([kind, k]) => ({ kind, description: k.description || k.caption, menu: k.menu || null, hidden: !!k.hidden }));
let api = null; // grammy bot.api, set by the bot
export const setWidgetApi = (a) => { api = a; };
let htmlRefusedAt = 0; // auto mode: after Telegram refused a widget, cards for 10 minutes

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

export async function sendWidget(chatId, kind) {
  const k = kinds()[kind];
  const data = await k.data().catch(() => '{}');
  const mode = widgetMode();
  if (mode === 'html' || (mode === 'auto' && Date.now() - htmlRefusedAt > 600000)) {
    try {
      return await api.raw.sendWidget({ chat_id: chatId, html: k.html, chat_data: data, caption: k.caption, allow_queries: true, disable_notification: true });
    } catch (err) {
      if (mode === 'html') throw err;
      htmlRefusedAt = Date.now();
      addLog('error', `Виджет ${kind} не ушёл, шлю карточку: ${err.message.slice(0, 120)}`);
    }
  }
  const c = cardOf(kind, data);
  return api.sendMessage(chatId, c.text, { parse_mode: 'HTML', reply_markup: c.reply_markup, disable_notification: true, link_preview_options: { is_disabled: true } });
}

// A card's button: wg:<kind>[:<action>]. Returns the toast text.
export async function cardButton(chatId, msgId, cb) {
  const [, kind, action] = cb.split(':');
  const k = kinds()[kind];
  if (!k) return 'Этой карточки больше нет';
  let toast = 'Обновила';
  if (action && k.actions?.[action]) { await k.actions[action](); toast = 'Остановила'; }
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
  if (action && k.actions?.[action]) { try { await k.actions[action](); } catch (err) { addLog('error', `Виджет ${q.data}: ${err.message.slice(0, 120)}`); } }
  const data = await k.data().catch((err) => { addLog('error', `Виджет ${q.data}: ${err.message.slice(0, 120)}`); return null; });
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
