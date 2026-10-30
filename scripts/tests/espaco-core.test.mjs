import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../../dist/main/agente/espaco-core.js");

const COTA = { usadoKb: 3_400_000, limiteKb: 4_126_300, hardKb: 4_500_000, pct: 82, nivel: "perto", grace: null, em: "2026-10-30T12:00:00Z",
  itens: [{ id: "conversas", rotulo: "Conversas", kb: 1_200_000, dela: true, apagavel: false }, { id: "tools", rotulo: "Programas do agente (fixos)", kb: 900_000, dela: false, apagavel: false }] };

test("espaço: lerCotaJson aceita o json do backend e recusa lixo", () => {
  const c = core.lerCotaJson(COTA);
  assert.equal(c.usadoKb, 3_400_000); assert.equal(c.limiteKb, 4_126_300); assert.equal(c.hardKb, 4_500_000);
  assert.equal(c.pct, 82); assert.equal(c.nivel, "perto"); assert.equal(c.grace, null); assert.equal(c.em, "2026-10-30T12:00:00Z");
  assert.equal(c.itens.length, 2); assert.deepEqual(c.itens[1], { id: "tools", rotulo: "Programas do agente (fixos)", kb: 900_000, dela: false, apagavel: false });
  assert.equal(core.lerCotaJson(null), null); assert.equal(core.lerCotaJson(undefined), null); assert.equal(core.lerCotaJson("x"), null); assert.equal(core.lerCotaJson(42), null);
  assert.equal(core.lerCotaJson({ usadoKb: 1 }), null, "sem limiteKb"); assert.equal(core.lerCotaJson({ usadoKb: -1, limiteKb: 2 }), null, "negativo");
  assert.equal(core.lerCotaJson({ usadoKb: Infinity, limiteKb: 2 }), null); assert.equal(core.lerCotaJson({ usadoKb: "1", limiteKb: 2 }), null);
});

test("espaço: lerCotaJson conserta nível estranho pelo pct, corta grace/rotulo/itens e tolera itens quebrados", () => {
  assert.equal(core.lerCotaJson({ ...COTA, nivel: "x", pct: 97 }).nivel, "critico");
  assert.equal(core.lerCotaJson({ ...COTA, nivel: "x", pct: 100 }).nivel, "cheio");
  assert.equal(core.lerCotaJson({ ...COTA, nivel: "x", pct: 80 }).nivel, "perto");
  assert.equal(core.lerCotaJson({ ...COTA, nivel: 3, pct: 10 }).nivel, "ok");
  assert.equal(core.lerCotaJson({ usadoKb: 50, limiteKb: 100, nivel: "x" }).pct, 50, "sem pct: calcula");
  assert.equal(core.lerCotaJson({ ...COTA, grace: "x".repeat(21) }).grace, null); assert.equal(core.lerCotaJson({ ...COTA, grace: "7 dias" }).grace, "7 dias");
  assert.equal(core.lerCotaJson({ ...COTA, hardKb: "x" }).hardKb, null); assert.equal(core.lerCotaJson({ ...COTA, em: "x".repeat(41) }).em, "");
  const muitos = core.lerCotaJson({ ...COTA, itens: Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, rotulo: "r".repeat(100), kb: i, dela: 1, apagavel: "sim" })) });
  assert.equal(muitos.itens.length, 20); assert.equal(muitos.itens[0].rotulo.length, 60); assert.equal(muitos.itens[0].dela, true); assert.equal(muitos.itens[0].apagavel, false);
  const quebrados = core.lerCotaJson({ ...COTA, itens: [null, 7, { id: "a" }, { id: "b", rotulo: "B", kb: -1 }, { id: "c", rotulo: "C", kb: 5 }] });
  assert.deepEqual(quebrados.itens, [{ id: "c", rotulo: "C", kb: 5, dela: true, apagavel: false }]);
  assert.deepEqual(core.lerCotaJson({ usadoKb: 1, limiteKb: 2, itens: "x" }).itens, []);
});

test("espaço: caminhoApagavel só abaixo das raízes (nunca a raiz), sessão antiga inteira, nada fora do home", () => {
  const h = "/home/ana";
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/cache/images/a.jpg"), true);
  assert.equal(core.caminhoApagavel(h, "/home/ana/agent-workspace/proj/x.pdf"), true);
  assert.equal(core.caminhoApagavel(h, "/home/ana/chat-workspace/x"), true);
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/cache/images"), false, "a raiz fica");
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/cache/images/"), false);
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/cache"), false);
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/tools/x"), false);
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/whatsapp/session"), false, "a sessão viva nunca");
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/whatsapp/session/x"), false);
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/whatsapp/session.loggedout-1"), true);
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/whatsapp/session.loggedout-"), false);
  assert.equal(core.caminhoApagavel(h, "/home/ana/.hermes/whatsapp/session.loggedout-1/x"), false, "só a pasta inteira");
  assert.equal(core.caminhoApagavel(h, "/home/ana/../etc"), false);
  assert.equal(core.caminhoApagavel(h, "/home/ana/agent-workspace/../.hermes/tools"), false);
  assert.equal(core.caminhoApagavel(h, "/home/ana/agent-workspace//x"), false);
  assert.equal(core.caminhoApagavel(h, "/home/anabela/.hermes/cache/images/x"), false, "outro home com o mesmo prefixo");
  assert.equal(core.caminhoApagavel(h, "agent-workspace/x"), false, "relativo"); assert.equal(core.caminhoApagavel(h, ""), false);
  assert.equal(core.caminhoApagavel("", "/home/ana/agent-workspace/x"), false);
  assert.equal(core.caminhoApagavel("/root", "/root/agent-workspace/x"), false, "só homes em /home");
  assert.equal(core.caminhoApagavel(h, "/home/ana/agent-workspace/x\ny"), false);
});

test("espaço: apagarMeuItemSh confere com realpath -m e a mesma allowlist no case; só base64", () => {
  const sh = core.apagarMeuItemSh("YWJj");
  assert.match(sh, /printf '%s' 'YWJj' \| base64 -d/); assert.match(sh, /realpath -m -- "\$P"/);
  assert.match(sh, /case "\$R" in "\$HOME"\/\.hermes\/cache\/images\/\?\*\|"\$HOME"\/\.hermes\/cache\/audio\/\?\*\|"\$HOME"\/\.hermes\/image_cache\/\?\*\|"\$HOME"\/\.hermes\/audio_cache\/\?\*\|"\$HOME"\/agent-workspace\/\?\*\|"\$HOME"\/chat-workspace\/\?\*\|"\$HOME"\/\.hermes\/whatsapp\/session\.loggedout-\?\*\) ;; \*\) echo "ERRO=esse item não pode ser apagado por aqui"; exit 0 ;; esac/);
  assert.match(sh, /rm -rf -- "\$R" && echo "APAGADO=\$R" \|\| echo "ERRO=não consegui apagar"/);
  assert.doesNotMatch(sh, /getent|sudo/);
  assert.throws(() => core.apagarMeuItemSh("a b"), /inválido/); assert.throws(() => core.apagarMeuItemSh("'; rm -rf /"), /inválido/); assert.throws(() => core.apagarMeuItemSh(""), /inválido/);
});

test("espaço: MEUS_MAIORES_SH roda como a pessoa, só nas raízes dela e nas sessões antigas", () => {
  const sh = core.MEUS_MAIORES_SH;
  assert.match(sh, /^echo "HOME=\$HOME"$/m);
  assert.match(sh, /du -xak --max-depth=1 "\$HOME\/\.hermes\/cache\/images" "\$HOME\/\.hermes\/cache\/audio" "\$HOME\/\.hermes\/image_cache" "\$HOME\/\.hermes\/audio_cache" "\$HOME\/agent-workspace" "\$HOME\/chat-workspace" 2>\/dev\/null \| sort -rn \| head -40/);
  assert.match(sh, /printf 'I\\t%s\\t%s\\t%s\\n'/);
  assert.match(sh, /"\$HOME"\/\.hermes\/whatsapp\/session\.loggedout-\*/);
  assert.doesNotMatch(sh, /\.hermes\/tools/); assert.doesNotMatch(sh, /whatsapp\/session"/); assert.doesNotMatch(sh, /getent|sudo/);
  assert.deepEqual(core.RAIZES_APAGAVEIS, [".hermes/cache/images", ".hermes/cache/audio", ".hermes/image_cache", ".hermes/audio_cache", "agent-workspace", "chat-workspace"]);
  assert.equal(core.PADRAO_SESSAO_ANTIGA, ".hermes/whatsapp/session.loggedout-");
});

test("espaço: lerMeusMaiores derruba as raízes e o que está fora, mantém os filhos, maiores primeiro", () => {
  const out = ["HOME=/home/ana",
    "I\t900000\td\t/home/ana/agent-workspace",
    "I\t500\tf\t/home/ana/agent-workspace/pequeno.txt",
    "I\t40000\td\t/home/ana/.hermes/cache/images",
    "I\t39000\tf\t/home/ana/.hermes/cache/images/a.jpg",
    "I\t70000\td\t/home/ana/agent-workspace/proj",
    "I\t10\tf\t/home/ana/.hermes/tools/x",
    "I\t10\tf\t/home/ana/../etc/passwd",
    "I\t10\tf\t/home/anabela/agent-workspace/y",
    "I\t12000\td\t/home/ana/.hermes/whatsapp/session.loggedout-2026",
    "I\t99999\td\t/home/ana/.hermes/whatsapp/session",
    "lixo", "I\tabc\td\t/home/ana/agent-workspace/z", ""].join("\n");
  const r = core.lerMeusMaiores(out, "/home/ana");
  assert.equal(r.home, "/home/ana");
  assert.deepEqual(r.itens.map((i) => [i.kb, i.pasta, i.caminho]), [
    [70000, true, "/home/ana/agent-workspace/proj"],
    [39000, false, "/home/ana/.hermes/cache/images/a.jpg"],
    [12000, true, "/home/ana/.hermes/whatsapp/session.loggedout-2026"],
    [500, false, "/home/ana/agent-workspace/pequeno.txt"],
  ]);
  assert.deepEqual(core.lerMeusMaiores("", "/home/ana"), { home: "/home/ana", itens: [] });
  assert.deepEqual(core.lerMeusMaiores("ERRO=x\n", ""), { home: null, itens: [] });
});

test("espaço: tam em pt-BR", () => {
  assert.equal(core.tam(4126300), "3,9 GB"); assert.equal(core.tam(43476), "42 MB"); assert.equal(core.tam(512), "512 KB");
  assert.equal(core.tam(1024 * 1024), "1,0 GB"); assert.equal(core.tam(1024), "1 MB"); assert.equal(core.tam(0), "0 KB");
});
