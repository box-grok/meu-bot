/** Contrato IPC · Suporte e meu-bot-admin: saúde, espelho, auditoria, produtos, backup. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */
import type { ClaudeAuthInfo } from "./agente";
import type { LicenseView, PlanName } from "./licenca";
import type { HostProbe } from "./maquina";
import type { WhatsappStatus } from "./whatsapp";

/** Suporte (meu-bot-admin), lado da pessoa: estado na máquina desta janela. */
export interface SupportInfo {
  /** Este meu-bot veio com o pacote de suporte e a janela é de uma máquina por SSH. */
  available: boolean;
  /** Nome de quem dá o suporte ("Lucas"). */
  admin: string;
  /** A chave do admin está no authorized_keys da máquina. */
  on: boolean;
  /** Nome que a pessoa deu para si. */
  name: string;
  /** Sugestão para o campo vazio (nome do git ou do usuário do Mac): salvar liga com um clique. */
  suggestedName: string;
  /** Últimas linhas do registro de auditoria da máquina (mais nova primeiro); `tipo` = quem: dono, admin, agente, sistema ou legado. */
  log: { at: string; who: string; what: string; tipo: string }[];
  /** Última entrega do aviso na caixa do admin que deu certo (ISO); null = ainda nenhuma. */
  deliveredAt: string | null;
  /** O que a pessoa deixa o app do admin ver. */
  share: SupportShare;
  /** O admin desligou: o app não religa sozinho; "Ligar o suporte" pede de novo. */
  blockedByAdmin: boolean;
  /** O código gravado na máquina tem o id antigo (só a chave do servidor): o app regrava sozinho. */
  staleId: boolean;
}
/**
 * O que a pessoa escolhe compartilhar com o app do admin: progresso nos tutoriais, WhatsApp (estado e
 * conversas) e registros (journal). O app do admin respeita; o acesso SSH em si continua enquanto o suporte
 * está ligado (desligar o interruptor corta tudo). Fica na máquina dela, em ~/.local/share/meu-bot.
 */
/** `backup`: o admin pode fazer backup completo (sessão do WhatsApp e logins inclusive); padrão desligado. */
export interface SupportShare { progress: boolean; whatsapp: boolean; logs: boolean; chat: boolean; backup: boolean }

/** Suporte, lado do admin: uma pessoa (uma máquina) que entregou ou colou o código. */
export interface SupportPerson {
  /** Alias no ~/.ssh do admin (`suporte-<nome>-<4 hex>`): é o "host" da janela. */
  alias: string;
  /** Apelido do admin, se deu; senão o nome que ela escreveu. */
  name: string;
  /** Apelido que a pessoa usa para a máquina no ~/.ssh/config dela ("colima"); null em códigos antigos. */
  machine: string | null;
  hostname: string;
  port: number;
  /** Endereço local (127.0.0.1/localhost): só alcançável do próprio Mac onde a pessoa está (teste com VM). */
  local: boolean;
  /** A pessoa deixou o suporte ligado (desligado = sem acesso). */
  on: boolean;
  /** Última entrega na caixa (ISO): o "visto há". */
  seenAt: string;
  source: "caixa" | "colado";
  /** O admin tirou da lista (continua com suporte; o interruptor "arquivadas" mostra de volta). */
  archived: boolean;
  /** Último plano visto da conta (cache, para o selo no seletor); null = ainda desconhecido. */
  plan: PlanName | null;
}
/** Uma conversa da pessoa com o meu-bot, vista pela transcrição do Claude Code na máquina dela (meu-bot-admin). */
export interface BotChat {
  /** Sessão do Claude Code (nome do .jsonl) ou, com `source: "app"`, o id da conversa do app (diário do backend). */
  sessionId: string;
  /** Pasta do projeto em ~/.claude/projects (diz o modo: agent-workspace = agente, chat-workspace = chat); "conversas" no diário. */
  project: string;
  title: string;
  updatedAt: string;
  /** Quantas respostas o meu-bot deu. */
  replies: number;
  /** De onde vem: transcrição do Claude Code, ou o diário que o backend grava para Grok/Hermes (~/.local/share/meu-bot/conversas). */
  source: "claude" | "app";
  /** Último provedor que respondeu (só no diário): "grok-4"… */
  provider?: string;
}
export interface BotMessage { role: "person" | "agent" | "tool"; text: string; at: string; /** Quem respondeu (só no diário). */ provider?: string }
/** Saúde da máquina da pessoa; `whatsapp` e `progress` vêm null quando ela não compartilha (ver `share`). */
export interface AdminHealth { probe: HostProbe; whatsapp: WhatsappStatus | null; progress: SupportProgress | null; share: SupportShare; /** Conta da xAI no Hermes da máquina; null = sem Hermes. */ xai: ClaudeAuthInfo | null; /** Licença e devices da conta; null = máquina fora do ar ou backend antigo sem a rota. */ license: LicenseView | null }
/** Progresso da pessoa nos tutoriais (o meu-bot dela grava na máquina com o suporte ligado). */
export interface SupportProgress {
  at: string;
  tour: "done" | "skipped" | "pending";
  tutorials: { id: string; title: string; done: number; total: number; current: string | null; finished: boolean; comingSoon: boolean }[];
}
/** Ações do admin na máquina da pessoa. "support-off" tira o próprio acesso (ex.: deixou de pagar); só o admin desliga. */
export type AdminAction = "install-backend" | "restart-gateway" | "restart-backend" | "transcription" | "transcription-off" | "support-off";

/** O que o renderer vê em `window.picker`: os três grupos juntos (o main recusa o que não é da variante). */
/** Uma ação no registro central de uma máquina, já com o texto da tela. */
export interface AuditoriaLinhaView {
  em: string; quemTipo: string; quemNome: string; app: string; acao: string; texto: string; detalhe: string;
  /** Quem entregou à central (carimbado pela chave SSH lá): "admin Fulano", "maquina pessoas"… */
  via: string; recebidoEm: string;
  /** false = a central tem e a máquina não tem mais (apagada lá); null = a máquina não foi lida. */
  naMaquina: boolean | null;
}
/** Aba "Usuários" do admin (máquina em que se entra como root): um usuário Linux de login. */
export interface UsuarioMaquina { nome: string; uid: number; home: string; shell: string; sudo: boolean; meuBot: boolean; chave: boolean; /** Disco usado e limite (KB), pela cota; null = cota desligada (usado) ou sem limite (limite). */ usadoKb: number | null; limiteKb: number | null; /** RAM dos processos dele agora (KB). */ ramKb: number; /** Tetos do systemd: RAM (MB) e CPU (% de um núcleo); null = sem teto. */ ramMaxMb: number | null; cpuMaxPct: number | null; /** Nome de exibição (descrição do usuário no Linux); "" = sem. */ apelido: string; /** Linger: o agente dele segue rodando sem ele conectado e volta ao reiniciar. */ ligado: boolean; /** A conta passou pelo onboarding: backend do meu-bot instalado e o Hermes como agente do WhatsApp. */ pronto: boolean }
/** A lista e como este Mac chega à máquina (para mostrar `ssh nome@endereço`). */
/** Hermes na máquina: `global` (em /opt/hermes, para todos), `root` (só na pasta do root: os outros não alcançam) ou `nenhum`. */
/** Claude Code Global (admin): uma conta do rodízio do root, como a tela mostra. */
export interface CgConta { id: string; rotulo: string; email: string | null; logada: boolean; ativa: boolean; estado: string; motivo: string | null; ate: number | null; sessaoPct: number | null; semanalPct: number | null }
/** Um usuário da máquina no Claude Code Global: ligado (tem chave) e quanto usou. */
export interface CgUsuario { nome: string; ligado: boolean; chamadas: number; ultima: number | null; limites: number }
/** Estado do Claude Code Global da máquina: o intermediário do root, a conta do root, o rodízio e os usuários. */
export interface CgEstado { instalado: boolean; ativo: boolean; porta: number | null; login: boolean; email: string | null; plano: string | null; contas: CgConta[]; /** Limiares do rodízio do root (os do tutorial 15); null = ainda não instalado. */ limiares: { sessao: number; semanal: number; estrategia: "ordem" | "folga" } | null; usuarios: CgUsuario[] }
/** "sem-transcritor" = Hermes global sem o /opt/transcriber (máquina de antes do padrão): falta completar. */
export type HermesNaMaquina = "global" | "sem-transcritor" | "root" | "nenhum";
export interface UsuariosVisao { usuarios: UsuarioMaquina[]; hostname: string | null; port: string | null; /** Chave privada deste Mac que entra nos usuários criados (~/.ssh/…). */ chave: string | null; /** Tamanho do disco principal (KB) e se a cota de usuário está ligada nele. */ discoKb: number | null; cota: boolean; /** Onde está o Hermes (null = máquina antiga que não informou). */ hermes: HermesNaMaquina | null; /** RAM da máquina: total, em uso e quanto é do root (KB); null = não leu. */ ram: { totalKb: number; usoKb: number; rootKb: number; swapKb: number; swapUsoKb: number } | null; /** Só na resposta de criar: o nome no seletor do meu-bot e o aviso se o do admin falhou. */ seletores?: { alias: string; aviso: string | null }; /** Só na resposta de criar: null = conta preparada (backend, Hermes, transcrição); texto = onde o preparo parou. */ preparo?: string | null; /** Só na resposta de criar: a conta já responde pelo Claude Code Global (sem login próprio). */ global?: boolean }
export interface AuditoriaVisao {
  maquina: string; nome: string | null; linhas: AuditoriaLinhaView[];
  /** Corrente da central: null = íntegra; senão o nº do primeiro registro adulterado. */
  centralQuebraEm: number | null;
  /** A cópia da máquina: lida (suporte ligado) ou não, e onde a corrente dela quebra. */
  maquinaLida: boolean; maquinaQuebraEm: number | null; faltamNaMaquina: number; maquinaErro: string | null;
}
/** Menu "…" de uma conversa dela com o meu-bot no espelho do admin. */
export type BotMenuAction = "copy-ref" | "delete";

/** Variante: admin. Só o meu-bot-admin: a página "Suporte" da máquina da pessoa. */
/** Variante: admin. Um MVP de produto derivado do meu-bot (meu-bot-fit, meu-bot-vendas…) registrado no meu-bot-admin. */
export type ProdutoStatus = "ideia" | "mvp" | "beta" | "lancado";
export interface ProdutoMvp {
  /** meu-bot-<slug>. */
  nome: string;
  vertical: string;
  pitch: string;
  publico: string;
  modulos: { chat: boolean; whatsapp: boolean; navegador: boolean; crm: boolean; extras: string };
  pipeline: { etapas: string[]; campos: { nome: string; tipo: "TEXT" | "NUMBER" | "DATE" | "DROPDOWN" | "TAG" | "CHECKBOX" }[] };
  status: ProdutoStatus;
  notas: string;
  proximos: string;
  createdAt: string;
  updatedAt: string;
}
export type ProdutoMvpPatch = { nome: string } & Partial<Omit<ProdutoMvp, "nome" | "createdAt" | "updatedAt">>;

/** Um backup no Mac do admin (sem segredos: o pacote fica cifrado). */
export interface BackupIndiceView { arquivo: string; pessoa: string; maquina: string; criadoEm: string; tamanho: number; por: string; usuario: string; whatsapp: boolean; arquivos: number }
/** Pré-voo da restauração num destino: o que impede, o que pede atenção. */
export interface BackupRestauracao { bloqueios: string[]; avisos: string[]; podeRestaurar: boolean; destinoUsuario: string; whatsappNoDestino: boolean }

/** O que já sai deste código (tabela de produtos e add-ons em src/main/app/variant-core.ts), para a janela Produtos. */
export interface ProdutosCatalogo {
  apps: { nome: string; canal: "estavel" | "staging"; descricao: string }[];
  addons: { nome: string; rotulo: string; descricao: string }[];
  /**
   * Versões para situar: a última publicada em cada canal (releases do GitHub; null = nenhuma, ou sem internet) e a
   * deste admin (build local sai sem sufixo e conta como mais nova que qualquer publicada).
   */
  versoes: { estavel: string | null; staging: string | null; local: string };
}
/** A janela Produtos do meu-bot-admin (window.produtos): o registro de MVPs e o catálogo. */
export interface ProdutosJanelaApi {
  listar(): Promise<ProdutoMvp[]>;
  salvar(patch: ProdutoMvpPatch): Promise<ProdutoMvp[]>;
  remover(nome: string): Promise<ProdutoMvp[]>;
  exportar(nome: string): Promise<{ json: string; checklist: string[] }>;
  catalogo(): Promise<ProdutosCatalogo>;
}
