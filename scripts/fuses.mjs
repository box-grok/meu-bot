import { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";

// `--admin`: o meu-bot-admin (ver scripts/package.mjs).
const name = process.argv.includes("--admin") ? "meu-bot-admin" : "meu-bot";
const bundleId = `local.${name}`;
const app = `out/${name}-darwin-${process.arch === "arm64" ? "arm64" : "x64"}/${name}.app`;
if (!existsSync(app)) {
  console.error(`App não encontrado em ${app}. Rode npm run package primeiro.`);
  process.exit(1);
}
// Pacote de suporte (build/suporte, de scripts/suporte-setup.mjs) no meu-bot instalado: só no meu-bot normal,
// com MEU_BOT_SUPORTE=1 (o ./instalar.sh liga quando build/suporte existe). Antes da assinatura.
if (name === "meu-bot" && process.env.MEU_BOT_SUPORTE === "1" && existsSync("build/suporte/suporte.json")) {
  const cfg = path.join(app, "Contents", "Resources", "config");
  copyFileSync("build/suporte/suporte.json", path.join(cfg, "suporte.json"));
  copyFileSync("build/suporte/known_hosts", path.join(cfg, "suporte-known_hosts"));
  copyFileSync("build/suporte/entrega", path.join(cfg, "suporte-entrega"));
  chmodSync(path.join(cfg, "suporte-entrega"), 0o600);
  console.log("Pacote de suporte incluído");
}
await flipFuses(app, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});
const wire = await getCurrentFuseWire(app);
const names = Object.fromEntries(Object.entries(FuseV1Options).map(([name, index]) => [String(index), name]));
console.log("Fuses gravados:");
for (const [index, value] of Object.entries(wire)) {
  if (index === "version") continue;
  console.log(`  ${(names[index] ?? index).padEnd(40)} ${value === 49 ? "enabled" : value === 48 ? "disabled" : "removed"}`);
}
execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
console.log("Assinatura ad-hoc aplicada em", app);

// Instala em ~/Applications e garante o atalho na área de trabalho.
import { rmSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
const installed = path.join(homedir(), "Applications", `${name}.app`);
mkdirSync(path.dirname(installed), { recursive: true });
rmSync(installed, { recursive: true, force: true });
// ditto preserva symlinks dos frameworks, atributos e a assinatura; cpSync quebrava os helpers.
execFileSync("ditto", [app, installed]);
console.log("Instalado em", installed);
// Cópia do app na área de trabalho: o "botão". Só substitui um bundle nosso (mesmo bundle id); nunca toca em outra coisa.
const desktopApp = path.join(homedir(), "Desktop", `${name}.app`);
const plist = path.join(desktopApp, "Contents", "Info.plist");
if (existsSync(desktopApp)) {
  const id = existsSync(plist) ? execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist]).toString().trim() : "";
  if (id !== bundleId) throw new Error(`${desktopApp} existe e não é o ${name} (bundle id "${id}"); não vou sobrescrever.`);
  rmSync(desktopApp, { recursive: true, force: true });
}
execFileSync("ditto", [app, desktopApp]);
console.log("Botão na área de trabalho:", desktopApp);
