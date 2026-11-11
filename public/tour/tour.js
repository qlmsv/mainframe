
const NAV = [
  ['inbox', '📥', 'Входящие'], ['today', '📅', 'Сегодня'], ['sessions', '🧠', 'Сессии'], ['memory', '✨', 'Память'],
  ['social', '📊', 'Соцсети'], ['finance', '💳', 'Финансы'],
];
const now = () => new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

// Each scenario: chat steps (me / bot / sys / voice / photo / buttons / progress / typing input) and a pult pane.
const S = [
  { id: 'morning', icon: '☀️', title: 'Утренняя сводка', text: 'В 8:00 помощник сам присылает день одним сообщением: встречи, кто ждёт ответа и траты.', tab: 'today',
    chat: [
      { sys: 'Сегодня' },
      { bot: '<span class="h">☀️ Доброе утро</span><b>Встречи</b><br>11:00 созвон с Олегом про сайт<br>16:30 стоматолог<br><br><b>Ждут ответа</b><span class="ck">Анна про договор, 2 дня</span><span class="ck">Кофейня «Морская» про макет</span><br><b>Вчера потрачено</b> <mark>2 340 ₽</mark>, больше всего такси', delay: 900 },
      { buttons: ['Ответить Анне', 'Открыть пульт'], press: 0 },
      { bot: '✍️ Черновик для Анны:<div class="quote">Анна, привет! Договор посмотрел, всё ок, кроме п. 4.2. Пришлю правки до обеда</div>', delay: 1200 },
      { buttons: ['✅ Отправить', 'Поправлю'], press: 0, one: false },
      { sys: 'Отправлено Анне в Telegram' },
    ] },
  { id: 'inbox', icon: '📥', title: 'Сообщения и почта', text: 'Помощник читает Telegram, рабочие чаты и почту. Неважное откладывает, важное приносит карточкой с готовым ответом.', tab: 'inbox',
    chat: [
      { bot: '📥 <b>Новое · Олег (Telegram)</b><div class="quote">Скинь, пожалуйста, счёт за ноябрь, бухгалтер ждёт</div>💡 Нужен счёт. Нашёл его в почте от 1 ноября.<br>✍️ <i>Олег, держи счёт за ноябрь, если что-то не так, скажи</i> + файл', delay: 700 },
      { buttons: ['✅ Отправить', '✏️ Изменить', 'Пропустить'], press: 0 },
      { sys: 'Ушло Олегу со счётом' },
      { bot: '📥 <b>Почта · Банк</b>: выписка за октябрь. Отложил, ничего делать не нужно.', delay: 1000 },
      { bot: '✉️ <b>Почта · Поставщик</b><div class="quote">Новый прайс на декабрь во вложении</div>💡 Сохранил прайс, цены выросли на 4%.', delay: 1200 },
    ] },
  { id: 'voice', icon: '🎙', title: 'Задачи голосом', text: 'Говоришь как сотруднику, помощник расшифровывает и делает: календарь, напоминания, сообщения людям.', tab: 'today',
    chat: [
      { voice: 'перенеси созвон с Олегом на завтра в три и напомни мне за час' },
      { bot: '🎙 <i>перенеси созвон с Олегом на завтра в три и напомни мне за час</i>', delay: 600 },
      { progress: ['Нахожу встречу в календаре', 'Переношу на завтра 15:00', 'Ставлю напоминание на 14:00', 'Пишу Олегу'] },
      { bot: '<span class="ck x">Созвон с Олегом: завтра, 15:00</span><span class="ck x">Напомню в 14:00</span><span class="ck">Олегу: «перенесём на завтра в 15:00?»</span>', delay: 500 },
      { buttons: ['✅ Отправить Олегу', 'Не надо'], press: 0 },
      { bot: 'Олег ответил: «да, ок 👍». Всё в календаре.', delay: 1600 },
    ] },
  { id: 'money', icon: '💳', title: 'Финансы', text: 'Траты из писем банков собираются сами. Чек можно сфотографировать, баланс прислать скриншотом.', tab: 'finance',
    chat: [
      { photo: 'КОФЕЙНЯ «ЗЕРНО»<br>Капучино ........ 290<br>Сырник .......... 360<br>------------------<br>ИТОГО ........... 650 ₽<br>10.11 09:14' },
      { bot: '🧾 Записал: <b>650 ₽</b> · Кофейня «Зерно» · еда · сегодня 9:14', delay: 900 },
      { me: 'сколько потратил на еду в этом месяце?' },
      { bot: '<b>Еда за ноябрь: 18 420 ₽</b><table><tr><th>Где</th><th>Сумма</th></tr><tr><td>Кафе</td><td>9 860 ₽</td></tr><tr><td>Продукты</td><td>6 210 ₽</td></tr><tr><td>Доставка</td><td>2 350 ₽</td></tr></table><span class="muted">Это на 12% меньше, чем в октябре</span>', delay: 1100 },
    ] },
  { id: 'social', icon: '📊', title: 'Соцсети', text: 'Посты в твоём стиле для Telegram, LinkedIn, Threads и Instagram. Помощник смотрит, что заходит у конкурентов, и показывает, какие посты приводят клиентов.', tab: 'social',
    chat: [
      { bot: '📊 <b>Пост на сегодня</b>, Telegram и Threads<div class="quote">Перестал открывать пять приложений, чтобы разобраться с делами. Теперь утром одно сообщение, и я знаю всё…</div><span class="muted">Похожий пост у конкурента набрал 12 тыс. просмотров</span>', delay: 700 },
      { buttons: ['✅ Опубликовать', '✏️ Изменить', 'Позже', 'Другой'], press: 0 },
      { sys: 'Опубликовано в канале и Threads' },
      { bot: '📈 Через 3 часа: <b>2 140</b> просмотров, 31 реакция, <mark>5 репостов</mark>', delay: 1700 },
    ] },
  { id: 'dev', icon: '🛠', title: 'Сайты и боты', text: 'Описываешь словами, помощник делает лендинг, Telegram-бота или мини-приложение, проверяет на телефоне и выкладывает после твоего «да».', tab: 'sessions',
    chat: [
      { me: 'сделай лендинг для кофейни: меню, адрес, кнопка записи в телеграм' },
      { progress: ['Пишу тексты и структуру', 'Собираю страницу', 'Проверяю на телефоне и компьютере', 'Готовлю превью'] },
      { bot: '✅ <b>Лендинг готов</b><br>Превью: <u>coffee-zerno.vercel.app</u><br>Проверил на ширине телефона, горизонтальной прокрутки нет', delay: 700 },
      { buttons: ['🚀 Выложить на сайт', 'Поправить'], press: 0 },
      { bot: '🌐 Сайт работает: <u>zerno-coffee.ru</u>', delay: 1500 },
    ] },
  { id: 'memory', icon: '✨', title: 'Память', text: 'Помнит тебя, людей и договорённости. Находит, что обсуждали месяц назад, в переписке, почте и задачах.', tab: 'memory',
    chat: [
      { me: 'что я обещал Анне в октябре?' },
      { bot: '<b>Анна, 14 октября, Telegram</b><br>Ты обещал прислать коммерческое предложение до конца месяца и скидку 10% при оплате за год.<br><span class="muted">КП ушло 28 октября, скидку она ещё не использовала</span>', delay: 1000 },
      { me: 'запомни, что с Анной всегда на «вы»' },
      { bot: '🧠 Запомнил: с Анной на «вы»', delay: 700 },
    ] },
  { id: 'schedule', icon: '⏰', title: 'По расписанию', text: 'Любая регулярная работа: проверить, собрать, напомнить. Итог приходит, только когда есть что сказать.', tab: 'today',
    chat: [
      { me: 'каждую пятницу в 18:00 присылай, сколько заработали и потратили за неделю' },
      { bot: '⏰ Поставил: пятница, 18:00, итог недели по деньгам', delay: 800 },
      { sys: 'Пятница, 18:00' },
      { bot: '<span class="h">💼 Итог недели</span><table><tr><td>Поступило</td><td class="green">+184 000 ₽</td></tr><tr><td>Потрачено</td><td class="red">−41 300 ₽</td></tr><tr><td>Осталось</td><td><b>+142 700 ₽</b></td></tr></table>', delay: 1200 },
    ] },
  { id: 'computer', icon: '🖥', title: 'Работа на компьютере', text: 'Помощник сам работает в своём браузере и приложениях на Mac, не трогая твою мышь. Ты в это время спокойно делаешь своё.', tab: 'sessions',
    chat: [
      { me: 'зайди в личный кабинет поставщика и скачай акт за октябрь' },
      { progress: ['Открываю кабинет в своём браузере', 'Нахожу раздел «Документы»', 'Скачиваю акт за октябрь'] },
      { bot: '📄 Акт за октябрь скачал и сохранил в «Документы/Акты». Твою мышь и экран не трогал.', delay: 700 },
    ] },
];

const PANES = {
  today: () => `<h3>Сегодня</h3><div class="sub">вторник, 10 ноября</div>
    <div class="heroc warm"><div class="l">Ближайшее</div><div class="v">11:00 · созвон с Олегом</div><div class="tiles"><div class="tile">Встреч<b>2</b></div><div class="tile">Напоминаний<b>4</b></div><div class="tile">Ждут ответа<b>2</b></div></div></div>
    <div class="cards">${['11:00 · Созвон с Олегом · сайт', '14:00 · Напомнить про созвон', '16:30 · Стоматолог', '18:00 · Итог недели по деньгам (пятница)'].map((x, i) => `<div class="card" style="animation-delay:${i * 90}ms"><div class="tt"><span>📅</span><span>${x}</span></div></div>`).join('')}</div>`,
  inbox: () => `<h3>Входящие</h3><div class="sub">важное с готовыми ответами</div>
    <div class="cards">
      <div class="card"><div class="tt">💬 Олег <span class="pill">ждёт ответа</span></div><div class="ds">«Скинь счёт за ноябрь, бухгалтер ждёт»</div><div class="acts"><span class="btn p">Отправить черновик</span><span class="btn">Изменить</span></div></div>
      <div class="card" style="animation-delay:.1s"><div class="tt">✉️ Поставщик <span class="pill b">новое</span></div><div class="ds">Новый прайс на декабрь, цены выросли на 4%</div></div>
      <div class="card" style="animation-delay:.2s"><div class="tt">✉️ Банк <span class="pill g">отложено</span></div><div class="ds">Выписка за октябрь, действий не нужно</div></div>
      <div class="card" style="animation-delay:.3s"><div class="tt">👥 Рабочий чат «Проект» <span class="pill">2 вопроса</span></div><div class="ds">Спрашивают сроки по макету и доступ к папке</div></div>
    </div>`,
  finance: () => `<h3>Финансы</h3><div class="sub">траты из банков, чеки и балансы</div>
    <div class="heroc green"><div class="l">Всего на счетах</div><div class="v">≈ 486 300 ₽</div><div class="tiles"><div class="tile">Сегодня<b>650 ₽</b></div><div class="tile">7 дней<b>14 900 ₽</b></div><div class="tile">Месяц<b>61 200 ₽</b></div></div></div>
    <div class="card"><div class="tt">Месяц по категориям</div>${[['Еда', 72, '18 420 ₽'], ['Такси', 48, '12 300 ₽'], ['Дом', 35, '9 100 ₽'], ['Подписки', 18, '4 600 ₽']].map(([n, w, v], i) => `<div class="barrow"><span>${n}</span><span class="track"><i style="width:${w}%;animation-delay:${i * 120}ms"></i></span><b>${v}</b></div>`).join('')}</div>`,
  social: () => `<h3>Соцсети</h3><div class="sub">посты, календарь, конкуренты</div>
    <div class="grid2"><div class="post"><div class="net">✈️ Telegram · сегодня 10:00</div><p>Перестал открывать пять приложений, чтобы разобраться с делами…</p><span class="pill g">опубликовано · 2 заявки</span></div>
    <div class="post"><div class="net">💼 LinkedIn · завтра 9:00</div><p>Как ИИ-помощник сэкономил мне 2 часа в день: три сценария…</p><span class="pill">на одобрении</span></div></div>
    <div class="card" style="margin-top:10px"><div class="tt">Просмотры за неделю</div><svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none"><path d="M0 60 L40 52 L80 55 L120 40 L160 42 L200 25 L240 30 L300 8" fill="none" stroke="#ff7a45" stroke-width="3" stroke-linecap="round"/></svg></div>`,
  sessions: () => `<h3>Сессии</h3><div class="sub">проекты, в которых помощник работает</div>
    <div class="cards">${[['🌐 Лендинг кофейни', 'готово · превью на телефоне', 'g'], ['🤖 Бот записи клиентов', 'работает · 2 правки сегодня', 'b'], ['🖥 Кабинет поставщика', 'акт за октябрь скачан', 'g']].map(([a, b, c], i) => `<div class="card" style="animation-delay:${i * 100}ms"><div class="tt">${a} <span class="pill ${c}">${b}</span></div></div>`).join('')}
    <div class="card" style="animation-delay:.3s"><div class="tt">⚙️ Работаю…</div><div class="ds">Проверяю страницу на ширине телефона · шаг 4</div></div></div>`,
  memory: () => `<h3>Память</h3><div class="sub">что помощник знает о тебе</div>
    <div class="cards">${['С Анной всегда на «вы»', 'Пишу без длинных тире, коротко и по делу', 'Олег: сайт кофейни, оплата по этапам', 'Встречи не ставить раньше 10:00'].map((x, i) => `<div class="card" style="animation-delay:${i * 90}ms"><div class="tt"><span>🧠</span><span>${x}</span></div></div>`).join('')}</div>`,
};

const $ = (s) => document.querySelector(s);
const chat = $('#chat'), main = $('#main'), side = $('#side');
let cur = 0, playing = true, timers = [], stepIdx = 0;

side.innerHTML = '<div class="logo"><i></i>Пульт</div>' + NAV.map(([id, ic, name]) => `<div class="nav" data-tab="${id}"><span>${ic}</span><span>${name}</span>${id === 'inbox' ? '<em>4</em>' : ''}</div>`).join('');
$('#chips').innerHTML = S.map((s, i) => `<button class="chip" data-i="${i}"><span class="ic">${s.icon}</span>${s.title}</button>`).join('');
$('#fgrid').innerHTML = S.map((s, i) => `<div class="f" data-i="${i}"><div class="ic">${s.icon}</div><b>${s.title}</b><span>${s.text}</span></div>`).join('');

const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
const clear = () => { timers.forEach(clearTimeout); timers = []; };
const scroll = () => { chat.scrollTop = chat.scrollHeight; };
const add = (html, cls) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; chat.appendChild(d); scroll(); return d; };
const t = () => `<span class="t">${now()}</span>`;

function typeInput(text, done) {
  const box = $('#input'); box.classList.add('filling'); box.textContent = '';
  let i = 0;
  const tick = () => { box.textContent = text.slice(0, ++i); if (i < text.length) later(tick, 22); else later(() => { box.textContent = 'Сообщение'; box.classList.remove('filling'); done(); }, 260); };
  tick();
}
function botTyping(ms, done) {
  $('#status').textContent = 'печатает…'; $('#status').classList.add('typing');
  const dots = add('<i></i><i></i><i></i>', 'typing-dots');
  later(() => { dots.remove(); $('#status').textContent = 'бот'; $('#status').classList.remove('typing'); done(); }, ms);
}

function runStep() {
  const sc = S[cur];
  const st = sc.chat[stepIdx];
  $('#bar').style.width = `${(stepIdx / sc.chat.length) * 100}%`;
  if (!st) { $('#bar').style.width = '100%'; if (playing) later(() => go(cur + 1), 3200); return; }
  const next = (ms = 700) => { stepIdx++; later(runStep, ms); };
  if (st.sys) { add(st.sys, 'msg sys'); return next(800); }
  if (st.me) return typeInput(st.me, () => { add(st.me + t(), 'msg me'); next(500); });
  if (st.voice) { add(`<div class="voice"><span class="pb">▶</span><span class="wave">${Array.from({ length: 22 }, (_, i) => `<i style="height:${30 + ((i * 37) % 70)}%;animation-delay:${i * 40}ms"></i>`).join('')}</span><span class="muted" style="font-size:11px">0:06</span></div>${t()}`, 'msg me'); return next(900); }
  if (st.photo) { add(`<div class="photo">${st.photo}</div>${t()}`, 'msg me'); return next(800); }
  if (st.bot) return botTyping(st.delay || 900, () => { add(st.bot + t(), 'msg bot'); next(700); });
  if (st.buttons) {
    const b = add(st.buttons.map((x, i) => `<span class="${i === 0 ? 'primary' : ''}">${x}</span>`).join(''), `btns${st.buttons.length === 1 ? ' one' : ''}`);
    if (st.press != null) later(() => { b.children[st.press]?.classList.add('pressed'); later(() => { b.style.opacity = '.5'; next(400); }, 600); }, 1400);
    else next(900);
    return;
  }
  if (st.progress) {
    const p = add(`<div class="prog">${st.progress.map((x) => `<div class="row">${x}</div>`).join('')}</div><span class="t">⚙️ работаю</span>`, 'msg bot');
    st.progress.forEach((_, i) => later(() => { p.querySelectorAll('.row')[i].classList.add('done'); scroll(); if (i === st.progress.length - 1) next(500); }, 900 * (i + 1)));
  }
}

function go(i) {
  clear();
  cur = (i + S.length) % S.length; stepIdx = 0;
  const sc = S[cur];
  $('#st-title').textContent = `${sc.icon} ${sc.title}`;
  $('#st-text').textContent = sc.text;
  document.querySelectorAll('.chip').forEach((c, k) => c.classList.toggle('on', k === cur));
  document.querySelector(`.chip[data-i="${cur}"]`).scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('on', n.dataset.tab === sc.tab));
  main.innerHTML = `<div class="pane">${PANES[sc.tab]()}</div>`;
  chat.innerHTML = '';
  $('#input').textContent = 'Сообщение';
  later(runStep, 500);
}

function setPlay(v) { playing = v; $('#play-ic').textContent = v ? '❚❚' : '▶'; $('#play-tx').textContent = v ? 'Пауза' : 'Дальше сами'; }
$('#play').onclick = () => { setPlay(!playing); if (playing && stepIdx >= S[cur].chat.length) go(cur + 1); };
$('#next').onclick = () => go(cur + 1);
$('#prev').onclick = () => go(cur - 1);
document.addEventListener('click', (e) => {
  const c = e.target.closest('.chip, .f');
  if (!c) return;
  go(Number(c.dataset.i));
  if (c.classList.contains('f')) document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(cur + 1); if (e.key === 'ArrowLeft') go(cur - 1); if (e.key === ' ') { e.preventDefault(); $('#play').click(); } });
const startAt = Math.max(0, S.findIndex((s) => location.hash === `#${s.id}`));
go(startAt);
