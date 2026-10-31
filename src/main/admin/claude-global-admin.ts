/**
 * Claude Code Global (admin): a assinatura do root servindo todos os usuários da máquina, gerida só aqui. Instala o
 * intermediário (installClaudeGlobal), entra na conta do root e nas contas do rodízio dele (Terminal, como a adoção
 * de conta em support-admin.ts), liga ou desliga o global por usuário e mostra quem está usando. Tudo como root pela
 * janela do admin; os scripts estão em claude-global-core.ts.
 */
import { spawn } from "node:child_process";
import type { CgEstado } from "../../shared/ipc";
import { CG_CONTA_NOVA_SH, CG_ESTADO_SH, cgContaEditarSh, cgContaRemoverSh, cgLimiaresSh, cgContaUsarAgoraSh, cgDesligarSh, cgLigarSh, lerEstado } from "./claude-global-core";
import { NOME_USUARIO_RE } from "./usuarios-core";
import { installClaudeGlobal } from "../maquina/hostProbe";
import { runSsh } from "../whatsapp/whatsapp";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/backend";

const ultimaLinha = (s: string): string => s.trim().split("\n").pop() ?? "";

export async function estadoClaudeGlobal(host: string): Promise<CgEstado> {
  const r = await runSsh(host, `${CG_ESTADO_SH}\n`, 90_000);
  if (/^NAOROOT$/m.test(r.stdout)) throw new Error("o Claude Code Global é do root: abra o admin pela conta root desta máquina");
  const e = lerEstado(r.stdout);
  if (e === null) throw new Error(`não consegui ler o Claude Code Global: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  return e;
}

/** Instala ou atualiza o intermediário (idempotente). */
export async function instalarClaudeGlobal(host: string): Promise<CgEstado> {
  const r = await installClaudeGlobal(host);
  if (!r.ok) throw new Error(`não consegui instalar o Claude Code Global: ${r.erro ?? "?"}`);
  log(`[claude-global] ${host}: intermediário no ar na porta ${r.porta}${r.login ? "" : " (o root ainda não entrou no Claude Code)"}`);
  void registrar(host, "maquina.claude-global", r.email ?? "");
  return estadoClaudeGlobal(host);
}

/** Abre o login do Claude Code do root (ou de uma conta do rodízio dele) no Terminal deste Mac; a página acompanha. */
function abrirLoginNoTerminal(host: string, configDir: string | null): void {
  if (configDir !== null && !/^\/root\/\.local\/share\/meu-bot\/contas-claude\/c-[a-f0-9]{8}\/home$/.test(configDir)) throw new Error("pasta de conta inválida");
  const env = configDir === null ? "" : `export CLAUDE_CONFIG_DIR=${configDir}; `;
  const cmd = `ssh -t ${host} '${env}export PATH=$HOME/.local/bin:$PATH; claude auth login'`;
  spawn("osascript", ["-e", `tell application "Terminal" to do script "${cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, "-e", 'tell application "Terminal" to activate'], { stdio: "ignore" })
    .on("error", () => { /* sem Terminal: a página segue mostrando "sem login" */ });
}
export async function entrarClaudeGlobal(host: string): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(host)) throw new Error("máquina inválida");
  abrirLoginNoTerminal(host, null);
  log(`[claude-global] ${host}: login do root aberto no Terminal`);
}

/** Conta nova no rodízio do root: cria a pasta e abre o login dela no Terminal. */
export async function contaNovaClaudeGlobal(host: string): Promise<CgEstado> {
  if (!/^[A-Za-z0-9._-]+$/.test(host)) throw new Error("máquina inválida");
  const r = await runSsh(host, `${CG_CONTA_NOVA_SH}\n`, 30_000);
  const m = /^CONTA=(c-[a-f0-9]{8}) (\S+)$/m.exec(r.stdout);
  if (m === null) throw new Error(`não consegui criar a conta: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  abrirLoginNoTerminal(host, m[2]!);
  void registrar(host, "maquina.claude-global-conta", m[1]!);
  return estadoClaudeGlobal(host);
}
export async function contaRemoverClaudeGlobal(host: string, id: unknown): Promise<CgEstado> {
  const r = await runSsh(host, `${cgContaRemoverSh(String(id))}\n`, 30_000);
  if (!/^REMOVIDA=ok$/m.test(r.stdout)) throw new Error(`não consegui remover a conta: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout)}`);
  return estadoClaudeGlobal(host);
}
export async function contaUsarAgoraClaudeGlobal(host: string, id: unknown): Promise<CgEstado> {
  const r = await runSsh(host, `${cgContaUsarAgoraSh(String(id))}\n`, 30_000);
  if (!/^USAR=ok$/m.test(r.stdout)) throw new Error(`não consegui liberar a conta: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout)}`);
  return estadoClaudeGlobal(host);
}

/** Ordem, ligar/desligar ou conferir uma conta do rodízio do root (os controles do tutorial 2). */
export async function contaEditarClaudeGlobal(host: string, p: unknown): Promise<CgEstado> {
  const r = await runSsh(host, `${cgContaEditarSh((p ?? {}) as { ordem?: unknown; id?: unknown; ativa?: unknown; conferir?: unknown })}\n`, 60_000);
  if (!/^CONTA=ok$/m.test(r.stdout)) throw new Error(`não consegui mudar a conta: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout)}`);
  return estadoClaudeGlobal(host);
}

/** Limiares do rodízio do root: sessão %, semana % e qual conta vai primeiro. */
export async function limiaresClaudeGlobal(host: string, t: unknown): Promise<CgEstado> {
  const r = await runSsh(host, `${cgLimiaresSh((t ?? {}) as { sessao?: unknown; semanal?: unknown; estrategia?: unknown })}\n`, 30_000);
  if (!/^LIMIARES=ok$/m.test(r.stdout)) throw new Error(`não consegui gravar os limiares: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout)}`);
  return estadoClaudeGlobal(host);
}

/** Liga ou desliga o global para um usuário (gera ou revoga a chave dele). */
export async function usuarioClaudeGlobal(host: string, nome: unknown, ligado: unknown): Promise<CgEstado> {
  await ligarClaudeGlobalPara(host, nome, ligado === true);
  return estadoClaudeGlobal(host);
}
/** Também usado pelo onboarding da criação de usuário. */
export async function ligarClaudeGlobalPara(host: string, nome: unknown, ligar: boolean): Promise<void> {
  if (typeof nome !== "string" || !NOME_USUARIO_RE.test(nome)) throw new Error("nome de usuário inválido");
  const r = await runSsh(host, `${ligar ? cgLigarSh(nome) : cgDesligarSh(nome)}\n`, 30_000);
  const erro = /^ERRO=(.*)$/m.exec(r.stdout)?.[1];
  if (erro !== undefined) throw new Error(erro);
  if (!new RegExp(`^GLOBAL=${ligar ? "ok" : "desligado"}$`, "m").test(r.stdout)) throw new Error(`não consegui ${ligar ? "ligar" : "desligar"} o global para ${nome}: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout)}`);
  log(`[claude-global] ${host}: global ${ligar ? "ligado" : "desligado"} para ${nome}`);
  void registrar(host, ligar ? "usuarios.claude-global-ligar" : "usuarios.claude-global-desligar", nome);
}
