# CRM

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## CRM: caminho real da chave da API do Streak (19 out 2026)

- O passo 3 do tutorial 10 dizia "Streak › Configurações › Integrações (API)". Verificado ao vivo no Gmail da
  `agente-box` (pelo agente com o Navegador) e na documentação do Streak: o botão do Streak na barra do Gmail abre
  um menu com "Integrações e Automações" (irmão de "Configurações"), e a chave fica em "Integrações personalizadas
  – Use nossa API" (criar/copiar). O texto do passo agora segue esses rótulos.

## CRM: o agente gera a chave da API do Streak (19 out 2026)

- Passo 3 do tutorial 10 ganhou "Pedir ao agente para gerar a chave" (só com o Navegador instalado): liga o
  Navegador para o agente e manda o pedido pronto (`CRM_KEY_PROMPT`). O agente segue a skill
  `streak-crm-navegador` (seção "Gerar a chave da API": botão do Streak › Integrações e Automações › Integrações
  personalizadas) e grava com `node ~/.local/share/meu-bot/crm/streak.mjs chave-set <chave>`.
- `chave-set` (streak.mjs): único subcomando que roda sem chave gravada; confere a chave em `/v1/users/me`
  antes de salvar (0600, merge) e responde `{ok, usuario}` sem repetir a chave.
- No app: a linha da ferramenta mascara `chave-set ••••`; ao chegar o resultado do Bash, `crmAfterAgentKey`
  consulta o CRM, testa a chave e `crmAutoPipeline` escolhe o pipeline sozinho quando a conta tem um só (também
  roda em todo `refreshCrm`). Com vários, a pessoa escolhe no app, como antes.
- Verificado localmente: `chave-set abc` recusa pelo formato; chave inválida é recusada pelo Streak (chamada real).
  Na `agente-box`: streak.mjs novo copiado e a seção da chave acrescentada à skill instalada (a instalação mantém
  a skill existente, então atualizações do bundle não chegam sozinhas a máquinas já instaladas).

## CRM → WhatsApp (contexto nas respostas)

O plugin `meu-bot-crm` do OpenClaw também faz o caminho de volta: antes de cada resposta a um contato numa conversa
direta, o hook `before_prompt_build` busca `GET /v1/crm/contexto?phone=+N` e põe no prompt (`prependContext`) só o
essencial da caixa dele: nome, pipeline, etapa, próximo passo e visão geral do resumo com IA. Anotações fixas,
registros e histórico ficam de fora (podem ter coisa interna). Cache de 60 s por telefone; sem caixa, backend fora
ou `crm.json` com `contextoWhatsapp: false` (`crm.mjs config --contexto-whatsapp false`), nada é acrescentado.

## Limpar histórico do WhatsApp guarda antes no CRM (meu-bot-crm)

No meu-bot-crm, "Limpar histórico" passa antes por "Guardando a conversa no CRM…" ("Excluir conversa" só tira
da lista, sem zerar o agente, então não precisa guardar): o app
lê a conversa só deste contato (até 1000 mensagens por sessão, também quando ela está na sessão principal),
monta o mesmo Markdown da exportação e manda para `POST /v1/crm/whatsapp/arquivar` pelo túnel
(`src/main/whatsapp-crm.ts`). O backend acha ou cria o contato pelo telefone, grava a transcrição como anexo da
caixa mais recente dele com um registro na linha do tempo (sem caixa: em `contato.arquivos`, baixável na página
do contato) e pede ao motor o resumo consolidado, que fica em `whatsapp.arquivo` (o `whatsapp.resumo` da
conversa atual, escrito pelo crm-job, recomeça). O mesmo texto duas vezes não duplica (sha256). Se guardar falhar,
a confirmação volta com o erro e os botões "Tentar de novo" e "Limpar sem guardar"; nunca limpa sozinho. Sem IA,
a transcrição fica e o aviso diz "resumo não atualizado". No meu-bot comum nada muda.

## Google Contatos → CRM (automático)

O meu-bot-crm traz os contatos do Google sozinho: na página Contatos, "Conectar Google Contatos" abre o login do
Google no navegador do Mac (só leitura, API People oficial, PKCE com retorno em 127.0.0.1). O refresh token fica
cifrado no Keychain (userData/google-contatos.bin). O app sincroniza 20 s depois de abrir, a cada 30 min e no
"Sincronizar agora": lê `people/me/connections` e manda para `POST /v1/crm/contacts/import` da máquina (acha por
id do Google, telefone ou e-mail; completa sem apagar; quem não mudou não é regravado). A ficha ganha
"Google Contatos ↗". Código: `src/main/google/` e as rotas locais `/v1/crm/google/*` do proxy da extensão.

Configuração única (o client OAuth do app, igual para todos os clientes):
1. console.cloud.google.com → criar projeto "meu-bot CRM".
2. APIs e serviços → Biblioteca → ativar **People API**.
3. Tela de consentimento OAuth → Externo; nome "meu-bot CRM", e-mail de suporte; escopos `contacts` e `drive.file`,
   `openid`, `email`. Em teste, adicione os e-mails que vão usar (até 100); para todos, publique (o Google pede
   verificação do app para o escopo de contatos; até lá aparece "app não verificado" no login).
4. Credenciais → Criar credenciais → ID do cliente OAuth → tipo **App para computador** → baixar o JSON.
5. Salvar como `config/google-oauth.json` (fora do git) e empacotar, ou copiar para
   `~/Library/Application Support/meu-bot-crm/google-oauth.json` para testar sem reinstalar.

### WhatsApp → Google Contatos

Todo número novo que conversa com o agente no WhatsApp vai para o Google Contatos, no marcador "WhatsApp" (decisão
de 2026-10-20; exige a permissão `contacts` com escrita, e o app pede "Reconectar" se a conexão for só leitura).
O plugin anota cada número em `crm/whatsapp-contatos.json`; `crm-job.mjs contatos-whatsapp` completa com as
conversas antigas e o nome do WhatsApp (do histórico); o backend expõe `GET /v1/crm/whatsapp/contatos`; a cada
sincronização o app cria no Google só os que ele ainda não tem (pelos 10 últimos dígitos) e guarda os criados em
userData/google-whatsapp.json para nunca duplicar.

## Caixa fixa do grupo no CRM ao limpar o histórico (23 out)

"Limpar histórico" de um grupo guarda a conversa no CRM antes, como a de um contato. Grupo não tem contato único,
então a conversa vai para **uma caixa fixa por grupo**, e o dono não escolhe numa lista (ela só cresce).

- **Dono da caixa é a máquina:** `POST /v1/crm/whatsapp/arquivar` com `grupo: { jid, nome }` acha a caixa pelo
  `fields.whatsappGrupo`; sem ela, abre uma no pipeline padrão, com o nome do grupo, na primeira etapa, já ligada
  (resposta `criada: true`, registro "📦 Caixa aberta para o grupo…"). Sem pipeline padrão responde 400 e nada é
  limpo. O app (`whatsapp-crm.ts` › `whatsappGroupArchiveToCrm`) só manda e conta o resultado; a fase "escolher",
  `boxKey`, `precisaCaixa` e a lista de caixas saíram.
- **Backend 1.0.2:** o `crm-api.js` com grupos tinha ficado em 1.0.0 nos servidores (a versão não subiu com a
  mudança), e o backend antigo respondia "telefone inválido" ao receber um grupo. A sondagem agora atualiza.

## Chave própria do agente no CRM e exclusão que pede (24 out)

O agente do WhatsApp usava a **mesma** `OPENAI_COMPAT_KEY` do app e declarava a própria identidade num cabeçalho
(`X-Crm-Por`) que nenhuma rota conferia. Em 23/10 ele esvaziou e apagou um pipeline inteiro por conta própria,
dirigido por mensagens de terceiro. Agora:

- **`CRM_AGENT_KEY`** no `.env` do backend (`install.sh` cria; em `.env` antigo, acrescenta sem tocar no resto).
  `crm/backend.mjs` usa essa chave; sem ela cai na do app e avisa uma vez no stderr para reinstalar.
- **Identidade carimbada pelo servidor** (`papelDe` em `server.js`): `app` ou `agente`, pela chave usada. O
  `X-Crm-Por` virou só sub-rótulo do app (ex.: `google`) e não eleva ninguém. O feed `mudancas.jsonl` passa a
  ser auditoria confiável.
- **Apagar é do dono.** Qualquer `DELETE` vindo da chave do agente volta 403 `exclusao_requer_dono`, registra
  `exclusao.pedida` no feed e, quando há box, deixa um comentário "🗑 O agente pediu para apagar…" para o dono
  confirmar no app ou no Gmail. A skill `crm-api` diz isso ao agente.

**Limite honesto:** o agente roda como o mesmo usuário Unix do backend e consegue ler a chave do app no `.env`.
A separação sobe o custo de "mudar um cabeçalho" para "ler de propósito um arquivo que a regra proíbe", e torna
cada exclusão auditável pela chave usada. Não é fronteira dura; fronteira dura é outro usuário Unix ou um proxy.

**Segredo recebido em mensagem** (regra v5 do CLAUDE.md do agente, `install-navegador-mcp.sh`): grava em
`~/.config/<serviço>/` e responde "guardado"; nunca repete o valor em texto, resumo, comentário ou skill. Era a
causa raiz dos tokens nos transcripts.

**Portão de senha dos sites** (`site-middleware.js`): senha errada custa 1,5 s (sem estado, cabe no Pages
Functions) e o cookie é salgado com o commit do deploy, então troca a cada publicação.

**Limpar histórico do WhatsApp:** se a exportação bater no teto de 1000 mensagens, o app recusa limpar em vez
de guardar 1000 e zerar o resto em silêncio.

## Primeiro pipeline do CRM no tutorial 10 (21 out)

O CRM só anota conversas do WhatsApp com um pipeline padrão. A box-lv tinha o CRM instalado e nenhum pipeline, e a
pessoa só recebia no WhatsApp o erro da CLI (`config --pipeline <key>`).

- **Tutorial 10 (`crm-gmail`):** ganhou o passo **"Criar o primeiro pipeline"**, antes do Streak e do teste. Ele conclui
  pelo estado real (`ctx.crm.local.padrao`): quem já tem pipeline padrão continua concluído.
- **Corpo do passo** (`renderCrmPipeline`):
  - modelos prontos de mídia paga ("Operação de mídia paga" e "Testes de anúncio") ou "Do meu jeito", em `lib/crm-modelos.ts` com
    `validarPipeline`: de 2 a 12 etapas, sem repetir;
  - com vários pipelines e nenhum padrão, escolher qual o WhatsApp usa.
- **Main** (`crm-local.ts`): `GET /v1/crm/pipelines` e `/config`, `POST /pipelines` e `PUT /config`, pelo túnel. Canais
  `crm:local`, `crm:pipeline-criar` e `crm:pipeline-padrao`; na auditoria, `crm.pipeline-criar` e
  `crm.pipeline-padrao`.
- **Aviso no WhatsApp:** `regras.mjs` › `avisoSemPipeline` dá o caminho no app (e "me peça aqui: cria um pipeline…"),
  com texto próprio para o CRM próprio e para o Streak.
- **O plugin do CRM agora se atualiza sozinho:** o probe lê `crm` e `crmVersion` e o seletor roda `installCrm` quando
  `deveAtualizar`. Só onde o CRM já está instalado. Versão 1.1.0.
