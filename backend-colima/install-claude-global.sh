#!/bin/bash
# Claude Code Global (root): instala ou atualiza o intermediário que serve a assinatura do root a todos os usuários
# da máquina (claude-global.js). Idempotente. O programa fica em /opt/meu-bot-claude-global (todos leem, como o
# /opt/hermes; não tem segredo); porta e chaves em /etc/meu-bot/claude-global (só o root); o token continua só no
# /root/.claude. Saída: CLAUDE_GLOBAL=ok <porta>, LOGIN=0|1 e EMAIL=<conta do root>, ou ERRO=<motivo>.
set -u
umask 077
[ "$(id -u)" = 0 ] || { echo "ERRO=o Claude Code Global precisa ser instalado como root"; exit 0; }
SRC=$(cd "$(dirname "$0")" && pwd)
D=/opt/meu-bot-claude-global; ETC=/etc/meu-bot/claude-global; U=meu-bot-claude-global
NODE=""; for n in /opt/hermes/node/bin/node "$(command -v node 2>/dev/null)" /usr/bin/node /usr/local/bin/node; do [ -n "$n" ] && [ -x "$n" ] && "$n" -v >/dev/null 2>&1 && { NODE=$n; break; }; done
[ -n "$NODE" ] || { echo "ERRO=não achei o Node.js nesta máquina (instale o Hermes para todos antes)"; exit 0; }

mkdir -p "$D" "$ETC/chaves" || { echo "ERRO=não consegui criar $D ou $ETC"; exit 0; }
for f in claude-global.js contas-claude.js account-status.js; do
  [ -f "$SRC/$f" ] || { echo "ERRO=falta $f no pacote"; exit 0; }
  install -m 644 -o root -g root "$SRC/$f" "$D/$f"
done
chmod 755 "$D"; chmod 700 "$ETC" "$ETC/chaves"; chown -R root:root "$ETC"

# Porta: a que já está gravada; senão a primeira livre de 18780 a 18799.
P=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["porta"]))' "$ETC/config.json" 2>/dev/null)
if [ -z "$P" ]; then
  for c in $(seq 18780 18799); do ss -ltn 2>/dev/null | grep -q "127.0.0.1:$c \|\*:$c \|0.0.0.0:$c " || { P=$c; break; }; done
  [ -n "$P" ] || { echo "ERRO=nenhuma porta livre entre 18780 e 18799"; exit 0; }
  printf '{"porta": %s}\n' "$P" > "$ETC/config.json"
fi
chmod 600 "$ETC/config.json"

cat > /etc/systemd/system/$U.service <<EOF
[Unit]
Description=meu-bot: Claude Code Global (a assinatura do root para os usuários desta máquina)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$NODE $D/claude-global.js
Environment=HOME=/root
User=root
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$U" >/dev/null 2>&1
systemctl restart "$U" || { echo "ERRO=o serviço $U não subiu (journalctl -u $U)"; exit 0; }
ok=0; for i in $(seq 1 20); do curl -s -m 2 "http://127.0.0.1:$P/saude" 2>/dev/null | grep -q '"ok":true' && { ok=1; break; }; sleep 0.5; done
[ "$ok" = 1 ] || { echo "ERRO=o intermediário não respondeu em 127.0.0.1:$P (journalctl -u $U)"; exit 0; }

# Confere como um usuário comum: enxerga o intermediário, mas não lê porta, chaves nem o login do root.
if runuser -u nobody -- cat "$ETC/config.json" >/dev/null 2>&1 || runuser -u nobody -- ls "$ETC/chaves" >/dev/null 2>&1 || runuser -u nobody -- cat /root/.claude/.credentials.json >/dev/null 2>&1; then
  echo "ERRO=um usuário comum conseguiu ler $ETC ou o login do root; confira as permissões"; exit 0
fi
echo "CLAUDE_GLOBAL=ok $P"
grep -q '"oauthAccount"' /root/.claude.json 2>/dev/null && [ -s /root/.claude/.credentials.json ] && echo "LOGIN=1" || echo "LOGIN=0"
E=$(python3 -c 'import json; print(json.load(open("/root/.claude.json")).get("oauthAccount",{}).get("emailAddress",""))' 2>/dev/null); echo "EMAIL=$E"
