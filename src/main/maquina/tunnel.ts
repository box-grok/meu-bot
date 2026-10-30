/**
 * Túneis SSH para os backends, um por host, no padrão do Hermes Desktop: um ControlMaster
 * autenticado uma vez por host, clientes leves (chave, forward, checagens) pendurados nele,
 * máquina de estados por host e revalidação após o Mac acordar. Nada aqui é logado com segredo.
 *
 * Cada conversa pertence a um host; conversas em hosts diferentes convivem com túneis
 * independentes. Trocar o host padrão nas Configurações não mexe em túnel nenhum.
 */
import { controlDir } from "../app/control-dir";
import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { isValidHost } from "../app/settings";
import { checkLocalBackend, ensureLocalBackend, LOCAL_HOST, localBackendAlive, onLocalBackendExit, stopLocalBackend } from "./localBackend";

export type TunnelState = "idle" | "connecting" | "ready" | "degraded" | "error";

export interface TunnelInfo {
  localPort: number;
  apiKey: string;
}

/** Onde o backend guarda a chave do endpoint OpenAI-compatível, na VM. */
import { BACKEND_DIR_CANONICAL, BACKEND_DIR_SH } from "./backend-dir-core";
const BACKEND_KEY_NAME = "OPENAI_COMPAT_KEY";
const CONTROL_PERSIST_S = 600;
const FORWARD_RESTART_BUDGET = 5;
const RETRIES = 3;
const BACKOFF_MS = 3000;

/** Erro que não adianta repetir (host sem backend, por exemplo). */
export class TunnelFatalError extends Error {}
/** Começo do erro de máquina sem o backend: a janela reconhece por ele e oferece instalar ali mesmo. */
export const SEM_BACKEND_MSG = "Esta máquina ainda não tem o backend do meu-bot";
export const ehSemBackend = (detail: string): boolean => detail.startsWith(SEM_BACKEND_MSG);

/** Túnel reverso (-R): a máquina alcança um socket Unix deste Mac em 127.0.0.1:<remotePort> (ações do agente no Navegador). */
interface Reverse { child: ChildProcess; remotePort: number; localSocket: string; restarts: number; since: number }
interface Live {
  remotePort: number;
  localPort: number;
  apiKey: string;
  forward: ChildProcess;
  forwardRestarts: number;
  reverse?: Reverse;
}

interface HostTunnel {
  host: string;
  state: TunnelState;
  live: Live | undefined;
  pending: Promise<TunnelInfo> | undefined;
  stopping: boolean;
  suspect: boolean;
  /** Socket local que a máquina deve alcançar por -R (null = nenhum). O reconcile abre/fecha conforme. */
  reverseWanted: string | null;
  reverseBusy: boolean;
  /** Porta do backend do último túnel aberto: o vigia do -R reconstrói o túnel sem esperar a janela pedir. */
  lastRemotePort?: number;
}

const hosts = new Map<string, HostTunnel>();
const listeners = new Set<(host: string, s: TunnelState, detail: string) => void>();

export function log(line: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "meu-bot.log"), `${new Date().toISOString()} [tunnel] ${line}\n`);
  } catch {
    /* log é cortesia */
  }
}

function entry(host: string): HostTunnel {
  let h = hosts.get(host);
  if (h === undefined) { h = { host, state: "idle", live: undefined, pending: undefined, stopping: false, suspect: false, reverseWanted: null, reverseBusy: false }; hosts.set(host, h); }
  return h;
}

function setState(h: HostTunnel, next: TunnelState, detail: string): void {
  if (h.state !== next) log(`[${h.host}] state ${h.state}→${next} (${detail})`);
  h.state = next;
  for (const cb of listeners) cb(h.host, next, detail);
  // Túnel de volta (aberto, reconstruído ou revalidado depois de acordar): o -R do Navegador volta junto.
  if (next === "ready" && h.reverseWanted !== null) queueMicrotask(() => { void reconcileReverse(h); });
}

export const getTunnelState = (host: string): TunnelState => hosts.get(host)?.state ?? "idle";
export function onTunnelState(cb: (host: string, s: TunnelState, detail: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}


const muxOpts = (host: string): string[] => [
  "-o", `ControlPath=${path.join(controlDir(), "cm-%C")}`,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=3",
  "-o", "TCPKeepAlive=yes",
  "--", host,
];

interface RunResult { code: number | null; stdout: string; stderr: string }

function runSsh(args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    const timer = setTimeout(() => { if (!done) { child.kill("SIGKILL"); } }, timeoutMs);
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}\n${e.message}` }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } });
  });
}

const lastLine = (s: string): string => s.trim().split("\n").filter((l) => !l.startsWith("debug")).pop() ?? "";

/** `-O check`: o master responde? */
async function masterAlive(host: string): Promise<boolean> {
  const r = await runSsh(["-O", "check", ...muxOpts(host)], 5000);
  return r.code === 0;
}

/** Inicia o master em background (-f devolve depois de autenticar). */
async function startMaster(host: string): Promise<void> {
  const t0 = Date.now();
  const r = await runSsh(["-M", "-N", "-f", "-o", "ControlMaster=yes", "-o", `ControlPersist=${CONTROL_PERSIST_S}`, ...muxOpts(host)], 40_000);
  if (r.code !== 0) throw new Error(`SSH não conectou (${r.code ?? "timeout"}): ${lastLine(r.stderr) || "sem detalhes"}`);
  log(`[${host}] master up em ${Date.now() - t0} ms`);
}

async function exitMaster(host: string): Promise<void> {
  const r = await runSsh(["-O", "exit", ...muxOpts(host)], 5000);
  log(`[${host}] master exit rc=${r.code}`);
}

/** Garante um master vivo; reusa o existente quando `-O check` passa. */
async function ensureMaster(host: string): Promise<void> {
  if (await masterAlive(host)) { log(`[${host}] master reused (-O check ok)`); return; }
  await startMaster(host);
  if (!(await masterAlive(host))) throw new Error("Master SSH subiu mas não responde ao -O check.");
}

/** Para o terminal: garante o master e devolve os argumentos de um `ssh` que pega carona nele (termina em `-- host`). */
export async function sshMuxArgs(host: string): Promise<string[]> {
  await ensureMaster(host);
  return ["-o", "ControlMaster=no", ...muxOpts(host)];
}

/** Executa um comando remoto pelo master. */
async function execViaMux(host: string, command: string, timeoutMs: number): Promise<RunResult> {
  return runSsh(["-o", "ControlMaster=no", ...muxOpts(host), command], timeoutMs);
}

/** Lê a chave do backend direto da VM. Nunca é logada nem persistida. */
async function fetchBackendKey(host: string): Promise<string> {
  const t0 = Date.now();
  const r = await execViaMux(host, `${BACKEND_DIR_SH}; grep '^${BACKEND_KEY_NAME}=' "$BD/.env" 2>/dev/null | head -1 | cut -d= -f2-`, 15_000);
  if (r.code !== 0 && r.code !== 1) throw new Error(`Falha ao ler a chave do backend (${r.code ?? "timeout"}): ${lastLine(r.stderr)}`);
  const key = r.stdout.trim().replace(/^["']|["']$/g, "").trim();
  if (key === "") {
    throw new TunnelFatalError(`${SEM_BACKEND_MSG} (sem .env em ${BACKEND_DIR_CANONICAL}). Use "Instalar backend" aqui na janela ou no seletor de máquinas.`);
  }
  log(`[${host}] key fetched via mux em ${Date.now() - t0} ms`);
  return key;
}

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

/**
 * Forward -L como cliente do master; pronto quando a porta local aceita conexão.
 * Pelo mux, o `ssh -N` é uma sessão do master e termina quando o stdin fecha: o stdin fica
 * num pipe aberto enquanto o filho viver.
 */
function startForward(h: HostTunnel, localPort: number, remotePort: number): Promise<ChildProcess> {
  return spawnForward(h.host, localPort, remotePort, (child) => onForwardExit(h, child));
}
/** Abre o `ssh -N -L` pelo master; `afterExit` roda se ele morrer depois de pronto (cada dono decide o que refazer). */
function spawnForward(host: string, localPort: number, remotePort: number, afterExit: (child: ChildProcess) => void): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-N", "-v", "-o", "ControlMaster=no", "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, ...muxOpts(host)],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    child.stdin?.on("error", () => { /* fechou antes; o exit cuida */ });
    let err = "";
    let done = false;
    const startedAt = Date.now();
    log(`[${host}] forward pid ${child.pid ?? "?"} 127.0.0.1:${localPort}→${remotePort} iniciando`);
    const finish = (ok: boolean, reason: string): void => {
      if (done) return;
      done = true;
      if (ok) { log(`[${host}] forward pid ${child.pid ?? "?"} pronto em ${Date.now() - startedAt} ms`); resolve(child); }
      else { child.kill(); reject(new Error(reason)); }
    };
    child.stderr?.on("data", (d: Buffer) => { err += d.toString("utf8"); });
    const poll = async (): Promise<void> => {
      while (!done) {
        if (await portOpen(localPort)) { finish(true, ""); return; }
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    void poll();
    child.on("error", (e) => finish(false, `Falha ao iniciar ssh: ${e.message}`));
    child.on("exit", (code, signal) => {
      log(`[${host}] forward pid ${child.pid ?? "?"} saiu após ${Date.now() - startedAt} ms: code=${code} signal=${signal} stderr=${JSON.stringify(lastLine(err).slice(-300))}`);
      if (!done) finish(false, `Túnel SSH encerrou (${code}): ${lastLine(err) || "sem detalhes"}`);
      else afterExit(child);
    });
    setTimeout(() => finish(false, "Túnel SSH não abriu em 20s."), 20_000);
  });
}

/** O forward morreu com o app vivo: reconstrói, com orçamento de reinícios. */
function onForwardExit(h: HostTunnel, child: ChildProcess): void {
  if (h.stopping || h.live === undefined || h.live.forward !== child) return;
  h.live.forwardRestarts += 1;
  setState(h, "degraded", "forward exited");
  const restarts = h.live.forwardRestarts;
  const { remotePort } = h.live;
  setTimeout(() => {
    if (h.stopping || h.live === undefined || h.live.forward !== child) return;
    if (restarts > FORWARD_RESTART_BUDGET) { log(`[${h.host}] orçamento de reinícios esgotado; refazendo o master`); h.live = undefined; return; }
    void rebuildForward(h, remotePort).catch((e) => log(`[${h.host}] rebuild do forward falhou: ${e instanceof Error ? e.message : String(e)}`));
  }, 1000);
}

async function rebuildForward(h: HostTunnel, remotePort: number): Promise<void> {
  if (h.live === undefined) return;
  const forward = await startForward(h, h.live.localPort, remotePort);
  h.live.forward = forward;
  setState(h, "ready", "forward reaberto");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Forwards além do backend (hoje: a tela noVNC do painel Computador), um por host e porta remota, no mesmo master.
 * Não se refazem sozinhos: quem usa pede de novo (o painel faz isso no "Reconectar"). Caem junto com o túnel do host.
 */
const extras = new Map<string, { child: ChildProcess; localPort: number }>();
const extraKey = (host: string, remotePort: number): string => `${host}\u0000${remotePort}`;
export async function ensureForwardExtra(host: string, remotePort: number): Promise<number> {
  const k = extraKey(host, remotePort);
  const cur = extras.get(k);
  if (cur !== undefined && cur.child.exitCode === null && await portOpen(cur.localPort)) return cur.localPort;
  if (cur !== undefined) { cur.child.stdin?.end(); cur.child.kill(); extras.delete(k); }
  await ensureMaster(host);
  const localPort = await freePort();
  const child = await spawnForward(host, localPort, remotePort, (c) => { if (extras.get(k)?.child === c) extras.delete(k); });
  extras.set(k, { child, localPort });
  return localPort;
}
function closeForwardExtras(host: string): void {
  for (const [k, e] of extras) {
    if (!k.startsWith(`${host}\u0000`)) continue;
    e.child.stdin?.end(); e.child.kill(); extras.delete(k);
  }
}
/** Comando remoto pelo master (abre o master se preciso). Para quem não é o túnel do backend (ex.: a tela). */
export async function execNaMaquina(host: string, command: string, timeoutMs: number): Promise<RunResult> {
  await ensureMaster(host);
  return execViaMux(host, command, timeoutMs);
}

async function withRetry<T>(label: string, fn: () => Promise<T>, onStatus?: (detail: string) => void): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TunnelFatalError) throw err;
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

/** Checagem real: master responde e um exec pelo mux retorna (o -O check sozinho engana após sleep). */
export async function checkTunnel(host: string): Promise<boolean> {
  if (host === LOCAL_HOST) return checkLocalBackend();
  const h = hosts.get(host);
  if (h === undefined || h.live === undefined || h.live.forward.exitCode !== null) return false;
  if (!(await masterAlive(host))) { log(`[${host}] check: master não responde`); return false; }
  const r = await execViaMux(host, "true", 10_000);
  if (r.code !== 0) { log(`[${host}] check: exec pelo mux falhou (${r.code ?? "timeout"})`); return false; }
  return portOpen(h.live.localPort);
}

export function markDegraded(host: string, reason: string): void {
  const h = hosts.get(host);
  if (h === undefined) return;
  if (host !== LOCAL_HOST && h.live === undefined) return;
  setState(h, "degraded", reason);
}

onLocalBackendExit((reason) => markDegraded(LOCAL_HOST, reason));

/** "local": sem SSH; o backend é um processo filho deste Mac. */
function ensureLocal(h: HostTunnel, onStatus?: (detail: string) => void): Promise<TunnelInfo> {
  if (h.pending !== undefined) return h.pending;
  h.pending = (async () => {
    try {
      if (h.state !== "ready" || !localBackendAlive()) setState(h, "connecting", "subindo backend local");
      const info = await ensureLocalBackend(onStatus);
      setState(h, "ready", "backend local pronto");
      return info;
    } catch (err) {
      setState(h, "error", err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      h.pending = undefined;
    }
  })();
  return h.pending;
}

/** Garante túnel vivo para host:remotePort e devolve porta local + chave. Reconstrói o que estiver ruim. */
export function ensureTunnel(host: string, remotePort: number, onStatus?: (detail: string) => void): Promise<TunnelInfo> {
  if (!isValidHost(host)) return Promise.reject(new Error(`Host SSH inválido: ${JSON.stringify(host)}`));
  const h = entry(host);
  if (host === LOCAL_HOST) return ensureLocal(h, onStatus);
  if (h.pending !== undefined) return h.pending;
  h.lastRemotePort = remotePort;
  h.pending = (async () => {
    try {
      const live = h.live;
      const sameTarget = live !== undefined && live.remotePort === remotePort;
      if (live !== undefined && sameTarget && live.forward.exitCode === null && h.state === "ready" && !h.suspect) {
        return { localPort: live.localPort, apiKey: live.apiKey };
      }
      if (live !== undefined && sameTarget && (h.state === "degraded" || h.suspect)) {
        log(`[${host}] ensureTunnel: revalidando (state=${h.state} suspect=${h.suspect})`);
        h.suspect = false;
        onStatus?.("verificando o túnel…");
        if (await checkTunnel(host)) { setState(h, "ready", "revalidado"); return { localPort: live.localPort, apiKey: live.apiKey }; }
        log(`[${host}] túnel não passou na checagem; reconstruindo`);
      }
      h.stopping = true;
      await teardown(h, false);
      h.stopping = false;
      setState(h, "connecting", "abrindo");
      onStatus?.(`conectando a ${host}…`);
      await withRetry("conexão SSH", () => ensureMaster(host), onStatus);
      onStatus?.("lendo a chave do backend…");
      const apiKey = await withRetry("leitura da chave", () => fetchBackendKey(host), onStatus);
      onStatus?.("abrindo túnel…");
      const localPort = await freePort();
      const forward = await withRetry("túnel SSH", () => startForward(h, localPort, remotePort), onStatus);
      h.live = { remotePort, localPort, apiKey, forward, forwardRestarts: 0 };
      setState(h, "ready", "túnel pronto");
      return { localPort, apiKey };
    } catch (err) {
      setState(h, "error", err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      h.pending = undefined;
    }
  })();
  return h.pending;
}

// ---- Túnel reverso para o Navegador: `ssh -R 127.0.0.1:P:<socket>` como cliente do master. Estado desejado por
// host (setReverseWanted); o reconcile abre quando o túnel principal está pronto e fecha quando ninguém quer mais.
const REVERSE_RESTART_BUDGET = 5;
const reverseListeners = new Set<(host: string, state: "up" | "down" | "connecting", port: number | null) => void>();
export function onReverseState(cb: (host: string, state: "up" | "down" | "connecting", port: number | null) => void): () => void { reverseListeners.add(cb); return () => reverseListeners.delete(cb); }
const tellReverse = (host: string, state: "up" | "down" | "connecting", port: number | null): void => { for (const cb of reverseListeners) cb(host, state, port); };
export const reversePort = (host: string): number | null => hosts.get(host)?.live?.reverse?.remotePort ?? null;

/** Quer (ou não) o -R para este socket; abre já se o túnel estiver pronto, senão na próxima vez que ficar. */
export function setReverseWanted(host: string, localSocket: string | null): void {
  const h = entry(host);
  h.reverseWanted = localSocket;
  if (localSocket !== null) startReverseKeeper();
  void reconcileReverse(h);
}
/**
 * Vigia do -R (a cada 30 s): o agente do WhatsApp usa o Navegador a qualquer hora, não só quando alguém olha a janela.
 * Com o -R pedido e fora (queda longa de rede, Mac que acordou, orçamento de reinícios esgotado), reconstrói o túnel
 * principal (que reabre o -R ao ficar pronto) ou só o -R.
 */
let reverseKeeper: ReturnType<typeof setInterval> | null = null;
function startReverseKeeper(): void {
  if (reverseKeeper !== null) return;
  reverseKeeper = setInterval(() => {
    for (const h of hosts.values()) {
      if (h.reverseWanted === null || h.host === LOCAL_HOST || h.pending !== undefined || h.reverseBusy || h.stopping) continue;
      if (h.live?.reverse !== undefined && h.live.reverse.child.exitCode === null) continue;
      if (h.state === "ready" && h.live !== undefined) { void reconcileReverse(h); continue; }
      if (h.lastRemotePort === undefined) continue;
      log(`[${h.host}] vigia do navegador: túnel fora (${h.state}); reconstruindo`);
      void ensureTunnel(h.host, h.lastRemotePort).catch((e: unknown) => log(`[${h.host}] vigia do navegador: ${e instanceof Error ? e.message : String(e)}`));
    }
  }, 30_000);
  reverseKeeper.unref?.();
}
async function reconcileReverse(h: HostTunnel): Promise<void> {
  if (h.reverseBusy) return;
  h.reverseBusy = true;
  try {
    const live = h.live;
    if (h.reverseWanted === null) { if (live?.reverse !== undefined) { await stopReverse(h.host, live); delete live.reverse; tellReverse(h.host, "down", null); } return; }
    if (live === undefined || h.state !== "ready") return;
    if (live.reverse !== undefined && live.reverse.child.exitCode === null && live.reverse.localSocket === h.reverseWanted) return;
    if (live.reverse !== undefined) { await stopReverse(h.host, live); delete live.reverse; }
    tellReverse(h.host, "connecting", null);
    const rev = await startReverse(h, h.reverseWanted, 0);
    live.reverse = rev;
    tellReverse(h.host, "up", rev.remotePort);
  } catch (e) {
    log(`[${h.host}] reverso: ${e instanceof Error ? e.message : String(e)}`);
    tellReverse(h.host, "down", null);
  } finally { h.reverseBusy = false; }
}
/** Porta livre na máquina (python3 já é exigido pelo terminal); sem python, uma determinística pelo nome. */
async function remoteFreePort(host: string): Promise<number> {
  const r = await execViaMux(host, `python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])' 2>/dev/null`, 10_000);
  const n = Number.parseInt(r.stdout.trim(), 10);
  if (Number.isInteger(n) && n > 1024) return n;
  let hsh = 0; for (const ch of host) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return 19000 + (hsh % 1000);
}
function startReverse(h: HostTunnel, localSocket: string, restarts: number): Promise<Reverse> {
  const { host } = h;
  return new Promise((resolve, reject) => {
    void (async () => {
      const remotePort = await remoteFreePort(host);
      const child = spawn("ssh", ["-N", "-o", "ControlMaster=no", "-o", "ExitOnForwardFailure=yes", "-R", `127.0.0.1:${remotePort}:${localSocket}`, ...muxOpts(host)], { stdio: ["pipe", "ignore", "pipe"] });
      child.stdin?.on("error", () => { /* fechou antes */ });
      let err = ""; let done = false; const t0 = Date.now();
      child.stderr?.on("data", (d: Buffer) => { err += d.toString("utf8"); });
      const rev: Reverse = { child, remotePort, localSocket, restarts, since: Date.now() };
      const finish = (ok: boolean, why: string): void => { if (done) return; done = true; if (ok) resolve(rev); else { child.kill(); reject(new Error(why)); } };
      // Pronto quando a máquina alcança o socket pelo -R (prova o caminho inteiro).
      const probe = `curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:${remotePort}/abas 2>/dev/null || python3 -c 'import urllib.request;print(urllib.request.urlopen("http://127.0.0.1:${remotePort}/abas",timeout=2).status)' 2>/dev/null`;
      const poll = async (): Promise<void> => {
        while (!done && Date.now() - t0 < 20_000) {
          if (child.exitCode !== null) break;
          const r = await execViaMux(host, probe, 6_000);
          if (/^(200|404|400)$/.test(r.stdout.trim())) { log(`[${host}] reverso pronto: 127.0.0.1:${remotePort} → ${localSocket} em ${Date.now() - t0} ms`); finish(true, ""); return; }
          await new Promise((r2) => setTimeout(r2, 500));
        }
        finish(false, child.exitCode !== null ? `o ssh -R saiu (${child.exitCode}): ${lastLine(err) || "sem detalhes"}` : "o túnel reverso não respondeu em 20 s");
      };
      void poll();
      child.on("error", (e) => finish(false, `Falha ao iniciar ssh -R: ${e.message}`));
      child.on("exit", (code) => {
        if (!done) { finish(false, `ssh -R encerrou (${code}): ${lastLine(err) || "sem detalhes"}`); return; }
        onReverseExit(h, rev, code);
      });
    })().catch((e: unknown) => reject(e instanceof Error ? e : new Error(String(e))));
  });
}
function onReverseExit(h: HostTunnel, rev: Reverse, code: number | null): void {
  const live = h.live;
  if (h.stopping || live === undefined || live.reverse !== rev) return;
  log(`[${h.host}] reverso caiu (code=${code}) após ${Math.round((Date.now() - rev.since) / 1000)} s`);
  const restarts = Date.now() - rev.since > 60_000 ? 0 : rev.restarts + 1;
  delete live.reverse;
  tellReverse(h.host, "connecting", null);
  if (h.reverseWanted === null) { tellReverse(h.host, "down", null); return; }
  if (restarts > REVERSE_RESTART_BUDGET) { log(`[${h.host}] reverso: orçamento de reinícios esgotado`); tellReverse(h.host, "down", null); return; }
  setTimeout(() => {
    if (h.stopping || h.live !== live || h.reverseWanted === null) return;
    startReverse(h, h.reverseWanted, restarts).then((r) => { live.reverse = r; tellReverse(h.host, "up", r.remotePort); }).catch((e: unknown) => { log(`[${h.host}] reverso não voltou: ${e instanceof Error ? e.message : String(e)}`); tellReverse(h.host, "down", null); });
  }, Math.min(1000 * 2 ** restarts, 8000));
}
async function stopReverse(host: string, l: Live): Promise<void> {
  const r = l.reverse; if (r === undefined) return;
  r.child.stdin?.end(); r.child.kill();
  await runSsh(["-O", "cancel", "-R", `127.0.0.1:${r.remotePort}:${r.localSocket}`, ...muxOpts(host)], 5000);
  log(`[${host}] reverso cancelado (127.0.0.1:${r.remotePort})`);
}

/** Encerra o filho do forward e cancela o forward no master (ele persiste lá mesmo sem o filho). */
async function stopForward(host: string, l: Live): Promise<void> {
  l.forward.stdin?.end();
  l.forward.kill();
  await runSsh(["-O", "cancel", "-L", `127.0.0.1:${l.localPort}:127.0.0.1:${l.remotePort}`, ...muxOpts(host)], 5000);
}

async function teardown(h: HostTunnel, exitMasterToo: boolean): Promise<void> {
  const prev = h.live;
  h.live = undefined;
  if (prev?.reverse !== undefined) { await stopReverse(h.host, prev).catch(() => { /* master já caiu */ }); delete prev.reverse; tellReverse(h.host, "down", null); }
  if (prev !== undefined) {
    await stopForward(h.host, prev);
    if (exitMasterToo) await exitMaster(h.host);
  }
}

/** Fecha forward e master de um host, ou de todos (troca de porta ou saída do app). */
export function closeTunnel(host?: string): void {
  const targets = host === undefined ? [...hosts.values()] : [entry(host)];
  for (const h of targets) {
    if (h.host === LOCAL_HOST) { stopLocalBackend(); setState(h, "idle", "teardown"); continue; }
    closeForwardExtras(h.host);
    h.stopping = true;
    const prev = h.live;
    h.live = undefined;
    if (prev !== undefined) {
      prev.forward.stdin?.end();
      prev.forward.kill();
      void exitMaster(h.host).finally(() => { h.stopping = false; });
    } else {
      h.stopping = false;
    }
    setState(h, "idle", "teardown");
  }
}

/** O Mac dormiu: a próxima chamada revalida antes de confiar nos túneis. */
export function markSuspect(): void {
  for (const h of hosts.values()) h.suspect = true;
  log("suspend: túneis marcados como suspeitos");
}

/** O Mac acordou: valida já; o que falhar fica degradado e a próxima chamada reconstrói. */
export async function revalidate(): Promise<void> {
  await Promise.all([...hosts.values()].map(async (h) => {
    if (h.host === LOCAL_HOST) { h.suspect = false; if (h.state === "ready" && !(await checkLocalBackend())) setState(h, "degraded", "backend local sumiu"); return; }
    if (h.live === undefined) { h.suspect = false; return; }
    log(`[${h.host}] resume → revalidate`);
    if (await checkTunnel(h.host)) { h.suspect = false; setState(h, "ready", "revalidado após acordar"); }
    else setState(h, "degraded", "falhou após acordar");
  }));
}

export const tunnelAlive = (host: string): boolean => {
  if (host === LOCAL_HOST) return localBackendAlive();
  const h = hosts.get(host);
  return h !== undefined && h.live !== undefined && h.live.forward.exitCode === null && h.state === "ready";
};
