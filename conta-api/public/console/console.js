// Console da conta meu-bot (console.agentesgrok.com/account/*): só leitura nesta versão. Entra pela mesma página de
// login do app (auth.agentesgrok.com) com esquema=web: o console gera state + PKCE, a página devolve #code&state, e
// POST /token {grant:"web"} vira um token de acesso de 1 h guardado só nesta aba (sessionStorage). Sem Firebase aqui.
const cfg = window.MEU_BOT_CONTA;
const $ = (id) => document.getElementById(id);
const CH_SESSAO = "meu-bot-console-sessao", CH_LOGIN = "meu-bot-console-login";
const SECOES = ["overview", "profile", "devices", "plan", "support", "access"];
const TITULOS = { overview: "Visão geral", profile: "Perfil", devices: "Devices", plan: "Plano", support: "Suporte", access: "Perfis de acesso" };
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
/** Visão do admin (todas as contas, pedidos, totais); null para quem não é admin ou enquanto não carregou. */
let visao = null, visaoBusca = "";
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
async function carregarVisao(busca) {
  const s = sessaoGuardada();
  if (s === null || conta === null || conta.admin === null) { visao = null; return; }
  const r = await api("GET", `/admin/visao?busca=${encodeURIComponent(busca)}`, undefined, s.acesso);
  if (r.status !== 200) throw new Error(erroDe(r));
  visao = r.corpo; visaoBusca = busca;
}
async function atender(id, botao) {
  const s = sessaoGuardada();
  if (s === null) return;
  botao.disabled = true;
  const r = await api("POST", `/admin/pedidos/${encodeURIComponent(id)}/atender`, {}, s.acesso);
  if (r.status !== 200) { botao.disabled = false; mostrarErro(erroDe(r)); return; }
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
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
function mostrarErro(texto) { $("erro").hidden = texto === null; $("erro").textContent = texto ?? ""; }
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
  const admin = visao !== null;
  $("console").classList.toggle("modo-admin", admin);
  $("menu-access").hidden = !(admin && c.admin === "super");
  for (const id of ["ad-overview", "ad-plan", "ad-devices", "ad-support"]) $(id).hidden = !admin;
  for (const d of document.querySelectorAll("details.pessoal")) d.open = !admin;
  if (secao === "access" && !(admin && c.admin === "super")) { history.replaceState(null, "", "/account/overview"); mostrarConsole(c); return; }
  if (admin) ({ overview: pintarAdminTotais, profile: () => undefined, devices: pintarAdminDevices, plan: pintarAdminContas, support: pintarAdminPedidos, access: pintarAdminPerfis })[secao](visao);
}
function pintarAdminPerfis(v) {
  const tb = $("ad-perfis").querySelector("tbody"); tb.replaceChildren();
  for (const p of v.perfis) {
    const tr = el("tr");
    tr.append(el("td", "", p.email));
    const papel = el("td"); const sel = el("select"); for (const [val, t] of [["admin", "admin"], ["super", "super admin"]]) { const o = el("option", "", t); o.value = val; o.selected = val === p.papel; sel.append(o); }
    sel.disabled = p.email === conta.email; sel.addEventListener("change", () => { void perfilGravar(p.email, sel.value, sel); }); papel.append(sel); tr.append(papel);
    tr.append(el("td", "", p.entrou ? "sim" : "ainda não"), el("td", "", data(p.criadoEm)));
    const td = el("td"); if (p.email !== conta.email) { const b = el("button", "btn btn-ghost", "Remover"); b.type = "button"; b.addEventListener("click", () => { void perfilRemover(p.email, b); }); td.append(b); } tr.append(td);
    tb.append(tr);
  }
}
async function perfilGravar(email, papel, controle) {
  const s = sessaoGuardada(); if (s === null) return;
  controle.disabled = true;
  const r = await api("PUT", `/admin/perfis/${encodeURIComponent(email)}`, { papel }, s.acesso);
  if (r.status !== 200) { controle.disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
async function perfilRemover(email, botao) {
  const s = sessaoGuardada(); if (s === null) return;
  if (botao.dataset.confirma !== "1") { botao.dataset.confirma = "1"; botao.textContent = "Confirmar remoção"; return; }
  botao.disabled = true;
  const r = await api("DELETE", `/admin/perfis/${encodeURIComponent(email)}`, undefined, s.acesso);
  if (r.status !== 200) { botao.disabled = false; mostrarErro(erroDe(r)); return; }
  mostrarErro(null);
  await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
  if (conta !== null) mostrarConsole(conta);
}
const DIA = 24 * 60 * 60 * 1000;
/** A fase da conta, para o admin acompanhar: trial (dias restantes), trial vencido, Pro ativo, expirado, free. */
function fase(l, agora = Date.now()) {
  const fim = Date.parse(l.expiresAt ?? l.trialEnd ?? "");
  const dias = Number.isNaN(fim) ? null : Math.ceil((fim - agora) / DIA);
  if (l.status === "trialing") return dias === null ? { texto: "Trial", tom: "ok" } : dias >= 0 ? { texto: `Trial · ${dias === 0 ? "último dia" : `${dias} dia${dias === 1 ? "" : "s"}`}`, tom: "ok" } : { texto: `Trial venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" };
  if (l.status === "active" && l.plan === "pro") return dias !== null && dias < 0 ? { texto: `Pro venceu há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "mau" } : { texto: dias === null ? "Pro ativo" : `Pro · ${dias} dia${dias === 1 ? "" : "s"}`, tom: "ok" };
  if (l.status === "expired") return { texto: "Expirado", tom: "mau" };
  return { texto: "Free", tom: "" };
}
const contaCelula = (email, nome) => { const td = el("td"); const box = el("div", "conta"); box.append(el("strong", "", nome ?? email)); if (nome) box.append(el("span", "", email)); td.append(box); return td; };
function pintarAdminTotais(v) {
  const fases = v.contas.map((c) => fase(c.licenca));
  const n = (re) => fases.filter((f) => re.test(f.texto)).length;
  $("ad-totais").replaceChildren(
    cartao("◉", "Contas", document.createTextNode(String(v.totais.contas))),
    cartao("◷", "Em trial", document.createTextNode(String(n(/^Trial ·|^Trial$/)))),
    cartao("◷", "Trial vencido", document.createTextNode(String(n(/^Trial venceu/))), ...(n(/^Trial venceu/) > 0 ? [selo("converter ou liberar", "mau")] : [])),
    cartao("⬢", "Pro ativo", document.createTextNode(String(n(/^Pro ativo|^Pro ·/)))),
    cartao("▭", "Devices pendentes", document.createTextNode(String(v.totais.devicesPendentes)), ...(v.totais.devicesPendentes > 0 ? [selo("liberar", "mau")] : [])),
    cartao("✉", "Pedidos abertos", document.createTextNode(String(v.totais.pedidosAbertos)), ...(v.totais.pedidosAbertos > 0 ? [selo("ver em Suporte", "mau")] : [])),
  );
}
function pintarAdminContas(v) {
  $("ad-busca").value = visaoBusca;
  const tb = $("ad-contas").querySelector("tbody"); tb.replaceChildren();
  if (v.contas.length === 0) { const tr = el("tr"); const td = el("td", "", visaoBusca ? "Nenhuma conta com esse e-mail ou nome." : "Ninguém entrou ainda."); td.colSpan = 8; tr.append(td); tb.append(tr); }
  for (const c of v.contas) {
    const l = c.licenca, ativos = c.devices.filter((d) => d.status !== "pending").length, pend = c.devices.length - ativos;
    const tr = el("tr");
    tr.append(contaCelula(c.email, c.nome));
    const plano = el("td"); plano.append(selo(PLANO[l.plan] ?? l.plan, l.plan === "pro" ? "ok" : "")); if (c.admin) plano.append(document.createTextNode(" "), selo(c.admin === "super" ? "super admin" : "admin")); tr.append(plano);
    const f = fase(l); const tdFase = el("td"); tdFase.append(selo(f.texto, f.tom)); tr.append(tdFase);
    tr.append(el("td", "", l.expiresAt ? data(l.expiresAt) : l.trialEnd ? data(l.trialEnd) : "-"));
    const dv = el("td", "", `${ativos}/${l.deviceLimit}`); if (pend > 0) dv.append(document.createTextNode(" "), selo(`${pend} pendente${pend === 1 ? "" : "s"}`, "mau")); tr.append(dv);
    tr.append(el("td", "", String(c.maquinas)), el("td", "", String(c.pedidos)), el("td", "", data(c.criadaEm)));
    const acao = el("td"); const b = el("button", "btn btn-ghost", "Mudar"); b.type = "button"; b.addEventListener("click", () => editorLicenca(tr, c)); acao.append(b); tr.append(acao);
    tb.append(tr);
  }
}
/** Linha de edição abaixo da conta: plano, status, vale até, limite de devices, add-ons, pagamento. Salva com PATCH. */
function editorLicenca(tr, c) {
  const existente = tr.nextElementSibling;
  if (existente !== null && existente.classList.contains("editor")) { existente.remove(); return; }
  const l = c.licenca;
  const linha = el("tr", "editor"); const td = el("td"); td.colSpan = 10;
  const form = el("form", "editor-form");
  const campo = (rotulo, input) => { const lb = el("label"); lb.append(el("span", "", rotulo), input); return lb; };
  const select = (nome, opcoes, atual) => { const s = el("select"); s.name = nome; for (const [v, t] of opcoes) { const o = el("option", "", t); o.value = v; o.selected = v === atual; s.append(o); } return s; };
  const input = (nome, tipo, valor, ph) => { const i = el("input"); i.name = nome; i.type = tipo; i.value = valor ?? ""; if (ph) i.placeholder = ph; return i; };
  const plan = select("plan", [["free", "Free"], ["pro", "Pro"]], l.plan);
  const status = select("status", [["free", "Free"], ["trialing", "Trial"], ["active", "Ativo"], ["expired", "Expirado"]], l.status);
  const ate = input("ate", "date", (l.expiresAt ?? l.trialEnd ?? "").slice(0, 10));
  const limite = input("deviceLimit", "number", String(l.deviceLimit)); limite.min = "1"; limite.max = "50";
  const produtos = input("produtos", "text", l.produtos.join(", "), "meu-bot-finance, …");
  const instrucoes = input("instrucoes", "text", l.pagamento?.instrucoes ?? "", "Pix, link, contato…");
  const link = input("link", "url", l.pagamento?.link ?? "", "https://…");
  form.append(campo("Plano", plan), campo("Status", status), campo("Vale até", ate), campo("Devices", limite), campo("Add-ons", produtos), campo("Como pagar", instrucoes), campo("Link", link));
  const salvar = el("button", "btn btn-primary", "Salvar"); salvar.type = "submit";
  const cancelar = el("button", "btn btn-ghost", "Cancelar"); cancelar.type = "button"; cancelar.addEventListener("click", () => linha.remove());
  const acoes = el("div", "acoes"); acoes.append(salvar, cancelar); form.append(acoes);
  const aviso = el("p", "sub", "Vale na conta e no console; o que libera o Pro no app ainda é a licença da máquina (próxima versão).");
  form.append(aviso);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); salvar.disabled = true;
    const ateIso = ate.value ? `${ate.value}T23:59:59.000Z` : null;
    const patch = { plan: plan.value, status: status.value, deviceLimit: Number(limite.value), produtos: produtos.value.split(",").map((x) => x.trim()).filter(Boolean), pagamento: instrucoes.value.trim() ? { instrucoes: instrucoes.value.trim(), link: link.value.trim() || null } : null };
    if (status.value === "trialing") { patch.trialEnd = ateIso; patch.expiresAt = ateIso; } else { patch.expiresAt = ateIso; patch.trialEnd = null; }
    const s = sessaoGuardada(); if (s === null) return;
    const r = await api("PATCH", `/admin/contas/${encodeURIComponent(c.id)}/licenca`, patch, s.acesso);
    if (r.status !== 200) { salvar.disabled = false; mostrarErro(erroDe(r)); return; }
    mostrarErro(null);
    await carregarVisao(visaoBusca).catch((e) => mostrarErro(e?.message ?? String(e)));
    if (conta !== null) mostrarConsole(conta);
  });
  td.append(form); linha.append(td); tr.after(linha);
}
function pintarAdminDevices(v) {
  const tb = $("ad-devices-tabela").querySelector("tbody"); tb.replaceChildren();
  const linhas = v.contas.flatMap((c) => c.devices.map((d) => ({ c, d })));
  if (linhas.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhum device em conta nenhuma."); td.colSpan = 6; tr.append(td); tb.append(tr); }
  for (const { c, d } of linhas) {
    const tr = el("tr");
    tr.append(contaCelula(c.email, c.nome), el("td", "", `${d.name || d.id.slice(0, 8)}${d.platform ? ` · ${d.platform}` : ""}`), el("td", "", d.user || "-"), el("td", "", Object.entries(d.apps ?? {}).map(([a, x]) => `${a} ${x.version}`).join(", ") || "-"));
    const st = el("td"); st.append(selo(d.status === "pending" ? "Pendente" : "Ativo", d.status === "pending" ? "mau" : "ok")); tr.append(st);
    tr.append(el("td", "", dataHora(d.lastSeen)));
    tb.append(tr);
  }
}
const TIPO_PEDIDO = { "plano.pedir": "Pro", "addon.pedir": "Add-on", "device.pedir": "Device", "importar": "Importar licença" };
function pintarAdminPedidos(v) {
  const tb = $("ad-pedidos").querySelector("tbody"); tb.replaceChildren();
  if (v.pedidos.length === 0) { const tr = el("tr"); const td = el("td", "", "Nenhum pedido aberto."); td.colSpan = 5; tr.append(td); tb.append(tr); }
  for (const p of v.pedidos) {
    const tr = el("tr");
    tr.append(el("td", "", dataHora(p.criadoEm)), contaCelula(p.conta.email, p.conta.nome), el("td", "", TIPO_PEDIDO[p.tipo] ?? p.tipo), el("td", "", p.detalhe ?? "-"));
    const td = el("td"); const b = el("button", "btn btn-ghost", "Atender"); b.type = "button"; b.addEventListener("click", () => { void atender(p.id, b); }); td.append(b); tr.append(td);
    tb.append(tr);
  }
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
$("ad-perfil-form").addEventListener("submit", (ev) => { ev.preventDefault(); const email = $("ad-perfil-email").value.trim().toLowerCase(); if (!email) return; void perfilGravar(email, $("ad-perfil-papel").value, $("ad-perfil-form").querySelector("button")).then(() => { $("ad-perfil-email").value = ""; }); });
$("ad-busca-form").addEventListener("submit", (ev) => { ev.preventDefault(); void carregarVisao($("ad-busca").value.trim()).then(() => { if (conta !== null) mostrarConsole(conta); }).catch((e) => mostrarErro(e?.message ?? String(e))); });
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
      conta = await trocarCodigo(code, state);
      await carregarVisao("").catch((e) => mostrarErro(`Visão do admin: ${e?.message ?? e}`));
      mostrarConsole(conta);
      return;
    }
    const c = await lerConta();
    if (c === null) { mostrarEntrada(null); return; }
    conta = c;
    await carregarVisao("").catch((e) => mostrarErro(`Visão do admin: ${e?.message ?? e}`));
    mostrarConsole(c);
  } catch (e) { mostrarEntrada(`Não deu para entrar: ${e?.message ?? e}`); }
})();
