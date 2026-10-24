#!/usr/bin/env node
/**
 * abrir-backup.mjs — decifra um pacote `credenciais-*.tar.gz.age` da cópia no Drive.
 *
 * O `age` de linha de comando não vem instalado, e um backup que a pessoa não consegue abrir não é backup. Este
 * script usa a mesma biblioteca do app (dependência do projeto), então só precisa do Node.
 *
 *   node scripts/abrir-backup.mjs ~/Downloads/credenciais-agente-box-lv-2026-10-24.tar.gz.age
 *   node scripts/abrir-backup.mjs <arquivo.age> --saida /tmp/restauracao
 *
 * A senha é pedida no terminal, sem eco, e nunca vai como argumento: argumento fica no histórico do shell e no
 * `ps` de quem estiver na máquina.
 */
import fs from "node:fs";
import path from "node:path";
import { Decrypter } from "age-encryption";

function uso(msg) {
  if (msg) console.error(`erro: ${msg}\n`);
  console.error("uso: node scripts/abrir-backup.mjs <arquivo.tar.gz.age> [--saida <pasta>]");
  process.exit(msg ? 2 : 0);
}

/** Lê a senha do terminal sem eco. Sem TTY (num pipe), lê a primeira linha da entrada padrão. */
function pedirSenha(rotulo) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (d) => { buf += d; });
      process.stdin.on("end", () => resolve(buf.split("\n")[0]));
      process.stdin.on("error", reject);
      return;
    }
    process.stdout.write(rotulo);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let senha = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(senha);
      } else if (ch === "\u0003") { // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        process.exit(130);
      } else if (ch === "\u007f" || ch === "\b") {
        senha = senha.slice(0, -1);
      } else {
        senha += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) uso();

const entrada = path.resolve(args[0]);
const iSaida = args.indexOf("--saida");
const saidaDir = iSaida >= 0 ? path.resolve(args[iSaida + 1] ?? "") : path.dirname(entrada);

if (!fs.existsSync(entrada)) uso(`arquivo não encontrado: ${entrada}`);
if (!entrada.endsWith(".age")) uso("este arquivo não é cifrado (só os pacotes `credenciais-*` são); extraia direto com tar");
if (iSaida >= 0 && !args[iSaida + 1]) uso("--saida precisa de uma pasta");

const cifrado = fs.readFileSync(entrada);
if (!cifrado.subarray(0, 32).toString("latin1").startsWith("age-encryption.org/v1")) {
  uso("não parece um arquivo age; confira se o download veio inteiro");
}

const senha = await pedirSenha("Senha do backup: ");
if (senha.trim() === "") uso("sem senha não dá para abrir");

const d = new Decrypter();
d.addPassphrase(senha);
let claro;
try {
  claro = Buffer.from(await d.decrypt(new Uint8Array(cifrado)));
} catch {
  console.error("erro: senha incorreta, ou o arquivo está corrompido.");
  process.exit(1);
}

fs.mkdirSync(saidaDir, { recursive: true });
const destino = path.join(saidaDir, path.basename(entrada).replace(/\.age$/, ""));
fs.writeFileSync(destino, claro, { mode: 0o600 });

console.log(`pronto: ${destino} (${claro.length} bytes)`);
console.log("\npara ver o que tem dentro:");
console.log(`  tar -tzf ${destino} | head`);
console.log("\npara restaurar numa máquina (extrai sobre o $HOME; confira antes com o comando acima):");
console.log(`  tar -xzf ${destino} -C ~`);
console.log("\nO arquivo decifrado tem credenciais em texto claro. Apague quando terminar:");
console.log(`  rm ${destino}`);
