#!/bin/bash
# Помощник только на этом Mac, без сервера: работает, пока Mac включён (автозапуск при входе, launchd).
#   curl -fsSL https://raw.githubusercontent.com/qlmsv/mainframe/main/scripts/install-computer.sh | bash
# Ставит всё в ~/mainframe (Node.js в той же папке, пароль администратора не нужен), потом открывает
# мастер настройки в браузере: http://127.0.0.1:7777/setup
set -euo pipefail
DIR="${MAINFRAME_DIR:-$HOME/mainframe}"
REPO_ZIP="${MAINFRAME_ZIP:-https://github.com/qlmsv/mainframe/archive/refs/heads/main.zip}"
PORT="${PORT:-7777}"
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
set_env() { if grep -q "^$1=" "$DIR/.env"; then sed -i '' "s|^$1=.*|$1=$2|" "$DIR/.env"; else echo "$1=$2" >> "$DIR/.env"; fi; }
[ "$(uname)" = Darwin ] || { echo "Этот скрипт для Mac. Для Windows: scripts/install-windows.ps1, для сервера: scripts/install-server.sh"; exit 1; }
ARCH=$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )

say "Код помощника в $DIR"
if [ ! -f "$DIR/src/index.js" ]; then
  curl -fsSL "$REPO_ZIP" -o /tmp/mf.zip && rm -rf /tmp/mf-src && mkdir -p /tmp/mf-src && ditto -x -k /tmp/mf.zip /tmp/mf-src
  mkdir -p "$DIR" && cp -R /tmp/mf-src/*/. "$DIR/" && rm -rf /tmp/mf.zip /tmp/mf-src
fi
cd "$DIR"

say "Node.js"
if [ ! -x vendor/node/bin/node ]; then
  V=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep -oE "node-v[0-9.]+-darwin-$ARCH\.tar\.gz" | head -1)
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$V" -o /tmp/mf-node.tgz
  mkdir -p vendor/node && tar -xzf /tmp/mf-node.tgz -C vendor/node --strip-components 1 && rm /tmp/mf-node.tgz
fi
export PATH="$DIR/vendor/node/bin:$HOME/.local/bin:$PATH"
npm ci --omit=dev --no-audit --no-fund >/dev/null
mkdir -p vendor/browser && (cd vendor/browser && { [ -f package.json ] || echo '{ "private": true }' > package.json; } && npm install --no-audit --no-fund --silent chrome-devtools-mcp@1.13.0 >/dev/null)

say "Claude Code и uv"
[ -x "$HOME/.local/bin/claude" ] || curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1 || echo "Claude Code не поставился: вход в Claude будет по токену"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true

say "Настройки"
[ -f .env ] || cp .env.example .env
chmod 600 .env
CODE=$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 20)
set_env SETUP_CODE "$CODE"; set_env MF_MODE computer; set_env HOST 127.0.0.1; set_env PORT "$PORT"; set_env TUNNEL off
set_env UVX_PATH "$HOME/.local/bin/uvx"
NODE="$DIR/vendor/node/bin/node"
CDT="$DIR/vendor/browser/node_modules/chrome-devtools-mcp/out/Default/gen/src/bin/chrome-devtools-mcp.js"
APP=""; for d in /Applications "$HOME/Applications"; do [ -d "$d/macos-apps-mcp.app" ] && APP="$d/macos-apps-mcp.app"; done
if [ ! -f mcp.json ]; then
  "$NODE" -e '
    const [node, cdt, app, dir] = process.argv.slice(1);
    const s = {
      computer: { command: "npx", args: ["-y", "@zavora-ai/computer-use-mcp@7.8.0"] },
      chrome: { command: node, args: [cdt, "--userDataDir", dir + "/data/chrome-profile", "--usageStatistics", "false", "--performanceCrux", "false"] },
    };
    if (app) s.apple = { command: app + "/Contents/MacOS/macos-apps-mcp", args: ["-E", "-s", "-P", "-m", "macos_apps_mcp", "shim"] };
    require("fs").writeFileSync("mcp.json", JSON.stringify({ mcpServers: s }, null, 2) + "\n");
  ' "$NODE" "$CDT" "$APP" "$DIR"
fi
[ -n "$APP" ] || echo "Для Почты, Календаря и Заметок поставь приложение macos-apps-mcp (github.com/elfensky/macos-apps-mcp/releases) и запусти команду ещё раз."

say "Автозапуск"
zsh scripts/install-autostart.sh >/dev/null
for i in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$PORT/setup/" && break; sleep 2; done
say "Готово. Открываю мастер настройки."
open "http://127.0.0.1:$PORT/setup/?code=$CODE" || echo "Открой в браузере: http://127.0.0.1:$PORT/setup/?code=$CODE"
