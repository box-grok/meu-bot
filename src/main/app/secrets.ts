/**
 * Credencial do OAuth client do Tailscale, cifrada pelo safeStorage do Electron (chave no Keychain
 * do macOS). Arquivo userData/tailscale-oauth.bin, modo 0600, escrito com tmp + rename. Nunca vai
 * para o renderer: ele só recebe {configured, encryptionAvailable}. Nunca é logada.
 */
import { marcar } from "./depuracao";
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { TailscaleCredentialState } from "../../shared/ipc";
import { log } from "../maquina/backend";
import type { TailscaleCredential } from "../maquina/tailscale-api";

const file = (): string => path.join(app.getPath("userData"), "tailscale-oauth.bin");

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const SECRET_RE = /^tskey-client-[A-Za-z0-9_-]{10,}$/;

export const tailscaleCredentialState = (): TailscaleCredentialState => ({
  configured: fs.existsSync(file()),
  encryptionAvailable: safeStorage.isEncryptionAvailable(),
});

export function saveTailscaleCredential(clientIdRaw: string, clientSecretRaw: string): TailscaleCredentialState {
  const clientId = clientIdRaw.trim();
  const clientSecret = clientSecretRaw.trim();
  if (!safeStorage.isEncryptionAvailable()) throw new Error("este Mac não tem o Keychain disponível para guardar o secret");
  if (!CLIENT_ID_RE.test(clientId)) throw new Error("o client id não parece válido (letras, números, - e _)");
  if (!SECRET_RE.test(clientSecret)) throw new Error("não parece um client secret do Tailscale: ele começa com tskey-client-");
  const blob = safeStorage.encryptString(JSON.stringify({ v: 1, clientId, clientSecret }));
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, blob, { mode: 0o600 });
  fs.renameSync(tmp, target);
  log("[tailscale] credencial do OAuth client salva no Keychain");
  return tailscaleCredentialState();
}

/** null se não há credencial ou se o Keychain não consegue decifrar (ex.: outro usuário do Mac). */
export function loadTailscaleCredential(): TailscaleCredential | null {
  try {
    const blob = fs.readFileSync(file());
    marcar("safeStorage: credencial do Tailscale");
    const j = JSON.parse(safeStorage.decryptString(blob)) as { clientId?: unknown; clientSecret?: unknown };
    if (typeof j.clientId !== "string" || typeof j.clientSecret !== "string") return null;
    return { clientId: j.clientId, clientSecret: j.clientSecret };
  } catch {
    return null;
  }
}

export function clearTailscaleCredential(): TailscaleCredentialState {
  try { fs.rmSync(file(), { force: true }); log("[tailscale] credencial do OAuth client removida"); } catch { /* ok */ }
  return tailscaleCredentialState();
}
