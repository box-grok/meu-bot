// Home do meu-bot: versão, data e tamanho da release mais nova (o Worker lê o GitHub com cache de 10 min) e o link
// do console. Sem resposta, o botão continua apontando para /download/mac, que resolve na hora do clique.
(() => {
  const cfg = window.MEU_BOT_CONTA || {};
  const $ = (id) => document.getElementById(id);
  // Google Analytics 4 (só quando o Worker manda o ID): visualizações de página do site, sem sinais de anúncios.
  // Pode haver mais de um ID (vírgula): cada propriedade recebe as mesmas visualizações e eventos.
  const gaIds = typeof cfg.ga === "string" ? cfg.ga.split(",").filter((x) => /^G-[A-Z0-9]{6,12}$/.test(x)) : [];
  if (gaIds.length > 0) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    for (const id of gaIds) window.gtag("config", id, { allow_google_signals: false, allow_ad_personalization_signals: false });
    const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaIds[0])}`; document.head.append(s);
  }
  /** Evento do Analytics (só com a tag ligada): "baixar_mac" no clique do botão e quando a página de obrigado dispara o download. */
  const evento = (nome, params) => { if (typeof window.gtag === "function") window.gtag("event", nome, params); };
  const bb = $("btn-baixar"); if (bb) bb.addEventListener("click", () => evento("baixar_mac", { origem: "home" }));
  if ($("btn-denovo")) { evento("baixar_mac", { origem: /[?&]ver=1/.test(location.search) ? "obrigado-ver" : "obrigado" }); $("btn-denovo").addEventListener("click", () => evento("baixar_mac", { origem: "obrigado-link" })); }
  if (typeof cfg.console === "string") { $("link-console").href = `${cfg.console}/account/overview`; const lc = $("link-conta"); if (lc) lc.href = `${cfg.console}/account/overview`; }
  const mb = (n) => (n > 0 ? `${(n / 1048576).toFixed(0)} MB` : "");
  const data = (iso) => { const t = Date.parse(iso || ""); return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }); };
  fetch("/download/mac.json", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || typeof d.versao !== "string") { $("versao").textContent = "Versão mais nova em github.com/diegofornalha/meu-bot/releases"; return; }
      $("versao").textContent = ["Versão " + d.versao, data(d.publicadoEm), mb(d.tamanho)].filter(Boolean).join(" · ");
    })
    .catch(() => { $("versao").textContent = ""; });
})();
