/**
 * regras.mjs — regras puras do agente financeiro no WhatsApp (plugin meu-bot-finance). Sem IO: testável com node --test.
 *
 * O plugin só lança sozinho as frases fechadas do dono ("gastei 48 no mercado", "recebi 3.000 do salário"): valor
 * numérico obrigatório, verbo no pretérito, uma frase só, sem pergunta. Tudo o mais (frase livre, várias compras,
 * correção, pergunta, foto) fica com o agente, que tem a skill finance-api e o contexto injetado. "ok"/"não" são do
 * CRM; aqui a correção é "desfaz"/"errado".
 */

/** Número só com dígitos e "+", para comparar o dono com `me.id` do creds.json ("5521…:19@s.whatsapp.net"). */
export function normalizePhone(v) {
  const d = String(v ?? "").replace(/@.*$/, "").replace(/:.*$/, "").replace(/[^\d]/g, "");
  return d === "" ? null : `+${d}`;
}
export function phoneOfSessionKey(key) {
  const m = /:direct:(\+?\d{6,20})$/.exec(String(key ?? ""));
  return m === null ? null : m[1].startsWith("+") ? m[1] : `+${m[1]}`;
}
/** A sessão é o chat do dono consigo mesmo no WhatsApp? (é ali que mora o financeiro dele). */
export function ehChatDoDono(ctx, dono) {
  if (dono === null || dono === undefined) return false;
  const canal = ctx?.channel ?? ctx?.messageProvider;
  if (typeof canal === "string" && canal !== "" && canal !== "whatsapp") return false;
  return phoneOfSessionKey(ctx?.sessionKey) === dono;
}

const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const VAL = String.raw`(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:reais|real|conto|contos|pila|pilas)\b)?`;
/** Palavras logo depois do número que dizem que não é dinheiro ("gastei 2 horas", "paguei 3 vezes"). */
const UNIDADE = /^\s*(h|hs|hora|horas|min|minuto|minutos|dia|dias|km|kg|g|gramas|litro|litros|%|x|vez|vezes|ano|anos|mes|meses|semana|semanas|pessoa|pessoas|unidade|unidades)\b/;
const GASTO = new RegExp(String.raw`^(gastei|paguei|comprei|torrei|deixei)\s+(?:uns?\s+|umas?\s+)?${VAL}`, "i");
const RENDA = new RegExp(String.raw`^(recebi|caiu|entrou|ganhei|vendi|fechei|faturei)\s+(?:uns?\s+)?${VAL}`, "i");
/** Ganho indireto (retorno estimado do investimento): tempo economizado, custo evitado. */
const INDIRETO = new RegExp(String.raw`^(economizei|poupei|evitei)\s+(?:uns?\s+)?${VAL}`, "i");
const PREP_INDIRETO = /^\s+(?:de|do|da|em|no|na|com|por|pelo|pela)\s+(.+)$/i;
const PREP_GASTO = /^\s+(?:no|na|nos|nas|em|de|do|da|com|pro|pra|para o|para a|para)\s+(.+)$/i;
const PREP_RENDA = /^\s+(?:de|do|da|dos|das)\s+(.+)$/i;
const FORMAS = [[/\s+(?:no|em|pelo|pela|via|com)\s+(?:cartao de credito|credito|cartao)$/, "cartao"], [/\s+(?:no|em|pelo|pela|via|com)\s+debito$/, "debito"], [/\s+(?:no|em|pelo|pela|via|com)\s+pix$/, "pix"], [/\s+(?:em|no)\s+(?:dinheiro|especie)$/, "dinheiro"]];
const DATAS = [[/\s+(?:hoje)$/, "hoje"], [/\s+(?:ontem)$/, "ontem"], [/\s+(?:anteontem)$/, "anteontem"], [/\s+(?:dia|em|no dia)?\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/, null]];

/**
 * Intenção do dono numa frase fechada: `{ tipo: "gasto"|"renda", valor, favorecido, forma?, data? }`, ou
 * `{ tipo: "desfazer" }`, ou null (deixa com o agente). Uma frase, até 160 caracteres, sem "?", um valor só.
 */
export function intencaoDono(texto) {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  if (t === "" || t.length > 160 || t.includes("?") || t.includes("\n")) return null;
  if (/^(desfaz|desfazer|desfaca|errado|esta errado|ta errado|apaga (?:esse|isso|o ultimo)|cancela (?:esse|isso|o ultimo))$/.test(sem(t))) return { tipo: "desfazer" };
  for (const [re, prep, tipo] of [[GASTO, PREP_GASTO, "gasto"], [RENDA, PREP_RENDA, "renda"], [INDIRETO, PREP_INDIRETO, "indireto"]]) {
    const m = re.exec(t);
    if (m === null) continue;
    const verbo = sem(m[1]); const moeda = m[2] !== undefined || m[4] !== undefined || /,\d{1,2}$/.test(m[3]);
    let resto = t.slice(m[0].length);
    if (UNIDADE.test(sem(resto))) return null;
    // "comprei 2 no mercado" pode ser quantidade: comprar só vira lançamento com marca de dinheiro (R$, reais, centavos).
    if (["comprei", "deixei", "ganhei", "vendi", "fechei", "faturei", "economizei", "poupei", "evitei"].includes(verbo) && !moeda) return null;
    // Dois valores ("48 no mercado e 20 na padaria"): várias compras, fica com o agente.
    if (/\d/.test(resto.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ""))) return null;
    const pm = prep.exec(resto);
    if (pm === null) return null;
    let fav = pm[1].trim(); let forma; let data;
    for (let mudou = true; mudou;) {
      mudou = false;
      for (const [rx, f] of FORMAS) { const x = rx.exec(sem(fav)); if (x !== null && forma === undefined) { forma = f; fav = fav.slice(0, fav.length - x[0].length).trim(); mudou = true; } }
      for (const [rx, d] of DATAS) { const x = rx.exec(sem(fav)); if (x !== null && data === undefined) { data = d ?? x[1]; fav = fav.slice(0, fav.length - x[0].length).trim(); mudou = true; } }
    }
    if (fav === "" || fav.length > 60 || /\b(e|mais)\s+\d/.test(fav)) return null;
    if (tipo === "indireto") return { tipo: "renda", retorno: "indireto", valor: m[3], favorecido: fav, ...(data ? { data } : {}) };
    return { tipo, ...(tipo === "renda" ? { retorno: "direto" } : {}), valor: m[3], favorecido: fav, ...(forma ? { forma } : {}), ...(data ? { data } : {}) };
  }
  return null;
}

/** Palavras que indicam que o dono está falando de dinheiro (para injetar o contexto financeiro no prompt). */
export function falaDeDinheiro(texto) {
  return /\b(r\$|\d+[.,]\d{2}|gast|pagu|pagar|compr|receb|salario|saldo|dinheiro|conta|cartao|fatura|pix|boleto|lancamento|lanca|financ|orcamento|mes|categoria|comprovante|nota|recibo|extrato|renda|caiu|entrou|desfaz|errado|ganh|vend|fech|fatur|economiz|roi|retorno|investi)\w*/.test(sem(texto));
}

/** Resposta curta em pt-BR do que o módulo lançou (o agente repete ou ajusta). */
export function textoLancado(r) {
  const l = r.lancamento;
  const base = `${l.valorCent < 0 ? "Gasto" : l.categoria === "ganho-indireto" ? "Ganho indireto" : "Ganho"} lançado: ${r.linha}.`;
  if (r.suspeitoDe) return `${base} Parece repetido com ${r.suspeitoDe.data.slice(8, 10)}/${r.suspeitoDe.data.slice(5, 7)} (${r.suspeitoDe.valor}); ficou pendente. Mande "desfaz" se foi engano.`;
  if (l.status === "pendente") return `${base} Ficou pendente para você confirmar a categoria (sugeri ${l.categoriaNome}). "desfaz" apaga.`;
  return `${base} "desfaz" apaga se foi engano.`;
}

/**
 * Cobrança diária ao dono (só entre 9h e 21h, uma por dia, cada assunto no máximo a cada 3 dias). `estado` vem de
 * GET /v1/finance/estado; `avisos` = { [assunto]: últimoMs }. Devolve { texto, assuntos } ou null.
 */
export function avisoDevido(estado, avisos, agoraMs, horaLocal, diaDoMes) {
  if (!estado || horaLocal < 9 || horaLocal >= 21) return null;
  const ultimoQualquer = Math.max(0, ...Object.values(avisos ?? {}).map(Number).filter(Number.isFinite));
  if (agoraMs - ultimoQualquer < 20 * 3600_000) return null;
  const podeAvisar = (assunto) => agoraMs - (Number(avisos?.[assunto]) || 0) >= 3 * 86_400_000;
  const partes = []; const assuntos = [];
  const item = (id) => estado.checklist?.find((c) => c.id === id);
  if (estado.pendencias >= 3 && podeAvisar("pendencias")) { partes.push(`${estado.pendencias} lançamentos esperam sua confirmação (é só responder com a categoria certa ou "tudo certo")`); assuntos.push("pendencias"); }
  const fechar = item("fechar");
  if (fechar && !fechar.feito && diaDoMes >= 3 && podeAvisar("fechar")) { partes.push(`${fechar.titulo.toLowerCase()}: confira os números e me diga "fecha o mês"`); assuntos.push("fechar"); }
  const orc = item("orcamento");
  if (orc && !orc.feito && podeAvisar("orcamento")) { partes.push("me diga quanto você quer gastar este mês (o orçamento); eu acompanho e aviso antes de estourar"); assuntos.push("orcamento"); }
  // Orçamento: avisa uma vez ao passar de 80% e outra ao estourar, em cada mês.
  const o = estado.resumo?.orcamento;
  if (o && o.usadoPct >= 100 && !avisos?.[`estouro:${estado.mes}`]) { partes.push(`o orçamento do mês estourou: ${o.usadoPct}% usado (${o.valor})`); assuntos.push(`estouro:${estado.mes}`); }
  else if (o && o.usadoPct >= 80 && o.usadoPct < 100 && !avisos?.[`alerta80:${estado.mes}`]) { partes.push(`você já usou ${o.usadoPct}% do orçamento do mês; restam ${o.restante}`); assuntos.push(`alerta80:${estado.mes}`); }
  const dinheiro = item("dinheiro");
  if (dinheiro && !dinheiro.feito && diaDoMes >= 25 && podeAvisar("dinheiro")) { partes.push('me diga os gastos em dinheiro vivo do mês (ou "nada em dinheiro")'); assuntos.push("dinheiro"); }
  if (partes.length === 0) return null;
  return { texto: `💰 Seu financeiro: ${partes.join("; ")}.`, assuntos };
}
