#!/usr/bin/env bash
# Instala/atualiza o backend do meu-bot nesta máquina. Rodar no host, com server.js, session-map.js,
# meu-bot-backend.service e este script no mesmo diretório. Idempotente: pode rodar de novo.
# - Node: usa o existente se for >= 18; senão baixa o 20 LTS (.tar.gz) em ~/.local/node.
# - Serviço: unidade systemd de usuário; como root (ou sem gerenciador de usuário) vira unidade do sistema.
#   Onde o systemd não roda (Computador do Grok Bot: PID 1 é o pod-daemon, mas /usr/bin/systemctl existe),
#   cai no nohup — por isso testamos /run/systemd/system, não a presença do binário.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DEST=$HOME/.hermes/agente-rene/backend-sdk-claude
NODE_DIR=$HOME/.local/node
NODE_VER=${NODE_VER:-v20.20.2}
PORT=${PORT:-8080}

node_ok() { local v; v=$("$1" -v 2>/dev/null | sed 's/^v//; s/\..*//') || return 1; [ "${v:-0}" -ge 18 ]; }
NODE=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then NODE=$(command -v node)
elif [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; then NODE=$NODE_DIR/bin/node
else
  arch=$(uname -m); case "$arch" in aarch64|arm64) a=arm64;; x86_64) a=x64;; *) echo "arquitetura $arch não suportada"; exit 1;; esac
  tmp=$(mktemp -d); echo "baixando node $NODE_VER $a…"
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$a.tar.gz" -o "$tmp/node.tar.gz"
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"; tar -xzf "$tmp/node.tar.gz" -C "$NODE_DIR" --strip-components=1; rm -rf "$tmp"
  NODE=$NODE_DIR/bin/node
fi
echo "node: $("$NODE" -v) em $NODE"

CLAUDE=$(command -v claude 2>/dev/null || true); [ -z "$CLAUDE" ] && [ -x "$HOME/.local/bin/claude" ] && CLAUDE=$HOME/.local/bin/claude
[ -n "$CLAUDE" ] || { echo "claude não encontrado no PATH nem em ~/.local/bin"; exit 1; }
grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null || echo "aviso: Claude Code parece deslogado (sem oauthAccount em ~/.claude.json); o backend vai responder 401 até fazer /login"

# Trava: na grokbot-1 o mesmo caminho é o backend ORIGINAL do Hermes (app.js, services/, git). Copiar o
# server.js genérico por cima apaga o dele; o processo vivo não nota, mas o próximo restart sobe o
# genérico e o WhatsApp (rene-dm) para. Aconteceu em 14/15 out 2026. Nunca mais.
if [ -f "$DEST/app.js" ] || [ -d "$DEST/services" ]; then
  echo "ERRO: $DEST já é o backend do Hermes (app.js/services). Este instalador é só para máquinas sem ele." >&2
  echo "      Para o modelo agente/grok-4 nessa máquina use backend-vm/deploy-agente.sh." >&2
  exit 3
fi
mkdir -p "$DEST/data" "$HOME/chat-workspace" "$HOME/agent-workspace"
cp "$HERE/server.js" "$HERE/session-map.js" "$HERE/providers.js" "$HERE/account-status.js" "$HERE/tool-events.js" "$HERE/navegador.js" "$HERE/licenca.js" "$DEST/"
[ -f "$DEST/providers.json" ] || { cp "$HERE/providers.json" "$DEST/providers.json"; echo "providers.json criado (agente → grok-4; grok-4 precisa de XAI_API_KEY no .env ou base_url local)"; }
if [ ! -f "$DEST/.env" ]; then
  umask 077; printf 'OPENAI_COMPAT_KEY=%s\nPORT=%s\nHOST=127.0.0.1\nCLAUDE_BIN=%s\n' "$(openssl rand -hex 32)" "$PORT" "$CLAUDE" > "$DEST/.env"; echo ".env criado"
else
  grep -q '^CLAUDE_BIN=' "$DEST/.env" || printf 'CLAUDE_BIN=%s\n' "$CLAUDE" >> "$DEST/.env"
fi
chmod 600 "$DEST/.env"

render_unit() { # $1 = USERLINE, $2 = TARGET
  sed -e "s|__DEST__|$DEST|g" -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE|g" -e "s|__NODEDIR__|$(dirname "$NODE")|g" \
      -e "s|__USERLINE__|$1|g" -e "s|__TARGET__|$2|g" "$HERE/meu-bot-backend.service"
}

if [ "$(id -u)" -ne 0 ] && systemctl --user is-system-running >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  render_unit "" "default.target" > "$HOME/.config/systemd/user/meu-bot-backend.service"
  systemctl --user daemon-reload
  systemctl --user enable meu-bot-backend.service >/dev/null
  systemctl --user restart meu-bot-backend.service
  command -v loginctl >/dev/null && loginctl enable-linger "$(id -un)" 2>/dev/null || true
  sleep 1.5; systemctl --user --no-pager --lines=3 status meu-bot-backend.service || true
elif [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo -n"
  render_unit "User=$(id -un)" "multi-user.target" | $SUDO tee /etc/systemd/system/meu-bot-backend.service >/dev/null
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable meu-bot-backend.service >/dev/null
  $SUDO systemctl restart meu-bot-backend.service
  sleep 1.5; $SUDO systemctl --no-pager --lines=3 status meu-bot-backend.service || true
elif supervisorctl status meu-bot-backend >/dev/null 2>&1; then
  # Computador do Grok Bot com supervisord e o programa já cadastrado (ver PERSISTENCIA.md da máquina):
  # reiniciar por ele, nunca por nohup — senão nascem dois server.js disputando a porta.
  echo "supervisord gerencia meu-bot-backend: reiniciando por ele"
  supervisorctl restart meu-bot-backend >/dev/null 2>&1 || { echo "supervisorctl restart falhou"; exit 1; }
  sleep 2
else
  echo "sem systemd: subindo com nohup (não sobrevive a reinício)"
  # O processo anterior foi iniciado como `node server.js` (relativo, a partir de $DEST): `pkill -f` pelo
  # caminho completo nunca casa, o novo nasce com EADDRINUSE e o curl do fim responde pelo velho. Mata
  # pelo cwd, que é o que identifica o nosso.
  for p in $(pgrep -f 'node server\.js' 2>/dev/null); do [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$DEST" ] && kill "$p" 2>/dev/null; done
  pkill -f "$DEST/server.js" 2>/dev/null || true; sleep 0.5
  (cd "$DEST" && OPENAI_COMPAT_SESSIONS_PATH="$DEST/data/openai-compat-sessions.json" nohup "$NODE" server.js >> "$DEST/backend.log" 2>&1 &)
  sleep 1.5
fi

K=$(grep '^OPENAI_COMPAT_KEY=' "$DEST/.env" | cut -d= -f2-)
if curl -s -m 5 -H "Authorization: Bearer $K" "http://127.0.0.1:$PORT/v1/models" | grep -q claudecode; then echo "OK: backend respondendo em 127.0.0.1:$PORT"; else echo "AVISO: backend ainda não respondeu em 127.0.0.1:$PORT"; exit 1; fi

# Status line do Claude (Sessão/Semanal no app) vai junto quando o instalador está ao lado. Não derruba o
# backend: numa máquina com statusLine gerenciada ele sai com 3 e explica.
if [ -f "$HERE/install-statusline.sh" ]; then bash "$HERE/install-statusline.sh" || echo "aviso: status line não instalada (código $?)"; fi
