// Regras da release, puras (testadas em scripts/tests/release-core.test.mjs): qual o próximo build staging, se um
// commit pode virar release estável e quais produtos cada canal publica. O release.mjs só executa.

const STAGING = /^v(\d+\.\d+\.\d+)-staging\.(\d+)$/;

/** Próximo N do staging de `versao`, pelas tags que já existem (v0.2.0-staging.1, .2 → 3). */
export function proximaStaging(versao, tags) {
  let n = 0;
  for (const t of tags) { const m = STAGING.exec(t.trim()); if (m !== null && m[1] === versao) n = Math.max(n, Number(m[2])); }
  return n + 1;
}

/**
 * Promoção: a release estável v<versao> só sai de um commit que já foi publicado como staging DESSA versão
 * (alguma tag v<versao>-staging.N apontando para o HEAD). Devolve o motivo da recusa, ou null se pode.
 */
export function recusaPromocao(versao, tagsNoHead) {
  const st = tagsNoHead.map((t) => STAGING.exec(t.trim())).filter((m) => m !== null);
  if (st.length === 0) return `este commit não foi publicado como staging. Publique e aprove antes: npm run release:staging (e teste o v${versao}-staging.N instalado)`;
  if (!st.some((m) => m[1] === versao)) return `o staging deste commit é de outra versão (${st.map((m) => m[0]).join(", ")}); o package.json diz ${versao}`;
  return null;
}

/**
 * Produtos que cada canal publica: staging = as linhas staging; estável = as estáveis (o admin inclusive). Ficam de
 * fora os que levam módulos de um repositório privado (`caps.modulos`, como o meu-bot-diego): as releases do meu-bot
 * são públicas e o app levaria os módulos dentro. Esses se publicam por fora (docs/guia/meu-bot-diego.md).
 */
export const produtosDoCanal = (produtos, canal) => produtos.filter((p) => p.canal === canal && (p.caps?.modulos ?? null) === null);

/**
 * Componentes que mudaram desde a última release sem subir a versão (as máquinas só atualizam para cima: sem a
 * versão nova, a mudança nunca chega a elas). `componentes` vem de dist/main/maquina/backend-bundle-core.js (COMPONENTES);
 * `mudancas` = caminhos do `git diff --name-only <tag>..HEAD`; `versoes[nome]` = {antes, agora} lidas do arquivo de
 * versão nos dois pontos. Devolve uma linha por componente a corrigir (vazio = pode publicar).
 */
export function componentesSemVersao(componentes, mudancas, versoes) {
  const mudou = new Set(mudancas.map((m) => m.trim()).filter(Boolean));
  const out = [];
  for (const c of componentes) {
    const tocados = c.arquivos.filter((f) => mudou.has(f));
    if (tocados.length === 0) continue;
    const v = versoes[c.nome] ?? { antes: null, agora: null };
    if (v.agora !== null && v.agora !== v.antes) continue;
    out.push(`${c.nome}: mudou (${tocados.slice(0, 3).join(", ")}${tocados.length > 3 ? ` e mais ${tocados.length - 3}` : ""}) e a versão em ${c.versao} continua ${v.agora ?? "sem versão"}; suba a versão`);
  }
  return out;
}

/** Versão de um arquivo de versão: VERSION é texto puro; package.json, o campo `version`; plugin.yaml, a linha `version:`. null = ausente/ilegível. */
export function lerVersao(caminho, conteudo) {
  if (conteudo === null || conteudo === undefined) return null;
  if (caminho.endsWith(".json")) { try { const v = JSON.parse(conteudo).version; return typeof v === "string" && v !== "" ? v : null; } catch { return null; } }
  if (/\.ya?ml$/.test(caminho)) { const m = /^version:\s*["']?([\w.-]+)["']?\s*$/m.exec(String(conteudo)); return m === null ? null : m[1]; }
  const t = String(conteudo).trim();
  return t === "" ? null : t;
}
