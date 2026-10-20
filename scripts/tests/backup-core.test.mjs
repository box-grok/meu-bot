import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const b = createRequire(import.meta.url)("../../dist/main/admin/backup-core.js");

const man = { formato: 1, criadoEm: "2026-10-20T20:00:00Z", maquina: "abcdef123456", usuario: "box", home: "/home/box", ultimoHashAuditoria: "a".repeat(64), versoes: { openclaw: "2026.9.9", node: "v24.1.0", guarda: "1.1.0", crm: true, transcricao: true, voz: false, statusline: true }, whatsapp: true, arquivos: 900, bytes: 400 * 1048576, entradas: [{ caminho: "x" }] };
const conf = (o = {}) => b.parseConferir(Object.entries({ NODE: "v24.1.0", OPENCLAW: "2026.9.9", WHATSAPP_PAREADO: "0", LIVRE_MB: "20000", GATEWAY_UNIT: "1", USUARIO: "maria", HOME: "/home/maria", ...o }).map(([k, v]) => `${k}=${v}`).join("\n"));

test("manifesto: só formato 1 com máquina válida; a lista de entradas não vai para o índice", () => {
  const m = b.parseManifesto(man);
  assert.equal(m.maquina, "abcdef123456"); assert.equal(m.versoes.crm, true); assert.equal("entradas" in m, false);
  assert.equal(b.parseManifesto({ ...man, formato: 2 }), null); assert.equal(b.parseManifesto({ ...man, maquina: "x" }), null); assert.equal(b.parseManifesto(null), null);
});

test("nome do arquivo e índice", () => {
  assert.equal(b.nomeBackup("Ana Lúcia", new Date("2026-10-20T19:05:00Z"), "abcdef123456"), "ana-lucia-20261020-1905-abcdef123456.mbbak");
  const idx = b.parseIndice([{ arquivo: "a-1.mbbak", criadoEm: "2026-10-01", manifesto: man }, { arquivo: "b-2.mbbak", criadoEm: "2026-10-05", manifesto: man }, { arquivo: "../x.mbbak", manifesto: man }, { arquivo: "c.mbbak", manifesto: {} }]);
  assert.deepEqual(idx.map((x) => x.arquivo), ["b-2.mbbak", "a-1.mbbak"], "o mais novo primeiro; nome perigoso e manifesto ruim caem fora");
});

test("decisão de restaurar: mesma máquina, espaço, WhatsApp já pareado, OpenClaw ausente; avisos de versão e usuário", () => {
  const m = b.parseManifesto(man);
  const ok = b.decisaoRestaurar(m, conf(), "111111aaaaaa", false);
  assert.deepEqual(ok.bloqueios, []); assert.match(ok.avisos.join(), /box → maria/);
  assert.match(b.decisaoRestaurar(m, conf(), "abcdef123456", false).bloqueios.join(), /mesma máquina/);
  assert.match(b.decisaoRestaurar(m, conf({ LIVRE_MB: "300" }), "111111aaaaaa", false).bloqueios.join(), /pouco espaço/);
  assert.match(b.decisaoRestaurar(m, conf({ WHATSAPP_PAREADO: "1" }), "111111aaaaaa", false).bloqueios.join(), /substituir/);
  assert.deepEqual(b.decisaoRestaurar(m, conf({ WHATSAPP_PAREADO: "1" }), "111111aaaaaa", true).bloqueios, []);
  assert.match(b.decisaoRestaurar(m, conf({ OPENCLAW: "", GATEWAY_UNIT: "0" }), "111111aaaaaa", false).bloqueios.join(), /OpenClaw/);
  assert.match(b.decisaoRestaurar(m, conf({ OPENCLAW: "2026.10.1" }), "111111aaaaaa", false).avisos.join(), /2026\.10\.1/);
  assert.match(b.decisaoRestaurar(m, conf({ HOME: "" }), "111111aaaaaa", false).bloqueios.join(), /não respondeu/);
});

test("cifra age em stream: só a identidade abre, e o pacote não tem texto claro", async () => {
  const age = await import("age-encryption");
  const id = await age.generateX25519Identity(); const outra = await age.generateX25519Identity();
  const e = new age.Encrypter(); e.addRecipient(await age.identityToRecipient(id));
  const claro = Buffer.concat([Buffer.from("creds.json do WhatsApp: SEGREDO-123"), Buffer.alloc(200_000, 7)]);
  const stream = (buf) => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } });
  const juntar = async (s) => { const out = []; for await (const x of s) out.push(x); return Buffer.concat(out); };
  const cifrado = await juntar(await e.encrypt(stream(claro)));
  assert.equal(cifrado.includes("SEGREDO-123"), false);
  const d = new age.Decrypter(); d.addIdentity(id);
  assert.deepEqual(await juntar(await d.decrypt(stream(cifrado))), claro);
  const d2 = new age.Decrypter(); d2.addIdentity(outra);
  await assert.rejects(async () => juntar(await d2.decrypt(stream(cifrado))));
});
