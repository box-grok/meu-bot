import { test } from "node:test";
import assert from "node:assert/strict";
import { isConnectionCode, isLocalAddr, looksLikeOffline, offlineMessage } from "../../dist/main/net-core.js";

test("looksLikeOffline: códigos sem rota/DNS e o texto do ssh; o forward local recusando não é offline por si", () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN"]) assert.equal(looksLikeOffline({ code }), true, code);
  for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ABORTED", ""]) assert.equal(looksLikeOffline({ code }), false, code);
  assert.equal(looksLikeOffline({ text: "SSH não conectou (255): ssh: Could not resolve hostname agente-box: nodename nor servname provided" }), true);
  assert.equal(looksLikeOffline({ text: "ssh: connect to host 100.64.0.9 port 22: Network is unreachable" }), true);
  assert.equal(looksLikeOffline({ text: "ssh: connect to host x port 22: No route to host" }), true);
  assert.equal(looksLikeOffline({ text: "Permission denied (publickey)" }), false);
  assert.equal(looksLikeOffline({ code: null, text: null }), false);
});

test("isConnectionCode: tudo que vale uma sondagem antes de culpar a máquina", () => {
  for (const c of ["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND"]) assert.equal(isConnectionCode(c), true, c);
  for (const c of ["ABORTED", "ETIMEDOUT_LOCAL", undefined, null, ""]) assert.equal(isConnectionCode(c), false, String(c));
});

test("isLocalAddr: a colima (127.0.0.1) é este Mac; um IP do Tailscale não", () => {
  assert.equal(isLocalAddr("127.0.0.1"), true); assert.equal(isLocalAddr("localhost"), true); assert.equal(isLocalAddr("::1"), true);
  assert.equal(isLocalAddr("100.64.0.9"), false); assert.equal(isLocalAddr("agente-box"), false);
});

test("offlineMessage: cada frase começa pela causa certa e não culpa a máquina", () => {
  assert.match(offlineMessage("chat"), /^Você está sem internet\./); assert.match(offlineMessage("chat"), /não tem culpa/);
  assert.match(offlineMessage("tunnel"), /^Você está sem internet/);
  assert.equal(offlineMessage("update"), "sem internet");
  assert.match(offlineMessage("support"), /^Você está sem internet/);
  for (const k of ["chat", "tunnel", "support"]) assert.doesNotMatch(offlineMessage(k), /Tailscale|VM não respondeu/);
});
