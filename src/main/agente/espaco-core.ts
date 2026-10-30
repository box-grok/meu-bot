/**
 * Espaço da pessoa na máquina (cota de disco): a parte pura do "Liberar espaço" das Configurações. Lê o json de cota
 * do backend dela, monta os scripts que rodam como ela por SSH (o que ocupa, apagar um item) e confere, dos dois
 * lados, que só caches do agente, as pastas de trabalho e sessões antigas do WhatsApp podem ser apagados: nunca
 * `.hermes/tools` nem a sessão viva. O admin tem a versão dele (qualquer pasta do usuário) em admin/usuarios-core.ts.
 */
import type { CotaInfo, CotaItem, CotaNivel } from "../../shared/ipc";
import { caminhoDentro, lerMaiores } from "../admin/usuarios-core";

/** Raízes (relativas ao home) cujo conteúdo a pessoa pode apagar por aqui; a raiz em si fica. */
export const RAIZES_APAGAVEIS = [".hermes/cache/images", ".hermes/cache/audio", ".hermes/image_cache", ".hermes/audio_cache", "agent-workspace", "chat-workspace"] as const;
/** Sessões antigas do WhatsApp (o Hermes renomeia a sessão ao sair); a pasta inteira pode ir. */
export const PADRAO_SESSAO_ANTIGA = ".hermes/whatsapp/session.loggedout-";

const NIVEIS: readonly CotaNivel[] = ["ok", "perto", "critico", "cheio"];
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const nivelDe = (pct: number): CotaNivel => (pct >= 100 ? "cheio" : pct >= 95 ? "critico" : pct >= 80 ? "perto" : "ok");

/** O `cota` do backend (`GET /v1/meu-bot/cota`), conferido campo a campo; null = sem cota ou json estranho. */
export function lerCotaJson(v: unknown): CotaInfo | null {
  if (v === null || v === undefined || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const usadoKb = num(o.usadoKb); const limiteKb = num(o.limiteKb);
  if (usadoKb === null || limiteKb === null) return null;
  const pct = num(o.pct) ?? (limiteKb > 0 ? Math.round((usadoKb / limiteKb) * 100) : 0);
  const nivel = typeof o.nivel === "string" && (NIVEIS as readonly string[]).includes(o.nivel) ? (o.nivel as CotaNivel) : nivelDe(pct);
  const grace = typeof o.grace === "string" && o.grace.length > 0 && o.grace.length <= 20 ? o.grace : null;
  const itens: CotaItem[] = [];
  if (Array.isArray(o.itens)) {
    for (const x of o.itens.slice(0, 20) as unknown[]) {
      if (x === null || typeof x !== "object") continue;
      const i = x as Record<string, unknown>;
      const kb = num(i.kb);
      if (typeof i.id !== "string" || i.id === "" || typeof i.rotulo !== "string" || kb === null) continue;
      itens.push({ id: i.id.slice(0, 60), rotulo: i.rotulo.slice(0, 60), kb, dela: i.dela !== false, apagavel: i.apagavel === true });
    }
  }
  return { usadoKb, limiteKb, hardKb: num(o.hardKb), pct, nivel, grace, itens, em: typeof o.em === "string" && o.em.length <= 40 ? o.em : "" };
}

/**
 * A pessoa pode apagar este caminho por aqui? Só dentro do home dela, só abaixo de uma das raízes (nunca a raiz) ou
 * uma pasta `session.loggedout-*` inteira (nada dentro dela). Sem `..`, sem barra dupla, sem barra no fim.
 */
export function caminhoApagavel(home: string, p: string): boolean {
  if (home === "" || p === "" || !p.startsWith("/") || !caminhoDentro(home, p) || /\/\//.test(p) || p.endsWith("/")) return false;
  const rel = p.slice(home.length + 1);
  if (rel.split("/").some((s) => s === "" || s === "." || s === "..")) return false;
  if (RAIZES_APAGAVEIS.some((r) => rel.startsWith(`${r}/`) && rel.length > r.length + 1)) return true;
  if (rel.startsWith(PADRAO_SESSAO_ANTIGA)) { const resto = rel.slice(PADRAO_SESSAO_ANTIGA.length); return resto !== "" && !resto.includes("/"); }
  return false;
}

const raizesSh = RAIZES_APAGAVEIS.map((r) => `"$HOME/${r}"`).join(" ");
/**
 * O que ocupa espaço no que a pessoa pode apagar (roda como ela): `HOME=`, um nível abaixo de cada raiz
 * (`I<TAB>kb<TAB>d|f<TAB>caminho`, maiores primeiro) e cada sessão antiga do WhatsApp. `.hermes/tools` e a sessão
 * viva nunca entram.
 */
export const MEUS_MAIORES_SH = `echo "HOME=$HOME"
du -xak --max-depth=1 ${raizesSh} 2>/dev/null | sort -rn | head -40 | while IFS="$(printf '\\t')" read -r k p; do [ -d "$p" ] && t=d || t=f; printf 'I\\t%s\\t%s\\t%s\\n' "$k" "$t" "$p"; done
for d in "$HOME"/${PADRAO_SESSAO_ANTIGA}*; do [ -d "$d" ] || continue; k=$(du -xsk -- "$d" 2>/dev/null | cut -f1); printf 'I\\t%s\\td\\t%s\\n' "\${k:-0}" "$d"; done`;

/** Lê a saída do MEUS_MAIORES_SH: só o que `caminhoApagavel` aceita (as raízes em si caem), maiores primeiro. */
export function lerMeusMaiores(out: string, home: string): { home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] } {
  const lido = lerMaiores(out);
  const h = lido.home ?? (home !== "" ? home : null);
  if (h === null) return { home: null, itens: [] };
  const itens = lido.itens.filter((i) => caminhoApagavel(h, i.caminho)).sort((a, b) => b.kb - a.kb);
  return { home: h, itens };
}

const padroesCase = [...RAIZES_APAGAVEIS.map((r) => `"$HOME"/${r}/?*`), `"$HOME"/${PADRAO_SESSAO_ANTIGA}?*`].join("|");
/** Apaga um item (como ela); o caminho chega em base64 e a máquina confere de novo contra a mesma lista de raízes. */
export function apagarMeuItemSh(caminhoB64: string): string {
  if (!/^[A-Za-z0-9+/=]+$/.test(caminhoB64)) throw new Error("caminho inválido");
  return `P=$(printf '%s' '${caminhoB64}' | base64 -d); R=$(realpath -m -- "$P")
case "$R" in ${padroesCase}) ;; *) echo "ERRO=esse item não pode ser apagado por aqui"; exit 0 ;; esac
rm -rf -- "$R" && echo "APAGADO=$R" || echo "ERRO=não consegui apagar"`;
}

/** KB → "3,9 GB" / "42 MB" / "512 KB" (pt-BR). Cópia igual em renderer/lib/espaco.ts (o renderer não importa o main). */
export function tam(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1).replace(".", ",")} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${Math.round(kb)} KB`;
}
