/**
 * Ponto de entrada no Gmail (content script): carrega o InboxSDK e registra as peças do CRM. Tudo que toca o SDK
 * fica em ui/; o que é puro (estado, api, rotas, tema) fica fora. O token nunca passa por aqui: os pedidos saem
 * pelo service worker (api.ts).
 */
import * as InboxSDK from "@inboxsdk/core";
import { criarApi, transporteAuto, transporteDireto, transporteRelay, type MensagemCrm } from "./api.ts";
import { parseConfig, type Config } from "./config.ts";
import { criarEstado, type Estado } from "./estado.ts";
import type { CustomRouteView } from "@inboxsdk/core";
import { injetarEstilos } from "./estilos.ts";
import { ROTA_CAIXA, ROTA_CONTATO, ROTA_CONTATOS, ROTA_INICIO, ROTA_MALAS, ROTA_ORG, ROTA_ORGS, ROTA_PIPELINE, ROTAS_ANTIGAS, parseHash } from "./rotas.ts";
import { temaAtual } from "./tema.ts";
import { monitorarConexao } from "./ui/avisos.ts";
import { registrarBarra } from "./ui/barra.ts";
import { definirMeuEmail, montarCaixa } from "./ui/caixa.ts";
import { registrarMenu } from "./ui/menu.ts";
import { registrarPainelThread } from "./ui/painel-thread.ts";
import { registrarPainelGlobal } from "./ui/painel-global.ts";
import { registrarBotaoTopo, registrarRotaInicio } from "./ui/home.ts";
import { montarContato, montarContatos, montarOrg, montarOrgs } from "./ui/pessoas.ts";
import { montarMalas } from "./ui/malas.ts";
import { CHAVE_CAIXAS, CHAVE_PIPELINES, registrar } from "./recentes.ts";
import { montarPipeline } from "./ui/pipeline.ts";
import { registrarRotulos } from "./ui/rotulos.ts";

// App ID do InboxSDK (register.inboxsdk.com, conta box@agentesgrok.com): um só para todos os clientes.
const APP_ID = "sdk_meubotCRM_2cfc25813a";

/** Config para o caminho direto (fallback): pedida ao worker, nunca lida da página. */
const configDoWorker = (): Promise<Config> => new Promise((resolve, reject) => {
  try { chrome.runtime.sendMessage({ tipo: "crm:config" } satisfies MensagemCrm, (r: unknown) => { if (chrome.runtime.lastError || r === undefined) reject(new Error("sem config")); else { try { resolve(parseConfig(r)); } catch (e) { reject(e); } } }); }
  catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
});

void InboxSDK.load(2, APP_ID, { appName: "meu-bot CRM", appIconUrl: chrome.runtime.getURL("icones/crm-32.png") }).then((sdk) => {
  injetarEstilos();
  try { definirMeuEmail(sdk.User.getEmailAddress()); } catch { /* sem e-mail: só não filtra você das sugestões */ }
  const api = criarApi(transporteAuto(transporteRelay(), transporteDireto(configDoWorker)));
  const estado = criarEstado({ api, eu: () => { try { const email = sdk.User.getEmailAddress(); return email ? { email, nome: "" } : null; } catch { return null; } } });
  const raizes = new Set<HTMLElement>();
  const tema = (): string => { let escuro: boolean | null = null; try { escuro = sdk.Global.gmailTheme.isDarkMode.body; } catch { escuro = null; } return temaAtual(escuro) === "escuro" ? "mbcrm-escuro" : ""; };
  const aplicarTema = (): void => { const t = tema(); for (const r of raizes) { r.classList.toggle("mbcrm-escuro", t !== ""); } };
  const raiz = (el: HTMLElement): void => { raizes.add(el); if (tema() !== "") el.classList.add("mbcrm-escuro"); };
  sdk.Router.handleCustomRoute(ROTA_PIPELINE, (v) => { montarPipeline(sdk, estado, v, raiz); v.on("destroy", () => { for (const r of raizes) if (!r.isConnected) raizes.delete(r); }); });
  sdk.Router.handleCustomRoute(ROTA_CAIXA, (v) => { montarCaixa(sdk, estado, v, raiz); v.on("destroy", () => { for (const r of raizes) if (!r.isConnected) raizes.delete(r); }); });
  const rota = (id: string, montar: (s: InboxSDK.InboxSDK, e: Estado, v: CustomRouteView, raiz: (el: HTMLElement) => void) => void): void => { sdk.Router.handleCustomRoute(id, (v) => { montar(sdk, estado, v, raiz); v.on("destroy", () => { for (const r of raizes) if (!r.isConnected) raizes.delete(r); }); }); };
  rota(ROTA_CONTATOS, montarContatos); rota(ROTA_CONTATO, montarContato); rota(ROTA_ORGS, montarOrgs); rota(ROTA_ORG, montarOrg); rota(ROTA_MALAS, montarMalas);
  // "Recentes" da Home: pipelines e caixas que você abriu, guardados neste navegador.
  sdk.Router.handleAllRoutes((v) => { aplicarTema(); const id = v.getRouteID(); const k = v.getParams()["key"]; if (k) { if (id === ROTA_PIPELINE) registrar(CHAVE_PIPELINES, k); else if (id === ROTA_CAIXA) registrar(CHAVE_CAIXAS, k); } });
  // Endereços antigos (#crm/…) levam aos novos (#meu-bot-crm/…).
  sdk.Router.handleCustomRoute(ROTAS_ANTIGAS.inicio, () => { void sdk.Router.goto(ROTA_INICIO); });
  sdk.Router.handleCustomRoute(ROTAS_ANTIGAS.pipeline, (v) => { void sdk.Router.goto(ROTA_PIPELINE, { key: v.getParams()["key"] ?? "" }); });
  sdk.Router.handleCustomRoute(ROTAS_ANTIGAS.caixa, (v) => { void sdk.Router.goto(ROTA_CAIXA, { key: v.getParams()["key"] ?? "" }); });
  registrarRotaInicio(sdk, estado, tema);
  registrarPainelGlobal(sdk, estado, tema);
  registrarPainelThread(sdk, estado, tema);
  registrarRotulos(sdk, estado);
  registrarBarra(sdk, estado, tema);
  registrarMenu(sdk, estado);
  registrarBotaoTopo(sdk, estado, tema);
  monitorarConexao(sdk, estado);
  estado.iniciarPolling();
  // O app (Navegador do meu-bot) pode pedir uma rota por aqui, em vez de montar o hash na mão.
  (window as unknown as { __meuBotCrm?: unknown }).__meuBotCrm = { ir: (hash: string) => { const r = parseHash(hash); if (r === null) return false; if (r.tipo === "inicio") void sdk.Router.goto(ROTA_INICIO); else void sdk.Router.goto(r.tipo === "pipeline" ? ROTA_PIPELINE : ROTA_CAIXA, { key: r.key }); return true; } };
}).catch((e: unknown) => { console.error("[meu-bot CRM] InboxSDK não carregou:", e instanceof Error ? e.message : e); });
