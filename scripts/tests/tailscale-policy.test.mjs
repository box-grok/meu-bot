import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { applySshAction, stripHujson, tokenize } = createRequire(import.meta.url)("../../dist/main/tailscale-policy.js");

// Política real do usuário (15 out 2026), com os comentários de exemplo do Tailscale.
const REAL = `// Example/default ACLs for unrestricted connections.
{
    // Declare static groups of users. Use autogroups for all users or users with a specific role.
    // "groups": {
    //   "group:example": ["alice@example.com", "bob@example.com"],
    // },

    // Define grants that govern access for users, groups, autogroups, tags,
    // Tailscale IP addresses, and subnet ranges.
    "grants": [
        {
            "src": ["*"],
            "dst": ["*"],
            "ip":  ["*"],
        },

        // Allow users in "group:example" to access "tag:example", but only from
        // devices that are running macOS and have enabled Tailscale client auto-updating.
        // {"src": ["group:example"], "dst": ["tag:example"], "ip": ["*"], "srcPosture":["posture:autoUpdateMac"]},
    ],

    // Define users and devices that can use Tailscale SSH.
    "ssh": [
        // Allow all users to SSH into their own devices in check mode.
        // Comment this section out if you want to define specific restrictions.
        {
            "action": "check",
            "src":    ["autogroup:member"],
            "dst":    ["autogroup:self"],
            "users":  ["autogroup:nonroot", "root"],
        },
    ],

    // Test access rules every time they're saved.
    // "tests": [
    //   {
    //       "src": "alice@example.com",
    //       "accept": ["tag:example"],
    //       "deny": ["100.101.102.103:443"],
    //   },
    // ],
}
`;

const parsed = (t) => JSON.parse(stripHujson(t));

test("política real: check → accept muda só esse valor; comentários e resto byte a byte iguais", () => {
  const r = applySshAction(REAL, "accept");
  assert.equal(r.changed, true);
  assert.equal(r.text, REAL.replace('"action": "check"', '"action": "accept"'));
  assert.equal(r.stats.changed, 1);
  assert.equal(parsed(r.text).ssh[0].action, "accept");
  assert.match(r.summary, /regra 1: check → accept/);
  // idempotente, e o caminho inverso restaura o original
  const again = applySshAction(r.text, "accept");
  assert.equal(again.changed, false);
  assert.equal(again.text, r.text);
  assert.equal(applySshAction(r.text, "check").text, REAL);
});

test("sem bloco ssh: insere a regra antes do } final, com e sem vírgula final, e raiz vazia", () => {
  const semSsh = REAL.replace(/\n    \/\/ Define users and devices[\s\S]*?\n    \],\n/, "\n");
  assert.equal(semSsh.includes('"ssh"'), false);
  const r = applySshAction(semSsh, "accept");
  assert.equal(r.changed, true);
  assert.equal(r.stats.inserted, true);
  const j = parsed(r.text);
  assert.equal(j.ssh[0].action, "accept");
  assert.deepEqual(j.ssh[0].users, ["autogroup:nonroot", "root"]);
  assert.deepEqual(j.grants[0].ip, ["*"]);
  assert.ok(r.text.includes("\n    \"ssh\": [\n"), "usa a indentação do arquivo");
  const semVirgula = `{\n  "grants": [{"src": ["*"], "dst": ["*"], "ip": ["*"]}]\n}\n`;
  const r2 = applySshAction(semVirgula, "accept");
  assert.equal(parsed(r2.text).ssh[0].action, "accept");
  assert.equal(parsed(r2.text).grants.length, 1);
  const vazia = applySshAction("{}", "accept");
  assert.equal(parsed(vazia.text).ssh[0].action, "accept");
  const listaVazia = applySshAction('{ "ssh": [] }', "accept");
  assert.equal(parsed(listaVazia.text).ssh[0].action, "accept");
});

test("várias regras: só as check mudam; checkPeriod sai sem quebrar as vírgulas", () => {
  const t = `{
  "ssh": [
    { "action": "check", "src": ["a"], "dst": ["b"], "users": ["root"], "checkPeriod": "12h" },
    { "action": "accept", "src": ["c"], "dst": ["d"], "users": ["root"] },
    {
      "action": "check",
      "checkPeriod": "5m",
      "src": ["e"], "dst": ["f"], "users": ["root"],
    },
    { "checkPeriod": "1h", "action": "check", "src": ["g"], "dst": ["h"], "users": ["root"] },
  ],
}`;
  const r = applySshAction(t, "accept");
  assert.equal(r.stats.rules, 4);
  assert.equal(r.stats.changed, 3);
  assert.equal(r.stats.alreadyTarget, 1);
  const j = parsed(r.text);
  assert.deepEqual(j.ssh.map((x) => x.action), ["accept", "accept", "accept", "accept"]);
  assert.ok(j.ssh.every((x) => !("checkPeriod" in x)), "checkPeriod removido");
  assert.deepEqual(j.ssh.map((x) => x.src[0]), ["a", "c", "e", "g"]);
  assert.equal(r.text.includes("checkPeriod"), false);
});

test("iscas não são tocadas: comentário, acls, grants com app, string com //, sshTests", () => {
  const t = `{
  // set "action": "check" if you want check mode
  "acls": [ { "action": "accept", "src": ["*"], "dst": ["*:*"] } ],
  "grants": [ { "src": ["*"], "dst": ["*"], "app": { "tailscale.com/cap/x": [ { "action": "check", "url": "https://x//y" } ] } } ],
  "sshTests": [ { "src": "a@b", "dst": "c", "accept": ["root"], "check": ["x"] } ],
  "ssh": [ { "action": "check", /* modo check */ "src": ["autogroup:member"], "dst": ["autogroup:self"], "users": ["root"] } ],
}`;
  const r = applySshAction(t, "accept");
  assert.equal(r.stats.changed, 1);
  const outsideBefore = t.replace(/"ssh": \[.*?\]/s, "").split('"check"').length;
  const outsideAfter = r.text.replace(/"ssh": \[.*?\]/s, "").split('"check"').length;
  assert.equal(outsideAfter, outsideBefore);
  const j = parsed(r.text);
  assert.equal(j.ssh[0].action, "accept");
  assert.equal(j.acls[0].action, "accept");
  assert.equal(j.grants[0].app["tailscale.com/cap/x"][0].action, "check");
  assert.ok(r.text.includes("/* modo check */"));
  assert.ok(r.text.includes('// set "action": "check"'));
});

test("espaços e quebras entre chave, dois-pontos e valor; ssh que não é lista dá erro", () => {
  const t = `{ "ssh": [ { "action"\n  :\n  "check" , "src": ["a"], "dst": ["b"], "users": ["root"] } ] }`;
  const r = applySshAction(t, "accept");
  assert.equal(parsed(r.text).ssh[0].action, "accept");
  assert.throws(() => applySshAction('{ "ssh": "nope" }', "accept"), /não é uma lista/);
  assert.throws(() => applySshAction("", "accept"), /vazia/);
  assert.throws(() => applySshAction("[1,2]", "accept"), /objeto raiz/);
});

test("tokenize ignora comentários e respeita escapes dentro de strings", () => {
  const toks = tokenize(`{ "a": "x\\"y // não é comentário", /* c */ "b": 1 } // fim`);
  assert.deepEqual(toks.map((t) => t.raw), ["{", "a", ":", 'x\\"y // não é comentário', ",", "b", ":", "1", "}"]);
});
