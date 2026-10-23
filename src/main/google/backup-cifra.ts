/**
 * Cifra e decifra o pacote de credenciais da cópia no Drive, com `age` e a senha do dono (mesma biblioteca do
 * backup completo, em admin/backup-admin.ts). Sem Electron de propósito: assim dá para testar o ciclo inteiro.
 *
 * O formato é o `age` padrão, então o pacote também abre pela linha de comando (`age -d`) com a mesma senha. Isso
 * importa: o dono não fica dependendo do app para recuperar o próprio backup.
 */

/** Cifra com senha. O resultado é um arquivo age comum, que o `age -d` abre. */
export async function cifrarPacote(pacote: Buffer, senha: string): Promise<Buffer> {
  if (senha.trim() === "") throw new Error("sem senha não se cifra (e sem cifra não se envia credencial)");
  const { Encrypter } = await import("age-encryption");
  const e = new Encrypter();
  e.setPassphrase(senha);
  return Buffer.from(await e.encrypt(new Uint8Array(pacote)));
}

/** Decifra com a mesma senha. Senha errada lança: não devolve lixo silenciosamente. */
export async function decifrarPacote(cifrado: Buffer, senha: string): Promise<Buffer> {
  const { Decrypter } = await import("age-encryption");
  const d = new Decrypter();
  d.addPassphrase(senha);
  return Buffer.from(await d.decrypt(new Uint8Array(cifrado)));
}
