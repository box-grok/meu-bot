---
name: streak-crm-navegador
description: "Operar o Streak CRM dentro do Gmail pelo Navegador do meu-bot (mcp__navegador__*): abrir pipeline, criar/editar/apagar boxes, preencher campos e anotações. Aprendido em 18/10/2026 na agente-box; atualize quando descobrir algo novo."
---

# Streak CRM pelo Navegador do meu-bot

Skill aprendida (semente do meu-bot). Use antes de mexer no Streak; ao descobrir um caminho novo ou um que
parou de funcionar, **edite este arquivo** (seção "Diário"), para a próxima vez não repetir tentativas.

## Antes de começar
- Confira `abas`. O popup da extensão (`chrome-extension://…/popup.html`) não é uma aba de página: ignore.
- Ids de aba mudam quando o app da pessoa reinicia. Em "aba N não existe", chame `abas` e siga na nova.
- Se o Streak mostrar "Faça login para usar o Streak", peça à pessoa que entre pela aba Navegador. Nunca faça login.

## Abrir um pipeline ou box
- Links do Streak são hashes do Gmail: `#pipeline/<id>/<view>` e `#box/<id>`.
- Num Gmail **recém-carregado** o hash do Streak pode voltar para `#inbox` (a extensão ainda não subiu).
  Se isso acontecer, espere 2 a 3 s e chame `abrir` de novo **na mesma aba** com a mesma url.
- Uma visualização salva (ex.: "🏆 Parceiros com clientes ativos") **filtra** os boxes. Para ver todos, use a
  url do pipeline com `__default__` no fim.

## Ler a página
- `ler` dá o texto e os elementos; a planilha do Streak esconde muita coisa do `ler`. Quando faltar algo,
  use `print` (layout) e `js` para listar botões por `title`/`data-tooltip`/texto, por exemplo:
  `Array.from(document.querySelectorAll('button,[role=button],a')).map(b=>({t:b.textContent.trim().slice(0,40), tt:b.getAttribute('data-tooltip')||b.title, y:Math.round(b.getBoundingClientRect().y)}))`.

## Criar um box
- O botão **"+"** da barra de ferramentas do pipeline (ícone `add`, canto superior direito) abre o diálogo de
  nova caixa: digite o nome e confirme. Funciona.
- O "+" de cada etapa (`.streak__spreadsheet_groupAdd`, tooltip "Adicionar caixa a <etapa>") abre uma célula
  inline; digitar + Enter **não salvou** na primeira tentativa. Prefira o "+" da barra e depois mova de etapa.

## Editar um box (página `#box/<id>`)
- Título: `input` com placeholder `(Sem nome)`; mudar `.value` e disparar `input` + `blur` renomeia.
- Anotações: campo `.mdl-textfield__input` mais abaixo na página (y > 400); gravar o texto e disparar `input`
  salva (confirmado após recarregar).
- Etapa: botão vermelho com a etapa atual (ex.: "Prospecção de parceiros") abre a lista; clique na nova.
- Campos do tipo lista (Tipo de parceiro, Origem): são "selects" próprios. Clicar no "—" foca um `input`
  com a dica "0 results available. Select is focused, type to refine list": **digite o valor e aperte Enter**
  em vez de usar setas.
- "Adicionar contato" (seção Contatos e organizações) abre um `input` de busca: digite nome ou e-mail, escolha
  na lista ou crie. Telefone entra no contato, não no box.

## Apagar boxes
- Apagar não tem volta: confirme o alcance com a pessoa (quantos boxes, de qual pipeline) antes.
- A caixa de seleção do cabeçalho não reage a `clicar`; dispare `mousedown`/`mouseup`/`click` nela por `js`.
- "Excluir caixas" pede para digitar a confirmação literal, ex.: `4 caixas`, e depois Excluir.

## Dados de uma conversa do WhatsApp (OpenClaw na mesma máquina)
- Sessões: `openclaw sessions --all-agents --json` (chave `agent:main:whatsapp:direct:+55…`).
- Texto da conversa: banco só leitura `~/.openclaw/agents/main/agent/openclaw-agent.sqlite`
  (`sqlite3.connect('file:…?mode=ro', uri=True)`), tabela de busca com `role`, `timestamp` e texto.
- O WhatsApp Web normalmente não está logado no Navegador; não é preciso.

## Diário (acrescente aqui o que aprender)
- 2026-10-18: criado o box "Junior Rezende" em Prospecção de parceiros com anotações da conversa; depois
  preenchidos Tipo de parceiro = Indicador e Origem = Redes sociais. Campos de data reagem a setas/Enter
  dispersos ("Primeiro cliente ativo" ganhou uma data sem querer): confira datas depois de mexer em selects.
