/**
 * Variante: admin. Textos e linhas da página "Suporte" do meu-bot-admin e do seletor de pessoas, sem DOM.
 * Puro: testável com node --test. O desenho fica em admin/suporte-page.ts e admin/picker-chrome.ts.
 */
import type { AdminAction, AdminHealth, SupportPerson, SupportProgress } from "../../shared/ipc";

export const ADMIN_ACTIONS: readonly { id: AdminAction; label: string; confirm: string }[] = [
  { id: "restart-gateway", label: "Reiniciar o gateway do OpenClaw", confirm: "Confirmar? o WhatsApp dela cai por ~1 min" },
  { id: "restart-backend", label: "Reiniciar o backend do meu-bot", confirm: "Confirmar? conversas em andamento caem" },
  { id: "transcription", label: "Ativar a transcrição de áudio", confirm: "Confirmar? baixa ~500 MB na máquina dela" },
];

/** Uma linha da lista de saúde/progresso: ✓ (ok), ✗ (bad) ou • (null). */
export interface HealthLine { text: string; ok: boolean | null; step?: string }

export function healthLines(h: AdminHealth, fmtPhone: (digits: string | null) => string): HealthLine[] {
  const p = h.probe;
  const lines: HealthLine[] = [
    { text: p.reachable ? `entra por SSH (${p.user ?? "?"} · ${p.os ?? "?"})` : `não entra por SSH: ${p.error ?? "sem detalhes"}`, ok: p.reachable },
    { text: p.backendListening ? "backend do meu-bot no ar" : p.backendInstalled ? "backend instalado mas parado" : "sem o backend do meu-bot", ok: p.backendListening },
    { text: p.claudeLoggedIn ? "Claude Code logado" : "Claude Code deslogado", ok: p.claudeLoggedIn },
    { text: p.statusLine ? "status line instalada" : "sem status line", ok: p.statusLine },
  ];
  const wa = h.whatsapp;
  if (wa !== null && wa.present) {
    lines.push({ text: wa.connected ? `WhatsApp conectado${wa.number !== null ? ` (${fmtPhone(wa.number)})` : ""}` : `WhatsApp: ${wa.detail}`, ok: wa.connected });
    if (wa.dmPolicy !== null) lines.push({ text: `responde: ${wa.dmPolicy === "open" ? "todo mundo" : wa.dmPolicy === "allowlist" ? "só a dona do número" : wa.dmPolicy}`, ok: null });
    if (wa.audioIn !== undefined) lines.push({ text: wa.audioIn ? "entende áudios" : "não entende áudios (sem transcrição)", ok: wa.audioIn });
    if (wa.audioOut !== undefined) lines.push({ text: `responde em áudio: ${wa.audioOut === "inbound" ? "quando recebe áudio" : wa.audioOut === "always" ? "sempre" : "nunca"}`, ok: null });
  }
  return lines;
}

export function progressLines(prog: SupportProgress): HealthLine[] {
  const lines: HealthLine[] = [
    { text: prog.tour === "done" ? "Tour do meu-bot: feito" : prog.tour === "skipped" ? "Tour do meu-bot: pulado" : "Tour do meu-bot: não feito", ok: prog.tour === "done" },
  ];
  for (const t of prog.tutorials) {
    if (t.comingSoon) { lines.push({ text: `${t.title}: em breve`, ok: null }); continue; }
    const line: HealthLine = { text: `${t.title}: ${t.finished ? "concluído" : `${t.done} de ${t.total}`}`, ok: t.finished ? true : t.done > 0 ? null : false };
    if (!t.finished && t.current !== null) line.step = ` · parou em "${t.current}"`;
    lines.push(line);
  }
  return lines;
}

export const progressEmptyText = (who: string): string =>
  `Ainda sem dados: o meu-bot de ${who} grava o progresso na máquina quando ela abre o app com o suporte ligado.`;

export const progressUpdatedText = (at: string): string =>
  `Atualizado ${new Date(at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}, quando o meu-bot dela estava aberto.`;

/** A transcrição só aparece enquanto a máquina não entende áudios. */
export const visibleActions = (h: AdminHealth | null): readonly (typeof ADMIN_ACTIONS)[number][] =>
  ADMIN_ACTIONS.filter((o) => !(o.id === "transcription" && h?.whatsapp?.audioIn === true));

export const actionResultText = (label: string, r: { ok: boolean; detail: string }): string =>
  `${label}: ${r.ok ? "feito" : "falhou"}${r.detail !== "" ? ` · ${r.detail}` : ""}`;

/** "visto há …" a partir de um ISO; "" se a data não vale. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  return Number.isNaN(min) ? "" : min < 1 ? "visto agora" : min < 60 ? `visto há ${min} min` : min < 48 * 60 ? `visto há ${Math.round(min / 60)} h` : `visto há ${Math.round(min / 1440)} dias`;
}

/** O que vai depois do nome da pessoa na lista do seletor: endereço, alcance e "visto há". */
export const personSuffix = (p: SupportPerson, now: number = Date.now()): string =>
  ` · ${p.hostname}${p.port !== 22 ? `:${p.port}` : ""}${p.local ? " · só alcançável deste Mac" : ""}${p.seenAt !== "" ? ` · ${timeAgo(p.seenAt, now)}` : ""}`;

export const EMPTY_PEOPLE_TEXT = "Ninguém ainda. Quando uma pessoa ligar \"Permitir suporte\" no meu-bot dela, ela aparece aqui sozinha. Ou use Adicionar pessoa com o código dela.";
export const MISSING_ADMIN_KEY_TEXT = "⚠ falta a chave ~/.ssh/meu-bot-admin neste Mac: rode node scripts/suporte-setup.mjs no projeto.";
