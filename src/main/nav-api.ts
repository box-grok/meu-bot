/**
 * Ações do agente no Navegador (módulo Pro). Em vez de expor o protocolo do Chrome (que exigiria emular o
 * puppeteer inteiro), o app serve meia dúzia de ações diretas nas abas do Navegador, num socket Unix 0700 só
 * nosso; o túnel SSH reverso leva esse socket até 127.0.0.1:<porta> da máquina, onde o `navegador-mcp.mjs`
 * (um arquivo, sem npm) apresenta as ações ao Claude como ferramentas e repassa para cá. Só as abas do
 * Navegador existem para o agente; a interface do app nunca.
 *
 * API (JSON): GET /abas · POST /abrir {url, nova?} · POST /ler {aba?} · POST /clicar {aba?, n?|texto?|seletor?}
 * · POST /digitar {aba?, n?|seletor?, texto, enter?} · POST /tecla {aba?, tecla} · POST /print {aba?}
 * · POST /voltar|/avancar|/recarregar {aba?} · POST /js {aba?, codigo}
 * · /favoritos · POST /favoritar {url, titulo?} · POST /desfavoritar {id?|url?}  (barra de favoritos da máquina)
 */
import { controlDir } from "./control-dir";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";
import { browserActiveWcId, browserAsk, browserConsole, browserExtensions, browserFavoriteAdd, browserFavoriteRemove, browserFavorites, browserServiceWorkers, browserWebContents } from "./browser";
import { log } from "./tunnel";

const sanit = (h: string): string => h.replace(/[^A-Za-z0-9_-]/g, "_");
export const navSocketPath = (host: string): string => path.join(controlDir(), `nav-${sanit(host)}.sock`);

const servers = new Map<string, http.Server>();
/** Sobe o serviço desta máquina (uma vez); devolve o caminho do socket que o -R vai encaminhar. */
export async function startNavApi(host: string): Promise<string> {
  const sock = navSocketPath(host);
  if (servers.has(host)) return sock;
  try { fs.unlinkSync(sock); } catch { /* não existia */ }
  const server = http.createServer((req, res) => { void handle(host, req, res); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(sock, () => { server.off("error", reject); resolve(); }); });
  fs.chmodSync(sock, 0o600);
  servers.set(host, server);
  log(`[navegador ${host}] ações do agente em ${sock}`);
  return sock;
}
export function stopNavApi(host: string): void {
  const s = servers.get(host); if (s === undefined) return;
  servers.delete(host); s.close();
  try { fs.unlinkSync(navSocketPath(host)); } catch { /* ok */ }
}

/** Texto e elementos interativos da página, numerados; o número é o que o agente usa em clicar/digitar. */
const READ_SCRIPT = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const items = []; window.__meuBotEls = [];
  const sel = "a[href], button, input, textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=textbox], [contenteditable=true], summary";
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e) || items.length >= 400) continue;
    const tag = e.tagName.toLowerCase();
    const type = e.getAttribute("type") || "";
    const label = (e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.getAttribute("title") || e.getAttribute("alt") || (e.labels && e.labels[0] && e.labels[0].innerText) || e.innerText || e.value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    const kind = tag === "a" ? "link" : tag === "input" ? (type === "checkbox" || type === "radio" ? type : type === "submit" || type === "button" ? "botão" : "campo") : tag === "textarea" || e.getAttribute("contenteditable") === "true" || e.getAttribute("role") === "textbox" ? "campo" : tag === "select" ? "seleção" : "botão";
    const n = window.__meuBotEls.push(e);
    items.push(n + ". [" + kind + "] " + label + (tag === "a" && e.href ? "  → " + e.href.slice(0, 100) : "") + (kind === "campo" && e.value ? "  (valor: " + String(e.value).slice(0, 40) + ")" : ""));
  }
  const text = (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, 12000), truncated: text.length > 12000, elements: items };
})()`;
const pick = (n: number): string => `(() => { const e = (window.__meuBotEls || [])[${n - 1}]; if (!e) throw new Error("elemento ${n} não existe: use 'ler' de novo"); return e; })()`;

interface Req { aba?: unknown; url?: unknown; nova?: unknown; n?: unknown; texto?: unknown; seletor?: unknown; enter?: unknown; tecla?: unknown; codigo?: unknown; titulo?: unknown; id?: unknown }

/** Abas de página do Navegador: o popup de uma extensão (chrome-extension://…/popup.html) também é um webview da sessão, mas não é aba. */
function tabsOf(host: string): WebContents[] { return browserWebContents(host).filter((w) => { try { return !w.getURL().startsWith("chrome-extension:"); } catch { return false; } }); }
const alive = (wc: WebContents): WebContents => { if (wc.isDestroyed()) throw new Error("essa aba foi fechada no meio da ação: chame 'abas' e siga na aba nova"); return wc; };
function tabInfo(wc: WebContents, activeId: number | null): { aba: number; url: string; titulo: string; ativa: boolean; carregando: boolean } {
  return { aba: wc.id, url: wc.getURL(), titulo: wc.getTitle(), ativa: wc.id === activeId, carregando: wc.isLoading() };
}
function resolveTab(host: string, aba: unknown): WebContents {
  const list = tabsOf(host);
  if (list.length === 0) throw new Error("a aba Navegador está sem abas: use 'abrir' com uma url");
  if (typeof aba === "number") { const t = list.find((w) => w.id === aba); if (t === undefined) throw new Error(`aba ${aba} não existe: veja 'abas'`); return t; }
  const active = browserActiveWcId(host);
  return list.find((w) => w.id === active) ?? list[0]!;
}
const waitLoad = (wc: WebContents, ms = 20_000): Promise<void> => new Promise((resolve) => {
  if (!wc.isLoading()) { resolve(); return; }
  const done = (): void => { clearTimeout(t); wc.off("did-stop-loading", done); resolve(); };
  const t = setTimeout(done, ms);
  wc.once("did-stop-loading", done);
});
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function act(host: string, route: string, b: Req): Promise<unknown> {
  const active = browserActiveWcId(host);
  switch (route) {
    case "/abas": return { abas: tabsOf(host).map((w) => tabInfo(w, active)) };
    case "/diag": {
      const wc = tabsOf(host).length === 0 ? null : resolveTab(host, b.aba);
      return { extensoes: browserExtensions(host).map((e) => ({ id: e.id, nome: e.name, versao: e.version, popup: e.popup })), service_workers: browserServiceWorkers(host), console: wc === null ? [] : browserConsole(wc.id), aba: wc === null ? null : tabInfo(wc, active) };
    }
    case "/abrir": {
      if (typeof b.url !== "string" || !/^https?:\/\//i.test(b.url)) throw new Error("url precisa começar com http:// ou https://");
      let wc: WebContents;
      if (b.nova === true || tabsOf(host).length === 0) {
        const before = new Set(tabsOf(host).map((w) => w.id));
        if (!browserAsk(host, { kind: "new-tab", url: b.url })) throw new Error("a aba Navegador não está aberta no app");
        wc = await new Promise<WebContents>((resolve, reject) => { const t0 = Date.now(); const tick = (): void => { const n = tabsOf(host).find((w) => !before.has(w.id)); if (n !== undefined) resolve(n); else if (Date.now() - t0 > 10_000) reject(new Error("a aba nova não apareceu")); else setTimeout(tick, 100); }; tick(); });
      } else { wc = resolveTab(host, b.aba); browserAsk(host, { kind: "activate", wcId: wc.id }); await wc.loadURL(b.url).catch(() => { /* erro de carga aparece no título/url */ }); }
      await waitLoad(wc); await settle(300);
      return tabInfo(alive(wc), browserActiveWcId(host));
    }
    case "/ler": {
      const wc = resolveTab(host, b.aba); await waitLoad(wc);
      // Páginas pesadas (Gmail + extensões) às vezes falham na primeira leitura logo após navegar; uma segunda tentativa resolve.
      try { return await alive(wc).executeJavaScript(READ_SCRIPT, true); }
      catch (e) { log(`[navegador ${host}] ler falhou (1ª): ${e instanceof Error ? e.message : String(e)}`); await settle(600); return await alive(wc).executeJavaScript(READ_SCRIPT, true); }
    }
    case "/clicar": {
      const wc = resolveTab(host, b.aba);
      const target = typeof b.n === "number" ? pick(b.n)
        : typeof b.seletor === "string" ? `(() => { const e = document.querySelector(${JSON.stringify(b.seletor)}); if (!e) throw new Error("nada com o seletor"); return e; })()`
          : typeof b.texto === "string" ? `(() => { const q = ${JSON.stringify(b.texto)}.toLowerCase(); const all = [...document.querySelectorAll("a, button, [role=button], [role=link], [role=tab], [role=menuitem], input[type=submit], input[type=button], summary, label")]; const e = all.find((x) => (x.innerText || x.value || x.getAttribute("aria-label") || "").toLowerCase().trim() === q) || all.find((x) => (x.innerText || x.value || x.getAttribute("aria-label") || "").toLowerCase().includes(q)); if (!e) throw new Error("nenhum botão/link com esse texto"); return e; })()`
            : null;
      if (target === null) throw new Error("diga n (número do 'ler'), texto ou seletor");
      await wc.executeJavaScript(`(() => { const e = ${target}; e.scrollIntoView({ block: "center" }); e.focus && e.focus(); e.click(); return true; })()`, true);
      await settle(500); await waitLoad(wc, 8_000);
      return { ok: true, ...tabInfo(wc, browserActiveWcId(host)) };
    }
    case "/digitar": {
      const wc = resolveTab(host, b.aba);
      if (typeof b.texto !== "string") throw new Error("falta texto");
      const target = typeof b.n === "number" ? pick(b.n) : typeof b.seletor === "string" ? `(() => { const e = document.querySelector(${JSON.stringify(b.seletor)}); if (!e) throw new Error("nada com o seletor"); return e; })()` : "document.activeElement";
      // Foca e limpa; o texto entra como digitação de verdade (insertText), que apps como o Gmail entendem.
      await wc.executeJavaScript(`(() => { const e = ${target}; e.scrollIntoView({ block: "center" }); e.focus(); if ("value" in e && typeof e.value === "string") { e.select && e.select(); } else if (e.isContentEditable) { const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } return true; })()`, true);
      await wc.insertText(b.texto);
      if (b.enter === true) { wc.sendInputEvent({ type: "keyDown", keyCode: "Return" }); wc.sendInputEvent({ type: "char", keyCode: "Return" }); wc.sendInputEvent({ type: "keyUp", keyCode: "Return" }); await settle(500); await waitLoad(wc, 8_000); }
      return { ok: true };
    }
    case "/tecla": {
      const wc = resolveTab(host, b.aba);
      const k = typeof b.tecla === "string" ? b.tecla : "";
      const map: Record<string, string> = { enter: "Return", tab: "Tab", esc: "Escape", escape: "Escape", backspace: "Backspace", space: "Space", up: "Up", down: "Down", left: "Left", right: "Right", pagedown: "PageDown", pageup: "PageUp" };
      const code = map[k.toLowerCase()] ?? (k.length === 1 ? k : null);
      if (code === null) throw new Error("tecla: enter, tab, esc, backspace, space, up, down, left, right, pageup, pagedown ou um caractere");
      wc.sendInputEvent({ type: "keyDown", keyCode: code }); if (code.length === 1 || code === "Return") wc.sendInputEvent({ type: "char", keyCode: code }); wc.sendInputEvent({ type: "keyUp", keyCode: code });
      await settle(300);
      return { ok: true };
    }
    case "/print": { const wc = resolveTab(host, b.aba); const img = await wc.capturePage(); return { png_base64: img.resize({ width: Math.min(1280, img.getSize().width) }).toPNG().toString("base64") }; }
    case "/voltar": { const wc = resolveTab(host, b.aba); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); await settle(300); await waitLoad(wc); return tabInfo(wc, active); }
    case "/avancar": { const wc = resolveTab(host, b.aba); if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); await settle(300); await waitLoad(wc); return tabInfo(wc, active); }
    case "/recarregar": { const wc = resolveTab(host, b.aba); wc.reload(); await settle(300); await waitLoad(wc); return tabInfo(wc, active); }
    case "/js": { const wc = resolveTab(host, b.aba); if (typeof b.codigo !== "string") throw new Error("falta codigo"); const r: unknown = await wc.executeJavaScript(b.codigo, true); return { resultado: typeof r === "string" ? r.slice(0, 8000) : JSON.stringify(r)?.slice(0, 8000) ?? null }; }
    case "/favoritos": return { favoritos: browserFavorites(host) };
    case "/favoritar": {
      if (typeof b.url !== "string" || !/^https?:\/\//i.test(b.url)) throw new Error("url precisa começar com http:// ou https://");
      // Sem título: o da aba que está nessa url, senão o host.
      let titulo = typeof b.titulo === "string" ? b.titulo : "";
      if (titulo.trim() === "") { const t = tabsOf(host).find((w) => w.getURL() === b.url); titulo = t?.getTitle() ?? ""; if (titulo === "") { try { titulo = new URL(b.url).hostname; } catch { /* fica vazio */ } } }
      return { favoritos: browserFavoriteAdd(host, { titulo, url: b.url }) };
    }
    case "/desfavoritar": {
      const key = typeof b.id === "string" ? b.id : typeof b.url === "string" ? b.url : "";
      if (key === "") throw new Error("informe id ou url do favorito (veja 'favoritos')");
      return { favoritos: browserFavoriteRemove(host, key) };
    }
    default: throw Object.assign(new Error(`rota desconhecida: ${route}`), { status: 404 });
  }
}

async function handle(host: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const route = (req.url ?? "/").split("?")[0] ?? "/";
  const send = (code: number, body: unknown): void => { const s = JSON.stringify(body); res.writeHead(code, { "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(s) }); res.end(s); };
  let body: Req = {};
  if (req.method === "POST") {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Req; } catch { return send(400, { erro: "JSON inválido" }); }
  }
  try { send(200, await act(host, route, body)); }
  catch (e) {
    const st = (e as { status?: number }).status ?? 400;
    const msg = (e instanceof Error ? e.message : String(e)) || "a ação falhou sem mensagem (a aba pode ter mudado); chame 'abas' e tente de novo";
    log(`[navegador ${host}] ${route} → ${st}: ${msg.slice(0, 200)}`);
    send(st, { erro: msg });
  }
}
