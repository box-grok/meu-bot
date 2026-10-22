import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { comandoEntrar, comandoSairDoGithub, lerStatus, lerLink, loginConcluiu, isContaId, CF_ESCOPOS, GITHUB_OUTRA_CONTA, SAIR_DO_SITE } = createRequire(import.meta.url)("../../dist/main/contas-cli-core.js");

const WHOAMI_AMPLO = `👋 You are logged in with an OAuth Token, associated with the email lv@exemplo.com.
Scope (Access)
- user (read)
- offline_access
- k2.read
- account (read)
- workers (write)
- pages (write)
- zone (read)
- email_routing (write)`;
const WHOAMI_SITES = `👋 You are logged in with an OAuth Token, associated with the email lv@exemplo.com.
Scope (Access)
- account (read)
- user (read)
- pages (write)
- zone (read)
- offline_access `;

test("status: email, acesso amplo e só sites; gh logado e não logado", () => {
  const out = `<<cloudflare\n${WHOAMI_AMPLO}\n>>\n<<github\n✓ Logged in to github.com account lucas-lv (keyring)\n>>\n`;
  assert.deepEqual(lerStatus(out), [
    { id: "cloudflare", presente: true, conectado: true, conta: "lv@exemplo.com", amplo: true },
    { id: "github", presente: true, conectado: true, conta: "lucas-lv", amplo: false },
  ]);
  const so = lerStatus(`<<cloudflare\n${WHOAMI_SITES}\n>>\n<<github\nYou are not logged into any GitHub hosts. To log in, run: gh auth login\n>>`);
  assert.equal(so[0].amplo, false);
  assert.deepEqual(so[1], { id: "github", presente: true, conectado: false, conta: null, amplo: false });
});

test("status: ferramenta ausente e bloco que não chegou (SSH caiu) fica de fora", () => {
  const r = lerStatus("<<cloudflare\nYou are not authenticated. Please run `wrangler login`.\n>>\n<<github\nausente\n>>");
  assert.deepEqual(r, [
    { id: "cloudflare", presente: true, conectado: false, conta: null, amplo: false },
    { id: "github", presente: false, conectado: false, conta: null, amplo: false },
  ]);
  assert.deepEqual(lerStatus("<<cloudflare\nmeio do caminho"), []);
});

test("link: Cloudflare pelo retorno (com pty e cores), por código e GitHub por código", () => {
  const cf = "\x1b[2mAttempting to login via OAuth...\r\nVisit this link to authenticate: https://dash.cloudflare.com/oauth2/auth?response_type=code&scope=pages%3Awrite&state=x\r\n";
  assert.deepEqual(lerLink("cloudflare", cf), { url: "https://dash.cloudflare.com/oauth2/auth?response_type=code&scope=pages%3Awrite&state=x", codigo: null });
  const dev = "To authorize Wrangler, please visit:\n\n  https://dash.cloudflare.com/oauth2/device/verify\n\nand enter the code:\n\n  UFAi4wmj\n";
  assert.deepEqual(lerLink("cloudflare", dev), { url: "https://dash.cloudflare.com/oauth2/device/verify", codigo: "UFAi4wmj" });
  // Link sem o código ainda (chegou só metade): espera.
  assert.deepEqual(lerLink("cloudflare", "please visit:\n  https://dash.cloudflare.com/oauth2/device/verify\n"), { url: null, codigo: null });
  const gh = "! First copy your one-time code: 877B-0B69\nOpen this URL to continue in your web browser: https://github.com/login/device\n";
  assert.deepEqual(lerLink("github", gh), { url: "https://github.com/login/device", codigo: "877B-0B69" });
  assert.deepEqual(lerLink("github", "! First copy"), { url: null, codigo: null });
});

test("login: fim pela saída de cada ferramenta", () => {
  assert.equal(loginConcluiu("cloudflare", "Successfully logged in."), true);
  assert.equal(loginConcluiu("github", "✓ Authentication complete.\n✓ Logged in as lucas-lv"), true);
  assert.equal(loginConcluiu("github", "error connecting"), false);
});

test("comando: Cloudflare só com os escopos de sites; código sem o Navegador; ids validados", () => {
  const nav = comandoEntrar("cloudflare", true);
  assert.equal(nav.tty, true);
  assert.match(nav.cmd, new RegExp(`--scopes ${CF_ESCOPOS.join(" ")}`));
  assert.doesNotMatch(nav.cmd, /--device/);
  assert.match(comandoEntrar("cloudflare", false).cmd, /--device/);
  assert.deepEqual(CF_ESCOPOS, ["account:read", "user:read", "pages:write", "zone:read"]);
  assert.equal(comandoEntrar("github", true).tty, false);
  assert.equal(isContaId("github"), true);
  assert.equal(isContaId("aws"), false);
});

test("trocar de conta: GitHub com várias contas vale a ativa; sair só da anterior; Cloudflare limpa a sessão do Navegador", () => {
  const gh = `github.com
  ✓ Logged in to github.com account conta-antiga (keyring)
  - Active account: false
  - Git operations protocol: https
  ✓ Logged in to github.com account conta-nova (keyring)
  - Active account: true`;
  assert.equal(lerStatus(`<<github\n${gh}\n>>`)[0].conta, "conta-nova");
  assert.equal(comandoSairDoGithub("conta-antiga"), "gh auth logout -h github.com -u conta-antiga </dev/null 2>&1 | tail -2");
  assert.equal(comandoSairDoGithub("x; rm -rf ~"), null, "nome fora do formato do GitHub não vira comando");
  assert.match(GITHUB_OUTRA_CONTA, /^https:\/\/github\.com\/login\?add_account=1&return_to=%2Flogin%2Fdevice$/);
  assert.deepEqual(SAIR_DO_SITE, { cloudflare: "cloudflare.com", github: null });
});
