/**
 * `POST /sessao` (a página de login, depois do Firebase): troca o ID token por um código de uso único (120 s) preso
 * ao `state` e ao PKCE que o app pôs na URL de login. A página manda a pessoa de volta com `<esquema>://auth?code&state`.
 * `POST /sessao/sair` (o app): revoga a família de refresh desta sessão.
 */
import type { Env } from "../tipos.js";
import { auditar, contarLimite, criarCodigo, iniciarTrialSeNovo, papelAdmin, revogarFamilia, sessaoPorId, upsertConta } from "../db.js";
import { buscaJwksGoogle, verificarIdToken } from "../firebase.js";
import { agoraIso, CHALLENGE_RE, CODE_TTL_S, ESQUEMA_WEB, janelaMinuto, LIMITE_SESSAO_POR_MIN, maisSegundos, segredo, TOKEN_RE, validaPedidoSessao } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";

export async function postSessao(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "sem-ip";
  if (await contarLimite(env.DB, `sessao:${ip}`, janelaMinuto()) > LIMITE_SESSAO_POR_MIN) return json({ erro: "muitas tentativas; espere um minuto" }, 429);
  const pedido = validaPedidoSessao(await lerJson(req));
  if ("erro" in pedido) return json({ erro: pedido.erro }, 400);
  const u = await verificarIdToken(pedido.idToken, env.FIREBASE_PROJECT_ID, buscaJwksGoogle);
  if ("erro" in u) { console.log(`[sessao] id token recusado: ${u.erro}`); return json({ erro: "login não reconhecido; entre de novo" }, 401); }
  if (!u.emailVerificado) return json({ erro: "confirme o e-mail antes de entrar" }, 403);
  const agora = agoraIso();
  const conta = await upsertConta(env.DB, u, agora);
  await papelAdmin(env.DB, conta.email, env.ADMIN_BOOTSTRAP_EMAIL, agora);
  // Primeira entrada: trial do Pro (TRIAL_DIAS), como no Rambox; o admin muda depois pelo console.
  const dias = Number.parseInt(env.TRIAL_DIAS ?? "14", 10);
  if (await iniciarTrialSeNovo(env.DB, conta, Number.isFinite(dias) ? dias : 14, agora)) await auditar(env.DB, conta.email, "licenca.trial", conta.id, `${dias} dias`, agora);
  const code = segredo(32);
  await criarCodigo(env.DB, { code, conta_id: conta.id, state: pedido.state, challenge: pedido.challenge, esquema: pedido.esquema, app: pedido.app, versao_app: pedido.versao, criado_em: agora, expira_em: maisSegundos(CODE_TTL_S) });
  await auditar(env.DB, conta.email, "login.codigo", conta.id, `${pedido.esquema}${pedido.app === null ? "" : ` · ${pedido.app} ${pedido.versao ?? ""}`}`.trim(), agora);
  return json({ code, expiraEm: CODE_TTL_S });
}

export async function postSair(auth: Autenticado, env: Env): Promise<Response> {
  const s = await sessaoPorId(env.DB, auth.claims.sid);
  if (s !== null) await revogarFamilia(env.DB, s.familia);
  await auditar(env.DB, auth.conta.email, "login.sair", auth.conta.id, null);
  return json({ ok: true });
}

/** Quanto vale o código que leva do app ao console: o app abre o navegador na hora. */
export const CODE_CONSOLE_TTL_S = 60;
/**
 * `POST /sessao/console` (o app, com o Bearer dele): um código de uso único, esquema "web", preso ao challenge que o
 * app gerou. O app abre o console com `#code&verifier`, e o console o troca no `POST /token {grant:"web"}`: quem já
 * entrou no app não entra de novo no site.
 */
export async function postSessaoConsole(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  const raw = await lerJson(req);
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const challenge = typeof o.challenge === "string" && CHALLENGE_RE.test(o.challenge) ? o.challenge : null;
  const state = typeof o.state === "string" && TOKEN_RE.test(o.state) ? o.state : segredo(32);
  if (challenge === null) return json({ erro: "challenge (PKCE) ausente ou fora do formato" }, 400);
  const agora = agoraIso();
  const code = segredo(32);
  await criarCodigo(env.DB, { code, conta_id: auth.conta.id, state, challenge, esquema: ESQUEMA_WEB, app: null, versao_app: null, criado_em: agora, expira_em: maisSegundos(CODE_CONSOLE_TTL_S) });
  await auditar(env.DB, auth.conta.email, "login.console", auth.conta.id, "do app", agora);
  return json({ code, expiraEm: CODE_CONSOLE_TTL_S });
}
