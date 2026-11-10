// Confere, já no PR, o que faria a release recusar (e a release automática travar): componente da máquina (backend,
// financeiro, CRM, guarda) que mudou desde a última release sem subir a versão. Também avisa (sem falhar) quando o PR
// muda o app sem escrever nada em "Ainda não lançado" do docs/CHANGELOG.md, que vira as notas da release.
//   node scripts/release-checar.mjs            (precisa do dist/main: rode depois do `npm run build`)
// O release.mjs usa a mesma conferência (componentesPendentes) antes de empacotar.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { componentesSemVersao, lerVersao, notasDaRelease } from "./release-core.mjs";

const git = (args) => { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };

/** { ultima, falta }: a última tag v* alcançável do HEAD e as linhas de componentesSemVersao (vazio = ok). */
export function componentesPendentes() {
  const ultima = git(["describe", "--tags", "--abbrev=0", "--match", "v*"])?.trim() || null;
  if (ultima === null) return { ultima: null, falta: [] };
  const { COMPONENTES } = createRequire(import.meta.url)("../dist/main/maquina/backend-bundle-core.js");
  const mudancas = (git(["diff", "--name-only", `${ultima}..HEAD`]) ?? "").split("\n");
  const versoes = Object.fromEntries(COMPONENTES.map((c) => [c.nome, { antes: lerVersao(c.versao, git(["show", `${ultima}:${c.versao}`])), agora: lerVersao(c.versao, existsSync(c.versao) ? readFileSync(c.versao, "utf8") : null) }]));
  return { ultima, falta: componentesSemVersao(COMPONENTES, mudancas, versoes) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { ultima, falta } = componentesPendentes();
  if (falta.length > 0) {
    console.error(`✗ desde ${ultima}, componente da máquina mudou sem subir a versão (a release automática recusaria):\n  ${falta.join("\n  ")}`);
    process.exit(1);
  }
  console.log(ultima === null ? "sem release anterior: nada a comparar" : `✓ versões dos componentes ok desde ${ultima}`);
  // CHANGELOG: só aviso. Num PR, compara com a base dele; fora de PR, não há o que avisar.
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    const mb = git(["merge-base", "HEAD", `origin/${baseRef}`])?.trim();
    const mudou = mb ? (git(["diff", "--name-only", `${mb}..HEAD`]) ?? "").split("\n").filter(Boolean) : [];
    const app = mudou.some((f) => /^(src|backend-colima|conta-api|crm|guarda|extensao-crm)\//.test(f));
    const antes = mb ? notasDaRelease(git(["show", `${mb}:docs/CHANGELOG.md`])) : null;
    const agora = notasDaRelease(existsSync("docs/CHANGELOG.md") ? readFileSync("docs/CHANGELOG.md", "utf8") : null);
    if (app && antes === agora) console.log('::warning file=docs/CHANGELOG.md::Este PR muda o app mas não escreve nada em "Ainda não lançado": a release automática sai com as notas sem esta mudança.');
  }
}
