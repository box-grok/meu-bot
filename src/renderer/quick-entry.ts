interface QuickEntryApi {
  submit(text: string): Promise<{ ok: boolean; message?: string }>;
  hide(): void;
  on(channel: "quick:shown" | "quick:appearance", callback: (payload: unknown) => void): () => void;
}
declare global { interface Window { quickEntry: QuickEntryApi } }

const input = document.getElementById("qe-input") as HTMLTextAreaElement;
const error = document.getElementById("qe-error") as HTMLSpanElement;

async function submit(): Promise<void> {
  const text = input.value.trim();
  if (text === "" || input.disabled) return;
  input.disabled = true;
  error.hidden = true;
  const r = await window.quickEntry.submit(text);
  input.disabled = false;
  if (r.ok) { input.value = ""; return; }
  error.textContent = r.message ?? "Não deu pra enviar.";
  error.hidden = false;
  input.focus();
}

input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); void submit(); }
  if (ev.key === "Escape") { ev.preventDefault(); window.quickEntry.hide(); }
});
window.quickEntry.on("quick:shown", () => { error.hidden = true; input.focus(); input.select(); });
window.quickEntry.on("quick:appearance", (p) => {
  const size = (p as { fontSize?: number })?.fontSize;
  if (typeof size === "number") document.documentElement.style.setProperty("--chat-font", `${size}px`);
});
input.focus();
export {};
