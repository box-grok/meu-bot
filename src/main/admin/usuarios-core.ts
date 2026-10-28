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
 * Lista: `DISCO=<kb>` (tamanho de /), `COTA=0|1`, `RAM=<total kb> <em uso kb>`, `RAMROOT=<kb>` (o que é do root) e uma linha
 * `U<TAB>nome<TAB>uid<TAB>home<TAB>shell<TAB>sudo<TAB>meubot<TAB>chave<TAB>usadoKb<TAB>limiteKb` por usuário de login
 * (usado e limite vazios sem cota; limite 0 = sem limite), a RAM dos processos dele (KB) e os tetos do systemd na
 * fatia dele (`user-<uid>.slice`): RAM máxima (bytes ou "infinity") e CPU por segundo ("1s" = 100%, "infinity").
 */
export const LISTAR_SH = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
echo ROOT
echo "DISCO=$(df -k --output=size / 2>/dev/null | tail -1 | tr -d ' ')"
if quotaon -pu / 2>/dev/null | grep -q " is on"; then cota=1; else cota=0; fi; echo "COTA=$cota"
echo "RAM=$(free -k | awk '/^Mem:/ {print $2" "$3}')"
echo "RAMROOT=$(ps -u root -o rss= 2>/dev/null | awk '{s+=$1} END {print s+0}')"
echo "SWAP=$(free -k | awk '/^Swap:/ {print $2" "$3}')"
awk -F: '$3>=1000 && $3<60000 && $7 !~ /(nologin|false)$/ {split($5, g, ","); print $1"\\t"$3"\\t"$6"\\t"$7"\\t"g[1]}' /etc/passwd | while IFS="$(printf '\\t')" read -r n u h s ap; do
  g=" $(id -nG "$n" 2>/dev/null) "; case "$g" in *" sudo "*|*" wheel "*|*" admin "*) su=1 ;; *) su=0 ;; esac
  [ -d "$h/.local/share/meu-bot" ] && mb=1 || mb=0
  [ -s "$h/.ssh/authorized_keys" ] && ch=1 || ch=0
  us=""; li=""
  if [ "$cota" = 1 ]; then q=$(quota -wu "$n" 2>/dev/null | awk 'NR>2 && $1 ~ /^\\// {gsub(/\\*/,"",$2); print $2" "$4; exit}'); us=\${q%% *}; li=\${q##* }; [ -n "$q" ] || { us=0; li=0; }; fi
  ram=$(ps -u "$n" -o rss= 2>/dev/null | awk '{s+=$1} END {print s+0}')
  mm=$(systemctl show "user-$u.slice" -p MemoryMax --value 2>/dev/null); cq=$(systemctl show "user-$u.slice" -p CPUQuotaPerSecUSec --value 2>/dev/null)
  printf 'U\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$n" "$u" "$h" "$s" "$su" "$mb" "$ch" "$us" "$li" "$ram" "$mm" "$cq" "$ap"
done`;

const kb = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
export function lerUsuarios(out: string): { root: boolean; discoKb: number | null; cota: boolean; ram: { totalKb: number; usoKb: number; rootKb: number; swapKb: number; swapUsoKb: number } | null; usuarios: UsuarioMaquina[] } {
  const root = /^ROOT$/m.test(out);
  const discoKb = kb(/^DISCO=(\d+)$/m.exec(out)?.[1]);
  const cota = /^COTA=1$/m.test(out);
  const rm = /^RAM=(\d+) (\d+)$/m.exec(out);
  const sw = /^SWAP=(\d+) (\d+)$/m.exec(out);
  const ram = rm === null ? null : { totalKb: Number(rm[1]), usoKb: Number(rm[2]), rootKb: kb(/^RAMROOT=(\d+)$/m.exec(out)?.[1]) ?? 0, swapKb: sw === null ? 0 : Number(sw[1]), swapUsoKb: sw === null ? 0 : Number(sw[2]) };
  const usuarios: UsuarioMaquina[] = [];
  for (const l of out.split("\n")) {
    const c = l.split("\t");
    if (c[0] !== "U" || c.length < 8 || !NOME_USUARIO_RE.test(c[1] ?? "")) continue;
    const limite = kb(c[9]);
    usuarios.push({ nome: c[1]!, uid: Number(c[2]), home: c[3] ?? "", shell: c[4] ?? "", sudo: c[5] === "1", meuBot: c[6] === "1", chave: c[7] === "1", usadoKb: kb(c[8]), limiteKb: limite === 0 ? null : limite, ramKb: kb(c[10]) ?? 0, ramMaxMb: ramMaxDe(c[11]), cpuMaxPct: cpuMaxDe(c[12]), apelido: (c[13] ?? "").trim() });
  }
  return { root, discoKb, cota, ram, usuarios: usuarios.sort((a, b) => a.uid - b.uid) };
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

/** MemoryMax do systemd (bytes ou "infinity") → MB; null = sem teto. */
export function ramMaxDe(v: string | undefined): number | null {
  if (v === undefined || !/^\d+$/.test(v.trim())) return null;
  return Math.round(Number(v.trim()) / 1024 / 1024);
}
/** CPUQuotaPerSecUSec do systemd ("1s", "500ms", "1.500s", "infinity") → % de um núcleo; null = sem teto. */
export function cpuMaxDe(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  const m = /^(\d+(?:\.\d+)?)(s|ms|us)$/.exec(t);
  if (m === null) return null;
  const s = Number(m[1]) / (m[2] === "s" ? 1 : m[2] === "ms" ? 1000 : 1_000_000);
  return Math.round(s * 100);
}

/**
 * Tetos de RAM (MB; 0 = sem teto) e CPU (% de um núcleo; 0 = sem teto) na fatia do usuário, pelo systemd: vale para
 * tudo o que ele roda (agente, terminal…), persiste sem reiniciar e é o mesmo para qualquer agente. MemoryHigh a 90%
 * do máximo: o Linux aperta antes de matar. Saída `RECURSOS=ok` ou `ERRO=`.
 */
export function recursosSh(nome: string, ramMb: number, cpuPct: number): string {
  if (!Number.isInteger(ramMb) || ramMb < 0 || ramMb > 1_048_576) throw new Error("RAM máxima: um número inteiro de MB (0 = sem teto)");
  if (!Number.isInteger(cpuPct) || cpuPct < 0 || cpuPct > 6400) throw new Error("CPU: uma porcentagem inteira de um núcleo (100 = um núcleo; 0 = sem teto)");
  const mem = ramMb === 0 ? "MemoryHigh=infinity MemoryMax=infinity" : `MemoryHigh=${Math.floor(ramMb * 0.9)}M MemoryMax=${ramMb}M`;
  const cpu = cpuPct === 0 ? "CPUQuota=" : `CPUQuota=${cpuPct}%`;
  return `U=$(id -u '${nome}' 2>/dev/null) || { echo "ERRO=não existe o usuário ${nome}"; exit 0; }
[ "$U" -ge 1000 ] || { echo "ERRO=${nome} é um usuário do sistema"; exit 0; }
systemctl set-property "user-$U.slice" ${mem} ${cpu} >/dev/null 2>&1 && echo RECURSOS=ok || echo "ERRO=o systemd recusou os limites"`;
}

/**
 * Memória de reserva (swap) de `gb` GB num arquivo, quando a máquina não tem nenhuma: sem ela, RAM cheia faz o Linux
 * matar processos (um agente some) em vez de desacelerar. Backup do /etc/fstab, conferência, desfaz se falhar;
 * swappiness 10 (só usa quando aperta). Já tem swap: não faz nada. Saída `SWAP=ok` ou `ERRO=`.
 */
export function swapLigarSh(gb: number): string {
  if (!Number.isInteger(gb) || gb < 1 || gb > 64) throw new Error("swap: de 1 a 64 GB");
  return `if [ "$(swapon --noheadings --show=SIZE 2>/dev/null | wc -l)" -gt 0 ]; then echo SWAP=ok; exit 0; fi
F=/swapfile; [ -e "$F" ] && { echo "ERRO=já existe um /swapfile que não está ligado; confira à mão"; exit 0; }
L=$(df -k --output=avail / | tail -1 | tr -d ' '); [ "$L" -gt $(( ${gb} * 1024 * 1024 + 2097152 )) ] || { echo "ERRO=pouco espaço livre no disco para ${gb} GB de swap"; exit 0; }
B=/etc/fstab.bak-meu-bot-$(date +%Y%m%d-%H%M%S); cp /etc/fstab "$B" || { echo "ERRO=não consegui guardar a cópia do /etc/fstab"; exit 0; }
fallocate -l ${gb}G "$F" && chmod 600 "$F" && mkswap "$F" >/dev/null && swapon "$F" || { swapoff "$F" 2>/dev/null; rm -f "$F"; echo "ERRO=não consegui criar a swap"; exit 0; }
grep -qE '^/swapfile[[:space:]]' /etc/fstab || printf '/swapfile none swap sw 0 0\\n' >> /etc/fstab
findmnt --verify --tab-file /etc/fstab >/dev/null 2>&1 || { cp "$B" /etc/fstab; echo "ERRO=o /etc/fstab novo não passou na conferência (a cópia voltou; a swap fica ligada só até reiniciar)"; exit 0; }
printf 'vm.swappiness=10\\n' > /etc/sysctl.d/90-meu-bot-swap.conf; sysctl -q -w vm.swappiness=10 >/dev/null 2>&1 || true
systemctl daemon-reload >/dev/null 2>&1 || true
echo SWAP=ok`;
}

/** Apelido aceito: até 40 caracteres, sem ":", "," nem quebra (são separadores do /etc/passwd). Vazio = sem apelido. */
export function apelidoValido(v: unknown): string {
  if (typeof v !== "string") throw new Error("apelido inválido");
  const a = v.replace(/\s+/g, " ").trim();
  if (a.length > 40 || /[:,\n\r\t\\]/.test(a)) throw new Error("apelido: até 40 caracteres, sem dois-pontos nem vírgula");
  return a;
}
/** Grava o apelido no campo de descrição do usuário (GECOS); login e pasta não mudam. Saída `APELIDO=ok` ou `ERRO=`. */
export const apelidoSh = (nome: string, apelido: string): string => `id '${nome}' >/dev/null 2>&1 || { echo "ERRO=não existe o usuário ${nome}"; exit 0; }
A=$(printf '%s' '${Buffer.from(apelido, "utf8").toString("base64")}' | base64 -d)
usermod -c "$A" '${nome}' && echo APELIDO=ok || echo "ERRO=não consegui gravar o apelido"`;

/** Nome do Host no ~/.ssh/config para o usuário de uma máquina: `<máquina>-<usuário>` (só letras, números, - e .). */
export function aliasDoUsuario(maquina: string, nome: string): string {
  const m = maquina.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "maquina";
  return `${m}-${nome}`.slice(0, 63);
}
/** O bloco que entra no ~/.ssh/config deste Mac (com a chave do admin, que já está no authorized_keys do usuário). */
export function blocoSshUsuario(o: { alias: string; hostname: string; port: string; user: string; chave: string; maquina: string }): string {
  return `# meu-bot-admin: usuário ${o.user} da máquina ${o.maquina}
Host ${o.alias}
    HostName ${o.hostname}
    User ${o.user}
    Port ${o.port}
    IdentityFile ${o.chave}
    IdentitiesOnly yes
`;
}
/** O ~/.ssh/config já tem um Host com esse nome (em qualquer posição da linha Host)? */
export const configTemHost = (texto: string, alias: string): boolean =>
  texto.split("\n").some((l) => { const m = /^\s*Host\s+(.+)$/i.exec(l); return m !== null && m[1]!.trim().split(/\s+/).includes(alias); });
