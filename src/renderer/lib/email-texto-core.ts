/**
 * Corpo de e-mail em texto (a parte `text/plain`, ou o HTML já convertido pelo main) → blocos para a página E-mail.
 * O texto vem com quebras duras a ~70 colunas, URLs de rastreamento partidas em várias linhas e linhas de asteriscos
 * como separador; mostrado cru num <pre> lê mal. Aqui: parágrafos corridos (as quebras duras voltam a ser espaço),
 * separadores, citações (`>`) e links com rótulo curto. Puro, testado; o renderer monta o DOM.
 */
export type Trecho = { tipo: "texto"; texto: string } | { tipo: "link"; url: string; rotulo: string };
export type Bloco = { tipo: "paragrafo" | "citacao"; trechos: Trecho[] } | { tipo: "separador" };

/** Linha só de `* - = _ ~` (ao menos 3): um separador decorativo. */
export const ehSeparador = (linha: string): boolean => /^[\s*\-=_~]{3,}$/.test(linha) && /[*\-=_~]{3}/.test(linha.replace(/\s/g, ""));
/** Item de lista (`- `, `* `, `• `, `1. `, `1) `): começa linha própria. */
export const ehItem = (linha: string): boolean => /^\s*([-*•–]|\d{1,2}[.)])\s+/.test(linha);
/** Linha a partir da qual uma quebra dura é só a coluna 70 acabando: a próxima linha continua a frase. */
export const LINHA_LONGA = 50;
const URL_RE = /https?:\/\/[^\s<>()"']+/g;
const URL_CHARS = /^[A-Za-z0-9_\-~.%/?=&+#]{8,}/;
const PONTUACAO_FINAL = /[).,;:!?>]+$/;

/** Última palavra da linha começa uma URL que ainda não fechou (sem `)` `.` `,` `>` no fim)? */
function urlAberta(linha: string): boolean {
  const ult = linha.trim().split(/\s+/).at(-1) ?? "";
  return /^https?:\/\//.test(ult) && !PONTUACAO_FINAL.test(ult);
}

/** Junta as linhas de um bloco: quebra dura depois de linha longa vira espaço; URL partida volta a ser uma. */
export function juntarLinhas(linhas: readonly string[]): string {
  let out = "";
  for (const bruta of linhas) {
    const l = bruta.replace(/\s+$/, "");
    if (out === "") { out = l; continue; }
    const ant = out.split("\n").at(-1) ?? "";
    if (urlAberta(ant) && URL_CHARS.test(l.trim())) { out += l.trim(); continue; }
    if (ant.length >= LINHA_LONGA && !ehItem(l) && l.trim() !== "") out += ` ${l.trim()}`;
    else out += `\n${l}`;
  }
  return out;
}

/** Rótulo curto de um link: host sem `www.` + caminho, até 40 caracteres. */
export function rotuloDeLink(url: string): string {
  let r = url;
  try { const u = new URL(url); r = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}${u.search}`; } catch { /* fica como veio */ }
  return r.length > 40 ? `${r.slice(0, 39)}…` : r;
}

/** Texto → trechos, com as URLs viradas em links (pontuação final fica fora do link). */
export function trechosDe(texto: string): Trecho[] {
  const out: Trecho[] = [];
  let i = 0;
  for (const m of texto.matchAll(URL_RE)) {
    let url = m[0]; const ini = m.index ?? 0;
    const sobra = PONTUACAO_FINAL.exec(url)?.[0] ?? ""; if (sobra !== "") url = url.slice(0, -sobra.length);
    if (ini > i) out.push({ tipo: "texto", texto: texto.slice(i, ini) });
    out.push({ tipo: "link", url, rotulo: rotuloDeLink(url) });
    i = ini + url.length;
  }
  if (i < texto.length) out.push({ tipo: "texto", texto: texto.slice(i) });
  return out;
}

/** O corpo inteiro em blocos. Texto vazio → nenhum bloco. */
export function blocosDoCorpo(texto: string): Bloco[] {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  const blocos: Bloco[] = [];
  let grupo: string[] = []; let citacao = false;
  const fechar = (): void => {
    if (grupo.length > 0) { const t = juntarLinhas(grupo).trim(); if (t !== "") blocos.push({ tipo: citacao ? "citacao" : "paragrafo", trechos: trechosDe(t) }); }
    grupo = []; citacao = false;
  };
  for (const l of linhas) {
    if (l.trim() === "") { fechar(); continue; }
    if (ehSeparador(l)) { fechar(); if (blocos.at(-1)?.tipo !== "separador") blocos.push({ tipo: "separador" }); continue; }
    const cit = /^\s*>/.test(l);
    if (grupo.length > 0 && cit !== citacao) fechar();
    citacao = cit;
    grupo.push(cit ? l.replace(/^\s*>\s?/, "") : l);
  }
  fechar();
  if (blocos.at(-1)?.tipo === "separador" && blocos.length === 1) return blocos;
  return blocos;
}
