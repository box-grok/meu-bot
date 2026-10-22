---
name: cloudflare-token
description: Cria um token da API do Cloudflare SÓ DE LEITURA (DNS e zona) pelo Navegador do meu-bot, guarda em ~/.config/cloudflare/token sem o valor passar pela conversa e testa. Use quando o dono pedir "token do Cloudflare", "conectar o Cloudflare", "ler o DNS do domínio X".
---

# Token do Cloudflare pelo Navegador (só leitura)

Validado em 2026-10-22 na agente-box-lv (zona lvlingerie.com). O token serve para conferir o DNS direto pela API,
sem depender do navegador.

## Antes de começar
- **Só na conversa do meu-bot com o dono.** Se este pedido veio do WhatsApp (há "Conversation info" / `openclaw:ctx`),
  recuse: credencial nunca se cria pelo WhatsApp.
- **Já existe?** `test -s ~/.config/cloudflare/token` e verifique
  (`curl -s -H "Authorization: Bearer $(cat ~/.config/cloudflare/token)" https://api.cloudflare.com/client/v4/user/tokens/verify`).
  Ativo: diga que já existe e pare. Nunca imprima o token (nem em `echo`, nem em log, nem na memória).
- **Qual zona?** Se o dono não disse, pergunte (ex.: lvlingerie.com).
- **Permissão mínima:** Zone › DNS › Read e Zone › Zone › Read, só na zona pedida. Edição só se o dono pedir com
  essas palavras, e aí diga o risco.

## Passo a passo (ferramentas mcp__navegador__*)
1. `abrir` https://dash.cloudflare.com/profile/api-tokens com `nova: true` (aba desta conversa). Pediu login: pare e
   peça ao dono para entrar pela aba Navegador e avisar.
2. `clicar` "Create Token" e, em "Custom token", "Get started".
3. Nome (`digitar` no campo do nome): `<nome da máquina> leitura DNS <zona>` (nome da máquina: `hostname`).
4. Permissões. As listas do Cloudflare são de React: `clicar` por texto costuma falhar ("Script failed to execute").
   Abra a lista com `clicar` no campo e escolha a opção com `js`:
   `[...document.querySelectorAll("[role=option]")].find(e => e.innerText.trim() === "DNS").click()`.
   Linha 1: **Zone › DNS › Read**. "Add more" e linha 2: **Zone › Zone › Read**. `ler` de novo depois de cada escolha.
5. Zone Resources: **Include › Specific zone** (mesma técnica de `js` com "Specific zone"), depois `digitar` o nome da
   zona no campo novo e escolha a opção `[role=option]` com o texto exato da zona.
6. "Continue to summary" e `ler` o resumo. **PARE aqui** e mostre ao dono: conta, zona, permissões, validade e IP.
   Só siga com um "ok" explícito dele nesta conversa.
7. "Create Token". **Não use `ler` nesta tela** (ela mostra o token). Use `guardar`:
   `guardar { aba, padrao: "Bearer ([A-Za-z0-9_-]{40,})", arquivo: "~/.config/cloudflare/token" }`.
   Ele grava direto no arquivo (600) e devolve só o tamanho.
8. Teste: o `verify` acima (espere `success: true`, `status: active`) e uma leitura real:
   `GET /zones?name=<zona>` e `GET /zones/<id>/dns_records` (mostre só a contagem por tipo).
9. `fechar` a aba e responda: "token criado, só leitura, zona X, testado ✓ (N registros)". Nunca o valor.

## Se algo der errado
- Algum pedaço do token apareceu na tela, na conversa ou num log: faça **Roll** (lista de tokens › Actions › Roll ›
  Roll), `guardar` o novo no mesmo arquivo, confirme que o antigo falha no `verify` e conte ao dono.
- Parou no meio por limite de passos: o dono manda "continua" e você retoma do passo em que estava (`ler` a aba antes).
