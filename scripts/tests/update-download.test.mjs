import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { baixarComRetomada, DownloadError } = createRequire(import.meta.url)("../../dist/main/update-download.js");

const CORPO = Buffer.alloc(300 * 1024); for (let i = 0; i < CORPO.length; i++) CORPO[i] = (i * 7 + 13) & 0xff;
const SHA = createHash("sha256").update(CORPO).digest("hex");

/**
 * Servidor falso com ETag e Range/If-Range. `modo.cortaEm` = bytes depois dos quais a primeira resposta cai
 * (socket destruído), uma vez; `modo.etag` muda para forçar o recomeço; `modo.status` força um código.
 */
function fake(modo = {}) {
  const st = { pedidos: [], corpo: CORPO, etag: '"v1"', ...modo };
  const server = createServer((req, res) => {
    st.pedidos.push({ range: req.headers.range ?? null, ifRange: req.headers["if-range"] ?? null });
    if (st.status !== undefined) { res.writeHead(st.status); return res.end(); }
    const total = st.corpo.length;
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    const retoma = m !== null && req.headers["if-range"] === st.etag;
    let inicio = 0;
    if (retoma) {
      inicio = Number(m[1]);
      if (inicio >= total) { res.writeHead(416, { "Content-Range": `bytes */${total}` }); return res.end(); }
      res.writeHead(206, { ETag: st.etag, "Content-Range": `bytes ${inicio}-${total - 1}/${total}`, "Content-Length": total - inicio });
    } else {
      res.writeHead(200, { ETag: st.etag, "Content-Length": total });
    }
    const fatia = st.corpo.subarray(inicio);
    if (st.cortaEm !== undefined && st.pedidos.length === 1) {
      res.write(fatia.subarray(0, st.cortaEm));
      setTimeout(() => res.socket?.destroy(), 20);
      return;
    }
    res.end(fatia);
  });
  return { server, st };
}
const sobe = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}/app.zip`)));
const pasta = () => mkdtempSync(join(tmpdir(), "meu-bot-dl-"));
const semEspera = () => 0;

test("download inteiro: vai para o disco, progresso cresce, sha256 e tamanho conferem, .partial e .resume somem", async () => {
  const { server, st } = fake(); const url = await sobe(server); const dir = pasta(); const destino = join(dir, "app.zip");
  const prog = [];
  try {
    const r = await baixarComRetomada({ url, destino, tamanho: CORPO.length, esperaMs: semEspera, onProgress: (b, t) => prog.push([b, t]) });
    assert.equal(r.sha256, SHA); assert.equal(r.bytes, CORPO.length); assert.equal(r.retomadas, 0);
    assert.ok(readFileSync(destino).equals(CORPO));
    assert.ok(prog.length > 0 && prog.every(([, t]) => t === CORPO.length) && prog.at(-1)[0] === CORPO.length);
    for (let i = 1; i < prog.length; i++) assert.ok(prog[i][0] >= prog[i - 1][0], "progresso nunca volta");
    assert.equal(existsSync(`${destino}.partial`), false); assert.equal(existsSync(`${destino}.resume`), false);
    assert.equal(st.pedidos.length, 1); assert.equal(st.pedidos[0].range, null);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("conexão cai no meio: a 2.ª tentativa retoma com Range + If-Range (206) e o arquivo sai idêntico", async () => {
  const { server, st } = fake({ cortaEm: 100 * 1024 }); const url = await sobe(server); const dir = pasta(); const destino = join(dir, "app.zip");
  try {
    const r = await baixarComRetomada({ url, destino, esperaMs: semEspera });
    assert.equal(r.sha256, SHA); assert.equal(r.retomadas, 1);
    assert.equal(st.pedidos.length, 2);
    assert.equal(st.pedidos[1].ifRange, '"v1"'); assert.match(st.pedidos[1].range, /^bytes=\d+-$/);
    assert.ok(Number(/\d+/.exec(st.pedidos[1].range)[0]) > 0, "retomou de onde parou, não do zero");
    assert.ok(readFileSync(destino).equals(CORPO));
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("ETag mudou entre as tentativas: o servidor manda 200 e o download recomeça do zero, sem corromper", async () => {
  const { server, st } = fake({ cortaEm: 50 * 1024 }); const url = await sobe(server); const dir = pasta(); const destino = join(dir, "app.zip");
  try {
    const p = baixarComRetomada({ url, destino, esperaMs: () => 30 });
    setTimeout(() => { st.etag = '"v2"'; }, 10);
    const r = await p;
    assert.equal(r.sha256, SHA); assert.ok(readFileSync(destino).equals(CORPO));
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test(".partial de outra URL não é retomado; o .resume guarda a URL", async () => {
  const { server, st } = fake(); const url = await sobe(server); const dir = pasta(); const destino = join(dir, "app.zip");
  try {
    writeFileSync(`${destino}.partial`, Buffer.alloc(10)); writeFileSync(`${destino}.resume`, `http://outra/app.zip\n"v1"`);
    const r = await baixarComRetomada({ url, destino, esperaMs: semEspera });
    assert.equal(r.sha256, SHA); assert.equal(st.pedidos[0].range, null, "começou do zero");
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("HTTP 404 não insiste: DownloadError na hora", async () => {
  const { server, st } = fake({ status: 404 }); const url = await sobe(server); const dir = pasta();
  try {
    await assert.rejects(baixarComRetomada({ url, destino: join(dir, "app.zip"), esperaMs: semEspera }), (e) => e instanceof DownloadError && /404/.test(e.message));
    assert.equal(st.pedidos.length, 1);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("tamanho declarado diferente do baixado: DownloadError e nada fica no disco", async () => {
  const { server } = fake(); const url = await sobe(server); const dir = pasta(); const destino = join(dir, "app.zip");
  try {
    await assert.rejects(baixarComRetomada({ url, destino, tamanho: CORPO.length + 1, esperaMs: semEspera }), (e) => e instanceof DownloadError && /incompleto/.test(e.message));
    assert.equal(existsSync(destino), false); assert.equal(existsSync(`${destino}.partial`), false);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("cancelado por fora: erro ABORTED e o .partial fica para a próxima vez", async () => {
  const { server } = fake({ cortaEm: 80 * 1024 }); const url = await sobe(server); const dir = pasta(); const destino = join(dir, "app.zip");
  const ac = new AbortController();
  try {
    const p = baixarComRetomada({ url, destino, signal: ac.signal, esperaMs: () => 5_000 });
    setTimeout(() => ac.abort(), 150);
    await assert.rejects(p, (e) => e.code === "ABORTED");
    assert.equal(existsSync(`${destino}.partial`), true);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("servidor que para de mandar bytes: o vigia de inatividade derruba a tentativa e a próxima retoma", async () => {
  // Primeira resposta: manda metade e fica muda (sem fechar); com stallMs curto a tentativa cai e a 2.ª retoma.
  const st = { pedidos: 0 };
  const server = createServer((req, res) => {
    st.pedidos++;
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (st.pedidos === 1) { res.writeHead(200, { ETag: '"v1"', "Content-Length": CORPO.length }); res.write(CORPO.subarray(0, 120 * 1024)); return; }
    const inicio = m !== null && req.headers["if-range"] === '"v1"' ? Number(m[1]) : 0;
    res.writeHead(inicio > 0 ? 206 : 200, { ETag: '"v1"', ...(inicio > 0 ? { "Content-Range": `bytes ${inicio}-${CORPO.length - 1}/${CORPO.length}` } : {}), "Content-Length": CORPO.length - inicio });
    res.end(CORPO.subarray(inicio));
  });
  const url = await sobe(server); const dir = pasta(); const destino = join(dir, "app.zip");
  try {
    const r = await baixarComRetomada({ url, destino, stallMs: 200, esperaMs: semEspera });
    assert.equal(r.sha256, SHA); assert.equal(st.pedidos, 2); assert.equal(r.retomadas, 1);
  } finally { server.closeAllConnections?.(); server.close(); rmSync(dir, { recursive: true, force: true }); }
});
