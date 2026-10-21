/**
 * Variante: admin. Backup completo da máquina de uma pessoa e a mudança para outra (regras em backup-core.ts; o que
 * entra e como volta é do backend-colima/meu-bot-backup.sh, que vai pelo SSH).
 *
 * O pacote nunca existe em texto claro no Mac: o stdout do ssh passa pela cifra age (destinatário de backup do super
 * admin, no suporte.json) direto para userData/backups/<arquivo>.mbbak; na volta, o arquivo é decifrado em stream
 * direto para o stdin do ssh. Qualquer admin gera; só o super admin (com ~/.ssh/meu-bot-backup.age) restaura.
 * Só com a permissão `backup` que a pessoa liga no meu-bot dela.
 */
import { isVozId } from "../vozes-core";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { app } from "electron";
import type { BackupIndiceView, BackupRestauracao } from "../../shared/ipc";
import { decisaoRestaurar, nomeBackup, parseConferir, parseIndice, parseManifesto, type BackupIndice } from "./backup-core";
import { adminName, backupDestinatario, isSuperAdmin, pessoasPorMaquina, readShare } from "./support-admin";
import { backendBundleDir, installBackend, installClaudeCode, installCrm, installGuarda, installAudio, installStatusLine } from "../hostProbe";
import { entregar, registrar } from "../auditoria";
import { getBackendPort } from "../settings";
import { runSsh } from "../whatsapp";
import { log } from "../backend";

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8", "-o", "ControlMaster=no", "-o", "ControlPath=none"];
const IDENTIDADE = path.join(os.homedir(), ".ssh", "meu-bot-backup.age");
const pasta = (): string => path.join(app.getPath("userData"), "backups");
const indicePath = (): string => path.join(pasta(), "indice.json");
type Age = typeof import("age-encryption");
let ageMod: Promise<Age> | null = null;
const age = (): Promise<Age> => (ageMod ??= import("age-encryption"));

let script: string | null = null;
/** O script do pacote do app, para ir na linha de comando do ssh (base64: nada de aspas nem de stdin, que é o tar). */
function remoto(op: string, ...args: string[]): string {
  script ??= fs.readFileSync(path.join(backendBundleDir(), "meu-bot-backup.sh"), "utf8");
  const b64 = Buffer.from(script, "utf8").toString("base64");
  const seguros = [op, ...args].map((a) => { if (!/^[A-Za-z0-9._-]+$/.test(a)) throw new Error(`argumento inválido: ${a}`); return a; });
  return `bash -c "$(printf %s '${b64}' | base64 -d)" meu-bot-backup ${seguros.join(" ")}`;
}

function lerIndice(): BackupIndice[] { try { return parseIndice(JSON.parse(fs.readFileSync(indicePath(), "utf8"))); } catch { return []; } }
function gravarIndice(lista: BackupIndice[]): void { fs.mkdirSync(pasta(), { recursive: true, mode: 0o700 }); fs.writeFileSync(indicePath(), JSON.stringify(lista, null, 1), { mode: 0o600 }); }

/** Pessoa conhecida por alias → id da máquina e nome. */
function pessoa(alias: string): { id: string; nome: string; on: boolean } {
  for (const [id, p] of pessoasPorMaquina()) if (p.alias === alias) return { id, nome: p.nome, on: p.on };
  throw new Error("pessoa desconhecida");
}

export function listarBackups(alias?: string): { backups: BackupIndiceView[]; podeRestaurar: boolean; podeCriar: boolean } {
  const lista = lerIndice().filter((b) => alias === undefined || b.alias === alias || b.maquina === (alias !== undefined ? safeId(alias) : ""));
  return { backups: lista.map(view), podeRestaurar: isSuperAdmin() && fs.existsSync(IDENTIDADE), podeCriar: backupDestinatario() !== "" };
}
const safeId = (alias: string): string => { try { return pessoa(alias).id; } catch { return ""; } };
const view = (b: BackupIndice): BackupIndiceView => ({ arquivo: b.arquivo, pessoa: b.pessoa, maquina: b.maquina, criadoEm: b.criadoEm, tamanho: b.tamanho, por: b.por, usuario: b.manifesto.usuario, whatsapp: b.manifesto.whatsapp, arquivos: b.manifesto.arquivos });

/** Faz o backup da máquina `alias` (com a permissão dela): ssh criar → cifra → disco. */
export async function criarBackup(alias: string, progresso?: (bytes: number) => void): Promise<BackupIndiceView> {
  const dest = backupDestinatario();
  if (dest === "") throw new Error("este meu-bot-admin não tem o destinatário de backup (rode scripts/suporte-setup.mjs e reempacote o admin)");
  const p = pessoa(alias);
  if (!p.on) throw new Error("o suporte desta pessoa está desligado");
  if (!(await readShare(alias)).backup) throw new Error("a pessoa não liberou o backup completo (Configurações › Suporte, no meu-bot dela)");
  const arquivo = nomeBackup(p.nome, new Date(), p.id);
  fs.mkdirSync(pasta(), { recursive: true, mode: 0o700 });
  const final = path.join(pasta(), arquivo); const tmp = `${final}.parcial`;
  const { Encrypter } = await age();
  const e = new Encrypter(); e.addRecipient(dest);
  const child = spawn("ssh", [...SSH_OPTS, "--", alias, remoto("criar", p.id)], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
  const fim = new Promise<number | null>((res) => child.on("close", res));
  let lidos = 0;
  child.stdout.on("data", (d: Buffer) => { lidos += d.length; progresso?.(lidos); });
  const hash = createHash("sha256"); let tamanho = 0;
  const out = fs.createWriteStream(tmp, { mode: 0o600 });
  try {
    const cifrado = await e.encrypt(Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>);
    for await (const bloco of cifrado as unknown as AsyncIterable<Uint8Array>) { hash.update(bloco); tamanho += bloco.length; if (!out.write(bloco)) await new Promise<void>((r) => out.once("drain", () => r())); }
    await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
    const code = await fim;
    if (code !== 0) throw new Error(`a máquina não gerou o backup: ${stderr.trim().split("\n").filter((l) => !l.startsWith("MANIFESTO=")).pop() ?? `código ${code}`}`);
    const linha = stderr.split("\n").find((l) => l.startsWith("MANIFESTO="));
    const manifesto = linha === undefined ? null : parseManifesto(JSON.parse(linha.slice("MANIFESTO=".length)));
    if (manifesto === null) throw new Error("a máquina não devolveu o manifesto do backup");
    fs.renameSync(tmp, final);
    const item: BackupIndice = { arquivo, pessoa: p.nome, alias, maquina: p.id, criadoEm: new Date().toISOString(), tamanho, sha256: hash.digest("hex"), por: adminName(), manifesto };
    gravarIndice([item, ...lerIndice().filter((b) => b.arquivo !== arquivo)]);
    void registrar(alias, "backup.criar", `${manifesto.arquivos} arquivos, ${Math.round(tamanho / 1048576)} MB`);
    log(`[backup] ${alias}: ${arquivo} (${tamanho} bytes cifrados, ${manifesto.arquivos} arquivos)`);
    return view(item);
  } catch (err) {
    child.kill("SIGKILL"); out.destroy(); fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Pré-voo do destino: conferência e o que impede ou pede atenção. */
export async function conferirRestauracao(arquivo: string, alias: string, substituir: boolean): Promise<BackupRestauracao> {
  const b = lerIndice().find((x) => x.arquivo === arquivo);
  if (b === undefined) throw new Error("backup desconhecido");
  const destino = pessoa(alias);
  const r = await runSsh(alias, `${remoto("conferir")}\n`, 60_000);
  const c = parseConferir(r.stdout);
  const d = decisaoRestaurar(b.manifesto, c, destino.id, substituir);
  return { ...d, podeRestaurar: isSuperAdmin() && fs.existsSync(IDENTIDADE), destinoUsuario: c.usuario, whatsappNoDestino: c.whatsappPareado };
}

/**
 * Restaura `arquivo` na máquina `alias` (só o super admin): decifra em stream para o restaurar, reinstala o que a
 * origem tinha e deixa o WhatsApp DESLIGADO no destino (a troca é trocarWhatsapp, passo à parte).
 */
export async function restaurarBackup(arquivo: string, alias: string, substituir: boolean, linha?: (l: string) => void): Promise<{ log: string[] }> {
  if (!isSuperAdmin() || !fs.existsSync(IDENTIDADE)) throw new Error("só o meu-bot-admin do super admin restaura backups");
  const pre = await conferirRestauracao(arquivo, alias, substituir);
  if (pre.bloqueios.length > 0) throw new Error(pre.bloqueios.join("; "));
  const b = lerIndice().find((x) => x.arquivo === arquivo)!;
  const linhas: string[] = []; const say = (l: string): void => { linhas.push(l); linha?.(l); };
  const caminho = path.join(pasta(), arquivo);
  const sha = createHash("sha256"); for await (const bloco of fs.createReadStream(caminho)) sha.update(bloco as Buffer);
  if (sha.digest("hex") !== b.sha256) throw new Error("o arquivo do backup não confere com o índice (corrompido ou trocado)");
  say(`decifrando e enviando ${Math.round(b.tamanho / 1048576)} MB para ${alias}…`);
  const { Decrypter } = await age();
  const d = new Decrypter(); d.addIdentity(fs.readFileSync(IDENTIDADE, "utf8").split("\n").find((l) => l.startsWith("AGE-SECRET-KEY-"))?.trim() ?? "");
  const claro = await d.decrypt(Readable.toWeb(fs.createReadStream(caminho)) as unknown as ReadableStream<Uint8Array>);
  const child = spawn("ssh", [...SSH_OPTS, "--", alias, remoto("restaurar", ...(substituir ? ["--substituir"] : []))], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (x: Buffer) => { stdout += x.toString("utf8"); });
  child.stderr.on("data", (x: Buffer) => { stderr += x.toString("utf8"); });
  const fim = new Promise<number | null>((res) => child.on("close", res));
  child.stdin.on("error", () => { /* o remoto recusou e fechou: o motivo vem no stderr */ });
  try { await new Promise<void>((res, rej) => { const src = Readable.fromWeb(claro as unknown as import("node:stream/web").ReadableStream<Uint8Array>); src.on("error", rej); child.stdin.on("finish", () => res()); src.pipe(child.stdin); }); }
  catch (e) { child.kill("SIGKILL"); throw new Error(`não consegui decifrar o backup: ${e instanceof Error ? e.message : String(e)}`); }
  const code = await fim;
  if (code !== 0 || !/RESTAURADO=ok/.test(stdout)) throw new Error(`a máquina recusou a restauração: ${stderr.trim().split("\n").pop() ?? `código ${code}`}`);
  say(`dados restaurados; o que havia ficou em ${/ANTES=(\S+)/.exec(stdout)?.[1] ?? "~/.meu-bot-antes-da-restauracao-…"}`);
  // Programas fora do $HOME copiado: reinstala pelo que o app já sabe instalar.
  const m = b.manifesto;
  const passos: [string, () => Promise<{ ok: boolean; log: string[] }>][] = [
    ["Claude Code", () => installClaudeCode(alias)],
    ["backend do meu-bot", () => installBackend(alias, getBackendPort(alias))],
    ...(m.whatsapp || m.versoes.guarda !== "" ? [["guarda do WhatsApp", () => installGuarda(alias)] as [string, () => Promise<{ ok: boolean; log: string[] }>]] : []),
    ...(m.versoes.crm ? [["CRM pelo WhatsApp", () => installCrm(alias)] as [string, () => Promise<{ ok: boolean; log: string[] }>]] : []),
    ...(m.versoes.transcricao ? [["transcrição de áudio", () => installAudio(alias, { kind: "in" })] as [string, () => Promise<{ ok: boolean; log: string[] }>]] : []),
    ...(m.versoes.statusline ? [["status line", () => installStatusLine(alias)] as [string, () => Promise<{ ok: boolean; log: string[] }>]] : []),
  ];
  for (const [nome, fn] of passos) {
    say(`instalando ${nome}…`);
    try { const r = await fn(); say(r.ok ? `✓ ${nome}` : `✗ ${nome}: ${r.log.at(-1) ?? "falhou"}`); } catch (e) { say(`✗ ${nome}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  // Voz das respostas: o modo está no openclaw.json restaurado; o motor (Piper/Kokoro) se reinstala com a mesma voz.
  if (m.versoes.voz && isVozId(m.versoes.vozid)) {
    const modo = /MODO=(inbound|always)/.exec((await runSsh(alias, `echo "MODO=$(openclaw config get tts.auto 2>/dev/null | tr -d '"')"\n`, 30_000)).stdout)?.[1] as "inbound" | "always" | undefined;
    if (modo !== undefined) {
      say(`instalando a voz das respostas (${m.versoes.vozid})…`);
      try { const r = await installAudio(alias, { kind: "out", mode: modo, voz: m.versoes.vozid }); say(r.ok ? "✓ voz das respostas" : `✗ voz das respostas: ${r.log.at(-1) ?? "falhou"}`); } catch (e) { say(`✗ voz das respostas: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  // A história continua: a primeira linha nova aponta para a máquina e o último registro da origem.
  await registrar(alias, "backup.restaurar", m.maquina, `último registro da origem: ${m.ultimoHashAuditoria || "nenhum"}; backup de ${m.criadoEm} (${arquivo})`);
  say("O WhatsApp continua DESLIGADO nesta máquina: use \"Trocar o WhatsApp para esta máquina\" quando a antiga estiver desligada.");
  log(`[backup] ${arquivo} restaurado em ${alias}`);
  return { log: linhas };
}

/**
 * A troca do WhatsApp: desliga o gateway na máquina antiga (se ela ainda está no suporte; nunca logout) e só então
 * liga na nova. `antigaDesligada`: o admin confirma que a antiga já está fora (sem suporte ou apagada).
 */
export async function trocarWhatsapp(arquivo: string, alias: string, antigaDesligada: boolean): Promise<{ log: string[] }> {
  if (!isSuperAdmin()) throw new Error("só o super admin troca o WhatsApp de máquina");
  const b = lerIndice().find((x) => x.arquivo === arquivo);
  if (b === undefined) throw new Error("backup desconhecido");
  const nova = pessoa(alias);
  const linhas: string[] = [];
  const antiga = pessoasPorMaquina().get(b.maquina);
  if (antiga !== undefined && antiga.on) {
    const r = await runSsh(antiga.alias, `${remoto("desativar-whatsapp", nova.id)}\n`, 60_000);
    if (!/WHATSAPP=desativado/.test(r.stdout)) throw new Error(`não consegui desligar o WhatsApp na máquina antiga (${r.stderr.trim().split("\n").pop() ?? "sem resposta"}); nada foi ligado na nova`);
    await registrar(antiga.alias, "backup.desativar-origem", nova.id);
    await entregar(antiga.alias);
    linhas.push(`✓ WhatsApp desligado na máquina antiga (${antiga.nome})`);
  } else if (!antigaDesligada) {
    throw new Error("a máquina antiga não está no suporte: confirme que ela está desligada (ou que o OpenClaw dela está parado) antes de ligar o WhatsApp aqui");
  } else linhas.push("• máquina antiga fora do suporte: confirmada como desligada pelo admin");
  const r = await runSsh(alias, `${remoto("ativar-whatsapp")}\n`, 60_000);
  if (!/WHATSAPP=ativo/.test(r.stdout)) throw new Error(`não consegui ligar o WhatsApp aqui: ${r.stderr.trim().split("\n").pop() ?? "sem resposta"}`);
  await registrar(alias, "backup.ativar-whatsapp");
  linhas.push("✓ WhatsApp ligado nesta máquina");
  log(`[backup] WhatsApp trocado de ${b.maquina} para ${nova.id}`);
  return { log: linhas };
}
