import { packager } from "@electron/packager";
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `--admin` empacota o meu-bot-admin: mesmo código, outro nome, bundle id e ícone. O app sabe qual é pelo
// Resources/variant.json e, sendo admin, usa userData próprio (src/main/admin/user-data.ts; o Electron nomearia a
// pasta pelo productName do package.json, igual nos dois), então os dois apps convivem abertos ao mesmo tempo.
const admin = process.argv.includes("--admin");
const name = admin ? "meu-bot-admin" : "meu-bot";
const arch = process.arch === "arm64" ? "arm64" : "x64";
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
  appBundleId: admin ? "local.meu-bot-admin" : "local.meu-bot",
  icon: admin ? "assets/icon-admin.icns" : "assets/icon.icns",
  appCategoryType: "public.app-category.productivity",
  prune: true,
  // config/ (modelo de hosts ssh) e scripts/alivio/ (script enviado ao pod) vão em Resources/.
  extraResource: ["backend-colima", "config", "scripts/alivio"],
  ignore: [/^\/hermes-agent($|\/)/, /^\/backend-colima($|\/)/, /^\/backend-vm($|\/)/, /^\/docs($|\/)/, /^\/assets($|\/)/, /^\/build($|\/)/, /^\/src($|\/)/, /^\/scripts($|\/)/, /^\/config($|\/)/, /^\/tsconfig/, /^\/\.gitignore$/, /^\/out($|\/)/],
});
for (const p of paths) {
  const res = join(p, `${name}.app`, "Contents", "Resources");
  writeFileSync(join(res, "variant.json"), `${JSON.stringify({ variant: admin ? "admin" : "client" })}\n`);
  // O admin lê a caixa de entrada pelo suporte.json (só dados públicos: nome, pública do admin, endereço da caixa).
  if (admin && existsSync(join("build", "suporte", "suporte.json"))) copyFileSync(join("build", "suporte", "suporte.json"), join(res, "config", "suporte.json"));
}
console.log("Empacotado em:", paths.join(", "));
