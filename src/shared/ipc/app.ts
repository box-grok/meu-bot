/** Contrato IPC · Janela, configurações, variante do produto e capacidades. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */
import type { PlanName } from "./licenca";
import type { NavNotifyPref, NavWorkspaces } from "./navegador";

export type BackendModel = "claudecode" | "agente" | "rene-dm" | "rene" | "grok-4";
export type Theme = "system" | "light" | "dark";
/** Quem usa uma aba do Navegador ou um terminal: conversa do meu-bot, conversa do WhatsApp ou o Claude Code deste Mac. */
export type OrigemDono = "meu-bot" | "whatsapp" | "claude-code";
export interface DonoInfo { id: string; rotulo: string; origem: OrigemDono }

export type QuickEntryStatus = "registered" | "taken" | "invalid" | "disabled";

/** Zoom da janela (interface inteira): um passo para cima/baixo, um nível exato ou voltar a 100%. */
export type ZoomAction = { action: "step"; delta: 1 | -1 } | { action: "set"; level: number } | { action: "reset" };
/** Nível aplicado (-8..8), fator (1.2^nível) e percentual arredondado, como o Chromium mostra. */
export interface ZoomState { level: number; factor: number; percent: number }

export interface SettingsView {
  /** Última máquina aberta (pré-seleção do seletor); null antes da primeira escolha. */
  lastHost: string | null;
  /** Modelo padrão global para conversas novas; cada conversa pode trocar o seu. */
  backendModel: BackendModel;
  /** Modelo padrão já resolvido para a máquina da janela que pediu (por máquina vence o global). */
  backendModelForHost: BackendModel;
  /** Porta padrão do backend (máquinas sem porta própria). */
  backendPort: number;
  /** Porta já resolvida para a máquina da janela que pediu (por máquina vence a padrão). */
  backendPortForHost: number;
  /** Notificações das páginas do Navegador viram conversas com a instrução da pessoa. */
  navNotify: NavNotifyPref;
  /** Espaços de trabalho do Navegador da máquina da janela (para o tutorial saber antes de o Navegador abrir). */
  navEspacos: NavWorkspaces;
  fontSize: number;
  /** Zoom da interface inteira (nível -8..8, 0 = 100%). Muda só por `zoomWindow`, nunca por setSettings. */
  zoomLevel: number;
  theme: Theme;
  /** Avisar com notificação do sistema quando uma resposta terminar em segundo plano. */
  notifications: boolean;
  /** Acima disso (tokens estimados), o meio da conversa vai resumido. */
  contextBudgetTokens: number;
  /** A cada N turnos do usuário, extrair memória em background (0 desliga). */
  memoryEveryTurns: number;
  quickEntryEnabled: boolean;
  quickEntryShortcut: string;
  quickEntryStatus: QuickEntryStatus;
  /** Onboarding guiado: "pending" até concluir ("done") ou pular ("skipped"). */
  onboarding: "pending" | "done" | "skipped";
  /** true = a janela abre direto; false = abertura animada toda vez (caixinha do seletor). */
  openDirect: boolean;
  /** Abrir o app ao entrar no Mac (item de início do sistema; o sistema é a fonte da verdade). */
  openAtLogin: boolean;
  /** Só o app empacotado consegue se registrar como item de início. */
  openAtLoginAvailable: boolean;
  /** Apelido de cada máquina ("Renomear" no seletor). */
  hostNames: Record<string, string>;
  /** Reiniciar sozinho na versão nova quando o Mac está ocioso (10 min sem mexer ou tela bloqueada) e nada em andamento. */
  atualizarOcioso: boolean;
  /** Aba fixada (📌) que fica na frente ao abrir a janela. */
  abaFixa: AbaFixa;
}
/**
 * Aba que fica na frente ao abrir: "padrao" = a do produto (Finanças no finance-staging, Tutoriais nos outros, para
 * quem chega leigo); "conversa" = sem alfinete, a última conversa; o resto é o id de uma página.
 */
export type AbaFixa = "padrao" | "conversa" | "tutoriais" | "acervo" | "conta-google" | "financas" | "navegador" | "modulos" | "usuarios";

export interface SettingsUpdate {
  backendModel?: BackendModel;
  /** Modelo padrão só para a máquina da janela que salvou. */
  backendModelForHost?: BackendModel;
  backendPort?: number;
  /** Porta só para a máquina da janela que salvou (igual à padrão tira a exceção). */
  backendPortForHost?: number;
  navNotify?: Partial<NavNotifyPref>;
  fontSize?: number;
  theme?: Theme;
  notifications?: boolean;
  contextBudgetTokens?: number;
  memoryEveryTurns?: number;
  quickEntryEnabled?: boolean;
  quickEntryShortcut?: string;
  /** URL do atalho do Navegador (clique no ícone de extensão sem popup); "" desliga. */
  /** O renderer marca concluído/pulado; "pending" é a ação "Rever onboarding" da paleta. */
  onboarding?: "pending" | "done" | "skipped";
  openAtLogin?: boolean;
  atualizarOcioso?: boolean;
  abaFixa?: AbaFixa;
}
/** Avisos de segurança gravados na máquina (o backend envia): um Mac novo usou o meu-bot desta máquina. */
export interface AlertPrefs { whatsapp: boolean; email: string }

/**
 * Qual produto é este app: meu-bot (de cada pessoa, com o CRM próprio liberado pela licença), meu-bot-admin (suporte)
 * e os staging. Tabela em src/main/variant-core.ts.
 */
export type AppVariant = "client" | "admin" | "client-staging" | "finance-staging" | "admin-mac" | "diego" | "diego-staging";
/** Canal do app: estável (só o aprovado) ou staging (o que está em teste), como VS Code e VS Code Insiders. */
export type Canal = "estavel" | "staging";
/**
 * O que esta variante do app pode fazer. O main decide (variant-core.ts) e manda para a janela em WindowInfo;
 * o renderer esconde/mostra por capacidade, nunca por "é admin?". O admin tem tudo false menos supportAdmin.
 */
export interface Capabilities {
  variant: AppVariant;
  /** Conversar com o agente: compositor, abas de chat, entrada rápida. */
  chat: boolean;
  /** Parear/desconectar o WhatsApp, política de DM, áudio. */
  pair: boolean;
  /** Logins Claude e xAI, chave de API. */
  login: boolean;
  /** Mexer no espelho do WhatsApp: pausar, limpar, ramificar; menu "…" completo. */
  manageWa: boolean;
  /** Túnel para o backend da máquina (chat, conta). */
  tunnel: boolean;
  /** Instalar coisas na máquina pelo seletor e pelos tutoriais (status line, transcrição). */
  install: boolean;
  /** Configurações › Suporte, lado da pessoa. */
  supportClient: boolean;
  /** Página "Suporte" do admin e as ações de suporte. */
  supportAdmin: boolean;
  /** Aba Navegador (e o agente navegando por você). */
  navegador: boolean;
  /** meu-bot-admin-mac: o app é só a janela das contas deste Mac (sem seletor de máquinas). */
  usuariosMac: boolean;
  /**
   * Pasta do repositório de módulos que veio com este app (submódulo produtos/<nome>, em Resources/ empacotado):
   * página "Módulos" e src/main/modulos/. null = app sem módulos (o meu-bot de todo mundo).
   */
  modulos: string | null;
  /**
   * Plano que a licença da máquina precisa ter para o app funcionar. "free" = app grátis com módulos Pro à parte
   * (etiqueta Pro, "pedir ao admin"); acima disso o app inteiro dependeria do add-on `produto` (hoje nenhum app usa).
   */
  planoExigido: PlanName;
  /**
   * Nome do produto ("meu-bot", "meu-bot-admin"): é o que a licença libera. No staging
   * continua o do estável (meu-bot-staging → "meu-bot"); o nome do app é outro (appTitle). O renderer nunca o deduz.
   */
  produto: string;
  /** Canal deste app (estável ou staging). */
  canal: Canal;
  /** Nome do app ("meu-bot-staging"): texto da atualização, nome do .app. */
  nome: string;
  /** Título da janela: o nome, e no staging a versão junto ("meu-bot-staging 0.2.0-staging.3"). */
  titulo: string;
  /** Add-on que é a razão deste app (a entrada dele fica sempre à vista); null = nenhum. Tabela em variant-core.ts. */
  addon: string | null;
  /** Página que fica na frente quando a janela abre ("financas"); null = as abas de conversa. */
  abreEm: string | null;
  /** Catálogo de add-ons (nome e rótulo para ler), para as telas não escreverem nomes à mão. */
  addons: { nome: string; rotulo: string }[];
}

/** O que a janela principal recebe ao nascer: a máquina a que está presa. */
export interface WindowInfo {
  host: string;
  /** O que esta variante pode fazer (ver Capabilities); o admin é `caps.supportAdmin`. */
  caps: Capabilities;
  /** No admin: nome da pessoa dona da máquina. */
  person: string | null;
  /** No admin: apelido que a pessoa usa para a máquina ("colima"); null se o código não trouxe. */
  machine: string | null;
  /** Versão deste app (package.json). */
  version: string;
  /** Identidade do build (versão + quando o renderer foi gerado): muda a cada rebuild; o cache do renderer é por build. */
  build: string;
  /** Modelos conhecidos dessa máquina (da última sondagem); vazio se desconhecido. */
  models: string[];
}

/** Eventos da janela de alívio (aliviar <host>). */
export type ReliefEvent =
  | { kind: "init"; host: string }
  | { kind: "step"; step: "connect" | "clean" | "tailscale" | "open"; state: "doing" | "done" | "fail"; text: string }
  | { kind: "stats"; which: "before" | "after"; load: string; memMb: number | null }
  | { kind: "countdown"; seconds: number }
  /** Alívio falhou: contagem até abrir o app do Grok Bot no card Reset (Fechar cancela). */
  | { kind: "reset-countdown"; seconds: number }
  | { kind: "reset-opened"; ok: boolean }
  | { kind: "log"; text: string }
  | { kind: "done"; ok: boolean; text: string };

/**
 * Internet deste Mac (faixa OFFLINE): `online` null = ainda não sondado; `since` = desde quando está fora
 * (ms); `checkedAt` = última sondagem (ms).
 */
export interface NetState { online: boolean | null; checking: boolean; since: number | null; checkedAt: number | null }
