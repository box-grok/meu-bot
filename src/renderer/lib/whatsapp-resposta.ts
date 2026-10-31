/** Quem o agente responde no WhatsApp: os cartões (só eu / todo mundo / lista), a leitura da política gravada e os números da lista. Puro, com teste. */
import type { WhatsappStatus } from "../../shared/ipc";

/** Quem o agente responde, como o guia e o modal oferecem (os mesmos dois cartões). */
export interface ReplyOption { id: "self" | "open" | "list"; title: string; text: string; isDefault: boolean }
export const REPLY_OPTIONS: readonly ReplyOption[] = [
  { id: "self", title: "Desativado: só eu falo com o agente", text: "O agente só responde mensagens que você manda para si mesmo. Ninguém mais recebe resposta nem código de pareamento.", isDefault: true },
  { id: "open", title: "Responder todo mundo", text: "Logo depois do pareamento, o agente responde qualquer pessoa que mandar mensagem para este número.", isDefault: false },
  { id: "list", title: "Só alguns contatos", text: "Você e os números que você listar. Quem não estiver na lista não recebe resposta nem código.", isDefault: false },
];
export const REPLY_NOTE = "Para atender clientes, as respostas precisam estar ativas. Você pode testar só com você agora e ativar depois no canal WhatsApp.";
/** Texto do cartão "só eu" quando o dono não é o aparelho: o agente responde ao dono, do celular dele. */
export const replySelfTextoDono = (donoFmt: string): string => `O agente só responde ao dono (${donoFmt}). Ninguém mais recebe resposta nem código de pareamento.`;
/** Aviso nos cartões Lista/Todo mundo quando o agente roda no próprio número da pessoa (Hermes): o próprio chat não é respondido nesses modos. */
export const REPLY_AVISO_SELF_CHAT = "Neste modo o Hermes não responde ao seu próprio chat (limitação dele): para falar com o agente e atender outras pessoas, use um número dedicado para o agente e cadastre o seu como dono.";
/** A linha "Dono" do bloco "Quem o agente responde": quem é e de onde fala. */
export function donoLinhaTexto(dono: { numero: string; souEu: boolean }, agenteNumero: string | null, fmt: (n: string) => string): string {
  if (dono.souEu) return `${fmt(dono.numero)} · você (este número)`;
  return `${fmt(dono.numero)} · você, do seu celular${agenteNumero !== null ? ` (o agente atende em ${fmt(agenteNumero)})` : ""}`;
}
export const DONO_HINT = "O dono fala com o agente de qualquer modo, nunca é pausado e recebe os avisos. Troque só se o agente roda num número dedicado e você fala com ele do seu celular.";
/** Só dígitos de um número como o OpenClaw guarda ("+5511…", "5511…"). */
export const digitsOf = (n: string): string => n.replace(/\D/g, "");
/** Números da allowlist além do aparelho e do dono (sem "*"): o que a pessoa listou. */
export function listedNumbers(allowFrom: readonly string[] | undefined, self: string | null, dono: string | null = self): string[] {
  return [...new Set((allowFrom ?? []).filter((n) => n !== "*").map(digitsOf).filter((n) => n !== "" && n !== self && n !== dono))];
}
/**
 * A política gravada no OpenClaw → qual cartão está marcado (null = nenhum: pairing ou disabled). allowlist com
 * alguém além do dono em allowFrom é "list"; só o dono (ou vazio) é "self".
 */
export function replyChoiceOf(dmPolicy: WhatsappStatus["dmPolicy"], allowFrom?: readonly string[], self: string | null = null, dono: string | null = self): "self" | "open" | "list" | null {
  if (dmPolicy === "open") return "open";
  if (dmPolicy !== "allowlist") return null;
  return listedNumbers(allowFrom, self, dono).length > 0 ? "list" : "self";
}
/**
 * Texto digitado → números para a lista (um por linha, vírgula ou ponto e vírgula). Sem "+", 10 ou 11 dígitos
 * é número brasileiro com DDD e ganha o 55. `bad` são os que não viraram número (8 a 15 dígitos).
 */
export function parseWaNumbers(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = []; const bad: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const item = raw.trim(); if (item === "") continue;
    let d = digitsOf(item);
    if (!item.startsWith("+") && (d.length === 10 || d.length === 11)) d = `55${d}`;
    if (/^\d{8,15}$/.test(d)) { if (!ok.includes(d)) ok.push(d); } else bad.push(item);
  }
  return { ok, bad };
}
