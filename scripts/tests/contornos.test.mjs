import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Todo contorno de limitação do Hermes/OpenClaw tem cabeçalho "CONTORNO #N" no código e uma linha na tabela de
// docs/guia/contornos.md, com um critério de saída verificável. Assim dá para apagar o contorno quando a ferramenta
// trouxer a função, sem arqueologia.
const RAIZ = join(import.meta.dirname, "..", "..");
const arquivos = (dir, exts) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? (f === "node_modules" ? [] : arquivos(p, exts)) : exts.some((e) => f.endsWith(e)) ? [p] : []; });
const fontes = [...arquivos(join(RAIZ, "src"), [".ts"]), ...arquivos(join(RAIZ, "backend-colima", "hermes-plugins"), [".py"])];
const tabela = readFileSync(join(RAIZ, "docs", "guia", "contornos.md"), "utf8");

test("cada CONTORNO #N do código está na tabela, com 'Sai quando:' no cabeçalho; e cada linha da tabela tem cabeçalho no código", () => {
  const noCodigo = new Map();
  for (const f of fontes) {
    const txt = readFileSync(f, "utf8");
    for (const m of txt.matchAll(/CONTORNO #(\d+) \(/g)) {
      const n = Number(m[1]);
      const trecho = txt.slice(m.index, m.index + 1500);
      assert.match(trecho, /Sai quando:/, `${f}: CONTORNO #${n} sem "Sai quando:"`);
      assert.match(trecho, /docs\/guia\/contornos\.md/, `${f}: CONTORNO #${n} sem apontar a tabela`);
      noCodigo.set(n, [...(noCodigo.get(n) ?? []), f.replace(RAIZ + "/", "")]);
    }
  }
  const naTabela = new Set([...tabela.matchAll(/^\| (\d+) \| /gm)].map((m) => Number(m[1])));
  assert.ok(naTabela.size >= 4, "a tabela tem as entradas iniciais");
  for (const n of naTabela) assert.ok(noCodigo.has(n), `contorno #${n} está na tabela mas nenhum arquivo tem o cabeçalho`);
  for (const n of noCodigo.keys()) assert.ok(naTabela.has(n), `CONTORNO #${n} em ${noCodigo.get(n).join(", ")} não está na tabela`);
  for (const linha of tabela.split("\n").filter((l) => /^\| \d+ \| /.test(l))) {
    const colunas = linha.split(" | ");
    assert.equal(colunas.length, 7, `linha da tabela com ${colunas.length} colunas: ${linha.slice(0, 60)}…`);
  }
});
