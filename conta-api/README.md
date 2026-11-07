# conta-api

Um Worker só para a conta meu-bot: a API (`conta.agentesgrok.com`), a página de login (`auth.agentesgrok.com`) e o
console da conta (`console.agentesgrok.com/account/…`). O `wrangler.toml` descreve os dois ambientes (produção e
`--env staging`), os secrets e as vars; os comandos estão no `package.json` (`npm test`, `npm run dev`, `migrar`,
`deploy`).

## Chave Web do Firebase (projeto `meu-bot-conta`)

A chave em `FIREBASE_API_KEY` (a "Browser key (auto created by Firebase)" do Google Cloud) é **pública por desenho**:
ela vai para o navegador em `/config.js` e a página de login a usa para falar com o Firebase Auth. O que a protege
não é o segredo, e sim a restrição no Google Cloud (APIs e serviços › Credenciais), aplicada em 7 nov 2026:

- **Referers aceitos:** `auth.agentesgrok.com`, `auth-staging.agentesgrok.com`, `meu-bot-conta.firebaseapp.com`,
  `meu-bot-conta.web.app` e `localhost`.
- **APIs aceitas:** só Identity Toolkit e Token Service (antes aceitava 27 APIs de qualquer origem).

Com isso, a chave sem referer ou com referer de outro site recebe 403; da página de login, 200. O app desktop nunca
chama o Firebase: o login acontece na página do navegador e volta ao app por deep link, então a restrição não muda
nada do fluxo da conta.

O que isso exige de quem mexer aqui:

- **Domínio de login novo** (outra variante, outro ambiente): acrescente o referer na restrição *antes* de publicar;
  sem ele, a página abre, mas o login responde 403.
- **Chave recriada ou "renovada" no console do Firebase:** ela nasce sem restrição; aplique a mesma lista de novo e
  troque o valor nas vars dos dois ambientes.
- **Alerta de "secret exposto" do GitHub apontando para esta chave:** é falso positivo (chave Web, restrita); feche
  com essa justificativa, como foi feito no fork `box-grok/meu-bot`.
- Se o Google recusar a mudança alegando "uso de outra API nos últimos 7 dias", confira se foi um teste seu (um
  `curl` de geocoding, por exemplo) e aplique com o override.
- **O Worker também usa a chave**, em `POST /conta/senha` (`accounts:sendOobCode`, o e-mail de criar/redefinir senha):
  como a restrição é por referer, esse `fetch` manda `Referer: https://<FIREBASE_AUTH_DOMAIN>/`. Se a lista de referers
  mudar, esse host precisa continuar nela.
- **Senha** (console › Perfil › Login e segurança › "Criar senha") exige o provedor **E-mail/senha** ativado em
  Authentication › Sign-in method do projeto; sem ele o Firebase responde `OPERATION_NOT_ALLOWED` e o console avisa.
- **O super admin define a senha de alguém** (console › Plano › Mudar › Senha) pela conta de serviço do projeto
  (`firebase-adminsdk-fbsvc@meu-bot-conta.iam.gserviceaccount.com`): o JSON da chave fica no secret
  `FIREBASE_ADMIN_SA` (staging e produção), nunca no repositório. A organização agentesgrok.com proíbe criar chaves
  de conta de serviço; no projeto `meu-bot-conta` as duas restrições (`iam.disableServiceAccountKeyCreation` e
  `iam.managed.disableServiceAccountKeyCreation`) foram sobrescritas para "não aplicada" em 7 nov 2026, só para
  esse projeto. Para trocar a chave: IAM › Contas de serviço › firebase-adminsdk › Chaves › Adicionar chave (JSON),
  `wrangler secret put FIREBASE_ADMIN_SA [--env staging] < arquivo.json`, apagar o arquivo e a chave antiga.

## Organizações (molde Rambox Enterprise)

`console.agentesgrok.com/organizations/<slug>/members` e `/settings`. Qualquer conta cria uma organização (`POST /orgs`
`{nome, slug}`) e vira a **dona**; convida por e-mail (`POST /orgs/:slug/membros` `{email, papel: admin|membro}`). Não há
envio de e-mail: o convite é o e-mail cadastrado, e o console dá o link para a pessoa; quando aquele e-mail entra (Google
ou link por e-mail), `aceitarConvites` no `POST /sessao` liga a conta e o membro vira ativo. Papéis: dona (tudo, inclusive
apagar e promover), admin (convida, remove e muda entre admin↔membro), membro (vê). A organização precisa de pelo menos
uma dona; uma dona não apaga a própria conta (`DELETE /conta` → 403) sem passar o bastão. **Assentos** (ativos +
convidados) começam em 5 e só o super admin muda (`PATCH /admin/orgs/:slug` `{assentos}`); `dominio_email` restringe os
convites a um domínio. Quem não é membro recebe 404 em tudo (a organização não existe para quem está fora); o super admin
vê todas (`GET /admin/visao` → `orgs`; console › Todas as organizações). Slugs seguem `SLUG_RE` e a lista
`SLUGS_RESERVADOS` (hosts nossos, `www`, `api`…), porque na próxima versão `<slug>.agentesgrok.com` abre o console da
organização (`slugDoHost` já existe; falta o registro `*` no DNS e a rota curinga). Apagar é soft delete: o slug vira
`apagada:<id>:<slug>` e continua reservado. Depois: times com permissões por área, login com a cara da empresa, plano
Enterprise com assentos cobrados.
