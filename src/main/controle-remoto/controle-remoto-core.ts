/**
 * Controle remoto (MCP), parte pura: o catálogo de ferramentas que o app oferece a um cliente MCP deste Mac
 * (Claude Code, Cursor…), o roteador que diz para onde cada ferramenta vai (socket do terminal, socket do
 * Navegador ou o próprio main), a conferência de um pedido HTTP (só POST /mcp, loopback, Bearer) e o JSON-RPC do
 * MCP (initialize, ping, tools/list, tools/call). Molde do Remote Control do Rambox: servidor sem sessão, resposta
 * JSON pura, token de 32 bytes. Sem Electron: testável com node --test.
 */
import { randomBytes } from "node:crypto";
import { autorizado, hostOk } from "../extensao-gmail/extensao-api-core";

export const CAMINHO = "/mcp";
/** Corpo máximo de um pedido (o Rambox aceita 8 MB; aqui as chamadas são pequenas). */
export const MAX_CORPO = 1024 * 1024;
export const PORTA_MIN = 1024;
export const PORTA_MAX = 65535;
export const isPortaMcp = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= PORTA_MIN && v <= PORTA_MAX;
/** Token = 32 bytes em hex, como o do Rambox (e o do backend local). */
export const gerarToken = (): string => randomBytes(32).toString("hex");
export const isToken = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** Anotações do MCP: o cliente mostra o que só lê, o que age e o que destrói. */
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const ACTION = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const OPEN = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

export interface Ferramenta {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  annotations: typeof READ | typeof ACTION | typeof WRITE | typeof DESTRUCTIVE | typeof OPEN;
}
const S = (props: Record<string, unknown>, required: string[] = []): Ferramenta["inputSchema"] => ({ type: "object", properties: props, ...(required.length > 0 ? { required } : {}) });
const MAQ = { maquina: { type: "string", description: "máquina da janela (ex.: agente-box-lv); opcional se só uma janela está aberta" } };
const ABA = { aba: { type: "number", description: "id da aba do Navegador (veja nav_abas); sem ele, a aba deste cliente" } };
export const PAGINAS = ["tutoriais", "acervo", "financas", "conta-google", "gmail", "computador", "navegador"] as const;
export type Pagina = (typeof PAGINAS)[number];
export const TEMAS = ["system", "light", "dark"] as const;

export const FERRAMENTAS: readonly Ferramenta[] = [
  { name: "app", description: "Este app: nome, versão, tema e as janelas de máquina abertas (qual está em foco).", inputSchema: S({}), annotations: READ },
  { name: "janela_abrir", description: "Abre (ou traz à frente) a janela de uma máquina do ~/.ssh/config, ou \"local\" para este Mac.", inputSchema: S({ maquina: { type: "string" } }, ["maquina"]), annotations: ACTION },
  { name: "pagina_abrir", description: `Põe uma página na frente da janela: ${PAGINAS.join(", ")}.`, inputSchema: S({ ...MAQ, pagina: { type: "string", enum: [...PAGINAS] } }, ["pagina"]), annotations: ACTION },
  { name: "tema", description: "Troca o tema do app (system, light, dark); vale para todas as janelas.", inputSchema: S({ tema: { type: "string", enum: [...TEMAS] } }, ["tema"]), annotations: WRITE },
  { name: "print_janela", description: "Captura a janela inteira do app (a da máquina pedida, ou a em foco) como imagem.", inputSchema: S(MAQ), annotations: READ },
  { name: "terminais", description: "Terminais abertos no app (id, máquina, número).", inputSchema: S({}), annotations: READ },
  { name: "terminal_abrir", description: "Abre uma aba de terminal nova na janela da máquina e devolve o id e o prompt.", inputSchema: S(MAQ), annotations: ACTION },
  { name: "terminal_ler", description: "Últimas linhas da tela de um terminal (sem cores).", inputSchema: S({ id: { type: "string" }, linhas: { type: "number" } }, ["id"]), annotations: READ },
  { name: "terminal_digitar", description: "Digita no terminal (a pessoa vê na hora). texto com enter=true roda o comando; ou tecla: enter, tab, esc, ctrl+c, ctrl+d, cima, baixo…", inputSchema: S({ id: { type: "string" }, texto: { type: "string" }, enter: { type: "boolean" }, tecla: { type: "string" } }, ["id"]), annotations: ACTION },
  { name: "tela_dividir", description: "Mais uma coluna na tela do app: um terminal (id) ou uma página (navegador, tutoriais, acervo, vazia).", inputSchema: S({ ...MAQ, id: { type: "string" }, pagina: { type: "string", enum: ["navegador", "tutoriais", "acervo", "vazia"] } }), annotations: ACTION },
  { name: "tela_juntar", description: "Tira uma coluna (id do terminal ou pagina) ou todas (sem argumentos).", inputSchema: S({ ...MAQ, id: { type: "string" }, pagina: { type: "string", enum: ["navegador", "tutoriais", "acervo"] } }), annotations: ACTION },
  { name: "nav_abas", description: "Abas do Navegador do app (id, url, título, quem usa).", inputSchema: S(MAQ), annotations: READ },
  { name: "nav_abrir", description: "Abre uma url numa aba deste cliente (nova=true força aba nova; aba=N navega naquela).", inputSchema: S({ ...MAQ, url: { type: "string" }, nova: { type: "boolean" }, aba: { type: "number" } }, ["url"]), annotations: OPEN },
  { name: "nav_ler", description: "Texto da página e os elementos clicáveis numerados.", inputSchema: S({ ...MAQ, ...ABA }), annotations: READ },
  { name: "nav_clicar", description: "Clica no elemento n (de nav_ler), ou por texto ou seletor CSS.", inputSchema: S({ ...MAQ, ...ABA, n: { type: "number" }, texto: { type: "string" }, seletor: { type: "string" } }), annotations: ACTION },
  { name: "nav_digitar", description: "Digita texto no campo n (ou seletor); enter=true confirma.", inputSchema: S({ ...MAQ, ...ABA, n: { type: "number" }, seletor: { type: "string" }, texto: { type: "string" }, enter: { type: "boolean" } }, ["texto"]), annotations: ACTION },
  { name: "nav_tecla", description: "Aperta uma tecla na página (enter, tab, esc, down, up…).", inputSchema: S({ ...MAQ, ...ABA, tecla: { type: "string" } }, ["tecla"]), annotations: ACTION },
  { name: "nav_print", description: "Captura a aba como imagem.", inputSchema: S({ ...MAQ, ...ABA }), annotations: READ },
  { name: "nav_recarregar", description: "Recarrega a aba.", inputSchema: S({ ...MAQ, ...ABA }), annotations: ACTION },
  { name: "nav_voltar", description: "Volta uma página.", inputSchema: S({ ...MAQ, ...ABA }), annotations: ACTION },
  { name: "nav_js", description: "Roda JavaScript na página e devolve o resultado (até 8000 caracteres).", inputSchema: S({ ...MAQ, ...ABA, codigo: { type: "string" } }, ["codigo"]), annotations: ACTION },
  { name: "nav_fechar", description: "Fecha uma aba deste cliente.", inputSchema: S({ ...MAQ, ...ABA }), annotations: DESTRUCTIVE },
  { name: "nota", description: "Escreve uma linha na faixa de depuração do app (\"vou pedir ao agente para…\"): a pessoa acompanha de fora o que você vai fazer. Só aparece com o modo de depuração ligado.", inputSchema: S({ texto: { type: "string" } }, ["texto"]), annotations: WRITE },
  { name: "depuracao", description: "Liga (on=true), desliga (on=false) ou volta ao padrão da variante (on=null) o modo de depuração do app; sem on, só consulta.", inputSchema: S({ on: { type: ["boolean", "null"] } }), annotations: WRITE },
];
export const ferramenta = (nome: string): Ferramenta | undefined => FERRAMENTAS.find((f) => f.name === nome);

/** Para onde cada ferramenta vai: socket do terminal (term-api.ts), socket do Navegador (nav-api.ts) ou o main. */
export type Destino =
  | { alvo: "terminal"; rota: string; corpo?: Record<string, unknown> }
  | { alvo: "navegador"; rota: string; corpo?: Record<string, unknown>; maquina?: string }
  | { alvo: "app"; acao: "app" | "janela_abrir" | "pagina_abrir" | "tema" | "print_janela"; args: Record<string, unknown> };
const NAV_ROTAS: Record<string, string> = { nav_abas: "abas", nav_abrir: "abrir", nav_ler: "ler", nav_clicar: "clicar", nav_digitar: "digitar", nav_tecla: "tecla", nav_print: "print", nav_recarregar: "recarregar", nav_voltar: "voltar", nav_js: "js", nav_fechar: "fechar" };
export function roteador(nome: string, args: Record<string, unknown>): Destino {
  const { maquina, ...resto } = args;
  const maq = typeof maquina === "string" && maquina !== "" ? maquina : undefined;
  switch (nome) {
    case "app": case "janela_abrir": case "pagina_abrir": case "tema": case "print_janela": return { alvo: "app", acao: nome, args };
    case "terminais": return { alvo: "terminal", rota: "terminais" };
    case "terminal_abrir": return { alvo: "terminal", rota: "abrir", corpo: maq === undefined ? {} : { maquina: maq } };
    case "terminal_ler": return { alvo: "terminal", rota: "ler", corpo: resto };
    case "terminal_digitar": return { alvo: "terminal", rota: "digitar", corpo: resto };
    case "tela_dividir": return { alvo: "terminal", rota: "dividir", corpo: { ...resto, ...(maq === undefined ? {} : { maquina: maq }) } };
    case "tela_juntar": return { alvo: "terminal", rota: "juntar", corpo: { ...resto, ...(maq === undefined ? {} : { maquina: maq }) } };
    case "nota": return { alvo: "terminal", rota: "nota", corpo: { texto: resto["texto"] } };
    case "depuracao": return { alvo: "terminal", rota: "depuracao", corpo: "on" in resto ? { on: resto["on"] } : {} };
    default: {
      const rota = NAV_ROTAS[nome];
      if (rota === undefined) throw new Error(`ferramenta desconhecida: ${nome}`);
      return { alvo: "navegador", rota, ...(rota === "abas" ? {} : { corpo: resto }), ...(maq === undefined ? {} : { maquina: maq }) };
    }
  }
}

/** Quem está pedindo, como o app mostra ("✳️ Cursor (MCP) · digitou"): o cliente diz o nome em `X-Meu-Bot-Cliente`. */
export function donoDe(cliente: string | string[] | undefined): { id: string; rotulo: string; origem: "claude-code" } {
  const c = (Array.isArray(cliente) ? cliente[0] ?? "" : cliente ?? "").replace(/[^\w .-]/g, "").trim().slice(0, 30);
  return c === "" ? { id: "mcp:cliente", rotulo: "Cliente MCP (Mac)", origem: "claude-code" } : { id: `mcp:${c.toLowerCase().replace(/\s+/g, "-")}`, rotulo: `${c} (MCP)`, origem: "claude-code" };
}

export interface PedidoHttp { method?: string | undefined; url?: string | undefined; headers: Record<string, string | string[] | undefined> }
/** O pedido pode entrar? Só `POST /mcp`, de um cliente deste Mac (Host e Origin no loopback), com o token. */
export function pedidoOk(req: PedidoHttp, porta: number, token: string): { ok: true } | { ok: false; status: number; erro: string } {
  const caminho = (req.url ?? "/").split("?")[0];
  if (caminho !== CAMINHO) return { ok: false, status: 404, erro: `não existe; o MCP fica em ${CAMINHO}` };
  if (req.method !== "POST") return { ok: false, status: 405, erro: "só POST (servidor sem sessão; GET/SSE não existe)" };
  if (!hostOk(req.headers["host"], porta)) return { ok: false, status: 421, erro: "host inválido" };
  const origin = req.headers["origin"]; const o = Array.isArray(origin) ? origin[0] ?? "" : origin ?? "";
  if (o !== "" && o !== "null" && o !== `http://127.0.0.1:${porta}` && o !== `http://localhost:${porta}`) return { ok: false, status: 403, erro: "origem não permitida" };
  if (token === "" || !autorizado(req.headers["authorization"], token)) return { ok: false, status: 401, erro: "token inválido; copie o token em Configurações › Controle remoto (MCP)" };
  const ct = req.headers["content-type"]; const tipo = (Array.isArray(ct) ? ct[0] ?? "" : ct ?? "").toLowerCase();
  if (!tipo.startsWith("application/json")) return { ok: false, status: 415, erro: "Content-Type precisa ser application/json" };
  return { ok: true };
}

/* ---------- JSON-RPC do MCP ---------- */
export const VERSAO_PROTOCOLO = "2025-03-26";
export type Chamar = (nome: string, args: Record<string, unknown>) => Promise<unknown>;
export interface ServidorInfo { nome: string; versao: string }
interface Msg { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
const resposta = (id: unknown, result: unknown): Record<string, unknown> => ({ jsonrpc: "2.0", id, result });
export const erroRpc = (id: unknown, code: number, message: string): Record<string, unknown> => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Uma mensagem: devolve a resposta, ou null quando é notificação (sem id). Um lote (array) devolve um array. */
export async function responderJsonRpc(msg: unknown, chamar: Chamar, info: ServidorInfo): Promise<unknown | null> {
  if (Array.isArray(msg)) {
    if (msg.length === 0) return erroRpc(null, -32600, "lote vazio");
    const r = (await Promise.all(msg.map((m) => responderUma(m, chamar, info)))).filter((x) => x !== null);
    return r.length === 0 ? null : r;
  }
  return responderUma(msg, chamar, info);
}
async function responderUma(raw: unknown, chamar: Chamar, info: ServidorInfo): Promise<unknown | null> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return erroRpc(null, -32600, "pedido inválido");
  const m = raw as Msg;
  const id = m.id === undefined ? undefined : m.id;
  const method = typeof m.method === "string" ? m.method : null;
  if (method === null) return id === undefined ? null : erroRpc(id, -32600, "falta method");
  if (method.startsWith("notifications/")) return null;
  if (id === undefined) return null; // notificação de método qualquer: sem resposta
  const params = (m.params !== null && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;
  switch (method) {
    case "initialize": {
      const pv = typeof params["protocolVersion"] === "string" ? params["protocolVersion"] : VERSAO_PROTOCOLO;
      return resposta(id, { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: { name: info.nome, version: info.versao }, instructions: `Controle remoto do ${info.nome} neste Mac: o que você faz aparece na hora na tela da pessoa, com o seu nome. Antes de agir, anuncie com 'nota'.` });
    }
    case "ping": return resposta(id, {});
    case "tools/list": return resposta(id, { tools: FERRAMENTAS });
    case "tools/call": {
      const nome = typeof params["name"] === "string" ? params["name"] : "";
      const args = (params["arguments"] !== null && typeof params["arguments"] === "object" ? params["arguments"] : {}) as Record<string, unknown>;
      if (ferramenta(nome) === undefined) return erroRpc(id, -32602, `ferramenta desconhecida: ${nome}`);
      try {
        const r = await chamar(nome, args);
        const png = r !== null && typeof r === "object" && typeof (r as { png_base64?: unknown }).png_base64 === "string" ? (r as { png_base64: string }).png_base64 : null;
        if (png !== null) return resposta(id, { content: [{ type: "image", data: png, mimeType: "image/png" }], isError: false });
        const dados = r === undefined ? { ok: true } : r;
        return resposta(id, { content: [{ type: "text", text: JSON.stringify(dados) }], structuredContent: dados !== null && typeof dados === "object" && !Array.isArray(dados) ? dados : { resultado: dados }, isError: false });
      } catch (e) {
        const texto = e instanceof Error ? e.message : String(e);
        return resposta(id, { content: [{ type: "text", text: `Erro: ${texto}` }], isError: true });
      }
    }
    default: return erroRpc(id, -32601, `método não suportado: ${method}`);
  }
}

/* ---------- Configuração pronta para os clientes ---------- */
export const urlMcp = (porta: number): string => `http://127.0.0.1:${porta}${CAMINHO}`;
/** O comando do Claude Code (transporte HTTP, cabeçalho fixo); o nome do servidor é o do app (meu-bot, meu-bot-staging…). */
export const configClaudeCode = (nome: string, porta: number, token: string): string => `claude mcp add --transport http ${nome} ${urlMcp(porta)} --header "Authorization: Bearer ${token}"`;
/** O trecho do mcp.json do Cursor (ou de qualquer cliente que aceite url + headers). */
export const configCursor = (nome: string, porta: number, token: string): string => JSON.stringify({ mcpServers: { [nome]: { url: urlMcp(porta), headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
