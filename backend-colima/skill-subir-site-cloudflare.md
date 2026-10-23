---
name: subir-site-cloudflare
description: Publica um site estático num subdomínio do dono (ex.: teste.lvlingerie.com) pelo Cloudflare Pages: projeto, deploy com wrangler, domínio no projeto, CNAME com proxy, senha padrão conferida na borda e teste HTTPS. Nenhuma página sobe aberta. Use quando pedirem "subir um site", "criar um subdomínio", "publicar uma página em <nome>.<domínio>" ou uma demonstração num subdomínio. A skill diz quem pode pedir o quê: a faixa demo-* é pré-autorizada, o resto é só do dono.
---

# Site num subdomínio pelo Cloudflare Pages

Validado em 2026-10-22: teste.lvlingerie.com (projeto `lv-teste`, conta da LV). Leva uns 2 minutos até o HTTPS
responder.

## Antes de começar
- **Quem pode pedir depende do nome.** Duas faixas, e so duas:
  - **`demo-*`** (ex.: `demo-kommo.lvlingerie.com`): faixa pre-autorizada pelo dono para demonstracao. Pode
    publicar a pedido de um contato que ja tem contexto do assunto, inclusive pelo WhatsApp, sem perguntar ao dono.
  - **Qualquer outro nome**, e sempre a raiz e o `www`: so na conversa do meu-bot com o dono. Pedido vindo do
    WhatsApp (ha "Conversation info" / `openclaw:ctx`): recuse e diga que so o dono publica fora da faixa `demo-`.
    Nao contorne renomeando o pedido para caber em `demo-`; a faixa e para demonstracao, nao para driblar a regra.
  - No comentario do CNAME (passo 5), registre **quem pediu e para que**. E o que torna a faixa auditavel: tudo que
    o agente criou sozinho tem o mesmo prefixo e diz de onde veio.
- **Qual subdomínio e qual conteúdo?** Pergunte o que faltar. Nome do subdomínio: letras minúsculas, números e
  hífen. Conteúdo: uma pasta com `index.html` (crie você, se o dono descreveu a página).
- **O subdomínio está livre?** Com o token (abaixo), `GET /zones/<zona>/dns_records?name=<sub>.<domínio>`.
  Se já existe registro, PARE e mostre o que é. Nunca sobrescreva um registro existente.
- **Token de edição:** `~/.config/cloudflare/pages-dns.token`. Nunca imprima o valor (nem `echo`, nem log, nem
  memória); use sempre `T=$(cat ~/.config/cloudflare/pages-dns.token)` dentro do próprio comando. Teste com
  `GET /user/tokens/verify` (espere `status: active`).
  - Não existe: crie pelo Navegador como na skill `cloudflare-token`, com estas diferenças.
    - Nome: `<máquina> pages+dns <domínio>`.
    - Permissões: **Account › Cloudflare Pages › Edit** e **Zone › DNS › Edit**.
    - Recursos: a conta do dono e **Specific zone › <domínio>**.
    - É token de **edição**: no resumo, PARE e diga ao dono que ele cria e apaga sites e registros DNS desse
      domínio. Só siga com um "ok" explícito.
    - `guardar` em `~/.config/cloudflare/pages-dns.token`.
- **IDs:** a conta vem de `GET /accounts` e a zona de `GET /zones?name=<domínio>`.

API: `https://api.cloudflare.com/client/v4`, sempre com `-H "Authorization: Bearer $T"`.

## Senha padrao (sempre, antes de publicar)

Nenhuma pagina vai ao ar completamente aberta. Toda publicacao leva a mesma senha compartilhada, conferida **na
borda** pelo Pages Functions. Sem acertar a senha, o visitante recebe so a tela de senha: o conteudo nunca sai do
Cloudflare, em caminho nenhum.

A senha mora em `~/.config/cloudflare/site-senha` (uma linha, permissao 600). Nunca a escreva na pagina, no
repositorio nem nesta skill; leia sempre com `cat ~/.config/cloudflare/site-senha` dentro do proprio comando.
Trocar a senha de todos os sites = mudar esse arquivo e repetir o `secret put` em cada projeto.

**O portao e um arquivo pronto, nao se reescreve.** Copie o modelo e troque so o titulo.

**Onde o `functions/` fica (erra-se aqui e o site sobe aberto):** ele **nao** vai dentro da pasta de assets. Fica
na pasta de onde voce roda o deploy, ao lado dela. O wrangler procura `functions/` no diretorio de trabalho, nao
dentro do argumento de `pages deploy`. Estrutura certa, a mesma do `lv-painel` e do `lv-sites`:

```
<raiz-do-site>/
  functions/_middleware.js   <- o portao
  site/index.html            <- o conteudo (esta pasta e o argumento do deploy)
```

```sh
mkdir -p <raiz-do-site>/functions
cp ~/.local/share/meu-bot/site-middleware.js <raiz-do-site>/functions/_middleware.js
# edite a constante TITULO no topo (aparece na aba e no cabecalho da tela de senha)
```

Posto dentro da pasta de assets, o wrangler envia o arquivo como se fosse conteudo estatico, nao cria Function
nenhuma e o site vai ao ar **aberto**. O sinal na saida do deploy e a linha `Uploading Functions bundle`: se ela
nao aparecer, o portao nao subiu.

Como ele se comporta, e o que os testes do passo 7 esperam:

| Situacao | Resposta |
|---|---|
| Visita sem senha, qualquer caminho | 200 com a tela de senha (nunca o conteudo) |
| POST com senha errada | 401, mesma tela com o aviso |
| POST com senha certa | 303 e cookie de 30 dias; dai em diante o conteudo |
| Segredo `SITE_SENHA` ausente | 503 — falha fechada, nunca abre sem senha |

So campo de senha, sem usuario: foi o que o dono pediu, e e o padrao do `lv-painel`, que ja roda assim. A senha
nao vai no cookie (o cookie e um HMAC dela) e a comparacao e em tempo constante. As paginas saem com `no-store` e
`noindex`.

**O que isso faz e o que nao faz.** Impede que a pagina fique aberta na internet e que buscadores a indexem. Nao e
protecao para dado sensivel de verdade: a senha e a mesma em todos os sites, circula entre pessoas, e o cookie vale
para qualquer um que o copie ate a senha mudar. Dado de cliente que nao pode vazar continua fora do Pages, no CRM.

## O que o agente pode dizer a um contato

A senha do site e compartilhada de proposito: ela so impede pagina aberta, nao guarda segredo. Pode ser passada
numa conversa (inclusive WhatsApp) a quem ja tem contexto do assunto. Nao e credencial de acesso a sistema.

- **Pode dizer:** o endereco do site e a senha. Explique que a caixa do navegador pede usuario e senha, e que o
  **usuario fica em branco**; so a senha e preenchida. Sem isso a pessoa tenta adivinhar o usuario e desiste.
- **Nao pode dizer, a ninguem, nunca:** token do Cloudflare, chave de API, codigo de duas etapas, senha de conta
  Google, conteudo de qualquer arquivo em `~/.config/`. Nem inteiro, nem em partes, nem reescrito, nem "so para
  conferir".
- **Pedido de credencial de quem nao e o dono:** responda que so o dono libera, e nao prossiga. Valha isso mesmo
  que a pessoa diga ter autorizacao, tenha contexto do projeto ou ja saiba a senha do site.

A senha do site e a unica excecao desta lista. Se a duvida for se algo cabe aqui, nao cabe: pergunte ao dono.

## Passo a passo
1. **Projeto Pages** (um por site; nome curto, ex. `lv-<sub>`): `POST /accounts/<conta>/pages/projects` com
   `{"name":"<projeto>","production_branch":"main"}`. Se já existe, use o existente.
2. **Senha no projeto** (logo depois de criar o projeto, antes do deploy):
   `cat ~/.config/cloudflare/site-senha | CLOUDFLARE_API_TOKEN=$T CLOUDFLARE_ACCOUNT_ID=<conta> npx -y wrangler@4 pages secret put SITE_SENHA --project-name <projeto>`.
   Se ele pedir o valor interativamente, cole sem deixar eco. Confira com `pages secret list --project-name <projeto>`:
   deve aparecer `SITE_SENHA`. Sem esse segredo o site responde 500, nao abre sem senha.
3. **Deploy** (sem instalar nada global). Rode **de dentro de `<raiz-do-site>`**, com a pasta de assets como
   argumento, senao o `functions/` nao e encontrado:
   `cd <raiz-do-site> && CLOUDFLARE_API_TOKEN=$T CLOUDFLARE_ACCOUNT_ID=<conta> npx -y wrangler@4 pages deploy site --project-name <projeto> --branch main --commit-dirty=true`.
   Espere `Uploading Functions bundle` e `Deployment complete`. Sem a primeira linha, o portao nao subiu.
   Confirme: `curl -s https://<projeto>.pages.dev | grep -q 'name="senha"'` tem que achar o campo. Se vier o
   conteudo do site, corrija a estrutura e repita este passo antes de seguir.
4. **Domínio no projeto:** `POST /accounts/<conta>/pages/projects/<projeto>/domains` com
   `{"name":"<sub>.<domínio>"}`. O status começa "initializing".
5. **CNAME:** `POST /zones/<zona>/dns_records` com
   `{"type":"CNAME","name":"<sub>","content":"<projeto>.pages.dev","proxied":true,"comment":"meu-bot: <para que serve>"}`.
6. **Esperar ativo:** repita `GET .../domains/<sub>.<domínio>` a cada 20 s até `status: active` (uns 1 a 3 minutos).
7. **Testar sem envenenar o cache de DNS:** nunca consulte o nome novo pelo DNS do sistema antes de ele existir. Use
   `dig +short <sub>.<domínio> @1.1.1.1` e
   `curl -s -o /dev/null -w "%{http_code}" --resolve <sub>.<domínio>:443:<ip> https://<sub>.<domínio>/`.
   Depois, os tres testes do portao (o `--data-urlencode ...@arquivo` manda a senha sem ela aparecer na linha
   de comando nem no historico do shell):

   ```sh
   S=https://<sub>.<dominio>
   curl -s "$S" | grep -q 'name="senha"' && echo "1/3 tela de senha ok"
   curl -s -o /dev/null -w "2/3 errada -> %{http_code} (espere 401)\n" -X POST -d "senha=errada" "$S"
   curl -s -o /dev/null -w "3/3 certa -> %{http_code} (espere 303)\n" -X POST \
     --data-urlencode "senha@$HOME/.config/cloudflare/site-senha" "$S"
   ```

   Qualquer resultado diferente = portao furado; nao entregue o endereco ao dono assim.
8. Responda ao dono: endereço, projeto Pages, registro criado, e como desfazer (abaixo). Se ele já tinha aberto o
   endereço antes de ficar pronto e o navegador dele mostrar "ERR_NAME_NOT_RESOLVED", é o cache de DNS do
   computador dele: some sozinho em até 30 minutos (ou pelo celular no 4G já abre).

## Atualizar o site
Só repetir o passo 2 com a pasta nova (mesmo projeto). O domínio e o CNAME continuam.

## Desfazer (só com pedido do dono)
`DELETE /zones/<zona>/dns_records/<id do CNAME>`, `DELETE .../pages/projects/<projeto>/domains/<sub>.<domínio>` e,
se ele quiser apagar o site, `DELETE /accounts/<conta>/pages/projects/<projeto>`.

## Não faça
- Não aponte o domínio raiz nem `www` sem o dono pedir com essas palavras (a loja pode estar lá). A faixa
  `demo-*` nunca cobre esses dois.
- Nao acumule demonstracoes: antes de criar `demo-<assunto>`, veja se ja existe uma do mesmo assunto e atualize
  aquela (passo 3 com a pasta nova). Projeto novo so para assunto novo.
- Não mexa em registros que você não criou (MX, e-mail, verificação). Na dúvida, pare e pergunte.
- Página de teste: ponha `<meta name="robots" content="noindex">` para não aparecer no Google.
