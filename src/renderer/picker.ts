/** Seletor de máquinas: lista imediata, sondagens em paralelo, teclado completo. */
import type { HostProbe, PickerApi, PickerInit } from "../shared/ipc";
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
const logEl = $<HTMLPreElement>("pk-log");
const openBtn = $<HTMLButtonElement>("pk-open");
const cancelBtn = $<HTMLButtonElement>("pk-cancel");
const pickerShortcutBtn = $<HTMLButtonElement>("pk-shortcut");

interface Row { host: string; li: HTMLLIElement; badgeEl: HTMLSpanElement; shortcutBtn: HTMLButtonElement }
let shortcuts = new Map<string, string | null>();
const SELETOR = "seletor";

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
    const shortcutBtn = el("button", "shortcut");
    shortcutBtn.type = "button";
    shortcutBtn.addEventListener("click", (ev) => { ev.stopPropagation(); void toggleShortcut(host, shortcutBtn); });
    li.append(dot, name, badge, shortcutBtn);
    li.addEventListener("click", () => select(host));
    li.addEventListener("dblclick", () => { select(host); void open(); });
    listEl.appendChild(li);
    rows.set(host, { host, li, badgeEl: badge, shortcutBtn });
    paintShortcut(host);
  }
  applyFilter();
}

function paintShortcut(host: string): void {
  const btn = host === SELETOR ? pickerShortcutBtn : rows.get(host)?.shortcutBtn;
  if (btn === undefined) return;
  const has = shortcuts.has(host);
  const emoji = shortcuts.get(host) ?? null;
  btn.textContent = has ? (emoji ?? "★") : "+";
  btn.classList.toggle("on", has);
  btn.setAttribute("aria-label", has ? "remover atalho da área de trabalho" : "criar atalho na área de trabalho");
  btn.title = has ? `Remover "${host}.app" da área de trabalho` : `Criar "${host}.app" na área de trabalho, que abre ${host === SELETOR ? "só este seletor" : `direto a janela de ${hostLabel(host)}`}`;
}

async function toggleShortcut(host: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    const r = await window.picker.setShortcut(host, !shortcuts.has(host));
    if (r.has) shortcuts.set(host, r.emoji); else shortcuts.delete(host);
    errorEl.hidden = true;
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = `Atalho: ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(err)}`;
  } finally {
    btn.disabled = false;
    paintShortcut(host);
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
  } catch (err) {
    results.set(host, { kind: "bad", text: `✗ ${hostLabel(host)}: ${err instanceof Error ? err.message : String(err)}`, install: null, canOpen: false });
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
    results.set(host, { kind: "bad", text: `✗ instalação falhou: ${err instanceof Error ? err.message : String(err)}`, install: "install", canOpen: false });
    paintState(host);
    return;
  } finally {
    installing = false;
  }
  await probe(host, true);
}

function init(payload: PickerInit): void {
  hosts = payload.hosts;
  openHosts = new Set(payload.open);
  shortcuts = new Map(payload.shortcuts.map((s) => [s.host, s.emoji]));
  paintShortcut(SELETOR);
  errorEl.hidden = payload.error === null;
  errorEl.textContent = payload.error ?? "";
  buildRows();
  select(hosts.includes(payload.preselect) ? payload.preselect : (hosts[0] ?? null));
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
openBtn.addEventListener("click", () => { void open(); });
cancelBtn.addEventListener("click", () => window.picker.cancel());
pickerShortcutBtn.addEventListener("click", () => { void toggleShortcut(SELETOR, pickerShortcutBtn); });
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
