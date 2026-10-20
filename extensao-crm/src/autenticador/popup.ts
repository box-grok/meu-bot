/**
 * Popup do meu-bot Autenticador (ação da extensão, aberto pelo 🧩/barra do Navegador). Fala direto com o proxy do
 * app (127.0.0.1, token do config.json): /v1/crm/autenticador/* vai à máquina, onde ficam os segredos; aqui só
 * chegam os códigos. "Ler QR da página" pede ao app (o proxy) que fotografe a aba ativa e decodifique o QR.
 */
import { lerConfig, type Config } from "../config.ts";
import { parseOtpauth, type Conta, type ContaCodigo, type Previa } from "./modelo.ts";

let cfg: Promise<Config> | null = null;
const config = (): Promise<Config> => { if (cfg === null) cfg = lerConfig().catch((e) => { cfg = null; throw e; }); return cfg; };

async function api<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const c = await config();
  let r: Response;
  try { r = await fetch(`http://127.0.0.1:${c.porta}/v1/crm/autenticador${caminho}`, { method: metodo, headers: { authorization: `Bearer ${c.token}`, ...(corpo === undefined ? {} : { "content-type": "application/json" }) }, body: corpo === undefined ? null : JSON.stringify(corpo) }); }
  catch { throw new Error("o app não respondeu; feche e abra o popup"); }
  if (r.status === 401) cfg = null;
  const j = await r.json().catch(() => null) as { error?: { message?: string }; erro?: string } | null;
  if (!r.ok) throw new Error(j?.error?.message ?? j?.erro ?? `erro ${r.status}`);
  return j as T;
}

type Modo = { tipo: "lista" } | { tipo: "colar" } | { tipo: "confirmar"; previa: Previa };
let modo: Modo = { tipo: "lista" };
let contas: (ContaCodigo & { ate: number })[] = [];
let erro: string | null = null;
let carregado = false;
let ocupado = false;
let proxima: ReturnType<typeof setTimeout> | null = null;
/** Conta com o 🗑 armado: o segundo clique apaga (sem diálogo nativo dentro do popup). */
let apagando: string | null = null;

const app = document.getElementById("app") as HTMLElement;
// ✕ e Esc fecham: no Navegador do app o popup é um <webview>, e o window.close() vira o evento "close" dele.
document.getElementById("fechar")?.addEventListener("click", () => window.close());
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") window.close(); });
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls !== undefined) e.className = cls; if (texto !== undefined) e.textContent = texto; return e;
}
const botao = (cls: string, texto: string, fn: () => void, titulo?: string): HTMLButtonElement => { const b = el("button", cls, texto); b.type = "button"; if (titulo !== undefined) b.title = titulo; b.addEventListener("click", fn); return b; };
const agrupado = (codigo: string): string => (codigo.length === 6 ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : codigo.length === 8 ? `${codigo.slice(0, 4)} ${codigo.slice(4)}` : codigo);

/** Busca os códigos e agenda a próxima busca para quando o primeiro expirar. */
async function atualizar(): Promise<void> {
  if (proxima !== null) { clearTimeout(proxima); proxima = null; }
  try {
    const r = await api<{ contas: ContaCodigo[] }>("GET", "/codigos");
    const agora = Date.now();
    contas = r.contas.map((c) => ({ ...c, ate: agora + c.restante * 1000 }));
    erro = null;
  } catch (e) { erro = e instanceof Error ? e.message : String(e); }
  carregado = true;
  const menor = contas.reduce((m, c) => Math.min(m, c.ate - Date.now()), 30_000);
  proxima = setTimeout(() => { void atualizar(); }, Math.max(1000, menor + 300));
  pintar();
}

function anel(c: { periodo: number; ate: number }): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg"; const r = 11; const volta = 2 * Math.PI * r;
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 28 28"); svg.classList.add("anel");
  const resta = Math.max(0, (c.ate - Date.now()) / 1000);
  if (resta <= 5) svg.classList.add("fim");
  for (const cls of ["trilho", "resto"]) { const k = document.createElementNS(ns, "circle"); k.setAttribute("cx", "14"); k.setAttribute("cy", "14"); k.setAttribute("r", String(r)); k.setAttribute("class", cls); if (cls === "resto") { k.setAttribute("stroke-dasharray", String(volta)); k.setAttribute("stroke-dashoffset", String(volta * (1 - resta / c.periodo))); } svg.append(k); }
  const t = document.createElementNS(ns, "title"); t.textContent = `${Math.ceil(resta)} s`; svg.append(t);
  return svg;
}

let aviso: HTMLElement | null = null;
function copiar(c: Conta & { codigo: string }): void {
  void navigator.clipboard.writeText(c.codigo).then(() => {
    aviso?.remove(); aviso = el("div", "copiado", "Código copiado"); document.body.append(aviso);
    const a = aviso; setTimeout(() => a.remove(), 1400);
  }).catch(() => { erro = "não consegui copiar; selecione o código"; pintar(); });
}

async function acao(fn: () => Promise<unknown>): Promise<void> {
  ocupado = true; erro = null; pintar();
  try { await fn(); } catch (e) { erro = e instanceof Error ? e.message : String(e); }
  ocupado = false; await atualizar();
}

function pintarLista(): void {
  if (contas.length === 0 && carregado && erro === null) app.append(el("p", "aviso", "Nenhuma conta ainda. Abra a página que mostra o QR de verificação em duas etapas e clique em \"Ler QR da página\"."));
  const lista = el("div", "contas");
  for (const c of contas) {
    const item = el("div", "conta");
    item.append(el("div", "nome", c.emissor || c.conta));
    if (c.emissor !== "" && c.conta !== "") item.append(el("div", "sub", c.conta));
    const cod = botao("codigo", agrupado(c.codigo), () => copiar(c), "Clique para copiar");
    const lado = el("div", "lado");
    const acoes = el("div", "acoes");
    acoes.append(
      botao(`mini${c.agente ? " ligado" : ""}`, "🤖", () => { void acao(() => api("PATCH", `/${c.key}`, { agente: !c.agente })); }, c.agente ? "O agente pode pedir este código (registrado na máquina). Clique para tirar." : "Só você vê este código. Clique para deixar o agente usar."),
      apagando === c.key
        ? botao("mini ligado", "✓", () => { apagando = null; void acao(() => api("DELETE", `/${c.key}`)); }, "Confirmar: apagar esta conta (sem ela, você precisa de outro jeito de entrar no site)")
        : botao("mini", "🗑", () => { apagando = c.key; pintar(); setTimeout(() => { if (apagando === c.key) { apagando = null; pintar(); } }, 4000); }, "Apagar"),
    );
    lado.append(anel(c), acoes);
    item.append(cod, lado);
    lista.append(item);
  }
  if (contas.length > 0) app.append(lista);
  const botoes = el("div", "botoes");
  const colar = botao("btn btn-texto", "Digitar chave", () => { modo = { tipo: "colar" }; erro = null; pintar(); });
  const ler = botao("btn", ocupado ? "Lendo…" : "Ler QR da página", () => {
    ocupado = true; erro = null; pintar();
    void api<{ uri: string }>("POST", "/ler-qr").then((r) => { const p = parseOtpauth(r.uri); if (p === null) throw new Error("o QR da página não é de autenticador"); modo = { tipo: "confirmar", previa: p }; })
      .catch((e: unknown) => { erro = e instanceof Error ? e.message : String(e); })
      .finally(() => { ocupado = false; pintar(); });
  }, "Lê o QR de verificação em duas etapas da aba aberta no Navegador");
  ler.disabled = ocupado; colar.disabled = ocupado;
  botoes.append(colar, ler);
  app.append(botoes);
}

function pintarConfirmar(p: Previa): void {
  app.append(el("p", "aviso", "QR encontrado. Confira o nome e adicione; o segredo vai direto para a sua máquina."));
  const form = el("form");
  const emissor = el("input"); emissor.placeholder = "Serviço (ex.: Google)"; emissor.value = p.emissor;
  const conta = el("input"); conta.placeholder = "Conta (ex.: seu e-mail)"; conta.value = p.conta;
  form.append(emissor, conta);
  const botoes = el("div", "botoes");
  const add = el("button", "btn", "Adicionar"); add.type = "submit"; add.disabled = ocupado;
  botoes.append(botao("btn btn-texto", "Cancelar", () => { modo = { tipo: "lista" }; pintar(); }), add);
  form.append(botoes);
  form.addEventListener("submit", (ev) => { ev.preventDefault(); void acao(async () => { await api("POST", "", { uri: p.uri, emissor: emissor.value, conta: conta.value }); modo = { tipo: "lista" }; }); });
  app.append(form);
}

function pintarColar(): void {
  app.append(el("p", "aviso", "Sem QR? Use a chave de configuração que o site mostra (\"não consegue ler o código?\")."));
  const form = el("form");
  const emissor = el("input"); emissor.placeholder = "Serviço (ex.: Google)"; emissor.required = true;
  const conta = el("input"); conta.placeholder = "Conta (opcional)";
  const segredo = el("input"); segredo.placeholder = "Chave (letras e números)"; segredo.required = true; segredo.autocomplete = "off"; segredo.spellcheck = false;
  form.append(emissor, conta, segredo);
  const botoes = el("div", "botoes");
  const add = el("button", "btn", "Adicionar"); add.type = "submit"; add.disabled = ocupado;
  botoes.append(botao("btn btn-texto", "Cancelar", () => { modo = { tipo: "lista" }; pintar(); }), add);
  form.append(botoes);
  form.addEventListener("submit", (ev) => { ev.preventDefault(); void acao(async () => { await api("POST", "", { segredo: segredo.value, emissor: emissor.value, conta: conta.value }); modo = { tipo: "lista" }; }); });
  app.append(form);
  emissor.focus();
}

function pintar(): void {
  app.replaceChildren();
  if (erro !== null) app.append(el("p", "aviso erro", erro));
  if (modo.tipo === "confirmar") pintarConfirmar(modo.previa);
  else if (modo.tipo === "colar") pintarColar();
  else pintarLista();
}

// Anéis andam a cada segundo; só a lista (os formulários não são redesenhados no meio da digitação).
setInterval(() => { if (modo.tipo === "lista") for (const [i, s] of [...app.querySelectorAll(".anel")].entries()) { const c = contas[i]; if (c !== undefined) s.replaceWith(anel(c)); } }, 1000);
void atualizar();
