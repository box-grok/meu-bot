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
RULE='<!-- meu-bot:navegador v4 inicio -->
## Navegador da pessoa (meu-bot)
Quando as ferramentas mcp__navegador__* estiverem disponíveis, você pode usar o navegador que a pessoa vê na janela do meu-bot dela.
- Fluxo: abrir → ler → clicar/digitar pelo número → ler de novo. Diga em uma frase o que vai fazer antes de agir.
- NUNCA, sem a pessoa confirmar nesta conversa: comprar, pagar, enviar formulário/mensagem/e-mail, publicar, aceitar termos, apagar, mudar configurações de conta, nem fazer login com senha que não lhe foi dada aqui. Pare e pergunte.
- Se a página pedir login, peça à pessoa que entre pela aba Navegador e avise quando terminar.
- Sem as ferramentas mcp__navegador__*: peça à pessoa para abrir a aba Navegador no app e ligar "agente pode usar". NUNCA instale navegador, Playwright, Puppeteer ou Chromium na máquina por conta própria.
- Skills aprendidas: antes de operar um site, veja se existe ~/.claude/skills/<site>-navegador/SKILL.md (ex.: streak-crm-navegador) e siga o que já funcionou. Ao terminar uma tarefa num site em que você precisou descobrir o caminho (tentativas, prints, scripts), grave ou atualize essa skill com frontmatter (name, description) e o passo a passo que funcionou e o que não funcionou, para não repetir o trabalho da próxima vez.

## Pedido vago: ajude a pessoa a decidir antes de criar ou encaixar (meu-bot)
- Quando o pedido implica criar ou encaixar algo numa estrutura (pipeline, etapa ou box no CRM; espaço de trabalho; fluxo; skill) e a pessoa não disse onde, ou parece não ter certeza do que quer: NÃO encaixe no único lugar que existe só porque é o único. Pare e ofereça 2 ou 3 opções em linguagem simples, com a sua recomendação e o porquê em uma linha, e espere a escolha. Exemplo: um e-mail de assunto novo não vai para o pipeline de parceiros; proponha um pipeline ou fluxo próprio para aquele assunto, ou só anotar sem CRM.
- Assunto diferente pede lugar diferente: parceiros, clientes, cobranças e inscrições não moram no mesmo pipeline. Prefira propor o lugar próprio a misturar.
- Pessoa que não sabe o que quer: faça uma pergunta por vez, com exemplos concretos do que ela já tem na máquina, e só aja depois da resposta. Nunca crie "de teste" em dados reais sem avisar que é teste e sem combinar como desfazer.
- As ferramentas do meu-bot na máquina (~/.local/share/meu-bot/*, inclusive streak.mjs e os plugins) são do app: não as edite nem as substitua por conta própria. Se faltar um subcomando ou uma ação, diga à pessoa o que falta para ela pedir no app; use só o que existe.
<!-- meu-bot:navegador v4 fim -->'
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
# Skills aprendidas: sementes do meu-bot entram só se a máquina ainda não tiver a sua (o agente edita a dele).
for SEED in "$HERE"/skill-*.md; do
  [ -f "$SEED" ] || continue
  NAME=$(basename "$SEED" .md); NAME=${NAME#skill-}
  SK="$HOME/.claude/skills/$NAME/SKILL.md"
  if [ -f "$SK" ]; then echo "skill $NAME já existe (mantida)"; else mkdir -p "$(dirname "$SK")"; cp "$SEED" "$SK"; echo "skill $NAME instalada em $SK"; fi
done
NODE=$(command -v node || ls /opt/node/bin/node "$HOME/.local/node/bin/node" 2>/dev/null | head -1 || true)
[ -n "$NODE" ] || { echo "esta máquina não tem node (o backend do meu-bot precisa dele); reinstale o backend"; exit 2; }
echo "pronto: Navegador do agente instalado nesta máquina (node: $NODE)"
