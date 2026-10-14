/** Texto e ação a partir de uma sondagem de máquina. Puro: testável com node --test. */
import type { HostProbe } from "../../shared/ipc";

export type ProbeKind = "ok" | "warn" | "bad";
export interface ProbeText { kind: ProbeKind; text: string; install: "install" | "reinstall" | null; canOpen: boolean }

export const hostLabel = (h: string): string => (h === "local" ? "este Mac (sem SSH)" : h);

export function describeProbe(p: HostProbe): ProbeText {
  const who = `${p.user ?? "?"}@${p.host === "local" ? "mac" : p.host}${p.os ? ` · ${p.os}` : ""}${p.arch ? ` · ${p.arch}` : ""}${p.grokPod ? " · computador do Grok Bot" : ""}`;
  if (p.host === "local") {
    if (p.error !== null || p.claudePath === null || !p.claudeLoggedIn) {
      const why = p.error ?? (p.claudePath === null ? "Claude Code não encontrado" : "Claude Code não está logado: rode claude no Terminal e use /login");
      return { kind: "bad", text: `✗ este Mac · ${why}`, install: null, canOpen: false };
    }
    return { kind: "ok", text: `✓ ${who} · Node ${p.node ?? "?"} · Claude Code logado · backend sobe com a janela${p.backendListening ? " (no ar agora)" : ""}`, install: null, canOpen: true };
  }
  if (!p.reachable) return { kind: "bad", text: `✗ ${p.host} inacessível por SSH: ${p.error ?? "sem detalhes"}`, install: null, canOpen: false };
  if (p.backendInstalled && p.backendListening) {
    return { kind: "ok", text: `✓ ${who} · backend instalado e ouvindo${p.models.length > 0 ? ` · modelos: ${p.models.join(", ")}` : ""}`, install: null, canOpen: true };
  }
  if (p.backendInstalled) return { kind: "warn", text: `⚠ ${who} · backend instalado mas parado. Reinstalar sobe o serviço de novo.`, install: "reinstall", canOpen: true };
  if (p.claudePath === null) return { kind: "bad", text: `✗ ${who} · sem backend e sem Claude Code. Instale o Claude Code nessa máquina e faça login antes.`, install: null, canOpen: false };
  if (!p.claudeLoggedIn) {
    return { kind: "bad", text: `✗ ${who} · sem backend; Claude Code existe mas não está logado. No terminal: ssh -t ${p.host} claude  e depois /login. Aí volte aqui e instale.`, install: null, canOpen: false };
  }
  return { kind: "warn", text: `⚠ ${who} · Claude Code logado, mas sem o backend do meu-bot.${p.node ? ` Node ${p.node} presente.` : " Node será baixado."}`, install: "install", canOpen: false };
}
