// Setup wizard: phrase → about you → model → Telegram bot → launch. Talks to /api/setup/*.
(() => {
  const $ = (s) => document.querySelector(s);
  const STEPS = ['mode', 'profile', 'model', 'bot', 'connect', 'finish'];
  let state = null;
  let pick = null;
  let modePick = null;

  async function api(name, body) {
    const r = await fetch(`/api/setup/${name}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-mf-client': '1', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const d = await r.json().catch(() => ({ error: 'Сервер не ответил' }));
    if (!r.ok) { const e = new Error(d.error || 'Ошибка'); e.status = r.status; throw e; }
    return d;
  }

  const spark = (s) => $('#spark')?.setState?.(s);
  function err(text) { const e = $('#err'); e.textContent = text || ''; e.hidden = !text; if (text) spark('error'); }

  function show(step) {
    document.querySelectorAll('section[data-step]').forEach((s) => { s.hidden = s.dataset.step !== step; });
    const i = STEPS.indexOf(step);
    $('#steps').innerHTML = STEPS.map((_, k) => `<i class="${i >= k || step === 'launched' ? 'on' : ''}"></i>`).join('');
    spark(step === 'launched' ? 'done' : 'idle');
    err('');
    if (step === 'model') renderModel();
    if (step === 'mode') renderMode();
    if (step === 'connect') renderConnect();
    if (step === 'finish') renderSummary();
    window.scrollTo(0, 0);
  }

  const modelReady = (s) => s.model.ready && (s.model.provider !== 'claude' || s.claudeToken);
  function next(s = state) {
    state = s;
    if (!s.modeChosen) return show('mode');
    if (!s.owner || !s.tz) return show('profile');
    if (!modelReady(s)) return show('model');
    if (!s.bot) return show('bot');
    if (!s.connectDone) return show('connect');
    return show('finish');
  }

  // ---------- busy buttons ----------
  async function busy(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Секунду…'; spark('working'); err('');
    try { await fn(); } catch (e) { if (e.status === 401) { show('login'); } err(e.message); } finally { btn.disabled = false; btn.textContent = label; if ($('#spark')?.state === 'working') spark('idle'); }
  }

  // ---------- profile ----------
  function fillTz() {
    const sel = $('#tz');
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const all = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [mine];
    const top = ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Vladivostok', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Yerevan', 'Europe/Minsk', 'Europe/Kyiv', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Bali'];
    const opt = (z) => `<option value="${z}">${z.replace(/_/g, ' ')}</option>`;
    sel.innerHTML = `<optgroup label="Частые">${top.filter((z) => all.includes(z)).map(opt).join('')}</optgroup><optgroup label="Все">${all.map(opt).join('')}</optgroup>`;
    sel.value = state?.tz || (all.includes(mine) ? mine : 'Europe/Moscow');
  }

  // ---------- model ----------
  function renderModel() {
    const russia = state.russia;
    const prov = $('#provider');
    const list = state.model.providers.filter((p) => p.id !== 'claude');
    if (russia) list.sort((a, b) => (a.id === 'deepseek' ? -1 : b.id === 'deepseek' ? 1 : 0));
    prov.innerHTML = list.map((p) => `<option value="${p.id}">${p.name}${russia && p.id === 'deepseek' ? ', советую' : ''}</option>`).join('');
    prov.value = state.model.provider !== 'claude' ? state.model.provider : 'deepseek';
    $('#keyHint').textContent = russia
      ? 'DeepSeek, GLM, Kimi или Qwen по своему ключу. Платишь за использование.'
      : 'GLM, Kimi, DeepSeek, OpenRouter и другие. Платишь за использование.';
    const cards = $('#choice');
    const claudeCard = cards.querySelector('[data-pick=claude] small');
    claudeCard.textContent = russia
      ? 'Нужна подписка Claude Pro или Max (от 20 $ в месяц). Из России её сложно оплатить: нужна зарубежная карта.'
      : 'Нужна подписка Claude Pro или Max (от 20 $ в месяц). Лучшее качество.';
    const keyCard = cards.querySelector('[data-pick=key]');
    keyCard.querySelector('b').innerHTML = russia ? 'Китайские модели по ключу <span class="tag">советую</span>' : 'Другой сервис по ключу';
    if (russia) cards.prepend(keyCard); else cards.append(keyCard);
    setPick(pick || (russia ? 'key' : (state.model.provider === 'claude' ? 'claude' : 'key')));
    providerHint();
  }
  function setPick(p) {
    pick = p;
    document.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', b.dataset.pick === p));
    $('#claudeBox').hidden = p !== 'claude';
    $('#keyBox').hidden = p !== 'key';
  }
  function providerHint() {
    const p = state.model.providers.find((x) => x.id === $('#provider').value);
    if (!p) return;
    $('#baseRow').hidden = p.id !== 'custom';
    $('#mainRow').hidden = Boolean(p.main);
    $('#providerHint').innerHTML = p.keys ? `Ключ берётся тут: <a href="${p.keys}" target="_blank" rel="noopener">${new URL(p.keys).host}</a>. Сначала пополни баланс, потом создай ключ.` : 'Впиши адрес API, ключ и название модели.';
  }

  // ---------- where it works ----------
  function renderMode() {
    // The wizard on a server offers server or server + computer; on a Mac/PC it is the computer.
    const ids = state.platform === 'linux' ? ['server', 'both'] : ['computer'];
    modePick = modePick || (ids.includes(state.mode) ? state.mode : ids[0]);
    $('#modeCards').innerHTML = ids.map((id) => `<button type="button" class="card${id === modePick ? ' on' : ''}" data-mode="${id}"><b>${esc(state.modes[id].title)}</b><small>${esc(state.modes[id].short)}</small></button>`).join('')
      + (state.platform === 'linux' ? '<p class="hint">Хочешь без сервера, только на своём компьютере? Это другая установка: docs/modes.md в репозитории.</p>' : '');
    const m = state.modes[modePick];
    $('#modeInfo').innerHTML = `<div class="modeinfo"><b>Работает:</b><ul>${m.works.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><b>Не будет:</b><ul>${m.not.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${modePick === 'both' ? '<p>Команду для подключения компьютера покажу в конце.</p>' : ''}${state.russia || modePick !== 'computer' ? '' : ''}</div>`;
  }

  // ---------- mail and Google ----------
  let conn = null;
  async function renderConnect() {
    conn = await api('connect');
    const m = conn.mail;
    $('#mailOk').hidden = !m.configured;
    $('#mailOk').textContent = m.configured ? `✓ Почта подключена: ${m.address}` : '';
    $('#mailForm').hidden = m.configured;
    const g = conn.google;
    $('#googleOk').hidden = !g.connected;
    $('#googleOk').textContent = g.connected ? `✓ Google подключён: ${g.email}` : '';
    $('#googleBox').hidden = g.connected;
    $('#googleClient').hidden = g.clientSet;
    $('#googleLogin').hidden = !g.clientSet;
  }
  async function mailHint(address) {
    if (!/@/.test(address)) return;
    const { preset } = await api('mail-preset', { address });
    $('#mailHint').textContent = preset ? `${preset.name}. ${preset.help}` : 'Почта на своём домене: впиши серверы IMAP и SMTP (их даёт хостинг почты).';
    $('#mailServers').hidden = Boolean(preset);
  }

  // ---------- summary ----------
  function renderSummary() {
    const m = state.model;
    $('#summary').innerHTML = [
      `Тебя зовут ${esc(state.owner)}, пояс ${esc(state.tz)}`,
      m.provider === 'claude' ? 'ИИ: Claude по твоей подписке' : `ИИ: ${esc(m.name)}, модель ${esc(m.main || '')}`,
      `Бот: @${esc(state.bot.username)}`,
    ].map((t) => `<li>${t}</li>`).join('');
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pick]');
    if (p) return setPick(p.dataset.pick);
    const md = e.target.closest('[data-mode]');
    if (md) { modePick = md.dataset.mode; return renderMode(); }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'claude-start') {
      busy(a, async () => {
        const { url } = await api('claude-start', {});
        const link = $('#claudeLink');
        link.href = url; link.hidden = false;
        $('#claudeCode').hidden = false;
        window.open(url, '_blank', 'noopener');
      });
    }
    if (a.dataset.act === 'mode') busy(a, async () => next(await api('mode', { mode: modePick })));
    if (a.dataset.act === 'connect-done') busy(a, async () => next(await api('connect-done', {})));
    if (a.dataset.act === 'google-start') {
      busy(a, async () => {
        const { url } = await api('google-start', {});
        const link = $('#googleLink');
        link.href = url; link.hidden = false;
        window.open(url, '_blank', 'noopener');
      });
    }
    if (a.dataset.act === 'finish') {
      busy(a, async () => {
        const d = await api('finish', {});
        $('#botLink').href = d.link;
        $('#botLink').textContent = `Открыть @${d.bot}`;
        if (d.dashboard) $('#dashLink').href = d.dashboard; else $('#dashLink').hidden = true;
        if (d.bridge) { $('#bridgeBox').hidden = false; $('#cmdMac').textContent = d.bridge.mac; $('#cmdWin').textContent = d.bridge.windows; }
        show('launched');
      });
    }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'provider') providerHint(); if (e.target.name === 'address') mailHint(e.target.value); });

  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const btn = f.querySelector('button');
    const v = Object.fromEntries(new FormData(f));
    const kind = f.dataset.form;
    busy(btn, async () => {
      if (kind === 'login') { await api('login', { code: v.code }); state = await api('state'); fillTz(); $('#russia').checked = state.russia; return next(state); }
      if (kind === 'profile') return next(await api('profile', { name: v.name, tz: v.tz, russia: $('#russia').checked }));
      if (kind === 'claude-code') return next(await api('claude-code', { code: v.code }));
      if (kind === 'claude-token') return next(await api('claude-token', { token: v.token }));
      if (kind === 'mail') { btn.textContent = 'Проверяю почту…'; await api('mail', v); return renderConnect(); }
      if (kind === 'google-client') { await api('google-client', v); return renderConnect(); }
      if (kind === 'google-finish') { await api('google-finish', { pasted: v.pasted }); return renderConnect(); }
      if (kind === 'bot') return next(await api('bot', { token: v.token }));
      if (kind === 'model') {
        const body = { provider: v.provider, key: v.key, baseUrl: v.baseUrl || undefined, main: v.main || undefined };
        btn.textContent = 'Проверяю, до минуты…';
        const t = await api('model-test', body);
        if (!t.ok) throw new Error(`Сервис не ответил: ${t.error || 'пустой ответ'}. Проверь ключ и баланс.`);
        return next(await api('model', body));
      }
    });
  });

  // ---------- start ----------
  const autoCode = new URLSearchParams(location.search).get('code');
  if (autoCode) history.replaceState(null, '', location.pathname);
  (autoCode ? api('login', { code: autoCode }).catch(() => null) : Promise.resolve()).then(() => api('state')).then((s) => { state = s; fillTz(); if (s.russia) $('#russia').checked = true; if (s.owner) document.querySelector('[name=name]').value = s.owner; next(s); })
    .catch((e) => { show('login'); if (e.status === 404) { err('Настройка уже завершена. Пульт открывается по ссылке из бота.'); document.querySelector('[data-form=login]').hidden = true; } });
})();
