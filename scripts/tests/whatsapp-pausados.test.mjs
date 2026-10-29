import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { waPausadosSh, parsePausados, mensagensDaPausa, chatsComPausados, WA_PAUSADOS_FILE } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-pausados.js");
const { parseWaMarks } = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-marks.js");

const chat = (number, updatedAt, name = null) => ({ number, name, alias: null, isSelf: false, sessionKeys: ["agent:main:whatsapp:dm:" + number], sessionIds: {}, ownSession: true, paused: false, pausaAte: null, updatedAt, archived: false, deleted: false });
const DIEGO = "5521923670743", NOVO = "5511988887777";
const linhas = [
  { numero: DIEGO, nome: "Diego", texto: "oi", em: "2026-10-29T13:10:00Z", tipo: "text" },
  { numero: DIEGO, nome: null, texto: "", em: "2026-10-29T13:12:00Z", tipo: "voice" },
  { numero: NOVO, nome: "Novo", texto: "primeira vez", em: "2026-10-29T13:20:00Z", tipo: "text" },
  { numero: "abc", texto: "lixo", em: "2026-10-29T13:00:00Z" },
  { numero: DIEGO, texto: "sem hora" },
  "linha que não é objeto",
];

test("parsePausados: só número e hora válidos, em ordem de hora; nome limpo; tipo padrão text", () => {
  const p = parsePausados(linhas);
  assert.deepEqual(p.map((m) => [m.numero, m.em, m.texto, m.tipo, m.nome]), [
    [DIEGO, "2026-10-29T13:10:00Z", "oi", "text", "Diego"],
    [DIEGO, "2026-10-29T13:12:00Z", "", "voice", null],
    [NOVO, "2026-10-29T13:20:00Z", "primeira vez", "text", "Novo"],
  ]);
  assert.deepEqual(parsePausados(null), []); assert.deepEqual(parsePausados("x"), []);
});

test("mensagensDaPausa: bolhas do contato marcadas como da pausa; mídia sem texto ganha o rótulo do tipo", () => {
  const m = mensagensDaPausa(parsePausados(linhas), DIEGO);
  assert.deepEqual(m, [
    { role: "contact", text: "oi", at: "2026-10-29T13:10:00Z", durantePausa: true },
    { role: "contact", text: "(áudio)", at: "2026-10-29T13:12:00Z", durantePausa: true },
  ]);
  assert.deepEqual(mensagensDaPausa(parsePausados(linhas), "5599999999999"), []);
});

test("chatsComPausados: conversa existente sobe com a mensagem da pausa (e ganha nome); quem só escreveu na pausa entra sem sessão, pausado conforme a marca", () => {
  const marks = parseWaMarks({ paused: { [NOVO]: { desde: "2026-10-29T13:00:00Z", ate: "2026-10-29T15:00:00Z" } } });
  const antes = [chat(DIEGO, "2026-10-29T12:00:00Z"), chat("5516900000001", "2026-10-29T12:30:00Z", "Outro")];
  const depois = chatsComPausados(antes, parsePausados(linhas), marks, Date.parse("2026-10-29T14:00:00Z"));
  assert.deepEqual(depois.map((c) => c.number), [NOVO, DIEGO, "5516900000001"], "ordem por atividade");
  const d = depois.find((c) => c.number === DIEGO);
  assert.equal(d.updatedAt, "2026-10-29T13:12:00Z"); assert.equal(d.name, "Diego", "nome do plugin preenche o que faltava");
  assert.equal(d.paused, false, "a marca de pausado é de applyWaMarks/whatsappChats, não daqui");
  const n = depois.find((c) => c.number === NOVO);
  assert.deepEqual(n, { number: NOVO, name: "Novo", alias: null, isSelf: false, sessionKeys: [], sessionIds: {}, ownSession: true, paused: true, pausaAte: "2026-10-29T15:00:00Z", updatedAt: "2026-10-29T13:20:00Z", archived: false, deleted: false });
  assert.equal(chatsComPausados(antes, parsePausados(linhas), marks, Date.parse("2026-10-29T16:00:00Z")).find((c) => c.number === NOVO).paused, false, "prazo vencido: não aparece pausado");
  assert.deepEqual(chatsComPausados(antes, [], marks), antes);
});

test("waPausadosSh: lê as últimas linhas do arquivo, filtra pelo número e ignora linhas quebradas (python3 de verdade)", { skip: spawnSync("python3", ["--version"]).status !== 0 }, () => {
  const home = mkdtempSync(join(tmpdir(), "pausados-"));
  mkdirSync(join(home, ".local", "share", "meu-bot"), { recursive: true });
  writeFileSync(join(home, ".local", "share", "meu-bot", "whatsapp-pausados.jsonl"), `${JSON.stringify(linhas[0])}\n{quebrada\n${JSON.stringify(linhas[2])}\n`);
  const run = (sh) => { const r = spawnSync("bash", ["-c", sh], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return JSON.parse(/^pausados=(.*)$/m.exec(r.stdout)[1]); };
  assert.equal(run(waPausadosSh()).length, 2);
  assert.deepEqual(run(waPausadosSh(DIEGO)).map((m) => m.numero), [DIEGO]);
  assert.deepEqual(run(waPausadosSh("5599999999999")), []);
  assert.ok(WA_PAUSADOS_FILE.endsWith("whatsapp-pausados.jsonl"));
  assert.throws(() => waPausadosSh("abc"), /número inválido/);
});
