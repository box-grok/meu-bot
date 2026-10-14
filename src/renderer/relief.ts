/** Janela de alívio: etapas, números de antes/depois e fechamento automático. */
import type { ReliefEvent } from "../shared/ipc";

interface ReliefApi { close(): void; on(channel: "relief:event", cb: (payload: unknown) => void): () => void }
declare global { interface Window { relief: ReliefApi } }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const title = $<HTMLHeadingElement>("rl-title");
const result = $<HTMLParagraphElement>("rl-result");
const closeBtn = $<HTMLButtonElement>("rl-close");

function setStep(step: string, state: "doing" | "done" | "fail", text: string): void {
  const li = document.getElementById(`st-${step}`);
  if (li === null) return;
  li.classList.remove("doing", "done", "fail");
  li.classList.add(state);
  const detail = li.querySelector<HTMLSpanElement>(".detail");
  if (detail !== null) detail.textContent = text;
}

function setStats(which: "before" | "after", load: string, memMb: number | null): void {
  $<HTMLDivElement>(`${which}-load`).textContent = `carga ${load}`;
  $<HTMLDivElement>(`${which}-mem`).textContent = memMb === null ? "" : `${(memMb / 1024).toFixed(1)} GB livres`;
}

window.relief.on("relief:event", (p) => {
  const ev = p as ReliefEvent;
  switch (ev.kind) {
    case "init": title.textContent = `Aliviando ${ev.host}…`; break;
    case "step": setStep(ev.step, ev.state, ev.text); break;
    case "stats": setStats(ev.which, ev.load, ev.memMb); break;
    case "countdown": setStep("open", "doing", `abrindo o meu-bot em ${ev.seconds} s…`); break;
    case "log": break;
    case "done":
      result.hidden = false;
      result.className = `result ${ev.ok ? "ok" : "bad"}`;
      result.textContent = ev.ok ? "✓ Alívio aplicado. Abrindo a janela da máquina." : `✗ ${ev.text}`;
      title.textContent = ev.ok ? "Aliviado" : "Não deu";
      break;
  }
});

closeBtn.addEventListener("click", () => window.relief.close());
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") window.relief.close(); });
