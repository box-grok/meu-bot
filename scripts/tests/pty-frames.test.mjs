import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { encodeFrame, FrameDecoder, RingBuffer } = createRequire(import.meta.url)("../../dist/main/terminal/pty-frames.js");

test("frames: codifica, decodifica em pedaços e vários num chunk; recusa lixo", () => {
  const a = encodeFrame("i", "olá");
  const b = encodeFrame("r", "100 30");
  const c = encodeFrame("k");
  const all = Buffer.concat([a, b, c]);
  const d = new FrameDecoder();
  assert.deepEqual(d.push(all.subarray(0, 3)), []);
  const got = [...d.push(all.subarray(3, 9)), ...d.push(all.subarray(9))];
  assert.deepEqual(got.map((f) => [f.kind, f.payload.toString()]), [["i", "olá"], ["r", "100 30"], ["k", ""]]);
  assert.throws(() => new FrameDecoder().push(Buffer.from("zzzzzzzz")), /inválido/);
});

test("ring buffer guarda só os últimos bytes", () => {
  const r = new RingBuffer(10);
  r.push(Buffer.from("12345")); r.push(Buffer.from("67890")); r.push(Buffer.from("ab"));
  assert.equal(r.read().toString(), "67890ab");
  r.push(Buffer.from("x".repeat(25)));
  assert.equal(r.read().length, 10);
});

/** O broker de verdade, com um PTY local: resize chega como SIGWINCH, entrada ecoa, saída e código voltam. */
test("pty-broker.py: resize, eco e código de saída", { timeout: 20_000 }, async () => {
  const src = readFileSync(new URL("../../dist/main/terminal/pty-broker.py", import.meta.url), "utf8");
  const py = spawn("/usr/bin/python3", ["-c", src, "/bin/sh", "-c", "stty size; cat; exit 7"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HOME: process.env.HOME } });
  const dec = new FrameDecoder();
  let out = ""; let exit = null;
  const done = new Promise((resolve) => {
    py.stdout.on("data", (chunk) => { for (const f of dec.push(chunk)) { if (f.kind === "o") out += f.payload.toString("utf8"); if (f.kind === "x") { exit = Number(f.payload.toString()); resolve(); } } });
    py.on("close", () => resolve());
  });
  py.stdin.write(encodeFrame("r", "100 30"));
  await new Promise((r) => setTimeout(r, 400));
  py.stdin.write(encodeFrame("i", "eco-áé\n"));
  await new Promise((r) => setTimeout(r, 400));
  py.stdin.write(encodeFrame("i", "\u0004")); // Ctrl+D encerra o cat
  await done;
  assert.match(out, /30 100/, `stty size deveria refletir o resize; saída: ${JSON.stringify(out)}`);
  assert.match(out, /eco-áé/);
  assert.equal(exit, 7);
});
