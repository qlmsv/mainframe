// Inbox rules in plain words: "GitHub quietly, except mentions of me", "Anna in batches".
// A rule has a clear condition (source, chat, sender, keywords) and an action. Clear exceptions
// (keywords) are checked here without a model; vague ones ("except suspicious", "if it asks me")
// go to the dispatcher as text and it decides.
import { db, all, get, run, now, addLog } from './db.js';
import { bus } from './bus.js';

db.exec(`CREATE TABLE IF NOT EXISTS inbox_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  source TEXT,
  chat_id TEXT,
  sender TEXT,
  keywords TEXT,
  action TEXT NOT NULL,
  except_keywords TEXT,
  except_text TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  hits INTEGER DEFAULT 0,
  last_hit_at INTEGER,
  enabled INTEGER DEFAULT 1
)`);
const cols = db.prepare('PRAGMA table_info(inbox)').all().map((c) => c.name);
if (!cols.includes('urgency')) db.exec('ALTER TABLE inbox ADD COLUMN urgency TEXT');
if (!cols.includes('rule_id')) db.exec('ALTER TABLE inbox ADD COLUMN rule_id INTEGER');

export const ACTIONS = { show: 'показывать', quiet: 'учитывать тихо', skip: 'пропускать', batch: 'присылать пакетом', urgent: 'срочно' };
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
const parse = (r) => r && { ...r, keywords: JSON.parse(r.keywords || '[]'), except_keywords: JSON.parse(r.except_keywords || '[]') };

export const listRules = () => all('SELECT * FROM inbox_rules ORDER BY id').map(parse);
export const getRule = (id) => parse(get('SELECT * FROM inbox_rules WHERE id = ?', Number(id)));

export function addRule(r, by = 'session') {
  if (!ACTIONS[r.action]) throw new Error(`Действие одно из: ${Object.keys(ACTIONS).join(', ')}`);
  if (!r.source && !r.chat_id && !r.sender && !list(r.keywords).length) throw new Error('Нужно условие: источник, чат, отправитель или ключевые слова');
  if (!r.description) throw new Error('Нужно описание словами');
  const res = run(`INSERT INTO inbox_rules (description, source, chat_id, sender, keywords, action, except_keywords, except_text, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, String(r.description).slice(0, 300), r.source || null, r.chat_id ? String(r.chat_id) : null,
  r.sender ? String(r.sender).toLowerCase() : null, JSON.stringify(list(r.keywords)), r.action, JSON.stringify(list(r.except_keywords)),
  r.except_text ? String(r.except_text).slice(0, 500) : null, by, now());
  addLog('inbox', `Новое правило входящих: ${r.description}`);
  bus.change('inbox_rules');
  return getRule(Number(res.lastInsertRowid));
}

export function deleteRule(id) {
  const r = getRule(id);
  if (!r) throw new Error('Нет такого правила');
  run('DELETE FROM inbox_rules WHERE id = ?', r.id);
  addLog('inbox', `Правило входящих удалено: ${r.description}`);
  bus.change('inbox_rules');
  return r;
}

export const hitRule = (id) => run('UPDATE inbox_rules SET hits = hits + 1, last_hit_at = ? WHERE id = ?', now(), id);

const haystack = (item) => `${item.name || ''} ${item.username || ''} ${item.chat_id || ''}`.toLowerCase();

export function matches(rule, item) {
  if (rule.source && rule.source !== item.source) return false;
  if (rule.chat_id && String(rule.chat_id) !== String(item.chat_id)) return false;
  if (rule.sender && !haystack(item).includes(rule.sender)) return false;
  const text = String(item.text || '').toLowerCase();
  if (rule.keywords.length && !rule.keywords.some((k) => text.includes(k))) return false;
  return true;
}

// The first matching rule and what it means for this item:
// 'apply' (do the action), 'exception' (a clear exception: show as usual), 'fuzzy' (the dispatcher decides).
export function evaluate(item, rules = listRules().filter((r) => r.enabled)) {
  const rule = rules.find((r) => matches(r, item));
  if (!rule) return null;
  const text = `${item.name || ''} ${item.text || ''}`.toLowerCase();
  if (rule.except_keywords.some((k) => text.includes(k))) return { rule, outcome: 'exception' };
  if (rule.except_text) return { rule, outcome: 'fuzzy' };
  return { rule, outcome: 'apply' };
}

// All rules as text for the dispatcher prompt.
export function rulesText() {
  const rs = listRules().filter((r) => r.enabled);
  if (!rs.length) return '';
  return `Правила владельца для входящих:\n${rs.map((r) => `- №${r.id}: ${r.description} (действие: ${ACTIONS[r.action]}${r.except_text ? `; исключения: ${r.except_text}` : ''})`).join('\n')}`;
}

// What a rule would have caught over the last N days: count and a few examples.
export function previewRule(r, days = 7) {
  const rule = { ...r, keywords: list(r.keywords), except_keywords: list(r.except_keywords), sender: r.sender ? String(r.sender).toLowerCase() : null };
  // Bank card mails already go to «Финансы» before any rule: they are not counted.
  const items = all('SELECT id, source, chat_id, name, username, text, created_at, decision FROM inbox WHERE created_at > ? ORDER BY id DESC', now() - days * 86400000)
    .filter((i) => !/"finance":true/.test(i.decision || ''));
  const hit = items.filter((i) => matches(rule, i));
  const text = (i) => `${i.name || ''} ${i.text || ''}`.toLowerCase();
  const exceptions = hit.filter((i) => rule.except_keywords.some((k) => text(i).includes(k)));
  const caught = hit.filter((i) => !exceptions.includes(i));
  const ex = (i) => ({ id: i.id, when: new Date(i.created_at).toISOString().slice(0, 16).replace('T', ' '), from: i.name, text: String(i.text || '').replace(/\s+/g, ' ').slice(0, 140) });
  return {
    days, matched: hit.length, caught: caught.length, exceptions: exceptions.length,
    vague: rule.except_text ? `Исключение «${rule.except_text}» решает диспетчер по смыслу: часть из ${caught.length} он покажет.` : null,
    examples: caught.slice(0, 5).map(ex), exceptionExamples: exceptions.slice(0, 3).map(ex),
  };
}

