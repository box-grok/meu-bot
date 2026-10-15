#!/bin/bash
# Alívio de um computador do Grok Bot, rodado DENTRO dele. Encerra só processos nossos que ficaram
# presos e, com --tailscale, reinicia o tailscaled por quem o gerencia nesta máquina — supervisord
# (grokbot-3), PM2 (grokbot-1) ou systemd — porque é ele que trava sem netmap quando o host suspende
# a VM (derruba esta sessão ssh por alguns segundos; o estado é preservado e o IP volta o mesmo).
# Nunca mexe em serviços do Grok Bot nem no gerenciador inteiro.
LOG=$HOME/alivio.log
LIMITE=${LIMITE_S:-1800}   # CLI do Claude com mais de 30 min = turno preso
ts() { date "+%F %T"; }
say() { echo "$*" | tee -a "$LOG"; }
carga() { uptime | sed 's/.*load average: /carga /'; }
say "== $(ts) alívio iniciado ($(hostname))"
say "antes:  $(carga) | memória disponível $(free -m | awk 'NR==2{print $7}') MB | em disco (D): $(ps -eo stat | grep -c D)"
presas=0
for p in $(pgrep -f 'claude-code-linux-x64/claude'); do
  et=$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')
  if [ -n "$et" ] && [ "$et" -gt "$LIMITE" ]; then kill "$p" 2>/dev/null && presas=$((presas+1)); fi
done
chrome=$(pgrep -fc '/opt/google/chrome/chrome')
[ "$chrome" -gt 0 ] && pkill -f '/opt/google/chrome/chrome' 2>/dev/null
sleep 3
for p in $(pgrep -f 'claude-code-linux-x64/claude'); do
  et=$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')
  [ -n "$et" ] && [ "$et" -gt "$LIMITE" ] && kill -9 "$p" 2>/dev/null
done
say "encerrados: $presas CLI(s) do Claude presas há mais de $((LIMITE/60)) min, $chrome processo(s) do Chrome"
say "ativas:   $(pgrep -fc 'claude-code-linux-x64/claude') CLI(s) do Claude em turno recente (mantidas)"
if [ "$1" = "--tailscale" ]; then
  # Quem gerencia o tailscaled aqui? Não pressupor: supervisord, PM2 ou systemd.
  if supervisorctl status tailscaled >/dev/null 2>&1; then GER=supervisord; CMD="supervisorctl restart tailscaled"
  elif command -v pm2 >/dev/null 2>&1 && pm2 describe tailscaled >/dev/null 2>&1; then GER=PM2; CMD="pm2 restart tailscaled"
  elif [ -d /run/systemd/system ] && systemctl list-units --type=service 2>/dev/null | grep -q tailscaled; then GER=systemd; CMD="sudo -n systemctl restart tailscaled"
  else GER=""; fi
  if [ -n "$GER" ]; then
    say "tailscaled: reinício pelo $GER em 2 s (a sessão ssh cai e volta sozinha)"
    nohup bash -lc "sleep 2; $CMD >/dev/null 2>&1 && echo \"\$(date '+%F %T') tailscaled reiniciado pelo $GER\" >> ~/alivio.log || echo \"\$(date '+%F %T') FALHA ao reiniciar o tailscaled pelo $GER\" >> ~/alivio.log" >/dev/null 2>&1 &
  else
    say "tailscaled: não achei quem o gerencia (supervisord, PM2 ou systemd); não reiniciado"
  fi
fi
say "depois: $(carga) | memória disponível $(free -m | awk 'NR==2{print $7}') MB"
say "== fim"
