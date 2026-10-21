/**
 * Sondagem e instalação do backend num host SSH, pensadas para a tela de Configurações:
 * "este host está acessível? tem o backend? o Claude Code dele está logado?" e, se faltar o
 * backend mas o Claude estiver logado, instalar com o mesmo instalador usado no Colima.
 *
 * Usa ssh/scp avulsos (ControlMaster=no, sem o mux do túnel) para não interferir no túnel ativo.
 */
import { isVozId } from "./vozes-core";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import os from "node:os";
import type { AudioSetup, HostProbe, InstallBackendResult } from "../shared/ipc";
import { claudeLoggedIn, findClaude, findNode, LOCAL_HOST, localBackendAlive } from "./localBackend";
import { isValidHost } from "./settings";

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
    // A porta do backend é a do .env dele (o app pode estar com outra); sem backend, é a que o app usa.
    `EP=$(grep '^PORT=' ${BACKEND_DIR}/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -dc 0-9); echo "envport=$EP"`,
    `L=$( (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) ); BP=\${EP:-${port}}`,
    `echo "$L" | grep -q ":$BP " && echo port=1 || echo port=0`,
    // A porta do app está tomada nesta máquina? (sem backend nesta conta: outra conta ou outro programa)
    `echo "$L" | grep -q ':${port} ' && echo busy=1 || echo busy=0`,
    // Primeira porta livre acima da do app, para o seletor instalar sem conflito.
    `F=; q=$((${port}+1)); while [ $q -le $((${port}+30)) ]; do echo "$L" | grep -q ":$q " || { F=$q; break; }; q=$((q+1)); done; echo "freeport=$F"`,
    `C=$(command -v claude 2>/dev/null); [ -z "$C" ] && [ -x "$HOME/.local/bin/claude" ] && C="$HOME/.local/bin/claude"; echo "claude=$C"`,
    `grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null && echo login=1 || echo login=0`,
    // Status line nossa: o statusline.sh que grava o cache de limites lido em /v1/meu-bot/status.
    `grep -q ratelimits.json "$HOME/.claude/statusline.sh" 2>/dev/null && echo statusline=1 || echo statusline=0`,
    // Guarda do WhatsApp (plugin meu-bot-guarda do OpenClaw): a cópia que o install-guarda.sh registra por --link.
    `[ -f "$HOME/.local/share/meu-bot/guarda/index.js" ] && echo guarda=1 || echo guarda=0`,
    // Versão instalada com sucesso (o instalador grava .ok no fim); sem .ok = instalação antiga ou incompleta → atualiza.
    `echo "guardaver=$(cat "$HOME/.local/share/meu-bot/guarda/.ok" 2>/dev/null)"`,
    // Agente de chat: openclaw (CLI em ~/.openclaw/bin) tem preferência; senão hermes (~/.local/bin).
    `G=; { command -v openclaw >/dev/null 2>&1 || [ -x "$HOME/.openclaw/bin/openclaw" ]; } && G=openclaw; [ -z "$G" ] && { command -v hermes >/dev/null 2>&1 || [ -x "$HOME/.local/bin/hermes" ] || [ -d "$HOME/.hermes/whatsapp" ]; } && G=hermes; echo "gateway=$G"`,
    // OpenClaw: o agente do WhatsApp entende áudio? (transcritor em tools.media.models; o openclaw.json é JSON puro)
    `[ "$G" = openclaw ] && echo "audioin=$(python3 -c 'import json,os;c=json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")));m=(c.get("tools") or {}).get("media") or {};print(int(any("audio" in (x.get("capabilities") or []) for x in (m.get("models") or []) if isinstance(x,dict))))' 2>/dev/null)"`,
    `echo "node=$(command -v node >/dev/null 2>&1 && node -v 2>/dev/null)"`,
    // Disco da home e memória (kB): o whisper da transcrição baixa ~500 MB e o OpenClaw enche de transcripts.
    `echo "disk=$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $2" "$4}')"`,
    `echo "mem=$(free -k 2>/dev/null | awk '/^Mem:/{print $2" "$7}')"`,
    `echo "systemd=$(command -v systemctl >/dev/null 2>&1 && echo 1 || echo 0)"`,
    // Computador do Grok Bot: PID 1 é o pod-daemon (sob tini) ou o cgroup do init é pod-…
    `( tr '\\0' ' ' </proc/1/cmdline 2>/dev/null | grep -q pod-daemon || grep -q 'pod-' /proc/1/cgroup 2>/dev/null ) && echo grokpod=1 || echo grokpod=0`,
    `K=$(grep '^OPENAI_COMPAT_KEY=' ${BACKEND_DIR}/.env 2>/dev/null | head -1 | cut -d= -f2-); echo "models=$(curl -s -m 6 -H "Authorization: Bearer $K" http://127.0.0.1:$BP/v1/models 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | tr '\n' ,)"`,
  ].join("; ");
}

/** "total livre" em kB → MB (null quando a máquina não respondeu); mantém o mesmo nome de campo para disco e memória. */
function sizePair(v: string | undefined, kind: "disk" | "mem"): { diskTotalMb: number | null; diskFreeMb: number | null } | { memTotalMb: number | null; memFreeMb: number | null } {
  const m = /^(\d+)\s+(\d+)$/.exec((v ?? "").trim());
  const total = m === null ? null : Math.round(Number(m[1]) / 1024), free = m === null ? null : Math.round(Number(m[2]) / 1024);
  return kind === "disk" ? { diskTotalMb: total, diskFreeMb: free } : { memTotalMb: total, memFreeMb: free };
}

/** Porta vinda da sondagem (só dígitos, 1 a 65535); vazio ou lixo = null. */
function parsePort(v: string | undefined): number | null {
  const n = /^\d{1,5}$/.test(v ?? "") ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
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
  if (host === LOCAL_HOST) return probeLocal(port);
  const base: HostProbe = {
    host, reachable: false, user: null, os: null, arch: null, backendInstalled: false, backendListening: false,
    appPort: port, backendPort: null, portBusy: false, freePort: null,
    claudePath: null, claudeLoggedIn: false, node: null, diskTotalMb: null, diskFreeMb: null, memTotalMb: null, memFreeMb: null, systemd: false, grokPod: false, tailscaleCheck: false, statusLine: false, guarda: null, guardaVersion: null, audioIn: null, gateway: null, models: [], error: null,
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
    backendPort: parsePort(kv.get("envport")),
    portBusy: kv.get("busy") === "1",
    freePort: parsePort(kv.get("freeport")),
    claudePath: kv.get("claude") || null,
    claudeLoggedIn: kv.get("login") === "1",
    node: kv.get("node") || null,
    ...sizePair(kv.get("disk"), "disk"), ...sizePair(kv.get("mem"), "mem"),
    systemd: kv.get("systemd") === "1",
    grokPod: kv.get("grokpod") === "1",
    statusLine: kv.get("statusline") === "1",
    guarda: kv.get("gateway") === "openclaw" ? kv.get("guarda") === "1" : null,
    guardaVersion: kv.get("guardaver") || null,
    audioIn: kv.get("gateway") === "openclaw" ? kv.get("audioin") === "1" : null,
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
function probeLocal(port: number): HostProbe {
  const node = findNode();
  const claude = findClaude();
  let nodeVersion: string | null = null;
  if (node !== null) { try { nodeVersion = spawnSync(node, ["-v"], { encoding: "utf8", timeout: 5000 }).stdout.trim() || null; } catch { /* sem versão */ } }
  return {
    host: LOCAL_HOST, reachable: true, user: os.userInfo().username, os: `macOS ${os.release()}`, arch: os.arch(),
    backendInstalled: true, backendListening: localBackendAlive(), appPort: port, backendPort: null, portBusy: false, freePort: null, claudePath: claude, claudeLoggedIn: claude !== null && claudeLoggedIn(),
    node: nodeVersion, diskTotalMb: null, diskFreeMb: null, memTotalMb: null, memFreeMb: null, systemd: false, grokPod: false, tailscaleCheck: false, statusLine: localStatusLine(), guarda: null, guardaVersion: null, audioIn: null, gateway: null, models: ["claudecode", "agente"], error: node === null ? "Node.js não encontrado neste Mac" : null,
  };
}

/** Pasta com server.js, session-map.js, a unidade systemd e install.sh (Resources/ no .app; raiz no dev). */
export function backendBundleDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "backend-colima") : path.join(app.getAppPath(), "backend-colima");
}

// Tudo que o install.sh copia: server.js exige providers.js e account-status.js ao lado (sem eles o cp aborta
// e a VM nova fica sem backend). A status line vai junto e o install.sh a encadeia no fim.
const BUNDLE_FILES = [
  "server.js", "session-map.js", "providers.js", "providers.json", "account-status.js", "tool-events.js", "navegador.js", "licenca.js", "crm-modelo.js", "crm-store.js", "crm-api.js", "autenticador.js", "auditoria.py", "meu-bot-backend.service", "install.sh",
  "statusline.sh", "install-statusline.sh", "uninstall-statusline.sh",
];

/** Copia o bundle para o host e roda o instalador; `onLine` recebe o progresso linha a linha. */
/**
 * Porta para instalar o backend nesta máquina (regra única do seletor e do admin): a do backend já instalado
 * (reinstalar não muda o .env), a primeira livre quando a do app está tomada (outra conta da mesma máquina), senão a do app.
 */
export function portaParaInstalar(probe: Pick<HostProbe, "backendInstalled" | "backendPort" | "portBusy" | "freePort">, configurada: number): number {
  if (probe.backendInstalled && probe.backendPort !== null) return probe.backendPort;
  if (!probe.backendInstalled && probe.portBusy && probe.freePort !== null) return probe.freePort;
  return configurada;
}

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


/**
 * Claude Code na conta do alias (outro usuário da mesma máquina, por exemplo): o instalador oficial
 * (claude.ai/install.sh) põe o binário em ~/.local/bin sem precisar de Node nem de root; idempotente (se já
 * existe, só confere a versão). O login e o backend vêm depois, pelos botões de sempre do seletor.
 */
export async function installClaudeCode(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["neste Mac, instale o Claude Code pelo site: https://claude.ai/code"] };
  const lines: string[] = [];
  const say = (l: string): void => { if (l.trim() !== "") { lines.push(l); onLine?.(l); } };
  const script = [
    `export PATH="$HOME/.local/bin:$PATH"`,
    `if command -v claude >/dev/null 2>&1; then echo "Claude Code já instalado: $(claude --version 2>/dev/null | head -1)"; exit 0; fi`,
    `command -v curl >/dev/null 2>&1 || { echo "esta máquina não tem curl; instale com: sudo apt install curl"; exit 2; }`,
    `echo "baixando o instalador oficial do Claude Code…"`,
    `curl -fsSL https://claude.ai/install.sh | bash 2>&1`,
    `command -v claude >/dev/null 2>&1 || [ -x "$HOME/.local/bin/claude" ] || { echo "o instalador terminou, mas não achei o claude em ~/.local/bin"; exit 3; }`,
    `echo "pronto: Claude Code instalado em ~/.local/bin; agora é Entrar no Claude Code"`,
  ].join("; ");
  say(`instalando o Claude Code em ${host} (conta do alias)…`);
  const r = await run("ssh", [...sshBase(host), "--", host, `bash -c ${JSON.stringify(script)}`], 5 * 60_000, say);
  if (r.code !== 0) return { ok: false, log: [...lines, r.code === null ? "o instalador não terminou em 5 min" : lastLine(r.stderr) || `instalador saiu com código ${r.code}`] };
  return { ok: true, log: lines };
}

/**
 * Áudio do agente do WhatsApp (OpenClaw): "in" = transcrição local (install-transcricao.sh), "out" = voz local
 * com o modo (install-voz.sh off|inbound|always). Mesmo molde da status line: manda o script e roda no host.
 */
export async function installAudio(host: string, setup: AudioSetup, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  if (host === LOCAL_HOST) return { ok: false, log: ["este Mac não tem agente com WhatsApp"] };
  const file = setup.kind === "in" ? "install-transcricao.sh" : "install-voz.sh";
  const arg = setup.kind === "out" ? ` ${setup.mode}${setup.voz !== undefined && isVozId(setup.voz) ? ` ${setup.voz}` : ""}` : setup.off === true ? " off" : "";
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${REMOTE_STAGE}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", path.join(backendBundleDir(), file), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  // A transcrição baixa ~500 MB na primeira vez (faster-whisper + modelo): tempo de sobra.
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/${file}${arg} 2>&1`], 20 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, lines.at(-1) ?? `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}

/** A status line nossa está instalada no host (a mesma checagem da sondagem; neste Mac, com as settings gerenciadas)? */
export async function statusLineInstalled(host: string): Promise<boolean> {
  if (host === LOCAL_HOST) return localStatusLine();
  const r = await run("ssh", [...sshBase(host), "--", host, `grep -q ratelimits.json "$HOME/.claude/statusline.sh" 2>/dev/null && echo statusline=1 || echo statusline=0`], 25_000);
  if (r.code !== 0) throw new Error(lastLine(r.stderr) || "não consegui entrar na máquina");
  return r.stdout.includes("statusline=1");
}

/** Grok por OAuth (Hermes + proxy local + providers.json): manda install-grok-oauth.sh e roda no host. */
export async function prepareGrokOauth(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  if (host === LOCAL_HOST) return { ok: false, log: ["o Grok por OAuth vale para máquinas por SSH"] };
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${REMOTE_STAGE}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", path.join(backendBundleDir(), "install-grok-oauth.sh"), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/install-grok-oauth.sh 2>&1`], 10 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, lines.at(-1) ?? `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}

const STATUSLINE_FILES = ["statusline.sh", "install-statusline.sh", "uninstall-statusline.sh"];
/** Guarda do WhatsApp: o plugin (pasta guarda/) e os dois scripts. */
const GUARDA_FILES = ["install-guarda.sh", "uninstall-guarda.sh"];
const WA_GRUPOS_SCRIPTS = ["habilitar.py", "listar.sh", "wa-admin.sh", "wa-grupos.js"];
/** Versão da guarda que vem neste app (package.json do plugin); o seletor atualiza máquinas com versão diferente. */
export function bundledGuardaVersion(): string | null {
  try { const j = JSON.parse(fs.readFileSync(path.join(backendBundleDir(), "guarda", "package.json"), "utf8")) as { version?: unknown }; return typeof j.version === "string" ? j.version : null; } catch { return null; }
}
/** Navegador do agente (módulo Pro): o servidor MCP (um arquivo) e o instalador. */
const NAVEGADOR_FILES = ["navegador-mcp.mjs", "install-navegador-mcp.sh", "skill-streak-crm-navegador.md"];

/** O lado da máquina do Navegador está instalado? (null para este Mac) */
export async function navegadorInstalled(host: string): Promise<boolean | null> {
  if (host === LOCAL_HOST || !isValidHost(host)) return null;
  const r = await run("ssh", [...sshBase(host), "--", host, `[ -f "$HOME/.local/share/meu-bot/navegador-mcp.mjs" ] && grep -q "meu-bot:navegador" "$HOME/agent-workspace/CLAUDE.md" 2>/dev/null && echo nav=1 || echo nav=0`], 25_000);
  return r.stdout.includes("nav=1");
}
/** Instala o lado da máquina do Navegador (MCP + regra no CLAUDE.md). Mesmo molde da status line. */
export async function installNavegador(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["o Navegador do agente é para máquinas por SSH"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando o Navegador do agente para ${host}:${REMOTE_STAGE}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${REMOTE_STAGE}`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp = await run("scp", ["-q", ...sshBase(host), "--", ...NAVEGADOR_FILES.map((f) => path.join(dir, f)), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/install-navegador-mcp.sh 2>&1`], 2 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
const GUARDA_PLUGIN_FILES = ["index.js", "regras.mjs", "package.json", "openclaw.plugin.json"];
const CRM_FILES = ["install-crm.sh", "uninstall-crm.sh", "skill-streak-crm-api.md", "skill-crm-api.md"];
const CRM_PLUGIN_FILES = ["index.js", "regras.mjs", "crm-job.mjs", "backend.mjs", "crm.mjs", "streak.mjs", "importar-streak.mjs", "package.json", "openclaw.plugin.json"];
/** Tutorial 10: instala o plugin meu-bot-crm + as CLIs (crm.mjs do CRM próprio, streak.mjs do Pro) + skills na máquina (molde da guarda). */
export async function installCrm(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["o CRM pelo WhatsApp é do agente do WhatsApp (OpenClaw) de uma máquina por SSH"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando o CRM para ${host}:${REMOTE_STAGE}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${REMOTE_STAGE}/crm`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp1 = await run("scp", ["-q", ...sshBase(host), "--", ...CRM_FILES.map((f) => path.join(dir, f)), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp1.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp1.stderr)}`] };
  const scp2 = await run("scp", ["-q", ...sshBase(host), "--", ...CRM_PLUGIN_FILES.map((f) => path.join(dir, "crm", f)), `${host}:${REMOTE_STAGE}/crm/`], 60_000);
  if (scp2.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp2.stderr)}`] };
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/install-crm.sh 2>&1`], 4 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
export async function uninstallCrm(host: string): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: true, log: ["nada a desfazer neste Mac"] };
  const r = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/uninstall-crm.sh 2>&1 || bash "$HOME/.local/share/meu-bot/crm/../uninstall-crm.sh" 2>&1 || { export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"; openclaw plugins uninstall meu-bot-crm >/dev/null 2>&1; rm -rf "$HOME/.local/share/meu-bot/crm"; echo removido; }`], 2 * 60_000);
  return { ok: r.code === 0, log: r.stdout.trim().split("\n").filter(Boolean) };
}

/** A guarda do WhatsApp está nesta máquina? (a cópia registrada no OpenClaw; null para este Mac) */
export async function guardaInstalled(host: string): Promise<boolean | null> {
  if (host === LOCAL_HOST || !isValidHost(host)) return null;
  const r = await run("ssh", [...sshBase(host), "--", host, `command -v openclaw >/dev/null 2>&1 || [ -x "$HOME/.openclaw/bin/openclaw" ] || { echo guarda=none; exit 0; }; [ -f "$HOME/.local/share/meu-bot/guarda/index.js" ] && echo guarda=1 || echo guarda=0`], 25_000);
  if (r.stdout.includes("guarda=none")) return null;
  return r.stdout.includes("guarda=1");
}

/**
 * Instala a guarda do WhatsApp (plugin meu-bot-guarda) no OpenClaw da máquina: manda a pasta guarda/ e os scripts
 * e roda o instalador, que registra o plugin por --link (o gateway aplica na hora). Mesmo molde da status line.
 */
export async function installGuarda(host: string, onLine?: (line: string) => void): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: false, log: ["a guarda é do agente do WhatsApp (OpenClaw) de uma máquina por SSH"] };
  const lines: string[] = [];
  const say = (l: string): void => { lines.push(l); onLine?.(l); };
  const dir = backendBundleDir();
  say(`enviando a guarda para ${host}:${REMOTE_STAGE}…`);
  const mk = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${REMOTE_STAGE}/guarda`], 20_000);
  if (mk.code !== 0) return { ok: false, log: [...lines, `falha ao preparar a pasta remota: ${lastLine(mk.stderr)}`] };
  const scp1 = await run("scp", ["-q", ...sshBase(host), "--", ...GUARDA_FILES.map((f) => path.join(dir, f)), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp1.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp1.stderr)}`] };
  const scp2 = await run("scp", ["-q", ...sshBase(host), "--", ...GUARDA_PLUGIN_FILES.map((f) => path.join(dir, "guarda", f)), `${host}:${REMOTE_STAGE}/guarda/`], 60_000);
  if (scp2.code !== 0) return { ok: false, log: [...lines, `scp falhou: ${lastLine(scp2.stderr)}`] };
  // Skill whatsapp-grupos vai junto (o install-guarda.sh a põe em ~/.claude/skills).
  const sk = path.join(dir, "skills", "whatsapp-grupos");
  const mk2 = await run("ssh", [...sshBase(host), "--", host, `mkdir -p ${REMOTE_STAGE}/skills/whatsapp-grupos/scripts`], 20_000);
  const scp3 = mk2.code !== 0 ? mk2 : await run("scp", ["-q", ...sshBase(host), "--", path.join(sk, "SKILL.md"), `${host}:${REMOTE_STAGE}/skills/whatsapp-grupos/`], 60_000);
  const scp4 = scp3.code !== 0 ? scp3 : await run("scp", ["-q", ...sshBase(host), "--", ...WA_GRUPOS_SCRIPTS.map((f) => path.join(sk, "scripts", f)), `${host}:${REMOTE_STAGE}/skills/whatsapp-grupos/scripts/`], 60_000);
  if (scp4.code !== 0) say(`aviso: a skill whatsapp-grupos não foi enviada (${lastLine(scp4.stderr)}); a guarda segue`);
  say("rodando o instalador…");
  const inst = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/install-guarda.sh 2>&1`], 4 * 60_000, say);
  if (inst.code !== 0) return { ok: false, log: [...lines, `instalador saiu com código ${inst.code ?? "timeout"}`] };
  return { ok: true, log: lines };
}
/** "Refazer do zero" do tutorial da guarda: tira o plugin do OpenClaw e apaga a cópia. */
export async function uninstallGuarda(host: string): Promise<InstallBackendResult> {
  if (host === LOCAL_HOST) return { ok: true, log: ["nada a desfazer neste Mac"] };
  const dir = backendBundleDir();
  const scp = await run("scp", ["-q", ...sshBase(host), "--", path.join(dir, "uninstall-guarda.sh"), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [`scp falhou: ${lastLine(scp.stderr)}`] };
  const r = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/uninstall-guarda.sh 2>&1`], 2 * 60_000);
  if (r.code !== 0) return { ok: false, log: [lastLine(r.stdout) || lastLine(r.stderr) || `código ${r.code ?? "timeout"}`] };
  return { ok: true, log: r.stdout.trim().split("\n") };
}

/** "Refazer do zero" da status line: desfaz o install-statusline.sh na máquina (ou neste Mac). */
export async function uninstallStatusLine(host: string): Promise<InstallBackendResult> {
  const dir = backendBundleDir();
  if (host === LOCAL_HOST) {
    const r = await run("bash", [path.join(dir, "uninstall-statusline.sh")], 60_000);
    return r.code === 0 ? { ok: true, log: r.stdout.trim().split("\n") } : { ok: false, log: [lastLine(r.stderr) || `saiu com código ${r.code ?? "timeout"}`] };
  }
  const scp = await run("scp", ["-q", ...sshBase(host), "--", path.join(dir, "uninstall-statusline.sh"), `${host}:${REMOTE_STAGE}/`], 60_000);
  if (scp.code !== 0) return { ok: false, log: [`scp falhou: ${lastLine(scp.stderr)}`] };
  const r = await run("ssh", [...sshBase(host), "--", host, `bash ${REMOTE_STAGE}/uninstall-statusline.sh 2>&1`], 60_000);
  return r.code === 0 ? { ok: true, log: r.stdout.trim().split("\n") } : { ok: false, log: [lastLine(r.stdout) || `saiu com código ${r.code ?? "timeout"}`] };
}

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
