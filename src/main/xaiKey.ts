/**
 * Grok (xAI) por chave de API, nas máquinas sem Hermes: o backend do meu-bot já tem o provedor `grok-4`
 * apontando para api.x.ai e lendo `XAI_API_KEY` do .env dele (backend-colima/providers.json). Aqui a chave
 * entra no .env pelo SSH (só pela entrada do `bash -s`, nunca em argv nem em log), o backend reinicia e os
 * modelos que ele passa a listar voltam para a janela (o grok-4 entra no modo e no fallback).
 */
import type { XaiKeyStatus } from "../shared/ipc";
import { LOCAL_HOST } from "./localBackend";
import { getBackendPort, isValidHost } from "./settings";
import { runSsh } from "./whatsapp";
import { log } from "./backend";

const BACKEND_DIR = "$HOME/.hermes/agente-rene/backend-sdk-claude";
/** Chave da xAI: sem espaços nem aspas (vai dentro de aspas simples no script), tamanho razoável. */
const KEY_RE = /^[A-Za-z0-9._-]{16,300}$/;

const MODELS_SH = `K=$(grep '^OPENAI_COMPAT_KEY=' ${BACKEND_DIR}/.env 2>/dev/null | head -1 | cut -d= -f2-); echo "models=$(curl -s -m 8 -H "Authorization: Bearer $K" http://127.0.0.1:PORT/v1/models 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | tr '\\n' ,)"`;
const parseModels = (out: string): string[] => (/models=(.*)/.exec(out)?.[1] ?? "").split(",").map((m) => m.trim()).filter((m) => /^[a-z0-9-]+$/.test(m));

/** Há backend do meu-bot na máquina? Há XAI_API_KEY no .env dele? (sem ler o valor) */
export async function xaiKeyStatus(host: string): Promise<XaiKeyStatus> {
  if (host === LOCAL_HOST || !isValidHost(host)) return { backend: false, hasKey: false };
  const r = await runSsh(host, `[ -f ${BACKEND_DIR}/.env ] && echo backend=1 || echo backend=0\ngrep -Eq '^XAI_API_KEY=.+' ${BACKEND_DIR}/.env 2>/dev/null && echo key=1 || echo key=0\n`, 20_000);
  if (r.code !== 0) throw new Error("não consegui ler o backend desta máquina");
  return { backend: r.stdout.includes("backend=1"), hasKey: r.stdout.includes("key=1") };
}

/** Grava (ou tira, com `key === null`) a chave no .env do backend, reinicia e devolve os modelos que ele lista. */
export async function setXaiKey(host: string, key: string | null): Promise<string[]> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("por enquanto a chave da xAI vale para máquinas por SSH");
  if (key !== null && !KEY_RE.test(key)) throw new Error("isso não parece uma chave da xAI (sem espaços; cole a chave inteira)");
  const put = key === null ? "" : `printf 'XAI_API_KEY=%s\\n' '${key}' >> "$E.tmp"`;
  const script = `set -e
E=${BACKEND_DIR}/.env
[ -f "$E" ] || { echo "SEM_BACKEND"; exit 3; }
umask 077
grep -v '^XAI_API_KEY=' "$E" > "$E.tmp" || true
${put}
chmod 600 "$E.tmp"; mv "$E.tmp" "$E"
systemctl --user restart meu-bot-backend 2>/dev/null || pm2 restart hermes-mythos-lucas >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s -m 2 http://127.0.0.1:${getBackendPort()}/health >/dev/null 2>&1 && break; done
${MODELS_SH.replace("PORT", String(getBackendPort()))}
`;
  const r = await runSsh(host, script, 60_000);
  if (r.stdout.includes("SEM_BACKEND")) throw new Error("esta máquina não tem o backend do meu-bot; instale pelo seletor antes");
  if (r.code !== 0) throw new Error(`não consegui ${key === null ? "tirar" : "gravar"} a chave: ${(r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "ssh falhou"}`);
  const models = parseModels(r.stdout);
  log(`[xai] ${host}: chave ${key === null ? "removida" : "gravada"}; modelos: ${models.join(", ") || "(backend não respondeu ainda)"}`);
  return models;
}
