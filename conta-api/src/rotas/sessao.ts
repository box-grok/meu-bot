/**
 * `POST /sessao` (a página de login, depois do Firebase): troca o ID token por um código de uso único (120 s) preso
 * ao `state` e ao PKCE que o app pôs na URL de login. A página manda a pessoa de volta com `<esquema>://auth?code&state`.
 * `POST /sessao/sair` (o app): revoga a família de refresh desta sessão.
 */
import type { Env } from "../tipos.js";
import { auditar, contarLimite, criarCodigo, iniciarTrialSeNovo, papelAdmin, revogarFamilia, sessaoPorId, upsertConta } from "../db.js";
import { buscaJwksGoogle, verificarIdToken } from "../firebase.js";
import { agoraIso, CODE_TTL_S, janelaMinuto, LIMITE_SESSAO_POR_MIN, maisSegundos, segredo, validaPedidoSessao } from "../sessao-core.js";
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
