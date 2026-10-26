import { test } from "node:test";
import assert from "node:assert/strict";
import { textoEspera } from "../../dist/renderer/lib/carregando.js";

test("espera: só o rótulo no começo; o tempo a partir de 3 s; o aviso de demora a partir de 10 s", () => {
  assert.deepEqual(textoEspera("Lendo os grupos…", 0), { linha: "Lendo os grupos…", aviso: null });
  assert.deepEqual(textoEspera("Lendo os grupos…", 2.9), { linha: "Lendo os grupos…", aviso: null });
  assert.deepEqual(textoEspera("Lendo os grupos…", 3), { linha: "Lendo os grupos… 3 s", aviso: null });
  const lenta = textoEspera("Lendo os grupos…", 12.7);
  assert.equal(lenta.linha, "Lendo os grupos… 12 s");
  assert.match(lenta.aviso ?? "", /continuo buscando\. Não precisa clicar de novo\.$/);
  assert.equal(textoEspera("x", -5).linha, "x", "relógio adiantado não vira tempo negativo");
});
