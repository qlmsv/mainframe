#!/bin/bash
# Обновление помощника на сервере: код, зависимости, Claude Code, браузер, коннекторы, перезапуск.
#   bash ~/mainframe/scripts/update.sh
set -euo pipefail
DIR="${MAINFRAME_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
SERVICE="${MAINFRAME_SERVICE:-mainframe}"
cd "$DIR"
printf '\n\033[1;36m▸ Код\033[0m\n'
if [ -d .git ]; then git pull --ff-only; else echo "Не git-копия: код не обновляю"; fi
npm ci --omit=dev --no-audit --no-fund >/dev/null
[ -d vendor/telegram-mcp ] && (cd vendor/telegram-mcp && uv sync -q) || true
MAINFRAME_DIR="$DIR" bash scripts/server-tools.sh
if [ -d /run/systemd/system ] && systemctl cat "$SERVICE" >/dev/null 2>&1; then
  printf '\n\033[1;36m▸ Перезапуск\033[0m\n'; sudo systemctl restart "$SERVICE" && echo "Готово."
else echo "Готово. Перезапусти помощника вручную (npm start)."; fi
