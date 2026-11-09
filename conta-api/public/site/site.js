// Home do meu-bot: versão, data e tamanho da release mais nova (o Worker lê o GitHub com cache de 10 min) e o link
// do console. Sem resposta, o botão continua apontando para /download/mac, que resolve na hora do clique.
(() => {
  const cfg = window.MEU_BOT_CONTA || {};
  const $ = (id) => document.getElementById(id);
  // Analytics (public/analytics.js, no-op sem GA_ID): a visualização desta página e o evento "baixar_mac" no clique do
  // botão da home e quando a página de obrigado dispara o download (origem diz de onde veio).
  const ga = window.meuBotGa || { pagina() {}, evento() {} };
  ga.pagina();
  const bb = $("btn-baixar"); if (bb) bb.addEventListener("click", () => ga.evento("baixar_mac", { origem: "home" }));
  let versao = "";
  if ($("btn-denovo")) {
    const ver = /[?&]ver=1/.test(location.search);
    ga.evento("baixar_mac", { origem: ver ? "obrigado-ver" : "obrigado" });
    $("btn-denovo").addEventListener("click", () => ga.evento("baixar_mac", { origem: "obrigado-link" }));
    // O download começa sozinho (?ver=1 só mostra a página): o evento sai antes de navegar.
    if (!ver) setTimeout(() => { ga.evento("download_iniciado", { versao: versao || "desconhecida" }); location.href = "/download/mac"; }, 900);
  }
  if (typeof cfg.console === "string") { $("link-console").href = `${cfg.console}/account/overview`; const lc = $("link-conta"); if (lc) lc.href = `${cfg.console}/account/overview`; }
  const mb = (n) => (n > 0 ? `${(n / 1048576).toFixed(0)} MB` : "");
  const data = (iso) => { const t = Date.parse(iso || ""); return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }); };
  fetch("/download/mac.json", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || typeof d.versao !== "string") { $("versao").textContent = "Versão mais nova em github.com/diegofornalha/meu-bot/releases"; return; }
      versao = d.versao;
      $("versao").textContent = ["Versão " + d.versao, data(d.publicadoEm), mb(d.tamanho)].filter(Boolean).join(" · ");
    })
    .catch(() => { $("versao").textContent = ""; });
})();
