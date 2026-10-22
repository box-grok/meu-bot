/**
 * Autenticador (vem com todo meu-bot). Acha o QR de verificação em duas etapas numa captura da aba (bitmap BGRA do
 * NativeImage, a ordem do macOS) e devolve o otpauth:// dele. Puro: testado com QR gerado pelo `qrcode`.
 */
import jsQR from "jsqr";

/** Passa BGRA → RGBA (o jsQR lê RGBA; a luminância pesa os canais de forma diferente). */
export function bgraParaRgba(bgra: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i + 3 < bgra.length; i += 4) { out[i] = bgra[i + 2]!; out[i + 1] = bgra[i + 1]!; out[i + 2] = bgra[i]!; out[i + 3] = bgra[i + 3]!; }
  return out;
}
export type ResultadoQr = { tipo: "otpauth"; uri: string } | { tipo: "outro" } | { tipo: "nenhum" };
/** Lê o QR do bitmap. Só um QR por leitura (o jsQR acha o mais evidente); um QR que não é otpauth:// vira "outro". */
export function lerOtpauth(bgra: Uint8Array, largura: number, altura: number): ResultadoQr {
  if (largura <= 0 || altura <= 0 || bgra.length < largura * altura * 4) return { tipo: "nenhum" };
  const r = jsQR(bgraParaRgba(bgra), largura, altura, { inversionAttempts: "attemptBoth" });
  if (r === null) return { tipo: "nenhum" };
  return /^otpauth:\/\//i.test(r.data.trim()) ? { tipo: "otpauth", uri: r.data.trim() } : { tipo: "outro" };
}
