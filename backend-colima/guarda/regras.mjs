/**
 * Regras da guarda do WhatsApp (plugin meu-bot-guarda do OpenClaw). Puro: sem gateway, sem rede, testado
 * com node --test no repositório. Duas regras:
 * 1. notas operacionais do OpenClaw ("↪️ Model Fallback…") nunca vão ao contato;
 * 2. loop bot-com-bot: 3 ciclos seguidos de ping-pong curto (despedidas ou textos quase iguais) em janela
 *    curta → pausa automática. Humanos não batem: três "ok" em 10 min estouram a janela; conversa com
 *    conteúdo não passa na similaridade nem na lista de despedidas.
 */

/** Prefixos das linhas operacionais do OpenClaw que não são fala do agente. */
export const OPERATIONAL_PREFIXES = ["↪️ Model Fallback", "↪️ Retried on"];
export const isOperationalNotice = (text) => typeof text === "string" && OPERATIONAL_PREFIXES.some((p) => text.trimStart().startsWith(p));

/** Minúsculas, sem acento, sem pontuação, espaços únicos. */
export const normalize = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const wordSet = (s) => new Set(normalize(s).split(" ").filter((w) => w !== ""));

/** Jaccard dos conjuntos de palavras (0..1). Dois vazios = 1. */
export function similarity(a, b) {
  const A = wordSet(a), B = wordSet(b);
  if (A.size === 0 || B.size === 0) return A.size === B.size ? 1 : 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** Fórmulas de encerramento/cortesia em pt, es e en (normalizadas). */
const FAREWELLS = [
  "ate mais", "ate logo", "ate breve", "ate", "tchau", "adeus", "obrigado", "obrigada", "de nada", "valeu", "ok", "okay", "beleza",
  "combinado", "fico a disposicao", "estou a disposicao", "a disposicao", "qualquer coisa", "quando precisar", "se precisar",
  "bom dia", "boa tarde", "boa noite", "tenha um otimo dia", "tenha um bom dia", "por agora nao", "por enquanto nao",
  "hasta luego", "hasta pronto", "adios", "gracias", "que estes bien", "buen dia", "aqui estare", "cuando necesites", "igualmente", "igual",
  "bye", "goodbye", "see you", "thanks", "thank you", "you re welcome", "take care", "have a nice day", "let me know", "anytime",
];
const FAREWELL_RE = new RegExp(`(^| )(${FAREWELLS.map((f) => f.replace(/ /g, "\\s+")).join("|")})( |$)`);
/** Mensagem curta (≤ 12 palavras) que contém uma fórmula de encerramento/cortesia. */
export function isFarewell(text) {
  const n = normalize(text);
  if (n === "" || n.split(" ").length > 12) return false;
  return FAREWELL_RE.test(n);
}

export const DEFAULTS = Object.freeze({ cycles: 3, gapMs: 3 * 60_000, maxChars: 200, minSimilarity: 0.6 });

/**
 * Acompanha, por conversa, os pares (recebida → enviada). `received` abre um ciclo; `sending` fecha e avalia.
 * Devolve `{ loop: false }` ou `{ loop: true, reason }` na resposta que fecha o 3º ciclo suspeito.
 */
export class LoopTracker {
  constructor(opts = {}) { this.opts = { ...DEFAULTS, ...opts }; this.conv = new Map(); }
  received(convId, text, at = Date.now()) {
    const c = this.conv.get(convId) ?? { pending: null, cycles: [] };
    c.pending = { inText: String(text ?? ""), inAt: at };
    this.conv.set(convId, c);
  }
  sending(convId, text, at = Date.now()) {
    const c = this.conv.get(convId);
    if (c === undefined || c.pending === null) return { loop: false };
    c.cycles.push({ ...c.pending, outText: String(text ?? ""), outAt: at });
    c.pending = null;
    if (c.cycles.length > this.opts.cycles) c.cycles.splice(0, c.cycles.length - this.opts.cycles);
    return this.evaluate(c.cycles);
  }
  forget(convId) { this.conv.delete(convId); }
  evaluate(cycles) {
    const { cycles: n, gapMs, maxChars, minSimilarity } = this.opts;
    if (cycles.length < n) return { loop: false };
    const short = cycles.every((c) => c.inText.length <= maxChars && c.outText.length <= maxChars);
    if (!short) return { loop: false };
    for (let i = 1; i < cycles.length; i += 1) if (cycles[i].inAt - cycles[i - 1].inAt > gapMs) return { loop: false };
    const spanMin = Math.max(1, Math.round((cycles[cycles.length - 1].inAt - cycles[0].inAt) / 60_000));
    const allFarewell = (pick) => cycles.every((c) => isFarewell(pick(c)));
    if (allFarewell((c) => c.inText) || allFarewell((c) => c.outText)) return { loop: true, reason: `${n} ciclos de despedida em ${spanMin} min` };
    const similar = (pick) => cycles.slice(1).every((c, i) => similarity(pick(c), pick(cycles[i])) >= minSimilarity);
    if (similar((c) => c.inText) || similar((c) => c.outText)) return { loop: true, reason: `${n} mensagens quase iguais em ${spanMin} min` };
    return { loop: false };
  }
}

/** A nota que entra na conversa para o agente saber que foi pausado automaticamente (mesmo molde da pausa manual). */
export function autoPauseNoteText(reason, whenText, peer) {
  return `Nota do meu-bot: o agente foi pausado para este contato em ${whenText} automaticamente pelo meu-bot: padrão de loop (${reason}) com ${peer}; o contato parece ser outro agente. A partir daqui, nada do que você responder será entregue ao contato. Não responda a esta nota ao contato; apenas registre com uma palavra.`;
}
