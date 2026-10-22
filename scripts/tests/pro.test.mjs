import { test } from "node:test";
import assert from "node:assert/strict";
import { acessoProduto, browserAccess, crmProprioOk, displayUrl, planoLiberaPro, proBlockText, tabLabel } from "../../dist/renderer/lib/pro.js";

const lic = (over) => ({ license: { plan: "free", status: "free", interval: null, memberSince: "2026-10-18T00:00:00Z", trialEnd: null, expiresAt: null, deviceLimit: 1, produtos: [], updatedAt: "2026-10-18T00:00:00Z", updatedBy: "admin", ...over }, devices: [] });

test("browserAccess: pro ativo abre; free e vencido bloqueiam; este Mac e backend antigo são unknown", () => {
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "agente-box"), "ok");
  assert.equal(browserAccess(lic({ plan: "pro", status: "trialing", trialEnd: "2027-01-01T00:00:00Z" }), "agente-box"), "ok");
  assert.equal(browserAccess(lic({}), "agente-colima"), "free");
  assert.equal(browserAccess(lic({ plan: "pro", status: "expired" }), "agente-box"), "expired");
  assert.equal(browserAccess(lic({ plan: "pro", status: "active", expiresAt: "2020-01-01T00:00:00Z" }), "agente-box"), "expired", "expiresAt no passado vence mesmo com status active");
  assert.equal(browserAccess(null, "agente-box"), "unknown");
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "local"), "unknown");
});

test("browserAccess no meu-bot: personalizado também libera os módulos Pro", () => {
  assert.equal(browserAccess(lic({ plan: "personalizado", status: "active" }), "agente-box"), "ok");
  assert.equal(browserAccess(lic({ plan: "personalizado", status: "expired" }), "agente-box"), "expired");
  assert.equal(planoLiberaPro("free"), false); assert.equal(planoLiberaPro("pro"), true); assert.equal(planoLiberaPro("personalizado"), true);
});

test("produto contratado (meu-bot-crm): acumulativo por cima do plano; ok ou 'assinatura', nunca 'free'", () => {
  const P = "meu-bot-crm";
  assert.equal(browserAccess(lic({ plan: "pro", status: "active", produtos: [P] }), "agente-box", "personalizado", P), "ok", "pro + produto");
  assert.equal(browserAccess(lic({ produtos: [P] }), "agente-box", "personalizado", P), "ok", "free + produto");
  assert.equal(browserAccess(lic({ plan: "personalizado", status: "active" }), "agente-box", "personalizado", P), "ok", "personalizado libera todos");
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "agente-box", "personalizado", P), "assinatura", "pro sem o produto não basta");
  assert.equal(browserAccess(lic({ produtos: ["meu-bot-fit"] }), "agente-box", "personalizado", P), "assinatura", "outro produto não serve");
  assert.equal(browserAccess(lic({ plan: "pro", status: "expired", produtos: [P] }), "agente-box", "personalizado", P), "assinatura", "vencida tranca");
  assert.equal(browserAccess(null, "agente-box", "personalizado", P), "unknown");
  assert.equal(browserAccess(lic({ produtos: [P] }), "local", "personalizado", P), "unknown");
  assert.equal(acessoProduto(lic({ plan: "pro", status: "active" }), "agente-box", "personalizado", P), "ausente");
  assert.equal(acessoProduto(lic({ produtos: [P], expiresAt: "2020-01-01T00:00:00Z" }), "agente-box", "personalizado", P), "expirada");
  assert.equal(acessoProduto(lic({}), "agente-box", "free", "meu-bot"), "ok");
  const t = proBlockText("assinatura", lic({ plan: "pro", status: "active" }), "navegador", P);
  assert.equal(t.askAdmin, true); assert.match(t.title, /meu-bot-crm/); assert.doesNotMatch(t.text, /plano Pro/);
});

test("proBlockText: free pede ao admin; unknown não; vencido traz a data", () => {
  assert.equal(proBlockText("free", lic({})).askAdmin, true);
  assert.equal(proBlockText("unknown", null).askAdmin, false);
  const e = proBlockText("expired", lic({ plan: "pro", status: "expired", expiresAt: "2026-09-30T12:00:00Z" }));
  assert.equal(e.askAdmin, true); assert.match(e.text, /venceu em \d{2}\/\d{2}\/\d{4}/);
});

test("tabLabel e displayUrl", () => {
  assert.equal(tabLabel("Gmail", "https://mail.google.com/mail/u/0/"), "Gmail");
  assert.equal(tabLabel("", "https://www.google.com/"), "google.com");
  assert.equal(tabLabel("https://x.com/a", "https://x.com/a"), "x.com");
  assert.equal(tabLabel("", "about:blank"), "Nova aba");
  assert.equal(tabLabel("Um título muito comprido que não cabe na aba interna", "https://a.b"), "Um título muito comprido qu…");
  assert.equal(displayUrl("https://mail.google.com/"), "mail.google.com");
  assert.equal(displayUrl("http://localhost:3000/x"), "http://localhost:3000/x");
});

test("crmProprioOk: Pro ou superior em vigor, ou o produto meu-bot-crm; nunca neste Mac nem sem licença", () => {
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "active" }), "agente-box"), true);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "trialing", trialEnd: "2027-01-01T00:00:00Z" }), "agente-box"), true);
  assert.equal(crmProprioOk(lic({ produtos: ["meu-bot-crm"] }), "agente-box"), true);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "expired" }), "agente-box"), false);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "active", expiresAt: "2020-01-01T00:00:00Z" }), "agente-box"), false);
  assert.equal(crmProprioOk(lic({}), "agente-box"), false);
  assert.equal(crmProprioOk(lic({ plan: "pro", status: "active" }), "local"), false);
  assert.equal(crmProprioOk(null, "agente-box"), false);
});
