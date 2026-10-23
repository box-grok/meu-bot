/**
 * Cópia diária dos dados da máquina no Drive do dono (CRM e financeiro), para ninguém ficar preso a uma VM.
 *
 * A VM já guarda 7 cópias diárias locais de cada conjunto (`db/backup/<data>`, em crm-store.js e finance-store.js):
 * aquilo resolve "o dado estragou". Esta cópia resolve "a máquina morreu", e por isso mora fora dela. Quem envia é
 * o Mac, com o token de Contatos do CRM e escopo `drive.file` (o app só enxerga o que ele mesmo criou): a VM não
 * ganha credencial nenhuma, o que importa porque é lá que o agente atende terceiros pelo WhatsApp.
 *
 * Retenção de uma cópia só por conjunto, escolha do dono. Cada conjunto tem pasta e prefixo próprios no Drive, para
 * zerar o financeiro não encostar no CRM. A ordem é sempre **subir e só então apagar o anterior**: com uma cópia
 * só, apagar primeiro deixaria o dono sem nada se o upload falhasse.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { CONJUNTOS_DADOS, caminhoDadosNoDrive, consultaFilhos, corpoUploadBinario, pacoteDadosRe, pacotesDadosAApagar, type ConjuntoDados } from "./google-core";
import { sessaoDriveCom, type SessaoDrive } from "./google";
import { acessoValido, contaStatus } from "./conta-google";
import { lerSenhaBackup } from "./senha-backup";
import { cifrarPacote } from "./backup-cifra";
import { gravar } from "./comum";
import { registrar } from "../auditoria";
import { log } from "../tunnel";

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8", "-o", "ControlMaster=no", "-o", "ControlPath=none"];
const INTERVALO = 24 * 60 * 60_000;
/** Teto do pacote. O maior conjunto medido (transcripts do agente) dá ~37 MB; muito acima disso é erro. */
const PACOTE_MAX = 512 * 1024 * 1024;


export interface EnvioDados { conjunto: string; caminho: string; bytes: number; apagados: number; local: string }

/**
 * Pasta da cópia local, uma por máquina, em Documentos (alcançável pela pessoa, ao contrário do userData).
 * A cópia local é gravada **antes** do envio: se o Drive falhar, ainda sobra um pacote fora da VM.
 */
export const pastaBackupDados = (host: string): string => path.join(app.getPath("documents"), "meu-bot", "backup", host.replace(/[^\w.-]/g, "_"));
/** Grava o pacote e apaga os anteriores do mesmo conjunto: a mesma retenção de uma cópia só do Drive. */
function gravarLocal(host: string, c: ConjuntoDados, arquivo: string, pacote: Buffer): string {
  const dir = pastaBackupDados(host);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destino = path.join(dir, arquivo);
  gravar(destino, pacote);
  const re = pacoteDadosRe(c.prefixo, host);
  for (const f of fs.readdirSync(dir)) { if (f !== arquivo && re.test(f)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* fica para a próxima */ } } }
  return destino;
}

/**
 * Empacota um conjunto na VM e traz pelo stdout do ssh. O que fica de fora está em `c.excluir`; os anexos do CRM e
 * os comprovantes do financeiro entram, porque são justamente o que se perde junto com a máquina.
 *
 * Os padrões do `--exclude` são relativos ao membro que o tar gera (`db/...`, sem `./`): com `./` na frente eles
 * não casam e o backup local entra no pacote em silêncio.
 */
async function empacotar(host: string, c: ConjuntoDados): Promise<Buffer> {
  // Lista só o que existe: uma VM pode não ter `.hermes` ou `.config/gh`, e o tar falharia inteiro por um ausente.
  const alvos = c.dirs.map((d) => `'${d.replace(/'/g, "'\\''")}'`).join(" ");
  const excl = c.excluir.map((e) => `--exclude='${e.replace(/'/g, "'\\''")}'`).join(" ");
  const cmd = `set -e; cd "$HOME"; A=""; for p in ${alvos}; do [ -e "$p" ] && A="$A $p"; done; ` +
    `[ -n "$A" ] || { echo "nada de ${c.id} nesta maquina" >&2; exit 3; }; tar -czf - ${excl} $A`;
  const filho = spawn("ssh", [...SSH_OPTS, "--", host, cmd], { stdio: ["ignore", "pipe", "pipe"] });
  const partes: Buffer[] = [];
  let bytes = 0; let estourou = false;
  filho.stdout.on("data", (d: Buffer) => {
    bytes += d.length;
    if (bytes > PACOTE_MAX) { estourou = true; filho.kill(); return; }
    partes.push(d);
  });
  let erro = "";
  filho.stderr.on("data", (d: Buffer) => { erro += d.toString("utf8"); });
  const code = await new Promise<number | null>((res) => filho.on("close", res));
  if (estourou) throw new Error(`o pacote de ${c.id} passou de ${Math.round(PACOTE_MAX / 1024 / 1024)} MB`);
  if (code !== 0) throw new Error(`a máquina não empacotou ${c.id}: ${erro.trim().split("\n").pop() ?? `código ${code}`}`);
  const pacote = Buffer.concat(partes);
  if (pacote.length === 0) throw new Error(`a máquina devolveu um pacote vazio de ${c.id}`);
  return pacote;
}

/**
 * Sobe um conjunto e apaga os pacotes anteriores daquela pasta. `null` = pulado de propósito (conjunto cifrado sem
 * senha definida): nunca cai no caminho de subir em texto claro, nem "só desta vez".
 */
async function enviarConjunto(s: SessaoDrive, host: string, c: ConjuntoDados): Promise<EnvioDados | null> {
  const senha = c.cifrar === true ? lerSenhaBackup() : null;
  if (c.cifrar === true && senha === null) return null;
  const cru = await empacotar(host, c);
  const pacote = senha === null ? cru : await cifrarPacote(cru, senha);
  const { pastas, arquivo } = caminhoDadosNoDrive(host, c, Date.now());
  const local = gravarLocal(host, c, arquivo, pacote);
  const pai = await s.pasta(pastas);
  const fronteira = `meu-bot-${Date.now().toString(36)}`;
  const up = await s.api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${fronteira}` },
    body: corpoUploadBinario({ name: arquivo, parents: [pai], mimeType: "application/gzip" }, pacote, fronteira, "application/gzip"),
  });
  const idNovo = typeof up["id"] === "string" ? up["id"] : "";
  // Só agora o anterior sai: com uma cópia só, apagar antes de ter a nova no ar deixaria o dono sem nada.
  let apagados = 0;
  if (idNovo !== "") {
    const lista = await s.api(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: consultaFilhos(pai), fields: "files(id,name)", spaces: "drive", pageSize: "100" })}`);
    for (const id of pacotesDadosAApagar(Array.isArray(lista["files"]) ? (lista["files"] as { id?: unknown; name?: unknown }[]) : [], idNovo, c.prefixo, host)) {
      try { await s.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE" }); apagados += 1; }
      catch (e) { log(`[dados-drive] não consegui apagar um pacote antigo de ${c.id}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  const caminho = [...pastas, arquivo].join(" / ");
  log(`[dados-drive] ${c.id} de ${host} no Drive: ${caminho} (${pacote.length} bytes; ${apagados} antigo(s) apagado(s); cópia local em ${local})`);
  return { conjunto: c.id, caminho, bytes: pacote.length, apagados, local };
}

/** Última cópia de cada máquina, para a aba Conta Google mostrar sem precisar falar com o Drive. */
export interface EstadoDadosDrive { ultimaEm: string | null; conta: string | null; enviados: EnvioDados[]; erro: string | null }
const ARQ_ESTADO = (): string => path.join(app.getPath("userData"), "dados-drive.json");
const VAZIO: EstadoDadosDrive = { ultimaEm: null, conta: null, enviados: [], erro: null };
const lerEstadoTodos = (): Record<string, EstadoDadosDrive> => { try { return JSON.parse(fs.readFileSync(ARQ_ESTADO(), "utf8")) as Record<string, EstadoDadosDrive>; } catch { return {}; } };
export const estadoDadosDrive = (host: string): EstadoDadosDrive => ({ ...VAZIO, ...lerEstadoTodos()[host] });
function gravarEstado(host: string, e: EstadoDadosDrive): void {
  try { gravar(ARQ_ESTADO(), JSON.stringify({ ...lerEstadoTodos(), [host]: e }, null, 1)); } catch { /* o estado é só para a tela */ }
}

/**
 * Envia todos os conjuntos de uma máquina para o Drive da Conta Google do dono. Um conjunto que falhe não impede o
 * outro: são cópias independentes, e meia cópia é melhor que nenhuma. Guarda o resultado para a tela mostrar.
 */
export async function enviarDadosAoDrive(host: string): Promise<EstadoDadosDrive> {
  const st = contaStatus();
  if (!st.conectado) { const e = { ...VAZIO, erro: "a Conta Google não está conectada neste Mac" }; gravarEstado(host, e); return e; }
  if (st.precisaReconectar) {
    const e = { ...VAZIO, conta: st.perfil?.email ?? null, erro: "falta a permissão do Drive: clique em Reconectar na aba Conta Google" };
    gravarEstado(host, e); return e;
  }
  const s = sessaoDriveCom(await acessoValido());
  const enviados: EnvioDados[] = []; const erros: string[] = [];
  const pulados: string[] = [];
  for (const c of CONJUNTOS_DADOS) {
    try { const r = await enviarConjunto(s, host, c); if (r === null) pulados.push(c.nome); else enviados.push(r); }
    catch (e) { erros.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (pulados.length > 0) erros.push(`${pulados.join(" e ")}: sem senha de backup definida, não subiu (credencial nunca vai sem cifra)`);
  const estado: EstadoDadosDrive = { ultimaEm: enviados.length > 0 ? new Date().toISOString() : null, conta: st.perfil?.email ?? null, enviados, erro: erros.length > 0 ? erros.join("; ") : null };
  gravarEstado(host, estado);
  // A pessoa vê no registro da máquina dela que uma cópia saiu, e para onde.
  if (enviados.length > 0) void registrar(host, "backup.dados-drive", enviados.map((e) => e.conjunto).join(", "));
  return estado;
}

const agendados = new Map<string, ReturnType<typeof setInterval>>();
/** Uma vez por máquina (quando a extensão do CRM sobe): 2 min depois e a cada 24 h. */
export function agendarDadosAoDrive(host: string, ligado: () => boolean): void {
  if (agendados.has(host)) return;
  const rodar = (): void => {
    if (!ligado()) return;
    void enviarDadosAoDrive(host).then(
      ({ erro }) => { if (erro !== null) log(`[dados-drive] ${host}: ${erro}`); },
      // Máquina inacessível ou token recusado: registra e espera o próximo ciclo, sem repetir em laço.
      (e: unknown) => { log(`[dados-drive] ${host} falhou: ${e instanceof Error ? e.message : String(e)}`); },
    );
  };
  setTimeout(rodar, 2 * 60_000).unref();
  const i = setInterval(rodar, INTERVALO); i.unref(); agendados.set(host, i);
}
export function pararDadosAoDrive(host: string): void { const i = agendados.get(host); if (i) clearInterval(i); agendados.delete(host); }
