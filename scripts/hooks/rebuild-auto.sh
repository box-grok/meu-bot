#!/bin/bash
# Hook `Stop` do Claude Code (ver .claude/settings.json): ao fim de cada resposta, se algum arquivo do app mudou desde
# o último empacotamento, roda em segundo plano o ciclo da skill `testar-no-app`: testes → fecha o app aberto →
# empacota → reabre → confere que ficou de pé (passos 1-4 da skill; o passo 5, olhar a tela, continua sendo do agente).
# Nada acontece se nada mudou; a pessoa não precisa pedir "rebuilda".
#
#   rebuild-auto.sh            modo hook: detecta mudanças e dispara `--run` destacado (volta na hora)
#   rebuild-auto.sh --check    só lista o que mudou e o que seria feito
#   rebuild-auto.sh --run      o ciclo inteiro, no terminal (o hook chama isto com nohup)
#
# Variantes: as que estão ABERTAS agora são fechadas, empacotadas e reabertas (prioridade); o admin sempre entra
# (CLAUDE.md); as demais instaladas em ~/Applications só são empacotadas. Builds em sequência: dist/ é compartilhado.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ" || exit 0
STAMP="$RAIZ/.claude/.rebuild-stamp"
LOCK="$RAIZ/.claude/.rebuild-lock"
LOG="$HOME/Library/Logs/meu-bot-rebuild.log"
mkdir -p "$(dirname "$LOG")"
# pastas que o app empacotado usa (a skill rebuildar): mudou aqui = precisa empacotar
# (build/ e dist/ ficam de fora: são saída do empacotamento; vigiá-los faria o ciclo disparar a si mesmo)
VIGIAR=(src scripts/tests scripts/package.mjs scripts/dist.mjs scripts/fuses.mjs scripts/vendor.mjs scripts/icons.mjs config assets extensao-crm/src extensao-crm/package.json package.json package-lock.json)
# variante | app em ~/Applications | script npm
TABELA="admin|meu-bot-admin|dist:admin
meu-bot|meu-bot|dist
staging|meu-bot-staging|dist:staging
finance-staging|meu-bot-finance-staging|dist:finance-staging
diego|meu-bot-diego|dist:diego
diego-staging|meu-bot-diego-staging|dist:diego-staging"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
avisar() { osascript -e "display notification \"$2\" with title \"meu-bot · rebuild\" subtitle \"$1\"" >/dev/null 2>&1 || true; }
mudados() {
  local alvos=()
  for p in "${VIGIAR[@]}"; do [ -e "$p" ] && alvos+=("$p"); done
  if [ -f "$STAMP" ]; then
    find "${alvos[@]}" -type f -newer "$STAMP" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name ".DS_Store" 2>/dev/null
  else
    echo "(sem carimbo: primeiro ciclo)"
  fi
}
aberto() { pgrep -f "/$1.app/Contents/MacOS/" >/dev/null 2>&1; }
fechar() {
  osascript -e "quit app \"$1\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8; do aberto "$1" || return 0; sleep 1; done
  pkill -f "/$1.app/Contents/MacOS/" >/dev/null 2>&1 || true; sleep 1
}
# ordem: abertos primeiro, depois admin, depois os outros instalados
planejar() {
  local abertos=() resto=()
  while IFS='|' read -r v app script; do
    [ -d "$HOME/Applications/$app.app" ] || continue
    if aberto "$app"; then abertos+=("$v|$app|$script|reabrir"); elif [ "$v" = admin ]; then resto=("$v|$app|$script|so-build" ${resto[@]+"${resto[@]}"}); else resto+=("$v|$app|$script|so-build"); fi
  done <<< "$TABELA"
  printf '%s\n' ${abertos[@]+"${abertos[@]}"} ${resto[@]+"${resto[@]}"} | sed '/^$/d'
}

modo="${1:-hook}"
case "$modo" in
  --check)
    echo "Mudou desde o último empacotamento:"; mudados | sed 's/^/  /'
    echo "Plano:"; planejar | sed 's/^/  /';;
  --run)
    if ! mkdir "$LOCK" 2>/dev/null; then log "já há um ciclo rodando; este sai"; exit 0; fi
    trap 'rmdir "$LOCK" 2>/dev/null' EXIT
    n_mud=$(mudados | wc -l | tr -d ' ')
    touch "$STAMP"   # mudanças feitas durante o build ficam mais novas que o carimbo e entram no próximo ciclo
    log "=== ciclo: $n_mud arquivo(s) mudado(s)"
    avisar "começando" "testes e empacotamento em segundo plano"
    if ! npm test >> "$LOG" 2>&1; then
      log "TESTES FALHARAM: nada empacotado (carimbo desfeito para tentar de novo)"; rm -f "$STAMP"
      avisar "testes falharam" "nada foi empacotado; veja ~/Library/Logs/meu-bot-rebuild.log"; exit 0
    fi
    feitos=(); falhas=()
    while IFS='|' read -r v app script acao; do
      [ -n "$v" ] || continue
      [ "$acao" = reabrir ] && { log "fechando $app"; fechar "$app"; }
      log "npm run $script"
      if npm run "$script" >> "$LOG" 2>&1; then feitos+=("$app"); else falhas+=("$app"); log "FALHOU: $script"; fi
      if [ "$acao" = reabrir ]; then
        # passo 4 da skill testar-no-app: abre, espera, confere que ficou de pé e que não há erro novo no log do app
        applog="$HOME/Library/Application Support/$app/meu-bot.log"; antes=$( [ -f "$applog" ] && wc -l < "$applog" || echo 0 )
        open "$HOME/Applications/$app.app"; sleep 8
        if aberto "$app"; then
          erros=$( [ -f "$applog" ] && tail -n +$((antes+1)) "$applog" | grep -iE "erro|error|falh|exception|uncaught" | head -3 )
          if [ -n "$erros" ]; then log "reaberto $app, MAS com erro novo no log: $erros"; falhas+=("$app (erro no log)"); else log "reaberto $app: de pé, sem erro novo"; fi
        else log "$app NÃO ficou de pé depois de reabrir"; falhas+=("$app (caiu)"); fi
      fi
    done <<< "$(planejar)"
    log "=== fim: ok=${feitos[*]:-nenhum} falhas=${falhas[*]:-nenhuma}"
    if [ -z "${falhas[*]:-}" ]; then avisar "pronto" "${feitos[*]:-nada} reempacotado(s); o app aberto já reabriu"; else avisar "com falhas" "falhou: ${falhas[*]} (log em ~/Library/Logs)"; fi;;
  *)
    cat >/dev/null 2>&1 || true   # stdin JSON do hook: não usamos
    lista="$(mudados)"
    [ -z "$lista" ] && exit 0
    if [ -d "$LOCK" ]; then echo '{"systemMessage":"Rebuild automático já está rodando em segundo plano (as mudanças novas entram no próximo ciclo)."}'; exit 0; fi
    nohup bash "$0" --run >/dev/null 2>&1 &
    n=$(printf '%s\n' "$lista" | wc -l | tr -d ' ')
    echo "{\"systemMessage\":\"Rebuild automático iniciado em segundo plano: $n arquivo(s) do app mudaram. Testes → fecha → empacota → reabre; o Mac avisa quando terminar (log: ~/Library/Logs/meu-bot-rebuild.log).\"}";;
esac
exit 0
