#!/usr/bin/env bash
# Desliga o receptor da API oficial do WhatsApp (o serviço). Mantém a configuração e o histórico das conversas
# (~/.config/meu-bot/wa-cloud.env e ~/.local/share/meu-bot/wa-cloud/): ligar de novo volta como estava.
set -uo pipefail
if [ -f "$HOME/.config/systemd/user/meu-bot-wa-cloud.service" ]; then
  systemctl --user disable --now meu-bot-wa-cloud.service >/dev/null 2>&1
  rm -f "$HOME/.config/systemd/user/meu-bot-wa-cloud.service"; systemctl --user daemon-reload
fi
if [ -f /etc/systemd/system/meu-bot-wa-cloud.service ]; then
  SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo -n"
  $SUDO systemctl disable --now meu-bot-wa-cloud.service >/dev/null 2>&1
  $SUDO rm -f /etc/systemd/system/meu-bot-wa-cloud.service; $SUDO systemctl daemon-reload
fi
echo "WA_CLOUD=desligado"
