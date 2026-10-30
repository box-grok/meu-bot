import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { lerPreparar, passosPreparar, pacotesSh, GH_GLOBAL_SH, PREPARAR_ESTADO_SH, ORDEM_PREPARAR, PACOTES_BASE, PACOTES_TELA } = createRequire(import.meta.url)("../../dist/main/admin/preparar-core.js");
const { COTA_ESTADO_SH, HERMES_ESTADO_SH } = createRequire(import.meta.url)("../../dist/main/admin/usuarios-core.js");

const todos = [...PACOTES_BASE, ...PACOTES_TELA, "chromium"];
const pacotes = (faltam = []) => todos.map((p) => `${p}=${faltam.includes(p) ? 0 : 1}`).join(" ");
const saida = (o = {}) => [
  "ROOT", `RAM=${o.ram ?? 32000000}`, `SWAP=${o.swap ?? 8388604}`, `COTA=${o.cota ?? 1}`, `RESERVA=${o.reserva ?? 1}`, `SEMISO=${o.semiso ?? ""}`,
  `PACOTES=${o.pacotes ?? pacotes()}`, `GH=${o.gh ?? "2.103.3"}`, `HERMES=${o.hermes ?? "global"}`, `CG=${o.cg ?? "1 1 1"}`, `LP=${o.lp ?? "1 1 1 1 agentesgrok.com"}`, `OS=${o.os ?? "debian"}`,
].join("\n") + "\n";

test("preparar: máquina pronta → tudo ok, nada a aplicar; NAOROOT → root=false", () => {
  const v = lerPreparar(saida());
  assert.equal(v.root, true);
  assert.deepEqual(v.itens.map((i) => [i.id, i.estado]), [["swap", "ok"], ["cota", "ok"], ["governanca", "ok"], ["pacotes", "ok"], ["gh", "ok"], ["hermes", "ok"], ["transcritor", "ok"], ["claude-global", "ok"], ["link-publico", "ok"], ["chromium", "ok"]]);
  assert.deepEqual(v.faltam, []);
  assert.equal(v.ramKb, 32000000);
  assert.match(v.itens.find((i) => i.id === "link-publico").detalhe, /agentesgrok\.com/);
  assert.equal(lerPreparar("NAOROOT\n").root, false);
  assert.deepEqual(lerPreparar("NAOROOT\n").itens, []);
});

test("preparar: faltas saem na ordem de dependência, com o detalhe; o Chromium é opcional e fica fora de faltam", () => {
  const v = lerPreparar(saida({ swap: 0, cota: 0, reserva: 0, semiso: "box-1 box-2", pacotes: pacotes(["ffmpeg", "xvfb", "chromium"]), gh: "", hermes: "sem-transcritor" }));
  assert.deepEqual(v.faltam, ["swap", "cota", "governanca", "pacotes", "gh", "transcritor"]);
  const por = Object.fromEntries(v.itens.map((i) => [i.id, i]));
  assert.match(por.pacotes.detalhe, /^faltam: ffmpeg, xvfb$/);
  assert.match(por.governanca.detalhe, /sem reserva.*sem isolamento: box-1, box-2/);
  assert.equal(por.hermes.estado, "ok"); assert.equal(por.transcritor.estado, "falta");
  assert.equal(por.chromium.estado, "falta"); assert.equal(por.chromium.opcional, true);
  assert.deepEqual(v.semIsolamento, ["box-1", "box-2"]);
  // Hermes só no root: os dois faltam.
  const r = lerPreparar(saida({ hermes: "root" }));
  assert.equal(r.itens.find((i) => i.id === "hermes").estado, "falta"); assert.equal(r.itens.find((i) => i.id === "transcritor").estado, "falta");
});

test("preparar: Claude Global e Link Público (humano aponta a aba; link nunca entra em faltam); Chromium no Ubuntu é humano", () => {
  const cg = (s) => lerPreparar(saida({ cg: s })).itens.find((i) => i.id === "claude-global");
  assert.equal(cg("0 0 0").estado, "falta"); assert.equal(cg("1 1 0").estado, "humano"); assert.equal(cg("1 0 1").estado, "falta"); assert.equal(cg("1 1 1").estado, "ok");
  assert.equal(cg("1 1 0").pagina, "claude-global");
  const lp = (s) => lerPreparar(saida({ lp: s })).itens.find((i) => i.id === "link-publico");
  assert.equal(lp("0 0 0 0").estado, "humano"); assert.equal(lp("1 0 0 0 d.com").estado, "humano"); assert.equal(lp("1 1 0 0 d.com").estado, "humano"); assert.equal(lp("1 1 1 0 d.com").estado, "humano"); assert.equal(lp("1 1 1 1 d.com").estado, "ok");
  assert.equal(lp("0 0 0 0").pagina, "link-publico");
  assert.ok(!lerPreparar(saida({ lp: "0 0 0 0" })).faltam.includes("link-publico"));
  const ub = lerPreparar(saida({ os: "ubuntu", pacotes: pacotes(["chromium"]) })).itens.find((i) => i.id === "chromium");
  assert.equal(ub.estado, "humano"); assert.match(ub.detalhe, /snap/);
});

test("preparar: passos na ordem, só do que falta; governança vira reserva e/ou isolamento; claude-global sem script; chromium só pedido", () => {
  const v = lerPreparar(saida({ swap: 0, cota: 0, reserva: 0, semiso: "box-2", pacotes: pacotes(["jq", "chromium"]), gh: "", hermes: "nenhum", cg: "0 0 0" }));
  const p = passosPreparar(["chromium", "transcritor", "gh", "link-publico", "inventado", "swap", "cota", "governanca", "pacotes", "hermes", "claude-global"], v);
  assert.deepEqual(p.map((x) => x.titulo), ["Memória de reserva (swap de 8 GB)", "Cota de disco por usuário", "Reserva de memória para o sistema", "Isolamento das boxes", "Pacotes do sistema (jq, ffmpeg e a tela do bot)", "GitHub CLI para todos (/usr/local/bin/gh)", "Hermes para todos (/opt/hermes)", "Transcritor de áudio para todos (/opt/transcriber)", "Claude Code Global", "Navegador na tela do bot (Chromium)"]);
  assert.deepEqual(p.map((x) => x.acao), ["maquina.swap", "maquina.cota", "maquina.reserva", "maquina.isolamento", "maquina.pacotes", "maquina.gh", "maquina.hermes-global", "maquina.transcritor", "maquina.claude-global", "maquina.pacotes"]);
  for (const x of p) if (x.sh !== null) assert.match(x.sh, /^\[ "\$\(id -u\)" = 0 \]/, x.titulo);
  assert.equal(p.find((x) => x.id === "claude-global").sh, null);
  assert.match(p[2].sh, /set-property user\.slice MemoryMax=28125M/);
  assert.equal(p[2].alvo("RESERVA=ok 28125\n"), "28125");
  assert.equal(p[4].alvo("PACOTES=ok 1 jq\n"), "jq");
  // Só isolamento quando a reserva já existe; sem RAM lida, a reserva não entra; chromium não pedido não entra.
  const v2 = lerPreparar(saida({ reserva: 1, semiso: "box-1" }));
  assert.deepEqual(passosPreparar(["governanca"], v2).map((x) => x.titulo), ["Isolamento das boxes"]);
  const v3 = lerPreparar(saida({ reserva: 0 }).replace(/^RAM=.*\n/m, ""));
  assert.deepEqual(passosPreparar(["governanca"], v3), []);
  assert.deepEqual(passosPreparar(v.faltam, v).map((x) => x.id).includes("chromium"), false);
  // No Ubuntu o chromium é humano: pedir não gera passo.
  assert.deepEqual(passosPreparar(["chromium"], lerPreparar(saida({ os: "ubuntu", pacotes: pacotes(["chromium"]) }))), []);
});

test("preparar: pacotesSh valida nomes e protege contra o lock do apt; GH_GLOBAL_SH vai para /usr/local/bin sem a API", () => {
  assert.throws(() => pacotesSh(["jq; rm -rf /"]), /inválido/);
  assert.throws(() => pacotesSh([]), /inválido/);
  const sh = pacotesSh(["jq", "ffmpeg"]);
  assert.match(sh, /DPkg::Lock::Timeout=120/); assert.match(sh, /dpkg --configure -a/); assert.match(sh, /--no-install-recommends install \$F/); assert.match(sh, /PACOTES=ok/); assert.match(sh, /dpkg-query -W -f='\$\{Status\}'/);
  assert.match(GH_GLOBAL_SH, /install -m 755 "\$T"\/gh_\*\/bin\/gh \/usr\/local\/bin\/gh/); assert.match(GH_GLOBAL_SH, /GH=ok/);
  assert.doesNotMatch(GH_GLOBAL_SH, /\$HOME\/\.local/); assert.doesNotMatch(GH_GLOBAL_SH, /api\.github\.com/);
  assert.match(GH_GLOBAL_SH, /releases\/latest/); assert.match(GH_GLOBAL_SH, /gh_\$\{V\}_linux_\$\{A\}\.tar\.gz/);
});

test("preparar: o script de estado começa pelo guard de root, reaproveita os trechos de cota e Hermes e tem uma chave por item", () => {
  assert.match(PREPARAR_ESTADO_SH, /^\[ "\$\(id -u\)" = 0 \] \|\| \{ echo "NAOROOT"; exit 0; \}/);
  assert.ok(PREPARAR_ESTADO_SH.includes(COTA_ESTADO_SH)); assert.ok(PREPARAR_ESTADO_SH.includes(HERMES_ESTADO_SH));
  for (const k of ["RAM=", "SWAP=", "RESERVA=", "SEMISO=", "PACOTES=", "GH=", "CG=", "LP=", "OS="]) assert.ok(PREPARAR_ESTADO_SH.includes(k), k);
  assert.match(PREPARAR_ESTADO_SH, /\/usr\/local\/bin\/gh --version/); assert.match(PREPARAR_ESTADO_SH, /dpkg-query/);
  assert.deepEqual([...ORDEM_PREPARAR], ["swap", "cota", "governanca", "pacotes", "gh", "hermes", "transcritor", "claude-global", "chromium"]);
});
