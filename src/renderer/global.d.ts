import type { MeuBotApi } from "../shared/ipc";

declare global {
  interface Window {
    meuBot: MeuBotApi;
  }
}

export {};
