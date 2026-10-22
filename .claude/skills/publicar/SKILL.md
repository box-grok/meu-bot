---
name: publicar
description: Leva uma mudança do meu-bot (app, financeiro, CRM, backend) do desenvolvimento até o usuário final pelo caminho staging → estável, com releases assinadas. Use quando o usuário disser "publica", "solta no staging", "manda pro estável", "lança a versão", "faz a release", "aprovado, pode publicar", ou perguntar como uma mudança chega aos usuários.
---

# Publicar o meu-bot (staging → estável)

Como o Brave (Sparkle) e o Cursor: o app baixa a versão nova sozinho, só instala o que a chave da release assinou e o
usuário só reinicia. Detalhes em `docs/GUIA.md`, seção "Revisão no molde do Brave/Sparkle".

## A sequência

1. **Desenvolver e testar localmente**: `npm test`, depois a skill `rebuildar`. Os builds locais saem com a versão do
   `package.json` sem sufixo (ex.: `0.2.0`), que conta como mais nova que qualquer `0.2.0-staging.N` publicado: a
   release nunca sobrescreve o que está em desenvolvimento.
2. **Subir a versão do que muda na máquina da pessoa** (senão as máquinas nunca recebem a mudança, porque só
   atualizam para cima; o release recusa se você esquecer):
   - backend (`server.js`, `finance-api.js`, `licenca.js`… a lista é `COMPONENTES` em `src/main/backend-bundle-core.ts`)
     → `backend-colima/VERSION`;
   - plugin do financeiro → `backend-colima/finance/package.json`; CRM → `crm/package.json`; guarda → `guarda/package.json`.
3. **Commitar tudo**: o release exige árvore limpa e `gh` logado (`gh auth status`; se expirou, o usuário roda
   `! gh auth refresh -h github.com`).
4. **`npm run release:staging`**: publica a pre-release `v<versão>-staging.N` com os apps staging (meu-bot-staging,
   meu-bot-finance-staging), cada zip com o `.sig`. Os staging instalados a partir de release atualizam calados ao fechar.
5. **O usuário testa e aprova.** Não promova sem a aprovação explícita dele.
6. **`npm run release`** no MESMO commit (ele recusa se o HEAD não tiver a tag `-staging.N` dessa versão): publica
   `v<versão>` com o meu-bot e o meu-bot-admin. Os apps dos usuários baixam, verificam a assinatura e mostram
   "Reiniciar e atualizar" (ou aplicam ao fechar). Na abertura seguinte, o seletor atualiza o backend (só ocioso)
   e os plugins de cada máquina.
7. **Subir a versão base** para a próxima estável (`npm version minor --no-git-tag-version`), commitar e dar push.

## Regras

- Nunca reescrever (rebase/amend/split) um commit que já tem tag de release publicada: a tag ficaria fora do
  histórico e a promoção para o estável quebraria.
- A chave privada da release fica em `~/.config/meu-bot/release-ed25519.pem` (criada por `npm run chave-release`;
  a pública está em `UPDATE_PUBLIC_KEY`, `src/main/updater-core.ts`). Nunca commitar, nunca trocar sem combinar com
  o usuário: apps instalados com a pública antiga recusariam toda atualização nova.
- Publicar é público (`diegofornalha/meu-bot`) e definitivo: confirme a versão e o canal antes de rodar.
- Ao terminar, diga em pt-BR o link da release, o que cada canal recebe e o próximo passo.

## Quando algo não chega

- App não atualizou: o build instalado é local com versão maior (passo 1), a release não tem o `.sig`, ou a
  assinatura não confere (log `[atualização]` em `~/Library/Application Support/<app>/meu-bot.log`).
- Máquina não atualizou: a versão do componente não subiu, o backend estava ocupado (tenta na próxima sondagem) ou
  o instalador falhou (log `[backend]`/`[finance]` no mesmo arquivo).
- Versão nova não abre: depois de 3 aberturas sem ficar 30 s de pé, o app volta sozinho para a anterior.
