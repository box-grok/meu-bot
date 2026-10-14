import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { BACKEND_MODELS, type BackendModel, type SettingsUpdate, type SettingsView } from "../shared/ipc";

interface SettingsFile {
  version: 1;
  sshHost: string;
  backendModel: BackendModel;
  backendPort: number;
}

const DEFAULT_HOST = "grokbot-1";
const DEFAULT_MODEL: BackendModel = "rene-dm";
const DEFAULT_PORT = 8080;
const isBackendModel = (v: unknown): v is BackendModel => typeof v === "string" && (BACKEND_MODELS as readonly string[]).includes(v);
const isPort = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535;
const defaults = (): SettingsFile => ({ version: 1, sshHost: DEFAULT_HOST, backendModel: DEFAULT_MODEL, backendPort: DEFAULT_PORT });
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

let file: SettingsFile = defaults();

const settingsPath = (): string => path.join(app.getPath("userData"), "settings.json");

export const isValidHost = (host: string): boolean => HOST_RE.test(host) && host.length <= 253;

export function loadSettings(): void {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SettingsFile>;
    file = {
      version: 1,
      sshHost: typeof parsed.sshHost === "string" && isValidHost(parsed.sshHost) ? parsed.sshHost : DEFAULT_HOST,
      backendModel: isBackendModel(parsed.backendModel) ? parsed.backendModel : DEFAULT_MODEL,
      backendPort: isPort(parsed.backendPort) ? parsed.backendPort : DEFAULT_PORT,
    };
  } catch {
    file = defaults();
  }
}

function persist(): void {
  const target = settingsPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export const getSshHost = (): string => file.sshHost;
export const getBackendModel = (): BackendModel => file.backendModel;
export const getBackendPort = (): number => file.backendPort;

export const settingsView = (): SettingsView => ({
  sshHost: file.sshHost,
  backendModel: file.backendModel,
  backendPort: file.backendPort,
});

export function updateSettings(update: SettingsUpdate): SettingsView {
  if (update.backendModel !== undefined) {
    if (!isBackendModel(update.backendModel)) throw new Error("Modelo do backend inválido.");
    file.backendModel = update.backendModel;
  }
  if (update.backendPort !== undefined) {
    if (!isPort(update.backendPort)) throw new Error("Porta do backend inválida (1 a 65535).");
    file.backendPort = update.backendPort;
  }
  if (update.sshHost !== undefined) {
    const host = update.sshHost.trim();
    if (!isValidHost(host)) throw new Error("Host SSH inválido. Use só letras, números, ponto, hífen e sublinhado.");
    file.sshHost = host;
  }
  persist();
  return settingsView();
}
