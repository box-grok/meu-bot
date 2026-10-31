/** Grupos do WhatsApp com o agente: nome para a tela, grupo alvo da pessoa, quem aciona e os avisos fixos. Puro, com teste. */
import type { WhatsappGroup, WhatsappGroups } from "../../shared/ipc";

/** Nome do grupo para a tela: o apelido dado no app, senão o nome do WhatsApp, senão o id. */
export const nomeDoGrupo = (g: WhatsappGroup): string => g.apelido ?? g.nome ?? g.jid.replace(/@g\.us$/, "");
/** "Quem chama: só você" / "você + 2" / "todo mundo do grupo" (o número do agente não conta). */
export function quemResumo(info: WhatsappGroups | null): string | null {
  if (info === null || !quemEscolhido(info)) return null;
  if (info.quemAciona === "todos") return "Quem chama: todo mundo do grupo";
  const outros = info.quemAciona.filter((n) => n !== info.self).length;
  return outros <= 1 ? "Quem chama: só você" : `Quem chama: você + ${outros - 1}`;
}
/**
 * Grupo do tutorial 11: o que a pessoa escolheu (se ainda existe na máquina); sem escolha, o primeiro com o agente
 * ligado (máquina que já tem grupo configurado entra com os passos concluídos pelo estado real).
 */
export function grupoAlvo(info: WhatsappGroups | null, escolhido: string | null): WhatsappGroup | null {
  if (info === null) return null;
  return info.grupos.find((g) => g.jid === escolhido) ?? info.grupos.find((g) => g.agente !== "desligado") ?? null;
}
/** Quem aciona o agente nos grupos já foi escolhido de propósito (lista própria ou "todos"), não herdado das diretas. */
export const quemEscolhido = (info: WhatsappGroups | null): boolean =>
  info !== null && !info.quemAcionaHerdado && (info.quemAciona === "todos" || info.quemAciona.length > 0);
export const GRUPOS_AVISO = "Só grupos internos, com gente de casa. Nunca ligue o agente num grupo com clientes.";
export const GRUPOS_QUEM_NOTA = "Quem não está nesta lista pode escrever no grupo à vontade: o agente simplesmente não responde a essa pessoa. A lista vale para todos os grupos com o agente ligado.";
