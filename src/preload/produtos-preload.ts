/** Preload da janela Produtos do meu-bot-admin (main/admin/produtos-janela.ts): só os canais dela. */
import { contextBridge, ipcRenderer } from "electron";
import type { ProdutoMvpPatch, ProdutosJanelaApi } from "../shared/ipc";

const api: ProdutosJanelaApi = {
  listar: () => ipcRenderer.invoke("produtos:listar", {}),
  salvar: (patch: ProdutoMvpPatch) => ipcRenderer.invoke("produtos:salvar", { patch }),
  remover: (nome: string) => ipcRenderer.invoke("produtos:remover", { nome }),
  exportar: (nome: string) => ipcRenderer.invoke("produtos:exportar", { nome }),
  catalogo: () => ipcRenderer.invoke("produtos:catalogo", {}),
};

contextBridge.exposeInMainWorld("produtos", api);
