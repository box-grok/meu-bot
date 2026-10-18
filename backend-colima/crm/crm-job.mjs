#!/usr/bin/env node
/**
 * crm-job.mjs — um "turno" do CRM pelo WhatsApp (meu-bot, Pro), rodado pelo plugin meu-bot-crm na máquina:
 *   crm-job.mjs <sessionKey> [--comando "texto"]   anota a conversa desse contato (silêncio ou pedido do dono)
 *   crm-job.mjs --dono --comando "texto"            pedido do dono sem contato explícito (o agente descobre)
 *   crm-job.mjs --aplicar [n] | --descartar          responde à última proposta pendente
 *   crm-job.mjs transcricao <+N> [--desde <ms>]      imprime a conversa (usado pelo agente em modo dono)
 * Lê a conversa com `openclaw gateway call chat.history`, pede ao backend local do meu-bot (perfil "agente",
 * sessão crm:+N) que rode `streak.mjs` e devolva um bloco crm-json; manda o resumo ao dono pelo WhatsApp dele.
 * Estado em ~/.local/share/meu-bot/crm/estado.json; log em crm/crm.log. Exige licença Pro (licenca.json).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { buildPrompt, confirmIndex, lastTimestamp, mergeEstado, normalizePhone, ownerMessage, parseCrmJson, phoneOfSessionKey, threadFromHistory } from "./regras.mjs";

const HOME = os.homedir();
const BASE = path.join(HOME, ".local", "share", "meu-bot");
const DIR = path.join(BASE, "crm");
const CONFIG = path.join(BASE, "crm.json");
const LICENCA = path.join(BASE, "licenca.json");
const ESTADO = path.join(DIR, "estado.json");
const LOG = path.join(DIR, "crm.log");
const STREAK = path.join(DIR, "streak.mjs");
const ENV_FILE = process.env.MEU_BOT_BACKEND_ENV || path.join(HOME, ".hermes", "agente-rene", "backend-sdk-claude", ".env");
const PATH_EXTRA = `${HOME}/.openclaw/bin:${HOME}/.local/bin:/opt/node/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
fs.mkdirSync(DIR, { recursive: true });

const log = (line) => { try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* cortesia */ } };
const readJson = (f, dflt) => { try { const v = JSON.parse(fs.readFileSync(f, "utf8")); return v && typeof v === "object" ? v : dflt; } catch { return dflt; } };
const writeJson = (f, v) => { const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(tmp, f); };
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const optv = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };

const cfg = readJson(CONFIG, {});
const estado = readJson(ESTADO, {});
function ownerPhone() {
  if (typeof cfg.dono === "string" && cfg.dono !== "") return cfg.dono;
  const creds = readJson(path.join(HOME, ".openclaw", "credentials", "whatsapp", "default", "creds.json"), {});
  return normalizePhone(creds?.me?.id ?? "");
}
function proOk() { const l = readJson(LICENCA, {}); return l.plan === "pro" && (l.status === "active" || l.status === "trialing") && !(typeof l.expiresAt === "string" && Date.parse(l.expiresAt) < Date.now()); }
function openclaw(args, timeoutMs = 60_000) { return execFileSync("openclaw", args, { encoding: "utf8", timeout: timeoutMs, env: { ...process.env, PATH: PATH_EXTRA }, stdio: ["ignore", "pipe", "pipe"] }); }
function sendOwner(text) {
  const to = ownerPhone(); if (to === null) { log("sem número do dono: mensagem não enviada"); return; }
  try { openclaw(["message", "send", "--channel", "whatsapp", "--target", to, "--message", text, "--json"], 90_000); log(`→ dono: ${text.slice(0, 120).replace(/\n/g, " | ")}`); }
  catch (e) { log(`falha ao avisar o dono: ${e instanceof Error ? e.message : String(e)}`); }
}
function streak(args) {
  const r = spawnSync("node", [STREAK, ...args], { encoding: "utf8", timeout: 60_000, env: { ...process.env, PATH: PATH_EXTRA } });
  const line = (r.stdout || "").trim().split("\n").pop() || "";
  try { return JSON.parse(line); } catch { return { erro: (r.stderr || line || "sem resposta").slice(0, 300) }; }
}
function history(sessionKey, limit = 200) {
  const raw = openclaw(["gateway", "call", "chat.history", "--json", "--params", JSON.stringify({ sessionKey, limit })], 60_000);
  const i = raw.indexOf("{"); return JSON.parse(i >= 0 ? raw.slice(i) : raw);
}
function backendEnv() {
  const env = {}; try { for (const l of fs.readFileSync(ENV_FILE, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2]; } } catch { /* sem .env */ }
  return { key: env.OPENAI_COMPAT_KEY ?? "", port: Number(env.PORT ?? 8080), host: env.HOST ?? "127.0.0.1" };
}
function askAgent(prompt, convId) {
  const be = backendEnv(); if (be.key === "") throw new Error(`backend do meu-bot não encontrado (${ENV_FILE})`);
  const body = JSON.stringify({ model: "agente", messages: [{ role: "user", content: prompt }], stream: false });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: be.host, port: be.port, path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${be.key}`, "X-Conversation-Id": convId }, timeout: 10 * 60_000 }, (res) => {
      let s = ""; res.setEncoding("utf8"); res.on("data", (c) => { s += c; });
      res.on("end", () => { try { const j = JSON.parse(s); if (res.statusCode !== 200) reject(new Error(j.error?.message ?? `backend ${res.statusCode}`)); else resolve(String(j.choices?.[0]?.message?.content ?? "")); } catch (e) { reject(new Error(`resposta inválida do backend: ${e.message}`)); } });
    });
    req.on("timeout", () => req.destroy(new Error("o agente não respondeu em 10 min")));
    req.on("error", reject); req.write(body); req.end();
  });
}
function withLock(name, fn) {
  const lock = path.join(DIR, `lock-${name.replace(/[^\w+]/g, "_")}`);
  try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); } catch { const age = Date.now() - (fs.statSync(lock).mtimeMs || 0); if (age < 15 * 60_000) { log(`${name}: já há um job rodando; saio`); return Promise.resolve(); } fs.unlinkSync(lock); fs.writeFileSync(lock, String(process.pid)); }
  return Promise.resolve().then(fn).finally(() => { try { fs.unlinkSync(lock); } catch { /* ok */ } });
}

async function runForContact(sessionKey, command) {
  const phone = phoneOfSessionKey(sessionKey); if (phone === null) { log(`chave sem telefone: ${sessionKey}`); return; }
  const prev = estado[phone] ?? {};
  const h = history(sessionKey);
  const delta = threadFromHistory(h, typeof prev.marca === "number" ? prev.marca : 0);
  if (delta.length === 0 && command === null) { log(`${phone}: nada novo`); return; }
  const info = streak(["pipeline"]); if (info.erro) { log(`${phone}: pipeline: ${info.erro}`); if (command !== null) sendOwner(`📇 CRM: ${info.erro}`); return; }
  const found = streak(["box-find", "--phone", phone]);
  const knownBox = !found.erro && Array.isArray(found.boxes) && found.boxes.length === 1 ? found.boxes[0] : null;
  if (knownBox === null && command === null && cfg.criarSemPerguntar !== true && (found.total ?? 0) === 0) {
    // Sem box e sem pedido do dono: não cria nada sozinho; só lembra para a próxima.
    log(`${phone}: sem box no pipeline; ignorado (peça "anota no CRM" para criar)`);
    writeJson(ESTADO, mergeEstado(estado, phone, { marca: lastTimestamp(delta) || prev.marca || 0, semBox: true }));
    return;
  }
  const prompt = buildPrompt({ phone, contactName: knownBox?.name ?? h?.sessionInfo?.createdActor?.identity?.displayName ?? null, pipeline: { name: info.name, stages: info.stages, fields: (info.fields ?? []).map((f) => ({ name: f.name, type: f.type, options: (f.options ?? []).map((o) => o.name) })) }, delta, command, allowCreate: cfg.criarSemPerguntar === true, streakCli: `node ${STREAK}`, knownBox: knownBox ? { name: knownBox.name, key: knownBox.key, stage: knownBox.stage } : null });
  log(`${phone}: pedindo ao agente (${delta.length} msgs novas${command !== null ? ", com pedido do dono" : ""})`);
  const answer = await askAgent(prompt, `crm:${phone}`);
  const parsed = parseCrmJson(answer);
  const marca = lastTimestamp(delta) || prev.marca || 0;
  if (parsed === null) { log(`${phone}: resposta sem crm-json: ${answer.slice(0, 200).replace(/\n/g, " ")}`); writeJson(ESTADO, mergeEstado(estado, phone, { marca })); if (command !== null) sendOwner(`📇 CRM · ${knownBox?.name ?? phone}: não consegui estruturar a anotação desta vez. Resposta do agente:\n${answer.slice(0, 500)}`); return; }
  const next = mergeEstado(estado, phone, { marca, nome: knownBox?.name ?? prev.nome ?? null, propostas: parsed.propostas, propostasEm: parsed.propostas.length > 0 ? Date.now() : null });
  if (parsed.propostas.length > 0) next.ultimaProposta = phone;
  writeJson(ESTADO, next);
  log(`${phone}: aplicado ${parsed.aplicado.length}, propostas ${parsed.propostas.length}`);
  if (parsed.aplicado.length > 0 || parsed.propostas.length > 0 || command !== null) sendOwner(ownerMessage(knownBox?.name ?? prev.nome ?? phone, parsed));
}

async function runForOwner(command) {
  const list = (() => { try { const raw = openclaw(["gateway", "call", "sessions.list", "--json", "--params", JSON.stringify({ limit: 60 })]); const i = raw.indexOf("{"); const j = JSON.parse(raw.slice(i)); return Array.isArray(j.sessions) ? j.sessions : []; } catch { return []; } })();
  const dono = ownerPhone();
  const recentes = list.map((s) => ({ key: s.key ?? s.sessionKey, at: s.updatedAt ?? 0 })).filter((s) => typeof s.key === "string" && s.key.includes(":direct:") && phoneOfSessionKey(s.key) !== dono).sort((a, b) => b.at - a.at).slice(0, 15);
  const info = streak(["pipeline"]); if (info.erro) { sendOwner(`📇 CRM: ${info.erro}`); return; }
  const prompt = [
    `O dono pediu agora, pelo WhatsApp: "${command}".`,
    `Descubra de qual contato ele fala: use \`node ${STREAK} box-find --name "..."\` no pipeline "${info.name}" e, se precisar da conversa recente do contato, \`node ${path.join(DIR, "crm-job.mjs")} transcricao +N\` (devolve JSON com as mensagens).`,
    `Contatos com conversa recente (telefone · quando): ${recentes.map((s) => `${phoneOfSessionKey(s.key)} · ${new Date(s.at).toISOString().slice(0, 16)}`).join("; ") || "(nenhum)"}.`,
    buildPrompt({ phone: "(a descobrir)", contactName: null, pipeline: { name: info.name, stages: info.stages, fields: (info.fields ?? []).map((f) => ({ name: f.name, type: f.type, options: (f.options ?? []).map((o) => o.name) })) }, delta: [], command, allowCreate: cfg.criarSemPerguntar === true, streakCli: `node ${STREAK}`, knownBox: null }).split("\n\n").slice(1).join("\n\n"),
    "Se o pedido do dono for explícito (ex.: \"crie o box do Fulano\", \"mova para Acordo\"), isso vale como confirmação: faça e relate em `aplicado`.",
  ].join("\n\n");
  log(`dono: pedido "${command.slice(0, 80)}"`);
  const answer = await askAgent(prompt, "crm:dono");
  const parsed = parseCrmJson(answer);
  if (parsed === null) { sendOwner(`📇 CRM: não consegui estruturar. Resposta do agente:\n${answer.slice(0, 600)}`); return; }
  if (parsed.propostas.length > 0) { const next = mergeEstado(estado, "dono", { propostas: parsed.propostas, propostasEm: Date.now() }); next.ultimaProposta = "dono"; writeJson(ESTADO, next); }
  sendOwner(ownerMessage("pedido", parsed));
}

function applyPending(index) {
  const who = estado.ultimaProposta; const pend = who ? estado[who]?.propostas ?? [] : [];
  if (!who || pend.length === 0) { sendOwner("📇 CRM: não há proposta pendente."); return; }
  const chosen = index === null ? pend : pend.filter((_, i) => i + 1 === index);
  if (chosen.length === 0) { sendOwner(`📇 CRM: não existe a proposta ${index}.`); return; }
  const lines = [];
  for (const p of chosen) { const r = streak([p.acao, ...p.args]); lines.push(r.erro ? `✗ ${p.texto}: ${r.erro}` : `✓ ${p.texto}`); log(`aplicar ${p.acao} ${JSON.stringify(p.args)} → ${r.erro ?? "ok"}`); }
  const rest = index === null ? [] : pend.filter((_, i) => i + 1 !== index);
  const next = mergeEstado(estado, who, { propostas: rest, propostasEm: rest.length > 0 ? estado[who].propostasEm : null }); if (rest.length === 0) delete next.ultimaProposta; writeJson(ESTADO, next);
  sendOwner(`📇 CRM · ${estado[who]?.nome ?? who}\n${lines.join("\n")}`);
}
function discardPending() {
  const who = estado.ultimaProposta; if (!who) { sendOwner("📇 CRM: não há proposta pendente."); return; }
  const next = mergeEstado(estado, who, { propostas: [], propostasEm: null }); delete next.ultimaProposta; writeJson(ESTADO, next);
  log(`${who}: propostas descartadas`); sendOwner("📇 CRM: proposta descartada.");
}

(async () => {
  if (argv[0] === "transcricao") {
    const phone = normalizePhone(argv[1]); if (phone === null) { console.log(JSON.stringify({ erro: "uso: transcricao +N" })); process.exit(1); }
    const since = Number(optv("desde") ?? 0) || 0;
    const h = history(`agent:main:whatsapp:direct:${phone}`);
    console.log(JSON.stringify({ telefone: phone, mensagens: threadFromHistory(h, since).slice(-80) })); return;
  }
  if (!proOk()) { log("sem plano Pro ativo nesta máquina; nada feito"); return; }
  if (typeof cfg.apiKey !== "string" || cfg.apiKey === "") { log("crm.json sem apiKey; nada feito"); return; }
  if (flag("aplicar")) { const n = optv("aplicar"); const idx = n !== null && /^\d+$/.test(n) ? Number(n) : confirmIndex(optv("texto") ?? ""); return withLock("aplicar", () => applyPending(idx)); }
  if (flag("descartar")) return withLock("aplicar", () => discardPending());
  const command = optv("comando");
  if (flag("dono")) return withLock("dono", () => runForOwner(command ?? ""));
  const sessionKey = argv.find((a) => a.startsWith("agent:")); if (!sessionKey) { console.error("uso: crm-job.mjs <sessionKey> [--comando txt] | --dono --comando txt | --aplicar [n] | --descartar"); process.exit(2); }
  return withLock(phoneOfSessionKey(sessionKey) ?? sessionKey, () => runForContact(sessionKey, command));
})().catch((e) => { log(`erro: ${e instanceof Error ? e.stack ?? e.message : String(e)}`); process.exit(1); });
