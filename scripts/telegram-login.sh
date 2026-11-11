#!/bin/bash
# Вход в Telegram-аккаунт для экспериментов. Нужны TELEGRAM_API_ID и TELEGRAM_API_HASH в .env.
# Генератор telegram-mcp покажет QR-код и выдаст строку сессии. Скрипт сам перенесёт её в .env мейнфрейма.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
[ -f .env ] && set -a && source .env && set +a
if [ -z "$TELEGRAM_API_ID" ] || [ -z "$TELEGRAM_API_HASH" ]; then
  echo "Сначала впиши TELEGRAM_API_ID и TELEGRAM_API_HASH в .env (их выдают на https://my.telegram.org/apps)"
  exit 1
fi

echo "Как отвечать:"
echo "  • Account label: просто Enter"
echo "  • Метод входа: Enter (QR-код)"
echo "  • Telegram на телефоне: Настройки → Устройства → Подключить устройство, отсканируй QR"
echo "  • Если есть облачный пароль, введи его"
echo "  • «update your .env file?»: y"
echo

cd vendor/telegram-mcp
# The generator only updates an existing .env, so give it an empty one to write into.
: > .env
chmod 600 .env
uv run session_string_generator.py --qr || true

# The generator writes into its own folder's .env; move the string into ours.
SESSION="$(grep -E '^TELEGRAM_SESSION_STRING=' .env 2>/dev/null | head -1 | cut -d= -f2-)"
rm -f .env
cd "$ROOT"
if [ -n "$SESSION" ]; then
  if grep -qE '^TELEGRAM_SESSION_STRING=' .env; then
    python3 - "$SESSION" <<'PY'
import sys, re, pathlib
p = pathlib.Path('.env')
s = p.read_text(encoding='utf-8')
s = re.sub(r'^TELEGRAM_SESSION_STRING=.*$', lambda m: 'TELEGRAM_SESSION_STRING=' + sys.argv[1], s, flags=re.M)
p.write_text(s, encoding='utf-8')
PY
  else
    echo "TELEGRAM_SESSION_STRING=$SESSION" >> .env
  fi
  chmod 600 .env
  echo
  echo "✅ Строка сессии сохранена в .env мейнфрейма. Перезапусти мейнфрейм."
else
  echo
  echo "Строка сессии не сохранилась. Если генератор её напечатал, впиши вручную в .env: TELEGRAM_SESSION_STRING=..."
fi
