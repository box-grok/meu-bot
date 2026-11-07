// Console da conta meu-bot (console.agentesgrok.com/account/*): só leitura nesta versão. Entra pela mesma página de
// login do app (auth.agentesgrok.com) com esquema=web: o console gera state + PKCE, a página devolve #code&state, e
// POST /token {grant:"web"} vira um token de acesso de 1 h guardado só nesta aba (sessionStorage). Sem Firebase aqui.
const cfg = window.MEU_BOT_CONTA;
const $ = (id) => document.getElementById(id);
const CH_SESSAO = "meu-bot-console-sessao", CH_LOGIN = "meu-bot-console-login";
const SECOES = ["overview", "profile", "devices", "plan", "support"];
const TITULOS = { overview: "Visão geral", profile: "Perfil", devices: "Devices", plan: "Plano", support: "Suporte" };
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const aleatorio = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const ss = { get(k) { try { return JSON.parse(sessionStorage.getItem(k) ?? "null"); } catch { return null; } }, set(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage: a sessão dura a página */ } } };
const data = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? "-" : new Date(t).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }); };
const dataHora = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? "-" : new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const PLANO = { free: "Free", pro: "Pro" }, STATUS = { free: "Free", trialing: "Trial", active: "Ativo", expired: "Expirado" }, CICLO = { month: "mensal", year: "anual" };
const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) e.className = cls; if (texto !== undefined) e.textContent = texto; return e; };
const selo = (texto, tom) => el("span", `selo${tom ? ` ${tom}` : ""}`, texto);
const inicial = (c) => (c.nome ?? c.email).trim().charAt(0).toUpperCase() || "?";

$("canal").textContent = $("entrada-canal").textContent = cfg.canal === "staging" ? "staging" : "";

// ---- sessão
let conta = null;
function sessaoGuardada() { const s = ss.get(CH_SESSAO); return s !== null && typeof s.acesso === "string" && Date.parse(s.expiraEm ?? "") > Date.now() + 30_000 ? s : null; }
async function api(metodo, rota, corpo, acesso) {
  const headers = { accept: "application/json" };
  if (corpo !== undefined) headers["content-type"] = "application/json";
  if (acesso) headers.authorization = `Bearer ${acesso}`;
  const r = await fetch(`${cfg.api}${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const j = await r.json().catch(() => null);
  return { status: r.status, corpo: j };
}
const erroDe = (r) => (r.corpo && typeof r.corpo.erro === "string" ? r.corpo.erro : `a API respondeu ${r.status}`);

async function entrar() {
  const verifier = aleatorio(48);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = aleatorio(32);
  ss.set(CH_LOGIN, { state, verifier, em: Date.now() });
  const retorno = `${cfg.console}${secaoAtual() === null ? "/account/overview" : location.pathname}`;
  const q = new URLSearchParams({ esquema: "web", state, challenge, app: "meu-bot-console", retorno });
  location.href = `${cfg.auth}/entrar?${q.toString()}`;
}
async function trocarCodigo(code, state) {
  const p = ss.get(CH_LOGIN);
  ss.set(CH_LOGIN, null);
  if (p === null || p.state !== state || Date.now() - p.em > 10 * 60 * 1000) throw new Error("o retorno não é deste login (ou passou de 10 min); entre de novo");
  const r = await api("POST", "/token", { grant: "web", code, verifier: p.verifier });
  if (r.status !== 200 || !r.corpo || typeof r.corpo.acesso !== "string") throw new Error(erroDe(r));
  ss.set(CH_SESSAO, { acesso: r.corpo.acesso, expiraEm: r.corpo.expiraEm });
  return r.corpo.conta;
}
async function lerConta() {
  const s = sessaoGuardada();
  if (s === null) return null;
  const r = await api("GET", "/conta", undefined, s.acesso);
  if (r.status === 401) { ss.set(CH_SESSAO, null); return null; }
  if (r.status !== 200) throw new Error(erroDe(r));
  return r.corpo;
}
async function sair() {
  const s = sessaoGuardada();
  if (s !== null) await api("POST", "/sessao/sair", {}, s.acesso).catch(() => undefined);
  ss.set(CH_SESSAO, null);
  conta = null;
  mostrarEntrada(null);
}

// ---- telas
function secaoAtual() { const m = /^\/account\/([a-z]+)\/?$/.exec(location.pathname); return m !== null && SECOES.includes(m[1]) ? m[1] : null; }
function mostrarEntrada(erro) {
  $("console").hidden = true; $("entrada").hidden = false;
  $("entrada-erro").hidden = erro === null; $("entrada-erro").textContent = erro ?? "";
}
function mostrarConsole(c) {
  conta = c;
  $("entrada").hidden = true; $("console").hidden = false;
  const secao = secaoAtual() ?? "overview";
  if (secaoAtual() === null) history.replaceState(null, "", "/account/overview");
  for (const a of $("menu").querySelectorAll("a")) a.classList.toggle("ativo", a.dataset.secao === secao);
  for (const s of document.querySelectorAll("section[data-secao]")) s.hidden = s.dataset.secao !== secao;
  $("titulo").textContent = TITULOS[secao];
  document.title = `${TITULOS[secao]} · Console meu-bot`;
  $("atualizado").textContent = `lido às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  pintarQuem(c);
  ({ overview: pintarOverview, profile: pintarPerfil, devices: pintarDevices, plan: pintarPlano, support: pintarSuporte })[secao](c);
}
function pintarQuem(c) {
  $("quem-nome").textContent = c.nome ?? c.email; $("quem-email").textContent = c.nome ? c.email : (c.admin ? `admin (${c.admin})` : "");
  const foto = typeof c.foto === "string" && /^https:\/\//.test(c.foto);
  $("quem-foto").hidden = !foto; $("quem-inicial").hidden = foto; if (foto) $("quem-foto").src = c.foto; $("quem-inicial").textContent = inicial(c);
}
function cartao(ico, rotulo, ...valor) {
  const box = el("div", "cartao-info"); box.append(el("span", "ico", ico));
  const t = el("div"); t.append(el("div", "rotulo", rotulo)); const v = el("div", "valor"); v.append(...valor); t.append(v); box.append(t);
  return box;
}
const statusTom = (l) => (l.status === "active" || l.status === "trialing" ? "ok" : l.status === "expired" ? "mau" : "");
function pintarOverview(c) {
  const l = c.licenca, ativos = c.devices.filter((d) => d.status !== "pending").length, pendentes = c.devices.length - ativos;
  $("ov-cartoes").replaceChildren(
    cartao("⬢", "Plano", selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")),
    cartao("✓", "Status", document.createTextNode(STATUS[l.status] ?? l.status), selo(l.status === "expired" ? "venceu" : "OK", statusTom(l) || "")),
    cartao("▦", "Membro desde", document.createTextNode(data(l.memberSince))),
    cartao("↻", "Ciclo de cobrança", document.createTextNode(l.interval ? CICLO[l.interval] : "-")),
    cartao("▭", "Devices", document.createTextNode(`${ativos} de ${l.deviceLimit}`), ...(pendentes > 0 ? [selo(`${pendentes} pendente${pendentes === 1 ? "" : "s"}`, "mau")] : [])),
    cartao("⌂", "Máquinas", document.createTextNode(String(c.maquinas.length))),
    ...(l.produtos.length > 0 ? [cartao("+", "Add-ons", ...l.produtos.map((p) => selo(p)))] : []),
    ...(c.pedidos > 0 ? [cartao("✉", "Pedidos abertos", document.createTextNode(String(c.pedidos)))] : []),
  );
}
function pintarPerfil(c) {
  $("pf-nome").textContent = c.nome ?? "(sem nome)"; $("pf-email").textContent = c.email;
  const foto = typeof c.foto === "string" && /^https:\/\//.test(c.foto);
  $("pf-foto").hidden = !foto; $("pf-inicial").hidden = foto; if (foto) $("pf-foto").src = c.foto; $("pf-inicial").textContent = inicial(c);
  const dl = $("pf-lista"); dl.replaceChildren();
  for (const [k, v] of [["E-mail", c.email], ["Nome", c.nome ?? "-"], ["Papel", c.admin ? `admin (${c.admin})` : "pessoa"], ["Id da conta", c.id]]) { dl.append(el("dt", "", k), el("dd", "", v)); }
}
function pintarDevices(c) {
  const l = c.licenca, ativos = c.devices.filter((d) => d.status !== "pending").length;
  $("dv-resumo").textContent = `${c.devices.length} device${c.devices.length === 1 ? "" : "s"} · ${ativos} ativo${ativos === 1 ? "" : "s"} de ${l.deviceLimit} do plano.`;
  const tb = $("dv-tabela").querySelector("tbody"); tb.replaceChildren();
  if (c.devices.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhum device ainda: entre com a conta no app meu-bot de um Mac."); td.colSpan = 5; tr.append(td); tb.append(tr); }
  for (const d of c.devices) {
    const tr = el("tr");
    const apps = Object.entries(d.apps ?? {}).map(([a, v]) => `${a} ${v.version}`).join(", ") || "-";
    tr.append(el("td", "", `${d.name || d.id.slice(0, 8)}${d.platform ? ` · ${d.platform}` : ""}`), el("td", "", d.user || "-"), el("td", "", apps));
    const st = el("td"); st.append(selo(d.status === "pending" ? "Pendente" : "Ativo", d.status === "pending" ? "mau" : "ok")); tr.append(st);
    tr.append(el("td", "", dataHora(d.lastSeen)));
    tb.append(tr);
  }
  $("dv-maquinas").textContent = c.maquinas.length === 0 ? "Nenhuma máquina (VM) vinculada à conta ainda." : `Máquinas vinculadas: ${c.maquinas.map((m) => m.apelido ?? m.id.slice(0, 8)).join(", ")}.`;
}
function pintarPlano(c) {
  const l = c.licenca;
  $("pl-cartoes").replaceChildren(
    cartao("⬢", "Plano", selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")),
    cartao("✓", "Status", document.createTextNode(STATUS[l.status] ?? l.status)),
    cartao("▦", "Vale até", document.createTextNode(l.expiresAt ? data(l.expiresAt) : l.trialEnd ? `trial até ${data(l.trialEnd)}` : "sem prazo")),
    cartao("↻", "Ciclo", document.createTextNode(l.interval ? CICLO[l.interval] : "-")),
    cartao("▭", "Limite de devices", document.createTextNode(String(l.deviceLimit))),
    cartao("+", "Add-ons", ...(l.produtos.length > 0 ? l.produtos.map((p) => selo(p)) : [document.createTextNode("nenhum")])),
  );
  const pg = l.pagamento;
  $("pl-pagamento").hidden = !pg;
  if (pg) { $("pl-instrucoes").textContent = pg.instrucoes; const link = typeof pg.link === "string" && /^https?:\/\//.test(pg.link); $("pl-link").hidden = !link; if (link) $("pl-link").href = pg.link; }
}
function pintarSuporte(c) {
  $("sp-pedidos").textContent = c.pedidos > 0 ? `Você tem ${c.pedidos} pedido${c.pedidos === 1 ? "" : "s"} aberto${c.pedidos === 1 ? "" : "s"} com o admin.` : "Nenhum pedido aberto com o admin.";
  $("sp-conta").textContent = c.id;
}

// ---- arranque
$("btn-entrar").addEventListener("click", () => { $("btn-entrar").disabled = true; void entrar(); });
$("btn-sair").addEventListener("click", () => { void sair(); });
// Os links do menu são caminhos reais (o Worker serve a mesma página para /account/*), mas trocar de seção não precisa recarregar.
$("menu").addEventListener("click", (ev) => { const a = ev.target.closest("a[data-secao]"); if (a === null || conta === null) return; ev.preventDefault(); history.pushState(null, "", a.getAttribute("href")); mostrarConsole(conta); });
window.addEventListener("popstate", () => { if (conta !== null) mostrarConsole(conta); });

(async () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  const code = hash.get("code"), state = hash.get("state");
  try {
    if (code !== null && state !== null) {
      history.replaceState(null, "", location.pathname);
      if (!TOKEN_RE.test(code) || !TOKEN_RE.test(state)) throw new Error("retorno do login fora do formato");
      mostrarConsole(await trocarCodigo(code, state));
      return;
    }
    const c = await lerConta();
    if (c === null) mostrarEntrada(null); else mostrarConsole(c);
  } catch (e) { mostrarEntrada(`Não deu para entrar: ${e?.message ?? e}`); }
})();
