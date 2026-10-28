/**
 * Memória do dono pelo WhatsApp (só no chat do dono consigo mesmo), testada com node --test. Gatilhos estritos, no
 * começo da mensagem: "lembre que …" / "lembra que …" / "anota que …" / "anota: …" grava; "esquece que …" apaga as
 * linhas que contêm o trecho; "o que você lembra (sobre …)?" lista. Nada de "apaga/remova X": isso é pedido normal
 * ao agente. O arquivo é ~/.local/share/meu-bot/memoria-dono.md (0600, tmp+rename), com teto de tamanho; a guarda
 * põe o conteúdo no prompt das conversas do dono (before_prompt_build), então o agente lembra em todo turno dele.
 * Contato nenhum chega aqui: quem chama confere que a mensagem é do próprio dono.
 */
import fs from "node:fs";
import path from "node:path";

export const MAX_CHARS = 4000;
const normal = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const limpaFato = (s) => String(s ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");

/** Texto do dono → { tipo: "anotar"|"esquecer"|"listar", fato } ou null (mensagem normal para o agente). */
export function atalho(texto) {
  const t = String(texto ?? "").trim();
  let m = /^(?:lembr[ae]\s+que|anot[ae]\s+que|anot[ae]\s*:)\s*([\s\S]+)$/i.exec(t);
  if (m !== null && limpaFato(m[1]) !== "") return { tipo: "anotar", fato: limpaFato(m[1]) };
  m = /^esque(?:ce|ça)\s+que\s+([\s\S]+)$/i.exec(t);
  if (m !== null && limpaFato(m[1]) !== "") return { tipo: "esquecer", fato: limpaFato(m[1]) };
  m = /^o\s+que\s+(?:voc[eê]|vc)\s+lembra(?:\s+(?:sobre|de|do|da)\s+(.+?))?\s*\??$/i.exec(t);
  if (m !== null) return { tipo: "listar", fato: m[1] ? limpaFato(m[1]) : "" };
  return null;
}

const ler = (arquivo) => { try { return fs.readFileSync(arquivo, "utf8"); } catch { return ""; } };
const itens = (arquivo) => ler(arquivo).split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
function gravar(arquivo, lista) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  const tmp = `${arquivo}.tmp`;
  fs.writeFileSync(tmp, lista.length === 0 ? "" : `${lista.map((l) => `- ${l}`).join("\n")}\n`, { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
}
const semData = (l) => l.replace(/ \(\d{2}\/\d{2}\/\d{4}\)$/, "");

/** Acrescenta o fato com a data. `{ ok, motivo? }`: "repetido" (já estava) ou "cheia" (passaria do teto). */
export function anotar(arquivo, fato, agora = new Date()) {
  const lista = itens(arquivo);
  if (lista.some((l) => normal(semData(l)) === normal(fato))) return { ok: false, motivo: "repetido" };
  const data = agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: process.env.TZ || "America/Sao_Paulo" });
  const nova = [...lista, `${fato} (${data})`];
  if (nova.join("\n").length > MAX_CHARS) return { ok: false, motivo: "cheia" };
  gravar(arquivo, nova);
  return { ok: true };
}

/** Tira as linhas que contêm o trecho (sem acento/caixa). Devolve as removidas. */
export function esquecer(arquivo, trecho) {
  const alvo = normal(trecho);
  if (alvo === "") return [];
  const lista = itens(arquivo);
  const fora = lista.filter((l) => normal(semData(l)).includes(alvo));
  if (fora.length > 0) gravar(arquivo, lista.filter((l) => !fora.includes(l)));
  return fora;
}

/** Itens (todos, ou os que contêm `filtro`). */
export function listar(arquivo, filtro = "") {
  const alvo = normal(filtro);
  return itens(arquivo).filter((l) => alvo === "" || normal(l).includes(alvo));
}

/** O que vai no prompt das conversas do dono; null sem memória. */
export function contexto(arquivo) {
  const lista = itens(arquivo);
  if (lista.length === 0) return null;
  return `Memória do dono (anotada por ele pelo WhatsApp com "lembre que"; use quando for útil, sem recitar):\n${lista.map((l) => `- ${l}`).join("\n")}`;
}

/** Aplica o atalho e devolve a nota ao agente daquele turno (ele só confirma ao dono, em uma linha). */
export function aplicar(arquivo, a, agora = new Date()) {
  if (a.tipo === "anotar") {
    const r = anotar(arquivo, a.fato, agora);
    if (r.ok) return `Nota do meu-bot: anotei na memória do dono: "${a.fato}". Confirme a ele em uma linha curta que anotou; não faça mais nada.`;
    return r.motivo === "repetido"
      ? `Nota do meu-bot: "${a.fato}" já estava na memória do dono. Diga isso a ele em uma linha.`
      : `Nota do meu-bot: a memória do dono está cheia (${MAX_CHARS} caracteres) e "${a.fato}" não foi anotado. Diga isso a ele e sugira "esquece que …" para liberar espaço.`;
  }
  if (a.tipo === "esquecer") {
    const fora = esquecer(arquivo, a.fato);
    return fora.length > 0
      ? `Nota do meu-bot: removi da memória do dono: ${fora.map((l) => `"${semData(l)}"`).join(", ")}. Confirme a ele em uma linha.`
      : `Nota do meu-bot: nada na memória do dono contém "${a.fato}". Diga isso a ele em uma linha.`;
  }
  const lista = listar(arquivo, a.fato);
  return lista.length > 0
    ? `Nota do meu-bot: o dono perguntou o que você lembra${a.fato ? ` sobre "${a.fato}"` : ""}. A memória anotada é:\n${lista.map((l) => `- ${l}`).join("\n")}\nResponda com essa lista, sem inventar itens.`
    : `Nota do meu-bot: o dono perguntou o que você lembra${a.fato ? ` sobre "${a.fato}"` : ""} e não há nada anotado. Diga isso e lembre que ele pode escrever "lembre que …".`;
}
