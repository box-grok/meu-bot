import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_ACTIONS, actionResultText, agoText, compareVersions, dateInputToIso, gb, healthLines, isoToDateInput, licenseSummary, personSuffix, progressLines, timeAgo, transcriptionNote, visibleActions } from "../../dist/renderer/lib/admin-view.js";

const probe = { reachable: true, user: "box", os: "Ubuntu", error: null, backendInstalled: true, backendListening: false, claudeLoggedIn: true, statusLine: false };
const fmt = (d) => (d === null ? "" : `+${d}`);
const share = { progress: true, whatsapp: true, logs: true, chat: true };
const V = "0.1.0";

test("healthLines: sondagem e WhatsApp viram linhas com ✓/✗/•", () => {
  const sem = healthLines({ probe, whatsapp: null, progress: null, share, xai: null }, fmt, V);
  assert.deepEqual(sem.map((l) => l.ok), [null, true, false, true, null, false]);
  assert.equal(sem[4].text, "xAI (Grok): sem Hermes nesta máquina");
  assert.match(sem[0].text, /sem dados ainda/);
  sem.shift();
  assert.equal(sem[0].text, "entra por SSH (box · Ubuntu)");
  assert.equal(sem[1].text, "backend instalado mas parado");
  const wa = { present: true, connected: true, number: "5511999990000", detail: "", dmPolicy: "allowlist", audioIn: false, audioOut: "inbound" };
  const com = healthLines({ probe, whatsapp: wa, progress: null, share: { ...share, progress: false }, xai: { loggedIn: true, email: "d@x.ai" } }, fmt, V);
  assert.equal(com.length, 9, "sem compartilhar o progresso não há linha de versão");
  assert.equal(com[3].text, "xAI (Grok) logada (d@x.ai)"); assert.equal(com[3].ok, true);
  com.splice(3, 1);
  assert.equal(com[4].text, "WhatsApp conectado (+5511999990000)");
  assert.equal(com[5].text, "responde: só a dona do número"); assert.equal(com[5].ok, null);
  assert.equal(com[6].text, "não entende áudios (sem transcrição)"); assert.equal(com[6].ok, false);
  assert.equal(com[7].text, "responde em áudio: quando recebe áudio");
  const fora = healthLines({ probe: { ...probe, reachable: false, error: "timeout" }, whatsapp: null, progress: null, share: { ...share, progress: false }, xai: { loggedIn: false, email: null } }, fmt, V);
  assert.equal(fora[3].text, "xAI (Grok) deslogada: o grok-4 não responde");
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
  assert.deepEqual(visibleActions(null).map((o) => o.id), ["restart-gateway", "restart-backend", "support-off"]);
  const wa = (x) => ({ present: true, gateway: "openclaw", connected: true, number: null, detail: "", dmPolicy: null, ...x });
  const h = (whatsapp, sh = share) => ({ probe, whatsapp, progress: null, share: sh, xai: null });
  assert.deepEqual(visibleActions(h(wa({ audioIn: false }))).map((o) => o.id), ["restart-gateway", "restart-backend", "transcription", "support-off"]);
  const ids = visibleActions(h(wa({ audioIn: true }))).map((o) => o.id);
  assert.ok(!ids.includes("transcription") && ids.includes("transcription-off") && ids.includes("restart-gateway"));
  assert.deepEqual(visibleActions(h({ present: false, gateway: null })).map((o) => o.id), ["restart-gateway", "restart-backend", "support-off"]);
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
  const atras = healthLines({ probe, whatsapp: null, progress: prog("0.0.9"), share, xai: null }, fmt, "0.1.0")[0];
  assert.equal(atras.ok, false); assert.match(atras.text, /0\.0\.9 .*atrás da sua \(0\.1\.0\).*aberto há 2 h/);
  const igual = healthLines({ probe, whatsapp: null, progress: prog("0.1.0"), share, xai: null }, fmt, "0.1.0")[0];
  assert.equal(igual.ok, true); assert.match(igual.text, /meu-bot 0\.1\.0 no Mac dela · aberto há 2 h/);
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.1", "0.1.0"), 0);
  assert.equal(agoText(new Date(now - 20_000).toISOString(), now), "agora");
});

test("healthLines: disco e memória da máquina (REA do Rambox), com aviso de pouco espaço", () => {
  assert.equal(gb(40_960), "40 GB"); assert.equal(gb(1536), "1,5 GB"); assert.equal(gb(820), "820 MB");
  const base = { probe: { ...probe, diskTotalMb: 40_960, diskFreeMb: 12_288, memTotalMb: 4096, memFreeMb: 1536 }, whatsapp: null, progress: null, share: { ...share, progress: false }, xai: null };
  const lines = healthLines(base, fmt, V);
  const disk = lines.find((l) => l.text.startsWith("disco:")), mem = lines.find((l) => l.text.startsWith("memória:"));
  assert.deepEqual([disk.text, disk.ok], ["disco: 12 GB livres de 40 GB", true]);
  assert.deepEqual([mem.text, mem.ok], ["memória: 1,5 GB livres de 4,0 GB", null]);
  const low = healthLines({ ...base, probe: { ...base.probe, diskFreeMb: 900, memFreeMb: 300 } }, fmt, V);
  assert.deepEqual([low.find((l) => l.text.startsWith("disco:")).ok, low.find((l) => l.text.startsWith("memória:")).ok], [false, false]);
  assert.match(low.find((l) => l.text.startsWith("disco:")).text, /pouco espaço/);
  // sem os números (máquina antiga/sondagem sem df): nenhuma linha
  assert.equal(healthLines({ ...base, probe }, fmt, V).some((l) => /^disco:|^memória:/.test(l.text)), false);
});

test("isoToDateInput / dateInputToIso: ida e volta, vazio e inválido", () => {
  assert.equal(isoToDateInput("2027-10-15T00:00:00.000Z"), "2027-10-15");
  assert.equal(isoToDateInput(null), "");
  assert.equal(isoToDateInput("não-data"), "");
  assert.equal(dateInputToIso("2027-10-15"), "2027-10-15T00:00:00.000Z");
  assert.equal(dateInputToIso(""), null, "vazio limpa a validade");
  assert.equal(dateInputToIso("15/10/2027"), null, "formato errado vira null");
  // Round-trip: input → ISO → input.
  assert.equal(isoToDateInput(dateInputToIso("2026-01-02")), "2026-01-02");
});

test("licenseSummary: mostra validade e marca expirada no passado", () => {
  const lic = { plan: "pro", status: "active", interval: "year", memberSince: "2026-10-15T00:00:00.000Z", trialEnd: null, expiresAt: "2020-01-01T00:00:00.000Z", deviceLimit: 2, updatedAt: "2026-10-17T00:00:00.000Z", updatedBy: "admin" };
  const view = { license: lic, devices: [], activeCount: 0, pendingCount: 0, deviceLimit: 2 };
  const lines = licenseSummary(view, Date.parse("2026-10-17T00:00:00.000Z"));
  const exp = lines.find((l) => l.text.startsWith("Expira:"));
  assert.ok(exp, "tem linha de validade");
  assert.equal(exp.ok, false, "validade no passado marca vermelho");
});
