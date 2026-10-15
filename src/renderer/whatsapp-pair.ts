/** Janela de pareamento do WhatsApp do Hermes: QR ao vivo, etapas e resultado. */
import type { WhatsappPairEvent } from "../shared/ipc";

interface PairApi { close(): void; retry(host: string, force: boolean): void; on(channel: "wapair:event", cb: (payload: unknown) => void): () => void }
declare global { interface Window { wapair: PairApi } }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const title = $<HTMLHeadingElement>("wp-title");
const qrBox = $<HTMLDivElement>("wp-qr");
const qrImg = $<HTMLImageElement>("wp-qr-img");
const qrWait = $<HTMLSpanElement>("wp-qr-wait");
const result = $<HTMLParagraphElement>("wp-result");
const retryBtn = $<HTMLButtonElement>("wp-retry");
const forceBtn = $<HTMLButtonElement>("wp-force");
let host = "";

/** Etapas do script que não têm linha própria na lista caem na etapa visível mais próxima. */
const STEP_LI: Record<string, string> = { connect: "connect", checar: "connect", parar: "parar", sessao: "parar", qr: "qr", religar: "religar" };
const ORDER = ["connect", "parar", "qr", "religar"];

function setStep(step: string, state: "doing" | "done" | "fail", text: string): void {
  const id = STEP_LI[step] ?? step;
  // Começar uma etapa encerra as anteriores que ainda giravam.
  if (state === "doing") for (const prev of ORDER.slice(0, ORDER.indexOf(id))) { const li = document.getElementById(`st-${prev}`); if (li?.classList.contains("doing")) { li.classList.remove("doing"); li.classList.add("done"); } }
  const li = document.getElementById(`st-${id}`);
  if (li === null) return;
  li.classList.remove("doing", "done", "fail");
  li.classList.add(state);
  const detail = li.querySelector<HTMLSpanElement>(".detail");
  if (detail !== null && text !== "") detail.textContent = text;
}

function reset(): void {
  for (const id of ORDER) { const li = document.getElementById(`st-${id}`); li?.classList.remove("doing", "done", "fail"); const d = li?.querySelector<HTMLSpanElement>(".detail"); if (d) d.textContent = ""; }
  result.hidden = true; retryBtn.hidden = true; forceBtn.hidden = true;
  qrImg.hidden = true; qrWait.hidden = false; qrWait.textContent = "preparando o QR…"; qrBox.classList.remove("dim");
  title.textContent = `Parear o WhatsApp do Hermes · ${host}`;
}

function finish(ok: boolean, text: string): void {
  result.hidden = false;
  result.className = `result ${ok ? "ok" : "bad"}`;
  result.textContent = `${ok ? "✓" : "✗"} ${text}`;
  qrBox.classList.add("dim");
  retryBtn.hidden = ok;
  title.textContent = ok ? "WhatsApp conectado" : "Não deu";
  for (const id of ORDER) { const li = document.getElementById(`st-${id}`); if (li?.classList.contains("doing")) { li.classList.remove("doing"); li.classList.add(ok ? "done" : "fail"); } }
}

window.wapair.on("wapair:event", (p) => {
  const ev = p as WhatsappPairEvent;
  switch (ev.kind) {
    case "init": host = ev.host; reset(); break;
    case "step": setStep(ev.step, ev.state, ev.text); break;
    case "qr":
      qrImg.src = `data:image/svg+xml;base64,${ev.svgBase64}`;
      qrImg.hidden = false; qrWait.hidden = true;
      qrBox.classList.remove("fresh"); void qrBox.offsetWidth; qrBox.classList.add("fresh");
      setStep("qr", "doing", "esperando o celular ler o QR");
      break;
    case "paired":
      setStep("qr", "done", ev.who !== "" ? `lido por ${ev.who}` : "lido");
      qrBox.classList.add("dim");
      break;
    case "already":
      finish(true, ev.text);
      qrWait.textContent = "já conectado";
      forceBtn.hidden = false;
      break;
    case "done": finish(ev.ok, ev.text); break;
  }
});

$<HTMLButtonElement>("wp-close").addEventListener("click", () => window.wapair.close());
retryBtn.addEventListener("click", () => { reset(); window.wapair.retry(host, false); });
forceBtn.addEventListener("click", () => { reset(); window.wapair.retry(host, true); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") window.wapair.close(); });
