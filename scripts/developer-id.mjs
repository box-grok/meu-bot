// Developer ID da Apple para o meu-bot: a chave, o CSR, o certificado no chaveiro e as credenciais do notarytool.
// Sem Xcode: só as Command Line Tools (openssl do Homebrew ou o LibreSSL do macOS, security, xcrun notarytool).
//
//   node scripts/developer-id.mjs --csr [--email <apple id>]   (o e-mail é opcional: a Apple ignora o assunto do CSR)
//       gera a chave RSA 2048 em ~/.meu-bot-devid/developer-id.key (modo 600) e o pedido de certificado em
//       ~/Desktop/meu-bot-developer-id.certSigningRequest. A pessoa envia esse arquivo em
//       developer.apple.com/account/resources/certificates/add ("Developer ID Application") e baixa o .cer.
//   node scripts/developer-id.mjs --instalar <developerID_application.cer>
//       baixa o intermediário "Developer ID - G2" da Apple, monta o .p12 com a chave guardada e importa os dois no
//       chaveiro de login com acesso para o codesign (como o assinatura.mjs). Confere com find-identity.
//   node scripts/developer-id.mjs --credenciais
//       guarda no chaveiro o perfil "meu-bot" do notarytool (Apple ID, Team ID e a senha específica de app).
//       Lê APPLE_ID, TEAM_ID e APP_PASSWORD do ambiente; o que faltar o notarytool pergunta no terminal.
//       A senha nunca passa por este script nem fica no repositório.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { identidadeDeveloperId, teamId } from "./assinatura.mjs";

const DIR = join(homedir(), ".meu-bot-devid");
const CHAVE = join(DIR, "developer-id.key");
const CSR = join(homedir(), "Desktop", "meu-bot-developer-id.certSigningRequest");
const CHAVEIRO = join(homedir(), "Library/Keychains/login.keychain-db");
const G2_URL = "https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer";
const PERFIL = "meu-bot";

const arg = (nome) => { const i = process.argv.indexOf(nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts });
async function perguntar(texto) { const rl = createInterface({ input: stdin, output: stdout }); try { return (await rl.question(texto)).trim(); } finally { rl.close(); } }

/** Chave privada nova (ou a já guardada) e o pedido de certificado para a Apple. */
async function csr() {
  // O e-mail no CSR é só informativo: a Apple emite o certificado com o assunto dela (nome do time e Team ID).
  const email = arg("--email") ?? process.env.APPLE_ID ?? "";
  if (email !== "" && !/^[^@\s]+@[^@\s]+$/.test(email)) { console.error("✗ e-mail inválido"); process.exit(64); }
  mkdirSync(DIR, { recursive: true, mode: 0o700 }); chmodSync(DIR, 0o700);
  if (existsSync(CHAVE)) console.log(`✓ chave já existe em ${CHAVE}; reaproveitando (o CSR novo usa a mesma chave)`);
  else { sh("openssl", ["genrsa", "-out", CHAVE, "2048"], { stdio: ["ignore", "ignore", "inherit"] }); chmodSync(CHAVE, 0o600); console.log(`✓ chave RSA 2048 em ${CHAVE} (modo 600)`); }
  sh("openssl", ["req", "-new", "-key", CHAVE, "-subj", `${email === "" ? "" : `/emailAddress=${email}`}/CN=Developer ID Application/C=BR`, "-out", CSR]);
  console.log(`✓ pedido de certificado em ${CSR}`);
  console.log("\nPróximo passo (seu): developer.apple.com/account/resources/certificates/add → \"Developer ID Application\" →");
  console.log("envie esse arquivo, baixe o developerID_application.cer e rode: node scripts/developer-id.mjs --instalar <caminho do .cer>");
}

/** O .cer da Apple + o intermediário G2 + a chave guardada → chaveiro de login, com acesso para o codesign. */
function instalar() {
  const cer = arg("--instalar");
  if (!cer || !existsSync(cer)) { console.error("✗ passe o caminho do .cer baixado da Apple: --instalar <arquivo.cer>"); process.exit(64); }
  if (!existsSync(CHAVE)) { console.error(`✗ não há chave em ${CHAVE}: rode --csr primeiro (o .cer só serve com a chave que gerou o CSR)`); process.exit(1); }
  const d = mkdtempSync(join(tmpdir(), "meu-bot-devid-"));
  try {
    // DER (como a Apple entrega) ou PEM: normaliza para PEM.
    const pem = (entrada, saida) => { try { sh("openssl", ["x509", "-inform", "DER", "-in", entrada, "-out", saida], { stdio: "ignore" }); } catch { sh("openssl", ["x509", "-in", entrada, "-out", saida]); } };
    pem(cer, join(d, "dev.pem"));
    const g2 = join(d, "g2.cer");
    sh("curl", ["-fsSL", "-o", g2, G2_URL]);
    pem(g2, join(d, "g2.pem"));
    // A chave guardada tem que ser a do CSR que gerou esse certificado.
    const modChave = sh("openssl", ["rsa", "-noout", "-modulus", "-in", CHAVE]).trim();
    const modCert = sh("openssl", ["x509", "-noout", "-modulus", "-in", join(d, "dev.pem")]).trim();
    if (modChave !== modCert) { console.error("✗ esse .cer não foi emitido para a chave guardada em ~/.meu-bot-devid (CSR de outra chave?)"); process.exit(1); }
    const nome = sh("openssl", ["x509", "-noout", "-subject", "-nameopt", "RFC2253", "-in", join(d, "dev.pem")]).replace(/^subject=/, "").trim();
    const senha = randomBytes(12).toString("hex");
    const p12 = join(d, "id.p12");
    // OpenSSL 3 precisa de -legacy para o `security import` aceitar o .p12; o LibreSSL do macOS não tem a flag (e nem precisa).
    const pkcs12 = (extra) => sh("openssl", ["pkcs12", "-export", ...extra, "-inkey", CHAVE, "-in", join(d, "dev.pem"), "-certfile", join(d, "g2.pem"), "-passout", `pass:${senha}`, "-out", p12], { stdio: "ignore" });
    try { pkcs12(["-legacy"]); } catch { pkcs12([]); }
    sh("security", ["import", join(d, "g2.pem"), "-k", CHAVEIRO], { stdio: "inherit" });
    sh("security", ["import", p12, "-k", CHAVEIRO, "-P", senha, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"], { stdio: "inherit" });
    console.log(`✓ importado: ${nome}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
  const id = identidadeDeveloperId();
  if (id === null) { console.error("✗ o chaveiro não mostra uma identidade \"Developer ID Application\" válida (security find-identity -v -p codesigning)"); process.exit(1); }
  console.log(`✓ identidade válida no chaveiro: "${id}" · Team ID ${teamId()}`);
  console.log("\nPróximo passo: node scripts/developer-id.mjs --credenciais (Apple ID, Team ID e a senha específica de app)");
}

/** Perfil do notarytool no chaveiro. A senha específica de app vem do ambiente ou é digitada no prompt do próprio notarytool. */
async function credenciais() {
  const appleId = process.env.APPLE_ID ?? (await perguntar("Apple ID (e-mail): "));
  const time = process.env.TEAM_ID ?? teamId() ?? (await perguntar("Team ID (10 caracteres, como no certificado): "));
  if (!/^[A-Z0-9]{10}$/.test(time)) { console.error(`✗ Team ID inválido: ${time}`); process.exit(64); }
  const args = ["notarytool", "store-credentials", PERFIL, "--apple-id", appleId, "--team-id", time];
  if (process.env.APP_PASSWORD) args.push("--password", process.env.APP_PASSWORD);
  else console.log("O notarytool vai pedir a senha específica de app (appleid.apple.com → Senhas específicas de app). Ela fica só no chaveiro.");
  const r = spawnSync("xcrun", args, { stdio: "inherit" });
  if (r.status !== 0) { console.error("✗ notarytool store-credentials falhou"); process.exit(r.status ?? 1); }
  console.log(`✓ perfil "${PERFIL}" guardado no chaveiro (xcrun notarytool submit --keychain-profile ${PERFIL})`);
}

if (process.argv.includes("--csr")) await csr();
else if (process.argv.includes("--instalar")) instalar();
else if (process.argv.includes("--credenciais")) await credenciais();
else { console.error("uso: node scripts/developer-id.mjs --csr [--email <apple id>] | --instalar <arquivo.cer> | --credenciais"); process.exit(64); }
