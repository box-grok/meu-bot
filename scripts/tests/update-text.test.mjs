import { test } from "node:test";
import assert from "node:assert/strict";
import { updateStateText, updateBlockerText, APLICAR, PARAR_E_APLICAR } from "../../dist/renderer/lib/update-text.js";

const base = { current: "0.1.0", available: null, ready: null, checking: false, error: null, errorKind: null, checkedAt: null, progress: null, aguardando: false, ocupadoAoAplicar: false, minima: null, abaixoDaMinima: false, atualizarOcioso: true };
const NOW = Date.parse("2026-10-17T05:00:00Z");

test("cada fase vira uma frase, como no Rambox", () => {
  assert.deepEqual(updateStateText({ ...base, phase: "idle" }, "meu-bot", NOW), { text: "Atualização automática só no app instalado.", kind: "muted", showApply: false, applyLabel: APLICAR, showMove: false, short: null });
  assert.equal(updateStateText({ ...base, phase: "checking", checking: true }, "meu-bot", NOW).text, "Verificando atualizações…");
  assert.equal(updateStateText({ ...base, phase: "checking", checking: true }, "meu-bot", NOW).short, "verificando atualizações…");
  assert.deepEqual(updateStateText({ ...base, phase: "up-to-date", checkedAt: "2026-10-17T04:58:00Z" }, "meu-bot", NOW), { text: "Você está na versão mais recente (conferido há 2 min).", kind: "ok", showApply: false, applyLabel: APLICAR, showMove: false, short: null });
  assert.equal(updateStateText({ ...base, phase: "up-to-date", checkedAt: "2026-10-17T04:59:50Z" }, "meu-bot", NOW).text, "Você está na versão mais recente (conferido agora).");
  assert.equal(updateStateText({ ...base, phase: "up-to-date" }, "meu-bot", NOW).text, "Você está na versão mais recente.");
  assert.deepEqual(updateStateText({ ...base, phase: "available", available: "0.2.0" }, "meu-bot", NOW), { text: "Nova versão 0.2.0 disponível, baixando…", kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "baixando a atualização…" });
  assert.deepEqual(updateStateText({ ...base, phase: "ready", available: "0.2.0", ready: "0.2.0" }, "meu-bot-admin", NOW), { text: "meu-bot-admin 0.2.0 pronta para instalar.", kind: "warn", showApply: true, applyLabel: APLICAR, showMove: false, short: null });
  assert.deepEqual(updateStateText({ ...base, phase: "error", error: "GitHub respondeu 503", errorKind: "github" }, "meu-bot", NOW), { text: "Não consegui verificar atualizações: GitHub respondeu 503.", kind: "bad", showApply: false, applyLabel: APLICAR, showMove: false, short: null });
  assert.deepEqual(updateStateText({ ...base, phase: "error", error: "sem internet", errorKind: "rede" }, "meu-bot", NOW), { text: "Sem internet; verifico as atualizações de novo quando a conexão voltar.", kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: null });
});

test("fases novas (molde do Grok Bot): download com porcentagem, conferência, instalação e pasta só de leitura", () => {
  assert.deepEqual(updateStateText({ ...base, phase: "downloading", available: "0.2.0", progress: 0.427 }, "meu-bot", NOW), { text: "Baixando a versão 0.2.0… 42%", kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "baixando 42%" });
  assert.deepEqual(updateStateText({ ...base, phase: "downloading", available: "0.2.0", progress: null }, "meu-bot", NOW), { text: "Baixando a versão 0.2.0…", kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "baixando…" });
  assert.equal(updateStateText({ ...base, phase: "downloading", available: "0.2.0", progress: 1 }, "meu-bot", NOW).short, "baixando 100%");
  assert.deepEqual(updateStateText({ ...base, phase: "verifying", available: "0.2.0" }, "meu-bot", NOW), { text: "Conferindo a versão 0.2.0…", kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "conferindo a atualização…" });
  assert.deepEqual(updateStateText({ ...base, phase: "applying", ready: "0.2.0" }, "meu-bot", NOW), { text: "Instalando a versão 0.2.0…", kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "instalando…" });
  assert.equal(updateStateText({ ...base, phase: "applying", ready: "0.2.0", aguardando: true }, "meu-bot", NOW).text, "Esperando a resposta em andamento terminar para atualizar…");
  const ro = updateStateText({ ...base, phase: "needs-move" }, "meu-bot", NOW);
  assert.equal(ro.kind, "bad"); assert.match(ro.text, /Aplicativos/); assert.equal(ro.showApply, false);
  assert.equal(ro.showMove, true, "numa pasta sem escrita o app oferece mover, em vez de só instruir");
});

test("resposta em andamento: a tela oferece parar, em vez de o app reiniciar por cima da conversa", () => {
  const pronta = { ...base, phase: "ready", available: "0.2.0", ready: "0.2.0" };
  assert.equal(updateStateText(pronta, "meu-bot", NOW).applyLabel, APLICAR);
  assert.equal(updateStateText(pronta, "meu-bot", NOW).short, null, "pronta e nada em andamento não vira aviso na barra");

  const ocupada = updateStateText({ ...pronta, ocupadoAoAplicar: true }, "meu-bot", NOW);
  assert.equal(ocupada.applyLabel, PARAR_E_APLICAR);
  assert.equal(ocupada.showApply, true, "a escolha continua à mão");
  assert.match(ocupada.text, /resposta em andamento/);
  assert.match(ocupada.text, /esperar/, "esperar é uma saída legítima: não fazer nada");
  assert.equal(ocupada.short, "atualização esperando a resposta");
});

test("bloqueador de versão mínima: o que a pessoa vê em cada fase", () => {
  const b = (extra) => updateBlockerText({ ...base, minima: "0.3.0", abaixoDaMinima: true, ...extra }, "meu-bot");
  assert.deepEqual(b({ phase: "ready", ready: "0.3.1", available: "0.3.1" }), { title: "Atualização pronta", text: "Reinicie para terminar de instalar o meu-bot 0.3.1. Leva poucos segundos; as conversas e o WhatsApp ficam onde estavam.", showApply: true, applyLabel: APLICAR, showMove: false, showManual: false });
  // Mesmo com o backend exigindo a versão nova, uma resposta em andamento não é interrompida sem a pessoa mandar.
  const ocupado = b({ phase: "ready", ready: "0.3.1", available: "0.3.1", ocupadoAoAplicar: true });
  assert.equal(ocupado.applyLabel, PARAR_E_APLICAR); assert.match(ocupado.text, /resposta em andamento/);
  // E se o app está numa pasta sem escrita, mover é o ÚNICO caminho para destravar esta tela.
  const preso = b({ phase: "needs-move" });
  assert.equal(preso.showMove, true); assert.equal(preso.showManual, true);
  assert.equal(b({ phase: "error", errorKind: "github", error: "x" }).showMove, false);
  const d = b({ phase: "downloading", available: "0.3.1", progress: 0.5 });
  assert.equal(d.title, "Atualização necessária"); assert.match(d.text, /precisa do meu-bot 0\.3\.0 ou mais novo \(este é o 0\.1\.0\)\. Baixando a versão 0\.3\.1… 50%/); assert.equal(d.showApply, false); assert.equal(d.showManual, false);
  const e = b({ phase: "error", error: "GitHub respondeu 503", errorKind: "github" });
  assert.match(e.text, /Não consegui verificar atualizações: GitHub respondeu 503/); assert.equal(e.showManual, true, "sem download, o caminho manual aparece");
  assert.equal(b({ phase: "up-to-date" }).showManual, true, "a release ainda não tem a versão exigida: baixar à mão");
  assert.equal(b({ phase: "applying", ready: "0.3.1" }).title, "Atualizando…");
});
