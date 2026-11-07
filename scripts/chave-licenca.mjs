// Chaves Ed25519 da LICENÇA da conta (separadas das chaves das releases, scripts/chave-release.mjs): a API da conta
// (conta-api/, Cloudflare Worker) assina cada licença emitida com a privada PRINCIPAL, e o app e o backend-colima só
// aceitam o que confere com uma das públicas embutidas (LICENCA_PUBLIC_KEYS em src/main/conta/licenca-assinada-core.ts
// e em backend-colima/licenca.js).
//
// Onde mora cada privada:
// - principal: no secret LICENCA_PRIVATE_KEY do Worker (`wrangler secret put`) e, neste Mac, no Chaveiro de login
//   (serviço meu-bot-licenca, conta principal, sem app confiável: todo uso pede a senha). Cópia no gerenciador de senhas.
// - reserva: SÓ no gerenciador de senhas. Serve para trocar de chave sem reinstalar ninguém.
//
// Regra de ouro (a mesma do chave-release): nenhuma privada vai para a saída do terminal. Só a pública aparece; a
// privada vai para o Chaveiro ou para a área de transferência, e `--limpar` a esvazia.
//
//   npm run chave-licenca -- --gerar        gera a principal → Chaveiro; imprime a pública (para LICENCA_PUBLIC_KEYS)
//   npm run chave-licenca -- --reserva      gera a reserva: privada → área de transferência, pública na tela
//   npm run chave-licenca -- --copiar       principal do Chaveiro → área de transferência (backup, `wrangler secret put`)
//   npm run chave-licenca -- --publica      imprime a pública da principal do Chaveiro
//   npm run chave-licenca -- --testar       assina uma licença de teste com a principal e confere com as públicas do app e do backend
//   npm run chave-licenca -- --limpar       esvazia a área de transferência
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const SERVICO = "meu-bot-licenca", CONTA = "principal";
const req = createRequire(import.meta.url);

/** A privada numa linha (PKCS#8 DER em base64): é o que vai para o Chaveiro e para o secret do Worker. */
const emLinha = (k) => k.export({ type: "pkcs8", format: "der" }).toString("base64");
/** A pública no formato de LICENCA_PUBLIC_KEYS: SPKI DER em base64. */
export const publicaDe = (k) => createPublicKey(k).export({ type: "spki", format: "der" }).toString("base64");
const copiar = (texto) => execFileSync("pbcopy", { input: texto });
const temNoChaveiro = () => { try { execFileSync("security", ["find-generic-password", "-s", SERVICO, "-a", CONTA], { stdio: "ignore" }); return true; } catch { return false; } };

/** A principal, do Chaveiro (o macOS pede aprovação). null = não está lá ou o dono negou. */
export function lerChavePrincipal() {
  try {
    const b64 = execFileSync("security", ["find-generic-password", "-s", SERVICO, "-a", CONTA, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
  } catch { return null; }
}

function core() {
  const f = new URL("../dist/main/conta/licenca-assinada-core.js", import.meta.url);
  if (!existsSync(f)) { console.error("✗ falta dist/main/conta/licenca-assinada-core.js: rode `npm run build:main` antes"); process.exit(1); }
  return req("../dist/main/conta/licenca-assinada-core.js");
}

function gerar() {
  if (temNoChaveiro()) { console.error(`✗ o Chaveiro já tem a principal (${SERVICO}/${CONTA}); para trocar, apague-a antes no app Acesso às Chaves`); process.exit(64); }
  const { privateKey } = generateKeyPairSync("ed25519");
  // -T "": nenhum app confiável → todo acesso pede aprovação do dono, inclusive pelo próprio `security`.
  execFileSync("security", ["add-generic-password", "-s", SERVICO, "-a", CONTA, "-l", "meu-bot · chave principal da licença", "-T", "", "-w", emLinha(privateKey)], { stdio: "ignore" });
  const lida = lerChavePrincipal();
  if (lida === null || publicaDe(lida) !== publicaDe(privateKey)) { console.error("✗ gravei no Chaveiro, mas não consegui reler a mesma chave"); process.exit(1); }
  console.log("✓ principal da licença no Chaveiro. Depois: `--copiar` para o gerenciador de senhas e para `wrangler secret put LICENCA_PRIVATE_KEY`.");
  console.log(`\nPública (para LICENCA_PUBLIC_KEYS no app e em backend-colima/licenca.js):\n${publicaDe(privateKey)}`);
}

function reserva() {
  const { privateKey } = generateKeyPairSync("ed25519");
  copiar(emLinha(privateKey));
  console.log("✓ reserva gerada. A PRIVADA está na área de transferência (não aparece aqui): cole no gerenciador de senhas,");
  console.log("  numa nota \"meu-bot · chave reserva da licença\", e depois rode `npm run chave-licenca -- --limpar`.");
  console.log(`\nPública da reserva (para LICENCA_PUBLIC_KEYS):\n${publicaDe(privateKey)}`);
}

function copiarPrincipal() {
  const k = lerChavePrincipal();
  if (k === null) { console.error("✗ não li a principal do Chaveiro (não está lá, ou o acesso foi negado)"); process.exit(1); }
  copiar(emLinha(k));
  console.log("✓ a PRINCIPAL está na área de transferência (não aparece aqui). Use no gerenciador de senhas ou em");
  console.log("  `wrangler secret put LICENCA_PRIVATE_KEY` (cole quando ele pedir) e depois rode `--limpar`.");
}

function publica() {
  const k = lerChavePrincipal();
  if (k === null) { console.error("✗ não li a principal do Chaveiro"); process.exit(1); }
  console.log(publicaDe(k));
}

function testar() {
  const k = lerChavePrincipal();
  if (k === null) { console.error("✗ não li a principal do Chaveiro (não está lá, ou o acesso foi negado)"); process.exit(1); }
  const c = core();
  const be = req("../backend-colima/licenca.js");
  const agora = Date.now();
  const payload = { v: 2, conta: { id: "11111111-1111-4111-8111-111111111111", email: "teste@exemplo" }, maquina: "22222222-2222-4222-8222-222222222222", emitidaEm: new Date(agora).toISOString(), exp: new Date(agora + c.LICENCA_VALIDADE_MS).toISOString(), licenca: c.LICENCA_PUBLIC_KEYS.length > 0 ? { plan: "pro", status: "active" } : {}, devices: [] };
  const kid = c.LICENCA_PUBLIC_KEYS.find((p) => p.chave === publicaDe(k))?.id;
  if (kid === undefined) { console.error("✗ a principal do Chaveiro NÃO está em LICENCA_PUBLIC_KEYS do app"); process.exit(1); }
  const assinada = c.assinarLicenca(payload, k, kid);
  const app = c.verificaLicencaAssinada({ assinada }, { now: agora });
  const back = be.verificaLicencaAssinada({ assinada }, { now: agora });
  if (!app.ok || !back.ok) { console.error(`✗ não confere: app=${app.ok ? "ok" : app.motivo} backend=${back.ok ? "ok" : back.motivo}`); process.exit(1); }
  console.log(`✓ ok · ${kid} (o app e o backend aceitam o que ela assinar)`);
}

const a = process.argv;
if (a.includes("--gerar")) gerar();
else if (a.includes("--reserva")) reserva();
else if (a.includes("--copiar")) copiarPrincipal();
else if (a.includes("--publica")) publica();
else if (a.includes("--testar")) testar();
else if (a.includes("--limpar")) { copiar(""); console.log("✓ área de transferência vazia"); }
else if (process.argv[1]?.endsWith("chave-licenca.mjs")) console.log("uso: npm run chave-licenca -- --gerar | --reserva | --copiar | --publica | --testar | --limpar");
