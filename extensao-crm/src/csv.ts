/** Importar caixas de uma planilha (CSV): leitura tolerante (vírgula ou ponto e vírgula, aspas) e mapeamento puro. */
import type { Pipeline } from "./tipos.ts";

/** CSV → linhas de células. Detecta ";" (Excel em pt-BR) quando a 1ª linha tem mais ";" do que ",". */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = []; let linha: string[] = []; let cel = ""; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (aspas) { if (c === '"') { if (t[i + 1] === '"') { cel += '"'; i++; } else aspas = false; } else cel += c; continue; }
    if (c === '"') aspas = true;
    else if (c === sep) { linha.push(cel); cel = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; linha.push(cel); cel = ""; if (linha.some((x) => x.trim() !== "")) linhas.push(linha); linha = []; }
    else cel += c;
  }
  linha.push(cel); if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
  return linhas;
}

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
export interface LinhaImport { name: string; stageKey?: string; fields: Record<string, string>; email?: string; phone?: string; contactName?: string }
export interface PlanoImport { linhas: LinhaImport[]; colunas: { titulo: string; destino: string }[]; ignoradas: number }

/**
 * Cabeçalho → destino: "Nome"/"Name" (ou a 1ª coluna) vira o nome da caixa; "Etapa"/"Stage" a etapa (por nome);
 * "E-mail", "Telefone", "Contato" viram o contato vinculado; colunas com o nome de um campo do pipeline vão para
 * ele (o host converte o valor pelo tipo). O resto fica de fora e aparece no resumo.
 */
export function planejarImport(linhas: string[][], p: Pipeline): PlanoImport {
  const [cab, ...dados] = linhas;
  if (!cab) return { linhas: [], colunas: [], ignoradas: 0 };
  const papel = cab.map((tit, i): string => {
    const n = norm(tit);
    if (["nome", "name", "caixa", "box"].includes(n)) return "nome";
    if (["etapa", "stage", "estagio", "fase"].includes(n)) return "etapa";
    if (["e-mail", "email", "e mail"].includes(n)) return "email";
    if (["telefone", "phone", "celular", "whatsapp", "fone"].includes(n)) return "telefone";
    if (["contato", "contact", "pessoa"].includes(n)) return "contato";
    const f = p.fields.find((x) => norm(x.name) === n); if (f) return `campo:${f.key}`;
    return i === 0 ? "nome?" : "";
  });
  const temNome = papel.includes("nome");
  const col = papel.map((x) => (x === "nome?" ? (temNome ? "" : "nome") : x));
  let ignoradas = 0; const out: LinhaImport[] = [];
  for (const l of dados) {
    const get = (k: string): string => { const i = col.indexOf(k); return i >= 0 ? (l[i] ?? "").trim() : ""; };
    const name = get("nome"); if (name === "") { ignoradas++; continue; }
    const etapa = get("etapa"); const st = etapa === "" ? undefined : p.stages.find((s) => norm(s.name) === norm(etapa))?.key;
    const fields: Record<string, string> = {}; col.forEach((c, i) => { if (c.startsWith("campo:")) { const v = (l[i] ?? "").trim(); if (v !== "") fields[c.slice(6)] = v; } });
    const email = get("email"); const phone = get("telefone"); const contactName = get("contato");
    out.push({ name, ...(st ? { stageKey: st } : {}), fields, ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(contactName ? { contactName } : {}) });
  }
  const destinoDe = (c: string): string => c === "nome" ? "Nome da caixa" : c === "etapa" ? "Etapa" : c === "email" ? "E-mail do contato" : c === "telefone" ? "Telefone do contato" : c === "contato" ? "Nome do contato" : c.startsWith("campo:") ? `Coluna "${p.fields.find((f) => f.key === c.slice(6))?.name ?? ""}"` : "fica de fora";
  return { linhas: out, colunas: cab.map((titulo, i) => ({ titulo, destino: destinoDe(col[i] ?? "") })), ignoradas };
}

export interface ContatoImport { nome: string; emails: string[]; telefones: string[]; cargo: string; empresa: string; notas: string }
/**
 * Exportação do Google Contatos (contacts.google.com → Exportar → "CSV do Google"), formato novo ("First Name",
 * "E-mail 1 - Value", "Organization Name") e antigo ("Name", "Given Name", "Organization 1 - Name"); também uma
 * planilha simples com "Nome", "E-mail", "Telefone", "Empresa", "Cargo". Linhas sem nome, e-mail e telefone saem.
 */
export function planejarContatos(linhas: string[][]): { contatos: ContatoImport[]; ignoradas: number } {
  const [cab, ...dados] = linhas;
  if (!cab) return { contatos: [], ignoradas: 0 };
  const h = cab.map(norm);
  const col = (...nomes: string[]): number => h.findIndex((x) => nomes.includes(x));
  const cols = (re: RegExp): number[] => h.flatMap((x, i) => (re.test(x) ? [i] : []));
  const iNome = col("name", "nome", "nome completo", "full name", "display name");
  const iPrimeiro = col("first name", "given name", "primeiro nome", "nome proprio"); const iMeio = col("middle name", "additional name", "nome do meio");
  const iUltimo = col("last name", "family name", "sobrenome");
  const iEmpresa = col("organization name", "organization 1 - name", "empresa", "organizacao", "company");
  const iCargo = col("organization title", "organization 1 - title", "cargo", "title", "job title");
  const iNotas = col("notes", "notas", "observacoes");
  const iEmails = [...cols(/^e-?mail \d+ - value$/), ...cols(/^(e-?mail|email address)$/)];
  const iTels = [...cols(/^phone \d+ - value$/), ...cols(/^(telefone|phone|celular|whatsapp|mobile phone)$/)];
  const celula = (l: string[], i: number): string => (i >= 0 ? (l[i] ?? "").trim() : "");
  // O Google junta vários valores numa célula com " ::: ".
  const multi = (l: string[], is: number[]): string[] => [...new Set(is.flatMap((i) => celula(l, i).split(/\s*:::\s*/)).map((x) => x.trim()).filter(Boolean))];
  let ignoradas = 0; const contatos: ContatoImport[] = [];
  for (const l of dados) {
    const nome = celula(l, iNome) || [celula(l, iPrimeiro), celula(l, iMeio), celula(l, iUltimo)].filter(Boolean).join(" ");
    const emails = multi(l, iEmails).map((e) => e.toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const telefones = multi(l, iTels).filter((t) => t.replace(/\D/g, "").length >= 8);
    if (nome === "" && emails.length === 0 && telefones.length === 0) { ignoradas++; continue; }
    contatos.push({ nome, emails, telefones, cargo: celula(l, iCargo), empresa: celula(l, iEmpresa), notas: celula(l, iNotas) });
  }
  return { contatos, ignoradas };
}
