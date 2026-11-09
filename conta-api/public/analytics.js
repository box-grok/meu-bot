// Google Analytics 4 das páginas do meu-bot (site, login, console). Script clássico carregado logo depois de /config.js:
// expõe window.meuBotGa = { pagina, evento } para as páginas. Sem `ga` no config (GA_ID vazio no Worker), as duas
// funções não fazem nada e nenhum script de fora é carregado.
// Regras: nunca mandar query nem fragmento da URL (o console recebe #code&verifier, o login tem ?state&challenge), nem
// e-mail, nome, slug de organização ou id de conta nos parâmetros; sem sinais de anúncios; em staging, debug_mode (o
// DebugView do Analytics mostra os eventos na hora) e todo evento leva `ambiente`.
(() => {
  const cfg = window.MEU_BOT_CONTA || {};
  const ids = typeof cfg.ga === "string" ? [...new Set(cfg.ga.split(",").map((x) => x.trim()).filter((x) => /^G-[A-Z0-9]{6,12}$/.test(x)))] : [];
  const ambiente = cfg.canal === "staging" ? "staging" : "producao";
  const nada = { pagina() { /* sem Analytics */ }, evento() { /* sem Analytics */ }, ligado: false, ambiente };
  if (ids.length === 0) { window.meuBotGa = nada; return; }
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  /** O caminho sem o endereço de uma organização (/organizations/<slug>/… → /organizations/_/…). */
  const anonimo = (c) => c.replace(/^\/organizations\/(?!new(?:\/|$))[^/]+/, "/organizations/_").replace(/^\/enterprise\/[^/]+/, "/enterprise/_");
  const semQuery = (url) => { try { const u = new URL(url, location.href); return `${u.origin}${anonimo(u.pathname)}`; } catch { return ""; } };
  /**
   * Fixa a URL limpa para TODO evento (os automáticos da medição otimizada e os de mudança de histórico usam a URL real
   * se nada for fixado): origem + caminho anonimizado, sem query nem fragmento; o referrer também limpo.
   */
  const fixar = (caminho) => { const cam = anonimo(caminho || location.pathname); window.gtag("set", { page_location: `${location.origin}${cam}`, page_path: cam, page_referrer: semQuery(document.referrer) }); return cam; };
  fixar();
  // Antes de o gtag carregar: o pushState/replaceState da página passa por aqui primeiro, e a URL fixada já é a nova (limpa).
  for (const m of ["pushState", "replaceState"]) { const original = history[m]; history[m] = function (st, titulo, url) { const r = original.apply(this, arguments); if (url !== undefined && url !== null) { try { fixar(new URL(String(url), location.href).pathname); } catch { /* url estranha: fica a anterior */ } } return r; }; }
  const base = { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false };
  if (ambiente === "staging") base.debug_mode = true;
  // `set` vale para todos os IDs; o config de cada ID repete as opções num objeto próprio, porque o gtag guarda a referência.
  window.gtag("set", { ...base });
  for (const id of ids) window.gtag("config", id, { ...base });
  const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids[0])}`; document.head.append(s);
  /** Um evento com `ambiente`; os parâmetros vêm de listas fechadas (nada pessoal). */
  const evento = (nome, params) => { window.gtag("event", nome, { ambiente, ...(params || {}) }); };
  /** Uma visualização de página com a URL limpa (SPA do console chama a cada troca de seção). */
  const pagina = (caminho, params) => { const cam = fixar(caminho); window.gtag("event", "page_view", { ambiente, page_location: `${location.origin}${cam}`, page_path: cam, page_title: document.title, ...(params || {}) }); };
  window.meuBotGa = { pagina, evento, ligado: true, ambiente };
})();
