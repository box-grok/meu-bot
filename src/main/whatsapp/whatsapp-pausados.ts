/**
 * Mensagens que chegaram enquanto o contato estava pausado no Hermes (puro; o IO por SSH fica em whatsapp.ts).
 *
 * CONTORNO #2 (Hermes): sem pausa por contato (NousResearch/hermes-agent#146672), o plugin meu-bot-pausa descarta a
 * mensagem do pausado antes do agente e a guarda em ~/.local/share/meu-bot/whatsapp-pausados.jsonl (uma linha JSON
 * por mensagem: numero, nome, texto, em, tipo). O que fazemos aqui: ler esse arquivo para a conversa mostrar o que o
 * agente não viu (bolha tracejada) e para um contato que só escreveu na pausa aparecer na lista. O plugin apaga as
 * linhas do número quando entrega a nota ao agente, na primeira mensagem depois da retomada.
 * Sai quando: `pausanativa=1` — se o nativo guardar as mensagens, este leitor troca de fonte; se não, continua.
 * Tabela: docs/guia/contornos.md.
 */
import type { WhatsappChat, WhatsappThreadMessage } from "../../shared/ipc";
import { pausaVigente, type WaMarks } from "./whatsapp-marks";

export const WA_PAUSADOS_FILE = "$HOME/.local/share/meu-bot/whatsapp-pausados.jsonl";
const NUMBER_RE = /^\d{8,15}$/;
const MAX_LINHAS = 5000;

/** Imprime `pausados=<json array>` com as últimas linhas válidas do arquivo (todas, ou só do número dado). */
export function waPausadosSh(numero?: string): string {
  if (numero !== undefined && !NUMBER_RE.test(numero)) throw new Error("número inválido");
  return `echo "pausados=$(tail -n ${MAX_LINHAS} "${WA_PAUSADOS_FILE}" 2>/dev/null | python3 -c '
import json, sys
n = sys.argv[1] if len(sys.argv) > 1 else ""
out = []
for l in sys.stdin:
    try:
        d = json.loads(l)
    except Exception:
        continue
    if isinstance(d, dict) and (not n or str(d.get("numero")) == n): out.append(d)
print(json.dumps(out, ensure_ascii=False))
' ${numero === undefined ? "" : `'${numero}'`} 2>/dev/null | tr -d '\\n')"`;
}

export interface MsgPausada { numero: string; nome: string | null; texto: string; em: string; tipo: string }
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

/** O que o plugin gravou, saneado: só número válido e hora legível; texto e tipo como strings. */
export function parsePausados(raw: unknown): MsgPausada[] {
  if (!Array.isArray(raw)) return [];
  const out: MsgPausada[] = [];
  for (const d of raw) {
    if (!isObj(d)) continue;
    const numero = String(d.numero ?? "").replace(/\D/g, "");
    const em = isoOrNull(d.em);
    if (!NUMBER_RE.test(numero) || em === null) continue;
    const nome = typeof d.nome === "string" && d.nome.trim() !== "" ? d.nome.trim().slice(0, 80) : null;
    out.push({ numero, nome, texto: typeof d.texto === "string" ? d.texto : "", em, tipo: typeof d.tipo === "string" && d.tipo !== "" ? d.tipo : "text" });
  }
  return out.sort((a, b) => a.em.localeCompare(b.em));
}

const ROTULO_TIPO: Record<string, string> = { voice: "(áudio)", audio: "(áudio)", photo: "(imagem)", image: "(imagem)", video: "(vídeo)", document: "(arquivo)", sticker: "(figurinha)" };

/** As mensagens de um número como bolhas do contato, marcadas como recebidas na pausa. */
export function mensagensDaPausa(list: readonly MsgPausada[], numero: string): WhatsappThreadMessage[] {
  return list.filter((m) => m.numero === numero).map((m) => ({ role: "contact" as const, text: m.texto !== "" ? m.texto : ROTULO_TIPO[m.tipo] ?? "(mídia)", at: m.em, durantePausa: true as const }));
}

/**
 * Funde o que chegou na pausa com a lista: conversa existente ganha `updatedAt` mais novo (e o nome, se não tinha);
 * quem só escreveu na pausa não tem sessão no state.db e entra aqui, pausado conforme a marca. Vai antes de
 * applyWaMarks, para "excluída volta com mensagem nova" valer também para o que chegou na pausa.
 */
export function chatsComPausados(chats: readonly WhatsappChat[], list: readonly MsgPausada[], marks: WaMarks, agora: number = Date.now()): WhatsappChat[] {
  if (list.length === 0) return [...chats];
  const ultima = new Map<string, MsgPausada>();
  for (const m of list) { const u = ultima.get(m.numero); if (u === undefined || m.em > u.em) ultima.set(m.numero, m); }
  const nomes = new Map<string, string>();
  for (const m of list) if (m.nome !== null && !nomes.has(m.numero)) nomes.set(m.numero, m.nome);
  const out: WhatsappChat[] = chats.map((c) => {
    const u = ultima.get(c.number);
    if (u === undefined) return c;
    return { ...c, name: c.name ?? nomes.get(c.number) ?? null, updatedAt: u.em > c.updatedAt ? u.em : c.updatedAt };
  });
  const temos = new Set(chats.map((c) => c.number));
  for (const [numero, u] of ultima) {
    if (temos.has(numero)) continue;
    const p = pausaVigente(marks, numero, agora);
    out.push({ number: numero, name: nomes.get(numero) ?? null, alias: null, isSelf: false, sessionKeys: [], sessionIds: {}, ownSession: true, paused: p !== null, pausaAte: p?.ate ?? null, updatedAt: u.em, archived: false, deleted: false });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
