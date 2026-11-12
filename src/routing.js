// What each run gets: the model and the tools, chosen from the text before the session starts.
// Cheap rules, no model call. When unsure: Opus and every tool (the safe side).
import { config } from './config.js';
import { mainModel, fastModel } from './models.js';
import { moduleRoutingWords } from './modules.js';

// ---------- 1. model ----------
// A reply to the session, not a new job: "да", "не надо", "оставь как есть", a short question.
const ANSWER_RE = /^(привет|здравствуй|доброе утро|добрый вечер|да|ага|угу|ок|окей|ok|хорошо|норм|нормально|отлично|супер|спасибо|благодарю|нет|не надо|не нужно|не стоит|отмена|отмени|стоп|потом|позже|не сейчас|оставь( как есть)?|пусть так|не трогай|понял|ясно|принято|согласен|верно|точно|👍|👌|🙏|❤️|\+|-)([\s,.!)(]+(да|спасибо|пока|так|оставь|как есть|не надо|понял|ок|👍))*[\s.!)(]*$/i;
// Work: code, several steps, files, links, sending, analysis. Any of these keeps Opus.
const WORK_RE = /(сдела|напиш|исправ|почин|найд|провер|постав|запуст|созда|отправ|посчита|перевед|собер|добав|удал|настро|перепиш|сравн|анализ|разбер|помен|измен|обнов|задеплой|деплой|выкат|сгенер|состав|подготов|опубли|закоммит|коммит|пуш|push|commit|код|скрипт|сервер|баг|ошибк|файл|таблиц|отчёт|отчет|план|пост|письм|рассыл|ответь|напомни|запомни|забудь|выясни|узнай|покажи|пришли|скачай|загрузи|оплат|купи|продай|переведи|почему|как сделать|https?:\/\/|\/Users\/|Вложения)/i;

// resume: the session already has history. Switching models there loses the prompt cache and costs
// more than it saves (measured 12.11.2026: Sonnet after Opus $1.33 for a short answer, Opus with a warm
// cache $0.10–0.40). So a running session keeps the model it had; the fast one is for new sessions only.
export function chooseModel({ prompt, origin, resume = false, lastModel = null }) {
  const opus = mainModel(config.workModel || undefined);
  const fast = fastModel(config.fastModel);
  // The last model counts only if the current provider has it (after a provider switch it does not).
  const keep = lastModel && [opus, fast].includes(lastModel) ? lastModel : null;
  if (resume) return { model: keep || opus, why: keep ? 'та же модель, что в этой сессии (кэш)' : 'сессия продолжается, основная модель' };
  if (!config.modelRouting || !fast || fast === opus) return { model: opus, why: 'одна модель для всех' };
  if (!['bot', 'ui'].includes(origin)) return { model: opus, why: origin === 'cron' ? 'задача по расписанию' : 'входящее' };
  const t = String(prompt || '').trim();
  if (t.length > 120 || t.includes('\n')) return { model: opus, why: 'развёрнутая задача' };
  if (WORK_RE.test(t)) return { model: opus, why: 'похоже на работу' };
  if (ANSWER_RE.test(t)) return { model: fast, why: 'короткий ответ, новая сессия' };
  if (/\?\s*$/.test(t) && t.length <= 80) return { model: fast, why: 'короткий вопрос, новая сессия' };
  return { model: opus, why: 'неясно, беру сильную' };
}

// ---------- 2. tools ----------
// Mac, apps, browser and sites: apple, computer, chrome, jev, cua load only when the work is about them.
// Optional modules add their own words (src/modules.js routingWords).
export const MAC_WORDS = [
  'mac', 'мак', 'компьютер', 'экран', 'скриншот', 'кликни', 'нажми', 'окно', 'приложени', 'finder', 'терминал на маке',
  'браузер', 'chrome', 'хром', 'сайт', 'страниц', 'открой', 'зайди', 'залогин', 'войди', 'http',
  'почт', 'письм', 'mail', 'inbox', 'календар', 'встреч', 'событи', 'напомина', 'reminder', 'заметк', 'notes', 'контакт',
  'музык', 'music', 'фото', 'photos', 'shortcut', 'быстрые команды', 'imessage', 'сообщения на маке', 'safari',
  'instagram', 'инстаграм', 'инсту', 'insta', 'директ', 'linkedin', 'линкедин', 'линкедн',
  'jev', 'cua', 'apple', 'icloud', 'сводк',
];
export const MAC_SERVERS = ['apple', 'computer', 'chrome', 'jev', 'cua', 'browser', 'windows'];
// claude.ai connectors (Notion, Trello, Gmail, Google, Metricool...): only when named.
export const CONNECTOR_WORDS = ['notion', 'ноушн', 'trello', 'трелло', 'gmail', 'гмейл', 'google', 'гугл', 'drive', 'диск', 'metricool', 'метрикул', 'claude docs', 'документ claude', 'соцсет'];

const has = (text, words) => { const t = String(text || '').toLowerCase(); return words.some((w) => t.includes(w)); };

// context: this message plus the project's recent prompts (a follow-up like "да" to a browser task).
export function chooseTools({ prompt, recent = '' }) {
  if (!config.toolRouting) return { mac: true, connectors: true, why: 'все инструменты' };
  const ctx = `${prompt}\n${recent}`;
  const mac = has(ctx, [...MAC_WORDS, ...moduleRoutingWords()]);
  const connectors = has(ctx, CONNECTOR_WORDS);
  return { mac, connectors, why: [mac ? 'Mac и браузер' : null, connectors ? 'коннекторы claude.ai' : null].filter(Boolean).join(', ') || 'только telegram и mainframe' };
}
