import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { BackendModel } from "../shared/ipc";
import type { MainEventChannel, MainEvents } from "../shared/ipc";
import { saveTranscript, type BackendMessage, type Conversation } from "./conversation";
import { getBackendModel, getBackendPort, getSshHost } from "./settings";
import { closeTunnel, ensureTunnel } from "./tunnel";

class Sender {
  constructor(private readonly win: BrowserWindow) {}
  send<K extends MainEventChannel>(channel: K, payload: MainEvents[K]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }
}

/** O backend achata todo o histórico num prompt; limitar mantém latência e custo baixos. */
const HISTORY_WINDOW = 12;
/** rene/rene-dm rodam ferramentas e podem levar minutos; claudecode é chat puro. */
const timeoutFor = (model: BackendModel): number => (model === "claudecode" ? 120_000 : 600_000);

interface ChatCompletion {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string; type?: string; code?: string };
}

const CONNECT_PHASE_MS = 3000;

/** Log simples em userData/meu-bot.log para diagnosticar falhas de rede. */
export function log(line: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* log é cortesia */
  }
}

const errCode = (err: unknown): string =>
  (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code ?? "";

/** Explica o erro de rede com a causa por trás e o código, para diagnóstico. */
function describeFetchError(err: unknown, model: BackendModel): string {
  const code = errCode(err);
  if (code === "ETIMEDOUT_LOCAL" || (err instanceof Error && err.name === "AbortError")) return `O backend não respondeu em ${timeoutFor(model) / 1000}s.`;
  if (code === "ECONNREFUSED") return "O túnel SSH caiu (conexão recusada na porta local). Vou reabrir na próxima mensagem.";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET" || code === "EPIPE") {
    return `A conexão com o backend foi cortada no meio da resposta (${code}). Causa provável: a VM pausou ou o túnel SSH fechou o canal. Tente de novo.`;
  }
  if (code === "ETIMEDOUT" || code === "EHOSTUNREACH") return "A VM não respondeu pela rede (Tailscale oscilando).";
  const msg = err instanceof Error ? err.message : String(err);
  return code ? `${msg} (${code})` : msg;
}

const isConnectionError = (err: unknown): boolean =>
  ["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH"].includes(errCode(err));

interface HttpReply {
  status: number;
  body: string;
}

/**
 * POST pelo túnel usando node:http. O fetch do Node (undici) corta a espera por cabeçalhos
 * em 300 s e esconde o código de rede atrás de "fetch failed"; aqui não há limite além do
 * nosso timeout, e o erro traz o código (ECONNRESET, ECONNREFUSED, ...).
 */
function httpPost(port: number, pathName: string, apiKey: string, body: string, timeoutMs: number): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathName, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${apiKey}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT_LOCAL" })));
    req.on("error", reject);
    req.end(body);
  });
}

async function postWithReconnect(host: string, localPort: number, apiKey: string, model: BackendModel, messages: BackendMessage[], out: Sender): Promise<HttpReply> {
  const body = JSON.stringify({ model, messages, stream: false });
  const started = Date.now();
  try {
    return await httpPost(localPort, "/v1/chat/completions", apiKey, body, timeoutFor(model));
  } catch (err) {
    log(`POST falhou após ${Date.now() - started} ms: ${errCode(err)} ${err instanceof Error ? err.message : String(err)}`);
    const early = Date.now() - started < CONNECT_PHASE_MS;
    if (!isConnectionError(err) || !early) throw err;
    out.send("backend:status", { state: "connecting", detail: "túnel caiu; reabrindo…" });
    closeTunnel();
    const fresh = await ensureTunnel(host, getBackendPort(), (detail) => out.send("backend:status", { state: "connecting", detail }));
    out.send("backend:status", { state: "ready", detail: `túnel reaberto · ${model}` });
    return httpPost(fresh.localPort, "/v1/chat/completions", fresh.apiKey, body, timeoutFor(model));
  }
}

const PREFLIGHT_MS = 8000;

/** GET /v1/models pelo túnel: barato e detecta um túnel meio morto depois de uma pausa da VM. */
function tunnelHealthy(localPort: number, apiKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: localPort, path: "/v1/models", method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 0) < 500);
    });
    req.setTimeout(PREFLIGHT_MS, () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
    req.end();
  });
}

/** Garante um túnel que responde: se o atual não passa na checagem, reabre uma vez. */
async function readyTunnel(host: string, out: Sender): Promise<{ localPort: number; apiKey: string }> {
  const status = (detail: string): void => out.send("backend:status", { state: "connecting", detail });
  let tunnel = await ensureTunnel(host, getBackendPort(), status);
  if (await tunnelHealthy(tunnel.localPort, tunnel.apiKey)) return tunnel;
  status("túnel sem resposta; reabrindo…");
  closeTunnel();
  tunnel = await ensureTunnel(host, getBackendPort(), status);
  if (await tunnelHealthy(tunnel.localPort, tunnel.apiKey)) return tunnel;
  throw new Error("A VM não respondeu pelo túnel, mesmo depois de reabrir. Ela pode estar pausada; tente em um minuto.");
}

export async function runBackendTurn(win: BrowserWindow, conv: Conversation, userText: string): Promise<void> {
  const out = new Sender(win);
  const host = getSshHost();
  const model = getBackendModel();
  const conversationId = conv.id;
  const cancelled = (): boolean => conv.closed || win.isDestroyed();

  conv.backendMessages.push({ role: "user", content: userText });
  out.send("chat:assistant-start", { conversationId });
  try {
    out.send("backend:status", { state: "connecting", detail: "verificando a VM…" });
    const tunnel = await readyTunnel(host, out);
    out.send("backend:status", { state: "ready", detail: `túnel ativo · ${model}` });
    if (cancelled()) return;

    const window: BackendMessage[] = conv.backendMessages.slice(-HISTORY_WINDOW);
    const t0 = Date.now();
    const res = await postWithReconnect(host, tunnel.localPort, tunnel.apiKey, model, window, out);
    log(`POST ${model} ${res.status} em ${Date.now() - t0} ms (${window.length} msgs, ${res.body.length} bytes)`);
    let data: ChatCompletion = {};
    try { data = JSON.parse(res.body) as ChatCompletion; } catch { data = {}; }
    if (res.status < 200 || res.status >= 300) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 401) throw new Error(`Backend recusou a chave: ${msg}`);
      if (res.status === 503) throw new Error(`Backend indisponível: ${msg}`);
      throw new Error(`Backend respondeu ${res.status}: ${msg}`);
    }
    const text = data.choices?.[0]?.message?.content ?? "";
    if (cancelled()) return;
    conv.backendMessages.push({ role: "assistant", content: text });
    out.send("chat:delta", { conversationId, text });
    out.send("chat:done", { conversationId, stopReason: data.choices?.[0]?.finish_reason ?? "stop" });
  } catch (err) {
    // Remove o user sem resposta para não repetir a pergunta no próximo turno.
    if (conv.backendMessages.at(-1)?.role === "user") conv.backendMessages.pop();
    const message = describeFetchError(err, model);
    if (isConnectionError(err)) closeTunnel();
    out.send("backend:status", { state: "error", detail: message });
    if (!cancelled()) out.send("chat:error", { conversationId, kind: "backend", message });
  } finally {
    saveTranscript(conv);
  }
}
