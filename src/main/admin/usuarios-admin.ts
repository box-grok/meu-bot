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
import { RECURSOS_PADRAO, usuarioComChavesSh, lingerSh, aliasDoUsuario, blocoSshUsuario, candidatosAoSeletor, configTemHost, removerBlocoUsuario, semChaveDesteMac, apelidoSh, apelidoValido, swapLigarSh, recursosSh, apagarItemSh, caminhoDentro, lerMaiores, maioresSh, apagarSh, COTA_LIGAR_SH, limiteKbDe, limiteSh, LISTAR_SH, lerUsuarios, NOME_USUARIO_RE, PROTEGIDOS, RESERVADOS } from "./usuarios-core";
import { runSsh } from "../whatsapp/whatsapp";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/backend";
import { adicionarUsuario, esquecerUsuario, pessoasPorMaquina, usuariosNoSeletor } from "./support-admin";
import { refreshPickerIfOpen } from "../maquina/picker";

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
  return { usuarios: l.usuarios, hostname: a?.hostname ?? null, port: a?.port ?? null, chave: a?.arquivo ?? null, discoKb: l.discoKb, cota: l.cota, ram: l.ram };
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
  // Sai dos dois seletores também (sem SSH na conta que não existe mais).
  try { tirarDoSshConfig(host, n); } catch (e) { log(`[usuarios] ${host}: ${n} ficou no ~/.ssh/config: ${e instanceof Error ? e.message : String(e)}`); }
  if (await esquecerUsuario(host, n).catch(() => false)) refreshPickerIfOpen();
  return usuariosDaMaquina(host);
}

/** Cria um usuário comum (sem sudo, shell bash, home própria) com a chave SSH deste Mac. Devolve a lista nova. */
export async function criarUsuario(host: string, nome: unknown, pct: unknown = 0): Promise<UsuariosVisao> {
  if (typeof nome !== "string" || !NOME_USUARIO_RE.test(nome)) throw new Error("nome inválido: use minúsculas, números, - ou _, começando por letra (2 a 32)");
  if (RESERVADOS.has(nome)) throw new Error(`"${nome}" é um nome reservado do sistema; escolha outro`);
  const { chave } = await acessoDesteMac(host);
  const r = await runSsh(host, `${usuarioComChavesSh(nome, [chave], "erro")}\n`, 60_000);
  const erro = /^ERRO=(.*)$/m.exec(r.stdout)?.[1];
  if (erro !== undefined) throw new Error(erro);
  if (!/^CRIADO=/m.test(r.stdout)) throw new Error(`não consegui criar o usuário: ${(r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "sem resposta"}`);
  log(`[usuarios] ${host}: criou o usuário ${nome}`);
  void registrar(host, "usuarios.criar", nome);
  // Nasce sempre ligado (o agente dele não morre quando ele sai da máquina); falhar aqui também só avisa no log.
  const lg = await runSsh(host, `${lingerSh(nome)}\n`, 30_000).catch(() => null);
  if (lg === null || !/^LINGER=ok$/m.test(lg.stdout)) log(`[usuarios] ${host}: ${nome} criado sem linger`);
  // Nasce com os tetos padrão de RAM e CPU (falhar aqui não desfaz o usuário: avisa no log e segue).
  const rec = await runSsh(host, `${recursosSh(nome, RECURSOS_PADRAO.ramMb, RECURSOS_PADRAO.cpuPct)}\n`, 30_000).catch(() => null);
  if (rec === null || !/^RECURSOS=ok$/m.test(rec.stdout)) log(`[usuarios] ${host}: ${nome} criado sem os tetos padrão`);
  // Já entra nos dois seletores (meu-bot e admin); falhar aqui não desfaz o usuário: a resposta avisa.
  const sel = await porNosSeletores(host, nome).catch((e: unknown) => ({ alias: aliasNoMeuBot(host, nome).alias, novo: false, aviso: e instanceof Error ? e.message : String(e) }));
  // Com limite pedido na criação: grava já (liga a cota na primeira vez).
  const v = typeof pct === "number" && pct > 0 ? await definirLimite(host, nome, pct) : await usuariosDaMaquina(host);
  return { ...v, seletores: { alias: sel.alias, aviso: sel.aviso } };
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

/** Tetos de RAM (MB) e CPU (% de um núcleo) do usuário; 0 = sem teto. Recusa quem tem sudo (como o limite de disco). */
export async function definirRecursos(host: string, nome: unknown, ramMb: unknown, cpuPct: unknown): Promise<UsuariosVisao> {
  const n = nomeValido(nome);
  const v = await usuariosDaMaquina(host);
  const u = v.usuarios.find((x) => x.nome === n);
  if (u === undefined) throw new Error(`não existe o usuário ${n}`);
  if (u.sudo) throw new Error(`${n} tem sudo: os tetos valem para usuários comuns`);
  const sh = recursosSh(n, typeof ramMb === "number" ? ramMb : Number.NaN, typeof cpuPct === "number" ? cpuPct : Number.NaN);
  const r = await runSsh(host, `${sh}\n`, 30_000);
  saida(r.stdout, /^RECURSOS=ok$/m, "não consegui gravar os limites");
  log(`[usuarios] ${host}: tetos de ${n}: RAM ${ramMb} MB, CPU ${cpuPct}%`);
  void registrar(host, "usuarios.recursos", n, `RAM ${ramMb === 0 ? "sem teto" : `${ramMb} MB`}, CPU ${cpuPct === 0 ? "sem teto" : `${cpuPct}%`}`);
  return usuariosDaMaquina(host);
}

/** Liga 8 GB de swap na máquina (só se ela não tem nenhuma). */
export async function ligarSwap(host: string): Promise<UsuariosVisao> {
  await usuariosDaMaquina(host); // confere root
  const r = await runSsh(host, `${swapLigarSh(8)}\n`, 300_000);
  saida(r.stdout, /^SWAP=ok$/m, `não consegui ligar a swap: ${(r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "sem resposta"}`);
  log(`[usuarios] ${host}: swap de 8 GB ligada`);
  void registrar(host, "maquina.swap", "8 GB");
  return usuariosDaMaquina(host);
}

/** Apelido do usuário (nome de exibição); login e pasta não mudam. Vazio tira o apelido. */
export async function definirApelido(host: string, nome: unknown, apelido: unknown): Promise<UsuariosVisao> {
  const n = nomeValido(nome); const a = apelidoValido(apelido);
  const r = await runSsh(host, `${apelidoSh(n, a)}\n`, 30_000);
  saida(r.stdout, /^APELIDO=ok$/m, "não consegui gravar o apelido");
  void registrar(host, "usuarios.apelido", n, a);
  return usuariosDaMaquina(host);
}

/** Liga o linger: o agente do usuário segue rodando quando ele sai da máquina e volta sozinho ao reiniciar. */
export async function manterLigado(host: string, nome: unknown): Promise<UsuariosVisao> {
  const n = nomeValido(nome);
  const r = await runSsh(host, `${lingerSh(n)}\n`, 30_000);
  saida(r.stdout, /^LINGER=ok$/m, `não consegui deixar ${n} sempre ligado`);
  void registrar(host, "usuarios.ligado", n);
  return usuariosDaMaquina(host);
}

/** O nome do usuário no seletor do meu-bot: `<máquina>-<usuário>`, pela máquina como o admin a chama. */
const aliasNoMeuBot = (host: string, nome: string): { alias: string; maquina: string } => {
  const maquina = [...pessoasPorMaquina().values()].find((p) => p.alias === host)?.nome ?? host;
  return { alias: aliasDoUsuario(maquina, nome), maquina };
};
const sshConfigPath = (): string => path.join(os.homedir(), ".ssh", "config");
const lerSshConfig = (): { texto: string; existe: boolean } => { try { return { texto: fs.readFileSync(sshConfigPath(), "utf8"), existe: true }; } catch { return { texto: "", existe: false }; } };

/**
 * Põe o usuário no ~/.ssh/config deste Mac como uma máquina (`<máquina>-<usuário>`, com a chave deste Mac, que já está
 * no authorized_keys dele): o seletor do meu-bot e do staging leem o mesmo arquivo (aba Usuário). Backup antes; nunca
 * altera um Host que já existe (se existir, só devolve o nome).
 */
async function garantirNoSshConfig(host: string, n: string): Promise<{ alias: string; novo: boolean }> {
  const { alias, maquina } = aliasNoMeuBot(host, n);
  const { texto, existe } = lerSshConfig();
  if (configTemHost(texto, alias)) return { alias, novo: false };
  const a = await acessoDesteMac(host);
  const configPath = sshConfigPath();
  if (existe) fs.copyFileSync(configPath, `${configPath}.bak-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`);
  else fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const sep = existe && texto !== "" && !texto.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(configPath, `${sep}\n${blocoSshUsuario({ alias, hostname: a.hostname, port: a.port, user: n, chave: a.arquivo, maquina })}`, { mode: 0o600 });
  try { fs.chmodSync(configPath, 0o600); } catch { /* cortesia */ }
  log(`[usuarios] ${host}: ${n} entrou no ~/.ssh/config como ${alias}`);
  return { alias, novo: true };
}

/** Tira do ~/.ssh/config o bloco que o admin escreveu para o usuário (backup antes); bloco de outra origem fica. */
function tirarDoSshConfig(host: string, n: string): boolean {
  const { alias } = aliasNoMeuBot(host, n);
  const { texto, existe } = lerSshConfig();
  if (!existe) return false;
  const r = removerBlocoUsuario(texto, alias);
  if (!r.removido) return false;
  const configPath = sshConfigPath();
  fs.copyFileSync(configPath, `${configPath}.antes-de-remover-${alias}`);
  fs.writeFileSync(configPath, r.texto, { mode: 0o600 });
  log(`[usuarios] ${host}: ${n} saiu do ~/.ssh/config (${alias})`);
  return true;
}

/** O usuário nos dois seletores: o do meu-bot (~/.ssh/config) e o do admin (pessoa marcada, sem preparar a conta). */
async function porNosSeletores(host: string, n: string): Promise<{ alias: string; novo: boolean; aviso: string | null }> {
  const meuBot = await garantirNoSshConfig(host, n);
  let aviso: string | null = null; let noAdmin = false;
  try { noAdmin = (await adicionarUsuario(host, meuBot.alias, n)).novo; } catch (e) { aviso = `não entrou no seletor do admin: ${e instanceof Error ? e.message : String(e)}`; }
  if (meuBot.novo || noAdmin) { void registrar(host, "usuarios.seletor", n); refreshPickerIfOpen(); }
  return { alias: meuBot.alias, novo: meuBot.novo || noAdmin, aviso };
}

/** Botão "Nos seletores" da linha (refaz o que a sincronização faz, para um usuário). */
export async function nosSeletores(host: string, nome: unknown): Promise<{ alias: string; novo: boolean; aviso: string | null }> {
  const n = nomeValido(nome);
  const v = await usuariosDaMaquina(host);
  const u = v.usuarios.find((x) => x.nome === n);
  if (u === undefined) throw new Error(`não existe o usuário ${n}`);
  if (candidatosAoSeletor([u]).length === 0) throw new Error(u.chave ? `${n} tem sudo ou é do meu-bot: não entra no seletor por aqui` : `${n} não tem a chave deste Mac: o admin não entra nele`);
  return porNosSeletores(host, n);
}

/**
 * Ao abrir a aba: os usuários comuns com a chave deste Mac que ainda faltam em algum seletor entram (um por vez; quem já
 * está nos dois não custa SSH). Sem preparar nada nas contas.
 */
export async function sincronizarSeletores(host: string): Promise<{ entraram: string[]; semChave: string[]; falhas: { nome: string; motivo: string }[] }> {
  const v = await usuariosDaMaquina(host);
  const noAdmin = usuariosNoSeletor(host);
  const { texto } = lerSshConfig();
  const entraram: string[] = []; const falhas: { nome: string; motivo: string }[] = [];
  for (const u of candidatosAoSeletor(v.usuarios)) {
    if (configTemHost(texto, aliasNoMeuBot(host, u.nome).alias) && noAdmin.has(u.nome)) continue;
    try { const r = await porNosSeletores(host, u.nome); if (r.novo) entraram.push(u.nome); if (r.aviso !== null) falhas.push({ nome: u.nome, motivo: r.aviso }); }
    catch (e) { falhas.push({ nome: u.nome, motivo: e instanceof Error ? e.message : String(e) }); }
  }
  return { entraram, semChave: semChaveDesteMac(v.usuarios), falhas };
}
