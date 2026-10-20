/**
 * Variante: admin (só o super admin). Auditoria no seletor: as máquinas da central e, para cada uma, a história
 * (quem fez o quê, entregue por quem), o selo da corrente (central e máquina), as linhas que sumiram da máquina e
 * a exportação da prova. Fábrica com dependências explícitas, como produtos-page.ts.
 */
import type { AuditoriaMaquinaView, AuditoriaVisao, PickerApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface AuditoriaViewDeps {
  container: HTMLElement;
  api: Pick<PickerApi, "auditoriaMaquinas" | "auditoriaRegistro" | "auditoriaExportar">;
}
const TIPOS: Record<string, string> = { dono: "dono", admin: "admin", agente: "agente", sistema: "sistema", legado: "antigo" };
const quando = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); };

export function mountAuditoriaView(deps: AuditoriaViewDeps): { refresh: () => Promise<void> } {
  const box = deps.container;
  let maquinas: AuditoriaMaquinaView[] = [];
  let erro: string | null = null;
  let aberta: string | null = null;
  let visao: AuditoriaVisao | null = null;
  let carregando = false;
  let filtroTipo = "";
  let filtroTexto = "";
  let msg = "";

  const selo = (v: AuditoriaVisao): HTMLElement => {
    const s = el("div", "auditoria-selos");
    s.append(el("span", `auditoria-selo ${v.centralQuebraEm === null ? "ok" : "bad"}`, v.centralQuebraEm === null ? "✓ central íntegra" : `✗ central adulterada a partir do registro ${v.centralQuebraEm}`));
    if (!v.maquinaLida) s.append(el("span", "auditoria-selo", v.maquinaErro !== null ? `máquina não lida: ${v.maquinaErro}` : "máquina não lida (suporte desligado)"));
    else s.append(el("span", `auditoria-selo ${v.maquinaQuebraEm === null ? "ok" : "bad"}`, v.maquinaQuebraEm === null ? "✓ cópia da máquina íntegra" : `✗ cópia da máquina adulterada (linha ${v.maquinaQuebraEm + 1})`));
    if (v.faltamNaMaquina > 0) s.append(el("span", "auditoria-selo bad", `✗ ${v.faltamNaMaquina} registro(s) apagado(s) da máquina`));
    return s;
  };

  const desenhar = (): void => {
    box.replaceChildren();
    box.append(el("p", "hint", "Tudo o que o dono, cada admin, o agente e o sistema fizeram em cada máquina. A cópia central só aceita linhas novas: ninguém apaga nem edita por SSH."));
    if (erro !== null) { box.append(el("p", "hint guide-pair-note", `Central de auditoria: ${erro}`)); return; }
    if (maquinas.length === 0) { box.append(el("p", "hint", carregando ? "Lendo a central…" : "Nenhuma máquina com registro ainda.")); return; }
    const ul = el("ul", "auditoria-maquinas");
    for (const m of maquinas) {
      const li = el("li", `auditoria-maquina${aberta === m.maquina ? " aberta" : ""}`);
      const b = el("button", "linkish", `${m.nome ?? `máquina ${m.maquina}`}`); b.type = "button";
      b.addEventListener("click", () => { void abrir(m.maquina); });
      li.append(b, el("span", "hint", ` · ${m.registros} registro(s)${m.ultimo !== "" ? ` · último ${quando(m.ultimo)}` : ""}${m.on ? "" : " · suporte desligado"}`));
      ul.append(li);
      if (aberta === m.maquina) li.append(detalhe());
    }
    box.append(ul);
  };

  const detalhe = (): HTMLElement => {
    const d = el("div", "auditoria-detalhe");
    if (visao === null) { d.append(el("p", "hint", "Lendo o registro…")); return d; }
    const v = visao;
    d.append(selo(v));
    const barra = el("div", "auditoria-barra");
    const tipo = el("select") as HTMLSelectElement;
    for (const [id, label] of [["", "todos"], ["dono", "dono"], ["admin", "admins"], ["agente", "agente"], ["sistema", "sistema"], ["legado", "antigos"]]) { const o = el("option", "", label) as HTMLOptionElement; o.value = id!; o.selected = filtroTipo === id; tipo.append(o); }
    tipo.addEventListener("change", () => { filtroTipo = tipo.value; desenhar(); });
    const busca = el("input") as HTMLInputElement; busca.type = "search"; busca.placeholder = "filtrar (nome, número, ação…)"; busca.value = filtroTexto;
    busca.addEventListener("input", () => { filtroTexto = busca.value; const pos = busca.selectionStart; desenhar(); const nova = box.querySelector<HTMLInputElement>(".auditoria-barra input[type=search]"); nova?.focus(); if (pos !== null) nova?.setSelectionRange(pos, pos); });
    const exp = el("button", "btn btn-ghost btn-small", "Exportar prova"); exp.type = "button";
    exp.addEventListener("click", () => { exp.disabled = true; void deps.api.auditoriaExportar(v.maquina).then((r) => { msg = r === null ? "" : `✓ salvo em ${r.path} (e o .csv ao lado)`; desenhar(); }).catch((e: unknown) => { msg = `✗ ${ipcErrorText(e)}`; desenhar(); }); });
    barra.append(tipo, busca, exp);
    d.append(barra);
    if (msg !== "") d.append(el("p", "hint", msg));
    const q = filtroTexto.trim().toLowerCase();
    const linhas = v.linhas.filter((l) => (filtroTipo === "" || l.quemTipo === filtroTipo) && (q === "" || `${l.quemNome} ${l.texto} ${l.detalhe} ${l.acao} ${l.via}`.toLowerCase().includes(q)));
    const t = el("table", "auditoria-tabela");
    const cab = el("tr"); for (const h of ["Quando", "Quem", "O quê", "Entregue por", "Máquina"]) cab.append(el("th", "", h));
    t.append(cab);
    for (const l of linhas) {
      const tr = el("tr", l.naMaquina === false ? "apagada" : "");
      const o = el("td", "", l.texto); if (l.detalhe !== "") o.title = l.detalhe;
      tr.append(el("td", "", quando(l.em)), el("td", "", `${l.quemNome || "—"} (${TIPOS[l.quemTipo] ?? l.quemTipo})`), o, el("td", "hint", `${l.via} · ${quando(l.recebidoEm)}`), el("td", "", l.naMaquina === null ? "—" : l.naMaquina ? "✓" : "apagada"));
      t.append(tr);
    }
    d.append(linhas.length === 0 ? el("p", "hint", "Nada com esse filtro.") : t);
    return d;
  };

  const abrir = async (maquina: string): Promise<void> => {
    if (aberta === maquina) { aberta = null; visao = null; desenhar(); return; }
    aberta = maquina; visao = null; msg = ""; desenhar();
    try { const v = await deps.api.auditoriaRegistro(maquina); if (aberta === maquina) visao = v; }
    catch (e) { if (aberta === maquina) { aberta = null; erro = ipcErrorText(e); } }
    desenhar();
  };

  const refresh = async (): Promise<void> => {
    carregando = true; desenhar();
    try { const r = await deps.api.auditoriaMaquinas(); maquinas = r.maquinas; erro = r.erro; }
    catch (e) { erro = ipcErrorText(e); }
    carregando = false; desenhar();
  };
  return { refresh };
}
