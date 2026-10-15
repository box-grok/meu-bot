/**
 * Janela "parear WhatsApp do Hermes": envia o parear-hermes.sh por SSH (fica em ~/bin do host) e o
 * roda. O script para o hermes-gateway, põe a ponte Baileys em modo de pareamento e devolve cada QR
 * novo como SVG; aqui ele aparece ao vivo para a pessoa ler com o celular do número do agente. Lido o
 * QR, o script religa o gateway e confirma a conexão. Fechar a janela derruba o ssh, e o script
 * devolve a sessão antiga e religa o gateway sozinho.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { WhatsappPairEvent } from "../shared/ipc";
import { isValidHost } from "./settings";
import { backgroundColor } from "./windows";
import { parsePairLine } from "./whatsapp-pair-line";

let pairWin: BrowserWindow | null = null;
let child: ChildProcess | null = null;

const SSH_OPTS = [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new",
];

/** scripts/whatsapp/parear-hermes.sh: Resources/whatsapp no .app; pasta do projeto no dev. */
function pairScript(): string {
  const p = app.isPackaged ? path.join(process.resourcesPath, "whatsapp", "parear-hermes.sh") : path.join(app.getAppPath(), "scripts", "whatsapp", "parear-hermes.sh");
  return fs.readFileSync(p, "utf8");
}

function send(ev: WhatsappPairEvent): void {
  if (pairWin !== null && !pairWin.isDestroyed()) pairWin.webContents.send("wapair:event", ev);
}

function stopChild(): void {
  if (child !== null) { try { child.kill("SIGTERM"); } catch { /* já saiu */ } child = null; }
}

function runPair(host: string, force: boolean): void {
  stopChild();
  send({ kind: "step", step: "connect", state: "doing", text: `conectando a ${host} por SSH` });
  const cmd = `mkdir -p ~/bin && cat > ~/bin/parear-hermes.sh && bash ~/bin/parear-hermes.sh${force ? " --forcar" : ""}`;
  const proc = spawn("ssh", [...SSH_OPTS, "--", host, cmd], { stdio: ["pipe", "pipe", "pipe"] });
  child = proc;
  proc.stdin.on("error", () => { /* o ssh caiu antes de ler o script; o close abaixo reporta */ });
  proc.stdin.end(pairScript());
  let stderr = ""; let buf = ""; let connected = false; let finished = false;
  proc.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
  proc.stdout.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line === "") continue;
      if (!connected) { connected = true; send({ kind: "step", step: "connect", state: "done", text: `conectado a ${host}` }); }
      const ev = parsePairLine(line);
      if (ev === null) continue;
      if (ev.kind === "done") finished = true;
      send(ev);
    }
  });
  proc.on("close", (code) => {
    if (child === proc) child = null;
    if (finished) return;
    if (!connected) {
      const why = stderr.trim().split("\n").pop() ?? "";
      send({ kind: "step", step: "connect", state: "fail", text: why || "o ssh não entrou" });
      send({ kind: "done", ok: false, text: `Não consegui entrar em ${host} por SSH.` });
      return;
    }
    send({ kind: "done", ok: false, text: `O pareamento parou sem resposta (código ${code ?? "?"}). O gateway volta como estava.` });
  });
}

export function initWhatsappPair(): void {
  const fromWin = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => pairWin !== null && event.sender === pairWin.webContents;
  ipcMain.on("wapair:close", (event) => { if (fromWin(event)) pairWin?.close(); });
  ipcMain.on("wapair:retry", (event, payload: unknown) => {
    if (!fromWin(event)) return;
    const host = String((payload as { host?: unknown } | null)?.host ?? "");
    if (!isValidHost(host)) return;
    runPair(host, (payload as { force?: unknown } | null)?.force === true);
  });
}

/** Abre a janela de pareamento da máquina e dispara o processo (uma por vez). */
export function showWhatsappPair(host: string): void {
  if (!isValidHost(host)) return;
  if (pairWin !== null && !pairWin.isDestroyed()) { pairWin.show(); pairWin.focus(); return; }
  const win = new BrowserWindow({
    width: 520, height: 720, resizable: false, minimizable: true, title: `parear WhatsApp · ${host}`,
    titleBarStyle: "hiddenInset", backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "whatsapp-pair-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
    },
  });
  pairWin = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  // Fechar a janela derruba o ssh; do lado de lá o script devolve a sessão e religa o gateway.
  win.on("closed", () => { if (pairWin === win) { pairWin = null; stopChild(); } });
  win.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.webContents.send("wapair:event", { kind: "init", host } satisfies WhatsappPairEvent);
    runPair(host, false);
  });
  void win.loadFile(path.join(__dirname, "..", "renderer", "whatsapp-pair.html"));
}
