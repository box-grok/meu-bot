/**
 * meu-bot-admin-mac: as contas deste Mac, lado puro (testado). O app só cuida das contas (quem abre o meu-bot neste
 * Mac); o bot de cada pessoa roda numa VM, que é assunto do meu-bot-admin. Ler a lista não pede nada (dscl e
 * dsmemberutil, como o usuário que abriu o app); criar, apagar e mudar o apelido são scripts que o usuarios-mac.ts roda
 * uma vez como root, pela janela de senha de administrador do macOS. Mesma regra de nome do Linux (admin/usuarios-core.ts).
 */
import type { UsuarioMac, UsuariosMacVisao } from "../../shared/ipc";
import { NOME_USUARIO_RE, RESERVADOS } from "../admin/usuarios-core";
import { UPDATE_REPO } from "../atualizacao/updater-core";

/** Nomes que o macOS já usa ou que confundem, além dos do Linux. */
export const RESERVADOS_MAC = new Set([...RESERVADOS, "guest", "shared", "administrator", "staff", "wheel", "everyone", "svc"]);
/** Contas que existem mas não se apagam daqui (serviço deste Mac). */
const SERVICO = new Set(["svc"]);

/** Erro com a frase para a tela; null = nome bom para uma conta nova. */
export function nomeNovoInvalido(nome: unknown, existentes: readonly string[]): string | null {
  if (typeof nome !== "string" || !NOME_USUARIO_RE.test(nome)) return "nome inválido: use minúsculas, números, - ou _, começando por letra (2 a 32)";
  if (RESERVADOS_MAC.has(nome)) return `"${nome}" é reservado pelo sistema`;
  if (existentes.includes(nome)) return `já existe uma conta "${nome}" neste Mac`;
  return null;
}

/**
 * Senha que a pessoa escolheu: 8 a 64 caracteres visíveis, sem aspas simples (o script a põe entre aspas simples) nem
 * barra invertida. Erro com a frase para a tela; null = boa.
 */
export function senhaEscolhidaInvalida(senha: string): string | null {
  if (senha.length < 8 || senha.length > 64) return "a senha precisa ter de 8 a 64 caracteres";
  if (!/^[\x21-\x7e ]+$/.test(senha) || senha.includes("'") || senha.includes("\\")) return "a senha não pode ter aspas simples, barra invertida, acentos nem quebra de linha";
  return null;
}

/** Senha forte só com letras e números sem ambiguidade (sem aspas em lugar nenhum). `bytes`: aleatórios, ao menos `tamanho`. */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function senhaDe(bytes: Uint8Array, tamanho = 24): string {
  if (bytes.length < tamanho) throw new Error("bytes insuficientes");
  let s = ""; for (let i = 0; i < tamanho; i++) s += ALFABETO[bytes[i]! % ALFABETO.length];
  return s;
}

/** Lista sem sudo: `ATUAL=`, `TELA=` e `U<TAB>nome<TAB>uid<TAB>admin<TAB>realname-base64` por conta de pessoa. */
export const LISTAR_MAC_SH = `echo "ATUAL=$(id -un)"
echo "TELA=$(stat -f %Su /dev/console 2>/dev/null)"
dscl . -list /Users UniqueID | while read -r n uid; do
  case "$n" in _*|root|daemon|nobody) continue ;; esac
  [ "$uid" -ge 501 ] 2>/dev/null && [ "$uid" -lt 60000 ] || continue
  a=0; dsmemberutil checkmembership -U "$n" -G admin 2>/dev/null | grep -q "is a member" && a=1
  r=$(dscl . -read "/Users/$n" RealName 2>/dev/null | sed '1s/^RealName: *//' | tr '\\n' ' ' | sed 's/^ *//; s/ *$//' | base64 | tr -d '\\n')
  printf 'U\\t%s\\t%s\\t%s\\t%s\\n' "$n" "$uid" "$a" "$r"
done`;

/** Por que uma conta não pode ser apagada daqui; null = pode. */
export function protegidaPorque(nome: string, uid: number, atual: string, naTela: string | null): string | null {
  if (nome === atual) return "é a sua conta";
  if (naTela !== null && nome === naTela) return "está usando o Mac agora";
  if (uid < 501) return "conta do sistema";
  if (SERVICO.has(nome)) return "conta de serviço deste Mac";
  return null;
}

/** Saída do LISTAR_MAC_SH → a visão da tela. */
export function lerUsuariosMac(stdout: string): UsuariosMacVisao {
  const kv = (k: string): string => new RegExp(`^${k}=(.*)$`, "m").exec(stdout)?.[1]?.trim() ?? "";
  const atual = kv("ATUAL"); const tela = kv("TELA");
  const naTela = tela !== "" && tela !== "root" ? tela : null;
  const usuarios: UsuarioMac[] = [];
  for (const linha of stdout.split("\n")) {
    const p = linha.split("\t");
    if (p[0] !== "U" || p.length < 5 || !/^[a-z0-9_.-]+$/i.test(p[1] ?? "")) continue;
    const nome = p[1]!; const uid = Number(p[2]);
    if (!Number.isInteger(uid)) continue;
    let apelido = "";
    try { apelido = Buffer.from(p[4] ?? "", "base64").toString("utf8").trim(); } catch { /* sem apelido */ }
    usuarios.push({ nome, uid, apelido: apelido === nome ? "" : apelido, admin: p[3] === "1", protegida: protegidaPorque(nome, uid, atual, naTela) });
  }
  usuarios.sort((a, b) => a.uid - b.uid);
  return { usuarios, atual, naTela };
}

/** De onde a conta nova clona o meu-bot para a mesa (o repositório público; o submódulo privado do Diego não vem). */
export const REPO_MEU_BOT = `https://github.com/${UPDATE_REPO}.git`;

/**
 * Cria a conta administrador com a senha e o home, e já com o meu-bot clonado em ~/Desktop/meu-bot (dono: a conta
 * nova). Roda como root (uma vez). A senha só existe neste script (arquivo
 * 0700 apagado em seguida) e por um instante no argumento do sysadminctl, que não lê senha de entrada sem terminal.
 * Imprime `CRIADO=<nome>` (ou `ERRO=<motivo>`) e `REPO=ok|falhou|sem-git`: o clone que não deu certo não desfaz a conta.
 */
export function criarMacSh(o: { nome: string; senha: string; repo?: string }): string {
  const repo = o.repo ?? REPO_MEU_BOT;
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(repo)) throw new Error("repositório inválido");
  if (!NOME_USUARIO_RE.test(o.nome) || RESERVADOS_MAC.has(o.nome)) throw new Error("nome inválido");
  if (senhaEscolhidaInvalida(o.senha) !== null) throw new Error("senha inválida");
  return `set -u
if dscl . -read "/Users/${o.nome}" >/dev/null 2>&1; then echo "ERRO=já existe uma conta ${o.nome} neste Mac"; exit 1; fi
sysadminctl -addUser "${o.nome}" -fullName "${o.nome}" -shell /bin/zsh -home "/Users/${o.nome}" -admin -password '${o.senha}' >/dev/null 2>&1
dscl . -read "/Users/${o.nome}" >/dev/null 2>&1 || { echo "ERRO=o macOS não criou a conta (sysadminctl)"; exit 1; }
createhomedir -c -u "${o.nome}" >/dev/null 2>&1
[ -d "/Users/${o.nome}" ] || { echo "ERRO=a conta foi criada, mas o home não"; exit 1; }
echo "CRIADO=${o.nome}"
# O meu-bot na mesa, como a conta nova (git das ferramentas de linha de comando; sem elas o /usr/bin/git abriria o instalador).
install -d -m 700 -o "${o.nome}" -g staff "/Users/${o.nome}/Desktop"
if xcode-select -p >/dev/null 2>&1 && [ ! -e "/Users/${o.nome}/Desktop/meu-bot" ]; then
  if sudo -u "${o.nome}" -H git clone -q '${repo}' "/Users/${o.nome}/Desktop/meu-bot" >/dev/null 2>&1; then echo "REPO=ok"; else echo "REPO=falhou"; fi
else echo "REPO=sem-git"; fi`;
}

/**
 * Apaga a conta e o home. Primeiro o sysadminctl -deleteUser; se a conta continuar (ele falha, por exemplo, numa conta
 * cujo home nunca foi criado), o registro sai com dscl . -delete e o home, se existir e for da conta, com rm.
 * Quem chama já conferiu protegidaPorque. Imprime `APAGADO=<nome>` ou `ERRO=<o que o macOS disse>`.
 */
export function apagarMacSh(nome: string): string {
  if (!NOME_USUARIO_RE.test(nome) || RESERVADOS_MAC.has(nome)) throw new Error("nome inválido");
  return `set -u
dscl . -read "/Users/${nome}" >/dev/null 2>&1 || { echo "ERRO=a conta ${nome} não existe"; exit 1; }
UID_C=$(dscl . -read "/Users/${nome}" UniqueID 2>/dev/null | awk '{print $2}')
SYS=$(sysadminctl -deleteUser "${nome}" 2>&1 | tail -1)
if dscl . -read "/Users/${nome}" >/dev/null 2>&1; then
  DS=$(dscl . -delete "/Users/${nome}" 2>&1 | tail -1)
  if dscl . -read "/Users/${nome}" >/dev/null 2>&1; then echo "ERRO=o macOS não apagou a conta (sysadminctl: \${SYS:-sem resposta}; dscl: \${DS:-sem resposta})" | tr -d '\\r'; exit 1; fi
fi
H="/Users/${nome}"
if [ -d "$H" ] && [ -n "$UID_C" ] && [ "$(stat -f %u "$H")" = "$UID_C" ]; then rm -rf "$H"; fi
echo "APAGADO=${nome}"`;
}

/** Nome completo (RealName). Imprime `APELIDO=ok`. */
export function apelidoMacSh(nome: string, apelido: string): string {
  const a = apelido.trim();
  if (!NOME_USUARIO_RE.test(nome)) throw new Error("nome inválido");
  if (a === "" || a.length > 60 || !/^[\p{L}\p{N} ._-]+$/u.test(a)) throw new Error("apelido: letras, números, espaço, ponto ou hífen (até 60)");
  return `dscl . -create "/Users/${nome}" RealName '${a}' && echo "APELIDO=ok"`;
}

/** ERRO=… da saída vira exceção; sem a marca de sucesso, a frase `falha`. */
export function saidaMac(out: string, ok: RegExp, falha: string): void {
  const erro = /^ERRO=(.*)$/m.exec(out)?.[1];
  if (erro !== undefined) throw new Error(erro);
  if (!ok.test(out)) throw new Error(falha);
}
