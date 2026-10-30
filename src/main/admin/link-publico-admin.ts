/**
 * Link Público Global (admin): cada usuário da máquina com um link `https://<nome>.<domínio>/` atrás de um Cloudflare
 * Tunnel do root, gerido só aqui (aba abaixo do Claude Code Global). Instala nginx e cloudflared, abre o login do root
 * na Cloudflare (o link abre no navegador deste Mac; a página confirma sozinha quando o cert chega), cria o túnel e a
 * rota curinga, liga ou desliga o link por usuário, e publica ou tira do ar um item no link de um usuário, sempre como
 * ele (o `publicar` dele, via runuser: o arquivo nasce dono dele). Tudo como root pela janela do admin; os scripts
 * estão em link-publico-core.ts.
 */
import { app, dialog, shell, type BrowserWindow } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LpAviso, LpEstado } from "../../shared/ipc";
import { ARQUIVO_STAGE_RE, ITEM_LINK_RE, LP_ESTADO_SH, LP_ETC, LP_LOGIN_SH, LP_MAX_BYTES, lerAgentes, lerEstadoLp, lerLinkOk, lpAtualizarAgentesSh, lpDesligarSh, lpInstalarSh, lpLigarSh, lpPublicarSh, lpRemoverSh, lpStageSh, lpTunelSh, nomeNoLinkDe } from "./link-publico-core";
import { NOME_USUARIO_RE } from "./usuarios-core";
import { runSsh, scpPara } from "../whatsapp/whatsapp";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/backend";

const ultimaLinha = (s: string): string => s.trim().split("\n").pop() ?? "";
const erroDe = (r: { stdout: string; stderr: string }): string | undefined => /^ERRO=(.*)$/m.exec(r.stdout)?.[1];
const usuarioOk = (nome: unknown): string => { if (typeof nome !== "string" || !NOME_USUARIO_RE.test(nome)) throw new Error("nome de usuário inválido"); return nome; };

export async function estadoLinkPublico(host: string): Promise<LpEstado> {
  const r = await runSsh(host, `${LP_ESTADO_SH}\n`, 60_000);
  if (/^NAOROOT$/m.test(r.stdout)) throw new Error("o Link Público Global é do root: abra o admin pela conta root desta máquina");
  const e = lerEstadoLp(r.stdout);
  if (e === null) throw new Error(`não consegui ler o Link Público Global: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  return e;
}

/**
 * Instala ou atualiza nginx, cloudflared, o site, os modelos e os comandos (idempotente), com o domínio dos links, e
 * refaz a skill e o CLAUDE.md de quem já tem o link ligado (senão quem já estava ligado ficava com a skill velha).
 */
export async function instalarLinkPublico(host: string, dominio: unknown): Promise<LpEstado> {
  if (typeof dominio !== "string") throw new Error("domínio inválido");
  const r = await runSsh(host, `${lpInstalarSh(dominio.trim().toLowerCase())}\n`, 5 * 60_000);
  const erro = erroDe(r);
  if (erro !== undefined) throw new Error(erro);
  if (!/^INSTALADO=ok$/m.test(r.stdout)) throw new Error(`não consegui instalar o Link Público Global: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  log(`[link-publico] ${host}: nginx e cloudflared instalados para ${dominio}`);
  void registrar(host, "maquina.link-publico", dominio.trim().toLowerCase());
  try {
    const a = await runSsh(host, `${lpAtualizarAgentesSh()}\n`, 120_000);
    const ea = erroDe(a);
    if (ea !== undefined) log(`[link-publico] ${host}: agentes não atualizados: ${ea}`);
    else {
      const ag = lerAgentes(a.stdout);
      log(`[link-publico] ${host}: skill e CLAUDE.md refeitos para ${ag.length === 0 ? "ninguém (nenhum link ligado)" : ag.map((x) => x.avisos.length > 0 ? `${x.usuario} (${x.avisos.join(", ")})` : x.usuario).join(", ")}`);
    }
  } catch (e) { log(`[link-publico] ${host}: agentes não atualizados: ${e instanceof Error ? e.message : String(e)}`); }
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

/** Liga ou desliga o link de um usuário; `avisos` = o que o ligar pulou (conta sem Hermes ou sem agent-workspace). */
export async function usuarioLinkPublico(host: string, nome: unknown, ligado: unknown): Promise<{ estado: LpEstado; avisos: LpAviso[] }> {
  const avisos = await ligarLinkPublicoPara(host, nome, ligado === true);
  return { estado: await estadoLinkPublico(host), avisos };
}
/** Também usado pelo onboarding da criação de usuário (quando o link global está instalado, a conta já nasce com o dela). Devolve o que o ligar pulou. */
export async function ligarLinkPublicoPara(host: string, nome: unknown, ligar: boolean): Promise<LpAviso[]> {
  const n = usuarioOk(nome);
  const r = await runSsh(host, `${ligar ? lpLigarSh(n) : lpDesligarSh(n)}\n`, 60_000);
  const erro = erroDe(r);
  if (erro !== undefined) throw new Error(erro);
  if (!ligar) {
    if (!/^LINK=desligado/m.test(r.stdout)) throw new Error(`não consegui desligar o link de ${n}: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout)}`);
    log(`[link-publico] ${host}: link desligado para ${n}`);
    void registrar(host, "usuarios.link-publico-desligar", n);
    return [];
  }
  const ok = lerLinkOk(r.stdout);
  if (ok === null) throw new Error(`não consegui ligar o link de ${n}: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout)}`);
  log(`[link-publico] ${host}: link ligado para ${n}${ok.avisos.length > 0 ? ` (${ok.avisos.join(", ")})` : ""}`);
  void registrar(host, "usuarios.link-publico-ligar", n, ok.avisos.join(" "));
  return ok.avisos;
}

/** Tira um item do ar no link do usuário, como ele (`publicar --remover`); nunca um rm do root. */
export async function removerLinkPublico(host: string, nome: unknown, item: unknown): Promise<LpEstado> {
  const n = usuarioOk(nome);
  if (typeof item !== "string" || !ITEM_LINK_RE.test(item)) throw new Error("nome de item inválido");
  const r = await runSsh(host, `${lpRemoverSh(n, item)}\n`, 60_000);
  const erro = erroDe(r);
  if (erro !== undefined) throw new Error(erro);
  if (!/^REMOVIDO=/m.test(r.stdout)) throw new Error(`não consegui tirar ${item} do ar: ${ultimaLinha(r.stderr) || ultimaLinha(r.stdout) || "sem resposta"}`);
  log(`[link-publico] ${host}: ${item} fora do ar no link de ${n}`);
  void registrar(host, "usuarios.link-publico-remover", n, item);
  return estadoLinkPublico(host);
}

/**
 * Escolhe um arquivo neste Mac (diálogo do main: o renderer nunca manda caminho) e publica no link do usuário, como
 * ele: scp para uma pasta de passagem do root em /tmp, depois `publicar` via runuser (um .md vira página; o arquivo
 * nasce dono dele, na cota dele), e a passagem some. `url` null = a pessoa cancelou o diálogo.
 */
export async function publicarLinkPublico(host: string, nome: unknown, win: BrowserWindow | null): Promise<{ estado: LpEstado; url: string | null }> {
  const n = usuarioOk(nome);
  const opts: Electron.OpenDialogOptions = { title: `Publicar no link de ${n}`, buttonLabel: "Publicar", properties: ["openFile"], defaultPath: app.getPath("documents") };
  const escolha = win === null ? await dialog.showOpenDialog(opts) : await dialog.showOpenDialog(win, opts);
  const local = escolha.filePaths[0];
  if (escolha.canceled || local === undefined) return { estado: await estadoLinkPublico(host), url: null };
  const st = await fs.promises.stat(local);
  if (st.isDirectory()) throw new Error("por enquanto o admin publica um arquivo por vez; uma pasta inteira, peça ao agente dele (`publicar pasta/ nome`)");
  if (!st.isFile()) throw new Error("isso não é um arquivo");
  if (st.size > LP_MAX_BYTES) throw new Error("arquivo com mais de 100 MB: a Cloudflare não entrega arquivos maiores que isso pelo túnel");
  const ext = path.extname(local).toLowerCase();
  const arquivo = `arquivo${/^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ""}`;
  if (!ARQUIVO_STAGE_RE.test(arquivo)) throw new Error("extensão de arquivo inválida");
  const nomeNoLink = nomeNoLinkDe(path.basename(local)) ?? arquivo;
  const stage = `/tmp/meu-bot-publicar-${randomBytes(6).toString("hex")}`;
  const s = await runSsh(host, `${lpStageSh(stage)}\n`, 20_000);
  const es = erroDe(s);
  if (es !== undefined) throw new Error(es);
  if (!/^STAGE=ok$/m.test(s.stdout)) throw new Error(`não consegui preparar a máquina para receber o arquivo: ${ultimaLinha(s.stderr) || ultimaLinha(s.stdout) || "sem resposta"}`);
  let passagemApagada = false;
  try {
    const up = await scpPara(host, local, `${stage}/${arquivo}`, 10 * 60_000);
    if (up.code !== 0) throw new Error(`não consegui enviar o arquivo para a máquina: ${ultimaLinha(up.stderr) || "scp falhou"}`);
    const p = await runSsh(host, `${lpPublicarSh(n, stage, arquivo, nomeNoLink)}\n`, 120_000);
    passagemApagada = true; // o script apaga a passagem nos dois caminhos (deu certo ou não)
    const ep = erroDe(p);
    if (ep !== undefined) throw new Error(ep);
    const url = /^PUBLICADO=(https:\/\/\S+)$/m.exec(p.stdout)?.[1];
    if (url === undefined) throw new Error(`não consegui publicar: ${ultimaLinha(p.stderr) || ultimaLinha(p.stdout) || "sem resposta"}`);
    log(`[link-publico] ${host}: ${path.basename(local)} publicado no link de ${n}: ${url}`);
    void registrar(host, "usuarios.link-publico-publicar", n, url);
    return { estado: await estadoLinkPublico(host), url };
  } finally {
    if (!passagemApagada) void runSsh(host, `rm -rf '${stage}'\n`, 20_000).catch(() => undefined);
  }
}

/** O Link Público Global está instalado nesta máquina? (o onboarding liga o link da conta nova quando sim). */
export async function linkPublicoInstalado(host: string): Promise<boolean> {
  const r = await runSsh(host, `[ -f ${LP_ETC}/config.json ] && echo LP=1 || echo LP=0\n`, 20_000);
  return /^LP=1$/m.test(r.stdout);
}
