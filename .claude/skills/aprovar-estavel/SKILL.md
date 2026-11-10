---
name: aprovar-estavel
description: Painel das três fases do staging à estável do meu-bot — 1) o staging está no ar e saudável, 2) a estável passa em todas as recusas (npm run release -- --conferir), 3) depois de publicada, chegou certa às pessoas e às máquinas. Use quando o usuário perguntar "como está o staging?", "quando sai a estável?", "dá para subir a estável?", "posso aprovar?", "subiu certo?", ou disser "aprovado" querendo a estável antes das 24 h do agente automático.
---

# Aprovar a estável (as três fases)

**Quem publica:** normalmente o agente `scripts/release-auto.mjs` (launchd, a cada 10 min; skill `publicar`, "Caminho
normal"): staging 10 min depois do último merge, estável 24 h depois se o staging deste Mac confirmou a versão. Esta
skill é o painel: diz em que fase está, o que já foi conferido e o que falta; e, com o **"aprovado"** do usuário,
antecipa a estável pelo caminho manual. Responda em pt-BR, com uma tabela por fase e, no fim, **o que depende do
usuário agora** numa linha.

Comece sempre por: `git fetch origin --tags` e, num worktree no `origin/main` com `node_modules`:
`node scripts/release-auto.mjs --check` (decisão da vez: aguardar, staging, promover, subir-base; e se o agente está
instalado) e `tail -20 ~/Library/Logs/meu-bot-release.log` (o que ele fez por último). `<v>` = a staging candidata
(`v<base>-staging.N`, a mais nova em `gh release list -R diegofornalha/meu-bot --limit 5`).

## Fase 1: o staging está no ar e saudável

- **Release completa:** `gh release view <tag> -R diegofornalha/meu-bot --json isDraft,assets` → não é draft;
  `.zip` + `.zip.sig` de meu-bot-staging e meu-bot-finance-staging, e o `.dmg` do meu-bot-staging.
- **Site de staging:** `curl -s https://site-staging.agentesgrok.com/download/mac.json` → `versao` da `<tag>`, `nome`
  `.dmg` (até 10 min de cache).
- **Saúde neste Mac:** `node scripts/release-saude.mjs <versão>` → `✓ … confirmada neste Mac`. É a mesma prova que o
  agente usa para promover: o meu-bot-staging **instalado da release** (o de `/Applications`; o de `~/Applications`
  feito pelo rebuild é build local e não serve) recebeu a versão e ficou de pé. `✗ ainda não confirmou`: abra o
  `/Applications/meu-bot-staging.app` (o agente também o abre escondido) e espere; `voltou para a anterior`: pare e
  investigue o log `[atualização]` de `~/Library/Application Support/meu-bot-staging/meu-bot.log`.
- **Máquinas:** para cada `Host suporte-*` de `~/.ssh/meu-bot-suporte.conf` (menos o este Mac, que não tem backend de
  VM), `ssh -o BatchMode=yes <alias> 'cat ~/.local/share/meu-bot/backend/VERSION'` igual a
  `git show <tag>:backend-colima/VERSION`.
- **Escopo:** `git log --oneline --first-parent v<estável anterior>..<tag>` (o que a estável leva) e
  `git log --oneline --first-parent <tag>..origin/main` (o que ficou de fora: o agente solta um staging novo e
  recomeça as 24 h).

Depende do usuário (opcional): o roteiro de dez minutos de [`docs/ROTEIRO-upgrade.md`](../../../docs/ROTEIRO-upgrade.md)
para o que a prova automática não encena (instalar por cima, preferências e abas, volta atrás matando no meio).

## Fase 2: a estável passa em todas as recusas

Antes de qualquer promoção manual (e para responder "dá para subir?"), num worktree **no commit da `<tag>`**:
`git worktree add --detach ../meu-bot-promover <tag>` com `node_modules` (symlink do checkout principal), o `build/`
inteiro (inclui `build/suporte`) e `config/google-*.json` copiados (skill `contribuir`). Nunca use o
`../meu-bot-release` (é do agente). Lá:

```
npm test
npm run release -- --conferir
```

O `--conferir` roda tudo o que o `npm run release` recusaria e sai antes de empacotar, sem tag nem release: árvore
limpa, `gh` logado, `v<base>` livre, **o commit tem a tag `-staging.N`**, a chave no Chaveiro (o macOS pode pedir
aprovação), as versões dos componentes da máquina e `build/suporte` para o admin. Termina em `✓ conferido: v<base>
pode sair do commit …. Nada foi publicado.` Um `✗` para tudo: mostre a linha e o que fazer.

**Antecipar a estável** (antes das 24 h): só com o **"aprovado"** explícito do usuário, fase 1 com saúde ✓ e fase 2
✓. Aí `npm run release` no mesmo worktree, o deploy do site se `conta-api/` mudou (skill `publicar-site`) e a PR da
base (skill `publicar`, passo 7). O agente vê a `v<base>` publicada e passa a cuidar só da subida da base.

## Fase 3: a estável chegou certa

- **Release:** `gh release view v<base> -R diegofornalha/meu-bot --json isPrerelease,assets` → não é pre-release;
  `.zip` + `.zip.sig` do meu-bot e dos admins, `.dmg` do meu-bot.
- **Site de produção:** `curl -s https://agentesgrok.com/download/mac.json` → `versao` `<base>`, `nome`
  `meu-bot-<base>-arm64.dmg` (até 10 min).
- **Um app de verdade atualiza:** um meu-bot estável instalado de release (não build local): Configurações › Sobre e
  atualização › **Atualizar agora**; no log dele, `[atualização] <base> confirmada` e nenhum
  `não passou das primeiras aberturas` (a volta automática).
- **Máquinas:** repita a conferência de `VERSION` da fase 1 depois da abertura seguinte do seletor.
- **Base:** a PR "Versão: base sobe" existe (o agente abre e mergeia; no caminho manual, você).

Depende do usuário: nada, só avisar se alguém reclamar.
