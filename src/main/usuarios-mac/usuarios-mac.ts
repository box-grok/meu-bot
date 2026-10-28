/**
 * meu-bot-admin-mac: as contas deste Mac (I/O). A lista é lida como o usuário que abriu o app; criar, apagar e mudar o
 * apelido rodam como root uma vez cada, pela janela de senha de administrador do próprio macOS (osascript "with
 * administrator privileges"): o script vai num arquivo 0700 temporário, apagado logo depois. O núcleo puro é o
 * usuarios-mac-core.ts. Registro local (auditoria-mac.jsonl na pasta do app), nunca com a senha.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { UsuarioMacCriado, UsuariosMacVisao } from "../../shared/ipc";
import { LISTAR_MAC_SH, apagarMacSh, apelidoMacSh, criarMacSh, lerUsuariosMac, nomeNovoInvalido, saidaMac, senhaDe, uidLivre } from "./usuarios-mac-core";

function rodar(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Roda `script` como root pela janela de senha do macOS. Cancelar a janela vira o erro "cancelado". O arquivo (com o
 * que houver de sensível, como a senha nova) fica 0700 numa pasta 0700 deste usuário e some no fim, dê certo ou não.
 */
async function comoAdministrador(script: string, motivo: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meu-bot-admin-mac-"));
  const arq = path.join(dir, "acao.sh");
  try {
    fs.writeFileSync(arq, `${script}\n`, { mode: 0o700 });
    if (!/^[A-Za-z0-9/._-]+$/.test(arq)) throw new Error("caminho temporário inesperado");
    const r = await rodar("osascript", ["-e", `do shell script "/bin/bash ${arq}" with prompt "O meu-bot-admin-mac quer ${motivo}." with administrator privileges`], 5 * 60_000);
    if (r.code !== 0 && /-128|cancel/i.test(r.stderr)) throw new Error("cancelado: a senha de administrador não foi informada");
    if (r.code !== 0 && !/^ERRO=/m.test(r.stdout)) throw new Error(r.stderr.trim().split("\n").pop() || "o macOS recusou a ação");
    return r.stdout;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function registrar(acao: string, alvo: string): void {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "auditoria-mac.jsonl"), `${JSON.stringify({ em: new Date().toISOString(), quem: os.userInfo().username, acao, alvo })}\n`, { mode: 0o600 }); } catch { /* registro é cortesia */ }
}

export async function listarUsuariosMac(): Promise<UsuariosMacVisao> {
  const r = await rodar("bash", ["-c", LISTAR_MAC_SH], 30_000);
  if (r.code !== 0) throw new Error(`não consegui ler as contas deste Mac: ${r.stderr.trim().split("\n").pop() ?? "?"}`);
  return lerUsuariosMac(r.stdout);
}

/** Todas as contas (inclusive as de sistema), para o nome e o UID novos não colidirem. */
async function contasEUids(): Promise<{ nomes: string[]; uids: number[] }> {
  const r = await rodar("dscl", [".", "-list", "/Users", "UniqueID"], 20_000);
  const linhas = r.stdout.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 2);
  return { nomes: linhas.map((p) => p[0]!), uids: linhas.map((p) => Number(p[1])).filter(Number.isInteger) };
}

export async function criarUsuarioMac(nome: unknown): Promise<UsuarioMacCriado> {
  const { nomes, uids } = await contasEUids();
  const erro = nomeNovoInvalido(nome, nomes);
  if (erro !== null) throw new Error(erro);
  const n = nome as string;
  const senha = senhaDe(crypto.randomBytes(32));
  const out = await comoAdministrador(criarMacSh({ nome: n, uid: uidLivre(uids), senha }), `criar a conta ${n} (com o meu-bot na mesa)`);
  saidaMac(out, new RegExp(`^CRIADO=${n}$`, "m"), "o macOS não confirmou a conta nova");
  const repo = (/^REPO=(ok|falhou|sem-git)$/m.exec(out)?.[1] ?? "falhou") as UsuarioMacCriado["repo"];
  registrar("conta.criar", `${n} (meu-bot na mesa: ${repo})`);
  return { nome: n, senha, repo, visao: await listarUsuariosMac() };
}

export async function apagarUsuarioMac(nome: unknown): Promise<UsuariosMacVisao> {
  const v = await listarUsuariosMac();
  const u = v.usuarios.find((x) => x.nome === nome);
  if (u === undefined) throw new Error("conta não encontrada");
  if (u.protegida !== null) throw new Error(`a conta ${u.nome} não pode ser apagada daqui: ${u.protegida}`);
  const out = await comoAdministrador(apagarMacSh(u.nome), `apagar a conta ${u.nome} e tudo o que está nela`);
  saidaMac(out, new RegExp(`^APAGADO=${u.nome}$`, "m"), "o macOS não confirmou a remoção");
  registrar("conta.apagar", u.nome);
  return listarUsuariosMac();
}

export async function apelidoUsuarioMac(nome: unknown, apelido: unknown): Promise<UsuariosMacVisao> {
  const v = await listarUsuariosMac();
  const u = v.usuarios.find((x) => x.nome === nome);
  if (u === undefined) throw new Error("conta não encontrada");
  const out = await comoAdministrador(apelidoMacSh(u.nome, String(apelido ?? "")), `mudar o nome completo da conta ${u.nome}`);
  saidaMac(out, /^APELIDO=ok$/m, "o macOS não confirmou o apelido");
  registrar("conta.apelido", u.nome);
  return listarUsuariosMac();
}
