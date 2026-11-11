#!/bin/bash
# Установка личного мейнфрейма на чистый сервер Ubuntu 22.04 или 24.04 (x86 или ARM).
#   curl -fsSL https://raw.githubusercontent.com/qlmsv/mainframe/main/scripts/install-server.sh | bash
# Можно от root: скрипт сам создаст пользователя mainframe и продолжит от него.
# или из клона репозитория: bash scripts/install-server.sh
# Что делает: подкачка, файрвол, Node 24, uv, Caddy (https на адресе вида 1-2-3-4.sslip.io),
# код в ~/mainframe, telegram-mcp, служба systemd. Потом по шагам спрашивает бота, имя, Telegram
# и вход в Claude. Повторный запуск безопасен: уже сделанное пропускается.
#
# Флаги для проверки на занятом сервере: --dir DIR --port PORT --service NAME --no-caddy --no-system
set -euo pipefail

DIR="$HOME/mainframe"; PORT=7777; SERVICE=mainframe; CADDY=1; SYSTEM=1
REPO_URL="${MAINFRAME_REPO:-https://github.com/qlmsv/mainframe.git}"
TG_MCP_REPO="https://github.com/chigwell/telegram-mcp.git"; TG_MCP_COMMIT="1451ae7"
while [ $# -gt 0 ]; do case "$1" in
  --dir) DIR="$2"; shift 2;; --port) PORT="$2"; shift 2;; --service) SERVICE="$2"; shift 2;;
  --no-caddy) CADDY=0; shift;; --no-system) SYSTEM=0; shift;; *) echo "Неизвестный флаг $1"; exit 1;;
esac; done

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
# Answers come from the keyboard. Without a terminal (automatic check, container) the default is used.
HAS_TTY=0; { exec 3</dev/tty; } 2>/dev/null && HAS_TTY=1 && exec 3<&-
ask() { local q="$1" def="${2:-}" v=""; if [ "$HAS_TTY" = 1 ]; then read -r -p "$q${def:+ [$def]}: " v < /dev/tty || true; else echo "$q: [$def] (нет терминала, беру по умолчанию)" >&2; fi; echo "${v:-$def}"; }
# Inside a container there is no systemd: the service, firewall and clock steps are skipped.
HAS_SYSTEMD=0; [ -d /run/systemd/system ] && HAS_SYSTEMD=1
set_env() { local k="$1" v="$2" f="$DIR/.env"; if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=$v|" "$f"; else echo "$k=$v" >> "$f"; fi; }

# Run as root (Hetzner and most hosts give root): create a regular user "mainframe" with sudo
# and continue as that user, so the service never runs as root.
if [ "$(id -u)" = 0 ]; then
  MF_USER="${MF_USER:-mainframe}"
  id "$MF_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$MF_USER"
  echo "$MF_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$MF_USER" && chmod 440 "/etc/sudoers.d/90-$MF_USER"
  if [ -s /root/.ssh/authorized_keys ]; then
    mkdir -p "/home/$MF_USER/.ssh" && cp /root/.ssh/authorized_keys "/home/$MF_USER/.ssh/" && chown -R "$MF_USER:$MF_USER" "/home/$MF_USER/.ssh" && chmod 700 "/home/$MF_USER/.ssh"
  fi
  SELF=/tmp/mainframe-install-server.sh
  # Started from a copy of the code (not curl | bash): the new user installs from that copy.
  SRC_FROM=""; [ -f "$(dirname "$0")/../src/index.js" ] && SRC_FROM="$(cd "$(dirname "$0")/.." && pwd)" && chmod -R o+rX "$SRC_FROM" 2>/dev/null && chmod o+x "$(dirname "$SRC_FROM")" 2>/dev/null || true
  if [ -f "$0" ] && grep -q "Установка личного мейнфрейма" "$0" 2>/dev/null; then cp "$0" "$SELF"; else curl -fsSL "${MAINFRAME_INSTALL_URL:-https://raw.githubusercontent.com/qlmsv/mainframe/main/scripts/install-server.sh}" -o "$SELF"; fi
  chmod 755 "$SELF"
  echo "Продолжаю от пользователя $MF_USER (root для службы не нужен)."
  if { exec 3</dev/tty; } 2>/dev/null; then exec 3<&-; exec su - "$MF_USER" -c "MF_SRC_DIR='$SRC_FROM' bash $SELF $*" < /dev/tty; else exec su - "$MF_USER" -c "MF_SRC_DIR='$SRC_FROM' bash $SELF $*" < /dev/null; fi
fi
export DEBIAN_FRONTEND=noninteractive

if [ "$SYSTEM" = 1 ]; then
  say "Система: пакеты, подкачка, файрвол, часовой пояс"
  sudo apt-get update -qq
  sudo apt-get install -y -qq git sqlite3 build-essential python3-venv ufw fail2ban unattended-upgrades ffmpeg jq curl >/dev/null
  if ! swapon --show | grep -q . && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 3500 ]; then
    sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
    echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  fi
  if [ "$HAS_SYSTEMD" = 1 ]; then
    TZ_NEW=$(ask "Часовой пояс (для сводок и расписания), например Europe/Moscow или Asia/Almaty" "$(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)")
    sudo timedatectl set-timezone "$TZ_NEW" || true
    # Password login is switched off only when a key is already in place, or the owner would be locked out.
    if [ -s "$HOME/.ssh/authorized_keys" ]; then sudo sed -i "s/^#\?PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config && sudo systemctl reload ssh || true; fi
    sudo ufw allow OpenSSH >/dev/null; sudo ufw allow 80/tcp >/dev/null; sudo ufw allow 443/tcp >/dev/null; sudo ufw --force enable >/dev/null
    sudo systemctl enable --now fail2ban >/dev/null 2>&1 || true
  fi
  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - >/dev/null 2>&1 && sudo apt-get install -y -qq nodejs >/dev/null
  fi
  command -v uv >/dev/null || [ -x "$HOME/.local/bin/uv" ] || curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1
  # Mac projects keep their Mac paths on the server: /Users must be writable for their empty folders.
  sudo mkdir -p /Users && sudo chown "$USER" /Users
fi
export PATH="$HOME/.local/bin:$PATH"

say "Код мейнфрейма в $DIR"
if [ ! -d "$DIR/.git" ] && [ ! -f "$DIR/src/index.js" ]; then
  SRC_DIR="${MF_SRC_DIR:-}"; [ -z "$SRC_DIR" ] && [ -f "$(dirname "$0")/../src/index.js" ] && SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  if [ -n "$SRC_DIR" ] && [ "$SRC_DIR" != "$DIR" ]; then
    mkdir -p "$DIR/kb" && cp -r "$SRC_DIR"/{src,public,scripts,package.json,package-lock.json,mcp.example.json,.env.example,README.md,LICENSE} "$DIR"/ 2>/dev/null || true
    # Only the shared part: the author's personal scripts and knowledge base stay behind.
    rm -rf "$DIR/scripts/personal"
    cp -r "$SRC_DIR/kb/README.md" "$SRC_DIR/kb/примеры" "$DIR/kb/" 2>/dev/null || true
  else
    git clone -q "$REPO_URL" "$DIR"
  fi
fi
cd "$DIR"
npm ci --omit=dev --no-audit --no-fund >/dev/null
if [ ! -d vendor/telegram-mcp ]; then
  git clone -q "$TG_MCP_REPO" vendor/telegram-mcp && git -C vendor/telegram-mcp checkout -q "$TG_MCP_COMMIT"
fi
(cd vendor/telegram-mcp && uv sync -q)
CLAUDE_BIN=$(ls -d "$DIR"/node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude 2>/dev/null | grep -v musl | head -1)
[ -n "$CLAUDE_BIN" ] && sudo ln -sf "$CLAUDE_BIN" /usr/local/bin/claude

say "Настройки"
[ -f .env ] || cp .env.example .env
chmod 600 .env
IP=$(curl -fsS -4 https://checkip.amazonaws.com 2>/dev/null || curl -fsS -4 https://ifconfig.me)
HOSTNAME_PUBLIC="${IP//./-}.sslip.io"
set_env HOST 127.0.0.1
set_env PORT "$PORT"
set_env TUNNEL off
[ "$CADDY" = 1 ] && set_env PUBLIC_URL "https://$HOSTNAME_PUBLIC"
set_env WORKSPACE_DIR "$HOME/workspace"; mkdir -p "$HOME/workspace"
set_env SERVER_DIRS "$HOME/workspace"
grep -q "^OWNER_NAME=..*" .env || set_env OWNER_NAME "$(ask 'Как тебя зовут (так агент будет к тебе обращаться)')"
if ! grep -q "^BOT_TOKEN=..*" .env; then
  echo "Создай бота у @BotFather в Telegram: /newbot, придумай имя. Он пришлёт токен."
  set_env BOT_TOKEN "$(ask 'Токен бота')"
fi
grep -q "^OWNER_TG_USERNAME=..*" .env || set_env OWNER_TG_USERNAME "$(ask 'Твой @username в Telegram без @ (Enter, если нет)' '')"
grep -q "^SOCIAL_TG_CHANNEL=..*" .env || set_env SOCIAL_TG_CHANNEL "$(ask 'Твой Telegram-канал без @ (Enter, если нет)' '')"
[ -f mcp.json ] || echo '{ "mcpServers": {} }' > mcp.json

if [ "$CADDY" = 1 ] && [ "$HAS_SYSTEMD" = 1 ]; then
  say "https для пульта: $HOSTNAME_PUBLIC"
  if ! command -v caddy >/dev/null; then
    sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update -qq && sudo apt-get install -y -qq caddy >/dev/null
  fi
  printf '%s {\n  encode gzip\n  reverse_proxy 127.0.0.1:%s {\n    flush_interval -1\n  }\n}\n' "$HOSTNAME_PUBLIC" "$PORT" | sudo tee /etc/caddy/Caddyfile >/dev/null
  sudo systemctl reload caddy || sudo systemctl restart caddy
  echo "Если у сервера облачный файрвол (AWS Security Group и т.п.), открой в нём порты 80 и 443."
fi

say "Вход в Claude (нужна подписка Pro или Max)"
if [ ! -f "$HOME/.claude/.credentials.json" ] && ! grep -q "^CLAUDE_CODE_OAUTH_TOKEN=..*" .env; then
  echo "Сейчас откроется вход: скопируй ссылку в браузер, войди, вставь код обратно сюда."
  claude auth login < /dev/tty || echo "Вход не завершён. Потом выполни: claude auth login"
fi

say "Telegram-аккаунт (входящие, группы, канал). Можно пропустить и подключить позже."
if ! grep -q "^TELEGRAM_SESSION_STRING=..*" .env && [ "$HAS_TTY" = 1 ] && [ "$(ask 'Подключить сейчас? (да/нет)' 'да')" = "да" ]; then
  echo "Нужны api_id и api_hash: https://my.telegram.org/apps (создай приложение, любое название)."
  set_env TELEGRAM_API_ID "$(ask 'api_id')"
  set_env TELEGRAM_API_HASH "$(ask 'api_hash')"
  bash scripts/telegram-login.sh < /dev/tty || echo "Вход в Telegram не завершён. Потом: bash scripts/telegram-login.sh"
fi

say "Голосовые: расшифровка прямо на сервере (whisper.cpp, 3–5 минут сборки)"
if [ "$(free -m | awk '/Mem:/{print $2}')" -ge 1500 ]; then
  bash scripts/install-whisper-server.sh || echo "Расшифровка голосовых не поставилась, это можно сделать позже: bash scripts/install-whisper-server.sh"
else
  echo "Памяти меньше 1.5 ГБ: расшифровку голосовых пропускаю."
fi

if [ "$HAS_SYSTEMD" = 0 ]; then
  say "systemd нет (контейнер): службу не ставлю. Запуск вручную: cd $DIR && npm start"
  exit 0
fi

say "Служба $SERVICE"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=Personal mainframe
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=$HOME
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning $DIR/src/index.js
Restart=always
RestartSec=5
StandardOutput=append:$DIR/data/logs/mainframe.log
StandardError=append:$DIR/data/logs/mainframe.log

[Install]
WantedBy=multi-user.target
EOF
mkdir -p data/logs data/backups
sudo systemctl daemon-reload && sudo systemctl enable --now "$SERVICE" >/dev/null 2>&1
(crontab -l 2>/dev/null | grep -v "$DIR/scripts/backup.sh"; echo "30 3 * * * MAINFRAME_DIR=$DIR $DIR/scripts/backup.sh >> $DIR/data/logs/backup.log 2>&1") | crontab -
for i in $(seq 1 30); do curl -fs -o /dev/null -H 'x-mf-client: 1' "http://127.0.0.1:$PORT/api/state" && break; sleep 2; done

TOKEN=$(cat data/dashboard-token.secret 2>/dev/null || true)
CODE=$(cat data/pairing-code.secret 2>/dev/null || true)
say "Готово"
echo "1. Открой своего бота в Telegram и отправь ему: /start $CODE"
[ "$CADDY" = 1 ] && echo "2. Пульт в браузере (личная ссылка, никому не пересылай): https://$HOSTNAME_PUBLIC/?token=$TOKEN"
echo "3. Если есть Mac: на нём выполни установку моста (почта, календарь, голосовые, проекты с кодом):"
echo "   bash <(curl -fsSL ${REPO_URL%.git}/raw/main/scripts/install-mac.sh) $USER@$IP"
