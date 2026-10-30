/**
 * Espaço da pessoa na máquina da janela: quanto ela usa da cota (pelo backend dela, no túnel), o que dá para apagar
 * (caches do agente, pastas de trabalho, sessões antigas do WhatsApp; como ela, por SSH) e apagar um item. A parte
 * pura (scripts, leitura, allowlist) fica em espaco-core.ts; o admin mexe na cota em admin/usuarios.ts.
 */
import type { CotaInfo } from "../../shared/ipc";
import { runSsh } from "../whatsapp/whatsapp";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { registrar } from "../auditoria/auditoria";
import { backendJson } from "../maquina/backend";
import { apagarMeuItemSh, caminhoApagavel, lerCotaJson, lerMeusMaiores, MEUS_MAIORES_SH } from "./espaco-core";

export type MeusMaiores = { home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] };

const remota = (host: string): boolean => host !== LOCAL_HOST && isValidHost(host);
const homeDe = (out: string): string => /^HOME=(.+)$/m.exec(out)?.[1] ?? "";

/** O que a pessoa pode apagar, maiores primeiro; vazio neste Mac. */
export async function cotaMaiores(host: string): Promise<MeusMaiores> {
  if (!remota(host)) return { home: null, itens: [] };
  const r = await runSsh(host, `${MEUS_MAIORES_SH}\n`, 60_000);
  return lerMeusMaiores(r.stdout, homeDe(r.stdout));
}

/** Apaga um item da lista (conferido aqui e na máquina) e devolve a lista nova. */
export async function cotaApagarItem(host: string, caminho: unknown): Promise<MeusMaiores> {
  if (!remota(host)) throw new Error("liberar espaço é da máquina por SSH");
  if (typeof caminho !== "string" || caminho === "" || caminho.length > 4096) throw new Error("caminho inválido");
  const antes = await runSsh(host, `${MEUS_MAIORES_SH}\n`, 60_000);
  const home = homeDe(antes.stdout);
  if (home === "" || !caminhoApagavel(home, caminho)) throw new Error("esse item não pode ser apagado por aqui");
  const r = await runSsh(host, `${apagarMeuItemSh(Buffer.from(caminho, "utf8").toString("base64"))}\n`, 120_000);
  const erro = /^ERRO=(.*)$/m.exec(r.stdout)?.[1];
  if (erro !== undefined) throw new Error(erro);
  if (!/^APAGADO=/m.test(r.stdout)) throw new Error(`não consegui apagar: ${r.stderr.trim().split("\n").pop() || "sem resposta da máquina"}`);
  void registrar(host, "cota.liberar", caminho.slice(home.length + 1));
  return cotaMaiores(host);
}

/** A cota dela, fresca, pelo backend no túnel; null = sem cota, backend sem a rota, túnel fora ou este Mac. */
export async function cotaStatus(host: string): Promise<CotaInfo | null> {
  if (!remota(host)) return null;
  try {
    const j = await backendJson<{ cota?: unknown }>(host, "GET", "/v1/meu-bot/cota?fresco=1");
    return j === null ? null : lerCotaJson(j.cota);
  } catch { return null; }
}
