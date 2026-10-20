// Identidade de assinatura estável para os apps (meu-bot, meu-bot-admin, meu-bot-crm).
//
// Assinatura ad-hoc ("-") muda a cada build; o macOS amarra a chave "<app> Safe Storage" do chaveiro (que cifra
// os cookies do Navegador) à assinatura exata, então cada reinstalação pede a senha do Mac e, se negado, o Gmail
// cai deslogado. Com um certificado autoassinado fixo ("meu-bot local", só neste Mac) a regra do chaveiro passa
// a ser "assinado por este certificado" e vale para todas as versões seguintes.
//
//   node scripts/assinatura.mjs --criar   cria o certificado no chaveiro de login (uma vez; idempotente)
//   import { identidade } from "./assinatura.mjs"   → "meu-bot local" se existir, senão "-" (ad-hoc, como antes)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const NOME = "meu-bot local";
const CHAVEIRO = join(homedir(), "Library/Keychains/login.keychain-db");

/** O certificado com chave privada está no chaveiro? (`find-identity` sem -v lista também os não confiáveis.) */
export function existe() {
  try { return execFileSync("security", ["find-identity", "-p", "codesigning", CHAVEIRO], { encoding: "utf8" }).includes(`"${NOME}"`); } catch { return false; }
}
export const identidade = () => (existe() ? NOME : "-");

function criar() {
  if (existe()) { console.log(`✓ "${NOME}" já está no chaveiro.`); return; }
  const d = mkdtempSync(join(tmpdir(), "meu-bot-cert-"));
  try {
    const senha = randomBytes(12).toString("hex");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650", "-subj", `/CN=${NOME}`,
      "-addext", "basicConstraints=critical,CA:false", "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=critical,codeSigning",
      "-keyout", join(d, "k.pem"), "-out", join(d, "c.pem")], { stdio: "ignore" });
    execFileSync("openssl", ["pkcs12", "-export", "-legacy", "-inkey", join(d, "k.pem"), "-in", join(d, "c.pem"), "-name", NOME, "-out", join(d, "id.p12"), "-passout", `pass:${senha}`], { stdio: "ignore" });
    execFileSync("security", ["import", join(d, "id.p12"), "-k", CHAVEIRO, "-P", senha, "-T", "/usr/bin/codesign"], { stdio: "inherit" });
  } finally { rmSync(d, { recursive: true, force: true }); }
  console.log(existe() ? `✓ "${NOME}" criado no chaveiro de login.` : `✗ não apareceu como identidade de assinatura`);
}

if (process.argv.includes("--criar")) criar();
