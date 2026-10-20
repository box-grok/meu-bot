#!/bin/bash
# Gera o meu-bot.app e deixa o ícone pronto na área de trabalho.
#
# Atalho para `npm run dist` (build → empacota → fuses → assinatura ad-hoc), que por sua vez
# instala em ~/Applications e refaz o botão da mesa (scripts/fuses.mjs). Além disso: instala as
# dependências quando faltam e encerra uma cópia em execução, porque a instalação apaga e
# reescreve o .app — trocar o bundle debaixo de um processo vivo deixa o Finder com o ícone velho.
#
#   ./instalar.sh               gera e instala
#   ./instalar.sh --abrir       gera, instala e abre o seletor
#   ./instalar.sh --sem-suporte sem o pacote de suporte (por padrão ele entra quando build/suporte existe,
#                               para este Mac também ver Configurações › Suporte e o tutorial "Ligar o suporte")
#   ./instalar.sh --crm         gera e instala o meu-bot-crm (meu-bot + CRM próprio) em vez do meu-bot
#   ./instalar.sh --admin       gera e instala o meu-bot-admin (do super admin)
#   ./instalar.sh --admin --como "Fulano"   o meu-bot-admin de outro admin (build/suporte/admins.json)
set -euo pipefail

cd "$(dirname "$0")"

abrir=0
suporte=0; [ -f build/suporte/suporte.json ] && suporte=1
app=meu-bot; dist=dist; como=""; prox=""
for a in "$@"; do
  if [ "$prox" = como ]; then como="$a"; prox=""; continue; fi
  case "$a" in
    --como) prox=como ;;
    --abrir) abrir=1 ;;
    --sem-suporte) suporte=0 ;;
    --crm) app=meu-bot-crm; dist=dist:crm; suporte=0 ;;
    --admin) app=meu-bot-admin; dist=dist:admin; suporte=0 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "argumento desconhecido: $a (use --abrir, --sem-suporte, --crm, --admin ou --help)" >&2; exit 2 ;;
  esac
done

command -v npm >/dev/null 2>&1 || { echo "npm não encontrado; instale o Node.js 24+." >&2; exit 1; }

if [ ! -d node_modules ]; then
  echo "▸ instalando dependências…"
  npm install
fi

# `npm run $dist` apaga ~/Applications/$app.app; se estiver aberto, fecha antes.
if pgrep -f "$app.app/Contents/MacOS/$app" >/dev/null 2>&1; then
  echo "▸ fechando o $app aberto…"
  osascript -e "quit app \"$app\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "$app.app/Contents/MacOS/$app" >/dev/null 2>&1 || break
    sleep 0.5
  done
  pkill -f "$app.app/Contents/MacOS/$app" >/dev/null 2>&1 || true
fi

echo "▸ compilando e empacotando o ${app}…$([ "$suporte" -eq 1 ] && echo " (com o pacote de suporte)")"
MEU_BOT_SUPORTE=$suporte MEU_BOT_ADMIN_COMO="$como" npm run "$dist"

mesa="$HOME/Desktop/$app.app"
[ -d "$mesa" ] || { echo "a instalação terminou mas $mesa não apareceu." >&2; exit 1; }

echo
echo "✓ pronto — clique no ícone do $app na área de trabalho."
echo "  mesa:         $mesa"
echo "  aplicativos:  $HOME/Applications/$app.app"

if [ "$abrir" -eq 1 ]; then
  echo "▸ abrindo o seletor…"
  open "$mesa"
fi
