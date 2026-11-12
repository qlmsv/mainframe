#!/bin/bash
# Мост Mac → сервер помощника. Команду с одноразовым кодом даёт пульт: Ещё → Система → Компьютер.
#   curl -fsSL https://<сервер>/bridge/<код>/mac.sh | bash
# Что даёт серверу (всё через один SSH-туннель, который открывает сам Mac, на Mac снаружи ничего не слушает):
#   браузер (твой Chrome с отдельным профилем, входы на сайты сохраняются), управление Mac,
#   Почта, Календарь, Заметки, Напоминания (приложение macos-apps-mcp), голосовые (по желанию),
#   задачи с кодом на этом Mac (если включён «Удалённый вход»).
# Пароль от сервера не нужен: Mac отправляет серверу свой ключ вместе с кодом, и сервер пускает
# этот ключ только на порты моста. Повторный запуск с новым кодом безопасен.
# Для проверки рядом с рабочим мостом: MF_BRIDGE_DIR, MF_LABEL, MF_PORT_SHIFT (сдвиг всех портов),
# MF_CHROME_PORT (взять уже открытый Chrome с этим портом отладки, свой не запускать), MF_NO_SSH=1.
set -euo pipefail
MF_URL="${MF_URL:-__MF_URL__}"
MF_TOKEN="${MF_TOKEN:-__MF_TOKEN__}"
M="${MF_BRIDGE_DIR:-$HOME/.mainframe-mac}"
LABEL="${MF_LABEL:-com.mainframe.bridge}"
SHIFT="${MF_PORT_SHIFT:-0}"
P_APPLE=$((8801 + SHIFT)); P_COMPUTER=$((8802 + SHIFT)); P_CHROME=$((8803 + SHIFT)); P_WHISPER=$((8178 + SHIFT)); P_SSH=$((2222 + SHIFT)); P_DEBUG=$((9222 + SHIFT))
LA="$HOME/Library/LaunchAgents"
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
TTY=0; { exec 3</dev/tty; } 2>/dev/null && TTY=1 && exec 3<&-
ask() { local v=""; if [ "$TTY" = 1 ]; then read -r -p "$1 [$2]: " v < /dev/tty || true; fi; echo "${v:-$2}"; }
pause() { [ "$TTY" = 1 ] && read -r -p "$1 Потом нажми Enter. " _ < /dev/tty || true; }

[ "$(uname)" = Darwin ] || { echo "Этот скрипт для Mac. Для Windows возьми команду для Windows в пульте."; exit 1; }
case "$MF_TOKEN" in __*|"") echo "Нет кода подключения. Возьми команду в пульте: Ещё → Система → Компьютер."; exit 1;; esac
mkdir -p "$M/logs" "$LA" "$HOME/.ssh"
ARCH=$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )

say "Node.js (в папке моста, без пароля администратора)"
if [ -x "$M/node/bin/node" ]; then :; else
  V=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep -oE "node-v[0-9.]+-darwin-$ARCH\.tar\.gz" | head -1)
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$V" -o /tmp/mf-node.tgz
  rm -rf "$M/node" && mkdir -p "$M/node" && tar -xzf /tmp/mf-node.tgz -C "$M/node" --strip-components 1 && rm /tmp/mf-node.tgz
fi
export PATH="$M/node/bin:$PATH"
NODE="$M/node/bin/node"

say "Компоненты моста"
cd "$M"
[ -f package.json ] || echo '{ "private": true }' > package.json
npm install --no-audit --no-fund --silent supergateway@4.2.2 chrome-devtools-mcp@1.13.0 @zavora-ai/computer-use-mcp@7.8.0 >/dev/null
SG="$M/node_modules/.bin/supergateway"

FEAT_APPLE=0; FEAT_CHROME=0; FEAT_WHISPER=0; FEAT_SSH=0; FEAT_COMPUTER=1

say "Почта, Календарь, Заметки, Напоминания"
APP=""
for d in /Applications "$HOME/Applications"; do [ -d "$d/macos-apps-mcp.app" ] && APP="$d/macos-apps-mcp.app"; done
if [ -z "$APP" ] && [ "$(ask 'Подключить приложения Apple? (да/нет)' 'да')" = "да" ]; then
  DEST=/Applications; [ -w /Applications ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
  URL=$(curl -fsSL https://api.github.com/repos/elfensky/macos-apps-mcp/releases/latest | grep -oE '"browser_download_url": *"[^"]+\.zip"' | head -1 | sed 's/.*"\(http[^"]*\)"/\1/')
  if [ -n "$URL" ]; then curl -fsSL "$URL" -o /tmp/mf-apps.zip && ditto -x -k /tmp/mf-apps.zip "$DEST/" && rm /tmp/mf-apps.zip && APP="$DEST/macos-apps-mcp.app"; fi
  if [ -n "$APP" ]; then
    open "$APP" || true
    echo "macOS спросит доступ к Календарю, Напоминаниям, Заметкам и Почте: разреши."
    echo "Для Почты: Системные настройки → Конфиденциальность и безопасность → Полный доступ к диску → macos-apps-mcp."
    pause "Дай разрешения."
  else echo "Не скачалось, пропускаю. Можно поставить позже: github.com/elfensky/macos-apps-mcp/releases"; fi
fi
[ -n "$APP" ] && FEAT_APPLE=1

say "Браузер"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -n "${MF_CHROME_PORT:-}" ]; then
  FEAT_CHROME=1; P_DEBUG="$MF_CHROME_PORT"; echo "Беру уже открытый Chrome (порт отладки $P_DEBUG)."
elif [ -x "$CHROME" ]; then
  FEAT_CHROME=1
  echo "Помощник получит отдельное окно Chrome со своим профилем: войди в нём на нужные сайты один раз."
else
  echo "Google Chrome не найден: браузер будет работать на сервере. Поставь Chrome и запусти команду ещё раз, если нужен браузер со входами."
fi

say "Голосовые"
if [ "$ARCH" = arm64 ] && [ "$(ask 'Расшифровывать голосовые на этом Mac (скачает ~550 МБ)? (да/нет)' 'нет')" = "да" ]; then
  curl -fsSL "${MAINFRAME_RAW:-https://github.com/qlmsv/mainframe/raw/main}/scripts/install-whisper.sh" -o "$M/install-whisper.sh"
  WHISPER_DIR="$M/whisper" WHISPER_PORT="$P_WHISPER" WHISPER_LABEL="$LABEL-whisper" bash "$M/install-whisper.sh" && FEAT_WHISPER=1 || echo "Не получилось, голосовые будут расшифровываться на сервере."
fi

say "Задачи с кодом на этом Mac"
if [ -z "${MF_NO_SSH:-}" ] && nc -z -G 2 127.0.0.1 22 2>/dev/null; then
  FEAT_SSH=1
  [ -x "$HOME/.local/bin/claude" ] || curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1 || true
  ln -sf "$HOME/.local/bin/claude" "$M/claude" 2>/dev/null || true
else
  [ -n "${MF_NO_SSH:-}" ] && echo "Пропускаю (MF_NO_SSH)." || echo "«Удалённый вход» выключен: задачи с кодом будут идти на сервере. Включить: Системные настройки →"
  echo "Основные → Общий доступ → Удалённый вход, потом запусти команду ещё раз (с новым кодом)."
fi

say "Подключаюсь к серверу"
KEY="$HOME/.ssh/mainframe_bridge"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "mainframe-bridge-$(hostname -s)" -f "$KEY" -q
BODY=$("$NODE" -e 'const [t,u,k,h,a,c,w,s]=process.argv.slice(1);console.log(JSON.stringify({token:t,os:"mac",user:u,pubkey:k,hostname:h,features:{apple:a==="1",computer:true,chrome:c==="1",whisper:w==="1",ssh:s==="1"}}))' \
  "$MF_TOKEN" "$USER" "$(cat "$KEY.pub")" "$(hostname -s)" "$FEAT_APPLE" "$FEAT_CHROME" "$FEAT_WHISPER" "$FEAT_SSH")
OUT=$(curl -fsS -X POST -H 'content-type: application/json' --data "$BODY" "$MF_URL/bridge/register") || { echo "Сервер не принял подключение. Возьми новую команду в пульте (код действует час и один раз)."; exit 1; }
j() { printf '%s' "$OUT" | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);if(o.error){console.error(o.error);process.exit(1)}console.log(o[process.argv[1]]??'')})" "$1"; }
S_USER=$(j sshUser); S_HOST=$(j sshHost); S_PORT=$(j sshPort); HOSTKEY=$(j hostKey); SKEY=$(j serverKey)
[ -n "$S_HOST" ] || { echo "Сервер не сообщил свой адрес."; exit 1; }
KH="$M/known_hosts"
if [ -n "$HOSTKEY" ]; then echo "$S_HOST $HOSTKEY" > "$KH"; CHECK=yes; else : > "$KH"; CHECK=accept-new; fi
if [ "$FEAT_SSH" = 1 ] && [ -n "$SKEY" ]; then
  touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys"
  grep -qF "$SKEY" "$HOME/.ssh/authorized_keys" || echo "from=\"127.0.0.1,::1\" $SKEY" >> "$HOME/.ssh/authorized_keys"
fi

say "Службы моста (запускаются сами при входе в macOS)"
agent() { # name, program args (plist strings)
  local L="$LABEL-$1"
  launchctl bootout "gui/$(id -u)/$L" 2>/dev/null && sleep 1 || true
  cat > "$LA/$L.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$L</string>
  <key>ProgramArguments</key><array>$2</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$M/node/bin:$M/node_modules/.bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$M/logs/$1.log</string><key>StandardErrorPath</key><string>$M/logs/$1.log</string>
</dict></plist>
PL
  launchctl bootstrap "gui/$(id -u)" "$LA/$L.plist"
}
s() { printf '<string>%s</string>' "$@"; }
FWD=(-R "127.0.0.1:$P_COMPUTER:127.0.0.1:$P_COMPUTER")
agent computer "$(s "$SG" --stdio "$M/node_modules/.bin/computer-use-mcp" --outputTransport streamableHttp --stateful --port "$P_COMPUTER")"
if [ "$FEAT_APPLE" = 1 ]; then
  agent apple "$(s "$SG" --stdio "$APP/Contents/MacOS/macos-apps-mcp -E -s -P -m macos_apps_mcp shim" --outputTransport streamableHttp --stateful --port "$P_APPLE")"
  FWD+=(-R "127.0.0.1:$P_APPLE:127.0.0.1:$P_APPLE")
fi
if [ "$FEAT_CHROME" = 1 ]; then
  [ -z "${MF_CHROME_PORT:-}" ] && agent chrome "$(s "$CHROME" "--user-data-dir=$M/chrome-profile" "--remote-debugging-port=$P_DEBUG" --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check --restore-last-session --disable-background-timer-throttling --disable-renderer-backgrounding)"
  agent browser "$(s "$SG" --stdio "$M/node_modules/.bin/chrome-devtools-mcp --browserUrl http://127.0.0.1:$P_DEBUG --usageStatistics false --performanceCrux false --screenshotFormat jpeg --screenshotMaxWidth 1280" --outputTransport streamableHttp --stateful --port "$P_CHROME")"
  FWD+=(-R "127.0.0.1:$P_CHROME:127.0.0.1:$P_CHROME")
fi
[ "$FEAT_WHISPER" = 1 ] && FWD+=(-R "127.0.0.1:$P_WHISPER:127.0.0.1:$P_WHISPER")
[ "$FEAT_SSH" = 1 ] && FWD+=(-R "127.0.0.1:$P_SSH:127.0.0.1:22")
agent tunnel "$(s /usr/bin/ssh -N -i "$KEY" -p "$S_PORT" -o BatchMode=yes -o IdentitiesOnly=yes -o "UserKnownHostsFile=$KH" -o "StrictHostKeyChecking=$CHECK" -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 "${FWD[@]}" "$S_USER@$S_HOST")"

sleep 6
if launchctl print "gui/$(id -u)/$LABEL-tunnel" 2>/dev/null | grep -q "state = running"; then
  say "Готово. Mac подключён к помощнику."
else
  say "Службы поставлены, туннель пока не поднялся. Лог: $M/logs/tunnel.log"
fi
echo "Работает, пока Mac включён. Когда он выключен, сервер продолжает работу без него."
[ "$FEAT_CHROME" = 1 ] && echo "Откроется окно Chrome помощника: войди в нём на сайты, с которыми он будет работать."
echo "Отключить мост: for s in tunnel computer apple chrome browser; do launchctl bootout gui/\$(id -u)/$LABEL-\$s; rm -f $LA/$LABEL-\$s.plist; done"
