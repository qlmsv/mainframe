// Memory quality test: node scripts/memory-bench.mjs [file]
// The file (default data/memory-bench.json) holds real questions with known answers:
// [{ "q": "сколько стоит подписка", "expect": ["20"], "stale": ["15"], "src": "mem:prices.md" }]
// Counts how often the automatic recall (the block put in front of every message) contains the
// answer, and how often it serves an outdated value as current (lines marked outdated don't count).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/config.js';

const { recallContext } = await import('../src/recall.js');
const { semanticSearch } = await import('../src/semantic.js');
const file = process.argv[2] || path.join(DATA_DIR, 'memory-bench.json');
const bench = JSON.parse(fs.readFileSync(file, 'utf8'));
await semanticSearch('прогрев', { wait: true, timeout: 120000 }).catch(() => {});
const MARKED = /устарел|заменен|заменён|был[оаи]?\s|тогда стоил|старше заметок/i;
let found = 0; let stale = 0; let size = 0;
const miss = [];
for (const b of bench) {
  const c = await recallContext(b.q, { project: '—' });
  size += c.length;
  const src = String(b.src || '').startsWith('mem:') ? b.src.slice(4) : null;
  const live = c.split('\n').filter((l) => !MARKED.test(l) && !(src && l.includes(`(${src},`))).join('\n');
  if (b.expect.every((e) => c.includes(e))) found++; else miss.push(b.q);
  if ((b.stale || []).some((s) => live.includes(s))) { stale++; console.log(`устаревшее: ${b.q}`); }
}
console.log(`Нашёл ${found} из ${bench.length}, устаревшее как актуальное: ${stale}, средний блок ${Math.round(size / bench.length)} символов.`);
if (miss.length) console.log(`Промахи:\n- ${miss.join('\n- ')}`);
process.exit(0);
