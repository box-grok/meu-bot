// Chave Ed25519 das releases (o SUPublicEDKey do meu-bot, como o Sparkle no Brave): o `npm run release` assina cada
// .zip com a privada e o app só instala o que confere com a pública embutida em src/main/updater-core.ts
// (UPDATE_PUBLIC_KEY). A privada fica fora do repositório, só neste Mac; perdê-la = os apps instalados param de
// aceitar atualizações até receberem um build com a pública nova (pelo .dmg).
//
//   npm run chave-release              cria a chave (uma vez; idempotente) e mostra a pública
//   import { CHAVE_RELEASE } from "./chave-release.mjs"   → caminho da privada
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CHAVE_RELEASE = join(homedir(), ".config", "meu-bot", "release-ed25519.pem");

/** A pública no formato de UPDATE_PUBLIC_KEY: SPKI DER em base64. */
const publica = (privPem) => createPublicKey(createPrivateKey(privPem)).export({ type: "spki", format: "der" }).toString("base64");

function criar() {
  if (existsSync(CHAVE_RELEASE)) {
    console.log(`✓ a chave já existe em ${CHAVE_RELEASE}.`);
  } else {
    mkdirSync(dirname(CHAVE_RELEASE), { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(CHAVE_RELEASE, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
    chmodSync(CHAVE_RELEASE, 0o600);
    console.log(`✓ chave criada em ${CHAVE_RELEASE} (guarde um backup fora deste Mac).`);
  }
  console.log(`\nUPDATE_PUBLIC_KEY (src/main/updater-core.ts):\n${publica(readFileSync(CHAVE_RELEASE))}`);
}

if (process.argv.includes("--criar")) criar();
