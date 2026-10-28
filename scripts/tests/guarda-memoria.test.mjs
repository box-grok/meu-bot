import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CHARS, anotar, aplicar, atalho, contexto, esquecer, listar } from "../../backend-colima/guarda/memoria.mjs";

const arq = () => join(mkdtempSync(join(tmpdir(), "meu-bot-memoria-")), "memoria-dono.md");
const DIA = new Date("2026-10-28T15:00:00Z");

test("atalho: só os gatilhos estritos, no começo da mensagem", () => {
  assert.deepEqual(atalho("lembre que o café é às 15h."), { tipo: "anotar", fato: "o café é às 15h" });
  assert.deepEqual(atalho("Lembra que a Ana prefere áudio"), { tipo: "anotar", fato: "a Ana prefere áudio" });
  assert.deepEqual(atalho("anota: reunião toda segunda"), { tipo: "anotar", fato: "reunião toda segunda" });
  assert.deepEqual(atalho("anota que o CNPJ mudou"), { tipo: "anotar", fato: "o CNPJ mudou" });
  assert.deepEqual(atalho("esquece que o café é às 15h"), { tipo: "esquecer", fato: "o café é às 15h" });
  assert.deepEqual(atalho("O que você lembra?"), { tipo: "listar", fato: "" });
  assert.deepEqual(atalho("o que vc lembra sobre a Ana?"), { tipo: "listar", fato: "a Ana" });
  // Pedidos normais ao agente seguem para ele.
  for (const t of ["apaga o arquivo velho", "remova a linha 3", "esquece isso", "anota no CRM: fechou", "crm: ligar amanhã", "você lembra da reunião?", "me lembre que amanhã tem dentista", "lembre que", ""]) {
    assert.equal(atalho(t), null, t);
  }
});

test("anotar/esquecer/listar: data, sem repetir, teto de tamanho, 0600", () => {
  const f = arq();
  assert.deepEqual(anotar(f, "o café é às 15h", DIA), { ok: true });
  assert.deepEqual(anotar(f, "O CAFÉ é às 15h", DIA), { ok: false, motivo: "repetido" });
  anotar(f, "a Ana prefere áudio", DIA);
  assert.equal(readFileSync(f, "utf8"), "- o café é às 15h (28/10/2026)\n- a Ana prefere áudio (28/10/2026)\n");
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(listar(f, "ana"), ["a Ana prefere áudio (28/10/2026)"]);
  assert.deepEqual(esquecer(f, "cafe"), ["o café é às 15h (28/10/2026)"]);
  assert.deepEqual(listar(f), ["a Ana prefere áudio (28/10/2026)"]);
  assert.deepEqual(esquecer(f, "nada disso"), []);
  assert.deepEqual(anotar(f, "x".repeat(MAX_CHARS), DIA), { ok: false, motivo: "cheia" });
  assert.match(contexto(f), /^Memória do dono[^\n]*\n- a Ana prefere áudio/);
  assert.equal(contexto(arq()), null);
});

test("aplicar: a nota do turno diz ao agente só confirmar, e a lista vem pronta", () => {
  const f = arq();
  assert.match(aplicar(f, atalho("lembre que o café é às 15h"), DIA), /anotei na memória do dono: "o café é às 15h"\. Confirme/);
  assert.match(aplicar(f, atalho("lembre que o café é às 15h"), DIA), /já estava/);
  assert.match(aplicar(f, atalho("o que você lembra?")), /- o café é às 15h \(28\/10\/2026\)\nResponda com essa lista/);
  assert.match(aplicar(f, atalho("esquece que café")), /removi da memória do dono: "o café é às 15h"/);
  assert.match(aplicar(f, atalho("o que você lembra?")), /não há nada anotado/);
});
