import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { LEVELS, OBJECTIVE_SKILL, parseObjectiveChoice, parseObjectiveFile, parseMachineSkills, skillMarkdown, toolsBySenderFor, saveObjectiveSh, setObjectiveSh, resetObjectiveSh, objectiveInfoSh } = createRequire(import.meta.url)("../../dist/main/objetivo-core.js");

test("níveis: três, ids fixos; só \"age\" sem trava; \"conversa\" trava como os outros contatos", () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ["conversa", "consulta", "age"]);
  assert.deepEqual(LEVELS.find((l) => l.id === "age").deny, []);
  assert.ok(LEVELS.find((l) => l.id === "conversa").deny.includes("exec") && LEVELS.find((l) => l.id === "conversa").deny.includes("write"));
  assert.ok(!LEVELS.find((l) => l.id === "consulta").deny.includes("write") && LEVELS.find((l) => l.id === "consulta").deny.includes("exec"));
});

test("parseObjectiveChoice: saneia; \"outro\" exige frase; id estranho cai", () => {
  assert.deepEqual(parseObjectiveChoice({ id: "vendas", label: "Vender", text: "  fechar  pedidos $$ " }), { id: "vendas", label: "Vender", text: "fechar pedidos" });
  assert.equal(parseObjectiveChoice({ id: "outro", label: "Outro", text: "" }), null);
  assert.deepEqual(parseObjectiveChoice({ id: "outro", label: "Outro", text: "cobrar boletos" }), { id: "outro", label: "Outro", text: "cobrar boletos" });
  assert.equal(parseObjectiveChoice({ id: "x; rm", label: "a", text: "" }), null);
  assert.equal(parseObjectiveChoice({ id: "vendas", label: "", text: "" }), null);
  assert.equal(parseObjectiveChoice("vendas"), null);
});

test("parseObjectiveFile: lixo vira nada; nível desconhecido some; savedAt só se for data", () => {
  assert.deepEqual(parseObjectiveFile(null), { objective: null, level: null, savedAt: null });
  assert.deepEqual(parseObjectiveFile({ objective: { id: "agenda", label: "Marcar horários", text: "" }, level: "age", savedAt: "2026-10-17T03:00:00Z" }), { objective: { id: "agenda", label: "Marcar horários", text: "" }, level: "age", savedAt: "2026-10-17T03:00:00Z" });
  assert.deepEqual(parseObjectiveFile({ level: "tudo", savedAt: "ontem" }), { objective: null, level: null, savedAt: null });
});

test("parseMachineSkills: linhas K; a do objetivo vem primeiro e marcada", () => {
  const out = parseMachineSkills("O={}\nK\tzeta\tfaz z\nK\tobjetivo-whatsapp\tObjetivo: vender\nK\talpha\t\nlixo\tx\nK\tnome inválido!\tx\n");
  assert.deepEqual(out.map((s) => [s.name, s.objective]), [["objetivo-whatsapp", true], ["alpha", false], ["zeta", false]]);
  assert.equal(out[0].description, "Objetivo: vender");
});

test("skillMarkdown: frontmatter que o OpenClaw lê + regras do nível em português", () => {
  const md = skillMarkdown({ id: "vendas", label: "Vender", text: "fechar pedidos" }, "consulta", "colima");
  assert.match(md, new RegExp(`^---\\nname: ${OBJECTIVE_SKILL}\\ndescription: "Objetivo deste agente no WhatsApp: Vender. fechar pedidos"\\n`));
  assert.match(md, /## Quanta liberdade você tem: Consulta e organiza/);
  assert.match(md, /Não rode comandos no sistema/);
  assert.match(md, /máquina colima/);
  assert.ok(!md.includes('""'), "aspas duplas da frase viram simples na descrição");
});

test("toolsBySenderFor: o dono conforme o nível; qualquer outro sem as ferramentas que mudam a máquina", () => {
  const age = JSON.parse(toolsBySenderFor("age", "5521999990000"));
  assert.deepEqual(age["e164:+5521999990000"], {});
  assert.deepEqual(age["*"].deny.filter((t) => !t.startsWith("navegador__")), ["write", "edit", "apply_patch", "exec", "process", "cron", "gateway"]);
  assert.ok(age["*"].deny.includes("navegador__*")); // o Navegador do dono nunca vale para "*"
  assert.deepEqual(JSON.parse(toolsBySenderFor("conversa", "1"))["e164:+1"].deny, ["write", "edit", "apply_patch", "exec", "process", "cron", "gateway"]);
  assert.deepEqual(JSON.parse(toolsBySenderFor("consulta", "1"))["e164:+1"].deny, ["exec", "process", "cron", "gateway"]);
});

test("scripts remotos: base64 para o que vem da tela, tmp+mv, workspace do openclaw.json com fallback", () => {
  const set = setObjectiveSh({ level: "age" });
  assert.ok(set.includes(Buffer.from(JSON.stringify({ level: "age" })).toString("base64")) && set.includes('print("OBJ=1")'));
  const save = saveObjectiveSh({ id: "vendas", label: "Vender", text: "" }, "conversa", "colima", "2026-10-17T03:00:00Z");
  assert.ok(save.includes(`skills/${OBJECTIVE_SKILL}/SKILL.md.tmp`) && save.includes("openclaw config set tools.toolsBySender") && save.includes("agents") && save.includes("~/.openclaw/workspace"));
  assert.ok(save.includes("'conversa'"), "o nível vai para a trava");
  assert.ok(resetObjectiveSh().includes(`rm -rf "$W/skills/${OBJECTIVE_SKILL}"`) && resetObjectiveSh().includes("RESET=1"));
  assert.ok(objectiveInfoSh().includes("echo \"O=$(cat") && objectiveInfoSh().includes("printf 'K\\t%s\\t%s\\n'"));
});
