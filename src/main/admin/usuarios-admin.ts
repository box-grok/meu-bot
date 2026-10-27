/**
 * Variante: admin. Aba "Usuários" da janela de uma pessoa, abaixo de Auditoria: numa máquina em que o admin entra como
 * root, lista os usuários de login, cria usuários comuns (sem sudo) com a chave SSH deste Mac, regula o limite de disco
 * (cota, em % do disco) e apaga (nunca quem tem sudo nem os usuários do meu-bot).
 * O main acha a máquina pela janela; a tela só manda o nome, validado aqui e de novo no script.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UsuariosVisao } from "../../shared/ipc";
import { apagarItemSh, caminhoDentro, lerMaiores, maioresSh, apagarSh, COTA_LIGAR_SH, limiteKbDe, limiteSh, LISTAR_SH, lerUsuarios, NOME_USUARIO_RE, PROTEGIDOS, RESERVADOS } from "./usuarios-core";
import { runSsh } from "../whatsapp/whatsapp";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/backend";

const sshG = (host: string): Promise<string> => new Promise((resolve) => {
  execFile("ssh", ["-G", "--", host], { timeout: 10_000 }, (err, stdout) => resolve(err ? "" : stdout));
});

/** O endereço e a chave pública que este Mac usa para a máquina (a primeira IdentityFile que tem o .pub). */
async function acessoDesteMac(host: string): Promise<{ hostname: string; port: string; chave: string; arquivo: string }> {
  const g = await sshG(host);
  const hostname = /^hostname (.+)$/m.exec(g)?.[1]?.trim() ?? host;
  const port = /^port (\d+)$/m.exec(g)?.[1] ?? "22";
  const arquivos = [...g.matchAll(/^identityfile (.+)$/gm)].map((m) => (m[1] ?? "").trim().replace(/^~(?=\/)/, os.homedir()));
  for (const f of [...arquivos, path.join(os.homedir(), ".ssh/id_ed25519"), path.join(os.homedir(), ".ssh/id_rsa")]) {
    try { const pub = fs.readFileSync(`${f}.pub`, "utf8").trim(); if (/^(ssh-|ecdsa-)\S+ \S+/.test(pub)) return { hostname, port, chave: pub.split(/\s+/).slice(0, 2).join(" ") + " meu-bot-admin", arquivo: f.replace(os.homedir(), "~") }; } catch { /* próxima */ }
  }
  throw new Error("não achei a chave pública SSH deste Mac (~/.ssh/id_ed25519.pub)");
}

/** A linha "Usuários" aparece só quando o admin entra nesta máquina como root. */
export async function usuariosVisivel(host: string): Promise<boolean> {
  try { const r = await runSsh(host, `id -u\n`, 20_000); return r.code === 0 && r.stdout.trim() === "0"; } catch { return false; }
}

export async function usuariosDaMaquina(host: string): Promise<UsuariosVisao> {
  const [r, a] = await Promise.all([runSsh(host, `${LISTAR_SH}\n`, 30_000), acessoDesteMac(host).catch(() => null)]);
  if (r.code !== 0) throw new Error(`não consegui ler os usuários da máquina: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const l = lerUsuarios(r.stdout);
  if (!l.root) throw new Error("o admin não entra como root nesta máquina: só root cria usuários");
  return { usuarios: l.usuarios, hostname: a?.hostname ?? null, port: a?.port ?? null, chave: a?.arquivo ?? null, discoKb: l.discoKb, cota: l.cota };
}

const nomeValido = (nome: unknown): string => {
  if (typeof nome !== "string" || !NOME_USUARIO_RE.test(nome)) throw new Error("nome inválido: use minúsculas, números, - ou _, começando por letra (2 a 32)");
  return nome;
};
const saida = (out: string, ok: RegExp, falha: string): void => {
  const erro = /^ERRO=(.*)$/m.exec(out)?.[1];
  if (erro !== undefined) throw new Error(erro);
  if (!ok.test(out)) throw new Error(falha);
};

/** Limite de disco do usuário em % do disco principal (0 = sem limite). Liga a cota na máquina na primeira vez. */
export async function definirLimite(host: string, nome: unknown, pct: unknown): Promise<UsuariosVisao> {
  const n = nomeValido(nome);
  const p = typeof pct === "number" ? pct : Number.NaN;
  const v = await usuariosDaMaquina(host);
  if (v.discoKb === null) throw new Error("não consegui ler o tamanho do disco da máquina");
  const kb = limiteKbDe(p, v.discoKb);
  // Baixar abaixo do que já ocupa: o admin escolhe antes o que apagar (aba mostra as maiores pastas); aqui só recusa.
  const usado = v.usuarios.find((u) => u.nome === n)?.usadoKb ?? null;
  if (kb > 0 && usado !== null && usado > kb) throw new Error(`ACIMA_DO_LIMITE: ${n} já ocupa ${Math.ceil(usado / 1024)} MB, mais que os ${Math.floor(kb / 1024)} MB de ${p}%; libere espaço antes`);
  if (kb > 0 && !v.cota) {
    const c = await runSsh(host, `${COTA_LIGAR_SH}\n`, 300_000);
    saida(c.stdout, /^COTA=ok$/m, `não consegui ligar a cota de disco: ${(c.stderr.trim() || c.stdout.trim()).split("\n").pop() ?? "sem resposta"}`);
    log(`[usuarios] ${host}: cota de disco ligada`);
  }
  if (kb === 0 && !v.cota) return v; // sem cota e sem limite: nada a gravar
  const r = await runSsh(host, `${limiteSh(n, kb)}\n`, 30_000);
  saida(r.stdout, /^LIMITE=ok$/m, "não consegui gravar o limite");
  log(`[usuarios] ${host}: limite de ${n} = ${p}% (${kb} KB)`);
  void registrar(host, "usuarios.limite", n, `${p}%`);
  return usuariosDaMaquina(host);
}

/** Apaga o usuário e a pasta dele. Recusa os do meu-bot (openclaw…), quem tem sudo e os de sistema. */
export async function apagarUsuario(host: string, nome: unknown): Promise<UsuariosVisao> {
  const n = nomeValido(nome);
  if (RESERVADOS.has(n) || PROTEGIDOS.has(n)) throw new Error(`"${n}" é usado pelo sistema ou pelo meu-bot: não dá para apagar por aqui`);
  const r = await runSsh(host, `${apagarSh(n)}\n`, 60_000);
  saida(r.stdout, /^APAGADO=/m, `não consegui apagar ${n}`);
  log(`[usuarios] ${host}: apagou o usuário ${n}`);
  void registrar(host, "usuarios.apagar", n);
  return usuariosDaMaquina(host);
}

/** Cria um usuário comum (sem sudo, shell bash, home própria) com a chave SSH deste Mac. Devolve a lista nova. */
export async function criarUsuario(host: string, nome: unknown, pct: unknown = 0): Promise<UsuariosVisao> {
  if (typeof nome !== "string" || !NOME_USUARIO_RE.test(nome)) throw new Error("nome inválido: use minúsculas, números, - ou _, começando por letra (2 a 32)");
  if (RESERVADOS.has(nome)) throw new Error(`"${nome}" é um nome reservado do sistema; escolha outro`);
  const { chave } = await acessoDesteMac(host);
  const b64 = Buffer.from(chave, "utf8").toString("base64");
  const r = await runSsh(host, `set -e
[ "$(id -u)" = 0 ] || { echo "ERRO=o admin não entra como root nesta máquina"; exit 0; }
N='${nome}'
if id "$N" >/dev/null 2>&1; then echo "ERRO=já existe um usuário $N nesta máquina"; exit 0; fi
useradd -m -s /bin/bash "$N"
H=$(getent passwd "$N" | cut -d: -f6)
install -d -m 700 -o "$N" -g "$N" "$H/.ssh"
printf '%s' '${b64}' | base64 -d > "$H/.ssh/authorized_keys"; echo >> "$H/.ssh/authorized_keys"
chown "$N:$N" "$H/.ssh/authorized_keys"; chmod 600 "$H/.ssh/authorized_keys"
echo "CRIADO=$N"
`, 60_000);
  const erro = /^ERRO=(.*)$/m.exec(r.stdout)?.[1];
  if (erro !== undefined) throw new Error(erro);
  if (!/^CRIADO=/m.test(r.stdout)) throw new Error(`não consegui criar o usuário: ${(r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "sem resposta"}`);
  log(`[usuarios] ${host}: criou o usuário ${nome}`);
  void registrar(host, "usuarios.criar", nome);
  // Com limite pedido na criação: grava já (liga a cota na primeira vez).
  if (typeof pct === "number" && pct > 0) return definirLimite(host, nome, pct);
  return usuariosDaMaquina(host);
}

/** As maiores pastas e arquivos do usuário, para o admin escolher o que apagar antes de baixar o limite. */
export async function maioresDoUsuario(host: string, nome: unknown): Promise<{ home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] }> {
  const n = nomeValido(nome);
  const r = await runSsh(host, `${maioresSh(n)}\n`, 120_000);
  saida(r.stdout, /^HOME=/m, `não consegui ler a pasta de ${n}`);
  return lerMaiores(r.stdout);
}

/** Apaga um item escolhido pelo admin dentro da pasta do usuário. Devolve a lista nova das maiores. */
export async function apagarItemDoUsuario(host: string, nome: unknown, caminho: unknown): Promise<{ home: string | null; itens: { kb: number; pasta: boolean; caminho: string }[] }> {
  const n = nomeValido(nome);
  // A pasta real vem da máquina (getent); aqui só barra o óbvio, e o script confere de novo pelo caminho real.
  const home = (await maioresDoUsuario(host, n)).home;
  if (typeof caminho !== "string" || home === null || !caminhoDentro(home, caminho)) throw new Error("caminho inválido: fora da pasta do usuário");
  const b64 = Buffer.from(caminho, "utf8").toString("base64");
  const r = await runSsh(host, `${apagarItemSh(n, b64)}\n`, 120_000);
  saida(r.stdout, /^APAGADO=/m, "não consegui apagar");
  log(`[usuarios] ${host}: apagou ${caminho} de ${n}`);
  void registrar(host, "usuarios.liberar", n, caminho);
  return maioresDoUsuario(host, n);
}
