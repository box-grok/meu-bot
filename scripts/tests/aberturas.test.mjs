import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { usoResumo, aberturaTexto, canalDoProduto } from "../../dist/renderer/lib/admin-view.js";

const { parseAberturas } = createRequire(import.meta.url)("../../dist/main/admin/aberturas-core.js");

test("parseAberturas: mais nova primeiro, pula linha estragada ou fora do formato", () => {
  const raw = [
    JSON.stringify({ em: "2026-11-10T10:00:00Z", produto: "meu-bot", versao: "0.79.3", mac: "box-mac", user: "box" }),
    "lixo{",
    JSON.stringify({ em: "2026-11-10T11:00:00Z", produto: "meu-bot-staging", versao: "0.80.0-staging.1", mac: "box-mac", user: "box" }),
    JSON.stringify({ em: "ontem", produto: "meu-bot", versao: "1" }),
    JSON.stringify({ em: "2026-11-10T12:00:00Z", produto: "rm -rf /", versao: "1" }),
  ].join("\n");
  const ab = parseAberturas(raw);
  assert.deepEqual(ab.map((a) => a.produto), ["meu-bot-staging", "meu-bot"]);
  assert.equal(parseAberturas("").length, 0);
});

test("usoResumo: última versão de cada app, com o canal; aberturaTexto diz produção ou staging", () => {
  const ab = [
    { em: "2026-11-10T11:00:00Z", produto: "meu-bot-staging", versao: "0.80.0-staging.1", mac: "box-mac", user: "box" },
    { em: "2026-11-10T10:00:00Z", produto: "meu-bot", versao: "0.79.3", mac: "box-mac", user: "box" },
    { em: "2026-11-09T10:00:00Z", produto: "meu-bot", versao: "0.79.2", mac: "box-mac", user: "box" },
  ];
  const r = usoResumo(ab, Date.parse("2026-11-10T12:00:00Z"));
  assert.equal(r.length, 2);
  assert.match(r[0].text, /^Staging \(meu-bot-staging\): versão 0\.80\.0-staging\.1 · aberto há 1 h$/);
  assert.match(r[1].text, /^Produção \(meu-bot\): versão 0\.79\.3/);
  assert.equal(canalDoProduto("meu-bot-finance-staging"), "staging");
  assert.match(aberturaTexto(ab[2]), /meu-bot \(produção\) 0\.79\.2 · box-mac$/);
});
