import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_NOTIFY_DEFAULT_INSTRUCTION, NavNotifyBudget, NavNotifyDedup, navNotifyAllowed, navNotifyMessage, navNotifyTitle, parseNotifyHosts, parsePageNotification, toggleNotifyHost } from "../../dist/renderer/lib/nav-notify.js";

const n = { title: "New message from Alice", body: "Your invoice is ready", icon: "https://x/i.png", tag: "t1", url: "https://mail.google.com/mail/u/0/#inbox", site: "mail.google.com" };

test("parsePageNotification: só campos esperados, texto normalizado, url/ícone só http(s)/data", () => {
  assert.deepEqual(parsePageNotification({ ...n, title: "  New\n message  from Alice ", icon: "javascript:alert(1)", url: "ftp://x", extra: 1 }), { ...n, title: "New message from Alice", icon: "", url: "" });
  assert.equal(parsePageNotification({ site: "a.com" }), null, "sem título nem corpo");
  assert.equal(parsePageNotification({ title: "x" }), null, "sem site");
  assert.equal(parsePageNotification("nope"), null);
  assert.equal(parsePageNotification({ ...n, site: "MAIL.Google.com" }).site, "mail.google.com");
});

test("navNotifyAllowed: só sites com o sino ligado (host ou subdomínio); vazio = nenhum", () => {
  assert.equal(navNotifyAllowed([], "x.com"), false);
  assert.deepEqual(toggleNotifyHost([], "Mail.Google.com", true), ["mail.google.com"]);
  assert.deepEqual(toggleNotifyHost(["mail.google.com"], "mail.google.com", true), ["mail.google.com"]);
  assert.deepEqual(toggleNotifyHost(["mail.google.com", "a.com"], "mail.google.com", false), ["a.com"]);
  assert.equal(navNotifyAllowed(["google.com"], "mail.google.com"), true);
  assert.equal(navNotifyAllowed(["mail.google.com"], "google.com"), false);
  assert.equal(navNotifyAllowed(["a.com"], "b.com"), false);
});

test("título por site ou por notificação; mensagem com a instrução e o que a página disse", () => {
  assert.equal(navNotifyTitle(n, "site"), "🔔 mail.google.com");
  assert.equal(navNotifyTitle(n, "each"), "🔔 mail.google.com · New message from Alice");
  const m = navNotifyMessage("  ", n);
  assert.ok(m.startsWith(NAV_NOTIFY_DEFAULT_INSTRUCTION), "instrução vazia cai no padrão");
  assert.match(m, /Notificação de mail\.google\.com \(https:\/\/mail\.google\.com/);
  assert.match(m, /Título: New message from Alice\nTexto: Your invoice is ready$/);
  assert.ok(navNotifyMessage("Resuma.", { ...n, body: "", url: "" }).endsWith("Título: New message from Alice"));
});

test("dedup: a mesma notificação dentro de 60 s não repete; depois sim; tag diferente é outra", () => {
  const d = new NavNotifyDedup(60_000);
  assert.equal(d.fresh(n, 1000), true);
  assert.equal(d.fresh(n, 2000), false);
  assert.equal(d.fresh({ ...n, tag: "t2" }, 2000), true);
  assert.equal(d.fresh(n, 70_000), true);
});

test("parseNotifyHosts: separa por vírgula/espaço, tira esquema e caminho, sem repetição nem lixo", () => {
  assert.deepEqual(parseNotifyHosts("mail.google.com, https://web.whatsapp.com/x ; MAIL.google.com bad_host!"), ["mail.google.com", "web.whatsapp.com"]);
  assert.deepEqual(parseNotifyHosts(""), []);
});

test("orçamento por site: 3 por minuto; o excedente conta e volta no próximo aviso da janela seguinte", () => {
  const b = new NavNotifyBudget(3, 60_000);
  assert.deepEqual([b.take("a", 0), b.take("a", 1), b.take("a", 2)].map((r) => r.ok), [true, true, true]);
  assert.deepEqual(b.take("a", 3), { ok: false, skipped: 0 });
  assert.deepEqual(b.take("a", 4), { ok: false, skipped: 0 });
  assert.deepEqual(b.take("b", 5), { ok: true, skipped: 0 }, "outro site tem o próprio orçamento");
  assert.deepEqual(b.take("a", 60_001), { ok: true, skipped: 2 }, "janela nova: avisa quantas ficaram de fora");
});
