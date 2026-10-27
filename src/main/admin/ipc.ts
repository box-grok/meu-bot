/**
 * Variante: admin. Handlers IPC do meu-bot-admin: a página "Suporte" da máquina de uma pessoa (saúde,
 * registros, ações). Só valem numa janela de pessoa do suporte (alias `suporte-…`); no meu-bot normal o
 * registro vira recusa (ipc/registry.ts).
 */
import { Menu } from "electron";
import type { BotMenuAction } from "../../shared/ipc";
import { isSupportAlias } from "../suporte/support-code";
import type { LicensePatch } from "../../shared/ipc";
import { adminAction, adminBotChats, adminBotDelete, adminBotThread, adminHealth, adminLogs, approveDevice, removeDevice, setLicense } from "./support-admin";
import { hostFromEvent } from "../ipc/context";
import { handleAdmin } from "../ipc/registry";
import { listProdutos } from "./produtos";
import { auditoriaDaJanela, auditoriaExportarDaJanela, auditoriaVisivel } from "./auditoria-admin";
import { conferirRestauracao, criarBackup, listarBackups, restaurarBackup, trocarWhatsapp } from "./backup-admin";

/** A máquina da pessoa do suporte que pediu; recusa qualquer outra janela. */
const adminHost = (event: Electron.IpcMainInvokeEvent): string => {
  const h = hostFromEvent(event);
  if (h === null || !isSupportAlias(h.host)) throw new Error("origem inválida");
  return h.host;
};

export function registerAdminIpc(): void {
  // Produtos (MVPs de bots verticais): registro local do admin, em qualquer janela do meu-bot-admin.
  handleAdmin("admin:produtos-list", () => listProdutos());
  handleAdmin("admin:health", (event) => adminHealth(adminHost(event)));
  // Auditoria (só o super admin): o registro da máquina desta janela, na aba própria abaixo de Suporte.
  handleAdmin("admin:auditoria-visivel", () => auditoriaVisivel());
  handleAdmin("admin:auditoria", (event) => auditoriaDaJanela(adminHost(event)));
  handleAdmin("admin:auditoria-exportar", (event) => auditoriaExportarDaJanela(adminHost(event)));
  // Backup e mudança de máquina (backup-admin.ts): o progresso vai para a janela que pediu.
  const arq = (payload: unknown): string => { const a = String((payload as { arquivo?: unknown } | null)?.arquivo ?? ""); if (!/^[a-z0-9-]+\.mbbak$/.test(a)) throw new Error("backup inválido"); return a; };
  const subst = (payload: unknown): boolean => (payload as { substituir?: unknown } | null)?.substituir === true;
  const enviar = (event: Electron.IpcMainInvokeEvent) => (p: { bytes?: number; line?: string }): void => { if (!event.sender.isDestroyed()) event.sender.send("admin:backup-progress", p); };
  handleAdmin("admin:backup-listar", (event, payload: unknown) => listarBackups((payload as { todos?: unknown } | null)?.todos === true ? undefined : adminHost(event)));
  handleAdmin("admin:backup-criar", (event) => criarBackup(adminHost(event), (bytes) => enviar(event)({ bytes })));
  handleAdmin("admin:backup-conferir", (event, payload: unknown) => conferirRestauracao(arq(payload), adminHost(event), subst(payload)));
  handleAdmin("admin:backup-restaurar", (event, payload: unknown) => restaurarBackup(arq(payload), adminHost(event), subst(payload), (line) => enviar(event)({ line })));
  handleAdmin("admin:backup-whatsapp", (event, payload: unknown) => trocarWhatsapp(arq(payload), adminHost(event), (payload as { antigaDesligada?: unknown } | null)?.antigaDesligada === true));
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
      const menu = Menu.buildFromTemplate([{ label: "Copiar ID  ⓘ", click: () => pick("copy-ref") }]);
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
