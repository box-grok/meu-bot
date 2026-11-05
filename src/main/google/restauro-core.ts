/**
 * Restaurar a cópia do Drive nesta máquina, a parte pura (testada em restauro-core.test.mjs): que cópias existem
 * (Drive + Mac), de que máquina e de que dia; o home antigo escondido dentro do pacote; o pré-voo do destino; e o
 * script que a VM roda com o `.tar.gz` claro no stdin. O IO (Drive, senha, ssh) fica em dados-drive.ts.
 *
 * Regras que vêm do backup completo do admin (meu-bot-backup.sh `restaurar`): nada é apagado (o que existia vai para
 * `~/.meu-bot-antes-da-restauracao-<ts>/`), caminho perigoso no pacote recusa tudo, e o home antigo vira o novo nos
 * arquivos de texto conhecidos. Novidades daqui: um conjunto por vez, o motor da máquina decide o que não entra
 * (`.hermes` numa máquina OpenClaw, `.openclaw` numa Hermes), e o WhatsApp vivo só é trocado com pedido explícito.
 */
import { CONJUNTOS_DADOS, lerTar, slugMaquina, type ConjuntoDados } from "./google-core";
import { WA_MOTOR_SH } from "../whatsapp/whatsapp-capacidades";

export type OrigemCopia = "drive" | "local" | "ambos";
/** Uma cópia de um conjunto: a mais nova daquela máquina, no Drive, no Mac, ou nos dois (mesmo nome de arquivo). */
export interface CopiaConjunto { conjunto: string; nome: string; arquivo: string; bytes: number; /** AAAA-MM-DD do nome do arquivo. */ data: string; cifrado: boolean; origem: OrigemCopia; driveId: string | null; local: string | null }
export interface CopiaMaquina { maquina: string; conjuntos: CopiaConjunto[] }
export interface ArquivoDrive { id: string; name: string; size: number }
export interface ArquivoLocal { name: string; bytes: number; caminho: string }

const NOME_PACOTE_RE = /^([a-z]+)-(.+)-(\d{4}-\d{2}-\d{2})\.tar\.gz(\.age)?$/;
/** O que o nome de um pacote diz sozinho (a máquina entra no nome de propósito: `caminhoDadosNoDrive`). */
export function parseNomePacote(name: string): { conjunto: ConjuntoDados; maquina: string; data: string; cifrado: boolean } | null {
  const m = NOME_PACOTE_RE.exec(name);
  if (m === null) return null;
  const c = CONJUNTOS_DADOS.find((x) => x.prefixo === m[1]);
  if (c === undefined) return null;
  // `.age` só nos cifrados e vice-versa: um `crm-…tar.gz` sem cifra não é nosso (ou é de antes da regra) e não entra.
  if ((m[4] !== undefined) !== (c.cifrar === true)) return null;
  return { conjunto: c, maquina: m[2] ?? "", data: m[3] ?? "", cifrado: c.cifrar === true };
}

/**
 * Drive e Mac fundidos por nome de arquivo, agrupados por máquina (pelo nome do arquivo, não pela pasta: a pasta do
 * Drive e a do Mac têm regras de nome diferentes). Um item por conjunto: o de data mais nova. A máquina `atual` vem
 * primeiro; as outras em ordem alfabética.
 */
export function copiasDeBackup(drive: readonly ArquivoDrive[], locais: readonly ArquivoLocal[], atual: string): CopiaMaquina[] {
  const porMaquina = new Map<string, Map<string, CopiaConjunto>>();
  const poe = (name: string, bytes: number, driveId: string | null, local: string | null): void => {
    const p = parseNomePacote(name);
    if (p === null) return;
    const m = porMaquina.get(p.maquina) ?? new Map<string, CopiaConjunto>();
    porMaquina.set(p.maquina, m);
    const atualC = m.get(p.conjunto.id);
    if (atualC !== undefined && atualC.arquivo === name) {
      m.set(p.conjunto.id, { ...atualC, origem: "ambos", driveId: atualC.driveId ?? driveId, local: atualC.local ?? local, bytes: atualC.bytes || bytes });
      return;
    }
    if (atualC !== undefined && atualC.data >= p.data) return;
    m.set(p.conjunto.id, { conjunto: p.conjunto.id, nome: p.conjunto.nome, arquivo: name, bytes, data: p.data, cifrado: p.cifrado, origem: driveId !== null ? "drive" : "local", driveId, local });
  };
  for (const a of drive) poe(a.name, a.size, a.id, null);
  for (const a of locais) poe(a.name, a.bytes, null, a.caminho);
  const slugAtual = slugMaquina(atual);
  const ordemConj = new Map(CONJUNTOS_DADOS.map((c, i) => [c.id, i] as const));
  return [...porMaquina.entries()]
    .sort(([a], [b]) => (a === slugAtual ? -1 : b === slugAtual ? 1 : a.localeCompare(b)))
    .map(([maquina, m]) => ({ maquina, conjuntos: [...m.values()].sort((x, y) => (ordemConj.get(x.conjunto) ?? 9) - (ordemConj.get(y.conjunto) ?? 9)) }));
}

const SUFIXOS_PROJETO = ["-agent-workspace", "-chat-workspace", "--claude-skills", "--openclaw-workspace"];
/**
 * O home da máquina de origem, lido de dentro do pacote (já descomprimido): `.claude.json` (chaves de `projects`),
 * `.openclaw/openclaw.json` (`workspace`), ou as pastas `.claude/projects/-home-<usuário>-agent-workspace`. null = não
 * dá para saber (pacote sem nenhum desses: CRM, financeiro), e aí nada é trocado.
 */
export function homeAntigoDoTar(tar: Buffer): string | null {
  const entradas = lerTar(tar);
  if (entradas === null) return null;
  const deCaminho = (p: string): string | null => { const m = /^(\/home\/[^/]+|\/root)(?=\/|$)/.exec(p); return m?.[1] ?? null; };
  const porPastas = new Set<string>();
  for (const e of entradas) {
    const nome = e.nome.replace(/^\.\//, "");
    if (nome === ".claude.json" && e.conteudo !== null) {
      try {
        const j = JSON.parse(e.conteudo.toString("utf8")) as { projects?: Record<string, unknown> };
        for (const k of Object.keys(j.projects ?? {})) { const h = deCaminho(k); if (h !== null) return h; }
      } catch { /* não é JSON: segue para as outras pistas */ }
    }
    if (nome === ".openclaw/openclaw.json" && e.conteudo !== null) {
      const m = /"(\/home\/[^/"]+|\/root)\/\.openclaw\/workspace/.exec(e.conteudo.toString("utf8"));
      if (m?.[1] !== undefined) return m[1];
    }
    const pm = /^\.claude\/projects\/(-home-[^/]+|-root(?:-[^/]*)?)(?:\/|$)/.exec(nome);
    if (pm?.[1] !== undefined) porPastas.add(pm[1]);
  }
  for (const pasta of porPastas) {
    if (pasta === "-root" || SUFIXOS_PROJETO.some((s) => pasta === `-root${s}`)) return "/root";
    for (const s of SUFIXOS_PROJETO) if (pasta.endsWith(s)) { const u = pasta.slice("-home-".length, -s.length); if (u !== "" && !u.includes("/")) return `/home/${u}`; }
  }
  return null;
}

export type MotorMaquina = "openclaw" | "hermes" | "picoclaw" | "";
/** O ledger desta máquina é dela: a cópia de outra máquina (ou de ontem) nunca passa por cima. */
const NUNCA_RESTAURA = [".local/share/meu-bot/auditoria.jsonl"];
/** O que não entra nesta máquina por causa do motor dela: o Hermes numa máquina OpenClaw é lixo, e vice-versa. */
export function exclusoesPorMotor(motor: MotorMaquina): string[] {
  if (motor === "openclaw" || motor === "picoclaw") return [".hermes"];
  if (motor === "hermes") return [".openclaw"];
  return [];
}
/** Os caminhos do conjunto que entram mesmo nesta máquina (os `dirs` menos o que o motor e a regra fixa barram). */
export function caminhosDoConjunto(c: ConjuntoDados, motor: MotorMaquina): string[] {
  const ex = [...exclusoesPorMotor(motor), ...NUNCA_RESTAURA];
  return c.dirs.filter((d) => !ex.some((e) => d === e || d.startsWith(`${e}/`)));
}
/** Serviços que param durante a extração (e voltam no fim, aconteça o que acontecer). */
export function servicosDoConjunto(c: Pick<ConjuntoDados, "id">): string[] {
  if (c.id === "credenciais") return ["openclaw-gateway", "meu-bot-backend"];
  if (c.id === "agente") return [];
  return ["meu-bot-backend"];
}

const q = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
/** O `conferir` do destino, CHAVE=valor: motor, espaço, WhatsApp pareado, unidades. */
export const CONFERIR_RESTAURO_SH = `${WA_MOTOR_SH}; echo "MOTOR=$MOTOR"; echo "LIVRE_MB=$(df -Pm "$HOME" | awk 'NR==2{print $4}')"; ` +
  `if [ -s "$HOME/.openclaw/credentials/whatsapp/default/creds.json" ] || [ -d "$HOME/.hermes/whatsapp/session" ]; then echo WHATSAPP_PAREADO=1; else echo WHATSAPP_PAREADO=0; fi; ` +
  `systemctl --user cat meu-bot-backend >/dev/null 2>&1 && echo BACKEND_UNIT=1 || echo BACKEND_UNIT=0; echo "GATEWAY=$(systemctl --user is-active openclaw-gateway 2>/dev/null || true)"; echo "HOME=$HOME"`;
export interface ConferenciaRestauro { motor: MotorMaquina; livreMb: number; whatsappPareado: boolean; backendUnit: boolean; gateway: string; home: string }
export function parseConferirRestauro(stdout: string): ConferenciaRestauro {
  const kv = new Map(stdout.split("\n").map((l) => { const i = l.indexOf("="); return i > 0 ? [l.slice(0, i), l.slice(i + 1).trim()] as const : ["", ""] as const; }));
  const motor = kv.get("MOTOR") ?? "";
  return { motor: motor === "openclaw" || motor === "hermes" || motor === "picoclaw" ? motor : "", livreMb: Number.parseInt(kv.get("LIVRE_MB") ?? "", 10) || 0, whatsappPareado: kv.get("WHATSAPP_PAREADO") === "1", backendUnit: kv.get("BACKEND_UNIT") === "1", gateway: kv.get("GATEWAY") ?? "", home: kv.get("HOME") ?? "" };
}
/**
 * Pode restaurar estes conjuntos aqui? Bloqueios (não dá) e avisos (dá, mas a pessoa precisa saber). Credenciais
 * com um WhatsApp já pareado só com "substituir"; espaço como no backup completo (o pacote é extraído por cima).
 */
export function decisaoRestauroDados(c: ConferenciaRestauro, escolhidos: readonly string[], bytesTotal: number, substituirWhatsapp: boolean, mesmaMaquina: boolean): { bloqueios: string[]; avisos: string[] } {
  const bloqueios: string[] = []; const avisos: string[] = [];
  if (c.home === "") bloqueios.push("a máquina não respondeu ao conferir");
  const precisaMb = Math.ceil((bytesTotal * 2.2) / (1024 * 1024)) + 200;
  if (c.livreMb > 0 && c.livreMb < precisaMb) bloqueios.push(`pouco espaço na máquina: ${c.livreMb} MB livres, precisa de uns ${precisaMb} MB`);
  if (escolhidos.includes("credenciais")) {
    if (c.whatsappPareado && !substituirWhatsapp) bloqueios.push("já há um WhatsApp pareado nesta máquina; marque \"substituir o WhatsApp desta máquina\" para trocá-lo pelo da cópia");
    else if (substituirWhatsapp) avisos.push("o WhatsApp desta máquina vai ser trocado pelo da cópia (o gateway reinicia; a máquina de origem precisa estar desligada)");
  }
  if (mesmaMaquina) avisos.push("é a cópia desta própria máquina: o que há hoje vai para a pasta de segurança e volta o de ontem");
  if (c.motor === "") avisos.push("não reconheci o motor do WhatsApp desta máquina: o pacote entra inteiro (Hermes e OpenClaw)");
  return { bloqueios, avisos };
}

export interface PedidoRestauroSh { conjunto: ConjuntoDados; motor: MotorMaquina; homeAntigo: string | null; substituirWhatsapp: boolean }
/**
 * O script que a VM roda com o `.tar.gz` claro no stdin (vai em base64 na linha do ssh, como o backup completo).
 * A cópia entra **por cima** do que há (o que a máquina tem e a cópia não tem continua lá: conversas de hoje,
 * anexos novos); cada arquivo que vai ser sobrescrito é guardado antes em `~/.meu-bot-antes-da-restauracao-<ts>/`,
 * no mesmo caminho relativo. Saída: `ANTES=<pasta>`, `GUARDADOS=<n>`, `MESCLADOS=<n>` (conversas do agente
 * juntadas num projeto que já existia), `TROCADOS=<n>` (arquivos em que o home antigo virou o novo) e
 * `BLOCOS=<n>` (arquivos de instrução em que os blocos `meu-bot:*` da máquina voltaram por cima dos da cópia) e
 * `RESTAURADO=ok`. `ANTES` sai vazio quando nada foi sobrescrito. Qualquer recusa sai com código ≠ 0 e o motivo no
 * stderr. Os serviços parados voltam pelo `trap`.
 */
export function comandoRestaurarSh(p: PedidoRestauroSh): string {
  const excl = [...exclusoesPorMotor(p.motor), ...NUNCA_RESTAURA];
  const exArgs = excl.flatMap((e) => [`--exclude=${q(e)}`, `--exclude=${q(`${e}/*`)}`]).join(" ");
  const exPy = excl.map(q).join(" ");
  const caminhos = caminhosDoConjunto(p.conjunto, p.motor).map(q).join(" ");
  const servicos = servicosDoConjunto(p.conjunto).map(q).join(" ");
  const subst = p.substituirWhatsapp ? "1" : "0";
  const conj = q(p.conjunto.id);
  const old = q(p.homeAntigo ?? "");
  return [
    "set -euo pipefail; umask 077",
    'H="$HOME"; cd "$H" || exit 3',
    `CONJ=${conj}; SUBST=${subst}; OLD=${old}`,
    "TS=$(date -u +%Y%m%dT%H%M%SZ)",
    'T="$H/.meu-bot-restauracao/$TS"; mkdir -p "$T"',
    "VOLTAR=()",
    'religar() { for s in ${VOLTAR[@]+"${VOLTAR[@]}"}; do systemctl --user start "$s" >/dev/null 2>&1 || true; done; VOLTAR=(); }',
    'trap \'religar; rm -rf "$T"\' EXIT',
    'cat > "$T/pacote.tgz"',
    '[ -s "$T/pacote.tgz" ] || { echo "recusado: pacote vazio" >&2; exit 65; }',
    'ANTES="$H/.meu-bot-antes-da-restauracao-$TS"',
    // Caminho perigoso recusa o pacote inteiro (mesma checagem do backup completo): absoluto, `..`, ou arquivo que
    // passa por um link (gravaria onde o link aponta). No mesmo passo, o que vai ser sobrescrito é guardado.
    `GUARDADOS=$(python3 - "$T/pacote.tgz" "$H" "$ANTES" ${exPy} <<'PY'`,
    "import os, shutil, sys, tarfile",
    "pacote, home, antes, *excl = sys.argv[1:]",
    "def barrado(nome):",
    '    return any(nome == e or nome.startswith(e + "/") for e in excl)',
    "links = set(); n = 0",
    'with tarfile.open(pacote, "r:gz") as tf:',
    "    for m in tf:",
    '        nome = m.name[2:] if m.name.startswith("./") else m.name',
    '        partes = nome.split("/")',
    '        if os.path.isabs(m.name) or ".." in partes or any("/".join(partes[:k]) in links for k in range(1, len(partes))):',
    '            sys.exit(f"recusado: caminho perigoso no pacote: {m.name}")',
    "        if m.issym() or m.islnk():",
    '            links.add(nome.rstrip("/"))',
    "        if barrado(nome) or not (m.isfile() or m.issym()):",
    "            continue",
    "        alvo = os.path.join(home, nome)",
    "        if os.path.lexists(alvo):",
    "            dest = os.path.join(antes, nome); os.makedirs(os.path.dirname(dest), exist_ok=True)",
    "            if os.path.islink(alvo): os.symlink(os.readlink(alvo), dest)",
    "            else: shutil.copy2(alvo, dest)",
    "            n += 1",
    "print(n)",
    "PY",
    ")",
    'if [ "$CONJ" = credenciais ] && [ "$SUBST" -ne 1 ]; then',
    '  if [ -s "$H/.openclaw/credentials/whatsapp/default/creds.json" ] || [ -d "$H/.hermes/whatsapp/session" ]; then echo "recusado: já há um WhatsApp pareado nesta máquina (marque \\"substituir o WhatsApp\\" para trocá-lo)" >&2; exit 65; fi',
    "fi",
    `for s in ${servicos}; do if systemctl --user is-active "$s" >/dev/null 2>&1; then VOLTAR+=("$s"); fi; systemctl --user stop "$s" >/dev/null 2>&1 || true; done`,
    `tar -xzf "$T/pacote.tgz" -C "$H" ${exArgs}`,
    "MESCLADOS=0; TROCADOS=0",
    'if [ -n "$OLD" ] && [ "$OLD" != "$H" ]; then',
    // Pastas de projeto do Claude Code levam o caminho no nome: `-home-box-lv-agent-workspace` vira
    // `-home-box-1-agent-workspace`; se a nova já existe (a máquina já tem conversas), as antigas entram ao lado.
    '  OLDSLUG=$(printf %s "$OLD" | tr / -); NEWSLUG=$(printf %s "$H" | tr / -)',
    '  if [ -d "$H/.claude/projects" ]; then',
    '    for d in "$H/.claude/projects/$OLDSLUG" "$H/.claude/projects/$OLDSLUG"-*; do',
    '      [ -e "$d" ] || continue; b=$(basename "$d"); novo="$H/.claude/projects/$NEWSLUG${b#"$OLDSLUG"}"',
    '      if [ -e "$novo" ]; then (cd "$d" && find . -mindepth 1 -print0 | while IFS= read -r -d \'\' f; do if [ -d "$f" ] && [ ! -L "$f" ]; then mkdir -p "$novo/$f"; elif [ ! -e "$novo/$f" ]; then mkdir -p "$novo/$(dirname "$f")"; mv "$f" "$novo/$f"; fi; done); rm -rf "$d"; MESCLADOS=$((MESCLADOS+1)); else mv "$d" "$novo"; fi',
    "    done",
    "  fi",
    // O caminho antigo vira o novo nos textos conhecidos e nos transcripts do agente (o `cwd` de cada linha).
    '  TROCADOS=$(python3 - "$OLD" "$H" "$ANTES" <<\'PY\'',
    "import glob, json, os, re, sys",
    "old, new, antes = sys.argv[1:4]",
    'padrao = re.compile(re.escape(old) + r"(?=[/\\"\'\\s:]|$)")',
    'fixos = [".claude.json", ".openclaw/openclaw.json", ".hermes/agente-rene/backend-sdk-claude/.env", ".local/share/meu-bot/backend/.env", ".local/share/meu-bot/crm.json", ".claude/settings.json"]',
    'newslug = new.replace("/", "-")',
    // As notas de memória do agente (`memory/*.md`) também citam caminhos ("a memória fica em /home/<antigo>/…"), e o
    // agente lê essas notas toda conversa: um caminho velho ali o manda procurar no lugar errado (LV, 5 nov).
    'proj = os.path.join(new, ".claude", "projects", newslug + "*")',
    'arqs = [os.path.join(new, f) for f in fixos] + glob.glob(os.path.join(proj, "**", "*.jsonl"), recursive=True) + glob.glob(os.path.join(proj, "*.jsonl")) + glob.glob(os.path.join(proj, "memory", "**", "*.md"), recursive=True)',
    "n = 0",
    "for a in dict.fromkeys(arqs):",
    "    try:",
    '        s = open(a, encoding="utf-8").read()',
    "    except (OSError, UnicodeDecodeError):",
    "        continue",
    "    t = padrao.sub(new, s)",
    "    if t != s:",
    '        open(a, "w", encoding="utf-8").write(t); n += 1',
    // `.claude.json` é da máquina (login, preferências): da cópia só entram os projetos que ela não tinha.
    'meu = os.path.join(antes, ".claude.json"); novo = os.path.join(new, ".claude.json")',
    "if os.path.exists(meu) and os.path.exists(novo):",
    "    try:",
    "        a = json.load(open(meu, encoding=\"utf-8\")); b = json.load(open(novo, encoding=\"utf-8\"))",
    '        pa = a.get("projects") if isinstance(a.get("projects"), dict) else {}',
    '        pb = b.get("projects") if isinstance(b.get("projects"), dict) else {}',
    '        a["projects"] = {**pb, **pa}',
    '        json.dump(a, open(novo, "w", encoding="utf-8"), ensure_ascii=False, indent=2)',
    "    except (OSError, ValueError):",
    "        pass",
    "print(n)",
    "PY",
    "  )",
    // Links que apontavam para dentro do home antigo passam a apontar para o mesmo lugar no novo.
    `  while IFS= read -r -d '' L; do ALVO=$(readlink "$L"); case "$ALVO" in "$OLD"/*) ln -sfn "$H\${ALVO#"$OLD"}" "$L" ;; esac; done < <(find ${caminhos === "" ? "." : caminhos} -type l -print0 2>/dev/null)`,
    "fi",
    // Os blocos `<!-- meu-bot:<nome> vN inicio/fim -->` dos arquivos de instrução são da máquina (contexto, navegador,
    // gmail…), não da cópia: o que ela tinha antes volta por cima do bloco de mesmo nome que veio no pacote.
    'BLOCOS=$(python3 - "$H" "$ANTES" <<\'PY\'',
    "import os, re, sys",
    "home, antes = sys.argv[1:3]",
    'RE = re.compile(r"<!-- meu-bot:([\\w-]+) v\\d+ inicio -->.*?<!-- meu-bot:\\1 v\\d+ fim -->\\n?", re.S)',
    "n = 0",
    'for rel in ("agent-workspace/CLAUDE.md", "chat-workspace/CLAUDE.md", ".openclaw/workspace/AGENTS.md", ".hermes/AGENTS.md"):',
    "    meu = os.path.join(antes, rel); novo = os.path.join(home, rel)",
    "    if not (os.path.isfile(meu) and os.path.isfile(novo)):",
    "        continue",
    "    try:",
    '        a = open(meu, encoding="utf-8").read(); b = open(novo, encoding="utf-8").read()',
    "    except (OSError, UnicodeDecodeError):",
    "        continue",
    "    blocos = {m.group(1): m.group(0) for m in RE.finditer(a)}",
    "    if not blocos:",
    "        continue",
    "    vistos = set()",
    "    def troca(m):",
    "        nome = m.group(1); vistos.add(nome)",
    "        return blocos.get(nome, m.group(0))",
    "    c = RE.sub(troca, b)",
    "    faltam = [t for nome, t in blocos.items() if nome not in vistos]",
    "    if faltam:",
    '        c = c.rstrip("\\n") + "\\n\\n" + "\\n".join(faltam)',
    "    if c != b:",
    '        open(novo, "w", encoding="utf-8").write(c); n += 1',
    "print(n)",
    "PY",
    ")",
    'religar',
    // Sem nada sobrescrito a pasta de segurança não existe: não se anuncia pasta fantasma.
    '[ "$GUARDADOS" -gt 0 ] || ANTES=""',
    'echo "ANTES=$ANTES"; echo "GUARDADOS=$GUARDADOS"; echo "MESCLADOS=$MESCLADOS"; echo "TROCADOS=$TROCADOS"; echo "BLOCOS=$BLOCOS"; echo "RESTAURADO=ok"',
  ].join("\n");
}

/** Linha de comando do ssh: o script em base64 (nada de aspas; o stdin é o pacote), como `remoto()` do backup completo. */
export function linhaSshRestaurar(script: string): string {
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return `bash -c "$(printf %s '${b64}' | base64 -d)" meu-bot-restaurar`;
}
