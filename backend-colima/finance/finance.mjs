#!/usr/bin/env node
/**
 * finance.mjs — CLI do financeiro do meu-bot para o agente da máquina (skill finance-api). Fala com o backend local
 * (/v1/finance/*; ver backend.mjs). Saída: JSON numa linha; erro → {"erro": "..."} e código 1 (2 = sem o produto
 * meu-bot-finance; 3 = backend fora). Valores em pt-BR ("48", "12,50", "1.234,56"); datas "hoje", "ontem", "21/10".
 *
 *   estado                                   contas com saldo, mês atual, pendências e o checklist do mês
 *   resumo [--mes AAAA-MM]                   gastos, renda e saldo do mês, por categoria
 *   lancar --valor V --favorecido "x" [--categoria c] [--conta c] [--data d] [--forma pix|debito|cartao|dinheiro]
 *          [--notas "…"] [--origem whatsapp|foto|chat|agente] [--pendente] [--forcar] [--comprovante <caminho da foto>]
 *   renda --valor V --fonte "x" [--indireto] [--data d] [--conta c]   (entrada = ganho do investimento: direto por padrão; --indireto = tempo/custo economizado)
 *   lancamentos [--mes AAAA-MM] [--status pendente|confirmado] [--categoria c] [--conta c] [--busca "x"] [--limite N]
 *   pendencias · confirmar <id|todas> [--categoria c] [--conta c] · descartar <id>
 *   corrigir <id> [--valor V] [--favorecido "x"] [--categoria c] [--conta c] [--data d] [--notas "…"]
 *   contas · conta-criar --nome "x" [--tipo corrente|poupanca|cartao|dinheiro|outra] [--moeda BRL|PYG|USD] [--saldo V] [--padrao]
 *   conta-editar <conta> [--nome "x"] [--tipo t] [--saldo V] [--padrao] [--fechar]
 *   categorias · categoria-criar --nome "x" [--grupo "g"] [--renda]
 *   mes <AAAA-MM> [--meta-direto V] [--meta-indireto V] [--meta-notas "conta"] [--orcamento V] [--renda-prevista V] [--dinheiro-informado sim|nao]   (orçamento = quanto gastar no mês; vale para os meses seguintes até mudar)
 *   linhas · linha-criar --nome "x" --tipo custo|ganho-direto|ganho-indireto [--valor V|"a definir"] [--notas "…"]
 *   linha-editar <chave> [--nome] [--tipo] [--valor V|"a definir"] [--notas] · linha-remover <chave>   (DRE prevista do mês)
 *   fechar-mes [--mes AAAA-MM]               (padrão: o mês anterior; recusa com pendências)
 */
import fs from "node:fs";
import path from "node:path";
import { financeApi } from "./backend.mjs";

const out = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`); };
const fail = (msg, code = 1, extra) => { out({ erro: msg, ...(extra ?? {}) }); process.exit(code); };
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const pos = []; const opt = {};
for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1]; if (v !== undefined && !v.startsWith("--")) { opt[k] = v; i++; } else opt[k] = true; } else pos.push(a); }
const q = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== true) p.set(k, String(v)); const s = p.toString(); return s === "" ? "" : `?${s}`; };
const POR = process.env.MEU_BOT_FINANCE_POR || "agente";
const api = (m, c, b) => financeApi(m, c, b, { por: POR });
const precisa = (v, o) => { if (v === undefined || v === true || v === "") fail(`falta ${o}`); return v; };
const sim = (v) => (v === undefined ? undefined : /^(sim|s|true|1)$/i.test(String(v)));

async function main() {
  switch (cmd) {
    case "estado": return out(await api("GET", "/estado"));
    case "resumo": return out(await api("GET", `/resumo${q({ mes: opt.mes })}`));
    case "lancar": {
      let midia;
      if (typeof opt.comprovante === "string") {
        let dados; try { dados = fs.readFileSync(opt.comprovante); } catch (e) { fail(`não consegui ler a foto: ${e.message}`); }
        const r = await api("POST", "/comprovantes", { base64: dados.toString("base64") });
        midia = { sha256: r.sha256, nome: path.basename(opt.comprovante) };
      }
      return out(await api("POST", "/lancamentos", {
        valor: precisa(opt.valor, "--valor"), favorecido: opt.favorecido ?? "", tipo: opt.tipo === "renda" ? "renda" : "gasto",
        ...(opt.categoria ? { categoria: opt.categoria } : {}), ...(opt.conta ? { conta: opt.conta } : {}), ...(opt.data ? { data: opt.data } : {}),
        ...(opt.forma ? { formaPagamento: opt.forma } : {}), ...(typeof opt.linha === "string" ? { linha: opt.linha } : {}), ...(opt.notas ? { notas: opt.notas } : {}),
        origem: midia ? "foto" : opt.origem ?? "agente", ...(opt.pendente ? { status: "pendente" } : {}), ...(opt.forcar ? { forcar: true } : {}), ...(midia ? { midia } : {}),
      }));
    }
    case "ganho":
    case "renda": return out(await api("POST", "/renda", { valor: precisa(opt.valor, "--valor"), fonte: opt.fonte ?? "", ...(opt.indireto ? { retorno: "indireto" } : {}), ...(opt.data ? { data: opt.data } : {}), ...(opt.conta ? { conta: opt.conta } : {}), origem: opt.origem ?? "agente" }));
    case "lancamentos": return out(await api("GET", `/lancamentos${q({ mes: opt.mes, status: opt.status, categoria: opt.categoria, conta: opt.conta, busca: opt.busca, limite: opt.limite })}`));
    case "pendencias": return out(await api("GET", "/pendencias"));
    case "confirmar": {
      const id = precisa(pos[0], "o id do lançamento (ou 'todas')");
      if (id === "todas") return out(await api("POST", "/pendencias/confirmar-todas", {}));
      return out(await api("POST", `/lancamentos/${encodeURIComponent(id)}/confirmar`, { ...(opt.categoria ? { categoria: opt.categoria } : {}), ...(opt.conta ? { conta: opt.conta } : {}) }));
    }
    case "descartar": return out(await api("POST", `/lancamentos/${encodeURIComponent(precisa(pos[0], "o id do lançamento"))}/descartar`, {}));
    case "corrigir": {
      const id = precisa(pos[0], "o id do lançamento"); const b = {};
      for (const k of ["valor", "favorecido", "categoria", "conta", "data", "notas", "linha"]) if (typeof opt[k] === "string") b[k] = opt[k];
      if (Object.keys(b).length === 0) fail("nada para corrigir: use --valor, --favorecido, --categoria, --conta, --data ou --notas");
      return out(await api("PUT", `/lancamentos/${encodeURIComponent(id)}`, b));
    }
    case "contas": return out(await api("GET", `/contas${opt.todas ? "?todas=1" : ""}`));
    case "conta-criar": return out(await api("POST", "/contas", { nome: precisa(opt.nome, "--nome"), ...(opt.tipo ? { tipo: opt.tipo } : {}), ...(opt.moeda ? { moeda: String(opt.moeda).toUpperCase() } : {}), ...(opt.saldo ? { saldoInicial: opt.saldo } : {}), ...(opt.padrao ? { padrao: true } : {}) }));
    case "conta-editar": {
      const k = precisa(pos[0], "a chave da conta (veja 'contas')");
      return out(await api("PUT", `/contas/${encodeURIComponent(k)}`, { ...(opt.nome ? { nome: opt.nome } : {}), ...(opt.tipo ? { tipo: opt.tipo } : {}), ...(opt.saldo ? { saldoInicial: opt.saldo } : {}), ...(opt.padrao ? { padrao: true } : {}), ...(opt.fechar ? { fechada: true } : {}) }));
    }
    case "categorias": return out(await api("GET", "/categorias"));
    case "categoria-criar": return out(await api("POST", "/categorias", { nome: precisa(opt.nome, "--nome"), ...(opt.grupo ? { grupo: opt.grupo } : {}), ...(opt.renda ? { renda: true } : {}) }));
    case "mes": {
      const ym = precisa(pos[0], "o mês (AAAA-MM)"); const b = {};
      if (opt.orcamento !== undefined) b.orcamento = opt.orcamento;
      if (opt["meta-direto"] !== undefined) b.metaDireto = opt["meta-direto"];
      if (opt["meta-indireto"] !== undefined) b.metaIndireto = opt["meta-indireto"];
      if (typeof opt["meta-notas"] === "string") b.metaNotas = opt["meta-notas"];
      if (opt["renda-prevista"] !== undefined) b.rendaPrevista = opt["renda-prevista"];
      if (opt["dinheiro-informado"] !== undefined) b.dinheiroInformado = sim(opt["dinheiro-informado"]);
      return out(await api("PUT", `/meses/${encodeURIComponent(ym)}`, b));
    }
    case "linhas": return out(await api("GET", "/linhas"));
    case "linha-criar": return out(await api("POST", "/linhas", { nome: precisa(opt.nome, "--nome"), tipo: precisa(opt.tipo, "--tipo (custo, ganho-direto ou ganho-indireto)"), ...(opt.valor !== undefined ? { valor: opt.valor === true ? null : opt.valor } : {}), ...(typeof opt.notas === "string" ? { notas: opt.notas } : {}) }));
    case "linha-editar": { const k = precisa(pos[0], "a chave da linha (veja 'linhas')"); const b = {}; for (const x of ["nome", "tipo", "notas"]) if (typeof opt[x] === "string") b[x] = opt[x]; if (opt.valor !== undefined) b.valor = opt.valor === true ? null : opt.valor; return out(await api("PUT", `/linhas/${encodeURIComponent(k)}`, b)); }
    case "linha-remover": return out(await api("POST", `/linhas/${encodeURIComponent(precisa(pos[0], "a chave da linha"))}/remover`, {}));
    case "fechar-mes": return out(await api("POST", "/fechamento", opt.mes ? { mes: opt.mes } : {}));
    default: fail(`comando desconhecido: ${cmd || "(nenhum)"}; veja o cabeçalho de finance.mjs`);
  }
}
main().catch((e) => fail(e.message, e.code === "finance_license" ? 2 : e.code === "backend_fora" ? 3 : 1, e.extra && typeof e.extra === "object" ? Object.fromEntries(Object.entries(e.extra).filter(([k]) => !["message", "type", "code"].includes(k))) : undefined));
