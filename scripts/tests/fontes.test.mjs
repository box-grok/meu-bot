import assert from "node:assert/strict";
import { test } from "node:test";
import { GUIDE_SOURCES, emptyContext } from "../../dist/renderer/lib/tutoriais.js";
import { CAMPOS_POR_FONTE, conferirFontes, limparFontes, montarGuideCtx, registrarFonte } from "../../dist/renderer/tutoriais/fontes.js";

test("fontes do guia: cada campo do GuideContext tem exatamente uma fonte dona; toda fonte está no mapa", () => {
  assert.deepEqual(Object.keys(CAMPOS_POR_FONTE).sort(), [...GUIDE_SOURCES].sort());
  const campos = Object.values(CAMPOS_POR_FONTE).flat();
  assert.equal(new Set(campos).size, campos.length, "campo com duas fontes");
  assert.deepEqual([...campos].sort(), Object.keys(emptyContext()).filter((k) => k !== "known").sort());
});

test("montarGuideCtx: junta as fatias registradas e marca known por fonte; repetir fonte é erro; sem registro fica desconhecida", () => {
  limparFontes();
  assert.deepEqual(conferirFontes(), [...GUIDE_SOURCES]);
  registrarFonte("claude", () => ({ known: true, dados: { claude: { loggedIn: true, email: "a@b", global: false, firstReply: true, contasExtras: 1, trocas: 0 } } }));
  registrarFonte("whatsapp", () => ({ known: false, dados: {} }));
  assert.throws(() => registrarFonte("claude", () => ({ known: true, dados: {} })), /duas vezes/);
  const c = montarGuideCtx();
  assert.equal(c.known.claude, true); assert.equal(c.known.whatsapp, false); assert.equal(c.known.crm, false);
  assert.equal(c.claude.email, "a@b"); assert.equal(c.claude.contasExtras, 1);
  assert.deepEqual(c.navegador, emptyContext().navegador, "fonte sem registro fica no vazio");
  assert.ok(!conferirFontes().includes("claude") && conferirFontes().includes("crm"));
  limparFontes();
});
