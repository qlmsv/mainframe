#!/bin/zsh
# Saves a `claude setup-token` token into the mainframe .env without showing it, and checks it.
# Paste the token (it may span several lines), then press Enter on an empty line.
ENV=$HOME/Assistant/mainframe/.env
echo "Вставь токен (⌘V) и нажми Enter два раза:"
T=""
while IFS= read -rs line; do [[ -z $line ]] && break; T+=$line; done
T=$(printf '%s' "$T" | tr -d '[:space:]│|')
T=${T#*sk-ant-oat01-}; [[ -n $T ]] && T="sk-ant-oat01-${T%%[^A-Za-z0-9_-]*}"
if [[ ${#T} -lt 90 ]]; then echo "Это не похоже на токен (длина ${#T}). Скопируй его целиком и запусти ещё раз."; exit 1; fi
sed -i '' "s|^CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=$T|" $ENV
echo "Записал (длина ${#T}). Проверяю…"
cd /tmp && if CLAUDE_CODE_OAUTH_TOKEN=$T $HOME/Assistant/mainframe/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude -p "Ответь одним словом: работает" < /dev/null 2>/dev/null | grep -qi работает; then echo "✅ Токен работает"; else echo "❌ Claude не принял токен. Запусти claude setup-token ещё раз."; fi
