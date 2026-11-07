/** Miúdos de HTTP do Worker: JSON de entrada e saída, CORS para a página de login, e o Bearer do app. */
import type { AcessoClaims, ContaLinha, Env } from "./tipos.js";
import { contaPorId } from "./db.js";
import { verificarJwt } from "./sessao-core.js";

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

/** Corpo JSON até 64 KB; qualquer problema vira null (a rota responde 400). */
export async function lerJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 65536) return null;
  try { const t = await req.text(); if (t.length > 65536) return null; return JSON.parse(t); } catch { return null; }
}

/** Pelo navegador só a página de login e o console chamam a API: as duas origens são as únicas permitidas. */
export function cors(req: Request, env: Env, res: Response): Response {
  const origem = req.headers.get("origin");
  if (origem === null || (origem !== env.AUTH_ORIGIN && origem !== env.CONSOLE_ORIGIN)) return res;
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", origem);
  h.set("access-control-allow-methods", "GET, POST, OPTIONS");
  h.set("access-control-allow-headers", "content-type, authorization");
  h.set("access-control-max-age", "600");
  h.set("vary", "origin");
  return new Response(res.body, { status: res.status, headers: h });
}

export interface Autenticado { conta: ContaLinha; claims: AcessoClaims }
/** O Bearer do app: token de acesso HS256 nosso, não vencido, de uma conta que existe. */
export async function autenticar(req: Request, env: Env): Promise<Autenticado | null> {
  const m = /^Bearer\s+([A-Za-z0-9_.-]+)$/.exec(req.headers.get("authorization") ?? "");
  if (m === null) return null;
  const c = await verificarJwt(m[1]!, env.SESSAO_HMAC_KEY);
  if (c === null || typeof c.sub !== "string" || typeof c.sid !== "string") return null;
  const conta = await contaPorId(env.DB, c.sub);
  if (conta === null) return null;
  const adm = c.adm === "super" || c.adm === "admin" ? c.adm : null;
  return { conta, claims: { sub: c.sub, sid: c.sid, dev: typeof c.dev === "string" ? c.dev : null, adm, iat: c.iat as number, exp: c.exp as number } };
}
