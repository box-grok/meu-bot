/**
 * Variante: cliente. Handlers IPC só do meu-bot normal: conversar com o agente, parear e mexer no WhatsApp,
 * logins, instalar coisas na máquina, suporte do lado da pessoa. No meu-bot-admin cada canal daqui vira um
 * stub que recusa (ipc/registry.ts): o admin só lê e usa as ações de suporte.
 */
import { VOZES, isVozId } from "../whatsapp/vozes-core";
import { app, dialog, Menu, Notification } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AudioSetup, ClaudeLoginEvent, ClaudeSessionRef, ExportFormat, LimiaresClaude, TabMenuAction, WhatsappEvent } from "../../shared/ipc";
import { conversationToMarkdown, conversationTitle, slugify } from "../conversa/export";
import { atualizarContaClaude, conferirContaClaude, criarContaClaude, deleteBackendSession, fetchAccountStatus, fetchAlertPrefs, fetchBackendSession, fetchContasClaude, limiaresContasClaude, log, removerContaClaude, reordenarContasClaude, runBackendTurn, saveAlertPrefs, usarAgoraContaClaude } from "../maquina/backend";
import { lerLicenca, lerLicencaDaMaquina } from "../licenca/licenca-maquina";
import { assertAcesso, assertFinance } from "../licenca/acesso";
import { esquecerPermissoes, responderPermissao } from "../navegador/nav-permissoes";
import { financeAbc, financeImportarPlanilha, financeCategorias, financeComprovante, financeConfig, financeConfigLer, financeCorrigir, financeLinhaRemover, financeLinhaSalvar, financeConfirmar, financeConfirmarTodas, financeContaCriar, financeDescartar, financeFecharMes, financeInfo, financeLancamentos, financeLancar, financeMes } from "../financeiro/finance-local";
import { navWhatsappInfo, setNavWhatsapp } from "../navegador/navegador-whatsapp";
import { crmCriarPipeline, crmDefinirPadrao, crmLocal } from "../crm/crm-local";
import { caps } from "../app/variant";
import { disableSshCheck, restoreLastPolicy } from "../maquina/tailscale";
import { cancelPairing, runSsh, setDmPolicy, startPairing, whatsappBranch, whatsappEscolherAgente, whatsappLogout, whatsappStatus } from "../whatsapp/whatsapp";
import { pauseRuleSh } from "../whatsapp/whatsapp-pause";
import { cancelClaudeLogin, claudeLogout, startClaudeLogin, submitClaudeLoginCode } from "../agente/claudeLogin";
import { cancelXaiLogin, startXaiLogin, xaiLogout } from "../agente/xaiLogin";
import { cancelarConta, entrarConta, instalarGh, sairConta } from "../agente/contas-cli";
import { isContaId } from "../agente/contas-cli-core";
import {
  archiveConversation, branchConversation, closeTab, createConversation, dropConversation, duplicateConversation, getConversation,
  getStoredConversation, listConversationsForHost, openConversation, persistConversations, renameConversation, reorderConversations, setConversationModel,
} from "../conversa/conversation";
import { APAGADAS_FILE, conversasApagadas, parseApagadas } from "../conversa/apagadas-core";
import { LOCAL_HOST } from "../maquina/localBackend";

/** Depois de um turno, guarda a sessão do Claude Code desta conversa (o .jsonl): a referência vale mesmo depois do TTL do backend. */
async function rememberClaudeSession(conv: { id: string; host: string; claude?: ClaudeSessionRef }): Promise<ClaudeSessionRef | null> {
  const ref = await fetchBackendSession(conv.host, conv.id);
  if (ref !== null && (conv.claude === undefined || conv.claude.sessionId !== ref.sessionId)) { conv.claude = ref; persistConversations(); }
  return ref ?? conv.claude ?? null;
}
import { getHostNames, isBackendModel } from "../app/settings";
import { objectiveInfo, resetObjective, saveObjectiveSkill, setObjective } from "../agente/objetivo";
import { crmInfo, crmTest, resetCrm, setCrm } from "../crm/crm";
import { toggleQuickEntry } from "../app/quickEntry";
import { guardaInstalled, installAudio, installCrm, installFinance, installGuarda, installNavegador, installStatusLine, navegadorInstalled, prepareGrokOauth, statusLineInstalled, uninstallCrm, uninstallGuarda, uninstallStatusLine } from "../maquina/hostProbe";
import { readSegments, writeSegments } from "../agente/statusLine";
import { deliverNow, reportSupportProgress, resetSupport, setSupport, setSupportNameOnly, setSupportShare, supportCodeText, supportInfo } from "../client/support";
import { openMainWindow, sendWhenLoaded } from "../app/windows";
import { hostFromEvent, ownedConversation, waNumber } from "./context";
import { handleClient, onClient } from "./registry";
import { browserAgent, browserAgentInfo, browserExtensions, browserOpen, browserRemoveExtension, browserSetActive, browserSincronizarCrm, browserFavoriteAdd, browserFavoriteRemove, browserWorkspacesSet } from "../navegador/browser";
import { registrar } from "../auditoria/auditoria";

/**
 * Padrão do app: máquina cujo agente transcreve áudio (capacidade `audio`) entende áudios depois de parear. Depois de parear, se não há transcritor, instala
 * (uma vez; baixa ~500 MB) e conta pelo mesmo canal de eventos do pareamento. O admin pode desativar depois.
 */
async function ensureTranscription(host: string, send: (ev: WhatsappEvent) => void): Promise<void> {
  const st = await whatsappStatus(host).catch(() => null);
  if (st === null || !st.capacidades.audio || st.audioIn !== false) return;
  send({ kind: "step", text: "ligando a transcrição de áudio (padrão do meu-bot; baixa ~500 MB só na primeira vez)…" });
  const r = await installAudio(host, { kind: "in" }, (line) => send({ kind: "log", text: line }));
  send({ kind: r.ok ? "step" : "log", text: r.ok ? "transcrição de áudio pronta: o agente entende áudios" : `a transcrição não ligou: ${r.log.at(-1) ?? "erro"}` });
}

/**
 * Padrão do app: o agente sabe o que é a pausa do meu-bot. Depois de parear, grava no AGENTS.md do workspace a
 * regra das notas de pausa (whatsapp-pause.ts); idempotente. Toda pausa confere de novo (máquinas antigas).
 */
async function ensurePauseRule(host: string, send: (ev: WhatsappEvent) => void): Promise<void> {
  const st = await whatsappStatus(host).catch(() => null);
  // A regra vai no AGENTS.md do workspace do OpenClaw; no Hermes pausar é tirar da lista (o agente nem vê a mensagem).
  if (st === null || !st.capacidades.pausar || st.gateway !== "openclaw") return;
  const r = await runSsh(host, `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH\n${pauseRuleSh()}\n`, 30_000).catch(() => null);
  const rule = r === null ? "erro" : (/REGRA=(\S+)/.exec(r.stdout)?.[1] ?? "erro");
  send({ kind: rule === "erro" ? "log" : "step", text: rule === "erro" ? "não deu para gravar a regra de pausa no AGENTS.md do agente" : rule === "1" ? "regra de pausa do meu-bot gravada no agente (AGENTS.md)" : "regra de pausa do meu-bot já estava no agente" });
}

export function registerClientIpc(): void {
  // Suporte, lado da pessoa (só com o pacote de suporte no .dmg).
  handleClient("support:info", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return supportInfo(h.host);
  });
  handleClient("support:set", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { on?: unknown; name?: unknown } | null;
    return setSupport(h.host, p?.on === true, typeof p?.name === "string" ? p.name : "");
  });
  handleClient("support:progress", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) return;
    await reportSupportProgress(h.host, payload).catch(() => undefined);
  });
  handleClient("support:name", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return setSupportNameOnly(h.host, String((payload as { name?: unknown } | null)?.name ?? ""));
  });
  handleClient("support:deliver", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return deliverNow(h.host);
  });
  handleClient("support:code", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return supportCodeText(h.host);
  });
  handleClient("support:share", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return setSupportShare(h.host, payload);
  });
  // Tutorial 7 · objetivo do WhatsApp: tudo mora na máquina (objetivo.json, skill no workspace, trava do nível).
  handleClient("objective:info", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return objectiveInfo(h.host);
  });
  handleClient("objective:set", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return setObjective(h.host, payload);
  });
  handleClient("objective:save", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    // A trava do objetivo regrava toolsBySender: o Navegador do WhatsApp (se ligado) refaz a lista dos liberados.
    return saveObjectiveSkill(h.host, getHostNames()[h.host] ?? h.host).finally(() => { void setNavWhatsapp(h.host, "sincronizar").catch(() => undefined); });
  });
  handleClient("objective:reset", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return resetObjective(h.host).finally(() => { void setNavWhatsapp(h.host, "sincronizar").catch(() => undefined); });
  });
  // "Refazer do zero" do tutorial de suporte: desliga e esquece o nome.
  handleClient("support:reset", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return resetSupport(h.host);
  });

  // Grok por OAuth em máquina sem Hermes: instala Hermes + proxy (install-grok-oauth.sh); cada linha vai ao log do login.
  handleClient("xai-login:prepare", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return prepareGrokOauth(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("xai-login:event", { kind: "log", text: line }); });
  });
  // Status line do Claude (tutorial): checar e instalar na máquina desta janela.
  handleClient("statusline:status", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return statusLineInstalled(h.host);
  });
  handleClient("statusline:install", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return installStatusLine(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("statusline:progress", { line }); });
  });
  // Aba "Navegador" (módulo Pro): a sessão é da máquina da janela; abrir exige plano Pro (o renderer já bloqueia;
  // aqui é a defesa). Os <webview> são do renderer; o main só prepara a sessão e cuida das extensões.
  const ctxOf = (event: Electron.IpcMainInvokeEvent) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return h; };
  handleClient("browser:open", async (event) => {
    const h = ctxOf(event);
    await assertAcesso(h.host);
    return browserOpen(h.win, h.host, await lerLicencaDaMaquina(h.host).catch(() => null)); // a extensão do CRM segue a licença e o backend
  });
  handleClient("browser:extensions", (event) => browserExtensions(ctxOf(event).host));
  // O agente do WhatsApp também usa o Navegador: só o número do agente e a lista dos grupos (trava do OpenClaw por remetente).
  handleClient("browser:agent-whatsapp", async (event, payload: unknown) => {
    const h = ctxOf(event);
    const on = (payload as { on?: unknown } | null)?.on;
    if (typeof on !== "boolean") return navWhatsappInfo(h.host);
    await assertAcesso(h.host);
    const r = await setNavWhatsapp(h.host, on);
    void registrar(h.host, on ? "navegador.whatsapp-ligar" : "navegador.whatsapp-desligar", r.liberados.map((n) => `+${n}`).join(", "));
    return r;
  });
  handleClient("browser:agent", (event, payload: unknown) => { const h = ctxOf(event); browserAgent(h.host, (payload as { on?: unknown } | null)?.on === true); return browserAgentInfo(h.host); });
  onClient("browser:active", (event, payload: unknown) => { const h = hostFromEvent(event); const id = (payload as { wcId?: unknown } | null)?.wcId; if (h !== null && typeof id === "number") browserSetActive(h.host, id); });
  handleClient("browser:remove-extension", (event, payload: unknown) => { const id = (payload as { extId?: unknown } | null)?.extId; if (typeof id !== "string" || !/^[a-p]{32}$/.test(id)) throw new Error("id de extensão inválido"); return browserRemoveExtension(ctxOf(event).host, id); });
  handleClient("browser:favorite-add", (event, payload: unknown) => { const p = payload as { titulo?: unknown; url?: unknown } | null; if (typeof p?.url !== "string") throw new Error("falta url"); return browserFavoriteAdd(ctxOf(event).host, { titulo: typeof p.titulo === "string" ? p.titulo : "", url: p.url }); });
  handleClient("browser:favorite-remove", (event, payload: unknown) => { const id = (payload as { id?: unknown } | null)?.id; if (typeof id !== "string" || id === "") throw new Error("falta id"); return browserFavoriteRemove(ctxOf(event).host, id); });
  handleClient("browser:workspaces-set", (event, payload: unknown) => { const h = ctxOf(event); return browserWorkspacesSet(h.host, (payload as { espacos?: unknown } | null)?.espacos, h.win); });
  handleClient("browser:permissao", (event, payload: unknown) => { ctxOf(event); const p = (payload ?? {}) as { id?: unknown; decisao?: unknown }; if (typeof p.id === "string" && (p.decisao === "sempre" || p.decisao === "agora" || p.decisao === "nunca")) responderPermissao(p.id, p.decisao); });
  handleClient("browser:permissoes-esquecer", (event, payload: unknown) => { const h = ctxOf(event); const o = (payload as { origem?: unknown } | null)?.origem; esquecerPermissoes(h.host, typeof o === "string" ? o : undefined); });
  handleClient("browser:request-pro", async (event) => { const h = ctxOf(event); const pedido = caps().planoExigido === "free" ? "pediu o plano Pro (aba Navegador)" : `pediu para liberar o ${caps().produto} (assinatura)`; await registrar(h.host, "plano.pedir", pedido); log(`[navegador] ${h.host}: ${pedido}`); });
  // Tutorial 10 · CRM pelo WhatsApp (Pro): estado, instalar plugin, gravar chave/pipeline/regras, testar, refazer.
  // Financeiro (produto meu-bot-finance): página Finanças e tutorial 14. Tudo passa pelo gate da licença (o backend confere de novo).
  const fin = async (event: Electron.IpcMainInvokeEvent): Promise<string> => { const h = ctxOf(event); await assertFinance(h.host); return h.host; };
  const txt = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : undefined);
  const mesOk = (v: unknown): string => { if (typeof v !== "string" || !/^\d{4}-\d{2}$/.test(v)) throw new Error("mês inválido"); return v; };
  const idOk = (v: unknown): string => { if (typeof v !== "string" || !/^[A-Za-z0-9_-]{2,80}$/.test(v)) throw new Error("lançamento inválido"); return v; };
  handleClient("finance:info", async (event) => financeInfo(await fin(event)));
  handleClient("finance:importar-planilha", async (event, payload: unknown) => {
    const p = (payload ?? {}) as { link?: unknown; aba?: unknown; tipo?: unknown; simular?: unknown };
    if (typeof p.link !== "string" || p.link.length > 500) throw new Error("link inválido");
    const host = await fin(event);
    const r = await financeImportarPlanilha(host, { link: p.link, ...(typeof p.aba === "string" ? { aba: p.aba } : {}), tipo: p.tipo === "venda" ? "venda" : "compra", simular: p.simular !== false });
    if (!r.simulado && r.importadas > 0) void registrar(host, "financeiro.importar", `planilha ${r.planilha}`, `${r.importadas} lançamento(s)`);
    return r;
  });
  handleClient("finance:abc", async (event, payload: unknown) => {
    const p = (payload ?? {}) as { lado?: unknown; por?: unknown; meses?: unknown; ate?: unknown };
    const lado = p.lado === "venda" ? "venda" : "compra"; const por = p.por === "categoria" ? "categoria" : p.por === "favorecido" ? "favorecido" : "produto";
    const meses = Number.isInteger(p.meses) ? Math.min(24, Math.max(1, p.meses as number)) : 3;
    return financeAbc(await fin(event), { lado, por, meses, ...(p.ate !== undefined ? { ate: mesOk(p.ate) } : {}) });
  });
  handleClient("finance:lancamentos", async (event, payload: unknown) => { const p = (payload ?? {}) as { mes?: unknown; status?: unknown; limite?: unknown }; return financeLancamentos(await fin(event), { ...(p.mes !== undefined ? { mes: mesOk(p.mes) } : {}), ...(p.status === "pendente" || p.status === "confirmado" ? { status: p.status } : {}), ...(typeof p.limite === "number" ? { limite: Math.min(500, Math.max(1, Math.trunc(p.limite))) } : {}) }); });
  handleClient("finance:categorias", async (event) => financeCategorias(await fin(event)));
  handleClient("finance:lancar", async (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>; const host = await fin(event);
    const valor = txt(p.valor, 30); if (valor === undefined) throw new Error("diga o valor");
    const l = await financeLancar(host, { valor, favorecido: txt(p.favorecido, 80) ?? "", ...(p.tipo === "renda" ? { tipo: "renda" as const } : {}), ...(p.retorno === "indireto" || p.retorno === "direto" ? { retorno: p.retorno } : {}), ...(txt(p.categoria) ? { categoria: txt(p.categoria)! } : {}), ...(txt(p.conta) ? { conta: txt(p.conta)! } : {}), ...(txt(p.data, 12) ? { data: txt(p.data, 12)! } : {}), ...(txt(p.notas, 500) ? { notas: txt(p.notas, 500)! } : {}) });
    void registrar(host, "finance.lancar", `${l.valor} · ${l.categoriaNome}`); return l;
  });
  handleClient("finance:confirmar", async (event, payload: unknown) => { const p = (payload ?? {}) as { id?: unknown; categoria?: unknown }; return financeConfirmar(await fin(event), idOk(p.id), txt(p.categoria)); });
  handleClient("finance:descartar", async (event, payload: unknown) => { const host = await fin(event); const id = idOk((payload as { id?: unknown } | null)?.id); await financeDescartar(host, id); void registrar(host, "finance.descartar", id); });
  handleClient("finance:corrigir", async (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>; const host = await fin(event); const id = idOk(p.id);
    const patch: Record<string, string | null> = {};
    for (const [k, max] of [["valor", 30], ["favorecido", 80], ["categoria", 80], ["data", 12], ["notas", 500]] as const) if (typeof p[k] === "string") patch[k] = String(p[k]).slice(0, max);
    if (p.linha === null || typeof p.linha === "string") patch.linha = p.linha === null || p.linha === "" ? null : String(p.linha).slice(0, 80);
    if (p.conta === null || typeof p.conta === "string") patch.conta = p.conta === null || p.conta === "" ? null : String(p.conta).slice(0, 80);
    if (Object.keys(patch).length === 0) throw new Error("nada para corrigir");
    const l = await financeCorrigir(host, id, patch); void registrar(host, "finance.corrigir", `${l.valor} · ${l.categoriaNome}`); return l;
  });
  handleClient("finance:linha-salvar", async (event, payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>; const host = await fin(event);
    const nome = txt(p.nome, 80); if (nome === undefined) throw new Error("dê um nome à linha");
    if (p.tipo !== "custo" && p.tipo !== "ganho-direto" && p.tipo !== "ganho-indireto") throw new Error("tipo de linha inválido");
    const key = p.key === undefined ? undefined : idOk(p.key);
    await financeLinhaSalvar(host, { ...(key ? { key } : {}), nome, tipo: p.tipo, valor: typeof p.valor === "string" && p.valor.trim() !== "" ? p.valor.slice(0, 30) : null, ...(typeof p.notas === "string" ? { notas: p.notas.slice(0, 500) } : {}) });
    void registrar(host, "finance.linha", `${nome} (${p.tipo})`);
  });
  handleClient("finance:linha-remover", async (event, payload: unknown) => { const host = await fin(event); const key = idOk((payload as { key?: unknown } | null)?.key); await financeLinhaRemover(host, key); void registrar(host, "finance.linha", `removeu ${key}`); });
  handleClient("finance:comprovante", async (event, payload: unknown) => { const sha = (payload as { sha256?: unknown } | null)?.sha256; if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) throw new Error("comprovante inválido"); return financeComprovante(await fin(event), sha); });
  handleClient("finance:confirmar-todas", async (event) => financeConfirmarTodas(await fin(event)));
  handleClient("finance:conta-criar", async (event, payload: unknown) => { const p = (payload ?? {}) as Record<string, unknown>; const nome = txt(p.nome, 80); if (nome === undefined) throw new Error("dê um nome à conta"); return financeContaCriar(await fin(event), { nome, ...(txt(p.tipo, 20) ? { tipo: txt(p.tipo, 20)! } : {}), ...(txt(p.moeda, 8) ? { moeda: txt(p.moeda, 8)! } : {}), ...(txt(p.saldoInicial, 30) ? { saldoInicial: txt(p.saldoInicial, 30)! } : {}) }); });
  handleClient("finance:config-ler", async (event) => financeConfigLer(await fin(event)));
  handleClient("finance:config-salvar", async (event, payload: unknown) => { const p = (payload ?? {}) as Record<string, unknown>; const patch: { taxas?: Record<string, number>; moedaExibicao?: string } = {}; if (p.taxas && typeof p.taxas === "object") { const t: Record<string, number> = {}; for (const [k, v] of Object.entries(p.taxas as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v > 0) t[k] = v; patch.taxas = t; } if (txt(p.moedaExibicao, 8)) patch.moedaExibicao = txt(p.moedaExibicao, 8)!; return financeConfig(await fin(event), patch); });
  handleClient("finance:mes", async (event, payload: unknown) => { const p = (payload ?? {}) as Record<string, unknown>; return financeMes(await fin(event), mesOk(p.mes), { ...(p.metaDireto === null || typeof p.metaDireto === "string" ? { metaDireto: p.metaDireto as string | null } : {}), ...(p.metaIndireto === null || typeof p.metaIndireto === "string" ? { metaIndireto: p.metaIndireto as string | null } : {}), ...(typeof p.metaNotas === "string" ? { metaNotas: p.metaNotas.slice(0, 500) } : {}), ...(p.orcamento === null || typeof p.orcamento === "string" ? { orcamento: p.orcamento as string | null } : {}), ...(p.rendaPrevista === null || typeof p.rendaPrevista === "string" ? { rendaPrevista: p.rendaPrevista as string | null } : {}), ...(typeof p.dinheiroInformado === "boolean" ? { dinheiroInformado: p.dinheiroInformado } : {}) }); });
  handleClient("finance:fechar-mes", async (event, payload: unknown) => { const host = await fin(event); const mes = mesOk((payload as { mes?: unknown } | null)?.mes); await financeFecharMes(host, mes); void registrar(host, "finance.fechar-mes", mes); });
  handleClient("finance:install", async (event) => { const h = ctxOf(event); await assertFinance(h.host); const r = await installFinance(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("finance:progress", { line }); }); if (r.ok) void registrar(h.host, "finance.instalar"); return r; });
  handleClient("finance:pedir", async (event) => { const h = ctxOf(event); await registrar(h.host, "plano.pedir", "pediu para liberar o meu-bot-finance (financeiro)"); log(`[finance] ${h.host}: pediu o meu-bot-finance`); });
  handleClient("crm:info", (event) => crmInfo(ctxOf(event).host));
  // Tutorial 10 (meu-bot-crm): o primeiro pipeline do CRM da máquina e qual é o do WhatsApp.
  handleClient("crm:local", (event) => crmLocal(ctxOf(event).host));
  handleClient("crm:pipeline-criar", async (event, payload: unknown) => {
    const h = ctxOf(event); await assertAcesso(h.host);
    const p = payload as { name?: unknown; stages?: unknown } | null;
    if (typeof p?.name !== "string" || p.name.trim() === "" || p.name.length > 60) throw new Error("nome inválido");
    if (!Array.isArray(p.stages) || p.stages.length < 2 || p.stages.length > 12 || !p.stages.every((s) => typeof s === "string" && s.trim() !== "" && s.length <= 40)) throw new Error("etapas inválidas (2 a 12)");
    const r = await crmCriarPipeline(h.host, p.name.trim(), (p.stages as string[]).map((s) => s.trim()));
    void registrar(h.host, "crm.pipeline-criar", `"${p.name.trim()}"`);
    return r;
  });
  handleClient("crm:pipeline-padrao", async (event, payload: unknown) => {
    const h = ctxOf(event); await assertAcesso(h.host);
    const key = (payload as { key?: unknown } | null)?.key;
    if (typeof key !== "string" || !/^[\w-]{1,80}$/.test(key)) throw new Error("pipeline inválido");
    const r = await crmDefinirPadrao(h.host, key);
    void registrar(h.host, "crm.pipeline-padrao", `"${r.pipelines.find((x) => x.key === key)?.name ?? key}"`);
    return r;
  });
  handleClient("crm:install", async (event) => { const h = ctxOf(event); await assertAcesso(h.host); const r = await installCrm(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("crm:progress", { line }); }); if (r.ok) void registrar(h.host, "crm.instalar"); return r; });
  handleClient("crm:set", (event, payload: unknown) => setCrm(ctxOf(event).host, payload));
  handleClient("crm:test", (event) => crmTest(ctxOf(event).host));
  handleClient("crm:reset", async (event) => { const h = ctxOf(event); await uninstallCrm(h.host).catch(() => undefined); void registrar(h.host, "crm.desinstalar"); return resetCrm(h.host); });
  // Guarda do WhatsApp (tutorial): está? instalar (progresso em guarda:progress) e desfazer.
  handleClient("guarda:status", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return guardaInstalled(h.host); });
  handleClient("navegador:status", (event) => navegadorInstalled(ctxOf(event).host));
  handleClient("navegador:install", (event) => { const h = ctxOf(event); return installNavegador(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("navegador:progress", { line }); }); });
  handleClient("guarda:install", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return installGuarda(h.host, (line) => { if (!h.win.isDestroyed()) h.win.webContents.send("guarda:progress", { line }); });
  });
  handleClient("guarda:uninstall", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return uninstallGuarda(h.host); });
  // Segmentos da status line (preferência na máquina) e "Refazer do zero".
  handleClient("statusline:segments", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return readSegments(h.host);
  });
  handleClient("statusline:set-segments", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return writeSegments(h.host, payload);
  });
  handleClient("statusline:uninstall", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return uninstallStatusLine(h.host);
  });
  handleClient("tailscale:disable-check", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return disableSshCheck();
  });
  handleClient("tailscale:restore", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return restoreLastPolicy();
  });

  // WhatsApp: parear, áudio, política, pausar, limpar.
  handleClient("whatsapp:pair", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const reset = (payload as { reset?: unknown } | null)?.reset === true;
    let connected = false;
    const send = (ev: WhatsappEvent): void => { if (ev.kind === "connected") connected = true; if (!h.win.isDestroyed()) h.win.webContents.send("whatsapp:event", ev); };
    await startPairing(h.host, reset, send);
    if (connected) { void ensureTranscription(h.host, send); void ensurePauseRule(h.host, send); void registrar(h.host, "whatsapp.parear"); }
  });
  handleClient("whatsapp:audio", async (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { kind?: unknown; mode?: unknown } | null;
    const voz = (p as { voz?: unknown } | null)?.voz;
    const setup: AudioSetup | null = p?.kind === "in" ? { kind: "in", ...((p as { off?: unknown }).off === true ? { off: true } : {}) }
      : p?.kind === "out" && (p.mode === "off" || p.mode === "inbound" || p.mode === "always") ? { kind: "out", mode: p.mode, ...(isVozId(voz) ? { voz } : {}) } : null;
    if (setup === null) throw new Error("pedido inválido");
    const r = await installAudio(h.host, setup);
    if (r.ok && setup.kind === "out" && setup.voz !== undefined) void registrar(h.host, "audio.voz", VOZES.find((v) => v.id === setup.voz)?.rotulo.toLowerCase() ?? setup.voz);
    return r;
  });
  handleClient("whatsapp:logout", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappLogout(h.host).then(() => { void registrar(h.host, "whatsapp.desconectar"); });
  });
  handleClient("whatsapp:dm-policy", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { policy?: unknown; numbers?: unknown } | null;
    const policy = p?.policy;
    if (policy !== "open" && policy !== "self" && policy !== "list") throw new Error("política inválida");
    const numbers = Array.isArray(p?.numbers) ? p.numbers.filter((n): n is string => typeof n === "string") : [];
    if (policy === "list" && numbers.length === 0) throw new Error("a lista precisa de pelo menos um número");
    return setDmPolicy(h.host, policy, numbers).then((r) => { void registrar(h.host, "whatsapp.quem-responde", policy === "open" ? "todo mundo" : policy === "self" ? "só você" : `você e ${numbers.length} números`); return r; });
  });
  handleClient("whatsapp:agente", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const agente = (payload as { agente?: unknown } | null)?.agente;
    if (agente !== "openclaw" && agente !== "hermes") throw new Error("agente inválido");
    return whatsappEscolherAgente(h.host, agente).then((r) => { void registrar(h.host, "whatsapp.agente", agente === "openclaw" ? "OpenClaw" : "Hermes"); return r; });
  });
  handleClient("whatsapp:branch", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return whatsappBranch(h.host, waNumber(payload));
  });
  handleClient("whatsapp:cancel", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    cancelPairing();
  });

  // Logins Claude e xAI.
  handleClient("claude-login:start", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return startClaudeLogin(h.host, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("claude-login:event", ev); });
  });
  handleClient("claude-login:code", (event, payload: unknown) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    return submitClaudeLoginCode(String((payload as { code?: unknown } | null)?.code ?? ""));
  });
  handleClient("claude-login:logout", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return claudeLogout(h.host);
  });
  handleClient("claude-login:cancel", (event) => {
    if (hostFromEvent(event) === null) throw new Error("origem inválida");
    cancelClaudeLogin();
  });

  // Várias contas do Claude na máquina (backend: contas-claude.js). O login numa conta isolada é o mesmo fluxo do
  // tutorial 1 (link + código, eventos em claude-login:event), só que com CLAUDE_CONFIG_DIR na pasta da conta.
  const contaId = (payload: unknown): string => { const id = String((payload as { id?: unknown } | null)?.id ?? ""); if (!/^(padrao|c-[a-f0-9]{8})$/.test(id)) throw new Error("conta inválida"); return id; };
  const entrarNaConta = async (h: { host: string; win: Electron.BrowserWindow }, id: string): Promise<void> => {
    const view = await fetchContasClaude(h.host);
    const conta = view?.contas.find((c) => c.id === id);
    if (conta === undefined) throw new Error("conta não encontrada na máquina (backend antigo?)");
    const send = (ev: ClaudeLoginEvent): void => { if (!h.win.isDestroyed()) h.win.webContents.send("claude-login:event", ev); };
    await startClaudeLogin(h.host, send, conta.home ?? undefined);
    await conferirContaClaude(h.host, id); // o backend relê login, e-mail e uso
  };
  handleClient("contas-claude:listar", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return fetchContasClaude(h.host); });
  handleClient("contas-claude:criar", async (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const rotulo = String((payload as { rotulo?: unknown } | null)?.rotulo ?? "").slice(0, 60);
    const r = await criarContaClaude(h.host, rotulo);
    if (r === null) throw new Error("o backend desta máquina não tem contas (atualize o backend no seletor)");
    return r; // o renderer abre o login na conta nova (contas-claude:entrar); o backend registra na auditoria da máquina
  });
  handleClient("contas-claude:entrar", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return entrarNaConta(h, contaId(payload)); });
  handleClient("contas-claude:atualizar", (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const p = payload as { rotulo?: unknown; ativa?: unknown };
    return atualizarContaClaude(h.host, contaId(payload), { ...(typeof p.rotulo === "string" ? { rotulo: p.rotulo.slice(0, 60) } : {}), ...(typeof p.ativa === "boolean" ? { ativa: p.ativa } : {}) });
  });
  handleClient("contas-claude:reordenar", (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const ids = (payload as { ids?: unknown } | null)?.ids;
    return reordenarContasClaude(h.host, Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && /^c-[a-f0-9]{8}$/.test(x)) : []);
  });
  handleClient("contas-claude:remover", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return removerContaClaude(h.host, contaId(payload)); });
  handleClient("contas-claude:usar-agora", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return usarAgoraContaClaude(h.host, contaId(payload)); });
  handleClient("contas-claude:conferir", (event, payload: unknown) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return conferirContaClaude(h.host, contaId(payload)); });
  handleClient("contas-claude:limiares", (event, payload: unknown) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const p = (payload ?? {}) as { sessao?: unknown; semanal?: unknown; estrategia?: unknown };
    const pct = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.max(50, Math.min(100, Math.round(v))) : undefined);
    const l: Partial<LimiaresClaude> = {};
    const s = pct(p.sessao); if (s !== undefined) l.sessao = s;
    const w = pct(p.semanal); if (w !== undefined) l.semanal = w;
    if (p.estrategia === "ordem" || p.estrategia === "folga") l.estrategia = p.estrategia;
    return limiaresContasClaude(h.host, l);
  });
  handleClient("xai-login:start", (event) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    return startXaiLogin(h.host, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("xai-login:event", ev); });
  });
  handleClient("xai-login:cancel", (event) => { if (hostFromEvent(event) === null) throw new Error("origem inválida"); cancelXaiLogin(); });
  handleClient("xai-login:logout", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return xaiLogout(h.host); });
  handleClient("contas:entrar", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = (payload ?? {}) as { id?: unknown; navegador?: unknown; trocar?: unknown };
    if (!isContaId(p.id)) throw new Error("conta desconhecida");
    return entrarConta(h.host, p.id, p.navegador === true, p.trocar === true, (ev) => { if (!h.win.isDestroyed()) h.win.webContents.send("contas:evento", ev); });
  });
  handleClient("contas:instalar-gh", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return instalarGh(h.host); });
  handleClient("contas:cancelar", (event) => { if (hostFromEvent(event) === null) throw new Error("origem inválida"); cancelarConta(); });
  handleClient("contas:sair", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const id = (payload as { id?: unknown } | null)?.id;
    if (!isContaId(id)) throw new Error("conta desconhecida");
    return sairConta(h.host, id);
  });

  handleClient("backend:account", async (event) => {
    const host = hostFromEvent(event)?.host;
    return host === undefined ? null : fetchAccountStatus(host);
  });
  handleClient("ui:quick-toggle", () => toggleQuickEntry());

  // Conversas com o agente.
  handleClient("chat:send", async (event, payload: unknown) => {
    const ctx = hostFromEvent(event);
    const p = payload as { conversationId?: unknown; text?: unknown };
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    const conv = typeof p?.conversationId === "string" ? getConversation(p.conversationId) : undefined;
    if (ctx === null || text === "" || conv === undefined || conv.host !== ctx.host) return;
    if (conv.busy) {
      ctx.win.webContents.send("chat:error", { conversationId: conv.id, kind: "unknown", message: "Espere a resposta atual terminar." });
      return;
    }
    conv.busy = true;
    try {
      await runBackendTurn(conv, text);
    } finally {
      conv.busy = false;
    }
    if (!conv.closed) void rememberClaudeSession(conv);
  });
  // "Copiar ID": a sessão do Claude Code (o .jsonl na máquina); guardada, ou lida agora do backend.
  handleClient("chat:reference", async (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned === null) throw new Error("origem inválida");
    return { claude: owned.conv.claude ?? await rememberClaudeSession(owned.conv) };
  });
  handleClient("chat:cancel", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    owned?.conv.abort?.abort();
  });
  handleClient("chat:new", (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null) return { conversationId: "" };
    return { conversationId: createConversation(ctx.host).id };
  });
  handleClient("chat:list", (event) => {
    const ctx = hostFromEvent(event);
    return ctx === null ? [] : listConversationsForHost(ctx.host);
  });
  // Conversas que o admin excluiu na máquina (conversas-apagadas.json): saem daqui também. Devolve os ids que saíram.
  handleClient("chat:apagadas", async (event) => {
    const ctx = hostFromEvent(event);
    if (ctx === null || ctx.host === LOCAL_HOST) return [];
    const r = await runSsh(ctx.host, `cat "${APAGADAS_FILE}" 2>/dev/null\n`, 20_000);
    if (r.code !== 0) return [];
    const ids = conversasApagadas(listConversationsForHost(ctx.host), parseApagadas(r.stdout));
    for (const id of ids) { dropConversation(id); log(`[${ctx.host}] conversa ${id} excluída pelo admin: saiu daqui também`); }
    return ids;
  });
  handleClient("chat:rename", (event, payload: unknown) => {
    const p = payload as { conversationId?: unknown; title?: unknown };
    const owned = ownedConversation(event, payload);
    if (owned !== null && typeof p?.title === "string") renameConversation(owned.conv.id, p.title);
  });
  handleClient("chat:set-model", (event, payload: unknown) => {
    const p = payload as { conversationId?: unknown; model?: unknown };
    const owned = ownedConversation(event, payload);
    if (owned !== null && isBackendModel(p?.model)) setConversationModel(owned.conv.id, p.model);
  });
  handleClient("chat:reorder", (event, payload: unknown) => {
    const ctx = hostFromEvent(event);
    const ids = (payload as { conversationIds?: unknown })?.conversationIds;
    if (ctx === null || !Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return;
    reorderConversations(ids, ctx.host);
  });
  // Fechar a aba mantém a conversa na lista lateral; excluir é explícito.
  handleClient("chat:close", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned !== null) closeTab(owned.conv.id);
  });
  handleClient("chat:delete", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned === null) return;
    dropConversation(owned.conv.id);
    // A transcrição do Claude Code na máquina vai junto (o admin também deixa de vê-la). Backend antigo: ignora.
    void deleteBackendSession(owned.host, owned.conv.id).then((n) => { if (n !== null && n > 0) log(`[${owned.host}] conversa ${owned.conv.id}: ${n} transcrição(ões) apagada(s) na máquina`); });
  });
  handleClient("chat:open", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    return owned === null ? null : (openConversation(owned.conv.id) ?? null);
  });
  handleClient("chat:archive", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const archived = (payload as { archived?: unknown })?.archived === true;
    if (owned !== null) archiveConversation(owned.conv.id, archived);
  });
  handleClient("chat:duplicate", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    return owned === null ? null : (duplicateConversation(owned.conv.id) ?? null);
  });
  handleClient("chat:branch", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const index = (payload as { index?: unknown })?.index;
    return owned === null || typeof index !== "number" ? null : (branchConversation(owned.conv.id, index) ?? null);
  });
  handleClient("chat:export", async (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const format = (payload as { format?: unknown })?.format;
    if (owned === null || (format !== "md" && format !== "json")) return null;
    const stored = getStoredConversation(owned.conv.id);
    if (stored === undefined) return null;
    const ext: ExportFormat = format;
    const result = await dialog.showSaveDialog(owned.win, {
      title: "Exportar conversa",
      defaultPath: path.join(app.getPath("documents"), `${slugify(conversationTitle(stored))}.${ext}`),
      filters: ext === "md" ? [{ name: "Markdown", extensions: ["md"] }] : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath === "") return null;
    const body = ext === "md" ? conversationToMarkdown(stored) : `${JSON.stringify(stored, null, 2)}\n`;
    fs.writeFileSync(result.filePath, body, { mode: 0o600 });
    return { path: result.filePath };
  });
  handleClient("ui:tab-menu", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    if (owned === null) return null;
    const state = (payload as { state?: { busy?: unknown; archived?: unknown } })?.state ?? {};
    const busy = state.busy === true;
    const archived = state.archived === true;
    return new Promise<TabMenuAction | null>((resolve) => {
      let settled = false;
      const pick = (action: TabMenuAction | null): void => { if (!settled) { settled = true; resolve(action); } };
      const item = (label: string, action: TabMenuAction, enabled = true): Electron.MenuItemConstructorOptions =>
        ({ label, enabled, click: () => pick(action) });
      const menu = Menu.buildFromTemplate([
        item("Renomear", "rename"),
        item("Duplicar", "duplicate", !busy),
        { label: "Exportar", submenu: [item("Markdown (.md)", "export-md"), item("JSON (.json)", "export-json")] },
        item("Copiar ID  ⓘ", "copy-ref"),
        archived ? item("Desarquivar", "unarchive") : item("Arquivar", "archive", !busy),
        { type: "separator" },
        item("Fechar aba", "close"),
        item("Excluir conversa…", "delete", !busy),
      ]);
      // O callback de fechamento corre antes do click; o adiamento deixa o click vencer.
      menu.popup({ window: owned.win, callback: () => setTimeout(() => pick(null), 0) });
    });
  });

  const liveNotifications = new Set<Notification>();
  // Notificação de teste (como no Rambox): a pessoa confirma que o macOS deixa as do meu-bot passarem; na primeira, o
  // sistema pede a permissão junto. Clicar traz a janela.
  handleClient("ui:notify-test", (event) => {
    const h = hostFromEvent(event);
    if (h === null || !Notification.isSupported()) throw new Error("este sistema não mostra notificações");
    const n = new Notification({ title: "meu-bot", body: "As notificações estão funcionando. Até logo!", silent: false });
    n.on("click", () => { h.win.show(); h.win.focus(); });
    n.show();
  });
  // Licença e devices desta conta (licenca.json + maquinas.json): pelo backend, ou por SSH onde ele não tem a rota (Hermes).
  handleClient("license:get", async (event) => {
    const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida");
    const lic = await lerLicencaDaMaquina(h.host);
    void browserSincronizarCrm(h.host, lic); // a extensão do CRM acompanha a licença relida (admin liberou o Pro com o app aberto)
    return lic.view;
  });
  // Avisos de segurança desta máquina (alertas.json, via backend): um Mac novo usou o meu-bot dela.
  handleClient("alerts:get", (event) => { const h = hostFromEvent(event); if (h === null) throw new Error("origem inválida"); return fetchAlertPrefs(h.host); });
  handleClient("alerts:set", (event, payload: unknown) => {
    const h = hostFromEvent(event);
    if (h === null) throw new Error("origem inválida");
    const p = payload as { whatsapp?: unknown; email?: unknown } | null;
    const email = typeof p?.email === "string" ? p.email.trim().slice(0, 120) : "";
    if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("e-mail inválido");
    return saveAlertPrefs(h.host, { whatsapp: p?.whatsapp !== false, email });
  });
  handleClient("ui:notify", (event, payload: unknown) => {
    const owned = ownedConversation(event, payload);
    const p = payload as { title?: unknown; body?: unknown };
    if (owned === null || !Notification.isSupported()) return;
    const { host, conv } = owned;
    const n = new Notification({
      title: typeof p.title === "string" ? p.title.slice(0, 80) : "meu-bot",
      body: typeof p.body === "string" ? p.body.slice(0, 200) : "",
      silent: false,
    });
    liveNotifications.add(n);
    const done = (): void => { liveNotifications.delete(n); };
    n.on("click", () => {
      done();
      // A janela dona pode ter sido fechada: reabre a da máquina e foca a conversa quando ela carregar.
      const win = openMainWindow(host, "notify");
      app.focus({ steal: true });
      sendWhenLoaded(win, "ui:focus-conversation", { conversationId: conv.id });
    });
    n.on("close", done);
    n.show();
  });
}
