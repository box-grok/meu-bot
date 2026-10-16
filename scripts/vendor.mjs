// Copia para dist/renderer/vendor/ os módulos ESM autônomos usados pelo renderer (sem bundler).
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = "dist/renderer/vendor";
mkdirSync(path.join(out, "hljs"), { recursive: true });
mkdirSync(path.join(out, "LICENSES"), { recursive: true });
const cdn = "node_modules/@highlightjs/cdn-assets";
const copies = [
  ["node_modules/marked/lib/marked.esm.js", "marked.esm.js"],
  ["node_modules/dompurify/dist/purify.es.mjs", "purify.es.mjs"],
  [`${cdn}/es/core.min.js`, "hljs-core.js"],
  [`${cdn}/styles/github.min.css`, "hljs-github.css"],
  [`${cdn}/styles/github-dark.min.css`, "hljs-github-dark.css"],
  ["node_modules/marked/LICENSE", "LICENSES/marked.txt"],
  ["node_modules/dompurify/LICENSE", "LICENSES/dompurify.txt"],
  [`${cdn}/LICENSE`, "LICENSES/highlightjs.txt"],
  // Terminal: xterm.js e addons são UMD (viram globais window.Terminal, window.FitAddon…), carregados por
  // <script src> clássico no index.html (CSP script-src 'self').
  ["node_modules/@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["node_modules/@xterm/xterm/css/xterm.css", "xterm.css"],
  ["node_modules/@xterm/addon-fit/lib/addon-fit.js", "xterm-addon-fit.js"],
  ["node_modules/@xterm/addon-webgl/lib/addon-webgl.js", "xterm-addon-webgl.js"],
  ["node_modules/@xterm/addon-web-links/lib/addon-web-links.js", "xterm-addon-web-links.js"],
  ["node_modules/@xterm/addon-search/lib/addon-search.js", "xterm-addon-search.js"],
  ["node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js", "xterm-addon-unicode11.js"],
  ["node_modules/@xterm/xterm/LICENSE", "LICENSES/xterm.txt"],
];
export const HLJS_LANGUAGES = ["bash", "shell", "javascript", "typescript", "json", "python", "markdown", "yaml", "sql", "diff"];
for (const lang of HLJS_LANGUAGES) copies.push([`${cdn}/es/languages/${lang}.min.js`, `hljs/${lang}.js`]);
for (const [from, to] of copies) copyFileSync(from, path.join(out, to));
// Permite que testes em Node importem dist/renderer/lib/*.js como ESM.
writeFileSync("dist/renderer/package.json", JSON.stringify({ type: "module" }, null, 2));
console.log(`vendor: ${copies.length} arquivos em ${out}`);
