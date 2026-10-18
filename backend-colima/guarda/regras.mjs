/**
 * Regras da guarda do WhatsApp (plugin meu-bot-guarda do OpenClaw). Puro: sem gateway, sem rede, testado
 * com node --test no repositório. Duas regras:
 * 1. notas operacionais do OpenClaw ("↪️ Model Fallback…") nunca vão ao contato;
 * 2. loop bot-com-bot: 3 ciclos seguidos de ping-pong curto (despedidas ou textos quase iguais) em janela
 *    curta → pausa automática. Humanos não batem: três "ok" em 10 min estouram a janela; conversa com
 *    conteúdo não passa na similaridade nem na lista de despedidas.
 */

/**
 * Linhas operacionais do OpenClaw que não são fala do agente e nunca podem ir ao contato: notas de fallback e
 * retry, e os textos de erro que ele manda ao chat quando todas as tentativas falham ("claude-cli/claude-opus-5-5
 * request failed", "The model returned an empty response. Please try again.", "This turn ended before a reply: …").
 * Sempre em inglês, sempre técnicos; a conversa da pessoa é em português.
 */
export const OPERATIONAL_PREFIXES = ["↪️ Model Fallback", "↪️ Retried on", "↪️", "⚠️ ", "This turn ended before a reply", "LLM request failed", "The model returned an empty response", "The provider session expired", "NO_REPLY"];
export const OPERATIONAL_PATTERNS = [
  /^[a-z0-9._-]+\/[a-z0-9._-]+ (request|call|turn) failed\b/i, // "claude-cli/claude-opus-5-5 request failed"
  /\brequest failed\b.*\b(provider|model|backend|cli|timeout|status \d{3})\b/i,
  /\b(empty response|rate limit(ed)?|context window|token limit|session expired)\b.*\b(try again|retry|model)\b/i,
  /^(error|erro):\s*\S*(request|provider|backend|cli)/i,
];
export function isOperationalNotice(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t === "") return false;
  if (OPERATIONAL_PREFIXES.some((p) => t.startsWith(p))) return true;
  if (t.length > 400) return false; // fala normal do agente pode ser longa; os avisos do OpenClaw são curtos
  return OPERATIONAL_PATTERNS.some((re) => re.test(t));
}

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
  "combinado", "fechado", "pode deixar", "tranquilo", "show", "perfeito", "sem problema", "fico no aguardo", "te aviso", "estamos ai", "pra voce tambem", "para voce tambem", "tudo claro", "ficou claro", "tudo certo", "na segunda", "ate la", "fico esperando",
  "fico a disposicao", "estou a disposicao", "a disposicao", "qualquer coisa", "quando precisar", "se precisar",
  "bom dia", "boa tarde", "boa noite", "bom domingo", "bom sabado", "bom descanso", "bom fim de semana", "boa semana", "bom feriado", "tenha um otimo dia", "tenha um bom dia", "por agora nao", "por enquanto nao",
  "buen descanso", "buen fin de semana", "buena semana", "buenas noches", "buenas tardes", "buen domingo",
  "hasta luego", "hasta pronto", "hasta la proxima", "adios", "chau", "chao", "gracias", "que estes bien", "que andes bien", "cuidate", "buen dia", "aqui estare", "cuando necesites", "cuando quieras", "igualmente", "igual", "nos vemos", "dale", "listo", "quedamos asi", "vos tambien", "abrazo", "abraco", "ate mais", "ate a proxima",
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
 * Sem a entrada (o OpenClaw 2026.9 não entrega `message_received` a plugins de fora, só `message_sending`),
 * cada resposta vira um ciclo "só de saída": aí a regra exige um ciclo a mais (4) e olha só o que o agente mandou,
 * para uma despedida educada de humano (obrigado → de nada → até → até) não pausar a conversa dele.
 */
export class LoopTracker {
  constructor(opts = {}) { this.opts = { ...DEFAULTS, ...opts }; this.conv = new Map(); }
  received(convId, text, at = Date.now()) {
    const c = this.conv.get(convId) ?? { pending: null, cycles: [] };
    c.pending = { inText: String(text ?? ""), inAt: at };
    this.conv.set(convId, c);
  }
  sending(convId, text, at = Date.now()) {
    const c = this.conv.get(convId) ?? { pending: null, cycles: [] };
    this.conv.set(convId, c);
    const pending = c.pending ?? { inText: "", inAt: at, soSaida: true };
    c.cycles.push({ ...pending, outText: String(text ?? ""), outAt: at });
    c.pending = null;
    const keep = this.opts.cycles + 1;
    if (c.cycles.length > keep) c.cycles.splice(0, c.cycles.length - keep);
    return this.evaluate(c.cycles);
  }
  forget(convId) { this.conv.delete(convId); }
  evaluate(all) {
    const { gapMs, maxChars, minSimilarity } = this.opts;
    const soSaida = all.some((c) => c.soSaida === true);
    const n = soSaida ? this.opts.cycles + 1 : this.opts.cycles;
    if (all.length < n) return { loop: false };
    const cycles = all.slice(-n);
    const short = cycles.every((c) => c.inText.length <= maxChars && c.outText.length <= maxChars);
    if (!short) return { loop: false };
    for (let i = 1; i < cycles.length; i += 1) if (cycles[i].inAt - cycles[i - 1].inAt > gapMs) return { loop: false };
    const spanMin = Math.max(1, Math.round((cycles[cycles.length - 1].inAt - cycles[0].inAt) / 60_000));
    const allFarewell = (pick) => cycles.every((c) => isFarewell(pick(c)));
    if ((!soSaida && allFarewell((c) => c.inText)) || allFarewell((c) => c.outText)) return { loop: true, reason: `${n} ${soSaida ? "respostas" : "ciclos"} de despedida em ${spanMin} min` };
    const similar = (pick) => cycles.slice(1).every((c, i) => similarity(pick(c), pick(cycles[i])) >= minSimilarity);
    if ((!soSaida && similar((c) => c.inText)) || similar((c) => c.outText)) return { loop: true, reason: `${n} ${soSaida ? "respostas" : "mensagens"} quase iguais em ${spanMin} min` };
    return { loop: false };
  }
}

/** A nota que entra na conversa para o agente saber que foi pausado automaticamente (mesmo molde da pausa manual). */
export function autoPauseNoteText(reason, whenText, peer) {
  return `Nota do meu-bot: o agente foi pausado para este contato em ${whenText} automaticamente pelo meu-bot: padrão de loop (${reason}) com ${peer}; o contato parece ser outro agente. A partir daqui, nada do que você responder será entregue a ele. Enquanto a pausa durar, responda NO_REPLY a tudo o que ele mandar, inclusive a esta nota: não escreva nada, nem para registrar. A pausa é controle interno do dono: nunca a mencione ao contato.`;
}

/** Texto de uma mensagem do transcript do OpenClaw (string ou partes {type:"text"}). */
export function textOfContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((p) => (p && typeof p === "object" && typeof p.text === "string" ? p.text : "")).filter(Boolean).join("\n").trim();
}
export const SILENT = "NO_REPLY";
export const isSilentText = (t) => { const n = String(t ?? "").trim(); return n === "" || n.toUpperCase() === SILENT; };

/**
 * Pares (contato → agente) do transcript que o `agent_end` entrega (`event.messages`): cada mensagem `user` com
 * remetente abre um par; a próxima `assistant` com texto fecha. Avisos ("Nota do meu-bot:") e turnos sem texto ficam fora.
 */
export function transcriptPairs(messages) {
  const pairs = [];
  let pending = null;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m === null || typeof m !== "object") continue;
    const at = typeof m.timestamp === "number" ? m.timestamp : 0;
    const text = textOfContent(m.content);
    if (m.role === "user") { if (text === "" || /^Nota do meu-bot:/.test(text)) continue; pending = { inText: text, inAt: at }; }
    else if (m.role === "assistant" && pending !== null) { if (isSilentText(text)) continue; pairs.push({ ...pending, outText: text, outAt: at }); pending = null; }
  }
  return pairs;
}

/** Reavalia o loop com a conversa inteira (entrada e saída), como se os hooks de entrada tivessem chegado. */
export function loopVerdict(messages, opts = {}) {
  const tr = new LoopTracker(opts);
  let r = { loop: false };
  for (const p of transcriptPairs(messages).slice(-8)) { tr.received("k", p.inText, p.inAt); r = tr.sending("k", p.outText, p.outAt); }
  return r;
}

/**
 * Conversa encerrada: o agente já se despediu e, desde então, ficou em silêncio (NO_REPLY ou sem resposta) em
 * `silences` turnos seguidos do contato. Aí a pausa de verdade entra (o app mostra "pausado"), sem depender do loop.
 */
export function closureVerdict(messages, silences = 2) {
  const msgs = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant"));
  let silent = 0; let lastReply = null;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]; const text = textOfContent(m.content);
    if (m.role === "user") { if (/^Nota do meu-bot:/.test(text)) continue; const next = msgs[i + 1]; const replied = next !== undefined && next.role === "assistant" && !isSilentText(textOfContent(next.content)); if (replied) break; silent += 1; continue; }
    if (m.role === "assistant" && !isSilentText(text)) { lastReply = text; break; }
  }
  if (silent >= silences && lastReply !== null && isFarewell(lastReply)) return { closed: true, reason: `conversa encerrada: o agente se despediu ("${lastReply.slice(0, 40)}") e ficou em silêncio ${silent}×` };
  return { closed: false };
}
