/**
 * Deep link da conta meu-bot, a parte pura: ler a URL `<esquema>://auth?code=…&state=…` com que a página de login
 * (auth.agentesgrok.com) devolve a pessoa ao app, e achá-la nos argumentos (Windows/Linux e segunda instância).
 * O esquema é o do produto (esquemaDe em app/variant-core.ts): `meu-bot://`, `meu-bot-staging://`… Vem de fora =
 * dado, nunca comando: qualquer app pode registrar o mesmo esquema e mandar o que quiser; o que protege o login é o
 * `state` (tem de bater com o login pendente deste processo) e o PKCE (o `code` é inútil sem o verifier).
 */

export interface RetornoAuth { code: string; state: string }
/** null = não é uma URL deste esquema; `ok: false` = é, mas não dá para usar (a tela explica o motivo). */
export type ParseRetorno = { ok: true; retorno: RetornoAuth } | { ok: false; erro: string } | null;

/** Código de login e `state`: base64url curto, como a API e o app geram (32 bytes → 43 caracteres). */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
/** Mensagem de erro que a página pode mandar em vez do código (`?erro=…`): curta e sem controle. */
const ERRO_RE = /^[^\p{C}]{1,200}$/u;

export const ehUrlDoEsquema = (s: string, esquema: string): boolean => s.toLowerCase().startsWith(`${esquema}://`);

export function parseRetornoAuth(url: string, esquema: string): ParseRetorno {
  if (!ehUrlDoEsquema(url, esquema)) return null;
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, erro: "o link de retorno do login não é uma URL válida" }; }
  // `meu-bot://auth?…`: para o WHATWG URL o "auth" é o host; `meu-bot:///auth` (barra a mais) vem como caminho.
  const acao = (u.host !== "" ? u.host : u.pathname.replace(/^\/+/, "").replace(/\/+$/, "")).toLowerCase();
  if (acao !== "auth") return { ok: false, erro: `ação desconhecida no link de retorno: "${acao.slice(0, 40)}"` };
  const erro = u.searchParams.get("erro");
  if (erro !== null) return { ok: false, erro: ERRO_RE.test(erro) ? erro : "a página de login devolveu um erro" };
  const code = u.searchParams.get("code") ?? "", state = u.searchParams.get("state") ?? "";
  if (!TOKEN_RE.test(code) || !TOKEN_RE.test(state)) return { ok: false, erro: "o link de retorno do login veio sem código ou sem state" };
  return { ok: true, retorno: { code, state } };
}

/** A URL deste esquema entre os argumentos do processo (primeira execução no Windows/Linux, ou segunda instância). */
export function urlDeArgv(argv: readonly string[], esquema: string): string | null {
  for (const a of argv) if (ehUrlDoEsquema(a, esquema)) return a;
  return null;
}
