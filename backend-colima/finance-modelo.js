/**
 * finance-modelo.js — domínio do financeiro do meu-bot (produto meu-bot-finance): contas, lançamentos, categorias,
 * favorecidos com categoria aprendida, meses (renda prevista, fechamento). Puro: sem IO, sem relógio implícito
 * (`now` em ms e `hoje` em AAAA-MM-DD vêm por parâmetro), testável com node --test. O finance-store.js persiste; o
 * finance-api.js expõe em /v1/finance/*; o finance/finance.mjs (CLI do agente) e o plugin do WhatsApp só falam HTTP.
 *
 * Valores em centavos inteiros (BRL), gasto negativo e renda positiva. Desenho inspirado no Actual Budget (MIT):
 * favorecido → categoria aprendida na confirmação, deduplicação por valor/favorecido/data próxima, parser de valor
 * que aceita "1.234,56". Tudo em pt-BR.
 */
'use strict';

const KEY_RE = /^[A-Za-z0-9_-]{2,80}$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MES_RE = /^\d{4}-\d{2}$/;
const TIPOS_CONTA = ['corrente', 'poupanca', 'cartao', 'dinheiro', 'outra'];
const ORIGENS = ['whatsapp', 'foto', 'chat', 'app', 'agente'];
const STATUS = ['pendente', 'confirmado'];
const LIMITES = { nome: 80, notas: 500, valorMaxCent: 100_000_000_00 };
/** Até quantos dias de diferença dois lançamentos iguais contam como possível duplicado. */
const DEDUP_DIAS = 2;

class ErroFinance extends Error {
  /** @param {string} code  invalido | nao_encontrado | conflito */
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}
const invalido = (m) => new ErroFinance('invalido', m);

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const str = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const isKey = (k) => typeof k === 'string' && KEY_RE.test(k);
/** Chave nova: prefixo + 12 chars base64url (rnd(n) devolve n bytes). */
const novaChave = (prefixo, rnd) => `${prefixo}_${Buffer.from(rnd(9)).toString('base64url')}`;

// ---- categorias ---------------------------------------------------------------------------------------------------
/** Categorias com que todo financeiro nasce (a pessoa e o agente criam outras). `renda` = entra dinheiro. */
const CATEGORIAS_PADRAO = [
  ['moradia', 'Moradia', 'Casa'], ['contas-da-casa', 'Contas da casa', 'Casa'], ['mercado', 'Mercado', 'Dia a dia'],
  ['alimentacao-fora', 'Alimentação fora', 'Dia a dia'], ['transporte', 'Transporte', 'Dia a dia'], ['saude', 'Saúde', 'Cuidados'],
  ['educacao', 'Educação', 'Cuidados'], ['lazer', 'Lazer', 'Estilo de vida'], ['compras', 'Compras', 'Estilo de vida'],
  ['assinaturas', 'Assinaturas', 'Estilo de vida'], ['impostos-e-taxas', 'Impostos e taxas', 'Obrigações'], ['outros', 'Outros', 'Outros'],
].map(([key, nome, grupo]) => ({ key, nome, grupo, renda: false }))
  // Entradas como retorno do investimento: ganho direto (dinheiro que entrou por causa do trabalho/agente: venda, cliente)
  // e ganho indireto (valor estimado: tempo economizado, custo evitado). Salário e saldo inicial não contam no ROI.
  .concat([['ganho-direto', 'Ganho direto', 'direto'], ['ganho-indireto', 'Ganho indireto', 'indireto']].map(([key, nome, retorno]) => ({ key, nome, grupo: 'Retorno', renda: true, retorno })))
  .concat([['salario', 'Salário'], ['outras-rendas', 'Outras rendas'], ['saldo-inicial', 'Saldo inicial']].map(([key, nome]) => ({ key, nome, grupo: 'Renda', renda: true })));
const CATEGORIA_SEM = 'outros';

/** Acha uma categoria pela chave, pelo nome exato (sem acento) ou pelo começo do nome; null se nada bate. */
function findCategoria(categorias, want) {
  const w = norm(want);
  if (w === '') return null;
  return categorias.find((c) => c.key === want || norm(c.nome) === w) ?? categorias.find((c) => norm(c.nome).startsWith(w)) ?? categorias.find((c) => w.length >= 4 && norm(c.nome).includes(w)) ?? null;
}
function novaCategoria(input, existentes) {
  const nome = str(input?.nome, LIMITES.nome);
  if (nome === '') throw invalido('categoria precisa de nome');
  const key = slug(nome);
  if (key.length < 2) throw invalido('nome de categoria inválido');
  if (existentes.some((c) => c.key === key || norm(c.nome) === norm(nome))) throw new ErroFinance('conflito', `a categoria "${nome}" já existe`);
  return { key, nome, grupo: str(input?.grupo, LIMITES.nome) || (input?.renda === true ? 'Renda' : 'Outros'), renda: input?.renda === true };
}

// ---- valores e datas ------------------------------------------------------------------------------------------------
/**
 * "R$ 1.234,56", "48", "12,5", "1234.56", "48 reais", -12,30 → centavos (inteiro, com sinal). null se não é valor.
 * Vírgula é sempre decimal; ponto é decimal só quando é o único e tem 1 ou 2 casas depois ("1.234" = mil e duzentos).
 */
function parseValorBRL(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v ?? '').toLowerCase().replace(/r\$|reais|real|brl/g, '').replace(/\s+/g, '');
  if (s === '') return null;
  let sinal = 1;
  if (s.startsWith('-')) { sinal = -1; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  let inteiro; let dec = '';
  if (s.includes(',')) {
    const i = s.lastIndexOf(',');
    inteiro = s.slice(0, i).replace(/\./g, ''); dec = s.slice(i + 1);
    if (dec.includes(',') || dec.length > 2) return null;
  } else {
    const pontos = s.split('.').length - 1;
    const depois = s.slice(s.lastIndexOf('.') + 1);
    if (pontos === 1 && depois.length >= 1 && depois.length <= 2) { inteiro = s.slice(0, s.lastIndexOf('.')); dec = depois; }
    else { if (pontos > 0 && !/^\d{1,3}(\.\d{3})+$/.test(s)) return null; inteiro = s.replace(/\./g, ''); }
  }
  if (inteiro === '') inteiro = '0';
  if (!/^\d+$/.test(inteiro) || !/^\d*$/.test(dec)) return null;
  const cent = Number(inteiro) * 100 + Number((dec + '00').slice(0, 2));
  return Number.isSafeInteger(cent) ? sinal * cent : null;
}
/** 4800 → "R$ 48,00"; -123456 → "-R$ 1.234,56". */
function formatBRL(cent) {
  const n = Math.abs(Math.trunc(cent));
  const reais = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cent < 0 ? '-' : ''}R$ ${reais},${String(n % 100).padStart(2, '0')}`;
}
const dataValida = (d) => { if (!DATA_RE.test(d)) return false; const t = Date.parse(`${d}T12:00:00Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d; };
/** AAAA-MM-DD a partir de ms no fuso local da máquina (é o "hoje" da pessoa). */
function hojeDe(now) { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function somaDias(data, n) { const t = Date.parse(`${data}T12:00:00Z`) + n * 86_400_000; return new Date(t).toISOString().slice(0, 10); }
const diasEntre = (a, b) => Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
/**
 * "hoje", "ontem", "anteontem", "21/10", "21/10/2026", "21/10/26", "2026-10-21" → AAAA-MM-DD. dd/mm sem ano usa o
 * ano de `hoje`, ou o anterior se a data cairia no futuro (nota de dezembro lançada em janeiro). null se inválida.
 */
function parseData(v, hoje) {
  const s = norm(v);
  if (s === '' || s === 'hoje') return hoje;
  if (s === 'ontem') return somaDias(hoje, -1);
  if (s === 'anteontem') return somaDias(hoje, -2);
  if (dataValida(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
  if (m === null) return null;
  const dd = m[1].padStart(2, '0'); const mm = m[2].padStart(2, '0');
  let ano = m[3] === undefined ? Number(hoje.slice(0, 4)) : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  let d = `${ano}-${mm}-${dd}`;
  if (m[3] === undefined && d > hoje) { ano -= 1; d = `${ano}-${mm}-${dd}`; }
  return dataValida(d) ? d : null;
}
const mesDe = (data) => data.slice(0, 7);
/** "2026-10" → "outubro de 2026". */
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesPorExtenso = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1] ?? ym} de ${ym.slice(0, 4)}`;
const mesAnterior = (ym) => { let a = Number(ym.slice(0, 4)); let m = Number(ym.slice(5, 7)) - 1; if (m === 0) { m = 12; a -= 1; } return `${a}-${String(m).padStart(2, '0')}`; };
/** "21/10" para mostrar. */
const dataCurta = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

// ---- contas --------------------------------------------------------------------------------------------------------
function novaConta(input, existentes, now, rnd) {
  const nome = str(input?.nome, LIMITES.nome);
  if (nome === '') throw invalido('conta precisa de nome');
  if (existentes.some((c) => !c.fechada && norm(c.nome) === norm(nome))) throw new ErroFinance('conflito', `a conta "${nome}" já existe`);
  const tipo = TIPOS_CONTA.includes(input?.tipo) ? input.tipo : tipoPeloNome(nome);
  const saldo = input?.saldoInicialCent !== undefined ? input.saldoInicialCent : input?.saldoInicial !== undefined ? parseValorBRL(input.saldoInicial) : 0;
  if (!Number.isSafeInteger(saldo) || Math.abs(saldo) > LIMITES.valorMaxCent) throw invalido('saldo inicial inválido');
  return { key: isKey(input?.key) ? input.key : novaChave('c', rnd), nome, tipo, saldoInicialCent: saldo, padrao: existentes.filter((c) => !c.fechada).length === 0 || input?.padrao === true, fechada: false, criadaEm: now, atualizadaEm: now };
}
function tipoPeloNome(nome) {
  const n = norm(nome);
  if (/cart[ao]|credito|nubank card|fatura/.test(n)) return 'cartao';
  if (/poupanca|reserva|caixinha/.test(n)) return 'poupanca';
  if (/dinheiro|carteira|especie/.test(n)) return 'dinheiro';
  return 'corrente';
}
function patchConta(cur, patch, outras, now) {
  const out = { ...cur, atualizadaEm: now };
  if (patch.nome !== undefined) { const n = str(patch.nome, LIMITES.nome); if (n === '') throw invalido('conta precisa de nome'); if (outras.some((c) => c.key !== cur.key && !c.fechada && norm(c.nome) === norm(n))) throw new ErroFinance('conflito', `a conta "${n}" já existe`); out.nome = n; }
  if (patch.tipo !== undefined) { if (!TIPOS_CONTA.includes(patch.tipo)) throw invalido(`tipo de conta inválido (${TIPOS_CONTA.join(', ')})`); out.tipo = patch.tipo; }
  if (patch.saldoInicialCent !== undefined || patch.saldoInicial !== undefined) { const s = patch.saldoInicialCent ?? parseValorBRL(patch.saldoInicial); if (!Number.isSafeInteger(s)) throw invalido('saldo inicial inválido'); out.saldoInicialCent = s; }
  if (patch.fechada !== undefined) out.fechada = patch.fechada === true;
  if (patch.padrao === true) out.padrao = true;
  return out;
}
/** Conta a usar quando ninguém disse qual: a padrão aberta, senão a única aberta, senão null (lança sem conta). */
function contaPadrao(contas) { const abertas = contas.filter((c) => !c.fechada); return abertas.find((c) => c.padrao) ?? (abertas.length === 1 ? abertas[0] : null); }
function findConta(contas, want) {
  const w = norm(want);
  if (w === '') return null;
  const abertas = contas.filter((c) => !c.fechada);
  return abertas.find((c) => c.key === want || norm(c.nome) === w) ?? abertas.find((c) => norm(c.nome).startsWith(w)) ?? abertas.find((c) => w.length >= 3 && norm(c.nome).includes(w)) ?? null;
}

// ---- favorecidos (quem recebeu ou pagou) ---------------------------------------------------------------------------
/** Nome limpo de favorecido: "  pão  de açúcar " → "Pão de açúcar" (mantém o que a pessoa escreveu, só arruma). */
function nomeFavorecido(v) { const s = str(v, LIMITES.nome); return s === '' ? '' : s.charAt(0).toUpperCase() + s.slice(1); }
const favorecidoKey = (nome) => slug(nome);
/** Categoria aprendida para um favorecido (exato pela chave; senão um favorecido conhecido contido no nome). */
function categoriaAprendida(favorecidos, nome) {
  const k = favorecidoKey(nome);
  if (k === '') return null;
  const exato = favorecidos.find((f) => f.key === k);
  if (exato?.categoria) return exato.categoria;
  const contido = favorecidos.filter((f) => f.categoria && f.key.length >= 4 && (k.includes(f.key) || f.key.includes(k))).sort((a, b) => b.key.length - a.key.length)[0];
  return contido?.categoria ?? null;
}
/** Registra/atualiza o favorecido; `categoria` só é gravada quando veio de confirmação (aprendizado). */
function aprender(favorecidos, nome, categoria, now) {
  const n = nomeFavorecido(nome); const key = favorecidoKey(n);
  if (key === '') return null;
  const cur = favorecidos.find((f) => f.key === key);
  return { key, nome: cur?.nome ?? n, categoria: categoria ?? cur?.categoria ?? null, usos: (cur?.usos ?? 0) + 1, atualizadoEm: now };
}

// ---- sementes: palavra no favorecido → categoria (só quando a pessoa ainda não ensinou nada) --------------------------
const SEMENTES = [
  [/supermerc|mercad|atacad|assai|carrefour|pao de acucar|extra hiper|hortifrut|sacolao|acougue/, 'mercado'],
  [/ifood|rappi|restaurante|lanchonete|padaria|pizzar|hamburg|bar |cafe|cafeteria|delivery|sushi|burger/, 'alimentacao-fora'],
  [/uber|^99|99 ?app|99pop|taxi|onibus|metro|posto|combustivel|gasolina|estacionamento|pedagio|sem parar|bilhete unico/, 'transporte'],
  [/farmacia|drogaria|droga ?raia|drogasil|pague menos|hospital|clinica|laboratorio|medic|dentista|plano de saude|unimed|amil/, 'saude'],
  [/netflix|spotify|prime video|amazon prime|disney|hbo|max |youtube premium|deezer|globoplay|icloud|google one|chatgpt|claude/, 'assinaturas'],
  [/aluguel|condominio|iptu|imobiliaria/, 'moradia'],
  [/\bluz\b|energia|enel|light|cemig|copel|celesc|agua|sabesp|cedae|internet|vivo|claro|tim\b|oi fibra|\bgas\b|comgas/, 'contas-da-casa'],
  [/escola|faculdade|curso|mensalidade|udemy|alura|livraria/, 'educacao'],
  [/cinema|show|ingresso|viagem|hotel|airbnb|passagem/, 'lazer'],
  [/shopee|mercado livre|amazon|magalu|magazine|americanas|shein|aliexpress|loja|renner|riachuelo|c&a|zara/, 'compras'],
  [/darf|imposto|taxa|tarifa|anuidade|iof|multa|detran|ipva/, 'impostos-e-taxas'],
  [/salario|holerite|pagamento empresa|folha/, 'salario'],
];
/** Categoria sugerida pela semente (null se nada bate). O nome é normalizado: minúsculas, sem acento. */
function categoriaSemente(nome) { const n = norm(nome); if (n === '') return null; for (const [re, cat] of SEMENTES) if (re.test(n)) return cat; return null; }

// ---- lançamentos ----------------------------------------------------------------------------------------------------
/**
 * Lançamento novo a partir do que o agente, o app ou o WhatsApp mandaram. `input`: valor (texto pt-BR ou número em
 * reais) ou valorCent; tipo "gasto" (padrão) | "renda"; favorecido; categoria (chave ou nome); conta (chave ou nome);
 * data; notas; origem; status; confianca (0..1, quem adivinhou a categoria); midia {sha256, nome}.
 * Status: o pedido explícito vale; senão foto ou categoria incerta nascem "pendente" (a pessoa confirma), o resto
 * "confirmado". Categoria: a pedida, senão a aprendida do favorecido, senão "outros" (pendente).
 */
function novoLancamento(input, ctx) {
  const { contas, categorias, favorecidos, now, rnd, hoje } = ctx;
  let cent = input?.valorCent !== undefined ? input.valorCent : parseValorBRL(input?.valor);
  if (!Number.isSafeInteger(cent) || cent === 0) throw invalido('valor inválido: diga quanto foi, ex.: 48,90');
  if (Math.abs(cent) > LIMITES.valorMaxCent) throw invalido('valor alto demais');
  const tipo = input?.tipo === 'renda' ? 'renda' : input?.tipo === 'gasto' || input?.tipo === undefined ? 'gasto' : null;
  if (tipo === null) throw invalido('tipo inválido (gasto ou renda)');
  // Sem sinal explícito, o tipo decide; com sinal no valor, o sinal decide (estorno de cartão = gasto positivo).
  if (input?.valorCent === undefined && !/^\s*[-+]/.test(String(input?.valor ?? ''))) cent = tipo === 'renda' ? Math.abs(cent) : -Math.abs(cent);
  const data = input?.data === undefined || input?.data === null ? hoje : parseData(input.data, hoje);
  if (data === null) throw invalido('data inválida: use dd/mm, dd/mm/aaaa, hoje ou ontem');
  const favorecido = nomeFavorecido(input?.favorecido);
  let conta = null;
  if (typeof input?.conta === 'string' && input.conta.trim() !== '') { conta = findConta(contas, input.conta); if (conta === null) throw new ErroFinance('nao_encontrado', `não achei a conta "${input.conta}"`, { contas: contas.filter((c) => !c.fechada).map((c) => c.nome) }); }
  else if (input?.formaPagamento === 'cartao' || input?.formaPagamento === 'dinheiro') conta = contas.find((c) => !c.fechada && c.tipo === input.formaPagamento) ?? contaPadrao(contas);
  else conta = contaPadrao(contas);
  let categoria = null; let certa = false; const duvidas = [];
  if (typeof input?.categoria === 'string' && input.categoria.trim() !== '') {
    const c = findCategoria(categorias, input.categoria);
    if (c === null) throw new ErroFinance('nao_encontrado', `não achei a categoria "${input.categoria}"`, { categorias: categorias.map((x) => x.nome) });
    categoria = c.key; certa = !(typeof input.confianca === 'number' && input.confianca < 0.7);
  } else {
    const aprendida = categoriaAprendida(favorecidos, favorecido);
    const semente = categoriaSemente(favorecido);
    // "gastei 48 no mercado": o lugar já é o nome de uma categoria; não há o que perguntar.
    const exata = categorias.find((c) => norm(c.nome) === norm(favorecido) && c.renda === (tipo === 'renda'));
    if (aprendida !== null && categorias.some((c) => c.key === aprendida)) { categoria = aprendida; certa = true; }
    else if (exata !== undefined) { categoria = exata.key; certa = true; }
    // A semente acerta o grupo, mas a pessoa ainda não ensinou: sugere e deixa para confirmar.
    else if (semente !== null && categorias.some((c) => c.key === semente && c.renda === (tipo === 'renda'))) categoria = semente;
    else categoria = tipo === 'renda' ? (input?.retorno === 'indireto' ? 'ganho-indireto' : 'ganho-direto') : CATEGORIA_SEM;
  }
  if (!certa) duvidas.push('categoria');
  if (conta === null && contas.some((c) => !c.fechada)) duvidas.push('conta');
  const origem = ORIGENS.includes(input?.origem) ? input.origem : 'app';
  if (origem === 'foto') duvidas.push('valor');
  const status = STATUS.includes(input?.status) ? input.status : duvidas.length > 0 ? 'pendente' : 'confirmado';
  const midia = input?.midia && typeof input.midia === 'object' && /^[0-9a-f]{64}$/.test(String(input.midia.sha256 ?? '')) ? { sha256: input.midia.sha256, nome: str(input.midia.nome, 120) || 'comprovante' } : undefined;
  return {
    id: novaChave('l', rnd), data, valorCent: cent, favorecido, categoria, conta: conta?.key ?? null, notas: str(input?.notas, LIMITES.notas),
    origem, status, duvidas: status === 'pendente' ? duvidas : [], ...(typeof input?.confianca === 'number' ? { confianca: Math.max(0, Math.min(1, input.confianca)) } : {}), ...(midia ? { midia } : {}),
    criadoEm: now, atualizadoEm: now,
  };
}
function patchLancamento(cur, patch, ctx) {
  const { contas, categorias, hoje, now } = ctx;
  const out = { ...cur, atualizadoEm: now };
  if (patch.valor !== undefined || patch.valorCent !== undefined) {
    let c = patch.valorCent ?? parseValorBRL(patch.valor);
    if (!Number.isSafeInteger(c) || c === 0) throw invalido('valor inválido');
    if (patch.valorCent === undefined && !/^\s*[-+]/.test(String(patch.valor))) c = cur.valorCent < 0 ? -Math.abs(c) : Math.abs(c);
    out.valorCent = c;
  }
  if (patch.data !== undefined) { const d = parseData(patch.data, hoje); if (d === null) throw invalido('data inválida'); out.data = d; }
  if (patch.favorecido !== undefined) out.favorecido = nomeFavorecido(patch.favorecido);
  if (patch.categoria !== undefined) { const c = findCategoria(categorias, patch.categoria); if (c === null) throw new ErroFinance('nao_encontrado', `não achei a categoria "${patch.categoria}"`, { categorias: categorias.map((x) => x.nome) }); out.categoria = c.key; }
  if (patch.conta !== undefined) { if (patch.conta === null || patch.conta === '') out.conta = null; else { const c = findConta(contas, patch.conta); if (c === null) throw new ErroFinance('nao_encontrado', `não achei a conta "${patch.conta}"`); out.conta = c.key; } }
  if (patch.notas !== undefined) out.notas = str(patch.notas, LIMITES.notas);
  if (patch.status !== undefined) { if (!STATUS.includes(patch.status)) throw invalido('status inválido'); out.status = patch.status; }
  if (out.status === 'confirmado') out.duvidas = [];
  return out;
}
/** Possível duplicado: mesmo valor, mesmo favorecido (ou os dois sem), data a até DEDUP_DIAS dias. Devolve o id ou null. */
function duplicadoDe(l, existentes) {
  const k = favorecidoKey(l.favorecido);
  const d = existentes.find((x) => x.id !== l.id && x.valorCent === l.valorCent && favorecidoKey(x.favorecido) === k && diasEntre(x.data, l.data) <= DEDUP_DIAS);
  return d?.id ?? null;
}

// ---- contas e meses: números --------------------------------------------------------------------------------------
function saldoConta(conta, lancamentos) { return conta.saldoInicialCent + lancamentos.filter((l) => l.conta === conta.key).reduce((s, l) => s + l.valorCent, 0); }
/** Resumo de um mês: gastos e renda (centavos), saldo do mês, por categoria (maior gasto primeiro), pendências. */
function resumoMes(lancamentos, categorias, ym) {
  const doMes = lancamentos.filter((l) => mesDe(l.data) === ym);
  const porCat = new Map();
  let gastos = 0; let renda = 0;
  for (const l of doMes) {
    if (l.valorCent < 0) gastos += -l.valorCent; else renda += l.valorCent;
    porCat.set(l.categoria, (porCat.get(l.categoria) ?? 0) + l.valorCent);
  }
  const nomeCat = (k) => categorias.find((c) => c.key === k)?.nome ?? k;
  // Retorno do investimento: entradas em categorias de retorno; ROI = (retorno − gastos) / gastos.
  const retornoDe = (k) => categorias.find((c) => c.key === k)?.retorno;
  let direto = 0; let indireto = 0;
  for (const l of doMes) if (l.valorCent > 0) { const r = retornoDe(l.categoria); if (r === 'direto') direto += l.valorCent; else if (r === 'indireto') indireto += l.valorCent; }
  const porCategoria = [...porCat.entries()].map(([key, cent]) => ({ key, nome: nomeCat(key), cent })).sort((a, b) => a.cent - b.cent);
  return { mes: ym, gastosCent: gastos, rendaCent: renda, saldoCent: renda - gastos, porCategoria, total: doMes.length, pendencias: doMes.filter((l) => l.status === 'pendente').length, ...retornoResumo(gastos, direto, indireto) };
}
/** ROI em % (inteiro) do investimento: só com o ganho direto (realizado) e com direto + indireto (perspectiva). Sem gasto, null. */
function retornoResumo(gastosCent, diretoCent, indiretoCent) {
  const roi = (r) => (gastosCent > 0 ? Math.round(((r - gastosCent) / gastosCent) * 100) : null);
  return { ganhoDiretoCent: diretoCent, ganhoIndiretoCent: indiretoCent, ganhosCent: diretoCent + indiretoCent, roiDireto: roi(diretoCent), roiTotal: roi(diretoCent + indiretoCent) };
}
/** Uma linha curta do lançamento, para o agente e o WhatsApp: "21/10 · Mercado · Pão de açúcar · -R$ 48,00 (pendente)". */
function linhaLancamento(l, categorias, contas = []) {
  const cat = categorias.find((c) => c.key === l.categoria)?.nome ?? l.categoria;
  const conta = l.conta ? contas.find((c) => c.key === l.conta)?.nome : null;
  const fav = l.favorecido && norm(l.favorecido) !== norm(cat) ? ` · ${l.favorecido}` : '';
  return `${dataCurta(l.data)} · ${cat}${fav} · ${formatBRL(l.valorCent)}${conta ? ` · ${conta}` : ''}${l.status === 'pendente' ? ' (pendente)' : ''}`;
}

module.exports = {
  KEY_RE, MES_RE, TIPOS_CONTA, ORIGENS, STATUS, LIMITES, DEDUP_DIAS, CATEGORIAS_PADRAO, CATEGORIA_SEM,
  ErroFinance, norm, slug, isKey, novaChave,
  findCategoria, novaCategoria,
  parseValorBRL, formatBRL, parseData, hojeDe, somaDias, diasEntre, mesDe, mesPorExtenso, mesAnterior, dataCurta,
  novaConta, patchConta, contaPadrao, findConta, tipoPeloNome,
  nomeFavorecido, favorecidoKey, categoriaAprendida, aprender, categoriaSemente,
  novoLancamento, patchLancamento, duplicadoDe,
  saldoConta, resumoMes, retornoResumo, linhaLancamento,
};
