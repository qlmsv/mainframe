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
// Mail and calendar words count for the Mac only when there is no Composio: with it, mail, calendar
// and drive go through Composio (works with the Mac off), Apple Mail on the Mac is the spare way,
// named directly («почта на маке», «apple»).
const MAIL_WORDS = ['почт', 'письм', 'mail', 'inbox', 'календар', 'встреч', 'событи', 'напомина', 'reminder', 'заметк', 'notes', 'контакт'];
export const MAC_WORDS = [
  'mac', 'мак', 'компьютер', 'экран', 'скриншот', 'кликни', 'нажми', 'окно', 'приложени', 'finder', 'терминал на маке',
  'браузер', 'chrome', 'хром', 'сайт', 'страниц', 'открой', 'зайди', 'залогин', 'войди', 'http',
  'музык', 'music', 'фото', 'photos', 'shortcut', 'быстрые команды', 'imessage', 'сообщения на маке', 'safari',
  'instagram', 'инстаграм', 'инсту', 'insta', 'директ', 'linkedin', 'линкедин', 'линкедн',
  'jev', 'cua', 'apple', 'icloud',
];
export const MAC_SERVERS = ['apple', 'computer', 'chrome', 'jev', 'cua', 'browser', 'windows'];
// claude.ai connectors (Notion, Metricool, Claude docs...): only when named. Gmail, Google and Trello
// count only without Composio (it covers them).
export const CONNECTOR_WORDS = ['notion', 'ноушн', 'metricool', 'метрикул', 'claude docs', 'документ claude', 'соцсет'];
const CONNECTOR_GOOGLE_WORDS = ['trello', 'трелло', 'gmail', 'гмейл', 'google', 'гугл', 'drive', 'диск'];
// Composio (mcp.json server «composio»): mail, calendar, Google, Yandex, socials, GitHub, Trello...
export const COMPOSIO_WORDS = [
  ...MAIL_WORDS, 'gmail', 'гмейл', 'google', 'гугл', 'drive', 'диск', 'документ', 'docs', 'таблиц', 'sheet', 'meet', 'созвон',
  'analytics', 'аналитик', 'search console', 'яндекс', 'yandex', 'instagram', 'инстаграм', 'инсту', 'threads', 'тредс',
  'linkedin', 'линкедин', 'youtube', 'ютуб', 'github', 'гитхаб', 'supabase', 'render', 'trello', 'трелло', 'карточк', 'доск',
  'composio', 'композио', 'соцсет', 'статистик', 'трафик', 'посещ',
];
// Telegram (the owner's account): the owner's own chat always has it; background work only when about Telegram.
export const TELEGRAM_WORDS = [
  'telegram', 'телеграм', 'телега', 'тг', 'tg', 'чат', 'канал', 'групп', 'переписк', 'сообщени', 'личк', 'диалог', 'непрочитан',
  'написал', 'напиши', 'ответь', 'перешли', 'избранн', 'контакт', 'конкурент', 'подписчик', 'пост', 'входящ', '@',
];
// Rarely needed Telegram tools (admin, folders, profile, stickers...): left out unless the request is about them.
export const TG_RARE_TOOLS = [
  'ban_user', 'unban_user', 'get_banned_users', 'promote_admin', 'demote_admin', 'edit_admin_rights', 'set_default_chat_permissions',
  'toggle_slow_mode', 'create_channel', 'create_group', 'upgrade_group_to_supergroup', 'edit_chat_photo', 'delete_chat_photo',
  'edit_chat_title', 'edit_chat_about', 'set_profile_photo', 'delete_profile_photo', 'update_profile', 'set_privacy_settings',
  'get_privacy_settings', 'set_bot_commands', 'get_bot_info', 'create_folder', 'delete_folder', 'update_folder', 'reorder_folders',
  'add_chat_to_folder', 'remove_chat_from_folder', 'get_folder_limits', 'get_chatlist_invite', 'export_chat_invite',
  'import_chat_invite', 'join_chat_by_link', 'delete_chat_history', 'create_forum_topic', 'edit_forum_topic', 'delete_forum_topic',
  'enable_forum_topics', 'list_forum_topic_icons', 'get_custom_emoji_pack', 'get_custom_emoji_packs', 'preview_custom_emoji',
  'get_sticker_sets', 'send_sticker', 'get_gif_search', 'send_gif', 'block_user', 'unblock_user', 'get_blocked_users',
  'delete_contact', 'import_contacts', 'export_contacts', 'set_default_send_as', 'get_send_as', 'enable_incoming_feed',
  'disable_incoming_feed', 'incoming_feed_status', 'wait_for_events', 'list_accounts', 'vote_poll', 'create_poll',
  'get_recent_actions', 'delete_messages_bulk', 'leave_chat', 'remove_user', 'invite_to_group', 'unpin_all_messages',
  'subscribe_public_channel', 'set_contact_alias', 'delete_contact_alias', 'list_contact_aliases',
].map((t) => `mcp__telegram__${t}`);
const TG_RARE_WORDS = ['админ', 'бан', 'папк', 'folder', 'профил', 'аватар', 'приватн', 'стикер', 'гиф', 'gif', 'опрос', 'poll', 'топик', 'форум',
  'заблок', 'разблок', 'выйди из', 'покинь', 'удали чат', 'очисти чат', 'создай канал', 'создай групп', 'пригласи', 'исключи', 'импорт', 'экспорт', 'подпишись', 'вступи'];

const has = (text, words) => { const t = String(text || '').toLowerCase(); return words.some((w) => t.includes(w)); };

// context: this message plus the project's recent prompts (a follow-up like "да" to a browser task).
// projectId: projects listed in CONNECTOR_PROJECTS always get the claude.ai connectors and Composio
// (a social media project needs Metricool even when the message does not name it).
// origin: the owner's own chat (bot, ui) keeps Telegram; scheduled and other background work gets it by words.
// composioOn: Composio is configured (mcp.json has «composio»).
export function chooseTools({ prompt, recent = '', projectId = null, origin = 'bot', composioOn = false }) {
  if (!config.toolRouting) return { mac: true, connectors: true, telegram: true, composio: true, tgRare: true, why: 'все инструменты' };
  const ctx = `${prompt}\n${recent}`;
  const mac = has(ctx, [...MAC_WORDS, ...(composioOn ? [] : MAIL_WORDS), ...moduleRoutingWords()]);
  const byProject = Boolean(projectId) && config.connectorProjects.includes(Number(projectId));
  const connectors = byProject || has(ctx, [...CONNECTOR_WORDS, ...(composioOn ? [] : CONNECTOR_GOOGLE_WORDS)]);
  const composio = composioOn && (byProject || has(ctx, COMPOSIO_WORDS));
  const telegram = ['bot', 'ui'].includes(origin) || has(ctx, TELEGRAM_WORDS);
  const tgRare = telegram && has(ctx, TG_RARE_WORDS);
  const why = [
    mac ? 'Mac и браузер' : null,
    composio ? 'Composio' : null,
    connectors ? `коннекторы claude.ai${byProject ? ' (проект)' : ''}` : null,
    telegram ? `telegram${tgRare ? ' (все)' : ''}` : null,
  ].filter(Boolean).join(', ') || 'только mainframe';
  return { mac, connectors, telegram, composio, tgRare, why };
}
