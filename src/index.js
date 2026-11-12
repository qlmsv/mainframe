import { config } from './config.js';
import { addLog, all, run, recoverInterrupted, kvGet } from './db.js';
const interrupted = recoverInterrupted();
import { startWeb, route } from './web.js';
import { loadModules, registerRoutes, startModules } from './modules.js';
import { startBot, stopBot, updateMenuButton } from './bot.js';
import { startTelegramMcp, stopTelegramMcp } from './telegram-mcp.js';
import { watchFeed } from './feed.js';
import { handleFeedEvent, handleMail, handleGroupBatch, classify } from './dispatcher.js';
import { watchGroups, stopGroups } from './groups.js';
import { watchMail, stopMail } from './mail.js';
import { saveReport, ensureSocialTask } from './social.js';
import * as linkedin from './linkedin.js';
import * as content from './content.js';
import { startRecall } from './recall.js';
import { startMemory } from './memory.js';
import { startMemoryExtract } from './memory-extract.js';
import { addExpense, listExpenses, financeSummary, rescanInbox, setBalance } from './finance.js';
import { reloadTasks, createTask } from './scheduler.js';
import { setMainframeHandlers } from './mcp.js';
import { activeRuns, onRunFinished, startRun } from './agent.js';
import { startTunnel, stopTunnel } from './tunnel.js';

// Self-restart for code changes: wait until no session is running, then exit;
// launchd (KeepAlive) starts the new code. The run that asked finishes its answer first.
let restartRequested = false;
const restartIfIdle = () => {
  if (!restartRequested) return;
  setTimeout(() => {
    if (activeRuns().length) return;
    addLog('system', 'Перезапуск по запросу сессии: применяю новый код');
    process.kill(process.pid, 'SIGTERM');
  }, 5000);
};
onRunFinished(() => restartIfIdle());
setMainframeHandlers({ createTask: (args) => createTask(args), saveSocial: (r) => saveReport(r), addExpense: (e) => addExpense(e), linkedinPost: (a) => linkedin.post(a), linkedinStatus: () => linkedin.status(), contentSaveDrafts: (a) => content.saveDrafts(a), contentMark: (a) => content.markPost(a), contentAddCompetitor: (u) => content.addCompetitor(u), contentAddIdea: (i) => content.addIdea(i), setBalance: (b) => setBalance(b), financeSummaryFor: (days) => ({ items: listExpenses({ from: Date.now() - days * 86400000 }), summary: { today: financeSummary().today, month: financeSummary().month, categories: financeSummary().categories } }), requestRestart: () => { restartRequested = true; addLog('system', 'Запрошен перезапуск мейнфрейма'); restartIfIdle(); } });

// Optional modules (modules/ and your own personal/): loaded before the web routes and the bot.
await loadModules();
try {
  await startWeb();
} catch (e) {
  console.error(e.code === 'EADDRINUSE'
    ? `Порт ${config.port} уже занят: мейнфрейм, похоже, уже запущен (автозапуск или другой терминал). Второй экземпляр не стартует.`
    : `Не удалось запустить веб-сервер: ${e.message}`);
  process.exit(1);
}
registerRoutes(route);
ensureSocialTask();
reloadTasks();
startBot();
startTunnel(() => updateMenuButton());
import('./modes.js').then(({ watchBridge }) => watchBridge());
import('./macwatch.js').then(({ watchMacTunnel }) => { if (process.env.MAC_RUNNER) watchMacTunnel(); });

if (config.tg.enabled) {
  startTelegramMcp();
  watchFeed(async (event) => {
    if (!event?.chat_id) return;
    await handleFeedEvent(event);
  });
  content.startContent();
  startRecall();
  // Background tasks (pult, schedule) cut off by the last stop continue by themselves, once.
  // The owner's chat messages are not repeated: he sees the answer did not come and decides.
  const RESUME = '(Мейнфрейм перезапустился посреди этой задачи. Продолжи с того места, где остановился, сделанное не повторяй. Проверь git status и файлы, прежде чем менять.)';
  for (const r of interrupted) {
    if (!['ui', 'cron'].includes(r.origin) || String(r.prompt).startsWith(RESUME)) continue;
    try {
      const prompt = r.status === 'queued' ? r.prompt : `${RESUME}\n\n${r.prompt}`;
      startRun({ projectId: r.project_id, prompt, origin: r.origin, inboxId: r.inbox_id });
      addLog('system', `Задача №${r.id} продолжена после перезапуска`);
    } catch (e) { addLog('error', `Продолжить задачу №${r.id}: ${e.message}`); }
  }
  startMemory();
  startMemoryExtract();
  watchGroups(async (batch) => { await handleGroupBatch(batch); });
}

watchMail(async (m) => { await handleMail(m); });
import('./bot.js').then(({ sendOwner }) => linkedin.watchExpiry((t) => sendOwner(t).catch(() => {})));
import('./alerts.js').then(({ startAlerts }) => import('./bot.js').then(({ sendOwner }) => startAlerts((t) => sendOwner(t, { disable_notification: false }))));
startModules();

try { const n = rescanInbox(); if (n) addLog('system', `Финансы: добавлено ${n} операций из почты`); } catch (e) { addLog('error', `Финансы: ${e.message}`); }
addLog('system', 'Мейнфрейм запущен');

// Messages whose classification was cut off by a restart: classify them again.
for (const { id } of all("SELECT id FROM inbox WHERE status = 'new' AND created_at > ?", Date.now() - 86400000)) {
  classify(id).catch((e) => addLog('error', `Повторный разбор ${id}: ${e.message}`));
}
// A reply cut off mid-send goes back to the owner's decision.
run("UPDATE inbox SET status = 'routed' WHERE status = 'sending'");

const shutdown = async (signal) => {
  addLog('system', `Остановлен сигналом ${signal}`);
  stopTunnel();
  stopTelegramMcp();
  stopMail();
  stopGroups();
  await stopBot();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => addLog('error', `unhandled: ${e?.message || e}`));
