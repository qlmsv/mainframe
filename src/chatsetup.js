// Setup right in the chat with the bot, no browser and no terminal. The install line carries only the
// bot key; the first person who writes to the fresh bot becomes its owner (nobody else knows the bot
// yet; OWNER_CODE, if set in the install line, must be sent first). Then: name, time zone, which
// model (buttons), its key (the message with the key is deleted right after saving), a check, and the
// get-to-know talk. On for installs with CHAT_SETUP=on; works the same in Telegram and MAX.
// A channel gives a port: { send(text, buttons?) → id, del(messageId) → bool, canDelete }.
// Buttons: rows of { text, data } or { text, url }. Text is simple HTML (<b>, <i>, <a>, <code>).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { kvGet, kvSet, addLog } from './db.js';
import { PROVIDERS, saveModelSettings, testModel, modelState } from './models.js';

const env = (k) => String(process.env[k] ?? '').trim();
export const chatSetupOn = () => ['on', '1', 'yes', 'true'].includes(env('CHAT_SETUP').toLowerCase()) && !kvGet('chat_setup_done', false);
const st = () => kvGet('chat_setup', { step: 'claim' });
const setSt = (v) => kvSet('chat_setup', v);

const ENV_FILE = path.join(ROOT, '.env');
function writeEnv(pairs) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${String(v).replace(/[\r\n]/g, '')}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
    process.env[k] = String(v);
  }
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

// Time zones as buttons: the common ones, anything else typed (Europe/Berlin or a city from the list).
const ZONES = [
  ['Москва', 'Europe/Moscow'], ['Калининград', 'Europe/Kaliningrad'], ['Самара', 'Europe/Samara'],
  ['Екатеринбург', 'Asia/Yekaterinburg'], ['Омск', 'Asia/Omsk'], ['Новосибирск', 'Asia/Novosibirsk'],
  ['Красноярск', 'Asia/Krasnoyarsk'], ['Иркутск', 'Asia/Irkutsk'], ['Владивосток', 'Asia/Vladivostok'],
  ['Минск', 'Europe/Minsk'], ['Алматы', 'Asia/Almaty'], ['Ташкент', 'Asia/Tashkent'],
  ['Тбилиси', 'Asia/Tbilisi'], ['Ереван', 'Asia/Yerevan'], ['Дубай', 'Asia/Dubai'], ['Бангкок', 'Asia/Bangkok'],
];
// Chinese models first (they work from anywhere with their own key), then the rest.
const MODEL_BUTTONS = ['deepseek', 'glm', 'kimi', 'qwen', 'claude', 'openrouter'];
const KEY_HELP = {
  deepseek: 'platform.deepseek.com → API keys → Create new API key',
  glm: 'z.ai → войти → API Keys → Create a new API key',
  kimi: 'platform.kimi.ai → Console → API Keys → Create',
  qwen: 'modelstudio.console.alibabacloud.com → API Key → Create API Key',
  openrouter: 'openrouter.ai/keys → Create Key',
};

const validZone = (z) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };

async function ask(port, step) {
  const s = st();
  if (step === 'name') return port.send('Как тебя зовут? Напиши имя, как к тебе обращаться.');
  if (step === 'tz') {
    const rows = [];
    for (let i = 0; i < ZONES.length; i += 3) rows.push(ZONES.slice(i, i + 3).map(([t, z]) => ({ text: t, data: `cs:tz:${z}` })));
    return port.send('Где ты живёшь? Выбери часовой пояс. Если твоего нет, напиши его, например <code>Europe/Berlin</code>.', rows);
  }
  if (step === 'model') {
    const rows = [];
    const names = MODEL_BUTTONS.map((id) => ({ text: PROVIDERS[id].name.replace(/\s*\(.*\)/, ''), data: `cs:m:${id}` }));
    for (let i = 0; i < names.length; i += 2) rows.push(names.slice(i, i + 2));
    return port.send('Какой ИИ будет у меня внутри? Нужен ключ этого сервиса (кроме Claude по подписке: там вход по ссылке).\n\n<b>DeepSeek</b> самый простой и недорогой, с него удобно начать.', rows);
  }
  if (step === 'key') {
    const p = PROVIDERS[s.provider];
    const del = port.canDelete ? 'Сообщение с ключом я сразу удалю из чата.' : 'Здесь я не могу удалить твоё сообщение: после проверки удали его сам (зажми сообщение → Удалить).';
    return port.send(`Пришли ключ ${p.name.replace(/\s*\(.*\)/, '')} одним сообщением.\n\nГде взять: ${KEY_HELP[s.provider] || p.keys}${p.keys ? `\n<a href="${p.keys}">Открыть страницу ключей</a>` : ''}\n\n${del}`);
  }
  if (step === 'claude') {
    const { claudeStart } = await import('./setup.js');
    try {
      const { url } = await claudeStart();
      return port.send(`1. Открой ссылку, войди в Claude и нажми «Authorize».\n2. Скопируй код, который покажет Claude, и пришли сюда.\n\n<a href="${url}">Войти в Claude</a>\n\nНужна подписка Claude Pro или Max.`, [[{ text: 'Выбрать другой ИИ', data: 'cs:back' }]]);
    } catch (e) { setSt({ ...s, step: 'model' }); await port.send(`Вход в Claude не открылся: ${e.message}`); return ask(port, 'model'); }
  }
  return null;
}

// The first message to a fresh bot. Returns true when this person is now the owner.
export async function claim(port, user, text) {
  const code = env('OWNER_CODE');
  if (code && !String(text || '').includes(code)) {
    await port.send('Это чужой помощник. Если он твой, пришли код из строки установки.');
    return false;
  }
  addLog('system', `Владелец помощника: ${user.username || user.id} (первым написал боту)`);
  setSt({ step: 'name' });
  await port.send('👋 <b>Привет! Я твой новый помощник.</b> Теперь я слушаюсь только тебя.\n\nНастроим меня за 2 минуты: имя, часовой пояс и какой ИИ будет внутри.');
  await ask(port, 'name');
  return true;
}

// A button press during setup (data starting with "cs:").
export async function onButton(port, data) {
  const s = st();
  const [, kind, ...rest] = data.split(':');
  const value = rest.join(':');
  if (kind === 'tz' && s.step === 'tz') return saveZone(port, value);
  if (kind === 'm' && ['model', 'key', 'claude'].includes(s.step) && PROVIDERS[value]) {
    setSt({ ...s, provider: value, step: value === 'claude' ? 'claude' : 'key' });
    return ask(port, value === 'claude' ? 'claude' : 'key');
  }
  if (kind === 'back') { setSt({ ...s, step: 'model' }); return ask(port, 'model'); }
  return null;
}

async function saveZone(port, z) {
  if (!validZone(z)) return port.send('Не знаю такой пояс. Выбери кнопкой или напиши как <code>Europe/Berlin</code>.');
  writeEnv({ OWNER_TZ: z });
  process.env.TZ = z;
  config.timezone = z;
  setSt({ ...st(), step: 'model' });
  await port.send(`Пояс: ${z}. Сейчас у тебя ${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: z })}.`);
  return ask(port, 'model');
}

// A text message during setup. Returns { done } when setup finished (the caller starts the talk).
export async function onText(port, text, messageId) {
  const s = st();
  const t = String(text || '').trim();
  if (s.step === 'name') {
    if (!t || t.length > 60 || t.startsWith('/')) return port.send('Напиши просто имя, например «Анна».');
    writeEnv({ OWNER_NAME: t });
    config.owner.name = t;
    setSt({ ...s, step: 'tz' });
    await port.send(`Приятно познакомиться, ${t}!`);
    return ask(port, 'tz');
  }
  if (s.step === 'tz') {
    const hit = ZONES.find(([name]) => name.toLowerCase() === t.toLowerCase());
    return saveZone(port, hit ? hit[1] : t);
  }
  if (s.step === 'model') return ask(port, 'model');
  if (s.step === 'key' || s.step === 'claude') {
    // The key or the code: off the chat first, then check.
    const gone = messageId ? await port.del(messageId).catch(() => false) : false;
    if (s.step === 'claude') {
      const { claudeCode } = await import('./setup.js');
      try { await claudeCode({ code: t }); } catch (e) { return port.send(`${e.message}${gone ? '' : '\nУдали сообщение с кодом из чата.'}`, [[{ text: 'Выбрать другой ИИ', data: 'cs:back' }]]); }
    } else {
      if (t.length < 16 || /\s/.test(t)) return port.send('Это не похоже на ключ. Скопируй его целиком и пришли одним сообщением.');
      saveModelSettings({ provider: s.provider, key: t });
    }
    await port.send(`${gone ? '🔒 Сообщение с ключом удалил. ' : ''}Проверяю, отвечает ли ИИ, до минуты…`);
    const r = await testModel({});
    if (!r.ok) {
      return port.send(`Не получилось: ${r.error || 'пустой ответ'}.\nПроверь ключ и баланс у сервиса и пришли ключ ещё раз.`, [[{ text: 'Выбрать другой ИИ', data: 'cs:back' }]]);
    }
    kvSet('chat_setup_done', true);
    setSt({ step: 'done' });
    addLog('system', `Настройка в чате завершена: ${modelState().name}`);
    await port.send(`✅ <b>Готово, ИИ отвечает</b> (${(r.ms / 1000).toFixed(1)} с).${gone ? '' : '\n\n⚠️ Удали своё сообщение с ключом из чата: зажми его → Удалить.'}\n\nТеперь познакомимся: задам около 10 коротких вопросов о тебе и твоих делах. Отвечай как другу, можно голосом.`);
    return { done: true };
  }
  return null;
}

export const setupStep = () => st().step;
