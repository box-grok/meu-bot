import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { openStore } = createRequire(import.meta.url)("../../backend-colima/finance-store.js");

const fresh = () => join(mkdtempSync(join(tmpdir(), "fin-store-")), "db");
let clock = Date.parse("2026-10-22T12:00:00Z");

test("nasce com as categorias padrão; lançamentos particionados por mês; mudar a data move de arquivo", async () => {
  const dir = fresh(); const s = openStore(dir, { now: () => clock });
  assert.ok(s.list("categorias").some((c) => c.key === "mercado" && c.nome === "Mercado"));
  await s.mutate("app", (tx) => { tx.setLanc({ id: "l_a", data: "2026-10-21", valorCent: -100, categoria: "mercado", status: "confirmado" }); tx.mudar("x"); });
  assert.deepEqual(readdirSync(join(dir, "lancamentos")), ["2026-10.json"]);
  await s.mutate("app", (tx) => { tx.setLanc({ ...tx.getLanc("l_a"), data: "2026-09-30" }); tx.mudar("x"); });
  assert.deepEqual(readdirSync(join(dir, "lancamentos")), ["2026-09.json"]);
  assert.equal((statSync(join(dir, "meta.json")).mode & 0o777), 0o600);
  assert.ok(existsSync(join(dir, "categorias.json")), "categorias vão para o disco na primeira escrita");
  const s2 = openStore(dir); assert.equal(s2.getLanc("l_a").data, "2026-09-30"); assert.equal(s2.meta().seq, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("erro dentro da transação não deixa nada pela metade; descartar vai para a lixeira", async () => {
  const dir = fresh(); const s = openStore(dir, { now: () => clock });
  await s.mutate("app", (tx) => { tx.setLanc({ id: "l_b", data: "2026-10-01", valorCent: -1 }); tx.mudar("x"); });
  await assert.rejects(s.mutate("app", (tx) => { tx.setLanc({ id: "l_c", data: "2026-10-02", valorCent: -2 }); throw new Error("falhou"); }));
  assert.equal(s.getLanc("l_c"), null);
  await s.mutate("app", (tx) => { tx.trashLanc(tx.getLanc("l_b")); tx.mudar("x"); });
  assert.equal(s.getLanc("l_b"), null); assert.ok(existsSync(join(dir, "lixeira", "lancamentos", "l_b.json")));
  assert.equal(existsSync(join(dir, "lancamentos", "2026-10.json")), false, "mês vazio some");
  assert.equal(s.ultimas(10)[0].por, "app");
  rmSync(dir, { recursive: true, force: true });
});

test("comprovante: guardado pelo sha256, sem duplicar", () => {
  const dir = fresh(); const s = openStore(dir);
  const h1 = s.guardarComprovante(Buffer.from("foto")); const h2 = s.guardarComprovante(Buffer.from("foto"));
  assert.equal(h1, h2); assert.equal(s.lerComprovante(h1).toString(), "foto"); assert.equal(s.lerComprovante("../x"), null);
  rmSync(dir, { recursive: true, force: true });
});
