/**
 * Framing do terminal (app ⇄ pty-broker.py): tipo (1 byte) + tamanho (4 bytes big-endian) + payload.
 * Puro, sem IO; o decoder é incremental (um frame pode chegar em pedaços, ou vários num chunk só).
 */
export type FrameKind = "i" | "r" | "k" | "o" | "x";
export interface Frame { kind: FrameKind; payload: Buffer }

const KINDS = new Set<string>(["i", "r", "k", "o", "x"]);
const HEADER = 5;
/** Teto de um frame (o broker manda no máximo 64 KiB por leitura; entrada colada pode ser maior). */
export const MAX_FRAME = 4 * 1024 * 1024;

export function encodeFrame(kind: FrameKind, payload: Buffer | string = Buffer.alloc(0)): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const head = Buffer.alloc(HEADER);
  head.write(kind, 0, 1, "ascii");
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  /** Acrescenta bytes e devolve os frames completos; lança em cabeçalho inválido (o fluxo está corrompido). */
  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const out: Frame[] = [];
    while (this.buf.length >= HEADER) {
      const kind = String.fromCharCode(this.buf[0]!);
      const len = this.buf.readUInt32BE(1);
      if (!KINDS.has(kind) || len > MAX_FRAME) throw new Error(`frame inválido do broker (tipo ${JSON.stringify(kind)}, ${len} bytes)`);
      if (this.buf.length < HEADER + len) break;
      out.push({ kind: kind as FrameKind, payload: this.buf.subarray(HEADER, HEADER + len) });
      this.buf = this.buf.subarray(HEADER + len);
    }
    return out;
  }
}

/** Buffer circular da saída (para repintar a aba ao reabrir): guarda os últimos `limit` bytes. */
export class RingBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly limit: number) {}
  push(b: Buffer): void {
    this.chunks.push(b); this.size += b.length;
    while (this.size > this.limit && this.chunks.length > 1) { this.size -= this.chunks.shift()!.length; }
    if (this.size > this.limit && this.chunks.length === 1) { const only = this.chunks[0]!; this.chunks = [only.subarray(only.length - this.limit)]; this.size = this.limit; }
  }
  read(): Buffer { return Buffer.concat(this.chunks); }
}
