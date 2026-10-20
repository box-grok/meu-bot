/**
 * Variante: admin (só o super admin). Auditoria: a cópia central de cada máquina (usuário "auditoria" na caixa),
 * conferida com a cópia da própria máquina quando o suporte dela está ligado. Quem é cada máquina vem das pessoas
 * conhecidas do admin (mesmo id: chave do servidor + usuário + porta).
 */
import fs from "node:fs";
import path from "node:path";
import { app, dialog } from "electron";
import type { AuditoriaLinhaView, AuditoriaMaquinaView, AuditoriaVisao } from "../../shared/ipc";
import { centralMaquinas, centralRegistro, entregar, lerRegistroBruto } from "../auditoria";
import { conferir, textoDaLinha, type AuditoriaCentral } from "../auditoria-core";
import { isSuperAdmin, pessoasPorMaquina } from "./support-admin";

export async function auditoriaMaquinas(): Promise<{ superAdmin: boolean; maquinas: AuditoriaMaquinaView[]; erro: string | null }> {
  if (!isSuperAdmin()) return { superAdmin: false, maquinas: [], erro: null };
  const pessoas = pessoasPorMaquina();
  try {
    const lista = await centralMaquinas();
    const vistas = new Set(lista.map((m) => m.maquina));
    const maquinas: AuditoriaMaquinaView[] = lista.map((m) => { const p = pessoas.get(m.maquina); return { ...m, nome: p?.nome ?? null, alias: p?.alias ?? null, on: p?.on === true }; });
    // Pessoas com suporte que ainda não entregaram nada também aparecem (abrir uma entrega o registro delas).
    for (const [id, p] of pessoas) if (!vistas.has(id) && p.on) maquinas.push({ maquina: id, nome: p.nome, alias: p.alias, on: true, registros: 0, ultimo: "" });
    return { superAdmin: true, maquinas: maquinas.sort((a, b) => b.ultimo.localeCompare(a.ultimo)), erro: null };
  } catch (e) {
    return { superAdmin: true, maquinas: [], erro: e instanceof Error ? e.message : String(e) };
  }
}

const viaTexto = (r: AuditoriaCentral): string => (r.via.papel === "maquina" ? "app da pessoa" : `${r.via.papel === "super" ? "super admin" : "admin"} ${r.via.nome}`);

export async function auditoriaRegistro(maquina: string): Promise<AuditoriaVisao> {
  if (!isSuperAdmin()) throw new Error("só o super admin vê a auditoria");
  const p = pessoasPorMaquina().get(maquina) ?? null;
  // Suporte ligado: o que a máquina gravou e ainda não chegou vai agora, e a cópia dela entra na conferência.
  let maquinaBruto: Record<string, unknown>[] | null = null;
  let maquinaErro: string | null = null;
  if (p?.on === true) {
    await entregar(p.alias);
    try { maquinaBruto = await lerRegistroBruto(p.alias); } catch (e) { maquinaErro = e instanceof Error ? e.message : String(e); }
  }
  const central = await centralRegistro(maquina);
  const c = conferir(maquinaBruto ?? [], central.map((x) => x.bruto));
  const naMaquina = new Set((maquinaBruto ?? []).map((l) => String(l.hash)));
  const linhas: AuditoriaLinhaView[] = central.map(({ registro: r }) => ({
    em: r.linha.em, quemTipo: r.linha.quem.tipo, quemNome: r.linha.quem.nome, app: r.linha.app, acao: r.linha.acao, texto: textoDaLinha(r.linha), detalhe: r.linha.detalhe,
    via: viaTexto(r), recebidoEm: r.recebidoEm, naMaquina: maquinaBruto === null ? null : naMaquina.has(r.linha.hash),
  })).reverse();
  return {
    maquina, nome: p?.nome ?? null, linhas,
    centralQuebraEm: c.centralQuebraEm === null ? null : (central[c.centralQuebraEm]?.registro.n ?? c.centralQuebraEm + 1),
    maquinaLida: maquinaBruto !== null, maquinaQuebraEm: maquinaBruto === null ? null : c.maquinaQuebraEm, faltamNaMaquina: maquinaBruto === null ? 0 : c.faltamNaMaquina.length, maquinaErro,
  };
}

const csv = (v: string): string => `"${v.replace(/"/g, '""')}"`;
/** Prova para guardar ou entregar: o JSON da central (com os hashes, para reconferir) e um CSV legível ao lado. */
export async function auditoriaExportar(maquina: string): Promise<{ path: string } | null> {
  if (!isSuperAdmin()) throw new Error("só o super admin exporta a auditoria");
  const v = await auditoriaRegistro(maquina);
  const central = await centralRegistro(maquina);
  const nome = (v.nome ?? maquina).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
  const r = await dialog.showSaveDialog({ title: "Exportar auditoria", defaultPath: path.join(app.getPath("documents"), `auditoria-${nome}-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: "JSON", extensions: ["json"] }] });
  if (r.canceled || r.filePath === undefined || r.filePath === "") return null;
  const prova = { maquina, nome: v.nome, exportadoEm: new Date().toISOString(), conferencia: { centralQuebraEm: v.centralQuebraEm, maquinaLida: v.maquinaLida, maquinaQuebraEm: v.maquinaQuebraEm, faltamNaMaquina: v.faltamNaMaquina }, registros: central.map((x) => x.bruto) };
  fs.writeFileSync(r.filePath, `${JSON.stringify(prova, null, 2)}\n`, { mode: 0o600 });
  const linhas = [["quando", "quem", "tipo", "app", "o que", "detalhe", "entregue por", "recebido em", "na máquina"].map(csv).join(","),
    ...[...v.linhas].reverse().map((l) => [l.em, l.quemNome, l.quemTipo, l.app, l.texto, l.detalhe, l.via, l.recebidoEm, l.naMaquina === null ? "não lida" : l.naMaquina ? "sim" : "APAGADA"].map(csv).join(","))];
  fs.writeFileSync(r.filePath.replace(/\.json$/i, "") + ".csv", `${linhas.join("\n")}\n`, { mode: 0o600 });
  return { path: r.filePath };
}
