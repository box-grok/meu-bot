/**
 * Puro (testado): o nome aceito, os scripts da aba Usuários (listar, ligar a cota, limite, apagar) e a leitura da
 * saída. O limite de disco é uma cota de usuário no disco principal (/), em % do tamanho dele.
 */
import type { UsuarioMaquina } from "../../shared/ipc";

/** Nome de usuário Linux aceito: minúsculas, dígitos, hífen e sublinhado, começando por letra; até 32. */
export const NOME_USUARIO_RE = /^[a-z][a-z0-9_-]{1,31}$/;
/** Nomes que já existem em qualquer Debian/Ubuntu ou que confundem (root, admin…): recusados mesmo se livres. */
export const RESERVADOS = new Set(["root", "admin", "sudo", "daemon", "bin", "sys", "sync", "games", "man", "lp", "mail", "news", "uucp", "proxy", "www-data", "backup", "list", "irc", "nobody", "systemd", "ubuntu", "debian"]);
/** Usuários que o meu-bot usa na máquina: nunca apagados pela aba (o agente para). */
export const PROTEGIDOS = new Set(["openclaw", "hermes", "auditoria"]);

/**
 * Lista: `DISCO=<kb>` (tamanho de /), `COTA=0|1` e uma linha
 * `U<TAB>nome<TAB>uid<TAB>home<TAB>shell<TAB>sudo<TAB>meubot<TAB>chave<TAB>usadoKb<TAB>limiteKb` por usuário de login
 * (usado e limite vazios sem cota; limite 0 = sem limite).
 */
export const LISTAR_SH = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
echo ROOT
echo "DISCO=$(df -k --output=size / 2>/dev/null | tail -1 | tr -d ' ')"
if quotaon -pu / 2>/dev/null | grep -q " is on"; then cota=1; else cota=0; fi; echo "COTA=$cota"
awk -F: '$3>=1000 && $3<60000 && $7 !~ /(nologin|false)$/ {print $1"\\t"$3"\\t"$6"\\t"$7}' /etc/passwd | while IFS="$(printf '\\t')" read -r n u h s; do
  g=" $(id -nG "$n" 2>/dev/null) "; case "$g" in *" sudo "*|*" wheel "*|*" admin "*) su=1 ;; *) su=0 ;; esac
  [ -d "$h/.local/share/meu-bot" ] && mb=1 || mb=0
  [ -s "$h/.ssh/authorized_keys" ] && ch=1 || ch=0
  us=""; li=""
  if [ "$cota" = 1 ]; then q=$(quota -wu "$n" 2>/dev/null | awk 'NR>2 && $1 ~ /^\\// {gsub(/\\*/,"",$2); print $2" "$4; exit}'); us=\${q%% *}; li=\${q##* }; [ -n "$q" ] || { us=0; li=0; }; fi
  printf 'U\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$n" "$u" "$h" "$s" "$su" "$mb" "$ch" "$us" "$li"
done`;

const kb = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
export function lerUsuarios(out: string): { root: boolean; discoKb: number | null; cota: boolean; usuarios: UsuarioMaquina[] } {
  const root = /^ROOT$/m.test(out);
  const discoKb = kb(/^DISCO=(\d+)$/m.exec(out)?.[1]);
  const cota = /^COTA=1$/m.test(out);
  const usuarios: UsuarioMaquina[] = [];
  for (const l of out.split("\n")) {
    const c = l.split("\t");
    if (c[0] !== "U" || c.length < 8 || !NOME_USUARIO_RE.test(c[1] ?? "")) continue;
    const limite = kb(c[9]);
    usuarios.push({ nome: c[1]!, uid: Number(c[2]), home: c[3] ?? "", shell: c[4] ?? "", sudo: c[5] === "1", meuBot: c[6] === "1", chave: c[7] === "1", usadoKb: kb(c[8]), limiteKb: limite === 0 ? null : limite });
  }
  return { root, discoKb, cota, usuarios: usuarios.sort((a, b) => a.uid - b.uid) };
}

/** Limite em KB para `pct`% do disco (inteiro de 1 a 100); 0 = sem limite. */
export function limiteKbDe(pct: number, discoKb: number): number {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error("o limite é uma porcentagem inteira de 0 a 100 (0 = sem limite)");
  return pct === 0 ? 0 : Math.max(1024, Math.floor((discoKb * pct) / 100));
}

/**
 * Liga a cota de usuário no disco principal, uma vez por máquina e sem reiniciar: instala o pacote quota, guarda uma
 * cópia do /etc/fstab, acrescenta `usrquota` à linha de /, confere o fstab (desfaz se não passar), remonta, cria o
 * arquivo de cota e liga. Já ligada: não faz nada. Saída: `COTA=ok` ou `ERRO=<motivo>`.
 */
export const COTA_LIGAR_SH = `if quotaon -pu / 2>/dev/null | grep -q " is on"; then echo COTA=ok; exit 0; fi
command -v quotaon >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y -q quota >/dev/null 2>&1 || { echo "ERRO=não consegui instalar o pacote quota"; exit 0; }
modprobe quota_v2 >/dev/null 2>&1 || true
B=/etc/fstab.bak-meu-bot-$(date +%Y%m%d-%H%M%S); cp /etc/fstab "$B" || { echo "ERRO=não consegui guardar a cópia do /etc/fstab"; exit 0; }
python3 - <<'PY' || { cp "$B" /etc/fstab; echo "ERRO=não consegui ajustar o /etc/fstab (a cópia voltou)"; exit 0; }
p = "/etc/fstab"; out = []
for l in open(p).read().split("\\n"):
    c = l.split()
    if len(c) >= 4 and not l.lstrip().startswith("#") and c[1] == "/" and "usrquota" not in c[3].split(","):
        c[3] = c[3] + ",usrquota"; l = "\\t".join(c)
    out.append(l)
open(p, "w").write("\\n".join(out))
PY
findmnt --verify --tab-file /etc/fstab >/dev/null 2>&1 || { cp "$B" /etc/fstab; echo "ERRO=o /etc/fstab novo não passou na conferência (a cópia voltou)"; exit 0; }
systemctl daemon-reload >/dev/null 2>&1 || true
mount -o remount,usrquota / || { cp "$B" /etc/fstab; systemctl daemon-reload >/dev/null 2>&1; echo "ERRO=o disco não aceitou a cota (a cópia do fstab voltou)"; exit 0; }
quotacheck -cum / >/dev/null 2>&1 || true
quotaon -u / >/dev/null 2>&1 || true
quotaon -pu / 2>/dev/null | grep -q " is on" && echo COTA=ok || echo "ERRO=a cota não ligou neste disco"`;

/** Grava o limite (KB; 0 = sem limite) do usuário `nome` (já validado). Saída `LIMITE=ok` ou `ERRO=`. */
export const limiteSh = (nome: string, limiteKb: number): string => `id '${nome}' >/dev/null 2>&1 || { echo "ERRO=não existe o usuário ${nome}"; exit 0; }
setquota -u '${nome}' ${limiteKb} ${limiteKb} 0 0 / && echo LIMITE=ok || echo "ERRO=não consegui gravar o limite"`;

/** Apaga o usuário `nome` (já validado) e a pasta dele; recusa quem tem sudo ou uid de sistema. Saída `APAGADO=` ou `ERRO=`. */
export const apagarSh = (nome: string): string => `N='${nome}'
id "$N" >/dev/null 2>&1 || { echo "ERRO=não existe o usuário $N"; exit 0; }
[ "$(id -u "$N")" -ge 1000 ] || { echo "ERRO=$N é um usuário do sistema"; exit 0; }
case " $(id -nG "$N") " in *" sudo "*|*" wheel "*|*" admin "*) echo "ERRO=$N tem sudo: tire o sudo antes de apagar"; exit 0 ;; esac
pkill -KILL -u "$N" >/dev/null 2>&1 || true
setquota -u "$N" 0 0 0 0 / >/dev/null 2>&1 || true
userdel -r "$N" >/dev/null 2>&1; id "$N" >/dev/null 2>&1 && echo "ERRO=não consegui apagar $N" || echo "APAGADO=$N"`;

/**
 * O que ocupa espaço na pasta do usuário (para o admin escolher o que apagar antes de baixar o limite): as maiores
 * pastas e arquivos até 2 níveis, sem a própria pasta. Linhas `I<TAB>kb<TAB>d|f<TAB>caminho`.
 */
export const maioresSh = (nome: string): string => `H=$(getent passwd '${nome}' | cut -d: -f6); [ -n "$H" ] && [ -d "$H" ] || { echo "ERRO=não achei a pasta de ${nome}"; exit 0; }
echo "HOME=$H"
du -xak --max-depth=2 "$H" 2>/dev/null | sort -rn | awk -v h="$H" '$2 != h' | head -25 | while IFS="$(printf '\\t')" read -r k p; do [ -d "$p" ] && t=d || t=f; printf 'I\\t%s\\t%s\\t%s\\n' "$k" "$t" "$p"; done`;

export function lerMaiores(out: string): { home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] } {
  const home = /^HOME=(.+)$/m.exec(out)?.[1] ?? null;
  const itens: { kb: number; pasta: boolean; caminho: string }[] = [];
  for (const l of out.split("\n")) {
    const c = l.split("\t");
    if (c[0] !== "I" || c.length < 4 || !/^\d+$/.test(c[1] ?? "") || home === null || !caminhoDentro(home, c[3] ?? "")) continue;
    itens.push({ kb: Number(c[1]), pasta: c[2] === "d", caminho: c[3]! });
  }
  return { home, itens };
}

/** O caminho fica dentro da pasta do usuário (nunca a própria pasta, nem com `..`)? */
export const caminhoDentro = (home: string, p: string): boolean =>
  home.startsWith("/home/") && p.startsWith(`${home}/`) && !p.split("/").includes("..") && !/[\n\r]/.test(p) && p.length > home.length + 1;

/** Apaga um item (pasta ou arquivo) dentro da pasta do usuário; o caminho chega em base64 e é conferido de novo. */
export const apagarItemSh = (nome: string, caminhoB64: string): string => `H=$(getent passwd '${nome}' | cut -d: -f6); [ -n "$H" ] || { echo "ERRO=não achei a pasta de ${nome}"; exit 0; }
P=$(printf '%s' '${caminhoB64}' | base64 -d); R=$(realpath -m -- "$P")
case "$R" in "$H"/?*) ;; *) echo "ERRO=o caminho não está dentro da pasta de ${nome}"; exit 0 ;; esac
rm -rf -- "$R" && echo "APAGADO=$R" || echo "ERRO=não consegui apagar"`;
