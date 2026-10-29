---
name: contribuir
description: Leva uma correção do meu-bot feita neste Mac até um pull request no diegofornalha/meu-bot, pelo fork box-grok/meu-bot (esta conta só tem leitura no original). Use quando o usuário disser "manda PR", "abre um PR", "faz o fork e manda", "envia a correção", "escreve uma issue e manda PR" ou "aproveita que corrigiu e manda".
---

# Contribuir: fork → pull request

A conta do GitHub deste Mac (`box-grok`) só lê o `diegofornalha/meu-bot`: toda mudança vai por um branch no fork
`box-grok/meu-bot` (remote `fork`) e chega no original por PR. Publicar é público: só abra o PR quando o usuário pedir.

## Antes

- `gh`: fica em `~/.local/bin/gh`, que pode não estar no PATH deste shell; use `export PATH="$HOME/.local/bin:$PATH"`
  no começo do comando. `gh auth status` deve mostrar `box-grok`. Se não estiver logado, o usuário roda
  `! gh auth login -h github.com -p https -w` e depois `! gh auth setup-git`.
- Identidade dos commits, só neste repositório (não no global): `user.name cursor` (o nome da máquina) e
  `user.email box@agentesgrok.com`. Confira com `git config user.name`; se faltar, grave com `git config` sem `--global`.
- Remote `fork`: `git remote get-url fork`. Se faltar: `gh repo fork diegofornalha/meu-bot --clone=false` (não falha se
  o fork já existe) e `git remote add fork https://github.com/box-grok/meu-bot.git`.

## A sequência

1. **Testes**: `npm test` (já roda o build). Com teste quebrado, pare e mostre a falha: não mande PR.
2. **Branch atualizado**: `git fetch origin` e um branch novo a partir de `origin/main`, com nome curto em pt-BR do que
   muda (ex.: `usuarios-tabela-rola`). Se a mudança foi feita no `main`, crie o branch a partir dali com `git switch -c`
   (as mudanças não commitadas vão junto). Nunca commite direto no `main`.
3. **Commit**: só os arquivos da mudança (`git add <arquivos>`, nada de `git add -A`, que pegaria `.env`, `out/` e afins).
   Mensagem no estilo do `git log`: `Área: o que muda` na primeira linha, em pt-BR, e um parágrafo com o porquê. Termine
   com a linha de coautoria que a conversa indicar.
4. **Push**: `git push -u fork <branch>`.
5. **PR**: escreva o corpo num arquivo no scratchpad e rode
   `gh pr create -R diegofornalha/meu-bot --head box-grok:<branch> --base main --title "<título>" --body-file <arquivo>`.
   Corpo com estas seções: **O que acontece** (o sintoma, como o usuário viu, a versão e a máquina), **Por quê** (a
   causa no código), **Correção** (arquivos e o que mudou), **Como conferir** (passos e o resultado esperado) e
   **Testes** (o que rodou e o que ainda não foi conferido na tela). Termine com a linha de atribuição que a conversa
   indicar.
6. **Issue**, só se o usuário pedir uma separada: `gh issue create -R diegofornalha/meu-bot --title … --body-file …`.
   Aí ponha `Closes #<n>` no corpo do PR.
7. **Rebuildar** (skill `rebuildar`) para o usuário ver a correção no app instalado, se ainda não foi feito.

## Ao terminar

Diga em pt-BR, em poucas linhas: o link do PR, o branch, o que foi testado e o que falta conferir. Avise que o
repositório local ficou no branch novo, não no `main`.

## Regras

- Nunca `push --force` num branch que já tem PR aberto sem combinar com o usuário. Para corrigir, faça um commit novo.
- Correção nova vai em branch novo, não no branch de outro PR ainda aberto.
- Não feche, não faça merge e não comente em PR ou issue de outra pessoa sem o usuário pedir.
