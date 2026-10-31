import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { toolEventsFrom, toolChunk, resultText } = createRequire(import.meta.url)("../../backend-colima/tool-events.js");

test("atividade do agente: tool_use vira resumo por ferramenta; tool_result acha o nome pelo id", () => {
  const names = new Map();
  const use = { type: "assistant", message: { content: [
    { type: "text", text: "vou olhar" },
    { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la   ~/" } },
    { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/home/box/a.txt" } },
    { type: "tool_use", id: "t3", name: "Grep", input: { pattern: "foo", path: "src" } },
  ] } };
  assert.deepEqual(toolEventsFrom(use, names), [
    { kind: "use", name: "Bash", summary: "ls -la ~/" },
    { kind: "use", name: "Read", summary: "/home/box/a.txt" },
    { kind: "use", name: "Grep", summary: "foo em src" },
  ]);
  const res = { type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "t1", content: "total 8\na\nb" },
    { type: "tool_result", tool_use_id: "zz", is_error: true, content: [{ type: "text", text: "boom" }] },
  ] } };
  assert.deepEqual(toolEventsFrom(res, names), [
    { kind: "result", name: "Bash", ok: true, text: "total 8\na\nb" },
    { kind: "result", name: null, ok: false, text: "boom" },
  ]);
  assert.deepEqual(toolEventsFrom({ type: "stream_event", event: {} }, names), []);
  assert.deepEqual(toolEventsFrom(null, names), []);
});

test("resultado longo é cortado em 20 linhas; chunk SSE tem o formato OpenAI com x_meu_bot.tool", () => {
  const r = resultText(Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n"));
  assert.ok(r.endsWith("… (+10 linhas)") && r.split("\n").length === 21);
  const c = toolChunk("id1", 123, "agente", { kind: "use", name: "Bash", summary: "pwd" });
  assert.equal(c.object, "chat.completion.chunk"); assert.deepEqual(c.choices[0].delta, {}); assert.equal(c.x_meu_bot.tool.summary, "pwd");
});

test("ações do navegador viram uma linha com 🌐; digitar nunca mostra o texto", () => {
  const ev = (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: `t-${name}`, name, input }] } });
  const names = new Map();
  const sum = (name, input) => toolEventsFrom(ev(name, input), names)[0].summary;
  assert.equal(sum("mcp__navegador__abrir", { url: "https://example.com", nova: true }), "🌐 abriu https://example.com (aba nova)");
  assert.equal(sum("mcp__navegador__ler", {}), "🌐 leu a página");
  assert.equal(sum("mcp__navegador__clicar", { n: 12 }), "🌐 clicou em o elemento 12");
  assert.equal(sum("mcp__navegador__clicar", { texto: "Entrar" }), '🌐 clicou em "Entrar"');
  const d = sum("mcp__navegador__digitar", { n: 3, texto: "minha-senha-secreta", enter: true });
  assert.equal(d, "🌐 digitou em o elemento 3 e apertou Enter"); assert.doesNotMatch(d, /secreta/);
  assert.equal(sum("mcp__navegador__print", {}), "🌐 tirou um print");
  assert.equal(sum("mcp__gmail__listar", { busca: "from:ana" }), "✉️ listou e-mails (busca: from:ana)");
  assert.equal(sum("mcp__gmail__ler", { id: "abc" }), "✉️ leu um e-mail");
  assert.equal(sum("mcp__gmail__apagar", { id: "abc" }), "✉️ moveu um e-mail para a lixeira");
  assert.match(sum("mcp__outro__x", { a: 1 }), /^\{/);
});

test("comandos do streak.mjs no Bash viram uma linha 📇 com o subcomando", () => {
  const { summarize } = createRequire(import.meta.url)("../../backend-colima/tool-events.js");
  assert.equal(summarize("Bash", { command: "node ~/.local/share/meu-bot/crm/streak.mjs box-find --phone +595994402904" }), "📇 CRM: box-find --phone +595994402904");
  assert.equal(summarize("Bash", { command: "node /x/streak.mjs comment k1 \"fechou o Kommo\"" }), "📇 CRM: comment k1 \"fechou o Kommo\"");
  assert.equal(summarize("Bash", { command: "node ~/.local/share/meu-bot/crm/crm.mjs box-find --phone +595994402904" }), "📇 CRM: box-find --phone +595994402904", "crm.mjs (meu-bot-crm) igual");
  assert.equal(summarize("Bash", { command: "node ~/.local/share/meu-bot/crm/importar-streak.mjs --chave SEGREDO --pipeline x --dry-run" }), "📇 CRM: importar do Streak (simulação)", "a chave do Streak nunca aparece");
});
