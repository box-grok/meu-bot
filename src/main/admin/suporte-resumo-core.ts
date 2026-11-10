/**
 * Resumo de uma pessoa do suporte para o console (console.agentesgrok.com/support-window): a saúde da máquina, a
 * licença, o uso do app (última versão em produção e em staging) e as aberturas recentes, em linhas de texto já
 * prontas. Puro (testado); quem lê a máquina e envia é support-admin.ts. Mesmas regras de texto da janela do admin.
 */
import type { AdminHealth } from "../../shared/ipc";

export interface LinhaResumo { texto: string; ok: boolean | null }
export interface ResumoSuporte { saude: LinhaResumo[]; licenca: LinhaResumo[]; uso: LinhaResumo[]; aberturas: string[] }

const gb = (mb: number): string => `${Math.round(mb / 1024)} GB`;
const canal = (produto: string): string => (/-staging$/.test(produto) ? "Staging" : "Produção");
const quando = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const PLANO: Record<string, string> = { free: "Free", pro: "Pro" };
const STATUS: Record<string, string> = { free: "Free", trialing: "Trial", active: "Ativo", expired: "Expirado" };

export function resumoDaSaude(h: AdminHealth): ResumoSuporte {
  const p = h.probe;
  const saude: LinhaResumo[] = [
    { texto: p.reachable ? `entra por SSH (${p.user ?? "?"}${p.os !== null ? ` · ${p.os}` : ""})` : `não entra por SSH: ${p.error ?? "sem detalhes"}`, ok: p.reachable },
  ];
  if (h.appsDoMac !== undefined) {
    const noAr = h.appsDoMac.filter((a) => a.noAr);
    saude.push(noAr.length > 0 ? { texto: `backend dos apps no ar: ${noAr.map((a) => `${a.nome} (${a.porta})`).join(", ")}`, ok: true } : { texto: "nenhum app meu-bot aberto neste Mac", ok: null });
  } else {
    saude.push({ texto: p.backendListening ? "backend do meu-bot no ar" : p.backendInstalled ? "backend instalado mas parado" : "sem o backend do meu-bot", ok: p.backendListening });
  }
  saude.push({ texto: p.claudeLoggedIn ? "Claude Code logado" : "Claude Code deslogado", ok: p.claudeLoggedIn });
  if (typeof p.diskTotalMb === "number" && p.diskTotalMb > 0 && typeof p.diskFreeMb === "number") saude.push({ texto: `disco: ${gb(p.diskFreeMb)} livres de ${gb(p.diskTotalMb)}`, ok: p.diskFreeMb >= 2048 });
  const wa = h.whatsapp;
  if (wa !== null) saude.push({ texto: wa.connected ? "WhatsApp conectado" : `WhatsApp: ${wa.detail}`, ok: wa.connected });

  const licenca: LinhaResumo[] = [];
  if (h.license !== null) {
    const l = h.license.license;
    licenca.push({ texto: `Plano: ${PLANO[l.plan] ?? l.plan}`, ok: l.plan !== "free" ? true : null });
    licenca.push({ texto: `Status: ${STATUS[l.status] ?? l.status}`, ok: l.status === "active" || l.status === "trialing" ? true : l.status === "expired" ? false : null });
    if (l.expiresAt !== null) licenca.push({ texto: `Validade: ${quando(l.expiresAt)}`, ok: null });
    licenca.push({ texto: `Devices: ${h.license.activeCount}/${h.license.deviceLimit} ativos${h.license.pendingCount > 0 ? ` · ${h.license.pendingCount} pedindo` : ""}`, ok: h.license.pendingCount > 0 ? false : null });
  }

  const ab = h.aberturas ?? [];
  const ultima = new Map<string, (typeof ab)[number]>();
  for (const a of ab) if (!ultima.has(a.produto)) ultima.set(a.produto, a);
  const uso: LinhaResumo[] = [...ultima.values()].map((a) => ({ texto: `${canal(a.produto)} (${a.produto}): versão ${a.versao}${a.conta !== "" ? ` · conta ${a.conta}` : ""} · aberto em ${quando(a.em)}`, ok: null }));
  const aberturas = ab.slice(0, 20).map((a) => `${quando(a.em)} · ${a.produto} (${canal(a.produto).toLowerCase()}) ${a.versao}${a.conta !== "" ? ` · ${a.conta}` : ""}${a.mac !== "" ? ` · Mac ${a.mac}` : ""}`);
  return { saude, licenca, uso, aberturas };
}
