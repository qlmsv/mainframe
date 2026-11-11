import fs from 'node:fs';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { config } from './config.js';
import { all, addLog } from './db.js';
import { saveMemory, deleteMemory, listMemory } from './memory.js';
import { recallHybrid, recallOpen, formatRecall } from './recall.js';
import { MAC_SERVERS } from './routing.js';
import { addRule, listRules, deleteRule, previewRule, ACTIONS } from './inbox-rules.js';
import { moduleTools } from './modules.js';

const handlers = {
  notify: async () => { throw new Error('Бот не настроен'); },
  createTask: async () => { throw new Error('Планировщик не запущен'); },
};
export const setMainframeHandlers = (h) => Object.assign(handlers, h);

export function readMcpConfig() {
  if (!fs.existsSync(config.mcpFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(config.mcpFile, 'utf8'));
    const servers = raw.mcpServers || raw;
    return Object.fromEntries(Object.entries(servers).filter(([name, s]) => !name.startsWith('_') && s && !s.disabled));
  } catch (e) {
    addLog('error', `mcp.json не читается: ${e.message}`);
    return {};
  }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });

const RULE_SHAPE = {
  text: z.string().optional().describe('формулировка владельца, например «GitHub тихо, кроме упоминаний меня»'),
  description: z.string().optional().describe('описание правила словами'),
  source: z.enum(['telegram', 'mail', 'group']).optional(),
  chat_id: z.string().optional(),
  sender: z.string().optional().describe('часть имени, @ника или адреса почты'),
  keywords: z.array(z.string()).optional().describe('хотя бы одно слово должно быть в тексте'),
  action: z.enum(['show', 'quiet', 'skip', 'batch', 'urgent']).optional(),
  except_keywords: z.array(z.string()).optional(),
  except_text: z.string().optional().describe('размытое исключение словами, решает диспетчер'),
  days: z.number().int().optional().describe('для preview: за сколько дней, по умолчанию 7'),
};

// Only a phrase given: turn it into a rule with a quick model call, using the senders seen in the inbox.
async function ruleFromArgs(a) {
  if (a.action && (a.source || a.chat_id || a.sender || a.keywords?.length)) return { ...a, description: a.description || a.text || 'Правило' };
  if (!a.text) throw new Error('Нужна структура правила или text');
  const senders = all("SELECT source, chat_id, name, username, COUNT(*) n FROM inbox WHERE created_at > ? GROUP BY chat_id ORDER BY n DESC LIMIT 40", Date.now() - 30 * 86400000)
    .map((x) => `${x.source} | chat_id ${x.chat_id} | ${x.name}${x.username ? ` | ${x.username}` : ''} | ${x.n}`).join('\n');
  const { structured } = await import('./agent.js');
  const out = await structured({
    prompt: `Правило владельца для входящих: «${a.text}»\n\nОтправители за 30 дней (источник | chat_id | имя | ник или почта | сколько):\n${senders}`,
    schema: { type: 'object', properties: {
      description: { type: 'string' }, source: { type: ['string', 'null'], enum: ['telegram', 'mail', 'group', null] }, chat_id: { type: ['string', 'null'] },
      sender: { type: ['string', 'null'], description: 'часть имени, ника или почты, нижний регистр' }, keywords: { type: 'array', items: { type: 'string' } },
      action: { type: 'string', enum: ['show', 'quiet', 'skip', 'batch', 'urgent'] }, except_keywords: { type: 'array', items: { type: 'string' } }, except_text: { type: ['string', 'null'] },
    }, required: ['description', 'action'] },
    system: 'Переведи правило владельца в структуру. Условие делай точным: chat_id или sender из списка отправителей. «Не показывай/тихо» = quiet, «убери/пропускай» = skip, «пакетом/раз в час» = batch, «срочно/сразу» = urgent. Однозначные исключения словами в except_keywords, размытые («кроме подозрительного», «если вопрос мне») в except_text.',
    tools: [], maxTurns: 2,
  });
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
}

// A fresh in-process server per query: instances are not shared between sessions.
function mainframeServer() {
  return createSdkMcpServer({
    name: 'mainframe',
    version: '0.1.0',
    tools: [
      tool('notify_owner', 'Отправить владельцу сообщение в его бот управления (итог, вопрос, напоминание).',
        { text: z.string().describe('Текст сообщения') },
        async ({ text: t }) => { await handlers.notify(t); return text('Отправлено владельцу'); }),
      tool('create_cron_task', 'Создать задачу по расписанию в мейнфрейме. cron в формате "мин час день месяц день_недели", часовой пояс сервера.',
        {
          name: z.string(),
          cron: z.string().describe('Например "0 9 * * 1-5"'),
          prompt: z.string().describe('Что сделать при запуске'),
          project_id: z.number().int().optional().describe('ID проекта; без него задача идёт в общий проект'),
        },
        async (args) => { const id = await handlers.createTask(args); return text(`Задача создана, id ${id}`); }),
      tool('save_social_report', 'Сохранить сводку по соцсетям для вкладки «Соцсети» в пульте. Вызывай в конце задачи «Сводка по соцсетям».',
        {
          period: z.string().describe('Например "1–7 ноября"'),
          summary: z.string().describe('Итог в 1-3 предложения'),
          networks: z.array(z.object({
            network: z.string().describe('instagram, tiktok, youtube, threads, facebook, telegram'),
            handle: z.string().optional(),
            followers: z.number().nullable().optional(),
            followers_change: z.number().nullable().optional().describe('Прирост за 7 дней'),
            views: z.number().nullable().optional().describe('Просмотры или показы за 7 дней'),
            reach: z.number().nullable().optional(),
            posts: z.number().nullable().optional().describe('Публикаций за 7 дней'),
            engagement: z.number().nullable().optional().describe('Вовлечённость, %'),
            change_note: z.string().optional().describe('Сравнение с прошлой неделей словами'),
            note: z.string().optional(),
          })),
          best_times: z.array(z.object({ network: z.string(), slots: z.array(z.string()).describe('Например "вт 19:00"') })).optional(),
          scheduled: z.array(z.object({ network: z.string(), when: z.string(), text: z.string() })).optional(),
          advice: z.array(z.string()).describe('3-5 конкретных советов из цифр'),
        },
        async (report) => { handlers.saveSocial(report); return text('Сводка сохранена, вкладка «Соцсети» обновлена'); }),
      tool('restart_mainframe', 'Перезапустить мейнфрейм, чтобы применить изменения в его коде (src/*.js). Перезапуск произойдёт сам, когда закончатся все текущие задачи, включая эту: сначала закончи ответ.', {},
        async () => { handlers.requestRestart(); return text('Перезапуск запланирован: мейнфрейм перезапустится, когда закончатся все задачи (около 5 секунд после последней).'); }),
      tool('add_expense', 'Записать расход владельца во вкладку «Финансы» (чек, перевод, наличные). Сумма числом, валюта кодом ISO (RUB, USD, EUR, KZT…), как в чеке.',
        {
          amount: z.number(),
          currency: z.string().default(config.currency),
          merchant: z.string().optional().describe('Где или кому'),
          category: z.string().optional().describe('Например еда, транспорт и доставка, жильё, сервисы и подписки'),
          note: z.string().optional(),
          at: z.string().optional().describe('Дата и время ISO; без него сейчас'),
        },
        async (e) => { const r = handlers.addExpense({ ...e, at: e.at ? Date.parse(e.at) : undefined, source: 'сессия' }); return text(r.added ? `Записано, id ${r.id}` : 'Такой расход уже есть'); }),
      tool('set_balance', 'Обновить остаток на счёте владельца во вкладке «Финансы» (по скриншоту банка или биржи). account: понятное имя счёта, например «Основная карта», «Сбережения», «Биржа (все активы)».',
        { account: z.string(), amount: z.number(), currency: z.string(), note: z.string().optional() },
        async (b) => { handlers.setBalance(b); return text('Остаток обновлён'); }),
      tool('list_expenses', 'Расходы владельца за период и итоги по валютам и категориям за месяц.',
        { days: z.number().int().default(1).describe('За сколько последних дней') },
        async ({ days }) => text(JSON.stringify(handlers.financeSummaryFor(days), null, 1))),
      tool('linkedin_post', 'Опубликовать пост в LinkedIn от имени владельца. ВЫЗЫВАЙ ТОЛЬКО после того, как показал владельцу итоговый текст и он явно ответил «да»/«публикуй». Можно со ссылкой (появится карточка ссылки).',
        { text: z.string().max(3000), link: z.string().url().optional() },
        async (a) => { const r = await handlers.linkedinPost(a); return text(r.url ? `Опубликовано: ${r.url}` : 'Опубликовано'); }),
      tool('linkedin_status', 'Подключён ли LinkedIn владельца и сколько дней осталось до переподключения.', {},
        async () => text(JSON.stringify(handlers.linkedinStatus()))),
      tool('content_save_drafts', 'Сохранить черновики постов в студию вкладки «Соцсети» (владелец поправит, запланирует или опубликует сам). Используй, когда владелец просит написать посты. В тексте можно поставить {{link}}: подставится ссылка на бесплатный урок с меткой этого поста.',
        { topic: z.string(), posts: z.array(z.object({ network: z.enum(['telegram', 'linkedin', 'instagram', 'threads', 'tiktok', 'youtube', 'facebook']), text: z.string(), notes: z.string().optional().describe('Сценарий рилс или слайды карусели') })) },
        async (a) => { const ids = handlers.contentSaveDrafts(a); return text(`Сохранено черновиков: ${ids.length}. Они во вкладке «Соцсети» → «Студия».`); }),
      tool('content_mark', 'Отметить результат постановки поста студии в Metricool.',
        { id: z.number().int(), status: z.enum(['scheduled', 'metricool_draft', 'published', 'failed']), url: z.string().optional(), error: z.string().optional() },
        async (a) => { handlers.contentMark(a); return text('Отмечено'); }),
      tool('content_add_competitors', 'Добавить Telegram-каналы в список наблюдения во вкладке «Соцсети» → «Конкуренты».',
        { usernames: z.array(z.string()) },
        async ({ usernames }) => { const out = []; for (const u of usernames) { try { await handlers.contentAddCompetitor(u); out.push(`${u}: ок`); } catch (e) { out.push(`${u}: ${e.message}`); } } return text(out.join('\n')); }),
      tool('content_save_ideas', 'Добавить темы в банк идей вкладки «Соцсети».',
        { ideas: z.array(z.object({ title: z.string(), angle: z.string().optional(), why: z.string().optional(), score: z.number().int().min(1).max(10).optional() })) },
        async ({ ideas }) => { for (const i of ideas) handlers.contentAddIdea({ ...i, source: 'сессия' }); return text(`Добавлено идей: ${ideas.length}`); }),
      tool('memory_save', 'Сохранить или обновить заметку в общей памяти владельца (видна всем сессиям мейнфрейма). Одна заметка на факт; та же name перезаписывает заметку. type: user (кто владелец), feedback (правило работы, с причиной), people (человек и отношения), project (проект, решение, договорённость, с датой), reference (где что лежит, ссылки).',
        { name: z.string().describe('короткий slug, латиница или кириллица через дефис'), title: z.string(), description: z.string().describe('одна строка: о чём заметка, для оглавления'), type: z.enum(['user', 'feedback', 'people', 'project', 'reference']), body: z.string().describe('сам факт; для правил и решений добавь «Почему:» и «Как применять:»; даты абсолютные'), pending: z.boolean().optional().describe('true: не сразу в память, а владельцу на проверку (для ночной выжимки)') },
        async (a) => { const r = saveMemory(a); return text(r.pending ? `Отправлено владельцу на проверку: ${r.file}` : r.updated ? `Обновлено: ${r.file}` : `Сохранено: ${r.file}`); }),
      tool('memory_delete', 'Убрать устаревшую или неверную заметку из общей памяти владельца.', { name: z.string() },
        async ({ name }) => { deleteMemory(name); return text('Убрано'); }),
      tool('inbox_rule_preview', 'Что правило входящих отсеяло бы за последние дни: число и примеры. Вызывай ПЕРЕД inbox_rule_add и покажи владельцу итог; сохраняй правило только после его «да». Можно передать готовую структуру или только text (формулировку владельца).', RULE_SHAPE,
        async (a) => { const r = await ruleFromArgs(a); const p = previewRule(r, a.days || 7); return text(JSON.stringify({ rule: r, preview: p }, null, 1)); }),
      tool('inbox_rule_add', 'Сохранить правило входящих (после «да» владельца на preview). Действия: show (показывать), quiet (учитывать тихо: в истории, без сообщения), skip (пропускать), batch (пакетом раз в час), urgent (срочно). Условие: source (telegram, mail, group), chat_id, sender (часть имени, ника или почты), keywords. Исключения: except_keywords (однозначные слова) и except_text (размытое, его решает диспетчер по смыслу). Можно передать только text.', RULE_SHAPE,
        async (a) => { const r = addRule(await ruleFromArgs(a), 'session'); return text(`Сохранено правило №${r.id}: ${r.description}`); }),
      tool('inbox_rule_list', 'Правила входящих владельца: условие, действие, исключения, сколько раз сработало.', {},
        async () => text(listRules().map((r) => `№${r.id} ${r.description} | ${ACTIONS[r.action]} | ${[r.source, r.chat_id && `чат ${r.chat_id}`, r.sender && `от «${r.sender}»`, r.keywords.length && `слова: ${r.keywords.join(', ')}`].filter(Boolean).join(', ')}${r.except_keywords.length ? ` | кроме слов: ${r.except_keywords.join(', ')}` : ''}${r.except_text ? ` | кроме: ${r.except_text}` : ''} | сработало ${r.hits}, создал ${r.created_by}`).join('\n') || 'Правил нет')),
      tool('inbox_rule_delete', 'Удалить правило входящих по номеру.', { id: z.number().int() },
        async ({ id }) => { const r = deleteRule(id); return text(`Удалено: ${r.description}`); }),
      tool('memory_list', 'Оглавление общей памяти владельца: файлы, типы, описания, даты обновления.', {},
        async () => text(listMemory().map((n) => `${n.file} [${n.type}, ${n.updated}] ${n.title}: ${n.description}`).join('\n') || 'Память пуста')),
      tool('recall', 'Поиск по всей истории владельца: сессии мейнфрейма (его запросы и ответы), входящие, почта, рабочие группы, переписка в Telegram по дням, общая память. Для вопросов «что решили», «что писал X», «когда обсуждали». Ищет по словам и по смыслу сразу: другая формулировка тоже найдётся. Результаты с датой и источником; полный текст через recall_open.',
        { query: z.string().describe('ключевые слова, например «Аня договор оплата»'), kind: z.enum(['session', 'telegram', 'mail', 'group', 'chat', 'memory']).optional().describe('chat: переписка в Telegram по дням; telegram: входящие из Telegram'), days: z.number().int().optional().describe('только за последние N дней'), limit: z.number().int().optional() },
        async (a) => text(formatRecall(await recallHybrid(a)))),
      tool('recall_open', 'Открыть целиком запись из поиска recall по её ref (переписка за день, сессия, письмо).', { ref: z.string() },
        async ({ ref }) => { const d = recallOpen(ref); return text(`${d.title} (${new Date(d.at || 0).toLocaleString('ru')})\n\n${d.body.slice(0, 30000)}`); }),
      tool('list_projects', 'Список проектов мейнфрейма с их папками.', {},
        async () => text(JSON.stringify(all('SELECT id, name, cwd, description FROM projects'), null, 1))),
      ...moduleTools({ tool, z, text }),
    ],
  });
}

// mac=false leaves out the Mac, app and browser servers (apple, computer, chrome, jev, cua):
// they stay in mcp.json, they are just not started for a session that doesn't need them.
export function buildMcpServers({ mac = true } = {}) {
  const skip = mac ? [] : MAC_SERVERS;
  const servers = { ...Object.fromEntries(Object.entries(readMcpConfig()).filter(([n]) => !skip.includes(n))), mainframe: mainframeServer() };
  if (config.tg.enabled) servers.telegram = { type: 'http', url: config.tg.url };
  return servers;
}

export function mcpSummary() {
  const list = Object.keys(readMcpConfig());
  if (config.tg.enabled) list.unshift('telegram');
  return ['mainframe', ...list];
}
