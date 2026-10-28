/**
 * Variante: admin-mac (meu-bot-admin-mac). A única janela do app: "Contas deste Mac". Abre sozinha (sem seletor de
 * máquinas) e ao clicar no app; os canais mac:* só respondem a ela.
 */
import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { handleMac } from "../ipc/registry";
import { caps } from "../app/variant";
import { backgroundColor, MIN_WINDOW_WIDTH } from "../app/windows";
import { apagarUsuarioMac, apelidoUsuarioMac, criarUsuarioMac, listarUsuariosMac } from "./usuarios-mac";

let win: BrowserWindow | null = null;
const soDaJanela = (event: Electron.IpcMainInvokeEvent): void => { if (win === null || win.isDestroyed() || event.sender !== win.webContents) throw new Error("origem inválida"); };
const campo = (p: unknown, k: string): unknown => (p !== null && typeof p === "object" ? (p as Record<string, unknown>)[k] : undefined);

export function registerUsuariosMacIpc(): void {
  handleMac("mac:usuarios", (event) => { soDaJanela(event); return listarUsuariosMac(); });
  handleMac("mac:usuario-criar", (event, p) => { soDaJanela(event); return criarUsuarioMac(campo(p, "nome")); });
  handleMac("mac:usuario-apagar", (event, p) => { soDaJanela(event); return apagarUsuarioMac(campo(p, "nome")); });
  handleMac("mac:usuario-apelido", (event, p) => { soDaJanela(event); return apelidoUsuarioMac(campo(p, "nome"), campo(p, "apelido")); });
}

/** Abre a janela, ou traz para a frente a que já está aberta. */
export function showUsuariosMac(): void {
  if (win !== null && !win.isDestroyed()) { win.show(); win.focus(); return; }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const largura = Math.min(MIN_WINDOW_WIDTH, area.width); const altura = Math.min(720, area.height);
  const w = new BrowserWindow({
    x: area.x + Math.round((area.width - largura) / 2), y: area.y + Math.round((area.height - altura) / 2), width: largura, height: altura,
    minWidth: 460, minHeight: 420, resizable: true, title: caps().nome, titleBarStyle: "hiddenInset", backgroundColor: backgroundColor(),
    webPreferences: { preload: path.join(__dirname, "..", "..", "preload", "usuarios-mac-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  w.webContents.setZoomMode("isolated"); w.webContents.setZoomLevel(0);
  win = w;
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.on("page-title-updated", (e) => e.preventDefault());
  w.on("closed", () => { if (win === w) win = null; });
  void w.loadFile(path.join(__dirname, "..", "..", "renderer", "usuarios-mac.html"));
}
