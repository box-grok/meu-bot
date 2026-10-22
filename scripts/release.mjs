// Publica uma release no GitHub com os produtos de um canal zipados (tabela em src/main/variant-core.ts): é daí que a
// atualização automática (src/main/updater.ts) baixa. Dois modos (regras em release-core.mjs):
//   npm run release:staging  → pre-release v<versão>-staging.N com os apps staging (meu-bot-staging, meu-bot-finance-staging);
//                              N = próximo pelas tags que já existem. Os staging instalados atualizam sozinhos.
//   npm run release          → promoção: release v<versão> com os estáveis (meu-bot, meu-bot-admin), SÓ
//                              num commit que já tem a tag v<versão>-staging.N (o staging aprovado); senão sai com 64.
// <versão> é a do package.json (a próxima estável; "meu-bot 2.0" = `npm version 2.0.0 --no-git-tag-version`). Exige
// `gh` logado (`gh auth login`) e a árvore limpa. Gera out/<app>-<v>-<arch>.zip com `ditto -c -k --keepParent`
// (preserva symlinks e a assinatura). O .dmg continua sendo o instalador da primeira vez; a release só precisa dos .zip.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { produtosDoCanal, proximaStaging, recusaPromocao } from "./release-core.mjs";

const staging = process.argv.includes("--staging");
const base = JSON.parse(readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(base)) { console.error(`✗ a versão do package.json (${base}) precisa ser x.y.z: ela é a próxima estável`); process.exit(64); }
const tags = execSync("git tag -l", { encoding: "utf8" }).split("\n");
const version = staging ? `${base}-staging.${proximaStaging(base, tags)}` : base;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const tag = `v${version}`;
const step = (s) => console.log(`\n▸ ${s}`);

if (execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "") { console.error("✗ árvore com mudanças: commite antes de publicar"); process.exit(64); }
try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); } catch { console.error("✗ gh não está logado: rode `gh auth login`"); process.exit(64); }
if (execSync(`git tag -l ${tag}`, { encoding: "utf8" }).trim() !== "") { console.error(`✗ a tag ${tag} já existe: suba a versão no package.json`); process.exit(64); }
if (!staging) {
  const recusa = recusaPromocao(base, execSync("git tag --points-at HEAD", { encoding: "utf8" }).split("\n").filter(Boolean));
  if (recusa !== null) { console.error(`✗ ${recusa}`); process.exit(64); }
}

// A tabela de produtos vem do build (dist/main/variant-core.js): compila o main antes de a ler.
step("compilando para ler a tabela de produtos");
execSync("npm run build:main", { stdio: "inherit" });
const { PRODUTOS } = await import("./produtos.mjs");
const zips = [];
for (const p of produtosDoCanal(PRODUTOS, staging ? "staging" : "estavel")) {
  const name = p.nome;
  step(`empacotando ${name}`);
  const extensao = p.extensoes.length === 0 ? "" : " && npm run build:extensao";
  execSync(`npm run build${extensao} && node scripts/package.mjs --variant ${p.variant} --versao ${version} && node scripts/fuses.mjs --variant ${p.variant} --no-install`, { stdio: "inherit" });
  const app = join("out", `${name}-darwin-${arch}`, `${name}.app`);
  if (!existsSync(app)) { console.error(`✗ não achei ${app}`); process.exit(1); }
  const zip = join("out", `${name}-${version}-${arch}.zip`);
  rmSync(zip, { force: true });
  execFileSync("ditto", ["-c", "-k", "--keepParent", app, zip]);
  zips.push(zip);
}
step(`criando a release ${tag}`);
execFileSync("git", ["tag", tag]); execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });
execFileSync("gh", ["release", "create", tag, ...zips, "--title", `meu-bot ${version}`, "--generate-notes", ...(staging ? ["--prerelease"] : [])], { stdio: "inherit" });
console.log(`\n✓ ${tag} publicada com ${zips.join(", ")}. Os apps instalados atualizam sozinhos na próxima verificação (até 6 h) ou ao reabrir.`);
