/**
 * Objetivo do agente no WhatsApp (tutorial 8): tudo mora na máquina (objetivo.json, skill no workspace do agente).
 * Aqui ficam o estado lido da máquina, as ações (ler, gravar, salvar a skill) e os três passos do guia.
 */
import type { ObjectiveChoice, ObjectiveInfo } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { LEVEL_OPTIONS, OBJECTIVE_OPTIONS } from "../lib/objetivo.js";
import { ctx, ehRemoto } from "../app/ctx.js";
import { registrarFonte } from "../tutoriais/fontes.js";
import { registrarPassos } from "../tutoriais/passos.js";

export let objectiveState: ObjectiveInfo | null = null;
/** Último recado do tutorial 8 (erro ou "skill salva"). */
export let objectiveMsg: { text: string; bad: boolean } | null = null;
/** Rascunho do passo 1 antes de "Salvar objetivo" (cartão marcado e frase digitada). */
export let objectiveDraft: { id: string; text: string } | null = null;
/** Quem muda de fora (o reset do tutorial, o Acervo) usa estas funções: import não se grava. */
export function setObjectiveState(v: ObjectiveInfo | null): void { objectiveState = v; }
export function setObjectiveMsg(v: { text: string; bad: boolean } | null): void { objectiveMsg = v; }
export function setObjectiveDraft(v: { id: string; text: string } | null): void { objectiveDraft = v; }

export let objectiveBusy = false;
export async function refreshObjective(): Promise<void> {
  if (ctx.windowHost === "" || ctx.windowHost === "local" || !ctx.caps.install) return;
  try { objectiveState = await window.meuBot.objectiveInfo(); } catch { /* sem resposta: fica o que havia */ }
  ctx.paintAcervoCount(); ctx.paintGuide();
  if (ctx.pageShown(ctx.acervoPage)) ctx.acervoPage.render();
}
export async function objectiveDo(run: () => Promise<ObjectiveInfo>, okText: string | null): Promise<void> {
  if (objectiveBusy) return;
  objectiveBusy = true; objectiveMsg = null; ctx.paintGuide();
  try { objectiveState = await run(); objectiveMsg = okText === null ? null : { text: okText, bad: false }; }
  catch (err) { objectiveMsg = { text: ipcErrorText(err), bad: true }; }
  finally { objectiveBusy = false; ctx.paintAcervoCount(); ctx.paintGuide(); if (ctx.pageShown(ctx.acervoPage)) ctx.acervoPage.render(); }
}

/** Tutorial 8, passo 1: cartões de objetivo + frase, "Salvar objetivo" grava na máquina. */
export function renderObjectiveChoice(container: HTMLElement): void {
  const cur = objectiveState?.objective ?? null;
  const draft = objectiveDraft ?? (cur === null ? null : { id: cur.id, text: cur.text });
  const cards = el("div", "reply-cards guide-cards");
  for (const o of OBJECTIVE_OPTIONS) {
    const on = draft?.id === o.id;
    const card = el("button", `reply-card${on ? " on" : ""}`); card.type = "button"; card.disabled = objectiveBusy;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(on));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.label));
    if (cur?.id === o.id) title.append(el("span", "reply-default", "Salvo"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(el("span", "reply-radio"), body);
    card.addEventListener("click", () => { objectiveDraft = { id: o.id, text: draft?.id === o.id ? draft.text : (cur?.id === o.id ? cur.text : "") }; ctx.paintGuide(); });
    cards.append(card);
  }
  container.append(cards);
  const row = el("div", "support-name");
  const opt = OBJECTIVE_OPTIONS.find((o) => o.id === draft?.id) ?? null;
  const input = el("input"); input.type = "text"; input.maxLength = 300; input.disabled = objectiveBusy || draft === null;
  input.placeholder = opt?.needsText === true ? "Em uma frase: o que o agente deve resolver (obrigatório)" : "Complete em uma frase, se quiser";
  input.value = draft?.text ?? "";
  input.addEventListener("input", () => { if (objectiveDraft !== null) objectiveDraft.text = input.value; else if (draft !== null) objectiveDraft = { id: draft.id, text: input.value }; });
  const save = el("button", "btn btn-primary btn-small", cur === null ? "Salvar objetivo" : "Salvar mudança"); save.type = "button";
  save.disabled = objectiveBusy || draft === null || (opt?.needsText === true && input.value.trim() === "");
  input.addEventListener("input", () => { save.disabled = objectiveBusy || (opt?.needsText === true && input.value.trim() === ""); });
  save.addEventListener("click", () => {
    if (draft === null || opt === null) return;
    const choice: ObjectiveChoice = { id: opt.id, label: opt.label, text: input.value.trim() };
    void objectiveDo(() => window.meuBot.setObjective({ objective: choice }), null).then(() => { objectiveDraft = null; ctx.paintGuide(); });
  });
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !save.disabled) { ev.preventDefault(); save.click(); } });
  row.append(input, save);
  container.append(row);
  if (objectiveMsg !== null && objectiveMsg.bad) container.append(el("p", "hint bad", `✗ ${objectiveMsg.text}`));
}
/** Tutorial 8, passo 2: os três níveis; clicar grava na hora (como "quem o agente responde"). */
export function renderObjectiveLevel(container: HTMLElement): void {
  const cur = objectiveState?.level ?? null;
  const cards = el("div", "reply-cards guide-cards");
  for (const o of LEVEL_OPTIONS) {
    const on = cur === o.id;
    const card = el("button", `reply-card${on ? " on" : ""}`); card.type = "button"; card.disabled = objectiveBusy;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(on));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(el("span", "reply-radio"), body);
    card.addEventListener("click", () => { if (cur !== o.id) void objectiveDo(() => window.meuBot.setObjective({ level: o.id }), null); });
    cards.append(card);
  }
  container.append(cards);
  if (objectiveMsg !== null && objectiveMsg.bad) container.append(el("p", "hint bad", `✗ ${objectiveMsg.text}`));
}
/** Tutorial 8, passo 3: resumo do que vai para a skill e o botão que grava no workspace do agente. */
export function renderObjectiveSkill(container: HTMLElement): void {
  const st = objectiveState;
  const box = el("div", "audio-controls");
  if (st?.objective !== null && st?.objective !== undefined && st.level !== null) {
    const lv = LEVEL_OPTIONS.find((l) => l.id === st.level);
    box.append(el("div", "hint", `🎯 ${st.objective.label}${st.objective.text !== "" ? `: ${st.objective.text}` : ""}`), el("div", "hint", `🔒 ${lv?.title ?? st.level}`));
  }
  const save = el("button", "btn btn-primary btn-small", objectiveBusy ? "Salvando…" : st?.savedAt === null || st?.savedAt === undefined ? "Salvar como skill no Acervo" : "Salvar de novo"); save.type = "button";
  save.disabled = objectiveBusy || st?.objective === null || st?.level === null;
  save.addEventListener("click", () => { void objectiveDo(async () => { const r = await window.meuBot.saveObjectiveSkill(); objectiveMsg = { text: r.detail, bad: false }; return r; }, "skill salva"); });
  const row = el("div", "support-name"); row.append(save);
  if (st?.savedAt !== null && st?.savedAt !== undefined) {
    const open = el("button", "btn btn-ghost btn-small", "Abrir o Acervo"); open.type = "button";
    open.addEventListener("click", () => ctx.openPage(ctx.acervoPage));
    row.append(open);
  }
  box.append(row);
  if (objectiveMsg !== null) box.append(el("p", `hint${objectiveMsg.bad ? " bad" : " ok"}`, `${objectiveMsg.bad ? "✗" : "✓"} ${objectiveMsg.text}`));
  container.append(box);
}

/** Liga os três passos do objetivo ao guia; o renderer.ts chama uma vez. */
export function ligarObjetivoGuia(): void {
  registrarFonte("objective", () => ({ known: objectiveState !== null || !ehRemoto(), dados: { objective: objectiveState } }));
  registrarPassos({
    "objective-choice": (txt) => renderObjectiveChoice(txt),
    "objective-level": (txt) => renderObjectiveLevel(txt),
    "objective-skill": (txt) => renderObjectiveSkill(txt),
  });
}
