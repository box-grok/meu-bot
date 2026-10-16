// Publica uma release no GitHub com os dois apps zipados: é daí que a atualização automática (src/main/updater.ts)
// baixa. Uso: `npm run release` (versão do package.json; a tag vira v<versão>). Exige `gh` logado
// (`gh auth login`) e a árvore limpa. Gera out/meu-bot-<v>-<arch>.zip e out/meu-bot-admin-<v>-<arch>.zip com
// `ditto -c -k --keepParent` (preserva symlinks e a assinatura ad-hoc). O .dmg continua sendo o instalador da
// primeira vez (`npm run dmg`); a release só precisa dos .zip.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const tag = `v${version}`;
const step = (s) => console.log(`\n▸ ${s}`);

if (execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "") { console.error("✗ árvore com mudanças: commite antes de publicar"); process.exit(64); }
try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); } catch { console.error("✗ gh não está logado: rode `gh auth login`"); process.exit(64); }
if (execSync(`git tag -l ${tag}`, { encoding: "utf8" }).trim() !== "") { console.error(`✗ a tag ${tag} já existe: suba a versão no package.json`); process.exit(64); }

const zips = [];
for (const admin of [false, true]) {
  const name = admin ? "meu-bot-admin" : "meu-bot";
  step(`empacotando ${name}`);
  execSync(`npm run build && node scripts/package.mjs${admin ? " --admin" : ""} && node scripts/fuses.mjs${admin ? " --admin" : ""} --no-install`, { stdio: "inherit" });
  const app = join("out", `${name}-darwin-${arch}`, `${name}.app`);
  if (!existsSync(app)) { console.error(`✗ não achei ${app}`); process.exit(1); }
  const zip = join("out", `${name}-${version}-${arch}.zip`);
  rmSync(zip, { force: true });
  execFileSync("ditto", ["-c", "-k", "--keepParent", app, zip]);
  zips.push(zip);
}
step(`criando a release ${tag}`);
execFileSync("git", ["tag", tag]); execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });
execFileSync("gh", ["release", "create", tag, ...zips, "--title", `meu-bot ${version}`, "--generate-notes"], { stdio: "inherit" });
console.log(`\n✓ ${tag} publicada com ${zips.join(", ")}. Os apps instalados atualizam sozinhos na próxima verificação (até 6 h) ou ao reabrir.`);
