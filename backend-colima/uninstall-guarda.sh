#!/usr/bin/env bash
# Desfaz a guarda do WhatsApp: tira o plugin do OpenClaw e apaga a cópia local. Rodar no host.
set -uo pipefail
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"
command -v openclaw >/dev/null 2>&1 && timeout 90 openclaw plugins uninstall meu-bot-guarda >/dev/null 2>&1
rm -rf "$HOME/.local/share/meu-bot/guarda" "$HOME/.openclaw/extensions/meu-bot-guarda"
echo "guarda removida"
