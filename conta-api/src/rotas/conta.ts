/** `GET /conta`: a conta desta sessão como o app a mostra (licença, devices com "este", máquinas, pedidos, papel). */
import type { Env } from "../tipos.js";
import { montarContaApi, papelAdmin } from "../db.js";
import { json, type Autenticado } from "../http.js";

export async function getConta(auth: Autenticado, env: Env): Promise<Response> {
  const adm = await papelAdmin(env.DB, auth.conta.email, env.ADMIN_BOOTSTRAP_EMAIL);
  return json(await montarContaApi(env.DB, auth.conta, adm, auth.claims.dev));
}
