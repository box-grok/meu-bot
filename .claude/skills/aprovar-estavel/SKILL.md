---
name: aprovar-estavel
description: Checklist de três fases para levar o staging do meu-bot à estável com segurança — 1) o staging está no ar e o usuário testou, 2) a release estável passa em todas as recusas (npm run release -- --conferir), 3) depois de publicar, a estável chegou certa às pessoas e às máquinas. Use quando o usuário perguntar "dá para subir a estável?", "como está o staging?", "posso aprovar?", "subiu certo?", "aprovado" (antes de chamar a skill publicar), ou depois de publicar uma estável.
---

# Aprovar a estável (as três fases)

A skill `publicar` é a que publica (staging e estável). Esta é o portão: diz se o staging está pronto para virar
estável e, depois, se a estável chegou certa. Responda sempre em pt-BR, com o que você conferiu e o que depende do
usuário. A estável só sai com o **"aprovado"** explícito dele (é pública e definitiva); nada aqui substitui isso.

Antes de tudo: `git fetch origin --tags` e descubra a staging mais nova (`gh release list -R diegofornalha/meu-bot --limit 5`).
Chame `<v>` a versão base (`package.json` do `origin/main`, ex.: `0.80.0`) e `<tag>` a staging candidata (`v<v>-staging.N`).

## Fase 1: o staging está no ar e foi testado

Você confere sozinho:

- **Release completa:** `gh release view <tag> -R diegofornalha/meu-bot --json isDraft,assets` → não é draft; para cada
  app do canal (meu-bot-staging, meu-bot-finance-staging) há o `.zip` **e** o `.zip.sig`, e o `.dmg` do
  meu-bot-staging (o instalador do site).
- **Site de staging:** `curl -s https://site-staging.agentesgrok.com/download/mac.json` → `versao` = a da `<tag>` e
  `nome` terminando em `.dmg` (até 10 min de cache depois de publicar).
- **O staging do usuário trocou mesmo:** no `~/Library/Application Support/meu-bot-staging/meu-bot.log`,
  `grep "atualizacao \(preparar\|trocar\)"` mostra `preparar ok: <versão> pronta` e `trocar ok: trocado para a <versão>`;
  e `grep "\[atualização\].*recus\|não confere"` vazio (assinatura recusada aparece aí).
- **Máquinas no backend certo:** para cada alias `suporte-*` do `~/.ssh/meu-bot-suporte.conf`,
  `ssh -o BatchMode=yes <alias> 'cat ~/.local/share/meu-bot/backend/VERSION'` igual ao `backend-colima/VERSION` da
  `<tag>` (`git show <tag>:backend-colima/VERSION`). Abaixo = a máquina ainda não atualizou (o seletor atualiza
  quando ociosa; log `[backend]` do app).
- **O que mudou desde a última estável:** `git log --oneline --first-parent v<estável anterior>..<tag>` e a seção
  "Ainda não lançado" do `docs/CHANGELOG.md` na `<tag>`. Aponte o que é novo e ninguém testou ainda.
- **O `main` andou depois da `<tag>`?** `git log --oneline --first-parent <tag>..origin/main`. Se sim, diga quais PRs
  ficariam de fora da estável (a promoção sai no commit da tag).

Depende do usuário: testar pelo roteiro de dez minutos de [`docs/ROTEIRO-upgrade.md`](../../../docs/ROTEIRO-upgrade.md)
(instalar por cima, versão preparada, recusa do que não confere, troca, preferências e abas, volta atrás) e dizer o que
viu. Sem esse retorno, diga "o staging está no ar, falta o seu teste".

## Fase 2: a estável passa em todas as recusas

Num worktree **no commit da `<tag>`** (nunca o checkout principal):
`git worktree add --detach ../meu-bot-release <tag>` (ou `git -C ../meu-bot-release checkout -q --detach <tag>`), com
`node_modules` (symlink do checkout principal), o `build/` inteiro (inclui `build/suporte`) e `config/google-*.json`
copiados, como na skill `contribuir`. Lá:

```
npm test
npm run release -- --conferir
```

O `--conferir` roda tudo o que o `npm run release` recusaria e sai antes de empacotar, sem tag nem release: árvore
limpa, `gh` logado, a tag `v<v>` ainda livre, **o commit tem a tag `-staging.N`** (só sobe para estável o que passou
pelo staging), a chave da release no Chaveiro (o macOS pode pedir aprovação), as versões dos componentes da máquina
(backend, financeiro, CRM, guarda) e `build/suporte` para o admin. Sai com `✓ conferido: v<v> pode sair do commit … com
meu-bot, meu-bot-admin-gestao, meu-bot-admin-mac (N itens nas notas). Nada foi publicado.` Qualquer `✗` para a fase:
mostre a linha ao usuário e o que fazer.

Com fase 1 e fase 2 verdes, diga ao usuário que dá para aprovar e espere o **"aprovado"**. Aí siga a skill `publicar`
(passos 6 a 8) no mesmo worktree.

## Fase 3: a estável chegou certa

Logo depois do `npm run release` (skill `publicar`), você confere sozinho:

- **Release:** `gh release view v<v> -R diegofornalha/meu-bot --json isPrerelease,assets` → não é pre-release; `.zip` +
  `.zip.sig` do meu-bot e dos admins, e o `.dmg` do meu-bot.
- **Site de produção:** `curl -s https://agentesgrok.com/download/mac.json` → `versao` = `<v>`, `nome`
  `meu-bot-<v>-arm64.dmg`; `curl -sI https://agentesgrok.com/download/mac` → `location` para o `.dmg` (até 10 min).
- **Um app de verdade atualiza:** num meu-bot estável instalado de release neste Mac, Configurações › Sobre e
  atualização › **Atualizar agora**; no log dele (`~/Library/Application Support/meu-bot/meu-bot.log`),
  `preparar ok` e `trocar ok` para `<v>`. App empacotado aqui (build local) não serve: ele não troca.
- **Volta atrás automática:** no mesmo log, depois de abrir na `<v>`, nada de rollback (três aberturas sem ficar 30 s
  de pé fazem o app voltar sozinho para a anterior). Se aparecer, avise na hora.
- **Máquinas:** na abertura seguinte do seletor, as máquinas sobem o backend e os plugins (log `[backend]`,
  `[finance]`, `[crm]` dos apps). Repita a conferência de `VERSION` da fase 1.
- **Pós-estável:** a PR da versão base e do CHANGELOG (skill `publicar`, passo 7) aberta.

Depende do usuário: nada, só avisar se alguém reclamar. Se a conferência falhar, diga o que falhou; o caminho de
emergência (release nova com a correção, ou a volta automática) está em "Quando algo não chega" da skill `publicar`.

## Ao responder

Uma tabela curta por fase (o que foi conferido, ✓/✗) e, por último, **o que depende do usuário agora** em uma linha.
