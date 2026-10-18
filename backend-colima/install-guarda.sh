#!/usr/bin/env bash
# Instala a guarda do WhatsApp do meu-bot no OpenClaw desta máquina: plugin local (index.js + regras.mjs +
# manifest) em ~/.local/share/meu-bot/guarda, registrado por `openclaw plugins install --link` (o gateway
# aplica na hora, sem reiniciar). Rodar no host, com a pasta guarda/ ao lado. Idempotente: copia por cima e
# reaplica. Sai com 2 se a máquina não tem OpenClaw (a guarda é do agente do WhatsApp dele).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"
command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw; a guarda é para o agente do WhatsApp dele"; exit 2; }
[ -f "$HERE/guarda/index.js" ] || { echo "a pasta guarda/ não está ao lado deste script"; exit 1; }
SRC=$HOME/.local/share/meu-bot/guarda
mkdir -p "$SRC"
cp "$HERE/guarda/index.js" "$HERE/guarda/regras.mjs" "$HERE/guarda/package.json" "$HERE/guarda/openclaw.plugin.json" "$SRC/"
# Uma cópia antiga dentro de extensions/ (instalação à mão) confunde o registro: a fonte é o link.
[ -d "$HOME/.openclaw/extensions/meu-bot-guarda" ] && [ ! -L "$HOME/.openclaw/extensions/meu-bot-guarda" ] && rm -rf "$HOME/.openclaw/extensions/meu-bot-guarda"
echo "registrando a guarda no OpenClaw…"
timeout 120 openclaw plugins install --link "$SRC" --force 2>&1 | grep -v "^WARNING\|outside ClawHub" | tail -2 || true
if timeout 60 openclaw plugins inspect meu-bot-guarda --runtime 2>/dev/null | grep -q "^Status: loaded"; then
  echo "pronto: guarda ativa (nota de fallback bloqueada; pausa automática em loop de 3 ciclos)"
else
  echo "a guarda foi copiada, mas o OpenClaw não a mostra carregada; veja na máquina: openclaw plugins inspect meu-bot-guarda"
  exit 3
fi
