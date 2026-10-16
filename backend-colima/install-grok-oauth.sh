#!/usr/bin/env bash
# Grok (xAI) por OAuth nesta máquina, do jeito que funcionava no grokbot: o Hermes (pacote npm, em ~/.local)
# faz o login por código de dispositivo (`hermes auth add xai-oauth`, que o app dispara em seguida) e serve um
# proxy OpenAI-compatível local (`hermes proxy start --provider xai`, porta 8645, aceita qualquer bearer e usa
# o OAuth); o backend do meu-bot aponta o modelo grok-4 para esse proxy (providers.json). Sem chave de API.
# Rodar no host. Idempotente. Não mexe no login do Claude nem no resto do backend.
set -euo pipefail
HERMES_VERSION=0.22.2
PROXY_PORT=8645
BACKEND=$HOME/.hermes/agente-rene/backend-sdk-claude
[ -f "$BACKEND/server.js" ] || { echo "esta máquina não tem o backend do meu-bot; instale pelo seletor antes"; exit 2; }
# O fallback e o grok-4 vivem no providers.js; um backend antigo não o tem (reinstalar pelo seletor atualiza).
[ -f "$BACKEND/providers.js" ] || { echo "o backend desta máquina é antigo (sem providers.js): use \"Reinstalar backend\" no seletor e tente de novo"; exit 3; }

# O node do backend (num shell sem login ele pode não estar no PATH).
NODE=$(grep -h '^ExecStart=' "$HOME/.config/systemd/user/meu-bot-backend.service" 2>/dev/null | awk '{print $1}' | sed 's/^ExecStart=//' || true)
[ -n "$NODE" ] && [ -x "$NODE" ] && export PATH="$(dirname "$NODE"):$PATH"
export PATH="$HOME/.local/bin:$PATH"
command -v npm >/dev/null 2>&1 || { echo "npm não encontrado nesta máquina"; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "esta máquina não tem systemd; o proxy do Hermes precisa dele para ficar no ar"; exit 1; }

if ! hermes --version 2>/dev/null | grep -q "v$HERMES_VERSION"; then
  echo "instalando o Hermes $HERMES_VERSION em ~/.local (só na primeira vez demora)…"
  mkdir -p "$HOME/.local"
  npm install -g --prefix "$HOME/.local" "hermes-agent@$HERMES_VERSION" >/dev/null 2>&1 || { echo "a instalação do Hermes falhou"; exit 1; }
fi
echo "Hermes: $(hermes --version 2>/dev/null | head -1)"
hermes proxy providers 2>/dev/null | grep -qi xai || { echo "este Hermes não tem o proxy da xAI"; exit 1; }

# providers.json do backend: grok-4 pelo proxy local (endpoint local dispensa chave). Um providers.json de
# outra origem fica guardado ao lado.
P=$BACKEND/providers.json
if [ -f "$P" ] && ! grep -q "127.0.0.1:$PROXY_PORT" "$P"; then cp "$P" "$P.antes-do-grok-oauth"; echo "providers.json anterior guardado em $P.antes-do-grok-oauth"; fi
cat > "$P" <<JSON
[
  { "name": "agente", "type": "claude", "priority": 0, "description": "Claude Code com ferramentas, sem pedir permissão (bypass)" },
  { "name": "grok-4", "type": "openai", "priority": 1, "base_url": "http://127.0.0.1:$PROXY_PORT/v1", "model": "grok-4", "description": "Grok da xAI pelo proxy local do Hermes (login OAuth: hermes auth add xai-oauth)" }
]
JSON
echo "grok-4 apontado para o proxy local (porta $PROXY_PORT)"

# O proxy como serviço do usuário: sobe no boot e volta se cair.
U=$HOME/.config/systemd/user; mkdir -p "$U"
HB=$(command -v hermes)
cat > "$U/hermes-xai-proxy.service" <<EOF
[Unit]
Description=Hermes: proxy da xAI (Grok por OAuth) para o meu-bot
After=network.target

[Service]
ExecStart=$HB proxy start --provider xai --host 127.0.0.1 --port $PROXY_PORT
Restart=always
# Antes do login da xAI o proxy sai na hora ("Not logged in"); sem pressa para tentar de novo.
RestartSec=15
Environment=PATH=$(dirname "$HB"):$(dirname "${NODE:-/usr/bin/node}"):/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now hermes-xai-proxy.service >/dev/null 2>&1 || systemctl --user restart hermes-xai-proxy.service
loginctl enable-linger "$USER" >/dev/null 2>&1 || true
systemctl --user restart meu-bot-backend
sleep 2
echo "proxy: $(systemctl --user is-active hermes-xai-proxy.service) · backend: $(systemctl --user is-active meu-bot-backend)"
if hermes auth status xai-oauth 2>/dev/null | grep -qi "logged in"; then
  echo "pronto: xAI já logada; o grok-4 responde pelo proxy"
else
  echo "pronto: falta entrar na xAI (o app abre o link de login agora)"
fi
