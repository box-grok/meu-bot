// Conta meu-bot, a parte pura: login pendente (state + PKCE), URL da página, parse do que a API devolve, renovação.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const { URLS, LOGIN_PENDENTE_MS, deveRenovar, erroDaApi, novoLogin, parseContaInfo, parseLoginPendente, parseSessao, retornoConfere, sessaoAcabou, urlDeLogin } = createRequire(import.meta.url)("../../dist/main/conta/conta-core.js");

const AGORA = Date.parse("2026-11-07T12:00:00Z");
const UUID = "077a1dd5-1fd3-45bc-9eef-506a7fd71201";
const conta = () => ({ id: UUID, email: "Ana@Exemplo.com", nome: "Ana", foto: "https://foto/x.png", admin: null, licenca: { plan: "pro", status: "active", interval: "month", memberSince: "2026-01-01T00:00:00.000Z", trialEnd: null, expiresAt: null, deviceLimit: 2, produtos: [], pagamento: null, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" }, devices: [{ id: "33333333-3333-4333-8333-333333333333", alias: "0123456789ab", name: "Mac", user: "ana", platform: "darwin", status: "active", requestedAt: null, firstSeen: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-02T00:00:00.000Z", apps: { "meu-bot": { version: "0.79.0", lastSeen: "2026-01-02T00:00:00.000Z" } }, este: true }, { id: "lixo" }], maquinas: [{ id: UUID, apelido: null, vinculadaPor: "app" }, { id: "x" }], pedidos: 2 });
const sessao = () => ({ refresh: "K-fcXwpUMEabK-fcXwpUMEabK-fcXwpUMEabK-fcXwp", acesso: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjMSJ9.abc", expiraEm: "2026-11-07T13:00:00.000Z", conta: conta() });

test("novoLogin: state e verifier aleatórios, challenge = base64url(sha256(verifier)); parseLoginPendente aceita até 10 min", () => {
  const p = novoLogin(AGORA);
  assert.match(p.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(p.challenge, createHash("sha256").update(p.verifier).digest("base64url"));
  assert.notEqual(novoLogin().state, p.state);
  assert.deepEqual(parseLoginPendente(p, AGORA + 60_000), p);
  assert.equal(parseLoginPendente(p, AGORA + LOGIN_PENDENTE_MS + 1), null, "vencido");
  assert.equal(parseLoginPendente({ ...p, state: "curto" }, AGORA), null);
  assert.equal(parseLoginPendente(null, AGORA), null);
  assert.equal(retornoConfere(p, p.state), true);
  assert.equal(retornoConfere(p, "outro"), false);
  assert.equal(retornoConfere(null, p.state), false);
});

test("urlDeLogin: página do canal com esquema, state, challenge, app e versão na query", () => {
  const u = new URL(urlDeLogin(URLS.staging.auth, { esquema: "meu-bot-staging", state: "s", challenge: "c", app: "meu-bot-staging", versao: "0.79.0" }));
  assert.equal(u.origin, "https://auth-staging.agentesgrok.com"); assert.equal(u.pathname, "/entrar");
  assert.equal(u.searchParams.get("esquema"), "meu-bot-staging"); assert.equal(u.searchParams.get("v"), "0.79.0"); assert.equal(u.searchParams.get("challenge"), "c");
  assert.equal(URLS.estavel.api, "https://conta.agentesgrok.com");
});

test("parseContaInfo: e-mail em minúsculas, devices e máquinas fora do formato caem, licença pelo parse da máquina", () => {
  const c = parseContaInfo(conta(), AGORA);
  assert.equal(c.email, "ana@exemplo.com"); assert.equal(c.licenca.plan, "pro"); assert.equal(c.pedidos, 2);
  assert.equal(c.devices.length, 1); assert.equal(c.devices[0].este, true); assert.equal(c.devices[0].apps["meu-bot"].version, "0.79.0");
  assert.equal(c.maquinas.length, 1);
  assert.equal(parseContaInfo({ ...conta(), foto: "http://inseguro" }).foto, null);
  assert.equal(parseContaInfo({ ...conta(), id: "x" }), null);
  assert.equal(parseContaInfo({ ...conta(), email: "semarroba" }), null);
  assert.equal(parseContaInfo({ ...conta(), licenca: "lixo" }).licenca.plan, "free", "licença ilegível vira a default");
});

test("parseSessao: a resposta do /token e o conta.bin; refresh, acesso (JWT) e expiraEm obrigatórios", () => {
  const s = parseSessao(sessao(), AGORA);
  assert.equal(s.conta.email, "ana@exemplo.com"); assert.equal(s.expiraEm, "2026-11-07T13:00:00.000Z");
  assert.equal(parseSessao({ ...sessao(), acesso: "nao-e-jwt" }), null);
  assert.equal(parseSessao({ ...sessao(), expiraEm: "amanhã" }), null);
  assert.equal(parseSessao({ ...sessao(), conta: null }), null);
  assert.equal(parseSessao("x"), null);
});

test("deveRenovar: a menos de 5 min do fim, ou data ilegível; erroDaApi usa o `erro` do corpo; 401 = sessão acabou", () => {
  assert.equal(deveRenovar("2026-11-07T13:00:00.000Z", AGORA), false);
  assert.equal(deveRenovar("2026-11-07T12:04:00.000Z", AGORA), true);
  assert.equal(deveRenovar("lixo", AGORA), true);
  assert.equal(erroDaApi(401, { erro: "sessão vencida; entre de novo" }), "sessão vencida; entre de novo");
  assert.equal(erroDaApi(429, null), "muitas tentativas; espere um minuto");
  assert.match(erroDaApi(502, {}), /502/);
  assert.equal(sessaoAcabou(401), true); assert.equal(sessaoAcabou(500), false);
});
