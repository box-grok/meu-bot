import type { MeuBotApi, ProdutosJanelaApi } from "../shared/ipc";

declare global {
  interface Window {
    meuBot: MeuBotApi;
    /** Só na janela Produtos do meu-bot-admin (produtos-preload.ts). */
    produtos: ProdutosJanelaApi;
  }
}

export {};
