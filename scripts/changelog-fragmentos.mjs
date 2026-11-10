// Lê docs/changelog/*.md (um arquivo por PR, ainda não lançado) e junta no texto que vira as notas da release.
// A regra (ordem, o que fica de fora) é pura e testada: juntarFragmentos, em release-core.mjs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { juntarFragmentos, PASTA_FRAGMENTOS } from "./release-core.mjs";

/** Os arquivos de item (sem o README), como caminhos relativos à raiz do repositório. */
export function arquivosDeFragmento(raiz = ".") {
  const pasta = join(raiz, PASTA_FRAGMENTOS);
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).filter((n) => /\.md$/i.test(n) && !/^readme\.md$/i.test(n)).map((n) => `${PASTA_FRAGMENTOS}/${n}`);
}

export function lerFragmentos(raiz = ".") {
  const pasta = join(raiz, PASTA_FRAGMENTOS);
  if (!existsSync(pasta)) return "";
  return juntarFragmentos(readdirSync(pasta).map((nome) => ({ nome, texto: readFileSync(join(pasta, nome), "utf8") })));
}
