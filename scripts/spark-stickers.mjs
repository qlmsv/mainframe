// Renders Искра's video stickers: public/spark/stickers.html → PNG frames (Chromium, transparent)
// → public/spark/<state>.webm (VP9 with alpha, 512×512, 30 fps, 2 s loop, no sound, ≤256 KB).
// Needs playwright-core (PLAYWRIGHT_CORE=path, or vendor/browser/node_modules) and ffmpeg.
// Run: node scripts/spark-stickers.mjs [state ...]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATES = ['thinking', 'working', 'done', 'error', 'waiting'];
const FPS = 30, LOOP_MS = 2000, FRAMES = (LOOP_MS / 1000) * FPS;

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_CORE || join(root, 'vendor/browser/node_modules/playwright-core');
const { chromium } = require(pwPath);
const exe = process.env.BROWSER_PATH && existsSync(process.env.BROWSER_PATH) ? process.env.BROWSER_PATH : undefined;

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
const want = process.argv.slice(2).filter((s) => STATES.includes(s));
for (const state of want.length ? want : STATES) {
  const dir = mkdtempSync(join(tmpdir(), `spark-${state}-`));
  await page.goto(`${pathToFileURL(join(root, 'public/spark/stickers.html'))}?s=${state}`);
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((t) => window.frameAt(t), (i * 1000) / FPS);
    await page.screenshot({ path: join(dir, `f${String(i).padStart(3, '0')}.png`), omitBackground: true });
  }
  const out = join(root, 'public/spark', `${state}.webm`);
  let crf = 34;
  for (;;) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%03d.png'),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String(crf), '-deadline', 'good', '-an', out]);
    const kb = statSync(out).size / 1024;
    if (kb <= 250 || crf >= 60) { console.log(`${state}: ${kb.toFixed(0)} KB, crf ${crf}`); break; }
    crf += 6;
  }
  if (process.env.KEEP_FRAMES) console.log(`  frames: ${dir}`); else rmSync(dir, { recursive: true });
}
await browser.close();
