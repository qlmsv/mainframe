#!/bin/bash
# Мост Mac → сервер мейнфрейма. Запуск на Mac:
#   bash <(curl -fsSL <адрес репозитория>/raw/main/scripts/install-mac.sh) ubuntu@1.2.3.4 [путь к ключу .pem]
# Что делает: отдаёт серверу Почту, Календарь, Заметки, Напоминания (приложение macos-apps-mcp),
# управление Mac и расшифровку голосовых, и разрешает серверу запускать на этом Mac сессии
# Claude для проектов, чьи файлы лежат здесь. Всё идёт через один SSH-туннель, который Mac
# открывает сам: на Mac ничего не слушает снаружи.
set -euo pipefail
SERVER="${1:?Укажи сервер: ubuntu@IP}"
PEM="${2:-}"
SDK_VERSION="0.3.319"
M="$HOME/.mainframe-mac"
LA="$HOME/Library/LaunchAgents"
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
pause() { read -r -p "$1 Потом нажми Enter. " _ < /dev/tty; }

[ "$(uname)" = Darwin ] || { echo "Этот скрипт для Mac."; exit 1; }
mkdir -p "$M/logs" "$LA" "$HOME/.ssh"

say "Node.js"
if ! command -v node >/dev/null; then
  echo "Нужен Node.js. Скачай и установи LTS-версию с https://nodejs.org (обычный установщик .pkg)."
  pause "Установи Node.js."
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
fi
NODE_DIR=$(dirname "$(command -v node)")

say "Компоненты моста в $M"
cd "$M"
[ -f package.json ] || echo '{ "private": true }' > package.json
npm install --no-audit --no-fund --silent supergateway@4.2.1 "@anthropic-ai/claude-agent-sdk@$SDK_VERSION" >/dev/null
ARCH=$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )
ln -sf "$M/node_modules/@anthropic-ai/claude-agent-sdk-darwin-$ARCH/claude" "$M/claude"
SG="$M/node_modules/.bin/supergateway"

say "Приложения Apple (Почта, Календарь, Заметки, Напоминания)"
if [ ! -d /Applications/macos-apps-mcp.app ]; then
  URL=$(curl -fsSL https://api.github.com/repos/elfensky/macos-apps-mcp/releases/latest | grep -oE '"browser_download_url": *"[^"]+\.zip"' | head -1 | sed 's/.*"\(http[^"]*\)"/\1/')
  if [ -n "$URL" ]; then
    curl -fsSL "$URL" -o /tmp/macos-apps-mcp.zip && ditto -x -k /tmp/macos-apps-mcp.zip /Applications/ && rm /tmp/macos-apps-mcp.zip
  else
    echo "Скачай macos-apps-mcp с https://github.com/elfensky/macos-apps-mcp/releases и положи в Программы."
    pause "Положи приложение в Программы."
  fi
  open /Applications/macos-apps-mcp.app || true
  echo "macOS спросит доступ к Календарю, Напоминаниям, Заметкам и Почте: разреши. Для Почты нужен"
  echo "«Полный доступ к диску»: Системные настройки → Конфиденциальность и безопасность → Полный доступ к диску → macos-apps-mcp."
  pause "Дай разрешения."
fi

say "Удалённый вход (сервер будет запускать здесь сессии через туннель)"
if ! nc -z -G 2 127.0.0.1 22 2>/dev/null; then
  echo "Включи: Системные настройки → Основные → Общий доступ → Удалённый вход."
  pause "Включи удалённый вход."
fi

say "Ключи доступа"
KEY="$HOME/.ssh/mainframe_server"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "mainframe-mac" -f "$KEY" -q
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "$PEM" ] && SSH_OPTS+=(-i "$PEM")
ssh "${SSH_OPTS[@]}" "$SERVER" "mkdir -p ~/.ssh && grep -qF '$(cat "$KEY.pub")' ~/.ssh/authorized_keys 2>/dev/null || echo '$(cat "$KEY.pub")' >> ~/.ssh/authorized_keys"
SRV=(ssh -i "$KEY" -o BatchMode=yes "$SERVER")
"${SRV[@]}" 'test -f ~/.ssh/to_mac || ssh-keygen -t ed25519 -N "" -C "mainframe-server-to-mac" -f ~/.ssh/to_mac -q'
TOMAC=$("${SRV[@]}" 'cat ~/.ssh/to_mac.pub')
touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys"
grep -qF "$TOMAC" "$HOME/.ssh/authorized_keys" || echo "from=\"127.0.0.1,::1\" $TOMAC" >> "$HOME/.ssh/authorized_keys"

say "Токен Claude для сессий на этом Mac"
if ! grep -q "^CLAUDE_CODE_OAUTH_TOKEN=..*" "$M/.env" 2>/dev/null; then
  echo "Сейчас откроется вход в Claude. В конце будет длинный токен (sk-ant-oat01-…): выдели его целиком и скопируй."
  "$M/claude" setup-token < /dev/tty || true
  echo "Вставь токен (⌘V) и нажми Enter два раза:"
  T=""; while IFS= read -rs line < /dev/tty; do [ -z "$line" ] && break; T+="$line"; done
  T=$(printf '%s' "$T" | tr -d '[:space:]│|'); T=${T#*sk-ant-oat01-}; T="sk-ant-oat01-${T%%[^A-Za-z0-9_-]*}"
  [ ${#T} -gt 90 ] && { echo "CLAUDE_CODE_OAUTH_TOKEN=$T" > "$M/.env"; chmod 600 "$M/.env"; echo "Записал."; } || echo "Не похоже на токен, пропускаю: сессии на Mac пока не заработают."
fi

say "Голосовые"
WHISPER=0
if [ "$(uname -m)" = arm64 ] && read -r -p "Расшифровывать голосовые на этом Mac (скачает ~550 МБ, соберёт whisper.cpp)? (да/нет) [да]: " a < /dev/tty && [ "${a:-да}" = "да" ]; then
  curl -fsSL "${MAINFRAME_RAW:-https://github.com/qlmsv/mainframe/raw/main}/scripts/install-whisper.sh" -o "$M/install-whisper.sh"
  WHISPER_DIR="$M/whisper" bash "$M/install-whisper.sh" && WHISPER=1 || echo "Не получилось, голосовые можно подключить позже."
fi

say "Службы моста"
agent() { # label, program args (plist strings)
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null && sleep 2 || true
  cat > "$LA/$1.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array>$2</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$M/logs/$1.log</string><key>StandardErrorPath</key><string>$M/logs/$1.log</string>
</dict></plist>
PL
  launchctl bootstrap "gui/$(id -u)" "$LA/$1.plist"
}
s() { printf '<string>%s</string>' "$@"; }
agent com.mainframe.bridge-apple "$(s "$SG" --stdio '/Applications/macos-apps-mcp.app/Contents/MacOS/macos-apps-mcp -E -s -P -m macos_apps_mcp shim' --outputTransport streamableHttp --stateful --port 8801)"
agent com.mainframe.bridge-computer "$(s "$SG" --stdio 'npx -y @zavora-ai/computer-use-mcp' --outputTransport streamableHttp --stateful --port 8802)"
agent com.mainframe.tunnel "$(s /usr/bin/ssh -N -i "$KEY" -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -R 127.0.0.1:8801:127.0.0.1:8801 -R 127.0.0.1:8802:127.0.0.1:8802 -R 127.0.0.1:8178:127.0.0.1:8178 -R 127.0.0.1:2222:127.0.0.1:22 "$SERVER")"
sleep 8

say "Настраиваю сервер"
"${SRV[@]}" "bash -s" <<EOF
set -e
D=\$(systemctl cat mainframe 2>/dev/null | sed -n 's/^WorkingDirectory=//p'); D=\${D:-\$HOME/mainframe}
cd "\$D"
set_env() { if grep -q "^\$1=" .env; then sed -i "s|^\$1=.*|\$1=\$2|" .env; else echo "\$1=\$2" >> .env; fi; }
set_env MAC_USER "$USER"
set_env MAC_RUNNER "\$D/scripts/mac-claude.sh"
[ "$WHISPER" = 1 ] && set_env WHISPER_URL http://127.0.0.1:8178
printf '{\n  "mcpServers": {\n    "apple": { "type": "http", "url": "http://127.0.0.1:8801/mcp" },\n    "computer": { "type": "http", "url": "http://127.0.0.1:8802/mcp" }\n  }\n}\n' > mcp.json
ssh -p 2222 -i ~/.ssh/to_mac -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$USER@127.0.0.1" true && echo "сервер видит Mac"
sudo systemctl restart mainframe
EOF
say "Готово. Mac подключён к мейнфрейму: почта, календарь, заметки, управление Mac$( [ $WHISPER = 1 ] && echo ', голосовые'), сессии по коду."
echo "Если Mac выключен, сервер продолжает работать, а задачи для Mac ждут его."
