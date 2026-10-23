/**
 * CRM próprio da máquina (liberado pela licença: Pro ou superior, ou produto meu-bot-crm) pelo túnel (o mesmo caminho de whatsapp-crm.ts): os pipelines, qual é o
 * padrão do WhatsApp (sem ele nada é anotado), criar um pipeline e escolher o padrão. Tutorial 10, passo
 * "Criar o primeiro pipeline". A validação final é da máquina (crm-modelo.js › novoPipeline).
 */
import type { CrmCaixaEscolha, CrmLocal } from "../shared/ipc";
import { ensureTunnel } from "./tunnel";
import { getBackendPort } from "./settings";
import { log } from "./backend";

async function api(host: string, method: "GET" | "POST" | "PUT", rota: string, body?: unknown): Promise<Record<string, unknown>> {
  const t = await ensureTunnel(host, getBackendPort(host));
  const r = await fetch(`http://127.0.0.1:${t.localPort}/v1/crm${rota}`, {
    method,
    headers: { authorization: `Bearer ${t.apiKey}`, "content-type": "application/json", "x-crm-por": "app" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message ?? `o CRM respondeu ${r.status}`);
  return j;
}

/** Pipelines do CRM desta máquina e o padrão do WhatsApp (null = nenhum: as conversas não são anotadas). */
export async function crmLocal(host: string): Promise<CrmLocal> {
  const [ps, cfg] = await Promise.all([api(host, "GET", "/pipelines"), api(host, "GET", "/config")]);
  const lista = Array.isArray(ps.pipelines) ? ps.pipelines : [];
  const pipelines = lista.flatMap((p) => {
    const o = p as { key?: unknown; name?: unknown; boxes?: unknown };
    return typeof o.key === "string" && typeof o.name === "string" ? [{ key: o.key, name: o.name, boxes: typeof o.boxes === "number" ? o.boxes : 0 }] : [];
  });
  const padrao = typeof cfg.pipelineKey === "string" && pipelines.some((p) => p.key === cfg.pipelineKey) ? cfg.pipelineKey : null;
  return { pipelines, padrao };
}

/** Caixas para oferecer quando o dono liga um grupo do WhatsApp a uma caixa (as mais ativas primeiro). */
export async function crmCaixas(host: string, limite = 30): Promise<CrmCaixaEscolha[]> {
  const j = await api(host, "GET", `/boxes?limit=${Math.min(100, Math.max(1, Math.trunc(limite)))}`);
  const lista = Array.isArray(j.boxes) ? j.boxes : [];
  return lista.flatMap((b) => {
    const o = b as { key?: unknown; name?: unknown; pipelineName?: unknown };
    if (typeof o.key !== "string" || typeof o.name !== "string") return [];
    return [{ key: o.key, nome: o.name, pipeline: typeof o.pipelineName === "string" && o.pipelineName !== "" ? o.pipelineName : null }];
  });
}

/** Cria um pipeline; o único do CRM vira o padrão sozinho (crm-api.js › pipelinePadrao). Devolve o estado novo. */
export async function crmCriarPipeline(host: string, name: string, stages: readonly string[]): Promise<CrmLocal> {
  await api(host, "POST", "/pipelines", { name, stages });
  let estado = await crmLocal(host);
  // Vários pipelines e nenhum padrão: o que acabou de nascer passa a ser o do WhatsApp.
  if (estado.padrao === null) {
    const novo = estado.pipelines.find((p) => p.name === name);
    if (novo !== undefined) estado = await crmDefinirPadrao(host, novo.key);
  }
  log(`crm: pipeline "${name}" criado em ${host} (${stages.length} etapas); padrão do WhatsApp: ${estado.padrao ?? "nenhum"}`);
  return estado;
}

/** O pipeline do WhatsApp (onde as conversas são anotadas). */
export async function crmDefinirPadrao(host: string, key: string): Promise<CrmLocal> {
  await api(host, "PUT", "/config", { pipelineKey: key });
  return crmLocal(host);
}
