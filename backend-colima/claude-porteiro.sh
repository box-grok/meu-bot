#!/usr/bin/env bash
# meu-bot-porteiro: `claude` da casa. Escolhe a conta do Claude desta máquina (contas-claude.js do backend) e
# chama o Claude Code de verdade. Instalado por install-porteiro.sh em ~/.local/share/meu-bot/bin/claude, na frente
# do PATH do gateway do OpenClaw (WhatsApp) e dos shells (Terminal). Nunca bloqueia: qualquer dúvida → claude real.
# __NODE__ e __DEST__ são preenchidos na instalação (node do backend e pasta do backend).
NODE="${MEU_BOT_NODE:-__NODE__}"
DEST="${MEU_BOT_BACKEND_DIR:-__DEST__}"
SELF=$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")

# O claude real: CLAUDE_BIN do ambiente, senão o do .env do backend, senão o primeiro do PATH que não é este porteiro.
e_porteiro() { head -c 4096 "$1" 2>/dev/null | grep -q 'meu-bot-porteiro'; }
REAL="${CLAUDE_BIN:-}"
[ -n "$REAL" ] || REAL=$(grep '^CLAUDE_BIN=' "$DEST/.env" 2>/dev/null | head -1 | cut -d= -f2-)
if [ -z "$REAL" ] || [ ! -x "$REAL" ] || e_porteiro "$REAL"; then
  REAL=""
  IFS=: ; for d in $PATH; do
    c="$d/claude"; [ -x "$c" ] || continue
    [ "$(readlink -f "$c" 2>/dev/null || printf '%s' "$c")" = "$SELF" ] && continue
    e_porteiro "$c" && continue
    REAL="$c"; break
  done; unset IFS
fi
[ -n "$REAL" ] || { echo "meu-bot: o Claude Code (claude) não foi encontrado nesta máquina" >&2; exit 127; }

# Passa direto, sem mexer no registro: o backend (MEU_BOT_PORTEIRO=0), quem já escolheu a conta (CLAUDE_CONFIG_DIR),
# comandos de manutenção do CLI, ou sem o porteiro instalado por inteiro.
passa=0
[ "${MEU_BOT_PORTEIRO:-1}" = 0 ] && passa=1
[ -n "${CLAUDE_CONFIG_DIR:-}" ] && passa=1
[ -x "$NODE" ] && [ -f "$DEST/claude-porteiro.js" ] || passa=1
case "${1:-}" in --version|-v|--help|-h|auth|login|logout|doctor|update|mcp|plugin|plugins|install|setup-token|migrate-installer) passa=1 ;; esac
export MEU_BOT_PORTEIRO=0
if [ "$passa" = 1 ]; then exec "$REAL" "$@"; fi

# stream-json (OpenClaw, scripts): o porteiro fica no meio e anota os limites. Senão (interativo): só escolhe a conta.
stream=0; print=0; prev=""
for a in "$@"; do
  case "$a" in -p|--print) print=1 ;; --output-format=stream-json) stream=1 ;; esac
  [ "$prev" = "--output-format" ] && [ "$a" = "stream-json" ] && stream=1
  prev="$a"
done
if [ "$stream" = 1 ] && [ "$print" = 1 ]; then
  unset MEU_BOT_PORTEIRO
  exec "$NODE" "$DEST/claude-porteiro.js" --run "$REAL" "$@"
fi
unset MEU_BOT_PORTEIRO
eval "$("$NODE" "$DEST/claude-porteiro.js" --env "$@" 2>&2 </dev/null || true)"
export MEU_BOT_PORTEIRO=0
exec "$REAL" "$@"
