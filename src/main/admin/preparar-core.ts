/**
 * Variante: admin. "Preparar máquina": o checklist do root, puro e testado. Um script de estado imprime fatos
 * `KEY=value` (como o LISTAR_SH) e `lerPreparar` decide aqui o que está ok, o que falta e o que é humano (login do
 * root no Claude e na Cloudflare, domínio do link): a regra fica num lugar só. `passosPreparar` monta, na ordem de
 * dependência, os passos que o admin roda (um `runSsh` por passo, com prazo e auditoria próprios), reaproveitando os
 * instaladores que já existem (swap, cota, governança, Hermes, transcritor) e dois novos daqui (pacotes do sistema e
 * o `gh` em /usr/local/bin). O que é humano nunca entra no "aplicar": a lista aponta para a aba certa. IO em preparar-admin.ts.
 */
import type { ItemPreparar, PrepararId, PrepararVisao } from "../../shared/ipc";
import type { Acao } from "../auditoria/auditoria-core";
import { COTA_ESTADO_SH, COTA_LIGAR_SH, HERMES_ESTADO_SH, hermesGlobalSh, isolamentoTodosSh, reservaDe, reservaHostSh, swapLigarSh, transcritorSh } from "./usuarios-core";
import { CG_DIR, CG_SERVICO } from "./claude-global-core";
import { LP_ETC } from "./link-publico-core";

/** jq (status line do Claude) e ffmpeg (voz e áudio do Hermes): até aqui só entravam por `sudo -n`, que as boxes não têm. */
export const PACOTES_BASE = ["jq", "ffmpeg"] as const;
/** A tela do bot (painel Computador): a mesma lista de backend-colima/install-tela.sh, que como usuário sai com 3 sem eles. */
export const PACOTES_TELA = ["xvfb", "x11-utils", "openbox", "x11vnc", "novnc", "python3-websockify", "xdotool", "scrot"] as const;
/** Navegador na tela do bot (o "gostinho" do Pro na box compartilhada); no Ubuntu o apt entrega um stub do snap, então vira passo humano. */
export const PACOTE_CHROMIUM = "chromium";
export const PACOTE_RE = /^[a-z0-9][a-z0-9.+-]{1,60}$/;
/** Ordem de aplicação (dependências): swap e cota antes de qualquer apt; pacotes antes do gh; Hermes antes do transcritor (copia o modelo) e do Claude Global (usa o Node de /opt/hermes). */
export const ORDEM_PREPARAR: readonly PrepararId[] = ["swap", "cota", "governanca", "pacotes", "gh", "hermes", "transcritor", "claude-global", "chromium"];
/** Ordem da lista na tela: o link público entre o Claude Global e o Chromium (os dois humanos juntos). */
export const ORDEM_LISTA: readonly PrepararId[] = ["swap", "cota", "governanca", "pacotes", "gh", "hermes", "transcritor", "claude-global", "link-publico", "chromium"];
export const TITULOS: Record<PrepararId, string> = {
  swap: "Memória de reserva (swap de 8 GB)", cota: "Cota de disco por usuário", governanca: "Governança de RAM/CPU", pacotes: "Pacotes do sistema (jq, ffmpeg e a tela do bot)",
  gh: "GitHub CLI para todos (/usr/local/bin/gh)", hermes: "Hermes para todos (/opt/hermes)", transcritor: "Transcritor de áudio para todos (/opt/transcriber)",
  "claude-global": "Claude Code Global", "link-publico": "Link Público Global", chromium: "Navegador na tela do bot (Chromium)",
};
const SO_ROOT = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }`;
const TODOS_PACOTES: readonly string[] = [...PACOTES_BASE, ...PACOTES_TELA, PACOTE_CHROMIUM];

/**
 * Estado da máquina numa viagem SSH, só leitura: `ROOT`, `RAM=<kb>`, `SWAP=<kb>`, `COTA=0|1`, `RESERVA=0|1` (teto no
 * user.slice), `SEMISO=<boxes sem isolamento>`, `PACOTES=jq=1 ffmpeg=0 …` (dpkg, não `command -v`: o novnc não tem
 * binário), `GH=<versão>` (só o de /usr/local/bin: o de ~/.local/bin de um usuário não conta), `HERMES=…`,
 * `CG=<inst> <ativo> <login>`, `LP=<inst> <login> <tunel> <servico> <domínio>`, `OS=<id>`.
 */
export const PREPARAR_ESTADO_SH = `${SO_ROOT}
echo ROOT
echo "RAM=$(free -k | awk '/^Mem:/ {print $2}')"
echo "SWAP=$(free -k | awk '/^Swap:/ {print $2}')"
${COTA_ESTADO_SH}
R=$(systemctl show user.slice -p MemoryMax --value 2>/dev/null); if [ -n "$R" ] && [ "$R" != infinity ]; then echo RESERVA=1; else echo RESERVA=0; fi
S=""; for n in $(awk -F: '$3>=1000 && $3<60000 && $7 !~ /(nologin|false)$/ {print $1}' /etc/passwd); do case "$n" in openclaw|hermes|auditoria) continue;; esac; g=" $(id -nG "$n" 2>/dev/null) "; case "$g" in *" sudo "*|*" wheel "*|*" admin "*) continue;; esac; u=$(id -u "$n" 2>/dev/null); [ -d "/sys/fs/cgroup/user.slice/user-$u.slice" ] || continue; [ "$(systemctl show "user-$u.slice" -p MemorySwapMax --value 2>/dev/null)" = infinity ] && S="$S $n"; done; echo "SEMISO=\${S# }"
P=""; for p in ${TODOS_PACOTES.join(" ")}; do if dpkg-query -W -f='\${Status}' "$p" 2>/dev/null | grep -q "install ok installed"; then P="$P $p=1"; else P="$P $p=0"; fi; done; echo "PACOTES=\${P# }"
echo "GH=$(/usr/local/bin/gh --version 2>/dev/null | head -1 | awk '{print $3}')"
${HERMES_ESTADO_SH}
CGI=0; [ -f /etc/systemd/system/${CG_SERVICO}.service ] && [ -f ${CG_DIR}/claude-global.js ] && CGI=1
CGA=0; systemctl is-active --quiet ${CG_SERVICO} 2>/dev/null && CGA=1
CGL=0; grep -q '"oauthAccount"' /root/.claude.json 2>/dev/null && [ -s /root/.claude/.credentials.json ] && CGL=1
echo "CG=$CGI $CGA $CGL"
LPI=0; command -v nginx >/dev/null 2>&1 && [ -f /etc/nginx/sites-enabled/meu-bot-publico ] && command -v cloudflared >/dev/null 2>&1 && [ -f ${LP_ETC}/config.json ] && LPI=1
LPL=0; [ -s /root/.cloudflared/cert.pem ] && LPL=1
LPT=0; [ -n "$(sed -n 's/^tunnel: *//p' /etc/cloudflared/config.yml 2>/dev/null | head -1)" ] && LPT=1
LPS=0; systemctl is-active --quiet cloudflared 2>/dev/null && LPS=1
echo "LP=$LPI $LPL $LPT $LPS $(python3 -c 'import json; print(json.load(open("${LP_ETC}/config.json"))["dominio"])' 2>/dev/null)"
echo "OS=$(. /etc/os-release 2>/dev/null; echo "\${ID:-}")"`;

/** A visão da tela mais o que só o "aplicar" precisa (RAM total para a reserva; quais boxes faltam isolar). */
export interface PrepararLido extends PrepararVisao { ramKb: number | null; semIsolamento: string[] }

const num = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);

export function lerPreparar(out: string): PrepararLido {
  if (!/^ROOT$/m.test(out)) return { root: false, itens: [], faltam: [], ramKb: null, semIsolamento: [] };
  const ramKb = num(/^RAM=(\d+)$/m.exec(out)?.[1]);
  const swapKb = num(/^SWAP=(\d+)$/m.exec(out)?.[1]) ?? 0;
  const cota = /^COTA=1$/m.test(out);
  const reserva = /^RESERVA=1$/m.test(out);
  const semIsolamento = (/^SEMISO=(.*)$/m.exec(out)?.[1] ?? "").split(/\s+/).filter((n) => /^[a-z_][a-z0-9_-]*$/.test(n));
  const pacotes = new Map<string, boolean>();
  for (const par of (/^PACOTES=(.*)$/m.exec(out)?.[1] ?? "").split(/\s+/)) { const m = /^([a-z0-9.+-]+)=([01])$/.exec(par); if (m !== null) pacotes.set(m[1]!, m[2] === "1"); }
  const faltamPacotes = [...PACOTES_BASE, ...PACOTES_TELA].filter((p) => pacotes.get(p) !== true);
  const gh = (/^GH=(\S*)$/m.exec(out)?.[1] ?? "").trim();
  const hermes = /^HERMES=(global|sem-transcritor|root|nenhum)$/m.exec(out)?.[1] ?? null;
  const cg = /^CG=([01]) ([01]) ([01])$/m.exec(out);
  const lp = /^LP=([01]) ([01]) ([01]) ([01]) ?(\S*)$/m.exec(out);
  const os = (/^OS=(\S*)$/m.exec(out)?.[1] ?? "").trim();

  const item = (id: PrepararId, estado: ItemPreparar["estado"], detalhe: string, extra: Partial<ItemPreparar> = {}): ItemPreparar => ({ id, titulo: TITULOS[id], estado, detalhe, opcional: false, ...extra });
  const porId = new Map<PrepararId, ItemPreparar>();
  porId.set("swap", swapKb > 0 ? item("swap", "ok", `${Math.round(swapKb / 1024 / 1024 * 10) / 10} GB`) : item("swap", "falta", "sem swap: o Linux mata processos quando a RAM acaba; 8 GB num /swapfile"));
  porId.set("cota", cota ? item("cota", "ok", "usrquota ligada no disco principal") : item("cota", "falta", "sem cota não há limite de disco por pessoa"));
  porId.set("governanca", reserva && semIsolamento.length === 0 ? item("governanca", "ok", "reserva para o sistema e isolamento das boxes")
    : item("governanca", "falta", [!reserva ? "sem reserva para o sistema (teto no user.slice)" : "", semIsolamento.length > 0 ? `sem isolamento: ${semIsolamento.join(", ")}` : ""].filter((s) => s !== "").join(" · ")));
  porId.set("pacotes", faltamPacotes.length === 0 ? item("pacotes", "ok", "jq, ffmpeg e a tela do bot") : item("pacotes", "falta", `faltam: ${faltamPacotes.join(", ")}`));
  porId.set("gh", gh !== "" ? item("gh", "ok", `gh ${gh}`) : item("gh", "falta", "cada conta teria de instalar o seu em ~/.local/bin"));
  porId.set("hermes", hermes === "global" || hermes === "sem-transcritor" ? item("hermes", "ok", "/opt/hermes para todos") : item("hermes", "falta", hermes === "root" ? "só o root tem o Hermes: os usuários não alcançam" : "cada usuário baixaria uma cópia"));
  porId.set("transcritor", hermes === "global" ? item("transcritor", "ok", "/opt/transcriber para todos") : item("transcritor", "falta", hermes === "sem-transcritor" ? "o Hermes global está sem o transcritor compartilhado" : "vem depois do Hermes para todos"));
  if (cg === null || cg[1] === "0") porId.set("claude-global", item("claude-global", "falta", "o intermediário do root ainda não está instalado", { pagina: "claude-global" }));
  else if (cg[3] === "0") porId.set("claude-global", item("claude-global", "humano", "entre no Claude Code do root (abre no Terminal, pela aba Claude Code Global)", { pagina: "claude-global" }));
  else if (cg[2] === "0") porId.set("claude-global", item("claude-global", "falta", "instalado, mas parado: instalar de novo sobe o serviço", { pagina: "claude-global" }));
  else porId.set("claude-global", item("claude-global", "ok", "no ar, com o login do root", { pagina: "claude-global" }));
  if (lp === null || lp[1] === "0") porId.set("link-publico", item("link-publico", "humano", "instale com o domínio na aba Link Público Global", { pagina: "link-publico" }));
  else if (lp[2] === "0") porId.set("link-publico", item("link-publico", "humano", "entre na Cloudflare pela aba Link Público Global", { pagina: "link-publico" }));
  else if (lp[3] === "0" || lp[4] === "0") porId.set("link-publico", item("link-publico", "humano", lp[3] === "0" ? "suba o túnel na aba Link Público Global" : "o túnel está criado, mas o cloudflared está parado", { pagina: "link-publico" }));
  else porId.set("link-publico", item("link-publico", "ok", `*.${lp[5] ?? ""} no ar`, { pagina: "link-publico" }));
  if (pacotes.get(PACOTE_CHROMIUM) === true) porId.set("chromium", item("chromium", "ok", "o agente abre sites na tela do bot", { opcional: true }));
  else if (os === "ubuntu") porId.set("chromium", item("chromium", "humano", "no Ubuntu o apt entrega só um atalho do snap: instale o Chromium à mão", { opcional: true }));
  else porId.set("chromium", item("chromium", "falta", "300 a 600 MB de RAM por janela; numa box apertada o vigia fecha", { opcional: true }));

  const itens = ORDEM_LISTA.map((id) => porId.get(id)!);
  const faltam = ORDEM_PREPARAR.filter((id) => { const i = porId.get(id); return i !== undefined && i.estado === "falta" && !i.opcional; });
  return { root: true, itens, faltam, ramKb, semIsolamento };
}

/** Um passo do "aplicar": o script (null = precisa de scp, o admin chama `installClaudeGlobal`), o marcador de sucesso, o prazo e a auditoria. */
export interface PassoPreparar { id: PrepararId; titulo: string; sh: string | null; ok: RegExp; timeoutMs: number; acao: Acao; alvo: (out: string) => string }

/** Nomes de pacote validados um a um (nada de `;` ou espaço vira argumento do apt). */
export function pacotesSh(lista: readonly string[]): string {
  if (lista.length === 0 || lista.some((p) => !PACOTE_RE.test(p))) throw new Error("nome de pacote inválido");
  const l = lista.join(" ");
  return `${SO_ROOT}
command -v apt-get >/dev/null 2>&1 || { echo "ERRO=esta máquina não usa apt; instale à mão: ${l}"; exit 0; }
export DEBIAN_FRONTEND=noninteractive
dpkg --configure -a >/dev/null 2>&1 || true
F=""; for p in ${l}; do dpkg-query -W -f='\${Status}' "$p" 2>/dev/null | grep -q "install ok installed" || F="$F $p"; done
[ -n "$F" ] || { echo "PACOTES=ok 0"; exit 0; }
apt-get -o DPkg::Lock::Timeout=120 -qq update >/tmp/meu-bot-pacotes.log 2>&1 || true
apt-get -o DPkg::Lock::Timeout=120 -y -qq --no-install-recommends install $F >>/tmp/meu-bot-pacotes.log 2>&1 || { echo "ERRO=o apt não instalou$F (o log está em /tmp/meu-bot-pacotes.log)"; exit 0; }
R=""; for p in $F; do dpkg-query -W -f='\${Status}' "$p" 2>/dev/null | grep -q "install ok installed" || R="$R $p"; done
[ -z "$R" ] && echo "PACOTES=ok $(echo $F | wc -w)$F" || echo "ERRO=faltou depois do apt:$R"`;
}

/**
 * O gh para todos: o binário oficial da última versão em /usr/local/bin (a variante root do INSTALAR_GH_SH de
 * contas-cli-core.ts, que instala por conta em ~/.local/bin). A versão vem da URL final de releases/latest, sem a API
 * (60 pedidos por hora sem token). Já existe: só diz a versão. Saída `GH=ok <versão>` ou `ERRO=`.
 */
export const GH_GLOBAL_SH = `${SO_ROOT}
if [ -x /usr/local/bin/gh ]; then echo "GH=ok $(/usr/local/bin/gh --version | head -1 | awk '{print $3}')"; exit 0; fi
case "$(uname -m)" in x86_64|amd64) A=amd64;; aarch64|arm64) A=arm64;; *) echo "ERRO=arquitetura não suportada: $(uname -m)"; exit 0;; esac
V=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/cli/cli/releases/latest 2>/dev/null | sed 's|.*/tag/v||')
[ -n "$V" ] || { echo "ERRO=não consegui descobrir a versão do gh (sem internet?)"; exit 0; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
curl -fsSL -o "$T/gh.tgz" "https://github.com/cli/cli/releases/download/v$V/gh_\${V}_linux_\${A}.tar.gz" || { echo "ERRO=não consegui baixar o gh $V"; exit 0; }
tar -xzf "$T/gh.tgz" -C "$T" && install -m 755 "$T"/gh_*/bin/gh /usr/local/bin/gh || { echo "ERRO=não consegui instalar o gh em /usr/local/bin"; exit 0; }
echo "GH=ok $(/usr/local/bin/gh --version | head -1 | awk '{print $3}')"`;

/**
 * Os passos do "aplicar" para os ids pedidos, na ORDEM_PREPARAR: ids desconhecidos e o link público caem; o Chromium
 * só entra quando pedido e quando não é passo humano; a governança vira só o que falta (reserva precisa da RAM lida).
 */
export function passosPreparar(ids: readonly string[], v: PrepararLido): PassoPreparar[] {
  const pedidos = new Set(ids);
  const estado = (id: PrepararId): ItemPreparar["estado"] | null => v.itens.find((i) => i.id === id)?.estado ?? null;
  const passos: PassoPreparar[] = [];
  const ultimo = (re: RegExp) => (out: string): string => re.exec(out)?.[1] ?? "";
  // Os instaladores antigos (swap, cota, Hermes, transcritor) confiam em quem os chama; aqui todo passo nasce com o guard.
  const comoRoot = (sh: string): string => (sh.startsWith(SO_ROOT) ? sh : `${SO_ROOT}\n${sh}`);
  for (const id of ORDEM_PREPARAR) {
    if (!pedidos.has(id)) continue;
    if (id === "swap") passos.push({ id, titulo: TITULOS.swap, sh: comoRoot(swapLigarSh(8)), ok: /^SWAP=ok$/m, timeoutMs: 5 * 60_000, acao: "maquina.swap", alvo: () => "8 GB" });
    else if (id === "cota") passos.push({ id, titulo: TITULOS.cota, sh: comoRoot(COTA_LIGAR_SH), ok: /^COTA=ok$/m, timeoutMs: 5 * 60_000, acao: "maquina.cota", alvo: () => "usrquota" });
    else if (id === "governanca") {
      const temReserva = !(v.itens.find((i) => i.id === "governanca")?.detalhe ?? "").includes("sem reserva");
      if (!temReserva && v.ramKb !== null) { const { capMb, lowMb } = reservaDe(v.ramKb); passos.push({ id, titulo: "Reserva de memória para o sistema", sh: reservaHostSh(capMb, lowMb), ok: /^RESERVA=ok /m, timeoutMs: 30_000, acao: "maquina.reserva", alvo: ultimo(/^RESERVA=ok (\d+)/m) }); }
      if (v.semIsolamento.length > 0) passos.push({ id, titulo: "Isolamento das boxes", sh: isolamentoTodosSh(), ok: /^ISOLAMENTO=ok /m, timeoutMs: 60_000, acao: "maquina.isolamento", alvo: ultimo(/^ISOLAMENTO=ok (.*)$/m) });
    } else if (id === "pacotes") passos.push({ id, titulo: TITULOS.pacotes, sh: pacotesSh([...PACOTES_BASE, ...PACOTES_TELA]), ok: /^PACOTES=ok/m, timeoutMs: 10 * 60_000, acao: "maquina.pacotes", alvo: ultimo(/^PACOTES=ok \d+ ?(.*)$/m) });
    else if (id === "gh") passos.push({ id, titulo: TITULOS.gh, sh: GH_GLOBAL_SH, ok: /^GH=ok /m, timeoutMs: 2 * 60_000, acao: "maquina.gh", alvo: ultimo(/^GH=ok (\S+)/m) });
    else if (id === "hermes") passos.push({ id, titulo: TITULOS.hermes, sh: comoRoot(hermesGlobalSh()), ok: /^HERMES=ok /m, timeoutMs: 15 * 60_000, acao: "maquina.hermes-global", alvo: ultimo(/^HERMES=ok (\S+)/m) });
    else if (id === "transcritor") passos.push({ id, titulo: TITULOS.transcritor, sh: comoRoot(transcritorSh()), ok: /^TRANSCRITOR=ok$/m, timeoutMs: 20 * 60_000, acao: "maquina.transcritor", alvo: () => "/opt/transcriber" });
    else if (id === "claude-global") passos.push({ id, titulo: TITULOS["claude-global"], sh: null, ok: /^CLAUDE_GLOBAL=ok/m, timeoutMs: 5 * 60_000, acao: "maquina.claude-global", alvo: () => "" });
    else if (id === "chromium" && estado("chromium") === "falta") passos.push({ id, titulo: TITULOS.chromium, sh: pacotesSh([PACOTE_CHROMIUM]), ok: /^PACOTES=ok/m, timeoutMs: 10 * 60_000, acao: "maquina.pacotes", alvo: () => PACOTE_CHROMIUM });
  }
  return passos;
}
