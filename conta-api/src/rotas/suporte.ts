/**
 * Janelas de suporte no console: `POST /admin/suporte` (qualquer admin; o meu-bot-admin-gestao envia o resumo da
 * pessoa que acabou de ler) e `GET /admin/suporte` (só o super admin; a lista em console.agentesgrok.com/support-window).
 */
import type { Env } from "../tipos.js";
import { json, lerJson, type Autenticado } from "../http.js";
import { validaResumoSuporte } from "../suporte-core.js";

export async function postSuporteResumo(auth: Autenticado, env: Env, req: Request): Promise<Response> {
  if (auth.claims.adm === null) return json({ erro: "só admin" }, 403);
  const c = validaResumoSuporte(await lerJson(req));
  if ("erro" in c) return json({ erro: c.erro }, 400);
  const agora = new Date().toISOString();
  await env.DB.prepare("INSERT INTO suporte_resumo (id, nome, maquina, enviado_por, atualizado_em, resumo) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, maquina = excluded.maquina, enviado_por = excluded.enviado_por, atualizado_em = excluded.atualizado_em, resumo = excluded.resumo")
    .bind(c.id, c.nome, c.maquina, auth.conta.email, agora, JSON.stringify({ ...c.resumo, acesso: c.acesso })).run();
  return json({ ok: true, atualizadoEm: agora });
}

export async function getSuporteResumos(auth: Autenticado, env: Env): Promise<Response> {
  if (auth.claims.adm !== "super") return json({ erro: "só super admin" }, 403);
  const r = await env.DB.prepare("SELECT id, nome, maquina, enviado_por, atualizado_em, resumo FROM suporte_resumo ORDER BY atualizado_em DESC LIMIT 200").all<{ id: string; nome: string; maquina: string | null; enviado_por: string; atualizado_em: string; resumo: string }>();
  const pessoas = (r.results ?? []).map((l) => {
    let resumo: unknown = null; try { resumo = JSON.parse(l.resumo); } catch { resumo = null; }
    return { id: l.id, nome: l.nome, maquina: l.maquina, enviadoPor: l.enviado_por, atualizadoEm: l.atualizado_em, resumo };
  });
  return json({ pessoas });
}
