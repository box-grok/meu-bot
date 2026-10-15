/**
 * Menu do aplicativo. Definir um menu próprio descarta o padrão do Electron, então os roles de
 * edição entram aqui, senão Cmd+C/V/A param de funcionar nos campos de texto.
 */
import { app, Menu } from "electron";

export function installAppMenu(deps: { openPicker: () => void; toggleSettings: () => void }): void {
  // Cmd+, pelo menu: o Electron trata o acelerador nativamente, independente do foco e do teclado.
  const settingsItem: Electron.MenuItemConstructorOptions = { label: "Configurações…", accelerator: "CommandOrControl+,", click: () => deps.toggleSettings() };
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
    ...(app.isPackaged ? [] : [{ label: "Visualizar", submenu: [{ role: "toggleDevTools" as const }] }]),
    { role: "windowMenu", label: "Janela" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
