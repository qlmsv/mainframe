#!/bin/bash
# Инструменты сервера, которые работают с любой моделью: Claude Code (официальный установщик,
# чтобы пользоваться им и самому: команда claude), браузер без экрана (Chromium + chrome-devtools-mcp)
# и сервер Google Календаря и Диска (workspace-mcp). Ставит и обновляет: повторный запуск безопасен.
# Вызывается из install-server.sh и update.sh. Запуск вручную: bash scripts/server-tools.sh
set -uo pipefail
DIR="${MAINFRAME_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$DIR"
export PATH="$HOME/.local/bin:$PATH"
set_env() { local f="$DIR/.env"; touch "$f"; if grep -q "^$1=" "$f"; then sed -i "s|^$1=.*|$1=$2|" "$f"; else echo "$1=$2" >> "$f"; fi; }
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

say "Claude Code (официальная установка: claude.ai/install.sh)"
if [ -x "$HOME/.local/bin/claude" ]; then
  "$HOME/.local/bin/claude" update >/dev/null 2>&1 || true
else
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1 || echo "Claude Code не поставился: потом bash scripts/server-tools.sh"
fi
[ -x "$HOME/.local/bin/claude" ] && sudo -n ln -sf "$HOME/.local/bin/claude" /usr/local/bin/claude 2>/dev/null; "$HOME/.local/bin/claude" --version 2>/dev/null || true

say "Браузер на сервере (Chromium без экрана, chrome-devtools-mcp)"
mkdir -p vendor/browser
( cd vendor/browser
  [ -f package.json ] || echo '{ "private": true }' > package.json
  npm install --no-audit --no-fund --silent chrome-devtools-mcp@1.13.0 playwright@1.65.0 >/dev/null
  # --with-deps installs the system libraries Chromium needs (needs sudo; already there: skipped quickly).
  if sudo -n true 2>/dev/null; then npx playwright install --with-deps chromium >/dev/null 2>&1 || npx playwright install chromium >/dev/null 2>&1
  else npx playwright install chromium >/dev/null 2>&1; fi )
BROWSER=$(find "$HOME/.cache/ms-playwright" -type f -name chrome -path '*chrome-linux*' 2>/dev/null | sort | tail -1)
if [ -n "$BROWSER" ]; then set_env BROWSER_PATH "$BROWSER"; echo "Браузер: $BROWSER"; else echo "Chromium не поставился: браузер на сервере выключен."; fi

say "Google Календарь и Диск (workspace-mcp)"
command -v uvx >/dev/null && { uvx workspace-mcp@latest --help >/dev/null 2>&1 && echo "workspace-mcp готов"; } || echo "uv не найден: Google подключится при первом использовании"
UVX=$(command -v uvx || true); [ -n "$UVX" ] && set_env UVX_PATH "$UVX"
exit 0
