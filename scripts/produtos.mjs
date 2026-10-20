// Tabela de produtos para os scripts de empacotamento (package, fuses, dmg, release, icons). A fonte é
// src/main/variant-core.ts (PRODUTOS); aqui só se lê o compilado em dist/ — por isso rode `npm run build:main`
// antes. `--variant <id>` escolhe o produto; `--admin` continua valendo como alias de `--variant admin`.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const DIST = new URL("../dist/main/variant-core.js", import.meta.url);
if (!existsSync(DIST)) { console.error("✗ falta dist/main/variant-core.js: rode `npm run build:main` antes"); process.exit(1); }
const { PRODUTOS } = createRequire(import.meta.url)("../dist/main/variant-core.js");
export { PRODUTOS };

/** Produto pedido na linha de comando; desconhecido sai com 64 listando os ids. */
export function produtoFromArgv(argv = process.argv) {
  const i = argv.indexOf("--variant");
  const id = i >= 0 ? argv[i + 1] : argv.includes("--admin") ? "admin" : "client";
  const p = PRODUTOS.find((x) => x.variant === id);
  if (p === undefined) { console.error(`✗ produto desconhecido "${id}". Opções: ${PRODUTOS.map((x) => x.variant).join(", ")}`); process.exit(64); }
  return p;
}
export const archOf = () => (process.arch === "arm64" ? "arm64" : "x64");
/** `--versao <x>` (o release staging passa "0.2.0-staging.3"); sem ela, a do package.json. */
export function versaoFromArgv(argv = process.argv) {
  const i = argv.indexOf("--versao");
  if (i < 0) return null;
  const v = argv[i + 1] ?? "";
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) { console.error(`✗ versão inválida "${v}" (ex.: 0.2.0 ou 0.2.0-staging.3)`); process.exit(64); }
  return v;
}
/** Ícone .svg de origem do produto (mesmo nome do .icns). */
export const svgOf = (p) => p.icone.replace(/\.icns$/, ".svg");
