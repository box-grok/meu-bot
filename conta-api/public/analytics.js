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
  const base = { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false };
  if (ambiente === "staging") base.debug_mode = true;
  for (const id of ids) window.gtag("config", id, base);
  const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids[0])}`; document.head.append(s);
  /** Origem + caminho, sem query nem fragmento (mesma regra de paginaLimpa no Worker). */
  const limpa = (caminho) => `${location.origin}${caminho || location.pathname}`;
  /** Um evento com `ambiente`; os parâmetros vêm de listas fechadas (nada pessoal). */
  const evento = (nome, params) => { window.gtag("event", nome, { ambiente, ...(params || {}) }); };
  /** Uma visualização de página com a URL limpa (SPA do console chama a cada troca de seção, com o slug anonimizado). */
  const pagina = (caminho, params) => { window.gtag("event", "page_view", { ambiente, page_location: limpa(caminho), page_path: caminho || location.pathname, page_title: document.title, ...(params || {}) }); };
  window.meuBotGa = { pagina, evento, ligado: true, ambiente };
})();
