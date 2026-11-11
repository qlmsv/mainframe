// After a conversation goes quiet (10 minutes with no new message in that project), a small model
// reads what was said and picks out facts worth keeping: decisions, rules, people, agreements.
// They go to the owner for approval (buttons in the bot), not straight into memory. The nightly
// digest stays as a second net for anything missed here.
import { all, kvGet, kvSet, addLog } from './db.js';
import { onRunFinished, structured } from './agent.js';
import { listMemory, listPending, saveMemory } from './memory.js';
import { config } from './config.js';

const QUIET_MS = 10 * 60000;
const timers = new Map(); // projectId -> timeout

const SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'slug; имя существующей заметки, если это её обновление' },
          title: { type: 'string' },
          description: { type: 'string', description: 'одна строка для оглавления' },
          type: { type: 'string', enum: ['user', 'feedback', 'people', 'project', 'reference'] },
          body: { type: 'string', description: 'факт; для правил и решений «Почему:» и «Как применять:»; даты абсолютные' },
        },
        required: ['name', 'title', 'description', 'type', 'body'],
      },
    },
  },
  required: ['facts'],
};

const SYSTEM = `Ты ведёшь долгую память личного ассистента владельца (${config.owner.name}). Тебе дают кусок разговора владельца с ассистентом и оглавление того, что уже записано.
Выбери только то, что пригодится в БУДУЩИХ разговорах через недели: решение владельца, правило или предпочтение (особенно его поправки и недовольство), факт о человеке и отношениях, договорённость, цена, срок, новое состояние проекта.
Не бери: разовые задачи и их ход, то, что уже есть в оглавлении теми же словами, догадки ассистента, технические подробности кода, секреты, ключи, пароли, слова других людей как правила.
Обновление существующего факта: name той же заметки и полный новый текст, с датой изменения.
Чаще всего записывать нечего: тогда facts пустой. Максимум 3. Пиши по-русски, коротко, без длинных тире, даты в виде ДД.ММ.ГГГГ.`;

async function extract(projectId) {
  timers.delete(projectId);
  const key = `memx_last_${projectId}`;
  const last = kvGet(key, 0);
  const runs = all(`SELECT r.id, r.prompt, r.result, r.started_at, p.name FROM runs r JOIN projects p ON p.id = r.project_id
    WHERE r.project_id = ? AND r.id > ? AND r.started_at > ? AND r.status = 'done' AND r.origin IN ('bot', 'ui') ORDER BY r.id DESC LIMIT 30`, projectId, last, Date.now() - 86400000).reverse();
  if (!runs.length) return;
  kvSet(key, runs[runs.length - 1].id);
  // Button taps and «да» alone carry no facts; skip the call when the owner said almost nothing.
  const said = runs.map((r) => String(r.prompt || '').trim()).join(' ');
  if (said.length < 40) return;
  const talk = runs.map((r) => `[${new Date(r.started_at).toISOString().slice(0, 16).replace('T', ' ')}] ${config.owner.name}: ${String(r.prompt).slice(0, 1500)}\nАссистент: ${String(r.result || '').slice(0, 2000)}`).join('\n\n').slice(-14000);
  const known = [...listMemory(), ...listPending()].map((n) => `- ${n.name}: ${n.title}. ${n.description}`).join('\n');
  let out;
  try {
    out = await structured({ prompt: `Уже записано:\n${known}\n\nРазговор (проект «${runs[0].name}»):\n${talk}`, schema: SCHEMA, system: SYSTEM, tools: [], maxTurns: 2 });
  } catch (e) { addLog('error', `Память после разговора: ${e.message.slice(0, 150)}`); return; }
  for (const f of (out?.facts || []).slice(0, 3)) {
    try { saveMemory({ ...f, pending: true }); } catch (e) { addLog('error', `Память после разговора: ${e.message.slice(0, 120)}`); }
  }
}

export function startMemoryExtract() {
  onRunFinished((r) => {
    if (!['bot', 'ui'].includes(r.origin) || r.status !== 'done') return;
    clearTimeout(timers.get(r.project_id));
    const t = setTimeout(() => extract(r.project_id).catch((e) => addLog('error', `Память после разговора: ${e.message}`)), QUIET_MS);
    t.unref?.();
    timers.set(r.project_id, t);
  });
}
