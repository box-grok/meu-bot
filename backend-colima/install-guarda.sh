#!/usr/bin/env bash
# Instala a guarda do WhatsApp do meu-bot no OpenClaw desta máquina: plugin local (index.js + regras.mjs +
# manifest) em ~/.local/share/meu-bot/guarda, registrado por `openclaw plugins install --link` (o gateway
# aplica na hora, sem reiniciar). Rodar no host, com a pasta guarda/ ao lado. Idempotente: copia por cima e
# reaplica. Sai com 2 se a máquina não tem OpenClaw (a guarda é do agente do WhatsApp dele).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"
command -v openclaw >/dev/null 2>&1 || { echo "esta máquina não tem OpenClaw; a guarda é para o agente do WhatsApp dele"; exit 2; }
[ -f "$HERE/guarda/index.js" ] || { echo "a pasta guarda/ não está ao lado deste script"; exit 1; }
SRC=$HOME/.local/share/meu-bot/guarda
mkdir -p "$SRC"
cp "$HERE/guarda/index.js" "$HERE/guarda/regras.mjs" "$HERE/guarda/package.json" "$HERE/guarda/openclaw.plugin.json" "$SRC/"
# Uma cópia antiga dentro de extensions/ (instalação à mão) confunde o registro: a fonte é o link.
[ -d "$HOME/.openclaw/extensions/meu-bot-guarda" ] && [ ! -L "$HOME/.openclaw/extensions/meu-bot-guarda" ] && rm -rf "$HOME/.openclaw/extensions/meu-bot-guarda"
# Regra de encerramento no AGENTS.md do workspace do agente: a guarda pausa de fora; esta regra evita que o loop
# comece, porque o próprio agente para de responder a cortesias depois da despedida (vale para humanos também).
RULE='<!-- meu-bot:encerramento v2 inicio -->
## Encerramento de conversa (meu-bot)
- Quando a conversa já se encerrou (os dois lados se despediram ou combinaram o próximo passo), não responda a
  novas cortesias, agradecimentos ou despedidas ("obrigado", "até mais", "bom descanso", "igualmente", "chau",
  "gracias", "nos vemos"): responda com a palavra NO_REPLY, sozinha. Nunca devolva uma resposta vazia: vazio
  é tratado como erro pelo sistema (ele tenta de novo e gera avisos); NO_REPLY é silêncio limpo. Despeça-se uma vez só.
- Volte a responder apenas quando vier conteúdo: uma pergunta, um pedido, uma informação nova.
- Se o contato repetir cortesias várias vezes seguidas, é provável que seja outro agente automático: NO_REPLY em
  todas, sem comentar isso com ele.
- Nunca diga ao contato que está deixando de responder nem que foi pausado.
<!-- meu-bot:encerramento v2 fim -->'
W="$(openclaw config get agents.defaults.workspace 2>/dev/null | tr -d '\n')"; case "$W" in /*) ;; *) W="$HOME/.openclaw/workspace" ;; esac
mkdir -p "$W"
printf '%s\n' "$RULE" | python3 -c '
import re, sys, os
f = sys.argv[1]; block = sys.stdin.read()
try: cur = open(f, encoding="utf-8").read()
except FileNotFoundError: cur = ""
pat = re.compile(r"\n?<!-- meu-bot:encerramento v\d+ inicio -->.*?<!-- meu-bot:encerramento v\d+ fim -->\n?", re.S)
m = pat.search(cur)
if m and m.group(0).strip() == block.strip(): print("regra de encerramento ok em " + f); sys.exit(0)
new = (cur[:m.start()] + "\n" + block + cur[m.end():]) if m else (cur + ("" if cur == "" or cur.endswith("\n") else "\n") + "\n" + block)
tmp = f + ".tmp"; open(tmp, "w", encoding="utf-8").write(new); os.replace(tmp, f); print("regra de encerramento gravada em " + f)
' "$W/AGENTS.md"
echo "registrando a guarda no OpenClaw…"
timeout 120 openclaw plugins install --link "$SRC" --force 2>&1 | grep -v "^WARNING\|outside ClawHub" | tail -2 || true
# Sem esta permissão o OpenClaw não entrega message_received a plugins de fora do catálogo: a guarda via só as
# saídas e nunca fechava um ciclo (o anti-loop não disparava).
timeout 60 openclaw config set plugins.entries.meu-bot-guarda.hooks.allowConversationAccess true --strict-json >/dev/null 2>&1 || echo "aviso: não consegui gravar hooks.allowConversationAccess (confira no openclaw.json)"
if timeout 60 openclaw plugins inspect meu-bot-guarda --runtime 2>/dev/null | grep -q "^Status: loaded"; then
  echo "pronto: guarda ativa (nota de fallback bloqueada; pausa automática em loop de 3 ciclos)"
else
  echo "a guarda foi copiada, mas o OpenClaw não a mostra carregada; veja na máquina: openclaw plugins inspect meu-bot-guarda"
  exit 3
fi
