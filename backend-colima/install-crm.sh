#!/usr/bin/env bash
# Instala o CRM do meu-bot nesta máquina: a pasta crm/ (plugin do OpenClaw meu-bot-crm + crm-job.mjs + as CLIs
# crm.mjs [CRM próprio, plano pro] e streak.mjs [Streak pela API, plano free] + importador) em
# ~/.local/share/meu-bot/crm, registrada por `openclaw plugins install --link`, com a permissão de hooks de
# conversa; e as skills para o agente. Rodar no host, com a pasta crm/ e as skills ao lado. Idempotente.
# Nunca apaga crm/db/ (os dados do CRM próprio). Sai com 2 sem OpenClaw.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw; o CRM pelo WhatsApp é para o agente do WhatsApp dele"; exit 2; }
command -v node >/dev/null 2>&1 || { echo "esta máquina não tem node; reinstale o backend do meu-bot"; exit 2; }
[ -f "$HERE/crm/index.js" ] || { echo "a pasta crm/ não está ao lado deste script"; exit 1; }
SRC=$HOME/.local/share/meu-bot/crm
mkdir -p "$SRC/db"
for f in index.js regras.mjs crm-job.mjs backend.mjs crm.mjs streak.mjs importar-streak.mjs package.json openclaw.plugin.json; do
  [ -f "$HERE/crm/$f" ] && cp "$HERE/crm/$f" "$SRC/"
done
chmod 700 "$SRC" "$SRC/db"; chmod 644 "$SRC"/*.js "$SRC"/*.mjs "$SRC"/*.json
[ -d "$HOME/.openclaw/extensions/meu-bot-crm" ] && [ ! -L "$HOME/.openclaw/extensions/meu-bot-crm" ] && rm -rf "$HOME/.openclaw/extensions/meu-bot-crm"
echo "registrando o plugin meu-bot-crm no OpenClaw…"
OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force --accept-capabilities 2>&1 || true)
case "$OUT" in *"unknown option"*|*"Unknown option"*|*"too many arguments"*) OUT=$(timeout 120 openclaw plugins install --link "$SRC" --force 2>&1 || true);; esac
printf '%s\n' "$OUT" | grep -v "^WARNING\|outside ClawHub" | tail -2 || true
# Hooks de conversa (message_received/sending) exigem esta permissão para plugins de fora do catálogo.
timeout 60 openclaw config set plugins.entries.meu-bot-crm.hooks.allowConversationAccess true --strict-json >/dev/null 2>&1 || echo "aviso: não consegui gravar hooks.allowConversationAccess (confira no openclaw.json)"
timeout 60 openclaw config set plugins.entries.meu-bot-crm.enabled true --strict-json >/dev/null 2>&1 || true
# Skills do agente (sementes; o agente pode editar as dele): a do CRM próprio e a do Streak.
for par in "skill-crm-api.md:crm-api" "skill-streak-crm-api.md:streak-crm-api"; do
  src="$HERE/${par%%:*}"; nome="${par##*:}"
  if [ -f "$src" ]; then
    SK="$HOME/.claude/skills/$nome/SKILL.md"
    if [ -f "$SK" ]; then echo "skill $nome já existe (mantida)"; else mkdir -p "$(dirname "$SK")"; cp "$src" "$SK"; echo "skill $nome instalada"; fi
  fi
done
# Lê o arquivo cru (o backend pode ainda não ter migrado a licença antiga): "personalizado" virou Pro em 22 out.
PLANO=$(python3 -c 'import json,os; print(json.load(open(os.path.expanduser("~/.local/share/meu-bot/licenca.json"))).get("plan","free"))' 2>/dev/null || echo free)
if [ "$PLANO" = "pro" ] || [ "$PLANO" = "personalizado" ]; then FALTA="o CRM próprio está nesta máquina: escolha ou importe um pipeline no app"; else FALTA="falta a chave da API do Streak, pelo tutorial 10"; fi
if timeout 60 openclaw plugins inspect meu-bot-crm --runtime 2>/dev/null | grep -q "^Status: loaded"; then
  echo "pronto: CRM instalado ($FALTA)"
else
  timeout 60 openclaw plugins reload >/dev/null 2>&1 || true
  if timeout 60 openclaw plugins inspect meu-bot-crm --runtime 2>/dev/null | grep -q "^Status: loaded"; then echo "pronto: CRM instalado ($FALTA)"; else echo "o CRM foi copiado, mas o OpenClaw não mostra o plugin carregado; veja: openclaw plugins inspect meu-bot-crm"; exit 3; fi
fi
