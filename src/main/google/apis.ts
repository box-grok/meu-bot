/**
 * Chamadas às APIs do Google com o token da Conta Google (conta-google.ts): Drive só leitura; Gmail lê e move para a
 * lixeira; Agenda e Sheets leem e escrevem. `fetch` direto (sem googleapis). A base é injetável para teste (BASE). Escrita passa pelo
 * app com confirmação/auditoria; aqui só a chamada.
 */
import { agendaEventoDeRaw, gmailMensagemDeRaw, planilhaValoresDeRaw } from "./google-core";
import { linkDoGmail, mensagemDetalheDeRaw, validaMax } from "./gmail-core";
import { acessoValido, contaStatus } from "./conta-google";
import { registrar } from "../auditoria/auditoria";
import type { GmailApagado, GmailDetalhe, GmailLista, GmailMensagem } from "../../shared/ipc";

const BASE = { gmail: "https://gmail.googleapis.com", calendar: "https://www.googleapis.com", sheets: "https://sheets.googleapis.com", drive: "https://www.googleapis.com" };
export function __setBaseParaTeste(b: Partial<typeof BASE>): void { Object.assign(BASE, b); }

async function api(host: string, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const acesso = await acessoValido(host);
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${acesso}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) { const m = (j["error"] as { message?: unknown } | undefined)?.message; throw new Error(typeof m === "string" ? m : `Google respondeu ${r.status}`); }
  return j;
}

const GMAIL = (): string => `${BASE.gmail}/gmail/v1/users/me`;
const urlMensagem = (id: string, q: string): string => `${GMAIL()}/messages/${encodeURIComponent(id)}?${q}`;
/** Só os cabeçalhos da lista (From/Subject/Date): barato, e o bastante para a linha e para dizer o que foi apagado. */
const lerMetadados = async (host: string, id: string): Promise<GmailMensagem> => gmailMensagemDeRaw(id, await api(host, urlMensagem(id, "format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date")));

/**
 * Uma página da caixa de entrada (sem busca) ou de uma busca do Gmail (`busca`, a mesma sintaxe da caixa de busca).
 * Os metadados das mensagens vêm em paralelo, de 5 em 5 (em série, 25 mensagens levavam segundos).
 */
export async function gmailListar(host: string, opts: { busca?: string; max?: number; pagina?: string | undefined } = {}): Promise<GmailLista> {
  const busca = opts.busca ?? "";
  const q = new URLSearchParams({ maxResults: String(validaMax(opts.max)) });
  if (busca === "") q.set("labelIds", "INBOX"); else q.set("q", busca);
  if (opts.pagina !== undefined) q.set("pageToken", opts.pagina);
  const [perfil, lista, naoLidasRaw] = await Promise.all([
    api(host, `${GMAIL()}/profile`),
    api(host, `${GMAIL()}/messages?${q}`),
    api(host, `${GMAIL()}/labels/UNREAD`),
  ]);
  const ids = Array.isArray(lista["messages"]) ? (lista["messages"] as { id?: unknown }[]).map((m) => m.id).filter((x): x is string => typeof x === "string") : [];
  const mensagens: GmailMensagem[] = [];
  for (let i = 0; i < ids.length; i += 5) mensagens.push(...(await Promise.all(ids.slice(i, i + 5).map((id) => lerMetadados(host, id)))));
  return { email: typeof perfil["emailAddress"] === "string" ? perfil["emailAddress"] : null, naoLidas: Number(naoLidasRaw["messagesUnread"]) || 0, mensagens, proxima: typeof lista["nextPageToken"] === "string" ? lista["nextPageToken"] : null, busca };
}
/** A mensagem inteira: cabeçalhos, corpo em texto e os nomes dos anexos (o conteúdo deles não é baixado). */
export async function gmailLer(host: string, id: string): Promise<GmailDetalhe> {
  return { ...mensagemDetalheDeRaw(id, await api(host, urlMensagem(id, "format=full"))), link: linkDoGmail(id) };
}
/**
 * Move para a lixeira (reversível por 30 dias; apagar de vez exigiria o escopo total do Gmail e fica de fora).
 * Pede `gmail.modify`: uma conta conectada antes de 31 out lê, mas não apaga até reconectar (GMAIL_SEM_PERMISSAO).
 * `quem`: rótulo para a auditoria quando o pedido vem do agente ("conversa X"); vazio = a própria pessoa na tela.
 */
export async function gmailApagar(host: string, id: string, quem = ""): Promise<GmailApagado> {
  if (!contaStatus(host).gmailEscreve) throw new Error("GMAIL_SEM_PERMISSAO");
  const m = await lerMetadados(host, id);
  await api(host, `${GMAIL()}/messages/${encodeURIComponent(id)}/trash`, { method: "POST" });
  void registrar(host, "gmail.apagar", `${m.assunto} · ${m.de}`, quem);
  return { id, de: m.de, assunto: m.assunto, data: m.data };
}
/** Desfaz o `gmailApagar`: tira da lixeira (a mensagem volta às pastas de antes). */
export async function gmailRestaurar(host: string, id: string, quem = ""): Promise<GmailApagado> {
  if (!contaStatus(host).gmailEscreve) throw new Error("GMAIL_SEM_PERMISSAO");
  const m = await lerMetadados(host, id);
  await api(host, `${GMAIL()}/messages/${encodeURIComponent(id)}/untrash`, { method: "POST" });
  void registrar(host, "gmail.restaurar", `${m.assunto} · ${m.de}`, quem);
  return { id, de: m.de, assunto: m.assunto, data: m.data };
}

export interface AgendaEvento { id: string; titulo: string; inicio: string; fim: string; local: string; link: string }
export async function agendaProximos(host: string, dias = 7): Promise<AgendaEvento[]> {
  const agora = new Date(); const ate = new Date(agora.getTime() + Math.min(90, Math.max(1, dias)) * 86_400_000);
  const q = new URLSearchParams({ timeMin: agora.toISOString(), timeMax: ate.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "50" });
  const j = await api(host, `${BASE.calendar}/calendar/v3/calendars/primary/events?${q}`);
  return (Array.isArray(j["items"]) ? (j["items"] as Record<string, unknown>[]) : []).map(agendaEventoDeRaw);
}
export async function agendaCriar(host: string, e: { titulo: string; inicio: string; fim: string; descricao?: string }): Promise<AgendaEvento> {
  const corpo = { summary: e.titulo, ...(e.descricao ? { description: e.descricao } : {}), start: { dateTime: e.inicio }, end: { dateTime: e.fim } };
  return agendaEventoDeRaw(await api(host, `${BASE.calendar}/calendar/v3/calendars/primary/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }));
}

export interface PlanilhaLeitura { intervalo: string; valores: string[][] }
export async function planilhaLer(host: string, id: string, intervalo: string): Promise<PlanilhaLeitura> {
  const j = await api(host, `${BASE.sheets}/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(intervalo)}`);
  return { intervalo: typeof j["range"] === "string" ? j["range"] : intervalo, valores: planilhaValoresDeRaw(j) };
}
export async function planilhaEscrever(host: string, id: string, intervalo: string, valores: string[][]): Promise<{ celulasAtualizadas: number }> {
  const j = await api(host, `${BASE.sheets}/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(intervalo)}?valueInputOption=USER_ENTERED`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ range: intervalo, values: valores }) });
  return { celulasAtualizadas: Number(j["updatedCells"]) || 0 };
}
