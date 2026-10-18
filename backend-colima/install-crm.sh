#!/usr/bin/env bash
# Instala o "CRM pelo WhatsApp" do meu-bot (módulo Pro) nesta máquina: a pasta crm/ (plugin do OpenClaw
# meu-bot-crm + crm-job.mjs + streak.mjs + regras.mjs) em ~/.local/share/meu-bot/crm, registrada por
# `openclaw plugins install --link`, com a permissão de hooks de conversa; e a skill streak-crm-api para o agente.
# Rodar no host, com a pasta crm/ e skill-streak-crm-api.md ao lado. Idempotente. Sai com 2 sem OpenClaw.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw; o CRM pelo WhatsApp é para o agente do WhatsApp dele"; exit 2; }
command -v node >/dev/null 2>&1 || { echo "esta máquina não tem node; reinstale o backend do meu-bot"; exit 2; }
[ -f "$HERE/crm/index.js" ] || { echo "a pasta crm/ não está ao lado deste script"; exit 1; }
SRC=$HOME/.local/share/meu-bot/crm
mkdir -p "$SRC"
cp "$HERE/crm/index.js" "$HERE/crm/regras.mjs" "$HERE/crm/crm-job.mjs" "$HERE/crm/streak.mjs" "$HERE/crm/package.json" "$HERE/crm/openclaw.plugin.json" "$SRC/"
chmod 700 "$SRC"; chmod 644 "$SRC"/*
[ -d "$HOME/.openclaw/extensions/meu-bot-crm" ] && [ ! -L "$HOME/.openclaw/extensions/meu-bot-crm" ] && rm -rf "$HOME/.openclaw/extensions/meu-bot-crm"
echo "registrando o plugin meu-bot-crm no OpenClaw…"
OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force --accept-capabilities 2>&1 || true)
case "$OUT" in *"unknown option"*|*"Unknown option"*|*"too many arguments"*) OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force 2>&1 || true);; esac
printf '%s\n' "$OUT" | grep -v "^WARNING\|outside ClawHub" | tail -2 || true
# Hooks de conversa (message_received/sending) exigem esta permissão para plugins de fora do catálogo.
timeout 60 openclaw config set plugins.entries.meu-bot-crm.hooks.allowConversationAccess true --strict-json >/dev/null 2>&1 || echo "aviso: não consegui gravar hooks.allowConversationAccess (confira no openclaw.json)"
timeout 60 openclaw config set plugins.entries.meu-bot-crm.enabled true --strict-json >/dev/null 2>&1 || true
# Skill do agente: como usar o streak.mjs (semente; o agente pode editar a dele).
if [ -f "$HERE/skill-streak-crm-api.md" ]; then
  SK="$HOME/.claude/skills/streak-crm-api/SKILL.md"
  if [ -f "$SK" ]; then echo "skill streak-crm-api já existe (mantida)"; else mkdir -p "$(dirname "$SK")"; cp "$HERE/skill-streak-crm-api.md" "$SK"; echo "skill streak-crm-api instalada"; fi
fi
if timeout 60 openclaw plugins inspect meu-bot-crm --runtime 2>/dev/null | grep -q "^Status: loaded"; then
  echo "pronto: CRM pelo WhatsApp instalado (falta a chave da API do Streak, pelo tutorial 11)"
else
  timeout 60 openclaw plugins reload >/dev/null 2>&1 || true
  if timeout 60 openclaw plugins inspect meu-bot-crm --runtime 2>/dev/null | grep -q "^Status: loaded"; then echo "pronto: CRM pelo WhatsApp instalado (falta a chave da API do Streak, pelo tutorial 11)"; else echo "o CRM foi copiado, mas o OpenClaw não mostra o plugin carregado; veja: openclaw plugins inspect meu-bot-crm"; exit 3; fi
fi
