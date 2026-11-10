/**
 * Resumo de uma janela de suporte (o que o meu-bot-admin-gestao mostra de uma pessoa), enviado pelo app do admin e
 * lido pelo super admin no console. Puro: validação do corpo. As linhas já vêm em texto (as mesmas da tela do
 * admin), então o console só pinta; nada aqui é comando.
 */
export interface LinhaResumo { texto: string; ok: boolean | null }
export interface ResumoSuporte { saude: LinhaResumo[]; licenca: LinhaResumo[]; uso: LinhaResumo[]; aberturas: string[] }
/** Como o admin entra na máquina: usuário (root ou a conta da pessoa, box-N) e endereço. */
export interface AcessoMaquina { usuario: string; endereco: string; porta: number }
export interface CorpoResumo { id: string; nome: string; maquina: string | null; acesso: AcessoMaquina | null; resumo: ResumoSuporte }

const ID_RE = /^[a-f0-9]{12}$/;
const MAX_LINHAS = 40;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const textoCurto = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);

function linhas(v: unknown): LinhaResumo[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: LinhaResumo[] = [];
  for (const x of v.slice(0, MAX_LINHAS)) {
    if (!isObj(x)) return null;
    const texto = textoCurto(x["texto"], 300);
    const ok = x["ok"];
    if (texto === null || (ok !== true && ok !== false && ok !== null)) return null;
    out.push({ texto, ok });
  }
  return out;
}

/** Corpo do POST /admin/suporte: o resumo saneado, ou o erro. */
export function validaResumoSuporte(raw: unknown): CorpoResumo | { erro: string } {
  if (!isObj(raw)) return { erro: "corpo inválido" };
  const id = typeof raw["id"] === "string" && ID_RE.test(raw["id"]) ? raw["id"] : null;
  if (id === null) return { erro: "id da máquina fora do formato" };
  const nome = textoCurto(raw["nome"], 80);
  if (nome === null) return { erro: "nome vazio" };
  const maquina = raw["maquina"] === null || raw["maquina"] === undefined ? null : textoCurto(raw["maquina"], 80);
  const r = raw["resumo"];
  if (!isObj(r)) return { erro: "resumo inválido" };
  const saude = linhas(r["saude"]); const licenca = linhas(r["licenca"]); const uso = linhas(r["uso"]);
  if (saude === null || licenca === null || uso === null) return { erro: "linhas do resumo fora do formato" };
  const ab = r["aberturas"];
  if (ab !== undefined && !Array.isArray(ab)) return { erro: "aberturas fora do formato" };
  const aberturas = (ab ?? []).slice(0, MAX_LINHAS).map((x) => textoCurto(x, 200)).filter((x): x is string => x !== null);
  const a = raw["acesso"];
  let acesso: AcessoMaquina | null = null;
  if (isObj(a)) {
    const usuario = textoCurto(a["usuario"], 64); const endereco = textoCurto(a["endereco"], 253); const porta = a["porta"];
    if (usuario === null || endereco === null || typeof porta !== "number" || !Number.isInteger(porta) || porta < 1 || porta > 65535) return { erro: "acesso fora do formato" };
    acesso = { usuario, endereco, porta };
  }
  return { id, nome, maquina, acesso, resumo: { saude, licenca, uso, aberturas } };
}
