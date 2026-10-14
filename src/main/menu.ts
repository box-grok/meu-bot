/**
 * Menu do aplicativo. Definir um menu próprio descarta o padrão do Electron, então os roles de
 * edição entram aqui, senão Cmd+C/V/A param de funcionar nos campos de texto.
 */
import { app, Menu } from "electron";

export function installAppMenu(deps: { openPicker: () => void }): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "Arquivo",
      submenu: [
        { label: "Nova janela em outra máquina…", accelerator: "CommandOrControl+Shift+N", click: () => deps.openPicker() },
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
