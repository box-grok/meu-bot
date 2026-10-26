/**
 * Linha "xAI (Grok)" em máquina sem Hermes: ela só faz sentido quando a máquina tem o backend do meu-bot
 * (o "entrar" instala o Hermes e faz o login OAuth; o Grok por chave de API foi retirado a pedido do usuário).
 */
import type { XaiKeyStatus } from "../../shared/ipc";
import { LOCAL_HOST } from "../maquina/localBackend";
import { isValidHost } from "../app/settings";
import { runSsh } from "../whatsapp/whatsapp";

import { BACKEND_DIR_SH } from "../maquina/backend-dir-core";

/** Há backend do meu-bot na máquina? */
export async function xaiKeyStatus(host: string): Promise<XaiKeyStatus> {
  if (host === LOCAL_HOST || !isValidHost(host)) return { backend: false };
  const r = await runSsh(host, `${BACKEND_DIR_SH}; [ -f "$BD/.env" ] && echo backend=1 || echo backend=0\n`, 20_000);
  if (r.code !== 0) throw new Error("não consegui ler o backend desta máquina");
  return { backend: r.stdout.includes("backend=1") };
}
