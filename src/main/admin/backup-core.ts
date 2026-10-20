/**
 * Backup completo e mudança de máquina (meu-bot-admin), a parte pura: o manifesto que o meu-bot-backup.sh grava,
 * o índice dos backups no Mac do admin, a leitura do "conferir" do destino e a decisão de restaurar. Testado.
 *
 * O pacote (.mbbak) é o .tar.gz do meu-bot-backup.sh cifrado com age para o destinatário de backup do super admin:
 * qualquer admin gera, só o super admin abre. O índice guarda só o que não é segredo (manifesto sem as entradas).
 */

export interface BackupManifesto {
  formato: number; criadoEm: string; maquina: string; usuario: string; home: string; ultimoHashAuditoria: string;
  versoes: { openclaw: string; node: string; guarda: string; crm: boolean; transcricao: boolean; voz: boolean; statusline: boolean };
  whatsapp: boolean; arquivos: number; bytes: number;
}
export interface BackupIndice { arquivo: string; pessoa: string; alias: string; maquina: string; criadoEm: string; tamanho: number; sha256: string; por: string; manifesto: BackupManifesto }
export interface Conferencia { node: string; openclaw: string; whatsappPareado: boolean; livreMb: number; gatewayUnit: boolean; usuario: string; home: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Manifesto lido do pacote (sem a lista de entradas, que fica no pacote); null se não for um manifesto válido. */
export function parseManifesto(raw: unknown): BackupManifesto | null {
  if (!isObj(raw) || raw.formato !== 1 || !/^[0-9a-f]{12}$/.test(str(raw.maquina))) return null;
  const v = isObj(raw.versoes) ? raw.versoes : {};
  return {
    formato: 1, criadoEm: str(raw.criadoEm), maquina: str(raw.maquina), usuario: str(raw.usuario), home: str(raw.home), ultimoHashAuditoria: str(raw.ultimoHashAuditoria),
    versoes: { openclaw: str(v.openclaw), node: str(v.node), guarda: str(v.guarda), crm: v.crm === true, transcricao: v.transcricao === true, voz: v.voz === true, statusline: v.statusline === true },
    whatsapp: raw.whatsapp === true, arquivos: num(raw.arquivos), bytes: num(raw.bytes),
  };
}

/** Nome do arquivo: "<pessoa>-<AAAA-MM-DD-HHMM>-<maquina>.mbbak", só [a-z0-9-]. */
export function nomeBackup(pessoa: string, quando: Date, maquina: string): string {
  const slug = pessoa.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "pessoa";
  const d = quando.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  return `${slug}-${d}-${maquina}.mbbak`;
}

/** Saída CHAVE=valor do `conferir` → Conferencia. */
export function parseConferir(stdout: string): Conferencia {
  const kv = new Map(stdout.split("\n").map((l) => { const i = l.indexOf("="); return i > 0 ? [l.slice(0, i), l.slice(i + 1).trim()] as const : ["", ""] as const; }));
  return { node: kv.get("NODE") ?? "", openclaw: kv.get("OPENCLAW") ?? "", whatsappPareado: kv.get("WHATSAPP_PAREADO") === "1", livreMb: Number.parseInt(kv.get("LIVRE_MB") ?? "", 10) || 0, gatewayUnit: kv.get("GATEWAY_UNIT") === "1", usuario: kv.get("USUARIO") ?? "", home: kv.get("HOME") ?? "" };
}

/**
 * Pode restaurar `m` no destino `c`? Bloqueios (não dá) e avisos (dá, mas diga ao admin). O mesmo número de
 * WhatsApp já pareado ali só com "substituir"; sem Node/OpenClaw o WhatsApp não volta.
 */
export function decisaoRestaurar(m: BackupManifesto, c: Conferencia, destino: string, substituir: boolean): { bloqueios: string[]; avisos: string[] } {
  const bloqueios: string[] = [], avisos: string[] = [];
  if (destino === m.maquina) bloqueios.push("é a mesma máquina do backup: restaurar por cima dela não muda de máquina");
  if (c.home === "") bloqueios.push("a máquina de destino não respondeu ao conferir");
  const precisaMb = Math.ceil((m.bytes * 2.2) / (1024 * 1024)) + 200;
  if (c.livreMb > 0 && c.livreMb < precisaMb) bloqueios.push(`pouco espaço no destino: ${c.livreMb} MB livres, precisa de uns ${precisaMb} MB`);
  if (c.whatsappPareado && !substituir) bloqueios.push("já há um WhatsApp pareado no destino; marque \"substituir\" para trocar pelo do backup");
  if (m.whatsapp && (c.openclaw === "" || !c.gatewayUnit)) bloqueios.push("o destino não tem o OpenClaw instalado como serviço: instale o OpenClaw (e o gateway) antes de restaurar");
  if (m.whatsapp && c.openclaw !== "" && m.versoes.openclaw !== "" && c.openclaw !== m.versoes.openclaw) avisos.push(`OpenClaw ${c.openclaw} no destino e ${m.versoes.openclaw} no backup`);
  if (c.node === "") bloqueios.push("o destino não tem Node.js");
  if (c.usuario !== "" && c.usuario !== m.usuario) avisos.push(`usuário ${m.usuario} → ${c.usuario}: os caminhos são trocados na restauração`);
  return { bloqueios, avisos };
}

/** Índice no Mac do admin (userData/backups/indice.json): entradas válidas, a mais nova primeiro. */
export function parseIndice(raw: unknown): BackupIndice[] {
  if (!Array.isArray(raw)) return [];
  const out: BackupIndice[] = [];
  for (const e of raw) {
    if (!isObj(e) || !/^[a-z0-9-]+\.mbbak$/.test(str(e.arquivo))) continue;
    const m = parseManifesto(e.manifesto);
    if (m === null) continue;
    out.push({ arquivo: str(e.arquivo), pessoa: str(e.pessoa), alias: str(e.alias), maquina: m.maquina, criadoEm: str(e.criadoEm), tamanho: num(e.tamanho), sha256: str(e.sha256), por: str(e.por), manifesto: m });
  }
  return out.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}
