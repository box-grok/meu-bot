#!/bin/bash
# Gera o meu-bot.app e deixa o ícone pronto na área de trabalho.
#
# Atalho para `npm run dist` (build → empacota → fuses → assinatura ad-hoc), que por sua vez
# instala em ~/Applications e refaz o botão da mesa (scripts/fuses.mjs). Além disso: instala as
# dependências quando faltam e encerra uma cópia em execução, porque a instalação apaga e
# reescreve o .app — trocar o bundle debaixo de um processo vivo deixa o Finder com o ícone velho.
#
#   ./instalar.sh          gera e instala
#   ./instalar.sh --abrir  gera, instala e abre o seletor
set -euo pipefail

cd "$(dirname "$0")"

abrir=0
for a in "$@"; do
  case "$a" in
    --abrir) abrir=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "argumento desconhecido: $a (use --abrir ou --help)" >&2; exit 2 ;;
  esac
done

command -v npm >/dev/null 2>&1 || { echo "npm não encontrado; instale o Node.js 24+." >&2; exit 1; }

if [ ! -d node_modules ]; then
  echo "▸ instalando dependências…"
  npm install
fi

# `npm run dist` apaga ~/Applications/meu-bot.app; se estiver aberto, fecha antes.
if pgrep -f "meu-bot.app/Contents/MacOS/meu-bot" >/dev/null 2>&1; then
  echo "▸ fechando o meu-bot aberto…"
  osascript -e 'quit app "meu-bot"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "meu-bot.app/Contents/MacOS/meu-bot" >/dev/null 2>&1 || break
    sleep 0.5
  done
  pkill -f "meu-bot.app/Contents/MacOS/meu-bot" >/dev/null 2>&1 || true
fi

echo "▸ compilando e empacotando…"
npm run dist

mesa="$HOME/Desktop/meu-bot.app"
[ -d "$mesa" ] || { echo "a instalação terminou mas $mesa não apareceu." >&2; exit 1; }

echo
echo "✓ pronto — clique no ícone do meu-bot na área de trabalho."
echo "  mesa:         $mesa"
echo "  aplicativos:  $HOME/Applications/meu-bot.app"

if [ "$abrir" -eq 1 ]; then
  echo "▸ abrindo o seletor…"
  open "$mesa"
fi
