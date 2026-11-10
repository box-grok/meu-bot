// Janelas de suporte no console: o corpo que o admin-gestao manda (POST /admin/suporte) é validado antes do banco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validaResumoSuporte } from "../dist/suporte-core.js";

const ok = {
  id: "7aa55e82844b", nome: "este Mac", maquina: "este-mac",
  acesso: { usuario: "root", endereco: "187.41.115.200", porta: 22 },
  resumo: {
    saude: [{ texto: "entra por SSH (root)", ok: true }, { texto: "Claude Code deslogado", ok: false }],
    licenca: [{ texto: "Plano: Pro", ok: true }],
    uso: [{ texto: "Staging (meu-bot-staging): versão 0.80.0 · conta mac1@gmail.com", ok: null }],
    aberturas: ["10/11 11:09 · meu-bot-staging (staging) 0.80.0 · mac1@gmail.com"],
  },
};

test("validaResumoSuporte: aceita o resumo do admin-gestao, com o acesso (root ou usuário)", () => {
  const r = validaResumoSuporte(ok);
  assert.ok(!("erro" in r));
  assert.equal(r.acesso.usuario, "root");
  assert.equal(r.resumo.uso[0].texto.includes("mac1@gmail.com"), true);
});

test("validaResumoSuporte: recusa id, linhas e acesso fora do formato; corta o excesso", () => {
  assert.ok("erro" in validaResumoSuporte({ ...ok, id: "../etc" }));
  assert.ok("erro" in validaResumoSuporte({ ...ok, resumo: { ...ok.resumo, saude: [{ texto: "x", ok: "sim" }] } }));
  assert.ok("erro" in validaResumoSuporte({ ...ok, acesso: { usuario: "root", endereco: "h", porta: 99999 } }));
  assert.ok("erro" in validaResumoSuporte(null));
  const muitas = validaResumoSuporte({ ...ok, resumo: { ...ok.resumo, aberturas: Array.from({ length: 100 }, (_, i) => `linha ${i}`) } });
  assert.equal(muitas.resumo.aberturas.length, 40);
  const semAcesso = validaResumoSuporte({ ...ok, acesso: undefined });
  assert.equal(semAcesso.acesso, null);
});
