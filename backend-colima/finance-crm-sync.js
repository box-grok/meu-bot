/**
 * finance-crm-sync.js — sincronização automática do financeiro para o CRM (produto meu-bot-finance + Pro). O que
 * acontece no financeiro (frentes da DRE: custos/investimentos e fontes de ganho, mais o resumo do mês com ROI) vira
 * cartão no pipeline "Investimentos & ROI", com os valores já na moeda de exibição do sistema (a LV vê em dólar).
 *
 * Desacoplado: o financeiro não conhece o CRM. Este módulo lê o financeiro pela sua API (`estado()` + `store.meta()`)
 * e escreve no CRM pela rota idempotente `importar()` (upsert por chave estável). O server.js dispara, com debounce,
 * depois de cada escrita do financeiro, e só quando o CRM está liberado.
 */
'use strict';

const PIPELINE_KEY = 'p_investimentos';
const STAGES = [
  { key: 's_plan', name: 'Planejado' },
  { key: 's_ativo', name: 'Ativo' },
  { key: 's_analise', name: 'Em análise' },
  { key: 's_encerrado', name: 'Encerrado' },
];
const FIELDS = [
  { key: 'f_tipo', name: 'Tipo', type: 'TEXT' },
  { key: 'f_prev', name: 'Previsto/mês', type: 'TEXT' },
  { key: 'f_real', name: 'Realizado (mês)', type: 'TEXT' },
  { key: 'f_moeda', name: 'Moeda', type: 'TEXT' },
  { key: 'f_roi', name: 'ROI', type: 'TEXT' },
];
const TIPO_LABEL = { custo: 'Custo (investimento)', 'ganho-direto': 'Ganho direto', 'ganho-indireto': 'Ganho indireto' };

/** Monta o bundle do pipeline "Investimentos & ROI" a partir do estado do financeiro (valores na moeda de exibição). */
function bundleInvestimentos(estado, moeda, now) {
  const r = estado.resumo;
  const linhas = (r && r.dre && Array.isArray(r.dre.linhas)) ? r.dre.linhas : [];
  const boxes = linhas.map((ln) => ({
    key: `inv_${ln.key}`.slice(0, 80),
    name: ln.nome,
    stageKey: ln.realizadoCent > 0 || ln.previstoCent !== null ? 's_ativo' : 's_plan',
    notes: ln.notas || '',
    fields: { Tipo: TIPO_LABEL[ln.tipo] ?? ln.tipo, 'Previsto/mês': ln.previsto, 'Realizado (mês)': ln.realizado, Moeda: moeda, ROI: '' },
    origem: { programa: 'investimentos', linha: ln.key },
    updatedAt: now,
  }));
  // Cartão-resumo do mês: investido, ganhos e ROI projetado (o retângulo "onde o dinheiro está e o retorno").
  const pj = r ? r.projecao : null;
  if (pj) boxes.push({
    key: 'inv_resumo',
    name: `Resumo — ${r.nome}`,
    stageKey: 's_analise',
    notes: '',
    fields: { Tipo: 'Resumo do mês', 'Previsto/mês': `investido ${pj.gastos}`, 'Realizado (mês)': `ganhos ${pj.ganhos}`, Moeda: moeda, ROI: pj.roiTotal === null ? 'sem gasto ainda' : `${pj.roiTotal}% projetado` },
    origem: { programa: 'investimentos', resumo: true },
    updatedAt: now,
  });
  return {
    pipeline: { key: PIPELINE_KEY, name: 'Investimentos & ROI', stages: STAGES, fields: FIELDS, origem: { programa: 'investimentos' } },
    boxes,
  };
}

/** Lê o financeiro e faz o upsert no CRM. `financeApi` = { estado, store }; `crmApi` = { importar }. */
async function sincronizarInvestimentos(financeApi, crmApi, por = 'finance-sync', nowMs = Date.now()) {
  const estado = financeApi.estado();
  const moeda = financeApi.store.meta().moedaExibicao;
  const bundle = bundleInvestimentos(estado, moeda, nowMs);
  return crmApi.importar(bundle, por);
}

module.exports = { sincronizarInvestimentos, bundleInvestimentos, PIPELINE_KEY };
