/** Atalho global: exige pelo menos um modificador e uma tecla; Escape é proibido. Puro. */

const MODS = new Map<string, string>([
  ["cmd", "CommandOrControl"], ["command", "CommandOrControl"], ["commandorcontrol", "CommandOrControl"], ["cmdorctrl", "CommandOrControl"],
  ["ctrl", "Control"], ["control", "Control"], ["alt", "Alt"], ["option", "Alt"], ["shift", "Shift"], ["super", "Super"], ["meta", "Meta"],
]);
const SPECIAL = new Map<string, string>([["space", "Space"], ["spacebar", "Space"], ["enter", "Enter"], ["return", "Enter"], ["tab", "Tab"], ["up", "Up"], ["down", "Down"], ["left", "Left"], ["right", "Right"]]);

export function parseAccelerator(raw: string): string | null {
  const parts = raw.split("+").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length < 2) return null;
  const mods: string[] = [];
  let key: string | null = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    const mod = MODS.get(lower);
    if (mod !== undefined) { if (!mods.includes(mod)) mods.push(mod); continue; }
    if (key !== null) return null;
    if (lower === "escape" || lower === "esc") return null;
    const special = SPECIAL.get(lower);
    if (special !== undefined) key = special;
    else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) key = lower.toUpperCase();
    else if (/^[a-z0-9]$/.test(lower)) key = lower.toUpperCase();
    else return null;
  }
  if (key === null || mods.length === 0) return null;
  return [...mods, key].join("+");
}
