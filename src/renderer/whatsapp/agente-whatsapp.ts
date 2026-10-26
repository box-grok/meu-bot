import type { WhatsappStatus, WhatsappReplyChoice, VoiceReplyMode, VozId, AudioSetup, WhatsappEvent } from "../../shared/ipc";
import { byId as $, el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";
import { replyChoiceOf, REPLY_OPTIONS, listedNumbers, parseWaNumbers, TUTORIAIS } from "../lib/tutoriais.js";
import { ctx } from "../app/ctx.js";

const waLine = $<HTMLButtonElement>("wa-line");
export const waDialog = $<HTMLDialogElement>("wa-dialog");
const waStatusEl = $<HTMLParagraphElement>("wa-status");
export const waQr = $<HTMLImageElement>("wa-qr");
const waHow = $<HTMLParagraphElement>("wa-how");
export const waSuccess = $<HTMLElement>("wa-success");
const waSuccessText = $<HTMLElement>("wa-success-text");
export const waProgress = $<HTMLElement>("wa-progress");
export const waProgressText = $<HTMLElement>("wa-progress-text");
const waProgressMeta = $<HTMLElement>("wa-progress-meta");
/**
 * QR da vez: quantos já vieram, quando chegou o último e quanto os próximos duram. O WhatsApp Web dá ~60 s ao
 * primeiro QR e ~20 s aos seguintes; o ciclo é medido só entre QRs seguintes (medir o 1º→2º, de 60 s, fazia
 * a contagem do 2º trocar de imagem no meio). A previsão nunca é exata: passou do tempo, mostra "renovando…".
 */
const WA_QR_FIRST = 60_000;
let waQrCount = 0; let waQrAt = 0; let waQrEvery = 20_000;
let waTick: ReturnType<typeof setInterval> | null = null;
function setWaProgress(text: string, tone: "run" | "ok" | "bad" = "run"): void {
  waProgress.hidden = false;
  waProgress.className = `wa-progress${tone === "run" ? "" : ` ${tone}`}`;
  waProgressText.textContent = text;
}
function paintWaMeta(): void {
  if (waQrCount === 0 || !waPairing || waConnected) { waProgressMeta.textContent = ""; return; }
  const left = Math.ceil((waQrAt + (waQrCount === 1 ? WA_QR_FIRST : waQrEvery) - Date.now()) / 1000);
  waProgressMeta.textContent = left > 0 ? `QR ${waQrCount} · renova em ${left} s` : `QR ${waQrCount} · renovando…`;
}
function resetWaProgress(): void {
  waQrCount = 0; waQrAt = 0; waQrEvery = 20_000;
  if (waTick !== null) { clearInterval(waTick); waTick = null; }
  waProgressMeta.textContent = "";
}
export const waPairBtn = $<HTMLButtonElement>("wa-pair");
const waResetBtn = $<HTMLButtonElement>("wa-reset");
const waCloseBtn = $<HTMLButtonElement>("wa-close");
export const waAgentBtn = $<HTMLButtonElement>("wa-agent");
const waRefreshBtn = $<HTMLButtonElement>("wa-refresh");
export const waPolicyBox = $<HTMLElement>("wa-policy");
const waPolicyHint = $<HTMLElement>("wa-policy-hint");
export const waPolicyCards = $<HTMLElement>("wa-policy-cards");
const waPolicyEditor = $<HTMLElement>("wa-policy-editor");
export let waPolicySaving = false;
/** Pedido ao agente da máquina para ajustar o canal do WhatsApp por conversa, em vez do editor técnico de JSON. */
function waChannelPrompt(st: WhatsappStatus): string {
  return [
    "Quero ajustar o WhatsApp (OpenClaw) desta máquina conversando, sem eu editar JSON.",
    st.number !== null ? `Número conectado: ${fmtPhone(st.number)}.` : "",
    "Config atual do canal:",
    "```json\n" + (st.channelConfig ?? "{}") + "\n```",
    "Você pode alterar `channels.whatsapp` com `openclaw config set <caminho> <valor> --strict-json` (valide antes com `--dry-run`; nunca reinicie o gateway na mão, as mudanças valem sozinhas).",
    "Me diga em uma frase o que dá para mudar (quem o agente responde, lista de números permitidos, grupos, limite de mídia) e espere eu pedir. Não mude nada antes de eu confirmar.",
  ].filter((l) => l !== "").join("\n");
}
/** Botão que leva ao chat para ajustar o canal em linguagem natural (reaproveitado no guia e no modal). */
export function renderChannelEditor(host: HTMLElement): void {
  const st = ctx.waStatus;
  if (st === null || !st.connected) return;
  const row = el("div", "channel-chat");
  const btn = el("button", "btn btn-ghost btn-small", "Ajustar pelo chat"); btn.type = "button";
  btn.title = "Abre uma conversa com o agente desta máquina para mudar a configuração do WhatsApp pedindo em português";
  btn.addEventListener("click", () => {
    void (async () => { const tab = await ctx.newTab(); await ctx.sendText(tab, waChannelPrompt(st)); })();
  });
  row.append(btn, el("span", "hint", "Peça em português: quem responde, números permitidos, grupos…"));
  host.append(row);
}
/** Os dois cartões de rádio (só você / todo mundo), iguais no modal e no guia; o escolhido fica verde. */
/** Cartão sendo gravado nesta hora (mostra o spinner e a seleção otimista); null = nenhum. */
let waPolicyTarget: WhatsappReplyChoice | null = null;
/** Último erro ao aplicar um cartão: aparece embaixo dos cartões (guia e modal), não só no texto do modal. */
let waPolicyError: string | null = null;
/** "Só alguns contatos": a lista está aberta para edição (o cartão foi clicado, ainda sem salvar), o rascunho e o último erro. */
let waListEditing = false;
let waListDraft: string | null = null;
let waListError: string | null = null;
/** O cartão marcado hoje, pelo que está gravado na máquina. */
export const replyChoiceNow = (st: WhatsappStatus): WhatsappReplyChoice | null => replyChoiceOf(st.dmPolicy, st.allowFrom, st.number);
export function renderReplyCards(container: HTMLElement, current: WhatsappReplyChoice | null, disabled: boolean, onChoose: (c: WhatsappReplyChoice) => void): void {
  container.replaceChildren();
  // Máquina cujo agente não deixa escolher pelo app (capacidade, não produto): diz isso em vez de cartões que falhariam.
  if (ctx.waStatus !== null && !ctx.waStatus.capacidades.politicaDm) { container.append(el("p", "hint", `O agente desta máquina (${ctx.waStatus.gateway ?? "desconhecido"}) não permite escolher quem responde pelo app.`)); return; }
  const marked = waPolicyTarget ?? (waListEditing ? "list" : current); // otimista: enquanto grava, o cartão clicado já aparece marcado
  for (const o of REPLY_OPTIONS) {
    const saving = waPolicyTarget === o.id;
    const card = el("button", `reply-card${marked === o.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = disabled; card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(marked === o.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    if (saving) title.append(el("span", "reply-saving", "aplicando…"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    if (o.id === "list" && current === "list" && ctx.waStatus !== null && !waListEditing) {
      const nums = listedNumbers(ctx.waStatus.allowFrom, ctx.waStatus.number);
      body.append(el("p", "reply-list-now", `Na lista: ${nums.map((n) => fmtPhone(n)).join(", ")}. Clique para mudar.`));
    }
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => onChoose(o.id));
    container.append(card);
    // A lista editável fica fora do cartão (botão não pode conter campo de texto).
    if (o.id === "list" && waListEditing) container.append(renderListEditor(disabled));
  }
  if (waPolicyError !== null) container.append(el("p", "hint bad-hint", waPolicyError));
  else if (ctx.waStatus?.capacidades.politicaReinicia === true && waPolicySaving) container.append(el("p", "hint", "Trocar o modo reinicia o gateway do WhatsApp desta máquina: leva alguns segundos."));
}
/** Campo da lista: um número por linha; "Salvar lista" grava a allowlist (você entra sempre). */
function renderListEditor(disabled: boolean): HTMLElement {
  const box = el("div", "wa-list-editor");
  const ta = document.createElement("textarea"); ta.className = "wa-list-input"; ta.rows = 3;
  ta.placeholder = "Um número por linha, com DDD: 11 99999-9999 (o +55 entra sozinho) ou +1 212 555 0100";
  ta.value = waListDraft ?? (ctx.waStatus === null ? "" : listedNumbers(ctx.waStatus.allowFrom, ctx.waStatus.number).map((n) => `+${n}`).join("\n"));
  ta.disabled = disabled;
  ta.addEventListener("input", () => { waListDraft = ta.value; waListError = null; });
  const row = el("div", "wa-list-row");
  const save = el("button", "btn btn-primary btn-small", waPolicySaving ? "Aplicando…" : "Salvar lista"); save.type = "button"; save.disabled = disabled;
  save.addEventListener("click", () => { void saveReplyList(ta.value); });
  const cancel = el("button", "btn btn-ghost btn-small", "Cancelar"); cancel.type = "button"; cancel.disabled = disabled;
  cancel.addEventListener("click", () => { waListEditing = false; waListDraft = null; waListError = null; paintWhatsapp(); });
  row.append(save, cancel);
  box.append(ta, row, el("p", waListError === null ? "hint" : "hint bad-hint", waListError ?? "Você fica na lista sempre. Vale na hora, sem reiniciar nada."));
  return box;
}
async function saveReplyList(text: string): Promise<void> {
  if (waPolicySaving) return;
  const { ok, bad } = parseWaNumbers(text);
  if (bad.length > 0) { waListError = `não entendi: ${bad.join(", ")} (use só dígitos, com DDD; de fora do Brasil, comece com +)`; paintWhatsapp(); return; }
  if (ok.length === 0) { waListError = "a lista está vazia; para só você falar com o agente, use o primeiro cartão"; paintWhatsapp(); return; }
  for (const t of TUTORIAIS) if (t.steps.some((st) => st.target === "wa-policy")) ctx.saveGuideFlag(t, "policyChosen");
  waPolicySaving = true; waPolicyTarget = "list"; waListError = null; paintWhatsapp();
  try { ctx.waStatus = await window.meuBot.whatsappSetDmPolicy("list", ok); waListEditing = false; waListDraft = null; }
  catch (err) { waListError = `✗ ${err instanceof Error ? err.message : String(err)}`; }
  finally { waPolicySaving = false; waPolicyTarget = null; paintWhatsapp(); }
}
/** Quando o agente responde em áudio (os três cartões). */
const VOICE_OPTIONS: readonly { id: VoiceReplyMode; title: string; text: string; isDefault: boolean }[] = [
  { id: "off", title: "Nunca", text: "Responde sempre em texto.", isDefault: true },
  { id: "inbound", title: "Quando receber áudio", text: "Áudio vira áudio; texto continua texto.", isDefault: false },
  { id: "always", title: "Sempre", text: "Toda resposta vira nota de voz.", isDefault: false },
];
/** Vozes (cópia mínima de src/main/vozes-core.ts; o teste confere que batem). */
const VOZES_UI: readonly { id: VozId; rotulo: string; texto: string; padrao: boolean }[] = [
  { id: "faber", rotulo: "Masculina", texto: "Voz local (Piper). Na primeira vez baixa ~70 MB.", padrao: true },
  { id: "dora", rotulo: "Feminina", texto: "Voz local natural (Kokoro). Na primeira vez baixa ~350 MB.", padrao: false },
  { id: "alex", rotulo: "Masculina natural", texto: "Voz local natural (Kokoro). Na primeira vez baixa ~350 MB.", padrao: false },
];
/** Voz escolhida com o áudio desligado: guardada aqui e aplicada ao ligar. */
let waVozEscolhida: VozId | null = null;
let waVozBusy: VozId | null = null;
/** O que está sendo aplicado agora ("in" = transcrição; um modo = voz) e o último recado (erro ou aviso). */
let waAudioBusy: "in" | VoiceReplyMode | null = null;
let waAudioMsg: { text: string; bad: boolean } | null = null;
/**
 * Áudio do agente do WhatsApp: ouvir (transcrição local, faster-whisper) e falar (voz local, Piper), com quando
 * responder em áudio. Usado no passo do tutorial e no painel de gerência; os instaladores rodam na máquina.
 */
export function renderAudioControls(container: HTMLElement): void {
  const st = ctx.waStatus;
  const box = el("div", "audio-controls");
  const hear = el("div", "audio-row");
  hear.append(el("strong", "", "Ouvir áudios"));
  const hermes = st?.gateway === "hermes";
  if (st?.audioIn === true) hear.append(el("span", "audio-ok", hermes ? "✓ ativo: o Hermes transcreve os áudios (config.yaml › stt)" : "✓ ativo: a transcrição roda na própria máquina"));
  else if (hermes) hear.append(el("span", "hint", "desligado no Hermes (config.yaml › stt.enabled); liga-se com `hermes setup`, não pelo meu-bot"));
  else {
    const b = el("button", "btn btn-primary btn-small", waAudioBusy === "in" ? "Ativando… (na primeira vez baixa ~500 MB)" : "Ativar transcrição");
    b.type = "button"; b.disabled = waAudioBusy !== null || st === null || !st.connected;
    b.addEventListener("click", () => { void runAudioSetup({ kind: "in" }); });
    hear.append(b);
  }
  box.append(hear);
  box.append(el("p", "hint strong-hint", "Responder em áudio"));
  if (hermes) {
    // No Hermes a voz é dele (voice.auto_tts): só mostra, sem os cartões (os instaladores são do OpenClaw).
    box.append(el("p", "hint", st?.audioOut === "inbound" ? "✓ o Hermes responde em áudio quando a pessoa manda áudio (voice.auto_tts)" : "desligado no Hermes (voice.auto_tts); muda-se com `hermes setup`, não pelo meu-bot"));
    if (waAudioMsg !== null) box.append(el("p", `hint ${waAudioMsg.bad ? "guide-pair-note" : "audio-ok"}`, waAudioMsg.text));
    container.append(box);
    return;
  }
  const cards = el("div", "reply-cards voice-cards");
  const current = st?.audioOut ?? "off";
  const marked = waAudioBusy !== null && waAudioBusy !== "in" ? waAudioBusy : current;
  for (const o of VOICE_OPTIONS) {
    const saving = waAudioBusy === o.id;
    const card = el("button", `reply-card${marked === o.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = waAudioBusy !== null || st === null || !st.connected;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(marked === o.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", o.title));
    if (o.isDefault) title.append(el("span", "reply-default", "Padrão"));
    if (saving) title.append(el("span", "reply-saving", o.id === "off" ? "aplicando…" : "instalando a voz…"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", o.text));
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => { if (o.id !== current) void runAudioSetup({ kind: "out", mode: o.id, ...(o.id !== "off" ? { voz: waVozEscolhida ?? st?.audioVoice ?? "faber" } : {}) }); });
    cards.append(card);
  }
  box.append(cards);
  // Voz: com o áudio ligado, troca na hora; desligado, fica guardada para quando ligar. Todas rodam na máquina.
  box.append(el("p", "hint strong-hint", "Voz"));
  const vozes = el("div", "reply-cards voice-cards");
  const vozAtual: VozId = waVozBusy ?? waVozEscolhida ?? st?.audioVoice ?? "faber";
  for (const v of VOZES_UI) {
    const saving = waVozBusy === v.id;
    const card = el("button", `reply-card${vozAtual === v.id ? " on" : ""}${saving ? " saving" : ""}`);
    card.type = "button"; card.disabled = waAudioBusy !== null || waVozBusy !== null || st === null || !st.connected;
    card.setAttribute("role", "radio"); card.setAttribute("aria-checked", String(vozAtual === v.id));
    const title = el("div", "reply-title"); title.append(el("strong", "", v.rotulo));
    if (v.padrao) title.append(el("span", "reply-default", "Padrão"));
    if (saving) title.append(el("span", "reply-saving", "instalando a voz…"));
    const body = el("div", "reply-body"); body.append(title, el("p", "", v.texto));
    card.append(saving ? el("span", "reply-spin") : el("span", "reply-radio"), body);
    card.addEventListener("click", () => {
      if (v.id === vozAtual) return;
      waVozEscolhida = v.id;
      if (current === "off") { waAudioMsg = { text: `Voz ${v.rotulo.toLowerCase()} escolhida: vale quando ligar a resposta em áudio.`, bad: false }; ctx.paintGuide(); return; }
      waVozBusy = v.id; ctx.paintGuide();
      void runAudioSetup({ kind: "out", mode: current, voz: v.id }).finally(() => { waVozBusy = null; ctx.paintGuide(); });
    });
    vozes.append(card);
  }
  box.append(vozes, el("div", "guide-note", "Todas as vozes rodam na própria máquina, sem custo; o texto das respostas não sai dela."));
  if (waAudioMsg !== null) box.append(el("p", `hint ${waAudioMsg.bad ? "guide-pair-note" : "audio-ok"}`, waAudioMsg.text));
  container.append(box);
}
async function runAudioSetup(setup: AudioSetup): Promise<void> {
  if (waAudioBusy !== null) return;
  waAudioBusy = setup.kind === "in" ? "in" : waVozBusy !== null ? null : setup.mode; waAudioMsg = null;
  ctx.paintGuide();
  try {
    const r = await window.meuBot.whatsappAudio(setup);
    waAudioMsg = { text: r.log.at(-1) ?? (r.ok ? "pronto" : "não deu certo"), bad: !r.ok };
    await refreshWhatsapp();
  } catch (err) {
    waAudioMsg = { text: ipcErrorText(err), bad: true };
  } finally { waAudioBusy = null; ctx.paintGuide(); }
}
export function chooseReply(choice: WhatsappReplyChoice): void {
  if (waPolicySaving) return;
  // "Só alguns contatos" abre a lista para a pessoa preencher; grava só no "Salvar lista".
  if (choice === "list") { waListEditing = true; waListError = null; paintWhatsapp(); return; }
  waListEditing = false; waListDraft = null; waListError = null;
  for (const t of TUTORIAIS) if (t.steps.some((st) => st.target === "wa-policy")) ctx.saveGuideFlag(t, "policyChosen");
  if (ctx.waStatus !== null && replyChoiceNow(ctx.waStatus) === choice) { waPolicyError = null; paintWhatsapp(); return; }
  waPolicySaving = true; waPolicyTarget = choice; waPolicyError = null; paintWhatsapp(); // seleção na hora + spinner no cartão
  void window.meuBot.whatsappSetDmPolicy(choice)
    .then((st) => { ctx.waStatus = st; if (replyChoiceNow(st) !== choice) waPolicyError = `✗ a máquina ficou em "${st.dmPolicy ?? "?"}", não no que você escolheu. Tente de novo.`; })
    .catch((err: unknown) => { waPolicyError = `✗ ${err instanceof Error ? err.message : String(err)}`; waStatusEl.textContent = waPolicyError; })
    .finally(() => { waPolicySaving = false; waPolicyTarget = null; paintWhatsapp(); });
}
function paintWaPolicy(): void {
  const st = ctx.waStatus;
  const show = st !== null && st.capacidades.politicaDm && st.connected && st.dmPolicy !== null && !waPairing;
  waPolicyBox.hidden = !show;
  if (!show || st === null) return;
  renderReplyCards(waPolicyCards, replyChoiceNow(st), waPolicySaving, chooseReply);
  waPolicyEditor.replaceChildren(); renderChannelEditor(waPolicyEditor);
  waPolicyHint.textContent = waPolicySaving ? "Aplicando na máquina…"
    : st.dmPolicy === "pairing" ? "Hoje está no padrão do OpenClaw: quem manda mensagem recebe um código de pareamento e espera aprovação. Escolha uma das opções para mudar."
    : st.dmPolicy === "disabled" ? "Hoje está tudo desligado, inclusive suas próprias mensagens. Escolha uma das opções."
    : "Vale na hora, sem reiniciar nada. Grupos continuam desativados.";
}

/**
 * Pedido pronto ao agente da máquina (Claude Code em bypass): ele configura o OpenClaw e instala o plugin;
 * o pareamento (QR) fica com o app. Idempotente por instrução: pular o que já está feito.
 */
function waAgentPrompt(st: WhatsappStatus): string {
  if (st.gateway === "hermes") {
    return [
      "Prepare o Hermes desta máquina para o WhatsApp, sem parear (o QR eu faço pelo meu-bot).",
      "Falta: " + (st.missing ?? "o bridge do WhatsApp") + ".",
      "Verifique a instalação do hermes-agent em ~/.local/lib/node_modules/hermes-agent e garanta o bridge em runtime/hermes-agent/scripts/whatsapp-bridge/bridge.js (reinstale o pacote se preciso, sem mexer no backend do meu-bot nem reiniciar o gateway à mão).",
      "No fim, resuma o que fez e o que ainda falta. Não pareie o WhatsApp.",
    ].join("\n");
  }
  return [
    "Prepare o OpenClaw desta máquina para o WhatsApp, sem interação e sem parear (o QR eu faço pelo meu-bot).",
    "Encontrado: " + st.agent + ".",
    "Falta:\n" + (st.missing ?? "?").split("\n").map((l) => "- " + l).join("\n"),
    "",
    "Passos (pule o que já estiver feito):",
    "1. Se não houver ~/.openclaw/openclaw.json: `openclaw onboard --non-interactive --accept-risk --auth-choice anthropic-cli --skip-channels --skip-skills --skip-hooks --skip-search --skip-ui --install-daemon --gateway-bind loopback --gateway-auth token --gateway-token \"$(openssl rand -hex 24)\" --json`. Se o anthropic-cli não servir, me diga o que falta em vez de inventar chave.",
    "2. Plugin: `openclaw plugins install clawhub:@openclaw/whatsapp --accept-capabilities`.",
    "3. Confira com `openclaw gateway status` e `openclaw plugins list | grep -i whatsapp`. Se o serviço for systemd de usuário, veja `loginctl show-user $USER -p Linger`; se for `no`, avise (precisa de root para o gateway sobreviver ao logout).",
    "",
    "No fim, resuma o que fez e o que ainda falta. Não rode `openclaw channels login`; não pareie o WhatsApp.",
  ].join("\n");
}

export function requestAgentPrepare(): void {
  const st = ctx.waStatus;
  if (st === null) return;
  void (async () => {
    if (waDialog.open) waDialog.close();
    const tab = await ctx.newTab();
    await ctx.sendText(tab, waAgentPrompt(st));
  })();
}
export let waPairing = false;
/** O pareamento em curso já vinculou: o resto (gateway voltando) é pano de fundo. */
export let waConnected = false;

/** "5516992294486" → "+55 (16) 99229-4486"; outros formatos ficam com o + na frente. */
export function fmtPhone(digits: string | null): string {
  if (digits === null) return "";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m === null ? `+${digits}` : `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}

export function paintWhatsapp(): void {
  const st = ctx.waStatus;
  ctx.paintListMode();
  if (st === null || !st.present) { waLine.hidden = true; return; }
  waLine.hidden = false;
  // Ponto verde conectado; cinza no resto (limpo: vermelho só assusta, e o clique já leva à solução).
  waLine.className = `wa-line ${st.connected ? "on" : ""}`;
  const who = st.number !== null ? fmtPhone(st.number) : "sem número";
  const via = st.gateway === "openclaw" ? "WhatsApp (OpenClaw)" : st.gateway === "hermes" ? "WhatsApp (Hermes)" : st.gateway === "picoclaw" ? "WhatsApp (PicoClaw)" : "WhatsApp";
  if (!st.ready) {
    waLine.replaceChildren(el("span", "dot"), el("span", "", `${via} · sem configurar`));
    waStatusEl.textContent = `${st.agent}.\nFalta:\n${(st.missing ?? "?").split("\n").map((l) => `• ${l}`).join("\n")}`;
    waPairBtn.hidden = true; waResetBtn.hidden = true; waCloseBtn.textContent = "Fechar";
    waAgentBtn.hidden = waPairing;
    waRefreshBtn.hidden = waPairing;
    waPolicyBox.hidden = true;
    return;
  }
  waAgentBtn.hidden = true;
  paintWaPolicy();
  const responde = st.connected && st.dmPolicy !== null ? ` · responde ${st.dmPolicy === "open" ? "todo mundo" : st.dmPolicy === "allowlist" ? "só você" : st.dmPolicy === "disabled" ? "ninguém" : "com código"}` : "";
  waLine.replaceChildren(el("span", "dot"), el("span", "", st.connected ? `${via} · ${who}${responde}` : `${via} · desconectado`));
  // Conectado: só o número. Desconectado: nada (o QR e a linha de progresso dizem o resto). A ficha técnica fica no title.
  // O que o app consertou sozinho na consulta (gateway em porta própria) aparece uma vez, aqui, para a pessoa saber.
  waStatusEl.textContent = `${st.connected ? `Conectado como ${who}.` : ""}${st.repaired !== undefined ? `${st.connected ? "\n" : ""}✓ Consertado sozinho: ${st.repaired}.` : ""}`;
  waStatusEl.title = st.agent;
  waPairBtn.hidden = st.connected || waPairing;
  waPairBtn.textContent = st.number === null ? "Gerar QR" : "Tentar reconectar e gerar QR";
  waResetBtn.hidden = waPairing || st.number === null;
  ctx.paintGuide();
  waCloseBtn.textContent = waConnected && !waSuccess.hidden ? "Concluído" : waPairing ? "Cancelar" : "Fechar";
  waCloseBtn.classList.toggle("btn-done", waConnected && !waSuccess.hidden);
  waRefreshBtn.hidden = waPairing;
}
let waRefreshing = false;
/**
 * Consulta o estado e agenda a próxima: 10 s enquanto a máquina tem WhatsApp mas não está conectado
 * (gateway reiniciando, sessão caindo), 60 s quando está bem. Sem isso a linha congelava no estado da
 * abertura da janela — vermelha depois de um alívio, mesmo com o gateway já de volta.
 */
/** Consulta em andamento: quem chama de novo (o botão Atualizar) espera por ela em vez de ser ignorado. */
let waInflight: Promise<void> | null = null;
let waCheckedAt: Date | null = null;
export function refreshWhatsapp(): Promise<void> {
  if (waInflight !== null) return waInflight;
  waRefreshing = true;
  if (ctx.waTimer !== null) { clearTimeout(ctx.waTimer); ctx.waTimer = null; }
  waInflight = (async () => {
    try { ctx.waStatus = await window.meuBot.whatsappStatus(); waCheckedAt = new Date(); if (ctx.waStatus.present) ctx.cacheWrite("waStatus", ctx.waStatus); else ctx.cacheDrop("waStatus"); } catch { ctx.waStatus = null; }
    finally { waRefreshing = false; waInflight = null; }
    paintWhatsapp();
    if (ctx.waStatus?.capacidades.grupos === true && ctx.waGroups === null && ctx.waGroupsInflight === null && ctx.waGroupsAt === 0) void ctx.refreshWaGroups();
    if (waPairing && ctx.waStatus?.connected === true) waShowSuccess(ctx.waStatus.number);
    const soon = ctx.waStatus !== null && ctx.waStatus.present && !ctx.waStatus.connected;
    ctx.waTimer = setTimeout(() => { void refreshWhatsapp(); }, waPairing && !waConnected ? 8_000 : soon ? 10_000 : 60_000);
  })();
  return waInflight;
}

export function openWhatsapp(): void {
  // No meio de um pareamento o QR e o log continuam: reabrir o modal não pode esconder o QR da vez.
  if (!waPairing) { waQr.hidden = true; waHow.hidden = true; waProgress.hidden = true; waSuccess.hidden = true; resetWaProgress(); }
  paintWhatsapp();
  if (!waDialog.open) waDialog.showModal();
}

/**
 * Só desconecta (antes chamava o pareamento com reset, que já gerava outro QR: a tela ficava em "escaneie"
 * e terminava em "QR expirou", parecendo que não tinha desconectado). Depois o status volta a "desconectado"
 * e o guia volta ao passo de conectar.
 */
export async function disconnectWhatsapp(btn: HTMLButtonElement): Promise<void> {
  const label = btn.dataset.label ?? btn.textContent ?? "Desconectar";
  btn.disabled = true; btn.textContent = "Desconectando…";
  try {
    await window.meuBot.whatsappLogout();
    await refreshWhatsapp();
  } catch (err) {
    btn.textContent = `Não desconectou: ${ipcErrorText(err)}`;
    btn.classList.add("btn-bad");
    window.setTimeout(() => { btn.textContent = label; btn.classList.remove("btn-bad"); }, 5000);
    return;
  } finally { btn.disabled = false; }
  btn.textContent = label;
}
export async function pairWhatsapp(reset: boolean): Promise<void> {
  if (waPairing) return;
  waPairing = true; waConnected = false;
  resetWaProgress(); waSuccess.hidden = true;
  setWaProgress(reset ? "Apagando a sessão antiga…" : "Conectando à máquina…");
  waTick = setInterval(paintWaMeta, 1000);
  waStatusEl.textContent = reset ? "Apagando a sessão antiga e gerando um QR novo…" : "Gerando o QR…";
  paintWhatsapp();
  try {
    await window.meuBot.whatsappPair(reset);
  } catch (err) {
    setWaProgress(err instanceof Error ? err.message : String(err), "bad");
  } finally {
    waPairing = false;
    if (waTick !== null) { clearInterval(waTick); waTick = null; }
    paintWaMeta();
    if (!waConnected && !waProgress.classList.contains("bad")) setWaProgress("O QR expirou sem leitura. Gere outro quando quiser.", "bad");
    waQr.hidden = true; waHow.hidden = true;
    // O gateway acabou de voltar; dá alguns segundos para o bridge abrir a sessão antes de consultar.
    setTimeout(() => { void refreshWhatsapp(); }, 6000);
    paintWhatsapp();
  }
}


/** Pareou (pelo vigia do script ou pela consulta de estado): ✓ animado no lugar do QR, aviso na aba, modal fecha. */
function waShowSuccess(number: string | null): void {
  if (waConnected) return;
  const ev = { number };
      // Vinculou: a janela fecha sozinha; o gateway volta em segundo plano e o refresh depois do `done` mostra o número.
      waConnected = true;
      setWaProgress(`Pareado${ev.number !== null ? ` como ${fmtPhone(ev.number)}` : ""}`, "ok");
      waProgressMeta.textContent = "";
      waQr.hidden = true; waHow.hidden = true;
      waSuccessText.textContent = ev.number !== null ? `Pareado como ${fmtPhone(ev.number)}` : "Pareado";
      waSuccess.hidden = false; waStatusEl.textContent = `✓ Pareado${ev.number !== null ? ` como ${fmtPhone(ev.number)}` : ""}. O gateway está voltando…`;       // O único botão vira "Concluído" (verde): cancelar depois de pareado não faz sentido.
      waCloseBtn.textContent = "Concluído"; waCloseBtn.classList.add("btn-done");
      const tab = ctx.active(); if (tab !== null) ctx.addNotice(tab, "✓ WhatsApp pareado; o gateway está voltando.", "info");
      setTimeout(() => { if (waDialog.open) waDialog.close(); }, 2600);
}
const waCancelIfPairing = (): void => { if (waPairing && !waConnected) void window.meuBot.whatsappCancel(); };

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarAgenteWhatsapp(): void {
  waRefreshBtn.addEventListener("click", () => {
    waRefreshBtn.disabled = true; waRefreshBtn.textContent = "Consultando a máquina…";
    void refreshWhatsapp().finally(() => {
      waRefreshBtn.disabled = false; waRefreshBtn.textContent = "Atualizar";
      // Mesmo sem mudança, dizer que consultou: senão o clique parece não fazer nada.
      if (waCheckedAt !== null) waStatusEl.textContent = `${waStatusEl.textContent ?? ""}\nConsultado às ${waCheckedAt.toLocaleTimeString("pt-BR")}.`;
    });
  });
  waAgentBtn.addEventListener("click", () => requestAgentPrepare());
  window.addEventListener("focus", () => { if (ctx.waStatus?.present) void refreshWhatsapp(); });
  window.meuBot.on("whatsapp:event", (ev: WhatsappEvent) => {
    switch (ev.kind) {
      // Só a linha de progresso: cada passo substitui o anterior; o log cru do CLI não aparece.
      case "step": if (waQrCount === 0 && !waConnected) setWaProgress(ev.text.charAt(0).toUpperCase() + ev.text.slice(1)); break;
      case "log": break;
      case "qr": {
        if (waConnected) break; // já pareou nesta rodada: nenhum QR atrasado volta por cima do ✓
        const now = Date.now();
        if (waQrCount >= 2 && now - waQrAt > 5_000) waQrEvery = now - waQrAt; // mede o ciclo real (do 2º em diante)
        waQrCount += 1; waQrAt = now;
        waQr.src = ev.dataUrl; waQr.hidden = false; waHow.hidden = false;
        waStatusEl.textContent = "Leia o QR com o WhatsApp do número do agente.";
        setWaProgress("Aguardando a leitura no celular"); paintWaMeta();
        break;
      }
      case "connected": { waShowSuccess(ev.number); break; }
      case "error": waStatusEl.textContent = `✗ ${ev.text}`; setWaProgress(ev.text, "bad"); break;
      case "done":
        if (ev.ok && waDialog.open) setTimeout(() => { if (waDialog.open) waDialog.close(); }, 2600);
        break;
    }
  });
  // A linha sempre leva à aba do guia (tudo na aba, sem modal); só cai no modal se a máquina não é OpenClaw.
  waLine.addEventListener("click", () => {
    const guide = TUTORIAIS.find((t) => t.id === "whatsapp-openclaw");
    if (guide !== undefined && ctx.waStatus !== null && ctx.waStatus.capacidades.parear) { ctx.openGuide(guide); return; }
    openWhatsapp();
  });
  waPairBtn.addEventListener("click", () => { void pairWhatsapp(false); });
  waResetBtn.addEventListener("click", () => ctx.armConfirm(waResetBtn, "Confirmar? desconecta o número", () => { void disconnectWhatsapp(waResetBtn); }));
  waCloseBtn.addEventListener("click", () => { waCancelIfPairing(); waDialog.close(); });
  // Esc fecha o <dialog> por conta própria; tem que cancelar o pareamento do mesmo jeito que o botão.
  waDialog.addEventListener("cancel", () => { waCancelIfPairing(); });
}
