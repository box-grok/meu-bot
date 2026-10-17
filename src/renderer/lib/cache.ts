/**
 * Cache "stale-while-revalidate" do renderer: pinta o último estado conhecido na hora, lê a máquina por baixo e
 * troca sem piscar. Puro: recebe o armazenamento (o localStorage na janela; um Map nos testes). Chave
 * `cache:<host>:<nome>`, valor um envelope `{ at, v }`. Tudo em try/catch: sem armazenamento (janela privada,
 * cota cheia) o app segue como se não houvesse cache.
 */
export interface CacheStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}
export interface Cached<T> { value: T; /** Quando foi gravado (ms desde 1970). */ at: number }

const PREFIX = "cache:";
export const cacheKey = (host: string, name: string): string => `${PREFIX}${host}:${name}`;

/** O último valor gravado, ou null se não há, está corrompido ou passou de `maxAgeMs`. */
export function readCache<T>(store: CacheStore, host: string, name: string, maxAgeMs: number = Number.POSITIVE_INFINITY, now: number = Date.now()): Cached<T> | null {
  if (host === "") return null;
  try {
    const raw = store.getItem(cacheKey(host, name));
    if (raw === null) return null;
    const env = JSON.parse(raw) as { at?: unknown; v?: unknown } | null;
    if (env === null || typeof env !== "object" || typeof env.at !== "number" || !("v" in env)) return null;
    if (now - env.at > maxAgeMs) return null;
    return { value: env.v as T, at: env.at };
  } catch {
    return null;
  }
}

export function writeCache(store: CacheStore, host: string, name: string, value: unknown, now: number = Date.now()): void {
  if (host === "") return;
  try { store.setItem(cacheKey(host, name), JSON.stringify({ at: now, v: value })); } catch { /* cota ou sem armazenamento: segue sem cache */ }
}

export function dropCache(store: CacheStore, host: string, name: string): void {
  try { store.removeItem(cacheKey(host, name)); } catch { /* opcional */ }
}

/** Apaga tudo o que é desta máquina (ela saiu do seletor). Devolve quantas chaves saíram. */
export function clearCache(store: CacheStore, host: string): number {
  if (host === "") return 0;
  const prefix = `${PREFIX}${host}:`;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k !== null && k.startsWith(prefix)) doomed.push(k); }
    for (const k of doomed) store.removeItem(k);
  } catch { /* opcional */ }
  return doomed.length;
}

/** "há 2 min" / "há 3 h" / "ontem" para o rótulo do que veio do cache. */
export function cacheAgeText(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "agora há pouco";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}
