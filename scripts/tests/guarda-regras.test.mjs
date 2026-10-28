import { test } from "node:test";
import assert from "node:assert/strict";
import { GroupBrake, LoopTracker, autoPauseNoteText, closureVerdict, isFarewell, isOperationalNotice, loopVerdict, normalize, similarity, transcriptPairs } from "../../backend-colima/guarda/regras.mjs";

test("nota operacional: só as linhas do OpenClaw, não fala parecida do agente", () => {
  assert.equal(isOperationalNotice("↪️ Model Fallback: grok/grok-4.7 (selected anthropic/claude-opus-5-5; empty response)"), true);
  assert.equal(isOperationalNotice("↪️ Model Fallback cleared: anthropic/claude-opus-5-5 (was grok/grok-4.7)"), true);
  assert.equal(isOperationalNotice("↪️ Retried on anthropic/claude-opus-5-5"), true);
  assert.equal(isOperationalNotice("O modelo caiu para o Grok, desculpe"), false);
  assert.equal(isOperationalNotice(undefined), false);
});

test("normalize, similarity e despedidas em pt/es/en", () => {
  assert.equal(normalize("Até mais, Diego!"), "ate mais diego");
  assert.ok(similarity("Até, Diego! Estou à disposição sempre que precisar.", "Até, Diego! Estou à disposição quando precisar.") >= 0.6);
  assert.ok(similarity("Até, Diego! Estou à disposição sempre que precisar.", "Até, Diego! Fico à disposição para quando precisar.") < 0.6, "parecidas só pela fórmula: a regra de despedida é que pega");
  assert.ok(similarity("Qual o prazo de entrega do projeto?", "Preciso da nota fiscal de setembro") < 0.2);
  for (const t of ["Até.", "Ok.", "Combinado.", "Valeu. Até mais.", "Perfeito, Diego. Fico à disposição. Até mais!", "Igual, que estés bien.", "Perfecto, Diego. Cuando necesites, aquí estaré para ayudarte.", "Thanks! Take care.", "Por agora não, obrigado."]) assert.equal(isFarewell(t), true, t);
  for (const t of ["Diego, DLS Technology é uma empresa certificada ISO 9001 que oferece serviços de desenvolvimento web", "Qual o valor da hora técnica?", "Me manda o endereço de novo?"]) assert.equal(isFarewell(t), false, t);
});

const T0 = Date.parse("2026-10-18T01:01:27Z");
const s = (sec) => T0 + sec * 1000;

test("o loop real de 18 out: dispara na 3ª resposta a despedidas seguidas (01:06:09), não antes", () => {
  const tr = new LoopTracker();
  const k = "agent:main:whatsapp:direct:+595981003050";
  // pitch longo → resposta: não é ciclo suspeito (texto > 200 chars)
  tr.received(k, "Diego, nuestro asistente virtual con IA está diseñado para atender consultas en varios idiomas, incluyendo portugués, español e inglés, y puede ayudarte con información sobre nuestros servicios de desarrollo web, móvil y consultoría tecnológica, además de soporte técnico y seguimiento de proyectos en curso.", s(0));
  assert.deepEqual(tr.sending(k, "Gracias, por ahora no necesito nada. Si surge algo, te escribo.", s(15)), { loop: false });
  tr.received(k, "Perfecto, Diego. Cuando necesites, aquí estaré para ayudarte. Que tengas un buen día.", s(63));
  assert.deepEqual(tr.sending(k, "Igual, que estés bien.", s(82)), { loop: false });
  tr.received(k, "Sim, Diego, consigo escrever em português. Se precisar de algo, é só me chamar. Estou aqui para ajudar!", s(114));
  assert.deepEqual(tr.sending(k, "Beleza. Qualquer coisa eu chamo.", s(118)), { loop: false }, "3 ciclos, mas o 1º é o pitch longo");
  tr.received(k, "Perfeito, Diego. Fico à disposição. Até mais!", s(163));
  const r = tr.sending(k, "Até.", s(168));
  assert.equal(r.loop, true, "ciclos 2-4: três despedidas em ~2 min");
  assert.match(r.reason, /3 ciclos de despedida em \d min/);
});

test("humanos não batem: três 'ok' espaçados de 5 min estouram a janela; conversa com conteúdo não é loop", () => {
  const tr = new LoopTracker();
  tr.received("h", "ok", s(0)); assert.equal(tr.sending("h", "Combinado.", s(2)).loop, false);
  tr.received("h", "ok", s(5 * 60)); assert.equal(tr.sending("h", "Certo.", s(5 * 60 + 2)).loop, false);
  tr.received("h", "ok", s(10 * 60)); assert.equal(tr.sending("h", "Beleza.", s(10 * 60 + 2)).loop, false, "intervalo de 5 min > 3 min");
  const c = new LoopTracker();
  c.received("c", "Qual o prazo do projeto?", s(0)); c.sending("c", "Duas semanas.", s(5));
  c.received("c", "E o valor?", s(30)); c.sending("c", "R$ 12 mil.", s(35));
  c.received("c", "Pode parcelar?", s(60)); assert.equal(c.sending("c", "Sim, em 3 vezes.", s(65)).loop, false);
});

test("mensagens quase iguais seguidas também contam; forget zera; sem received não há ciclo", () => {
  const tr = new LoopTracker();
  for (let i = 0; i < 3; i += 1) { tr.received("x", "Pode me confirmar o horário da reunião de amanhã?", s(i * 40)); var r = tr.sending("x", "Claro: 14h, na sala 2.", s(i * 40 + 3)); }
  assert.equal(r.loop, true); assert.match(r.reason, /quase iguais/);
  tr.forget("x"); tr.received("x", "ok", s(500)); assert.equal(tr.sending("x", "ok", s(501)).loop, false);
  assert.deepEqual(new LoopTracker().sending("y", "oi"), { loop: false });
});

test("nota da pausa automática começa como as outras notas do meu-bot e explica o motivo", () => {
  const n = autoPauseNoteText("3 ciclos de despedida em 2 min", "18/10/2026 01:06 (UTC)", "+595981003050");
  assert.match(n, /^Nota do meu-bot: o agente foi pausado para este contato em 18\/10\/2026 01:06 \(UTC\) automaticamente pelo meu-bot: padrão de loop \(3 ciclos de despedida em 2 min\) com \+595981003050/);
  assert.match(n, /responda NO_REPLY a tudo/); assert.match(n, /nunca a mencione ao contato/);
});

test("despedidas em espanhol rioplatense e português curto contam (caso real: Sofía, 18/10)", () => {
  for (const t of ["Gracias por escribir.", "Dale, que andes bien.", "Chau, Sofía.", "Nos vemos.", "Listo, Sofía.", "Vos también.", "Gracias, cuidate.", "Hasta la próxima.", "Quedamos así.", "Abraço, Sofi."]) assert.equal(isFarewell(t), true, t);
  assert.equal(isFarewell("Dale, me passa o número do pedido que eu confiro no sistema agora"), false);
  const tr = new LoopTracker();
  const pairs = [["Gracias por escribir.", "Dale, Sofía."], ["Dale, que andes bien.", "Vos también, Sofía."], ["Gracias, cuidate.", "Vos también."]];
  let at = 1000; let r = { loop: false };
  for (const [i, o] of pairs) { tr.received("k", i, at); r = tr.sending("k", o, at + 5000); at += 30_000; }
  assert.equal(r.loop, true);
});

test("só de saída (sem message_received): 4 respostas de despedida seguidas pausam; 3 não; conteúdo não", () => {
  const tr = new LoopTracker();
  const outs = ["Dale, Sofía.", "Vos también, Sofía.", "Vos también.", "Chau, Sofía."];
  let r = { loop: false }; let at = 1000;
  for (const [i, o] of outs.entries()) { r = tr.sending("k", o, at); if (i === 2) assert.equal(r.loop, false, "3 respostas ainda não pausam"); at += 20_000; }
  assert.equal(r.loop, true); assert.match(r.reason, /4 respostas de despedida/);
  const tr2 = new LoopTracker(); let r2 = { loop: false }; at = 1000;
  for (const o of ["Dale.", "O pedido 4521 sai amanhã às 9h, com nota fiscal.", "Igualmente.", "Chau."]) { r2 = tr2.sending("k", o, at); at += 20_000; }
  assert.equal(r2.loop, false);
  // com a entrada presente continua valendo 3 ciclos
  const tr3 = new LoopTracker(); let r3 = { loop: false }; at = 1000;
  for (const [i, o] of [["Gracias.", "Dale."], ["Chau.", "Chau."], ["Nos vemos.", "Nos vemos."]]) { tr3.received("k", i, at); r3 = tr3.sending("k", o, at + 2000); at += 20_000; }
  assert.equal(r3.loop, true); assert.match(r3.reason, /3 ciclos/);
});

test("avisos de erro do OpenClaw em inglês nunca vão ao contato; fala normal passa", () => {
  for (const t of ["claude-cli/claude-opus-5-5 request failed", "grok/grok-4.7 request failed: HTTP 429", "The model returned an empty response. Please try again.", "This turn ended before a reply: CLI backend returned an empty response.", "LLM request failed with an unknown error.", "⚠️ Reply failed", "NO_REPLY"]) assert.equal(isOperationalNotice(t), true, t);
  for (const t of ["Oi Junior, o pedido falhou no cartão, pode tentar de novo?", "The meeting is on Monday, please try again later if the link fails.", "Beleza, valeu Sofía.", "Fechado. Qualquer coisa me chama."]) assert.equal(isOperationalNotice(t), false, t);
});

test("agent_end: pares do transcript, loop com os dois lados e conversa encerrada (despedida + 2 silêncios)", () => {
  const u = (t, at) => ({ role: "user", content: [{ type: "text", text: t }], timestamp: at });
  const a = (t, at) => ({ role: "assistant", content: t, timestamp: at });
  const conv = [u("Quanto custa?", 1000), a("Custa 50 mil.", 2000), u("Obrigada, Diego!", 3000), a("De nada. Até segunda!", 4000), u("Até segunda!", 5000), a("NO_REPLY", 6000), u("Bom descanso!", 7000)];
  assert.deepEqual(transcriptPairs(conv).map((p) => [p.inText, p.outText]), [["Quanto custa?", "Custa 50 mil."], ["Obrigada, Diego!", "De nada. Até segunda!"]]);
  assert.equal(loopVerdict(conv).loop, false);
  const c = closureVerdict(conv);
  assert.equal(c.closed, true); assert.match(c.reason, /se despediu/);
  // só 1 silêncio: ainda não
  assert.equal(closureVerdict(conv.slice(0, 6)).closed, false);
  // silêncio depois de resposta com conteúdo (falha transitória): não encerra
  assert.equal(closureVerdict([u("Quanto custa?", 1), a("Custa 50 mil.", 2), u("E o prazo?", 3), u("Oi?", 4)]).closed, false);
  // loop clássico com entrada e saída: 3 ciclos
  const loop = [u("Gracias.", 1000), a("Dale.", 2000), u("Chau.", 20000), a("Chau.", 21000), u("Nos vemos.", 40000), a("Nos vemos.", 41000)];
  assert.equal(loopVerdict(loop).loop, true);
});

test("GroupBrake: mais de 8 respostas em 5 min segura o grupo; solta sozinho depois da janela", () => {
  const b = new GroupBrake();
  const t0 = 1_000_000;
  for (let i = 0; i < 8; i += 1) assert.deepEqual(b.sending("g1", `assunto ${i} com conteúdo próprio ${"x".repeat(i)}`, t0 + i * 10_000), { segurar: false });
  assert.deepEqual(b.sending("g1", "mais uma resposta nova", t0 + 90_000), { segurar: true, motivo: "mais de 8 respostas em 5 min", novo: true });
  assert.deepEqual(b.sending("g1", "e outra", t0 + 100_000), { segurar: true, motivo: "mais de 8 respostas em 5 min", novo: false }, "registra uma vez só");
  assert.deepEqual(b.sending("g2", "outro grupo não é afetado", t0 + 100_000), { segurar: false });
  assert.deepEqual(b.sending("g1", "voltou", t0 + 90_000 + 5 * 60_000), { segurar: false }, "a janela esfriou");
});

test("GroupBrake: respostas espaçadas não freiam; repetição (despedidas) freia antes do teto", () => {
  const b = new GroupBrake();
  for (let i = 0; i < 20; i += 1) assert.equal(b.sending("g", `resposta com conteúdo ${i} ${"y".repeat(i)}`, i * 60_000).segurar, false, `envio ${i}`);
  const r = new GroupBrake();
  const t = 5_000_000;
  const seq = ["obrigado!", "de nada, até mais", "valeu, tchau", "até logo"].map((txt, i) => r.sending("g", txt, t + i * 20_000));
  assert.deepEqual(seq.map((x) => x.segurar), [false, false, false, true]);
  assert.match(seq[3].motivo, /despedida/);
  // Teto configurável (pluginConfig grupoMaxRespostas/grupoJanelaMin).
  const c = new GroupBrake({ maxRespostas: 2, janelaMs: 60_000 });
  c.sending("g", "um assunto", 0); c.sending("g", "outro assunto bem diferente", 1);
  assert.equal(c.sending("g", "terceiro tema qualquer", 2).motivo, "mais de 2 respostas em 1 min");
});
