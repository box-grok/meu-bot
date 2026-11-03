import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoOuvir } from "../../dist/renderer/lib/audio-ouvir-core.js";

test("ouvir áudios: ativo vence tudo; ligando (daqui ou pelo status) sem botão; máquina sem o necessário é 'precisa do admin' no molde do Computador", () => {
  assert.equal(estadoOuvir({ audioIn: true, audioMaquina: false, audioLigando: true }).kind, "ativo");
  assert.deepEqual([estadoOuvir({ audioIn: false, audioLigando: true }).kind, estadoOuvir({ audioIn: false }, true).kind], ["ligando", "ligando"]);
  assert.equal(estadoOuvir({ audioIn: false, audioLigando: true }).botao, null);
  const adm = estadoOuvir({ audioIn: false, audioMaquina: false });
  assert.equal(adm.kind, "precisa-admin"); assert.equal(adm.acao, "conferir"); assert.match(adm.titulo, /precisa do admin/);
  assert.match(adm.texto, /não deixa instalar programas sem senha/); assert.match(adm.texto, /Preparar máquina › Transcritor de áudio/);
  assert.equal(estadoOuvir({ audioIn: false }, false, true).kind, "precisa-admin", "código 3 da última tentativa daqui");
  assert.equal(estadoOuvir({ audioIn: false, audioMaquina: false }, true).kind, "ligando", "ligando vem antes do admin: a tentativa está rodando");
});

test("ouvir áudios: sem motivo para não ligar, o botão de reserva; a falha automática aparece no texto; status ausente também oferece o botão", () => {
  const a = estadoOuvir({ audioIn: false, audioMaquina: true });
  assert.equal(a.kind, "ativar"); assert.equal(a.acao, "ativar"); assert.equal(a.botao, "Ativar transcrição"); assert.match(a.texto, /liga a transcrição sozinho/);
  assert.match(estadoOuvir({ audioIn: false, audioErro: "python3 não encontrado" }).texto, /não ligou sozinha: python3 não encontrado/);
  assert.equal(estadoOuvir(null).kind, "ativar");
  assert.equal(estadoOuvir({ audioIn: false }).kind, "ativar", "sem o fato da máquina (status antigo), não acusa o admin");
});
