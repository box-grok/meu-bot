// Instalador .dmg no estilo do Rambox: janela com arte de fundo, o app à esquerda, seta "arraste" e o
// atalho de Aplicativos à direita. Rode depois de `npm run dist` (ou `npm run dmg`).
//
// O layout é gravado direto no .DS_Store da imagem pelo `dmgbuild` (MIT, o mesmo motor do electron-builder),
// sem controlar o Finder por AppleScript: no macOS novo o Finder deslocava o fundo dos ícones e pedia
// permissão de automação. O dmgbuild fica num ambiente Python próprio em build/.venv-dmg (criado sozinho na
// primeira vez, versão fixa). O resto é ferramenta do macOS: qlmanage, sips, tiffutil, codesign.
//
// Para mandar a outra pessoa: o config/ssh-hosts.conf do app (as suas máquinas e IPs) é trocado por um
// modelo vazio e o app é reassinado ad-hoc. `--com-minhas-maquinas` mantém o arquivo como está.
import { identidade } from "./assinatura.mjs";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { archOf, produtoFromArgv } from "./produtos.mjs";

const DMGBUILD = "dmgbuild==1.6.7";
const root = resolve(import.meta.dirname, "..");
// --admin: o meu-bot-admin (só para o admin; leva as máquinas dele). --suporte: o .dmg das pessoas leva o
// pacote de suporte de build/suporte (scripts/suporte-setup.mjs): pública do admin, chave só de entrega e
// endereço/chave do servidor da caixa de entrada.
const produto = produtoFromArgv();
const admin = produto.variant === "admin";
const support = process.argv.includes("--suporte");
const name = produto.nome;
const keepHosts = admin || process.argv.includes("--com-minhas-maquinas");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const arch = archOf();
const appSrc = join(root, "out", `${name}-darwin-${arch}`, `${name}.app`);
const out = join(root, "out", `${name}-${version}-${arch}${support ? "-suporte" : ""}.dmg`);
if (admin && support) { console.error("✗ --suporte é para o .dmg das pessoas, não para o admin"); process.exit(64); }
const supportDir = join(root, "build", "suporte");
if (support && !existsSync(join(supportDir, "suporte.json"))) { console.error("✗ falta build/suporte. Rode antes: node scripts/suporte-setup.mjs"); process.exit(1); }
const venv = join(root, "build", ".venv-dmg");

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const step = (t) => console.log(`▸ ${t}`);
const py = (s) => JSON.stringify(s); // string JSON também é literal válido em Python

if (!existsSync(appSrc)) { console.error(`✗ não achei ${appSrc}. Rode antes: npm run dist`); process.exit(1); }

const work = mkdtempSync(join(tmpdir(), "meu-bot-dmg-"));
try {
  if (!existsSync(join(venv, "bin", "dmgbuild"))) {
    step(`preparando o ${DMGBUILD} em build/.venv-dmg (só na primeira vez)`);
    mkdirSync(join(root, "build"), { recursive: true });
    run("python3", ["-m", "venv", venv]);
    run(join(venv, "bin", "pip"), ["install", "-q", DMGBUILD]);
  }

  // 1. Arte de fundo: SVG → PNG 2x e 1x → TIFF com as duas. O qlmanage só gera quadrado e o `sips -c` só
  //    recorta pelo centro (ignora --cropOffset): a arte 660×400 vai centralizada num quadro 660×660
  //    (viewBox com 130 de folga em cima e embaixo), e o recorte central de 800 px pega exatamente o desenho.
  //    Recortar o topo de uma renderização alinhada em cima subia a arte 130 pt em relação aos ícones.
  step("arte de fundo");
  const bgDir = join(work, "bg");
  mkdirSync(bgDir);
  const square = join(bgDir, "fundo.svg");
  const svg = readFileSync(join(root, "assets", "dmg-fundo.svg"), "utf8")
    .replace('width="660" height="400" viewBox="0 0 660 400"', 'width="660" height="660" viewBox="0 -130 660 660"');
  if (!svg.includes('viewBox="0 -130 660 660"')) throw new Error("assets/dmg-fundo.svg precisa começar com width=660 height=400 viewBox=0 0 660 400");
  writeFileSync(square, svg);
  run("qlmanage", ["-t", "-s", "1320", "-o", bgDir, square]);
  const at2x = join(bgDir, "fundo@2x.png");
  const at1x = join(bgDir, "fundo.png");
  const tiff = join(bgDir, "fundo.tiff");
  run("sips", ["-c", "800", "1320", join(bgDir, "fundo.svg.png"), "--out", at2x]);
  run("sips", ["-z", "400", "660", at2x, "--out", at1x]);
  run("tiffutil", ["-cathidpicheck", at1x, at2x, "-out", tiff]);

  // 2. Cópia do app; para terceiros, sem as suas máquinas e reassinado.
  step("copiando o app");
  const app = join(work, `${name}.app`);
  run("ditto", [appSrc, app]);
  const cfgDir = join(app, "Contents", "Resources", "config");
  if (support) {
    step("incluindo o pacote de suporte (pública do admin + chave só de entrega)");
    copyFileSync(join(supportDir, "suporte.json"), join(cfgDir, "suporte.json"));
    copyFileSync(join(supportDir, "known_hosts"), join(cfgDir, "suporte-known_hosts"));
    copyFileSync(join(supportDir, "entrega"), join(cfgDir, "suporte-entrega"));
    chmodSync(join(cfgDir, "suporte-entrega"), 0o600);
  }
  if (!keepHosts) {
    step("trocando suas máquinas por um modelo vazio e reassinando");
    writeFileSync(join(cfgDir, "ssh-hosts.conf"), [
      "# Máquinas do meu-bot, no formato do ~/.ssh/config. O botão ⇅ \"sincronizar ssh\" do seletor copia para",
      "# o ~/.ssh/config os blocos daqui que ainda não existem lá. Acrescente as suas máquinas, por exemplo:",
      "#",
      "# Host minha-vm",
      "#     HostName 203.0.113.10",
      "#     User eu",
      "#     IdentityFile ~/.ssh/id_ed25519",
      "",
      "# VM do Colima (Lima) do próprio Mac; se não houver Colima, o ssh ignora o arquivo ausente.",
      "Include ~/.colima/ssh_config",
      "",
    ].join("\n"));
  }
  if (!keepHosts || support) run("codesign", ["--force", "--deep", "--sign", identidade(), app]);

  // 3. dmgbuild: janela 660×400 sem barras, ícones de 128, app à esquerda e Aplicativos à direita.
  step("criando o .dmg");
  const settings = join(work, "settings.py");
  writeFileSync(settings, `
files = [${py(app)}]
symlinks = {"Aplicativos": "/Applications"}
icon = ${py(join(root, produto.icone))}
background = ${py(tiff)}
format = "UDZO"
compression_level = 9
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
window_rect = ((200, 120), (660, 400))
icon_size = 128
text_size = 13
icon_locations = {${py(`${name}.app`)}: (165, 175), "Aplicativos": (495, 175)}
`);
  rmSync(out, { force: true });
  run(join(venv, "bin", "dmgbuild"), ["-s", settings, name, out]);
  console.log(`✓ ${out}`);
  console.log(keepHosts ? "  (com as suas máquinas no ssh-hosts.conf)" : "  (sem as suas máquinas: pronto para mandar a outra pessoa)");
  console.log(`  Só roda em Mac ${arch === "arm64" ? "com Apple Silicon (M1 ou mais novo)" : "Intel"}.`);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  if (err && typeof err === "object" && "stderr" in err && err.stderr) console.error(String(err.stderr).trim());
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
