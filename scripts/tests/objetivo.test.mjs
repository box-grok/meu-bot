import assert from "node:assert/strict";
import { test } from "node:test";
import { LEVEL_OPTIONS, OBJECTIVE_OPTIONS } from "../../dist/renderer/lib/objetivo.js";

test("objetivo do WhatsApp: só \"outro\" exige frase; três níveis com um padrão", () => {
  assert.equal(new Set(OBJECTIVE_OPTIONS.map((o) => o.id)).size, OBJECTIVE_OPTIONS.length);
  assert.equal(OBJECTIVE_OPTIONS.filter((o) => o.needsText).map((o) => o.id).join(), "outro");
  assert.deepEqual(LEVEL_OPTIONS.map((l) => l.id), ["conversa", "consulta", "age"]);
  assert.equal(LEVEL_OPTIONS.filter((l) => l.isDefault).length, 1);
});
