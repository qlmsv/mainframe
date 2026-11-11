// Child process: a small local multilingual model (multilingual-e5-small, ~120 MB) that turns
// text into vectors for meaning search. Separate process: ~600 MB while loaded, so the parent
// starts it on demand and kills it when idle, and a crash here never takes the mainframe down.
import path from 'node:path';
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = process.env.EMBED_CACHE || path.resolve('data/models');
const MODEL = process.env.EMBED_MODEL || 'Xenova/multilingual-e5-small';
let ready = null;
const model = () => (ready ||= pipeline('feature-extraction', MODEL, { dtype: 'q8', session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } }));

process.on('message', async ({ id, texts }) => {
  try {
    const ex = await model();
    const out = await ex(texts, { pooling: 'mean', normalize: true });
    process.send({ id, dims: out.dims, data: Array.from(out.data) });
  } catch (e) {
    process.send({ id, error: String(e?.message || e) });
  }
});
process.on('disconnect', () => process.exit(0));
