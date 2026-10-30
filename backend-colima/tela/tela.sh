#!/usr/bin/env bash
# Tela do bot (painel "Computador" do meu-bot): Xvfb + openbox + x11vnc + websockify/noVNC, tudo só em 127.0.0.1.
# O app chega na porta web pelo túnel SSH (-L); a autenticação é a do SSH, por isso o VNC não tem senha e nunca escuta
# fora do loopback. Portas e display vêm do tela.env que o install-tela.sh escolheu (um conjunto por usuário).
# Roda em primeiro plano (systemd de usuário); se qualquer peça cai, sai para o systemd religar tudo junto.
set -uo pipefail
ENV=$HOME/.local/share/meu-bot/tela.env
[ -f "$ENV" ] || { echo "sem $ENV: rode o install-tela.sh"; exit 1; }
# shellcheck disable=SC1090
. "$ENV"
: "${TELA_DISPLAY:?}" "${TELA_VNC:?}" "${TELA_WEB:?}" "${TELA_NOVNC:?}"
export DISPLAY=":$TELA_DISPLAY"
pids=()
encerrar() { kill "${pids[@]}" 2>/dev/null; wait 2>/dev/null; }
trap encerrar EXIT INT TERM
rm -f "/tmp/.X${TELA_DISPLAY}-lock"
Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 & pids+=($!)
for _ in $(seq 1 50); do xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break; sleep 0.1; done
openbox >/dev/null 2>&1 & pids+=($!)
x11vnc -display "$DISPLAY" -localhost -rfbport "$TELA_VNC" -forever -shared -nopw -quiet -noxdamage >/dev/null 2>&1 & pids+=($!)
websockify --web "$TELA_NOVNC" "127.0.0.1:$TELA_WEB" "127.0.0.1:$TELA_VNC" >/dev/null 2>&1 & pids+=($!)
echo "tela no ar: display $DISPLAY, web 127.0.0.1:$TELA_WEB"
wait -n
echo "uma peça da tela caiu; saindo para religar"
exit 1
