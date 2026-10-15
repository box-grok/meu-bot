#!/usr/bin/env bash
# tailscale-watchdog.sh — vigia do tailscaled num computador do Grok Bot (grokbot-lv).
#
# O host suspende a VM (dezenas de vezes por dia, medido na grokbot-1). Ao acordar, o tailscaled
# costuma se reconectar sozinho, mas devagar (mediana 74 s, p90 ~18 min; 4 vezes em 10 dias nunca
# voltou) — e como o SSH desta máquina é o Tailscale SSH, nesse meio-tempo ninguém entra. Reiniciá-lo
# custa 1–2 s (9 reinícios medidos), então vale agir cedo. Este vigia roda em foreground sob o
# supervisord e, a cada CHECK_S segundos:
#   1. detecta suspensão por dois sinais: FIFO novo em /run/sand-box-store-flush (o hook de hibernação
#      do host congelou no meio) e relógio de parede que avançou mais que o uptime (+ TOLERANCIA_S);
#   2. mede alcançabilidade de verdade (não liveness, nem Self.Online — o plano de controle oscila o
#      tempo todo nessas VMs enquanto o tráfego passa): BackendState=Running e `tailscale ping` em pelo
#      menos um dos PEERS respondendo — o Mac, o agente-br (servidor fixo) e a grokbot-1, que congela
#      metade do dia e entra só como desempate. Basta um pong; só sem nenhum a leitura conta como ruim;
#   3. após BAD_READINGS medições ruins seguidas (80 s no padrão: acima de um blip, abaixo da mediana
#      de recuperação espontânea; atropelar uma recuperação em curso custa 2 s), reinicia o tailscaled por
#      `supervisorctl restart tailscaled`, com GRACA_S de carência depois e no máximo MAX_RESTARTS por
#      JANELA_S (não vira laço se a causa for a rede do host). Tudo vai para o log; nada mais é tocado.
set -u
CHECK_S=${CHECK_S:-20}
BAD_READINGS=${BAD_READINGS:-4}
GRACA_S=${GRACA_S:-60}
FLUSH_DIR=${FLUSH_DIR:-/run/sand-box-store-flush}
TOLERANCIA_S=${TOLERANCIA_S:-60}
MAX_RESTARTS=${MAX_RESTARTS:-3}
JANELA_S=${JANELA_S:-1800}
# Onde está o `tailscale`? Varia por máquina: apt (/usr/bin, grokbot-lv) ou instalação no home (~/.local/bin,
# grokbot-1). Caminho absoluto, porque o secure_path do sudo não vê o PATH do usuário.
TS=${TAILSCALE_BIN:-}
if [ -z "$TS" ]; then for c in /usr/bin/tailscale /usr/local/bin/tailscale /home/box/.local/bin/tailscale; do [ -x "$c" ] && { TS=$c; break; }; done; fi
[ -n "$TS" ] || { echo "$(date '+%F %T') tailscale não encontrado em /usr/bin, /usr/local/bin ou ~/.local/bin; saindo"; exit 1; }
PEERS=${PEERS:-"100.118.233.106 100.65.117.27 100.69.163.93"}   # Mac (grokbot-2), agente-br (servidor fixo, exit node) e grokbot-1 (congela metade do dia; só desempate)
log() { echo "$(date '+%F %T') $*"; }

uptime_s() { cut -d. -f1 "${UPTIME_FILE:-/proc/uptime}"; }   # UPTIME_FILE só para ensaio fora do Linux
saude() { # 0 = bem; 1 = mal; 2 = sem referência (nenhum peer para medir). Imprime o motivo.
  local st; st=$(sudo -n "$TS" status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("BackendState",""))' 2>/dev/null)
  if [ "$st" != "Running" ]; then echo "BackendState=${st:-?}"; return 1; fi
  local p; for p in $PEERS; do
    if sudo -n "$TS" ping -c 1 --timeout=5s "$p" 2>/dev/null | grep -q "^pong"; then echo "ok (pong de $p)"; return 0; fi
  done
  # Nenhum pong. Peer desligado ou nós sem rede? Se o Tailscale nem acha a si mesmo no netmap, é nós.
  echo "sem pong de ${PEERS}"; return 1
}
fifos() { ls -1 "$FLUSH_DIR"/response.* 2>/dev/null | wc -l | tr -d " "; }
log "tailscale em $TS"
log "vigia iniciado (check ${CHECK_S}s, age após ${BAD_READINGS} leituras ruins, tolerância ${TOLERANCIA_S}s, carência ${GRACA_S}s, máx ${MAX_RESTARTS} reinícios/${JANELA_S}s)"
prev_wall=$(date +%s); prev_up=$(uptime_s); prev_fifos=$(fifos); ruins=0; restarts=(); graca_ate=0
while :; do
  sleep "$CHECK_S"
  wall=$(date +%s); up=$(uptime_s)
  dw=$((wall - prev_wall)); du=$((up - prev_up)); prev_wall=$wall; prev_up=$up
  acordou=0
  if [ $((dw - du)) -gt "$TOLERANCIA_S" ]; then acordou=1; log "suspensão detectada: relógio +${dw}s, uptime +${du}s"; fi
  f=$(fifos); if [ "$f" != "$prev_fifos" ]; then [ "$f" -gt "$prev_fifos" ] && { acordou=1; log "hibernação detectada: $((f - prev_fifos)) FIFO(s) novo(s) em $FLUSH_DIR"; }; prev_fifos=$f; fi
  if [ "$wall" -lt "$graca_ate" ]; then continue; fi   # carência depois de um reinício: deixa reconvergir
  if motivo=$(saude); then
    [ "$ruins" -gt 0 ] && log "tailscale de volta ao normal"
    ruins=0
    continue
  fi
  ruins=$((ruins + 1)); [ "$ruins" -eq 1 ] || [ $((ruins % 3)) -eq 0 ] && log "tailscale mal ($motivo), ${ruins}ª vez seguida"
  if [ "$ruins" -ge "$BAD_READINGS" ]; then
    # janela deslizante de reinícios
    agora=$wall; keep=(); for t in "${restarts[@]:-}"; do [ -n "$t" ] && [ $((agora - t)) -lt "$JANELA_S" ] && keep+=("$t"); done; restarts=("${keep[@]:-}")
    n=0; for t in "${restarts[@]:-}"; do [ -n "$t" ] && n=$((n + 1)); done
    if [ "$n" -ge "$MAX_RESTARTS" ]; then log "limite de ${MAX_RESTARTS} reinícios em ${JANELA_S}s atingido; não reinicio (causa provavelmente é outra)"; continue; fi
    # /usr zera quando o container é recriado: sem o binário o supervisord só acumula BACKOFF.
    for b in tailscaled tailscale; do
      if [ ! -x "/usr/local/bin/$b" ] && [ -x "/home/box/.local/bin/$b" ]; then sudo -n ln -sf "/home/box/.local/bin/$b" "/usr/local/bin/$b" && log "symlink /usr/local/bin/$b refeito"; fi
    done
    sudo -n mkdir -p /run/tailscale 2>/dev/null
    log "reiniciando o tailscaled pelo supervisord"
    if supervisorctl restart tailscaled >/dev/null 2>&1; then
      restarts+=("$agora"); ruins=0; graca_ate=$((agora + GRACA_S)); log "tailscaled reiniciado; carência de ${GRACA_S}s"
      # Subir o daemon não religa o nó ao control plane; o `up --ssh` é o que devolve o shell.
      sleep 4; sudo -n "$TS" up --ssh --hostname=grokbot --accept-dns=false >/dev/null 2>&1 && log "tailscale up --ssh ok" || log "tailscale up falhou (o daemon pode ainda estar subindo)"
    else log "FALHA ao reiniciar o tailscaled"; fi
  fi
done
