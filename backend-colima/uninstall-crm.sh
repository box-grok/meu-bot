#!/usr/bin/env bash
# Desfaz o install-crm.sh: tira o plugin do OpenClaw e apaga a pasta (crm.json com a chave fica, apague à mão).
set -uo pipefail
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:/usr/local/bin:$PATH"
timeout 120 openclaw plugins uninstall meu-bot-crm >/dev/null 2>&1 || true
rm -rf "$HOME/.local/share/meu-bot/crm" "$HOME/.openclaw/extensions/meu-bot-crm"
echo "CRM pelo WhatsApp removido desta máquina"
