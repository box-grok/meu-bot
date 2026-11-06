import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { FERRAMENTAS, PAGINAS, ferramenta, roteador, donoDe, pedidoOk, responderJsonRpc, gerarToken, isToken, isPortaMcp, configClaudeCode, configCursor, urlMcp, erroRpc } = req("../../dist/main/controle-remoto/controle-remoto-core.js");
const { PRODUTOS } = req("../../dist/main/app/variant-core.js");
const { normalizeSettings, defaultSettings } = req("../../dist/main/app/settings-normalize.js");

const TOKEN = "a".repeat(64);
const okReq = (extra = {}) => ({ method: "POST", url: "/mcp", headers: { host: "127.0.0.1:7830", authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...extra } });

test("catálogo: as ferramentas do app-mcp (menos apps/app_abrir) mais as do app; cada uma com schema e anotações", () => {
  const nomes = FERRAMENTAS.map((f) => f.name);
  for (const n of ["terminais", "terminal_abrir", "terminal_ler", "terminal_digitar", "tela_dividir", "tela_juntar", "nav_abas", "nav_abrir", "nav_ler", "nav_clicar", "nav_digitar", "nav_tecla", "nav_print", "nav_recarregar", "nav_voltar", "nav_js", "nav_fechar", "nota", "depuracao", "app", "janela_abrir", "pagina_abrir", "tema", "print_janela"]) assert.ok(nomes.includes(n), `falta ${n}`);
  assert.ok(!nomes.includes("apps") && !nomes.includes("app_abrir"), "de dentro do app não se abre outro app");
  assert.equal(new Set(nomes).size, nomes.length, "nome repetido");
  for (const f of FERRAMENTAS) { assert.equal(f.inputSchema.type, "object"); assert.equal(typeof f.annotations.readOnlyHint, "boolean"); assert.ok(f.description.length > 10); }
  assert.equal(ferramenta("nav_fechar").annotations.destructiveHint, true);
  assert.equal(ferramenta("terminais").annotations.readOnlyHint, true);
  assert.deepEqual(ferramenta("pagina_abrir").inputSchema.properties.pagina.enum, [...PAGINAS]);
});

test("roteador: terminal, Navegador (com a máquina à parte) e app; desconhecida lança", () => {
  assert.deepEqual(roteador("terminais", {}), { alvo: "terminal", rota: "terminais" });
  assert.deepEqual(roteador("terminal_abrir", { maquina: "colima" }), { alvo: "terminal", rota: "abrir", corpo: { maquina: "colima" } });
  assert.deepEqual(roteador("terminal_ler", { id: "t1", linhas: 20 }), { alvo: "terminal", rota: "ler", corpo: { id: "t1", linhas: 20 } });
  assert.deepEqual(roteador("tela_dividir", { pagina: "navegador", maquina: "colima" }), { alvo: "terminal", rota: "dividir", corpo: { pagina: "navegador", maquina: "colima" } });
  assert.deepEqual(roteador("nota", { texto: "oi", maquina: "x" }), { alvo: "terminal", rota: "nota", corpo: { texto: "oi" } });
  assert.deepEqual(roteador("depuracao", { on: null }), { alvo: "terminal", rota: "depuracao", corpo: { on: null } });
  assert.deepEqual(roteador("depuracao", {}), { alvo: "terminal", rota: "depuracao", corpo: {} });
  assert.deepEqual(roteador("nav_abas", {}), { alvo: "navegador", rota: "abas" });
  assert.deepEqual(roteador("nav_abas", { maquina: "colima" }), { alvo: "navegador", rota: "abas", maquina: "colima" });
  assert.deepEqual(roteador("nav_abrir", { url: "https://x", nova: true, maquina: "colima" }), { alvo: "navegador", rota: "abrir", corpo: { url: "https://x", nova: true }, maquina: "colima" });
  assert.deepEqual(roteador("nav_print", { aba: 5 }), { alvo: "navegador", rota: "print", corpo: { aba: 5 } });
  assert.deepEqual(roteador("tema", { tema: "dark" }), { alvo: "app", acao: "tema", args: { tema: "dark" } });
  assert.deepEqual(roteador("print_janela", {}), { alvo: "app", acao: "print_janela", args: {} });
  assert.throws(() => roteador("inexistente", {}), /desconhecida/);
});

test("donoDe: sem nome vira Cliente MCP; com nome, o nome limpo vira selo", () => {
  assert.deepEqual(donoDe(undefined), { id: "mcp:cliente", rotulo: "Cliente MCP (Mac)", origem: "claude-code" });
  assert.deepEqual(donoDe("Cursor"), { id: "mcp:cursor", rotulo: "Cursor (MCP)", origem: "claude-code" });
  assert.deepEqual(donoDe(["Claude Code", "x"]), { id: "mcp:claude-code", rotulo: "Claude Code (MCP)", origem: "claude-code" });
  assert.equal(donoDe("<script>alert(1)</script>").rotulo, "scriptalert1script (MCP)");
  assert.equal(donoDe("a".repeat(80)).rotulo.length, 30 + " (MCP)".length);
});

test("pedidoOk: só POST /mcp do loopback com Bearer e JSON; cada recusa com o status certo", () => {
  assert.deepEqual(pedidoOk(okReq(), 7830, TOKEN), { ok: true });
  assert.deepEqual(pedidoOk(okReq({ origin: "http://127.0.0.1:7830" }), 7830, TOKEN), { ok: true });
  assert.deepEqual(pedidoOk(okReq({ origin: "http://localhost:7830" }), 7830, TOKEN), { ok: true });
  assert.deepEqual(pedidoOk(okReq({ host: "localhost:7830", "content-type": "application/json; charset=utf-8" }), 7830, TOKEN), { ok: true });
  assert.equal(pedidoOk({ ...okReq(), url: "/x" }, 7830, TOKEN).status, 404);
  assert.equal(pedidoOk({ ...okReq(), url: "/mcp?x=1" }, 7830, TOKEN).ok, true, "query não atrapalha");
  assert.equal(pedidoOk({ ...okReq(), method: "GET" }, 7830, TOKEN).status, 405, "sem SSE: GET recusa");
  assert.equal(pedidoOk({ ...okReq(), method: "DELETE" }, 7830, TOKEN).status, 405);
  assert.equal(pedidoOk(okReq({ host: "evil.com:7830" }), 7830, TOKEN).status, 421, "DNS rebinding");
  assert.equal(pedidoOk(okReq({ host: "127.0.0.1:7831" }), 7830, TOKEN).status, 421, "porta errada");
  assert.equal(pedidoOk(okReq({ origin: "https://evil.com" }), 7830, TOKEN).status, 403, "página de fora");
  assert.equal(pedidoOk(okReq({ origin: "http://127.0.0.1:9999" }), 7830, TOKEN).status, 403);
  assert.equal(pedidoOk(okReq({ authorization: "Bearer " + "b".repeat(64) }), 7830, TOKEN).status, 401);
  assert.equal(pedidoOk(okReq({ authorization: undefined }), 7830, TOKEN).status, 401);
  assert.equal(pedidoOk(okReq(), 7830, "").status, 401, "sem token gravado ninguém entra");
  assert.equal(pedidoOk(okReq({ "content-type": "text/plain" }), 7830, TOKEN).status, 415);
});

test("JSON-RPC: initialize, ping, tools/list, tools/call (texto, imagem, erro), notificação sem resposta, lote, método desconhecido", async () => {
  const info = { nome: "meu-bot", versao: "1.2.3" };
  const chamadas = [];
  const chamar = async (nome, args) => {
    chamadas.push([nome, args]);
    if (nome === "nav_print") return { png_base64: "AAAA" };
    if (nome === "nota") throw new Error("falta texto");
    if (nome === "terminais") return { terminais: [] };
    return undefined;
  };
  const init = await responderJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, chamar, info);
  assert.equal(init.result.protocolVersion, "2024-11-05"); assert.deepEqual(init.result.serverInfo, { name: "meu-bot", version: "1.2.3" }); assert.deepEqual(init.result.capabilities, { tools: {} }); assert.match(init.result.instructions, /nota/);
  const semVersao = await responderJsonRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }, chamar, info);
  assert.equal(semVersao.result.protocolVersion, "2025-03-26");
  assert.deepEqual(await responderJsonRpc({ jsonrpc: "2.0", id: 3, method: "ping" }, chamar, info), { jsonrpc: "2.0", id: 3, result: {} });
  const lista = await responderJsonRpc({ jsonrpc: "2.0", id: 4, method: "tools/list" }, chamar, info);
  assert.equal(lista.result.tools.length, FERRAMENTAS.length);
  assert.equal(await responderJsonRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, chamar, info), null);
  const t = await responderJsonRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "terminais", arguments: {} } }, chamar, info);
  assert.deepEqual(t.result, { content: [{ type: "text", text: JSON.stringify({ terminais: [] }) }], structuredContent: { terminais: [] }, isError: false });
  const ok = await responderJsonRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "tema", arguments: { tema: "dark" } } }, chamar, info);
  assert.deepEqual(ok.result.structuredContent, { ok: true }, "sem retorno vira {ok:true}");
  const img = await responderJsonRpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nav_print", arguments: {} } }, chamar, info);
  assert.deepEqual(img.result, { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], isError: false });
  const erro = await responderJsonRpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nota", arguments: {} } }, chamar, info);
  assert.deepEqual(erro.result, { content: [{ type: "text", text: "Erro: falta texto" }], isError: true });
  const desconhecida = await responderJsonRpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "sumir", arguments: {} } }, chamar, info);
  assert.equal(desconhecida.error.code, -32602);
  const metodo = await responderJsonRpc({ jsonrpc: "2.0", id: 10, method: "resources/list" }, chamar, info);
  assert.equal(metodo.error.code, -32601);
  assert.equal((await responderJsonRpc("texto", chamar, info)).error.code, -32600);
  assert.equal((await responderJsonRpc({ jsonrpc: "2.0", id: 11 }, chamar, info)).error.code, -32600);
  const lote = await responderJsonRpc([{ jsonrpc: "2.0", id: 12, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }], chamar, info);
  assert.deepEqual(lote, [{ jsonrpc: "2.0", id: 12, result: {} }]);
  assert.equal(await responderJsonRpc([{ jsonrpc: "2.0", method: "notifications/x" }], chamar, info), null);
  assert.equal((await responderJsonRpc([], chamar, info)).error.code, -32600);
  assert.deepEqual(chamadas.map((c) => c[0]), ["terminais", "tema", "nav_print", "nota"], "a desconhecida nunca chega ao app");
  assert.deepEqual(erroRpc(null, -32000, "x"), { jsonrpc: "2.0", id: null, error: { code: -32000, message: "x" } });
});

test("token e porta: 64 hex; porta 1024–65535; a configuração pronta leva nome, porta e token", () => {
  const t = gerarToken();
  assert.ok(isToken(t)); assert.notEqual(t, gerarToken());
  assert.equal(isToken("abc"), false); assert.equal(isToken("G".repeat(64)), false);
  assert.equal(isPortaMcp(1024), true); assert.equal(isPortaMcp(1023), false); assert.equal(isPortaMcp(65535), true); assert.equal(isPortaMcp(65536), false); assert.equal(isPortaMcp("7830"), false); assert.equal(isPortaMcp(7830.5), false);
  assert.equal(urlMcp(7830), "http://127.0.0.1:7830/mcp");
  assert.equal(configClaudeCode("meu-bot-staging", 7831, TOKEN), `claude mcp add --transport http meu-bot-staging http://127.0.0.1:7831/mcp --header "Authorization: Bearer ${TOKEN}"`);
  assert.deepEqual(JSON.parse(configCursor("meu-bot", 7830, TOKEN)), { mcpServers: { "meu-bot": { url: "http://127.0.0.1:7830/mcp", headers: { Authorization: `Bearer ${TOKEN}` } } } });
});

test("produtos: cada app tem a própria porta do MCP, nenhuma é a 7822 do Rambox nem colide com a porta local", () => {
  const portas = PRODUTOS.map((p) => p.portaMcp);
  assert.equal(new Set(portas).size, portas.length, "porta do MCP repetida entre apps");
  for (const p of PRODUTOS) { assert.ok(isPortaMcp(p.portaMcp), p.nome); assert.notEqual(p.portaMcp, 7822, "o Rambox pode estar aberto no mesmo Mac"); assert.notEqual(p.portaMcp, p.portaLocal); }
  assert.equal(PRODUTOS.find((p) => p.variant === "client").portaMcp, 7830);
  assert.equal(PRODUTOS.find((p) => p.variant === "client-staging").portaMcp, 7831);
});

test("settings: desligado e sem token por padrão; token inválido cai para vazio; porta fora da faixa vira padrão (null)", () => {
  const d = defaultSettings();
  assert.deepEqual([d.mcpLigado, d.mcpPorta, d.mcpToken], [false, null, ""]);
  const s = normalizeSettings({ mcpLigado: true, mcpPorta: 7900, mcpToken: TOKEN });
  assert.deepEqual([s.mcpLigado, s.mcpPorta, s.mcpToken], [true, 7900, TOKEN]);
  const ruim = normalizeSettings({ mcpLigado: "sim", mcpPorta: 80, mcpToken: "curto" });
  assert.deepEqual([ruim.mcpLigado, ruim.mcpPorta, ruim.mcpToken], [false, null, ""]);
});
