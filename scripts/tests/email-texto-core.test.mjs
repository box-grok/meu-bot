import test from "node:test";
import assert from "node:assert/strict";
import { blocosDoCorpo, ehItem, ehSeparador, juntarLinhas, rotuloDeLink, trechosDe } from "../../dist/renderer/lib/email-texto-core.js";

const HOSTINGER = [
  "No urgent action needed. Install your next kernel update and",
  "restart your VPS when it's available.      Hostinger",
  "Security update · CVE-2026-98432",
  "",
  "****************************************",
  "A new Linux kernel vulnerability was found",
  "****************************************",
  "",
  "Hello,",
  "",
  "On October 29, a security vulnerability was announced in the",
  "Linux kernel (CVE-2026-98432",
  "( https://clicks.hostinger.com/f/a/lpQmuW0zNAVjF7vi0G-w2g~~/AAAHahA~/fAcE-",
  "KtKEk2N1CClkiwGHunRnZK3FeBMb_0C9MfabPHqJpzEGlPLttViqNjA1ll1XHjGjHm8t3s0qOT",
  "U2Rrx3c-",
  "PlcXoZeafdsm9ckLVV9Qf2gVJ5h76XQHqn780a1bSjlAR5k2oL9tqCwEsb0J4XUhCW6b1rd7l-",
  "2pJP1JV1FA~ )",
  "). It affects how Linux handles new network connections, and in",
  "some cases it could let an attacker take control of a server",
  "remotely.",
  "",
  "- Update the kernel",
  "- Restart the VPS",
  "",
  "> quoted line one that is long enough to be joined with the next",
  "> quoted line two",
  "",
  "Thanks,",
  "Hostinger",
].join("\n");

test("ehSeparador e ehItem", () => {
  assert.equal(ehSeparador("****************"), true);
  assert.equal(ehSeparador("-- -- --"), true);
  assert.equal(ehSeparador("--"), false);
  assert.equal(ehSeparador("* item"), false);
  assert.equal(ehItem("- Update"), true); assert.equal(ehItem("1. Primeiro"), true); assert.equal(ehItem("Hello,"), false);
});

test("juntarLinhas: quebra dura depois de linha longa vira espaço; linha curta fica sozinha; item de lista também", () => {
  assert.equal(juntarLinhas(["On October 29, a security vulnerability was announced in the", "Linux kernel."]), "On October 29, a security vulnerability was announced in the Linux kernel.");
  assert.equal(juntarLinhas(["Hello,", "World"]), "Hello,\nWorld");
  assert.equal(juntarLinhas(["A linha anterior é comprida o bastante para continuar a frase", "- mas isto é item"]), "A linha anterior é comprida o bastante para continuar a frase\n- mas isto é item");
});

test("juntarLinhas: URL partida em várias linhas volta a ser uma", () => {
  const j = juntarLinhas(HOSTINGER.split("\n").slice(12, 17));
  assert.match(j, /^\( https:\/\/clicks\.hostinger\.com\/f\/a\/lpQmuW0zNAVjF7vi0G-w2g~~\/AAAHahA~\/fAcE-KtKEk2N1CC[^\s]+2pJP1JV1FA~ \)$/);
});

test("trechosDe: links com rótulo curto e pontuação final fora", () => {
  const t = trechosDe("Veja https://www.exemplo.com/a/b. E (https://x.com/y).");
  assert.deepEqual(t.map((x) => x.tipo), ["texto", "link", "texto", "link", "texto"]);
  assert.deepEqual(t[1], { tipo: "link", url: "https://www.exemplo.com/a/b", rotulo: "exemplo.com/a/b" });
  assert.deepEqual(t[3], { tipo: "link", url: "https://x.com/y", rotulo: "x.com/y" });
  assert.equal(t[4].texto, ").");
  assert.equal(rotuloDeLink("https://clicks.hostinger.com/f/a/lpQmuW0zNAVjF7vi0G-w2g~~/AAAHahA~/x"), "clicks.hostinger.com/f/a/lpQmuW0zNAVjF7…");
  assert.equal(rotuloDeLink("https://x.com/"), "x.com");
});

test("blocosDoCorpo: amostra no formato da Hostinger", () => {
  const b = blocosDoCorpo(HOSTINGER);
  assert.deepEqual(b.map((x) => x.tipo), ["paragrafo", "separador", "paragrafo", "separador", "paragrafo", "paragrafo", "paragrafo", "citacao", "paragrafo"]);
  assert.equal(b[4].trechos[0].texto, "Hello,");
  const p = b[5]; assert.equal(p.tipo, "paragrafo");
  const links = p.trechos.filter((t) => t.tipo === "link");
  assert.equal(links.length, 1);
  assert.match(links[0].url, /^https:\/\/clicks\.hostinger\.com\/f\/a\/lpQmuW0zNAVjF7vi0G-w2g~~\/AAAHahA~\/fAcE-KtKEk2N1CC\S+2pJP1JV1FA~$/);
  assert.equal(links[0].rotulo, "clicks.hostinger.com/f/a/lpQmuW0zNAVjF7…");
  assert.match(p.trechos.at(-1).texto, /^ \) \)\. It affects how Linux handles new network connections, and in some cases it could let an attacker take control of a server remotely\.$/);
  const lista = b[6]; assert.equal(lista.trechos[0].texto, "- Update the kernel\n- Restart the VPS");
  const cit = b[7]; assert.equal(cit.tipo, "citacao"); assert.equal(cit.trechos[0].texto, "quoted line one that is long enough to be joined with the next quoted line two");
  assert.equal(b[8].trechos[0].texto, "Thanks,\nHostinger");
});

test("blocosDoCorpo: vazio, só texto, \\r\\n e o marcador do corte", () => {
  assert.deepEqual(blocosDoCorpo(""), []);
  assert.deepEqual(blocosDoCorpo("   \n\n"), []);
  assert.deepEqual(blocosDoCorpo("Oi\r\n\r\nTudo bem?"), [{ tipo: "paragrafo", trechos: [{ tipo: "texto", texto: "Oi" }] }, { tipo: "paragrafo", trechos: [{ tipo: "texto", texto: "Tudo bem?" }] }]);
  const b = blocosDoCorpo("Texto cortado aqui porque passou do limite da página e segue\n[…]");
  assert.equal(b.length, 1); assert.match(b[0].trechos[0].texto, /segue \[…\]$/);
});
