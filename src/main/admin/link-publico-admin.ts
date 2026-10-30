/**
 * Link Público Global (admin): cada usuário da máquina com um link `https://<nome>.<domínio>/` atrás de um Cloudflare
 * Tunnel do root, gerido só aqui (aba abaixo do Claude Code Global). Instala nginx e cloudflared, abre o login do root
 * na Cloudflare (o link abre no navegador deste Mac; a página confirma sozinha quando o cert chega), cria o túnel e a
 * rota curinga, e liga ou desliga o link por usuário. Tudo como root pela janela do admin; os scripts estão em
 * link-publico-core.ts.
 */
import { shell } from "electron";
import type { LpEstado } from "../../shared/ipc";
import { LP_ESTADO_SH, LP_ETC, LP_LOGIN_SH, lerEstadoLp, lpDesligarSh, lpInstalarSh, lpLigarSh, lpTunelSh } from "./link-publico-core";
import { NOME_USUARIO_RE } from "./usuarios-core";
import { runSsh } from "../whatsapp/whatsapp";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/backend";

const ultimaLinha = (s: string): string => s.trim().split("\n").pop() ?? "";
const erroDe = (r: { stdout: string; stderr: string }): string | undefined => /^ERRO=(.*)$/m.exec(r.stdout)?.[1];

export async function estadoLinkPublico(host: string): Promise<LpEstado> {
  const r = await runSsh(host, `${LP_ESTADO_SH}\n`, 60_000);
  if (/^NAOROOT$/m.test(r.stdout)) throw new Error("o Link Público Global é do root: abra o admin pela conta root desta máquina");
  const e = lerEstadoLp(r.stdout);
  if (e === null) throw new Error(`não consegui ler o Link Público Global: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  return e;
}

/** Instala ou atualiza nginx, cloudflared, o site e os comandos (idempotente), com o domínio dos links. */
export async function instalarLinkPublico(host: string, dominio: unknown): Promise<LpEstado> {
  if (typeof dominio !== "string") throw new Error("domínio inválido");
  const r = await runSsh(host, `${lpInstalarSh(dominio.trim().toLowerCase())}\n`, 5 * 60_000);
  const erro = erroDe(r);
  if (erro !== undefined) throw new Error(erro);
  if (!/^INSTALADO=ok$/m.test(r.stdout)) throw new Error(`não consegui instalar o Link Público Global: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  log(`[link-publico] ${host}: nginx e cloudflared instalados para ${dominio}`);
  void registrar(host, "maquina.link-publico", dominio.trim().toLowerCase());
  return estadoLinkPublico(host);
}

/** Abre o login do root na Cloudflare: o cloudflared fica esperando na máquina; o link abre no navegador deste Mac. */
export async function entrarLinkPublico(host: string): Promise<{ url: string }> {
  const r = await runSsh(host, `${LP_LOGIN_SH}\n`, 60_000);
  const erro = erroDe(r);
  if (erro !== undefined) throw new Error(erro);
  const url = /^URL=(https:\/\/dash\.cloudflare\.com\/\S+)$/m.exec(r.stdout)?.[1];
  if (url === undefined) throw new Error(`não consegui abrir o login na Cloudflare: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  void shell.openExternal(url).catch(() => { /* a página mostra o link para copiar */ });
  log(`[link-publico] ${host}: login do root na Cloudflare aberto`);
  return { url };
}

/** Com o root logado: cria o túnel, aponta `*.<domínio>` para ele e sobe o serviço. */
export async function tunelLinkPublico(host: string): Promise<LpEstado> {
  const e = await estadoLinkPublico(host);
  if (e.dominio === null) throw new Error("instale o Link Público Global antes (o domínio vem de lá)");
  const r = await runSsh(host, `${lpTunelSh(e.dominio)}\n`, 3 * 60_000);
  const erro = erroDe(r);
  if (erro !== undefined) throw new Error(erro);
  const id = /^TUNEL=ok (\S+)$/m.exec(r.stdout)?.[1];
  if (id === undefined) throw new Error(`não consegui subir o túnel: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  log(`[link-publico] ${host}: túnel ${id} no ar para *.${e.dominio}`);
  void registrar(host, "maquina.link-publico-tunel", id);
  return estadoLinkPublico(host);
}

/** Liga ou desliga o link de um usuário. */
export async function usuarioLinkPublico(host: string, nome: unknown, ligado: unknown): Promise<LpEstado> {
  await ligarLinkPublicoPara(host, nome, ligado === true);
  return estadoLinkPublico(host);
}
/** Também usado pelo onboarding da criação de usuário (quando o link global está instalado, a conta já nasce com o dela). */
export async function ligarLinkPublicoPara(host: string, nome: unknown, ligar: boolean): Promise<void> {
  if (typeof nome !== "string" || !NOME_USUARIO_RE.test(nome)) throw new Error("nome de usuário inválido");
  const r = await runSsh(host, `${ligar ? lpLigarSh(nome) : lpDesligarSh(nome)}\n`, 60_000);
  const erro = erroDe(r);
  if (erro !== undefined) throw new Error(erro);
  if (!new RegExp(`^LINK=${ligar ? "ok" : "desligado"}`, "m").test(r.stdout)) throw new Error(`não consegui ${ligar ? "ligar" : "desligar"} o link de ${nome}: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout)}`);
  log(`[link-publico] ${host}: link ${ligar ? "ligado" : "desligado"} para ${nome}`);
  void registrar(host, ligar ? "usuarios.link-publico-ligar" : "usuarios.link-publico-desligar", nome);
}

/** O Link Público Global está instalado nesta máquina? (o onboarding liga o link da conta nova quando sim). */
export async function linkPublicoInstalado(host: string): Promise<boolean> {
  const r = await runSsh(host, `[ -f ${LP_ETC}/config.json ] && echo LP=1 || echo LP=0\n`, 20_000);
  return /^LP=1$/m.test(r.stdout);
}
