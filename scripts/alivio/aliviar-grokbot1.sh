#!/bin/bash
# Botão "aliviar grokbot-1": roda o alívio dentro do pod por SSH, mostra o resultado e, sem perguntar
# nada, abre o meu-bot na grokbot-1 e fecha esta janela. Se o ssh não entrar, explica e fecha em 30 s.
H=grokbot-1
APP="$HOME/Desktop/meu-bot.app/Contents/MacOS/meu-bot"
fechar() { osascript -e 'tell application "Terminal" to close (every window whose name contains "aliviar")' >/dev/null 2>&1; }
echo "Aliviando a maquina $H ... (o ssh pode levar ate 90 s se o pod estiver no limite)"
echo
ssh -o BatchMode=yes -o ConnectTimeout=90 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
    -o ControlMaster=no -o ControlPath=none "$H" 'bash ~/bin/alivio-pod.sh --tailscale'
rc=$?
echo
if [ $rc -eq 0 ]; then
  echo "✓ alívio aplicado. Esperando o tailscaled voltar e abrindo o meu-bot na $H..."
  for i in 8 7 6 5 4 3 2 1; do printf '\r  abrindo em %d s ' "$i"; sleep 1; done; echo
  if [ -x "$APP" ]; then "$APP" --host="$H" >/dev/null 2>&1 & disown; else open -a meu-bot; fi
  sleep 2
  fechar
else
  echo "✗ o ssh não entrou (código $rc)."
  echo "  O pod pode estar congelado pelo host. Aí o que resolve é reiniciar o computador pelo app do Grok Bot."
  echo "  (esta janela fecha sozinha em 30 s)"
  sleep 30
  fechar
fi
exit 0
