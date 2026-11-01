/**
 * Modo de depuração (31 out): uma faixa no topo da janela mostra o build, o batimento do processo principal, o
 * túnel e o que chega de fora (ações do agente nos sockets, do Claude Code, hooks). Ligado por padrão no staging;
 * nas outras variantes pela paleta ou `--depuracao`.
 */
export type OrigemDepuracao = "navegador" | "gmail" | "terminal" | "hook" | "nota" | "main";
/** Uma ação vinda de fora, como o main a viu. */
export interface EventoDepuracao { em: number; origem: OrigemDepuracao; dono: string | null; rota: string; ok: boolean; ms: number | null; resumo: string; detalhe?: unknown }
/** Tique de 1 s do main; `marca` = a última coisa síncrona que ele anunciou antes de fazer (Chaveiro, ssh). */
export interface BatimentoDepuracao { em: number; marca: string | null; marcaEm: number | null }
/** O que o empacotamento gravou em Resources/build.json; em dev, "dev". */
export interface Compilacao { commit: string; branch: string; em: string }
export interface EstadoDepuracao {
  ligado: boolean;
  /** O que está gravado nas configurações (null = o padrão da variante decide). */
  gravado: boolean | null;
  padraoDaVariante: boolean;
  /** `--depuracao` na linha de comando: ligado só neste processo. */
  forcado: boolean;
  eventos: EventoDepuracao[];
  batimento: BatimentoDepuracao;
}
