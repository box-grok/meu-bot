/**
 * Texto da verificação de atualização (Configurações → "Sobre e atualização" e o ponto da barra de cima), como no
 * Rambox: cada fase vira uma frase. Puro, testado. `now` só para "conferido há X".
 */
import type { UpdateState } from "../../shared/ipc";

export interface UpdateText { text: string; kind: "muted" | "ok" | "warn" | "bad"; showApply: boolean }

const ago = (iso: string | null, now: number): string => {
  if (iso === null) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return "";
  if (s < 60) return "conferido agora";
  if (s < 3600) return `conferido há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `conferido há ${Math.round(s / 3600)} h`;
  return `conferido há ${Math.round(s / 86_400)} d`;
};

export function updateStateText(u: UpdateState, appName: string, now: number = Date.now()): UpdateText {
  switch (u.phase) {
    case "checking": return { text: "Verificando atualizações…", kind: "muted", showApply: false };
    case "up-to-date": { const a = ago(u.checkedAt, now); return { text: `Você está na versão mais recente${a === "" ? "" : ` (${a})`}.`, kind: "ok", showApply: false }; }
    case "available": return { text: `Nova versão ${u.available ?? ""} disponível, baixando…`, kind: "warn", showApply: false };
    case "ready": return { text: `${appName} ${u.ready ?? ""} pronta para instalar.`, kind: "warn", showApply: true };
    case "error": return { text: `Não consegui verificar atualizações: ${u.error ?? "erro"}.`, kind: "bad", showApply: false };
    default: return { text: "Atualização automática só no app instalado.", kind: "muted", showApply: false };
  }
}
