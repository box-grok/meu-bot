/**
 * finance-api.js — rotas /v1/finance/* do financeiro do meu-bot (produto meu-bot-finance), montadas pelo server.js
 * depois do bearer. Só roteamento, validação de entrada e tradução de erros; as regras ficam em finance-modelo.js e
 * a persistência em finance-store.js. Clientes: o app no Mac (página Finanças, pelo túnel), o agente da máquina
 * (finance/finance.mjs) e o plugin do WhatsApp (finance/index.js). Payloads enxutos: o agente paga em tokens.
 *
 * Exige o add-on meu-bot-finance em vigor (com ou sem o Pro); sem ele, 403 finance_license.
 * `X-Finance-Por` diz quem mudou (agente | whatsapp | app | pessoa).
 */
'use strict';

const modelo = require('./finance-modelo');
const { openStore } = require('./finance-store');

const POR_RE = /^[a-z]{2,20}$/;
const ID_RE = /^[A-Za-z0-9_-]{2,80}$/;
/** Foto de comprovante: até 8 MB (o corpo vem em base64, ~4/3 disso). */
const COMPROVANTE_MAX = 8 * 1024 * 1024;
const erro = (code, m, extra) => new modelo.ErroFinance(code, m, extra);

/** `deps`: dir do db, `licenseOk()`, `json/readBody/log` do server.js; `now()` injetável para teste. */
function createFinanceApi(deps) {
  const { json, readBody, log } = deps;
  const now = deps.now ?? (() => Date.now());
  const store = openStore(deps.dir, { log, now, ...(deps.rnd ? { rnd: deps.rnd } : {}) });
  const hoje = () => modelo.hojeDe(now());
  const ctx = (extra = {}) => ({ linhas: store.list('linhas'), contas: store.list('contas'), categorias: store.list('categorias'), favorecidos: store.list('favorecidos'), now: now(), rnd: deps.rnd ?? ((n) => require('node:crypto').randomBytes(n)), hoje: hoje(), ...extra });

  // ---- vistas ---------------------------------------------------------------------------------------------------
  const nomeCat = (k) => store.get('categorias', k)?.nome ?? k;
  const nomeConta = (k) => (k ? store.get('contas', k)?.nome ?? null : null);
  /** Config de moeda atual (taxas + moeda de exibição) e atalhos de formatação/conversão. */
  const cfgMoeda = () => { const mt = store.meta(); return { taxas: mt.taxas, moedaExib: mt.moedaExibicao }; };
  const fmtExib = (cent) => modelo.formatMoeda(cent, store.meta().moedaExibicao);
  const lancView = (l) => {
    const { taxas, moedaExib } = cfgMoeda();
    const moeda = l.moeda ?? modelo.MOEDA_PADRAO;
    const exibCent = modelo.paraExib(l.valorCent, moeda, taxas, moedaExib);
    return { ...(l.linha ? { linha: l.linha, linhaNome: store.get('linhas', l.linha)?.nome ?? l.linha } : {}), id: l.id, data: l.data, valorCent: l.valorCent, moeda, valor: modelo.formatMoeda(l.valorCent, moeda), valorExibCent: exibCent, valorExib: modelo.formatMoeda(exibCent, moedaExib), ...(l.moedaOriginal ? { moedaOriginal: l.moedaOriginal, valorOriginalCent: l.valorOriginalCent, valorOriginal: modelo.formatMoeda(l.valorOriginalCent, l.moedaOriginal) } : {}), favorecido: l.favorecido, categoria: l.categoria, categoriaNome: nomeCat(l.categoria), conta: l.conta, contaNome: nomeConta(l.conta), status: l.status, duvidas: l.duvidas ?? [], origem: l.origem, notas: l.notas || undefined, ...(l.duplicadoDe ? { duplicadoDe: l.duplicadoDe } : {}), ...(l.midia ? { midia: l.midia } : {}) };
  };
  const contaView = (c) => {
    const { taxas, moedaExib } = cfgMoeda();
    const moeda = c.moeda ?? modelo.MOEDA_PADRAO;
    const saldo = modelo.saldoConta(c, store.listLanc());
    const saldoExib = modelo.paraExib(saldo, moeda, taxas, moedaExib);
    return { key: c.key, nome: c.nome, tipo: c.tipo, moeda, padrao: c.padrao === true, fechada: c.fechada === true, saldoInicialCent: c.saldoInicialCent, saldoCent: saldo, saldo: modelo.formatMoeda(saldo, moeda), saldoExibCent: saldoExib, saldoExib: modelo.formatMoeda(saldoExib, moedaExib) };
  };
  const pendentes = () => store.listLanc().filter((l) => l.status === 'pendente');
  const mesInfo = (ym) => store.get('meses', ym) ?? { key: ym };
  /**
   * Orçamento do mês (quanto a pessoa decidiu gastar): o do próprio mês ou, se ela ainda não mexeu, o do último mês que
   * tinha um. Assim a virada do mês não pede nada de novo; mudar é opcional. null = nunca definiu.
   */
  /** Um valor do mês (orçamento, metas) ou, se a pessoa ainda não mexeu, o do último mês que tinha um. */
  function herdado(ym, campo) {
    const proprio = mesInfo(ym)[campo];
    if (Number.isSafeInteger(proprio)) return { cent: proprio, herdadoDe: null };
    const ant = store.list('meses').filter((x) => x.key < ym && Number.isSafeInteger(x[campo])).sort((a, b) => b.key.localeCompare(a.key))[0];
    return ant ? { cent: ant[campo], herdadoDe: ant.key } : null;
  }
  const orcamentoDe = (ym) => herdado(ym, 'orcamentoCent');
  /**
   * Curva ABC (submódulo de Finanças): compras ou vendas dos últimos `n` meses até `ate` (inclusive), por favorecido ou
   * categoria, em moeda de exibição. A regra é do modelo (curvaABC); aqui só o período, a conversão e a formatação.
   */
  function abc(lado, por, n, ate) {
    const { taxas, moedaExib } = cfgMoeda();
    const toExib = (l) => modelo.paraExib(l.valorCent, l.moeda ?? modelo.MOEDA_PADRAO, taxas, moedaExib);
    const cats = store.list('categorias');
    const nomeCat = (k) => cats.find((c) => c.key === k)?.nome ?? k;
    const meses = [ate]; while (meses.length < n) meses.unshift(modelo.mesAnterior(meses[0]));
    const lanc = meses.flatMap((ym) => store.listLanc(ym));
    const r = modelo.curvaABC(lanc, { lado, por, toExib, nomeCat });
    const pct = (x) => Math.round(x * 1000) / 10;
    const classes = Object.fromEntries(Object.entries(r.classes).map(([k, c]) => [k, { itens: c.itens, cent: c.cent, valor: fmtExib(c.cent), pct: pct(c.pct) }]));
    return { lado: r.lado, por: r.por, de: meses[0], ate, meses: n, moeda: moedaExib, lancamentos: lanc.length, totalCent: r.totalCent, total: fmtExib(r.totalCent), classes,
      itens: r.itens.map((i) => ({ ...i, valor: fmtExib(i.cent), pct: pct(i.pct), acumPct: pct(i.acumPct) })) };
  }
  function resumo(ym) {
    const { taxas, moedaExib } = cfgMoeda();
    const conv = { taxas, moedaExib };
    const exibL = (l) => modelo.paraExib(l.valorCent, l.moeda ?? modelo.MOEDA_PADRAO, taxas, moedaExib);
    const r = modelo.resumoMes(store.listLanc(ym), store.list('categorias'), ym, conv);
    const info = mesInfo(ym);
    const orc = orcamentoDe(ym);
    const orcamento = orc === null ? null : { cent: orc.cent, valor: fmtExib(orc.cent), herdadoDe: orc.herdadoDe, restanteCent: orc.cent - r.gastosCent, restante: fmtExib(orc.cent - r.gastosCent), usadoPct: orc.cent > 0 ? Math.round((r.gastosCent / orc.cent) * 100) : 0 };
    // Projeção até o fim do mês: investimento = o orçamento (ou o gasto, se já passou dele; sem orçamento, o gasto no
    // ritmo de hoje); ganhos = os de até hoje no mesmo ritmo. Mês que já acabou: projeção = real.
    const hj = hoje(); const atual = hj.slice(0, 7);
    const diasMes = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const dia = ym === atual ? Number(hj.slice(8, 10)) : diasMes;
    const fator = ym > atual ? 1 : diasMes / Math.max(1, dia);
    // DRE do mês: cada linha prevista com o realizado (lançamentos ligados a ela). Linha "a definir" entra com 0 no total.
    const doMes = store.listLanc(ym);
    const linhasDre = store.list('linhas').map((ln) => {
      const realizado = doMes.filter((l) => l.linha === ln.key).reduce((s, l) => s + Math.abs(exibL(l)), 0);
      return { key: ln.key, nome: ln.nome, tipo: ln.tipo, previstoCent: ln.valorMensalCent, previsto: ln.valorMensalCent === null ? 'a definir' : fmtExib(ln.valorMensalCent), realizadoCent: realizado, realizado: fmtExib(realizado), notas: ln.notas || null };
    }).sort((a, b) => modelo.TIPOS_LINHA.indexOf(a.tipo) - modelo.TIPOS_LINHA.indexOf(b.tipo) || a.nome.localeCompare(b.nome));
    const somaPrev = (t) => linhasDre.filter((x) => x.tipo === t).reduce((s, x) => s + Math.max(x.previstoCent ?? 0, x.realizadoCent), 0);
    const custoPrev = somaPrev('custo'); const diretoPrev = somaPrev('ganho-direto'); const indiretoPrev = somaPrev('ganho-indireto');
    const aDefinir = linhasDre.filter((x) => x.previstoCent === null).map((x) => x.nome);
    const gastosNaoLigados = doMes.filter((l) => l.valorCent < 0 && !l.linha).reduce((s, l) => s - exibL(l), 0);
    const gastosProj = ym < atual ? r.gastosCent : Math.max(orc?.cent ?? 0, r.gastosCent, custoPrev + Math.round(gastosNaoLigados * (orc === null ? fator : 1)), orc === null && custoPrev === 0 ? Math.round(r.gastosCent * fator) : 0);
    // Ganhos projetados: a meta do mês (expectativa da pessoa, herdada até ela mudar) ou o ritmo real, o que for maior;
    // mês que já acabou fica no real. A meta nunca entra no realizado.
    const metaD = herdado(ym, 'metaDiretoCent'); const metaI = herdado(ym, 'metaIndiretoCent');
    const passado = ym < atual;
    const diretoProj = passado ? r.ganhoDiretoCent : Math.max(Math.round(r.ganhoDiretoCent * fator), metaD?.cent ?? 0, diretoPrev);
    const indiretoProj = passado ? r.ganhoIndiretoCent : Math.max(Math.round(r.ganhoIndiretoCent * fator), metaI?.cent ?? 0, indiretoPrev);
    const pr = modelo.retornoResumo(gastosProj, diretoProj, indiretoProj);
    const meta = metaD === null && metaI === null ? null : { diretoCent: metaD?.cent ?? 0, direto: fmtExib(metaD?.cent ?? 0), indiretoCent: metaI?.cent ?? 0, indireto: fmtExib(metaI?.cent ?? 0), herdadoDe: metaD?.herdadoDe ?? metaI?.herdadoDe ?? null, notas: mesInfo(ym).metaNotas ?? (metaD?.herdadoDe ? mesInfo(metaD.herdadoDe).metaNotas : undefined) ?? null };
    const projecao = { gastosCent: gastosProj, gastos: fmtExib(gastosProj), ganhoDiretoCent: diretoProj, ganhoIndiretoCent: indiretoProj, ganhosCent: pr.ganhosCent, ganhos: fmtExib(pr.ganhosCent), roiDireto: pr.roiDireto, roiTotal: pr.roiTotal, empateCent: gastosProj, empate: fmtExib(gastosProj), dia, diasMes, base: passado ? 'real' : custoPrev > 0 && custoPrev >= (orc?.cent ?? 0) ? 'linhas' : orc !== null ? 'orcamento' : 'ritmo', ganhosBase: passado ? 'real' : diretoPrev + indiretoPrev > 0 ? 'linhas' : meta !== null ? 'meta' : 'ritmo' };
    const dre = { linhas: linhasDre, aDefinir, custoPrevistoCent: custoPrev, ganhoDiretoPrevistoCent: diretoPrev, ganhoIndiretoPrevistoCent: indiretoPrev, resultadoPrevistoCent: diretoPrev + indiretoPrev - custoPrev, resultadoPrevisto: fmtExib(diretoPrev + indiretoPrev - custoPrev) };
    return { ...r, orcamento, meta, projecao, dre, ganhos: fmtExib(r.ganhosCent), ganhoDireto: fmtExib(r.ganhoDiretoCent), ganhoIndireto: fmtExib(r.ganhoIndiretoCent), nome: modelo.mesPorExtenso(ym), gastos: fmtExib(r.gastosCent), renda: fmtExib(r.rendaCent), saldo: fmtExib(r.saldoCent), porCategoria: r.porCategoria.map((c) => ({ ...c, valor: fmtExib(c.cent) })), rendaPrevistaCent: info.rendaPrevistaCent ?? null, fechadoEm: info.fechadoEm ?? null, dinheiroInformadoEm: info.dinheiroInformadoEm ?? null };
  }
  /**
   * Tudo o que o app e os tutoriais precisam numa chamada só: contas com saldo, mês atual, pendências e o checklist do
   * mês (o que depende só da pessoa). Os `feito` vêm daqui, não de flags locais: viram o mês, voltam a pedir.
   */
  function estado() {
    const ym = hoje().slice(0, 7); const ant = modelo.mesAnterior(ym);
    const todos = store.listLanc();
    const doMes = todos.filter((l) => modelo.mesDe(l.data) === ym);
    const r = resumo(ym);
    const contas = store.list('contas').filter((c) => !c.fechada).map(contaView);
    const porOrigem = {}; for (const l of todos) porOrigem[l.origem] = (porOrigem[l.origem] ?? 0) + 1;
    const rendaInformada = r.rendaPrevistaCent !== null || doMes.some((l) => l.valorCent > 0);
    const dinheiroInformado = r.dinheiroInformadoEm !== null || doMes.some((l) => l.conta && store.get('contas', l.conta)?.tipo === 'dinheiro');
    const temAnterior = todos.some((l) => modelo.mesDe(l.data) === ant);
    const anteriorFechado = !temAnterior || Boolean(mesInfo(ant).fechadoEm);
    const nPend = pendentes().length;
    const checklist = [
      { id: 'pendencias', titulo: nPend === 0 ? 'Nada para confirmar' : `Confirmar ${nPend} ${nPend === 1 ? 'lançamento' : 'lançamentos'}`, feito: nPend === 0 },
      { id: 'orcamento', titulo: r.orcamento === null ? `Definir quanto gastar em ${modelo.mesPorExtenso(ym)}` : r.orcamento.herdadoDe ? `Orçamento de ${modelo.mesPorExtenso(ym)}: ${r.orcamento.valor} (o mesmo de ${modelo.mesPorExtenso(r.orcamento.herdadoDe)})` : `Orçamento de ${modelo.mesPorExtenso(ym)}: ${r.orcamento.valor}`, feito: r.orcamento !== null },
      { id: 'dinheiro', titulo: 'Contar os gastos em dinheiro do mês', feito: dinheiroInformado },
      ...(temAnterior ? [{ id: 'fechar', titulo: `Fechar ${modelo.mesPorExtenso(ant)}`, feito: anteriorFechado }] : []),
    ];
    // Desde o início: o investimento todo e o retorno todo (o ROI de um mês só engana: o retorno vem depois do gasto).
    const tudo = modelo.resumoMes(todos.map((l) => ({ ...l, data: '0000-00-00' })), store.list('categorias'), '0000-00', { taxas: store.meta().taxas, moedaExib: store.meta().moedaExibicao });
    const acumulado = { gastosCent: tudo.gastosCent, gastos: fmtExib(tudo.gastosCent), ganhosCent: tudo.ganhosCent, ganhos: fmtExib(tudo.ganhosCent), ganhoDiretoCent: tudo.ganhoDiretoCent, ganhoIndiretoCent: tudo.ganhoIndiretoCent, roiDireto: tudo.roiDireto, roiTotal: tudo.roiTotal };
    return { instalado: true, hoje: hoje(), mes: ym, acumulado, mesAnterior: ant, contas, resumo: r, pendencias: nPend, totalLancamentos: todos.length, porOrigem, rendaInformada, orcamentoDefinido: r.orcamento !== null, dinheiroInformado, anteriorFechado, checklist, seq: store.meta().seq };
  }
  /** Texto curto em pt-BR que o plugin põe no prompt do agente quando o dono fala de dinheiro. */
  function contexto() {
    const e = estado();
    const linhas = [`Financeiro do dono (${e.resumo.nome}): gastos ${e.resumo.gastos}, renda ${e.resumo.renda}, saldo do mês ${e.resumo.saldo}.`];
    const roi = (v) => (v === null ? 'sem gasto ainda' : `${v}%`);
    const pj = e.resumo.projecao;
    const dr = e.resumo.dre;
    if (dr && dr.linhas.length > 0) linhas.push(`DRE prevista do mês (linhas recorrentes; "a definir" = custo certo sem valor ainda): ${dr.linhas.map((x) => `${x.tipo === 'custo' ? 'custo' : x.tipo === 'ganho-direto' ? 'ganho direto' : 'ganho indireto'} "${x.nome}" [${x.key}] previsto ${x.previsto}, realizado ${x.realizado}`).join('; ')}. Ao lançar algo que é de uma dessas linhas, use --linha <chave>.`);
    if (e.resumo.meta) linhas.push(`Meta de ganhos do mês (projeção, não é realizado): diretos ${e.resumo.meta.direto}, indiretos ${e.resumo.meta.indireto}${e.resumo.meta.notas ? ` (${e.resumo.meta.notas})` : ''}.`);
    linhas.push(`Projeção até o fim do mês (${pj.base === 'orcamento' ? 'investimento = o orçamento' : 'no ritmo de hoje'}, dia ${pj.dia} de ${pj.diasMes}): investido ${pj.gastos}, ganhos ${pj.ganhos}, ROI projetado ${roi(pj.roiTotal)} (só diretos ${roi(pj.roiDireto)}).`);
    linhas.push(`Retorno do investimento no mês: ganhos diretos ${e.resumo.ganhoDireto}, indiretos ${e.resumo.ganhoIndireto}; ROI ${roi(e.resumo.roiDireto)} (só diretos), ${roi(e.resumo.roiTotal)} (com indiretos). Desde o início: investido ${e.acumulado.gastos}, ganhos ${e.acumulado.ganhos}, ROI ${roi(e.acumulado.roiTotal)}.`);
    const o = e.resumo.orcamento;
    linhas.push(o === null ? 'Orçamento do mês: ainda não definido (pergunte quanto ele quer gastar no mês).' : `Orçamento do mês: ${o.valor}; já usou ${o.usadoPct}%, ${o.restanteCent >= 0 ? `restam ${o.restante}` : `passou ${fmtExib(-o.restanteCent)}`}.`);
    if (e.contas.length > 0) linhas.push(`Contas: ${e.contas.map((c) => `${c.nome} ${c.saldo}`).join('; ')}.`);
    const top = e.resumo.porCategoria.filter((c) => c.cent < 0).slice(0, 4);
    if (top.length > 0) linhas.push(`Maiores gastos: ${top.map((c) => `${c.nome} ${fmtExib(-c.cent)}`).join(', ')}.`);
    if (e.pendencias > 0) linhas.push(`Pendentes (${e.pendencias}): ${pendentes().slice(0, 5).map((l) => `[${l.id}] ${modelo.linhaLancamento(l, store.list('categorias'))}`).join(' | ')}.`);
    linhas.push('Para lançar, corrigir ou consultar use a ferramenta node ~/.local/share/meu-bot/finance/finance.mjs (skill finance-api). Nunca invente valores.');
    return linhas.join('\n');
  }

  // ---- escrita ---------------------------------------------------------------------------------------------------
  /** Confirmar (ou trocar a categoria de) um lançamento ensina o favorecido → categoria. */
  function aprenderDe(tx, l) {
    if (!l.favorecido) return;
    const f = modelo.aprender(tx.list('favorecidos'), l.favorecido, l.categoria, tx.now);
    if (f !== null) tx.set('favorecidos', f);
  }
  /** Lançar num mês já fechado reabre o mês (o checklist volta a pedir o fechamento). */
  function reabrirSeFechado(tx, data) {
    const ym = modelo.mesDe(data); const m = tx.get('meses', ym);
    if (m?.fechadoEm) { const { fechadoEm: _f, ...resto } = m; tx.set('meses', { ...resto, key: ym }); tx.mudar('mes.reaberto', { mes: ym }); }
  }
  async function lancar(input, por) {
    return store.mutate(por, (tx) => {
      const c = ctx({ now: tx.now, rnd: tx.rnd });
      let l = modelo.novoLancamento(input, c);
      const dup = modelo.duplicadoDe(l, tx.listLanc(modelo.mesDe(l.data)).concat(tx.listLanc(modelo.mesDe(modelo.somaDias(l.data, -modelo.DEDUP_DIAS)))));
      if (dup !== null && input.forcar !== true) l = { ...l, status: 'pendente', duvidas: [...new Set([...(l.duvidas ?? []), 'duplicado'])], duplicadoDe: dup };
      tx.setLanc(l);
      if (l.favorecido) { const f = modelo.aprender(tx.list('favorecidos'), l.favorecido, l.status === 'confirmado' ? l.categoria : null, tx.now); if (f !== null) tx.set('favorecidos', f); }
      reabrirSeFechado(tx, l.data);
      tx.mudar('lancamento.create', { id: l.id, origem: l.origem });
      return l;
    });
  }
  async function body(req, max = 256 * 1024) {
    const raw = await readBody(req, max);
    if (raw === '' || raw === undefined) return {};
    try { const v = JSON.parse(raw); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('objeto'); return v; } catch { throw erro('invalido', 'JSON inválido'); }
  }
  const int = (v, dflt, min, max) => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : dflt; };
  const lancOr404 = (id) => { const l = store.getLanc(id); if (l === null) throw erro('nao_encontrado', `lançamento ${id} não existe`); return l; };
  const contaOr404 = (k) => { const c = store.get('contas', k); if (c === null) throw erro('nao_encontrado', `conta ${k} não existe`); return c; };
  const mesOk = (ym) => { if (!modelo.MES_RE.test(String(ym))) throw erro('invalido', 'mês inválido: use AAAA-MM'); return ym; };

  async function rota(req, url, por) {
    const p = url.pathname.replace(/^\/v1\/finance\/?/, '').replace(/\/+$/, '');
    const seg = p === '' ? [] : p.split('/').map((s) => decodeURIComponent(s));
    const m = req.method; const [a, b, c] = seg; const sp = url.searchParams;
    if (seg.length > 3) throw erro('nao_encontrado', `rota desconhecida: ${m} ${url.pathname}`);
    if (b !== undefined && !ID_RE.test(b) && !modelo.MES_RE.test(b) && !/^[0-9a-f]{64}$/.test(b)) throw erro('invalido', 'chave inválida na rota');

    if (a === 'estado' && m === 'GET' && !b) return estado();
    if (a === 'contexto' && m === 'GET' && !b) return { texto: contexto() };
    if (a === 'resumo' && m === 'GET' && !b) return resumo(sp.has('mes') ? mesOk(sp.get('mes')) : hoje().slice(0, 7));
    if (a === 'abc' && m === 'GET' && !b) return abc(sp.get('lado') ?? 'compra', sp.get('por') ?? 'favorecido', int(sp.get('meses'), 3, 1, 24), sp.has('ate') ? mesOk(sp.get('ate')) : hoje().slice(0, 7));
    if (a === 'mudancas' && m === 'GET' && !b) return { mudancas: store.ultimas(int(sp.get('n'), 30, 1, 200)) };

    // Config de moeda: taxas (unidades por 1 US$) e a moeda de exibição (padrão do sistema, US$; trocável).
    if (a === 'config' && m === 'GET' && !b) { const mt = store.meta(); return { config: { taxas: mt.taxas, moedaExibicao: mt.moedaExibicao, moedas: modelo.MOEDAS, moedaInfo: modelo.MOEDA_INFO } }; }
    if (a === 'config' && m === 'PUT' && !b) { const input = await body(req); const out = await store.setConfig({ taxas: input.taxas, moedaExibicao: input.moedaExibicao }, por); return { ok: true, config: { ...out, moedas: modelo.MOEDAS, moedaInfo: modelo.MOEDA_INFO } }; }

    if (a === 'contas') {
      if (!b && m === 'GET') return { contas: store.list('contas').filter((x) => sp.get('todas') === '1' || !x.fechada).map(contaView) };
      if (!b && m === 'POST') { const input = await body(req); const conta = await store.mutate(por, (tx) => { let ct = modelo.novaConta(input, tx.list('contas'), tx.now, tx.rnd); if (ct.padrao) for (const o of tx.list('contas')) if (o.padrao) tx.set('contas', { ...o, padrao: false }); tx.set('contas', ct); tx.mudar('conta.create', { conta: ct.key }); return ct; }); return { ok: true, conta: contaView(conta) }; }
      if (b && !c && m === 'PUT') { const input = await body(req); contaOr404(b); const conta = await store.mutate(por, (tx) => { const atual = tx.get('contas', b); if (input.moeda !== undefined && input.moeda !== atual.moeda && tx.listLanc().some((l) => l.conta === b)) throw erro('invalido', 'não dá para trocar a moeda de uma conta que já tem lançamentos'); const ct = modelo.patchConta(atual, input, tx.list('contas'), tx.now); if (input.padrao === true) for (const o of tx.list('contas')) if (o.key !== b && o.padrao) tx.set('contas', { ...o, padrao: false }); tx.set('contas', ct); tx.mudar('conta.update', { conta: b }); return ct; }); return { ok: true, conta: contaView(conta) }; }
    }
    if (a === 'categorias') {
      if (!b && m === 'GET') return { categorias: store.list('categorias').map((x) => ({ key: x.key, nome: x.nome, grupo: x.grupo, renda: x.renda === true, ...(x.retorno ? { retorno: x.retorno } : {}) })) };
      if (!b && m === 'POST') { const input = await body(req); const cat = await store.mutate(por, (tx) => { const ct = modelo.novaCategoria(input, tx.list('categorias')); tx.set('categorias', ct); tx.mudar('categoria.create', { categoria: ct.key }); return ct; }); return { ok: true, categoria: cat }; }
    }
    if (a === 'linhas') {
      if (!b && m === 'GET') return { linhas: store.list('linhas') };
      if (!b && m === 'POST') { const input = await body(req); const ln = await store.mutate(por, (tx) => { const x = modelo.novaLinha(input, tx.list('linhas'), tx.now); tx.set('linhas', x); tx.mudar('linha.create', { linha: x.key }); return x; }); return { ok: true, linha: ln }; }
      if (b && !c && m === 'PUT') { const input = await body(req); if (store.get('linhas', b) === null) throw erro('nao_encontrado', `linha ${b} não existe`); const ln = await store.mutate(por, (tx) => { const x = modelo.patchLinha(tx.get('linhas', b), input, tx.now); tx.set('linhas', x); tx.mudar('linha.update', { linha: b }); return x; }); return { ok: true, linha: ln }; }
      if (b && c === 'remover' && m === 'POST') { const ln = store.get('linhas', b); if (ln === null) throw erro('nao_encontrado', `linha ${b} não existe`); await store.mutate(por, (tx) => { for (const l of tx.listLanc()) if (l.linha === b) { const { linha: _x, ...resto } = l; tx.setLanc({ ...resto, atualizadoEm: tx.now }); } tx.trash('linhas', ln); tx.mudar('linha.remover', { linha: b }); }); return { ok: true }; }
    }
    if (a === 'favorecidos' && !b && m === 'GET') return { favorecidos: store.list('favorecidos').sort((x, y) => (y.usos ?? 0) - (x.usos ?? 0)).slice(0, int(sp.get('limite'), 100, 1, 1000)).map((f) => ({ nome: f.nome, categoria: f.categoria, categoriaNome: f.categoria ? nomeCat(f.categoria) : null, usos: f.usos ?? 0 })) };

    if (a === 'lancamentos') {
      if (!b && m === 'GET') {
        let ls = store.listLanc(sp.has('mes') ? mesOk(sp.get('mes')) : undefined);
        if (sp.get('status')) ls = ls.filter((l) => l.status === sp.get('status'));
        if (sp.get('conta')) { const ct = modelo.findConta(store.list('contas'), sp.get('conta')); ls = ls.filter((l) => l.conta === (ct?.key ?? '-')); }
        if (sp.get('categoria')) { const ct = modelo.findCategoria(store.list('categorias'), sp.get('categoria')); ls = ls.filter((l) => l.categoria === (ct?.key ?? '-')); }
        if (sp.get('busca')) { const q = modelo.norm(sp.get('busca')); ls = ls.filter((l) => modelo.norm(`${l.favorecido} ${l.notas}`).includes(q)); }
        const limite = int(sp.get('limite'), 50, 1, 1000);
        return { total: ls.length, lancamentos: ls.slice(0, limite).map(lancView) };
      }
      if (!b && m === 'POST') {
        const input = await body(req);
        const l = await lancar(input, por);
        return { ok: true, lancamento: lancView(l), linha: modelo.linhaLancamento(l, store.list('categorias'), store.list('contas')), ...(l.duplicadoDe ? { suspeitoDe: lancView(lancOr404(l.duplicadoDe)) } : {}) };
      }
      if (b && !c && m === 'GET') return { lancamento: lancView(lancOr404(b)) };
      if (b && !c && m === 'PUT') {
        const input = await body(req); lancOr404(b);
        const l = await store.mutate(por, (tx) => { const cur = tx.getLanc(b); const nl = modelo.patchLancamento(cur, input, ctx({ now: tx.now })); tx.setLanc(nl); if (nl.status === 'confirmado' && (nl.categoria !== cur.categoria || cur.status !== 'confirmado')) aprenderDe(tx, nl); reabrirSeFechado(tx, nl.data); tx.mudar('lancamento.update', { id: b }); return nl; });
        return { ok: true, lancamento: lancView(l) };
      }
      if (b && c === 'confirmar' && m === 'POST') {
        const input = await body(req); lancOr404(b);
        const l = await store.mutate(por, (tx) => { const cur = tx.getLanc(b); const nl = modelo.patchLancamento(cur, { ...(input.categoria ? { categoria: input.categoria } : {}), ...(input.conta ? { conta: input.conta } : {}), status: 'confirmado' }, ctx({ now: tx.now })); delete nl.duplicadoDe; tx.setLanc(nl); aprenderDe(tx, nl); tx.mudar('lancamento.confirmar', { id: b }); return nl; });
        return { ok: true, lancamento: lancView(l) };
      }
      if (b && c === 'descartar' && m === 'POST') { lancOr404(b); await store.mutate(por, (tx) => { tx.trashLanc(tx.getLanc(b)); tx.mudar('lancamento.descartar', { id: b }); }); return { ok: true }; }
    }
    if (a === 'pendencias') {
      if (!b && m === 'GET') return { pendencias: pendentes().map(lancView) };
      if (b === 'confirmar-todas' && !c && m === 'POST') {
        const n = await store.mutate(por, (tx) => { let k = 0; for (const l of tx.listLanc()) if (l.status === 'pendente' && !l.duplicadoDe) { const nl = { ...l, status: 'confirmado', duvidas: [], atualizadoEm: tx.now }; tx.setLanc(nl); aprenderDe(tx, nl); k++; } if (k > 0) tx.mudar('pendencias.confirmar', { n: k }); return k; });
        return { ok: true, confirmados: n, restantes: pendentes().length };
      }
    }
    if (a === 'renda' && !b && m === 'POST') {
      // "recebi 3.000 de salário": um lançamento de renda, confirmado (a pessoa disse).
      const input = await body(req);
      const fonte = String(input.fonte ?? input.favorecido ?? '').trim();
      // Entrada é retorno do investimento: ganho direto por padrão; indireto (tempo economizado, custo evitado) a pedido.
      const categoria = input.categoria ?? (/sal[aá]rio|holerite|folha/i.test(fonte) ? 'salario' : input.retorno === 'indireto' ? 'ganho-indireto' : 'ganho-direto');
      const l = await lancar({ ...input, tipo: 'renda', favorecido: fonte, categoria, status: input.status ?? 'confirmado', origem: input.origem ?? (por === 'whatsapp' ? 'whatsapp' : por === 'agente' ? 'agente' : 'app') }, por);
      return { ok: true, lancamento: lancView(l) };
    }
    if (a === 'meses' && b && !c && m === 'PUT') {
      // Renda prevista do mês e "já contei os gastos em dinheiro" (o que só a pessoa sabe).
      const ym = mesOk(b); const input = await body(req);
      // Orçamento, metas e renda prevista são valores agregados na moeda de exibição (o padrão do sistema, US$).
      const moedaExib = store.meta().moedaExibicao;
      const pv = (x) => modelo.parseValor(x, moedaExib)?.valorCent ?? null;
      const info = await store.mutate(por, (tx) => {
        const cur = tx.get('meses', ym) ?? { key: ym }; const out = { ...cur, key: ym };
        // Metas de ganho do mês (projeção): direto e indireto, com a conta que as justifica em `metaNotas`.
        for (const [k, campo] of [['metaDireto', 'metaDiretoCent'], ['metaIndireto', 'metaIndiretoCent']]) {
          if (input[k] === null) delete out[campo];
          else if (input[k] !== undefined) { const v = pv(input[k]); if (v === null || !Number.isSafeInteger(v) || v < 0) throw erro('invalido', 'meta inválida: diga quanto espera ganhar no mês, ex.: 500'); out[campo] = v; }
        }
        if (typeof input.metaNotas === 'string') { const n = input.metaNotas.trim().slice(0, 500); if (n === '') delete out.metaNotas; else out.metaNotas = n; }
        if (input.orcamento === null) delete out.orcamentoCent;
        else if (input.orcamento !== undefined) { const v = pv(input.orcamento); if (v === null || !Number.isSafeInteger(v) || v <= 0) throw erro('invalido', 'orçamento inválido: diga quanto quer gastar no mês, ex.: 3.000'); out.orcamentoCent = v; }
        if (input.rendaPrevista !== undefined) { const v = input.rendaPrevista === null ? null : pv(input.rendaPrevista); if (v !== null && (!Number.isSafeInteger(v) || v < 0)) throw erro('invalido', 'renda prevista inválida'); if (v === null) delete out.rendaPrevistaCent; else out.rendaPrevistaCent = v; }
        if (input.dinheiroInformado === true) out.dinheiroInformadoEm = tx.now; else if (input.dinheiroInformado === false) delete out.dinheiroInformadoEm;
        tx.set('meses', out); tx.mudar('mes.update', { mes: ym }); return out;
      });
      return { ok: true, mes: info };
    }
    if (a === 'fechamento' && !b && m === 'POST') {
      const input = await body(req); const ym = mesOk(input.mes ?? modelo.mesAnterior(hoje().slice(0, 7)));
      const pend = store.listLanc(ym).filter((l) => l.status === 'pendente');
      if (pend.length > 0) throw erro('conflito', `${modelo.mesPorExtenso(ym)} ainda tem ${pend.length} ${pend.length === 1 ? 'lançamento pendente' : 'lançamentos pendentes'}: confirme ou descarte antes de fechar`, { pendencias: pend.map(lancView) });
      const info = await store.mutate(por, (tx) => { const out = { ...(tx.get('meses', ym) ?? {}), key: ym, fechadoEm: tx.now }; tx.set('meses', out); tx.mudar('mes.fechado', { mes: ym }); return out; });
      return { ok: true, mes: info, resumo: resumo(ym) };
    }
    if (a === 'comprovantes') {
      if (!b && m === 'POST') {
        const input = await body(req, Math.ceil(COMPROVANTE_MAX * 4 / 3) + 4096);
        const dados = Buffer.from(String(input.base64 ?? ''), 'base64');
        if (dados.length === 0) throw erro('invalido', 'comprovante vazio');
        if (dados.length > COMPROVANTE_MAX) throw erro('invalido', 'comprovante maior que 8 MB');
        return { ok: true, sha256: store.guardarComprovante(dados) };
      }
      if (b && !c && m === 'GET') { const d = store.lerComprovante(b); if (d === null) throw erro('nao_encontrado', 'comprovante não existe'); return { base64: d.toString('base64') }; }
    }
    throw erro('nao_encontrado', `rota desconhecida: ${m} ${url.pathname}`);
  }

  /** Trata uma requisição /v1/finance/*; sempre responde. */
  async function handle(req, res, url) {
    if (!deps.licenseOk()) return json(res, 403, { error: { message: 'o financeiro precisa do add-on meu-bot-finance nesta máquina, ou a licença venceu', type: 'forbidden', code: 'finance_license' } });
    const porHdr = String(req.headers['x-finance-por'] || '').toLowerCase();
    const por = POR_RE.test(porHdr) ? porHdr : 'app';
    const t0 = Date.now();
    try {
      const out = await rota(req, url, por);
      log(`finance ${req.method} ${url.pathname} → 200 (${Date.now() - t0} ms, ${por})`);
      return json(res, 200, out);
    } catch (e) {
      if (e instanceof modelo.ErroFinance) {
        const status = e.code === 'nao_encontrado' ? 404 : e.code === 'conflito' ? 409 : 400;
        log(`finance ${req.method} ${url.pathname} → ${status}: ${e.message}`);
        const { code, message, ...extra } = e; delete extra.stack;
        return json(res, status, { error: { message: e.message, type: status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'invalid_request_error', code: e.code, ...extra } });
      }
      log(`finance ${req.method} ${url.pathname} → 500: ${e && e.stack ? e.stack : e}`);
      return json(res, 500, { error: { message: e instanceof Error ? e.message : String(e), type: 'server_error' } });
    }
  }

  return { handle, store, estado, contexto };
}

module.exports = { createFinanceApi };
