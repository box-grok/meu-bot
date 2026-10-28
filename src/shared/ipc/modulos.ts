/**
 * Módulos de produto (o app meu-bot-diego e os próximos): o repositório do produto (submódulo em produtos/<nome>)
 * traz um modulos.json; o meu-bot só conhece este contrato. Ver src/main/modulos/modulos-core.ts.
 */

/** Uma credencial que a pessoa cola no app (vai para ~/.config/meu-bot/modulos/<id>.env, 0600; nunca volta ao app). */
export interface ModuloCredencial { chave: string; rotulo: string; ajuda: string }
/** Uma opção do módulo (vai para ~/.local/share/meu-bot/modulos/<id>/opcoes.json). */
export interface ModuloOpcao { chave: string; rotulo: string; tipo: "texto" | "numero" | "booleano"; padrao: string | number | boolean; ajuda: string }
export type ModuloGateway = "openclaw" | "hermes";

/** Um módulo do manifesto, já validado. */
export interface Modulo {
  id: string;
  rotulo: string;
  descricao: string;
  versao: string;
  /** Pasta do módulo no repositório do produto (relativa ao modulos.json). */
  pasta: string;
  /** Scripts dentro da pasta: o instalador recebe MODULO_ID, MODULO_DIR, MODULO_ENV e MODULO_OPCOES. */
  instalar: string;
  desinstalar: string;
  credenciais: ModuloCredencial[];
  opcoes: ModuloOpcao[];
  /** Só nestes gateways do WhatsApp (vazio = qualquer um). */
  gateways: ModuloGateway[];
  /** Avisos do que a máquina precisa ter (Chrome logado, ffmpeg…), mostrados no cartão. */
  requisitos: string[];
}

/** O que a máquina diz de um módulo. */
export interface ModuloEstado {
  ligado: boolean;
  /** Versão instalada; null = nunca instalado. */
  versao: string | null;
  /** Chaves de credencial que já têm valor (só os nomes). */
  preenchidas: string[];
  opcoes: Record<string, string | number | boolean>;
}

export interface ModuloVista extends Modulo { estado: ModuloEstado; desatualizado: boolean }

export interface ModulosLista {
  /** Nome do produto dono dos módulos (o add-on na licença). */
  produto: string;
  modulos: ModuloVista[];
  /** O add-on está liberado na licença desta máquina. */
  liberado: boolean;
  /** Gateway do WhatsApp da máquina; null = nenhum. */
  gateway: ModuloGateway | null;
}

export interface ModuloResultado { ok: boolean; log: string[] }
