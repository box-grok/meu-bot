/**
 * Service worker: o do InboxSDK (injeta o pageWorld.js no mundo da página quando o content script pede) + o relay
 * dos pedidos ao proxy do app (127.0.0.1:<porta>, token do config.json). Só o worker conhece o token; só aceita
 * mensagens da própria extensão; caminhos validados. Polling fica no content script (chrome.alarms não existe
 * no Navegador do app).
 */
import "@inboxsdk/core/background.js";
import { caminhoOk, type MensagemCrm, type Resposta } from "./api.ts";
import { lerConfig, type Config } from "./config.ts";

let cfg: Promise<Config> | null = null;
const config = (): Promise<Config> => { if (cfg === null) cfg = lerConfig().catch((e) => { cfg = null; throw e; }); return cfg; };

chrome.runtime.onMessage.addListener((msg: MensagemCrm, sender, responder: (r: Resposta | Config | { erro: string }) => void) => {
  if (msg === null || typeof msg !== "object" || typeof msg.tipo !== "string" || !msg.tipo.startsWith("crm:")) return false; // mensagens do SDK seguem para o listener dele
  if (sender.id !== chrome.runtime.id) { responder({ status: 0, json: { erro: "origem recusada" } }); return false; }
  (async () => {
    if (msg.tipo === "crm:config") { responder(await config()); return; }
    if (!caminhoOk(msg.caminho) || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(msg.metodo)) { responder({ status: 400, json: { error: { message: "pedido inválido" } } }); return; }
    const c = await config();
    const r = await fetch(`http://127.0.0.1:${c.porta}/v1/crm${msg.caminho}`, { method: msg.metodo, headers: { authorization: `Bearer ${c.token}`, accept: "application/json", ...(msg.corpo === undefined ? {} : { "content-type": "application/json" }) }, body: msg.corpo === undefined ? null : JSON.stringify(msg.corpo) });
    if (r.status === 401) cfg = null; // token girou (o app reabriu): relê na próxima
    responder({ status: r.status, json: await r.json().catch(() => null) });
  })().catch((e: unknown) => { responder({ status: 0, json: { erro: e instanceof Error ? e.message : String(e) } }); });
  return true;
});
