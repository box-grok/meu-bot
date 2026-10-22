---
name: subir-site-cloudflare
description: Publica um site estático num subdomínio do dono (ex.: teste.lvlingerie.com) pelo Cloudflare Pages: projeto, deploy com wrangler, domínio no projeto, CNAME com proxy e teste HTTPS. Use quando o dono pedir "subir um site", "criar um subdomínio", "publicar uma página em <nome>.<domínio>".
---

# Site num subdomínio pelo Cloudflare Pages

Validado em 2026-10-22: teste.lvlingerie.com (projeto `lv-teste`, conta da LV). Leva uns 2 minutos até o HTTPS
responder.

## Antes de começar
- **Só na conversa do meu-bot com o dono.** Pedido vindo do WhatsApp (há "Conversation info" / `openclaw:ctx`):
  recuse. Publicar algo no domínio dele é decisão dele, no computador.
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

## Passo a passo
1. **Projeto Pages** (um por site; nome curto, ex. `lv-<sub>`): `POST /accounts/<conta>/pages/projects` com
   `{"name":"<projeto>","production_branch":"main"}`. Se já existe, use o existente.
2. **Deploy** (sem instalar nada global):
   `CLOUDFLARE_API_TOKEN=$T CLOUDFLARE_ACCOUNT_ID=<conta> npx -y wrangler@4 pages deploy <pasta> --project-name <projeto> --branch main --commit-dirty=true`.
   Espere "Deployment complete" e confira `https://<projeto>.pages.dev` (HTTP 200).
3. **Domínio no projeto:** `POST /accounts/<conta>/pages/projects/<projeto>/domains` com
   `{"name":"<sub>.<domínio>"}`. O status começa "initializing".
4. **CNAME:** `POST /zones/<zona>/dns_records` com
   `{"type":"CNAME","name":"<sub>","content":"<projeto>.pages.dev","proxied":true,"comment":"meu-bot: <para que serve>"}`.
5. **Esperar ativo:** repita `GET .../domains/<sub>.<domínio>` a cada 20 s até `status: active` (uns 1 a 3 minutos).
6. **Testar sem envenenar o cache de DNS:** nunca consulte o nome novo pelo DNS do sistema antes de ele existir. Use
   `dig +short <sub>.<domínio> @1.1.1.1` e
   `curl -s -o /dev/null -w "%{http_code}" --resolve <sub>.<domínio>:443:<ip> https://<sub>.<domínio>/`.
   Espere 200.
7. Responda ao dono: endereço, projeto Pages, registro criado, e como desfazer (abaixo). Se ele já tinha aberto o
   endereço antes de ficar pronto e o navegador dele mostrar "ERR_NAME_NOT_RESOLVED", é o cache de DNS do
   computador dele: some sozinho em até 30 minutos (ou pelo celular no 4G já abre).

## Atualizar o site
Só repetir o passo 2 com a pasta nova (mesmo projeto). O domínio e o CNAME continuam.

## Desfazer (só com pedido do dono)
`DELETE /zones/<zona>/dns_records/<id do CNAME>`, `DELETE .../pages/projects/<projeto>/domains/<sub>.<domínio>` e,
se ele quiser apagar o site, `DELETE /accounts/<conta>/pages/projects/<projeto>`.

## Não faça
- Não aponte o domínio raiz nem `www` sem o dono pedir com essas palavras (a loja pode estar lá).
- Não mexa em registros que você não criou (MX, e-mail, verificação). Na dúvida, pare e pergunte.
- Página de teste: ponha `<meta name="robots" content="noindex">` para não aparecer no Google.
