#!/usr/bin/env bash
# wa-admin.sh — roda wa-grupos.js com segurança: backup das credenciais, PARA o gateway,
# executa o comando, RELIGA o gateway e confere que o WhatsApp voltou "connected".
#
# Uso:  bash wa-admin.sh listar [filtro] [--json]
#       bash wa-admin.sh criar "<nome>" <fone> [<fone>...]
#       bash wa-admin.sh info <jid@g.us>
#       bash wa-admin.sh add <jid@g.us> <fone> [...]
#
# Janela de indisponibilidade do agente no WhatsApp: ~20-40s. DMs recebidas nesse
# intervalo chegam quando o gateway volta (WhatsApp entrega offline messages).
set -uo pipefail

S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SVC=openclaw-gateway.service
CRED_ROOT="$HOME/.openclaw/credentials"
BK_DIR="$CRED_ROOT/backups"

[[ $# -ge 1 ]] || { sed -n '2,12p' "$0"; exit 2; }
EXEMPLO='^<.*>$'
for a in "$@"; do
  [[ "$a" =~ $EXEMPLO ]] && { echo "❌ '$a' é um exemplo do manual: troque pelo valor de verdade (ou omita o filtro)." >&2; exit 2; }
done

# Chamado de dentro do agente do WhatsApp (processo filho do próprio gateway): parar o gateway esperaria esta
# execução terminar, e o systemd acabaria matando tudo junto, inclusive o "religar". Roda fora, numa unit
# transitória, e devolve na hora; o resultado vai para data/wa-admin-ultimo.log.
if [[ -z "${MEU_BOT_WA_ADMIN_FORA:-}" ]] && grep -q "$SVC" /proc/self/cgroup 2>/dev/null; then
  OUT="$S/../data/wa-admin-ultimo.log"; mkdir -p "$S/../data"
  if systemd-run --user --collect --quiet --unit "meu-bot-wa-admin-$(date +%s)" --setenv=MEU_BOT_WA_ADMIN_FORA=1 --setenv=MEU_BOT_WA_ADMIN_LOG="$OUT" --setenv=PATH="$PATH" /bin/bash "$S/wa-admin.sh" "$@"; then
    echo "▶ rodando fora do gateway. O WhatsApp do agente para ~30 s (esta conversa pode ficar sem resposta nesse tempo) e volta sozinho."
    echo "  Resultado em $OUT (listar também atualiza data/grupos-live.json)."
    exit 0
  fi
  echo "❌ não consegui rodar fora do gateway (systemd-run). Peça pelo app meu-bot (Grupos › Atualizar lista) ou rode por SSH." >&2
  exit 1
fi
# No Mac (OpenClaw como serviço do launchd, ai.openclaw.gateway): de dentro do agente não dá para rodar fora do
# gateway (não há systemd-run, e parar o serviço do launchd encerra os processos dele). Pelo app, sim.
MAC_GW=""
if [[ "$(uname -s)" == Darwin ]]; then
  MAC_GW="gui/$(id -u)/ai.openclaw.gateway"
  p=$$
  while [[ -n "$p" && "$p" -gt 1 ]]; do
    # O próprio gateway: o node rodando openclaw/dist/index.js gateway, ou o binário openclaw(-gateway). Só o
    # executável e os argumentos dele contam (um shell cujo texto cita "openclaw gateway" não é o gateway).
    c=$(ps -o command= -p "$p" 2>/dev/null); exe=${c%% *}; b=${exe##*/}; eh_gw=""
    case "$b" in
      node|node[0-9]*) [[ "$c" == *"/openclaw/dist/index.js gateway"* ]] && eh_gw=1 ;;
      openclaw-gateway) eh_gw=1 ;;
      openclaw) [[ "$c" == "$exe gateway"* ]] && eh_gw=1 ;;
    esac
    if [[ -n "$eh_gw" ]]; then
      echo "❌ neste Mac a lista de grupos se atualiza pelo app meu-bot (Grupos › Atualizar lista): daqui de dentro do agente, parar o gateway pararia esta conversa junto." >&2
      exit 1
    fi
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
fi
[[ -n "${MEU_BOT_WA_ADMIN_LOG:-}" ]] && exec >"$MEU_BOT_WA_ADMIN_LOG" 2>&1
# Trava: o vigia do gateway (guarda) não religa enquanto este script trabalha com o gateway parado.
LOCK="$HOME/.cache/meu-bot/wa-admin.lock"; mkdir -p "$(dirname "$LOCK")"
# Uma de cada vez na máquina: duas listagens juntas (dois cliques, ou os dois apps) uma religava o gateway no meio da outra.
exec 9>"$LOCK.flock"
# O macOS não tem o flock: o mesmo flock(2) pelo perl, no descritor 9 deste shell (a trava fica com ele até o fim).
trava() {
  if command -v flock >/dev/null 2>&1; then flock -n 9
  else perl -e 'use Fcntl qw(:flock); open(my $f, ">&=", 9) or exit 1; flock($f, LOCK_EX | LOCK_NB) or exit 1'; fi
}
trava || { echo "❌ já há uma listagem/ação de grupos em andamento nesta máquina; espere ela terminar (uns 30 s a alguns minutos)." >&2; exit 4; }
echo $$ > "$LOCK"

# 0) confere o que a listagem precisa ANTES de parar o gateway (máquina que atende clientes não fica parada à toa)
# O Node: primeiro o que roda o gateway (o atalho `openclaw` de todos, em /usr/local/bin, é um `exec <node> …` e diz
# qual), senão os lugares em que o meu-bot instala Node (/opt/node, /opt/openclaw/node, /opt/node24, ~/.local/node24,
# ~/.local/node), por último o do PATH. O PATH de um SSH sem login não traz nenhum desses: por ele a listagem pelo app
# parava em "node não encontrado" com o Node a um diretório de distância.
achar_node() {
  local w n
  w=$(command -v openclaw 2>/dev/null)
  if [[ -n "$w" && -f "$w" ]]; then
    n=$(sed -n 's/^exec \([^ ]*\/node\) .*/\1/p' "$w" 2>/dev/null | head -n1)
    [[ -n "$n" && -x "$n" ]] && { echo "$n"; return 0; }
  fi
  for n in /opt/node/bin/node /opt/openclaw/node/bin/node /opt/node*/bin/node "$HOME"/.local/node*/bin/node /usr/local/bin/node; do
    [[ -x "$n" ]] && { echo "$n"; return 0; }
  done
  command -v node 2>/dev/null
}
NODE=$(achar_node)
[[ -n "$NODE" ]] || { echo "❌ node não encontrado (nem no atalho openclaw, em /opt/node*, /opt/openclaw/node, ~/.local/node* ou no PATH)" >&2; exit 3; }
"$NODE" "$S/wa-grupos.js" checar >&2 || { echo "❌ nada foi parado: corrija o problema acima e tente de novo." >&2; exit 3; }

# 1) backup (mantém os 3 últimos)
mkdir -p "$BK_DIR" && chmod 700 "$BK_DIR"
BK="$BK_DIR/whatsapp-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$BK" -C "$CRED_ROOT" whatsapp && chmod 600 "$BK"
echo "🗄  backup das credenciais: $BK" >&2
ls -1t "$BK_DIR"/whatsapp-*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -f

# 2) para o gateway (e garante religar mesmo se o node falhar)
if [[ -n "$MAC_GW" ]]; then
  # launchd: rodando = "state = running" no launchctl print; para e religa pelo próprio OpenClaw.
  launchctl print "$MAC_GW" 2>/dev/null | grep -q "state = running" && WAS_ACTIVE=active || WAS_ACTIVE=""
  SVC="gateway do OpenClaw (launchd)"
else
  WAS_ACTIVE=$(systemctl --user is-active "$SVC" 2>/dev/null || true)
fi
# O OpenClaw 2026.9 só para o próprio serviço com --force; versões que não conhecem a flag param sem ela.
gw_parar() { if [[ -n "$MAC_GW" ]]; then openclaw gateway stop --force >/dev/null 2>&1 || openclaw gateway stop >/dev/null 2>&1; else systemctl --user stop "$SVC"; fi; }
gw_ligar() { if [[ -n "$MAC_GW" ]]; then openclaw gateway start >/dev/null 2>&1; else systemctl --user start "$SVC"; fi; }
religar() {
  if [[ "$WAS_ACTIVE" == "active" ]]; then
    echo "🔁 religando ${SVC}…" >&2
    gw_ligar
    for i in $(seq 1 30); do
      sleep 2
      if timeout 15 openclaw channels status 2>/dev/null | grep -q 'WhatsApp.*connected'; then
        echo "✅ WhatsApp de volta: $(timeout 15 openclaw channels status 2>/dev/null | grep -o 'WhatsApp[^,]*,.*health:[a-z]*')" >&2
        return 0
      fi
    done
    echo "⚠️  gateway subiu mas WhatsApp ainda não reportou 'connected' após 60s. Veja: journalctl --user -u $SVC -n 50" >&2
    return 1
  fi
}
fim() { religar; rm -f "$LOCK"; }
trap fim EXIT

if [[ "$WAS_ACTIVE" == "active" ]]; then
  echo "⏸  parando ${SVC}…" >&2
  gw_parar
  sleep 2
  # No Mac, confere que o gateway saiu mesmo: duas conexões com as mesmas credenciais derrubariam a sessão.
  if [[ -n "$MAC_GW" ]]; then
    gw_rodando() { launchctl print "$MAC_GW" 2>/dev/null | grep -q "state = running"; }
    for i in $(seq 1 10); do gw_rodando || break; sleep 1; done
    gw_rodando && { echo "❌ o gateway do OpenClaw não parou; nada foi listado." >&2; exit 5; }
  fi
fi

# 3) comando
"$NODE" "$S/wa-grupos.js" "$@"
RC=$?
exit $RC
