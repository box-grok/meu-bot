/**
 * Variante: cliente. Tutorial 7 · objetivo do WhatsApp, lado do SSH: lê e grava objetivo.json na máquina, salva a
 * skill no workspace do OpenClaw e aplica a trava de ferramentas do nível (objetivo-core.ts tem a parte pura).
 */
import type { FreedomLevel, ObjectiveChoice, ObjectiveInfo } from "../shared/ipc";
import { OBJECTIVE_SKILL, levelOf, objectiveInfoSh, parseMachineSkills, parseObjectiveChoice, parseObjectiveFile, resetObjectiveSh, saveObjectiveSh, setObjectiveSh } from "./objetivo-core";
import { runSsh } from "./whatsapp";
import { LOCAL_HOST } from "./localBackend";
import { isValidHost } from "./settings";
import { log } from "./backend";

const lastLine = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim()).split("\n").pop() || "ssh falhou";

export async function objectiveInfo(host: string): Promise<ObjectiveInfo> {
  const none: ObjectiveInfo = { available: false, objective: null, level: null, savedAt: null, skill: OBJECTIVE_SKILL, skillPresent: false, skills: [] };
  if (host === LOCAL_HOST || !isValidHost(host)) return none;
  const r = await runSsh(host, objectiveInfoSh(), 20_000);
  if (r.code !== 0 && r.stdout.trim() === "") throw new Error(`não consegui ler o objetivo na máquina: ${lastLine(r)}`);
  let raw: unknown = null;
  const o = r.stdout.split("\n").find((l) => l.startsWith("O="));
  try { raw = JSON.parse((o ?? "O=").slice(2) || "null"); } catch { raw = null; }
  const skills = parseMachineSkills(r.stdout);
  return { available: true, ...parseObjectiveFile(raw), skill: OBJECTIVE_SKILL, skillPresent: skills.some((s) => s.objective), skills };
}

/** Passos 1 e 2: a tela manda só o que mudou (objetivo ou nível). */
export async function setObjective(host: string, payload: unknown): Promise<ObjectiveInfo> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const p = payload as { objective?: unknown; level?: unknown } | null;
  const patch: { objective?: ObjectiveChoice | null; level?: FreedomLevel | null } = {};
  if (p !== null && "objective" in p) {
    const c = parseObjectiveChoice(p.objective);
    if (c === null) throw new Error(p.objective !== null && typeof p.objective === "object" && (p.objective as { id?: unknown }).id === "outro" ? "escreva em uma frase o que você quer resolver" : "objetivo inválido");
    patch.objective = c;
  }
  if (p !== null && "level" in p) {
    const lv = levelOf(typeof p.level === "string" ? p.level : null);
    if (lv === null) throw new Error("nível inválido");
    patch.level = lv.id;
  }
  if (Object.keys(patch).length === 0) throw new Error("nada para gravar");
  const r = await runSsh(host, `${setObjectiveSh(patch)}\n`, 20_000);
  if (r.code !== 0 || !r.stdout.includes("OBJ=1")) throw new Error(`não deu para gravar na máquina: ${lastLine(r)}`);
  log(`[objetivo] ${host}: ${JSON.stringify(patch)}`);
  return objectiveInfo(host);
}

/** Passo 3: skill no workspace + trava do nível. Precisa dos dois passos anteriores. */
export async function saveObjectiveSkill(host: string, machine: string): Promise<ObjectiveInfo & { detail: string }> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const cur = await objectiveInfo(host);
  if (cur.objective === null) throw new Error("escolha o objetivo primeiro");
  if (cur.level === null) throw new Error("diga quanta liberdade o agente tem primeiro");
  const r = await runSsh(host, saveObjectiveSh(cur.objective, cur.level, machine, new Date().toISOString()), 60_000);
  if (r.code !== 0 || !r.stdout.includes("OBJ=1")) throw new Error(`não deu para salvar a skill: ${lastLine(r)}`);
  const lock = /LOCK=(\w+)/.exec(r.stdout)?.[1] ?? "skip";
  const detail = lock === "1" ? "skill salva e ferramentas do agente ajustadas ao nível" : lock === "0" ? "skill salva; a trava de ferramentas não aplicou (o OpenClaw recusou a config)" : "skill salva; a trava de ferramentas fica para quando o WhatsApp estiver pareado";
  log(`[objetivo] ${host}: skill salva (${lock})`);
  return { ...(await objectiveInfo(host)), detail };
}

/** "Refazer do zero" do tutorial 7. */
export async function resetObjective(host: string): Promise<ObjectiveInfo> {
  if (host === LOCAL_HOST || !isValidHost(host)) throw new Error("máquina inválida");
  const r = await runSsh(host, resetObjectiveSh(), 30_000);
  if (r.code !== 0 || !r.stdout.includes("RESET=1")) throw new Error(`não deu para desfazer: ${lastLine(r)}`);
  log(`[objetivo] ${host}: desfeito`);
  return objectiveInfo(host);
}
