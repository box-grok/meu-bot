/**
 * Itens do menu "…" de uma conversa do WhatsApp na lista lateral. Puro (ipc/shared.ts converte para o Menu do
 * Electron): sem manageWa (o meu-bot-admin) só exporta e arquiva; arquivar é deste app, nada mexe na máquina.
 */
import type { Capabilities, WhatsappMenuAction } from "../shared/ipc";

export interface WaMenuState { archived: boolean; paused: boolean; ownSession: boolean }
export type WaMenuEntry =
  | { label: string; action: WhatsappMenuAction | null; enabled: boolean }
  | { label: string; submenu: WaMenuEntry[] }
  | { separator: true };

const item = (label: string, action: WhatsappMenuAction, enabled = true): WaMenuEntry => ({ label, action, enabled });

export function waMenuTemplate(state: WaMenuState, caps: Pick<Capabilities, "manageWa">): WaMenuEntry[] {
  const exportar: WaMenuEntry = { label: "Exportar", submenu: [item("Markdown (.md)", "export-md"), item("JSON (.json)", "export-json")] };
  const arquivo = state.archived ? item("Desarquivar", "unarchive") : item("Arquivar", "archive");
  // Sem manageWa (o admin): exportar, arquivar e limpar (a limpeza fica no registro da máquina dela).
  if (!caps.manageWa) return [exportar, arquivo, item("Limpar histórico…", "clear")];
  return [
    item("Conversar com o meu-bot sobre isto", "talk"),
    exportar,
    { separator: true },
    arquivo,
    state.paused
      ? item("Retomar respostas do agente", "resume")
      : state.ownSession
        ? item("Pausar o agente para esta pessoa", "pause")
        : { label: "Pausar o agente (depois da próxima mensagem dela)", action: null, enabled: false },
    item("Limpar histórico…", "clear"),
  ];
}

/** O estado que a lista manda no payload, saneado. */
export const waMenuState = (payload: unknown): WaMenuState => {
  const s = (payload as { state?: { archived?: unknown; paused?: unknown; ownSession?: unknown } } | null)?.state ?? {};
  return { archived: s.archived === true, paused: s.paused === true, ownSession: s.ownSession === true };
};
