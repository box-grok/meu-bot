import type { MeuBotApi, ProdutosJanelaApi, UsuariosMacApi } from "../shared/ipc";

declare global {
  interface Window {
    meuBot: MeuBotApi;
    /** Só na janela Produtos do meu-bot-admin (produtos-preload.ts). */
    produtos: ProdutosJanelaApi;
    /** Só na janela do meu-bot-admin-mac (usuarios-mac-preload.ts). */
    contasMac: UsuariosMacApi;
  }
}

export {};
