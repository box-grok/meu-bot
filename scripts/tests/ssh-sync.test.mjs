import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parseSshConfig, planSshSync, renderSshAppend, normalizeInclude, identityFiles } = createRequire(import.meta.url)("../../dist/main/ssh-sync.js");

const HOME = "/Users/alguem";
const template = `# comentário
Include ~/.colima/ssh_config

Host grokbot-1
    HostName 100.69.163.93
    User box
    IdentityFile ~/.ssh/id_ed25519

Host agente-box
    HostName 187.127.41.175
    User box
    IdentityFile ~/.ssh/id_ed25519
`;

test("parseSshConfig separa Include e blocos Host com o texto original", () => {
  const p = parseSshConfig(template);
  assert.deepEqual(p.includes, ["~/.colima/ssh_config"]);
  assert.deepEqual(p.blocks.map((b) => b.aliases), [["grokbot-1"], ["agente-box"]]);
  assert.equal(p.blocks[0].text, "Host grokbot-1\n    HostName 100.69.163.93\n    User box\n    IdentityFile ~/.ssh/id_ed25519");
});

test("arquivo vazio: entra tudo, sem hosts mantidos", () => {
  const plan = planSshSync(template, "", HOME);
  assert.deepEqual(plan.includesToAdd, ["~/.colima/ssh_config"]);
  assert.deepEqual(plan.hostsToAdd.map((b) => b.aliases[0]), ["grokbot-1", "agente-box"]);
  assert.deepEqual(plan.kept, []);
  assert.deepEqual(plan.onlyLocal, []);
  const out = renderSshAppend(plan, "2026-10-14 10:00:00");
  assert.match(out, /^\n# meu-bot: máquinas sincronizadas em 2026-10-14 10:00:00\nInclude ~\/.colima\/ssh_config\n\nHost grokbot-1\n/);
  assert.ok(out.endsWith("IdentityFile ~/.ssh/id_ed25519\n"));
});

test("host existente é mantido intacto; Include com caminho absoluto equivalente não repete", () => {
  const current = `Include ${HOME}/.colima/ssh_config\n\nHost grokbot-1\n    HostName 1.2.3.4\n    User outro\n\nHost rota\n    HostName 5.6.7.8\n\nHost *\n    ServerAliveInterval 30\n`;
  const plan = planSshSync(template, current, HOME);
  assert.deepEqual(plan.includesToAdd, []);
  assert.deepEqual(plan.hostsToAdd.map((b) => b.aliases[0]), ["agente-box"]);
  assert.deepEqual(plan.kept, ["grokbot-1"]);
  assert.deepEqual(plan.onlyLocal, ["rota"]);
});

test("nada a fazer rende texto vazio", () => {
  const plan = planSshSync(template, template, HOME);
  assert.equal(renderSshAppend(plan, "x"), "");
  assert.deepEqual(plan.kept, ["grokbot-1", "agente-box"]);
});

test("normalizeInclude: ~, relativo a ~/.ssh e absoluto", () => {
  assert.equal(normalizeInclude("~/.colima/ssh_config", HOME), `${HOME}/.colima/ssh_config`);
  assert.equal(normalizeInclude("config.d/*", HOME), `${HOME}/.ssh/config.d/*`);
  assert.equal(normalizeInclude("/etc/ssh/x", HOME), "/etc/ssh/x");
});

test("identityFiles lista as chaves do modelo sem repetir, com ~ expandido", () => {
  assert.deepEqual(identityFiles(template, HOME), [`${HOME}/.ssh/id_ed25519`]);
});
