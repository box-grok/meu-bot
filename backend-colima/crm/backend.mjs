/**
 * backend.mjs — como os scripts do CRM (crm.mjs, crm-job.mjs, importar-streak.mjs) falam com o backend local do
 * meu-bot nesta máquina: lê OPENAI_COMPAT_KEY/HOST/PORT do .env do backend e faz as chamadas HTTP de /v1/crm/*.
 * Sem npm. Erros viram Error com `.code` (`backend_fora`, `crm_license`, `http`) para a CLI traduzir.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/**
 * Pasta do backend do meu-bot nesta máquina, a mesma regra do app (backend-dir-core.ts) e do install.sh: a própria
 * (~/.local/share/meu-bot/backend) quando tem server.js; a herdada do Hermes só se o server.js de lá é o nosso (tem a
 * rota meu-bot/hello); senão a própria. Na grokbot-1 a herdada é o backend do Hermes: ler o .env de lá era pegar
 * chave e porta erradas (404 em tudo). MEU_BOT_BACKEND_ENV força um .env.
 */
export function backendDir() {
  const propria = path.join(os.homedir(), ".local", "share", "meu-bot", "backend");
  const herdada = path.join(os.homedir(), ".hermes", "agente-rene", "backend-sdk-claude");
  if (fs.existsSync(path.join(propria, "server.js"))) return propria;
  try { if (fs.readFileSync(path.join(herdada, "server.js"), "utf8").includes("meu-bot/hello")) return herdada; } catch { /* sem server.js lá */ }
  return propria;
}
export const ENV_FILE = process.env.MEU_BOT_BACKEND_ENV || path.join(backendDir(), ".env");

/** Chave e endereço do backend desta máquina (do .env dele). */
export function backendEnv() {
  const env = {};
  try { for (const l of fs.readFileSync(ENV_FILE, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2]; } } catch { /* sem .env */ }
  // Chave própria do agente: o servidor carimba a identidade por ela e recusa exclusão. Sem ela (máquina ainda não
  // atualizada), cai na chave do app e avisa uma vez que está no modo antigo, para a pessoa reinstalar o backend.
  const propria = env.CRM_AGENT_KEY ?? "";
  if (propria === "" && !backendEnv.avisou) { backendEnv.avisou = true; process.stderr.write("aviso: sem CRM_AGENT_KEY no .env; usando a chave do app (reinstale o backend)\n"); }
  return { key: propria || (env.OPENAI_COMPAT_KEY ?? ""), port: Number(env.PORT ?? 8080), host: env.HOST ?? "127.0.0.1" };
}

/** Uma chamada a /v1/crm<caminho>. Devolve o JSON; lança Error com .code e .status em falha. */
export function crmApi(method, caminho, body, { por = "agente", timeoutMs = 30_000 } = {}) {
  const be = backendEnv();
  if (be.key === "") { const e = new Error(`backend do meu-bot não encontrado nesta máquina (${ENV_FILE})`); e.code = "backend_fora"; return Promise.reject(e); }
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: be.host, port: be.port, path: `/v1/crm${caminho}`, method, headers: { Accept: "application/json", Authorization: `Bearer ${be.key}`, "X-Crm-Por": por, ...(data === null ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }) }, timeout: timeoutMs }, (res) => {
      let s = ""; res.setEncoding("utf8"); res.on("data", (c) => { s += c; });
      res.on("end", () => {
        let j = null; try { j = s === "" ? null : JSON.parse(s); } catch { j = null; }
        if (res.statusCode === 200) return resolve(j);
        const msg = j?.error?.message ?? `backend respondeu ${res.statusCode}`;
        const e = new Error(msg); e.status = res.statusCode; e.code = j?.error?.code ?? "http"; e.box = j?.error?.box; reject(e);
      });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("o backend não respondeu a tempo"), { code: "backend_fora" })));
    req.on("error", (err) => { const e = new Error(err.code === "ECONNREFUSED" ? "backend do meu-bot não está rodando nesta máquina (systemctl --user status meu-bot-backend)" : err.message); e.code = "backend_fora"; reject(e); });
    if (data !== null) req.write(data);
    req.end();
  });
}
