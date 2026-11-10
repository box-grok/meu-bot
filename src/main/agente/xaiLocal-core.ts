/**
 * Grok (xAI) por OAuth na máquina "local" (este Mac), sem efeitos colaterais: a versão do Hermes, a porta do proxy e
 * o providers.json do backend local. O lado com processos é xaiLocal.ts.
 *
 * Nas máquinas por SSH o install-grok-oauth.sh faz isso com systemd; no Mac o backend local já é um processo filho do
 * app, e o proxy vira mais um, que nasce e morre com ele.
 */

/** A mesma versão do install-grok-oauth.sh: o proxy da xAI é desta versão. */
export const HERMES_VERSION_LOCAL = "0.22.2";

/**
 * Porta do proxy de cada app: 100 abaixo da porta do backend local (meu-bot 8690, meu-bot-staging 8691,
 * finance-staging 8692). Fora da 8645 das máquinas, que o Lima do Colima pode encaminhar para o Mac, e diferente
 * entre os apps, que podem ficar abertos juntos.
 */
export const proxyPortaLocal = (portaBackend: number): number => portaBackend - 100;

export const proxyUrlLocal = (porta: number): string => `http://127.0.0.1:${porta}/v1`;

/** providers.json do backend local com o grok-4 pelo proxy (o mesmo conteúdo do install-grok-oauth.sh). */
export function providersComGrokLocal(porta: number): string {
  return `${JSON.stringify([
    { name: "agente", type: "claude", priority: 0, description: "Claude Code com ferramentas, sem pedir permissão (bypass)" },
    { name: "grok-4", type: "openai", priority: 1, base_url: proxyUrlLocal(porta), model: "grok-4", description: "Grok da xAI pelo proxy local do Hermes (login OAuth: hermes auth add xai-oauth)" },
  ], null, 2)}\n`;
}

/** O providers.json já aponta o grok-4 para o proxy desta porta (= o Grok está preparado neste app). */
export function providersApontaProxy(raw: string | null, porta: number): boolean {
  if (raw === null) return false;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.some((p) => typeof p === "object" && p !== null && (p as { name?: unknown }).name === "grok-4" && (p as { base_url?: unknown }).base_url === proxyUrlLocal(porta));
  } catch { return false; }
}

/** `hermes auth status xai-oauth` → logado? ("not logged in"/"logged out" também contêm "logged"). */
export function statusXaiLogado(status: string): boolean {
  return /logged in/i.test(status) && !/not logged in/i.test(status);
}

/** Rótulo da credencial ativa (a linha com ←) de `hermes auth list`, no bloco xai-oauth. */
export function rotuloCredencialXai(list: string): string | null {
  const bloco = list.split("\n");
  const ini = bloco.findIndex((l) => l.startsWith("xai-oauth"));
  if (ini === -1) return null;
  for (const l of bloco.slice(ini + 1)) {
    if (l.trim() === "") break;
    if (l.includes("←")) return /#\d+\s+(\S+)/.exec(l)?.[1] ?? null;
  }
  return null;
}

/** `hermes --version` é da versão pedida? */
export const hermesNaVersao = (versionOut: string, versao: string = HERMES_VERSION_LOCAL): boolean => versionOut.includes(`v${versao}`);
