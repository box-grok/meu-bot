import { test } from "node:test";
import assert from "node:assert/strict";
import { hostAccent } from "../../dist/renderer/lib/host-color.js";

test("hostAccent é determinística, válida e distinta", () => {
  const re = /^hsl\(\d{1,3} 65% 48%\)$/;
  assert.equal(hostAccent("colima"), hostAccent("colima"));
  assert.match(hostAccent("colima"), re);
  assert.equal(hostAccent("local"), "hsl(210 65% 48%)");
  const set = new Set(["colima", "grokbot-1", "agente-box", "local"].map(hostAccent));
  assert.equal(set.size, 4);
});
