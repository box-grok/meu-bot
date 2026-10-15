/**
 * Sondagem e instalação do backend num host SSH, pensadas para a tela de Configurações:
 * "este host está acessível? tem o backend? o Claude Code dele está logado?" e, se faltar o
 * backend mas o Claude estiver logado, instalar com o mesmo instalador usado no Colima.
 *
 * Usa ssh/scp avulsos (ControlMaster=no, sem o mux do túnel) para não interferir no túnel ativo.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import os from "node:os";
import type { HostProbe, InstallBackendResult } from "../shared/ipc";
import { claudeLoggedIn, findClaude, findNode, LOCAL_HOST, localBackendAlive } from "./localBackend";

const BACKEND_DIR = "~/.hermes/agente-rene/backend-sdk-claude";
const REMOTE_STAGE = "~/.meu-bot-install";

const sshBase = (host: string): string[] => [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", "-o", "ControlMaster=no", "-o", "ControlPath=none",
  "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=2",
];

interface RunResult { code: number | null; stdout: string; stderr: string }

function run(cmd: string, args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let done = false; let pending = "";
    const feed = (d: Buffer): void => {
      const s = d.toString("utf8"); stdout += s;
      if (onLine === undefined) return;
      pending += s;
      let i: number;
      while ((i = pending.indexOf("\n")) >= 0) { onLine(pending.slice(0, i)); pending = pending.slice(i + 1); }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}\n${e.message}` }); } });
    child.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); if (pending !== "" && onLine) onLine(pending); resolve({ code, stdout, stderr }); } });
  });
}

const lastLine = (s: string): string => s.trim().split("\n").filter((l) => l !== "" && !l.startsWith("Warning: Permanently added")).pop() ?? "";

/** Link de verificação do Tailscale SSH ("# To authenticate, visit: https://login.tailscale.com/a/…"). */
export const TAILSCALE_CHECK_RE = /https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/;
export const tailscaleCheckUrl = (text: string): string | null => TAILSCALE_CHECK_RE.exec(text)?.[0] ?? null;

/**
 * Verificação do Tailscale SSH: o link só vale enquanto a sessão ssh que o pediu estiver viva, então
 * abrimos um ssh paciente, levamos o link ao navegador e esperamos a aprovação (até 4 min).
 */
export function approveTailscaleCheck(host: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=240", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new", "--", host, "echo ok"], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; let stdout = ""; let opened = false; let done = false;
    const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, 250_000);
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
      const url = tailscaleCheckUrl(stderr);
      if (url !== null && !opened) { opened = true; void shell.openExternal(url); }
    });
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, detail: e.message }); } });
    child.on("close", (code) => {
      if (done) return; done = true; clearTimeout(timer);
      if (code === 0 && stdout.includes("ok")) resolve({ ok: true, detail: opened ? "verificação aprovada; o ssh entrou" : "o ssh entrou sem pedir verificação" });
      else resolve({ ok: false, detail: opened ? `o link foi aberto mas a sessão terminou sem aprovação (${lastLine(stderr) || `código ${code}`})` : (lastLine(stderr) || `ssh saiu com código ${code}`) });
    });
  });
}

/** Script remoto: imprime `chave=valor` por linha; cada checagem é tolerante a ferramenta ausente. */
function probeScript(port: number): string {
  return [
    `echo "user=$(id -un 2>/dev/null)"`,
    `echo "os=$(. /etc/os-release 2>/dev/null && printf '%s' "$PRETTY_NAME")"`,
    `echo "arch=$(uname -m 2>/dev/null)"`,
    `[ -f ${BACKEND_DIR}/.env ] && echo env=1 || echo env=0`,
    `[ -f ${BACKEND_DIR}/server.js ] && echo server=1 || echo server=0`,
    `( (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ':${port} ' ) && echo port=1 || echo port=0`,
    `C=$(command -v claude 2>/dev/null); [ -z "$C" ] && [ -x "$HOME/.local/bin/claude" ] && C="$HOME/.local/bin/claude"; echo "claude=$C"`,
    `grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null && echo login=1 || echo login=0`,
    // Status line nossa: o statusline.sh que grava o cache de limites lido em /v1/meu-bot/status.
    `grep -q ratelimits.json "$HOME/.claude/statusline.sh" 2>/dev/null && echo statusline=1 || echo statusline=0`,
    // Agente de chat: openclaw (CLI em ~/.openclaw/bin) tem preferência; senão hermes (~/.local/bin).
    `G=; { command -v openclaw >/dev/null 2>&1 || [ -x "$HOME/.openclaw/bin/openclaw" ]; } && G=openclaw; [ -z "$G" ] && { command -v hermes >/dev/null 2>&1 || [ -x "$HOME/.local/bin/hermes" ] || [ -d "$HOME/.hermes/whatsapp" ]; } && G=hermes; echo "gateway=$G"`,
    `echo "node=$(command -v node >/dev/null 2>&1 && node -v 2>/dev/null)"`,
    `echo "systemd=$(command -v systemctl >/dev/null 2>&1 && echo 1 || echo 0)"`,
    // Computador do Grok Bot: PID 1 é o pod-daemon (sob tini) ou o cgroup do init é pod-…
    `( tr '\\0' ' ' </proc/1/cmdline 2>/dev/null | grep -q pod-daemon || grep -q 'pod-' /proc/1/cgroup 2>/dev/null ) && echo grokpod=1 || echo grokpod=0`,
    `K=$(grep '^OPENAI_COMPAT_KEY=' ${BACKEND_DIR}/.env 2>/dev/null | head -1 | cut -d= -f2-); echo "models=$(curl -s -m 6 -H "Authorization: Bearer $K" http://127.0.0.1:${port}/v1/models 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | tr '\n' ,)"`,
  ].join("; ");
}

function parseKv(stdout: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) m.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return m;
}

export async function probeHost(host: string, port: number): Promise<HostProbe> {
  if (host === LOCAL_HOST) return probeLocal();
  const base: HostProbe = {
    host, reachable: false, user: null, os: null, arch: null, backendInstalled: false, backendListening: false,
    claudePath: null, claudeLoggedIn: false, node: null, systemd: false, grokPod: false, tailscaleCheck: false, statusLine: false, gateway: null, models: [], error: null,
  };
  const t0 = Date.now();
  // Falha rápida (o host respondeu "ainda não": sshd subindo, rota do Tailscale recém-negociada)
  // costuma passar na segunda tentativa, e repetir custa menos de um segundo. Já um timeout cheio
  // é host fora: repetir só faria o seletor, que sonda todos em paralelo, esperar o dobro à toa.
  let r = await run("ssh", [...sshBase(host), "--", host, probeScript(port)], 25_000);
  if (r.code !== 0 && Date.now() - t0 < 3_000 && /connection (refused|reset|closed)|broken pipe/i.test(r.stderr)) {
    await new Promise((res) => setTimeout(res, 500));
    r = await run("ssh", [...sshBase(host), "--", host, probeScript(port)], 25_000);
  }
  if (r.code !== 0) {
    // O Tailscale SSH pediu a verificação extra: não é máquina fora, é aprovação pendente no navegador.
    if (tailscaleCheckUrl(r.stderr) !== null) return { ...base, tailscaleCheck: true, error: "o Tailscale SSH pede uma verificação extra no navegador antes de deixar entrar" };
    return { ...base, error: lastLine(r.stderr) || (r.code === null ? "tempo esgotado" : `ssh saiu com código ${r.code}`) };
  }
  const kv = parseKv(r.stdout);
  return {
    ...base,
    reachable: true,
    user: kv.get("user") || null,
    os: kv.get("os") || null,
    arch: kv.get("arch") || null,
    backendInstalled: kv.get("env") === "1" && kv.get("server") === "1",
    backendListening: kv.get("port") === "1",
    claudePath: kv.get("claude") || null,
    claudeLoggedIn: kv.get("login") === "1",
    node: kv.get("node") || null,
    systemd: kv.get("systemd") === "1",
    grokPod: kv.get("grokpod") === "1",
    statusLine: kv.get("statusline") === "1",
    gateway: kv.get("gateway") === "openclaw" ? "openclaw" : kv.get("gateway") === "hermes" ? "hermes" : null,
    models: (kv.get("models") ?? "").split(",").map((m) => m.trim()).filter((m) => /^[a-z0-9-]+$/.test(m)),
  };
}

const fileHas = (file: string, needle: string): boolean => { try { return fs.readFileSync(file, "utf8").includes(needle); } catch { return false; } };

/**
 * A status line efetiva deste Mac grava o cache de limites? Settings gerenciadas ganham do settings.json
 * do usuário: se elas definem statusLine, só o script delas conta.
 */
function localStatusLine(): boolean {
  try {
    const managed = JSON.parse(fs.readFileSync("/Library/Application Support/ClaudeCode/managed-settings.json", "utf8")) as { statusLine?: { command?: string } };
    if (managed.statusLine !== undefined) {
      const m = /(\/[^'"]+statusline\.sh)/.exec(managed.statusLine.command ?? "");
      return m !== null && fileHas(m[1]!, "ratelimits.json");
    }
  } catch { /* sem settings gerenciadas */ }
  return fileHas(path.join(os.homedir(), ".claude", "statusline.sh"), "ratelimits.json");
}

/** "local": este Mac, sem SSH. O backend vai junto no app, então "instalado" é sempre verdade. */
function probeLocal(): HostProbe {
  const node = findNode();
  const claude = findClaude();
  let nodeVersion: string | null = null;
  if (node !== null) { try { nodeVersion = spawnSync(node, ["-v"], { encoding: "utf8", timeout: 5000 }).stdout.trim() || null; } catch { /* sem versão */ } }
  return {
    host: LOCAL_HOST, reachable: true, user: os.userInfo().username, os: `macOS ${os.release()}`, arch: os.arch(),
    backendInstalled: true, backendListening: localBackendAlive(), claudePath: claude, claudeLoggedIn: claude !== null && claudeLoggedIn(),
    node: nodeVersion, systemd: false, grokPod: false, tailscaleCheck: false, statusLine: localStatusLine(), gateway: null, models: ["claudecode", "agente"], error: node === null ? "Node.js não encontrado neste Mac" : null,
  };
}

/** Pasta com server.js, session-map.js, a unidade systemd e install.sh (Resources/ no .app; raiz no dev). */
export function backendBundleDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "backend-colima") : path.join(app.getAppPath(), "backend-colima");
}

// Tudo que o install.sh copia: server.js exige providers.js e account-status.js ao lado (sem eles o cp aborta
// e a VM nova fica sem backend). A status line vai junto e o install.sh a encadeia no fim.
const BUNDLE_FILES = [
  "server.js", "session-map.js", "providers.js", "providers.json", "account-status.js", "meu-bot-backend.service", "install.sh",
  "statusline.sh", "install-statusline.sh",
];

/** Copia o bundle para o host e roda o instalador; `onLine` recebe o progresso linha a linha. */
export async function installBackend(host: string, port: number, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: true, log: ["o backend deste Mac vai dentro do app; nada a instalar"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando ${BUNDLE_FILES.length} arquivos para ${host}:${REMOTE_STAGE}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${REMOTE_STAGE}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", ...BUNDLE_FILES.map((f) => path.join(dir, f)), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `PORT=${port} bash ${REMOTE_STAGE}/install.sh 2>&1`], 10 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}


const STATUSLINE_FILES = ["statusline.sh", "install-statusline.sh"];

/** Instala a status line do Claude Code no host (ou neste Mac): manda os dois arquivos e roda o instalador. */
export async function installStatusLine(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  if (host === LOCAL_HOST) {
    say("instalando a status line neste Mac…");
    const r = await run("bash", [path.join(dir, "install-statusline.sh")], 60_000, say);
    if (r.code !== 0) return { ok: false, log: [...lines, lastLine(r.stderr) || `instalador saiu com código ${r.code ?? "timeout"}`] };
    return { ok: true, log: lines };
  }
  say(`enviando ${STATUSLINE_FILES.length} arquivos para ${host}:${REMOTE_STAGE}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${REMOTE_STAGE}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", ...STATUSLINE_FILES.map((f) => path.join(dir, f)), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/install-statusline.sh 2>&1`], 2 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
