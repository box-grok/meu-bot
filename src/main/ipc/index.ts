/**
 * Ponto único de registro dos handlers IPC da janela principal: comuns (ipc/shared.ts), do meu-bot normal
 * (ipc/client.ts) e do meu-bot-admin (admin/ipc.ts). O registry decide, pela variante, o que vira recusa.
 * Os canais do seletor são registrados por picker.ts; entrada rápida e alívio, pelos módulos deles.
 */
import { registerAdminIpc } from "../admin/ipc";
import { registerClientIpc } from "./client";
import { registerSharedIpc, type SharedIpcDeps } from "./shared";

export function registerIpc(deps: SharedIpcDeps): void {
  registerSharedIpc(deps);
  registerClientIpc();
  registerAdminIpc();
}
