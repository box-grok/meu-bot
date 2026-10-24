/**
 * Download do zip da atualização em fluxo, direto para o disco, com retomada (como o Grok Bot): grava em
 * `<destino>.partial`, guarda ao lado (`<destino>.resume`) a URL e o validador (ETag forte ou Last-Modified) e,
 * se a conexão cair (ou ficar 30 s sem mandar nada), volta com `Range`/`If-Range` de onde parou, com espera
 * crescente entre as tentativas. No fim confere o tamanho e calcula o sha256 do arquivo inteiro. Cancelado por fora, o
 * `.partial` fica para a próxima vez. Sem Electron: testável com um servidor http falso.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";

export interface DownloadOpts {
  url: string;
  /** Arquivo final; o `.partial` e o `.resume` ficam ao lado dele. */
  destino: string;
  /** Tamanho que a release declarou (0 = não sabe). */
  tamanho?: number;
  signal?: AbortSignal;
  /** Progresso: bytes já no disco e o total (null quando o servidor não diz). */
  onProgress?: (recebido: number, total: number | null) => void;
  /** Quantas vezes insistir depois de uma queda de conexão (15 = ~15 min no pior caso). */
  tentativas?: number;
  /** Espera antes da tentativa N (1, 2…); o padrão dobra de 1 s até 60 s. */
  esperaMs?: (tentativa: number) => number;
  /** Sem nenhum byte por este tempo, a tentativa conta como queda (um download longo numa rede lenta não tem limite total). */
  stallMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}
export interface DownloadResult { sha256: string; bytes: number; retomadas: number }

/** Erro que não adianta insistir (HTTP 4xx/5xx, resposta inconsistente); o resto é queda de rede, que tenta de novo. */
export class DownloadError extends Error { name = "DownloadError"; }

const TENTATIVAS = 15;
const STALL_MS = 30_000;
const esperaPadrao = (n: number): number => Math.min(60_000, 1_000 * 2 ** (n - 1));
const parcialDe = (destino: string): string => `${destino}.partial`;
const resumeDe = (destino: string): string => `${destino}.resume`;
const abortado = (signal?: AbortSignal): boolean => signal?.aborted === true;
const erroAbortado = (): Error => Object.assign(new Error("download cancelado"), { code: "ABORTED" });

async function lerResume(destino: string, url: string): Promise<{ offset: number; validador: string } | null> {
  let txt: string;
  try { txt = await fsp.readFile(resumeDe(destino), "utf8"); } catch { return null; }
  const [u, validador, ...resto] = txt.split("\n");
  if (u !== url || validador === undefined || validador === "" || resto.length > 0) return null;
  try { const { size } = await fsp.stat(parcialDe(destino)); return size > 0 ? { offset: size, validador } : null; } catch { return null; }
}
async function limpar(destino: string): Promise<void> {
  await fsp.rm(parcialDe(destino), { force: true }).catch(() => undefined);
  await fsp.rm(resumeDe(destino), { force: true }).catch(() => undefined);
}
/** ETag forte ou Last-Modified: o que o servidor aceita em If-Range; ETag fraca (W/) não serve para Range. */
const validadorDe = (h: Headers): string | null => { const et = h.get("etag"); if (et !== null) return et.startsWith("W/") ? null : et; return h.get("last-modified"); };
const contentRange = (v: string | null): { inicio: number; total: number | null } | null => { const m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(v ?? ""); return m === null ? null : { inicio: Number(m[1]), total: m[2] === "*" ? null : Number(m[2]) }; };

/** Uma tentativa: baixa (do zero ou retomando) para o .partial; "completo" ou "caiu" (queda no meio, com o que já ficou no disco). */
async function tentativa(o: DownloadOpts, retomar: { offset: number; validador: string } | null): Promise<{ fim: "completo"; total: number | null } | { fim: "caiu"; erro: unknown }> {
  const f = o.fetchImpl ?? fetch;
  const destino = o.destino;
  // Vigia de inatividade: rearmado a cada pedaço; estourou, aborta só esta tentativa (a próxima retoma do .partial).
  const stall = new AbortController();
  let vigia: NodeJS.Timeout | null = null;
  const rearmar = (): void => { if (vigia !== null) clearTimeout(vigia); vigia = setTimeout(() => stall.abort(), o.stallMs ?? STALL_MS); };
  const signal = o.signal === undefined ? stall.signal : AbortSignal.any([o.signal, stall.signal]);
  rearmar();
  let res: Response;
  try {
    res = await f(o.url, { redirect: "follow", signal, headers: { ...(o.headers ?? {}), ...(retomar === null ? {} : { range: `bytes=${retomar.offset}-`, "if-range": retomar.validador }) } });
  } catch (e) { if (vigia !== null) clearTimeout(vigia); if (abortado(o.signal)) throw erroAbortado(); return { fim: "caiu", erro: stall.signal.aborted ? new Error("sem resposta do servidor") : e }; }
  let offset = 0; let total: number | null = null;
  if (res.status === 206) {
    const cr = contentRange(res.headers.get("content-range"));
    if (retomar === null || cr === null || cr.inicio !== retomar.offset) { await limpar(destino); throw new DownloadError("o servidor retomou de um ponto diferente do pedido"); }
    offset = retomar.offset; total = cr.total;
  } else if (res.status === 416) {
    await limpar(destino); throw new DownloadError("o servidor recusou a retomada (416)");
  } else if (!res.ok) {
    throw new DownloadError(`download falhou (${res.status})`);
  } else {
    // Resposta inteira (200): começa do zero, e guarda o validador para uma retomada futura.
    const v = validadorDe(res.headers);
    if (v === null) await fsp.rm(resumeDe(destino), { force: true }).catch(() => undefined);
    else await fsp.writeFile(resumeDe(destino), `${o.url}\n${v}`, { mode: 0o600 });
    const cl = res.headers.get("content-length");
    total = cl !== null && /^\d+$/.test(cl) ? Number(cl) : null;
  }
  if (res.body === null) throw new DownloadError("resposta sem corpo");
  const out = fs.createWriteStream(parcialDe(destino), { flags: offset > 0 ? "a" : "w", mode: 0o600 });
  let recebido = offset;
  try {
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      if (abortado(o.signal)) throw erroAbortado();
      rearmar();
      recebido += chunk.byteLength;
      if (!out.write(chunk)) await new Promise<void>((r, j) => { out.once("drain", r); out.once("error", j); });
      o.onProgress?.(recebido, total);
    }
  } catch (e) {
    if (vigia !== null) clearTimeout(vigia);
    await new Promise<void>((r) => out.end(() => r()));
    if (abortado(o.signal)) throw erroAbortado();
    return { fim: "caiu", erro: stall.signal.aborted ? new Error("a conexão parou de responder") : e };
  }
  if (vigia !== null) clearTimeout(vigia);
  await new Promise<void>((r, j) => out.end((err?: Error | null) => (err ? j(err) : r())));
  return { fim: "completo", total };
}

async function sha256De(arquivo: string): Promise<{ sha256: string; bytes: number }> {
  const h = createHash("sha256"); let bytes = 0;
  for await (const c of fs.createReadStream(arquivo)) { h.update(c as Buffer); bytes += (c as Buffer).length; }
  return { sha256: h.digest("hex"), bytes };
}

/** Baixa `url` para `destino` (via .partial), insistindo em queda de rede; resolve com o sha256 e o tamanho do arquivo final. */
export async function baixarComRetomada(o: DownloadOpts): Promise<DownloadResult> {
  const max = o.tentativas ?? TENTATIVAS; const espera = o.esperaMs ?? esperaPadrao;
  let retomadas = 0; let ultimo: unknown = null;
  // O .partial de outra URL (outra versão) não serve.
  if ((await lerResume(o.destino, o.url)) === null) await limpar(o.destino);
  for (let n = 1; n <= max; n++) {
    if (abortado(o.signal)) throw erroAbortado();
    const retomar = await lerResume(o.destino, o.url);
    if (retomar !== null && n > 1) retomadas++;
    const r = await tentativa(o, retomar);
    if (r.fim === "completo") {
      const { sha256, bytes } = await sha256De(parcialDe(o.destino));
      // O tamanho que a release declarou manda (o arquivo no servidor tem que ser aquele); sem ele, o Content-Length.
      const esperado = o.tamanho !== undefined && o.tamanho > 0 ? o.tamanho : r.total;
      if (esperado !== null && bytes !== esperado) { await limpar(o.destino); throw new DownloadError(`download incompleto (${bytes} de ${esperado} bytes)`); }
      await fsp.rename(parcialDe(o.destino), o.destino);
      await fsp.rm(resumeDe(o.destino), { force: true }).catch(() => undefined);
      return { sha256, bytes, retomadas };
    }
    ultimo = r.erro;
    if (n === max) break;
    const ms = espera(n);
    if (ms > 0) await new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); o.signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });
  }
  if (abortado(o.signal)) throw erroAbortado();
  const msg = ultimo instanceof Error ? ultimo.message : String(ultimo);
  throw Object.assign(new Error(`a conexão caiu ${max} vezes durante o download (${msg})`), { cause: ultimo });
}
