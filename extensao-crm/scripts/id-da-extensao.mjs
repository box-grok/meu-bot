// Id da extensão a partir do `key` do manifesto (sha256 do DER público → 32 chars a–p), como o Chromium faz.
// Uso: node scripts/id-da-extensao.mjs [caminho/manifest.json]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export function idDaChave(keyBase64) {
  const hex = createHash("sha256").update(Buffer.from(keyBase64, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(c, 16))).join("");
}
if (process.argv[1] && /id-da-extensao\.mjs$/.test(process.argv[1])) {
  const m = JSON.parse(readFileSync(process.argv[2] ?? new URL("../static/manifest.json", import.meta.url), "utf8"));
  console.log(idDaChave(m.key));
}
