import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const contasClaude = require("../../backend-colima/contas-claude.js");

/** HOME descartável com ~/.claude (settings, CLAUDE.md, projects) e ~/.claude.json logado. */
function ambiente({ logado = true } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "meu-bot-cc-"));
  const claudeHome = path.join(home, ".claude");
  mkdirSync(path.join(claudeHome, "projects", "-tmp-x"), { recursive: true });
  mkdirSync(path.join(claudeHome, "sessions"), { recursive: true });
  writeFileSync(path.join(claudeHome, "settings.json"), JSON.stringify({ model: "opus" }));
  writeFileSync(path.join(claudeHome, "CLAUDE.md"), "# regras\n");
  writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ userID: "u1", hasCompletedOnboarding: true, projects: { "/tmp/x": { hasTrustDialogAccepted: true } }, ...(logado ? { oauthAccount: { emailAddress: "a@b.c" } } : {}) }));
  let agora = 1_800_000_000;
  const reg = contasClaude.abrir({ base: path.join(home, ".local", "share", "meu-bot"), claudeHome, claudeJson: path.join(home, ".claude.json"), agora: () => agora, temCredencial: () => false });
  return { home, claudeHome, reg, avancar: (s) => { agora += s; }, agoraS: () => agora };
}
const logar = (c, email = "x@y.z") => { const f = path.join(c.home, ".claude.json"); const j = JSON.parse(readFileSync(f, "utf8")); writeFileSync(f, JSON.stringify({ ...j, oauthAccount: { emailAddress: email } })); };

test("analisarRateLimit: acha o objeto em qualquer nível, normaliza utilização e reset", () => {
  const ev = { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1_800_003_600, rateLimitType: "five_hour", utilization: 1 } };
  assert.deepEqual(contasClaude.analisarRateLimit(ev), { janelas: { sessao: { pct: 100, resets: 1_800_003_600 } }, rejeitado: true, resets: 1_800_003_600, tipo: "five_hour" });
  const semanal = contasClaude.analisarRateLimit({ rateLimitType: "seven_day", status: "allowed_warning", utilization: 0.934, resetsAt: 1_800_000_000_000 });
  assert.deepEqual(semanal.janelas, { semanal: { pct: 93, resets: 1_800_000_000 } }); assert.equal(semanal.rejeitado, false);
  const porModelo = contasClaude.analisarRateLimit({ rate_limit_info: { rateLimitType: "seven_day_opus", status: "rejected", utilization: 42 } });
  assert.deepEqual(porModelo.janelas, {}); assert.equal(porModelo.rejeitado, true); assert.equal(porModelo.tipo, "seven_day_opus");
  assert.equal(contasClaude.analisarRateLimit({ type: "assistant", message: { content: "rateLimitType no texto" } }), null);
  assert.equal(contasClaude.analisarRateLimit(null), null);
});

test("servicoKeychain: padrão sem sufixo; pasta isolada ganha 8 hex do sha256 (NFC)", () => {
  assert.equal(contasClaude.servicoKeychain(null), "Claude Code-credentials");
  const s = contasClaude.servicoKeychain("/Users/x/.local/share/meu-bot/contas-claude/c-1/home");
  assert.match(s, /^Claude Code-credentials-[a-f0-9]{8}$/);
  assert.equal(contasClaude.servicoKeychain("/tmp/café"), contasClaude.servicoKeychain("/tmp/café"), "NFC e NFD dão o mesmo serviço");
});

test("registro: a conta padrão existe sozinha e é escolhida quando logada", () => {
  const a = ambiente();
  try {
    const v = a.reg.listar();
    assert.deepEqual(v.contas.map((c) => [c.id, c.padrao, c.logada, c.uso.estado]), [["padrao", true, true, "desconhecida"]]);
    assert.equal(v.atual, "padrao");
    assert.deepEqual(a.reg.ambiente(a.reg.conta("padrao")), {});
  } finally { rmSync(a.home, { recursive: true, force: true }); }
  const b = ambiente({ logado: false });
  try { assert.equal(b.reg.escolher({ permitirAviso: true }), null); assert.equal(b.reg.listar().atual, null); }
  finally { rmSync(b.home, { recursive: true, force: true }); }
});

test("criar: pasta isolada com histórico compartilhado por symlink, sessions fora, settings copiado e .claude.json sem login", () => {
  const a = ambiente();
  try {
    const c = a.reg.criar("Conta 2");
    assert.match(c.id, /^c-[a-f0-9]{8}$/);
    assert.equal(c.home, path.join(a.home, ".local", "share", "meu-bot", "contas-claude", c.id, "home"));
    for (const d of ["projects", "todos", "plans", "tasks", "transcripts", "file-history"]) {
      assert.ok(lstatSync(path.join(c.home, d)).isSymbolicLink(), `${d} é link`);
      assert.equal(readlinkSync(path.join(c.home, d)), path.join(a.claudeHome, d));
    }
    assert.ok(!existsSync(path.join(c.home, "sessions")), "sessions não é compartilhado");
    assert.ok(!existsSync(path.join(c.home, "skills")), "pasta que não existe em ~/.claude não vira link");
    assert.deepEqual(JSON.parse(readFileSync(path.join(c.home, "settings.json"), "utf8")), { model: "opus" });
    assert.equal(readFileSync(path.join(c.home, "CLAUDE.md"), "utf8"), `@${path.join(a.claudeHome, "CLAUDE.md")}\n`);
    const j = JSON.parse(readFileSync(path.join(c.home, ".claude.json"), "utf8"));
    assert.equal(j.oauthAccount, undefined); assert.equal(j.userID, undefined);
    assert.equal(j.hasCompletedOnboarding, true); assert.equal(j.projects["/tmp/x"].hasTrustDialogAccepted, true, "pasta confiável vem junto");
    assert.deepEqual(a.reg.ambiente(c), { CLAUDE_CONFIG_DIR: c.home, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_BASE_URL: "" });
    // Sem login a conta não entra no ranking; com login, vai na frente da padrão (ordem 1 < 1000).
    assert.equal(a.reg.escolher({ permitirAviso: true }).id, "padrao");
    logar(c, "dois@x.y");
    assert.equal(a.reg.escolher({ permitirAviso: true }).id, c.id);
    assert.equal(a.reg.conferir(c.id).email, "dois@x.y");
    // O registro sobrevive a reabrir.
    const reaberto = contasClaude.abrir({ base: path.join(a.home, ".local", "share", "meu-bot"), claudeHome: a.claudeHome, claudeJson: path.join(a.home, ".claude.json"), temCredencial: () => false });
    assert.deepEqual(reaberto.listar().contas.map((x) => [x.id, x.rotulo, x.email]), [[c.id, "Conta 2", "dois@x.y"], ["padrao", "Login padrão", "a@b.c"]], "o e-mail da padrão vem do login real (~/.claude.json)");
  } finally { rmSync(a.home, { recursive: true, force: true }); }
});

test("remover: desfaz os links antes do rm (o histórico fica), recusa a padrão e pastas de fora", () => {
  const a = ambiente();
  try {
    const c = a.reg.criar("");
    writeFileSync(path.join(a.claudeHome, "projects", "-tmp-x", "s1.jsonl"), "{}\n");
    assert.equal(a.reg.remover(c.id), true);
    assert.ok(!existsSync(path.dirname(c.home)));
    assert.ok(existsSync(path.join(a.claudeHome, "projects", "-tmp-x", "s1.jsonl")), "o histórico real não some");
    assert.throws(() => a.reg.remover("padrao"), /padrão/);
    assert.equal(a.reg.remover("c-00000000"), false);
  } finally { rmSync(a.home, { recursive: true, force: true }); }
});

test("uso: aviso é derivado dos limiares, esgotada expira em ate+60 s e um relato atrasado não ressuscita a conta", () => {
  const a = ambiente();
  try {
    const c = a.reg.criar("B"); logar(c);
    assert.equal(a.reg.registrarUso(c.id, { sessao: { pct: 91, resets: a.agoraS() + 3600 } }).estado, "aviso");
    assert.equal(a.reg.escolher({}), a.reg.conta("padrao"), "em aviso só serve se não houver outra");
    assert.equal(a.reg.escolher({ excluir: ["padrao"] }), null);
    assert.equal(a.reg.escolher({ excluir: ["padrao"], permitirAviso: true }).id, c.id);
    a.reg.definirLimiares({ sessao: 95 });
    assert.equal(a.reg.usoEfetivo(c.id).estado, "ok", "subir o limiar tira o aviso");
    a.reg.marcar(c.id, "esgotada", "limite", a.agoraS() + 600);
    assert.equal(a.reg.usoEfetivo(c.id).estado, "esgotada");
    assert.equal(a.reg.registrarUso(c.id, { sessao: { pct: 10, resets: null } }).estado, "esgotada", "relato de outra conversa não zera o ate");
    assert.equal(a.reg.proximaDisponivelEm(), a.agoraS() + 600);
    a.avancar(700);
    assert.equal(a.reg.usoEfetivo(c.id).estado, "desconhecida");
    a.reg.marcar(c.id, "esgotada", "sem hora");
    assert.equal(a.reg.usoEfetivo(c.id).ate, a.agoraS() + contasClaude.ESGOTADA_PADRAO_S);
    assert.equal(a.reg.usarAgora(c.id).estado, "desconhecida");
    a.reg.marcar(c.id, "bloqueada", "login vencido");
    assert.equal(a.reg.escolher({ permitirAviso: true }).id, "padrao");
    assert.equal(a.reg.registrarUso(c.id, { semanal: { pct: 1 } }).estado, "ok", "uso novo limpa bloqueio de login");
    a.reg.marcar(c.id, "bloqueada", "conta suspensa");
    assert.equal(a.reg.registrarUso(c.id, { semanal: { pct: 1 } }).estado, "bloqueada", "bloqueio que não é login fica");
    assert.equal(a.reg.resumo(c.id).esgotadas, 1);
  } finally { rmSync(a.home, { recursive: true, force: true }); }
});

test("estratégias: ordem respeita a posição; folga prefere quem tem mais cota e deixa quem não tem dado por último", () => {
  const a = ambiente();
  try {
    const b = a.reg.criar("B"); logar(b);
    const c = a.reg.criar("C"); logar(c);
    assert.equal(a.reg.escolher({}).id, b.id);
    a.reg.reordenar([c.id, b.id]);
    assert.equal(a.reg.escolher({}).id, c.id);
    a.reg.definirLimiares({ estrategia: "folga" });
    a.reg.registrarUso(c.id, { sessao: { pct: 70 }, semanal: { pct: 20 } });
    a.reg.registrarUso(b.id, { sessao: { pct: 20 }, semanal: { pct: 30 } });
    assert.equal(a.reg.escolher({}).id, b.id, "30% usado ganha de 70%");
    a.reg.registrarUso("padrao", { sessao: { pct: 5 } });
    assert.equal(a.reg.escolher({}).id, "padrao", "5% ganha de todos");
    assert.equal(a.reg.escolher({ excluir: ["padrao", b.id] }).id, c.id);
    assert.deepEqual(a.reg.listar().limiares, { sessao: 90, semanal: 95, estrategia: "folga" });
    assert.throws(() => a.reg.atualizar(c.id, { rotulo: "b" }), /já existe/);
    assert.equal(a.reg.atualizar(c.id, { ativa: false }).ativa, false);
    assert.equal(a.reg.escolher({ excluir: ["padrao", b.id] }), null);
  } finally { rmSync(a.home, { recursive: true, force: true }); }
});

test("backend-colima e backend-vm têm o mesmo contas-claude.js (copiar, não editar só um)", () => {
  const a = readFileSync(new URL("../../backend-colima/contas-claude.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../../backend-vm/services/contas-claude.js", import.meta.url), "utf8");
  assert.equal(a, b);
});

test("dois processos no mesmo registro: um relê o que o outro gravou e gravar não apaga a marca alheia", () => {
  const a = ambiente();
  const base = path.join(a.home, ".local", "share", "meu-bot");
  const c1 = a.reg.criar("Segunda"); logar({ home: path.join(c1.home) }, "s@y.z");
  // Instância B = outro processo (o porteiro do claude) sobre os mesmos arquivos, com relógio próprio.
  const b = contasClaude.abrir({ base, claudeHome: a.claudeHome, claudeJson: path.join(a.home, ".claude.json"), agora: a.agoraS, temCredencial: () => false });
  assert.ok(b.conta(c1.id), "B enxerga a conta criada por A sem reiniciar");
  // A marca a Segunda esgotada; B, que já tinha carregado, precisa ver isso ao escolher.
  a.reg.marcar(c1.id, "esgotada", "limite", a.agoraS() + 3600);
  assert.equal(b.usoEfetivo(c1.id).estado, "esgotada");
  assert.equal(b.escolher({ permitirAviso: true }).id, "padrao");
  // B grava uso da padrão: a marca da Segunda feita por A continua no disco (mescla, não sobrescreve).
  b.registrarUso("padrao", { sessao: { pct: 10, resets: a.agoraS() + 100 } });
  const disco = JSON.parse(readFileSync(path.join(base, "contas-claude-uso.json"), "utf8"));
  assert.equal(disco[c1.id].estado, "esgotada");
  assert.equal(disco.padrao.sessao.pct, 10);
  assert.equal(a.reg.usoEfetivo("padrao").sessao.pct, 10, "A relê o que B gravou");
  rmSync(a.home, { recursive: true, force: true });
});

test("conta global (Claude Code Global do admin): primeira da fila, travada, sem pasta própria e sem token do root", () => {
  const { home, reg } = ambiente();
  const arq = path.join(home, ".local", "share", "meu-bot", "claude-global.json");
  assert.equal(reg.conta("global"), null, "sem o arquivo do admin, não existe");
  const extra = reg.criar("Minha"); logar(extra);
  mkdirSync(path.dirname(arq), { recursive: true });
  const chave = "A".repeat(40);
  writeFileSync(arq, JSON.stringify({ url: "http://127.0.0.1:18765", chave, email: "admin@x.com" }));
  const g = reg.conta("global");
  assert.ok(g && g.global, "o arquivo do admin cria a conta");
  assert.equal(reg.logada(g), true);
  assert.equal(reg.emailDe(g), "admin@x.com");
  assert.deepEqual(reg.ambiente(g), { CLAUDE_CODE_OAUTH_TOKEN: chave, ANTHROPIC_BASE_URL: "http://127.0.0.1:18765", ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" }, "sem CLAUDE_CONFIG_DIR: o ~/.claude do usuário (histórico e --resume)");
  assert.equal(reg.escolher().id, "global", "o global vem primeiro");
  reg.definirLimiares({ estrategia: "folga" }); reg.registrarUso("global", { sessao: { pct: 80, resets: null } }); reg.registrarUso(extra.id, { sessao: { pct: 5, resets: null } });
  assert.equal(reg.escolher().id, "global", "nem com folga a própria passa na frente");
  reg.marcar("global", "esgotada", "limite", null);
  assert.equal(reg.escolher().id, extra.id, "esgotado o global, a conta própria é a reserva");
  assert.throws(() => reg.remover("global"), /gerida pelo admin/);
  assert.throws(() => reg.atualizar("global", { ativa: false }), /gerida pelo admin/);
  reg.reordenar(["global", extra.id]);
  const l = reg.listar();
  assert.equal(l.contas[0].id, "global"); assert.equal(l.contas[0].global, true); assert.equal(l.contas[0].padrao, false);
  assert.ok(!JSON.parse(readFileSync(reg.REGISTRO, "utf8")).contas.some((c) => c.id === "global"), "a global não é gravada no registro do usuário");
  writeFileSync(arq, JSON.stringify({ url: "http://exemplo.com:80", chave }));
  assert.equal(reg.conta("global"), null, "URL fora desta máquina: não vale");
  rmSync(arq);
  assert.equal(reg.conta("global"), null, "o admin desligou: some");
  assert.equal(reg.escolher().id, extra.id);
});
