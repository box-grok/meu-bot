// Landing page: no celular ou Windows o download vira "mandar o link para o meu Mac"; eventos pelo módulo de analytics
// do site (page_view limpo, `baixar_mac` com a origem e `link_celular` com a via). Sem gtag direto: o analytics.js decide.
(() => {
  const ga = window.meuBotGa || { pagina() {}, evento() {} };
  ga.pagina();
  const semMac = /Android|iPhone|iPad|iPod|Windows/i.test(navigator.userAgent);
  if (semMac) {
    document.body.classList.add("mobile");
    const fixo = document.getElementById("cta-fixo");
    const wa = document.getElementById("cta-cel-wa");
    if (fixo && wa) { fixo.href = wa.href; fixo.dataset.ev = "link_celular"; fixo.dataset.via = "whatsapp"; fixo.textContent = "Mandar o link para o meu Mac"; }
  }
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("[data-ev]") : null;
    if (!a) return;
    if (a.dataset.ev === "link_celular") ga.evento("link_celular", { via: a.dataset.via || "whatsapp" });
    else ga.evento("baixar_mac", { origem: a.dataset.origem || "lp" });
  });
})();
