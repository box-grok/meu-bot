/** Quem pediu: a janela principal registrada e a máquina dela. Comum a ipc/shared.ts, ipc/client.ts e admin/ipc.ts. */
import { BrowserWindow } from "electron";
import { getConversation } from "../conversation";
import { hostOfWindow } from "../windows";

export const windowFromEvent = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender);

/** Janela registrada + máquina dela; null para remetentes que não são uma janela principal. */
export const hostFromEvent = (event: Electron.IpcMainInvokeEvent): { win: BrowserWindow; host: string } | null => {
  const win = windowFromEvent(event);
  const host = win === null ? undefined : hostOfWindow(win);
  return win === null || host === undefined ? null : { win, host };
};

export const EXTERNAL_URL = /^https?:\/\/[^\s]{1,2048}$/;

/** Conversa do payload, só se for da máquina da janela que pediu. */
export const ownedConversation = (event: Electron.IpcMainInvokeEvent, payload: unknown) => {
  const ctx = hostFromEvent(event);
  const id = (payload as { conversationId?: unknown })?.conversationId;
  if (ctx === null || typeof id !== "string") return null;
  const conv = getConversation(id);
  return conv !== undefined && conv.host === ctx.host ? { win: ctx.win, host: ctx.host, conv } : null;
};

/** Número do WhatsApp do payload, só dígitos. */
export const waNumber = (payload: unknown): string => {
  const n = (payload as { number?: unknown } | null)?.number;
  if (typeof n !== "string" || !/^\+?\d{8,15}$/.test(n)) throw new Error("número inválido");
  return n.replace(/\D/g, "");
};
