/**
 * Chamadas às APIs do Google com o token da Conta Google (conta-google.ts): Gmail e Drive só leitura; Agenda e
 * Sheets leem e escrevem. `fetch` direto (sem googleapis). A base é injetável para teste (BASE). Escrita passa pelo
 * app com confirmação/auditoria; aqui só a chamada.
 */
import { agendaEventoDeRaw, gmailMensagemDeRaw, planilhaValoresDeRaw } from "./google-core";
import { acessoValido } from "./conta-google";

const BASE = { gmail: "https://gmail.googleapis.com", calendar: "https://www.googleapis.com", sheets: "https://sheets.googleapis.com", drive: "https://www.googleapis.com" };
export function __setBaseParaTeste(b: Partial<typeof BASE>): void { Object.assign(BASE, b); }

async function api(host: string, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const acesso = await acessoValido(host);
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${acesso}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) { const m = (j["error"] as { message?: unknown } | undefined)?.message; throw new Error(typeof m === "string" ? m : `Google respondeu ${r.status}`); }
  return j;
}

export interface GmailMensagem { id: string; de: string; assunto: string; data: string; resumo: string; naoLida: boolean }
export interface GmailResumo { email: string | null; naoLidas: number; mensagens: GmailMensagem[] }
/** Perfil + últimas mensagens (metadados) e a contagem de não lidas da caixa de entrada. */
export async function gmailResumo(host: string, max = 10): Promise<GmailResumo> {
  const perfil = await api(host, `${BASE.gmail}/gmail/v1/users/me/profile`);
  const lista = await api(host, `${BASE.gmail}/gmail/v1/users/me/messages?${new URLSearchParams({ labelIds: "INBOX", maxResults: String(Math.min(25, Math.max(1, max))) })}`);
  const ids = Array.isArray(lista["messages"]) ? (lista["messages"] as { id?: unknown }[]).map((m) => m.id).filter((x): x is string => typeof x === "string") : [];
  const mensagens: GmailMensagem[] = [];
  for (const id of ids) {
    const m = await api(host, `${BASE.gmail}/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${new URLSearchParams({ format: "metadata" })}&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    mensagens.push(gmailMensagemDeRaw(id, m));
  }
  const naoLidas = Number((await api(host, `${BASE.gmail}/gmail/v1/users/me/labels/UNREAD`))["messagesUnread"]) || 0;
  return { email: typeof perfil["emailAddress"] === "string" ? perfil["emailAddress"] : null, naoLidas, mensagens };
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
