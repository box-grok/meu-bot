#!/usr/bin/env bash
# Liga o WhatsApp pela API oficial (Cloud API da Meta) nesta máquina: o receptor wa-cloud.js (que o install.sh já copia
# para a pasta do backend) vira um serviço, ouvindo só em 127.0.0.1. Idempotente. Não mexe nas credenciais da Meta
# (o app grava ~/.config/meu-bot/wa-cloud.env); só garante a chave com que o receptor chama o backend (WA_CLOUD_KEY), o
# verify token do webhook e a porta. Imprime PORTA=<n> e VERIFY_TOKEN=<…> para o app mostrar à pessoa.
set -euo pipefail
CANON=$HOME/.local/share/meu-bot/backend
LEGACY=$HOME/.hermes/agente-rene/backend-sdk-claude
if [ -n "${MEU_BOT_BACKEND_DIR:-}" ]; then DEST=$MEU_BOT_BACKEND_DIR
elif [ -f "$CANON/server.js" ]; then DEST=$CANON
elif [ -f "$LEGACY/server.js" ] && grep -q "meu-bot/hello" "$LEGACY/server.js" 2>/dev/null; then DEST=$LEGACY
else echo "ERRO=o backend do meu-bot não está instalado nesta máquina"; exit 3; fi
[ -f "$DEST/wa-cloud.js" ] && [ -f "$DEST/wa-cloud-core.js" ] || { echo "ERRO=backend antigo, sem o receptor da API oficial: atualize o backend antes"; exit 3; }
node_ok() { local v; v=$("$1" -v 2>/dev/null | sed 's/^v//; s/\..*//') || return 1; [ "${v:-0}" -ge 18 ]; }
NODE=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then NODE=$(command -v node)
elif [ -x "$HOME/.local/node/bin/node" ] && node_ok "$HOME/.local/node/bin/node"; then NODE=$HOME/.local/node/bin/node
else echo "ERRO=node 18+ não encontrado (o do backend)"; exit 3; fi

# Chave do receptor no .env do backend (o backend lê o .env ao subir: reinicia só quando acabou de entrar).
NOVA_CHAVE=0
grep -q '^WA_CLOUD_KEY=' "$DEST/.env" 2>/dev/null || { ( umask 077; printf 'WA_CLOUD_KEY=%s\n' "$(openssl rand -hex 32)" >> "$DEST/.env" ); NOVA_CHAVE=1; }
chmod 600 "$DEST/.env"

# Configuração do receptor: verify token e porta criados aqui na 1ª vez; as credenciais da Meta o app acrescenta.
CFG=$HOME/.config/meu-bot/wa-cloud.env
mkdir -p "$(dirname "$CFG")"; chmod 700 "$(dirname "$CFG")"
( umask 077; touch "$CFG" ); chmod 600 "$CFG"
listening() { (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$1 "; }
grep -q '^WA_VERIFY_TOKEN=' "$CFG" || printf 'WA_VERIFY_TOKEN=%s\n' "$(openssl rand -hex 24)" >> "$CFG"
if ! grep -q '^WA_CLOUD_PORT=' "$CFG"; then
  P=8090; while listening "$P"; do P=$((P + 1)); done
  printf 'WA_CLOUD_PORT=%s\n' "$P" >> "$CFG"
fi
PORTA=$(grep '^WA_CLOUD_PORT=' "$CFG" | head -1 | cut -d= -f2- | tr -dc 0-9)

render_unit() { # $1 = USERLINE, $2 = TARGET
  sed -e "s|__DEST__|$DEST|g" -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE|g" -e "s|__NODEDIR__|$(dirname "$NODE")|g" \
      -e "s|__USERLINE__|$1|g" -e "s|__TARGET__|$2|g" "$DEST/meu-bot-wa-cloud.service"
}
user_manager() { case "$(systemctl --user is-system-running 2>/dev/null)" in running|degraded|starting|maintenance) return 0;; *) return 1;; esac; }
if [ "$(id -u)" != 0 ] && [ -d /run/systemd/system ] && user_manager; then
  mkdir -p "$HOME/.config/systemd/user"
  render_unit "" "default.target" > "$HOME/.config/systemd/user/meu-bot-wa-cloud.service"
  systemctl --user daemon-reload
  systemctl --user enable meu-bot-wa-cloud.service >/dev/null
  systemctl --user restart meu-bot-wa-cloud.service
  [ "$NOVA_CHAVE" = 1 ] && { systemctl --user restart meu-bot-backend.service 2>/dev/null || true; }
  command -v loginctl >/dev/null && loginctl enable-linger "$(id -un)" 2>/dev/null || true
elif [ -d /run/systemd/system ]; then
  SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo -n"
  render_unit "User=$(id -un)" "multi-user.target" | $SUDO tee /etc/systemd/system/meu-bot-wa-cloud.service >/dev/null
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable meu-bot-wa-cloud.service >/dev/null
  $SUDO systemctl restart meu-bot-wa-cloud.service
  [ "$NOVA_CHAVE" = 1 ] && { $SUDO systemctl restart meu-bot-backend.service 2>/dev/null || systemctl --user restart meu-bot-backend.service 2>/dev/null || true; }
else
  echo "ERRO=esta máquina não tem systemd: o receptor da API oficial precisa de um serviço"; exit 3
fi
sleep 1.5
curl -fsS "http://127.0.0.1:$PORTA/health" >/dev/null 2>&1 || { echo "ERRO=o receptor não respondeu em 127.0.0.1:$PORTA"; exit 1; }
echo "PORTA=$PORTA"
echo "VERIFY_TOKEN=$(grep '^WA_VERIFY_TOKEN=' "$CFG" | head -1 | cut -d= -f2-)"
echo "WA_CLOUD=ok"
