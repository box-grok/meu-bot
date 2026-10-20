/** Tipos do autenticador (o que o backend devolve: nunca o segredo) e a prévia de um otpauth:// lido do QR. Puro. */
export interface Conta { key: string; emissor: string; conta: string; digitos: number; periodo: number; agente: boolean; criadoEm: string }
export interface ContaCodigo extends Conta { codigo: string; restante: number }
export interface Previa { uri: string; emissor: string; conta: string }

/** Emissor e conta de um otpauth://totp/… para o formulário de confirmação; null se não for TOTP. A validação é do backend. */
export function parseOtpauth(uri: string): Previa | null {
  let u: URL; try { u = new URL(uri.trim()); } catch { return null; }
  if (u.protocol !== "otpauth:" || u.hostname.toLowerCase() !== "totp" || !u.searchParams.has("secret")) return null;
  let rotulo = u.pathname.replace(/^\//, ""); try { rotulo = decodeURIComponent(rotulo); } catch { /* fica cru */ }
  const i = rotulo.indexOf(":");
  return { uri: uri.trim(), emissor: (u.searchParams.get("issuer") ?? (i >= 0 ? rotulo.slice(0, i) : "")).trim(), conta: (i >= 0 ? rotulo.slice(i + 1) : rotulo).trim() };
}
