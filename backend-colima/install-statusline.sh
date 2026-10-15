#!/usr/bin/env bash
# Instala a status line do Claude Code nesta máquina: o statusline.sh do claude-statusline (Diego) com o
# bloco que grava ~/.cache/claude-statusline/ratelimits.json — é isso que o meu-bot lê em /v1/meu-bot/status
# para mostrar Sessão/Semanal. Rodar no host, com statusline.sh ao lado. Idempotente: pode rodar de novo.
# - Copia para ~/.claude/statusline.sh (o anterior, se não era o nosso, fica em .antes-do-meu-bot).
# - Injeta statusLine em ~/.claude/settings.json preservando o resto (backup uma vez).
# - Não grava limite nenhum: o cache só nasce quando um Claude Code interativo roda aqui.
# - Se a máquina tem settings gerenciadas com statusLine, elas ganham do settings.json: avisa e sai com 3.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
CLAUDE_DIR=$HOME/.claude
DEST=$CLAUDE_DIR/statusline.sh
SETTINGS=$CLAUDE_DIR/settings.json

command -v jq >/dev/null 2>&1 || { echo "jq não encontrado: a status line precisa dele (apt install jq / brew install jq)"; exit 1; }
[ -f "$HERE/statusline.sh" ] || { echo "statusline.sh não está ao lado deste script"; exit 1; }

for M in "/Library/Application Support/ClaudeCode/managed-settings.json" /etc/claude-code/managed-settings.json; do
  if [ -f "$M" ] && jq -e '.statusLine' "$M" >/dev/null 2>&1; then
    echo "a status line desta máquina é gerenciada ($M) e tem prioridade sobre ~/.claude/settings.json; instalar aqui não teria efeito"
    exit 3
  fi
done

mkdir -p "$CLAUDE_DIR"
if [ -f "$DEST" ] && ! grep -q 'ratelimits.json' "$DEST"; then
  cp "$DEST" "$DEST.antes-do-meu-bot"; echo "statusline.sh anterior guardado em $DEST.antes-do-meu-bot"
fi
install -m 755 "$HERE/statusline.sh" "$DEST"
echo "statusline.sh em $DEST"

if [ -f "$SETTINGS" ]; then
  jq empty "$SETTINGS" 2>/dev/null || { echo "$SETTINGS não é JSON válido; não mexo nele"; exit 1; }
  [ -f "$SETTINGS.antes-do-meu-bot" ] || cp "$SETTINGS" "$SETTINGS.antes-do-meu-bot"
  jq --arg c "bash $DEST" '.statusLine = {type: "command", command: $c}' "$SETTINGS" > "$SETTINGS.tmp" && mv -f "$SETTINGS.tmp" "$SETTINGS"
else
  printf '{\n  "statusLine": { "type": "command", "command": "bash %s" }\n}\n' "$DEST" > "$SETTINGS"
fi
echo "statusLine em $SETTINGS"

# Prova: roda uma vez com uma entrada sem limites. Tem que sair bem e não inventar cache de limites.
T=""; command -v timeout >/dev/null 2>&1 && T="timeout 20"
if printf '{"model":{"display_name":"teste"}}' | $T bash "$DEST" >/dev/null 2>&1; then
  echo "OK: status line instalada; Sessão/Semanal aparecem no meu-bot depois do primeiro Claude Code interativo nesta máquina"
else
  echo "AVISO: instalada, mas o statusline.sh não rodou limpo aqui (confira jq e bash)"
fi
