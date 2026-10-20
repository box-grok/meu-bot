/** Avisos na barra do Gmail (ButterBar): conexão com o app/máquina e erros de ação. */
import type { InboxSDK } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import { ErroCrm } from "../api.ts";
import { T } from "../textos.ts";

const CHAVE = "mbcrm-conexao";
export function monitorarConexao(sdk: InboxSDK, estado: Estado): void {
  let ultimo = estado.conexao;
  estado.assinar(({ conexao }) => {
    if (conexao === ultimo) return;
    const antes = ultimo; ultimo = conexao;
    if (conexao === "ok") { sdk.ButterBar.hideMessage(CHAVE); if (antes !== "desconhecida") sdk.ButterBar.showMessage({ text: T.conectado, time: 2500 }); return; }
    const texto = conexao === "host-fora" ? T.hostFora : conexao === "nao-autorizado" ? T.tokenInvalido : conexao === "assinatura" ? T.assinatura : T.abraOApp;
    sdk.ButterBar.showError({ text: texto, messageKey: CHAVE, persistent: true, hideOnViewChanged: false });
  });
}
export const textoDoErro = (e: unknown): string => (e instanceof ErroCrm ? (e.tipo === "proxy-fora" ? T.abraOApp : e.tipo === "host-fora" ? T.hostFora : e.message) : e instanceof Error ? e.message : String(e));
export function mostrarErro(sdk: InboxSDK, e: unknown): void { sdk.ButterBar.showError({ text: T.erro(textoDoErro(e)), time: 6000 }); }
