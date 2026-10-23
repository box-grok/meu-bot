/**
 * Variante: crm. Google Contatos → CRM, parte pura (testada sem rede): o client OAuth do app, PKCE, o endereço de
 * autorização (retorno no loopback, como o Google pede para apps de desktop), a troca de código e a conversão das
 * pessoas da API People para o formato do POST /v1/crm/contacts/import.
 */
import { createHash, randomBytes } from "node:crypto";

/**
 * Contatos com escrita (decisão do dono, 2026-10-20: todo contato novo do WhatsApp vai para o Google Contatos);
 * nada além disso. O e-mail da conta vem da própria API People, se ela der.
 */
export const ESCOPO_ESCRITA = "https://www.googleapis.com/auth/contacts";
/**
 * Drive só com `drive.file` (decisão do dono, 2026-10-21): o app enxerga apenas os arquivos e pastas que ele mesmo
 * cria, nada do resto do Drive. Serve para guardar a conversa do WhatsApp ao limpar o histórico (junto do CRM).
 */
export const ESCOPO_DRIVE = "https://www.googleapis.com/auth/drive.file";
export const ESCOPOS = [ESCOPO_ESCRITA, ESCOPO_DRIVE] as const;
export const temDrive = (escopo: unknown): boolean => typeof escopo === "string" && escopo.split(/\s+/).includes(ESCOPO_DRIVE);
/** A autorização guardada permite criar contatos? (a antiga, só leitura, pede "Reconectar"). */
export const temEscrita = (escopo: unknown): boolean => temEscopo(escopo, ESCOPO_ESCRITA);
/** `email`/`profile` voltam do Google como as URLs de userinfo; tratados como equivalentes ao pedir e ao conferir. */
const ALIASES_ESCOPO: Record<string, readonly string[]> = {
  email: ["email", "https://www.googleapis.com/auth/userinfo.email"],
  profile: ["profile", "https://www.googleapis.com/auth/userinfo.profile"],
};
/** O escopo guardado inclui `alvo` (ou um apelido equivalente)? (compara por token, ignorando a ordem). */
export const temEscopo = (escopoGuardado: unknown, alvo: string): boolean => {
  if (typeof escopoGuardado !== "string") return false;
  const tokens = escopoGuardado.split(/\s+/);
  return (ALIASES_ESCOPO[alvo] ?? [alvo]).some((e) => tokens.includes(e));
};
/** Todos os escopos de `alvos` estão no guardado? (para "precisa reconectar"). */
export const temTodosEscopos = (escopoGuardado: unknown, alvos: readonly string[]): boolean => alvos.every((a) => temEscopo(escopoGuardado, a));

/**
 * Conta Google geral (login + Gmail + Agenda + Sheets + Drive): escopos da decisão do usuário.
 * `drive.file` entrou em 23/10 para a cópia diária do CRM e do financeiro no Drive do dono: é o escopo mínimo que
 * permite gravar, e o app só enxerga o que ele mesmo criou. Quem conectou antes disso aparece como
 * "precisa reconectar" até autorizar uma vez; sem ele a cópia não sobe.
 */
export const ESCOPOS_CONTA = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  ESCOPO_DRIVE,
] as const;

/**
 * Perfil do id_token. `foto` e a URL que o Google devolveu (preservada como veio); `fotoLocal` e essa imagem ja
 * baixada como data URL, porque a tela roda com CSP `img-src 'self' data:` e nao busca nada no Google.
 */
export interface PerfilGoogle { sub: string; email: string | null; emailVerificado: boolean; nome: string | null; foto: string | null; fotoLocal: string | null }
/** Payload do id_token (JWT) do Google. Não verifica a assinatura: o token veio direto do endpoint oficial por HTTPS. */
export function parseIdToken(idToken: unknown): PerfilGoogle | null {
  if (typeof idToken !== "string") return null;
  const partes = idToken.split(".");
  if (partes.length !== 3) return null;
  try {
    const p = JSON.parse(Buffer.from(partes[1] as string, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof p["sub"] !== "string") return null;
    return { sub: p["sub"], email: typeof p["email"] === "string" ? p["email"] : null, emailVerificado: p["email_verified"] === true, nome: typeof p["name"] === "string" ? p["name"] : null, foto: typeof p["picture"] === "string" ? p["picture"] : null, fotoLocal: null };
  } catch { return null; }
}
export const URL_AUTORIZACAO = "https://accounts.google.com/o/oauth2/v2/auth";
export const URL_TOKEN = "https://oauth2.googleapis.com/token";
export const CAMPOS_PESSOA = "names,emailAddresses,phoneNumbers,organizations,urls,biographies,metadata";

export interface ClienteOAuth { clientId: string; clientSecret: string }
/** O JSON que o Google Cloud baixa ("installed": {client_id, client_secret}) ou o formato simples. null se inválido. */
export function parseClienteOAuth(v: unknown): ClienteOAuth | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const base = (typeof o["installed"] === "object" && o["installed"] !== null ? o["installed"] : o) as Record<string, unknown>;
  const id = base["client_id"] ?? base["clientId"]; const sec = base["client_secret"] ?? base["clientSecret"];
  if (typeof id !== "string" || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id) || typeof sec !== "string" || sec.length < 8) return null;
  return { clientId: id, clientSecret: sec };
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
export function urlDeAutorizacao(o: { clientId: string; redirect: string; challenge: string; state: string; scope?: string }): string {
  const p = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirect, response_type: "code", scope: o.scope ?? ESCOPOS.join(" "), code_challenge: o.challenge, code_challenge_method: "S256", state: o.state, access_type: "offline", prompt: "consent" });
  return `${URL_AUTORIZACAO}?${p.toString()}`;
}
/** E-mail principal do `people/me` (pode não vir só com contacts.readonly: aí a página mostra só "conectado"). */
export function emailDePessoaEu(p: unknown): string | null {
  const es = p !== null && typeof p === "object" ? (p as { emailAddresses?: { value?: unknown; metadata?: { primary?: unknown } }[] }).emailAddresses : undefined;
  if (!Array.isArray(es)) return null;
  const e = es.find((x) => x.metadata?.primary === true) ?? es[0];
  return typeof e?.value === "string" ? e.value : null;
}

export interface ContatoGoogle { nome: string; emails: string[]; telefones: string[]; cargo: string; empresa: string; notas: string; instagram: string; linkedin: string; googleId: string }
interface Valor { value?: unknown; canonicalForm?: unknown; displayName?: unknown; name?: unknown; title?: unknown; metadata?: { primary?: unknown } }
const lista = (v: unknown): Valor[] => (Array.isArray(v) ? (v as Valor[]) : []);
const txt = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const primeiroPrincipal = (vs: Valor[]): Valor | undefined => vs.find((x) => x.metadata?.primary === true) ?? vs[0];
/** instagram.com/fulano, @fulano… → "fulano"; linkedin.com/in/fulano → a URL. */
function redes(urls: Valor[]): { instagram: string; linkedin: string } {
  let instagram = ""; let linkedin = "";
  for (const u of urls) {
    const v = txt(u.value);
    const ig = /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(v); if (ig && instagram === "") instagram = ig[1] as string;
    if (/linkedin\.com\//i.test(v) && linkedin === "") linkedin = v;
  }
  return { instagram, linkedin };
}
/** Uma pessoa da API People → contato para importar; null se não tem nome, e-mail nem telefone. */
export function pessoaParaContato(p: unknown): ContatoGoogle | null {
  if (p === null || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const googleId = txt(o["resourceName"]); if (!/^people\/[A-Za-z0-9_-]{1,80}$/.test(googleId)) return null;
  const nome = txt(primeiroPrincipal(lista(o["names"]))?.displayName);
  const emails = [...new Set(lista(o["emailAddresses"]).map((e) => txt(e.value).toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  const telefones = [...new Set(lista(o["phoneNumbers"]).map((t) => txt(t.canonicalForm) || txt(t.value)).filter((t) => t.replace(/\D/g, "").length >= 8))];
  if (nome === "" && emails.length === 0 && telefones.length === 0) return null;
  const org = primeiroPrincipal(lista(o["organizations"]));
  return { nome, emails, telefones, cargo: txt(org?.title), empresa: txt(org?.name), notas: txt(primeiroPrincipal(lista(o["biographies"]))?.value).slice(0, 2000), ...redes(lista(o["urls"])), googleId };
}

// ---- WhatsApp → Google Contatos ---------------------------------------------------------------------------------
export interface ContatoWhatsapp { telefone: string; nome: string }
/** Os 10 últimos dígitos: o mesmo número com ou sem +55/DDI casa (o Google guarda do jeito que foi digitado). */
export const chaveTelefone = (t: string): string => t.replace(/\D/g, "").slice(-10);
/** Números do WhatsApp que o Google ainda não tem (nem foram criados por nós antes), sem repetir. */
export function faltantesNoGoogle(wa: ContatoWhatsapp[], telefonesGoogle: string[], jaCriados: string[]): ContatoWhatsapp[] {
  const tem = new Set([...telefonesGoogle, ...jaCriados].map(chaveTelefone).filter((k) => k.length >= 8));
  const out: ContatoWhatsapp[] = [];
  for (const c of wa) { const k = chaveTelefone(c.telefone); if (k.length < 8 || tem.has(k)) continue; tem.add(k); out.push(c); }
  return out;
}
/** Pessoa para o people:batchCreateContacts: nome do WhatsApp (ou "WhatsApp +N"), celular e o marcador. */
export function pessoaDoWhatsapp(c: ContatoWhatsapp, grupo: string | null): Record<string, unknown> {
  return {
    names: [{ givenName: c.nome.trim() !== "" ? c.nome.trim() : `WhatsApp ${c.telefone}` }],
    phoneNumbers: [{ value: c.telefone, type: "mobile" }],
    ...(grupo ? { memberships: [{ contactGroupMembership: { contactGroupResourceName: grupo } }] } : {}),
  };
}

/** Nome seguro para pasta/arquivo do Drive: sem barra nem controle, espaços colapsados, até 80 caracteres. */
const nomeDrive = (s: string): string => s.replace(/[\/\\\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "sem nome";
/**
 * Onde a conversa fica no Drive: uma pasta por máquina (o alias SSH, estável; o apelido da tela pode mudar), uma por
 * contato (nome + número, para o mesmo contato cair sempre na mesma pasta) e o arquivo com data e hora da última mensagem.
 */
export function caminhoNoDrive(maquina: string, nome: string, numero: string, ultimaEm: number): { pastas: string[]; arquivo: string } {
  const n = numero.replace(/\D/g, "");
  const quem = nome.replace(/\D/g, "") === n || nome.trim() === "" ? `+${n}` : `${nomeDrive(nome)} (+${n})`;
  const d = new Date(ultimaEm > 0 ? ultimaEm : Date.now());
  const p = (x: number): string => String(x).padStart(2, "0");
  const quando = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return { pastas: ["meu-bot", nomeDrive(maquina), "WhatsApp", quem], arquivo: `conversa-whatsapp-${quando}.md` };
}
/** Escapa aspas e barras num literal de consulta do Drive, como a API pede. */
const escDrive = (s: string): string => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
/** Busca do Drive por nome exato de pasta dentro de outra. */
export function consultaPasta(nome: string, pai: string): string {
  return `name = '${escDrive(nome)}' and mimeType = 'application/vnd.google-apps.folder' and '${escDrive(pai)}' in parents and trashed = false`;
}
/** Tudo o que está dentro de uma pasta (para decidir o que apagar sem adivinhar nomes na consulta). */
export function consultaFilhos(pai: string): string {
  return `'${escDrive(pai)}' in parents and trashed = false`;
}
/**
 * Corpo multipart/related do upload com conteúdo binário. O `.tar.gz` do CRM não sobrevive a uma volta por
 * string, então o corpo é montado em bytes; o caminho de texto (abaixo) é o mesmo código com UTF-8.
 */
export function corpoUploadBinario(meta: Record<string, unknown>, dados: Buffer, fronteira: string, tipo: string): Buffer {
  return Buffer.concat([
    Buffer.from(`--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${fronteira}\r\nContent-Type: ${tipo}\r\n\r\n`, "utf8"),
    dados,
    Buffer.from(`\r\n--${fronteira}--`, "utf8"),
  ]);
}
/** Corpo multipart/related do upload (metadados JSON + conteúdo de texto). */
export function corpoUpload(meta: Record<string, unknown>, conteudo: string, fronteira: string): string {
  return corpoUploadBinario(meta, Buffer.from(conteudo, "utf8"), fronteira, "text/markdown; charset=UTF-8").toString("utf8");
}

/**
 * Conjunto de dados da máquina que vai para o Drive do dono. Cada um tem **pasta e prefixo próprios** no Drive
 * (meu-bot / <máquina> / <pasta> / <prefixo>-AAAA-MM-DD.tar.gz), para ficarem independentes: zerar o histórico
 * financeiro não pode encostar na cópia do CRM, e vice-versa. `dir` é relativo a ~/.local/share/meu-bot na VM.
 */
export interface ConjuntoDados {
  id: string; nome: string; pasta: string; prefixo: string;
  /** Caminhos relativos ao `$HOME` da VM. O pacote é feito com `tar -C $HOME`, então restaurar é extrair sobre o $HOME. */
  dirs: readonly string[];
  /** Padrões do `--exclude`, também relativos ao `$HOME` e **sem** `./` na frente (com `./` o tar não casa). */
  excluir: readonly string[];
  /** Carrega credencial: o pacote só sai cifrado com a senha do dono, e é pulado se não houver senha. */
  cifrar?: boolean;
}
const MB = ".local/share/meu-bot";
export const CONJUNTOS_DADOS: readonly ConjuntoDados[] = [
  // `db/backup` é a cópia diária local: não se empacota cópia dentro de cópia.
  // `autenticador.*` são segredos TOTP cifrados por uma chave que mora FORA do db/ (autenticador.js), de propósito,
  // para o backup não levá-la. Fora da máquina eles não abrem, então levá-los só somaria exposição sem utilidade.
  { id: "crm", nome: "CRM", pasta: "CRM", prefixo: "crm", dirs: [`${MB}/crm/db`], excluir: [`${MB}/crm/db/backup`, `${MB}/crm/db/autenticador.json`, `${MB}/crm/db/autenticador-uso.jsonl`] },
  { id: "financeiro", nome: "Financeiro", pasta: "Financeiro", prefixo: "financeiro", dirs: [`${MB}/finance/db`], excluir: [`${MB}/finance/db/backup`] },
  // O clone `skills-cloudflare` volta com um `git clone`; as skills escritas aqui, não.
  { id: "agente", nome: "Agente", pasta: "Agente", prefixo: "agente", dirs: [".claude/projects", ".claude/skills"], excluir: [".claude/skills/skills-cloudflare"] },
  // Os segredos do .hermes saem daqui e vão para `credenciais`: o pacote sem cifra nunca leva credencial.
  {
    id: "trabalho", nome: "Trabalho", pasta: "Trabalho", prefixo: "trabalho",
    dirs: [
      ".local/share/lv-dashboard-kommo", ".local/share/lv-catalogo-sites", "agent-workspace", "chat-workspace", ".hermes", ".claude.json",
      `${MB}/auditoria.jsonl`, `${MB}/objetivo.json`, `${MB}/progresso.json`, `${MB}/crm.json`, `${MB}/whatsapp-lista.json`, `${MB}/maquinas.json`,
    ],
    excluir: [".hermes/auth.json", ".hermes/*/*/.env", ".hermes/*/.env"],
  },
  // 183 dos 208 MB do .openclaw são cache, temporários e extensões que se reinstalam.
  {
    id: "credenciais", nome: "Credenciais", pasta: "Credenciais", prefixo: "credenciais", cifrar: true,
    dirs: [".openclaw", ".config/kommo", ".config/cloudflare", ".config/gh", ".hermes/auth.json", ".ssh/authorized_keys", ".config/systemd/user"],
    excluir: [".openclaw/cache", ".openclaw/tmp", ".openclaw/extensions", ".openclaw/logs"],
  },
];
/** A máquina dentro de um nome de arquivo: só letras, números, ponto, hífen e sublinhado. */
export const slugMaquina = (s: string): string => s.trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "maquina";
/**
 * Onde o pacote de um conjunto fica no Drive: uma pasta por máquina e por conjunto. A máquina entra **também no
 * nome do arquivo**, para o pacote continuar se identificando depois de baixado, fora da pasta dele.
 */
export function caminhoDadosNoDrive(maquina: string, c: ConjuntoDados, quando: number): { pastas: string[]; arquivo: string } {
  const d = new Date(quando > 0 ? quando : Date.now());
  const p = (x: number): string => String(x).padStart(2, "0");
  const data = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  // `.age` no fim deixa claro no Drive, só pelo nome, que aquele pacote não abre sem a senha.
  return { pastas: ["meu-bot", nomeDrive(maquina), c.pasta], arquivo: `${c.prefixo}-${slugMaquina(maquina)}-${data}.tar.gz${c.cifrar === true ? ".age" : ""}` };
}
/**
 * Só os pacotes que este recurso cria para esta máquina; qualquer outra coisa na pasta é de terceiro e não se apaga.
 * Casar a máquina importa: se um dia duas delas dividirem pasta, uma não apaga a cópia da outra.
 */
export const pacoteDadosRe = (prefixo: string, maquina: string): RegExp =>
  new RegExp(`^${prefixo.replace(/[^a-z]/g, "")}-${slugMaquina(maquina).replace(/[.\-]/g, "\\$&")}-\\d{4}-\\d{2}-\\d{2}\\.tar\\.gz(\\.age)?$`);
/**
 * Retenção de uma cópia só: apaga os pacotes antigos daquele conjunto, menos o que acabou de subir. Decisão
 * separada da chamada à API para ser testável e para nunca apagar por engano o que não casa com o padrão.
 */
export function pacotesDadosAApagar(arquivos: readonly { id?: unknown; name?: unknown }[], idNovo: string, prefixo: string, maquina: string): string[] {
  const re = pacoteDadosRe(prefixo, maquina);
  const ids: string[] = [];
  for (const a of arquivos) {
    if (typeof a.id !== "string" || typeof a.name !== "string") continue;
    if (a.id === idNovo || !re.test(a.name)) continue;
    ids.push(a.id);
  }
  return ids;
}

// ---- Conta Google: parse puro das respostas das APIs (testável sem rede) ---------------------------------------
export interface GmailMensagemView { id: string; de: string; assunto: string; data: string; resumo: string; naoLida: boolean }
/** Uma mensagem do Gmail (format=metadata) → view. */
export function gmailMensagemDeRaw(id: string, m: Record<string, unknown>): GmailMensagemView {
  const h = (((m["payload"] as { headers?: unknown } | undefined)?.headers) ?? []) as { name?: string; value?: string }[];
  const hv = (n: string): string => h.find((x) => (x.name ?? "").toLowerCase() === n)?.value ?? "";
  const labels = Array.isArray(m["labelIds"]) ? (m["labelIds"] as unknown[]).map(String) : [];
  return { id, de: hv("from"), assunto: hv("subject") || "(sem assunto)", data: hv("date"), resumo: typeof m["snippet"] === "string" ? m["snippet"] : "", naoLida: labels.includes("UNREAD") };
}
export interface AgendaEventoView { id: string; titulo: string; inicio: string; fim: string; local: string; link: string }
/** Um evento do Calendar → view (dateTime, ou date para o dia inteiro). */
export function agendaEventoDeRaw(e: Record<string, unknown>): AgendaEventoView {
  const dt = (v: unknown): string => { const o = v as { dateTime?: unknown; date?: unknown } | undefined; return typeof o?.dateTime === "string" ? o.dateTime : typeof o?.date === "string" ? o.date : ""; };
  return { id: String(e["id"] ?? ""), titulo: typeof e["summary"] === "string" ? e["summary"] : "(sem título)", inicio: dt(e["start"]), fim: dt(e["end"]), local: typeof e["location"] === "string" ? e["location"] : "", link: typeof e["htmlLink"] === "string" ? e["htmlLink"] : "" };
}
/** `values` da Sheets → matriz de strings (células ausentes viram ""). */
export function planilhaValoresDeRaw(j: Record<string, unknown>): string[][] {
  return Array.isArray(j["values"]) ? (j["values"] as unknown[]).map((l) => (Array.isArray(l) ? l.map((c) => String(c ?? "")) : [])) : [];
}
