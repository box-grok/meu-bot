// Gera o .icns de cada produto a partir do .svg (scripts/icon.mjs). Uso: `npm run icons` (depois de build:main).
import { execFileSync } from "node:child_process";
import { PRODUTOS, svgOf } from "./produtos.mjs";
for (const p of PRODUTOS) {
  console.log(`▸ ${p.nome}: ${svgOf(p)} → ${p.icone}`);
  execFileSync("node", ["scripts/icon.mjs", svgOf(p), p.icone], { stdio: "inherit" });
}
