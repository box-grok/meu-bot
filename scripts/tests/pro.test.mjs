import { test } from "node:test";
import assert from "node:assert/strict";
import { browserAccess, displayUrl, proBlockText, tabLabel } from "../../dist/renderer/lib/pro.js";

const lic = (over) => ({ license: { plan: "free", status: "free", interval: null, memberSince: "2026-10-18T00:00:00Z", trialEnd: null, expiresAt: null, deviceLimit: 1, updatedAt: "2026-10-18T00:00:00Z", updatedBy: "admin", ...over }, devices: [] });

test("browserAccess: pro ativo abre; free e vencido bloqueiam; este Mac e backend antigo são unknown", () => {
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "agente-box"), "ok");
  assert.equal(browserAccess(lic({ plan: "pro", status: "trialing", trialEnd: "2027-01-01T00:00:00Z" }), "agente-box"), "ok");
  assert.equal(browserAccess(lic({}), "agente-colima"), "free");
  assert.equal(browserAccess(lic({ plan: "pro", status: "expired" }), "agente-box"), "expired");
  assert.equal(browserAccess(lic({ plan: "pro", status: "active", expiresAt: "2020-01-01T00:00:00Z" }), "agente-box"), "expired", "expiresAt no passado vence mesmo com status active");
  assert.equal(browserAccess(null, "agente-box"), "unknown");
  assert.equal(browserAccess(lic({ plan: "pro", status: "active" }), "local"), "unknown");
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
