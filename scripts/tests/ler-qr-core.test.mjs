import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { lerOtpauth } = require("../../dist/main/extensao-gmail/ler-qr-core.js");
const QRCode = require("qrcode");

/** Desenha o QR num bitmap BGRA (fundo cinza claro, 4 px por módulo, margem de 4 módulos), como o capturePage devolveria. */
function bitmap(texto, { escala = 4, margem = 4, largura = 0 } = {}) {
  const { modules } = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const n = modules.size; const lado = (n + 2 * margem) * escala; const w = Math.max(largura, lado); const h = lado;
  const buf = new Uint8Array(w * h * 4).fill(0xee);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (modules.get(y, x)) for (let dy = 0; dy < escala; dy++) for (let dx = 0; dx < escala; dx++) {
    const i = (((margem + y) * escala + dy) * w + (margem + x) * escala + dx) * 4; buf[i] = 0x22; buf[i + 1] = 0x22; buf[i + 2] = 0x22;
  }
  return { buf, w, h };
}

test("lerOtpauth: acha o otpauth:// do QR na captura (com sobra de página ao lado)", () => {
  const uri = "otpauth://totp/Google:lucas%40ex.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Google";
  const { buf, w, h } = bitmap(uri, { largura: 600 });
  assert.deepEqual(lerOtpauth(buf, w, h), { tipo: "otpauth", uri });
});
test("lerOtpauth: QR de outra coisa vira 'outro'; página sem QR, 'nenhum'", () => {
  const { buf, w, h } = bitmap("https://exemplo.com");
  assert.deepEqual(lerOtpauth(buf, w, h), { tipo: "outro" });
  assert.deepEqual(lerOtpauth(new Uint8Array(200 * 200 * 4).fill(255), 200, 200), { tipo: "nenhum" });
  assert.deepEqual(lerOtpauth(new Uint8Array(10), 200, 200), { tipo: "nenhum" });
});
