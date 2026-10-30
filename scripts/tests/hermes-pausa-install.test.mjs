import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const core = createRequire(import.meta.url)("../../dist/main/whatsapp/whatsapp-hermes-pausa-core.js");
const bundle = createRequire(import.meta.url)("../../dist/main/maquina/backend-bundle-core.js");
const PLUGIN = join(import.meta.dirname, "..", "..", "backend-colima", "hermes-plugins", "meu-bot-pausa");

// Máquina falsa como em whatsapp-hermes-core.test.mjs: `hermes` falso que diz onde está, python do venv falso que só
// confirma o patch do YAML (cfgset=ok), sem systemd nem gateway. O python3 de verdade grava os arquivos do plugin.
function maquinaFalsa({ gateway = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), "hermes-pausa-"));
  mkdirSync(join(d, ".hermes")); mkdirSync(join(d, "bin")); mkdirSync(join(d, "rt/venv/bin"), { recursive: true });
  writeFileSync(join(d, "bin/hermes"), `#!/bin/sh\necho "$*" >> "${d}/chamadas"\n[ "$1" = --version ] && echo "Install directory: ${d}/rt"\nexit 0\n`);
  writeFileSync(join(d, "rt/venv/bin/python"), `#!/bin/sh\nfor a; do ultimo=$a; done\nprintf '%s\\n' "$ultimo" >> "${d}/patches"\necho cfgset=ok\n`);
  writeFileSync(join(d, "bin/timeout"), `#!/bin/sh\nshift\nexec "$@"\n`);
  writeFileSync(join(d, "bin/pgrep"), "#!/bin/sh\nexit 1\n");
  writeFileSync(join(d, "bin/systemctl"), gateway ? `#!/bin/sh\necho "systemctl $*" >> "${d}/chamadas"\nexit 0\n` : "#!/bin/sh\nexit 1\n");
  for (const f of ["bin/hermes", "rt/venv/bin/python", "bin/timeout", "bin/pgrep", "bin/systemctl"]) chmodSync(join(d, f), 0o755);
  return d;
}
const rodar = (d, script) => spawnSync("bash", ["-c", `set -e\n${script}`], { env: { ...process.env, HOME: d, PATH: `${join(d, "bin")}:${process.env.PATH}` }, encoding: "utf8" });
const ler = (d, f) => (existsSync(join(d, f)) ? readFileSync(join(d, f), "utf8") : "");
const fonte = () => { const init = readFileSync(join(PLUGIN, "__init__.py"), "utf8"), yaml = readFileSync(join(PLUGIN, "plugin.yaml"), "utf8"); return { init, yaml, versao: core.versaoDoPluginYaml(yaml) }; };

test("versaoDoPluginYaml e fusoOk", () => {
  assert.equal(core.versaoDoPluginYaml('name: x\nversion: "1.2.3"\n'), "1.2.3");
  assert.equal(core.versaoDoPluginYaml("version: 2.0.0-rc1\n"), "2.0.0-rc1");
  assert.equal(core.versaoDoPluginYaml("name: x\n"), null);
  assert.equal(core.fusoOk("America/Sao_Paulo"), "America/Sao_Paulo");
  assert.equal(core.fusoOk("Europe/Lisbon"), "Europe/Lisbon");
  assert.equal(core.fusoOk("x; rm -rf /"), "America/Sao_Paulo");
  assert.equal(core.fusoOk(""), "America/Sao_Paulo");
});

test("o plugin do bundle é versionado como componente e a versão do yaml bate com a do módulo Python", () => {
  const f = fonte();
  assert.match(f.versao, /^\d+\.\d+\.\d+$/);
  assert.match(f.init, new RegExp(`^VERSAO = "${f.versao.replace(/\./g, "\\.")}"`, "m"));
  const comp = bundle.COMPONENTES.find((c) => c.nome === "hermes-pausa");
  assert.ok(comp, "componente hermes-pausa em COMPONENTES");
  assert.equal(comp.versao, "backend-colima/hermes-plugins/meu-bot-pausa/plugin.yaml");
  for (const a of comp.arquivos) assert.ok(existsSync(join(import.meta.dirname, "..", "..", a)), `${a} existe`);
  assert.throws(() => core.hermesPausaPluginSh({ ...f, versao: "9.9.9" }, "America/Sao_Paulo"), /não bate/);
  assert.throws(() => core.hermesPausaPluginSh({ ...f, init: " " }, "America/Sao_Paulo"), /sem arquivos/);
});

test("instalar: grava os dois arquivos, o fuso, liga em plugins.enabled e o .ok por último; sem gateway de pé não reinicia; de novo = nada", () => {
  const d = maquinaFalsa();
  const f = fonte();
  const r = rodar(d, core.hermesPausaPluginSh(f, "America/Sao_Paulo"));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const s = core.lerPausaPlugin(r.stdout);
  assert.deepEqual(s, { plugin: "instalado", enabled: "ja", restart: "sem-servico", ok: true }, "python falso só diz cfgset=ok (sem enabled=): conta como já ligado");
  assert.equal(ler(d, ".hermes/plugins/meu-bot-pausa/__init__.py"), f.init);
  assert.equal(ler(d, ".hermes/plugins/meu-bot-pausa/plugin.yaml"), f.yaml);
  assert.equal(ler(d, ".hermes/plugins/meu-bot-pausa/.ok"), f.versao);
  assert.equal(ler(d, ".local/share/meu-bot/fuso"), "America/Sao_Paulo\n");
  assert.match(ler(d, "patches"), /meu-bot-pausa/, "o editor do YAML recebeu o plugin a ligar");
  assert.ok(!ler(d, "chamadas").includes("gateway restart"), "sem gateway não há o que reiniciar");
  const r2 = rodar(d, core.hermesPausaPluginSh(f, "America/Sao_Paulo"));
  assert.equal(core.lerPausaPlugin(r2.stdout).plugin, "nada");
  assert.equal(core.lerPausaPlugin(r2.stdout).restart, "nao-precisou");
});

test("atualizar: conteúdo novo = plugin=atualizado e reinicia pelo systemd quando o gateway está de pé; o .ok acompanha a versão", () => {
  const d = maquinaFalsa({ gateway: true });
  const f = fonte();
  rodar(d, core.hermesPausaPluginSh(f, "America/Sao_Paulo"));
  const novo = { init: f.init.replace(/^VERSAO = "[^"]+"/m, 'VERSAO = "9.0.1"'), yaml: f.yaml.replace(/^version: .*$/m, 'version: "9.0.1"'), versao: "9.0.1" };
  const r = rodar(d, core.hermesPausaPluginSh(novo, "Europe/Lisbon"));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const s = core.lerPausaPlugin(r.stdout);
  assert.equal(s.plugin, "atualizado"); assert.equal(s.restart, "systemd"); assert.equal(s.ok, true);
  assert.equal(ler(d, ".hermes/plugins/meu-bot-pausa/.ok"), "9.0.1");
  assert.equal(ler(d, ".local/share/meu-bot/fuso"), "Europe/Lisbon\n");
  assert.match(ler(d, "chamadas"), /systemctl --user restart hermes-gateway/);
});

test("ligar no YAML falhou: sem .ok, código 3, e a leitura diz que não está ok", () => {
  const d = maquinaFalsa();
  writeFileSync(join(d, "rt/venv/bin/python"), "#!/bin/sh\nexit 1\n"); chmodSync(join(d, "rt/venv/bin/python"), 0o755);
  const r = rodar(d, core.hermesPausaPluginSh(fonte(), "America/Sao_Paulo"));
  assert.equal(r.status, 3);
  const s = core.lerPausaPlugin(r.stdout);
  assert.equal(s.plugin, "instalado"); assert.equal(s.enabled, "falhou"); assert.equal(s.ok, false);
  assert.equal(existsSync(join(d, ".hermes/plugins/meu-bot-pausa/.ok")), false);
});

test("remover: apaga a pasta e os marcadores, tira do YAML e reinicia se havia gateway; sem plugin = nada", () => {
  const d = maquinaFalsa({ gateway: true });
  rodar(d, core.hermesPausaPluginSh(fonte(), "America/Sao_Paulo"));
  writeFileSync(join(d, ".local/share/meu-bot/whatsapp-pausa.carregado"), "{}");
  const r = rodar(d, core.hermesPausaPluginRemoverSh());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(core.lerPausaPlugin(r.stdout).plugin, "removido");
  assert.equal(existsSync(join(d, ".hermes/plugins/meu-bot-pausa")), false);
  assert.equal(existsSync(join(d, ".local/share/meu-bot/whatsapp-pausa.carregado")), false);
  const r2 = rodar(d, core.hermesPausaPluginRemoverSh());
  assert.equal(core.lerPausaPlugin(r2.stdout).plugin, "nada");
});

test("lerPausaPlugin: saída crua → estado", () => {
  assert.deepEqual(core.lerPausaPlugin("plugin=instalado\ncfgset=ok\nenabled=sim\nrestart=systemd\n"), { plugin: "instalado", enabled: "sim", restart: "systemd", ok: true });
  assert.deepEqual(core.lerPausaPlugin("plugin=falhou: sem python3\n"), { plugin: "falhou", enabled: "ja", restart: "?", ok: false });
  assert.deepEqual(core.lerPausaPlugin("lixo"), { plugin: "falhou", enabled: "ja", restart: "?", ok: false });
});
