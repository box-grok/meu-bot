import test from "node:test";
import assert from "node:assert/strict";
import { favLabel, favOf, favTitleFor, parseFavsShown } from "../../dist/renderer/lib/favoritos.js";

test("favLabel: título curto, senão host+caminho, com reticências", () => {
  assert.equal(favLabel({ id: "a", titulo: "Pipeline Parceiros", url: "https://x" }), "Pipeline Parceiros");
  assert.equal(favLabel({ id: "a", titulo: "", url: "https://www.exemplo.com/" }), "exemplo.com");
  assert.equal(favLabel({ id: "a", titulo: "", url: "https://mail.google.com/mail/u/0/" }, 40), "mail.google.com/mail/u/0/");
  assert.equal(favLabel({ id: "a", titulo: "Um título bem maior que o limite da barra", url: "https://x" }, 12), "Um título b…");
});

test("favOf: igualdade exata, tolera # solto", () => {
  const list = [{ id: "1", titulo: "", url: "https://a.com/x" }];
  assert.equal(favOf(list, "https://a.com/x")?.id, "1");
  assert.equal(favOf(list, "https://a.com/x#")?.id, "1");
  assert.equal(favOf(list, "https://a.com/y"), null);
});

test("favTitleFor: título da página ou host", () => {
  assert.equal(favTitleFor("  Caixa de entrada  ", "https://mail.google.com/"), "Caixa de entrada");
  assert.equal(favTitleFor("", "https://www.streak.com/a/b"), "streak.com");
});

test("parseFavsShown: só '0' esconde", () => {
  assert.equal(parseFavsShown(null), true); assert.equal(parseFavsShown("1"), true); assert.equal(parseFavsShown("0"), false);
});
