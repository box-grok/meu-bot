/**
 * Identidade deste Mac como device da conta (ver device-core.ts): device.json em claro na pasta de dados do meu-bot
 * estável (`~/Library/Application Support/meu-bot/`), compartilhada por todas as variantes deste Mac; criada na
 * primeira leitura. Lida uma vez por processo.
 */
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "../maquina/tunnel";
import { produto } from "../app/variant";
import { montarDevicePedido, novoDeviceJson, parseDeviceJson, type DeviceJson, type DevicePedido } from "./device-core";

/** Nome da pasta do meu-bot estável (Produto.userData null = o productName, "meu-bot"). */
const PASTA_ESTAVEL = "meu-bot";
const arquivo = (): string => path.join(app.getPath("appData"), PASTA_ESTAVEL, "device.json");

let lido: DeviceJson | null = null;
/** O uuid deste Mac; cria o device.json se não existe ou não vale. */
export function deviceIdentidade(): DeviceJson {
  if (lido !== null) return lido;
  const f = arquivo();
  try { const d = parseDeviceJson(JSON.parse(fs.readFileSync(f, "utf8"))); if (d !== null) { lido = d; return d; } } catch { /* não existe ou não vale: cria */ }
  const novo = novoDeviceJson();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(novo, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, f);
    log(`[conta] device.json criado (${novo.id.slice(0, 8)}…)`);
  } catch (e) { log(`[conta] não gravou device.json: ${e instanceof Error ? e.message : String(e)}`); }
  lido = novo;
  return novo;
}
/** O device que o app manda no `POST /token`. */
export function devicePedido(): DevicePedido {
  return montarDevicePedido({ id: deviceIdentidade().id, hostname: os.hostname(), user: os.userInfo().username, platform: process.platform, app: produto().nome, versao: app.getVersion() });
}
