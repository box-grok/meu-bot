// Onde a prova de saúde procura o meu-bot-staging deste Mac (scripts/release-saude.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleDoStaging } from "../release-saude.mjs";

test("bundleDoStaging: ~/Applications primeiro, /Applications na falta, ~/Applications se não há nenhum", () => {
  const t = mkdtempSync(join(tmpdir(), "saude-"));
  try {
    const casa = join(t, "casa", "Applications"), sistema = join(t, "Applications");
    const raizes = [casa, sistema];
    assert.equal(bundleDoStaging(t, raizes), join(casa, "meu-bot-staging.app"));
    mkdirSync(join(sistema, "meu-bot-staging.app"), { recursive: true });
    assert.equal(bundleDoStaging(t, raizes), join(sistema, "meu-bot-staging.app"));
    mkdirSync(join(casa, "meu-bot-staging.app"), { recursive: true });
    assert.equal(bundleDoStaging(t, raizes), join(casa, "meu-bot-staging.app"));
  } finally { rmSync(t, { recursive: true, force: true }); }
});
