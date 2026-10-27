/**
 * Variante: admin. Aba "Usuários" da janela de uma pessoa, abaixo de Auditoria: numa máquina em que o admin entra como
 * root, lista os usuários de login e cria usuários comuns (sem sudo), com a chave SSH deste Mac no authorized_keys.
 * O main acha a máquina pela janela; a tela só manda o nome, validado aqui e de novo no script.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UsuariosVisao } from "../../shared/ipc";
import { LISTAR_SH, lerUsuarios, NOME_USUARIO_RE, RESERVADOS } from "./usuarios-core";
import { runSsh } from "../whatsapp/whatsapp";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/backend";

const sshG = (host: string): Promise<string> => new Promise((resolve) => {
  execFile("ssh", ["-G", "--", host], { timeout: 10_000 }, (err, stdout) => resolve(err ? "" : stdout));
});

/** O endereço e a chave pública que este Mac usa para a máquina (a primeira IdentityFile que tem o .pub). */
async function acessoDesteMac(host: string): Promise<{ hostname: string; port: string; chave: string }> {
  const g = await sshG(host);
  const hostname = /^hostname (.+)$/m.exec(g)?.[1]?.trim() ?? host;
  const port = /^port (\d+)$/m.exec(g)?.[1] ?? "22";
  const arquivos = [...g.matchAll(/^identityfile (.+)$/gm)].map((m) => (m[1] ?? "").trim().replace(/^~(?=\/)/, os.homedir()));
  for (const f of [...arquivos, path.join(os.homedir(), ".ssh/id_ed25519"), path.join(os.homedir(), ".ssh/id_rsa")]) {
    try { const pub = fs.readFileSync(`${f}.pub`, "utf8").trim(); if (/^(ssh-|ecdsa-)\S+ \S+/.test(pub)) return { hostname, port, chave: pub.split(/\s+/).slice(0, 2).join(" ") + " meu-bot-admin" }; } catch { /* próxima */ }
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
  return { usuarios: l.usuarios, hostname: a?.hostname ?? null, port: a?.port ?? null };
}

/** Cria um usuário comum (sem sudo, shell bash, home própria) com a chave SSH deste Mac. Devolve a lista nova. */
export async function criarUsuario(host: string, nome: unknown): Promise<UsuariosVisao> {
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
  return usuariosDaMaquina(host);
}
