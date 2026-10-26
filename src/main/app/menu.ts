/**
 * Menu do aplicativo. Definir um menu próprio descarta o padrão do Electron, então os roles de
 * edição entram aqui, senão Cmd+C/V/A param de funcionar nos campos de texto.
 */
import { app, Menu } from "electron";
import type { ZoomAction } from "../../shared/ipc";

export function installAppMenu(deps: { openPicker: () => void; toggleSettings: () => void; zoom: (action: ZoomAction) => void }): void {
  // Cmd+, pelo menu: o Electron trata o acelerador nativamente, independente do foco e do teclado.
  const settingsItem: Electron.MenuItemConstructorOptions = { label: "Configurações…", accelerator: "CommandOrControl+,", click: () => deps.toggleSettings() };
  // Zoom da janela. No macOS o item fica SEM acelerador de propósito: com ele, o menu capturaria Cmd+= / Cmd+-
  // antes do renderer, e é o renderer que decide, pelo foco, se o atalho é da página do Navegador (zoom do site)
  // ou da janela. `registerAccelerator: false` (só mostrar o atalho) só existe no Linux/Windows.
  const zoomItem = (label: string, accelerator: string, action: ZoomAction): Electron.MenuItemConstructorOptions =>
    process.platform === "darwin" ? { label, click: () => deps.zoom(action) } : { label, accelerator, registerAccelerator: false, click: () => deps.zoom(action) };
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{ label: app.name, submenu: [{ role: "about" as const }, { type: "separator" as const }, settingsItem, { type: "separator" as const }, { role: "services" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }] }]
      : []),
    {
      label: "Arquivo",
      submenu: [
        { label: "Nova janela em outra máquina…", accelerator: "CommandOrControl+Shift+N", click: () => deps.openPicker() },
        ...(process.platform === "darwin" ? [] : [settingsItem]),
        { type: "separator" },
        { role: "close", label: "Fechar janela", accelerator: "CommandOrControl+Shift+W" },
      ],
    },
    { role: "editMenu", label: "Editar" },
    {
      label: "Visualizar",
      submenu: [
        zoomItem("Aumentar zoom", "CommandOrControl+=", { action: "step", delta: 1 }),
        zoomItem("Diminuir zoom", "CommandOrControl+-", { action: "step", delta: -1 }),
        zoomItem("Tamanho real (100%)", "CommandOrControl+0", { action: "reset" }),
        ...(app.isPackaged ? [] : [{ type: "separator" as const }, { role: "toggleDevTools" as const }]),
      ],
    },
    { role: "windowMenu", label: "Janela" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
