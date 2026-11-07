// Home do meu-bot: versão, data e tamanho da release mais nova (o Worker lê o GitHub com cache de 10 min) e o link
// do console. Sem resposta, o botão continua apontando para /download/mac, que resolve na hora do clique.
(() => {
  const cfg = window.MEU_BOT_CONTA || {};
  const $ = (id) => document.getElementById(id);
  if (typeof cfg.console === "string") $("link-console").href = `${cfg.console}/account/overview`;
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
