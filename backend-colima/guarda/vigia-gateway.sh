#!/usr/bin/env bash
# vigia-gateway.sh — religa o openclaw-gateway desta conta quando ele fica parado sem ninguém para religar.
#
# Roda a cada minuto pelo timer de usuário meu-bot-vigia-gateway.timer (instalado pela guarda). Só age quando:
#   - o serviço openclaw-gateway existe e está HABILITADO (a migração de máquina faz `disable --now` de propósito
#     na máquina de origem: desabilitado = desligado de propósito, o vigia não mexe);
#   - ele está parado (inactive/failed) e nenhum wa-admin.sh está trabalhando (trava em ~/.cache/meu-bot);
#   - a cada 5 min, se o WhatsApp está "linked but disconnected" há 3 checagens seguidas, reinicia uma vez.
# Nunca desloga, nunca mexe em credenciais nem na config. Grava no registro de auditoria quando age.
set -u
SVC=openclaw-gateway.service
D=$HOME/.cache/meu-bot
mkdir -p "$D"
LOCK=$D/wa-admin.lock
LOG=$D/vigia-gateway.log
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH

systemctl --user cat "$SVC" >/dev/null 2>&1 || exit 0
[ "$(systemctl --user is-enabled "$SVC" 2>/dev/null)" = "enabled" ] || exit 0
[ -f "$D/vigia-desligado" ] && exit 0

# wa-admin.sh parou o gateway de propósito e ainda está trabalhando (até 15 min): espera ele religar.
if [ -f "$LOCK" ]; then
  PID=$(cat "$LOCK" 2>/dev/null)
  IDADE=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || stat -f %m "$LOCK" 2>/dev/null || echo 0) ))
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && [ "$IDADE" -lt 900 ]; then exit 0; fi
  rm -f "$LOCK"
fi

registrar() {
  A=$HOME/.local/share/meu-bot/auditoria.py
  [ -f "$A" ] || return 0
  B=$(python3 -c 'import base64,json,sys;print(base64.urlsafe_b64encode(json.dumps({"quem":{"tipo":"sistema","nome":"vigia do gateway"},"app":"backend","acao":sys.argv[1],"alvo":sys.argv[2]}).encode()).decode().rstrip("="))' "$1" "$2" 2>/dev/null) || return 0
  python3 "$A" gravar "$B" >/dev/null 2>&1 || true
}
anota() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; tail -n 200 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"; }

ST=$(systemctl --user is-active "$SVC" 2>/dev/null)
if [ "$ST" = "inactive" ] || [ "$ST" = "failed" ]; then
  systemctl --user reset-failed "$SVC" >/dev/null 2>&1
  if systemctl --user start "$SVC" >/dev/null 2>&1; then
    anota "religou o gateway (estava $ST)"; registrar servico.religar-gateway "estava $ST"
  else
    anota "não consegui religar o gateway (estava $ST)"
  fi
  rm -f "$D/vigia-desconectado"
  exit 0
fi
[ "$ST" = "active" ] || exit 0

# Conectado? Só a cada 5 min (a CLI do OpenClaw é pesada) e só depois de 3 checagens seguidas desconectado.
[ $(( $(date +%-M) % 5 )) -eq 0 ] || exit 0
L=$(timeout 40 openclaw channels status 2>/dev/null | grep -i "whatsapp default" | head -n1)
[ -n "$L" ] || exit 0
if echo "$L" | grep -qi "disconnected" && echo "$L" | grep -qi "linked" && ! echo "$L" | grep -qi "logged.\?out"; then
  N=$(( $(cat "$D/vigia-desconectado" 2>/dev/null || echo 0) + 1 ))
  echo "$N" > "$D/vigia-desconectado"
  if [ "$N" -ge 3 ]; then
    systemctl --user restart "$SVC" >/dev/null 2>&1 && { anota "reiniciou o gateway (WhatsApp desconectado há ~15 min)"; registrar servico.religar-gateway "WhatsApp desconectado há ~15 min"; }
    rm -f "$D/vigia-desconectado"
  fi
else
  rm -f "$D/vigia-desconectado"
fi
