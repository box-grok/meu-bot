---
name: contribuir
description: Leva uma correção do meu-bot feita neste Mac até um pull request no diegofornalha/meu-bot, pelo fork box-grok/meu-bot (esta conta só tem leitura no original). Use quando o usuário disser "manda PR", "abre um PR", "faz o fork e manda", "envia a correção", "escreve uma issue e manda PR" ou "aproveita que corrigiu e manda".
---

# Contribuir: fork → pull request

A conta do GitHub deste Mac (`box-grok`) só lê o `diegofornalha/meu-bot`: toda mudança vai por um branch no fork
`box-grok/meu-bot` (remote `fork`) e chega no original por PR. Publicar é público: abra o PR quando o usuário pedir **ou
quando o hook `scripts/hooks/pr-lembrete.sh` apontar, ao fim de uma resposta, commits sem PR num branch que você fez
nesta sessão** (branch de outra sessão: só avise o usuário).

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
2. **Worktree próprio, branch atualizado**: `git fetch origin` e um worktree novo com o branch a partir de `origin/main`,
   nome curto em pt-BR do que muda: `git worktree add -b <branch> ../meu-bot-<nome> origin/main`. Nunca troque de branch
   no checkout principal (outras sessões usam o mesmo diretório ao mesmo tempo) e nunca commite direto no `main`. Se a
   mudança já foi feita no checkout principal, leve-a para o worktree (`git stash` → `git -C ../meu-bot-<nome> stash pop`,
   ou `git diff | git -C ../meu-bot-<nome> apply`). Para o worktree empacotar: `ln -s` de `node_modules` e de
   `extensao-crm/node_modules` do checkout principal; cópia (não symlink: o `build:extensao` recusa) de
   `build/extensao-autenticador`; cópia de `config/google-oauth.json` e `config/google-conta-oauth.json` (fora do git; sem
   eles o cliente sai sem Google e o `package.mjs` avisa). Rode `npm test` e `npm run dist…` de dentro do worktree.
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

Diga em pt-BR, em poucas linhas: o link do PR, o branch, o que foi testado e o que falta conferir. Avise onde está o
worktree (`../meu-bot-<nome>`), que o checkout principal não mudou, e que ele sai com `git worktree remove ../meu-bot-<nome>`
quando a PR entrar.

## Regras

- Nunca `push --force` num branch que já tem PR aberto sem combinar com o usuário. Para corrigir, faça um commit novo.
- Correção nova vai em branch novo, não no branch de outro PR ainda aberto.
- Não feche, não faça merge e não comente em PR ou issue de outra pessoa sem o usuário pedir.
