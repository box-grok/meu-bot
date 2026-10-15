/** Seletor de máquinas: lista imediata, sondagens em paralelo, teclado completo. */
import type { HostProbe, PickerApi, PickerInit, SshSyncResult } from "../shared/ipc";
import { hostAccent } from "./lib/host-color.js";
import { describeProbe, hostLabel, type ProbeText } from "./lib/probe-text.js";

declare global { interface Window { picker: PickerApi } }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const listEl = $<HTMLUListElement>("pk-list");
const filterEl = $<HTMLInputElement>("pk-filter");
const errorEl = $<HTMLParagraphElement>("pk-error");
const detailEl = $<HTMLElement>("pk-detail");
const statusEl = $<HTMLParagraphElement>("pk-status");
const installBtn = $<HTMLButtonElement>("pk-install");
const reliefShortcutBtn = $<HTMLButtonElement>("pk-relief-shortcut");
const logEl = $<HTMLPreElement>("pk-log");
const noteEl = $<HTMLParagraphElement>("pk-note");
const openBtn = $<HTMLButtonElement>("pk-open");
const cancelBtn = $<HTMLButtonElement>("pk-cancel");
const syncBtn = $<HTMLButtonElement>("pk-sync");
const directCheck = $<HTMLInputElement>("pk-direct");

interface Row { host: string; li: HTMLLIElement; badgeEl: HTMLSpanElement; shortcutBtn: HTMLButtonElement; relieveBtn: HTMLButtonElement }
let shortcuts = new Map<string, string | null>();
let reliefShortcuts = new Set<string>();
let pods = new Set<string>();

let hosts: string[] = [];
let openHosts = new Set<string>();
let selected: string | null = null;
const rows = new Map<string, Row>();
const results = new Map<string, ProbeText>();
let installing = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls !== undefined) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(err);

function showError(prefix: string, err: unknown): void {
  errorEl.hidden = false;
  errorEl.textContent = `${prefix}: ${errorText(err)}`;
}

function buildRows(): void {
  listEl.replaceChildren();
  rows.clear();
  for (const host of hosts) {
    const li = el("li", "row");
    li.setAttribute("role", "option");
    const dot = el("span", "dot");
    dot.style.background = hostAccent(host);
    const name = el("span", "name", hostLabel(host));
    const badge = el("span", "badge open", "janela aberta");
    badge.hidden = !openHosts.has(host);
    // Só num computador do Grok Bot: aliviar agora (abre a janela de alívio e fecha o seletor).
    const relieveBtn = el("button", "relieve", "🧯");
    relieveBtn.type = "button";
    relieveBtn.title = `Aliviar ${host} agora: limpa processos presos no pod e reinicia o Tailscale`;
    relieveBtn.setAttribute("aria-label", `aliviar ${host} agora`);
    relieveBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void relieve(host, relieveBtn); });
    const shortcutBtn = el("button", "shortcut");
    shortcutBtn.type = "button";
    shortcutBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void toggleShortcut(host, shortcutBtn); });
    li.append(dot, name, badge, relieveBtn, shortcutBtn);
    li.addEventListener("click", () => select(host));
    li.addEventListener("dblclick", () => { select(host); void open(); });
    listEl.appendChild(li);
    rows.set(host, { host, li, badgeEl: badge, shortcutBtn, relieveBtn });
    paintShortcut(host);
    paintPod(host);
  }
  applyFilter();
}

function paintPod(host: string): void {
  const r = rows.get(host);
  if (r !== undefined) r.relieveBtn.hidden = !pods.has(host);
  if (host === selected) paintDetail();
}

function paintShortcut(host: string): void {
  const btn = rows.get(host)?.shortcutBtn;
  if (btn === undefined) return;
  const has = shortcuts.has(host);
  const emoji = shortcuts.get(host) ?? null;
  btn.textContent = has ? (emoji ?? "★") : "+";
  btn.classList.toggle("on", has);
  btn.setAttribute("aria-label", has ? "remover atalho da área de trabalho" : "criar atalho na área de trabalho");
  btn.title = has ? `Remover "${host}.app" da área de trabalho` : `Criar "${host}.app" na área de trabalho, que abre direto a janela de ${hostLabel(host)}`;
}

async function toggleShortcut(host: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    const r = await window.picker.setShortcut(host, !shortcuts.has(host));
    if (r.has) shortcuts.set(host, r.emoji); else shortcuts.delete(host);
    errorEl.hidden = true;
  } catch (err) {
    showError("Atalho", err);
  } finally {
    btn.disabled = false;
    paintShortcut(host);
  }
}

async function toggleReliefShortcut(): Promise<void> {
  if (selected === null || !pods.has(selected)) return;
  const host = selected;
  reliefShortcutBtn.disabled = true;
  try {
    const r = await window.picker.setReliefShortcut(host, !reliefShortcuts.has(host));
    if (r.has) reliefShortcuts.add(host); else reliefShortcuts.delete(host);
    errorEl.hidden = true;
  } catch (err) {
    showError("Botão de alívio", err);
  } finally {
    reliefShortcutBtn.disabled = false;
    paintDetail();
  }
}

async function relieve(host: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    await window.picker.relieve(host);
  } catch (err) {
    showError("Alívio", err);
    btn.disabled = false;
  }
}

function visibleHosts(): string[] {
  const q = filterEl.value.trim().toLowerCase();
  return hosts.filter((h) => q === "" || h.toLowerCase().includes(q) || hostLabel(h).toLowerCase().includes(q));
}

function applyFilter(): void {
  const vis = new Set(visibleHosts());
  for (const r of rows.values()) r.li.hidden = !vis.has(r.host);
  if (selected !== null && !vis.has(selected)) select(visibleHosts()[0] ?? null);
}

/** O estado só aparece na caixa de baixo, para a máquina selecionada. */
function paintState(host: string): void {
  if (host === selected) paintDetail();
}

function paintDetail(): void {
  if (selected === null) { detailEl.hidden = true; openBtn.disabled = true; return; }
  detailEl.hidden = false;
  const t = results.get(selected);
  installBtn.hidden = true;
  const isPod = pods.has(selected);
  reliefShortcutBtn.hidden = !isPod;
  if (isPod) {
    const has = reliefShortcuts.has(selected);
    reliefShortcutBtn.textContent = has ? "🧯 Tirar o botão de alívio da mesa" : "🧯 Botão de alívio na mesa";
    reliefShortcutBtn.title = has ? `Remover "aliviar ${selected}.app" da área de trabalho` : `Criar "aliviar ${selected}.app" na área de trabalho: um clique limpa o pod e abre a janela`;
  }
  if (t === undefined) {
    statusEl.className = "status";
    statusEl.textContent = `verificando ${hostLabel(selected)}…`;
    openBtn.disabled = true;
    return;
  }
  statusEl.className = `status ${t.kind}`;
  statusEl.textContent = t.text;
  openBtn.disabled = !t.canOpen || installing;
  if (t.install !== null && !installing) {
    installBtn.textContent = t.install === "reinstall" ? "Reinstalar backend" : "Instalar backend";
    installBtn.hidden = false;
  }
}

function select(host: string | null): void {
  selected = host;
  for (const r of rows.values()) r.li.classList.toggle("selected", r.host === host);
  if (host !== null) rows.get(host)?.li.scrollIntoView({ block: "nearest" });
  logEl.hidden = true;
  paintDetail();
}

async function probe(host: string, force = false): Promise<void> {
  if (!force && results.has(host)) return;
  results.delete(host);
  paintState(host);
  try {
    const p: HostProbe = await window.picker.probe(host);
    results.set(host, describeProbe(p));
    if (p.reachable) { if (p.grokPod) pods.add(host); else pods.delete(host); paintPod(host); }
  } catch (err) {
    results.set(host, { kind: "bad", text: `✗ ${hostLabel(host)}: ${errorText(err)}`, install: null, canOpen: false });
  }
  paintState(host);
}

async function open(): Promise<void> {
  if (selected === null || openBtn.disabled) return;
  openBtn.disabled = true;
  await window.picker.choose(selected);
}

async function install(): Promise<void> {
  if (selected === null || installing) return;
  const host = selected;
  installing = true;
  installBtn.hidden = true;
  logEl.hidden = false;
  logEl.textContent = "";
  statusEl.className = "status";
  statusEl.textContent = `instalando o backend em ${hostLabel(host)}… (pode levar alguns minutos)`;
  openBtn.disabled = true;
  try {
    const r = await window.picker.install(host);
    if (!r.ok) {
      results.set(host, { kind: "bad", text: `✗ instalação falhou: ${r.log.at(-1) ?? "sem detalhes"}`, install: "install", canOpen: false });
      paintState(host);
      return;
    }
  } catch (err) {
    results.set(host, { kind: "bad", text: `✗ instalação falhou: ${errorText(err)}`, install: "install", canOpen: false });
    paintState(host);
    return;
  } finally {
    installing = false;
  }
  await probe(host, true);
}

function syncSummary(r: SshSyncResult): { kind: "ok" | "warn"; text: string } {
  const lines: string[] = [];
  if (r.added.length === 0 && r.includesAdded === 0) lines.push("✓ ~/.ssh/config já tinha todas as máquinas do projeto; nada mudou.");
  else lines.push(`✓ entraram no ~/.ssh/config: ${[...r.added, ...(r.includesAdded > 0 ? [`${r.includesAdded} Include`] : [])].join(", ")}${r.backup !== null ? ` (backup em ${r.backup.replace(/^.*\//, "")})` : ""}.`);
  if (r.kept.length > 0) lines.push(`mantidas como estavam: ${r.kept.join(", ")}.`);
  if (r.onlyLocal.length > 0) lines.push(`só neste Mac (o projeto não conhece): ${r.onlyLocal.join(", ")}.`);
  let kind: "ok" | "warn" = "ok";
  if (r.missingKeys.length > 0) {
    kind = "warn";
    lines.push(`⚠ falta a chave ${r.missingKeys.map((k) => k.replace(/^.*\/\.ssh\//, "~/.ssh/")).join(", ")} neste Mac: copie do outro Mac, ou gere uma nova e coloque a .pub no authorized_keys de cada máquina (PLAYBOOK, seção 1).`);
  }
  lines.push("O Cursor (Remote SSH) lê o mesmo arquivo, então as máquinas aparecem lá também.");
  return { kind, text: lines.join("\n") };
}

/** Acrescenta as máquinas do projeto ao ~/.ssh/config e recarrega a lista. */
async function syncSsh(): Promise<void> {
  syncBtn.disabled = true;
  noteEl.hidden = false;
  noteEl.className = "note";
  noteEl.textContent = "sincronizando o ~/.ssh/config com as máquinas do projeto…";
  try {
    const r = await window.picker.syncSsh();
    const s = syncSummary(r);
    noteEl.className = `note ${s.kind}`;
    noteEl.textContent = s.text;
    if (r.added.length > 0 || r.includesAdded > 0) {
      const keep = selected;
      init(await window.picker.list(), keep);
    }
  } catch (err) {
    noteEl.className = "note bad";
    noteEl.textContent = `✗ sincronização falhou: ${errorText(err)}`;
  } finally {
    syncBtn.disabled = false;
  }
}

function init(payload: PickerInit, keepSelected: string | null = null): void {
  hosts = payload.hosts;
  openHosts = new Set(payload.open);
  shortcuts = new Map(payload.shortcuts.map((s) => [s.host, s.emoji]));
  reliefShortcuts = new Set(payload.reliefShortcuts);
  pods = new Set(payload.pods);
  directCheck.checked = payload.openDirect;
  errorEl.hidden = payload.error === null;
  errorEl.textContent = payload.error ?? "";
  buildRows();
  const wanted = keepSelected !== null && hosts.includes(keepSelected) ? keepSelected : payload.preselect;
  select(hosts.includes(wanted) ? wanted : (hosts[0] ?? null));
  // Todas em paralelo: a lista nunca espera a máquina lenta.
  for (const h of hosts) void probe(h);
  filterEl.focus();
}

window.picker.on("picker:init", (p) => init(p as PickerInit));
window.picker.on("picker:install-progress", (p) => {
  const ev = p as { host: string; line: string };
  if (ev.host !== selected) return;
  logEl.hidden = false;
  logEl.textContent = `${logEl.textContent ?? ""}${ev.line}\n`.split("\n").slice(-12).join("\n");
  logEl.scrollTop = logEl.scrollHeight;
});

filterEl.addEventListener("input", () => applyFilter());
installBtn.addEventListener("click", () => { void install(); });
reliefShortcutBtn.addEventListener("click", () => { void toggleReliefShortcut(); });
openBtn.addEventListener("click", () => { void open(); });
cancelBtn.addEventListener("click", () => window.picker.cancel());
syncBtn.addEventListener("click", () => { void syncSsh(); });
directCheck.addEventListener("change", () => { void window.picker.setOpenDirect(directCheck.checked).catch((err: unknown) => showError("Abrir direto", err)); });
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { ev.preventDefault(); window.picker.cancel(); return; }
  if (ev.key === "Enter") { ev.preventDefault(); void open(); return; }
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    const vis = visibleHosts();
    if (vis.length === 0) return;
    const i = selected === null ? -1 : vis.indexOf(selected);
    const next = ev.key === "ArrowDown" ? Math.min(vis.length - 1, i + 1) : Math.max(0, i - 1);
    select(vis[next] ?? null);
  }
});
