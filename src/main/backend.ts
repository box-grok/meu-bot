import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { BackendModel } from "../shared/ipc";
import type { MainEventChannel, MainEvents } from "../shared/ipc";
import { persistConversations, saveTranscript, type BackendMessage, type Conversation } from "./conversation";
import { alreadySeenPrefix, buildSummaryRequest, planContext, toWire, validateSummary, type OutgoingMessage } from "./context";
import { applyOps, buildMemoryRequest, getMemory, memorySystemMessage, NOTAS_MAX, parseOps, PERFIL_MAX, setMemory } from "./memory";
import { getBackendPort, getContextBudget, getMemoryEveryTurns } from "./settings";
import { ensureTunnel, markDegraded } from "./tunnel";

class Sender {
  constructor(private readonly win: BrowserWindow) {}
  send<K extends MainEventChannel>(channel: K, payload: MainEvents[K]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }
}

/** agente/rene/rene-dm rodam ferramentas e podem levar minutos; claudecode é chat puro. */
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
  /** Corpo JSON completo (resposta não-stream ou erro). Vazio quando veio SSE. */
  body: string;
  /** Texto acumulado dos deltas quando veio SSE. */
  streamed: string;
  finishReason: string | null;
  headers: http.IncomingHttpHeaders;
}

interface PostOptions {
  overallMs: number;
  idleMs: number;
  signal?: AbortSignal | undefined;
  onDelta?: ((text: string) => void) | undefined;
  extraHeaders?: Record<string, string> | undefined;
}

/**
 * POST pelo túnel usando node:http. Pede SSE ao vivo; se o backend responder JSON (backend antigo,
 * 401, 503) cai no caminho normal. Sem o limite oculto de 300 s do fetch, e o erro traz o código.
 */
function httpPostStream(port: number, pathName: string, apiKey: string, body: string, opts: PostOptions): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathName, method: "POST",
        headers: {
          "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream, application/json", "X-Stream-Mode": "live", ...(opts.extraHeaders ?? {}),
        } },
      (res) => {
        const isSse = (res.headers["content-type"] ?? "").includes("text/event-stream");
        const chunks: Buffer[] = [];
        let buffer = "";
        let streamed = "";
        let finishReason: string | null = null;
        let streamError: Error | null = null;
        let idle: NodeJS.Timeout | null = null;
        const bumpIdle = (): void => {
          if (idle !== null) clearTimeout(idle);
          idle = setTimeout(() => req.destroy(Object.assign(new Error("sem dados"), { code: "ETIMEDOUT_LOCAL" })), opts.idleMs);
        };
        const handleEvent = (block: string): void => {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") return;
            let chunk: { choices?: { delta?: { content?: string }; finish_reason?: string | null }[]; error?: { message?: string } };
            try { chunk = JSON.parse(data) as typeof chunk; } catch { continue; }
            const choice = chunk.choices?.[0];
            if (typeof choice?.delta?.content === "string" && choice.delta.content !== "") {
              streamed += choice.delta.content;
              opts.onDelta?.(choice.delta.content);
            }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (chunk.error?.message) streamError = new Error(chunk.error.message);
          }
        };
        res.on("data", (c: Buffer) => {
          bumpIdle();
          if (!isSse) { chunks.push(c); return; }
          buffer += c.toString("utf8");
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            handleEvent(buffer.slice(0, sep));
            buffer = buffer.slice(sep + 2);
            sep = buffer.indexOf("\n\n");
          }
        });
        res.on("end", () => {
          if (idle !== null) clearTimeout(idle);
          if (isSse && buffer.trim() !== "") handleEvent(buffer);
          if (streamError !== null && streamed === "") { reject(streamError); return; }
          resolve({ status: res.statusCode ?? 0, body: isSse ? "" : Buffer.concat(chunks).toString("utf8"), streamed, finishReason, headers: res.headers });
        });
        res.on("error", reject);
        bumpIdle();
      },
    );
    req.setTimeout(opts.overallMs, () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT_LOCAL" })));
    req.on("error", reject);
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) { req.destroy(Object.assign(new Error("cancelado"), { code: "ABORTED" })); return; }
      opts.signal.addEventListener("abort", () => req.destroy(Object.assign(new Error("cancelado"), { code: "ABORTED" })), { once: true });
    }
    req.end(body);
  });
}

const IDLE_MS = 60_000;

async function postWithReconnect(host: string, localPort: number, apiKey: string, model: BackendModel, messages: OutgoingMessage[], out: Sender | null, signal?: AbortSignal, onDelta?: (text: string) => void, extraHeaders?: Record<string, string>): Promise<HttpReply> {
  const body = JSON.stringify({ model, messages: toWire(messages), stream: true });
  const opts: PostOptions = { overallMs: timeoutFor(model), idleMs: IDLE_MS, signal, onDelta, extraHeaders };
  const started = Date.now();
  try {
    return await httpPostStream(localPort, "/v1/chat/completions", apiKey, body, opts);
  } catch (err) {
    log(`POST falhou após ${Date.now() - started} ms: ${errCode(err)} ${err instanceof Error ? err.message : String(err)}`);
    const early = Date.now() - started < CONNECT_PHASE_MS;
    if (!isConnectionError(err) || !early) throw err;
    out?.send("backend:status", { host, state: "connecting", detail: "túnel caiu; reabrindo…" });
    markDegraded(host, errCode(err));
    const fresh = await ensureTunnel(host, getBackendPort(), (detail) => out?.send("backend:status", { host, state: "connecting", detail }));
    out?.send("backend:status", { host, state: "ready", detail: `túnel reaberto · ${model}` });
    return httpPostStream(fresh.localPort, "/v1/chat/completions", fresh.apiKey, body, opts);
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
async function readyTunnel(host: string, out: Sender | null): Promise<{ localPort: number; apiKey: string }> {
  const status = (detail: string): void => out?.send("backend:status", { host, state: "connecting", detail });
  let tunnel = await ensureTunnel(host, getBackendPort(), status);
  if (await tunnelHealthy(tunnel.localPort, tunnel.apiKey)) return tunnel;
  status("túnel sem resposta; reabrindo…");
  markDegraded(host, "preflight");
  tunnel = await ensureTunnel(host, getBackendPort(), status);
  if (await tunnelHealthy(tunnel.localPort, tunnel.apiKey)) return tunnel;
  throw new Error("A VM não respondeu pelo túnel, mesmo depois de reabrir. Ela pode estar pausada; tente em um minuto.");
}

/** Uma chamada completa ao backend (túnel pronto + POST + parse). Reutilizada pelo chat e pelas tarefas de fundo. */
export async function chatCompletion(host: string, model: BackendModel, messages: OutgoingMessage[], out: Sender | null, signal?: AbortSignal, onDelta?: (text: string) => void, extraHeaders?: Record<string, string>): Promise<{ text: string; finishReason: string; streamed: boolean; resumed: boolean }> {
  const tunnel = await readyTunnel(host, out);
  out?.send("backend:status", { host, state: "ready", detail: `túnel ativo · ${model}` });
  const t0 = Date.now();
  const res = await postWithReconnect(host, tunnel.localPort, tunnel.apiKey, model, messages, out, signal, onDelta, extraHeaders);
  const streamed = res.body === "";
  const resumed = String(res.headers["x-session-resumed"] ?? "") === "true";
  log(`POST ${model} ${res.status} em ${Date.now() - t0} ms (${messages.length} msgs, ${streamed ? `sse ${res.streamed.length} chars` : `${res.body.length} bytes`}${resumed ? ", sessão retomada" : ""})`);
  if (streamed) return { text: res.streamed, finishReason: res.finishReason ?? "stop", streamed: true, resumed };
  let data: ChatCompletion = {};
  try { data = JSON.parse(res.body) as ChatCompletion; } catch { data = {}; }
  if (res.status < 200 || res.status >= 300) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new Error(`Backend recusou a chave: ${msg}`);
    if (res.status === 503) throw new Error(`Backend indisponível: ${msg}`);
    throw new Error(`Backend respondeu ${res.status}: ${msg}`);
  }
  return { text: data.choices?.[0]?.message?.content ?? "", finishReason: data.choices?.[0]?.finish_reason ?? "stop", streamed: false, resumed };
}

/** Fila serial de tarefas de fundo (resumo, memória): nunca duas ao mesmo tempo no túnel. */
let background: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): void {
  background = background.then(task).catch((err) => log(`background: ${err instanceof Error ? err.message : String(err)}`));
}

function sendContext(out: Sender, conv: Conversation, sent: number, mode: "full" | "summary" | "truncated"): void {
  out.send("chat:context", {
    conversationId: conv.id, sent, total: conv.backendMessages.length, mode, summarizing: conv.summarizing,
    ...(conv.summary === undefined ? {} : { summaryUpdatedAt: conv.summary.updatedAt }),
  });
}

const today = (): string => new Date().toLocaleDateString("pt-BR");

/** Resume em background a faixa do meio; falha mantém o resumo anterior. */
function scheduleSummary(out: Sender, conv: Conversation, range: [number, number], lastMode: "full" | "summary" | "truncated"): void {
  if (conv.summarizing || range[1] <= range[0]) return;
  conv.summarizing = true;
  sendContext(out, conv, 0, lastMode);
  enqueue(async () => {
    try {
      const turns = conv.backendMessages.slice(range[0], range[1]);
      const req = buildSummaryRequest(conv.summary?.text, turns, today());
      const { text } = await chatCompletion(conv.host, "claudecode", req, null);
      const valid = validateSummary(text);
      if (valid === null) { log(`resumo inválido para ${conv.id}; mantendo o anterior`); return; }
      if (conv.closed) return;
      conv.summary = { text: valid, coveredUntil: range[1], updatedAt: new Date().toISOString() };
      persistConversations();
      log(`resumo atualizado para ${conv.id}: cobre até ${range[1]} (${valid.length} chars)`);
    } finally {
      conv.summarizing = false;
      if (!conv.closed) sendContext(out, conv, 0, conv.summary === undefined ? lastMode : "summary");
    }
  });
}

/** A cada N turnos do usuário, extrai fatos duráveis para a memória local. */
function maybeExtractMemory(out: Sender, conv: Conversation): void {
  const every = getMemoryEveryTurns();
  if (every <= 0) return;
  conv.userTurnsSinceMemory += 1;
  if (conv.userTurnsSinceMemory < every) return;
  conv.userTurnsSinceMemory = 0;
  persistConversations();
  const turns = conv.backendMessages.slice(-every * 2);
  enqueue(async () => {
    const before = getMemory();
    const { text } = await chatCompletion(conv.host, "claudecode", buildMemoryRequest(before, turns), null);
    const ops = parseOps(text);
    if (ops.length === 0) { log(`memória: nada a guardar para ${conv.id}`); return; }
    const next = applyOps(before, ops, { notas: NOTAS_MAX, perfil: PERFIL_MAX });
    if (next.applied === 0) return;
    const saved = setMemory({ notas: next.notas, perfil: next.perfil });
    log(`memória: ${next.applied} operação(ões) aplicada(s)`);
    out.send("memory:changed", { ...saved, limits: { notas: NOTAS_MAX, perfil: PERFIL_MAX } });
  });
}

export async function runBackendTurn(win: BrowserWindow, conv: Conversation, userText: string): Promise<void> {
  const out = new Sender(win);
  const host = conv.host;
  const model = conv.model;
  const conversationId = conv.id;
  const cancelled = (): boolean => conv.closed || win.isDestroyed();
  const abort = new AbortController();
  conv.abort = abort;
  let partial = "";

  conv.backendMessages.push({ role: "user", content: userText });
  out.send("chat:assistant-start", { conversationId });
  try {
    out.send("backend:status", { host, state: "connecting", detail: "verificando a VM…" });
    const plan = planContext(conv.backendMessages, conv.summary, getContextBudget());
    sendContext(out, conv, plan.sentCount, plan.mode);
    const memory = memorySystemMessage();
    const outgoing = memory === undefined ? plan.outgoing : [memory, ...plan.outgoing];
    // Retomada de sessão no backend: diz quantas mensagens do começo ele já conhece.
    const seen = alreadySeenPrefix(plan.outgoing, conv.serverSeen);
    const headers = { "X-Conversation-Id": conversationId, "X-Conversation-Seen": String(seen) };
    log(`contexto ${conversationId}: modo=${plan.mode} enviadas=${plan.sentCount}/${conv.backendMessages.length}${memory === undefined ? "" : " +memória"} seen=${seen}`);
    const { text, finishReason, streamed, resumed } = await chatCompletion(host, model, outgoing, out, abort.signal, (delta) => {
      partial += delta;
      if (!cancelled()) out.send("chat:delta", { conversationId, text: delta });
    }, headers);
    if (cancelled()) return;
    conv.backendMessages.push({ role: "assistant", content: text });
    conv.serverSeen = conv.backendMessages.length;
    conv.lastResumed = resumed;
    if (!streamed) out.send("chat:delta", { conversationId, text });
    out.send("chat:done", { conversationId, stopReason: finishReason, resumed });
    out.send("backend:status", { host, state: "ready", detail: `túnel ativo · ${model}${resumed ? " · sessão retomada ↻" : " · sessão nova"}` });
    // Com a sessão retomada o servidor já tem todo o contexto; resumir no cliente seria desperdício.
    if (plan.needsSummary && !resumed) scheduleSummary(out, conv, plan.summarizeRange, plan.mode);
    maybeExtractMemory(out, conv);
  } catch (err) {
    if (errCode(err) === "ABORTED") {
      // Cancelado pelo usuário: guarda o que já veio, ou desfaz a pergunta.
      if (partial.trim() !== "") conv.backendMessages.push({ role: "assistant", content: `${partial}\n\n[interrompido]` });
      else if (conv.backendMessages.at(-1)?.role === "user") conv.backendMessages.pop();
      if (!cancelled()) out.send("chat:done", { conversationId, stopReason: "cancelled" });
      return;
    }
    if (partial.trim() !== "") {
      // Resposta parcial vale mais que nada; marca o corte.
      conv.backendMessages.push({ role: "assistant", content: `${partial}\n\n[resposta interrompida]` });
    } else if (conv.backendMessages.at(-1)?.role === "user") {
      conv.backendMessages.pop();
    }
    const message = describeFetchError(err, model);
    if (isConnectionError(err)) markDegraded(host, errCode(err));
    out.send("backend:status", { host, state: "error", detail: message });
    if (!cancelled()) out.send("chat:error", { conversationId, kind: "backend", message });
  } finally {
    delete conv.abort;
    saveTranscript(conv);
  }
}
