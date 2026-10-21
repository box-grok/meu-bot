/**
 * Conversa do WhatsApp guardada no CRM próprio antes de "Limpar histórico" (meu-bot-crm; "Excluir" não zera nada): a
 * transcrição em Markdown (a mesma da exportação, só deste contato mesmo quando ele está na sessão principal) vai
 * para o POST /v1/crm/whatsapp/arquivar da máquina pelo túnel, que é o dono do resto: anexo e registro na caixa (ou
 * no contato), resumo consolidado, sem duplicar se for tentado de novo.
 */
import type { WhatsappArchive } from "../shared/ipc";
import { whatsappExportBody } from "./whatsapp";
import { ensureTunnel } from "./tunnel";
import { getBackendPort } from "./settings";
import { guardarNoDrive } from "./google/google";
import { log } from "./backend";

/** Mensagens lidas por sessão para arquivar (o máximo de uma página do chat.history). */
const LIMITE = 1000;

export async function whatsappArchiveToCrm(host: string, number: string): Promise<WhatsappArchive> {
  const { name, body, messages } = await whatsappExportBody(host, number, "md", LIMITE);
  if (messages.length === 0) return { vazio: true, contato: null, box: null, arquivo: null, mensagens: 0, resumo: false, aviso: null, drive: null };
  const tunnel = await ensureTunnel(host, getBackendPort(host));
  const r = await fetch(`http://127.0.0.1:${tunnel.localPort}/v1/crm/whatsapp/arquivar`, {
    method: "POST",
    headers: { authorization: `Bearer ${tunnel.apiKey}`, "content-type": "application/json", "x-crm-por": "app" },
    body: JSON.stringify({ phone: `+${number.replace(/\D/g, "")}`, nome: name, transcricao: body, mensagens: messages.length, primeiraEm: Date.parse(messages[0]!.at) || 0, ultimaEm: Date.parse(messages.at(-1)!.at) || 0 }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  const j = (await r.json().catch(() => ({}))) as { contato?: string; box?: { key: string; nome: string } | null; arquivo?: { nome?: string }; resumo?: boolean; aviso?: string; error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message ?? `o CRM respondeu ${r.status}`);
  log(`whatsapp: conversa de +${number.replace(/\D/g, "")} guardada no CRM de ${host} (${messages.length} mensagens${j.box ? `, caixa ${j.box.nome}` : ", no contato"}${j.resumo === true ? "" : `; resumo: ${j.aviso ?? "não"}`})`);
  // Cópia no Google Drive, na pasta desta máquina (uma por máquina: projetos não se misturam). Falhou = nada é limpo;
  // tentar de novo não duplica no CRM (mesmo conteúdo) e cria só a cópia que faltou no Drive.
  let drive: string | null;
  try { drive = (await guardarNoDrive(host, name, number, body, Date.parse(messages.at(-1)!.at) || 0))?.caminho ?? null; }
  catch (e) { throw new Error(`guardada no CRM, mas não no Google Drive (${e instanceof Error ? e.message : String(e)}); nada foi limpo`); }
  return { vazio: false, contato: j.contato ?? null, box: j.box ?? null, arquivo: j.arquivo?.nome ?? null, mensagens: messages.length, resumo: j.resumo === true, aviso: j.aviso ?? null, drive };
}
