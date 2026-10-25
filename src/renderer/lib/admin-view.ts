/**
 * Variante: admin. Textos e linhas da página "Suporte" do meu-bot-admin e do seletor de pessoas, sem DOM.
 * Puro: testável com node --test. O desenho fica em admin/suporte-page.ts e admin/picker-chrome.ts.
 */
import type { AdminAction, AdminHealth, LicenseDevice, LicenseView, SupportPerson, SupportProgress } from "../../shared/ipc";
import { tutorialNumber } from "./tutoriais.js";

export const ADMIN_ACTIONS: readonly { id: AdminAction; label: string; confirm: string }[] = [
  { id: "install-backend", label: "Instalar o backend do meu-bot", confirm: "Confirmar? instala na conta dela (porta livre escolhida sozinha)" },
  { id: "restart-gateway", label: "Reiniciar o gateway do WhatsApp (OpenClaw ou PicoClaw)", confirm: "Confirmar? o WhatsApp dela cai por ~1 min" },
  { id: "restart-backend", label: "Reiniciar o backend do meu-bot", confirm: "Confirmar? conversas em andamento caem" },
  { id: "transcription", label: "Ativar a transcrição de áudio", confirm: "Confirmar? baixa ~500 MB na máquina dela" },
  { id: "transcription-off", label: "Desativar a transcrição de áudio", confirm: "Confirmar? o agente dela deixa de entender áudios" },
  { id: "support-off", label: "Desligar o suporte desta pessoa", confirm: "Confirmar? o seu acesso a esta máquina acaba agora" },
];

/** Compara versões na ordem do semver (mesma regra de src/main/updater-core.ts); negativo = a é mais antiga. */
export function compareVersions(a: string, b: string): number {
  // Núcleo "x.y.z" numérico; depois a pre-release: sem ela vence ("0.2.0" > "0.2.0-staging.9"); com as duas,
  // compara parte a parte (número com número, texto com texto, número < texto, mais partes > menos).
  const parse = (v: string): { nucleo: number[]; pre: string[] } => {
    const [semMeta = ""] = v.trim().replace(/^v/, "").split("+");
    const i = semMeta.indexOf("-");
    const nucleo = (i < 0 ? semMeta : semMeta.slice(0, i)).split(".").map((x) => Number.parseInt(x, 10) || 0);
    return { nucleo, pre: i < 0 ? [] : semMeta.slice(i + 1).split(".") };
  };
  const x = parse(a), y = parse(b);
  for (let k = 0; k < Math.max(x.nucleo.length, y.nucleo.length); k++) { const d = (x.nucleo[k] ?? 0) - (y.nucleo[k] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let k = 0; k < Math.max(x.pre.length, y.pre.length); k++) {
    const p = x.pre[k], q = y.pre[k];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const np = /^\d+$/.test(p), nq = /^\d+$/.test(q);
    const d = np && nq ? Number(p) - Number(q) : np ? -1 : nq ? 1 : p < q ? -1 : p > q ? 1 : 0;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Uma linha da lista de saúde/progresso: ✓ (ok), ✗ (bad) ou • (null). */
export interface HealthLine { text: string; ok: boolean | null; step?: string }

/** MB → "12 GB" / "820 MB" (uma casa só abaixo de 10 GB). */
export const gb = (mb: number): string => (mb >= 10_240 ? `${Math.round(mb / 1024)} GB` : mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(mb)} MB`);

export function healthLines(h: AdminHealth, fmtPhone: (digits: string | null) => string, adminVersion: string): HealthLine[] {
  const p = h.probe;
  const lines: HealthLine[] = [];
  // O meu-bot dela: versão (atrás da do admin = ainda não abriu o app com internet / não atualizou) e última abertura.
  const a = h.progress?.app;
  if (a !== undefined) {
    const behind = compareVersions(a.version, adminVersion) < 0;
    lines.push(behind
      ? { text: `meu-bot ${a.version} no Mac dela, atrás da sua (${adminVersion}): ela ainda não abriu o app com internet · aberto ${agoText(a.openedAt)}`, ok: false }
      : { text: `meu-bot ${a.version} no Mac dela · aberto ${agoText(a.openedAt)}`, ok: true });
  } else if (h.share.progress) lines.push({ text: "versão do meu-bot dela: sem dados ainda (grava quando ela abre o app com o suporte ligado)", ok: null });
  lines.push(
    { text: p.reachable ? `entra por SSH (${p.user ?? "?"} · ${p.os ?? "?"})` : `não entra por SSH: ${p.error ?? "sem detalhes"}`, ok: p.reachable },
    { text: p.backendListening ? "backend do meu-bot no ar" : p.backendInstalled ? "backend instalado mas parado" : "sem o backend do meu-bot", ok: p.backendListening },
    { text: p.claudeLoggedIn ? "Claude Code logado" : "Claude Code deslogado", ok: p.claudeLoggedIn },
    h.xai === null ? { text: "xAI (Grok): sem Hermes nesta máquina", ok: null }
      : h.xai.loggedIn ? { text: `xAI (Grok) logada${h.xai.email !== null ? ` (${h.xai.email})` : ""}`, ok: true }
        : { text: "xAI (Grok) deslogada: o grok-4 não responde", ok: false },
    { text: p.statusLine ? "status line instalada" : "sem status line", ok: p.statusLine },
  );
  // Disco da home e memória (como o Rambox mede): o whisper baixa ~500 MB e o OpenClaw enche de transcripts.
  if (typeof p.diskTotalMb === "number" && p.diskTotalMb > 0 && typeof p.diskFreeMb === "number") {
    lines.push({ text: `disco: ${gb(p.diskFreeMb)} livres de ${gb(p.diskTotalMb)}${p.diskFreeMb < 2048 ? " · pouco espaço" : ""}`, ok: p.diskFreeMb >= 2048 });
  }
  if (typeof p.memTotalMb === "number" && p.memTotalMb > 0 && typeof p.memFreeMb === "number") {
    lines.push({ text: `memória: ${gb(p.memFreeMb)} livres de ${gb(p.memTotalMb)}${p.memFreeMb < 512 ? " · apertada" : ""}`, ok: p.memFreeMb >= 512 ? null : false });
  }
  const wa = h.whatsapp;
  if (wa !== null && wa.present) {
    lines.push({ text: wa.connected ? `WhatsApp conectado${wa.number !== null ? ` (${fmtPhone(wa.number)})` : ""}` : `WhatsApp: ${wa.detail}`, ok: wa.connected });
    if (wa.dmPolicy !== null) lines.push({ text: `responde: ${wa.dmPolicy === "open" ? "todo mundo" : wa.dmPolicy === "allowlist" ? "só a dona do número" : wa.dmPolicy}`, ok: null });
    if (wa.audioIn !== undefined) lines.push({ text: wa.audioIn ? "entende áudios" : "não entende áudios (sem transcrição)", ok: wa.audioIn });
    if (wa.audioOut !== undefined) lines.push({ text: `responde em áudio: ${wa.audioOut === "inbound" ? "quando recebe áudio" : wa.audioOut === "always" ? "sempre" : "nunca"}`, ok: null });
  }
  return lines;
}

/** Rótulos do plano/status, como as telas de billing do Rambox. */
export const PLAN_LABEL: Record<LicenseView["license"]["plan"], string> = { free: "Free", pro: "Pro" };
export const STATUS_LABEL: Record<LicenseView["license"]["status"], string> = { free: "Free", trialing: "Trialing", active: "Active", expired: "Expired" };
/** Ciclo de cobrança legível; "-" quando não há (ex.: em trial), como a tela colada. */
export const billingCycleText = (interval: LicenseView["license"]["interval"]): string => (interval === "month" ? "mensal" : interval === "year" ? "anual" : "-");

/** "15 de out. de 2026" a partir de um ISO; "-" se a data não vale. */
export function fmtDate(iso: string | null): string {
  if (iso === null || iso === "") return "-";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "-" : new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** O resumo da conta (plano, status, membro desde, ciclo, validade, devices), como o painel do Rambox. */
/** Nome do add-on para o admin ler ("Financeiro"); MVP sem nome conhecido fica com o id. */
const PRODUTO_LABEL: Record<string, string> = { "meu-bot-finance": "Financeiro" };
export const produtoLabel = (id: string): string => PRODUTO_LABEL[id] ?? id;
export function licenseSummary(view: LicenseView, now: number = Date.now()): HealthLine[] {
  const l = view.license;
  const lines: HealthLine[] = [
    // `produtos` pode faltar num backend antigo (licença sem o campo): trata como nenhum.
    { text: `Plano: ${PLAN_LABEL[l.plan]}${(l.produtos ?? []).length > 0 ? ` + ${l.produtos.map(produtoLabel).join(", ")}` : ""}`, ok: l.plan !== "free" || (l.produtos ?? []).length > 0 ? true : null },
    { text: `Status: ${STATUS_LABEL[l.status]}`, ok: l.status === "active" ? true : l.status === "expired" ? false : null },
    { text: `Membro desde: ${fmtDate(l.memberSince)}`, ok: null },
    { text: `Ciclo de cobrança: ${billingCycleText(l.interval)}`, ok: null },
  ];
  if (l.status === "trialing" && l.trialEnd !== null) lines.push({ text: `Trial termina: ${fmtDate(l.trialEnd)}`, ok: null });
  if (l.expiresAt !== null) lines.push({ text: `Expira: ${fmtDate(l.expiresAt)}`, ok: Date.parse(l.expiresAt) < now ? false : null });
  lines.push({ text: `Devices: ${view.activeCount}/${view.deviceLimit} ativos${view.pendingCount > 0 ? ` · ${view.pendingCount} pedido(s) de device` : ""}`, ok: view.pendingCount > 0 ? false : null });
  return lines;
}

/** ISO → "2027-10-15" para preencher um <input type=date>; "" quando nulo/inválido. */
export function isoToDateInput(iso: string | null): string {
  if (iso === null || iso === "") return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}
/** "2027-10-15" (valor de <input type=date>) → ISO meia-noite UTC; null se vazio ou inválido (limpa o campo). */
export function dateInputToIso(value: string): string | null {
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Rótulo de status de um device. */
export const deviceStatusLabel = (s: LicenseDevice["status"]): string => (s === "pending" ? "Pendente" : "Ativo");
/** "meu-bot 0.2.0 · meu-bot-crm 0.2.0" quando o device já se apresentou com mais de um app; senão a versão do app (registro antigo). */
export function appsText(d: Pick<LicenseDevice, "app" | "apps">): string {
  const names = Object.keys(d.apps ?? {}).sort();
  if (names.length === 0) return d.app !== "" ? d.app : "?";
  return names.map((n) => `${n} ${d.apps[n]?.version || "?"}`).join(" · ");
}
/** Um device em partes: nome em destaque, metadados (sistema · apps) em cinza, status e "visto há" (ou "mão levantada"). */
export interface DeviceParts { name: string; meta: string; status: string; seen: string; ok: boolean }
export function deviceParts(d: LicenseDevice, now: number = Date.now()): DeviceParts {
  const seen = d.status === "pending" ? "mão levantada" : d.lastSeen !== "" ? timeAgo(d.lastSeen, now) : "";
  return { name: d.name !== "" ? d.name : d.id, meta: `${d.platform !== "" ? d.platform : "?"} · ${appsText(d)}`, status: deviceStatusLabel(d.status), seen, ok: d.status !== "pending" };
}
/** Uma linha de device para a tabela de máquinas (nome + sistema + apps/versão + status + visto há). */
export function deviceLine(d: LicenseDevice, now: number = Date.now()): HealthLine {
  const p = deviceParts(d, now);
  return { text: `${p.name} · ${p.meta} · ${p.status}${p.seen !== "" ? ` · ${p.seen}` : ""}`, ok: p.ok };
}

export function progressLines(prog: SupportProgress): HealthLine[] {
  const lines: HealthLine[] = [
    { text: prog.tour === "done" ? "Tour do meu-bot: feito" : prog.tour === "skipped" ? "Tour do meu-bot: pulado" : "Tour do meu-bot: não feito", ok: prog.tour === "done" },
  ];
  for (const t of prog.tutorials) {
    // O payload traz só o id; o número fixo vem da trilha ("3 · Status line do Claude"), para o suporte dizer "faz o 3".
    const n = tutorialNumber(t.id);
    const name = n === null ? t.title : `${n} · ${t.title}`;
    if (t.comingSoon) { lines.push({ text: `${name}: em breve`, ok: null }); continue; }
    const line: HealthLine = { text: `${name}: ${t.finished ? "concluído" : `${t.done} de ${t.total}`}`, ok: t.finished ? true : t.done > 0 ? null : false };
    if (!t.finished && t.current !== null) line.step = ` · parou em "${t.current}"`;
    lines.push(line);
  }
  return lines;
}

export const progressEmptyText = (who: string): string =>
  `Ainda sem dados: o meu-bot de ${who} grava o progresso na máquina quando ela abre o app com o suporte ligado.`;

export const progressUpdatedText = (at: string): string =>
  `Atualizado ${new Date(at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}, quando o meu-bot dela estava aberto.`;

/**
 * Ações que fazem sentido: reiniciar sempre; transcrição só em máquina cujo agente transcreve áudio (capacidade
 * `audio`: Ativar quando ela não entende áudios, Desativar quando entende). Sem saúde ainda, só o que não depende dela.
 */
export const visibleActions = (h: AdminHealth | null): readonly (typeof ADMIN_ACTIONS)[number][] =>
  ADMIN_ACTIONS.filter((o) => {
    // Instalar só aparece quando a máquina está sem backend (com ele, "Reiniciar"); sem saúde ainda, não aparece.
    if (o.id === "install-backend") return h !== null && h.probe.reachable && !h.probe.backendInstalled;
    if (o.id === "restart-backend") return h === null || h.probe.backendInstalled;
    if (o.id !== "transcription" && o.id !== "transcription-off") return true;
    const wa = h?.whatsapp ?? null;
    if (wa === null || !wa.present || !wa.capacidades.audio) return false;
    return o.id === "transcription" ? wa.audioIn === false : wa.audioIn === true;
  });

/** Por que não há ação de transcrição (null = há). */
export function transcriptionNote(h: AdminHealth | null): string | null {
  if (h === null) return null;
  if (h.whatsapp === null) return h.share.whatsapp ? "Transcrição de áudio: a máquina não tem agente com WhatsApp." : "Transcrição de áudio: ela não compartilha o WhatsApp.";
  if (!h.whatsapp.present) return "Transcrição de áudio: a máquina não tem agente com WhatsApp (a transcrição é dele).";
  if (!h.whatsapp.capacidades.audio) return `Transcrição de áudio: o agente desta máquina (${h.whatsapp.gateway ?? "desconhecido"}) não transcreve áudio pelo app.`;
  return null;
}

export const actionResultText = (label: string, r: { ok: boolean; detail: string }): string =>
  `${label}: ${r.ok ? "feito" : "falhou"}${r.detail !== "" ? ` · ${r.detail}` : ""}`;

/** "há …" / "agora" a partir de um ISO; "" se a data não vale. */
export function agoText(iso: string, now: number = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  return Number.isNaN(min) ? "" : min < 1 ? "agora" : min < 60 ? `há ${min} min` : min < 48 * 60 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dias`;
}
/** "visto há …" a partir de um ISO; "" se a data não vale. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = agoText(iso, now);
  return t === "" ? "" : `visto ${t}`;
}

/** O que vai depois do nome da pessoa na lista do seletor: endereço, alcance e "visto há". */
export const personSuffix = (p: SupportPerson, now: number = Date.now()): string =>
  ` · ${p.machine !== null ? `${p.machine} · ` : ""}${p.hostname}${p.port !== 22 ? `:${p.port}` : ""}${p.local ? " · só alcançável deste Mac" : ""}${p.seenAt !== "" ? ` · ${timeAgo(p.seenAt, now)}` : ""}`;

export const EMPTY_PEOPLE_TEXT = "Ninguém ainda. Quando uma pessoa ligar \"Permitir suporte\" no meu-bot dela, ela aparece aqui sozinha. Ou use Adicionar pessoa com o código dela.";
export const MISSING_ADMIN_KEY_TEXT = "⚠ falta a chave ~/.ssh/meu-bot-admin neste Mac: rode node scripts/suporte-setup.mjs no projeto.";
