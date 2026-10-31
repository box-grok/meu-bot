/**
 * Contas de ferramentas de linha de comando na máquina (tutorial 12), parte pura e testada: que comando entra, sai
 * e diz quem está logado, e como ler o link (e o código) que cada uma imprime. Quem roda é `contas-cli.ts`, por SSH;
 * a pessoa só clica: o link abre no Navegador do app e o retorno do login (localhost da máquina) chega por lá.
 */
import type { ContaEstado, ContaId } from "../../shared/ipc";
export type { ContaEstado, ContaId };
export const CONTA_IDS: readonly ContaId[] = ["cloudflare", "github"];
export const isContaId = (v: unknown): v is ContaId => typeof v === "string" && (CONTA_IDS as readonly string[]).includes(v);

/**
 * Cloudflare só para subir sites (Pages) e ver os domínios: o `wrangler login` sem `--scopes` pede quase tudo da conta
 * (Workers, D1, e-mail, segredos…), e a credencial fica na máquina, ao alcance do agente.
 */
export const CF_ESCOPOS: readonly string[] = ["account:read", "user:read", "pages:write", "zone:read"];
/** O que o wrangler acrescenta sozinho e não conta como "amplo". */
const CF_ESCOPOS_EXTRA = ["offline_access"];

const WRANGLER = "npx -y wrangler@4";
/**
 * Comandos na máquina. `tty`: o wrangler só imprime o link com pseudo-terminal; o `gh` sem terminal não pergunta
 * nada e vai direto ao código de dispositivo. `device`: Cloudflare sem o Navegador do app (o retorno ao localhost
 * da máquina só chega por ele) usa código de dispositivo, como o GitHub.
 */
export function comandoEntrar(id: ContaId, navegador: boolean): { cmd: string; tty: boolean } {
  if (id === "cloudflare") return { cmd: `${WRANGLER} login --browser=false${navegador ? "" : " --device"} --scopes ${CF_ESCOPOS.join(" ")} 2>&1`, tty: true };
  return { cmd: "BROWSER=true gh auth login -h github.com -p https -w </dev/null 2>&1", tty: false };
}
/** Só esta conta do GitHub (o `gh` guarda várias): a anterior sai quando outra entra, uma conta por máquina. */
export function comandoSairDoGithub(conta: string): string | null {
  return /^[\w-]{1,39}$/.test(conta) ? `gh auth logout -h github.com -u ${conta} </dev/null 2>&1 | tail -2` : null;
}
/**
 * Trocar de conta: a página de login usa a sessão do Navegador, que já está na conta antiga. No GitHub, "adicionar
 * conta" entra na outra sem derrubar a sessão e volta para a página do código; no Cloudflare não há isso, então o app
 * tira do Navegador os cookies do Cloudflare (`SAIR_DO_SITE`) antes de abrir o link, e a página pede o login.
 */
export const GITHUB_OUTRA_CONTA = "https://github.com/login?add_account=1&return_to=%2Flogin%2Fdevice";
export const SAIR_DO_SITE: Record<ContaId, string | null> = { cloudflare: "cloudflare.com", github: null };

export function comandoSair(id: ContaId): string {
  return id === "cloudflare" ? `${WRANGLER} logout </dev/null 2>&1 | tail -2` : "gh auth logout -h github.com </dev/null 2>&1 | tail -2";
}
/** Um SSH só para as duas: cada bloco entre marcadores, `ausente` quando a ferramenta não existe na máquina. */
export const STATUS_SH = [
  // Sem o arquivo de login não há o que perguntar: evita o npx baixar o wrangler (minutos) só para dizer "não logado".
  // Saída num arquivo, não num pipe, e com tempo-limite: o npm exec às vezes fica pendurado depois de responder.
  `echo '<<cloudflare'; if ! command -v npx >/dev/null 2>&1; then echo ausente; elif [ ! -s "$HOME/.config/.wrangler/config/default.toml" ]; then echo 'You are not authenticated.'; else T=$(mktemp); timeout 60 ${WRANGLER} whoami </dev/null >"$T" 2>&1; head -60 "$T"; rm -f "$T"; fi; echo '>>'`,
  "echo '<<github'; command -v gh >/dev/null 2>&1 && gh auth status -h github.com </dev/null 2>&1 | head -40 || echo ausente; echo '>>'",
].join("; ");

/**
 * Instala o GitHub CLI (gh) sem sudo: o binário oficial da última versão em ~/.local/bin (já no PATH das contas).
 * Linux amd64/arm64 (as máquinas) e macOS. Sai 0 com a versão instalada; senão, uma linha dizendo o que faltou.
 */
export const INSTALAR_GH_SH = [
  "set -e",
  "if command -v gh >/dev/null 2>&1; then gh --version | head -1; exit 0; fi",
  `case "$(uname -m)" in x86_64|amd64) A=amd64;; aarch64|arm64) A=arm64;; *) echo "arquitetura não suportada: $(uname -m)"; exit 2;; esac`,
  `V=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -o '"tag_name": *"v[^"]*"' | head -1 | sed 's/.*"v//; s/"$//')`,
  `[ -n "$V" ] || { echo "não consegui descobrir a versão do gh (sem internet?)"; exit 3; }`,
  `T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; mkdir -p "$HOME/.local/bin"`,
  `if [ "$(uname -s)" = Darwin ]; then curl -fsSL -o "$T/gh.zip" "https://github.com/cli/cli/releases/download/v$V/gh_\${V}_macOS_\${A}.zip"; (cd "$T" && unzip -q gh.zip); else curl -fsSL -o "$T/gh.tgz" "https://github.com/cli/cli/releases/download/v$V/gh_\${V}_linux_\${A}.tar.gz"; tar -xzf "$T/gh.tgz" -C "$T"; fi`,
  `install -m 755 "$T"/gh_*/bin/gh "$HOME/.local/bin/gh"`,
  `"$HOME/.local/bin/gh" --version | head -1`,
].join("\n");

function bloco(out: string, id: ContaId): string | null {
  const m = new RegExp(`<<${id}\\n([\\s\\S]*?)\\n>>`).exec(out.replace(/\r/g, ""));
  return m === null ? null : m[1]!;
}

/** Lê a saída de STATUS_SH. Bloco que não veio (SSH caiu no meio) fica de fora: desconhecido, não "desconectado". */
export function lerStatus(out: string): ContaEstado[] {
  const r: ContaEstado[] = [];
  const cf = bloco(out, "cloudflare");
  if (cf !== null) {
    const conta = /associated with the email ([^\s]+?)\.?\s*$/m.exec(cf)?.[1] ?? null;
    const conectado = conta !== null || /You are logged in/i.test(cf);
    // "- pages (write)" vira "pages:write"; alguns vêm sem parênteses ("- offline_access", "- k2.read").
    const escopos = [...cf.matchAll(/^- ([\w.:-]+)(?: \((\w+)\))?/gm)].map((m) => m[2] === undefined ? m[1]! : `${m[1]}:${m[2]}`);
    const permitidos = new Set([...CF_ESCOPOS, ...CF_ESCOPOS_EXTRA]);
    r.push({ id: "cloudflare", presente: cf.trim() !== "ausente", conectado, conta, amplo: conectado && escopos.some((e) => !permitidos.has(e)) });
  }
  const gh = bloco(out, "github");
  if (gh !== null) {
    // Com várias contas, vale a ativa ("- Active account: true" logo abaixo dela); o gh antigo só tem uma.
    const contas = [...gh.matchAll(/Logged in to github\.com (?:account|as) ([\w-]+)[^\n]*(?:\n\s*- Active account: (true|false))?/g)];
    const conta = (contas.find((m) => m[2] === "true") ?? contas.find((m) => m[2] === undefined) ?? contas[0])?.[1] ?? null;
    r.push({ id: "github", presente: gh.trim() !== "ausente", conectado: conta !== null, conta, amplo: false });
  }
  return r;
}

const SEM_COR = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n");
/** Link (e código de dispositivo) que o login imprimiu até agora; nada ainda = os dois null. */
export function lerLink(id: ContaId, saida: string): { url: string | null; codigo: string | null } {
  const s = SEM_COR(saida);
  if (id === "cloudflare") {
    const auth = /https:\/\/dash\.cloudflare\.com\/oauth2\/auth\?\S+/.exec(s)?.[0] ?? null;
    if (auth !== null) return { url: auth, codigo: null };
    const dev = /https:\/\/dash\.cloudflare\.com\/oauth2\/device\/verify\S*/.exec(s)?.[0] ?? null;
    const codigo = dev === null ? null : /enter the code:\s*([A-Za-z0-9-]{4,})/.exec(s)?.[1] ?? null;
    return { url: dev !== null && codigo !== null ? dev : null, codigo };
  }
  const url = /https:\/\/github\.com\/login\/device\S*/.exec(s)?.[0] ?? null;
  const codigo = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(s)?.[1] ?? null;
  return { url: url !== null && codigo !== null ? url : null, codigo };
}

/** O login terminou bem, pelo que a ferramenta imprimiu (a confirmação de verdade é o status depois). */
export function loginConcluiu(id: ContaId, saida: string): boolean {
  const s = SEM_COR(saida);
  return id === "cloudflare" ? /Successfully logged in/i.test(s) : /Logged in as [\w-]+/.test(s);
}

export const NOME_CONTA: Record<ContaId, string> = { cloudflare: "Cloudflare", github: "GitHub" };
