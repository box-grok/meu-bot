/** Rótulo com a caixa/etapa em cada linha da lista do Gmail (lote de threads por página). */
import type { InboxSDK, ThreadRowView } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import { normThreadId, threadIdValido } from "../rotas.ts";
import { corDaEtapa, textoSobre } from "../tema.ts";

export function registrarRotulos(sdk: InboxSDK, estado: Estado): void {
  let pendentes: { row: ThreadRowView; gid: string }[] = []; let agendado = false;
  const etapas = new Map<string, Map<string, number>>(); // pipelineKey → stageKey → índice
  async function indiceDaEtapa(pipelineKey: string, stageKey: string): Promise<number> {
    let m = etapas.get(pipelineKey);
    if (!m) { try { const p = await estado.pipeline(pipelineKey); m = new Map(p.stages.map((s, i) => [s.key, i])); etapas.set(pipelineKey, m); } catch { return 0; } }
    return m.get(stageKey) ?? 0;
  }
  async function processar(): Promise<void> {
    agendado = false; const lote = pendentes; pendentes = [];
    if (lote.length === 0) return;
    try {
      const hits = await estado.caixasDasThreads([...new Set(lote.map((x) => x.gid))]);
      for (const { row, gid } of lote) {
        const hit = hits.get(gid); if (!hit || row.destroyed) continue;
        const i = await indiceDaEtapa(hit.pipelineKey, hit.stageKey);
        if (!row.destroyed) row.addLabel({ title: `${hit.name} · ${hit.stage}`, backgroundColor: corDaEtapa(i), foregroundColor: textoSobre(corDaEtapa(i)), maxWidth: "140px" });
      }
    } catch { /* sem conexão: as linhas ficam sem rótulo até a próxima lista */ }
  }
  estado.assinar(({ mudancas, reset }) => { if (reset || mudancas.some((m) => m.tipo.startsWith("pipeline."))) etapas.clear(); });
  sdk.Lists.registerThreadRowViewHandler((row: ThreadRowView) => {
    void row.getThreadIDIfStableAsync().then((id) => {
      if (id === null || !threadIdValido(id) || row.destroyed) return;
      pendentes.push({ row, gid: normThreadId(id) });
      if (!agendado) { agendado = true; setTimeout(() => { void processar(); }, 80); }
    });
  });
}
