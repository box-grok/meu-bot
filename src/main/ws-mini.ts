/**
 * Servidor WebSocket mínimo (RFC 6455, lado servidor) para o endpoint CDP do Navegador: handshake, frames de
 * texto (com máscara do cliente, tamanhos de 7/16/64 bits, fragmentação de entrada), ping/pong e close.
 * Só o que o puppeteer precisa; sem dependência nova. Puro no codec (testável), com o socket por fora.
 */
import { createHash } from "node:crypto";
import type { Socket } from "node:net";
import type { IncomingMessage } from "node:http";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const acceptKey = (key: string): string => createHash("sha1").update(`${key.trim()}${GUID}`).digest("base64");

/** Monta um frame do servidor (sem máscara) com o texto; binário para pong/close com o código. */
export function encodeFrame(opcode: 0x1 | 0x8 | 0x9 | 0xa, payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len])
    : len < 65_536 ? Buffer.concat([Buffer.from([0x80 | opcode, 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(len); return b; })()])
      : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, payload]);
}

export interface Frame { fin: boolean; opcode: number; payload: Buffer }
/** Lê um frame do início do buffer; null se ainda não chegou inteiro. Devolve também quantos bytes consumiu. */
export function decodeFrame(buf: Buffer): { frame: Frame; used: number } | null {
  if (buf.length < 2) return null;
  const b0 = buf[0]!, b1 = buf[1]!;
  const fin = (b0 & 0x80) !== 0; const opcode = b0 & 0x0f; const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f; let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; const big = buf.readBigUInt64BE(2); if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame grande demais"); len = Number(big); off = 10; }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  let payload = buf.subarray(off + maskLen, off + maskLen + len);
  if (masked) { const mask = buf.subarray(off, off + 4); const out = Buffer.alloc(len); for (let i = 0; i < len; i += 1) out[i] = payload[i]! ^ mask[i & 3]!; payload = out; }
  return { frame: { fin, opcode, payload }, used: off + maskLen + len };
}

export interface WsConn { send(text: string): void; close(code?: number): void; onMessage(cb: (text: string) => void): void; onClose(cb: () => void): void }

/** Completa o upgrade e devolve a conexão; mensagens fragmentadas são juntadas; ping vira pong. */
export function upgrade(req: IncomingMessage, socket: Socket, head: Buffer): WsConn {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") { socket.destroy(); throw new Error("sem Sec-WebSocket-Key"); }
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  let buf: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let partial: Buffer[] = [];
  let closed = false;
  const msgCbs: ((t: string) => void)[] = []; const closeCbs: (() => void)[] = [];
  const finish = (): void => { if (closed) return; closed = true; for (const cb of closeCbs) cb(); };
  socket.setNoDelay(true);
  socket.on("data", (d: Buffer) => {
    buf = buf.length === 0 ? d : Buffer.concat([buf, d]);
    for (;;) {
      let r: { frame: Frame; used: number } | null;
      try { r = decodeFrame(buf); } catch { socket.destroy(); finish(); return; }
      if (r === null) return;
      buf = buf.subarray(r.used);
      const { fin, opcode, payload } = r.frame;
      if (opcode === 0x8) { try { socket.write(encodeFrame(0x8, payload.subarray(0, 2))); } catch { /* já fechou */ } socket.end(); finish(); return; }
      if (opcode === 0x9) { socket.write(encodeFrame(0xa, payload)); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        partial.push(payload);
        if (fin) { const text = Buffer.concat(partial).toString("utf8"); partial = []; for (const cb of msgCbs) cb(text); }
      }
    }
  });
  socket.on("close", finish); socket.on("error", finish);
  return {
    send: (text) => { if (!closed && !socket.destroyed) socket.write(encodeFrame(0x1, Buffer.from(text, "utf8"))); },
    close: (code = 1000) => { if (closed) return; const b = Buffer.alloc(2); b.writeUInt16BE(code); try { socket.write(encodeFrame(0x8, b)); } catch { /* idem */ } socket.end(); finish(); },
    onMessage: (cb) => { msgCbs.push(cb); },
    onClose: (cb) => { closeCbs.push(cb); },
  };
}
