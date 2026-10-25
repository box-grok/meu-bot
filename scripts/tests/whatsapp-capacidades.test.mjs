import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { capacidadesDe } = createRequire(import.meta.url)("../../dist/main/whatsapp-capacidades.js");

const CHAVES = ["parear", "listarConversas", "lerConversa", "limparHistorico", "pausar", "grupos", "guarda", "politicaDm", "audio", "politicaReinicia"];

test("sem gateway ou sem bridge/plugin, a máquina não oferece nada", () => {
  for (const c of [capacidadesDe(null, true, true), capacidadesDe("openclaw", false, false), capacidadesDe("hermes", false, false)]) {
    assert.deepEqual(Object.values(c).filter(Boolean), [], "nenhuma capacidade deveria estar ligada");
  }
});

test("toda capacidade é booleana e o conjunto de chaves não muda entre frameworks", () => {
  for (const g of ["openclaw", "hermes", "picoclaw"]) {
    const c = capacidadesDe(g, true, true);
    assert.deepEqual(Object.keys(c).sort(), [...CHAVES].sort(), `chaves de ${g}`);
    for (const k of CHAVES) assert.equal(typeof c[k], "boolean", `${g}.${k}`);
  }
});

test("OpenClaw: o que depende de conversa só liga com o número conectado", () => {
  const sem = capacidadesDe("openclaw", true, false);
  const com = capacidadesDe("openclaw", true, true);
  // Parear e a guarda não dependem de já haver número vinculado; o resto sim.
  assert.ok(sem.parear && sem.guarda && sem.politicaDm);
  assert.ok(!sem.listarConversas && !sem.limparHistorico && !sem.pausar && !sem.grupos);
  assert.ok(com.listarConversas && com.lerConversa && com.limparHistorico && com.pausar && com.grupos);
});

test("Hermes: lista, lê e limpa pelo state.db, liga/desliga grupos (config.yaml) e escolhe quem responde (.env, com reinício); não pausa nem guarda", () => {
  const c = capacidadesDe("hermes", true, true);
  assert.ok(c.parear && c.listarConversas && c.lerConversa && c.limparHistorico && c.pausar && c.grupos && c.politicaDm && c.politicaReinicia);
  assert.ok(!capacidadesDe("hermes", true, false).grupos, "grupos dependem do número conectado");
  assert.ok(capacidadesDe("hermes", true, false).politicaDm, "a política não depende de número conectado");
  assert.ok(!capacidadesDe("openclaw", true, true).politicaReinicia, "no OpenClaw a política vale sem reiniciar");
  // Nada disso existe no Hermes: oferecer na tela daria erro na primeira tentativa.
  assert.ok(!c.guarda && !c.audio);
  // Sem número conectado não há conversa para listar.
  assert.ok(!capacidadesDe("hermes", true, false).listarConversas);
});

test("PicoClaw: pareia e tem política de quem responde; o resto segue fora até ser mapeado", () => {
  const c = capacidadesDe("picoclaw", true, true);
  assert.ok(c.parear && c.politicaDm);
  assert.ok(!c.listarConversas && !c.grupos && !c.guarda);
});

test("gateway desconhecido não ganha capacidade por engano", () => {
  assert.deepEqual(Object.values(capacidadesDe("framework-novo", true, true)).filter(Boolean), []);
});
