import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
// restauro-core.ts importa google-core e whatsapp-capacidades sem extensao (como o resto do main): o teste le o compilado em dist/.
const { CONJUNTOS_DADOS, lerTar } = createRequire(import.meta.url)("../../dist/main/google/google-core.js");
const { caminhosDoConjunto, comandoRestaurarSh, copiasDeBackup, decisaoRestauroDados, exclusoesPorMotor, homeAntigoDoTar, linhaSshRestaurar, parseConferirRestauro, parseNomePacote, servicosDoConjunto, CONFERIR_RESTAURO_SH } = createRequire(import.meta.url)("../../dist/main/google/restauro-core.js");

const conj = (id) => CONJUNTOS_DADOS.find((c) => c.id === id);
const escrever = (base, rel, txt) => { mkdirSync(join(base, rel, ".."), { recursive: true }); writeFileSync(join(base, rel), txt); };
/** Um .tar.gz de `home` com os caminhos relativos, como o backup no Drive faz (`tar -C $HOME`). */
const empacotar = (home, caminhos, saida) => execFileSync("tar", ["-C", home, "-czf", saida, ...caminhos]);

test("parseNomePacote: conjunto, maquina e data pelo nome; .age so nos cifrados; o que nao e nosso e null", () => {
  const p = parseNomePacote("agente-agente-box-lv-2026-10-26.tar.gz.age");
  assert.equal(p.conjunto.id, "agente"); assert.equal(p.maquina, "agente-box-lv"); assert.equal(p.data, "2026-10-26"); assert.equal(p.cifrado, true);
  assert.equal(parseNomePacote("trabalho-meu-root-2026-11-01.tar.gz").conjunto.id, "trabalho");
  assert.equal(parseNomePacote("crm-box-2026-10-26.tar.gz"), null, "crm sem cifra nao e nosso");
  assert.equal(parseNomePacote("trabalho-box-2026-10-26.tar.gz.age"), null, "trabalho cifrado nao e nosso");
  assert.equal(parseNomePacote("foto.png"), null);
  assert.equal(parseNomePacote("conversa-whatsapp-2026-10-26-1200.md"), null);
});

test("copiasDeBackup: Drive e Mac fundidos por nome, o mais novo por conjunto, a maquina atual primeiro, conjuntos na ordem", () => {
  const drive = [
    { id: "d1", name: "agente-agente-box-lv-2026-10-26.tar.gz.age", size: 40 },
    { id: "d2", name: "trabalho-agente-box-lv-2026-10-26.tar.gz", size: 2 },
    { id: "d3", name: "trabalho-meu-root-openclaw-box-1-2026-11-05.tar.gz", size: 3 },
    { id: "d4", name: "trabalho-meu-root-openclaw-box-1-2026-11-04.tar.gz", size: 1 },
    { id: "dx", name: "lixo.txt", size: 9 },
  ];
  const locais = [
    { name: "trabalho-agente-box-lv-2026-10-26.tar.gz", bytes: 2, caminho: "/Mac/trabalho-agente-box-lv-2026-10-26.tar.gz" },
    { name: "crm-agente-box-lv-2026-10-26.tar.gz.age", bytes: 5, caminho: "/Mac/crm-agente-box-lv-2026-10-26.tar.gz.age" },
    { name: "crm-agente-box-lv-2026-10-20.tar.gz.age", bytes: 4, caminho: "/Mac/velho" },
  ];
  const r = copiasDeBackup(drive, locais, "meu-root-openclaw-box-1");
  assert.deepEqual(r.map((m) => m.maquina), ["meu-root-openclaw-box-1", "agente-box-lv"]);
  const atual = r[0].conjuntos;
  assert.equal(atual.length, 1); assert.equal(atual[0].data, "2026-11-05"); assert.equal(atual[0].driveId, "d3"); assert.equal(atual[0].origem, "drive");
  const lv = r[1].conjuntos;
  assert.deepEqual(lv.map((c) => c.conjunto), ["crm", "agente", "trabalho"], "na ordem de CONJUNTOS_DADOS");
  const trab = lv.find((c) => c.conjunto === "trabalho");
  assert.equal(trab.origem, "ambos"); assert.equal(trab.driveId, "d2"); assert.equal(trab.local, "/Mac/trabalho-agente-box-lv-2026-10-26.tar.gz");
  const crm = lv.find((c) => c.conjunto === "crm");
  assert.equal(crm.origem, "local"); assert.equal(crm.data, "2026-10-26"); assert.equal(crm.cifrado, true);
  assert.deepEqual(copiasDeBackup([], [], "x"), []);
});

test("homeAntigoDoTar: pelo .claude.json, pelo openclaw.json ou pelo nome da pasta de projeto; sem pista = null", () => {
  const raiz = mkdtempSync(join(tmpdir(), "mb-home-"));
  try {
    const a = join(raiz, "a"); escrever(a, ".claude.json", JSON.stringify({ projects: { "/home/box-lv/agent-workspace": {}, "/home/box-lv": {} } }));
    empacotar(a, [".claude.json"], join(raiz, "a.tgz"));
    assert.equal(homeAntigoDoTar(gunzipSync(readFileSync(join(raiz, "a.tgz")))), "/home/box-lv");
    const b = join(raiz, "b"); escrever(b, ".claude/projects/-home-box-lv-agent-workspace/s.jsonl", "{}"); escrever(b, ".claude/skills/x/SKILL.md", "#");
    empacotar(b, [".claude"], join(raiz, "b.tgz"));
    assert.equal(homeAntigoDoTar(gunzipSync(readFileSync(join(raiz, "b.tgz")))), "/home/box-lv");
    const c = join(raiz, "c"); escrever(c, ".claude/projects/-root-agent-workspace/s.jsonl", "{}");
    empacotar(c, [".claude"], join(raiz, "c.tgz"));
    assert.equal(homeAntigoDoTar(gunzipSync(readFileSync(join(raiz, "c.tgz")))), "/root");
    const d = join(raiz, "d"); escrever(d, ".openclaw/openclaw.json", JSON.stringify({ workspace: "/home/agente-box/.openclaw/workspace" }));
    empacotar(d, [".openclaw"], join(raiz, "d.tgz"));
    assert.equal(homeAntigoDoTar(gunzipSync(readFileSync(join(raiz, "d.tgz")))), "/home/agente-box");
    const e = join(raiz, "e"); escrever(e, ".local/share/meu-bot/crm/db/contatos.json", "{}");
    empacotar(e, [".local"], join(raiz, "e.tgz"));
    assert.equal(homeAntigoDoTar(gunzipSync(readFileSync(join(raiz, "e.tgz")))), null);
    assert.equal(homeAntigoDoTar(Buffer.from("nao e tar")), null);
    // lerTar: nomes sem ./, conteudo so dos arquivos
    const ents = lerTar(gunzipSync(readFileSync(join(raiz, "b.tgz"))));
    assert.ok(ents.some((x) => x.nome === ".claude/projects/-home-box-lv-agent-workspace/s.jsonl" && x.conteudo.toString() === "{}"));
    assert.ok(ents.every((x) => !x.nome.startsWith("./")));
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test("motor manda nas exclusoes; o ledger desta maquina nunca e restaurado; servicos por conjunto", () => {
  assert.deepEqual(exclusoesPorMotor("openclaw"), [".hermes"]);
  assert.deepEqual(exclusoesPorMotor("hermes"), [".openclaw"]);
  assert.deepEqual(exclusoesPorMotor(""), []);
  const t = caminhosDoConjunto(conj("trabalho"), "openclaw");
  assert.ok(!t.includes(".hermes")); assert.ok(t.includes("agent-workspace")); assert.ok(!t.some((x) => x.endsWith("auditoria.jsonl")));
  assert.ok(caminhosDoConjunto(conj("trabalho"), "hermes").includes(".hermes"));
  const cred = caminhosDoConjunto(conj("credenciais"), "openclaw");
  assert.ok(cred.includes(".openclaw")); assert.ok(!cred.some((x) => x.startsWith(".hermes")));
  assert.ok(!caminhosDoConjunto(conj("credenciais"), "hermes").includes(".openclaw"));
  assert.deepEqual(servicosDoConjunto({ id: "crm" }), ["meu-bot-backend"]);
  assert.deepEqual(servicosDoConjunto({ id: "agente" }), []);
  assert.deepEqual(servicosDoConjunto({ id: "credenciais" }), ["openclaw-gateway", "meu-bot-backend"]);
});

test("pre-voo: parse do conferir e a decisao (espaco, WhatsApp vivo so com substituir, avisos)", () => {
  const c = parseConferirRestauro("MOTOR=openclaw\nLIVRE_MB=74000\nWHATSAPP_PAREADO=1\nBACKEND_UNIT=1\nGATEWAY=active\nHOME=/home/box-1\n");
  assert.deepEqual(c, { motor: "openclaw", livreMb: 74000, whatsappPareado: true, backendUnit: true, gateway: "active", home: "/home/box-1" });
  assert.equal(parseConferirRestauro("MOTOR=\nHOME=/x").motor, "");
  let d = decisaoRestauroDados(c, ["agente", "trabalho"], 50 * 1048576, false, false);
  assert.deepEqual(d.bloqueios, []); assert.deepEqual(d.avisos, []);
  d = decisaoRestauroDados(c, ["credenciais"], 1, false, false);
  assert.match(d.bloqueios[0], /já há um WhatsApp pareado/);
  d = decisaoRestauroDados(c, ["credenciais"], 1, true, true);
  assert.deepEqual(d.bloqueios, []); assert.match(d.avisos[0], /vai ser trocado/); assert.match(d.avisos[1], /desta própria máquina/);
  d = decisaoRestauroDados({ ...c, livreMb: 300 }, ["agente"], 100 * 1048576, false, false);
  assert.match(d.bloqueios[0], /pouco espaço/);
  d = decisaoRestauroDados({ ...c, home: "" }, ["agente"], 1, false, false);
  assert.match(d.bloqueios[0], /não respondeu/);
  assert.match(decisaoRestauroDados({ ...c, motor: "" }, ["trabalho"], 1, false, false).avisos[0], /motor/);
  assert.match(CONFERIR_RESTAURO_SH, /MOTOR=\$MOTOR/); assert.match(CONFERIR_RESTAURO_SH, /LIVRE_MB=/);
  assert.match(linhaSshRestaurar("echo x"), /^bash -c "\$\(printf %s '[A-Za-z0-9+/=]+' \| base64 -d\)" meu-bot-restaurar$/);
});

// Comandos falsos no PATH (systemctl) anotam as chamadas e nunca tocam no Mac.
function ambiente() {
  const raiz = mkdtempSync(join(tmpdir(), "mb-rest-"));
  const fakes = join(raiz, "fakes"); mkdirSync(fakes);
  const log = join(raiz, "chamadas.log"); writeFileSync(log, "");
  writeFileSync(join(fakes, "systemctl"), `#!/bin/sh\necho "systemctl $*" >> "${log}"\ncase "$*" in *is-active*) [ -f "${raiz}/ativo-$3" ] && exit 0 || exit 3;; esac; exit 0\n`); chmodSync(join(fakes, "systemctl"), 0o755);
  return { raiz, log, env: (home) => ({ HOME: home, PATH: `${fakes}:/usr/bin:/bin`, TMPDIR: raiz }) };
}
const roda = (script, env, pacote) => spawnSync("bash", ["-c", script], { env, input: readFileSync(pacote), encoding: "utf8", maxBuffer: 64 * 1048576 });

test("comandoRestaurarSh: trabalho da box-lv entra na box-1 (OpenClaw): sem .hermes, por cima do que ha, com o home trocado e o que foi sobrescrito guardado", () => {
  const a = ambiente();
  const origem = join(a.raiz, "box-lv"); const destino = join(a.raiz, "box-1");
  const OLDSLUG = origem.replace(/\//g, "-"); const NEWSLUG = destino.replace(/\//g, "-");
  escrever(origem, "agent-workspace/CLAUDE.md", "# da LV");
  escrever(origem, "chat-workspace/notas.md", "notas antigas");
  escrever(origem, ".hermes/SOUL.md", "hermes velho");
  escrever(origem, ".claude.json", JSON.stringify({ projects: { [`${origem}/agent-workspace`]: { allowedTools: ["Bash"] } }, oauthAccount: { emailAddress: "lv@x" } }));
  escrever(origem, ".local/share/meu-bot/crm.json", JSON.stringify({ pasta: `${origem}/.local/share/meu-bot/crm` }));
  escrever(origem, ".local/share/meu-bot/auditoria.jsonl", '{"hash":"velho"}\n');
  escrever(origem, ".local/share/meu-bot/objetivo.json", '{"objetivo":"da LV"}');
  mkdirSync(join(origem, ".local/share/meu-bot/crm"), { recursive: true });
  symlinkSync(`${origem}/.local/share/meu-bot/crm`, join(origem, "agent-workspace/crm-link"));
  const pacote = join(a.raiz, "trabalho.tgz");
  empacotar(origem, ["agent-workspace", "chat-workspace", ".hermes", ".claude.json", ".local/share/meu-bot/crm.json", ".local/share/meu-bot/auditoria.jsonl", ".local/share/meu-bot/objetivo.json"], pacote);
  // O destino ja vive: tem o CLAUDE.md dele, conversas de hoje, o proprio ledger e o proprio .claude.json.
  escrever(destino, "agent-workspace/CLAUDE.md", "# da box-1");
  escrever(destino, "agent-workspace/so-daqui.md", "fica");
  escrever(destino, ".claude.json", JSON.stringify({ projects: { [`${destino}/agent-workspace`]: { allowedTools: ["Read"] } }, oauthAccount: { emailAddress: "box1@x" }, hasCompletedOnboarding: true }));
  escrever(destino, ".local/share/meu-bot/auditoria.jsonl", '{"hash":"meu"}\n');
  escrever(destino, ".local/share/meu-bot/whatsapp-agente", "openclaw");
  writeFileSync(join(a.raiz, "ativo-meu-bot-backend"), "");
  const r = roda(comandoRestaurarSh({ conjunto: conj("trabalho"), motor: "openclaw", homeAntigo: origem, substituirWhatsapp: false }), a.env(destino), pacote);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RESTAURADO=ok/);
  const antes = /ANTES=(\S+)/.exec(r.stdout)[1];
  // por cima: o da LV entrou, o que so a box-1 tinha ficou, e o sobrescrito esta na pasta de seguranca
  assert.equal(readFileSync(join(destino, "agent-workspace/CLAUDE.md"), "utf8"), "# da LV");
  assert.equal(readFileSync(join(destino, "agent-workspace/so-daqui.md"), "utf8"), "fica");
  assert.equal(readFileSync(join(antes, "agent-workspace/CLAUDE.md"), "utf8"), "# da box-1");
  assert.equal(readFileSync(join(destino, "chat-workspace/notas.md"), "utf8"), "notas antigas");
  assert.match(r.stdout, /GUARDADOS=2/, "CLAUDE.md e .claude.json; a auditoria e barrada e nao conta");
  // maquina OpenClaw: o .hermes da LV nao entra; o ledger desta maquina nao muda
  assert.ok(!existsSync(join(destino, ".hermes")));
  assert.equal(readFileSync(join(destino, ".local/share/meu-bot/auditoria.jsonl"), "utf8"), '{"hash":"meu"}\n');
  assert.equal(readFileSync(join(destino, ".local/share/meu-bot/objetivo.json"), "utf8"), '{"objetivo":"da LV"}');
  // home trocado: crm.json aponta para o novo; .claude.json e o da box-1 com os projetos da LV (chave trocada) somados
  assert.equal(JSON.parse(readFileSync(join(destino, ".local/share/meu-bot/crm.json"), "utf8")).pasta, `${destino}/.local/share/meu-bot/crm`);
  const cj = JSON.parse(readFileSync(join(destino, ".claude.json"), "utf8"));
  assert.equal(cj.oauthAccount.emailAddress, "box1@x"); assert.equal(cj.hasCompletedOnboarding, true);
  assert.deepEqual(cj.projects[`${destino}/agent-workspace`].allowedTools, ["Read"], "o projeto que a box-1 ja tinha vence");
  assert.ok(!Object.keys(cj.projects).some((k) => k.startsWith(origem)), "nenhuma chave com o home antigo");
  // link que apontava para dentro do home antigo
  assert.equal(readlinkSync(join(destino, "agent-workspace/crm-link")), `${destino}/.local/share/meu-bot/crm`);
  // o backend parou e voltou
  const log = readFileSync(a.log, "utf8");
  assert.match(log, /systemctl --user stop meu-bot-backend/); assert.match(log, /systemctl --user start meu-bot-backend/);
  assert.doesNotMatch(log, /openclaw-gateway/);
  assert.ok(!existsSync(join(destino, ".meu-bot-restauracao")) || readdirSync(join(destino, ".meu-bot-restauracao")).length === 0, "temporario apagado");
  void OLDSLUG; void NEWSLUG;
  rmSync(a.raiz, { recursive: true, force: true });
});

test("comandoRestaurarSh: agente: as conversas da LV entram ao lado das de hoje (pasta de projeto renomeada e mesclada, cwd trocado)", () => {
  const a = ambiente();
  const origem = join(a.raiz, "box-lv"); const destino = join(a.raiz, "box-1");
  const OLDSLUG = origem.replace(/\//g, "-"); const NEWSLUG = destino.replace(/\//g, "-");
  escrever(origem, `.claude/projects/${OLDSLUG}-agent-workspace/antiga.jsonl`, `{"cwd":"${origem}/agent-workspace","type":"user"}\n`);
  escrever(origem, `.claude/projects/${OLDSLUG}-agent-workspace/memory/MEMORY.md`, "memoria da LV");
  escrever(origem, `.claude/projects/${OLDSLUG}-chat-workspace/c.jsonl`, "{}\n");
  escrever(origem, ".claude/skills/minha/SKILL.md", "skill da LV");
  const pacote = join(a.raiz, "agente.tgz");
  empacotar(origem, [".claude/projects", ".claude/skills"], pacote);
  escrever(destino, `.claude/projects/${NEWSLUG}-agent-workspace/hoje.jsonl`, `{"cwd":"${destino}/agent-workspace"}\n`);
  escrever(destino, `.claude/projects/${NEWSLUG}-agent-workspace/memory/MEMORY.md`, "memoria da box-1");
  const r = roda(comandoRestaurarSh({ conjunto: conj("agente"), motor: "openclaw", homeAntigo: origem, substituirWhatsapp: false }), a.env(destino), pacote);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /MESCLADOS=1/); assert.match(r.stdout, /RESTAURADO=ok/);
  const proj = join(destino, `.claude/projects/${NEWSLUG}-agent-workspace`);
  assert.ok(existsSync(join(proj, "hoje.jsonl")), "a de hoje continua");
  assert.ok(existsSync(join(proj, "antiga.jsonl")), "a da LV entrou ao lado");
  assert.match(readFileSync(join(proj, "antiga.jsonl"), "utf8"), new RegExp(`"cwd":"${destino.replace(/[/.]/g, "\\$&")}/agent-workspace"`), "cwd trocado");
  assert.equal(readFileSync(join(proj, "memory/MEMORY.md"), "utf8"), "memoria da box-1", "o que a box-1 ja tinha vence");
  assert.ok(existsSync(join(destino, `.claude/projects/${NEWSLUG}-chat-workspace/c.jsonl`)), "pasta que nao existia e renomeada");
  assert.ok(!existsSync(join(destino, `.claude/projects/${OLDSLUG}-agent-workspace`)), "nada fica com o nome antigo");
  assert.equal(readFileSync(join(destino, ".claude/skills/minha/SKILL.md"), "utf8"), "skill da LV");
  assert.doesNotMatch(readFileSync(a.log, "utf8"), /stop/, "agente nao para servico nenhum");
  rmSync(a.raiz, { recursive: true, force: true });
});

test("comandoRestaurarSh: credenciais com WhatsApp vivo recusa sem substituir; com substituir para e religa o gateway; caminho perigoso recusa tudo", () => {
  const a = ambiente();
  const origem = join(a.raiz, "box-lv"); const destino = join(a.raiz, "box-1");
  escrever(origem, ".openclaw/credentials/whatsapp/default/creds.json", '{"me":"lv"}');
  escrever(origem, ".config/kommo/token", "t");
  const pacote = join(a.raiz, "cred.tgz");
  empacotar(origem, [".openclaw", ".config"], pacote);
  escrever(destino, ".openclaw/credentials/whatsapp/default/creds.json", '{"me":"box1"}');
  writeFileSync(join(a.raiz, "ativo-openclaw-gateway"), "");
  let r = roda(comandoRestaurarSh({ conjunto: conj("credenciais"), motor: "openclaw", homeAntigo: null, substituirWhatsapp: false }), a.env(destino), pacote);
  assert.equal(r.status, 65); assert.match(r.stderr, /já há um WhatsApp pareado/);
  assert.equal(readFileSync(join(destino, ".openclaw/credentials/whatsapp/default/creds.json"), "utf8"), '{"me":"box1"}', "nada mudou");
  assert.doesNotMatch(readFileSync(a.log, "utf8"), /stop/);
  r = roda(comandoRestaurarSh({ conjunto: conj("credenciais"), motor: "openclaw", homeAntigo: null, substituirWhatsapp: true }), a.env(destino), pacote);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(destino, ".openclaw/credentials/whatsapp/default/creds.json"), "utf8"), '{"me":"lv"}');
  const antes = /ANTES=(\S+)/.exec(r.stdout)[1];
  assert.equal(readFileSync(join(antes, ".openclaw/credentials/whatsapp/default/creds.json"), "utf8"), '{"me":"box1"}', "o de antes esta guardado");
  const log = readFileSync(a.log, "utf8");
  assert.match(log, /stop openclaw-gateway/); assert.match(log, /start openclaw-gateway/);
  // caminho perigoso: um tar com ../ fora do home
  // (o tar de linha de comando tira o ../ ao criar; o pacote malicioso e montado a mao)
  spawnSync("python3", ["-c", `import tarfile,io; t=tarfile.open(${JSON.stringify(join(a.raiz, "mal.tgz"))},"w:gz"); i=tarfile.TarInfo("../fora.txt"); i.size=1; t.addfile(i, io.BytesIO(b"x")); t.close()`], { encoding: "utf8" });
  r = roda(comandoRestaurarSh({ conjunto: conj("trabalho"), motor: "openclaw", homeAntigo: null, substituirWhatsapp: false }), a.env(destino), join(a.raiz, "mal.tgz"));
  assert.notEqual(r.status, 0); assert.match(r.stderr, /caminho perigoso/);
  assert.ok(!existsSync(join(destino, "fora.txt")) && !existsSync(join(a.raiz, "fora.txt")));
  rmSync(a.raiz, { recursive: true, force: true });
});
