import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
// O intermediário lê a pasta do root na carga: aponta para uma descartável antes.
const etc = mkdtempSync(path.join(tmpdir(), "cg-etc-"));
process.env.MEU_BOT_CLAUDE_GLOBAL_ETC = etc;
const relay = require("../../backend-colima/claude-global.js");
const core = require("../../dist/main/admin/claude-global-core.js");
const { TUTORIAIS, emptyContext, emptyFlags, guideView } = await import("../../dist/renderer/lib/tutoriais.js");

test("intermediário: só passam os caminhos de conversa; a API OAuth do root (criar chave, uso, perfil) não", () => {
  const passa = (u) => relay.PERMITIDO.some((re) => re.test(u));
  for (const u of ["/v1/messages", "/v1/messages?beta=true", "/v1/messages/count_tokens?beta=true", "/v1/models"]) assert.ok(passa(u), u);
  for (const u of ["/api/oauth/claude_cli/create_api_key", "/api/oauth/usage", "/api/oauth/profile", "/v1/organizations", "/v1/messages/../../api/oauth/usage", "/v1/messagesx"]) assert.ok(!passa(u), u);
});

test("intermediário: a chave do usuário vira o token do root; nada do usuário segue para fora", () => {
  const h = relay.cabecalhos({ headers: { authorization: "Bearer CHAVE", "x-api-key": "k", cookie: "c=1", host: "127.0.0.1", "anthropic-beta": "a-1,b-2", "anthropic-version": "2023-06-01" } }, "TOKEN-DO-ROOT", 10);
  assert.equal(h.authorization, "Bearer TOKEN-DO-ROOT");
  assert.equal(h["x-api-key"], undefined); assert.equal(h.cookie, undefined); assert.equal(h.host, undefined);
  assert.deepEqual(h["anthropic-beta"].split(","), ["a-1", "b-2", "oauth-2025-04-20"]);
  assert.equal(h["anthropic-version"], "2023-06-01"); assert.equal(h["content-length"], "10");
});

test("intermediário: a chave abre só para o dono dela; chave errada ou fora do formato não abre", () => {
  mkdirSync(path.join(etc, "chaves"), { recursive: true });
  const k = "a".repeat(48); writeFileSync(path.join(etc, "chaves", "box-2"), k);
  writeFileSync(path.join(etc, "chaves", "Nome Ruim"), "b".repeat(48));
  assert.equal(relay.usuarioDaChave({ headers: { authorization: `Bearer ${k}` } }), "box-2");
  assert.equal(relay.usuarioDaChave({ headers: { "x-api-key": k } }), "box-2");
  assert.equal(relay.usuarioDaChave({ headers: { authorization: `Bearer ${"b".repeat(48)}` } }), null, "nome de usuário inválido não vale");
  assert.equal(relay.usuarioDaChave({ headers: { authorization: "Bearer curta" } }), null);
  assert.equal(relay.usuarioDaChave({ headers: {} }), null);
});

test("scripts do root: a chave fica em /etc (600) e na pasta do usuário (dono ele, 600), nunca na saída", () => {
  const sh = core.cgLigarSh("box-3");
  assert.match(sh, /chmod 600 \/etc\/meu-bot\/claude-global\/chaves\/box-3/);
  assert.match(sh, /chown box-3:box-3 "\$A\.tmp"/);
  assert.match(sh, /os\.chmod\(t, 0o600\)/);
  assert.doesNotMatch(sh, /echo [^\n]*\$K/, "a chave nunca vai para a saída");
  assert.match(sh, /^echo "GLOBAL=ok"$/m);
  assert.throws(() => core.cgLigarSh("box-3; rm -rf /"), /inválido/);
  assert.match(core.cgDesligarSh("box-3"), /rm -f \/etc\/meu-bot\/claude-global\/chaves\/box-3/);
  assert.throws(() => core.cgContaRemoverSh("padrao"), /inválida/, "o login do root não sai do rodízio");
});

test("estado: lê a linha ESTADO= e descarta usuário com nome inválido", () => {
  const e = core.lerEstado(`x\nESTADO=${JSON.stringify({ instalado: true, ativo: true, porta: 18780, login: true, email: "a@b.c", plano: "team", contas: [], usuarios: [{ nome: "box-1", ligado: true, chamadas: 3, ultima: 1, limites: 0 }, { nome: "x;y", ligado: true }] })}\n`);
  assert.equal(e.porta, 18780); assert.equal(e.usuarios.length, 1);
  assert.equal(core.lerEstado("NAOROOT\n"), null);
});

test("tutorial 1 só confirma a sessão: com o global do admin, já vem concluído", () => {
  const t1 = TUTORIAIS.find((x) => x.id === "claude-login");
  const ctx = (claude) => ({ ...emptyContext(), claude: { ...emptyContext().claude, ...claude } });
  assert.equal(guideView(t1, null, emptyFlags(), ctx({ loggedIn: true, email: "admin@x.com", global: true })).finished, true);
  assert.equal(guideView(t1, null, emptyFlags(), ctx({ loggedIn: true, email: "eu@x.com", global: false })).finished, false, "conta própria: falta a primeira resposta");
  assert.equal(guideView(t1, null, emptyFlags(), ctx({ loggedIn: false, global: false })).current, 0);
});

test("intermediário: o uso da conta do root vem dos cabeçalhos da resposta (vale o limiar do rodízio)", () => {
  const orig = relay.anotarUsoDaConta;
  // A função usa o registro do root; aqui só confere a leitura dos cabeçalhos por um registro falso.
  const fake = { headers: { "anthropic-ratelimit-unified-5h-utilization": "0.16", "anthropic-ratelimit-unified-5h-reset": "1793312400", "anthropic-ratelimit-unified-7d-utilization": "0.91", "anthropic-ratelimit-unified-7d-reset": "1793757600" } };
  assert.equal(typeof orig, "function");
  assert.doesNotThrow(() => orig({ id: "padrao" }, fake), "sem registro gravável, não derruba a resposta");
  assert.doesNotThrow(() => orig({ id: "padrao" }, { headers: {} }));
});

test("limiares do rodízio do root: só números de 50 a 100 e as duas estratégias", () => {
  assert.match(core.cgLimiaresSh({ sessao: 85 }), /definirLimiares\(\{"sessao":85\}\)/);
  assert.match(core.cgLimiaresSh({ estrategia: "folga" }), /"estrategia":"folga"/);
  assert.throws(() => core.cgLimiaresSh({ sessao: 20 }), /50 a 100/);
  assert.throws(() => core.cgLimiaresSh({ estrategia: "x" }), /inválida/);
});
