// Mail over IMAP and SMTP: any mailbox (Gmail, Yandex, Mail.ru, iCloud, Outlook, your own domain),
// with any model, without a Mac. Settings live in .env (MAIL_ADDRESS, MAIL_PASSWORD, MAIL_IMAP,
// MAIL_SMTP; MAIL_AUTH=google signs in to Gmail through the Google login, see src/google.js).
// The sessions get the in-process «mail» tools; a letter leaves only after the owner presses
// «Отправить» in the bot, whatever the model decides.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { ROOT } from './config.js';
import { kvGet, kvSet, addLog } from './db.js';

// Common providers: the address is enough, the servers come from its domain.
const PRESETS = [
  { re: /@(gmail|googlemail)\.com$/i, imap: 'imap.gmail.com:993', smtp: 'smtp.gmail.com:465', name: 'Gmail', help: 'Нужен пароль приложения: myaccount.google.com/apppasswords (включи двухэтапную проверку). Или вход через Google ниже.' },
  { re: /@(yandex\.(ru|com|kz|by)|ya\.ru)$/i, imap: 'imap.yandex.ru:993', smtp: 'smtp.yandex.ru:465', name: 'Яндекс Почта', help: 'Нужен пароль приложения: id.yandex.ru → Безопасность → Пароли приложений → Почта.' },
  { re: /@(mail\.ru|bk\.ru|inbox\.ru|list\.ru|internet\.ru)$/i, imap: 'imap.mail.ru:993', smtp: 'smtp.mail.ru:465', name: 'Mail.ru', help: 'Нужен пароль для внешнего приложения: id.mail.ru → Безопасность → Пароли для внешних приложений.' },
  { re: /@(icloud|me|mac)\.com$/i, imap: 'imap.mail.me.com:993', smtp: 'smtp.mail.me.com:587', name: 'iCloud', help: 'Нужен пароль приложения: account.apple.com → Вход и безопасность → Пароли приложений.' },
  { re: /@(outlook|hotmail|live)\.[a-z.]+$/i, imap: 'outlook.office365.com:993', smtp: 'smtp-mail.outlook.com:587', name: 'Outlook', help: 'Microsoft закрывает вход по паролю: может не сработать.' },
];
export const presetFor = (address) => PRESETS.find((p) => p.re.test(String(address || '').trim())) || null;

const env = (k) => String(process.env[k] ?? '').trim();
const hostPort = (s, port) => { const [h, p] = String(s || '').split(':'); return { host: h, port: Number(p) || port }; };

function settings(over = {}) {
  const address = (over.address ?? env('MAIL_ADDRESS')).trim();
  const p = presetFor(address);
  const s = {
    address,
    password: over.password || env('MAIL_PASSWORD'),
    auth: over.auth || env('MAIL_AUTH') || 'password',
    imap: hostPort(over.imap || env('MAIL_IMAP') || p?.imap, 993),
    smtp: hostPort(over.smtp || env('MAIL_SMTP') || p?.smtp, 465),
    // Plain connections only for a local test server (MAIL_TLS=off).
    tls: !['off', '0', 'no', 'false'].includes((over.tls ?? env('MAIL_TLS') ?? 'on').toString().toLowerCase()),
  };
  return s;
}

export const mailboxConfigured = () => { const s = settings(); return Boolean(s.address && s.imap.host && (s.password || s.auth === 'google')); };

export function mailboxState() {
  const s = settings();
  const p = presetFor(s.address);
  return {
    configured: mailboxConfigured(), address: s.address || null, provider: p?.name || (s.imap.host ? s.imap.host : null),
    auth: s.auth, imap: s.imap.host ? `${s.imap.host}:${s.imap.port}` : null, smtp: s.smtp.host ? `${s.smtp.host}:${s.smtp.port}` : null,
    passwordSet: Boolean(s.password), lastUid: kvGet('imap_last_uid', null),
  };
}

async function authFor(s) {
  if (s.auth === 'google') {
    const { accessToken } = await import('./google.js');
    return { user: s.address, accessToken: await accessToken() };
  }
  return { user: s.address, pass: s.password };
}

async function imap(s = settings()) {
  const c = new ImapFlow({
    host: s.imap.host, port: s.imap.port, secure: s.tls && s.imap.port === 993, logger: false,
    auth: await authFor(s), tls: { rejectUnauthorized: s.tls }, disableAutoIdle: true,
    ...(s.tls ? {} : { doSTARTTLS: false }),
  });
  await c.connect();
  return c;
}

async function withImap(fn, s) {
  const c = await imap(s);
  try { return await fn(c); } finally { await c.logout().catch(() => c.close()); }
}

const short = (t, n) => (String(t || '').length > n ? `${String(t).slice(0, n)}…` : String(t || ''));
const addr = (a) => (a?.value || []).map((x) => (x.name ? `${x.name} <${x.address}>` : x.address)).join(', ');

function summary(msg) {
  const e = msg.envelope || {};
  const from = (e.from || []).map((x) => (x.name ? `${x.name} <${x.address}>` : x.address)).join(', ');
  return { uid: msg.uid, date: e.date ? new Date(e.date).toISOString() : null, from, subject: e.subject || '(без темы)', seen: msg.flags?.has('\\Seen') ?? null };
}

// ---------- reading ----------
export async function listFolders() {
  return withImap(async (c) => (await c.list()).map((f) => ({ path: f.path, special: f.specialUse || null })));
}

export async function listMessages({ folder = 'INBOX', limit = 20, unseen = false } = {}) {
  return withImap(async (c) => {
    const lock = await c.getMailboxLock(folder);
    try {
      const total = c.mailbox.exists;
      if (!total) return [];
      const range = unseen ? ((await c.search({ seen: false }, { uid: true })) || []).slice(-limit) : null;
      if (range && !range.length) return [];
      const out = [];
      const q = range ? range : `${Math.max(1, total - limit + 1)}:*`;
      for await (const m of c.fetch(q, { envelope: true, flags: true, uid: true }, range ? { uid: true } : {})) out.push(summary(m));
      return out.reverse();
    } finally { lock.release(); }
  });
}

export async function searchMessages({ folder = 'INBOX', query, from, since, limit = 20 } = {}) {
  return withImap(async (c) => {
    const lock = await c.getMailboxLock(folder);
    try {
      const crit = {};
      if (query) crit.or = [{ subject: query }, { body: query }, { from: query }];
      if (from) crit.from = from;
      if (since) crit.since = new Date(since);
      if (!Object.keys(crit).length) crit.all = true;
      const uids = ((await c.search(crit, { uid: true })) || []).slice(-limit);
      const out = [];
      if (uids.length) for await (const m of c.fetch(uids, { envelope: true, flags: true, uid: true }, { uid: true })) out.push(summary(m));
      return out.reverse();
    } finally { lock.release(); }
  });
}

export async function readMessage({ uid, folder = 'INBOX' }) {
  return withImap(async (c) => {
    const lock = await c.getMailboxLock(folder);
    try {
      const m = await c.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
      if (!m) throw new Error('Письмо не найдено');
      const p = await simpleParser(m.source);
      return {
        uid: m.uid, folder, messageId: p.messageId || null, references: p.references || null, date: p.date?.toISOString() || null,
        from: addr(p.from), fromEmail: p.from?.value?.[0]?.address?.toLowerCase() || '', fromName: p.from?.value?.[0]?.name || '',
        to: addr(p.to), cc: addr(p.cc), subject: p.subject || '(без темы)',
        text: short((p.text || (p.html ? String(p.html).replace(/<[^>]+>/g, ' ') : '')).replace(/\n{3,}/g, '\n\n').trim(), 20000),
        attachments: (p.attachments || []).map((a) => ({ name: a.filename, type: a.contentType, size: a.size })),
      };
    } finally { lock.release(); }
  });
}

// New letters since the last check, for «Входящие» (the first check only remembers where we are).
export async function fetchNew() {
  return withImap(async (c) => {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const mark = kvGet('imap_last_uid', null);
      const validity = String(c.mailbox.uidValidity);
      const next = Number(c.mailbox.uidNext) || 1;
      if (!mark || mark.validity !== validity) { kvSet('imap_last_uid', { validity, uid: next - 1 }); return []; }
      if (next - 1 <= mark.uid) return [];
      const out = [];
      for await (const m of c.fetch(`${mark.uid + 1}:*`, { source: true, uid: true }, { uid: true })) {
        if (m.uid <= mark.uid) continue;
        const p = await simpleParser(m.source);
        out.push({
          externalId: p.messageId ? p.messageId.replace(/^<|>$/g, '') : `imap-${validity}-${m.uid}`, messageId: p.messageId, references: p.references,
          uid: m.uid, folder: 'INBOX', account: settings().address, subject: p.subject || '(без темы)',
          body: short((p.text || '').replace(/\n{3,}/g, '\n\n').trim(), 20000),
          fromName: p.from?.value?.[0]?.name || '', fromEmail: p.from?.value?.[0]?.address?.toLowerCase() || '',
        });
      }
      kvSet('imap_last_uid', { validity, uid: Math.max(mark.uid, ...out.map((x) => x.uid)) });
      return out;
    } finally { lock.release(); }
  });
}

// ---------- sending ----------
async function transport(s = settings()) {
  return nodemailer.createTransport({
    host: s.smtp.host, port: s.smtp.port, secure: s.tls && s.smtp.port === 465, requireTLS: s.tls && s.smtp.port === 587,
    ignoreTLS: !s.tls, auth: s.auth === 'google' ? { type: 'OAuth2', ...(await authFor(s)) } : { user: s.address, pass: s.password },
    tls: { rejectUnauthorized: s.tls },
  });
}

async function deliver(m) {
  const s = settings();
  const t = await transport(s);
  const info = await t.sendMail({
    from: process.env.OWNER_NAME ? { name: process.env.OWNER_NAME, address: s.address } : s.address,
    to: m.to, cc: m.cc || undefined, subject: m.subject, text: m.body,
    inReplyTo: m.inReplyTo || undefined, references: m.references || undefined,
  });
  addLog('system', `Письмо отправлено: ${m.to}, «${short(m.subject, 60)}»`);
  return info.messageId;
}

// Reply to a letter from «Входящие» (the owner pressed «Ответить» there, that is the approval).
export async function replyTo(meta, body) {
  const subject = /^re:/i.test(meta.subject || '') ? meta.subject : `Re: ${meta.subject || ''}`;
  const refs = [].concat(meta.references || [], meta.messageId || []).filter(Boolean);
  return deliver({ to: meta.fromEmail, subject, body, inReplyTo: meta.messageId, references: refs.join(' ') });
}

// A letter from a session waits for the owner: the bot shows it with «Отправить» and «Отмена».
let askOwner = null;
export const setMailApprover = (fn) => { askOwner = fn; };
const outbox = () => kvGet('mail_outbox', {});

export async function requestSend(m) {
  if (!mailboxConfigured()) throw new Error('Почта не подключена: пульт → Ещё → Система → Почта');
  if (!askOwner) throw new Error('Бот не запущен: отправить письмо на подтверждение некому');
  const id = crypto.randomBytes(5).toString('hex');
  const box = outbox();
  box[id] = { ...m, created: Date.now() };
  for (const [k, v] of Object.entries(box)) if (Date.now() - v.created > 7 * 86400000) delete box[k];
  kvSet('mail_outbox', box);
  await askOwner(id, box[id]);
  return id;
}

export async function decideSend(id, ok) {
  const box = outbox();
  const m = box[id];
  if (!m) throw new Error('Письмо уже отправлено или отменено');
  delete box[id];
  kvSet('mail_outbox', box);
  if (!ok) return { sent: false, m };
  await deliver(m);
  return { sent: true, m };
}

// ---------- check from the wizard / dashboard ----------
export async function testMailbox(over = {}) {
  const s = settings(over);
  if (!s.address || !s.imap.host) throw new Error('Укажи адрес почты (для своего домена ещё серверы IMAP и SMTP)');
  const t0 = Date.now();
  try {
    const n = await withImap(async (c) => { const st = await c.status('INBOX', { messages: true }); return st.messages; }, s);
    let smtp = null;
    try { await (await transport(s)).verify(); smtp = true; } catch (e) { smtp = e.message.slice(0, 200); }
    return { ok: true, messages: n, smtp, ms: Date.now() - t0 };
  } catch (e) {
    const msg = /auth|login|credentials|invalid/i.test(e.message) || e.authenticationFailed ? 'почта не приняла пароль. Нужен пароль приложения, не обычный пароль' : e.message;
    return { ok: false, error: msg.slice(0, 300), ms: Date.now() - t0 };
  }
}

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

export function saveMailbox({ address, password, imap: im, smtp, auth }) {
  const pairs = {};
  if (typeof address === 'string') pairs.MAIL_ADDRESS = address.trim();
  if (typeof password === 'string' && password.trim()) pairs.MAIL_PASSWORD = password.replace(/\s+/g, ''); // app passwords come with spaces
  if (typeof im === 'string') pairs.MAIL_IMAP = im.trim();
  if (typeof smtp === 'string') pairs.MAIL_SMTP = smtp.trim();
  if (auth) pairs.MAIL_AUTH = auth === 'google' ? 'google' : 'password';
  if (pairs.MAIL_ADDRESS !== undefined && pairs.MAIL_ADDRESS !== env('MAIL_ADDRESS')) kvSet('imap_last_uid', null);
  writeEnv(pairs);
  return mailboxState();
}

export function forgetMailbox() {
  writeEnv({ MAIL_ADDRESS: '', MAIL_PASSWORD: '', MAIL_IMAP: '', MAIL_SMTP: '', MAIL_AUTH: '' });
  kvSet('imap_last_uid', null);
  return mailboxState();
}

// ---------- tools for sessions (any model) ----------
const txt = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const safe = (fn) => async (a) => { try { return txt(await fn(a)); } catch (e) { return { ...txt(`Ошибка почты: ${e.message}`), isError: true }; } };

export function mailServer() {
  return createSdkMcpServer({
    name: 'mail',
    version: '0.1.0',
    tools: [
      tool('mail_list', 'Последние письма в папке (по умолчанию INBOX): uid, дата, от кого, тема, прочитано ли.',
        { folder: z.string().optional(), limit: z.number().int().max(100).optional(), unseen: z.boolean().optional().describe('только непрочитанные') },
        safe((a) => listMessages(a))),
      tool('mail_search', 'Найти письма: по словам (тема, текст, отправитель), отправителю и дате.',
        { query: z.string().optional(), from: z.string().optional(), since: z.string().optional().describe('дата YYYY-MM-DD'), folder: z.string().optional(), limit: z.number().int().max(100).optional() },
        safe((a) => searchMessages(a))),
      tool('mail_read', 'Прочитать письмо целиком по uid (из mail_list или mail_search).',
        { uid: z.number().int(), folder: z.string().optional() },
        safe((a) => readMessage(a))),
      tool('mail_folders', 'Список папок почтового ящика.', {}, safe(() => listFolders())),
      tool('mail_send', 'Отправить письмо. Письмо НЕ уходит сразу: владелец получает его в боте с кнопками «Отправить» и «Отмена». Для ответа укажи reply_to_uid.',
        { to: z.string(), subject: z.string(), body: z.string().describe('текст письма'), cc: z.string().optional(), reply_to_uid: z.number().int().optional(), folder: z.string().optional() },
        safe(async (a) => {
          let extra = {};
          if (a.reply_to_uid) {
            const orig = await readMessage({ uid: a.reply_to_uid, folder: a.folder || 'INBOX' });
            extra = { inReplyTo: orig.messageId, references: [].concat(orig.references || [], orig.messageId || []).join(' ') };
          }
          await requestSend({ to: a.to, cc: a.cc, subject: a.subject, body: a.body, ...extra });
          return 'Письмо показано владельцу в боте. Уйдёт, только когда он нажмёт «Отправить». Не пиши, что письмо отправлено.';
        })),
    ],
  });
}
