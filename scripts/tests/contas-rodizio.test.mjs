/**
 * Rodízio de contas de ponta a ponta: sobe o server.js num HOME descartável com um `claude` de mentira
 * (fixtures/claude-falso.sh) que bate o limite na 2ª chamada. A conversa começa na conta isolada (ordem 1),
 * o 2º turno é rejeitado nela e segue na padrão com o mesmo --resume; o cliente recebe o aviso `tipo: conta`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(AQUI, "..", "..", "backend-colima");
const portaLivre = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function subir() {
  // realpath: no macOS /var/folders é link de /private/var; o `claude` falso usa $PWD (resolvido) para achar projects/.
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "meu-bot-rod-")));
  const root = path.join(home, "backend"); cpSync(BACKEND, root, { recursive: true });
  const fake = path.join(AQUI, "fixtures", "claude-falso.sh"); chmodSync(fake, 0o755);
  const fakeDir = path.join(home, "fake"); mkdirSync(fakeDir);
  mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "padrao@x.y" }, hasCompletedOnboarding: true }));
  const port = await portaLivre();
  writeFileSync(path.join(root, ".env"), `OPENAI_COMPAT_KEY=k\nPORT=${port}\nHOST=127.0.0.1\nCLAUDE_BIN=${fake}\nWORKSPACE=${path.join(home, "ws")}\nAGENT_WORKSPACE=${path.join(home, "ws-agente")}\n`);
  const child = spawn(process.execPath, [path.join(root, "server.js")], { cwd: root, env: { ...process.env, HOME: home, FAKE_DIR: fakeDir, OPENAI_COMPAT_SESSIONS_PATH: path.join(root, "data", "sessions.json") }, stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  child.stdout.on("data", (d) => { saida += d.toString(); }); child.stderr.on("data", (d) => { saida += d.toString(); });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`backend não subiu:\n${saida}`)), 15_000);
    const tick = () => { if (/ouvindo em/.test(saida)) { clearTimeout(t); resolve(); } else if (child.exitCode !== null) { clearTimeout(t); reject(new Error(`backend saiu:\n${saida}`)); } else setTimeout(tick, 50); };
    tick();
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, p, body) => { const r = await fetch(`${base}${p}`, { method, headers: { Authorization: "Bearer k", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };
  const turno = async (conv, texto, seen) => {
    const r = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { Authorization: "Bearer k", "Content-Type": "application/json", "X-Stream-Mode": "live", "X-Conversation-Id": conv, "X-Conversation-Seen": String(seen) }, body: JSON.stringify({ model: "claudecode", stream: true, messages: texto }) });
    const linhas = (await r.text()).split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
    return { status: r.status, resumed: r.headers.get("x-session-resumed"), texto: linhas.map((c) => c.choices?.[0]?.delta?.content ?? "").join(""), avisos: linhas.filter((c) => c.x_meu_bot?.fallback).map((c) => c.x_meu_bot.fallback) };
  };
  // Espera o processo sair antes de apagar a pasta: ele ainda grava (sessões, auditoria) ao receber o SIGTERM.
  const parar = async () => {
    const saiu = new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 6000).unref(); });
    child.kill("SIGTERM"); await saiu;
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  return { home, fakeDir, api, turno, parar, saida: () => saida };
}

test("limite na conta isolada: o mesmo turno continua na padrão com --resume e o cliente recebe o aviso tipo conta", { timeout: 60_000 }, async () => {
  const s = await subir();
  try {
    const criada = await s.api("POST", "/v1/meu-bot/contas-claude", { rotulo: "Segunda" });
    assert.equal(criada.status, 200);
    const c = criada.json.conta;
    assert.equal(c.logada, false);
    // "Login" na conta isolada: o oauthAccount na pasta dela (o que o `claude auth login` deixa).
    const f = path.join(c.home, ".claude.json");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), oauthAccount: { emailAddress: "segunda@x.y" } }));
    const conferida = await s.api("POST", `/v1/meu-bot/contas-claude/${c.id}/conferir`);
    assert.deepEqual(conferida.json.contas.map((x) => [x.id, x.logada, x.email]), [[c.id, true, "segunda@x.y"], ["padrao", true, "padrao@x.y"]]);
    assert.equal(conferida.json.atual, c.id, "a isolada vem antes da padrão");

    // Turno 1: normal, na conta isolada; registra o uso (42%) e abre a sessão.
    const msgs = [{ role: "user", content: "oi" }];
    const t1 = await s.turno("conv1", msgs, 0);
    assert.equal(t1.status, 200); assert.equal(t1.resumed, "false"); assert.deepEqual(t1.avisos, []);
    assert.match(t1.texto, new RegExp(`chamada 1 em ${c.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const depois1 = (await s.api("GET", "/v1/meu-bot/contas-claude")).json;
    assert.equal(depois1.contas[0].uso.sessao.pct, 42);
    const status1 = (await s.api("GET", "/v1/meu-bot/status")).json;
    assert.equal(status1.claude.email, "segunda@x.y"); assert.equal(status1.contas.atual, c.id); assert.equal(status1.contas.total, 2);

    // Turno 2: a isolada é rejeitada → esgotada até o reset; o turno segue na padrão com --resume da mesma sessão.
    msgs.push({ role: "assistant", content: t1.texto }, { role: "user", content: "e aí?" });
    const t2 = await s.turno("conv1", msgs, 2);
    assert.equal(t2.status, 200);
    assert.match(t2.texto, /chamada 3 em padrao/);
    assert.deepEqual(t2.avisos.map((a) => [a.from, a.to, a.tipo]), [["Segunda", "Login padrão", "conta"]]);
    const log = readFileSync(path.join(s.fakeDir, "log"), "utf8").trim().split("\n");
    assert.equal(log.length, 3);
    assert.match(log[1], new RegExp(`^2\\|${c.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|.*--resume sess-0001-aaaa`), "a 2ª chamada já retomava a sessão na isolada");
    assert.match(log[2], /^3\|\|.*--resume sess-0001-aaaa/, "a 3ª chamada retoma a mesma sessão sem CLAUDE_CONFIG_DIR (padrão)");
    const depois2 = (await s.api("GET", "/v1/meu-bot/contas-claude")).json;
    const isolada = depois2.contas.find((x) => x.id === c.id);
    assert.equal(isolada.uso.estado, "esgotada"); assert.ok(isolada.uso.ate > Math.floor(Date.now() / 1000) + 3000, "ate vem do resetsAt do evento");
    assert.equal(depois2.atual, "padrao");
    const status2 = (await s.api("GET", "/v1/meu-bot/status")).json;
    assert.equal(status2.claude.email, null, "a padrão sem profile.json não tem e-mail"); assert.equal(status2.contas.atual, "padrao"); assert.equal(status2.contas.esgotadas, 1);

    // Usar agora: sai de esgotada, mas o evento registrou 100% da sessão até o reset → fica em aviso, e a padrão segue na frente.
    const volta = (await s.api("POST", `/v1/meu-bot/contas-claude/${c.id}/usar-agora`)).json;
    assert.equal(volta.contas.find((x) => x.id === c.id).uso.estado, "aviso");
    assert.equal(volta.atual, "padrao");
    // Limiares: gravados e devolvidos (clamp 50..100; estratégia inválida vira a padrão).
    assert.deepEqual((await s.api("PUT", "/v1/meu-bot/contas-claude/limiares", { sessao: 80, semanal: 30, estrategia: "x" })).json.limiares, { sessao: 80, semanal: 50, estrategia: "ordem" });
    // Remover: a pasta some; a padrão fica.
    const removida = (await s.api("DELETE", `/v1/meu-bot/contas-claude/${c.id}`)).json;
    assert.deepEqual(removida.contas.map((x) => x.id), ["padrao"]);
    assert.equal((await s.api("DELETE", "/v1/meu-bot/contas-claude/padrao")).status, 400);
    assert.equal((await s.api("PATCH", "/v1/meu-bot/contas-claude/c-00000000", { rotulo: "x" })).status, 404);
  } catch (e) { e.message += `\n--- saída do backend ---\n${s.saida().slice(-3000)}`; throw e; }
  finally { await s.parar(); }
});
