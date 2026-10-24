/**
 * Texto da verificação de atualização (Configurações → "Sobre e atualização", o ponto da barra de cima e o
 * bloqueador de versão mínima), como no Rambox: cada fase vira uma frase. Puro, testado. `now` só para "conferido há X".
 */
import type { UpdateState } from "../../shared/ipc";

export interface UpdateText {
  text: string;
  kind: "muted" | "ok" | "warn" | "bad";
  /** Mostrar "Reiniciar e atualizar". */
  showApply: boolean;
  /** Texto curto do ponto na barra de cima (null = ponto escondido). */
  short: string | null;
}

const ago = (iso: string | null, now: number): string => {
  if (iso === null) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return "";
  if (s < 60) return "conferido agora";
  if (s < 3600) return `conferido há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `conferido há ${Math.round(s / 3600)} h`;
  return `conferido há ${Math.round(s / 86_400)} d`;
};
export const pct = (p: number | null): string => (p === null ? "" : `${Math.floor(p * 100)}%`);

export function updateStateText(u: UpdateState, appName: string, now: number = Date.now()): UpdateText {
  switch (u.phase) {
    case "checking": return { text: "Verificando atualizações…", kind: "muted", showApply: false, short: "verificando atualizações…" };
    case "up-to-date": { const a = ago(u.checkedAt, now); return { text: `Você está na versão mais recente${a === "" ? "" : ` (${a})`}.`, kind: "ok", showApply: false, short: null }; }
    case "available": return { text: `Nova versão ${u.available ?? ""} disponível, baixando…`, kind: "warn", showApply: false, short: "baixando a atualização…" };
    case "downloading": { const p = pct(u.progress); return { text: `Baixando a versão ${u.available ?? ""}…${p === "" ? "" : ` ${p}`}`, kind: "warn", showApply: false, short: `baixando${p === "" ? "…" : ` ${p}`}` }; }
    case "verifying": return { text: `Conferindo a versão ${u.available ?? ""}…`, kind: "warn", showApply: false, short: "conferindo a atualização…" };
    case "ready": return { text: `${appName} ${u.ready ?? ""} pronta para instalar.`, kind: "warn", showApply: true, short: null };
    case "applying": return { text: u.aguardando ? "Esperando a resposta em andamento terminar para atualizar…" : `Instalando a versão ${u.ready ?? ""}…`, kind: "warn", showApply: false, short: u.aguardando ? "atualiza quando a resposta terminar…" : "instalando…" };
    case "needs-move": return { text: "O app está numa pasta só de leitura (ainda na imagem do instalador?). Arraste-o para a pasta Aplicativos e abra de lá.", kind: "bad", showApply: false, short: null };
    case "error": return u.errorKind === "rede" || u.error === "sem internet"
      ? { text: "Sem internet; verifico as atualizações de novo quando a conexão voltar.", kind: "warn", showApply: false, short: null }
      : { text: `Não consegui verificar atualizações: ${u.error ?? "erro"}.`, kind: "bad", showApply: false, short: null };
    default: return { text: "Atualização automática só no app instalado.", kind: "muted", showApply: false, short: null };
  }
}

/** O bloqueador "Atualização necessária" (o backend exige uma versão mais nova): título, frase e se o botão de reiniciar entra. */
export function updateBlockerText(u: UpdateState, appName: string): { title: string; text: string; showApply: boolean; showManual: boolean } {
  const min = u.minima ?? "";
  if (u.phase === "ready") return { title: "Atualização pronta", text: `Reinicie para terminar de instalar o ${appName} ${u.ready ?? ""}. Leva poucos segundos; as conversas e o WhatsApp ficam onde estavam.`, showApply: true, showManual: false };
  if (u.phase === "applying") return { title: "Atualizando…", text: u.aguardando ? "Esperando a resposta em andamento terminar." : "Reiniciando na versão nova.", showApply: false, showManual: false };
  if (u.phase === "downloading" || u.phase === "verifying" || u.phase === "available" || u.phase === "checking") return { title: "Atualização necessária", text: `Esta máquina precisa do ${appName} ${min} ou mais novo (este é o ${u.current}). ${updateStateText(u, appName).text}`, showApply: false, showManual: false };
  const motivo = u.phase === "needs-move" ? updateStateText(u, appName).text : u.phase === "error" ? updateStateText(u, appName).text : "";
  return { title: "Atualização necessária", text: `Esta máquina precisa do ${appName} ${min} ou mais novo (este é o ${u.current}).${motivo === "" ? "" : ` ${motivo}`}`, showApply: false, showManual: true };
}
