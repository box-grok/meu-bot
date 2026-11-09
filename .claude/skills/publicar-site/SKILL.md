---
name: publicar-site
description: Publica o Worker conta-api (site agentesgrok.com, login, console e API da conta) no Cloudflare, em staging ou produção, e confere no ar. Use quando o usuário disser "publica o site", "sobe o site", "deploy do Worker", "atualiza o site de staging", "manda o site pra produção", quando uma PR que mexe em conta-api/ entrar no main, ou quando o site mostrar algo velho (versão, página) que o main já corrigiu.
---

# Publicar o site (Worker conta-api)

Um Worker só serve `agentesgrok.com` (site), `auth.`, `console.` e `conta.` (API); o de staging serve os mesmos com
`-staging` (`site-staging.agentesgrok.com` …). Merge no `main` **não publica**: sem deploy, o ar fica com o código
antigo. O app (`npm run release…`) é outra coisa: ver skill `publicar`.

## Antes

- **Login no Cloudflare:** `cd conta-api && npx wrangler whoami`. Sem login, peça ao usuário para rodar no prompt
  `! cd <worktree>/conta-api && npx wrangler login` e clicar em **Allow** no navegador (conta que tem o agentesgrok.com).
- **De onde publicar:** de um worktree no `origin/main` atual, nunca do checkout principal (outras sessões o usam) e
  nunca de um branch para produção:
  `git fetch origin && git worktree add --detach ../meu-bot-site-deploy origin/main` (se já existe:
  `git -C ../meu-bot-site-deploy checkout -q --detach origin/main`). Para mostrar um branch no **staging** antes do
  merge, publique de dentro do worktree do branch e avise que o próximo deploy do `main` passa por cima.
- `conta-api/node_modules` não vem no worktree: `npm ci` dentro de `conta-api` (symlink não serve: o checkout principal
  costuma não ter).

## A sequência

1. **Testes:** `npm test` em `conta-api`. Quebrou: pare e mostre.
2. **Migrações:** se `conta-api/migrations/` mudou desde o último deploy, `npm run migrar:staging` (e depois
   `npm run migrar` para produção) antes do deploy.
3. **Staging:** `npm run deploy:staging`. A saída lista os domínios e o `Current Version ID`.
4. **Conferir o staging no ar** (o que mudou, mais o básico):
   - `curl -s https://conta-staging.agentesgrok.com/health` → `{"ok":true,"canal":"staging"}`
   - `curl -s https://site-staging.agentesgrok.com/download/mac.json` → a pre-release de staging mais nova
     (`meu-bot-staging-…zip`; cai na estável se não houver)
   - `curl -s -o /dev/null -w '%{http_code}' https://site-staging.agentesgrok.com/obrigado` → 200
   - `curl -s https://site-staging.agentesgrok.com/robots.txt` → `Disallow: /` (staging fica fora dos buscadores)
5. **Produção só com o "pode" do usuário** (é o site público): `npm run deploy`, e as mesmas conferências sem
   `-staging`: `/health` com `"canal":"producao"`, `/download/mac.json` com a **estável** mais nova
   (`/releases/latest`), `robots.txt`, `sitemap.xml` e `llms.txt` com 200.

## Ao terminar

Diga em pt-BR, em poucas linhas: o ambiente publicado, o commit (`git -C ../meu-bot-site-deploy log -1 --oneline`), o
Version ID e o que foi conferido no ar. Se publicou de um branch, lembre que o merge precisa de outro deploy.

## Regras

- O download do site lê o GitHub com cache de 10 min no edge: release nova aparece sozinha, sem deploy.
- Rollback: `npx wrangler rollback [--env staging]` volta ao deploy anterior; use se a conferência falhar e avise.
- Não mexa em secrets (`wrangler secret put`) nem em vars do `wrangler.toml` sem o usuário pedir (README do conta-api).
