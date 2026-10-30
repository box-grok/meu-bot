/**
 * Itens do menu "…" de uma conversa do WhatsApp na lista lateral. Puro (ipc/shared.ts converte para o Menu do
 * Electron): sem manageWa (o meu-bot-admin) não há "Conversar com o meu-bot"; arquivar é só deste app.
 */
import type { Capabilities, WhatsappCapacidades, WhatsappGroupAgent, WhatsappGroupMenuAction, WhatsappMenuAction } from "../../shared/ipc";

/** O que a máquina sabe fazer, no que importa ao menu (whatsapp-capacidades.ts). `null` = desconhecido: vale o menu completo. */
export type WaMenuCaps = Pick<WhatsappCapacidades, "pausar" | "pausaPrazo" | "limparHistorico" | "grupos">;
/** Desconhecido = menu completo, menos o prazo da pausa: sem saber se a máquina o sustenta, "Pausar" simples não falha. */
const TUDO: WaMenuCaps = { pausar: true, pausaPrazo: false, limparHistorico: true, grupos: true };

/** `deleted`: excluída para a pessoa (só o meu-bot-admin a vê na lista, para restaurar). `pausaRotulo`: "até 14:30", pronto da tela, ou null. */
export interface WaMenuState { archived: boolean; paused: boolean; deleted: boolean; pausaRotulo: string | null }
export type WaMenuEntry =
  | { label: string; action: WhatsappMenuAction | null; enabled: boolean }
  | { label: string; submenu: WaMenuEntry[] }
  | { separator: true };

const item = (label: string, action: WhatsappMenuAction, enabled = true): WaMenuEntry => ({ label, action, enabled });

/**
 * `cap`: o menu pergunta o que a máquina sabe fazer, não qual framework ela roda. Sem `pausar` (Hermes: o `hermes pause`
 * é parada geral, não por contato) não há "Pausar"; sem `limparHistorico` não há "Limpar histórico…".
 */
export function waMenuTemplate(state: WaMenuState, caps: Pick<Capabilities, "manageWa">, cap: WaMenuCaps | null = null): WaMenuEntry[] {
  const pode = cap ?? TUDO;
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
  // Com `pausaPrazo` (Hermes com o plugin meu-bot-pausa) a pausa tem prazo e vale em qualquer política; sem ela,
  // ninguém na máquina devolveria o contato quando o prazo vencesse, então só "até eu retomar".
  const pausa: WaMenuEntry = state.paused
    ? item(state.pausaRotulo === null ? "Retomar" : `Retomar (${state.pausaRotulo})`, "resume")
    : pode.pausaPrazo
      ? { label: "Pausar o agente", submenu: [item("Por 2 horas", "pause-2h"), item("Por 24 horas", "pause-24h"), item("Até eu retomar", "pause")] }
      : item("Pausar", "pause");
  // Excluir = só tirar da lista (o agente continua de onde parou), sem confirmação; volta se o contato mandar outra mensagem. Zerar é o Limpar.
  const excluir = item("Excluir conversa", "delete");
  const mexe: WaMenuEntry[] = [...(pode.pausar ? [pausa] : []), ...(pode.limparHistorico ? [item("Limpar histórico…", "clear")] : [])];
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
  const s = (payload as { state?: { archived?: unknown; paused?: unknown; deleted?: unknown; pausaRotulo?: unknown } } | null)?.state ?? {};
  const r = s.pausaRotulo;
  const pausaRotulo = typeof r === "string" && r.length >= 1 && r.length <= 40 && !/[\r\n]/.test(r) ? r : null;
  return { archived: s.archived === true, paused: s.paused === true, deleted: s.deleted === true, pausaRotulo };
};

/**
 * Menu "…" de um grupo: ligar/desligar e quem pode conversar (só com `grupos`), copiar o id, limpar (só com
 * `limparHistorico`), excluir da lista e reler a lista (para o gateway ~30 s). Copiar, excluir e reler sempre.
 */
export type WaGroupMenuEntry = { label: string; action: WhatsappGroupMenuAction } | { separator: true };
/**
 * `deleted` = o grupo está excluído da lista (marca na máquina, só a vista): o menu vira Restaurar + Copiar ID. Excluir
 * entra sempre (pedido do dono, 25 out): só tira da lista, sem mexer no agente. A configuração do agente nunca muda
 * por excluir/restaurar.
 */
export function waGroupMenuTemplate(agente: WhatsappGroupAgent, cap: WaMenuCaps | null = null, deleted = false): WaGroupMenuEntry[] {
  const pode = cap ?? TUDO;
  const excluir: WaGroupMenuEntry = { label: "Excluir da lista", action: "group-delete" };
  const cauda: WaGroupMenuEntry[] = [{ separator: true }, { label: "Atualizar lista de grupos…", action: "groups-refresh" }];
  if (deleted) return [{ label: "Restaurar na lista", action: "group-restore" }, { label: "Copiar ID", action: "group-copy-id" }, ...cauda];
  return [
    ...(pode.grupos ? [
      agente === "desligado" ? { label: "Ligar o agente…", action: "group-on" } as WaGroupMenuEntry : { label: "Desligar o agente", action: "group-off" } as WaGroupMenuEntry,
      { label: "Quem pode conversar…", action: "group-who" } as WaGroupMenuEntry,
    ] : []),
    { label: "Copiar ID", action: "group-copy-id" },
    // Apelido só na lista (marca na máquina): o nome vem do WhatsApp pelo cache da skill, e sem ele o grupo ficaria "sem nome".
    { label: "Renomear", action: "group-rename" },
    // Zera a sessão do agente neste grupo (no Hermes, uma por remetente); antes, a conversa vai para uma caixa do CRM.
    // Sem reticências: no grupo o clique limpa direto, sem caixa de confirmação (na conversa ainda confirma).
    ...(pode.limparHistorico ? [{ label: "Limpar histórico", action: "group-clear" } as WaGroupMenuEntry] : []),
    excluir,
    ...cauda,
  ];
}
export const waGroupDeleted = (payload: unknown): boolean => (payload as { state?: { deleted?: unknown } } | null)?.state?.deleted === true;
export const waGroupAgente = (payload: unknown): WhatsappGroupAgent => {
  const a = (payload as { state?: { agente?: unknown } } | null)?.state?.agente;
  return a === "mencao" || a === "sempre" ? a : "desligado";
};
