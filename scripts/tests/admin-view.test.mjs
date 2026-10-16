import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_ACTIONS, actionResultText, agoText, compareVersions, healthLines, personSuffix, progressLines, timeAgo, transcriptionNote, visibleActions } from "../../dist/renderer/lib/admin-view.js";

const probe = { reachable: true, user: "box", os: "Ubuntu", error: null, backendInstalled: true, backendListening: false, claudeLoggedIn: true, statusLine: false };
const fmt = (d) => (d === null ? "" : `+${d}`);
const share = { progress: true, whatsapp: true, logs: true, chat: true };
const V = "0.1.0";

test("healthLines: sondagem e WhatsApp viram linhas com ✓/✗/•", () => {
  const sem = healthLines({ probe, whatsapp: null, progress: null, share }, fmt, V);
  assert.deepEqual(sem.map((l) => l.ok), [null, true, false, true, false]);
  assert.match(sem[0].text, /sem dados ainda/);
  sem.shift();
  assert.equal(sem[0].text, "entra por SSH (box · Ubuntu)");
  assert.equal(sem[1].text, "backend instalado mas parado");
  const wa = { present: true, connected: true, number: "5511999990000", detail: "", dmPolicy: "allowlist", audioIn: false, audioOut: "inbound" };
  const com = healthLines({ probe, whatsapp: wa, progress: null, share: { ...share, progress: false } }, fmt, V);
  assert.equal(com.length, 8, "sem compartilhar o progresso não há linha de versão");
  assert.equal(com[4].text, "WhatsApp conectado (+5511999990000)");
  assert.equal(com[5].text, "responde: só a dona do número"); assert.equal(com[5].ok, null);
  assert.equal(com[6].text, "não entende áudios (sem transcrição)"); assert.equal(com[6].ok, false);
  assert.equal(com[7].text, "responde em áudio: quando recebe áudio");
  const fora = healthLines({ probe: { ...probe, reachable: false, error: "timeout" }, whatsapp: null, progress: null, share: { ...share, progress: false } }, fmt, V);
  assert.equal(fora[0].text, "não entra por SSH: timeout");
});

test("progressLines: tour e tutoriais, com onde parou", () => {
  const prog = { at: "2026-10-16T12:00:00Z", tour: "skipped", tutorials: [
    { id: "a", title: "Ligar o suporte", done: 2, total: 2, current: null, finished: true, comingSoon: false },
    { id: "statusline", title: "Status line", done: 1, total: 2, current: "instalar", finished: false, comingSoon: false },
    { id: "c", title: "Voz", done: 0, total: 3, current: null, finished: false, comingSoon: true },
    { id: "d", title: "WhatsApp", done: 0, total: 4, current: null, finished: false, comingSoon: false },
  ] };
  const l = progressLines(prog);
  assert.deepEqual(l.map((x) => [x.text, x.ok, x.step]), [
    ["Tour do meu-bot: pulado", false, undefined],
    ["Ligar o suporte: concluído", true, undefined],
    ["3 · Status line: 1 de 2", null, ' · parou em "instalar"'],
    ["Voz: em breve", null, undefined],
    ["WhatsApp: 0 de 4", false, undefined],
  ]);
});

test("visibleActions: transcrição só com OpenClaw, Ativar ou Desativar conforme o estado; nota explica quando não há", () => {
  assert.deepEqual(visibleActions(null).map((o) => o.id), ["restart-gateway", "restart-backend"]);
  const wa = (x) => ({ present: true, gateway: "openclaw", connected: true, number: null, detail: "", dmPolicy: null, ...x });
  const h = (whatsapp, sh = share) => ({ probe, whatsapp, progress: null, share: sh });
  assert.deepEqual(visibleActions(h(wa({ audioIn: false }))).map((o) => o.id), ["restart-gateway", "restart-backend", "transcription"]);
  const ids = visibleActions(h(wa({ audioIn: true }))).map((o) => o.id);
  assert.ok(!ids.includes("transcription") && ids.includes("transcription-off") && ids.includes("restart-gateway"));
  assert.deepEqual(visibleActions(h({ present: false, gateway: null })).map((o) => o.id), ["restart-gateway", "restart-backend"]);
  assert.match(transcriptionNote(h({ present: false, gateway: null })), /não tem OpenClaw/);
  assert.match(transcriptionNote(h(wa({ gateway: "hermes", audioIn: undefined }))), /só com OpenClaw/);
  assert.match(transcriptionNote(h(null, { ...share, whatsapp: false })), /não compartilha/);
  assert.equal(transcriptionNote(h(wa({ audioIn: false }))), null);
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
  const p = { alias: "suporte-bia-ab12", name: "Bia", machine: null, hostname: "203.0.113.7", port: 2222, local: false, on: true, seenAt: "2026-10-16T11:30:00Z", source: "caixa" };
  assert.equal(personSuffix(p, now), " · 203.0.113.7:2222 · visto há 30 min");
  assert.equal(personSuffix({ ...p, port: 22, local: true, seenAt: "" }, now), " · 203.0.113.7 · só alcançável deste Mac");
  assert.equal(personSuffix({ ...p, machine: "colima", port: 22, seenAt: "" }, now), " · colima · 203.0.113.7");
});

test("versão do meu-bot dela na saúde: atrás da do admin acusa; igual ou à frente fica ok", () => {
  const now = Date.now();
  const prog = (version) => ({ at: new Date(now).toISOString(), tour: "done", tutorials: [], app: { version, openedAt: new Date(now - 2 * 3600_000).toISOString() } });
  const atras = healthLines({ probe, whatsapp: null, progress: prog("0.0.9"), share }, fmt, "0.1.0")[0];
  assert.equal(atras.ok, false); assert.match(atras.text, /0\.0\.9 .*atrás da sua \(0\.1\.0\).*aberto há 2 h/);
  const igual = healthLines({ probe, whatsapp: null, progress: prog("0.1.0"), share }, fmt, "0.1.0")[0];
  assert.equal(igual.ok, true); assert.match(igual.text, /meu-bot 0\.1\.0 no Mac dela · aberto há 2 h/);
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.1", "0.1.0"), 0);
  assert.equal(agoText(new Date(now - 20_000).toISOString(), now), "agora");
});
