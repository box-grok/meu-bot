---
name: quadro
description: Opera o quadro de pendências do meu-bot, o Project #6 "meu-bot" do GitHub (https://github.com/users/diegofornalha/projects/6) — ler o que está parado e de quem depende, abrir cartões, mover pelas colunas (Fila → Claude trabalhando → Esperando você → Arquivados), pôr PRs no quadro e rotular "pronto para merge". Use no começo de toda sessão ou rodada de trabalho, quando o usuário perguntar "o que depende de mim e o que depende de você", "o que está parado", "como está o quadro", pedir para "abrir um cartão", "mover para feito", "arquivar", ou quando terminar/abrir uma PR.
---

# Quadro: o Project #6 "meu-bot"

O quadro é a única lista de pendências do meu-bot; o resto vive em PRs e releases. Ele existe para o usuário ver
**de quem** cada coisa depende e para o Claude nunca ser a barreira: o Claude move os cartões, o usuário só arrasta
quando quer mudar prioridade. Quem conversa com o usuário é o Claude em pt-BR; o quadro é público.

- **Project:** número 6, dono `diegofornalha`, id `PVT_kwHOAkMxqc4BrGVE`, ligado ao repo `diegofornalha/meu-bot`.
- **Abas:** `Andamento` (quadro por Status) e `Aprovar` (tabela só com PRs abertas: o que o usuário mescla).
- **Status** (campo `PVTSSF_lAHOAkMxqc4BrGVEzhpahmg`), na ordem do fluxo:

  | Coluna | id | Significa |
  |---|---|---|
  | Fila | `7cbfd04e` | decidido, ninguém pegou ainda |
  | Claude trabalhando | `e6547439` | o Claude está fazendo: código, prova, verificação |
  | Esperando você | `f32b699d` | PR com `pronto para merge`, ou ação que só o usuário faz (áudio, conta, decisão) |
  | Arquivados | `a0d0b7df` | concluído (mesclado ou conferido), descartado ou PR de prova |

- **Campo "Depende de"** (você / Claude) e os rótulos do repo `depende: você`, `depende: Claude`, `sem-claude`,
  `pronto para merge`.
- O `gh` deste Mac (`~/.local/bin/gh`, conta `diegofornalha`) já tem o escopo `project`. Se faltar
  (`missing required scopes [read:project]`), o usuário roda no Terminal `gh auth refresh -s read:project,project -h github.com`.

## Regras

1. **Pendência de acompanhamento vira cartão rascunho**, não issue: toda issue aberta por `diegofornalha` acorda o
   workflow "Claude automático" (`.github/workflows/claude-auto.yml`), que a implementa sozinho; com o rótulo
   `sem-claude` ele não implementa, mas ainda deixa uma rodada "Skipped" no Actions, que o usuário não quer ver.
   **Issue só para o que o Claude deve implementar sozinho.**
2. **Toda PR que o Claude abre entra no quadro** (skill `contribuir`), em "Claude trabalhando". Quando Testes,
   Revisão Claude e CodeQL ficam verdes **e** a correção foi provada (memória "PR só aprovada funcionando"), ela
   ganha o rótulo `pronto para merge` e vai para "Esperando você". Nunca rotule uma PR de prova (título "NÃO MESCLAR").
3. **Não há coluna Feito** (o usuário a removeu): concluído vai direto para Arquivados.
4. Os workflows nativos do Project (issue fechada, PR mesclada) estão **desligados**: é o Claude que
   move. Ao fechar uma issue ou ver uma PR mesclada, mova o cartão na hora.
5. Cartão em "Esperando você" diz, no corpo, **a ação exata** que o usuário precisa fazer, em uma frase. O Claude não
   fica parado esperando: faz o resto em paralelo.
6. Renomear colunas pela API (`updateProjectV2Field`) troca os ids e zera o Status de todos os cartões; se precisar,
   faça na tela ou reatribua tudo depois. Abas e workflows nativos só se configuram na tela.

## Comandos

Prefixe com `export PATH="$HOME/.local/bin:$PATH"`. `P=PVT_kwHOAkMxqc4BrGVE` e `F=PVTSSF_lAHOAkMxqc4BrGVEzhpahmg`.

- **Ler o quadro** (começo de rodada):
  `gh project item-list 6 --owner diegofornalha --format json --jq '.items[]|"\(.status // "-") · \(.content.type) #\(.content.number // "") \(.title)"'`
- **Cartão rascunho** (pendência):
  `gh project item-create 6 --owner diegofornalha --title "<o quê>" --body "<ação exata e de quem depende>"`
- **Pôr issue ou PR no quadro:** `gh project item-add 6 --owner diegofornalha --url <url>` (devolve o id do item com `--format json --jq .id`).
- **Id do item de um número:** `gh project item-list 6 --owner diegofornalha --format json --jq '.items[]|select(.content.number==<n>)|.id'`
- **Mover:** `gh project item-edit --project-id $P --id <item> --field-id $F --single-select-option-id <id da coluna>`
- **Rotular PR pronta:** `gh pr edit <n> -R diegofornalha/meu-bot --add-label "pronto para merge"` (só com
  `gh pr view <n> --json statusCheckRollup` todo SUCCESS/SKIPPED e a prova feita).
- **Arquivar de verdade** (sumir do quadro, raro): `gh project item-archive 6 --owner diegofornalha --id <item>`.

## Ao responder "o que depende de mim e o que depende de você"

Leia o quadro e responda em duas listas curtas: **Esperando você** (com a ação exata de cada cartão) e **Claude
trabalhando / Fila** (o que o Claude está fazendo ou vai fazer sozinho). Se nada depende do usuário, diga isso.
