import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parseAccelerator } = createRequire(import.meta.url)("../../dist/main/app/accelerator.js");

test("parseAccelerator normaliza e valida", () => {
  assert.equal(parseAccelerator("cmd+shift+space"), "CommandOrControl+Shift+Space");
  assert.equal(parseAccelerator("Ctrl+Alt+k"), "Control+Alt+K");
  assert.equal(parseAccelerator("Space"), null);
  assert.equal(parseAccelerator("Cmd+Escape"), null);
  assert.equal(parseAccelerator("Cmd+Shift"), null);
  assert.equal(parseAccelerator("CommandOrControl+F12"), "CommandOrControl+F12");
});
