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
trap religar EXIT

if [[ "$WAS_ACTIVE" == "active" ]]; then
  echo "⏸  parando $SVC…" >&2
  systemctl --user stop "$SVC"
  sleep 2
fi

# 3) comando
/opt/node/bin/node "$S/wa-grupos.js" "$@"
RC=$?
exit $RC
