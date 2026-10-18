import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptKey, decodeFrame, encodeFrame } from "../../dist/main/ws-mini.js";

test("acceptKey: o exemplo da RFC 6455", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

const mask = (payload, key) => Buffer.from(payload.map((b, i) => b ^ key[i & 3]));
const clientFrame = (text, fin = true, opcode = 0x1) => {
  const p = Buffer.from(text, "utf8"); const key = Buffer.from([1, 2, 3, 4]);
  const len = p.length;
  const head = len < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | len])
    : len < 65536 ? Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(len); return b; })()])
      : Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, key, mask(p, key)]);
};

test("decodeFrame: máscara do cliente, 7/16/64 bits, frame incompleto, fragmento", () => {
  const small = decodeFrame(clientFrame("oi")); assert.equal(small.frame.payload.toString(), "oi"); assert.equal(small.used, 8);
  const mid = decodeFrame(clientFrame("x".repeat(300))); assert.equal(mid.frame.payload.length, 300);
  const big = decodeFrame(clientFrame("y".repeat(70_000))); assert.equal(big.frame.payload.length, 70_000); assert.equal(big.frame.fin, true);
  assert.equal(decodeFrame(clientFrame("abc").subarray(0, 5)), null, "faltando bytes: espera");
  const frag = decodeFrame(clientFrame("parte", false)); assert.equal(frag.frame.fin, false); assert.equal(frag.frame.opcode, 1);
});

test("encodeFrame: servidor sem máscara, tamanhos certos; decodifica de volta", () => {
  const f = encodeFrame(0x1, Buffer.from("{\"id\":1}")); assert.equal(f[0], 0x81); assert.equal(f[1], 8);
  const d = decodeFrame(f); assert.equal(d.frame.payload.toString(), "{\"id\":1}");
  const big = encodeFrame(0x1, Buffer.alloc(70_000, 65)); assert.equal(big[1], 127); assert.equal(decodeFrame(big).frame.payload.length, 70_000);
  const med = encodeFrame(0x1, Buffer.alloc(300, 66)); assert.equal(med[1], 126);
});
