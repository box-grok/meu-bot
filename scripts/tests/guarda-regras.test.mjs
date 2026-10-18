import { test } from "node:test";
import assert from "node:assert/strict";
import { LoopTracker, autoPauseNoteText, isFarewell, isOperationalNotice, normalize, similarity } from "../../backend-colima/guarda/regras.mjs";

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
  assert.match(n, /Não responda a esta nota ao contato/);
});
