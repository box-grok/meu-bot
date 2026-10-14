import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { isValidHost } from "./settings";

function log(line: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} [tunnel] ${line}\n`);
  } catch {
    /* log é cortesia */
  }
}

/** Onde o backend guarda a chave do endpoint OpenAI-compatível, na VM. */
const BACKEND_ENV_PATH = "~/.hermes/agente-rene/backend-sdk-claude/.env";
const BACKEND_KEY_NAME = "OPENAI_COMPAT_KEY";

export interface TunnelInfo {
  localPort: number;
  apiKey: string;
}

interface TunnelState {
  host: string;
  remotePort: number;
  localPort: number;
  child: ChildProcess;
  apiKey: string;
}

let current: TunnelState | undefined;
let pending: Promise<TunnelInfo> | undefined;

const sshBase = (host: string): string[] => ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new", host];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr !== null ? resolve(addr.port) : reject(new Error("porta livre não encontrada"))));
    });
    srv.on("error", reject);
  });
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

/** Lê a chave do backend direto da VM. Nunca é logada nem persistida. */
function fetchBackendKey(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const remote = `grep '^${BACKEND_KEY_NAME}=' ${BACKEND_ENV_PATH} | head -1 | cut -d= -f2-`;
    const child = spawn("ssh", [...sshBase(host), "--", remote], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString("utf8"); });
    child.on("error", (e) => reject(new Error(`Falha ao iniciar ssh: ${e.message}`)));
    child.on("close", (code) => {
      const key = out.trim().replace(/^["']|["']$/g, "").trim();
      if (code !== 0) return reject(new Error(`SSH falhou (${code}): ${err.trim().split("\n").pop() ?? ""}`));
      if (key === "") return reject(new Error(`Chave ${BACKEND_KEY_NAME} não encontrada em ${BACKEND_ENV_PATH} na VM.`));
      resolve(key);
    });
  });
}

function startForward(host: string, localPort: number, remotePort: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-N", "-v", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=10", "-o", "TCPKeepAlive=yes",
        "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, ...sshBase(host)],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    child.stderr?.on("data", (d: Buffer) => { err += d.toString("utf8"); });
    let done = false;
    const startedAt = Date.now();
    log(`ssh -N pid ${child.pid ?? "?"} iniciado para ${host}:${remotePort} em 127.0.0.1:${localPort}`);
    child.on("error", (e) => { if (!done) { done = true; reject(new Error(`Falha ao iniciar ssh: ${e.message}`)); } });
    child.on("exit", (code, signal) => {
      log(`ssh -N pid ${child.pid ?? "?"} saiu após ${Date.now() - startedAt} ms: code=${code} signal=${signal} stderr=${JSON.stringify(err.trim().slice(-400))}`);
      if (!done) { done = true; reject(new Error(`Túnel SSH encerrou (${code}): ${err.trim().split("\n").pop() ?? ""}`)); }
    });
    const started = Date.now();
    const poll = async (): Promise<void> => {
      if (done) return;
      if (await portOpen(localPort)) { done = true; resolve(child); return; }
      if (Date.now() - started > 15_000) { done = true; child.kill(); reject(new Error("Túnel SSH não abriu em 15s.")); return; }
      setTimeout(() => { void poll(); }, 250);
    };
    void poll();
  });
}

const RETRIES = 3;
const BACKOFF_MS = 3000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A VM pelo Tailscale oscila; tenta algumas vezes antes de desistir. */
async function withRetry<T>(label: string, fn: () => Promise<T>, onStatus?: (detail: string) => void): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt < RETRIES) {
        onStatus?.(`${label} falhou (${attempt}/${RETRIES}); tentando de novo…`);
        await sleep(BACKOFF_MS * attempt);
      }
    }
  }
  const msg = last instanceof Error ? last.message : String(last);
  throw new Error(`VM inacessível pelo SSH após ${RETRIES} tentativas. ${msg}`);
}

/** Garante um túnel vivo para host:remotePort e devolve porta local + chave. */
export function ensureTunnel(host: string, remotePort: number, onStatus?: (detail: string) => void): Promise<TunnelInfo> {
  if (!isValidHost(host)) return Promise.reject(new Error(`Host SSH inválido: ${JSON.stringify(host)}`));
  if (current !== undefined && current.host === host && current.remotePort === remotePort && current.child.exitCode === null) {
    return Promise.resolve({ localPort: current.localPort, apiKey: current.apiKey });
  }
  if (pending !== undefined) return pending;
  pending = (async () => {
    closeTunnel();
    onStatus?.("buscando chave do backend na VM…");
    const apiKey = await withRetry("busca da chave", () => fetchBackendKey(host), onStatus);
    onStatus?.("abrindo túnel SSH…");
    const localPort = await freePort();
    const child = await withRetry("túnel SSH", () => startForward(host, localPort, remotePort), onStatus);
    child.on("exit", () => { if (current?.child === child) current = undefined; });
    current = { host, remotePort, localPort, child, apiKey };
    return { localPort, apiKey };
  })().finally(() => { pending = undefined; });
  return pending;
}

export function closeTunnel(): void {
  if (current !== undefined) {
    current.child.kill();
    current = undefined;
  }
}

export const tunnelAlive = (): boolean => current !== undefined && current.child.exitCode === null;
