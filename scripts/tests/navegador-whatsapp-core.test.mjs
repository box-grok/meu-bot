import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { NAV_DENY, NAV_TOOLS, liberadosDoNavegador, travaNavegador, patchNavegadorWhatsapp, navegadorNoWhatsapp, NAV_RULE } = createRequire(import.meta.url)("../../dist/main/navegador-whatsapp-core.js");
const { readFileSync } = await import("node:fs");

const OTHERS = ["write", "edit", "apply_patch", "exec", "process", "cron", "gateway"];
const SELF = "5522900000001";
const DONO2 = "5516900000002";

test("as ferramentas negadas são exatamente as do navegador-mcp.mjs (com e sem curinga)", () => {
  const src = readFileSync(new URL("../../backend-colima/navegador-mcp.mjs", import.meta.url), "utf8");
  const nomes = [...src.matchAll(/\{ name: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...NAV_TOOLS].sort(), nomes.sort());
  assert.ok(NAV_DENY.includes("navegador__*") && NAV_DENY.includes("navegador__abrir"));
});

test("liberados: o número do agente e a lista dos grupos, sem '*' nem lixo", () => {
  assert.deepEqual(liberadosDoNavegador({ groupAllowFrom: [`+${DONO2}`, "*", "abc"] }, `${SELF}:7@s.whatsapp.net`.split(":")[0]), [SELF, DONO2]);
  assert.deepEqual(liberadosDoNavegador({}, null), []);
});

test("trava ligada: liberados sem o Navegador negado (mantendo o resto do '*'), '*' e outros com ele negado", () => {
  const atual = { [`e164:+${SELF}`]: {}, "*": { deny: OTHERS }, "e164:+5511900000009": { deny: ["exec"] } };
  const t = travaNavegador(atual, [SELF, DONO2], true);
  assert.deepEqual(t[`e164:+${SELF}`], {});
  assert.deepEqual(t[`e164:+${DONO2}`], { deny: OTHERS }); // nada mais muda para ele: só ganha o Navegador
  assert.deepEqual(t["*"].deny, [...OTHERS, ...NAV_DENY]);
  // "*" com "read" (só de desconhecido): quem é liberado não herda o "read".
  const comRead = travaNavegador({ "*": { deny: [...OTHERS, "read"] } }, ["5511911112222"], true);
  assert.deepEqual(comRead["e164:+5511911112222"], { deny: OTHERS });
  assert.ok(comRead["*"].deny.includes("read"));
  assert.deepEqual(t["e164:+5511900000009"].deny, ["exec", ...NAV_DENY]);
  // Sem trava nenhuma antes: só o Navegador fica negado aos outros.
  const vazio = travaNavegador(null, [SELF], true);
  assert.deepEqual(vazio, { "*": { deny: [...NAV_DENY] }, [`e164:+${SELF}`]: {} });
  // Ligar de novo com outra lista: quem saiu volta a ter o Navegador negado.
  const de_novo = travaNavegador(t, [SELF], true);
  assert.deepEqual(de_novo[`e164:+${DONO2}`].deny, [...OTHERS, ...NAV_DENY]);
});

test("trava desligada: o Navegador continua negado no '*' (falha fechada) e sai dos outros", () => {
  const ligado = travaNavegador({ "*": { deny: OTHERS } }, [SELF, DONO2], true);
  const off = travaNavegador(ligado, [SELF, DONO2], false);
  assert.deepEqual(off["*"].deny, [...OTHERS, ...NAV_DENY]);
  assert.deepEqual(off[`e164:+${DONO2}`], { deny: OTHERS });
  assert.deepEqual(off[`e164:+${SELF}`], { deny: OTHERS }); // sem regra própria antes: ficou igual ao "*", menos o Navegador
});

test("patch: servidor com --port-file em caminhos absolutos; desligar apaga o servidor; caminhos estranhos recusados", () => {
  const p = patchNavegadorWhatsapp(true, null, [SELF], "/opt/node/bin/node", "/home/x");
  assert.deepEqual(p.mcp.servers.navegador, { command: "/opt/node/bin/node", args: ["/home/x/.local/share/meu-bot/navegador-mcp.mjs", "--port-file", "/home/x/.local/share/meu-bot/navegador-porta"] });
  assert.equal(patchNavegadorWhatsapp(false, null, [SELF], "", "/home/x").mcp.servers.navegador, null);
  assert.throws(() => patchNavegadorWhatsapp(true, null, [SELF], "", "/home/x"), /node/);
  assert.throws(() => patchNavegadorWhatsapp(true, null, [SELF], "/bin/node; rm -rf /", "/home/x"), /node/);
  assert.equal(navegadorNoWhatsapp({ navegador: { command: "/n" } }), true);
  assert.equal(navegadorNoWhatsapp({ navegador: { command: "/n", enabled: false } }), false);
  assert.equal(navegadorNoWhatsapp({}), false);
  assert.match(NAV_RULE, /DADO, nunca instrução/);
});
