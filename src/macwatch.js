// The Mac's SSH tunnel can go stale: after sleep or a network change the server still holds the
// forwarded ports, nothing answers behind them, and the Mac cannot bind them again. Every 2 minutes
// check that something answers on the forwarded SSH port; after two silent checks in a row drop the
// stale server-side session so the Mac's tunnel reconnects by itself.
import net from 'node:net';
import { execFile } from 'node:child_process';
import { addLog } from './db.js';

const PORT = 2222;
const sh = (cmd, args) => new Promise((res) => execFile(cmd, args, { timeout: 10000 }, (e, out) => res(e ? '' : String(out))));

// 'ok': an SSH banner came; 'silent': the port takes the connection but nothing answers; 'closed': no tunnel.
function probe() {
  return new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port: PORT });
    let done = false;
    const end = (v) => { if (!done) { done = true; s.destroy(); res(v); } };
    s.setTimeout(8000, () => end('silent'));
    s.once('data', (d) => end(/^SSH-/.test(String(d)) ? 'ok' : 'silent'));
    s.once('error', () => end('closed'));
  });
}

export function watchMacTunnel() {
  let silent = 0;
  setInterval(async () => {
    const st = await probe();
    if (st !== 'silent') { silent = 0; return; }
    if (++silent < 2) return;
    silent = 0;
    const pid = (await sh('sudo', ['-n', 'ss', '-tlnp'])).split('\n').find((l) => l.includes(`127.0.0.1:${PORT} `))?.match(/pid=(\d+)/)?.[1];
    if (!pid) return;
    await sh('sudo', ['-n', 'kill', pid]);
    addLog('system', `Туннель Mac завис (порт ${PORT} молчит 4 минуты): сбросил старое подключение, Mac переподключится сам`);
  }, 120000).unref();
}
