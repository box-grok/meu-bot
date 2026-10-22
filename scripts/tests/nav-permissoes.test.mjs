import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const p = createRequire(import.meta.url)("../../dist/main/nav-permissoes-core.js");

test("origem e tipos: só http(s); vídeo = câmera, áudio = microfone, pedido genérico = os dois", () => {
  assert.equal(p.origemDe("https://accounts.google.com/v3/signin?x=1"), "https://accounts.google.com");
  assert.equal(p.origemDe("file:///etc/passwd"), null); assert.equal(p.origemDe("lixo"), null);
  assert.deepEqual(p.tiposDe(["video"]), ["camera"]); assert.deepEqual(p.tiposDe(["audio", "video"]), ["camera", "microfone"]); assert.deepEqual(p.tiposDe([]), ["camera", "microfone"]);
  assert.equal(p.nomeTipos(["camera", "microfone"]), "câmera e microfone");
});

test("decisão por origem: sempre libera, nunca bloqueia, desta vez não fica guardado; esquecer volta a perguntar", () => {
  const o = "https://accounts.google.com";
  let g = {};
  assert.equal(p.decisaoGuardada(g, o, ["camera"]), "perguntar");
  assert.deepEqual(p.guardar(g, o, ["camera"], "agora"), {});
  g = p.guardar(g, o, ["camera"], "sempre");
  assert.equal(p.decisaoGuardada(g, o, ["camera"]), "permitir");
  assert.equal(p.decisaoGuardada(g, o, ["camera", "microfone"]), "perguntar", "microfone ainda não");
  g = p.guardar(g, o, ["microfone"], "nunca");
  assert.equal(p.decisaoGuardada(g, o, ["camera", "microfone"]), "negar");
  assert.equal(p.decisaoGuardada(p.esquecer(g, o), o, ["camera"]), "perguntar");
  assert.deepEqual(p.parsePermissoes({ [o]: { camera: true, x: 1 }, "file:///a": { camera: true }, ruim: 3 }), { [o]: { camera: true } });
});
