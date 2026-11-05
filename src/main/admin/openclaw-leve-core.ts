/**
 * "OpenClaw leve" (Preparar máquina e pareamento): cada gateway do OpenClaw de uma conta nasce ou fica com a heap do
 * Node limitada e só os plugins usados. Medido em 5 nov (docs/guia/maquinas.md, "Medição do OpenClaw"): o unit que o
 * `openclaw gateway install` gera passa `--max-old-space-size=<metade da RAM>` no ExecStart e zera NODE_OPTIONS, então
 * a heap só muda por um drop-in que sobrescreve o ExecStart; 43 plugins ativos viram 4 com `plugins.allow` (o
 * `memory-core` é isento). Poupa ~430 MB na largada; o gateway segue crescendo com o uso (o cgroup soma os `claude`
 * filhos), por isso o teto por box é 2 GB. Puro: só texto de script; o IO é do Preparar (preparar-admin.ts) e do
 * pareamento (whatsapp-openclaw-core.ts).
 */

export const OPENCLAW_LEVE = {
  /** Heap do Node do gateway: 768 MB bastou na VM "meu" (sem `heap out of memory` em turnos e áudio). */
  heapMb: 768,
  /** Sempre na lista: o WhatsApp e a guarda (nossa). Os provedores de modelo em uso e os nossos `meu-bot-*` entram por conta. */
  allowBase: ["whatsapp", "meu-bot-guarda"],
  /** O drop-in do systemd --user, ao lado do unit que o OpenClaw gera (sobrevive ao `gateway install --force`). */
  dropIn: "meu-bot-leve.conf",
} as const;

/**
 * A lista `plugins.allow` de uma conta, a partir do openclaw.json dela (em Python, na máquina): base + nossos
 * (`plugins.entries` que começam com meu-bot-) + os provedores de modelo referenciados (prefixo de
 * agents.defaults.model primary/fallbacks, agents.entries.*.model e as chaves de models.providers). Só grava se a lista
 * está vazia ou é nossa (tem meu-bot-guarda); lista alheia não é tocada. Imprime `allow=set <json>`, `allow=kept`,
 * `allow=alheia` ou `allow=sem-config`.
 */
export const ALLOW_PY = `import json, os, sys
f = os.path.expanduser("~/.openclaw/openclaw.json")
try: c = json.load(open(f))
except Exception: print("allow=sem-config"); sys.exit(0)
pl = c.get("plugins") or {}; cur = pl.get("allow") or []
if not isinstance(cur, list): cur = []
base = ${JSON.stringify([...OPENCLAW_LEVE.allowBase])}
nossos = [k for k in (pl.get("entries") or {}) if isinstance(k, str) and k.startswith("meu-bot-")]
provs = []
def prov(m):
    if isinstance(m, str) and "/" in m:
        p = m.split("/")[0]
        if p and p not in provs: provs.append(p)
def modelo(m):
    if isinstance(m, dict): prov(m.get("primary")); [prov(x) for x in (m.get("fallbacks") or [])]
    else: prov(m)
a = c.get("agents") or {}
modelo((a.get("defaults") or {}).get("model"))
for e in (a.get("entries") or {}).values():
    if isinstance(e, dict): modelo(e.get("model"))
for k in ((c.get("models") or {}).get("providers") or {}):
    if isinstance(k, str) and k not in provs: provs.append(k)
allow = []
for x in base + nossos + provs:
    if x not in allow: allow.append(x)
if cur and "meu-bot-guarda" not in cur: print("allow=alheia"); sys.exit(0)
if sorted(cur) == sorted(allow): print("allow=kept"); sys.exit(0)
print("allow=set " + json.dumps(allow))`;

/**
 * Função de shell para a conta corrente ($HOME): grava o drop-in com o ExecStart do unit e a heap nossa, e o
 * plugins.allow quando é nosso ou vazio. `RESTART=1` recarrega e reinicia o gateway se ele estiver de pé (o WhatsApp
 * volta em ~10 s); `RESTART=0` (pareamento) só recarrega: o drop-in vale no próximo início e o allow aplica a quente.
 * Imprime `LEVE=ok <drop-in|-> <allow>` ou `LEVE=sem-gateway`; nunca falha (o pareamento não pode parar por isto).
 */
export const OC_LEVE_ENSURE_SH = `oc_leve_ensure() {
  U=openclaw-gateway.service; D="$HOME/.config/systemd/user/$U.d"; RESTART=\${RESTART:-1}
  systemctl --user cat "$U" >/dev/null 2>&1 || { echo "LEVE=sem-gateway"; return 0; }
  EX=$(systemctl --user cat "$U" 2>/dev/null | grep '^ExecStart=' | grep -v '^ExecStart=$' | head -1)
  [ -n "$EX" ] || { echo "LEVE=sem-gateway"; return 0; }
  case "$EX" in
    *--max-old-space-size=*) EX2=$(printf '%s' "$EX" | sed -E 's/--max-old-space-size=[0-9]+/--max-old-space-size=${OPENCLAW_LEVE.heapMb}/') ;;
    *) EX2=$(printf '%s' "$EX" | sed -E 's#^ExecStart=([^ ]+)#ExecStart=\\1 --max-old-space-size=${OPENCLAW_LEVE.heapMb}#') ;;
  esac
  NOVO=$(printf '[Service]\\n# meu-bot: gateway leve (heap do Node limitada). Para voltar: apague este arquivo e rode systemctl --user daemon-reload.\\nExecStart=\\n%s' "$EX2")
  MUDOU=0; DI=-
  if [ "$(cat "$D/${OPENCLAW_LEVE.dropIn}" 2>/dev/null)" != "$NOVO" ]; then mkdir -p "$D"; printf '%s\\n' "$NOVO" > "$D/${OPENCLAW_LEVE.dropIn}"; MUDOU=1; DI=${OPENCLAW_LEVE.dropIn}; fi
  A=$(python3 - <<'PY'
${ALLOW_PY}
PY
)
  case "$A" in
    "allow=set "*) J=\${A#allow=set }; if timeout 60 openclaw config set plugins.allow "$J" --strict-json >/dev/null 2>&1; then MUDOU=1; A=allow=set; else A=allow=falhou; fi ;;
  esac
  if [ "$MUDOU" = 1 ]; then
    systemctl --user daemon-reload >/dev/null 2>&1
    if [ "$RESTART" = 1 ] && systemctl --user is-active --quiet "$U"; then systemctl --user restart "$U" >/dev/null 2>&1; fi
  fi
  echo "LEVE=ok $DI $A"
}`;

/** Estado para o Preparar (root): `OCLEVE=<gateways> <leves> <contas que faltam>` (units em /root e /home/*). */
export const OPENCLAW_LEVE_ESTADO_SH = `T=0; L=0; F=""; for h in /root /home/*; do [ -d "$h" ] || continue; [ -f "$h/.config/systemd/user/openclaw-gateway.service" ] || continue; T=$((T+1)); u=$(stat -c %U "$h" 2>/dev/null); if [ -f "$h/.config/systemd/user/openclaw-gateway.service.d/${OPENCLAW_LEVE.dropIn}" ] && python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); a=(c.get("plugins") or {}).get("allow") or []; sys.exit(0 if "meu-bot-guarda" in a else 1)' "$h/.openclaw/openclaw.json" 2>/dev/null; then L=$((L+1)); else F="$F $u"; fi; done; echo "OCLEVE=$T $L$F"`;

export interface OcLeve { total: number; leves: number; faltam: string[] }
/** `OCLEVE=…` da saída de estado; null quando a máquina não informou (saída antiga). */
export function lerOcLeve(out: string): OcLeve | null {
  const m = /^OCLEVE=(\d+) (\d+)(.*)$/m.exec(out);
  if (m === null) return null;
  return { total: Number(m[1]), leves: Number(m[2]), faltam: (m[3] ?? "").trim().split(/\s+/).filter((n) => /^[a-z_][a-z0-9_-]*$/.test(n)) };
}

/**
 * O passo do Preparar (root): roda `oc_leve_ensure` como cada conta que tem o unit (RESTART=1: os gateways de pé
 * reiniciam, o WhatsApp de cada um volta em ~10 s). Imprime `OCLEVE=ok <n> <contas>`.
 */
export function openclawLeveSh(): string {
  return `[ "$(id -u)" = 0 ] || { echo "NAOROOT"; exit 0; }
T=$(mktemp /tmp/meu-bot-leve.XXXXXX); chmod 644 "$T"
cat > "$T" <<'SH'
${OC_LEVE_ENSURE_SH}
oc_leve_ensure
SH
N=0; C=""
for h in /root /home/*; do
  [ -d "$h" ] || continue; [ -f "$h/.config/systemd/user/openclaw-gateway.service" ] || continue
  u=$(stat -c %U "$h" 2>/dev/null); [ -n "$u" ] || continue
  if [ "$u" = root ]; then R=$(RESTART=1 HOME=/root bash "$T" 2>/dev/null); else R=$(runuser -u "$u" -- env RESTART=1 HOME="$h" XDG_RUNTIME_DIR="/run/user/$(id -u "$u")" bash "$T" 2>/dev/null); fi
  case "$R" in LEVE=ok*) N=$((N+1)); C="$C $u" ;; *) echo "aviso: $u: \${R:-sem resposta}" ;; esac
done
rm -f "$T"
echo "OCLEVE=ok $N$C"`;
}
