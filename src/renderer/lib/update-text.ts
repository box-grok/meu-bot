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
  /** O que o botão de aplicar diz: muda para "Parar e atualizar" quando interromper uma resposta é a escolha. */
  applyLabel: string;
  /** Mostrar "Mover para Aplicativos" (o app está numa pasta sem escrita). */
  showMove: boolean;
  /** Texto curto do ponto na barra de cima (null = ponto escondido). */
  short: string | null;
}

export const APLICAR = "Reiniciar e atualizar";
export const PARAR_E_APLICAR = "Parar e atualizar";

const ago = (iso: string | null, now: number): string => {
  if (iso === null) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return "";
  if (s < 60) return "conferido agora";
  if (s < 3600) return `conferido há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `conferido há ${Math.round(s / 3600)} h`;
  return `conferido há ${Math.round(s / 86_400)} d`;
};
const maiuscula = (t: string): string => (t === "" ? t : t.charAt(0).toUpperCase() + t.slice(1));
export const pct = (p: number | null): string => (p === null ? "" : `${Math.floor(p * 100)}%`);

export function updateStateText(u: UpdateState, appName: string, now: number = Date.now()): UpdateText {
  switch (u.phase) {
    case "checking": return { text: "Verificando atualizações…", kind: "muted", showApply: false, applyLabel: APLICAR, showMove: false, short: "verificando atualizações…" };
    case "up-to-date": { const a = ago(u.checkedAt, now); return { text: `Você está na versão mais recente${a === "" ? "" : ` (${a})`}.`, kind: "ok", showApply: false, applyLabel: APLICAR, showMove: false, short: null }; }
    case "available": return { text: `Nova versão ${u.available ?? ""} disponível, baixando…`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "baixando a atualização…" };
    case "downloading": { const p = pct(u.progress); return { text: `Baixando a versão ${u.available ?? ""}…${p === "" ? "" : ` ${p}`}`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: `baixando${p === "" ? "…" : ` ${p}`}` }; }
    case "verifying": return { text: `Conferindo a versão ${u.available ?? ""}…`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: "conferindo a atualização…" };
    case "ready": {
      // A troca foi pedida e o bot continuou respondendo: em vez de atropelar a conversa, o app devolve a escolha.
      if (u.ocupadoAoAplicar) return { text: `${appName} ${u.ready ?? ""} está pronta, mas há uma resposta em andamento. Posso esperar ela terminar, ou parar agora e atualizar.`, kind: "warn", showApply: true, applyLabel: PARAR_E_APLICAR, showMove: false, short: "atualização esperando a resposta" };
      return { text: `${appName} ${u.ready ?? ""} pronta para instalar.`, kind: "warn", showApply: true, applyLabel: APLICAR, showMove: false, short: null };
    }
    case "applying": return { text: u.aguardando ? "Esperando a resposta em andamento terminar para atualizar…" : `Instalando a versão ${u.ready ?? ""}…`, kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: u.aguardando ? "atualiza quando a resposta terminar…" : "instalando…" };
    case "needs-move": return { text: "O app está numa pasta só de leitura (ainda na imagem do instalador?). Posso copiá-lo para a pasta Aplicativos e reabrir de lá.", kind: "bad", showApply: false, applyLabel: APLICAR, showMove: true, short: null };
    case "error": {
      if (u.errorKind === "rede" || u.error === "sem internet") return { text: "Sem internet; verifico as atualizações de novo quando a conexão voltar.", kind: "warn", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
      // Disco cheio e release que não dá para instalar têm frase própria: a genérica mandaria a pessoa procurar no
      // lugar errado, e esta é justamente a situação em que o app pararia de atualizar sem ninguém notar.
      if (u.errorKind === "disco") return { text: `${maiuscula(u.error ?? "não há espaço em disco para a atualização")}. Libere espaço e eu tento de novo na próxima verificação.`, kind: "bad", showApply: false, applyLabel: APLICAR, showMove: false, short: "sem espaço para atualizar" };
      if (u.errorKind === "release") return { text: `Há uma versão nova publicada e não consegui instalá-la: ${u.error ?? "motivo desconhecido"}. A instalada continua funcionando.`, kind: "bad", showApply: false, applyLabel: APLICAR, showMove: false, short: "atualização publicada com problema" };
      return { text: `Não consegui verificar atualizações: ${u.error ?? "erro"}.`, kind: "bad", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
    }
    default: return { text: "Atualização automática só no app instalado.", kind: "muted", showApply: false, applyLabel: APLICAR, showMove: false, short: null };
  }
}

/** O bloqueador "Atualização necessária" (o backend exige uma versão mais nova): título, frase e se o botão de reiniciar entra. */
export function updateBlockerText(u: UpdateState, appName: string): { title: string; text: string; showApply: boolean; applyLabel: string; showMove: boolean; showManual: boolean } {
  const min = u.minima ?? "";
  if (u.phase === "ready") {
    const t = updateStateText(u, appName);
    if (u.ocupadoAoAplicar) return { title: "Atualização pronta", text: t.text, showApply: true, applyLabel: t.applyLabel, showMove: false, showManual: false };
    return { title: "Atualização pronta", text: `Reinicie para terminar de instalar o ${appName} ${u.ready ?? ""}. Leva poucos segundos; as conversas e o WhatsApp ficam onde estavam.`, showApply: true, applyLabel: APLICAR, showMove: false, showManual: false };
  }
  if (u.phase === "applying") return { title: "Atualizando…", text: u.aguardando ? "Esperando a resposta em andamento terminar." : "Reiniciando na versão nova.", showApply: false, applyLabel: APLICAR, showMove: false, showManual: false };
  if (u.phase === "downloading" || u.phase === "verifying" || u.phase === "available" || u.phase === "checking") return { title: "Atualização necessária", text: `Esta máquina precisa do ${appName} ${min} ou mais novo (este é o ${u.current}). ${updateStateText(u, appName).text}`, showApply: false, applyLabel: APLICAR, showMove: false, showManual: false };
  const motivo = u.phase === "needs-move" ? updateStateText(u, appName).text : u.phase === "error" ? updateStateText(u, appName).text : "";
  // Com o backend exigindo uma versão nova e o app numa pasta sem escrita, mover é o ÚNICO caminho para destravar:
  // o botão tem de estar aqui também, senão esta tela só sabe mandar a pessoa baixar à mão.
  return { title: "Atualização necessária", text: `Esta máquina precisa do ${appName} ${min} ou mais novo (este é o ${u.current}).${motivo === "" ? "" : ` ${motivo}`}`, showApply: false, applyLabel: APLICAR, showMove: u.phase === "needs-move", showManual: true };
}
