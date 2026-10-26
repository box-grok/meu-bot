/**
 * Cliente mínimo da API do Tailscale para a política do tailnet (sem Electron; node:https).
 * Endpoints verificados nos docs (15 out 2026):
 *  - POST /api/v2/oauth/token (client credentials, form) → access_token de 1 h
 *  - GET  /api/v2/tailnet/-/acl  Accept: application/hujson → texto + cabeçalho ETag
 *  - POST /api/v2/tailnet/-/acl/validate  (política no corpo; não salva)
 *  - POST /api/v2/tailnet/-/acl  Content-Type: application/hujson, If-Match: <etag>; 412 = conflito
 * `baseUrl` é injetável para os testes apontarem num servidor local.
 */
import http from "node:http";
import https from "node:https";

export type TsErrorKind = "auth" | "network" | "timeout" | "http" | "conflict" | "invalid";

export class TailscaleApiError extends Error {
  readonly kind: TsErrorKind;
  readonly status: number | undefined;
  constructor(kind: TsErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface TailscaleCredential { clientId: string; clientSecret: string }
export interface TailscaleApiOptions { baseUrl?: string | undefined; timeoutMs?: number | undefined }

const DEFAULT_BASE = "https://api.tailscale.com";

interface Reply { status: number; headers: http.IncomingHttpHeaders; body: string }

function request(method: string, url: string, headers: Record<string, string>, body: string | null, timeoutMs: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method, headers: { ...headers, ...(body === null ? {} : { "Content-Length": Buffer.byteLength(body) }) }, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", (e) => reject(new TailscaleApiError("network", `api.tailscale.com: ${e.message}`)));
    });
    req.on("timeout", () => { req.destroy(); reject(new TailscaleApiError("timeout", `api.tailscale.com não respondeu em ${Math.round(timeoutMs / 1000)} s`)); });
    req.on("error", (e: NodeJS.ErrnoException) => reject(new TailscaleApiError("network", `api.tailscale.com inacessível (${e.code ?? e.message})`)));
    if (body !== null) req.write(body);
    req.end();
  });
}

const errorMessage = (body: string): string => {
  try { const j = JSON.parse(body) as { message?: unknown; error?: unknown }; const m = j.message ?? j.error; if (typeof m === "string") return m; } catch { /* corpo não é JSON */ }
  return body.replace(/\s+/g, " ").trim().slice(0, 300);
};

/** Token de acesso (1 h) para um OAuth client. 401/403 → credencial recusada. */
export async function oauthToken(cred: TailscaleCredential, opts: TailscaleApiOptions = {}): Promise<string> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const form = new URLSearchParams({ client_id: cred.clientId, client_secret: cred.clientSecret }).toString();
  const r = await request("POST", `${base}/api/v2/oauth/token`, { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, form, opts.timeoutMs ?? 15_000);
  if (r.status === 401 || r.status === 403 || r.status === 400) throw new TailscaleApiError("auth", `credencial do Tailscale recusada (client id/secret errados, ou sem o escopo policy_file): ${errorMessage(r.body)}`, r.status);
  if (r.status !== 200) throw new TailscaleApiError("http", `token: HTTP ${r.status} ${errorMessage(r.body)}`, r.status);
  let token = "";
  try { token = String((JSON.parse(r.body) as { access_token?: unknown }).access_token ?? ""); } catch { /* abaixo */ }
  if (token === "") throw new TailscaleApiError("http", "token: resposta sem access_token");
  return token;
}

const auth = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** Política atual em HuJSON (comentários preservados) e o ETag para o If-Match do POST. */
export async function getPolicy(token: string, opts: TailscaleApiOptions = {}): Promise<{ text: string; etag: string }> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const r = await request("GET", `${base}/api/v2/tailnet/-/acl`, { ...auth(token), Accept: "application/hujson" }, null, opts.timeoutMs ?? 15_000);
  if (r.status === 401 || r.status === 403) throw new TailscaleApiError("auth", `sem permissão para ler a política (escopo policy_file:read?): ${errorMessage(r.body)}`, r.status);
  if (r.status !== 200) throw new TailscaleApiError("http", `ler política: HTTP ${r.status} ${errorMessage(r.body)}`, r.status);
  const etag = r.headers["etag"];
  return { text: r.body, etag: typeof etag === "string" ? etag : "" };
}

/** Valida sem salvar. Se o servidor não aceitar o formato, devolve ok com aviso (o POST valida de novo). */
export async function validatePolicy(token: string, text: string, opts: TailscaleApiOptions = {}): Promise<{ ok: boolean; message: string }> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const r = await request("POST", `${base}/api/v2/tailnet/-/acl/validate`, { ...auth(token), "Content-Type": "application/hujson", Accept: "application/json" }, text, opts.timeoutMs ?? 15_000);
  if (r.status === 200) {
    // 200 com {message} = política inválida (o endpoint responde 200 e explica); corpo vazio = ok.
    const msg = r.body.trim() === "" ? "" : errorMessage(r.body);
    return msg === "" ? { ok: true, message: "" } : { ok: false, message: msg };
  }
  if (r.status === 415 || r.status === 400) return { ok: true, message: `validação pulada (HTTP ${r.status}); o envio valida de novo` };
  if (r.status === 401 || r.status === 403) throw new TailscaleApiError("auth", `sem permissão para validar: ${errorMessage(r.body)}`, r.status);
  throw new TailscaleApiError("http", `validar política: HTTP ${r.status} ${errorMessage(r.body)}`, r.status);
}

/** Salva a política (HuJSON) com If-Match. 412 → alguém mudou no meio; 400 → política inválida. */
export async function setPolicy(token: string, text: string, etag: string, opts: TailscaleApiOptions = {}): Promise<{ etag: string }> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const headers: Record<string, string> = { ...auth(token), "Content-Type": "application/hujson", Accept: "application/hujson" };
  if (etag !== "") headers["If-Match"] = etag;
  const r = await request("POST", `${base}/api/v2/tailnet/-/acl`, headers, text, opts.timeoutMs ?? 15_000);
  if (r.status === 412) throw new TailscaleApiError("conflict", "a política mudou no painel enquanto eu editava; tente de novo", 412);
  if (r.status === 400) throw new TailscaleApiError("invalid", `o Tailscale recusou a política: ${errorMessage(r.body)}`, 400);
  if (r.status === 401 || r.status === 403) throw new TailscaleApiError("auth", `sem permissão para salvar a política (escopo policy_file de escrita?): ${errorMessage(r.body)}`, r.status);
  if (r.status !== 200) throw new TailscaleApiError("http", `salvar política: HTTP ${r.status} ${errorMessage(r.body)}`, r.status);
  const newEtag = r.headers["etag"];
  return { etag: typeof newEtag === "string" ? newEtag : "" };
}
