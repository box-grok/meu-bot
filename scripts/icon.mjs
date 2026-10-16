// Gera o .icns a partir do SVG (o caminho que antes era feito à mão): qlmanage → PNG 1024 → sips nos 10
// tamanhos do iconset → iconutil. Uso: node scripts/icon.mjs assets/icon.svg assets/icon.icns
// Só ferramentas do macOS; a pasta de trabalho é temporária.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const [svg, icns] = process.argv.slice(2).map((p) => resolve(p));
if (!svg || !icns) { console.error("uso: node scripts/icon.mjs <entrada.svg> <saida.icns>"); process.exit(64); }
const work = mkdtempSync(join(tmpdir(), "meu-bot-icon-"));
try {
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", work, svg], { stdio: "ignore" });
  const png = join(work, `${basename(svg)}.png`);
  const set = join(work, "icon.iconset");
  mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync("sips", ["-z", String(size), String(size), png, "--out", join(set, `icon_${size}x${size}.png`)], { stdio: "ignore" });
    execFileSync("sips", ["-z", String(size * 2), String(size * 2), png, "--out", join(set, `icon_${size}x${size}@2x.png`)], { stdio: "ignore" });
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", icns]);
  console.log(`✓ ${icns}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
