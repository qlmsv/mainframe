// Meaning search over the recall index: every document is cut into ~700-character pieces, each
// piece becomes a vector from a small local model (embed-worker.js). «Соглашение с Аней» then
// finds «договор с Михаилом» even with no word in common. No cloud, no subscription use.
// The model process starts on demand and quits after 5 idle minutes to give the memory back.
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { all, get, run, addLog, kvGet, kvSet } from './db.js';
import { DATA_DIR } from './config.js';

const CHUNK = 700;
const MAX_CHUNKS = 30;
const IDLE_MS = 5 * 60000; // the server has 1.8 GB; the model holds ~550 MB
const DIM = 384;

export function initSemantic() {
  run('CREATE TABLE IF NOT EXISTS recall_vec (doc_id INTEGER NOT NULL, chunk INTEGER NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (doc_id, chunk))');
  run('CREATE TABLE IF NOT EXISTS recall_vec_done (doc_id INTEGER PRIMARY KEY)');
  // A changed or deleted document loses its vectors and is embedded again on the next pass.
  run(`CREATE TRIGGER IF NOT EXISTS recall_vec_au AFTER UPDATE ON recall_docs WHEN old.body IS NOT new.body OR old.title IS NOT new.title BEGIN
    DELETE FROM recall_vec WHERE doc_id = old.id; DELETE FROM recall_vec_done WHERE doc_id = old.id; END`);
  run(`CREATE TRIGGER IF NOT EXISTS recall_vec_ad AFTER DELETE ON recall_docs BEGIN
    DELETE FROM recall_vec WHERE doc_id = old.id; DELETE FROM recall_vec_done WHERE doc_id = old.id; END`);
}

// The same cut every time, so a piece's text is found again from its number.
export function chunksOf(title, body) {
  const text = String(body || '');
  const out = [];
  for (let i = 0; i < text.length && out.length < MAX_CHUNKS; i += CHUNK) {
    let piece = text.slice(i, i + CHUNK + 80); // a small overlap keeps a sentence on the border whole
    out.push(`${title ? `${title}\n` : ''}${piece}`);
  }
  return out;
}

// ---------- the model process ----------
let child = null;
let warm = false;
let idleTimer = null;
let seq = 0;
const waiting = new Map();

function worker() {
  if (child) return child;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'embed-worker.js');
  child = fork(file, [], { env: { ...process.env, EMBED_CACHE: path.join(DATA_DIR, 'models') }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try { os.setPriority(child.pid, 10); } catch { /* not allowed: fine */ }
  child.stderr.on('data', (d) => { const s = String(d); if (/error/i.test(s) && !/warn/i.test(s)) addLog('error', `Поиск по смыслу: ${s.slice(0, 160)}`); });
  child.on('message', (m) => {
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    warm = true;
    if (m.error) w.reject(new Error(m.error));
    else {
      const vecs = [];
      for (let i = 0; i < m.dims[0]; i++) vecs.push(Float32Array.from(m.data.slice(i * DIM, (i + 1) * DIM)));
      w.resolve(vecs);
    }
  });
  child.on('exit', () => {
    child = null; warm = false;
    for (const w of waiting.values()) w.reject(new Error('Модель поиска по смыслу остановилась'));
    waiting.clear();
  });
  return child;
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (child && !waiting.size) child.kill(); }, IDLE_MS);
  idleTimer.unref?.();
}

function embed(texts, timeout = 120000) {
  const c = worker();
  touch();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { waiting.delete(id); reject(new Error('Поиск по смыслу не ответил вовремя')); }, timeout);
    waiting.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    c.send({ id, texts });
  });
}

export const semanticWarm = () => warm;
export function warmUp() { if (!child) embed(['query: привет']).catch(() => {}); }

// ---------- vectors in memory (a few MB) ----------
let cache = null; // doc_id -> [{ chunk, vec }]
function loadCache() {
  if (cache) return cache;
  cache = new Map();
  for (const r of all('SELECT doc_id, chunk, vec FROM recall_vec')) {
    const v = new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength));
    if (!cache.has(r.doc_id)) cache.set(r.doc_id, []);
    cache.get(r.doc_id).push({ chunk: r.chunk, vec: v });
  }
  return cache;
}

// ---------- indexing ----------
let busy = false;
export async function indexVectors({ maxDocs = 60 } = {}) {
  if (busy) return 0;
  busy = true;
  let done = 0;
  try {
    const docs = all(`SELECT d.id, d.title, d.body FROM recall_docs d LEFT JOIN recall_vec_done v ON v.doc_id = d.id
      WHERE v.doc_id IS NULL ORDER BY d.at DESC LIMIT ?`, maxDocs);
    for (const d of docs) {
      const pieces = chunksOf(d.title, d.body);
      const vecs = [];
      for (let i = 0; i < pieces.length; i += 8) vecs.push(...await embed(pieces.slice(i, i + 8).map((p) => `passage: ${p}`)));
      // The document may have changed while it was being embedded: then it waits for the next pass.
      const still = get('SELECT body FROM recall_docs WHERE id = ?', d.id);
      if (!still || still.body !== d.body) continue;
      run('DELETE FROM recall_vec WHERE doc_id = ?', d.id);
      vecs.forEach((v, i) => run('INSERT INTO recall_vec (doc_id, chunk, vec) VALUES (?, ?, ?)', d.id, i, Buffer.from(v.buffer)));
      run('INSERT OR IGNORE INTO recall_vec_done (doc_id) VALUES (?)', d.id);
      if (cache) cache.set(d.id, vecs.map((vec, chunk) => ({ chunk, vec })));
      done++;
    }
    // Deleted or changed documents: drop their stale vectors from memory too.
    if (cache && docs.length < maxDocs) {
      const live = new Set(all('SELECT doc_id FROM recall_vec_done').map((r) => r.doc_id));
      for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
    }
  } catch (e) {
    addLog('error', `Поиск по смыслу, индексация: ${e.message.slice(0, 150)}`);
  } finally {
    busy = false;
  }
  return done;
}

export const vectorStats = () => ({
  docs: get('SELECT COUNT(*) AS n FROM recall_vec_done').n,
  pieces: get('SELECT COUNT(*) AS n FROM recall_vec').n,
  waiting: get('SELECT COUNT(*) AS n FROM recall_docs d LEFT JOIN recall_vec_done v ON v.doc_id = d.id WHERE v.doc_id IS NULL').n,
  modelLoaded: warm,
});

// Indexing runs when the model is loaded anyway, and at least every 30 minutes; a big backlog
// (first start) is worked through in one go.
export function startSemantic() {
  const tick = async () => {
    const due = Date.now() - kvGet('semantic_index_at', 0) > 30 * 60000;
    if (!warm && !due) return;
    kvSet('semantic_index_at', Date.now());
    let n;
    do { n = await indexVectors(); } while (n >= 60);
  };
  setTimeout(tick, 90000);
  setInterval(tick, 3 * 60000).unref();
}

// ---------- search ----------
const dot = (a, b) => { let s = 0; for (let i = 0; i < DIM; i++) s += a[i] * b[i]; return s; };

// Best-matching documents by meaning: [{ id, score, chunk }]. Cold model and wait = false: [] at
// once (the caller falls back to word search) and the model starts loading for next time.
export async function semanticSearch(query, { limit = 10, wait = true, timeout = 20000 } = {}) {
  if (!String(query || '').trim()) return [];
  if (!warm && !wait) { warmUp(); return []; }
  const [q] = await embed([`query: ${String(query).slice(0, 1500)}`], timeout);
  const scored = [];
  for (const [id, pieces] of loadCache()) {
    let best = -1; let chunk = 0;
    for (const p of pieces) { const s = dot(q, p.vec); if (s > best) { best = s; chunk = p.chunk; } }
    scored.push({ id, score: best, chunk });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
