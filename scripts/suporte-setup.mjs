// Prepara o suporte (meu-bot-admin), uma vez, no Mac do admin. Idempotente: pode rodar de novo.
//   1. ~/.ssh/meu-bot-admin: a chave com que o admin entra nas máquinas das pessoas (a pública vai no .dmg
//      delas e só entra no authorized_keys quando a pessoa liga "Permitir suporte").
//   2. build/suporte/entrega: chave SÓ DE ENTREGA (vai inteira no .dmg das pessoas). Na máquina do admin ela
//      fica presa a um comando forçado que só grava um código na caixa de entrada.
//   3. Instala a caixa de entrada (backend-colima/meu-bot-suporte-inbox) na máquina do admin e a linha
//      restrict,command=… no authorized_keys de lá.
//   4. build/suporte/suporte.json: o que o .dmg das pessoas leva (os admins, nome + pública de cada um, e o
//      endereço e a chave do servidor da caixa).
//   5. Auditoria: usuário "auditoria" na caixa (criado por --root, uma vez) com backend-colima/meu-bot-auditoria
//      (/usr/local/bin, do root) como comando forçado de cada chave: admins e pessoas só entregam linhas; o super
//      admin lê. O authorized_keys de lá é do root (ninguém por SSH o muda).
//   6. build/suporte/admins/<nome>.json: o suporte.json do meu-bot-admin de cada admin (nome, superAdmin, caixa,
//      backupDestinatario).
//   7. Backup: par age X25519 do super admin. A identidade fica só neste Mac (~/.ssh/meu-bot-backup.age, 0600; é ela
//      que abre os backups); a pública vai no app de todos os admins (qualquer um gera, só o super admin abre).
// Admins: build/suporte/admins.json ([{ nome, chave, super }]). Quem roda sem --admin é o super admin, com a
// ~/.ssh/meu-bot-admin deste Mac. Outro admin gera a chave dele no Mac dele
// (ssh-keygen -t ed25519 -C meu-bot-admin -f ~/.ssh/meu-bot-admin) e manda a pública; aqui:
//   node scripts/suporte-setup.mjs --admin "Fulano" --chave "ssh-ed25519 AAAA…"   (inclui ou troca a chave)
//   node scripts/suporte-setup.mjs --remover "Fulano"                              (tira: perde o acesso)
// Depois, refaça o .dmg das pessoas (a lista de admins vai nele) e o app do admin (./instalar.sh --admin --como Fulano).
// Uso: node scripts/suporte-setup.mjs [--caixa agente-box] [--root agente-root] [--nome Lucas]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const root = resolve(import.meta.dirname, "..");
const caixa = arg("--caixa", "agente-box");
const root_ = arg("--root", "agente-root");
const nome = arg("--nome", (() => { try { return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim() || "suporte"; } catch { return "suporte"; } })());
const run = (cmd, args, input) => execFileSync(cmd, args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
const step = (t) => console.log(`▸ ${t}`);
const ssh = (script, input) => run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", caixa, script], input);

if (!/^[A-Za-z0-9._-]+$/.test(caixa)) throw new Error("--caixa inválida");
const adminKey = join(homedir(), ".ssh", "meu-bot-admin");
if (!existsSync(adminKey)) {
  step("criando ~/.ssh/meu-bot-admin (a chave do suporte)");
  run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "meu-bot-admin", "-f", adminKey]);
}
const dir = join(root, "build", "suporte");
mkdirSync(dir, { recursive: true });
const entrega = join(dir, "entrega");
if (!existsSync(entrega)) {
  step("criando a chave de entrega (build/suporte/entrega)");
  run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "meu-bot-entrega", "-f", entrega]);
}
const entregaPub = readFileSync(`${entrega}.pub`, "utf8").trim().split(" ").slice(0, 2).join(" ");

step(`instalando a caixa de entrada em ${caixa}`);
const inboxSh = readFileSync(join(root, "backend-colima", "meu-bot-suporte-inbox"), "utf8");
ssh('mkdir -p "$HOME/.local/bin" && cat > "$HOME/.local/bin/meu-bot-suporte-inbox" && chmod 755 "$HOME/.local/bin/meu-bot-suporte-inbox"', inboxSh);
// A linha da entrega: tira a anterior (comentário meu-bot-entrega) e põe a atual; o resto fica.
ssh(`set -e; umask 077; mkdir -p "$HOME/.ssh"; AK="$HOME/.ssh/authorized_keys"; touch "$AK"
grep -v ' meu-bot-entrega$' "$AK" > "$AK.meu-bot.tmp" || true
printf '%s\\n' "restrict,command=\\"$HOME/.local/bin/meu-bot-suporte-inbox\\" ${entregaPub} meu-bot-entrega" >> "$AK.meu-bot.tmp"
chmod 600 "$AK.meu-bot.tmp"; mv "$AK.meu-bot.tmp" "$AK"`);

step("lendo endereço e chave do servidor da caixa");
const g = new Map(run("ssh", ["-G", caixa]).split("\n").map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), l.slice(i + 1)]; }));
const hostKey = ssh("cat /etc/ssh/ssh_host_ed25519_key.pub").trim().split(" ").slice(0, 2).join(" ");
// Admins: este Mac é o super admin (a chave dele); --admin/--chave inclui ou troca outro; --remover tira.
const pubDe = (s) => { const p = String(s ?? "").trim().split(/\s+/); if (p.length < 2 || !/^ssh-(ed25519|rsa)$|^ecdsa-sha2-/.test(p[0])) throw new Error("chave pública inválida"); return `${p[0]} ${p[1]}`; };
const nomeOk = (n) => { if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(n)) throw new Error(`nome de admin inválido: ${n}`); return n; };
const adminsPath = join(dir, "admins.json");
let admins = existsSync(adminsPath) ? JSON.parse(readFileSync(adminsPath, "utf8")) : [];
const eu = { nome: nomeOk(nome), chave: pubDe(readFileSync(`${adminKey}.pub`, "utf8")), super: true };
admins = [eu, ...admins.filter((a) => a.nome !== eu.nome && a.chave !== eu.chave)];
const novo = arg("--admin", null);
if (novo !== null) admins = [...admins.filter((a) => a.nome !== nomeOk(novo)), { nome: novo, chave: pubDe(arg("--chave", "")), super: false }];
const sai = arg("--remover", null);
if (sai !== null) { if (sai === eu.nome) throw new Error("o super admin não se remove"); admins = admins.filter((a) => a.nome !== sai); }
writeFileSync(adminsPath, `${JSON.stringify(admins, null, 2)}\n`);
const inbox = { alias: caixa, hostname: g.get("hostname"), user: g.get("user"), port: Number(g.get("port") || 22), hostKey };
// O .dmg das pessoas: todos os admins (cada um ganha uma linha no authorized_keys delas ao ligar o suporte).
const cfg = { admins: admins.map((a) => ({ nome: a.nome, chave: a.chave })), inbox };
writeFileSync(join(dir, "suporte.json"), `${JSON.stringify(cfg, null, 2)}\n`);
// Par de backup (age): criado uma vez; perder a identidade = perder todos os backups (guarde uma cópia offline).
const backupId = join(homedir(), ".ssh", "meu-bot-backup.age");
const age = await import("age-encryption");
if (!existsSync(backupId)) {
  step("criando ~/.ssh/meu-bot-backup.age (a chave que abre os backups; guarde uma cópia offline)");
  const id = await age.generateX25519Identity();
  writeFileSync(backupId, `# meu-bot: abre os backups completos das máquinas (meu-bot-admin do super admin)\n${id}\n`, { mode: 0o600 });
}
const backupDestinatario = await age.identityToRecipient(readFileSync(backupId, "utf8").split("\n").find((l) => l.startsWith("AGE-SECRET-KEY-")).trim());
// O app de cada admin: nome, se é super admin, o alias da caixa (o meu-bot-admin lê a caixa por aqui) e a pública de backup.
mkdirSync(join(dir, "admins"), { recursive: true });
for (const a of admins) writeFileSync(join(dir, "admins", `${a.nome}.json`), `${JSON.stringify({ admin: a.nome, superAdmin: a.super === true, backupDestinatario, inbox }, null, 2)}\n`);

step(`auditoria: usuário "auditoria" e chaves em ${root_}`);
const auditoria = readFileSync(join(root, "backend-colima", "meu-bot-auditoria"), "utf8");
const cmd = (papel, quem) => `restrict,command="/usr/local/bin/meu-bot-auditoria ${papel} ${quem.replace(/[^\w.-]+/g, "-")}"`;
const ak = [...admins.map((a) => `${cmd(a.super ? "super" : "admin", a.nome)} ${a.chave} meu-bot-auditoria:${a.nome.replace(/[^\w.-]+/g, "-")}`), `${cmd("maquina", "pessoas")} ${entregaPub} meu-bot-auditoria:entrega`].join("\n");
run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", root_, `set -e
id auditoria >/dev/null 2>&1 || useradd -m -s /bin/sh auditoria
H=/home/auditoria
install -d -o auditoria -g auditoria -m 700 "$H/registro"
chown auditoria:auditoria "$H"; chmod 711 "$H"
T=$(mktemp); cat > "$T"; install -o root -g root -m 755 "$T" /usr/local/bin/meu-bot-auditoria; rm -f "$T"
install -d -o root -g root -m 755 "$H/.ssh"
printf '%s\\n' '${ak.replace(/'/g, "")}' > "$H/.ssh/authorized_keys.tmp"
chown root:root "$H/.ssh/authorized_keys.tmp"; chmod 644 "$H/.ssh/authorized_keys.tmp"; mv "$H/.ssh/authorized_keys.tmp" "$H/.ssh/authorized_keys"
echo AUDITORIA=ok`], auditoria);
// known_hosts da caixa pelo alias fixo: o meu-bot das pessoas confere a chave do servidor (nada de aceitar às cegas).
writeFileSync(join(dir, "known_hosts"), `meu-bot-caixa ${hostKey}\n`);

step("testando a entrega (precisa ser recusada sem código válido)");
let refused = false;
try {
  run("ssh", ["-i", entrega, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", `HostKeyAlias=meu-bot-caixa`, "-o", `UserKnownHostsFile=${join(dir, "known_hosts")}`, "-o", "StrictHostKeyChecking=yes",
    "-p", String(inbox.port), `${inbox.user}@${inbox.hostname}`, "id"], "isso não é código\n");
} catch { refused = true; }
if (!refused) throw new Error("a chave de entrega rodou um comando: a linha restrict,command não pegou");
step("testando a auditoria (a chave de entrega grava, mas não lê)");
let leu = true;
try { run("ssh", ["-i", entrega, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "HostKeyAlias=meu-bot-caixa", "-o", `UserKnownHostsFile=${join(dir, "known_hosts")}`, "-o", "StrictHostKeyChecking=yes", "-p", String(inbox.port), `auditoria@${inbox.hostname}`, "maquinas"]); } catch { leu = false; }
if (leu) throw new Error("a chave de entrega leu a central de auditoria: a linha restrict,command não pegou");
console.log(`✓ suporte pronto: ${admins.length} admin(s) (${admins.map((a) => `${a.nome}${a.super ? " (super)" : ""}`).join(", ")}), caixa em ${caixa} (${inbox.user}@${inbox.hostname}:${inbox.port})`);
console.log("  Agora: npm run dmg -- --suporte (para as pessoas) e npm run dmg:admin (para você).");
