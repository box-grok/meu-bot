/**
 * crm-finance-vendas.js — vendas do CRM viram entradas no financeiro (produto meu-bot-finance + Pro). O sentido inverso
 * do finance-crm-sync.js: lá o financeiro alimenta o pipeline "Investimentos & ROI"; aqui o CRM alimenta o financeiro.
 *
 * Um pipeline de vendas é qualquer um com os campos "Produto" e "Valor" e uma etapa de venda concluída ("Vendido",
 * "Ganho", "Fechado", "Pago", "Concluído"). Se a máquina não tem nenhum, nasce o pipeline "Vendas" com os campos
 * Cliente, Produto, Quantidade, Valor e Data da venda. Cada box na etapa de venda vira um lançamento de renda com ref
 * `crm:<box>` (categoria Vendas, produto e peças): a Curva ABC por produto passa a enxergar as vendas do CRM. Box que
 * muda é regravado; box que sai da etapa (ou some) tira o lançamento. Idempotente (financeApi.sincronizarExternos).
 * Desacoplado: lê o CRM pelo store e escreve no financeiro pela API dele; o server.js dispara com debounce.
 */
'use strict';

const PREFIXO = 'crm:';
const PIPELINE_VENDAS = {
  key: 'p_vendas', name: 'Vendas',
  stages: [{ key: 's_negociando', name: 'Negociando' }, { key: 's_vendido', name: 'Vendido' }, { key: 's_perdido', name: 'Perdido' }],
  fields: [
    { key: 'f_cliente', name: 'Cliente', type: 'TEXT' },
    { key: 'f_produto', name: 'Produto', type: 'TEXT' },
    { key: 'f_qtd', name: 'Quantidade', type: 'NUMBER' },
    { key: 'f_valor', name: 'Valor', type: 'TEXT' },
    { key: 'f_data_venda', name: 'Data da venda', type: 'DATE' },
  ],
};
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ETAPA_VENDA = /^(vendid|vendas? conclu|ganh|fechad|pago|conclu)/;
const campo = (pl, nomes) => pl.fields.find((f) => nomes.includes(norm(f.name))) ?? null;

/** Os campos e a etapa de venda de um pipeline; null quando ele não é de vendas. */
function mapaVendas(pl) {
  if (!pl || !Array.isArray(pl.fields) || !Array.isArray(pl.stages)) return null;
  const produto = campo(pl, ['produto', 'produtos', 'item', 'sku', 'modelo']);
  const valor = campo(pl, ['valor', 'valor da venda', 'total', 'preco', 'preço', 'valor total']);
  const etapas = pl.stages.filter((s) => ETAPA_VENDA.test(norm(s.name))).map((s) => s.key);
  if (!produto || !valor || etapas.length === 0) return null;
  return { produto, valor, etapas, qtd: campo(pl, ['quantidade', 'qtd', 'qtde', 'pecas', 'peças', 'unidades']), data: campo(pl, ['data da venda', 'data', 'vendido em']), cliente: campo(pl, ['cliente', 'comprador', 'comprador(a)', 'cliente final']) };
}

const isoDe = (ms) => { const d = new Date(Number(ms)); return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isoUtc = (ms) => { const d = new Date(Number(ms)); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };

/** Lançamentos (ref + input do financeiro) das vendas concluídas de um pipeline. `nomeContato(key)` dá o nome do contato. */
function vendasDoPipeline(pl, boxes, nomeContato = () => null) {
  const m = mapaVendas(pl); if (m === null) return [];
  const out = [];
  for (const b of boxes) {
    if (!m.etapas.includes(b.stageKey)) continue;
    const f = b.fields || {};
    const valor = f[m.valor.key];
    if (valor === undefined || valor === null || String(valor).trim() === '') continue;
    const produto = String(f[m.produto.key] ?? '').trim();
    const qtd = m.qtd ? f[m.qtd.key] : undefined;
    const data = (m.data && f[m.data.key] ? isoUtc(f[m.data.key]) : null) ?? isoDe(b.etapaDesde ?? b.updatedAt ?? b.createdAt);
    const cliente = (m.cliente ? String(f[m.cliente.key] ?? '').trim() : '') || (Array.isArray(b.contatos) && b.contatos.length > 0 ? (nomeContato(b.contatos[0]) || '') : '') || b.name;
    out.push({ ref: `${PREFIXO}${b.key}`, input: { tipo: 'renda', data, favorecido: cliente, valor: typeof valor === 'number' ? valor : String(valor), ...(produto ? { produto } : {}), ...(qtd !== undefined && qtd !== null && qtd !== '' ? { qtd } : {}), categoria: 'Vendas', origem: 'crm', notas: `CRM · ${pl.name}: ${b.name}`.slice(0, 500) } });
  }
  return out;
}

/** Garante um pipeline de vendas na máquina (cria "Vendas" se nenhum serve). Devolve a chave criada ou null. */
async function garantirPipelineVendas(crmApi, por = 'crm-vendas') {
  if (crmApi.store.listPipelines().some((p) => mapaVendas(p) !== null)) return null;
  const rel = await crmApi.importar({ pipeline: PIPELINE_VENDAS, boxes: [] }, por);
  return rel?.pipeline?.key ?? PIPELINE_VENDAS.key;
}

/** Uma rodada: garante o pipeline e espelha as vendas concluídas de todos os pipelines de vendas no financeiro. */
async function sincronizarVendas(crmApi, financeApi, por = 'crm-vendas') {
  const criado = await garantirPipelineVendas(crmApi, por);
  const nomeContato = (k) => crmApi.store.getContato(k)?.nome ?? null;
  const itens = crmApi.store.listPipelines().flatMap((pl) => vendasDoPipeline(pl, crmApi.store.listBoxes(pl.key), nomeContato));
  const rel = await financeApi.sincronizarExternos(PREFIXO, itens, por);
  return { ...rel, pipelineCriado: criado };
}

module.exports = { PIPELINE_VENDAS, PREFIXO, mapaVendas, vendasDoPipeline, garantirPipelineVendas, sincronizarVendas };
