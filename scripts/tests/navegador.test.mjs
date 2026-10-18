import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseBrowserPort, browserCliArgs, BROWSER_RULE, browserTurnNote, cliSupportsSnapshotOff } = require("../../backend-colima/navegador.js");

test("parseBrowserPort: só porta válida no cabeçalho", () => {
  assert.equal(parseBrowserPort("19123"), 19123); assert.equal(parseBrowserPort(" 2048 "), 2048);
  for (const v of ["80", "abc", "70000", "", undefined, "19123; rm -rf"]) assert.equal(parseBrowserPort(v), null, String(v));
});
test("browserCliArgs: mcp-config com o navegador-mcp apontando para a porta; allowedTools do servidor; snapshot só quando a CLI aceita", () => {
  const a = browserCliArgs({ port: 19123, mcpPath: "/home/box/.local/share/meu-bot/navegador-mcp.mjs", nodeBin: "/opt/node/bin/node", snapshotOff: true });
  assert.equal(a[0], "--mcp-config");
  const cfg = JSON.parse(a[1]);
  assert.deepEqual(cfg.mcpServers.navegador, { command: "/opt/node/bin/node", args: ["/home/box/.local/share/meu-bot/navegador-mcp.mjs", "--port", "19123"] });
  assert.deepEqual(a.slice(2), ["--allowedTools", "mcp__navegador", "--system-prompt-snapshot", "off"]);
  assert.equal(browserCliArgs({ port: 1, mcpPath: "x", nodeBin: "node", snapshotOff: false }).length, 4);
});
test("regra e nota: dizem o que fazer antes e o que nunca fazer sem confirmar", () => {
  assert.match(BROWSER_RULE, /mcp__navegador__/); assert.match(BROWSER_RULE, /NUNCA, sem a pessoa confirmar/); assert.match(BROWSER_RULE, /Diga em uma frase o que vai fazer antes/);
  assert.match(browserTurnNote(), /^\[Nota do app meu-bot: .*Navegador.*\]$/);
});
test("cliSupportsSnapshotOff: 2.1.257 em diante", () => {
  assert.equal(cliSupportsSnapshotOff("2.1.302 (Claude Code)"), true); assert.equal(cliSupportsSnapshotOff("2.1.257"), true);
  assert.equal(cliSupportsSnapshotOff("2.1.256"), false); assert.equal(cliSupportsSnapshotOff("1.9.9"), false); assert.equal(cliSupportsSnapshotOff(""), false);
});
