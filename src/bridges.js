// Watchdog for the computer's bridges: the MCP servers from mcp.json that live on this machine's
// loopback (http://127.0.0.1:PORT/..., forwarded from the Mac by the SSH tunnel). Every minute a TCP
// check; a bridge that is down gets one restart attempt over SSH every 10 minutes (its launchd agent
// on the Mac, or the tunnel when the bridge answers on the Mac but not here); after BRIDGE_ALERT_MIN
// minutes in the daytime the owner gets one message per outage. Sessions that need the Mac get a
// short line about what is down, so the model says so instead of waiting on dead tools.
import net from 'node:net';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { kvGet, kvSet, addLog } from './db.js';
import { readMcpConfig } from './mcp.js';

const DAY_HOURS = [9, 22];
const REPAIR_EVERY_MS = 10 * 60000;
const state = {}; // name -> { port, up, downSince, lastRepair }

export function bridgePorts() {
  const out = {};
  for (const [name, s] of Object.entries(readMcpConfig())) {
    const m = /^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//.exec(String(s?.url || ''));
    if (m) out[name] = Number(m[1]);
  }
  return out;
}

const probe = (port, host = '127.0.0.1') => new Promise((res) => {
  const s = net.connect({ host, port });
  const end = (v) => { s.destroy(); res(v); };
  s.setTimeout(2500, () => end(false));
  s.once('connect', () => end(true));
  s.once('error', () => end(false));
});

const macSsh = () => [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-i', process.env.MAC_SSH_KEY || `${process.env.HOME}/.ssh/to_mac`,
  '-p', String(process.env.MAC_SSH_PORT || 2222), `${process.env.MAC_USER || process.env.USER}@127.0.0.1`,
];
const sh = (cmd, args, timeout = 25000) => new Promise((res) => execFile(cmd, args, { timeout }, (e, out, err) => res({ ok: !e, out: String(out || ''), err: String(err || e?.message || '') })));

// One restart attempt: the bridge's own launchd agent, or the tunnel if the bridge answers on the Mac.
async function repair(name, port, busyMac) {
  // Everything goes through the forwarded SSH port: without it there is nothing to repair from here.
  if (!(await probe(Number(process.env.MAC_SSH_PORT || 2222)))) return 'mac-off';
  const script = `
P=${port}; N=${name}
L=$(launchctl list | awk '{print $3}' | grep -iE "(mainframe|bridge|mcp|${name}).*${name}|${name}.*(mcp|bridge)" | head -1)
if nc -z -G 2 127.0.0.1 $P 2>/dev/null; then echo up-on-mac; else
  if [ -n "$L" ]; then launchctl kickstart -k gui/$(id -u)/$L && echo restarted:$L; else echo no-agent; fi
fi`;
  const r = await sh('ssh', [...macSsh(), script]);
  const out = r.out.trim();
  // The bridge runs on the Mac but its port is not forwarded here: restart the tunnel, but not while
  // a session works on the Mac over it (that would cut the session).
  if (/up-on-mac/.test(out) && !busyMac) {
    const t = await sh('ssh', [...macSsh(), `T=$(launchctl list | awk '{print $3}' | grep -iE "(mainframe|mf).*tunnel|tunnel.*mainframe" | head -1); [ -n "$T" ] && (sleep 2; launchctl kickstart -k gui/$(id -u)/$T) >/dev/null 2>&1 & echo tunnel:$T`]);
    return `туннель ${t.out.trim() || t.err.slice(0, 80)}`;
  }
  return out || r.err.slice(0, 120);
}

let started = false;
export function watchBridges({ notify, busyMac = () => false } = {}) {
  if (started || !config.bridges.watch) return;
  started = true;
  const tick = async () => {
    const ports = bridgePorts();
    const h = new Date().getHours();
    const day = h >= DAY_HOURS[0] && h < DAY_HOURS[1];
    const told = kvGet('bridges_told', {});
    for (const [name, port] of Object.entries(ports)) {
      const s = state[name] || (state[name] = { port, up: null, downSince: null, lastRepair: 0 });
      s.port = port;
      const up = await probe(port);
      if (up) {
        if (s.up === false) addLog('system', `Мост ${name} снова отвечает`);
        if (told[name]) { notify?.(`✅ Мост ${name} снова на связи.`); delete told[name]; }
        Object.assign(s, { up: true, downSince: null });
        continue;
      }
      if (s.up !== false) s.downSince = Date.now();
      s.up = false;
      if (config.bridges.repair && Date.now() - s.lastRepair > REPAIR_EVERY_MS) {
        s.lastRepair = Date.now();
        repair(name, port, busyMac()).then((r) => { if (r !== 'mac-off') addLog('system', `Мост ${name} (порт ${port}) не отвечал, попытка поднять: ${r}`); }).catch(() => {});
      }
      // The whole Mac off is the Mac alert's business (src/alerts.js), not one message per bridge.
      const macUp = await probe(Number(process.env.MAC_SSH_PORT || 2222));
      if (macUp && day && !told[name] && Date.now() - s.downSince > config.bridges.alertMin * 60000) {
        told[name] = Date.now();
        notify?.(`⚠️ Мост <b>${name}</b> на Mac не отвечает ${Math.round((Date.now() - s.downSince) / 60000)} мин, перезапуск не помог. Задачи с ним скажут, что он недоступен.`);
      }
    }
    kvSet('bridges_told', told);
  };
  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), 60000).unref();
}

// Names of bridges known to be down right now (after at least one check).
export const bridgesDown = () => Object.entries(state).filter(([, s]) => s.up === false).map(([n]) => n);
export const bridgeStates = () => Object.fromEntries(Object.entries(state).map(([n, s]) => [n, { port: s.port, up: s.up, downSince: s.downSince }]));
