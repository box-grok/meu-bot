# Financeiro

> Parte do diário técnico do meu-bot, dividido por assunto em 27 out 2026. Índice: [../GUIA.md](../GUIA.md). Mapa do código: [../ARQUITETURA.md](../ARQUITETURA.md).

## CRM e financeiro numa máquina sem OpenClaw (25 out)

- `install-crm.sh` deixou de recusar máquina sem OpenClaw (saía com 2: "instalador saiu com código 2" no tutorial 10 da
  `grokbot-1`). Sem OpenClaw entram a CLI `crm.mjs`, as skills `crm-api`/`streak-crm-api` e a pasta `crm/` (marcador
  `index.js` para a sondagem); o plugin do WhatsApp (hooks, notas automáticas, `crm-job.mjs`) é só do OpenClaw e a
  saída diz isso. `install-finance.sh` já fazia o mesmo.
- `crm/backend.mjs` e `finance/backend.mjs` achavam o `.env` do backend sempre na pasta herdada do Hermes: na
  `grokbot-1` isso lia a chave e a porta do backend do Hermes (8080) e tudo dava 404. Agora `backendDir()` segue a regra
  do app (backend-dir-core.ts): a própria `~/.local/share/meu-bot/backend` se tem `server.js`; a herdada só se o
  `server.js` de lá tem `meu-bot/hello`; senão a própria. `MEU_BOT_BACKEND_ENV` continua forçando. Teste:
  `scripts/tests/plugin-backend-dir.test.mjs` (HOME de mentira, um processo por caso).

## Curva ABC: submódulo de Finanças (26 out)

Aba "Curva ABC" ao lado da "Visão geral" na página Finanças. Compras (saídas, valor < 0) ou vendas (entradas, valor > 0),
agrupadas por favorecido (fornecedor/cliente) ou por categoria, nos últimos 1, 3, 6 ou 12 meses, na moeda de exibição.

- Regra única no modelo (`finance-modelo.js › curvaABC`, pura, testada): ordena do maior para o menor e classifica pelo
  acumulado ANTES do item: A enquanto < 80%, B enquanto < 95%, C o resto (o item que cruza os 80% ainda é A). Favorecido
  agrupa pela chave sem caixa/acento (`favorecidoKey`) e mostra o nome do lançamento mais recente.
- API: `GET /v1/finance/abc?lado=compra|venda&por=favorecido|categoria&meses=1..24[&ate=AAAA-MM]` → total, classes
  (itens, valor, %) e itens (pos, nome, valor, %, acumulado, lançamentos, classe). App: `financeAbc` (IPC `finance:abc`).
- Backend 1.1.1: as máquinas recebem a rota pela atualização automática do seletor.

### Importar do Google Sheets (26 out)

Na aba Curva ABC, cartão "Importar do Google Sheets": cola o link, escolhe compras ou vendas, pré-visualiza e importa.
- O Mac lê as células com a Conta Google do app (`planilhaLer`, escopo de planilhas): a planilha precisa estar
  compartilhada com a conta conectada na aba Conta Google daquela variante do app. Sem aba, lê a primeira (A1:Z5000).
- A máquina interpreta e grava (`finance-modelo.js › linhasDePlanilha` + `POST /v1/finance/importar`): cabeçalho com
  Data, Fornecedor/Cliente/Nome e Valor (achado até a linha 20; título acima é ignorado); Categoria, Tipo e Obs opcionais.
  Cada linha passa pelo mesmo `novoLancamento`, com origem "planilha", status confirmado e `ref` (fonte + data +
  favorecido + valor + ocorrência): reimportar a mesma planilha só traz o que é novo. Compra sem categoria cai em
  "Fornecedores" (criada se faltar); venda em "Vendas". `simular` = prévia sem gravar. Auditoria: `financeiro.importar`.
- Backend 1.1.2.

### Curva ABC por produto e vendas só reais (26 out)

- Lançamento ganhou `produto` e `qtd` (peças) opcionais; a planilha os lê das colunas Produto/Item/SKU/Modelo/Referência
  e Quantidade/Qtd/Peças. A curva ganhou `por=produto` (padrão da API e da tela): agrupa por produto sem caixa/acento,
  soma as peças e conta à parte (`semProduto`) o que entrou sem produto. Exemplo da planilha de vendas do Junior:
  `Data | Cliente | Produto | Quantidade | Valor`, uma linha por item vendido.
- Curva de vendas conta só dinheiro que entrou: ficam de fora as categorias de ganho indireto (estimado, "tempo
  poupado") e o saldo inicial. Antes elas apareciam como "clientes" (LV, 26/10).
- Backend 1.1.3.

## Vendas do CRM alimentam o financeiro (26 out)

`backend-colima/crm-finance-vendas.js`: o sentido inverso do finance-crm-sync.js. Pipeline de vendas = qualquer um com
campos Produto e Valor e uma etapa de venda concluída (Vendido/Ganho/Fechado/Pago/Concluído); sem nenhum, nasce o
pipeline **Vendas** (`p_vendas`: Cliente, Produto, Quantidade, Valor, Data da venda; Negociando › Vendido › Perdido).
Cada box na etapa de venda vira lançamento de renda com `ref = crm:<box>` (categoria Vendas criada se faltar, produto,
qtd, cliente = campo Cliente, senão o 1º contato, senão o nome do box; data = Data da venda, senão quando entrou na
etapa). `financeApi.sincronizarExternos` é idempotente: sem diferença não grava; box alterado regrava o mesmo id; box
que sai da etapa tira o lançamento. O server.js dispara a cada mudança do CRM (debounce 2 s) e 15 s depois de subir,
só com CRM e financeiro liberados. A skill crm-api diz ao agente para registrar a venda no CRM e não também no
financeiro. Teste: `scripts/tests/crm-finance-vendas.test.mjs`. Backend 1.1.4.
