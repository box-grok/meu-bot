/** Texto e ação a partir de uma sondagem de máquina. Puro: testável com node --test. */
import type { HostProbe } from "../../shared/ipc";

export type ProbeKind = "ok" | "warn" | "bad";
export interface ProbeText { kind: ProbeKind; text: string; install: "install" | "reinstall" | "statusline" | null; canOpen: boolean; /** Oferecer o botão "Entrar no Claude Code". */ login?: boolean }

export const hostLabel = (h: string): string => (h === "local" ? "este Mac (sem SSH)" : h);

/** Status line do Claude que grava o cache de limites: quando falta, a máquina abre igual, mas o seletor oferece instalar. */
const slNote = (p: HostProbe): string => (p.statusLine ? "" : " · sem status line do Claude");
const slInstall = (p: HostProbe): "statusline" | null => (p.statusLine ? null : "statusline");

export function describeProbe(p: HostProbe): ProbeText {
  const who = `${p.user ?? "?"}@${p.host === "local" ? "mac" : p.host}${p.os ? ` · ${p.os}` : ""}${p.arch ? ` · ${p.arch}` : ""}${p.grokPod ? " · computador do Grok Bot" : ""}${p.gateway === "openclaw" ? " · OpenClaw" : p.gateway === "hermes" ? " · Hermes" : ""}`;
  if (p.host === "local") {
    if (p.error !== null || p.claudePath === null || !p.claudeLoggedIn) {
      const why = p.error ?? (p.claudePath === null ? "Claude Code não encontrado" : "Claude Code não está logado");
      return { kind: "bad", text: `✗ este Mac · ${why}`, install: null, canOpen: false, login: p.claudePath !== null && !p.claudeLoggedIn };
    }
    return { kind: "ok", text: `✓ ${who} · Node ${p.node ?? "?"} · Claude Code logado · backend sobe com a janela${p.backendListening ? " (no ar agora)" : ""}${slNote(p)}`, install: slInstall(p), canOpen: true };
  }
  if (!p.reachable && p.tailscaleCheck) return { kind: "warn", text: `⚠ ${p.host}: o Tailscale SSH pede uma verificação extra no navegador. Clique em "Aprovar verificação do Tailscale": o link abre e a máquina entra quando você aprovar.`, install: null, canOpen: false };
  if (!p.reachable) return { kind: "bad", text: `✗ ${p.host} inacessível por SSH: ${p.error ?? "sem detalhes"}`, install: null, canOpen: false };
  if (p.backendInstalled && p.backendListening) {
    // Backend no ar mas Claude deslogado: dá para abrir (grok-4 ainda responde), mas avisa e oferece o login.
    if (p.claudePath !== null && !p.claudeLoggedIn) return { kind: "warn", text: `⚠ ${who} · backend no ar, mas o Claude Code está deslogado nesta máquina. "Entrar no Claude Code" abre a janela já no login.`, install: null, canOpen: true, login: true };
    return { kind: "ok", text: `✓ ${who} · backend instalado e ouvindo${p.models.length > 0 ? ` · modelos: ${p.models.join(", ")}` : ""}${slNote(p)}`, install: slInstall(p), canOpen: true };
  }
  if (p.backendInstalled) return { kind: "warn", text: `⚠ ${who} · backend instalado mas parado. Reinstalar sobe o serviço de novo.`, install: "reinstall", canOpen: true };
  if (p.claudePath === null) return { kind: "bad", text: `✗ ${who} · sem backend e sem Claude Code. Instale o Claude Code nessa máquina e faça login antes.`, install: null, canOpen: false };
  if (!p.claudeLoggedIn) {
    return { kind: "bad", text: `✗ ${who} · sem backend; Claude Code existe mas não está logado. Use "Entrar no Claude Code" e depois instale o backend.`, install: null, canOpen: false, login: true };
  }
  return { kind: "warn", text: `⚠ ${who} · Claude Code logado, mas sem o backend do meu-bot.${p.node ? ` Node ${p.node} presente.` : " Node será baixado."}`, install: "install", canOpen: false };
}
