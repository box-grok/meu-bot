/**
 * Terminal do app controlado de fora (Claude Code neste Mac): o mesmo molde do Navegador (nav-api.ts), mas o
 * socket fica SÓ neste Mac (/tmp/<app>-<uid>/term.sock, 0600) e nunca vai pelo túnel para as máquinas: lá
 * quem pede seria o agente, e o terminal é o shell da pessoa. Tudo que é digitado aparece no xterm da aba, na
 * hora, para a pessoa ver.
 *
 * API (JSON): GET /terminais · POST /abrir {maquina?} (aba nova na janela da máquina) · POST /ler {id, linhas?}
 * · POST /digitar {id, texto, enter?} | {id, tecla}
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { controlDir } from "./control-dir";
import { hostOfWindow, lastFocusedWindow } from "./windows";
import { liveTerminals, replayTerminal, terminalById, waitNewTerminal, writeTerminal } from "./terminal";
import { entradaDigitar, textoDoTerminal } from "./term-api-core";
import { log } from "./backend";

export const termSocketPath = (): string => path.join(controlDir(), "term.sock");

interface Req { id?: unknown; maquina?: unknown; linhas?: unknown; texto?: unknown; enter?: unknown; tecla?: unknown }

/** Janela da máquina pedida (ou a última focada que tenha máquina). */
function janela(maquina: unknown): BrowserWindow {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && hostOfWindow(w) !== undefined);
  if (typeof maquina === "string" && maquina !== "") {
    const w = wins.find((x) => hostOfWindow(x) === maquina);
    if (w === undefined) throw new Error(`nenhuma janela aberta da máquina "${maquina}": abertas: ${wins.map((x) => hostOfWindow(x)).join(", ") || "nenhuma"}`);
    return w;
  }
  const f = lastFocusedWindow();
  const w = f !== null && wins.includes(f) ? f : wins[0];
  if (w === undefined) throw new Error("nenhuma janela de máquina aberta no app");
  return w;
}
const sessao = (id: unknown) => {
  const s = typeof id === "string" ? terminalById(id) : null;
  if (s === null) throw new Error("terminal não existe ou foi encerrado: veja /terminais");
  return s;
};
const info = (t: { id: string; host: string; n: number }) => ({ id: t.id, maquina: t.host, terminal: t.n });

async function act(route: string, b: Req): Promise<unknown> {
  switch (route) {
    case "/terminais": return { terminais: liveTerminals().map(info) };
    case "/abrir": {
      const w = janela(b.maquina);
      const antes = new Set(liveTerminals().map((t) => t.id));
      w.webContents.send("term:ask", { kind: "new" });
      const id = await waitNewTerminal(w.id, antes);
      if (id === null) throw new Error("a aba nova do terminal não abriu a tempo (veja a janela do app)");
      const t = liveTerminals().find((x) => x.id === id)!;
      await new Promise((r) => setTimeout(r, 800)); // o prompt chegar
      return { ...info(t), tela: textoDoTerminal(replayTerminal(terminalById(id)!), 20) };
    }
    case "/ler": {
      const s = sessao(b.id);
      return { id: s.id, maquina: s.host, tela: textoDoTerminal(replayTerminal(s), typeof b.linhas === "number" ? b.linhas : 60) };
    }
    case "/digitar": {
      const s = sessao(b.id);
      const e = entradaDigitar(b);
      if ("erro" in e) throw new Error(e.erro);
      writeTerminal(s, e.dados);
      return { ok: true };
    }
    default: throw Object.assign(new Error(`rota desconhecida: ${route}`), { status: 404 });
  }
}

let server: http.Server | null = null;
export async function startTermApi(): Promise<void> {
  if (server !== null) return;
  const sock = termSocketPath();
  try { fs.unlinkSync(sock); } catch { /* não existia */ }
  const s = http.createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((resolve, reject) => { s.once("error", reject); s.listen(sock, () => { s.off("error", reject); resolve(); }); });
  fs.chmodSync(sock, 0o600);
  server = s;
  log(`[terminal] controle local em ${sock}`);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const route = (req.url ?? "/").split("?")[0] ?? "/";
  const send = (code: number, body: unknown): void => { const s = JSON.stringify(body); res.writeHead(code, { "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(s) }); res.end(s); };
  let body: Req = {};
  if (req.method === "POST") {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Req; } catch { return send(400, { erro: "JSON inválido" }); }
  }
  try {
    send(200, await act(route, body));
    if (route === "/abrir" || route === "/digitar") log(`[terminal] controle: ${route}${typeof body.id === "string" ? ` ${body.id}` : ""}`);
  } catch (e) {
    const st = (e as { status?: number }).status ?? 400;
    send(st, { erro: e instanceof Error ? e.message : String(e) });
  }
}
