import { test } from "node:test";
import assert from "node:assert/strict";
import { isShellLang, shellBlockToPaste, xtermTheme } from "../../dist/renderer/lib/terminal.js";

test("rodar no terminal: só linguagens de shell; colado com bracketed paste e sem Enter final", () => {
  assert.ok(isShellLang("bash") && isShellLang("Shell") && isShellLang("console"));
  assert.ok(!isShellLang("python") && !isShellLang(""));
  assert.equal(shellBlockToPaste("df -h\n", "bash"), "\u001b[200~df -h\u001b[201~");
  assert.equal(shellBlockToPaste("cd /tmp\nls -la\n\n", "sh"), "\u001b[200~cd /tmp\nls -la\u001b[201~");
  // console: tira o prompt e descarta a saída
  assert.equal(shellBlockToPaste("$ uname -a\nLinux x\n$ uptime\n 10:00 up", "console"), "\u001b[200~uname -a\nuptime\u001b[201~");
  // bloco bash com prompt também é limpo; sem prompt fica como está
  assert.equal(shellBlockToPaste("$ echo oi", "bash"), "\u001b[200~echo oi\u001b[201~");
  assert.equal(shellBlockToPaste("echo '$ not prompt'", "bash"), "\u001b[200~echo '$ not prompt'\u001b[201~");
});

test("tema do xterm segue o app", () => {
  const d = xtermTheme({ bg: "#111317", fg: "#e8eaed", muted: "#9aa3ad", accent: "#6c9cff", dark: true });
  assert.equal(d.background, "#111317"); assert.equal(d.cursor, "#6c9cff"); assert.ok(d.brightWhite);
  assert.equal(xtermTheme({ bg: "#fff", fg: "#000", muted: "#666", accent: "#2f6fed", dark: false }).background, "#fff");
});
