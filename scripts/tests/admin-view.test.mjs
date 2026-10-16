import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_ACTIONS, actionResultText, healthLines, personSuffix, progressLines, timeAgo, visibleActions } from "../../dist/renderer/lib/admin-view.js";

const probe = { reachable: true, user: "box", os: "Ubuntu", error: null, backendInstalled: true, backendListening: false, claudeLoggedIn: true, statusLine: false };
const fmt = (d) => (d === null ? "" : `+${d}`);

test("healthLines: sondagem e WhatsApp viram linhas com ✓/✗/•", () => {
  const sem = healthLines({ probe, whatsapp: null, progress: null }, fmt);
  assert.deepEqual(sem.map((l) => l.ok), [true, false, true, false]);
  assert.equal(sem[0].text, "entra por SSH (box · Ubuntu)");
  assert.equal(sem[1].text, "backend instalado mas parado");
  const wa = { present: true, connected: true, number: "5511999990000", detail: "", dmPolicy: "allowlist", audioIn: false, audioOut: "inbound" };
  const com = healthLines({ probe, whatsapp: wa, progress: null }, fmt);
  assert.equal(com.length, 8);
  assert.equal(com[4].text, "WhatsApp conectado (+5511999990000)");
  assert.equal(com[5].text, "responde: só a dona do número"); assert.equal(com[5].ok, null);
  assert.equal(com[6].text, "não entende áudios (sem transcrição)"); assert.equal(com[6].ok, false);
  assert.equal(com[7].text, "responde em áudio: quando recebe áudio");
  const fora = healthLines({ probe: { ...probe, reachable: false, error: "timeout" }, whatsapp: null, progress: null }, fmt);
  assert.equal(fora[0].text, "não entra por SSH: timeout");
});

test("progressLines: tour e tutoriais, com onde parou", () => {
  const prog = { at: "2026-10-16T12:00:00Z", tour: "skipped", tutorials: [
    { id: "a", title: "Ligar o suporte", done: 2, total: 2, current: null, finished: true, comingSoon: false },
    { id: "b", title: "Status line", done: 1, total: 2, current: "instalar", finished: false, comingSoon: false },
    { id: "c", title: "Voz", done: 0, total: 3, current: null, finished: false, comingSoon: true },
    { id: "d", title: "WhatsApp", done: 0, total: 4, current: null, finished: false, comingSoon: false },
  ] };
  const l = progressLines(prog);
  assert.deepEqual(l.map((x) => [x.text, x.ok, x.step]), [
    ["Tour do meu-bot: pulado", false, undefined],
    ["Ligar o suporte: concluído", true, undefined],
    ["Status line: 1 de 2", null, ' · parou em "instalar"'],
    ["Voz: em breve", null, undefined],
    ["WhatsApp: 0 de 4", false, undefined],
  ]);
});

test("visibleActions esconde a transcrição quando a máquina já entende áudios", () => {
  assert.equal(visibleActions(null).length, ADMIN_ACTIONS.length);
  const ids = visibleActions({ probe, whatsapp: { present: true, connected: true, number: null, detail: "", dmPolicy: null, audioIn: true }, progress: null }).map((o) => o.id);
  assert.ok(!ids.includes("transcription") && ids.includes("restart-gateway"));
  assert.equal(actionResultText("Reiniciar", { ok: true, detail: "" }), "Reiniciar: feito");
  assert.equal(actionResultText("Reiniciar", { ok: false, detail: "exit 1" }), "Reiniciar: falhou · exit 1");
});

test("timeAgo e personSuffix", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(timeAgo("2026-10-16T11:59:40Z", now), "visto agora");
  assert.equal(timeAgo("2026-10-16T11:30:00Z", now), "visto há 30 min");
  assert.equal(timeAgo("2026-10-16T09:00:00Z", now), "visto há 3 h");
  assert.equal(timeAgo("2026-10-13T12:00:00Z", now), "visto há 3 dias");
  assert.equal(timeAgo("lixo", now), "");
  const p = { alias: "suporte-bia-ab12", name: "Bia", hostname: "203.0.113.7", port: 2222, local: false, on: true, seenAt: "2026-10-16T11:30:00Z", source: "caixa" };
  assert.equal(personSuffix(p, now), " · 203.0.113.7:2222 · visto há 30 min");
  assert.equal(personSuffix({ ...p, port: 22, local: true, seenAt: "" }, now), " · 203.0.113.7 · só alcançável deste Mac");
});
