#!/bin/zsh
# Установка мейнфрейма: зависимости, telegram-mcp, конфиги.
set -e
cd "$(dirname "$0")/.."

echo "→ Node-зависимости"
npm install --no-fund --no-audit

echo "→ telegram-mcp (только из git: пакет с таким именем на PyPI чужой)"
if [ ! -d vendor/telegram-mcp ]; then
  git clone --depth 1 https://github.com/chigwell/telegram-mcp.git vendor/telegram-mcp
else
  git -C vendor/telegram-mcp pull --ff-only || true
fi
command -v uv >/dev/null || { echo "Нужен uv: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
uv sync --directory vendor/telegram-mcp

[ -f .env ] || { cp .env.example .env; echo "→ Создан .env, заполни его"; }
[ -f mcp.json ] || { cp mcp.example.json mcp.json; echo "→ Создан mcp.json"; }
mkdir -p data kb

[ -d /Applications/macos-apps-mcp.app ] || echo "! Для Почты, Календаря и Заметок поставь приложение macos-apps-mcp: github.com/elfensky/macos-apps-mcp/releases → /Applications, открыть один раз"
command -v cloudflared >/dev/null || echo "! Для Mini App поставь cloudflared: brew install cloudflared"

echo
echo "Дальше:"
echo "  1. claude auth login                (вход в подписку Claude)"
echo "  2. впиши BOT_TOKEN в .env           (бот от @BotFather)"
echo "  3. scripts/telegram-login.sh        (аккаунт Telegram, по QR)"
echo "  4. npm start                        (или scripts/install-autostart.sh)"
