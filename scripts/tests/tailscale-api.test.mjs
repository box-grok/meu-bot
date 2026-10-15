import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
const { oauthToken, getPolicy, validatePolicy, setPolicy, TailscaleApiError } = createRequire(import.meta.url)("../../dist/main/tailscale-api.js");

/** Servidor falso: token, política com ETag, validate e POST com If-Match. */
function fake() {
  const state = { policy: '{ "ssh": [ { "action": "check" } ] }', etag: '"abc"', posts: [] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const auth = req.headers.authorization;
      if (req.url === "/api/v2/oauth/token" && req.method === "POST") {
        const p = new URLSearchParams(body);
        if (p.get("client_secret") !== "tskey-client-bom") { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: "invalid client" })); }
        res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }));
      }
      if (auth !== "Bearer tok-1") { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: "unauthorized" })); }
      if (req.url === "/api/v2/tailnet/-/acl" && req.method === "GET") {
        assert.equal(req.headers.accept, "application/hujson");
        res.writeHead(200, { "Content-Type": "application/hujson", ETag: state.etag }); return res.end(state.policy);
      }
      if (req.url === "/api/v2/tailnet/-/acl/validate" && req.method === "POST") {
        if (body.includes("invalido")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: "line 1: unexpected token" })); }
        res.writeHead(200); return res.end("");
      }
      if (req.url === "/api/v2/tailnet/-/acl" && req.method === "POST") {
        assert.equal(req.headers["content-type"], "application/hujson");
        if (req.headers["if-match"] !== state.etag) { res.writeHead(412, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: "If-Match hash mismatch" })); }
        if (body.includes("quebrado")) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: "ACL validation error" })); }
        state.posts.push(body); state.policy = body; state.etag = '"def"';
        res.writeHead(200, { ETag: state.etag }); return res.end(body);
      }
      res.writeHead(404); res.end();
    });
  });
  return { server, state };
}

test("token, GET com ETag, validate e POST com If-Match; 412 e 400 viram erros tipados", async () => {
  const { server, state } = fake();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const opts = { baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 3000 };
  try {
    await assert.rejects(oauthToken({ clientId: "id", clientSecret: "tskey-client-ruim" }, opts), (e) => e instanceof TailscaleApiError && e.kind === "auth" && e.status === 401);
    const token = await oauthToken({ clientId: "id", clientSecret: "tskey-client-bom" }, opts);
    assert.equal(token, "tok-1");
    const got = await getPolicy(token, opts);
    assert.equal(got.text, state.policy);
    assert.equal(got.etag, '"abc"');
    assert.deepEqual(await validatePolicy(token, '{ "ssh": [] }', opts), { ok: true, message: "" });
    assert.equal((await validatePolicy(token, "invalido", opts)).ok, false);
    await assert.rejects(setPolicy(token, '{ "a": 1 }', '"velho"', opts), (e) => e.kind === "conflict" && e.status === 412);
    await assert.rejects(setPolicy(token, "quebrado", '"abc"', opts), (e) => e.kind === "invalid" && /ACL validation error/.test(e.message));
    const saved = await setPolicy(token, '{ "ssh": [ { "action": "accept" } ] }', '"abc"', opts);
    assert.equal(saved.etag, '"def"');
    assert.equal(state.posts.length, 1);
    await assert.rejects(getPolicy("tok-errado", opts), (e) => e.kind === "auth");
  } finally {
    server.close();
  }
});

test("servidor fora do ar vira erro de rede em pt-BR", async () => {
  await assert.rejects(getPolicy("x", { baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 }), (e) => e instanceof TailscaleApiError && e.kind === "network" && /inacessível/.test(e.message));
});
