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
import { spawn } from "node:child_process";
import { CONJUNTOS_DADOS, caminhoDadosNoDrive, consultaFilhos, corpoUploadBinario, pacotesDadosAApagar, type ConjuntoDados } from "./google-core";
import { sessaoDrive } from "./google";
import { registrar } from "../auditoria";
import { log } from "../tunnel";

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8", "-o", "ControlMaster=no", "-o", "ControlPath=none"];
const INTERVALO = 24 * 60 * 60_000;
/** Teto do pacote: os conjuntos têm centenas de KB; muito acima disso é sinal de que algo está errado. */
const PACOTE_MAX = 256 * 1024 * 1024;

export interface EnvioDados { conjunto: string; caminho: string; bytes: number; apagados: number }

/**
 * Empacota um conjunto na VM e traz pelo stdout do ssh. O que fica de fora está em `c.excluir`; os anexos do CRM e
 * os comprovantes do financeiro entram, porque são justamente o que se perde junto com a máquina.
 *
 * Os padrões do `--exclude` são relativos ao membro que o tar gera (`db/...`, sem `./`): com `./` na frente eles
 * não casam e o backup local entra no pacote em silêncio.
 */
async function empacotar(host: string, c: ConjuntoDados): Promise<Buffer> {
  const base = `$HOME/.local/share/meu-bot/${c.dir}`;
  const excl = c.excluir.map((e) => `--exclude=${e}`).join(" ");
  const cmd = `set -e; [ -d ${base} ] || { echo "sem ${c.dir} nesta maquina" >&2; exit 3; }; tar -czf - -C "$(dirname ${base})" ${excl} "$(basename ${base})"`;
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

/** Sobe um conjunto e apaga os pacotes anteriores daquela pasta. Devolve null quando não há o que fazer. */
async function enviarConjunto(host: string, c: ConjuntoDados): Promise<EnvioDados | null> {
  const s = await sessaoDrive();
  if (s === null) return null; // Google não conectado neste Mac: nada a fazer, sem barulho.
  const pacote = await empacotar(host, c);
  const { pastas, arquivo } = caminhoDadosNoDrive(host, c, Date.now());
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
    for (const id of pacotesDadosAApagar(Array.isArray(lista["files"]) ? (lista["files"] as { id?: unknown; name?: unknown }[]) : [], idNovo, c.prefixo)) {
      try { await s.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE" }); apagados += 1; }
      catch (e) { log(`[dados-drive] não consegui apagar um pacote antigo de ${c.id}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  const caminho = [...pastas, arquivo].join(" / ");
  log(`[dados-drive] ${c.id} de ${host} no Drive: ${caminho} (${pacote.length} bytes; ${apagados} antigo(s) apagado(s))`);
  return { conjunto: c.id, caminho, bytes: pacote.length, apagados };
}

/**
 * Envia todos os conjuntos de uma máquina. Um conjunto que falhe não impede o outro: são cópias independentes, e
 * meia cópia é melhor que nenhuma. Devolve o que subiu e os erros, para quem chama registrar.
 */
export async function enviarDadosAoDrive(host: string): Promise<{ enviados: EnvioDados[]; erros: string[] }> {
  const enviados: EnvioDados[] = []; const erros: string[] = [];
  for (const c of CONJUNTOS_DADOS) {
    try { const r = await enviarConjunto(host, c); if (r !== null) enviados.push(r); }
    catch (e) { erros.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  // A pessoa vê no registro da máquina dela que uma cópia saiu, e para onde.
  if (enviados.length > 0) void registrar(host, "backup.dados-drive", enviados.map((e) => e.conjunto).join(", "));
  return { enviados, erros };
}

const agendados = new Map<string, ReturnType<typeof setInterval>>();
/** Uma vez por máquina (quando a extensão do CRM sobe): 2 min depois e a cada 24 h. */
export function agendarDadosAoDrive(host: string, ligado: () => boolean): void {
  if (agendados.has(host)) return;
  const rodar = (): void => {
    if (!ligado()) return;
    void enviarDadosAoDrive(host).then(
      ({ erros }) => { for (const e of erros) log(`[dados-drive] ${host}: ${e}`); },
      // Máquina inacessível ou Google sem Drive: registra e espera o próximo ciclo, sem repetir em laço.
      (e: unknown) => { log(`[dados-drive] ${host} falhou: ${e instanceof Error ? e.message : String(e)}`); },
    );
  };
  setTimeout(rodar, 2 * 60_000).unref();
  const i = setInterval(rodar, INTERVALO); i.unref(); agendados.set(host, i);
}
export function pararDadosAoDrive(host: string): void { const i = agendados.get(host); if (i) clearInterval(i); agendados.delete(host); }
