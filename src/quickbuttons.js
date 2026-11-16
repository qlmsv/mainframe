// Quick buttons in the bot menu: one tap sends a ready request as the owner's own message, so it
// goes through the same logic as typed text. Who decides the set, first wins:
//   1. the owner by words («поменяй кнопки…»): the session calls mainframe quick_buttons_set (kv);
//   2. a module (personal/…/index.js: quickButtons: [{ label, prompt }]);
//   3. the neutral default below.
// A button is { label, prompt } or { label, action: 'new' } (a fresh session, like /new).
import { kvGet, kvSet } from './db.js';
import { modules } from './modules.js';

export const DEFAULT_BUTTONS = [
  { label: '🔥 Что в работе', prompt: 'Что сейчас в работе и что ждёт моего решения? Коротко.' },
  { label: '📅 Что сегодня', prompt: 'Что у меня сегодня: встречи, задачи, напоминания? Коротко.' },
  { label: '📥 Что нового', prompt: 'Что нового пришло и что из этого важно? Коротко.' },
  { label: '💰 Траты', prompt: 'Сколько я потратил за неделю и на что? Коротко.' },
  { label: '✅ Что открыто', prompt: 'Какие задачи открыты и что осталось доделать? Коротко.' },
  { label: '🆕 Новая сессия', action: 'new' },
];

const MAX = 10;
const clean = (list) => (Array.isArray(list) ? list : [])
  .map((b) => ({ label: String(b?.label || '').trim().slice(0, 24), ...(b?.action === 'new' ? { action: 'new' } : { prompt: String(b?.prompt || '').trim().slice(0, 1000) }) }))
  .filter((b) => b.label && (b.action || b.prompt))
  .slice(0, MAX);

export function quickButtons() {
  const own = clean(kvGet('quick_buttons', null));
  if (own.length) return own;
  const fromModules = clean(modules.flatMap((m) => m.quickButtons || []));
  return fromModules.length ? fromModules : DEFAULT_BUTTONS;
}

export const quickFor = (text) => quickButtons().find((b) => b.label === String(text || '').trim()) || null;

// The owner's own set by words. An empty list goes back to the module or default set.
export function setQuickButtons(list) {
  const c = clean(list);
  if (Array.isArray(list) && list.length && !c.length) throw new Error('Нужны кнопки вида { label, prompt }');
  kvSet('quick_buttons', c.length ? c : null);
  return quickButtons();
}
