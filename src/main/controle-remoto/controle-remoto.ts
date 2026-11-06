/**
 * Controle remoto (MCP): o servidor que deixa um cliente MCP deste Mac (Claude Code, Cursor…) controlar o app, no
 * molde do Remote Control do Rambox. HTTP em 127.0.0.1:<porta>, só `POST /mcp`, `Authorization: Bearer <token>`,
 * sem sessão (cada pedido é um JSON-RPC completo com resposta JSON). As ferramentas de terminal e de Navegador vão
 * para os sockets que o app já publica (term-api.ts, nav-api.ts), como o scripts/app-mcp.mjs faz de fora: o selo
 * de quem mexeu, a posse das abas e o registro de depuração continuam os mesmos. Só as ferramentas do app em si
 * (janelas, página, tema, print) chamam o main direto. Desligado até a pessoa ligar em Configurações.
 */
import { app, nativeTheme } from "electron";
import fs from "node:fs";
import http from "node:http";
import type { ControleRemotoView, Theme } from "../../shared/ipc";
import { registrarAcao } from "../app/depuracao";
import { getControleRemoto, setControleRemoto, setLastHost, settingsView, updateSettings } from "../app/settings";
import { isTheme } from "../app/settings-normalize";
import { appTitle, produto } from "../app/variant";
import { allMainWindows, broadcast, hostOfWindow, lastFocusedWindow, openMainWindow, sendWhenLoaded, windowForHost } from "../app/windows";
import { log } from "../maquina/backend";
import { LOCAL_HOST } from "../maquina/localBackend";
import { listSshHosts } from "../maquina/sshConfig";
import { navSocketPath } from "../navegador/nav-api";
import { termSocketPath } from "../terminal/term-api";
import { MAX_CORPO, PAGINAS, configClaudeCode, configCursor, donoDe, erroRpc, gerarToken, pedidoOk, responderJsonRpc, roteador, urlMcp, type Destino, type Pagina } from "./controle-remoto-core";

let servidor: http.Server | null = null;
let portaAtiva = 0;
let erroAtual: string | null = null;

/** Porta em uso (ou a que vai ser usada): a gravada, senão a padrão da variante. */
export const portaControleRemoto = (): number => getControleRemoto().porta ?? produto().portaMcp;

export function estadoControleRemoto(): ControleRemotoView {
  const c = getControleRemoto();
  const porta = portaControleRemoto();
  const nome = appTitle().replace(/\s.*$/, ""); // "meu-bot-staging 0.80.0" → "meu-bot-staging"
  return {
    ligado: c.ligado, porta, portaPadrao: produto().portaMcp, token: c.token, rodando: servidor !== null, erro: erroAtual, url: urlMcp(porta), nome,
    configClaudeCode: c.token === "" ? "" : configClaudeCode(nome, porta, c.token),
    configCursor: c.token === "" ? "" : configCursor(nome, porta, c.token),
  };
}

/** Sobe o servidor com o que está gravado (gera o token se ainda não há). Porta ocupada vira `erro` no estado, não exceção. */
export async function startControleRemoto(): Promise<void> {
  if (servidor !== null) return;
  const c = getControleRemoto();
  if (c.token === "") setControleRemoto({ token: gerarToken() });
  const porta = portaControleRemoto();
  const s = http.createServer((req, res) => { void handle(req, res); });
  s.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    const body = JSON.stringify(erroRpc(null, -32000, `pedido malformado (${err.code ?? "erro"})`));
    if (socket.writable) socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  });
  try {
    await new Promise<void>((resolve, reject) => { s.once("error", reject); s.listen(porta, "127.0.0.1", () => { s.off("error", reject); resolve(); }); });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    erroAtual = code === "EADDRINUSE" ? `a porta ${porta} já está em uso neste Mac; escolha outra` : `não subiu: ${e instanceof Error ? e.message : String(e)}`;
    log(`[mcp] controle remoto não subiu em 127.0.0.1:${porta}: ${erroAtual}`);
    return;
  }
  servidor = s; portaAtiva = porta; erroAtual = null;
  log(`[mcp] controle remoto em ${urlMcp(porta)}`);
}
export function stopControleRemoto(): void {
  const s = servidor; if (s === null) return;
  servidor = null; portaAtiva = 0;
  s.close();
  log("[mcp] controle remoto desligado");
}
/** Porta ou token novos: derruba e sobe de novo (só se está ligado). */
export async function reiniciarControleRemoto(): Promise<void> {
  stopControleRemoto();
  erroAtual = null;
  if (getControleRemoto().ligado) await startControleRemoto();
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const send = (code: number, body: unknown): void => { const s = JSON.stringify(body); res.writeHead(code, { "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(s) }); res.end(s); };
  const ok = pedidoOk(req, portaAtiva, getControleRemoto().token);
  if (!ok.ok) {
    res.setHeader("Allow", "POST");
    send(ok.status, erroRpc(null, -32000, ok.erro));
    if (ok.status === 401 || ok.status === 403 || ok.status === 421) registrarAcao({ origem: "mcp", dono: null, rota: req.url ?? "/", corpo: {}, t0: Date.now(), erro: `${ok.status}: ${ok.erro}` });
    return;
  }
  const chunks: Buffer[] = []; let tamanho = 0;
  for await (const c of req) { tamanho += (c as Buffer).length; if (tamanho > MAX_CORPO) { send(413, erroRpc(null, -32000, "pedido grande demais")); req.destroy(); return; } chunks.push(c as Buffer); }
  let msg: unknown;
  try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); } catch { send(400, erroRpc(null, -32700, "JSON inválido")); return; }
  const dono = donoDe(req.headers["x-meu-bot-cliente"]);
  const r = await responderJsonRpc(msg, (nome, args) => chamar(nome, args, dono), { nome: estadoControleRemoto().nome, versao: app.getVersion() });
  if (r === null) { res.writeHead(202); res.end(); return; }
  send(200, r);
}

/* ---------- As ferramentas ---------- */
type Dono = ReturnType<typeof donoDe>;
async function chamar(nome: string, args: Record<string, unknown>, dono: Dono): Promise<unknown> {
  const d = roteador(nome, args);
  if (d.alvo === "terminal") return pedir(termSocketPath(), d.rota, d.corpo, dono);
  if (d.alvo === "navegador") return pedir(socketNavegador(d.maquina), d.rota, d.corpo, dono);
  const t0 = Date.now();
  try {
    const r = await acaoApp(d);
    registrarAcao({ origem: "mcp", dono, rota: `/${d.acao}`, corpo: d.args, t0, resultado: d.acao === "print_janela" ? { png: true } : r });
    return r;
  } catch (e) {
    registrarAcao({ origem: "mcp", dono, rota: `/${d.acao}`, corpo: d.args, t0, erro: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** O Navegador da máquina pedida (ou da única aberta): o socket só existe com a aba Navegador aberta e o 🤖 ligado. */
function socketNavegador(maquina: string | undefined): string {
  const abertos = allMainWindows().map((w) => hostOfWindow(w)).filter((h): h is string => h !== undefined && fs.existsSync(navSocketPath(h)));
  if (maquina !== undefined) {
    if (!abertos.includes(maquina)) throw new Error(`o Navegador de "${maquina}" não está aberto (abertos: ${abertos.join(", ") || "nenhum"}); abra a aba Navegador no app`);
    return navSocketPath(maquina);
  }
  if (abertos.length === 1) return navSocketPath(abertos[0]!);
  if (abertos.length === 0) throw new Error("nenhuma aba Navegador aberta (ou o 🤖 agente pode usar está desligado); abra-a no app");
  throw new Error(`o Navegador está aberto em várias máquinas (${abertos.join(", ")}): diga qual em "maquina"`);
}

/** Pedido a um socket do próprio app, com a identidade de quem pede (o selo "✳️ Cursor (MCP) · digitou"). */
function pedir(socketPath: string, rota: string, corpo: Record<string, unknown> | undefined, dono: Dono): Promise<unknown> {
  const get = corpo === undefined; const data = get ? "" : JSON.stringify(corpo);
  const donoHdr = Buffer.from(JSON.stringify(dono), "utf8").toString("base64");
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: `/${rota}`, method: get ? "GET" : "POST", agent: false, headers: { "X-Meu-Bot-Dono": donoHdr, ...(get ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }) }, timeout: 90_000 }, (res) => {
      const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        let j: { erro?: string };
        try { j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { erro?: string }; } catch { reject(new Error(`resposta inválida do app (${res.statusCode})`)); return; }
        if (res.statusCode !== 200) { reject(new Error(j.erro ?? `HTTP ${res.statusCode}`)); return; }
        resolve(j);
      });
    });
    req.on("timeout", () => { req.destroy(new Error("o app não respondeu em 90 s")); });
    req.on("error", (e: NodeJS.ErrnoException) => reject(new Error(e.code === "ENOENT" || e.code === "ECONNREFUSED" ? "esse serviço do app não está de pé (abra a aba correspondente)" : e.message)));
    if (!get) req.write(data);
    req.end();
  });
}

/** Janela da máquina pedida (ou a última focada que tenha máquina), como em term-api.ts. */
function janela(maquina: unknown): Electron.BrowserWindow {
  const wins = allMainWindows();
  if (typeof maquina === "string" && maquina !== "") {
    const w = windowForHost(maquina);
    if (w === undefined) throw new Error(`nenhuma janela aberta da máquina "${maquina}": abertas: ${wins.map((x) => hostOfWindow(x)).join(", ") || "nenhuma"}; use janela_abrir`);
    return w;
  }
  const f = lastFocusedWindow();
  const w = f !== null && wins.includes(f) ? f : wins[0];
  if (w === undefined) throw new Error("nenhuma janela de máquina aberta no app; use janela_abrir");
  return w;
}

async function acaoApp(d: Extract<Destino, { alvo: "app" }>): Promise<unknown> {
  const a = d.args;
  switch (d.acao) {
    case "app": {
      const foco = lastFocusedWindow();
      return { app: estadoControleRemoto().nome, variante: produto().variant, versao: app.getVersion(), tema: settingsView().theme, janelas: allMainWindows().map((w) => ({ maquina: hostOfWindow(w), foco: w === foco })), maquinas: [LOCAL_HOST, ...listSshHosts()] };
    }
    case "janela_abrir": {
      const host = typeof a["maquina"] === "string" ? a["maquina"] : "";
      if (host !== LOCAL_HOST && !listSshHosts().includes(host)) throw new Error(`a máquina "${host}" não está no ~/.ssh/config (use "local" para este Mac); veja \`app\``);
      setLastHost(host);
      const existia = windowForHost(host) !== undefined;
      openMainWindow(host, "menu");
      return { ok: true, maquina: host, nova: !existia };
    }
    case "pagina_abrir": {
      const pagina = PAGINAS.find((p) => p === a["pagina"]);
      if (pagina === undefined) throw new Error(`página desconhecida; use uma de: ${PAGINAS.join(", ")}`);
      const w = janela(a["maquina"]);
      sendWhenLoaded(w, "ui:abrir-pagina", { pagina: pagina as Pagina });
      return { ok: true, pagina, maquina: hostOfWindow(w) };
    }
    case "tema": {
      const tema = a["tema"];
      if (!isTheme(tema)) throw new Error("tema inválido: system, light ou dark");
      const view = updateSettings({ theme: tema as Theme });
      nativeTheme.themeSource = view.theme;
      broadcast("settings:changed", settingsView());
      return { ok: true, tema: view.theme };
    }
    case "print_janela": {
      const w = janela(a["maquina"]);
      const img = await w.webContents.capturePage();
      const { width } = img.getSize();
      return { png_base64: (width > 1280 ? img.resize({ width: 1280 }) : img).toPNG().toString("base64") };
    }
  }
}
