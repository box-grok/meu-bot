#!/usr/bin/env bash
# Instala a tela do bot (painel "Computador" do meu-bot) nesta máquina: pacotes (Debian/Ubuntu, via sudo sem senha),
# tela.sh em ~/.local/share/meu-bot/tela e o serviço de usuário meu-bot-tela (sem iniciar: quem acorda é o app).
# Idempotente. Escolhe display e portas livres uma vez (tela.env) para não brigar com outros usuários da máquina.
# Saídas: 0 ok · 2 sem apt (distro não suportada) · 3 faltam pacotes e não há sudo sem senha.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/tela/tela.sh" ] || { echo "a pasta tela/ não está ao lado deste script"; exit 1; }
PKGS="xvfb x11-utils openbox x11vnc novnc python3-websockify"
falta=""
for b in Xvfb xdpyinfo openbox x11vnc websockify; do command -v "$b" >/dev/null 2>&1 || falta="$falta $b"; done
[ -f /usr/share/novnc/vnc.html ] || falta="$falta novnc"
if [ -n "$falta" ]; then
  command -v apt-get >/dev/null 2>&1 || { echo "esta máquina não usa apt; instale à mão:$falta"; exit 2; }
  sudo -n true 2>/dev/null || { echo "faltam pacotes ($falta) e não há sudo sem senha; peça ao admin: sudo apt-get install -y $PKGS"; exit 3; }
  echo "instalando pacotes:$falta…"
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends $PKGS >/dev/null
fi
D=$HOME/.local/share/meu-bot
mkdir -p "$D/tela"; chmod 700 "$D"
cp "$HERE/tela/tela.sh" "$D/tela/"; chmod 755 "$D/tela/tela.sh"
livre() { python3 - "$1" <<'PY'
import socket, sys
p = int(sys.argv[1])
while p < 65000:
    s = socket.socket()
    try: s.bind(("127.0.0.1", p)); s.close(); print(p); break
    except OSError: p += 1
PY
}
if [ ! -f "$D/tela.env" ]; then
  n=$(( 10 + $(id -u) % 80 )); while [ -e "/tmp/.X${n}-lock" ] || [ -e "/tmp/.X11-unix/X${n}" ]; do n=$((n + 1)); done
  vnc=$(livre $(( 5910 + $(id -u) % 80 ))); web=$(livre $(( 6080 + $(id -u) % 80 )))
  [ "$web" = "$vnc" ] && web=$(livre $((vnc + 1)))
  printf 'TELA_DISPLAY=%s\nTELA_VNC=%s\nTELA_WEB=%s\nTELA_NOVNC=/usr/share/novnc\n' "$n" "$vnc" "$web" > "$D/tela.env"
  chmod 600 "$D/tela.env"
fi
cat "$D/tela.env"
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  U=$HOME/.config/systemd/user; mkdir -p "$U"
  printf '[Unit]\nDescription=meu-bot: tela do bot (Xvfb + noVNC em 127.0.0.1)\n\n[Service]\nExecStart=/bin/bash %s/tela/tela.sh\nRestart=on-failure\nRestartSec=2\n' "$D" > "$U/meu-bot-tela.service"
  systemctl --user daemon-reload
  echo "serviço meu-bot-tela pronto (o app liga quando você abre o Computador)"
else
  echo "sem systemd de usuário: o app liga a tela com nohup"
fi
echo "tela instalada"
