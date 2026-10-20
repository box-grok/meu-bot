/**
 * Variante: produtos com extensão do Gmail (crm). Proxy HTTP em 127.0.0.1:<porta aleatória>, um por máquina,
 * com token por abertura: a extensão (service worker) chama aqui com `Bearer <token>`; o proxy encaminha
 * /v1/crm/* pelo túnel -L já existente para o backend da máquina, com a chave do backend que a extensão nunca
 * vê. Pipe puro (SSE passa). Molde do nav-api.ts, só que em TCP (o Chromium não faz fetch a socket Unix).
 * Respondidas aqui no Mac, sem ir à máquina: /v1/crm/google/* (login no app) e /v1/crm/autenticador/ler-qr
 * (fotografa a aba ativa do Navegador e devolve o otpauth:// do QR; o segredo segue do popup para a máquina).
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { ensureTunnel, log, markDegraded } from "../tunnel";
import { getBackendPort } from "../settings";
import { autorizado, corsHeaders, hostOk, origemOk, rotaCrm } from "./extensao-api-core";
import { lerOtpauth } from "./ler-qr-core";
import { googleConectar, googleDesconectar, googleSincronizar, googleStatus } from "../google/google";
import { whatsappChats } from "../whatsapp";
import { avisarJanela } from "../browser";

export interface ExtensaoApiInfo { porta: number; token: string }
/** Captura da aba ativa do Navegador desta máquina (quem sabe qual é a aba é o browser.ts). */
export type CapturarAba = () => Promise<Electron.NativeImage>;
/** `extensoes`: id de cada extensão embutida carregada → prefixo de rota que ela pode chamar. */
interface Servidor { server: http.Server; info: ExtensaoApiInfo; extensoes: Map<string, string>; capturarAba: CapturarAba }
const servidores = new Map<string, Servidor>();
const cacheWa = new Map<string, { em: number; conversas: Record<string, { sessao: string | null; nome: string | null }> }>();

/** Sobe o proxy desta máquina (uma vez por abertura); devolve porta e token para o config.json da extensão. */
export async function startExtensaoApi(host: string, capturarAba: CapturarAba): Promise<ExtensaoApiInfo> {
  const atual = servidores.get(host);
  if (atual !== undefined) return atual.info;
  const token = randomBytes(24).toString("hex");
  const server = http.createServer((req, res) => { void tratar(host, req, res); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const addr = server.address();
  const porta = typeof addr === "object" && addr !== null ? addr.port : 0;
  const s: Servidor = { server, info: { porta, token }, extensoes: new Map(), capturarAba };
  servidores.set(host, s);
  log(`[navegador ${host}] API do CRM para a extensão em 127.0.0.1:${porta}`);
  return s.info;
}
/** Id real de uma extensão embutida carregada e o prefixo de rota dela (allowlist de origem). */
export function setExtensaoId(host: string, extId: string, prefixo: string): void { servidores.get(host)?.extensoes.set(extId, prefixo); }
export function stopExtensaoApi(host: string): void {
  const s = servidores.get(host); if (s === undefined) return;
  servidores.delete(host); s.server.close();
}
export const extensaoApiInfo = (host: string): ExtensaoApiInfo | null => servidores.get(host)?.info ?? null;

function responder(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data), ...extra });
  res.end(data);
}

async function tratar(host: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const s = servidores.get(host);
  if (s === undefined) { responder(res, 503, { erro: "proxy fechado" }); return; }
  const cors = corsHeaders(req.headers.origin);
  if (!hostOk(req.headers.host, s.info.porta)) { responder(res, 421, { erro: "host inválido" }); return; }
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  const rota = rotaCrm(req.url);
  if (rota === null) { responder(res, 404, { erro: "só /v1/crm/" }, cors); return; }
  if (!origemOk(req.headers.origin, s.extensoes, rota)) { responder(res, 403, { erro: "origem recusada" }, cors); return; }
  if (!autorizado(req.headers.authorization, s.info.token)) { responder(res, 401, { erro: "token inválido; reabra o app" }, cors); return; }
  if (rota === "/v1/crm/autenticador/ler-qr") {
    if (req.method !== "POST") { responder(res, 405, { error: { message: "use POST" } }, cors); return; }
    try {
      const img = await s.capturarAba();
      const { width, height } = img.getSize();
      const r = lerOtpauth(img.toBitmap(), width, height);
      if (r.tipo === "otpauth") { log(`[navegador ${host}] autenticador: QR lido da aba ativa`); responder(res, 200, { uri: r.uri }, cors); return; }
      responder(res, 404, { error: { message: r.tipo === "outro" ? "o QR visível na aba não é de autenticador (otpauth://)" : "nenhum QR visível na aba aberta; role até o QR aparecer inteiro e tente de novo" } }, cors);
    } catch (e) { responder(res, 400, { error: { message: `não consegui ler a aba: ${e instanceof Error ? e.message : String(e)}` } }, cors); }
    return;
  }
  // Conversas do WhatsApp do app (coluna "WhatsApp" dos Contatos): sessão de cada número e abrir a aba no app.
  if (rota.startsWith("/v1/crm/app/whatsapp")) {
    try {
      if (rota.split("?")[0] === "/v1/crm/app/whatsapp" && req.method === "GET") {
        const c = cacheWa.get(host);
        if (c === undefined || Date.now() - c.em > 60_000) cacheWa.set(host, { em: Date.now(), conversas: Object.fromEntries((await whatsappChats(host)).filter((x) => !x.isSelf).map((x) => [x.number, { sessao: x.sessionKeys.map((k) => x.sessionIds[k]).find((v): v is string => typeof v === "string") ?? null, nome: x.alias ?? x.name }])) });
        responder(res, 200, { conversas: cacheWa.get(host)?.conversas ?? {} }, cors); return;
      }
      if (rota === "/v1/crm/app/whatsapp/abrir" && req.method === "POST") {
        const corpo = await new Promise<string>((ok) => { let t = ""; req.setEncoding("utf8"); req.on("data", (d: string) => { if (t.length < 4096) t += d; }); req.on("end", () => ok(t)); });
        const numero = String((JSON.parse(corpo || "{}") as { telefone?: unknown }).telefone ?? "").replace(/\D/g, "");
        if (numero.length < 8) { responder(res, 400, { error: { message: "telefone inválido" } }, cors); return; }
        responder(res, 200, { ok: avisarJanela(host, "whatsapp:abrir", { number: numero }) }, cors); return;
      }
      responder(res, 404, { error: { message: "rota desconhecida" } }, cors);
    } catch (e) { responder(res, 400, { error: { message: e instanceof Error ? e.message : String(e) } }, cors); }
    return;
  }
  // Google Contatos: respondido aqui no Mac (login e token ficam no app), não vai para a máquina.
  if (rota.startsWith("/v1/crm/google/")) {
    const acao = rota.slice("/v1/crm/google/".length).split("?")[0];
    try {
      if (acao === "status" && req.method === "GET") { responder(res, 200, googleStatus(host), cors); return; }
      if (acao === "conectar" && req.method === "POST") { responder(res, 200, await googleConectar(host), cors); return; }
      if (acao === "sincronizar" && req.method === "POST") { responder(res, 200, await googleSincronizar(host), cors); return; }
      if (acao === "desconectar" && req.method === "POST") { responder(res, 200, await googleDesconectar(host), cors); return; }
      responder(res, 404, { error: { message: "rota do Google desconhecida" } }, cors);
    } catch (e) { responder(res, 400, { error: { message: e instanceof Error ? e.message : String(e) } }, cors); }
    return;
  }
  const t0 = Date.now();
  let tunnel: { localPort: number; apiKey: string };
  try { tunnel = await ensureTunnel(host, getBackendPort(host)); }
  catch (e) { responder(res, 503, { erro: `máquina fora do alcance: ${e instanceof Error ? e.message : String(e)}` }, cors); return; }
  const up = http.request({ host: "127.0.0.1", port: tunnel.localPort, path: rota, method: req.method, headers: { Authorization: `Bearer ${tunnel.apiKey}`, "Content-Type": req.headers["content-type"] ?? "application/json", Accept: req.headers.accept ?? "application/json", "X-Crm-Por": "extensao", ...(req.headers["content-length"] !== undefined ? { "Content-Length": req.headers["content-length"] } : {}) }, timeout: 200_000 }, (r) => { // resumo com IA e anexos grandes demoram
    res.writeHead(r.statusCode ?? 502, { ...cors, "Content-Type": r.headers["content-type"] ?? "application/json; charset=utf-8", ...(r.headers["content-length"] !== undefined ? { "Content-Length": r.headers["content-length"] } : {}) });
    r.pipe(res);
    r.on("end", () => { log(`[navegador ${host}] crm ${req.method} ${rota.slice(0, 80)} → ${r.statusCode} (${Date.now() - t0} ms)`); });
  });
  up.on("timeout", () => { up.destroy(new Error("o backend não respondeu a tempo")); });
  up.on("error", (e) => { markDegraded(host, `proxy do CRM: ${e.message}`); if (!res.headersSent) responder(res, 502, { erro: `backend não respondeu: ${e.message}` }, cors); else res.end(); });
  req.pipe(up);
  req.on("close", () => { if (!up.destroyed && !up.writableEnded) up.destroy(); });
}
