/**
 * Gmail: a parte pura (testável sem rede) da página Gmail e das ferramentas do agente. Parse de uma mensagem em
 * `format=full` (corpo em texto, anexos), limites do que a tela e o agente podem pedir, e o link para abrir no Gmail.
 * O que fala com a rede fica em apis.ts; o token nunca sai do Mac (conta-google.ts).
 */
import { gmailMensagemDeRaw, type GmailMensagemView } from "./google-core";

export interface GmailAnexoView { nome: string; tipo: string; bytes: number }
export interface GmailDetalheView extends GmailMensagemView { para: string; corpo: string; anexos: GmailAnexoView[]; /** O corpo passou de CORPO_MAX e foi cortado. */ truncado: boolean }

/** Corpo em texto: o bastante para ler um e-mail longo sem virar um despejo na conversa do agente. */
export const CORPO_MAX = 20_000;
export const BUSCA_MAX = 200;
export const LISTA_MAX = 50;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PAGINA_RE = /^[A-Za-z0-9_-]{1,300}$/;

/** Busca do Gmail (a mesma sintaxe da caixa de busca: `from:ana is:unread`): texto, sem controle, até BUSCA_MAX. */
export const validaBusca = (v: unknown): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, BUSCA_MAX) : "");
/** Quantas mensagens por página: inteiro entre 1 e LISTA_MAX; o resto vira o padrão. */
export const validaMax = (v: unknown, padrao = 10): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(LISTA_MAX, Math.max(1, Math.trunc(v))) : padrao);
/** Id de mensagem como o Gmail devolve (hex curto); qualquer outra coisa é null. */
export const validaId = (v: unknown): string | null => (typeof v === "string" && ID_RE.test(v) ? v : null);
/** Token de página do Gmail; ausente ou inválido = primeira página. */
export const validaPagina = (v: unknown): string | undefined => (typeof v === "string" && PAGINA_RE.test(v) ? v : undefined);
/** Abre a mensagem no Gmail do navegador (`#all` acha a mensagem em qualquer pasta, lixeira inclusive). */
export const linkDoGmail = (id: string): string => `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;

/** Entidades com nome que aparecem em e-mail (as básicas e as acentuadas do pt-BR); numéricas são decodificadas à parte. */
const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™", euro: "€", ordf: "ª", ordm: "º",
  aacute: "á", agrave: "à", atilde: "ã", acirc: "â", auml: "ä", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", iacute: "í", igrave: "ì", icirc: "î", iuml: "ï", oacute: "ó", ograve: "ò", otilde: "õ", ocirc: "ô", ouml: "ö", uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü", ccedil: "ç", ntilde: "ñ",
  Aacute: "Á", Agrave: "À", Atilde: "Ã", Acirc: "Â", Auml: "Ä", Eacute: "É", Egrave: "È", Ecirc: "Ê", Euml: "Ë", Iacute: "Í", Igrave: "Ì", Icirc: "Î", Iuml: "Ï", Oacute: "Ó", Ograve: "Ò", Otilde: "Õ", Ocirc: "Ô", Ouml: "Ö", Uacute: "Ú", Ugrave: "Ù", Ucirc: "Û", Uuml: "Ü", Ccedil: "Ç", Ntilde: "Ñ",
};
/** HTML de e-mail → texto legível: tira estilo e script, quebra em p/br/div/tr/li, decodifica as entidades comuns. */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|li|h[1-6]|blockquote|pre|table)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tudo, e: string) => {
      if (e.startsWith("#x")) { const n = Number.parseInt(e.slice(2), 16); return Number.isFinite(n) ? String.fromCodePoint(n) : tudo; }
      if (e.startsWith("#")) { const n = Number.parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : tudo; }
      return ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? tudo;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const b64url = (s: string): string => Buffer.from(s, "base64url").toString("utf8");
interface Parte { mimeType?: unknown; filename?: unknown; body?: { data?: unknown; size?: unknown }; parts?: unknown }
/**
 * Corpo e anexos de um `payload` do Gmail (format=full). Anda pelas partes: `text/plain` ganha; sem ele, `text/html`
 * vira texto. Parte com `filename` é anexo (só nome, tipo e tamanho: o conteúdo não é baixado).
 */
export function corpoDeMensagem(payload: unknown): { corpo: string; anexos: GmailAnexoView[]; truncado: boolean } {
  const textos: string[] = []; const htmls: string[] = []; const anexos: GmailAnexoView[] = [];
  const anda = (p: Parte | undefined, prof: number): void => {
    if (p === undefined || prof > 20) return;
    const tipo = typeof p.mimeType === "string" ? p.mimeType.toLowerCase() : "";
    const nome = typeof p.filename === "string" ? p.filename : "";
    const dados = typeof p.body?.data === "string" ? p.body.data : "";
    if (nome !== "") anexos.push({ nome, tipo, bytes: typeof p.body?.size === "number" ? p.body.size : 0 });
    else if (tipo === "text/plain" && dados !== "") textos.push(b64url(dados));
    else if (tipo === "text/html" && dados !== "") htmls.push(b64url(dados));
    if (Array.isArray(p.parts)) for (const f of p.parts as Parte[]) anda(f, prof + 1);
  };
  anda(payload as Parte | undefined, 0);
  const bruto = textos.length > 0 ? textos.join("\n").replace(/\r\n/g, "\n").trim() : htmlParaTexto(htmls.join("\n"));
  const truncado = bruto.length > CORPO_MAX;
  return { corpo: truncado ? `${bruto.slice(0, CORPO_MAX)}\n[…]` : bruto, anexos, truncado };
}

/** Uma mensagem em format=full → detalhe (linha da lista + para, corpo e anexos). */
export function mensagemDetalheDeRaw(id: string, m: Record<string, unknown>): GmailDetalheView {
  const linha = gmailMensagemDeRaw(id, m);
  const h = (((m["payload"] as { headers?: unknown } | undefined)?.headers) ?? []) as { name?: string; value?: string }[];
  const para = h.find((x) => (x.name ?? "").toLowerCase() === "to")?.value ?? "";
  return { ...linha, para, ...corpoDeMensagem(m["payload"]) };
}
