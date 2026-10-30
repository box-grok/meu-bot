#!/usr/bin/env bash
# Comando `tela` do agente: vê e mexe no computador do bot (o mesmo display que a pessoa assiste no painel Computador).
#   tela print [arquivo.png]   tira um print (padrão: /tmp/tela-<hora>.png) e diz onde salvou
#   tela clicar X Y [botao]    clica (botão 1 esquerdo, 3 direito) em X,Y (tela 1280x800)
#   tela duplo X Y             clique duplo
#   tela digitar "texto"       digita o texto onde estiver o foco
#   tela tecla NOME            tecla ou atalho do xdotool (Return, ctrl+l, alt+F4…)
#   tela rolar cima|baixo [N]  rola N vezes (padrão 5)
#   tela abrir COMANDO…        abre um programa gráfico nesta tela, em segundo plano
#   tela janelas               lista as janelas abertas
set -euo pipefail
ENV=$HOME/.local/share/meu-bot/tela.env
[ -f "$ENV" ] || { echo "a tela não está instalada nesta máquina (painel Computador › Instalar a tela)"; exit 2; }
# shellcheck disable=SC1090
. "$ENV"
export DISPLAY=":$TELA_DISPLAY"
xdpyinfo >/dev/null 2>&1 || { echo "a tela está desligada: peça para a pessoa acordar o computador no painel Computador"; exit 3; }
cmd=${1:-}; shift || true
case "$cmd" in
  print) f=${1:-/tmp/tela-$(date +%H%M%S).png}; scrot -o "$f" && echo "$f" ;;
  clicar) xdotool mousemove --sync "$1" "$2" click "${3:-1}" ;;
  duplo) xdotool mousemove --sync "$1" "$2" click --repeat 2 1 ;;
  digitar) xdotool type --delay 25 -- "$*" ;;
  tecla) xdotool key -- "$@" ;;
  rolar) b=5; [ "${1:-baixo}" = cima ] && b=4; xdotool click --repeat "${2:-5}" "$b" ;;
  abrir) nohup "$@" >/dev/null 2>&1 </dev/null & echo "aberto: $1 (pid $!)" ;;
  janelas) xdotool search --onlyvisible --name . getwindowname %@ 2>/dev/null || echo "nenhuma janela" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
