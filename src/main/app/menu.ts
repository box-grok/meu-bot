/**
 * Menu do aplicativo. Definir um menu próprio descarta o padrão do Electron, então os roles de
 * edição entram aqui, senão Cmd+C/V/A param de funcionar nos campos de texto.
 */
import { app, Menu } from "electron";
import type { ZoomAction } from "../../shared/ipc";

/** O que o menu precisa saber e poder fazer sobre a atualização do app. */
export interface MenuAtualizacao {
  /** `pronta` = versão já preparada em disco (null = nenhuma); `podeVerificar` = false durante uma verificação. */
  estado: () => { pronta: string | null; podeVerificar: boolean };
  verificar: () => void;
  aplicar: (versao: string) => void;
}
export interface MenuDeps { openPicker: () => void; toggleSettings: () => void; zoom: (action: ZoomAction) => void; atualizacao: MenuAtualizacao }

/** As dependências do menu montado, para `refreshAppMenu` refazer o menu sem o main.ts repassar tudo de novo. */
let montado: MenuDeps | null = null;
/**
 * Refaz o menu com o estado atual da atualização. O Electron não tem item de menu reativo: a única forma de
 * "Reiniciar para atualizar" aparecer quando a versão fica pronta é reconstruir o menu.
 */
export function refreshAppMenu(): void { if (montado !== null) installAppMenu(montado); }

export function installAppMenu(deps: MenuDeps): void {
  montado = deps;
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
  // Atualização no menu do aplicativo (no macOS, junto do "Sobre"; fora dele, em Arquivo), como faz o Grok Bot:
  // sem isto só se chega à atualização abrindo Configurações.
  const at = deps.atualizacao.estado();
  const itensAtualizacao: Electron.MenuItemConstructorOptions[] = [
    { label: "Verificar atualizações", enabled: at.podeVerificar, click: () => deps.atualizacao.verificar() },
    ...(at.pronta === null ? [] : [{ label: `Reiniciar para atualizar (${at.pronta})`, click: () => deps.atualizacao.aplicar(at.pronta as string) }]),
    { type: "separator" as const },
  ];
  const primeiro = template[0];
  if (process.platform === "darwin" && primeiro !== undefined && Array.isArray(primeiro.submenu)) primeiro.submenu.splice(1, 0, { type: "separator" }, ...itensAtualizacao.slice(0, -1));
  else {
    const arquivo = template.find((m) => m.label === "Arquivo");
    if (arquivo !== undefined && Array.isArray(arquivo.submenu)) arquivo.submenu.unshift(...itensAtualizacao);
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
