/** Texto e ação a partir de uma sondagem de máquina. Puro: testável com node --test. */
import type { HostProbe } from "../../shared/ipc";

export type ProbeKind = "ok" | "warn" | "bad";
export interface ProbeText {
  kind: ProbeKind;
  text: string;
  /** O que o botão de ação faz; "porta" = "Usar porta N" (o backend da máquina está em outra porta). */
  install: "install" | "reinstall" | "statusline" | "transcricao" | "guarda" | "claude" | "porta" | null;
  canOpen: boolean;
  /** Oferecer o botão "Entrar no Claude Code". */
  login?: boolean;
  /** Porta que a ação usa: a do backend ("porta") ou a livre em que "install" vai instalar. */
  port?: number;
}

let nicknames: Record<string, string> = {};
/** Apelidos ("Renomear" no seletor): a partir daqui, hostLabel mostra o apelido no lugar da chave SSH. */
export const setHostNicknames = (names: Record<string, string>): void => { nicknames = { ...names }; };
export const hostLabel = (h: string): string => nicknames[h] ?? (h === "local" ? "este Mac (sem SSH)" : h);

/**
 * O que falta de opcional numa máquina que abre: a status line do Claude (cache de limites) e, com OpenClaw, a
 * transcrição de áudio do agente do WhatsApp. A máquina abre igual; o seletor oferece instalar um por vez.
 */
const slNote = (p: HostProbe): string => `${p.statusLine ? "" : " · sem status line do Claude"}${p.audioIn === false ? " · sem transcrição de áudio" : ""}${p.guarda === false ? " · sem guarda do WhatsApp" : ""}`;
const slInstall = (p: HostProbe): "statusline" | "transcricao" | "guarda" | null => (!p.statusLine ? "statusline" : p.audioIn === false ? "transcricao" : p.guarda === false ? "guarda" : null);

export function describeProbe(p: HostProbe): ProbeText {
  const who = `${p.user ?? "?"}@${p.host === "local" ? "mac" : p.host}${p.os ? ` · ${p.os}` : ""}${p.arch ? ` · ${p.arch}` : ""}${p.grokPod ? " · computador do Grok Bot" : ""}${p.gateway === "openclaw" ? " · OpenClaw" : p.gateway === "hermes" ? " · Hermes" : p.gateway === "picoclaw" ? " · PicoClaw" : ""}`;
  if (p.host === "local") {
    if (p.error !== null || p.claudePath === null || !p.claudeLoggedIn) {
      const why = p.error ?? (p.claudePath === null ? "Claude Code não encontrado" : "Claude Code não está logado");
      return { kind: "bad", text: `✗ este Mac · ${why}`, install: null, canOpen: false, login: p.claudePath !== null && !p.claudeLoggedIn };
    }
    return { kind: "ok", text: `✓ ${who} · Node ${p.node ?? "?"} · Claude Code logado · backend sobe com a janela${p.backendListening ? " (no ar agora)" : ""}${slNote(p)}`, install: slInstall(p), canOpen: true };
  }
  if (!p.reachable && p.tailscaleCheck) return { kind: "warn", text: `⚠ ${p.host}: o Tailscale SSH pede uma verificação extra no navegador. Clique em "Aprovar verificação do Tailscale": o link abre e a máquina entra quando você aprovar.`, install: null, canOpen: false };
  if (!p.reachable) return { kind: "bad", text: `✗ ${p.host} inacessível por SSH: ${p.error ?? "sem detalhes"}`, install: null, canOpen: false };
  // O backend desta conta está em outra porta (duas contas na mesma máquina, por exemplo): o app apontaria para
  // a porta errada. Um clique grava a porta certa só para esta máquina.
  if (p.backendInstalled && p.backendPort !== null && p.backendPort !== p.appPort) {
    return { kind: "warn", text: `⚠ ${who} · o backend desta máquina está na porta ${p.backendPort}, mas o app usa a ${p.appPort}. "Usar porta ${p.backendPort}" ajusta só esta máquina; as outras continuam como estão.`, install: "porta", port: p.backendPort, canOpen: false };
  }
  if (p.backendInstalled && p.backendListening) {
    // Backend no ar mas Claude deslogado: dá para abrir (grok-4 ainda responde), mas avisa e oferece o login.
    if (p.claudePath !== null && !p.claudeLoggedIn) return { kind: "warn", text: `⚠ ${who} · backend no ar, mas o Claude Code está deslogado nesta máquina. "Entrar no Claude Code" abre a janela já no login.`, install: null, canOpen: true, login: true };
    return { kind: "ok", text: `✓ ${who} · backend instalado e ouvindo${p.models.length > 0 ? ` · modelos: ${p.models.join(", ")}` : ""}${slNote(p)}`, install: slInstall(p), canOpen: true };
  }
  if (p.backendInstalled) return { kind: "warn", text: `⚠ ${who} · backend instalado mas parado. Reinstalar sobe o serviço de novo.`, install: "reinstall", canOpen: true };
  // Conta sem Claude Code (outro usuário da mesma máquina, por exemplo): o seletor instala; depois vêm o login e o backend.
  if (p.claudePath === null) return { kind: "bad", text: `✗ ${who} · sem backend e sem Claude Code nesta conta. "Instalar Claude Code" instala em ~/.local/bin; depois é "Entrar no Claude Code" e "Instalar backend".`, install: "claude", canOpen: false };
  if (!p.claudeLoggedIn) {
    return { kind: "bad", text: `✗ ${who} · sem backend; Claude Code existe mas não está logado. Use "Entrar no Claude Code" e depois instale o backend.`, install: null, canOpen: false, login: true };
  }
  const nodeNote = p.node ? ` Node ${p.node} presente.` : " Node será baixado.";
  // A porta do app já tem dono nesta máquina (outra conta com o próprio backend, outro programa): instalar nela
  // falharia. "Instalar backend" usa a primeira livre e grava a porta só para esta máquina.
  if (p.portBusy) {
    if (p.freePort === null) return { kind: "bad", text: `✗ ${who} · sem backend, e a porta ${p.appPort} já está ocupada nesta máquina (outra conta ou outro programa); nenhuma livre entre ${p.appPort + 1} e ${p.appPort + 30}. Troque a porta em Configurações e tente de novo.`, install: null, canOpen: false };
    return { kind: "warn", text: `⚠ ${who} · Claude Code logado, mas sem o backend do meu-bot. A porta ${p.appPort} já está ocupada nesta máquina (outra conta ou outro programa): "Instalar backend" instala na ${p.freePort} e grava essa porta só para esta máquina.${nodeNote}`, install: "install", port: p.freePort, canOpen: false };
  }
  return { kind: "warn", text: `⚠ ${who} · Claude Code logado, mas sem o backend do meu-bot.${nodeNote}`, install: "install", canOpen: false };
}
