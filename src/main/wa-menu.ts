/**
 * Itens do menu "…" de uma conversa do WhatsApp na lista lateral. Puro (ipc/shared.ts converte para o Menu do
 * Electron): sem manageWa (o meu-bot-admin) não há "Conversar com o meu-bot"; arquivar é só deste app.
 */
import type { Capabilities, Gateway, WhatsappGroupAgent, WhatsappGroupMenuAction, WhatsappMenuAction } from "../shared/ipc";

/** `deleted`: excluída para a pessoa (só o meu-bot-admin a vê na lista, para restaurar). */
export interface WaMenuState { archived: boolean; paused: boolean; deleted: boolean }
export type WaMenuEntry =
  | { label: string; action: WhatsappMenuAction | null; enabled: boolean }
  | { label: string; submenu: WaMenuEntry[] }
  | { separator: true };

const item = (label: string, action: WhatsappMenuAction, enabled = true): WaMenuEntry => ({ label, action, enabled });

/**
 * `gateway`: no Hermes não há "Pausar" (o `hermes pause` é parada geral, não por contato); "Limpar histórico" existe
 * (encerra a sessão do contato como o /reset do gateway, guardando antes no CRM, como no OpenClaw).
 */
export function waMenuTemplate(state: WaMenuState, caps: Pick<Capabilities, "manageWa">, gateway: Gateway | null = "openclaw"): WaMenuEntry[] {
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
  const mexe: WaMenuEntry[] = gateway === "hermes" ? [item("Limpar histórico…", "clear")] : [pausa, item("Limpar histórico…", "clear")];
  // Sem manageWa (o admin): exportar, arquivar, pausar, limpar e excluir (o que mexe na máquina fica no registro dela).
  if (!caps.manageWa) return [exportar, referencia, renomear, arquivo, ...mexe, excluir];
  return [
    item("Conversar", "talk"),
    exportar,
    referencia,
    { separator: true },
    renomear,
    arquivo,
    ...mexe,
    excluir,
  ];
}

/** O estado que a lista manda no payload, saneado. */
export const waMenuState = (payload: unknown): WaMenuState => {
  const s = (payload as { state?: { archived?: unknown; paused?: unknown; deleted?: unknown } } | null)?.state ?? {};
  return { archived: s.archived === true, paused: s.paused === true, deleted: s.deleted === true };
};

/**
 * Menu "…" de um grupo: ligar/desligar, quem pode conversar, copiar o id e reler a lista (para o gateway ~30 s).
 * `gateway`: ligar/desligar, quem aciona e limpar são do `openclaw.json`/gateway do OpenClaw; no Hermes ficam só
 * "Copiar ID" e reler a lista (a skill whatsapp-grupos existe lá também).
 */
export type WaGroupMenuEntry = { label: string; action: WhatsappGroupMenuAction } | { separator: true };
/**
 * `deleted` = o grupo está excluído da lista (marca na máquina, só a vista): o menu vira Restaurar + Copiar ID. Excluir
 * entra com o agente desligado (grupo ligado sumir da lista enquanto o agente responde nele seria armadilha) e, no
 * Hermes, sempre (lá o app não liga nem desliga grupo). O openclaw.json nunca muda por excluir/restaurar.
 */
export function waGroupMenuTemplate(agente: WhatsappGroupAgent, gateway: Gateway | null = "openclaw", deleted = false): WaGroupMenuEntry[] {
  const excluir: WaGroupMenuEntry = { label: "Excluir da lista", action: "group-delete" };
  const cauda: WaGroupMenuEntry[] = [{ separator: true }, { label: "Atualizar lista de grupos…", action: "groups-refresh" }];
  if (deleted) return [{ label: "Restaurar na lista", action: "group-restore" }, { label: "Copiar ID", action: "group-copy-id" }, ...cauda];
  if (gateway === "hermes") return [{ label: "Copiar ID", action: "group-copy-id" }, excluir, ...cauda];
  return [
    agente === "desligado" ? { label: "Ligar o agente…", action: "group-on" } : { label: "Desligar o agente", action: "group-off" },
    { label: "Quem pode conversar…", action: "group-who" },
    { label: "Copiar ID", action: "group-copy-id" },
    // Zera a sessão do agente neste grupo; antes, a conversa vai para uma caixa do CRM (a tela escolhe qual).
    // Sem reticências: no grupo o clique limpa direto, sem caixa de confirmação (na conversa ainda confirma).
    { label: "Limpar histórico", action: "group-clear" },
    ...(agente === "desligado" ? [excluir] : []),
    ...cauda,
  ];
}
export const waGroupDeleted = (payload: unknown): boolean => (payload as { state?: { deleted?: unknown } } | null)?.state?.deleted === true;
export const waGroupAgente = (payload: unknown): WhatsappGroupAgent => {
  const a = (payload as { state?: { agente?: unknown } } | null)?.state?.agente;
  return a === "mencao" || a === "sempre" ? a : "desligado";
};
