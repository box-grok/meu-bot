/**
 * O que é "sem internet" (puro, testado). A faixa OFFLINE existe para a pessoa saber que o problema é na
 * conexão dela, não no app: aqui ficam a classificação dos erros de rede e as frases que o main usa no lugar
 * das que culpavam a VM ("Tailscale oscilando") quando o Mac é que estava fora do ar.
 */

/** Códigos do Node que só acontecem sem rota/DNS para fora. */
const OFFLINE_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN", "EADDRNOTAVAIL"]);
/** Falhas de conexão em geral (inclui o forward local recusando): não provam offline, mas pedem uma sondagem. */
const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH", ...OFFLINE_CODES]);
/** O que o ssh escreve quando o Mac não tem saída. */
const OFFLINE_TEXT = /could not resolve hostname|temporary failure in name resolution|network is unreachable|no route to host|network is down/i;

/** O erro, pelo código ou pelo texto (stderr do ssh), indica que este Mac está sem internet? */
export function looksLikeOffline(e: { code?: string | null; text?: string | null }): boolean {
  if (e.code !== undefined && e.code !== null && OFFLINE_CODES.has(e.code)) return true;
  return e.text !== undefined && e.text !== null && OFFLINE_TEXT.test(e.text);
}
/** O erro é de conexão (vale sondar a internet antes de culpar a máquina)? */
export const isConnectionCode = (code: string | null | undefined): boolean => code !== undefined && code !== null && CONNECTION_CODES.has(code);

/** Endereço que é este próprio Mac (a colima, por exemplo): o túnel para ele não precisa de internet. */
export const isLocalAddr = (h: string): boolean => /^(localhost|127\.|::1$)/.test(h.trim());

/** Frases do main enquanto a internet está fora. Todas começam pela causa certa. */
export function offlineMessage(kind: "chat" | "tunnel" | "update" | "support"): string {
  switch (kind) {
    case "chat": return "Você está sem internet. A máquina não tem culpa: quando a conexão voltar, mande de novo.";
    case "tunnel": return "Você está sem internet; não dá para abrir o túnel até a conexão voltar.";
    case "update": return "sem internet";
    case "support": return "Você está sem internet; aviso o admin quando a conexão voltar.";
  }
}
