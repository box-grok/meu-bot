import { test } from "node:test";
import assert from "node:assert/strict";
import { esperaAcordar, parseTelaStatus, particaoComputador, urlNoVnc, urlTelaPermitida } from "../../dist/main/maquina/tela-core.js";

test("parseTelaStatus: lê a última linha válida e ignora o que o .bashrc imprime", () => {
  assert.deepEqual(parseTelaStatus("bem-vindo!\ninstalada=1 rodando=1 web=6081\n"), { instalada: true, rodando: true, webPort: 6081 });
  assert.deepEqual(parseTelaStatus("instalada=1 rodando=0 web=6081"), { instalada: true, rodando: false, webPort: 6081 });
  assert.deepEqual(parseTelaStatus("instalada=0 rodando=0 web=-"), { instalada: false, rodando: false, webPort: null });
  assert.deepEqual(parseTelaStatus("instalada=1 rodando=1 web=-"), { instalada: true, rodando: false, webPort: null }, "rodando sem porta não conta");
  assert.equal(parseTelaStatus("instalada=1 rodando=1 web=99999").webPort, null);
  assert.equal(parseTelaStatus(""), null);
  assert.equal(parseTelaStatus("erro qualquer"), null);
});

test("acordar espera 2 s e depois 4 s", () => {
  assert.deepEqual([0, 1, 2].map(esperaAcordar), [2000, 4000, 4000]);
});

test("o <webview> só aceita o noVNC do forward local", () => {
  const u = urlNoVnc(51234);
  assert.equal(urlTelaPermitida(u), true);
  assert.match(u, /autoconnect=true/); assert.match(u, /resize=scale/); assert.match(u, /reconnect=true/);
  for (const ruim of ["http://127.0.0.1:51234/outra.html", "http://localhost:51234/vnc.html", "https://127.0.0.1:51234/vnc.html", "http://127.0.0.1.evil.com:80/vnc.html", "http://10.0.0.2:6080/vnc.html", "file:///vnc.html"]) assert.equal(urlTelaPermitida(ruim), false, ruim);
});

test("partição por máquina, sem caracteres estranhos", () => {
  assert.equal(particaoComputador("agente-box"), "computador-agente-box");
  assert.equal(particaoComputador("a b/c"), "computador-a_b_c");
});
