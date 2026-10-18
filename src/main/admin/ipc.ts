/**
 * Variante: admin. Handlers IPC do meu-bot-admin: a página "Suporte" da máquina de uma pessoa (saúde,
 * registros, ações). Só valem numa janela de pessoa do suporte (alias `suporte-…`); no meu-bot normal o
 * registro vira recusa (ipc/registry.ts).
 */
import { Menu } from "electron";
import type { BotMenuAction } from "../../shared/ipc";
import { isSupportAlias } from "../support-code";
import type { LicensePatch } from "../../shared/ipc";
import { adminAction, adminBotChats, adminBotDelete, adminBotThread, adminHealth, adminLogs, approveDevice, removeDevice, setLicense } from "./support-admin";
import { hostFromEvent } from "../ipc/context";
import { handleAdmin } from "../ipc/registry";

/** A máquina da pessoa do suporte que pediu; recusa qualquer outra janela. */
const adminHost = (event: Electron.IpcMainInvokeEvent): string => {
  const h = hostFromEvent(event);
  if (h === null || !isSupportAlias(h.host)) throw new Error("origem inválida");
  return h.host;
};

export function registerAdminIpc(): void {
  handleAdmin("admin:health", (event) => adminHealth(adminHost(event)));
  handleAdmin("admin:logs", (event) => adminLogs(adminHost(event)));
  handleAdmin("admin:bot-chats", (event) => adminBotChats(adminHost(event)));
  handleAdmin("admin:bot-thread", (event, payload: unknown) => adminBotThread(adminHost(event), String((payload as { sessionId?: unknown } | null)?.sessionId ?? "")));
  handleAdmin("admin:bot-delete", (event, payload: unknown) => adminBotDelete(adminHost(event), String((payload as { sessionId?: unknown } | null)?.sessionId ?? "")));
  // Menu "…" de uma conversa dela com o meu-bot (espelho): só "Copiar ID"; o apagar fica no cabeçalho.
  handleAdmin("ui:bot-menu", (event) => {
    const h = hostFromEvent(event);
    if (h === null || !isSupportAlias(h.host)) return null;
    return new Promise<BotMenuAction | null>((resolve) => {
      let settled = false;
      const pick = (action: BotMenuAction | null): void => { if (!settled) { settled = true; resolve(action); } };
      const menu = Menu.buildFromTemplate([{ label: "Copiar ID", click: () => pick("copy-ref") }]);
      // O callback de fechamento corre antes do click; o adiamento deixa o click vencer.
      menu.popup({ window: h.win, callback: () => setTimeout(() => pick(null), 0) });
    });
  });
  handleAdmin("admin:action", (event, payload: unknown) => {
    const host = adminHost(event);
    const a = (payload as { action?: unknown } | null)?.action;
    if (a !== "restart-gateway" && a !== "restart-backend" && a !== "transcription" && a !== "transcription-off" && a !== "support-off") throw new Error("ação inválida");
    return adminAction(host, a);
  });
  // Licença da conta: o admin é o dono e grava por SSH (plano/status/validade/limite e liberar device pendente).
  handleAdmin("admin:license-set", (event, payload: unknown) => {
    const patch = (payload as { patch?: unknown } | null)?.patch;
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw new Error("mudança inválida");
    return setLicense(adminHost(event), patch as LicensePatch);
  });
  handleAdmin("admin:license-approve", (event, payload: unknown) => {
    const id = String((payload as { deviceId?: unknown } | null)?.deviceId ?? "");
    return approveDevice(adminHost(event), id);
  });
  handleAdmin("admin:license-revoke", (event, payload: unknown) => {
    const id = String((payload as { deviceId?: unknown } | null)?.deviceId ?? "");
    return removeDevice(adminHost(event), id);
  });
}
