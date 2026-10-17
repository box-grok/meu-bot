/**
 * Itens do menu "…" de uma conversa do WhatsApp na lista lateral. Puro (ipc/shared.ts converte para o Menu do
 * Electron): sem manageWa (o meu-bot-admin) não há "Conversar com o meu-bot"; arquivar é só deste app.
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
  // Referência = número + chave da sessão do OpenClaw (+ UUID atual), uma linha para colar numa IA.
  const referencia = item("Copiar ID", "copy-ref");
  // Apelido guardado na máquina (vale na lista e no título dos dois apps; o nome original fica dentro da conversa).
  const renomear = item("Renomear", "rename");
  const arquivo = state.archived ? item("Desarquivar", "unarchive") : item("Arquivar", "archive");
  const pausa = state.paused
    ? item("Retomar respostas do agente", "resume")
    : state.ownSession
      ? item("Pausar o agente para esta pessoa", "pause")
      : { label: "Pausar o agente (depois da próxima mensagem dela)", action: null, enabled: false } as WaMenuEntry;
  // Excluir = limpar o histórico na máquina e tirar da lista deste app, sem confirmação (volta se o contato mandar outra mensagem).
  const excluir = item("Excluir conversa", "delete");
  // Sem manageWa (o admin): exportar, arquivar, pausar, limpar e excluir (o que mexe na máquina fica no registro dela).
  if (!caps.manageWa) return [exportar, referencia, renomear, arquivo, pausa, item("Limpar histórico…", "clear"), excluir];
  return [
    item("Conversar com o meu-bot sobre isto", "talk"),
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
  const s = (payload as { state?: { archived?: unknown; paused?: unknown; ownSession?: unknown } } | null)?.state ?? {};
  return { archived: s.archived === true, paused: s.paused === true, ownSession: s.ownSession === true };
};
