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
[[ -n "${MEU_BOT_WA_ADMIN_LOG:-}" ]] && exec >"$MEU_BOT_WA_ADMIN_LOG" 2>&1
# Trava: o vigia do gateway (guarda) não religa enquanto este script trabalha com o gateway parado.
LOCK="$HOME/.cache/meu-bot/wa-admin.lock"; mkdir -p "$(dirname "$LOCK")"; echo $$ > "$LOCK"

# 1) backup (mantém os 3 últimos)
mkdir -p "$BK_DIR" && chmod 700 "$BK_DIR"
BK="$BK_DIR/whatsapp-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$BK" -C "$CRED_ROOT" whatsapp && chmod 600 "$BK"
echo "🗄  backup das credenciais: $BK" >&2
ls -1t "$BK_DIR"/whatsapp-*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -f

# 2) para o gateway (e garante religar mesmo se o node falhar)
WAS_ACTIVE=$(systemctl --user is-active "$SVC" 2>/dev/null || true)
religar() {
  if [[ "$WAS_ACTIVE" == "active" ]]; then
    echo "🔁 religando $SVC…" >&2
    systemctl --user start "$SVC"
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
  echo "⏸  parando $SVC…" >&2
  systemctl --user stop "$SVC"
  sleep 2
fi

# 3) comando
/opt/node/bin/node "$S/wa-grupos.js" "$@"
RC=$?
exit $RC
