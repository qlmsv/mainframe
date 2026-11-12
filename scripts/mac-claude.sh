#!/bin/bash
# Runs the Claude Code CLI on the owner's Mac for projects whose files live there (the server only
# has an empty folder at the same path). The Agent SDK talks to it over stdin/stdout, which SSH
# carries as is. The Mac reads its own Claude token from the mainframe .env, so it never
# appears on a command line. Server-side services the session needs are forwarded with -L.
# Values come from the server .env (the SDK passes its environment through): MAC_USER, and on
# a standard install the Mac side lives in ~/.mainframe-mac (scripts/install-mac.sh).
MAC_USER=${MAC_USER:?MAC_USER не задан в .env}
MAC_CLAUDE=${MAC_CLAUDE:-\$HOME/.mainframe-mac/claude}
MAC_ENV_FILE=${MAC_ENV_FILE:-\$HOME/.mainframe-mac/.env}
q() { printf '%q' "$1"; }
cmd="cd $(q "$PWD") || exit 97;"
cmd+=' export PATH=/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin;'
# Another model provider (MODEL_PROVIDER, see src/models.js): its address and key come with the
# session, and the Mac's Claude token is not used. Otherwise the Mac signs in to Claude as before.
if [ -z "${ANTHROPIC_BASE_URL:-}" ]; then
  cmd+=" T=\$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' $MAC_ENV_FILE | cut -d= -f2-); [ -n \"\$T\" ] && export CLAUDE_CODE_OAUTH_TOKEN=\$T;"
else
  cmd+=" unset CLAUDE_CODE_OAUTH_TOKEN; export ANTHROPIC_API_KEY=$(q "${ANTHROPIC_API_KEY:-}");"
fi
for k in $(compgen -e); do
  case $k in
    CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY) ;;
    API_TIMEOUT_MS|ENABLE_CLAUDEAI_MCP_SERVERS) cmd+=" export $k=$(q "${!k}");" ;;
    MAC_*) ;;
    CLAUDE_*|ANTHROPIC_*|MCP_*|DISABLE_*|MAX_THINKING_TOKENS) cmd+=" export $k=$(q "${!k}");" ;;
  esac
done
cmd+=" exec $MAC_CLAUDE"
for a in "$@"; do cmd+=" $(q "$a")"; done
exec ssh -p 2222 -i "$HOME/.ssh/to_mac" -T -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=no -o LogLevel=ERROR -L 127.0.0.1:8765:127.0.0.1:8765 "$MAC_USER@127.0.0.1" "$cmd"
