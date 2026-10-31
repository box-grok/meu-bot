#!/usr/bin/env node
/**
 * Dirigir o meu-bot instalado pelo protocolo do DevTools, sem Acessibilidade (System Events é negado neste Mac).
 * Antes: feche o app e lance o binário com a porta (`open -a` não passa argumentos):
 *   ~/Applications/meu-bot.app/Contents/MacOS/meu-bot --remote-debugging-port=9334 &
 * Depois:
 *   node scripts/devtools.mjs paginas                       lista as janelas (índice, tipo, título)
 *   node scripts/devtools.mjs eval "<título|índice>" "<JS>"  avalia no renderer e imprime o valor (Promise é aguardada)
 *   node scripts/devtools.mjs console "<título>"            recarrega a página e junta por 12 s erros/avisos do console
 * Porta: --porta=NNNN ou MEU_BOT_DEVTOOLS_PORT (padrão 9334). Só Node ≥ 22 (fetch e WebSocket globais), sem dependências.
 * Ver a skill `testar-no-app`.
 */
const args = process.argv.slice(2);
const portaArg = args.find((a) => a.startsWith("--porta="));
const porta = Number(portaArg?.slice(8) ?? process.env["MEU_BOT_DEVTOOLS_PORT"] ?? 9334);
const [cmd, sel, expr] = args.filter((a) => !a.startsWith("--"));

async function paginas() {
  try { return await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); }
  catch { console.error(`Nada escuta em 127.0.0.1:${porta}. Lance o app com --remote-debugging-port=${porta} (feche o instalado antes).`); process.exit(2); }
}
function escolher(lista, s) {
  const p = /^\d+$/.test(s ?? "") ? lista[Number(s)] : lista.find((x) => x.type === "page" && x.title.includes(s ?? ""));
  if (!p) { console.error("página não achada; títulos:", lista.map((x) => x.title)); process.exit(2); }
  return p;
}
async function conectar(p) {
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((ok, erro) => { ws.onopen = ok; ws.onerror = erro; });
  let n = 0;
  const chamar = (method, params = {}) => new Promise((ok) => {
    const id = ++n;
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener("message", h); ok(m); } };
    ws.addEventListener("message", h); ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, chamar };
}

if (cmd === "paginas") {
  for (const [i, p] of (await paginas()).entries()) console.log(i, p.type, "|", p.title, "|", p.url.slice(-50));
} else if (cmd === "eval" && sel !== undefined && expr !== undefined) {
  const { ws, chamar } = await conectar(escolher(await paginas(), sel));
  const r = await chamar("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const d = r.result?.exceptionDetails;
  console.log(d ? "EXCEÇÃO: " + (d.exception?.description ?? d.text) : JSON.stringify(r.result?.result?.value ?? r.result));
  ws.close();
} else if (cmd === "console" && sel !== undefined) {
  const { ws, chamar } = await conectar(escolher(await paginas(), sel));
  const saida = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) saida.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
    if (m.method === "Runtime.exceptionThrown") saida.push(`exceção: ${(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)}`);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") saida.push(`log: ${m.params.entry.text.slice(0, 300)}`);
  });
  await chamar("Runtime.enable"); await chamar("Log.enable"); await chamar("Page.enable");
  await chamar("Page.reload");
  await new Promise((ok) => setTimeout(ok, 12_000));
  console.log(saida.length > 0 ? saida.join("\n") : "(nenhum erro ou aviso no console do renderer)");
  ws.close();
} else {
  console.error("uso: devtools.mjs [--porta=9334] paginas | eval <título|índice> <expressão> | console <título>"); process.exit(1);
}
