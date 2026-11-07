// Sessão da conta, a parte pura: PKCE, JWT HS256, validação dos pedidos, admissão de device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { admitirDevice, assinarJwt, b64url, deB64url, janelaMinuto, pkceConfere, segredo, sha256Hex, validaDevice, validaPedidoSessao, validaPedidoToken, verificarJwt } from "../dist/sessao-core.js";

const CHAVE = b64url(crypto.getRandomValues(new Uint8Array(32)));
const DEV = { id: "33333333-3333-4333-8333-333333333333", alias: "0123456789ab", name: "Mac da Ana", user: "ana", platform: "darwin", app: "meu-bot-staging", versao: "0.79.0" };

test("base64url ida e volta; segredo tem 43 caracteres sem padding", () => {
  const b = new Uint8Array([0, 1, 250, 251, 255]);
  assert.deepEqual([...deB64url(b64url(b))], [...b]);
  assert.equal(deB64url("a+b"), null);
  assert.match(segredo(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(segredo(), segredo());
});

test("PKCE S256: challenge = base64url(sha256(verifier)); fora do formato não confere", async () => {
  const verifier = segredo(32) + segredo(32);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  assert.equal(await pkceConfere(verifier, challenge), true);
  assert.equal(await pkceConfere(`${verifier}x`, challenge), false);
  assert.equal(await pkceConfere("curto", challenge), false);
  assert.equal((await sha256Hex("abc")).length, 64);
});

test("JWT HS256: assina e verifica; vencido, outra chave ou mexido não passam", async () => {
  const agora = 1_800_000_000;
  const t = await assinarJwt({ sub: "c1", sid: "s1", dev: null, adm: null, iat: agora, exp: agora + 3600 }, CHAVE);
  const c = await verificarJwt(t, CHAVE, agora + 10);
  assert.equal(c.sub, "c1"); assert.equal(c.sid, "s1");
  assert.equal(await verificarJwt(t, CHAVE, agora + 3601), null, "vencido");
  assert.equal(await verificarJwt(t, b64url(crypto.getRandomValues(new Uint8Array(32))), agora), null, "outra chave");
  const [h, p, s] = t.split(".");
  assert.equal(await verificarJwt(`${h}.${p}x.${s}`, CHAVE, agora), null, "payload mexido");
  assert.equal(await verificarJwt("lixo", CHAVE, agora), null);
  await assert.rejects(assinarJwt({ exp: 1 }, "curta"), /32 bytes/);
});

test("validaPedidoSessao: campos do app e o idToken no formato de JWT", () => {
  const ok = validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot-staging", app: "meu-bot-staging", v: "0.79.0" });
  assert.equal(ok.esquema, "meu-bot-staging"); assert.equal(ok.app, "meu-bot-staging"); assert.equal(ok.versao, "0.79.0");
  assert.equal(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "meu-bot" }).app, null, "app é opcional");
  assert.match(validaPedidoSessao({ idToken: "x", state: segredo(), challenge: segredo(), esquema: "meu-bot" }).erro, /idToken/);
  assert.match(validaPedidoSessao({ idToken: "a.b.c", state: "s", challenge: segredo(), esquema: "meu-bot" }).erro, /state/);
  assert.match(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: "c", esquema: "meu-bot" }).erro, /challenge/);
  assert.match(validaPedidoSessao({ idToken: "a.b.c", state: segredo(), challenge: segredo(), esquema: "Meu Bot" }).erro, /esquema/);
  assert.match(validaPedidoSessao("x").erro, /corpo/);
});

test("validaDevice e validaPedidoToken: uuid ou alias, campos livres sem controle, grant code|refresh", () => {
  const d = validaDevice(DEV);
  assert.equal(d.id, DEV.id); assert.equal(d.alias, DEV.alias); assert.equal(d.name, "Mac da Ana");
  assert.equal(validaDevice({ ...DEV, alias: undefined }).alias, null);
  assert.match(validaDevice({ ...DEV, id: "nope" }).erro, /id do device/);
  assert.match(validaDevice({ ...DEV, alias: "zz" }).erro, /alias/);
  assert.match(validaDevice({ ...DEV, app: "outro" }).erro, /app ou versão/);
  assert.equal(validaDevice({ ...DEV, name: "a\u0007b" }).name, "", "nome com caractere de controle vira vazio");
  assert.equal(validaDevice({ ...DEV, platform: "beos" }).platform, "");
  const code = validaPedidoToken({ grant: "code", code: segredo(), verifier: segredo(32) + segredo(32), device: DEV });
  assert.equal(code.grant, "code"); assert.equal(code.device.id, DEV.id);
  assert.match(validaPedidoToken({ grant: "code", code: "x", verifier: segredo(32) + segredo(32), device: DEV }).erro, /code/);
  assert.match(validaPedidoToken({ grant: "code", code: segredo(), verifier: "curto", device: DEV }).erro, /verifier/);
  assert.equal(validaPedidoToken({ grant: "refresh", refresh: segredo() }).grant, "refresh");
  assert.match(validaPedidoToken({ grant: "senha" }).erro, /grant/);
});

test("admitirDevice: conhecido mantém o status; novo cabe até o limite", () => {
  assert.equal(admitirDevice(null, 0, 1), "active");
  assert.equal(admitirDevice(null, 1, 1), "pending");
  assert.equal(admitirDevice(null, 1, 2), "active");
  assert.equal(admitirDevice({ status: "pending" }, 0, 5), "pending", "pendente continua até o admin liberar");
  assert.equal(admitirDevice({ status: "active" }, 9, 1), "active", "ativo não vira pendente ao reaparecer");
});

test("janelaMinuto: minuto corrente em ISO", () => {
  assert.equal(janelaMinuto(Date.parse("2026-11-06T12:34:56Z")), "2026-11-06T12:34");
});
