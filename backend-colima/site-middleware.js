// Portão de senha do meu-bot para sites no Cloudflare Pages: página própria só com campo de senha (sem usuário).
// Copie como `functions/_middleware.js` na raiz da pasta que vai subir e troque TITULO. A senha é o segredo
// SITE_SENHA do projeto Pages (`wrangler pages secret put SITE_SENHA`). Sem o segredo, o site responde 503:
// falha fechada, nunca aberta. Acertou a senha: cookie derivado por HMAC, 30 dias; a senha não vai no cookie.
const TITULO = "meu-bot";
const COOKIE = "site_ok";

async function assinatura(segredo, sal) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("meu-bot-site:" + sal));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparação sem vazar o tamanho pelo tempo de resposta.
function igual(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) d |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return d === 0;
}

function pagina(erro) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${TITULO}</title><style>
:root{--bg:#f3f2ef;--surface:#fcfcfb;--ink:#0b0b0b;--line:#d9d8d3;--s1:#2a78d6;--err:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#111110;--surface:#1a1a19;--ink:#f0efec;--line:#33332f;--s1:#3987e5;--err:#e8705f}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
form{background:var(--surface);border-radius:12px;padding:28px 24px;width:min(340px,92vw)}h1{font-size:18px;margin:0 0 16px}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
button{width:100%;margin-top:12px;font:inherit;font-weight:600;padding:10px;border:0;border-radius:8px;background:var(--s1);color:#fff;cursor:pointer}
.err{color:var(--err);font-size:13px;margin:8px 0 0}</style></head><body>
<form method="post"><h1>${TITULO}</h1>
<input type="password" name="senha" placeholder="Senha" autocomplete="current-password" autofocus required>
${erro ? '<p class="err">Senha incorreta.</p>' : ""}<button type="submit">Entrar</button></form></body></html>`;
  return new Response(html, {
    status: erro ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function onRequest({ request, env, next }) {
  // PAINEL_SENHA: compatibilidade com o lv-painel, que é anterior a este padrão.
  const segredo = env.SITE_SENHA || env.PAINEL_SENHA;
  if (!segredo) return new Response("Site sem senha configurada.", { status: 503 });
  // O sal é o commit do deploy (o Pages injeta CF_PAGES_COMMIT_SHA): o cookie troca a cada publicação.
  const esperado = await assinatura(segredo, env.CF_PAGES_COMMIT_SHA || "");
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([a-f0-9]+)"));

  if (m && igual(m[1], esperado)) {
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-store");
    out.headers.set("X-Robots-Tag", "noindex, nofollow");
    return out;
  }

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    if (igual(String(form?.get("senha") || ""), segredo)) {
      const url = new URL(request.url);
      return new Response(null, {
        status: 303,
        headers: {
          Location: url.pathname + url.search,
          "Set-Cookie": `${COOKIE}=${esperado}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
          "Cache-Control": "no-store",
        },
      });
    }
    // Senha errada custa 1,5 s: sem estado (cabe no Pages Functions) e derruba força bruta de milhares para dezenas/min.
    await new Promise((r) => setTimeout(r, 1500));
    return pagina(true);
  }
  return pagina(false);
}
