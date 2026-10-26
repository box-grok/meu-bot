import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { BlockQrCollector, blocksToGrid, gridToSvgDataUrl, isBlockLine, stripAnsi } = require("../../dist/main/whatsapp/qr-blocks.js");
const QRCode = require("qrcode");

/** Grade (true = aceso) → linhas de meios-blocos, como o terminal imprime. */
function gridToBlocks(grid) {
  const out = [];
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y]; const bottom = grid[y + 1] ?? top.map(() => false);
    out.push(top.map((t, x) => (t && bottom[x] ? "█" : t ? "▀" : bottom[x] ? "▄" : " ")).join(""));
  }
  return out;
}

/** QR real do pacote qrcode com borda de 1 módulo acesa (quiet zone clara, como no terminal). */
function sampleGrid(text) {
  const q = QRCode.create(text, { errorCorrectionLevel: "L" });
  const n = q.modules.size; const grid = [];
  for (let y = -1; y <= n; y++) { const row = []; for (let x = -1; x <= n; x++) row.push(y < 0 || x < 0 || y >= n || x >= n ? true : q.modules.get(y, x) === 0); grid.push(row); }
  return grid;
}

test("ida e volta: blocos → grade → mesma grade; SVG com um rect por módulo aceso", () => {
  const grid = sampleGrid("https://wa.me/qr/ABC123");
  const lines = gridToBlocks(grid);
  const back = blocksToGrid(lines);
  const padded = grid.length % 2 === 1 ? [...grid, grid[0].map(() => false)] : grid;
  assert.deepEqual(back, padded);
  const url = gridToSvgDataUrl(back);
  assert.match(url, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(url.split(",")[1], "base64").toString("utf8");
  const lit = padded.flat().filter(Boolean).length;
  assert.equal((svg.match(/<rect x=/g) ?? []).length, lit);
  assert.match(svg, /fill="#000"/); assert.match(svg, /fill="#fff"/);
});

test("coletor: ANSI e logs em volta não atrapalham; QR fecha na primeira linha que não é bloco", () => {
  const lines = gridToBlocks(sampleGrid("x"));
  const c = new BlockQrCollector();
  assert.equal(c.feed(stripAnsi("\x1b[32mScan this QR with WhatsApp\x1b[0m\r")), null);
  for (const l of lines) assert.equal(c.feed(l), null);
  const got = c.feed("Waiting for scan…");
  assert.deepEqual(got, lines);
  assert.equal(c.feed("Linked! Credentials saved."), null);
  assert.equal(c.flush(), null);
});

test("linhas curtas de blocos (barra de progresso, moldura) não viram QR", () => {
  assert.equal(isBlockLine("████ 40%"), false);
  assert.equal(isBlockLine("▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄"), true);
  const c = new BlockQrCollector();
  for (let i = 0; i < 3; i++) c.feed("▄".repeat(20));
  assert.equal(c.feed("fim"), null, "três linhas não são um QR");
});
