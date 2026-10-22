/**
 * backend.mjs — como os scripts do financeiro (finance.mjs, o plugin meu-bot-finance) falam com o backend local do
 * meu-bot nesta máquina: lê OPENAI_COMPAT_KEY/HOST/PORT do .env do backend e faz as chamadas HTTP de /v1/finance/*.
 * Sem npm. Erros viram Error com `.code` (`backend_fora`, `finance_license`, `http`) para a CLI traduzir.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

export const ENV_FILE = process.env.MEU_BOT_BACKEND_ENV || path.join(os.homedir(), ".hermes", "agente-rene", "backend-sdk-claude", ".env");

/** Chave e endereço do backend desta máquina (do .env dele). */
export function backendEnv() {
  const env = {};
  try { for (const l of fs.readFileSync(ENV_FILE, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2]; } } catch { /* sem .env */ }
  return { key: env.OPENAI_COMPAT_KEY ?? "", port: Number(env.PORT ?? 8080), host: env.HOST ?? "127.0.0.1" };
}

/** Uma chamada a /v1/finance<caminho>. Devolve o JSON; lança Error com .code e .status em falha. */
export function financeApi(method, caminho, body, { por = "agente", timeoutMs = 30_000 } = {}) {
  const be = backendEnv();
  if (be.key === "") { const e = new Error(`backend do meu-bot não encontrado nesta máquina (${ENV_FILE})`); e.code = "backend_fora"; return Promise.reject(e); }
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: be.host, port: be.port, path: `/v1/finance${caminho}`, method, headers: { Accept: "application/json", Authorization: `Bearer ${be.key}`, "X-Finance-Por": por, ...(data === null ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }) }, timeout: timeoutMs }, (res) => {
      let s = ""; res.setEncoding("utf8"); res.on("data", (c) => { s += c; });
      res.on("end", () => {
        let j = null; try { j = s === "" ? null : JSON.parse(s); } catch { j = null; }
        if (res.statusCode === 200) return resolve(j);
        const msg = j?.error?.message ?? `backend respondeu ${res.statusCode}`;
        const e = new Error(msg); e.status = res.statusCode; e.code = j?.error?.code ?? "http"; e.extra = j?.error; reject(e);
      });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("o backend não respondeu a tempo"), { code: "backend_fora" })));
    req.on("error", (err) => { const e = new Error(err.code === "ECONNREFUSED" ? "backend do meu-bot não está rodando nesta máquina (systemctl --user status meu-bot-backend)" : err.message); e.code = "backend_fora"; reject(e); });
    if (data !== null) req.write(data);
    req.end();
  });
}
