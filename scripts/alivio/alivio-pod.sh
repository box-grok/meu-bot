#!/bin/bash
# Alívio do pod grokbot-1, rodado DENTRO dele. Encerra só processos nossos que ficaram presos e,
# com --tailscale, reinicia o tailscaled pelo PM2 (derruba esta sessão ssh por alguns segundos;
# o estado é preservado e o IP volta o mesmo). Nunca mexe em serviços do Grok Bot nem no PM2 inteiro.
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
  say "tailscaled: reinício pelo PM2 em 2 s (a sessão ssh cai e volta sozinha)"
  nohup bash -lc 'sleep 2; pm2 restart tailscaled >/dev/null 2>&1 && echo "$(date "+%F %T") tailscaled reiniciado" >> ~/alivio.log' >/dev/null 2>&1 &
fi
say "depois: $(carga) | memória disponível $(free -m | awk 'NR==2{print $7}') MB"
say "== fim"
