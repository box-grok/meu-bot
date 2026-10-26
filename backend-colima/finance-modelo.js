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
const ORIGENS = ['whatsapp', 'foto', 'chat', 'app', 'agente', 'planilha'];
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

// ---- linhas previstas (a DRE projetada) --------------------------------------------------------------------------
/**
 * Uma linha prevista do mês, recorrente até mudar: um custo que certamente vai existir ("Plano Claude Code") ou uma fonte
 * de ganho (direto: receita; indireto: tempo poupado, ferramenta que deixou de pagar). `valorMensalCent` null = a definir
 * (a linha aparece mesmo sem valor). Lançamentos se ligam a uma linha pelo campo `linha` para ter o realizado dela.
 */
const TIPOS_LINHA = ['custo', 'ganho-direto', 'ganho-indireto'];
/** Linhas com que todo financeiro nasce: custos obrigatórios do produto. A pessoa pode editar o valor; se apagar, não volta. */
const LINHAS_PADRAO = [
  { key: 'plano-claude-code', nome: 'Plano Claude Code (assinatura com a gente)', tipo: 'custo', valorMensalCent: null, notas: 'Obrigatório: a infraestrutura do agente é nossa, então o plano do Claude Code é assinado conosco (parceiros não têm outra opção).' },
];
function novaLinha(input, existentes, now) {
  const nome = str(input?.nome, LIMITES.nome);
  if (nome === '') throw invalido('a linha precisa de nome');
  const tipo = TIPOS_LINHA.includes(input?.tipo) ? input.tipo : null;
  if (tipo === null) throw invalido(`tipo de linha inválido (${TIPOS_LINHA.join(', ')})`);
  const key = isKey(input?.key) ? input.key : slug(nome).slice(0, 60);
  if (key.length < 2) throw invalido('nome de linha inválido');
  if (existentes.some((l) => l.key === key)) throw new ErroFinance('conflito', `a linha "${nome}" já existe`);
  return { key, nome, tipo, valorMensalCent: valorLinha(input?.valor ?? input?.valorMensal ?? null), notas: str(input?.notas, LIMITES.notas), criadaEm: now, atualizadaEm: now };
}
/** "a definir", "", null → null; "0" → 0; "97,00" → 9700. */
function valorLinha(v) {
  if (v === null || v === undefined || (typeof v === 'string' && /^\s*(a definir|-|)\s*$/i.test(v))) return null;
  const c = parseValorBRL(v);
  if (c === null || c < 0) throw invalido('valor da linha inválido: use um valor mensal (ex.: 97,00), 0 ou "a definir"');
  return c;
}
function patchLinha(cur, patch, now) {
  const out = { ...cur, atualizadaEm: now };
  if (patch.nome !== undefined) { const n = str(patch.nome, LIMITES.nome); if (n === '') throw invalido('a linha precisa de nome'); out.nome = n; }
  if (patch.tipo !== undefined) { if (!TIPOS_LINHA.includes(patch.tipo)) throw invalido('tipo de linha inválido'); out.tipo = patch.tipo; }
  if (patch.valor !== undefined) out.valorMensalCent = valorLinha(patch.valor);
  if (patch.notas !== undefined) out.notas = str(patch.notas, LIMITES.notas);
  return out;
}
const findLinha = (linhas, want) => { const w = norm(want); if (w === '') return null; return linhas.find((l) => l.key === want || norm(l.nome) === w) ?? linhas.find((l) => norm(l.nome).startsWith(w)) ?? linhas.find((l) => w.length >= 4 && norm(l.nome).includes(w)) ?? null; };

// ---- valores e datas ------------------------------------------------------------------------------------------------
// ---- moedas ---------------------------------------------------------------------------------------------------------
/**
 * Multi-moeda: cada conta tem uma moeda (BRL, PYG guaraní, USD dólar); o lançamento guarda o valor na moeda da conta
 * (minor units = valor × 10^casas; BRL/USD = 2 casas, PYG = 0) e, se a pessoa falou em outra moeda, o original em
 * `valorOriginalCent`/`moedaOriginal`. A camada de padronização (US$ por padrão) converte pelas `taxas` que o usuário
 * define (unidades por 1 US$), sem buscar cotação na internet.
 */
const MOEDAS = ['BRL', 'PYG', 'USD'];
const MOEDA_INFO = { BRL: { casas: 2, simbolo: 'R$' }, PYG: { casas: 0, simbolo: '₲' }, USD: { casas: 2, simbolo: 'US$' } };
const MOEDA_PADRAO = 'BRL';
// Moeda de exibição padrão = a mesma dos lançamentos (real), para não surpreender quem já usa. Cada sistema troca na
// config (a LV usa dólar). Assim um financeiro só em real nunca depende de taxa.
const MOEDA_EXIB_PADRAO = 'BRL';
/** Taxas iniciais plausíveis (unidades por 1 US$); o usuário ajusta na config. */
const TAXAS_PADRAO = { USD: 1, BRL: 5, PYG: 7300 };
const moedaValida = (m) => MOEDAS.includes(m);
const casasDe = (m) => (MOEDA_INFO[m] ?? MOEDA_INFO.BRL).casas;
const simboloDe = (m) => (MOEDA_INFO[m] ?? MOEDA_INFO.BRL).simbolo;
const multDe = (m) => 10 ** casasDe(m);
const TETO_VALOR_WHOLE = 1e11; // teto por lançamento, em unidades inteiras da moeda (≈ 100 bi)
const valorAltoDemais = (cent, moeda) => Math.abs(cent) / multDe(moeda) > TETO_VALOR_WHOLE;
/** Taxa (unidades por 1 US$) da moeda; cai no padrão se ausente ou inválida. */
const taxaDe = (taxas, m) => { const t = taxas && taxas[m]; return (typeof t === 'number' && t > 0) ? t : (TAXAS_PADRAO[m] ?? 1); };
/** Normaliza o objeto de taxas vindo do usuário: só moedas válidas, números > 0; completa com o padrão. */
function taxasNormalizadas(taxas) {
  const out = { ...TAXAS_PADRAO };
  if (taxas && typeof taxas === 'object') for (const m of MOEDAS) { const t = taxas[m]; if (typeof t === 'number' && Number.isFinite(t) && t > 0) out[m] = t; }
  out.USD = 1; // o dólar é a âncora
  return out;
}
/** Detecta a moeda pelos símbolos/palavras no texto; null se não houver marca. */
const RE_MOEDA = [['USD', /us\$|u\$s|\busd\b|d[óo]lar(es)?|dollars?/], ['PYG', /₲|\bgs\b|guaran[íi]?(es|s)?|\bpyg\b/], ['BRL', /r\$|\breais\b|\breal\b|\bbrl\b/]];
function detectarMoeda(texto) { const t = String(texto ?? '').toLowerCase(); for (const [m, re] of RE_MOEDA) if (re.test(t)) return m; return null; }
const stripMoeda = (s) => s.replace(/us\$|u\$s|usd|d[óo]lar(es)?|dollars?|₲|\bgs\b|guaran[íi]?(es|s)?|pyg|r\$|reais|real|brl/g, '');
/** Núcleo numérico pt-BR com `casas` decimais: "1.234,56"/"1234.56"/"48". Devolve minor units (× 10^casas), com sinal. */
function parseMinor(s, casas) {
  let sinal = 1;
  if (s.startsWith('-')) { sinal = -1; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  let inteiro; let dec = '';
  if (s.includes(',')) {
    const i = s.lastIndexOf(',');
    inteiro = s.slice(0, i).replace(/\./g, ''); dec = s.slice(i + 1);
    if (dec.includes(',') || dec.length > casas) return null;
  } else {
    const pontos = s.split('.').length - 1;
    const depois = s.slice(s.lastIndexOf('.') + 1);
    if (casas > 0 && pontos === 1 && depois.length >= 1 && depois.length <= casas) { inteiro = s.slice(0, s.lastIndexOf('.')); dec = depois; }
    else { if (pontos > 0 && !/^\d{1,3}(\.\d{3})+$/.test(s)) return null; inteiro = s.replace(/\./g, ''); }
  }
  if (inteiro === '') inteiro = '0';
  if (!/^\d+$/.test(inteiro) || !/^\d*$/.test(dec)) return null;
  const mult = 10 ** casas;
  const minor = Number(inteiro) * mult + (casas > 0 ? Number((dec + '0'.repeat(casas)).slice(0, casas)) : 0);
  return Number.isSafeInteger(minor) ? sinal * minor : null;
}
/**
 * Valor com moeda. Detecta a moeda pelo texto ("paguei ₲50.000", "US$ 20", "R$ 48,90"); sem marca, usa `moedaPadrao`
 * (a da conta). Número puro vira valor na moedaPadrao. Devolve { valorCent, moeda } ou null.
 */
function parseValor(v, moedaPadrao = MOEDA_PADRAO) {
  const padrao = moedaValida(moedaPadrao) ? moedaPadrao : MOEDA_PADRAO;
  if (typeof v === 'number') return Number.isFinite(v) ? { valorCent: Math.round(v * multDe(padrao)), moeda: padrao } : null;
  const txt = String(v ?? '').toLowerCase();
  const moeda = detectarMoeda(txt) ?? padrao;
  const s = stripMoeda(txt).replace(/\s+/g, '');
  if (s === '') return null;
  const cent = parseMinor(s, casasDe(moeda));
  return cent === null ? null : { valorCent: cent, moeda };
}
/** "R$ 1.234,56", "48", "48 reais", -12,30 → centavos BRL (compat: só real). null se não é valor. */
function parseValorBRL(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = String(v ?? '').toLowerCase().replace(/r\$|reais|real|brl/g, '').replace(/\s+/g, '');
  return s === '' ? null : parseMinor(s, 2);
}
/** Minor units → texto na moeda: 4800/BRL → "R$ 48,00"; 10000000/PYG → "₲ 10.000.000"; -2000/USD → "-US$ 20,00". */
function formatMoeda(cent, moeda) {
  const casas = casasDe(moeda); const mult = 10 ** casas;
  const n = Math.abs(Math.trunc(cent));
  const inteiro = String(Math.floor(n / mult)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = casas > 0 ? `,${String(n % mult).padStart(casas, '0')}` : '';
  return `${cent < 0 ? '-' : ''}${simboloDe(moeda)} ${inteiro}${dec}`;
}
/** Compat BRL. */
const formatBRL = (cent) => formatMoeda(cent, 'BRL');
/** Converte `cent` (minor units de `moedaOrig`) para minor units de `moedaExib`, pelas taxas (unidades por 1 US$). */
function paraExib(cent, moedaOrig, taxas, moedaExib) {
  const mo = moedaValida(moedaOrig) ? moedaOrig : MOEDA_PADRAO;
  const me = moedaValida(moedaExib) ? moedaExib : MOEDA_EXIB_PADRAO;
  if (mo === me) return Math.trunc(cent);
  const wholeOrig = cent / multDe(mo);
  const wholeUsd = wholeOrig / taxaDe(taxas, mo);
  return Math.round(wholeUsd * taxaDe(taxas, me) * multDe(me));
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
  const moeda = moedaValida(input?.moeda) ? input.moeda : MOEDA_PADRAO;
  const saldo = input?.saldoInicialCent !== undefined ? input.saldoInicialCent : input?.saldoInicial !== undefined ? (parseValor(input.saldoInicial, moeda)?.valorCent ?? null) : 0;
  if (!Number.isSafeInteger(saldo) || valorAltoDemais(saldo, moeda)) throw invalido('saldo inicial inválido');
  return { key: isKey(input?.key) ? input.key : novaChave('c', rnd), nome, tipo, moeda, saldoInicialCent: saldo, padrao: existentes.filter((c) => !c.fechada).length === 0 || input?.padrao === true, fechada: false, criadaEm: now, atualizadaEm: now };
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
  if (patch.moeda !== undefined) { if (!moedaValida(patch.moeda)) throw invalido(`moeda inválida (${MOEDAS.join(', ')})`); out.moeda = patch.moeda; }
  if (patch.saldoInicialCent !== undefined || patch.saldoInicial !== undefined) { const s = patch.saldoInicialCent ?? parseValor(patch.saldoInicial, out.moeda ?? MOEDA_PADRAO)?.valorCent; if (!Number.isSafeInteger(s)) throw invalido('saldo inicial inválido'); out.saldoInicialCent = s; }
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
  const tipo = input?.tipo === 'renda' ? 'renda' : input?.tipo === 'gasto' || input?.tipo === undefined ? 'gasto' : null;
  if (tipo === null) throw invalido('tipo inválido (gasto ou renda)');
  const data = input?.data === undefined || input?.data === null ? hoje : parseData(input.data, hoje);
  if (data === null) throw invalido('data inválida: use dd/mm, dd/mm/aaaa, hoje ou ontem');
  const favorecido = nomeFavorecido(input?.favorecido);
  let conta = null;
  if (typeof input?.conta === 'string' && input.conta.trim() !== '') { conta = findConta(contas, input.conta); if (conta === null) throw new ErroFinance('nao_encontrado', `não achei a conta "${input.conta}"`, { contas: contas.filter((c) => !c.fechada).map((c) => c.nome) }); }
  else if (input?.formaPagamento === 'cartao' || input?.formaPagamento === 'dinheiro') conta = contas.find((c) => !c.fechada && c.tipo === input.formaPagamento) ?? contaPadrao(contas);
  else conta = contaPadrao(contas);
  // Valor na moeda da conta; se a pessoa falou em outra moeda ("₲50.000" numa conta BRL), converte e guarda o original.
  const moedaDefault = conta?.moeda ?? (moedaValida(input?.moeda) ? input.moeda : MOEDA_PADRAO);
  const parsed = input?.valorCent !== undefined ? { valorCent: input.valorCent, moeda: moedaValida(input?.moeda) ? input.moeda : moedaDefault } : parseValor(input?.valor, moedaDefault);
  if (parsed === null || !Number.isSafeInteger(parsed.valorCent) || parsed.valorCent === 0) throw invalido('valor inválido: diga quanto foi, ex.: 48,90');
  let cent = parsed.valorCent; const moeda = conta ? conta.moeda : parsed.moeda; let original;
  if (conta && parsed.moeda !== conta.moeda) { original = { valorOriginalCent: parsed.valorCent, moedaOriginal: parsed.moeda }; cent = paraExib(parsed.valorCent, parsed.moeda, ctx.taxas, conta.moeda); }
  if (valorAltoDemais(cent, moeda)) throw invalido('valor alto demais');
  // Sem sinal explícito, o tipo decide; com sinal no valor, o sinal decide (estorno de cartão = gasto positivo).
  if (input?.valorCent === undefined && !/^\s*[-+]/.test(String(input?.valor ?? ''))) cent = tipo === 'renda' ? Math.abs(cent) : -Math.abs(cent);
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
  let linha = null;
  if (typeof input?.linha === 'string' && input.linha.trim() !== '') { const ln = findLinha(ctx.linhas ?? [], input.linha); if (ln === null) throw new ErroFinance('nao_encontrado', `não achei a linha "${input.linha}" da DRE`, { linhas: (ctx.linhas ?? []).map((x) => x.nome) }); linha = ln.key; }
  const origem = ORIGENS.includes(input?.origem) ? input.origem : 'app';
  if (origem === 'foto') duvidas.push('valor');
  const status = STATUS.includes(input?.status) ? input.status : duvidas.length > 0 ? 'pendente' : 'confirmado';
  const midia = input?.midia && typeof input.midia === 'object' && /^[0-9a-f]{64}$/.test(String(input.midia.sha256 ?? '')) ? { sha256: input.midia.sha256, nome: str(input.midia.nome, 120) || 'comprovante' } : undefined;
  return {
    id: novaChave('l', rnd), data, valorCent: cent, moeda, ...(original ?? {}), favorecido, categoria, conta: conta?.key ?? null, notas: str(input?.notas, LIMITES.notas),
    ...(linha ? { linha } : {}), ...(typeof input?.ref === 'string' && input.ref.trim() !== '' ? { ref: str(input.ref, 300) } : {}), origem, status, duvidas: status === 'pendente' ? duvidas : [], ...(typeof input?.confianca === 'number' ? { confianca: Math.max(0, Math.min(1, input.confianca)) } : {}), ...(midia ? { midia } : {}),
    criadoEm: now, atualizadoEm: now,
  };
}
function patchLancamento(cur, patch, ctx) {
  const { contas, categorias, hoje, now } = ctx;
  const out = { ...cur, atualizadoEm: now };
  if (patch.valor !== undefined || patch.valorCent !== undefined) {
    let c = patch.valorCent ?? parseValor(patch.valor, cur.moeda ?? MOEDA_PADRAO)?.valorCent;
    if (!Number.isSafeInteger(c) || c === 0) throw invalido('valor inválido');
    if (patch.valorCent === undefined && !/^\s*[-+]/.test(String(patch.valor))) c = cur.valorCent < 0 ? -Math.abs(c) : Math.abs(c);
    out.valorCent = c;
  }
  if (patch.data !== undefined) { const d = parseData(patch.data, hoje); if (d === null) throw invalido('data inválida'); out.data = d; }
  if (patch.favorecido !== undefined) out.favorecido = nomeFavorecido(patch.favorecido);
  if (patch.categoria !== undefined) { const c = findCategoria(categorias, patch.categoria); if (c === null) throw new ErroFinance('nao_encontrado', `não achei a categoria "${patch.categoria}"`, { categorias: categorias.map((x) => x.nome) }); out.categoria = c.key; }
  if (patch.conta !== undefined) { if (patch.conta === null || patch.conta === '') out.conta = null; else { const c = findConta(contas, patch.conta); if (c === null) throw new ErroFinance('nao_encontrado', `não achei a conta "${patch.conta}"`); out.conta = c.key; } }
  if (patch.notas !== undefined) out.notas = str(patch.notas, LIMITES.notas);
  if (patch.linha !== undefined) { if (patch.linha === null || patch.linha === '') delete out.linha; else { const ln = findLinha(ctx.linhas ?? [], patch.linha); if (ln === null) throw new ErroFinance('nao_encontrado', `não achei a linha "${patch.linha}" da DRE`); out.linha = ln.key; } }
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
function resumoMes(lancamentos, categorias, ym, conv = null) {
  // `conv` = { taxas, moedaExib }: converte cada lançamento para a moeda de exibição antes de somar (moedas diferentes
  // não somam cruas). Sem conv, assume que tudo está na mesma moeda (compat).
  const toExib = conv ? (l) => paraExib(l.valorCent, l.moeda ?? MOEDA_PADRAO, conv.taxas, conv.moedaExib) : (l) => l.valorCent;
  const doMes = lancamentos.filter((l) => mesDe(l.data) === ym);
  const porCat = new Map();
  let gastos = 0; let renda = 0;
  for (const l of doMes) {
    const v = toExib(l);
    if (v < 0) gastos += -v; else renda += v;
    porCat.set(l.categoria, (porCat.get(l.categoria) ?? 0) + v);
  }
  const nomeCat = (k) => categorias.find((c) => c.key === k)?.nome ?? k;
  // Retorno do investimento: entradas em categorias de retorno; ROI = (retorno − gastos) / gastos.
  const retornoDe = (k) => categorias.find((c) => c.key === k)?.retorno;
  let direto = 0; let indireto = 0;
  for (const l of doMes) { const v = toExib(l); if (v > 0) { const r = retornoDe(l.categoria); if (r === 'direto') direto += v; else if (r === 'indireto') indireto += v; } }
  const porCategoria = [...porCat.entries()].map(([key, cent]) => ({ key, nome: nomeCat(key), cent })).sort((a, b) => a.cent - b.cent);
  return { mes: ym, gastosCent: gastos, rendaCent: renda, saldoCent: renda - gastos, porCategoria, total: doMes.length, pendencias: doMes.filter((l) => l.status === 'pendente').length, ...retornoResumo(gastos, direto, indireto) };
}
// ---- importação de planilha (Google Sheets) -------------------------------------------------------------------------
/**
 * Linhas de uma planilha → entradas de lançamento. `valores` = matriz de células (a 1ª linha com "data", "valor" e um
 * nome — fornecedor/favorecido/cliente/nome/descrição — é o cabeçalho; linhas acima dele são ignoradas). Colunas
 * opcionais: categoria, tipo (compra/gasto/saída ou venda/renda/entrada), notas. Linha vazia é pulada; linha sem data,
 * nome ou valor vira erro com o número da linha (1 = primeira linha da planilha). `ref` identifica a linha para não
 * importar duas vezes: fonte + data + favorecido + valor + ocorrência (duas linhas idênticas são duas compras).
 */
const COLS_PLANILHA = {
  data: ['data', 'dia', 'date', 'fecha'],
  favorecido: ['fornecedor', 'favorecido', 'cliente', 'nome', 'descricao', 'descrição', 'proveedor', 'loja', 'empresa'],
  valor: ['valor', 'total', 'preco', 'preço', 'valor total', 'monto', 'importe'],
  categoria: ['categoria', 'category', 'grupo'],
  tipo: ['tipo', 'operacao', 'operação', 'movimento'],
  notas: ['notas', 'obs', 'observacao', 'observação', 'observacoes', 'observações', 'produto', 'produtos', 'descricao do item'],
};
function linhasDePlanilha(valores, { fonte = 'planilha', tipoPadrao = 'gasto' } = {}) {
  const rows = Array.isArray(valores) ? valores.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : [])) : [];
  const achar = (cab, nomes) => cab.findIndex((c) => nomes.includes(norm(c)));
  let h = -1; let col = null;
  for (let i = 0; i < Math.min(rows.length, 20) && h < 0; i++) {
    const cab = rows[i]; const c = Object.fromEntries(Object.entries(COLS_PLANILHA).map(([k, ns]) => [k, achar(cab, ns.map(norm))]));
    if (c.data >= 0 && c.valor >= 0 && c.favorecido >= 0) { h = i; col = c; }
  }
  if (h < 0) throw invalido('não achei o cabeçalho: a planilha precisa das colunas "data", "fornecedor" (ou "cliente"/"nome") e "valor"');
  const linhas = []; const erros = []; const vistos = new Map();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]; const cel = (k) => (col[k] >= 0 ? (r[col[k]] ?? '') : '');
    if (r.every((c) => c === '')) continue;
    const data = cel('data'); const favorecido = cel('favorecido'); const valor = cel('valor');
    const falta = [!data && 'data', !favorecido && 'fornecedor', !valor && 'valor'].filter(Boolean);
    if (falta.length > 0) { erros.push({ linha: i + 1, motivo: `falta ${falta.join(', ')}` }); continue; }
    const t = norm(cel('tipo'));
    const tipo = /^(venda|renda|entrada|receita|credito|crédito)/.test(t) ? 'renda' : /^(compra|gasto|saida|saída|despesa|debito|débito)/.test(t) ? 'gasto' : tipoPadrao;
    const base = `${fonte}|${data}|${favorecidoKey(favorecido)}|${valor.replace(/\s/g, '')}|${tipo}`;
    const n = (vistos.get(base) ?? 0) + 1; vistos.set(base, n);
    linhas.push({ linha: i + 1, data, favorecido, valor, tipo, ...(cel('categoria') ? { categoria: cel('categoria') } : {}), ...(cel('notas') ? { notas: cel('notas') } : {}), ref: `${base}|${n}` });
  }
  return { cabecalho: h + 1, colunas: Object.fromEntries(Object.entries(col).filter(([, v]) => v >= 0).map(([k, v]) => [k, rows[h][v]])), linhas, erros };
}

// ---- curva ABC (submódulo de Finanças) ---------------------------------------------------------------------------
/**
 * Curva ABC de compras ou vendas. `lado`: 'compra' = lançamentos de saída (valor < 0), 'venda' = entradas (valor > 0).
 * `por`: 'favorecido' (fornecedor/cliente) ou 'categoria'. Agrupa, ordena do maior para o menor e classifica pelo
 * acumulado ANTES do item: A enquanto o acumulado anterior < limiteA (80%), B < limiteB (95%), C o resto — assim o item
 * que cruza os 80% ainda é A (convenção usual de Pareto). `toExib(l)` converte para a moeda de exibição; `nomeCat(key)`
 * dá o nome da categoria. Puro: devolve centavos e frações; a API formata.
 */
const LADOS_ABC = ['compra', 'venda'];
const AGRUPAR_ABC = ['favorecido', 'categoria'];
function curvaABC(lancamentos, { lado = 'compra', por = 'favorecido', toExib = (l) => l.valorCent, nomeCat = (k) => k, limiteA = 0.8, limiteB = 0.95 } = {}) {
  if (!LADOS_ABC.includes(lado)) throw invalido(`lado inválido: use ${LADOS_ABC.join(' ou ')}`);
  if (!AGRUPAR_ABC.includes(por)) throw invalido(`agrupamento inválido: use ${AGRUPAR_ABC.join(' ou ')}`);
  const grupos = new Map();
  for (const l of lancamentos) {
    const v = toExib(l);
    if (lado === 'compra' ? v >= 0 : v <= 0) continue;
    const cent = Math.abs(v);
    const key = por === 'categoria' ? (l.categoria || CATEGORIA_SEM) : (favorecidoKey(l.favorecido || '') || '(sem nome)');
    const nome = por === 'categoria' ? nomeCat(key) : (nomeFavorecido(l.favorecido || '') || '(sem nome)');
    const g = grupos.get(key) ?? { key, nome, cent: 0, qtd: 0, ultima: '' };
    g.cent += cent; g.qtd += 1;
    if ((l.data || '') > g.ultima) { g.ultima = l.data || ''; if (por === 'favorecido') g.nome = nome; }
    grupos.set(key, g);
  }
  const itens = [...grupos.values()].sort((a, b) => b.cent - a.cent || a.nome.localeCompare(b.nome));
  const total = itens.reduce((s, g) => s + g.cent, 0);
  const classes = { A: { itens: 0, cent: 0 }, B: { itens: 0, cent: 0 }, C: { itens: 0, cent: 0 } };
  let acum = 0;
  const out = itens.map((g, i) => {
    const antes = total > 0 ? acum / total : 0;
    const classe = antes < limiteA ? 'A' : antes < limiteB ? 'B' : 'C';
    acum += g.cent;
    classes[classe].itens += 1; classes[classe].cent += g.cent;
    return { pos: i + 1, key: g.key, nome: g.nome, cent: g.cent, qtd: g.qtd, ultima: g.ultima, pct: total > 0 ? g.cent / total : 0, acumPct: total > 0 ? acum / total : 0, classe };
  });
  for (const c of Object.values(classes)) c.pct = total > 0 ? c.cent / total : 0;
  return { lado, por, totalCent: total, itens: out, classes, limites: { A: limiteA, B: limiteB } };
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
  const orig = l.moedaOriginal ? ` (${formatMoeda(l.valorOriginalCent, l.moedaOriginal)})` : '';
  return `${dataCurta(l.data)} · ${cat}${fav} · ${formatMoeda(l.valorCent, l.moeda ?? MOEDA_PADRAO)}${orig}${conta ? ` · ${conta}` : ''}${l.status === 'pendente' ? ' (pendente)' : ''}`;
}

module.exports = {
  KEY_RE, MES_RE, TIPOS_CONTA, ORIGENS, STATUS, LIMITES, DEDUP_DIAS, CATEGORIAS_PADRAO, CATEGORIA_SEM,
  ErroFinance, norm, slug, isKey, novaChave,
  findCategoria, novaCategoria,
  parseValorBRL, formatBRL, parseData, hojeDe, somaDias, diasEntre, mesDe, mesPorExtenso, mesAnterior, dataCurta,
  MOEDAS, MOEDA_INFO, MOEDA_PADRAO, MOEDA_EXIB_PADRAO, TAXAS_PADRAO, moedaValida, casasDe, simboloDe, detectarMoeda,
  parseValor, parseMinor, formatMoeda, paraExib, taxaDe, taxasNormalizadas, valorAltoDemais,
  novaConta, patchConta, contaPadrao, findConta, tipoPeloNome,
  nomeFavorecido, favorecidoKey, categoriaAprendida, aprender, categoriaSemente,
  novoLancamento, patchLancamento, duplicadoDe,
  saldoConta, resumoMes, retornoResumo, linhaLancamento,
  LADOS_ABC, AGRUPAR_ABC, curvaABC, linhasDePlanilha,
  TIPOS_LINHA, LINHAS_PADRAO, novaLinha, patchLinha, findLinha, valorLinha,
};
