/**
 * Identidade deste Mac como device da conta, a parte pura. Hoje o backend conhece o Mac pelo alias (12 hex de
 * sha256(hostname\nusuário), `deviceId()` em src/main/maquina/backend.ts); a conta usa um uuid gravado em claro em
 * device.json na pasta do meu-bot estável (uma por Mac, compartilhada entre as variantes: um Mac = um device), e manda
 * o alias junto para a API casar com o maquinas.json das máquinas. Nome e usuário não entram no uuid: trocar o nome do
 * Mac não vira um device novo.
 */
import { createHash, randomUUID } from "node:crypto";
import { UUID_RE } from "../licenca/licenca";

/** O id antigo do Mac (igual a `deviceId()` do backend.ts): 12 hex de sha256(nome\nusuário), com `.local` tirado. */
export function aliasLegado(hostname: string, user: string): string {
  return createHash("sha256").update(`${hostname.replace(/\.local$/, "")}\n${user}`).digest("hex").slice(0, 12);
}
export interface DeviceJson { id: string; criadoEm: string }
/** O device.json gravado: só vale com um uuid v4 inteiro; qualquer outra coisa é regravada. */
export function parseDeviceJson(raw: unknown): DeviceJson | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID_RE.test(r.id)) return null;
  return { id: r.id, criadoEm: typeof r.criadoEm === "string" ? r.criadoEm : "" };
}
export const novoDeviceJson = (now: number = Date.now()): DeviceJson => ({ id: randomUUID(), criadoEm: new Date(now).toISOString() });
/** O que o app manda no `POST /token` para se registrar como device (mesmo formato de DevicePedido do Worker). */
export interface DevicePedido { id: string; alias: string; name: string; user: string; platform: string; app: string; versao: string }
/** Campos livres (nome do Mac, usuário): sem caracteres de controle e até 80, como o Worker aceita. */
const campo = (s: string): string => s.replace(/\p{C}/gu, "").slice(0, 80);
/**
 * Com `dadosUso` false (console › Dados de uso do produto), nome, usuário e plataforma vão vazios: a API já guardaria
 * só id e status, mas o app também não manda. `app` e `versao` ficam: a sessão precisa saber que produto entrou.
 */
export function montarDevicePedido(d: { id: string; hostname: string; user: string; platform: string; app: string; versao: string }, dadosUso = true): DevicePedido {
  const alias = aliasLegado(d.hostname, d.user);
  if (!dadosUso) return { id: d.id, alias, name: "", user: "", platform: "", app: d.app, versao: d.versao };
  return { id: d.id, alias, name: campo(d.hostname.replace(/\.local$/, "")), user: campo(d.user), platform: d.platform, app: d.app, versao: d.versao };
}
