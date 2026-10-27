/** Puro (testado): o nome aceito, o script que lista os usuários de login e a leitura da saída dele. */
import type { UsuarioMaquina } from "../../shared/ipc";

/** Nome de usuário Linux aceito: minúsculas, dígitos, hífen e sublinhado, começando por letra; até 32. */
export const NOME_USUARIO_RE = /^[a-z][a-z0-9_-]{1,31}$/;
/** Nomes que já existem em qualquer Debian/Ubuntu ou que confundem (root, admin…): recusados mesmo se livres. */
export const RESERVADOS = new Set(["root", "admin", "sudo", "daemon", "bin", "sys", "sync", "games", "man", "lp", "mail", "news", "uucp", "proxy", "www-data", "backup", "list", "irc", "nobody", "systemd", "ubuntu", "debian"]);

/** Lista: uma linha `U<TAB>nome<TAB>uid<TAB>home<TAB>shell<TAB>sudo<TAB>meubot<TAB>chave` por usuário de login. */
export const LISTAR_SH = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
echo ROOT
awk -F: '$3>=1000 && $3<60000 && $7 !~ /(nologin|false)$/ {print $1"\\t"$3"\\t"$6"\\t"$7}' /etc/passwd | while IFS="$(printf '\\t')" read -r n u h s; do
  g=" $(id -nG "$n" 2>/dev/null) "; case "$g" in *" sudo "*|*" wheel "*|*" admin "*) su=1 ;; *) su=0 ;; esac
  [ -d "$h/.local/share/meu-bot" ] && mb=1 || mb=0
  [ -s "$h/.ssh/authorized_keys" ] && ch=1 || ch=0
  printf 'U\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$n" "$u" "$h" "$s" "$su" "$mb" "$ch"
done`;

export function lerUsuarios(out: string): { root: boolean; usuarios: UsuarioMaquina[] } {
  const root = /^ROOT$/m.test(out);
  const usuarios: UsuarioMaquina[] = [];
  for (const l of out.split("\n")) {
    const c = l.split("\t");
    if (c[0] !== "U" || c.length < 8 || !NOME_USUARIO_RE.test(c[1] ?? "")) continue;
    usuarios.push({ nome: c[1]!, uid: Number(c[2]), home: c[3] ?? "", shell: c[4] ?? "", sudo: c[5] === "1", meuBot: c[6] === "1", chave: c[7] === "1" });
  }
  return { root, usuarios: usuarios.sort((a, b) => a.uid - b.uid) };
}

