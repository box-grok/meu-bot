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
