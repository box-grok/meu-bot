/**
 * Regras puras do "CRM pelo WhatsApp" (meu-bot, módulo Pro): sem rede, sem arquivos, testadas em
 * scripts/tests/crm-regras.test.mjs. Usadas pelo plugin (index.js) e pelo job (crm-job.mjs).
 */

/** Telefone E.164 da chave de sessão direta do WhatsApp (`agent:main:whatsapp[:conta]:direct:+N`), ou null. */
export function phoneOfSessionKey(key) {
  const m = /:direct:(\+?\d{6,20})$/.exec(String(key ?? ""));
  if (m === null) return null;
  return m[1].startsWith("+") ? m[1] : `+${m[1]}`;
}
export const isDirectWhatsapp = (key) => /^agent:[^:]+:whatsapp(?::[^:]+)?:direct:\+?\d+$/.test(String(key ?? ""));
/** Número só com dígitos e "+", para comparar o dono com `me.id` do creds.json ("5521923670743:19@s.whatsapp.net"). */
export function normalizePhone(v) {
  const d = String(v ?? "").replace(/@.*$/, "").replace(/:.*$/, "").replace(/[^\d]/g, "");
  return d === "" ? null : `+${d}`;
}

/**
 * Comando do dono no chat consigo mesmo. Aceita "anota no CRM: …", "anotar no crm …", "crm: …", "CRM …".
 * Devolve o texto do pedido (pode ser vazio = "anota o que der") ou null se não é comando.
 */
export function ownerCommand(text) {
  const t = String(text ?? "").trim();
  const m = /^(?:anot[ae]r?\s+(?:isso\s+)?no\s+crm|crm)\b[\s:,-]*([\s\S]*)$/i.exec(t);
  if (m === null) return null;
  return m[1].trim();
}
export const isConfirm = (text) => /^(ok|sim|confirmo|confirma|pode|aplica|aplicar|vai)(\s+crm)?[.!\s]*$/i.test(String(text ?? "").trim());
export const isReject = (text) => /^(n[ãa]o|nao|cancela|cancelar|descarta|descartar|deixa)(\s+crm)?[.!\s]*$/i.test(String(text ?? "").trim());

/** Última mensagem por sessão; `due(now, ms)` devolve as sessões em silêncio há `ms` e as esquece. */
export class SilenceTracker {
  constructor(initial = {}) { this.last = new Map(Object.entries(initial).filter(([, v]) => typeof v === "number")); }
  touch(key, at = Date.now()) { if (typeof key === "string" && key !== "") this.last.set(key, at); }
  clear(key) { this.last.delete(key); }
  due(now = Date.now(), silenceMs = 10 * 60_000) {
    const out = [];
    for (const [k, at] of this.last) if (now - at >= silenceMs) out.push(k);
    for (const k of out) this.last.delete(k);
    return out;
  }
  toJSON() { return Object.fromEntries(this.last); }
}

/**
 * Transcrição a partir do `chat.history` do OpenClaw: só o que chegou depois de `sinceTs`, papéis "contato"
 * (user com remetente) e "agente" (assistant), texto das partes; avisos de sistema e turnos sem texto ficam fora.
 */
export function threadFromHistory(history, sinceTs = 0) {
  const msgs = Array.isArray(history?.messages) ? history.messages : [];
  const out = [];
  for (const m of msgs) {
    if (m === null || typeof m !== "object") continue;
    const at = typeof m.timestamp === "number" ? m.timestamp : 0;
    if (at <= sinceTs) continue;
    const role = m.role === "user" ? "contato" : m.role === "assistant" ? "agente" : null;
    if (role === null) continue;
    const text = textOf(m.content);
    if (text === "" || /^Nota do meu-bot:/.test(text) || text === "NO_REPLY") continue;
    out.push({ role, at, text });
  }
  return out;
}
function textOf(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((p) => (p && typeof p === "object" && typeof p.text === "string" ? p.text : "")).filter(Boolean).join("\n").trim();
}
export const lastTimestamp = (thread) => thread.reduce((m, t) => (t.at > m ? t.at : m), 0);

/** O bloco ```crm-json``` da resposta do agente, validado; null se não houver. */
export function parseCrmJson(text) {
  const m = /```crm-json\s*([\s\S]*?)```/.exec(String(text ?? ""));
  if (m === null) return null;
  let j;
  try { j = JSON.parse(m[1]); } catch { return null; }
  if (j === null || typeof j !== "object" || Array.isArray(j)) return null;
  const aplicado = Array.isArray(j.aplicado) ? j.aplicado.filter((s) => typeof s === "string").slice(0, 20) : [];
  const propostas = Array.isArray(j.propostas) ? j.propostas.filter(isProposta).slice(0, 5).map((p) => ({ acao: p.acao, args: p.args.map(String), texto: String(p.texto).slice(0, 200) })) : [];
  const resumo = typeof j.resumo === "string" ? j.resumo.trim().slice(0, 900) : "";
  const resumoConversa = typeof j.resumoConversa === "string" ? j.resumoConversa.trim().slice(0, 1200) : "";
  return { aplicado, propostas, resumo, resumoConversa };
}
export const ACOES = ["box-create", "box-update", "field-set", "comment", "contact-upsert"];
const isProposta = (p) => p !== null && typeof p === "object" && ACOES.includes(p.acao) && Array.isArray(p.args) && p.args.every((a) => typeof a === "string" || typeof a === "number") && typeof p.texto === "string";

/** Texto da mensagem ao dono: o resumo e, se houver, as propostas numeradas com a instrução de confirmar. */
export function ownerMessage(contactLabel, parsed) {
  const head = `📇 CRM · ${contactLabel}`;
  const lines = [head];
  if (parsed.resumo !== "") lines.push(parsed.resumo);
  if (parsed.aplicado.length > 0) lines.push(...parsed.aplicado.map((a) => `✓ ${a}`));
  if (parsed.propostas.length > 0) {
    lines.push(parsed.propostas.length === 1 ? "Proposta:" : "Propostas:");
    parsed.propostas.forEach((p, i) => lines.push(`${i + 1}. ${p.texto}`));
    lines.push(parsed.propostas.length === 1 ? 'Responda "ok" para aplicar ou "não" para descartar.' : 'Responda "ok" para aplicar todas, "ok 2" só a 2ª, ou "não".');
  }
  return lines.join("\n");
}
/** "ok 2" → [2]; "ok" → null (todas). */
export function confirmIndex(text) {
  const m = /^(?:ok|sim|aplica|aplicar|pode)\s+(\d{1,2})\s*$/i.exec(String(text ?? "").trim());
  return m === null ? null : Number(m[1]);
}

/** Prompt do turno do agente (perfil "agente" do backend) para uma conversa. */
export function buildPrompt({ phone, contactName, pipeline, delta, command, allowCreate, streakCli, knownBox }) {
  const who = contactName ? `${contactName} (${phone})` : phone;
  const stages = (pipeline?.stages ?? []).map((s) => `  - ${s.name}`).join("\n") || "  (desconhecidas: rode `pipeline`)";
  const fields = (pipeline?.fields ?? []).map((f) => `  - ${f.name}${f.type ? ` [${f.type}]` : ""}${Array.isArray(f.options) && f.options.length > 0 ? `: ${f.options.join(" | ")}` : ""}`).join("\n") || "  (nenhum campo personalizado)";
  const conv = delta.length === 0 ? "(nenhuma mensagem nova)" : delta.map((m) => `[${new Date(m.at).toISOString().slice(0, 16).replace("T", " ")}] ${m.role === "contato" ? who : "Rene (nosso agente)"}: ${m.text}`).join("\n");
  return [
    `Você mantém o CRM do dono em dia a partir das conversas do WhatsApp. Esta tarefa é sobre o contato ${who}.`,
    `Pipeline: "${pipeline?.name ?? "?"}". Etapas:\n${stages}\nCampos:\n${fields}`,
    knownBox ? `Box já conhecido deste contato: ${knownBox.name} (chave ${knownBox.key}, etapa "${knownBox.stage ?? "?"}").` : "Ainda não sei se este contato tem box: procure com `box-find --phone` e, se não achar, por nome.",
    `Ferramenta: \`${streakCli}\` (rode com Bash; devolve JSON). Subcomandos: pipeline · box-find --phone +N | --name "x" | --query "x" · box-create --name "x" --stage "Etapa" [--notes "…"] · box-update <box> [--name] [--notes] [--stage "Etapa"] · field-set <box> "Campo" "valor" · comment <box> "texto" · contact-upsert --phone +N --name "x" [--email e] --box <box>.`,
    command !== null && command !== "" ? `Pedido do dono agora: "${command}". Dê prioridade a ele.` : command === "" ? "O dono pediu para anotar o que houver de novo." : "Gatilho: a conversa ficou em silêncio; registre o que mudou.",
    `Mensagens novas:\n${conv}`,
    [
      "Regras:",
      "- Pode fazer sozinho: `comment` com o resumo do que aconteceu (datas, pedidos, próximos passos), `contact-upsert` (telefone, nome, e-mail) e `field-set` em campos de texto/número/data quando a conversa disser claramente o valor.",
      allowCreate ? "- Criar box e mudar de etapa: pode fazer sozinho quando a conversa justificar; diga o que fez." : "- Criar box, mudar de etapa e campos de lista (dropdown): NÃO faça; proponha no bloco final e espere o dono confirmar.",
      "- Nunca invente dados; o que não está na conversa fica de fora. Não repita anotações já feitas (veja os comentários do box antes, `box-find` devolve os últimos).",
      "- Não mande mensagem a ninguém; não mexa em outros contatos.",
      "- Termine SEMPRE com um bloco:",
      "```crm-json",
      '{"aplicado":["frase curta do que você fez", "..."],"propostas":[{"acao":"box-update","args":["<boxKey>","--stage","Qualificação do perfil"],"texto":"mover Junior para Qualificação do perfil"}],"resumo":"2 linhas, em português, do que mudou","resumoConversa":"até 4 linhas sobre a conversa inteira com este contato: quem é, o que quer, em que pé está e o próximo passo"}',
      "```",
      "`acao` só pode ser box-create, box-update, field-set, comment ou contact-upsert; `args` são os argumentos exatos do subcomando. Sem propostas: `\"propostas\":[]`. Sem nada novo: `\"aplicado\":[]` e um resumo de uma linha.",
    ].join("\n"),
  ].join("\n\n");
}

/** Estado persistido do CRM: marca d'água e pendências por contato. */
export function mergeEstado(estado, phone, patch) {
  const cur = estado !== null && typeof estado === "object" ? estado : {};
  const prev = cur[phone] !== null && typeof cur[phone] === "object" ? cur[phone] : {};
  return { ...cur, [phone]: { ...prev, ...patch } };
}

/** Janela relida quando um número "sem caixa" ganha caixa (o dono vinculou o contato depois da conversa). */
export const JANELA_RECUPERAR_MS = 7 * 86_400_000;
/** Desde quando ler a conversa: a marca de sempre; mas se estava sem caixa e agora tem, os últimos 7 dias. */
export function recuperarDesde(prev, temCaixa, agora) {
  const marca = typeof prev?.marca === "number" ? prev.marca : 0;
  return prev?.semBox === true && temCaixa ? Math.min(marca, agora - JANELA_RECUPERAR_MS) : marca;
}

/**
 * O agente vai responder a um contato no WhatsApp (conversa direta, não o dono consigo mesmo)? Só aí o plugin
 * acrescenta o contexto do CRM. `ctx` = contexto do hook `before_prompt_build` do OpenClaw. Devolve o telefone ou null.
 */
export function deveInjetarContexto(ctx, dono) {
  // Nos hooks do agente, `channelId` é o id da conversa (espelha `chatId`), não o canal: o canal vem em `channel`
  // ou `messageProvider`. A chave da sessão (agent:…:whatsapp:direct:+N) já diz o resto.
  const canal = ctx?.channel ?? ctx?.messageProvider;
  if (typeof canal === "string" && canal !== "" && canal !== "whatsapp") return null;
  const key = ctx?.sessionKey;
  if (!isDirectWhatsapp(key)) return null;
  const tel = phoneOfSessionKey(key);
  return tel === null || (dono !== null && dono !== undefined && normalizePhone(tel) === normalizePhone(dono)) ? null : tel;
}

/** Aviso repetível ao dono (ex.: CRM sem pipeline padrão): no máximo um a cada 24 h. */
export const avisoDevido = (ultimoEm, agora, intervaloMs = 24 * 3_600_000) => typeof ultimoEm !== "number" || agora - ultimoEm >= intervaloMs;

/**
 * Contatos do WhatsApp (para salvar no Google Contatos): mescla um número na lista, guardando o nome quando vier
 * (o do WhatsApp da pessoa), a 1ª e a última conversa. `lista` = { "+N": { nome, primeiraEm, ultimaEm } }.
 */
export function mesclarContatoWhatsapp(lista, { telefone, nome, em }) {
  const tel = normalizePhone(telefone); if (tel === null || tel.replace(/\D/g, "").length < 10 || /0{7,}/.test(tel)) return lista; // número de teste (+5500000000001…)
  const cur = lista[tel] ?? {}; const quando = typeof em === "number" && em > 0 ? em : Date.now();
  const n = typeof nome === "string" ? nome.trim().slice(0, 120) : "";
  return { ...lista, [tel]: { ...cur, nome: n !== "" && !/^\+?\d[\d\s]*$/.test(n) ? n : cur.nome ?? "", primeiraEm: Math.min(cur.primeiraEm ?? quando, quando), ultimaEm: Math.max(cur.ultimaEm ?? 0, quando) } };
}
/** Nome que a pessoa usa no WhatsApp, das mensagens dela no `chat.history` do OpenClaw (`__openclaw.senderName`). */
export function nomeDoHistorico(history) {
  for (const m of Array.isArray(history?.messages) ? history.messages : []) {
    const n = m?.role === "user" ? m?.__openclaw?.senderName : undefined;
    if (typeof n === "string" && n.trim() !== "" && !/^\+?\d[\d\s]*$/.test(n.trim())) return n.trim();
  }
  return "";
}

// ---- classificação automática: contato sem caixa → pipeline que já existe --------------------------------------
/**
 * Pedido ao motor do chat (só texto): este contato pertence a algum dos pipelines? `pipelines` = [{ key, name,
 * stages: [nomes], exemplos: [nomes de caixas] }]; `mensagens` = [{ papel, texto }] (as últimas da conversa).
 */
export function promptClassificacao({ pipelines, nome, telefone, mensagens }) {
  return [
    "Você organiza o CRM de um pequeno negócio. Decida se este contato do WhatsApp pertence a algum dos pipelines abaixo.",
    "Use o nome do contato e o que ele disse. Só escolha um pipeline se o encaixe for claro (ex.: uma locadora de carros num pipeline de aluguel de carro). Na dúvida, nenhum.",
    "",
    "Pipelines:",
    ...pipelines.map((p) => `- key=${p.key} · "${p.name}" · etapas: ${p.stages.join(" → ")}${p.exemplos.length > 0 ? ` · já tem: ${p.exemplos.slice(0, 6).join(", ")}` : ""}`),
    "",
    `Contato: ${nome || "(sem nome)"} · ${telefone}`,
    mensagens.length > 0 ? `Últimas mensagens:\n${mensagens.slice(-30).map((m) => `[${m.papel}] ${String(m.texto).slice(0, 300)}`).join("\n")}` : "Sem mensagens.",
    "",
    'Responda SOMENTE com JSON: {"pipeline":"<key ou null>","confianca":0.0,"motivo":"uma frase curta","nome":"nome da pessoa ou empresa, se a conversa disser (senão vazio)"}',
  ].join("\n");
}
/** Resposta → { key, confianca, motivo } se escolheu um pipeline que existe com confiança ≥ `minimo`; senão null. */
export function parseClassificacao(texto, keys, minimo = 0.7) {
  const t = String(texto ?? ""); const i = t.indexOf("{"); const j = t.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  let v; try { v = JSON.parse(t.slice(i, j + 1)); } catch { return null; }
  const key = typeof v?.pipeline === "string" ? v.pipeline.trim() : "";
  const confianca = Number(v?.confianca);
  if (!keys.includes(key) || !Number.isFinite(confianca) || confianca < minimo) return null;
  return { key, confianca, motivo: typeof v.motivo === "string" ? v.motivo.trim().slice(0, 200) : "", nome: typeof v.nome === "string" ? v.nome.trim().slice(0, 120) : "" };
}

/**
 * Aviso ao dono quando as conversas não estão sendo anotadas por falta de pipeline padrão. Em português simples, com o
 * caminho no app (o erro da CLI, com `config --pipeline <key>`, é para o agente, não para a pessoa). `proprio` = CRM
 * próprio (meu-bot-crm); senão Streak (meu-bot).
 */
export function avisoSemPipeline(erro, proprio) {
  const apagado = /não existe/.test(String(erro || ""));
  if (proprio) {
    return apagado
      ? '📇 CRM: as conversas do WhatsApp não estão sendo anotadas porque o pipeline que o CRM usava foi apagado. Escolha outro no meu-bot-crm (Tutoriais › CRM no Gmail e no WhatsApp) ou me diga aqui qual usar.'
      : '📇 CRM: as conversas do WhatsApp ainda não estão sendo anotadas porque o CRM não tem um pipeline. Crie o primeiro no meu-bot-crm (Tutoriais › CRM no Gmail e no WhatsApp) ou me peça aqui: "cria um pipeline Vendas com as etapas Novo contato, Conversando, Proposta, Fechado".';
  }
  return apagado
    ? '📇 CRM: as conversas do WhatsApp não estão sendo anotadas porque o pipeline do Streak que o CRM usava não existe mais. Escolha outro no meu-bot (Tutoriais › CRM pelo WhatsApp).'
    : '📇 CRM: as conversas do WhatsApp ainda não estão sendo anotadas porque nenhum pipeline do Streak foi escolhido. Escolha um no meu-bot (Tutoriais › CRM pelo WhatsApp).';
}
