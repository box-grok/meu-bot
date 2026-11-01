/**
 * Senha do backup cifrado (o conjunto `credenciais` da cópia no Drive). Guardada cifrada pelo safeStorage
 * (Keychain) em userData/backup-senha.bin, como os tokens do Google em conta-google.ts, e nunca sai daqui: não vai
 * para o log, para a tela, para a auditoria nem para o pacote.
 *
 * É senha do dono, não a identidade do super admin (`~/.ssh/meu-bot-backup.age`): numa plataforma onde cada cliente
 * tem a própria VM, o cliente precisa abrir o próprio pacote sem depender de uma chave do fornecedor.
 *
 * Perder a senha torna aquele pacote inabrível. Como toda credencial ali é reemissível, a perda é recuperável —
 * diferente do CRM, e por isso a tela avisa em vez de impedir.
 */
import { marcar } from "../app/depuracao";
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { gravar } from "./comum";

const ARQ = (): string => path.join(app.getPath("userData"), "backup-senha.bin");
/** Curto demais não protege nada: o pacote tem token de DNS, de CRM externo e de repositório. */
export const SENHA_MIN = 8;

export function lerSenhaBackup(): string | null {
  try {
    marcar("safeStorage: senha do backup");
    const s = safeStorage.decryptString(fs.readFileSync(ARQ()));
    return s.length >= SENHA_MIN ? s : null;
  } catch { return null; }
}

/** Só diz se existe; o valor nunca atravessa o IPC. */
export const temSenhaBackup = (): boolean => lerSenhaBackup() !== null;

export function definirSenhaBackup(senha: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("este Mac não tem o Keychain disponível para guardar a senha");
  const s = senha.trim();
  if (s.length < SENHA_MIN) throw new Error(`a senha precisa de pelo menos ${SENHA_MIN} caracteres`);
  gravar(ARQ(), safeStorage.encryptString(s));
}

/** Apagar a senha não apaga o que já está no Drive; só para de enviar o conjunto cifrado daqui em diante. */
export function limparSenhaBackup(): void {
  try { fs.rmSync(ARQ(), { force: true }); } catch { /* já não existe */ }
}
