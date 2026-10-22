import { packager } from "@electron/packager";
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archOf, produtoFromArgv, versaoFromArgv } from "./produtos.mjs";

// `--variant <id>` (ou `--admin`) empacota outro produto da tabela (src/main/variant-core.ts): mesmo código, outro
// nome, bundle id e ícone. O app sabe qual é pelo Resources/variant.json e usa userData próprio
// (src/main/user-data.ts; o Electron nomearia a pasta pelo productName do package.json, igual em todos), então os
// apps convivem abertos ao mesmo tempo. Produto com extensões embutidas leva build/<extensao> em Resources/.
const produto = produtoFromArgv();
// `--versao <x>`: a versão do build (o release staging passa "0.2.0-staging.N"). Vai no Info.plist (appVersion) e no
// package.json de dentro do app (hook antes do asar), que é o que app.getVersion() lê: os dois batem.
const versao = versaoFromArgv();
const admin = produto.variant === "admin";
const name = produto.nome;
const arch = archOf();
for (const e of produto.extensoes) if (!existsSync(join("build", e, "manifest.json"))) {
  console.error(`✗ falta build/${e}/manifest.json: rode \`npm run build:extensao\` antes de empacotar o ${name}`);
  process.exit(1);
}
// Só a pasta desta variante: empacotar uma não apaga a outra (nem os .dmg em out/).
rmSync(join("out", `${name}-darwin-${arch}`), { recursive: true, force: true });
const paths = await packager({
  dir: ".",
  name,
  out: "out",
  platform: "darwin",
  arch,
  asar: true,
  overwrite: true,
  appBundleId: produto.bundleId,
  icon: produto.icone,
  appCategoryType: "public.app-category.productivity",
  ...(versao !== null ? {
    appVersion: versao,
    afterCopy: [async ({ buildPath }) => { const f = join(buildPath, "package.json"); const pkg = JSON.parse(readFileSync(f, "utf8")); pkg.version = versao; writeFileSync(f, `${JSON.stringify(pkg, null, 2)}\n`); }],
  } : {}),
  prune: true,
  // config/ (modelo de hosts ssh) e scripts/alivio/ (script enviado ao pod) vão em Resources/.
  extraResource: ["backend-colima", "config", "scripts/alivio"],
  ignore: [/^\/hermes-agent($|\/)/, /^\/backend-colima($|\/)/, /^\/backend-vm($|\/)/, /^\/docs($|\/)/, /^\/assets($|\/)/, /^\/build($|\/)/, /^\/src($|\/)/, /^\/scripts($|\/)/, /^\/config($|\/)/, /^\/tsconfig/, /^\/\.gitignore$/, /^\/out($|\/)/, /^\/extensao-crm($|\/)/, /^\/produtos($|\/)/],
});
for (const p of paths) {
  const res = join(p, `${name}.app`, "Contents", "Resources");
  writeFileSync(join(res, "variant.json"), `${JSON.stringify({ variant: produto.variant })}\n`);
  // Extensões embutidas (meu-bot-crm): Resources/<pasta da extensão>/ (manifest.json, content.js, popup.js, …).
  for (const e of produto.extensoes) cpSync(join("build", e), join(res, e), { recursive: true });
  // Client OAuth do Google (Google Contatos → CRM): config/google-oauth.json local, fora do git; sem ele o app só
  // mostra "configure o Google". Vai junto só nos produtos com extensão do Gmail.
  if (produto.extensoes.includes("extensao-crm") && existsSync(join("config", "google-oauth.json"))) copyFileSync(join("config", "google-oauth.json"), join(res, "google-oauth.json"));
  // O app de cada admin leva o suporte.json DELE (build/suporte/admins/<nome>.json: nome, superAdmin, caixa; só
  // dados públicos). MEU_BOT_ADMIN_COMO escolhe o admin; sem ele, o super admin. Setup antigo: o suporte.json geral.
  if (admin) {
    const como = process.env.MEU_BOT_ADMIN_COMO ?? "";
    let lista = [];
    try { lista = JSON.parse(readFileSync(join("build", "suporte", "admins.json"), "utf8")); } catch { /* setup antigo */ }
    const quem = como !== "" ? lista.find((a) => a.nome === como) : lista.find((a) => a.super === true);
    if (como !== "" && quem === undefined) throw new Error(`admin "${como}" não está em build/suporte/admins.json (rode scripts/suporte-setup.mjs --admin)`);
    const origem = quem !== undefined ? join("build", "suporte", "admins", `${quem.nome}.json`) : join("build", "suporte", "suporte.json");
    if (existsSync(origem)) copyFileSync(origem, join(res, "config", "suporte.json"));
    if (quem !== undefined) console.log(`meu-bot-admin de ${quem.nome}${quem.super === true ? " (super admin)" : ""}`);
  }
}
console.log("Empacotado em:", paths.join(", "), versao !== null ? `(versão ${versao})` : "");
