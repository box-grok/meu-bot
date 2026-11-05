/**
 * "Nova VPS" (seletor do meu-bot-admin-gestao): a parte pura do job que leva uma VPS recém-criada ao fluxo do meu-bot
 * (alias root no ~/.ssh/config deste Mac, pessoa no admin, Preparar máquina, primeiro usuário). O IO (ssh, arquivos,
 * os jobs do admin) fica em vps-nova-admin.ts. Premissa: a VPS nasce com a chave pública deste Mac cadastrada no
 * painel do provedor (Hostinger: Chaves SSH); senha nunca entra no app.
 */
import { HOSTNAME_RE, USER_RE } from "../suporte/support-code";

export interface VpsNovaPedido {
  /** IP ou nome DNS da VPS. */
  endereco: string;
  /** Nome curto da máquina: vira o alias `<nome>-root` neste Mac e o nome da pessoa no admin. */
  nome: string;
  usuario: string;
  porta: number;
  /** Domínio do Link Público Global; "" = não instalar. */
  dominio: string;
  /** Instalar também o Chromium na tela do bot (300 a 600 MB de RAM por janela). */
  chromium: boolean;
  /** Criar o primeiro usuário (box-1) ao fim. */
  primeiroUsuario: boolean;
  /** Mesmo endereço, chave do servidor nova: o job pode tirar a chave antiga do known_hosts. */
  reinstalada: boolean;
}

/** Nome curto: minúsculas, dígitos e hífen, 2 a 25 caracteres, começa por letra (vai virar alias e nome de pessoa). */
export const NOME_VPS_RE = /^[a-z][a-z0-9-]{1,24}$/;
const DOMINIO_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function parseVpsNova(raw: unknown): { ok: true; pedido: VpsNovaPedido } | { ok: false; reason: string } {
  const o = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const endereco = s("endereco");
  if (endereco === "" || !HOSTNAME_RE.test(endereco) || endereco.startsWith("-")) return { ok: false, reason: "endereço inválido: o IP ou o nome DNS da VPS" };
  const nome = s("nome").toLowerCase();
  if (!NOME_VPS_RE.test(nome)) return { ok: false, reason: "nome curto inválido: minúsculas, dígitos e hífen, de 2 a 25 caracteres, começando por letra" };
  if (nome.startsWith("suporte-") || nome === "local") return { ok: false, reason: `"${nome}" é um nome reservado` };
  const usuario = s("usuario") === "" ? "root" : s("usuario");
  if (!USER_RE.test(usuario)) return { ok: false, reason: "usuário inválido" };
  const porta = o["porta"] === undefined || o["porta"] === "" || o["porta"] === null ? 22 : Number(o["porta"]);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return { ok: false, reason: "porta inválida (1 a 65535)" };
  const dominio = s("dominio").toLowerCase();
  if (dominio !== "" && !DOMINIO_RE.test(dominio)) return { ok: false, reason: "domínio inválido (ex.: meubot.com.br)" };
  return { ok: true, pedido: { endereco, nome, usuario, porta, dominio, chromium: o["chromium"] === true, primeiroUsuario: o["primeiroUsuario"] !== false, reinstalada: o["reinstalada"] === true } };
}

/** O alias do acesso root neste Mac (`<nome>-root`), como o `vps-hostinger` já grava. */
export const aliasRootDe = (nome: string): string => `${nome}-root`;

export type MotivoAcesso = "ok" | "so-chave" | "senha" | "host-key-mudou" | "rede" | "outro";

/** Por que o `ssh -o BatchMode=yes` não entrou, pelo código de saída e pelo stderr do ssh. */
export function motivoAcesso(code: number | null, stderr: string): MotivoAcesso {
  if (code === 0) return "ok";
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(stderr)) return "host-key-mudou";
  const m = /Permission denied \(([^)]*)\)/i.exec(stderr);
  if (m !== null) return /password|keyboard-interactive/i.test(m[1] ?? "") ? "senha" : "so-chave";
  if (/timed out|No route to host|Could not resolve hostname|Connection refused|Network is unreachable|Connection reset/i.test(stderr)) return "rede";
  return "outro";
}

/** O que a tela diz para cada motivo (o endereço entra no lugar de <endereço>). */
export const TEXTO_ACESSO: Record<Exclude<MotivoAcesso, "ok">, string> = {
  "so-chave": "a VPS só aceita chave, e a deste Mac não está lá: cadastre ~/.ssh/id_ed25519.pub no painel do provedor (Hostinger: Configurações › Chaves SSH) e tente de novo",
  senha: "a VPS aceita senha, mas a chave deste Mac ainda não está lá: cadastre ~/.ssh/id_ed25519.pub no painel do provedor, ou autorize-a uma vez no Terminal com `ssh-copy-id -i ~/.ssh/id_ed25519.pub root@<endereço>`",
  "host-key-mudou": "a chave do servidor mudou para este endereço: se a VPS foi reinstalada, marque \"VPS reinstalada\" e tente de novo",
  rede: "não alcancei a VPS: confira o endereço, a porta e se ela já terminou de subir",
  outro: "o ssh não entrou",
};

/** O bloco sugerido para o modelo versionado config/ssh-hosts.conf (o job só sugere: o arquivo é do repositório). */
export function blocoModeloDe(o: { nome: string; hostname: string; user: string; port: number }): string {
  return `Host ${aliasRootDe(o.nome)}
    HostName ${o.hostname}
    User ${o.user}
    Port ${o.port}
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 60
    ServerAliveCountMax 3
`;
}

export type PassoVpsId = "acesso" | "alias" | "pessoa" | "preparar" | "usuario" | "modelo";
export interface PassoVps { id: PassoVpsId; titulo: string; estado: "feito" | "pendente" | "humano"; detalhe: string }

/** O que o job apurou (antes de agir, ou depois): cada campo null = ainda não se sabe. */
export interface FatosVps {
  acesso: MotivoAcesso | null;
  aliasNoConfig: boolean;
  /** Alias `suporte-…` da pessoa, quando já está na lista. */
  pessoa: string | null;
  /** Itens do Preparar que ainda faltam (null = não lido); humanos à parte. */
  prepararFaltam: string[] | null;
  prepararHumanos: string[];
  /** Alias do primeiro usuário quando ele existe. */
  usuario: string | null;
  primeiroUsuario: boolean;
  modeloTemHost: boolean;
}

export const TITULOS_VPS: Record<PassoVpsId, string> = {
  acesso: "Entrar como root por chave",
  alias: "Alias root no ~/.ssh/config deste Mac",
  pessoa: "Máquina na lista de pessoas do admin",
  preparar: "Preparar máquina (swap, cota, governança, pacotes, gh, Hermes, transcritor, OpenClaw, Claude Global)",
  usuario: "Primeiro usuário (box-1) pronto para o WhatsApp",
  modelo: "Bloco no modelo config/ssh-hosts.conf",
};

/** A lista feito/pendente/humano que a tela mostra antes e depois do job. */
export function planoVpsNova(f: FatosVps): PassoVps[] {
  const p: PassoVps[] = [];
  p.push({ id: "acesso", titulo: TITULOS_VPS.acesso, estado: f.acesso === "ok" ? "feito" : "pendente", detalhe: f.acesso === "ok" ? "entra com ~/.ssh/id_ed25519" : f.acesso === null ? "" : TEXTO_ACESSO[f.acesso] });
  p.push({ id: "alias", titulo: TITULOS_VPS.alias, estado: f.aliasNoConfig ? "feito" : "pendente", detalhe: "" });
  p.push({ id: "pessoa", titulo: TITULOS_VPS.pessoa, estado: f.pessoa !== null ? "feito" : "pendente", detalhe: f.pessoa ?? "" });
  const faltam = f.prepararFaltam;
  p.push({ id: "preparar", titulo: TITULOS_VPS.preparar, estado: faltam === null ? "pendente" : faltam.length === 0 ? (f.prepararHumanos.length > 0 ? "humano" : "feito") : "pendente", detalhe: faltam === null ? "" : faltam.length > 0 ? `faltam: ${faltam.join(", ")}` : f.prepararHumanos.length > 0 ? `só você: ${f.prepararHumanos.join(", ")}` : "tudo ok" });
  if (f.primeiroUsuario) p.push({ id: "usuario", titulo: TITULOS_VPS.usuario, estado: f.usuario !== null ? "humano" : "pendente", detalhe: f.usuario !== null ? `${f.usuario}: falta só o QR do WhatsApp no meu-bot dele` : "" });
  p.push({ id: "modelo", titulo: TITULOS_VPS.modelo, estado: f.modeloTemHost ? "feito" : "humano", detalhe: f.modeloTemHost ? "" : "copie o bloco e commite em config/ssh-hosts.conf" });
  return p;
}

/** O recado final: o que entrou e o que fica para o admin fazer na janela da máquina. */
export function textoFinal(nome: string, plano: PassoVps[], o: { aliasBox: string | null; dominio: string }): string {
  const pendentes = plano.filter((x) => x.estado === "pendente");
  const linhas: string[] = [];
  linhas.push(pendentes.length === 0 ? `✓ ${nome} entrou no fluxo.` : `⚠ ${nome} entrou parcialmente: ${pendentes.map((x) => x.titulo.toLowerCase()).join("; ")}.`);
  const humanos: string[] = [];
  humanos.push(`entrar no Claude Code do root (janela de ${nome} › Claude Code Global › Entrar)`);
  if (o.dominio !== "") humanos.push("Link Público: entrar na Cloudflare e subir o túnel (janela › Link Público Global)");
  if (o.aliasBox !== null) humanos.push(`ler o QR do WhatsApp no meu-bot de ${o.aliasBox}`);
  linhas.push(`Falta você: ${humanos.map((h, i) => `${i + 1}) ${h}`).join("; ")}.`);
  return linhas.join("\n");
}
