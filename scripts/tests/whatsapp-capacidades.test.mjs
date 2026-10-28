import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { capacidadesDe } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-capacidades.js");

const CHAVES = ["parear", "credencial", "listarConversas", "lerConversa", "limparHistorico", "pausar", "grupos", "guarda", "politicaDm", "audio", "politicaReinicia"];

test("sem gateway ou sem bridge/plugin, a máquina não oferece nada", () => {
  for (const c of [capacidadesDe(null, true, true), capacidadesDe("openclaw", false, false), capacidadesDe("hermes", false, false)]) {
    assert.deepEqual(Object.values(c).filter(Boolean), [], "nenhuma capacidade deveria estar ligada");
  }
});

test("toda capacidade é booleana e o conjunto de chaves não muda entre frameworks", () => {
  for (const g of ["openclaw", "hermes", "picoclaw", "cloud-api"]) {
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

test("Hermes: lista, lê e limpa pelo state.db, liga/desliga grupos e áudio (config.yaml) e escolhe quem responde (.env, com reinício); sem guarda", () => {
  const c = capacidadesDe("hermes", true, true);
  assert.ok(c.parear && c.listarConversas && c.lerConversa && c.limparHistorico && c.pausar && c.grupos && c.politicaDm && c.audio && c.politicaReinicia);
  assert.ok(!capacidadesDe("hermes", true, false).grupos, "grupos dependem do número conectado");
  assert.ok(capacidadesDe("hermes", true, false).politicaDm, "a política não depende de número conectado");
  assert.ok(!capacidadesDe("openclaw", true, true).politicaReinicia, "no OpenClaw a política vale sem reiniciar");
  // A guarda é um plugin do OpenClaw: oferecer no Hermes daria erro na primeira tentativa.
  assert.ok(!c.guarda);
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

test("API oficial: conecta por credencial (sem QR); lista, lê, limpa, pausa e escolhe quem responde; sem grupos, guarda nem áudio", () => {
  const sem = capacidadesDe("cloud-api", true, false);
  const com = capacidadesDe("cloud-api", true, true);
  assert.ok(sem.credencial && !sem.parear && sem.politicaDm);
  assert.ok(!sem.listarConversas && !sem.pausar, "conversa só com o número conectado");
  assert.ok(com.listarConversas && com.lerConversa && com.limparHistorico && com.pausar);
  assert.ok(!com.grupos && !com.guarda && !com.audio && !com.politicaReinicia);
  for (const g of ["openclaw", "hermes", "picoclaw"]) assert.equal(capacidadesDe(g, true, true).credencial, false, `${g} pareia por QR`);
});
