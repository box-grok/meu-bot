/**
 * Atalhos para o app do Grok Bot (esquema de URL `grokbot://`, registrado no Info.plist dele).
 * `/v1/settings?id=reset-computer` abre as Configurações no card "Reset computer"; o reset em si só
 * acontece quando a pessoa clica no botão vermelho lá. Nunca disparamos nada sozinhos.
 */
import { shell } from "electron";
import { log } from "./backend";

export const GROKBOT_RESET_URL = "grokbot://app/v1/settings?id=reset-computer";

/** Abre o app do Grok Bot no card de reset. false se o macOS não tem quem atenda `grokbot://`. */
export async function openGrokbotReset(): Promise<boolean> {
  try {
    await shell.openExternal(GROKBOT_RESET_URL);
    log(`[grokbot] aberto ${GROKBOT_RESET_URL}`);
    return true;
  } catch (err) {
    log(`[grokbot] falhou ao abrir ${GROKBOT_RESET_URL}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
