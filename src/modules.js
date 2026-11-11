// Optional modules: extra features that are not part of the shared mainframe (your CRM,
// a messenger only you use, parsers for your banks, anything else just for you).
// A module is a folder with index.js in modules/ (shared, in the repository) or personal/
// (yours, kept out of git by .gitignore). index.js exports a default object, every field optional:
//
//   tabs:        [{ id, title, icon, more }]        dashboard tabs, drawn by client.script
//   client:      { script: 'view.js', style: 'view.css' }  files in the module folder for the dashboard
//   routes(route, ctx)                               add API routes: route('GET', '/api/x', handler)
//   tools({ tool, z, text, ctx })                    extra MCP tools for sessions (an array)
//   start(ctx)                                       background work after the mainframe starts
//   widgets:     { kind: { html, data, caption, description } }   Telegram widgets, /kind command
//   routingWords: ['слово']                         words that load the Mac and browser tools
//   parseMail(fromEmail, subject, body, at)          a bank mail → expense, before the generic parser
//   dayLine()                                        one short line for the card of the day
//
// ctx: { config, sendOwner(html, extra) }.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, config } from './config.js';
import { addLog } from './db.js';

export const modules = [];
const DIRS = [path.join(ROOT, 'modules'), path.join(ROOT, 'personal')];

export async function loadModules() {
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name, 'index.js');
      if (!fs.existsSync(file) || modules.some((m) => m.name === name)) continue;
      try {
        const def = (await import(pathToFileURL(file).href)).default || {};
        modules.push({ ...def, name, dir: path.join(dir, name) });
      } catch (e) {
        addLog('error', `Модуль ${name} не загрузился: ${e.message.slice(0, 200)}`);
      }
    }
  }
  if (modules.length) addLog('system', `Модули: ${modules.map((m) => m.name).join(', ')}`);
  return modules;
}

export const ctx = {
  config,
  sendOwner: async (html, extra) => (await import('./bot.js')).sendOwner(html, extra),
};

const safe = (name, fn) => { try { return fn(); } catch (e) { addLog('error', `Модуль ${name}: ${e.message.slice(0, 200)}`); return null; } };

export function registerRoutes(route) {
  for (const m of modules) if (m.routes) safe(m.name, () => m.routes(route, ctx));
}

export function startModules() {
  for (const m of modules) {
    if (!m.start) continue;
    Promise.resolve().then(() => m.start(ctx)).catch((e) => addLog('error', `Модуль ${m.name}: ${e.message.slice(0, 200)}`));
  }
}

export const moduleTools = (helpers) => modules.flatMap((m) => (m.tools ? safe(m.name, () => m.tools({ ...helpers, ctx })) || [] : []));
export const moduleWidgets = () => Object.assign({}, ...modules.map((m) => m.widgets || {}));
export const moduleRoutingWords = () => modules.flatMap((m) => m.routingWords || []);

export function parseMailByModules(from, subject, body, at) {
  for (const m of modules) {
    if (!m.parseMail) continue;
    const r = safe(m.name, () => m.parseMail(from, subject, body, at));
    if (r) return r;
  }
  return null;
}

// What the dashboard needs: tabs and the files to load.
export const clientModules = () => modules.filter((m) => m.tabs?.length || m.client).map((m) => ({
  name: m.name,
  tabs: m.tabs || [],
  script: m.client?.script ? `/modules/${m.name}/${m.client.script}` : null,
  style: m.client?.style ? `/modules/${m.name}/${m.client.style}` : null,
}));

// A dashboard file of a module: only the ones it declared.
export function clientFile(name, file) {
  const m = modules.find((x) => x.name === name);
  if (!m?.client || ![m.client.script, m.client.style].includes(file)) return null;
  const p = path.join(m.dir, file);
  return fs.existsSync(p) ? p : null;
}
