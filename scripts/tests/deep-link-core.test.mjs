// Deep link da conta: só a URL do esquema deste produto, só a ação "auth", com código e state no formato esperado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { parseRetornoAuth, urlDeArgv, ehUrlDoEsquema } = createRequire(import.meta.url)("../../dist/main/conta/deep-link-core.js");
const CODE = "a".repeat(43), STATE = "b".repeat(43);

test("parseRetornoAuth: URL boa devolve code e state; host ou caminho servem", () => {
  for (const u of [`meu-bot://auth?code=${CODE}&state=${STATE}`, `meu-bot:///auth?code=${CODE}&state=${STATE}`, `MEU-BOT://AUTH?code=${CODE}&state=${STATE}`]) {
    const r = parseRetornoAuth(u, "meu-bot");
    assert.equal(r?.ok, true, u); assert.deepEqual(r.retorno, { code: CODE, state: STATE });
  }
});

test("parseRetornoAuth: outro esquema é null (não é nosso); staging e estável não se misturam", () => {
  assert.equal(parseRetornoAuth(`meu-bot-staging://auth?code=${CODE}&state=${STATE}`, "meu-bot"), null);
  assert.equal(parseRetornoAuth(`meu-bot://auth?code=${CODE}&state=${STATE}`, "meu-bot-staging"), null);
  assert.equal(parseRetornoAuth("https://auth.agentesgrok.com/entrar", "meu-bot"), null);
  assert.equal(parseRetornoAuth("", "meu-bot"), null);
});

test("parseRetornoAuth: nossa URL mas inútil: ação errada, sem código, código fora do formato, erro da página", () => {
  const erro = (u) => { const r = parseRetornoAuth(u, "meu-bot"); assert.equal(r?.ok, false, u); return r.erro; };
  assert.match(erro("meu-bot://abrir?x=1"), /ação desconhecida/);
  assert.match(erro("meu-bot://auth"), /sem código/);
  assert.match(erro(`meu-bot://auth?code=${CODE}`), /sem código ou sem state/);
  assert.match(erro(`meu-bot://auth?code=curto&state=${STATE}`), /sem código/);
  assert.match(erro(`meu-bot://auth?code=${CODE}+x&state=${STATE}`), /sem código/, "só base64url");
  assert.equal(erro("meu-bot://auth?erro=a%20pessoa%20cancelou"), "a pessoa cancelou");
  assert.match(erro("meu-bot://auth?erro=%01"), /devolveu um erro/, "erro com caractere de controle vira genérico");
  assert.match(erro(`meu-bot://auth?erro=${"x".repeat(300)}`), /devolveu um erro/, "erro longo demais vira genérico");
});

test("urlDeArgv e ehUrlDoEsquema: acha a URL entre os argumentos; só a do esquema pedido", () => {
  const argv = ["/Applications/meu-bot.app/Contents/MacOS/meu-bot", "--host=box", `meu-bot://auth?code=${CODE}&state=${STATE}`];
  assert.equal(urlDeArgv(argv, "meu-bot"), argv[2]);
  assert.equal(urlDeArgv(argv, "meu-bot-staging"), null);
  assert.equal(urlDeArgv(["--host=box"], "meu-bot"), null);
  assert.equal(ehUrlDoEsquema("Meu-Bot://auth", "meu-bot"), true);
  assert.equal(ehUrlDoEsquema("meu-bot:auth", "meu-bot"), false, "sem as barras não é a forma que a página manda");
});
