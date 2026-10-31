/**
 * Claude Code Global (parte pura): os scripts que o admin roda como root na máquina. O intermediário
 * (backend-colima/claude-global.js) serve a assinatura do root a todos os usuários; aqui ficam o estado para a tela,
 * ligar/desligar o global por usuário (a chave dele) e as contas do rodízio do root. O token do root nunca sai do
 * /root/.claude: cada usuário recebe só a chave dele, que só abre o intermediário desta máquina.
 */
import type { CgEstado } from "../../shared/ipc";
import { NOME_USUARIO_RE } from "./usuarios-core";

export const CG_DIR = "/opt/meu-bot-claude-global";
export const CG_ETC = "/etc/meu-bot/claude-global";
export const CG_SERVICO = "meu-bot-claude-global";

/** Node da máquina para os scripts do root (o do Hermes global primeiro, como o instalador). */
const NODE_SH = `NODE=""; for n in /opt/hermes/node/bin/node "$(command -v node 2>/dev/null)" /usr/bin/node /usr/local/bin/node; do [ -n "$n" ] && [ -x "$n" ] && { NODE=$n; break; }; done`;

/**
 * Estado para a tela, em uma linha `ESTADO=<json>`: instalado e no ar, porta, conta do root (e-mail e plano), as
 * contas do rodízio do root com o uso de cada uma e os usuários da máquina com o global ligado ou não e quanto usaram.
 */
export const CG_ESTADO_SH = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
${NODE_SH}
INST=0; [ -f /etc/systemd/system/${CG_SERVICO}.service ] && [ -f ${CG_DIR}/claude-global.js ] && INST=1
ATIVO=0; systemctl is-active --quiet ${CG_SERVICO} 2>/dev/null && ATIVO=1
CONTAS="{}"
if [ "$INST" = 1 ] && [ -n "$NODE" ]; then
  CONTAS=$(cd /tmp && HOME=/root timeout 40 "$NODE" -e '
const st = require("${CG_DIR}/account-status.js"); const cc = require("${CG_DIR}/contas-claude.js");
const reg = cc.abrir();
(async () => {
  const l = reg.listar();
  for (const c of l.contas) { try { await st.refreshRateLimits({ configDir: c.home }); const s = st.readClaudeStatus("/root", c.home); c.sessaoPct = s.sessionPct; c.semanalPct = s.weeklyPct; } catch (_) { /* sem uso */ } }
  process.stdout.write(JSON.stringify({ limiares: l.limiares, contas: l.contas.map((c) => ({ id: c.id, rotulo: c.rotulo, email: c.email, logada: c.logada, ativa: c.ativa, estado: c.uso.estado, motivo: c.uso.motivo, ate: c.uso.ate, sessaoPct: c.sessaoPct ?? (c.uso.sessao ? c.uso.sessao.pct : null), semanalPct: c.semanalPct ?? (c.uso.semanal ? c.uso.semanal.pct : null) })) }));
})().catch(() => process.stdout.write("{}"));' 2>/dev/null) || CONTAS="{}"
  [ -n "$CONTAS" ] || CONTAS="{}"
fi
INST=$INST ATIVO=$ATIVO CONTAS="$CONTAS" python3 -c '
import json, os, pwd
etc = "${CG_ETC}"
def ler(f, d):
    try: return json.load(open(f))
    except Exception: return d
cfg = ler(etc + "/config.json", {})
cj = ler("/root/.claude.json", {}).get("oauthAccount") or {}
cred = (ler("/root/.claude/.credentials.json", {}).get("claudeAiOauth") or {})
uso = ler(etc + "/uso.json", {})
usuarios = []
for p in pwd.getpwall():
    if p.pw_uid < 1000 or p.pw_uid >= 60000 or p.pw_shell.endswith(("nologin", "false")): continue
    u = uso.get(p.pw_name, {})
    usuarios.append({"nome": p.pw_name, "ligado": os.path.isfile(os.path.join(etc, "chaves", p.pw_name)), "chamadas": u.get("chamadas", 0), "ultima": u.get("ultima"), "limites": u.get("limites", 0)})
usuarios.sort(key=lambda x: x["nome"])
try: rod = json.loads(os.environ.get("CONTAS") or "{}")
except Exception: rod = {}
contas = rod.get("contas", []) if isinstance(rod, dict) else []
limiares = rod.get("limiares") if isinstance(rod, dict) else None
print("ESTADO=" + json.dumps({
    "instalado": os.environ.get("INST") == "1", "ativo": os.environ.get("ATIVO") == "1", "porta": cfg.get("porta"),
    "login": bool(cj) and bool(cred.get("refreshToken")), "email": cj.get("emailAddress"),
    "plano": " · ".join(x for x in [cred.get("subscriptionType"), cred.get("rateLimitTier")] if x) or None,
    "contas": contas, "limiares": limiares, "usuarios": usuarios}))
'`;

const nomeOk = (nome: string): string => { if (!NOME_USUARIO_RE.test(nome)) throw new Error("nome de usuário inválido"); return nome; };

/**
 * Liga o global para o usuário: uma chave nova (a antiga deixa de valer), guardada em ${CG_ETC}/chaves/<nome> (root
 * 600) e entregue só a ele em ~/.local/share/meu-bot/claude-global.json (dono ele, 0600) com o endereço do
 * intermediário e o e-mail da conta do root, para a tela dele mostrar. Saída `GLOBAL=ok`.
 */
export function cgLigarSh(nome: string): string {
  const n = nomeOk(nome);
  return `set -e; umask 077
[ "$(id -u)" = 0 ] || { echo "ERRO=só o root liga o Claude Code Global"; exit 0; }
P=$(python3 -c 'import json; print(int(json.load(open("${CG_ETC}/config.json"))["porta"]))' 2>/dev/null) || { echo "ERRO=o Claude Code Global ainda não está instalado nesta máquina"; exit 0; }
H=$(getent passwd ${n} | cut -d: -f6); [ -n "$H" ] && [ -d "$H" ] || { echo "ERRO=usuário ${n} não existe"; exit 0; }
K=$(head -c 96 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 48)
[ \${#K} -ge 32 ] || { echo "ERRO=não consegui gerar a chave"; exit 0; }
mkdir -p ${CG_ETC}/chaves; printf '%s' "$K" > ${CG_ETC}/chaves/${n}.tmp; mv ${CG_ETC}/chaves/${n}.tmp ${CG_ETC}/chaves/${n}; chmod 600 ${CG_ETC}/chaves/${n}
A="$H/.local/share/meu-bot/claude-global.json"
J=$(K="$K" P="$P" python3 -c '
import json, os
e = (json.load(open("/root/.claude.json")).get("oauthAccount") or {}).get("emailAddress") if os.path.exists("/root/.claude.json") else None
print(json.dumps({"url": "http://127.0.0.1:%s" % os.environ["P"], "chave": os.environ["K"], "email": e}))
')
# Dentro do home quem grava é o usuário, nunca o root: um symlink plantado ali (claude-global.json.tmp → /etc/shadow)
# faria o root truncar o alvo e entregá-lo ao usuário. Como o usuário, o link só leva aonde ele já escrevia; umask 077 dá o 0600.
printf '%s' "$J" | runuser -u ${n} -- sh -c 'umask 077; mkdir -p "$(dirname "$1")" && cat > "$1.tmp" && mv -f "$1.tmp" "$1"' sh "$A"
echo "GLOBAL=ok"`;
}

/** Desliga o global para o usuário: a chave some dos dois lados e o intermediário passa a recusar. Saída `GLOBAL=desligado`. */
export function cgDesligarSh(nome: string): string {
  const n = nomeOk(nome);
  return `[ "$(id -u)" = 0 ] || { echo "ERRO=só o root desliga o Claude Code Global"; exit 0; }
rm -f ${CG_ETC}/chaves/${n}
H=$(getent passwd ${n} | cut -d: -f6); [ -n "$H" ] && runuser -u ${n} -- rm -f "$H/.local/share/meu-bot/claude-global.json"
echo "GLOBAL=desligado"`;
}

/**
 * Conta nova no rodízio do root: cria a pasta isolada pelo registro (o mesmo do tutorial 2) e imprime
 * `CONTA=<id> <home>` para o admin abrir o login nela.
 */
export const CG_CONTA_NOVA_SH = `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
${NODE_SH}
cd /tmp && HOME=/root "$NODE" -e 'const c = require("${CG_DIR}/contas-claude.js").abrir().criar(""); console.log("CONTA=" + c.id + " " + c.home)'`;

/** Limiares do rodízio do root (os mesmos do tutorial 2): troca ao passar de sessão %/semana %, e qual vai primeiro. Saída `LIMIARES=ok`. */
export function cgLimiaresSh(t: { sessao?: unknown; semanal?: unknown; estrategia?: unknown }): string {
  const p: Record<string, unknown> = {};
  for (const k of ["sessao", "semanal"] as const) { const n = Number(t[k]); if (t[k] !== undefined) { if (!Number.isInteger(n) || n < 50 || n > 100) throw new Error("limiar: um número inteiro de 50 a 100"); p[k] = n; } }
  if (t.estrategia !== undefined) { if (t.estrategia !== "ordem" && t.estrategia !== "folga") throw new Error("estratégia inválida"); p.estrategia = t.estrategia; }
  return `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
${NODE_SH}
cd /tmp && HOME=/root "$NODE" -e 'require("${CG_DIR}/contas-claude.js").abrir().definirLimiares(${JSON.stringify(p)}); console.log("LIMIARES=ok")'`;
}

/**
 * Mexe numa conta do rodízio do root, como o tutorial 2 faz numa conta da pessoa: `ordem` (ids das contas isoladas
 * na ordem nova; o login do root fica sempre por último), `ativa` (ligar/desligar no rodízio, sem sair) ou `conferir`
 * (relê login, e-mail e uso). Saída `CONTA=ok`.
 */
export function cgContaEditarSh(p: { ordem?: unknown; id?: unknown; ativa?: unknown; conferir?: unknown }): string {
  const ID = /^(padrao|c-[a-f0-9]{8})$/;
  let js: string;
  if (Array.isArray(p.ordem)) {
    const ids = p.ordem.map(String);
    if (ids.length > 12 || !ids.every((i) => /^c-[a-f0-9]{8}$/.test(i))) throw new Error("ordem inválida");
    js = `r.reordenar(${JSON.stringify(ids)})`;
  } else if (typeof p.id === "string" && ID.test(p.id) && typeof p.ativa === "boolean") js = `r.atualizar(${JSON.stringify(p.id)}, { ativa: ${p.ativa} })`;
  else if (typeof p.id === "string" && ID.test(p.id) && p.conferir === true) js = `r.conferir(${JSON.stringify(p.id)})`;
  else throw new Error("pedido inválido");
  return `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
${NODE_SH}
cd /tmp && HOME=/root "$NODE" -e 'const r = require("${CG_DIR}/contas-claude.js").abrir(); ${js}; console.log("CONTA=ok")'`;
}

/** Remove uma conta do rodízio do root (a padrão, o login do root, não sai). Saída `REMOVIDA=ok`. */
export function cgContaRemoverSh(id: string): string {
  if (!/^c-[a-f0-9]{8}$/.test(id)) throw new Error("conta inválida");
  return `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
${NODE_SH}
cd /tmp && HOME=/root "$NODE" -e 'require("${CG_DIR}/contas-claude.js").abrir().remover("${id}"); console.log("REMOVIDA=ok")'`;
}

/** "Usar agora": tira a conta do root de `esgotada` (o limite voltou antes do previsto). Saída `USAR=ok`. */
export function cgContaUsarAgoraSh(id: string): string {
  if (!/^(padrao|c-[a-f0-9]{8})$/.test(id)) throw new Error("conta inválida");
  return `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
${NODE_SH}
cd /tmp && HOME=/root "$NODE" -e 'const r = require("${CG_DIR}/contas-claude.js").abrir(); r.usarAgora("${id}"); r.conferir("${id}"); console.log("USAR=ok")'`;
}


/** Lê a linha `ESTADO=` (null se o script não respondeu ou não é root). */
export function lerEstado(out: string): CgEstado | null {
  const m = /^ESTADO=(.*)$/m.exec(out);
  if (m === null) return null;
  try {
    const v = JSON.parse(m[1]!) as Partial<CgEstado>;
    return {
      instalado: v.instalado === true, ativo: v.ativo === true, porta: typeof v.porta === "number" ? v.porta : null,
      login: v.login === true, email: typeof v.email === "string" ? v.email : null, plano: typeof v.plano === "string" ? v.plano : null,
      limiares: v.limiares !== null && typeof v.limiares === "object" ? v.limiares : null,
      contas: Array.isArray(v.contas) ? v.contas : [], usuarios: Array.isArray(v.usuarios) ? v.usuarios.filter((u) => NOME_USUARIO_RE.test(String(u?.nome))) : [],
    };
  } catch { return null; }
}
