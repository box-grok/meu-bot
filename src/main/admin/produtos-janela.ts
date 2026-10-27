/**
 * Variante: admin. Janela Produtos: o registro de MVPs (meu-bot-fit, meu-bot-vendas…) e o que já sai deste código
 * (catálogo de app/variant-core.ts). Antes era uma caixa dentro do seletor; com o seletor estreito (faixa à direita
 * da tela) o formulário ficava apertado e misturava "escolher uma pessoa" com "planejar um MVP" (27 out). Abre pelo
 * "◆ Produtos" do seletor; uma janela só, no padrão do seletor: altura toda, largura da janela de uma máquina,
 * colada à esquerda dele.
 */
import { BrowserWindow, screen } from "electron";
import path from "node:path";
import type { ProdutosCatalogo } from "../../shared/ipc";
import { handleAdmin } from "../ipc/registry";
import { ADDONS, PRODUTOS } from "../app/variant-core";
import { caps } from "../app/variant";
import { backgroundColor, MIN_WINDOW_WIDTH } from "../app/windows";
import { pickerBounds } from "../maquina/picker";
import { posicaoNoCanto } from "../app/janela-core";
import { exportProduto, listProdutos, removeProduto, saveProduto } from "./produtos";

let produtosWin: BrowserWindow | null = null;
const daJanela = (event: Electron.IpcMainInvokeEvent): boolean => produtosWin !== null && !produtosWin.isDestroyed() && event.sender === produtosWin.webContents;
const soDaJanela = (event: Electron.IpcMainInvokeEvent): void => { if (!daJanela(event)) throw new Error("origem inválida"); };

/** O que já sai deste código: os apps da tabela e os add-ons. */
export const catalogoProdutos = (): ProdutosCatalogo => ({
  apps: PRODUTOS.map((p) => ({ nome: p.nome, canal: p.canal, descricao: p.descricao })),
  addons: ADDONS.map((a) => ({ nome: a.nome, rotulo: a.rotulo, descricao: a.descricao })),
});

/** Canais da janela (só ela chama). Uma vez, junto dos canais do seletor do admin. */
export function registerProdutosIpc(): void {
  handleAdmin("produtos:listar", (event) => { soDaJanela(event); return listProdutos(); });
  handleAdmin("produtos:salvar", (event, payload: unknown) => { soDaJanela(event); return saveProduto((payload as { patch?: unknown } | null)?.patch); });
  handleAdmin("produtos:remover", (event, payload: unknown) => { soDaJanela(event); return removeProduto((payload as { nome?: unknown } | null)?.nome); });
  handleAdmin("produtos:exportar", (event, payload: unknown) => { soDaJanela(event); return exportProduto((payload as { nome?: unknown } | null)?.nome); });
  handleAdmin("produtos:catalogo", (event) => { soDaJanela(event); return catalogoProdutos(); });
}

/** Abre a janela Produtos, ou traz para a frente a que já está aberta. */
export function showProdutos(): void {
  if (produtosWin !== null && !produtosWin.isDestroyed()) { produtosWin.show(); produtosWin.focus(); return; }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  // Colada à direita como o seletor; com o seletor no canto, à esquerda dele.
  const seletor = pickerBounds();
  const win = new BrowserWindow({
    ...posicaoNoCanto(area, MIN_WINDOW_WIDTH, seletor === null ? [] : [seletor]), minWidth: 460, minHeight: 420, resizable: true,
    title: `${caps().nome} · Produtos`,
    titleBarStyle: "hiddenInset",
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "produtos-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
    },
  });
  // Zoom isolado em 100%: o zoom da janela de uma pessoa (Cmd+=) não vaza para cá.
  win.webContents.setZoomMode("isolated"); win.webContents.setZoomLevel(0);
  produtosWin = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("page-title-updated", (e) => e.preventDefault());
  win.on("closed", () => { if (produtosWin === win) produtosWin = null; });
  void win.loadFile(path.join(__dirname, "..", "..", "renderer", "produtos.html"));
}
