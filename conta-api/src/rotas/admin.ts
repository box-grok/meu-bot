/**
 * Rotas do admin (Bearer com `adm`): `GET /admin/visao?busca=` (todas as contas, com licença, devices e máquinas; os
 * pedidos abertos; os totais), `PATCH /admin/contas/:id/licenca` (plano, status, prazo, limite de devices, add-ons,
 * pagamento) e `POST /admin/pedidos/:id/atender`. Liberar device e vincular máquina entram na rodada da licença
 * assinada (PR 5/6 do plano). Tudo fica na auditoria.
 */
import type { Env } from "../tipos.js";
import { atenderPedido, auditar, contaPorId, contarSupers, gravarLicenca, gravarPerfil, removerPerfil, visaoAdmin } from "../db.js";
import { UUID_RE, validaBusca, validaEmail, validaPapel, validaPatchLicenca } from "../sessao-core.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { enviarEmailSenha } from "./conta.js";

export async function getAdminVisao(auth: Autenticado, env: Env, url: URL): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  return json(await visaoAdmin(env.DB, validaBusca(url.searchParams.get("busca"))));
}
export async function postAtenderPedido(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id do pedido fora do formato" }, 400);
  if (!(await atenderPedido(env.DB, id, auth.conta.email))) return json({ erro: "pedido não existe ou já foi atendido" }, 404);
  await auditar(env.DB, auth.conta.email, "pedido.atendido", auth.conta.id, id);
  return json({ ok: true });
}
export async function patchLicenca(auth: Autenticado, env: Env, id: string, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  const patch = validaPatchLicenca(await lerJson(req));
  if ("erro" in patch) return json({ erro: patch.erro }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  const licenca = await gravarLicenca(env.DB, conta, patch);
  await auditar(env.DB, auth.conta.email, "licenca.alterada", conta.id, JSON.stringify(patch).slice(0, 500));
  return json({ ok: true, licenca });
}
/** `POST /admin/contas/:id/senha`: manda à pessoa o e-mail de criar/redefinir senha (o mesmo de "Esqueci a senha"). */
export async function postAdminSenha(auth: Autenticado, env: Env, id: string): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  if (!UUID_RE.test(id)) return json({ erro: "id da conta fora do formato" }, 400);
  const conta = await contaPorId(env.DB, id);
  if (conta === null) return json({ erro: "conta não existe" }, 404);
  return enviarEmailSenha(env, conta, auth.conta.email);
}
/** Perfis de acesso: só o super admin. `PUT /admin/perfis/:email {papel}` cria ou muda; `DELETE /admin/perfis/:email` remove. */
export async function putPerfil(auth: Autenticado, env: Env, emailRaw: string, req: Request): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin muda perfis de acesso" }, 403);
  const email = validaEmail(decodeURIComponent(emailRaw));
  if (email === null) return json({ erro: "e-mail fora do formato" }, 400);
  const corpo = await lerJson(req);
  const papel = validaPapel(corpo !== null && typeof corpo === "object" ? (corpo as { papel?: unknown }).papel : undefined);
  if (papel === null) return json({ erro: "papel: super ou admin" }, 400);
  if (email === auth.conta.email && papel !== "super") return json({ erro: "você não pode se rebaixar; peça a outro super admin" }, 400);
  await gravarPerfil(env.DB, email, papel);
  await auditar(env.DB, auth.conta.email, "perfil.gravado", auth.conta.id, `${email} = ${papel}`);
  return json({ ok: true });
}
export async function deletePerfil(auth: Autenticado, env: Env, emailRaw: string): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só o super admin muda perfis de acesso" }, 403);
  const email = validaEmail(decodeURIComponent(emailRaw));
  if (email === null) return json({ erro: "e-mail fora do formato" }, 400);
  if (email === auth.conta.email) return json({ erro: "você não pode remover o próprio acesso" }, 400);
  if (!(await removerPerfil(env.DB, email))) return json({ erro: "esse e-mail não é admin" }, 404);
  if ((await contarSupers(env.DB)) === 0) { await gravarPerfil(env.DB, email, "super"); return json({ erro: "era o último super admin; não removido" }, 400); }
  await auditar(env.DB, auth.conta.email, "perfil.removido", auth.conta.id, email);
  return json({ ok: true });
}
