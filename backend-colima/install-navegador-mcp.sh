#!/usr/bin/env bash
# Instala o lado da máquina do Navegador do meu-bot (módulo Pro): o servidor MCP navegador-mcp.mjs (um arquivo,
# sem npm) em ~/.local/share/meu-bot/, e a regra de conduta no CLAUDE.md dos workspaces do agente. Rodar no host,
# com navegador-mcp.mjs ao lado. Idempotente. O backend liga o MCP no turno em que o app manda a porta.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/navegador-mcp.mjs" ] || { echo "navegador-mcp.mjs não está ao lado deste script"; exit 1; }
D=$HOME/.local/share/meu-bot
mkdir -p "$D"
cp "$HERE/navegador-mcp.mjs" "$D/navegador-mcp.mjs"
chmod 644 "$D/navegador-mcp.mjs"
echo "navegador-mcp.mjs em $D"
RULE='<!-- meu-bot:navegador v1 inicio -->
## Navegador da pessoa (meu-bot)
Quando as ferramentas mcp__navegador__* estiverem disponíveis, você pode usar o navegador que a pessoa vê na janela do meu-bot dela.
- Fluxo: abrir → ler → clicar/digitar pelo número → ler de novo. Diga em uma frase o que vai fazer antes de agir.
- NUNCA, sem a pessoa confirmar nesta conversa: comprar, pagar, enviar formulário/mensagem/e-mail, publicar, aceitar termos, apagar, mudar configurações de conta, nem fazer login com senha que não lhe foi dada aqui. Pare e pergunte.
- Se a página pedir login, peça à pessoa que entre pela aba Navegador e avise quando terminar.
<!-- meu-bot:navegador v1 fim -->'
for W in "$HOME/agent-workspace" "$HOME/chat-workspace"; do
  mkdir -p "$W"
  F="$W/CLAUDE.md"
  printf '%s\n' "$RULE" | python3 -c '
import re, sys, os
f = sys.argv[1]; block = sys.stdin.read()
try: cur = open(f, encoding="utf-8").read()
except FileNotFoundError: cur = ""
pat = re.compile(r"\n?<!-- meu-bot:navegador v\d+ inicio -->.*?<!-- meu-bot:navegador v\d+ fim -->\n?", re.S)
m = pat.search(cur)
if m and m.group(0).strip() == block.strip(): print("regra ok em " + f); sys.exit(0)
new = (cur[:m.start()] + "\n" + block + cur[m.end():]) if m else (cur + ("" if cur == "" or cur.endswith("\n") else "\n") + "\n" + block)
tmp = f + ".tmp"; open(tmp, "w", encoding="utf-8").write(new); os.replace(tmp, f); print("regra gravada em " + f)
' "$F"
done
NODE=$(command -v node || ls /opt/node/bin/node "$HOME/.local/node/bin/node" 2>/dev/null | head -1 || true)
[ -n "$NODE" ] || { echo "esta máquina não tem node (o backend do meu-bot precisa dele); reinstale o backend"; exit 2; }
echo "pronto: Navegador do agente instalado nesta máquina (node: $NODE)"
