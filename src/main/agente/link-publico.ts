/**
 * Link público da pessoa na máquina da janela (tutorial 17): lê o que o admin ligou para ela
 * (~/.local/share/meu-bot/link-publico.json, gravado por ela) e troca o nome do link com o comando da máquina
 * (`link-publico-nome`, que renomeia a pasta dela sem passar pelo root). Como ela, por SSH; o admin gere o global
 * em admin/link-publico-admin.ts.
 */
import type { LinkPublicoInfo } from "../../shared/ipc";
import { runSsh } from "../whatsapp/whatsapp";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { registrar } from "../auditoria/auditoria";
import { NOME_LINK_RE } from "../admin/link-publico-core";

const STATUS_SH = `F="$HOME/.local/share/meu-bot/link-publico.json"
[ -f "$F" ] && [ -L "$HOME/publico" ] && [ -d "$HOME/publico/" ] || { echo "LINK=0"; exit 0; }
N=$(ls -1A "$HOME/publico/" 2>/dev/null | grep -vc '^\\.')
echo "LINK=1 $N $USER"; cat "$F"`;

const remota = (host: string): boolean => host !== LOCAL_HOST && isValidHost(host);

/** Lê `LINK=1 <arquivos> <usuário>` + o json; null = desligado, máquina fora ou este Mac. */
export function lerLinkPublico(out: string): LinkPublicoInfo | null {
  const m = /^LINK=1 (\d+) (\S+)$/m.exec(out);
  if (m === null) return null;
  const j = /^\{.*\}$/m.exec(out);
  if (j === null) return null;
  try {
    const v = JSON.parse(j[0]) as { url?: unknown; nome?: unknown; dominio?: unknown };
    if (typeof v.url !== "string" || !/^https:\/\/[a-z0-9.-]+\/$/.test(v.url) || typeof v.nome !== "string" || !NOME_LINK_RE.test(v.nome) || typeof v.dominio !== "string") return null;
    return { url: v.url, nome: v.nome, dominio: v.dominio, arquivos: Number(m[1]), usuario: m[2]! };
  } catch { return null; }
}

export async function linkPublicoStatus(host: string): Promise<LinkPublicoInfo | null> {
  if (!remota(host)) return null;
  const r = await runSsh(host, `${STATUS_SH}\n`, 30_000);
  return lerLinkPublico(r.stdout);
}

/** Troca o nome do link (o comando confere nome válido, reservado, de outro usuário ou em uso). */
export async function linkPublicoNome(host: string, nome: unknown): Promise<LinkPublicoInfo> {
  if (!remota(host)) throw new Error("o link público é da máquina por SSH");
  if (typeof nome !== "string" || !NOME_LINK_RE.test(nome.trim().toLowerCase())) throw new Error("nome inválido: só letras minúsculas, números e hífen (2 a 63 caracteres)");
  const n = nome.trim().toLowerCase();
  const r = await runSsh(host, `export PATH=/usr/local/bin:$PATH; link-publico-nome '${n}' 2>&1\n${STATUS_SH}\n`, 30_000);
  const erro = /^ERRO: (.*)$/m.exec(r.stdout)?.[1];
  if (erro !== undefined) throw new Error(erro);
  const info = lerLinkPublico(r.stdout);
  if (info === null || info.nome !== n) throw new Error(`não consegui trocar o nome do link: ${r.stdout.trim().split("\n").pop() ?? "sem resposta"}`);
  void registrar(host, "link-publico.nome", n);
  return info;
}
