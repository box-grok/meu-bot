/** Preload da janela do meu-bot-admin-mac (main/usuarios-mac/usuarios-mac-janela.ts): só os canais dela. */
import { contextBridge, ipcRenderer } from "electron";
import type { UsuariosMacApi } from "../shared/ipc";

const api: UsuariosMacApi = {
  listar: () => ipcRenderer.invoke("mac:usuarios", {}),
  criar: (nome: string) => ipcRenderer.invoke("mac:usuario-criar", { nome }),
  apagar: (nome: string) => ipcRenderer.invoke("mac:usuario-apagar", { nome }),
  apelido: (nome: string, apelido: string) => ipcRenderer.invoke("mac:usuario-apelido", { nome, apelido }),
};

contextBridge.exposeInMainWorld("contasMac", api);
