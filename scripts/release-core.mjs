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

/** Produtos que cada canal publica: staging = as linhas staging; estável = as estáveis (o admin inclusive). */
export const produtosDoCanal = (produtos, canal) => produtos.filter((p) => p.canal === canal);
