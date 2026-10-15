/**
 * Uma linha do parear-hermes.sh → evento da janela de pareamento. Puro: sem fs, sem Electron;
 * testável com node --test. O QR chega como SVG em base64 e só passa se for base64 de verdade de um
 * <svg>, porque vira src de <img> na janela.
 */
import type { WhatsappPairEvent } from "../shared/ipc";

const STEPS = ["checar", "parar", "sessao", "qr", "religar"] as const;
type RemoteStep = (typeof STEPS)[number];

export function parsePairLine(line: string): WhatsappPairEvent | null {
  const m = /^([a-z-]+):\s?(.*)$/.exec(line);
  if (m === null) return null;
  const [, tag, rest] = m as unknown as [string, string, string];
  switch (tag) {
    case "passo": {
      const sp = rest.indexOf(" ");
      const step = (sp < 0 ? rest : rest.slice(0, sp)) as RemoteStep;
      if (!STEPS.includes(step)) return null;
      return { kind: "step", step, state: "doing", text: sp < 0 ? "" : rest.slice(sp + 1) };
    }
    case "qr": {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(rest)) return null;
      if (!Buffer.from(rest, "base64").toString("utf8").trimStart().startsWith("<svg")) return null;
      return { kind: "qr", svgBase64: rest };
    }
    case "conectado": {
      let who = "";
      try {
        const u = JSON.parse(rest) as { id?: unknown; name?: unknown };
        const num = typeof u.id === "string" ? u.id.split(/[:@]/)[0] ?? "" : "";
        who = [typeof u.name === "string" ? u.name : "", num !== "" ? `+${num}` : ""].filter(Boolean).join(" · ");
      } catch { /* sem detalhes do número */ }
      return { kind: "paired", who };
    }
    case "pronto": return { kind: "done", ok: true, text: rest };
    case "ja-conectado": return { kind: "already", text: rest };
    case "erro": return { kind: "done", ok: false, text: rest };
    default: return null;
  }
}
