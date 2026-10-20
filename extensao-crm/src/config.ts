/**
 * config.json ao lado do manifesto: o app grava `{porta, token, host, app}` antes de carregar a extensão
 * (src/main/extensao-gmail/ no meu-bot). Só o service worker lê (o arquivo NÃO é web-acessível); o token nunca
 * vai ao console, ao `window` nem ao chrome.storage.
 */
export interface Config { porta: number; token: string; host: string; app: string }

export function parseConfig(json: unknown): Config {
  const o = json !== null && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const porta = Number(o["porta"]);
  const token = typeof o["token"] === "string" ? o["token"] : "";
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) throw new Error("config.json inválido: porta");
  if (token.length < 16 || token.length > 256 || /\s/.test(token)) throw new Error("config.json inválido: token");
  return { porta, token, host: typeof o["host"] === "string" ? o["host"] : "", app: typeof o["app"] === "string" ? o["app"] : "" };
}

export async function lerConfig(): Promise<Config> {
  const r = await fetch(chrome.runtime.getURL("config.json"), { cache: "no-store" });
  if (!r.ok) throw new Error(`config.json: ${r.status}`);
  return parseConfig(await r.json());
}
