/**
 * Itens do menu "…" de uma conversa do WhatsApp na lista lateral. Puro (ipc/shared.ts converte para o Menu do
 * Electron): sem manageWa (o meu-bot-admin) não há "Conversar com o meu-bot"; arquivar é só deste app.
 */
import type { Capabilities, WhatsappMenuAction } from "../shared/ipc";

/** `deleted`: excluída para a pessoa (só o meu-bot-admin a vê na lista, para restaurar). */
export interface WaMenuState { archived: boolean; paused: boolean; deleted: boolean }
export type WaMenuEntry =
  | { label: string; action: WhatsappMenuAction | null; enabled: boolean }
  | { label: string; submenu: WaMenuEntry[] }
  | { separator: true };

const item = (label: string, action: WhatsappMenuAction, enabled = true): WaMenuEntry => ({ label, action, enabled });

export function waMenuTemplate(state: WaMenuState, caps: Pick<Capabilities, "manageWa">): WaMenuEntry[] {
  const exportar: WaMenuEntry = { label: "Exportar", submenu: [item("Markdown (.md)", "export-md"), item("JSON (.json)", "export-json")] };
  // Excluída: nada foi apagado (a conversa e o agente continuam na máquina); dá para ler, exportar e restaurar.
  if (state.deleted) return [exportar, item("Copiar ID  ⓘ", "copy-ref"), item("Restaurar", "restore")];
  // Referência = número + chave da sessão do OpenClaw (+ UUID atual), uma linha para colar numa IA.
  // "ⓘ": a primeira cópia abre um balão dizendo o que o ID é (menu nativo não tem segundo alvo de clique).
  const referencia = item("Copiar ID  ⓘ", "copy-ref");
  // Apelido guardado na máquina (vale na lista e no título dos dois apps; o nome original fica dentro da conversa).
  const renomear = item("Renomear", "rename");
  const arquivo = state.archived ? item("Desarquivar", "unarchive") : item("Arquivar", "archive");
  // Pausar vale também sem sessão própria: a pausa fica na lista durável do openclaw.json (whatsapp-pause.ts).
  const pausa = state.paused ? item("Retomar", "resume") : item("Pausar", "pause");
  // Excluir = só tirar da lista (o agente continua de onde parou), sem confirmação; volta se o contato mandar outra mensagem. Zerar é o Limpar.
  const excluir = item("Excluir conversa", "delete");
  // Sem manageWa (o admin): exportar, arquivar, pausar, limpar e excluir (o que mexe na máquina fica no registro dela).
  if (!caps.manageWa) return [exportar, referencia, renomear, arquivo, pausa, item("Limpar histórico…", "clear"), excluir];
  return [
    item("Conversar", "talk"),
    exportar,
    referencia,
    { separator: true },
    renomear,
    arquivo,
    pausa,
    item("Limpar histórico…", "clear"),
    excluir,
  ];
}

/** O estado que a lista manda no payload, saneado. */
export const waMenuState = (payload: unknown): WaMenuState => {
  const s = (payload as { state?: { archived?: unknown; paused?: unknown; deleted?: unknown } } | null)?.state ?? {};
  return { archived: s.archived === true, paused: s.paused === true, deleted: s.deleted === true };
};
