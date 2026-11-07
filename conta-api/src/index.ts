/**
 * Worker da conta meu-bot. Um Worker, três hosts:
 * - auth.agentesgrok.com: a página de login (static assets em public/) e o /config.js com o projeto Firebase;
 * - console.agentesgrok.com: o console da conta (public/console/, uma página para /account/*), que entra pela página
 *   de login com `esquema=web` e fala com a API só com o token de acesso (sem Firebase nem device no console);
 * - conta.agentesgrok.com: a API (POST /sessao, POST /token, POST /sessao/sair, GET /conta, GET /health; para admins
 *   GET /admin/visao e POST /admin/pedidos/:id/atender).
 * Em staging, *-staging. com D1 próprio. Tudo que chega é dado: as rotas validam campo a campo.
 */
import type { Env } from "./tipos.js";
import { autenticar, cors, json } from "./http.js";
import { postSair, postSessao } from "./rotas/sessao.js";
import { postToken } from "./rotas/token.js";
import { getConta } from "./rotas/conta.js";
import { deletePerfil, getAdminVisao, patchLicenca, postAtenderPedido, putPerfil } from "./rotas/admin.js";

const SEGURANCA: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** A página de login precisa do SDK do Firebase (gstatic) e de falar com o Firebase Auth e com a API da conta. */
const cspDaPagina = (env: Env): string => [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com https://apis.google.com",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://apis.google.com " + env.API_ORIGIN,
  "frame-src https://*.firebaseapp.com https://accounts.google.com",
  "img-src 'self' data: https:",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function comCabecalhos(res: Response, extra: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...SEGURANCA, ...extra })) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const configJs = (cfg: Record<string, string>): Response =>
  new Response(`window.MEU_BOT_CONTA = ${JSON.stringify(cfg)};\n`, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });

async function pagina(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/config.js") return comCabecalhos(configJs({ apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID, api: env.API_ORIGIN, canal: env.CANAL, console: env.CONSOLE_ORIGIN }), {});
  const res = await env.ASSETS.fetch(req);
  return comCabecalhos(res, { "content-security-policy": cspDaPagina(env) });
}

/** O console não carrega Firebase: só o próprio JS e a API. */
const cspDoConsole = (env: Env): string => ["default-src 'self'", "script-src 'self'", `connect-src 'self' ${env.API_ORIGIN}`, "img-src 'self' data: https:", "style-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
/** /account/* e a raiz são a mesma página (o JS escolhe a seção pelo caminho); o resto são os assets de public/console/. */
async function consolePagina(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/config.js") return comCabecalhos(configJs({ api: env.API_ORIGIN, auth: env.AUTH_ORIGIN, console: env.CONSOLE_ORIGIN, canal: env.CANAL }), {});
  const caminho = url.pathname === "/" || url.pathname === "/account" || url.pathname.startsWith("/account/") ? "/console/index.html" : url.pathname;
  const res = await env.ASSETS.fetch(new Request(new URL(caminho, url.origin).toString(), { method: "GET", headers: req.headers }));
  // Tudo sem cache: o console muda junto com a API, e um JS velho de 5 min já mostrou tela errada depois de um deploy.
  return comCabecalhos(res, { "content-security-policy": cspDoConsole(env), "cache-control": "no-store" });
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.method === "OPTIONS") return cors(req, env, new Response(null, { status: 204 }));
  const rota = `${req.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
  let res: Response;
  if (rota === "GET /health") res = json({ ok: true, canal: env.CANAL });
  else if (rota === "POST /sessao") res = await postSessao(req, env);
  else if (rota === "POST /token") res = await postToken(req, env);
  else if (rota === "POST /sessao/sair" || rota === "GET /conta" || rota.startsWith("GET /admin/") || rota.startsWith("POST /admin/") || rota.startsWith("PATCH /admin/") || rota.startsWith("PUT /admin/") || rota.startsWith("DELETE /admin/")) {
    const auth = await autenticar(req, env);
    const atender = /^POST \/admin\/pedidos\/([A-Za-z0-9-]{1,40})\/atender$/.exec(rota);
    const licenca = /^PATCH \/admin\/contas\/([A-Za-z0-9-]{1,40})\/licenca$/.exec(rota);
    const perfil = /^(PUT|DELETE) \/admin\/perfis\/([^/]{3,200})$/.exec(rota);
    if (auth === null) res = json({ erro: "entre de novo" }, 401, { "www-authenticate": "Bearer" });
    else if (rota === "GET /conta") res = await getConta(auth, env);
    else if (rota === "POST /sessao/sair") res = await postSair(auth, env);
    else if (rota === "GET /admin/visao") res = await getAdminVisao(auth, env, url);
    else if (atender !== null) res = await postAtenderPedido(auth, env, atender[1]!);
    else if (licenca !== null) res = await patchLicenca(auth, env, licenca[1]!, req);
    else if (perfil !== null) res = perfil[1] === "PUT" ? await putPerfil(auth, env, perfil[2]!, req) : await deletePerfil(auth, env, perfil[2]!);
    else res = json({ erro: "rota desconhecida" }, 404);
  } else res = json({ erro: "rota desconhecida" }, 404);
  return comCabecalhos(cors(req, env, res), {});
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origem = `https://${url.host}`;
    try {
      return origem === env.AUTH_ORIGIN ? await pagina(req, env, url) : origem === env.CONSOLE_ORIGIN ? await consolePagina(req, env, url) : await api(req, env, url);
    } catch (e) {
      console.log(`[conta-api] ${req.method} ${url.pathname}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      return comCabecalhos(json({ erro: "falha interna; tente de novo" }, 500), {});
    }
  },
} satisfies ExportedHandler<Env>;
