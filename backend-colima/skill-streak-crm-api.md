---
name: streak-crm-api
description: "Mexer no Streak CRM pela API (sem navegador) com o streak.mjs do meu-bot: achar/criar/atualizar boxes, campos, comentários e contatos do pipeline configurado. Use quando o pedido envolver o CRM e a máquina tiver ~/.local/share/meu-bot/crm/streak.mjs."
---

# Streak CRM pela API (meu-bot · CRM pelo WhatsApp)

Ferramenta: `node ~/.local/share/meu-bot/crm/streak.mjs <subcomando>` (devolve JSON numa linha; erro = `{"erro":…}`).
A chave da API e o pipeline ficam em `~/.local/share/meu-bot/crm.json` (nunca leia nem mostre a chave).

## Subcomandos
- `diag` · `pipelines` · `pipeline` (etapas e campos, com as opções das listas)
- `box-find --phone +595…` | `--name "Junior"` | `--query "kommo"` → boxes (com os últimos comentários quando acha um só)
- `box-create --name "Fulano" --stage "Prospecção de parceiros" [--notes "…"] [--phone +N]`
- `box-update <boxKey> [--name "…"] [--notes "…"] [--stage "Etapa"]`
- `field-set <boxKey> "Origem" "Redes sociais"` (listas pelo nome da opção; datas dd/mm/aaaa; números)
- `comment <boxKey> "16/10: pediu os links do Kommo; fecha depois do fim de semana"`
- `contact-upsert --phone +N --name "Nome Sobrenome" [--email e] --box <boxKey>` (cria/acha o contato e vincula)
- `telefone-set +N <boxKey>` (lembra que o telefone é desse box)
- `box-find --email fulano@x.com` | `--email @dominio` (contatos, threads vinculadas e notas)
- `threads <boxKey>` (conversas do Gmail já no box) · `thread-add <boxKey> <threadGmailId>` (vincula uma conversa;
  o id é o hexadecimal `data-legacy-thread-id` da linha no Gmail; uma conversa só pode estar em um box)

## Como agir
1. Sempre comece por `box-find --phone` (telefone do WhatsApp); sem resultado, `--name`.
2. Antes de anotar, leia os `comentarios` do box para não repetir.
3. Anotações de conversa vão em `comment` (data + fato + próximo passo), não em `notes` (notes é a ficha fixa).
4. Criar box, mudar etapa e campos de lista: só com o dono confirmando (no fluxo automático, proponha no bloco
   `crm-json`; se o dono pediu explicitamente, faça).
5. Nunca invente valores; o que a conversa não disse fica em branco.
6. Assunto que não cabe no pipeline configurado (ex.: e-mails de inscrição, cobranças, um cliente quando o
   pipeline é de parceiros): não encaixe. Liste os `pipelines`, proponha 2 ou 3 saídas (pipeline próprio para
   aquele assunto, só anotar sem CRM, ou o configurado se a pessoa confirmar que é isso) com a sua recomendação,
   e espere. Criar pipeline novo só com o dono confirmando.
7. Este streak.mjs é do meu-bot: não o edite nem acrescente subcomandos por conta própria. Se faltar uma ação
   (ex.: criar um pipeline), diga à pessoa o que falta para ela pedir no app. Pipeline novo se cria pelo Gmail,
   no Navegador (Streak › novo pipeline), com a pessoa vendo e confirmando.

## Fluxo automático (plugin meu-bot-crm)
O job `crm-job.mjs` chama você com a conversa nova e espera no fim um bloco:
```crm-json
{"aplicado":["…"],"propostas":[{"acao":"box-update","args":["<boxKey>","--stage","Qualificação do perfil"],"texto":"mover Junior para Qualificação do perfil"}],"resumo":"…"}
```
`acao` ∈ box-create | box-update | field-set | comment | contact-upsert; `args` são os argumentos exatos do subcomando.
