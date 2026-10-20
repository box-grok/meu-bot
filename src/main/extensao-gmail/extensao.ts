/**
 * Variante: produtos com extensões embutidas (crm: meu-bot CRM no Gmail e meu-bot Autenticador). Cada extensão do
 * produto (Resources/<pasta>; em dev build/<pasta>, ou MEU_BOT_EXTENSAO_CRM_DIR para a do Gmail) é copiada para
 * userData/Navegador/<host>/<pasta>/ e carregada descompactada (`ses.loadExtension`), nunca pela Web Store: id
 * estável pelo `key` do manifesto, atualiza junto com o app, e o config.json (porta + token do proxy, 0600) é
 * gravado ao lado antes de carregar. O polyfill de extensões (browser.ts) é aplicado na cópia antes da carga,
 * então o `extension-loaded` não recarrega.
 */
import { agendarSincronizacaoGoogle } from "../google/google";
import { app, type Session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log } from "../tunnel";
import { produto } from "../variant";
import { configJson } from "./extensao-api-core";
import { setExtensaoId, startExtensaoApi, type CapturarAba } from "./extensao-api";

/** O que cada extensão embutida pode chamar no proxy (a pasta do build é a identidade dela no app). */
const ROTAS: Record<string, string> = { "extensao-crm": "/v1/crm", "extensao-autenticador": "/v1/crm/autenticador" };

const sanit = (host: string): string => host.replace(/[^A-Za-z0-9_-]/g, "_");
const navegadorDir = (host: string): string => path.join(app.getPath("userData"), "Navegador", sanit(host));
const extensaoUserDir = (host: string, pasta: string): string => path.join(navegadorDir(host), pasta);
/** De onde vem a extensão: variável de dev (só a do Gmail), Resources/ empacotado, ou build/ no repositório. */
function extensaoBundleDir(pasta: string): string {
  const dev = process.env["MEU_BOT_EXTENSAO_CRM_DIR"];
  if (pasta === "extensao-crm" && dev !== undefined && dev !== "") return dev;
  return app.isPackaged ? path.join(process.resourcesPath, pasta) : path.join(app.getAppPath(), "build", pasta);
}
const carimbo = (bundle: string): string => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8")) as { version?: string };
    const js = fs.readdirSync(bundle).filter((f) => f.endsWith(".js")).sort().map((f) => `${f}@${fs.statSync(path.join(bundle, f)).mtimeMs}`).join(",");
    return `${app.getVersion()}:${m.version ?? "?"}:${js}`;
  } catch { return ""; }
};

type Patch = (host: string, ext: { id: string; path: string; name: string; version: string; manifest: unknown }) => boolean;

/**
 * Prepara a cópia por máquina de uma extensão (refaz quando o app/extensão mudou), grava o config.json e carrega
 * na sessão. `patch` = o patchExtensionFiles do browser.ts (polyfill), aplicado antes de carregar.
 */
async function carregarUma(ses: Session, host: string, pasta: string, porta: number, token: string, patch: Patch): Promise<Electron.Extension | null> {
  const bundle = extensaoBundleDir(pasta);
  if (!fs.existsSync(path.join(bundle, "manifest.json"))) { log(`[navegador ${host}] extensão ${pasta} não encontrada em ${bundle} (rode npm run build:extensao)`); return null; }
  const dir = extensaoUserDir(host, pasta);
  const stamp = path.join(dir, ".origem");
  const atual = carimbo(bundle);
  if (!fs.existsSync(path.join(dir, "manifest.json")) || !fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== atual) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.cpSync(bundle, dir, { recursive: true });
    fs.writeFileSync(stamp, atual);
    log(`[navegador ${host}] extensão ${pasta} copiada de ${bundle}`);
  }
  fs.writeFileSync(path.join(dir, "config.json"), configJson({ porta, token, host, app: app.getVersion() }), { mode: 0o600 });
  // Polyfill antes da carga: lê o manifesto e aplica nos arquivos copiados (idempotente pelo marcador).
  try { const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { name?: string; version?: string }; patch(host, { id: "pendente", path: dir, name: manifest.name ?? "extensão", version: manifest.version ?? "?", manifest }); } catch (e) { log(`[navegador ${host}] polyfill na extensão ${pasta} falhou: ${e instanceof Error ? e.message : String(e)}`); }
  const ext = await ses.loadExtension(dir, { allowFileAccess: false });
  setExtensaoId(host, ext.id, ROTAS[pasta] ?? "/v1/crm");
  log(`[navegador ${host}] extensão embutida carregada: ${ext.name} ${ext.version} (${ext.id})`);
  return ext;
}

/** Carrega as extensões embutidas do produto nesta sessão; uma que falhe não impede as outras. */
export async function carregarExtensoes(ses: Session, host: string, patch: Patch, capturarAba: CapturarAba): Promise<void> {
  const pastas = produto().extensoes;
  if (pastas.length === 0) return;
  // Cópia da versão que tinha uma extensão só (Navegador/<host>/extensao/): o app a gerou; a nova mora em <pasta>/.
  fs.rmSync(path.join(navegadorDir(host), "extensao"), { recursive: true, force: true });
  const api = await startExtensaoApi(host, capturarAba);
  if (pastas.includes("extensao-crm")) agendarSincronizacaoGoogle(host);
  for (const pasta of pastas) {
    try { await carregarUma(ses, host, pasta, api.porta, api.token, patch); }
    catch (e) { log(`[navegador ${host}] extensão ${pasta} não carregou: ${e instanceof Error ? e.message : String(e)}`); }
  }
}
/** Extensão embutida = a que mora numa das pastas por máquina das extensões do produto. */
export const extensaoEmbutida = (host: string, extPath: string): boolean => {
  try { const p = path.resolve(extPath); return produto().extensoes.some((pasta) => p === path.resolve(extensaoUserDir(host, pasta))); } catch { return false; }
};
