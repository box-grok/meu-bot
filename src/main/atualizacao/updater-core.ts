/**
 * Atualização automática, a parte pura: qual release do GitHub é a mais nova, qual asset é deste app (nome e
 * arquitetura), como comparar versões, a assinatura das releases, os registros em disco (troca pendente, versão
 * preparada), a cadência, o reinício ocioso e a versão mínima que o backend exige. O download (update-download.ts),
 * a troca do .app e o reinício ficam em updater.ts. Puro: testável com node --test.
 */
import { createPublicKey, verify } from "node:crypto";

/** Repositório público de onde vêm as releases (`scripts/release.mjs` publica lá). */
export const UPDATE_REPO = "diegofornalha/meu-bot";

export interface ReleaseAsset { name: string; url: string; size: number }
/** `sig` = o `<zip>.sig` que o release publica ao lado (assinatura Ed25519 do zip, em base64). */
export interface UpdateCandidate { version: string; asset: ReleaseAsset; sig: ReleaseAsset }

/**
 * Chaves públicas Ed25519 das releases (SPKI DER em base64), como o SUPublicEDKey do Sparkle: o app só instala o zip
 * que uma delas confere. A principal assina toda release (privada no Chaveiro de quem publica); a reserva só existe
 * para trocar de chave sem reinstalar ninguém se a principal se perder ou vazar (privada só no gerenciador de senhas).
 * Troca: a reserva vira principal, entra uma reserva nova e a antiga sai (scripts/chave-release.mjs, skill publicar).
 */
export const UPDATE_PUBLIC_KEYS: readonly { id: string; chave: string }[] = [
  { id: "principal-2026-10", chave: "MCowBQYDK2VwAyEABo4DH23ayzUorwJWeJ8yfYnLmI89dGZSGgv/Z1hoDg0=" },
  { id: "reserva-2026-10", chave: "MCowBQYDK2VwAyEAv6Om08l77vi7GPD3A5rxD68OOnCZq+H/vLiV1qXzAlU=" },
];

/** O zip baixado é o que uma das chaves da release assinou? `sig` é o conteúdo do .sig (base64); qualquer erro = não. */
export function verificaAssinatura(zip: Buffer, sig: string, chaves: string | readonly string[] = UPDATE_PUBLIC_KEYS.map((k) => k.chave)): boolean {
  let s: Buffer;
  try { s = Buffer.from(sig.trim(), "base64"); } catch { return false; }
  if (s.length !== 64) return false;
  for (const chave of typeof chaves === "string" ? [chaves] : chaves) {
    try { if (verify(null, zip, createPublicKey({ key: Buffer.from(chave, "base64"), format: "der", type: "spki" }), s)) return true; } catch { /* chave inválida: tenta a próxima */ }
  }
  return false;
}

/** Nome do asset de um app numa release: `meu-bot-0.2.0-arm64.zip` (o .app zipado com ditto). */
export const assetName = (app: string, version: string, arch: string): string => `${app}-${version}-${arch}.zip`;

/**
 * Compara versões na ordem do semver; negativo = `a` é mais antiga: 0.2.0-staging.3 < 0.2.0-staging.10 < 0.2.0.
 * (Mesma regra de src/renderer/lib/admin-view.ts: o renderer compila à parte e não importa daqui.)
 */
export function compareVersions(a: string, b: string): number {
  // Núcleo "x.y.z" numérico; depois a pre-release: sem ela vence ("0.2.0" > "0.2.0-staging.9"); com as duas,
  // compara parte a parte (número com número, texto com texto, número < texto, mais partes > menos).
  const parse = (v: string): { nucleo: number[]; pre: string[] } => {
    const [semMeta = ""] = v.trim().replace(/^v/, "").split("+");
    const i = semMeta.indexOf("-");
    const nucleo = (i < 0 ? semMeta : semMeta.slice(0, i)).split(".").map((x) => Number.parseInt(x, 10) || 0);
    return { nucleo, pre: i < 0 ? [] : semMeta.slice(i + 1).split(".") };
  };
  const x = parse(a), y = parse(b);
  for (let k = 0; k < Math.max(x.nucleo.length, y.nucleo.length); k++) { const d = (x.nucleo[k] ?? 0) - (y.nucleo[k] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let k = 0; k < Math.max(x.pre.length, y.pre.length); k++) {
    const p = x.pre[k], q = y.pre[k];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const np = /^\d+$/.test(p), nq = /^\d+$/.test(q);
    const d = np && nq ? Number(p) - Number(q) : np ? -1 : nq ? 1 : p < q ? -1 : p > q ? 1 : 0;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Tag de um build staging: v0.2.0-staging.3. */
export const STAGING_TAG = /^v?\d+\.\d+\.\d+-staging\.\d+$/;
/** De onde o app lê as releases: o estável, a última (sem pre-release); o staging, a lista (as pre-releases). */
export const releasesUrl = (canal: "estavel" | "staging"): string => `https://api.github.com/repos/${UPDATE_REPO}/releases${canal === "staging" ? "?per_page=30" : "/latest"}`;

/** Hora do dia para as frases do atualizador; injetável para o teste não depender do fuso da máquina. */
export type Hora = (d: Date) => string;
const HORA_PADRAO: Hora = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
/**
 * O que a resposta do GitHub ao feed quer dizer, antes de olhar o corpo. Três desfechos, e a diferença entre eles é
 * o que impede o app de errar o diagnóstico:
 *
 * - 404: o repositório ainda não publicou release nenhuma. A instalada É a mais recente, e isso não é erro.
 * - 403 ou 429 com a cota zerada: o limite de consultas por IP. Não é defeito do app nem da rede, é esperar — e a
 *   frase diz a hora em que libera, em vez de mandar a pessoa procurar problema onde não há.
 * - qualquer outro status: o status mesmo, sem adivinhação. Um 403 com cota de sobra é repositório privado ou
 *   renomeado, e prometer que "libera às tantas" mandaria a pessoa esperar por nada.
 */
export type RespostaFeed = { tipo: "sem-release" } | { tipo: "ler" } | { tipo: "falha"; msg: string };
export function classificarRespostaFeed(status: number, remaining: string | null, reset: string | null, hora: Hora = HORA_PADRAO): RespostaFeed {
  if (status === 404) return { tipo: "sem-release" };
  if (status >= 200 && status < 300) return { tipo: "ler" };
  if ((status === 403 || status === 429) && remaining === "0") {
    const seg = Number(reset);
    const volta = Number.isFinite(seg) && seg > 0 ? hora(new Date(seg * 1000)) : null;
    return { tipo: "falha", msg: `o GitHub limitou as consultas deste IP${volta === null ? "" : `; libera por volta das ${volta}`}` };
  }
  return { tipo: "falha", msg: `GitHub respondeu ${status}` };
}

/** Por que uma release que o feed trouxe não dá para instalar. */
export type MotivoRelease = "corpo-inesperado" | "tag-inesperada" | "sem-ativo" | "sem-assinatura";

/**
 * O que a consulta ao feed achou. Separar "nada-novo" de "inutilizavel" é o que impede o app de anunciar
 * "tudo em dia" quando existe uma release que ele não conseguiu usar (zip que falhou no envio, release sem
 * o .sig ao lado, nome de asset que não bate) e, por isso, parar de atualizar calado para sempre.
 */
export type EscolhaRelease =
  | { tipo: "candidata"; candidata: UpdateCandidate }
  | { tipo: "nada-novo" }
  | { tipo: "inutilizavel"; versao: string | null; motivo: MotivoRelease };

const NADA_NOVO: EscolhaRelease = { tipo: "nada-novo" };
const inutilizavel = (versao: string | null, motivo: MotivoRelease): EscolhaRelease => ({ tipo: "inutilizavel", versao, motivo });
/** A candidata, ou null: para quem só quer saber se dá para atualizar. */
export const candidataDe = (e: EscolhaRelease): UpdateCandidate | null => (e.tipo === "candidata" ? e.candidata : null);

/** A frase que a tela mostra quando achamos uma release e não deu para usar. */
export function motivoReleaseTexto(versao: string | null, motivo: MotivoRelease): string {
  const qual = versao === null ? "a release mais recente" : `a ${versao}`;
  switch (motivo) {
    case "corpo-inesperado": return "o servidor de atualização respondeu algo que não consegui entender";
    case "tag-inesperada": return `${qual} está publicada com um número de versão que não reconheço`;
    case "sem-ativo": return `${qual} não traz o arquivo deste app para esta arquitetura`;
    case "sem-assinatura": return `${qual} foi publicada sem a assinatura ao lado do arquivo`;
  }
}

/**
 * A atualização deste app na resposta da API do GitHub (o asset é o deste app nesta arquitetura; a versão vem do
 * `tag_name`, com ou sem "v"). Estável: `raw` é a /releases/latest e só vale release normal "x.y.z". Staging: `raw`
 * é a lista /releases e vale a maior pre-release com tag v*-staging.* que tenha o asset deste app.
 *
 * Uma release que não dá para usar nunca vira "nada-novo": o app precisa dizer o que houve em vez de se declarar
 * atualizado. No staging, uma candidata utilizável ganha de qualquer problema em outra entrada da lista.
 */
export function escolherRelease(raw: unknown, want: { app: string; arch: string; current: string; canal?: "estavel" | "staging" }): EscolhaRelease {
  if (want.canal !== "staging") return avaliarRelease(raw, want, false);
  if (!Array.isArray(raw)) return inutilizavel(null, "corpo-inesperado");
  let melhor: UpdateCandidate | null = null;
  let problema: { versao: string | null; motivo: MotivoRelease } | null = null;
  for (const r of raw) {
    const e = avaliarRelease(r, want, true);
    if (e.tipo === "candidata") {
      if (melhor === null || compareVersions(e.candidata.version, melhor.version) > 0) melhor = e.candidata;
    } else if (e.tipo === "inutilizavel" && (problema === null || (e.versao !== null && (problema.versao === null || compareVersions(e.versao, problema.versao) > 0)))) {
      problema = { versao: e.versao, motivo: e.motivo };
    }
  }
  if (melhor !== null) return { tipo: "candidata", candidata: melhor };
  return problema === null ? NADA_NOVO : inutilizavel(problema.versao, problema.motivo);
}

function avaliarRelease(raw: unknown, want: { app: string; arch: string; current: string }, staging: boolean): EscolhaRelease {
  if (raw === null || typeof raw !== "object") return inutilizavel(null, "corpo-inesperado");
  const r = raw as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  if (typeof r.tag_name !== "string") return inutilizavel(null, "corpo-inesperado");
  // Rascunho, ou release do outro canal: não é para nós, e não é defeito nenhum.
  if (r.draft === true || (r.prerelease === true) !== staging) return NADA_NOVO;
  const version = r.tag_name.replace(/^v/, "");
  // Na lista do staging, uma tag de outro formato é só outra coisa publicada no repositório; no estável,
  // a /releases/latest com uma tag que não reconhecemos é problema que a pessoa precisa saber.
  if (staging ? !STAGING_TAG.test(r.tag_name) : !/^\d+(\.\d+){0,3}$/.test(version)) return staging ? NADA_NOVO : inutilizavel(null, "tag-inesperada");
  if (compareVersions(version, want.current) <= 0) return NADA_NOVO;
  // Uma entrada estragada no meio da lista do staging é ruído; na /releases/latest é a resposta inteira.
  if (!Array.isArray(r.assets)) return staging ? NADA_NOVO : inutilizavel(version, "corpo-inesperado");
  const name = assetName(want.app, version, want.arch);
  const achar = (n: string): ReleaseAsset | null => {
    for (const a of r.assets as unknown[]) {
      if (a === null || typeof a !== "object") continue;
      const o = a as { name?: unknown; browser_download_url?: unknown; size?: unknown };
      if (o.name === n && typeof o.browser_download_url === "string" && /^https:\/\//.test(o.browser_download_url)) return { name: n, url: o.browser_download_url, size: typeof o.size === "number" ? o.size : 0 };
    }
    return null;
  };
  const asset = achar(name);
  // No staging publica-se um produto de cada vez, então uma pre-release sem o arquivo deste app é o normal e
  // apenas se pula. No estável a /releases/latest tem que trazer todos: faltar o desta arquitetura é o defeito
  // que antes virava "você está na versão mais recente" para sempre.
  if (asset === null) return staging ? NADA_NOVO : inutilizavel(version, "sem-ativo");
  // Sem o .sig ao lado não dá para instalar: zip que ninguém assinou nunca entra.
  const sig = achar(`${name}.sig`);
  if (sig === null) return inutilizavel(version, "sem-assinatura");
  return { tipo: "candidata", candidata: { version, asset, sig } };
}

/**
 * Atualizar um componente que o app instala na máquina (a guarda do WhatsApp): só quando a versão que vem no app é
 * MAIS NOVA que a instalada (ou a instalada não diz versão). Com o estável e o staging falando com a mesma máquina,
 * "diferente" faria um trocar a guarda do outro a cada abertura.
 */
export function deveAtualizar(instalada: string | null, doApp: string | null): boolean {
  if (doApp === null) return false;
  return instalada === null || compareVersions(doApp, instalada) > 0;
}

/**
 * Reinstalar o backend da máquina (o install.sh reinicia o serviço) na sondagem: só onde ele já está instalado, só
 * para subir de versão (backend sem VERSION conta como antigo) e só ocioso, com zero chats em andamento. "ocupado" =
 * precisa, mas espera a próxima sondagem; null `busy` (backend antigo, sem o contador) conta como ocioso. Um backend
 * de outro agente na pasta herdada não é "instalado" (backend-dir-core.ts), então nunca é tocado.
 */
export function precisaAtualizarBackend(p: { backendInstalled: boolean; backendVersion: string | null; backendBusy: number | null }, doApp: string | null): "atualizar" | "ocupado" | "nao" {
  // `backendInstalled` só é verdadeiro para o backend do meu-bot (backend-dir-core.ts): o de outro agente na pasta herdada nunca conta.
  if (!p.backendInstalled || !deveAtualizar(p.backendVersion, doApp)) return "nao";
  return p.backendBusy !== null && p.backendBusy > 0 ? "ocupado" : "atualizar";
}

/**
 * Troca recém-feita, ainda sem prova de que a versão nova abre: `userData/update-pendente.json`, gravado na troca dos
 * .app. `antigos` = os `<app>.antigo` guardados para voltar; `tentativas` = aberturas já feitas na nova; `gatilho` =
 * quem pediu a troca (clique, reinício ocioso ou a saída do app) e `pedidoEm` = quando, para o registro.
 */
export type UpdateGatilho = "clique" | "ocioso" | "saida";
/** `fase`: "pedida" = o registro foi gravado e a troca começou; "trocada" = os .app já foram trocados (v1 antigo conta como trocada). */
export interface UpdatePendente { de: string; para: string; antigos: string[]; tentativas: number; gatilho: UpdateGatilho | null; pedidoEm: string | null; fase: "pedida" | "trocada" }
export function parsePendente(raw: unknown): UpdatePendente | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.de !== "string" || typeof o.para !== "string" || !Array.isArray(o.antigos)) return null;
  const antigos = o.antigos.filter((x): x is string => typeof x === "string" && x.endsWith(".app.antigo"));
  const gatilho = o.gatilho === "clique" || o.gatilho === "ocioso" || o.gatilho === "saida" ? o.gatilho : null;
  const pedidoEm = typeof o.pedidoEm === "string" && !Number.isNaN(Date.parse(o.pedidoEm)) ? o.pedidoEm : null;
  return { de: o.de, para: o.para, antigos, tentativas: Number.isInteger(o.tentativas) && (o.tentativas as number) >= 0 ? (o.tentativas as number) : 0, gatilho, pedidoEm, fase: o.fase === "pedida" ? "pedida" : "trocada" };
}
/**
 * Troca interrompida no meio (queda entre tirar o .app e pôr o novo no lugar): para cada `<app>.app.antigo` cujo
 * `<app>.app` não existe, devolve o rename que o repõe. `existe` = o `fs.existsSync` de quem chama. Puro.
 */
export function repararTroca(antigos: readonly string[], existe: (p: string) => boolean): { de: string; para: string }[] {
  const out: { de: string; para: string }[] = [];
  for (const old of antigos) { const alvo = old.replace(/\.antigo$/, ""); if (existe(old) && !existe(alvo)) out.push({ de: old, para: alvo }); }
  return out;
}
/** Por que uma cópia anterior fica onde está em vez de ser apagada. */
export type MotivoManter = "app-ausente" | "troca-incompleta";
/**
 * Quais cópias anteriores podem ser apagadas, e quais não. Duas regras, e as duas evitam apagar a única cópia que
 * resta de uma instalação:
 *
 * - `fase: "pedida"` quer dizer que o registro foi gravado e o processo morreu antes de terminar as renomeações:
 *   `antigos` é o PLANO, não o que foi criado. Um `<app>.antigo` que está lá pode ser de outra sessão deste Mac
 *   (troca rápida de usuário), e apagá-lo tiraria a volta atrás dela. Em "pedida" nada é apagado.
 * - `fase: "trocada"` lista o que esta sessão de fato criou, então pode apagar — menos a `<app>.antigo` cujo
 *   `<app>` não existe, que é tudo o que sobrou daquela cópia.
 */
export function decideDescarte(fase: "pedida" | "trocada", antigos: readonly string[], existe: (p: string) => boolean): { apagar: string[]; manter: { caminho: string; motivo: MotivoManter }[] } {
  if (fase === "pedida") return { apagar: [], manter: antigos.map((caminho) => ({ caminho, motivo: "troca-incompleta" as const })) };
  const apagar: string[] = [];
  const manter: { caminho: string; motivo: MotivoManter }[] = [];
  for (const a of antigos) { if (existe(a.replace(/\.antigo$/, ""))) apagar.push(a); else manter.push({ caminho: a, motivo: "app-ausente" }); }
  return { apagar, manter };
}
/** A frase do log para uma cópia anterior que ficou. */
export const motivoManterTexto = (motivo: MotivoManter): string =>
  motivo === "app-ausente" ? "o app no lugar dele não existe" : "a troca não chegou ao fim e esta cópia pode ser de outra sessão";

/** Aberturas da versão nova sem chegar a 30 s de vida antes de voltar à anterior. */
export const TENTATIVAS_ATE_VOLTAR = 3;
/**
 * O que fazer ao abrir com uma troca pendente: "aguardar" (conta a tentativa e confirma se o app ficar de pé),
 * "voltar" (a nova não passou das primeiras aberturas: restaura os .antigo), "nao-pegou" (reabriu na versão de
 * antes da troca: o .app que relançou não era o trocado; só registra e deixa a próxima verificação preparar de
 * novo) ou "descartar" (outra versão: a pessoa instalou por fora; só limpa o registro).
 */
export type DecisaoPendente = "aguardar" | "voltar" | "nao-pegou" | "descartar";
export function decideRollback(p: UpdatePendente, versaoAtual: string): DecisaoPendente {
  if (versaoAtual === p.de && p.de !== p.para) return "nao-pegou";
  if (versaoAtual !== p.para) return "descartar";
  return p.tentativas + 1 >= TENTATIVAS_ATE_VOLTAR ? "voltar" : "aguardar";
}

/**
 * Das cópias do app achadas no Mac (a que está rodando, ~/Applications, a mesa), quais ainda precisam trocar.
 * Uma cópia que JÁ está na versão de destino foi trocada por outra sessão: mexer nela faria esta sessão reivindicar
 * (e depois apagar) a `<app>.antigo` que é a volta atrás daquela. Filtrar aqui, antes de gravar o registro. Puro.
 */
export function alvosParaTrocar(alvos: readonly { caminho: string; versao: string | null }[], para: string): { trocar: string[]; jaNaVersao: string[] } {
  const trocar: string[] = [], jaNaVersao: string[] = [];
  for (const a of alvos) (a.versao === para ? jaNaVersao : trocar).push(a.caminho);
  return { trocar, jaNaVersao };
}

/** Quanto tempo uma trava de troca pode ficar de pé antes de contar como restos de uma sessão que morreu. */
export const TRAVA_VELHA_MS = 5 * 60_000;
/** A trava achada no disco é de uma sessão viva ou é lixo de uma que morreu? `idadeMs` NaN (não deu para ler) = lixo. */
export const travaAbandonada = (idadeMs: number, limite: number = TRAVA_VELHA_MS): boolean => !(idadeMs < limite);

/** Erro de escrita que quer dizer "esta pasta não aceita a troca" (imagem do instalador, pasta de outro usuário). */
export const pastaSoLeitura = (e: unknown): boolean => {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return c === "EROFS" || c === "EACCES" || c === "EPERM";
};

/**
 * Versão já baixada, verificada e extraída, guardada em disco (`userData/update/preparada.json`) para a próxima
 * abertura não baixar de novo: `bundle` = caminho do .app extraído; `sha256` = do zip de onde ele veio.
 */
export interface UpdatePreparada { versao: 1; para: string; bundle: string; sha256: string; em: string }
export function parsePreparada(raw: unknown): UpdatePreparada | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.versao !== 1 || typeof o.para !== "string" || !VERSAO_RE.test(o.para) || typeof o.bundle !== "string" || !o.bundle.endsWith(".app")) return null;
  if (typeof o.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(o.sha256) || typeof o.em !== "string" || Number.isNaN(Date.parse(o.em))) return null;
  return { versao: 1, para: o.para, bundle: o.bundle, sha256: o.sha256, em: o.em };
}
/** Forma de uma versão: x.y.z, com pre-release opcional (0.2.0-staging.3). */
export const VERSAO_RE = /^\d+(\.\d+){1,3}(-[0-9A-Za-z.-]+)?$/;

/**
 * A versão preparada da sessão anterior ainda serve? Só a decisão; quem chama é que lê o disco e refaz a conferência
 * de assinatura. "nao-e-mais-nova" cobre o caso de a pessoa ter instalado por fora no meio tempo.
 */
export type UsoPreparada = { tipo: "usar"; preparada: UpdatePreparada } | { tipo: "descartar"; motivo: "ilegivel" | "nao-e-mais-nova" | "sumiu" };
export function decideReaproveitar(p: UpdatePreparada | null, atual: string, existeBundle: (b: string) => boolean): UsoPreparada {
  if (p === null) return { tipo: "descartar", motivo: "ilegivel" };
  if (compareVersions(p.para, atual) <= 0) return { tipo: "descartar", motivo: "nao-e-mais-nova" };
  if (!existeBundle(p.bundle)) return { tipo: "descartar", motivo: "sumiu" };
  return { tipo: "usar", preparada: p };
}

/**
 * O botão mandou a versão que a tela mostrava (`pedida`) e, entre o clique e agora, a preparada pode ter mudado.
 * Seguir na mais nova é a mesma intenção da pessoa ("atualizar"), e a nova já passou pela assinatura e pelo
 * codesign; obrigá-la a clicar de novo só para pedir exatamente isto era atrito sem ganho. Andar para TRÁS, não:
 * aí alguma coisa aconteceu (a release foi retirada e outra entrou) e quem confere é a pessoa.
 */
export type AlvoAplicacao = { tipo: "seguir"; versao: string; trocou: boolean } | { tipo: "recusar"; motivo: string };
export function decideAlvoAplicacao(pedida: string, pronta: string | null): AlvoAplicacao {
  if (pronta === null) return { tipo: "recusar", motivo: "não há atualização pronta" };
  const d = compareVersions(pronta, pedida);
  if (d === 0) return { tipo: "seguir", versao: pronta, trocou: false };
  if (d > 0) return { tipo: "seguir", versao: pronta, trocou: true };
  return { tipo: "recusar", motivo: `A versão pronta agora é a ${pronta}, anterior à ${pedida} que você pediu; confira e clique de novo.` };
}

/**
 * "Reiniciar e atualizar" com uma resposta em andamento. A espera é a mesma de antes; o que muda é o fim dela:
 * em vez de atropelar a conversa calado, o app devolve a escolha para a pessoa ("Parar e atualizar"), e só o
 * clique dela em cima disso (`forcar`) interrompe o trabalho. O reinício ocioso nunca chega aqui ocupado, porque
 * `decideReinicioOcioso` já exige nada em andamento.
 */
export type FimDaEspera = "trocar" | "perguntar";
export const decideFimDaEspera = (aindaOcupado: boolean, forcar: boolean): FimDaEspera => (!aindaOcupado || forcar ? "trocar" : "perguntar");

/** Ciclo de verificação (como no Grok Bot): a cada hora, com até 5 min de jitter para os Macs não baterem juntos no GitHub. */
export const CHECK_EVERY_MS = 60 * 60_000;
export const CHECK_JITTER_MS = 5 * 60_000;
export const proximaVerificacaoMs = (random: () => number = Math.random): number => CHECK_EVERY_MS + Math.floor(Math.max(0, Math.min(1, random())) * CHECK_JITTER_MS);
/** Uma verificação com mais que isto de idade não serve para confirmar a troca: reconsulta antes de reiniciar. */
export const CONFIRMA_FEED_MS = 60_000;

/**
 * A release ainda oferece a versão preparada? `cand` = a candidata que a consulta devolveu agora para a versão em
 * execução: null (nada mais novo) ou uma versão anterior à preparada significa que ela foi retirada; a própria ou
 * uma mais nova confirma (a mais nova entra na próxima verificação; a preparada continua válida).
 */
export const feedAindaOferece = (cand: { version: string } | null, preparada: string): boolean => cand !== null && compareVersions(cand.version, preparada) >= 0;

/**
 * Antes de trocar, o app reconsulta o GitHub se a última verificação ficou velha. O que fazer com o resultado:
 * "segue" (a release ainda oferece a preparada, ou a consulta não deu para fazer), "ilegivel" (respondeu algo que
 * não dá para usar: isso NÃO descarta o que já foi baixado e conferido) ou "retirada" (resposta conclusiva dizendo
 * que aquela versão saiu do ar). Só uma resposta conclusiva joga fora trabalho já feito.
 */
export type Reconfirmacao = { tipo: "segue" } | { tipo: "ilegivel"; motivo: string } | { tipo: "retirada"; agora: string | null };
export function decideReconfirmacao(escolha: EscolhaRelease | null, preparadaPara: string): Reconfirmacao {
  if (escolha === null) return { tipo: "segue" };
  if (escolha.tipo === "inutilizavel") return { tipo: "ilegivel", motivo: motivoReleaseTexto(escolha.versao, escolha.motivo) };
  const cand = candidataDe(escolha);
  return feedAindaOferece(cand, preparadaPara) ? { tipo: "segue" } : { tipo: "retirada", agora: cand?.version ?? null };
}

/** Ociosidade que autoriza o reinício sozinho (como o Grok Bot: 10 min sem mexer, ou a tela bloqueada). */
export const OCIOSO_SEG = 600;
export type EstadoSistema = "active" | "idle" | "locked" | "unknown";
/**
 * Reiniciar sozinho na versão pronta? Só com a preferência ligada, a versão preparada, o Mac ocioso (ou bloqueado),
 * nenhuma resposta em andamento e nenhum terminal aberto (um terminal é uma sessão da pessoa; nunca se fecha por ela).
 */
export function decideReinicioOcioso(s: { ligado: boolean; pronta: boolean; sistema: EstadoSistema; ocupado: boolean; terminais: number }): boolean {
  return s.ligado && s.pronta && (s.sistema === "idle" || s.sistema === "locked") && !s.ocupado && s.terminais === 0;
}

/** Versão mínima do app que o backend exige (vem no hello); só uma string de versão válida vale. */
export const parseVersaoMinima = (v: unknown): string | null => (typeof v === "string" && VERSAO_RE.test(v) ? v : null);
/** O app em execução está abaixo da mínima que o backend exige? Sem mínima (backend antigo), nunca. */
export const abaixoDaMinima = (atual: string, minima: string | null): boolean => minima !== null && compareVersions(atual, minima) < 0;
