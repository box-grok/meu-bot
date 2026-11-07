// Página de login da conta meu-bot. O app abre esta página com ?state&challenge&esquema&app&v; a pessoa entra com
// Google (popup), com e-mail e senha, ou com um link por e-mail; o ID token do Firebase vai para a API (POST /sessao), que devolve um
// código de uso único; e a página manda a pessoa de volta com <esquema>://auth?code&state. Sem os parâmetros do app
// a página oferece baixar o app (SITE_ORIGIN) ou ir ao console (não há "entrar no site": a conta vive no app). Com esquema=web (o console da conta),
// a volta é para `retorno` (só a origem do console) com #code&state, em vez de um deep link.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signInWithEmailAndPassword, sendPasswordResetEmail, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const cfg = window.MEU_BOT_CONTA;
const $ = (id) => document.getElementById(id);
const secoes = ["escolha", "aguardando", "email-enviado", "senha-enviada", "pronto", "erro", "sem-app", "org-nao-achada"];
// /org/<slug>: login pela página da organização; só membro entra, e a API confere.
const orgSlug = /^\/org\/([a-z0-9-]{1,40})\/?$/.exec(location.pathname)?.[1] ?? null;
const mostrar = (id) => { for (const s of secoes) $(s).hidden = s !== id; };
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/, CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/, ESQUEMA_RE = /^[a-z][a-z0-9-]{1,40}$/;
const CHAVE_EMAIL = "meu-bot-conta-email";

// Os parâmetros do app ficam na URL (o link do e-mail volta para esta mesma URL, então sobrevivem).
const q = new URLSearchParams(location.search);
const pedido = { state: q.get("state") ?? "", challenge: q.get("challenge") ?? "", esquema: q.get("esquema") ?? "", app: q.get("app") ?? "", v: q.get("v") ?? "", retorno: q.get("retorno") ?? "" };
const paraConsole = pedido.esquema === "web";
const retornoOk = !paraConsole || (typeof cfg.console === "string" && cfg.console !== "" && (pedido.retorno === cfg.console || pedido.retorno.startsWith(`${cfg.console}/`)) && !pedido.retorno.includes("#"));
const pedidoOk = TOKEN_RE.test(pedido.state) && CHALLENGE_RE.test(pedido.challenge) && ESQUEMA_RE.test(pedido.esquema) && retornoOk;

$("canal").textContent = cfg.canal === "staging" ? "staging" : "";
$("app-info").textContent = paraConsole ? "console da conta" : pedido.app ? `${pedido.app}${pedido.v ? ` ${pedido.v}` : ""}` : "";
if (paraConsole) $("sub").textContent = "Você volta ao console sozinho depois de entrar.";

function falhou(texto) { $("erro-texto").textContent = texto; mostrar("erro"); }

// Cabeçalho da organização: nome e endereço vêm da API (sem login); endereço desconhecido vira a tela "não encontrada".
let orgOk = true;
if (orgSlug !== null) {
  for (const id of ["org-pessoal", "org-entrar"]) $(id).href = `/entrar${location.search}`;
  $("org-criar").href = `/signup${location.search}`;
  $("org-pessoal").hidden = false;
  let org = null;
  try { const r = await fetch(`${cfg.api}/orgs/${encodeURIComponent(orgSlug)}/publico`); if (r.ok) org = await r.json(); } catch { org = null; }
  if (org === null || typeof org.nome !== "string") { orgOk = false; $("org-slug-errado").textContent = orgSlug; $("titulo").textContent = "Entrar numa organização"; $("sub").textContent = ""; mostrar("org-nao-achada"); }
  else { $("titulo").textContent = `Entrar na ${org.nome}`; $("org-slug").textContent = orgSlug; $("org-selo").hidden = false; document.title = `Entrar na ${org.nome} · meu-bot`; }
}

if (!orgOk) {
  // A tela "organização não encontrada" já está na frente; nada de Firebase.
} else if (!pedidoOk) {
  // Sem os parâmetros do app (URL digitada, link velho): em vez de um erro, o caminho para baixar o app ou ir ao console.
  $("sub").textContent = "Abra o meu-bot e clique em Entrar: ele volta para cá já com o seu login.";
  if (typeof cfg.site === "string" && cfg.site !== "") $("baixar-app").href = cfg.site;
  $("ir-signup").href = "/signup";
  const ic = $("ir-console");
  if (typeof cfg.console === "string" && cfg.console !== "") ic.href = `${cfg.console}/account/overview`; else ic.hidden = true;
  mostrar("sem-app");
} else {
  const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId });
  const auth = getAuth(app);
  auth.languageCode = "pt-BR";
  // Lembra quem entrou neste navegador (como o Rambox): da próxima vez, "Continuar como …" sem a janela do Google.
  await setPersistence(auth, browserLocalPersistence).catch(() => undefined);

  // O Firebase chama senha e link por e-mail de "password": a página diz qual foi, e a conta registra o provedor certo.
  const metodoDe = (user) => ((user.providerData ?? []).some((p) => p.providerId === "google.com") ? "google" : "emailLink");
  async function concluir(user, metodo = metodoDe(user)) {
    mostrar("aguardando");
    let idToken;
    try { idToken = await user.getIdToken(true); } catch (e) { pintarLembrado(null); falhou("A sessão lembrada venceu; entre de novo."); return; }
    const r = await fetch(`${cfg.api}/sessao`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken, state: pedido.state, challenge: pedido.challenge, esquema: pedido.esquema, app: pedido.app || undefined, v: pedido.v || undefined, metodo, org: orgSlug ?? undefined }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || typeof j.code !== "string") { falhou(j.erro ?? `a API respondeu ${r.status}`); return; }
    if (paraConsole) { location.replace(`${pedido.retorno}#code=${encodeURIComponent(j.code)}&state=${encodeURIComponent(pedido.state)}`); return; }
    const volta = `${pedido.esquema}://auth?code=${encodeURIComponent(j.code)}&state=${encodeURIComponent(pedido.state)}`;
    $("abrir-app").href = volta;
    $("codigo").textContent = j.code;
    mostrar("pronto");
    // O navegador pergunta "abrir o meu-bot?" e o app recebe a URL; a página fica como está, com o botão para repetir.
    location.href = volta;
  }

  // Quem já entrou neste navegador: cartão com nome, e-mail e "Continuar"; "Não é você?" esquece e mostra as opções.
  function pintarLembrado(user) {
    const tem = user !== null && typeof user.email === "string";
    $("lembrado").hidden = !tem;
    if (!tem) return;
    const nome = user.displayName || user.email;
    $("lembrado-nome").textContent = nome; $("lembrado-email").textContent = user.displayName ? user.email : "";
    const foto = typeof user.photoURL === "string" && /^https:\/\//.test(user.photoURL);
    $("lembrado-foto").hidden = !foto; $("lembrado-inicial").hidden = foto;
    if (foto) $("lembrado-foto").src = user.photoURL; else $("lembrado-inicial").textContent = nome.trim().charAt(0).toUpperCase();
    $("btn-lembrado").textContent = `Continuar como ${(user.displayName || user.email).split(" ")[0]}`;
  }
  const lembrado = await new Promise((r) => { const parar = auth.onAuthStateChanged((u) => { parar(); r(u); }); });
  pintarLembrado(lembrado);
  $("btn-lembrado").addEventListener("click", async () => { const u = auth.currentUser; if (u === null) { pintarLembrado(null); return; } try { await concluir(u); } catch (e) { falhou(`${e?.message ?? e}`); } });
  $("lembrado-nao").addEventListener("click", async () => { try { await signOut(auth); } catch { /* ok */ } pintarLembrado(null); });

  $("btn-google").addEventListener("click", async () => {
    mostrar("aguardando");
    try { const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" }); const cred = await signInWithPopup(auth, prov); await concluir(cred.user, "google"); }
    catch (e) { falhou(e?.code === "auth/popup-closed-by-user" ? "A janela do Google foi fechada antes de terminar." : `Google: ${e?.message ?? e}`); }
  });

  // E-mail com senha entra na hora; sem senha, vai um link por e-mail (o que a pessoa sempre teve).
  $("form-email").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("email").value.trim().toLowerCase(), senha = $("senha").value;
    if (!email) return;
    $("btn-email").disabled = true;
    try {
      if (senha !== "") {
        mostrar("aguardando");
        try { const cred = await signInWithEmailAndPassword(auth, email, senha); await concluir(cred.user, "password"); }
        catch (e) {
          const c = e?.code ?? "";
          if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found" || c === "auth/invalid-login-credentials") { mostrar("escolha"); $("senha").value = ""; $("senha").focus(); $("senha").placeholder = "Senha errada, ou esta conta ainda não tem senha"; }
          else if (c === "auth/too-many-requests") falhou("Muitas tentativas de senha; espere um pouco ou peça um link por e-mail.");
          else falhou(`Senha: ${e?.message ?? e}`);
        }
        return;
      }
      await sendSignInLinkToEmail(auth, email, { url: location.href, handleCodeInApp: true });
      try { localStorage.setItem(CHAVE_EMAIL, email); } catch { /* sem localStorage: a volta pede o e-mail */ }
      $("email-destino").textContent = email;
      mostrar("email-enviado");
    } catch (e) { falhou(`E-mail: ${e?.message ?? e}`); }
    finally { $("btn-email").disabled = false; }
  });
  // "Esqueci a senha" (também serve para criar a primeira): o e-mail do Firebase leva ao formulário de definir senha.
  $("esqueci").addEventListener("click", async () => {
    const email = $("email").value.trim().toLowerCase();
    if (!email) { $("email").focus(); $("email").reportValidity(); return; }
    $("esqueci").disabled = true;
    try { await sendPasswordResetEmail(auth, email); $("senha-destino").textContent = email; mostrar("senha-enviada"); }
    catch (e) { falhou(e?.code === "auth/user-not-found" ? "Não há conta com esse e-mail: entre com o Google ou peça um link." : `Senha: ${e?.message ?? e}`); }
    finally { $("esqueci").disabled = false; }
  });
  $("senha-voltar").addEventListener("click", () => mostrar("escolha"));

  $("tentar").addEventListener("click", () => mostrar("escolha"));
  $("ir-signup").href = `/signup${location.search}`;

  if (isSignInWithEmailLink(auth, location.href)) {
    // Voltou pelo link do e-mail: o e-mail fica guardado neste navegador; se não está (outro navegador), pergunta.
    let email = null;
    try { email = localStorage.getItem(CHAVE_EMAIL); } catch { email = null; }
    if (!email) email = window.prompt("Confirme o e-mail que recebeu o link:");
    if (!email) { mostrar("escolha"); }
    else {
      mostrar("aguardando");
      try { const cred = await signInWithEmailLink(auth, email.trim().toLowerCase(), location.href); try { localStorage.removeItem(CHAVE_EMAIL); } catch { /* ok */ } await concluir(cred.user, "emailLink"); }
      catch (e) { falhou(`O link não serviu (${e?.code ?? e}). Peça um novo.`); }
    }
  } else {
    mostrar("escolha");
  }
}
