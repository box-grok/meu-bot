#!/usr/bin/env bash
# Desfaz o install-statusline.sh nesta máquina ("Refazer do zero" em Tutoriais › Status line). Idempotente.
# - Tira o nosso ~/.claude/statusline.sh (o anterior, se havia, volta de .antes-do-meu-bot).
# - settings.json: volta o backup .antes-do-meu-bot se existe; senão só remove a chave statusLine.
# - Apaga as preferências de segmentos (~/.claude/statusline-segments.json).
# - O cache ~/.cache/claude-statusline fica: são dados da conta, e um Claude Code interativo recria.
set -euo pipefail
CLAUDE_DIR=$HOME/.claude
DEST=$CLAUDE_DIR/statusline.sh
SETTINGS=$CLAUDE_DIR/settings.json

if [ -f "$DEST" ] && grep -q 'ratelimits.json' "$DEST"; then
  rm -f "$DEST"
  if [ -f "$DEST.antes-do-meu-bot" ]; then mv -f "$DEST.antes-do-meu-bot" "$DEST"; echo "statusline.sh anterior restaurado"; else echo "statusline.sh removido"; fi
else
  echo "statusline.sh não é o do meu-bot (ou não existe): não mexo nele"
fi

if [ -f "$SETTINGS.antes-do-meu-bot" ]; then
  mv -f "$SETTINGS.antes-do-meu-bot" "$SETTINGS"; echo "settings.json anterior restaurado"
elif [ -f "$SETTINGS" ] && command -v jq >/dev/null 2>&1 && jq -e '.statusLine' "$SETTINGS" >/dev/null 2>&1; then
  jq 'del(.statusLine)' "$SETTINGS" > "$SETTINGS.tmp" && mv -f "$SETTINGS.tmp" "$SETTINGS"; echo "statusLine removida do settings.json"
fi

rm -f "$CLAUDE_DIR/statusline-segments.json"
echo "OK: status line desfeita nesta máquina"
