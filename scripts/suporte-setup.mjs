// Prepara o suporte (meu-bot-admin), uma vez, no Mac do admin. Idempotente: pode rodar de novo.
//   1. ~/.ssh/meu-bot-admin: a chave com que o admin entra nas máquinas das pessoas (a pública vai no .dmg
//      delas e só entra no authorized_keys quando a pessoa liga "Permitir suporte").
//   2. build/suporte/entrega: chave SÓ DE ENTREGA (vai inteira no .dmg das pessoas). Na máquina do admin ela
//      fica presa a um comando forçado que só grava um código na caixa de entrada.
//   3. Instala a caixa de entrada (backend-colima/meu-bot-suporte-inbox) na máquina do admin e a linha
//      restrict,command=… no authorized_keys de lá.
//   4. build/suporte/suporte.json: o que o .dmg das pessoas leva (nome do admin, pública do admin, endereço e
//      chave do servidor da caixa).
// Uso: node scripts/suporte-setup.mjs [--caixa agente-box] [--nome Lucas]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const root = resolve(import.meta.dirname, "..");
const caixa = arg("--caixa", "agente-box");
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
const inbox = readFileSync(join(root, "backend-colima", "meu-bot-suporte-inbox"), "utf8");
ssh('mkdir -p "$HOME/.local/bin" && cat > "$HOME/.local/bin/meu-bot-suporte-inbox" && chmod 755 "$HOME/.local/bin/meu-bot-suporte-inbox"', inbox);
// A linha da entrega: tira a anterior (comentário meu-bot-entrega) e põe a atual; o resto fica.
ssh(`set -e; umask 077; mkdir -p "$HOME/.ssh"; AK="$HOME/.ssh/authorized_keys"; touch "$AK"
grep -v ' meu-bot-entrega$' "$AK" > "$AK.meu-bot.tmp" || true
printf '%s\\n' "restrict,command=\\"$HOME/.local/bin/meu-bot-suporte-inbox\\" ${entregaPub} meu-bot-entrega" >> "$AK.meu-bot.tmp"
chmod 600 "$AK.meu-bot.tmp"; mv "$AK.meu-bot.tmp" "$AK"`);

step("lendo endereço e chave do servidor da caixa");
const g = new Map(run("ssh", ["-G", caixa]).split("\n").map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), l.slice(i + 1)]; }));
const hostKey = ssh("cat /etc/ssh/ssh_host_ed25519_key.pub").trim().split(" ").slice(0, 2).join(" ");
const cfg = {
  admin: nome,
  adminKey: readFileSync(`${adminKey}.pub`, "utf8").trim().split(" ").slice(0, 2).join(" "),
  // alias: como o admin chega na caixa pelo SSH dele (o meu-bot-admin lê a caixa por aqui).
  inbox: { alias: caixa, hostname: g.get("hostname"), user: g.get("user"), port: Number(g.get("port") || 22), hostKey },
};
writeFileSync(join(dir, "suporte.json"), `${JSON.stringify(cfg, null, 2)}\n`);
// known_hosts da caixa pelo alias fixo: o meu-bot das pessoas confere a chave do servidor (nada de aceitar às cegas).
writeFileSync(join(dir, "known_hosts"), `meu-bot-caixa ${hostKey}\n`);

step("testando a entrega (precisa ser recusada sem código válido)");
let refused = false;
try {
  run("ssh", ["-i", entrega, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", `HostKeyAlias=meu-bot-caixa`, "-o", `UserKnownHostsFile=${join(dir, "known_hosts")}`, "-o", "StrictHostKeyChecking=yes",
    "-p", String(cfg.inbox.port), `${cfg.inbox.user}@${cfg.inbox.hostname}`, "id"], "isso não é código\n");
} catch { refused = true; }
if (!refused) throw new Error("a chave de entrega rodou um comando: a linha restrict,command não pegou");
console.log(`✓ suporte pronto: admin "${nome}", caixa em ${caixa} (${cfg.inbox.user}@${cfg.inbox.hostname}:${cfg.inbox.port})`);
console.log("  Agora: npm run dmg -- --suporte (para as pessoas) e npm run dmg:admin (para você).");
