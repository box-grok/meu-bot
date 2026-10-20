/** CSS da extensão, prefixado .mbcrm-; variáveis locais; nada de classes do Gmail. Injetado uma vez. */
export const CSS = `
.mbcrm { --mb-bg: #fff; --mb-fg: #202124; --mb-fg2: #5f6368; --mb-borda: #dadce0; --mb-acento: #1a73e8; --mb-ok: #188038; --mb-erro: #d93025; --mb-chip: #f1f3f4; --mb-raio: 8px;
  font: 13px/1.45 inherit; color: var(--mb-fg); background: var(--mb-bg); box-sizing: border-box; }
.mbcrm.mbcrm-escuro { --mb-bg: #202124; --mb-fg: #e8eaed; --mb-fg2: #9aa0a6; --mb-borda: #3c4043; --mb-acento: #8ab4f8; --mb-ok: #81c995; --mb-erro: #f28b82; --mb-chip: #303134; }
.mbcrm *, .mbcrm *::before, .mbcrm *::after { box-sizing: inherit; }
/* isolation: os z-index de dentro (chevrons, colunas fixas) não sobem acima dos menus do Gmail. */
.mbcrm-rota { isolation: isolate; position: relative; z-index: 0; height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: auto; padding: 16px 20px; gap: 12px; }
.mbcrm-painel { height: 100%; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.mbcrm h1 { font-size: 18px; font-weight: 500; margin: 0; }
.mbcrm h2 { font-size: 14px; font-weight: 500; margin: 0; color: var(--mb-fg2); }
.mbcrm h3 { font-size: 13px; font-weight: 500; margin: 0; }
.mbcrm-linha { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mbcrm-col { display: flex; flex-direction: column; gap: 6px; }
.mbcrm-cresce { flex: 1 1 auto; min-width: 0; }
.mbcrm input, .mbcrm select, .mbcrm textarea { font: inherit; color: var(--mb-fg); background: transparent; border: 1px solid var(--mb-borda); border-radius: var(--mb-raio); padding: 6px 8px; min-width: 0; }
.mbcrm input:focus, .mbcrm select:focus, .mbcrm textarea:focus { outline: none; border-color: var(--mb-acento); }
.mbcrm textarea { resize: vertical; min-height: 56px; width: 100%; }
.mbcrm select { cursor: pointer; }
.mbcrm-btn { font: inherit; border: 1px solid var(--mb-borda); background: transparent; color: var(--mb-fg); border-radius: var(--mb-raio); padding: 6px 12px; cursor: pointer; }
.mbcrm-btn:hover { background: var(--mb-chip); }
.mbcrm-btn.mbcrm-primario { background: var(--mb-acento); border-color: var(--mb-acento); color: #fff; }
.mbcrm-btn.mbcrm-primario:hover { filter: brightness(1.08); }
.mbcrm-btn.mbcrm-pequeno { padding: 3px 8px; font-size: 12px; }
.mbcrm-btn[disabled] { opacity: .5; cursor: default; }
.mbcrm-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; background: var(--mb-chip); color: var(--mb-fg); font-size: 12px; white-space: nowrap; }
.mbcrm-chip .mbcrm-ponto { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.mbcrm-dica { color: var(--mb-fg2); font-size: 12px; }
.mbcrm-erro { color: var(--mb-erro); font-size: 12px; }
.mbcrm-ok { color: var(--mb-ok); font-size: 12px; }
.mbcrm-vazio { color: var(--mb-fg2); padding: 24px; text-align: center; }
.mbcrm-grupo { border: 1px solid var(--mb-borda); border-radius: var(--mb-raio); overflow: hidden; }
.mbcrm-grupo > summary { cursor: pointer; padding: 8px 12px; background: var(--mb-chip); display: flex; align-items: center; gap: 8px; list-style: none; }
.mbcrm-grupo > summary::-webkit-details-marker { display: none; }
.mbcrm-grupo > summary .mbcrm-n { color: var(--mb-fg2); font-size: 12px; margin-left: auto; }
.mbcrm-item { display: grid; grid-template-columns: minmax(160px, 2fr) 160px minmax(0, 3fr); gap: 10px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--mb-borda); }
.mbcrm-item a { color: var(--mb-fg); text-decoration: none; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mbcrm-item a:hover { color: var(--mb-acento); text-decoration: underline; }
.mbcrm-item .mbcrm-campos { color: var(--mb-fg2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mbcrm-cartao { border: 1px solid var(--mb-borda); border-radius: var(--mb-raio); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.mbcrm-campo { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px; align-items: center; }
.mbcrm-painel .mbcrm-campo { grid-template-columns: 1fr; gap: 2px; }
.mbcrm-campo label { color: var(--mb-fg2); font-size: 12px; }
.mbcrm-comentario { padding: 6px 0; border-top: 1px solid var(--mb-borda); }
.mbcrm-comentario .mbcrm-meta { color: var(--mb-fg2); font-size: 11px; }
.mbcrm-titulo { font-size: 20px; font-weight: 500; border: 1px solid transparent; border-radius: var(--mb-raio); padding: 4px 6px; width: 100%; }
.mbcrm-titulo:hover, .mbcrm-titulo:focus { border-color: var(--mb-borda); }
.mbcrm-menu { padding: 8px; min-width: 260px; display: flex; flex-direction: column; gap: 8px; }
.mbcrm-lista-simples { display: flex; flex-direction: column; }
.mbcrm-lista-simples a { padding: 6px 8px; border-radius: var(--mb-raio); color: var(--mb-fg); text-decoration: none; }
.mbcrm-lista-simples a:hover { background: var(--mb-chip); }

/* ---- página da caixa (largura total, como no Streak) ---- */
.mbcrm-pagina { padding: 12px 24px 40px; gap: 14px; }
.mbcrm-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mbcrm-topo .mbcrm-titulo { flex: 0 1 420px; font-size: 20px; }
.mbcrm-voltar { font-size: 20px; text-decoration: none; color: var(--mb-fg2); padding: 0 4px; }
.mbcrm-migalha { color: var(--mb-fg2); text-decoration: none; font-size: 16px; }
.mbcrm-migalha:hover { color: var(--mb-acento); }
.mbcrm-relativo { position: relative; }
.mbcrm-menu-flutuante { position: absolute; right: 0; top: 110%; z-index: 10; background: var(--mb-bg); border: 1px solid var(--mb-borda); border-radius: var(--mb-raio); box-shadow: 0 4px 16px rgba(0,0,0,.15); padding: 6px; min-width: 160px; display: flex; flex-direction: column; }
.mbcrm-menu-flutuante[hidden] { display: none; }
.mbcrm-menu-flutuante a { padding: 6px 8px; color: var(--mb-erro); text-decoration: none; border-radius: 6px; }
.mbcrm-menu-flutuante a:hover { background: var(--mb-chip); }
.mbcrm-duas-colunas { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(320px, 1fr); gap: 20px; align-items: start; }
@media (max-width: 900px) { .mbcrm-duas-colunas { grid-template-columns: 1fr; } }
.mbcrm-linha-tempo { display: flex; flex-direction: column; gap: 10px; border-left: 2px solid var(--mb-borda); margin-left: 8px; padding-left: 14px; }
.mbcrm-evento { border: 1px solid var(--mb-borda); border-radius: var(--mb-raio); padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.mbcrm-evento-email { border-left: 3px solid var(--mb-acento); }
.mbcrm-evento-cab { display: flex; justify-content: space-between; gap: 8px; }
.mbcrm-evento-texto { white-space: pre-wrap; }
.mbcrm-evento-sistema { color: var(--mb-fg2); font-size: 12px; }
.mbcrm-etapa { font-weight: 500; border: none; border-radius: var(--mb-raio); padding: 8px 12px; min-width: 240px; }
.mbcrm-etapa option { color: var(--mb-fg); background: var(--mb-bg); }
.mbcrm-resumo { border-color: var(--mb-acento); }
.mbcrm-secao > summary { cursor: pointer; list-style: none; }
.mbcrm-secao > summary::-webkit-details-marker { display: none; }
.mbcrm-secao > summary::after { content: "▾"; float: right; color: var(--mb-fg2); }
.mbcrm-secao:not([open]) > summary::after { content: "▸"; }
.mbcrm-contato { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--mb-borda); }
/* ---- pipeline (como o Streak: chevrons de etapas + grade) ---- */
.mbcrm-pl { gap: 10px; }
.mbcrm-pl-topo { display: flex; align-items: center; gap: 6px; }
.mbcrm-pl-topo .mbcrm-titulo { flex: 0 1 460px; font-size: 22px; font-weight: 400; }
.mbcrm-contagem { color: var(--mb-fg2); font-size: 14px; margin-right: 6px; white-space: nowrap; }
.mbcrm-busca { width: 260px; }
.mbcrm-icone { font: inherit; font-size: 20px; line-height: 1; width: 36px; height: 36px; border-radius: 50%; border: none; background: transparent; color: var(--mb-fg2); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.mbcrm-icone:hover { background: var(--mb-chip); color: var(--mb-fg); }
.mbcrm-fab { width: 48px; height: 48px; border-radius: 50%; border: none; background: var(--mb-bg); color: #e8710a; font-size: 26px; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.25), 0 4px 10px rgba(0,0,0,.12); margin-left: 6px; }
.mbcrm-fab:hover { box-shadow: 0 2px 6px rgba(0,0,0,.3), 0 6px 14px rgba(0,0,0,.15); }
.mbcrm-faixa-moldura { position: relative; background: var(--mb-chip); border-radius: 14px; }
.mbcrm-faixa { display: flex; overflow-x: auto; scrollbar-width: none; border-radius: 14px; }
.mbcrm-faixa::-webkit-scrollbar { display: none; }
.mbcrm-chev { position: relative; flex: 0 0 auto; min-width: 170px; max-width: 260px; padding: 10px 34px 10px 46px; margin-left: -20px; cursor: pointer; user-select: none;
  clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 50%, calc(100% - 22px) 100%, 0 100%, 22px 50%); transition: opacity .15s, filter .15s; }
.mbcrm-chev:first-child { margin-left: 0; padding-left: 20px; border-radius: 14px 0 0 14px; clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 50%, calc(100% - 22px) 100%, 0 100%); }
.mbcrm-chev:hover { filter: brightness(1.05); }
.mbcrm-chev.mbcrm-apagada { opacity: .4; }
.mbcrm-chev-n { font-size: 26px; font-weight: 500; line-height: 1.1; }
.mbcrm-chev-nome { display: flex; align-items: center; gap: 2px; font-size: 16px; font-weight: 500; }
.mbcrm-chev-nome span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mbcrm-chev-menu { border: none; background: transparent; font-size: 14px; cursor: pointer; padding: 0 4px; border-radius: 4px; }
.mbcrm-chev-menu:hover { background: rgba(0,0,0,.12); }
.mbcrm-seta { position: absolute; top: 0; bottom: 0; z-index: 50; width: 36px; border: none; background: var(--mb-chip); color: var(--mb-fg2); font-size: 24px; cursor: pointer; }
.mbcrm-seta-esq { left: 0; border-radius: 14px 0 0 14px; }
.mbcrm-seta-dir { right: 0; border-radius: 0 14px 14px 0; }
.mbcrm-seta[hidden] { display: none; }
.mbcrm-grade { overflow: auto; flex: 1 1 auto; min-height: 0; border-top: 1px solid var(--mb-borda); }
.mbcrm-tabela { border-collapse: separate; border-spacing: 0; min-width: 100%; font-size: 14px; }
.mbcrm-tabela th { position: sticky; top: 0; z-index: 3; background: var(--mb-bg); color: var(--mb-fg2); font-weight: 400; text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--mb-borda); border-right: 1px solid var(--mb-borda); white-space: nowrap; }
.mbcrm-tabela td { padding: 7px 12px; border-bottom: 1px solid var(--mb-borda); border-right: 1px solid var(--mb-borda); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--mb-bg); }
.mbcrm-tabela .mbcrm-col-nome { position: sticky; left: 0; z-index: 2; min-width: 220px; }
.mbcrm-tabela th.mbcrm-col-nome { z-index: 4; }
.mbcrm-tabela .mbcrm-col-add { border-right: none; width: 48px; padding: 0 6px; }
.mbcrm-col-nome a { color: var(--mb-fg); text-decoration: none; }
.mbcrm-col-nome a:hover { color: var(--mb-acento); text-decoration: underline; }
.mbcrm-grupo-linha td { background: var(--mb-chip); padding: 8px 12px; }
.mbcrm-grupo-linha .mbcrm-n { color: var(--mb-fg2); font-size: 12px; margin-left: 4px; }
.mbcrm-etapa-chip { font: inherit; font-size: 15px; border: none; border-radius: 6px; padding: 5px 12px; cursor: pointer; margin-right: 4px; }
.mbcrm-grupo-linha .mbcrm-icone { width: 30px; height: 30px; font-size: 18px; vertical-align: middle; }
.mbcrm-caixa-linha:hover td { background: var(--mb-chip); }
.mbcrm-editavel { cursor: pointer; }
.mbcrm-editavel:hover { box-shadow: inset 0 0 0 1px var(--mb-acento); }
.mbcrm-editavel input, .mbcrm-editavel select { width: 100%; padding: 3px 6px; }
.mbcrm-mini-chev { display: inline-block; width: 14px; height: 12px; margin-right: 8px; vertical-align: -1px; clip-path: polygon(0 0, 65% 0, 100% 50%, 65% 100%, 0 100%, 35% 50%); }
.mbcrm-add-linha td { color: var(--mb-fg2); cursor: pointer; padding-left: 14px; }
.mbcrm-add-linha td:hover { color: var(--mb-fg); }
.mbcrm-add-ativa input { width: min(520px, 100%); }
.mbcrm-coluna-ed { display: grid; grid-template-columns: minmax(0, 1fr) 120px 90px; gap: 8px; align-items: center; }
.mbcrm-suspenso { position: fixed; z-index: 2147483000; background: var(--mb-bg); border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,.2), 0 8px 24px rgba(0,0,0,.15); padding: 6px 0; min-width: 220px; display: flex; flex-direction: column; }
.mbcrm-suspenso button { font: inherit; font-size: 15px; text-align: left; border: none; background: transparent; color: var(--mb-fg); padding: 10px 20px; cursor: pointer; }
.mbcrm-suspenso button:hover { background: var(--mb-chip); }
.mbcrm-suspenso .mbcrm-perigo { color: var(--mb-erro); }
/* ---- comuns ---- */
.mbcrm-ic { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.mbcrm-titulo-fixo { font-size: 22px !important; font-weight: 400 !important; color: var(--mb-fg) !important; margin: 0 8px 0 0 !important; }
.mbcrm-cartao-cab { display: flex; align-items: center; gap: 10px; color: var(--mb-fg); }
.mbcrm-cartao-cab h3 { font-size: 16px; font-weight: 500; }
.mbcrm-linha-caixa { display: flex; align-items: center; gap: 10px; padding: 9px 8px; border-radius: 8px; color: var(--mb-fg); text-decoration: none; min-width: 0; }
a.mbcrm-linha-caixa:hover { background: var(--mb-chip); }
.mbcrm-lc-nome { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mb-fg); text-decoration: none; }
a.mbcrm-lc-nome:hover { text-decoration: underline; }
.mbcrm-lc-etapa { font-size: 12px; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.mbcrm-lc-pipe { color: var(--mb-fg2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mbcrm-lc-quando { margin-left: auto; color: var(--mb-fg2); font-size: 12px; white-space: nowrap; padding-left: 8px; }
.mbcrm-suspenso button { display: flex; align-items: center; gap: 12px; }
.mbcrm-suspenso .mbcrm-mini-chev { width: 18px; height: 16px; margin: 0; }
.mbcrm-suspenso .mbcrm-marcado { color: #3f51b5; font-weight: 500; }
.mbcrm-check { color: #3f51b5; font-size: 18px; }

/* ---- home ---- */
.mbcrm-home { gap: 16px; max-width: 1400px; }
.mbcrm-home-cartao { padding: 16px 18px; gap: 12px; border-radius: 12px; }
.mbcrm-home-grade { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
@media (max-width: 900px) { .mbcrm-home-grade { grid-template-columns: 1fr; } }
.mbcrm-rapido { display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch; }
.mbcrm-tile { width: 135px; min-height: 84px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 10px 8px; border: 1px solid var(--mb-borda); border-radius: 10px; background: var(--mb-bg); color: var(--mb-fg); font: inherit; font-size: 13px; cursor: pointer; text-align: center; }
.mbcrm-tile:hover { background: var(--mb-chip); border-color: transparent; }
.mbcrm-tile span:last-child { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.mbcrm-tile .mbcrm-ic { color: var(--mb-fg2); }
.mbcrm-divisor { width: 1px; align-self: stretch; background: var(--mb-borda); margin: 0 4px; }
.mbcrm-abas { display: flex; gap: 4px; background: var(--mb-chip); border-radius: 999px; padding: 3px; }
.mbcrm-aba { font: inherit; font-size: 13px; border: none; background: transparent; color: var(--mb-fg2); padding: 4px 12px; border-radius: 999px; cursor: pointer; }
.mbcrm-aba-ativa { background: var(--mb-bg); color: var(--mb-fg); box-shadow: 0 1px 2px rgba(0,0,0,.15); }
.mbcrm-menu-topo { padding: 6px 0; min-width: 240px; display: flex; flex-direction: column; }
.mbcrm-item-topo { display: flex; align-items: center; gap: 12px; font: inherit; font-size: 14px; text-align: left; border: none; background: transparent; color: var(--mb-fg); padding: 9px 18px; cursor: pointer; }
.mbcrm-item-topo:hover { background: var(--mb-chip); }
.mbcrm-sep { height: 1px; background: var(--mb-borda); margin: 6px 0; }

/* ---- contato / organização ---- */
.mbcrm-pessoa .mbcrm-cartao { gap: 10px; padding: 14px 16px; border-radius: 12px; }
.mbcrm-pessoa .mbcrm-cartao h3 { font-size: 15px; }
.mbcrm-pessoa .mbcrm-campo { grid-template-columns: 130px minmax(0, 1fr); }
.mbcrm-pessoa .mbcrm-campo input, .mbcrm-pessoa .mbcrm-campo textarea, .mbcrm-pessoa .mbcrm-campo select { border-color: transparent; width: 100%; }
.mbcrm-pessoa .mbcrm-campo input:hover, .mbcrm-pessoa .mbcrm-campo textarea:hover { border-color: var(--mb-borda); }

/* ---- caixa (como no Streak) ---- */
.mbcrm-caixa { padding: 8px 28px 40px; gap: 18px; }
.mbcrm-caixa .mbcrm-topo { gap: 6px; min-height: 52px; }
.mbcrm-caixa .mbcrm-topo .mbcrm-titulo { flex: 0 1 520px; font-size: 18px; font-weight: 400; padding: 4px 6px; }
.mbcrm-caixa .mbcrm-voltar { font-size: 22px; margin-right: 6px; }
.mbcrm-caixa .mbcrm-migalha { font-size: 18px; }
.mbcrm-seta-migalha { color: var(--mb-fg2); font-size: 20px; padding: 0 4px; }
.mbcrm-caixa .mbcrm-duas-colunas { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; }
.mbcrm-esq { gap: 14px; }
.mbcrm-registro { border: 1px solid var(--mb-borda); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.mbcrm-registro-texto { border: none !important; padding: 2px 0 !important; min-height: 40px !important; font-size: 15px !important; resize: vertical; }
.mbcrm-chip-sel { font-size: 13px; border: 1px solid var(--mb-borda); border-radius: 4px; padding: 3px 10px; background: var(--mb-bg); }
.mbcrm-enviar { width: 30px; height: 30px; border-radius: 50%; border: none; background: var(--mb-chip); color: var(--mb-fg2); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.mbcrm-enviar:hover { background: var(--mb-acento); color: #fff; }
.mbcrm-atalhos { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mbcrm-atalhos .mbcrm-dica { font-size: 15px; margin-right: 4px; }
.mbcrm-chip-acao { font: inherit; font-size: 14px; border: none; background: var(--mb-chip); color: var(--mb-fg); border-radius: 999px; padding: 5px 12px; cursor: pointer; }
.mbcrm-chip-acao:hover { filter: brightness(.95); }
.mbcrm-tempo { display: flex; flex-direction: column; gap: 14px; position: relative; padding-left: 4px; }
.mbcrm-tempo::before { content: ""; position: absolute; left: 19px; top: 18px; bottom: 10px; width: 2px; background: var(--mb-borda); }
.mbcrm-ev { display: flex; gap: 14px; align-items: flex-start; position: relative; }
.mbcrm-avatar { width: 30px; height: 30px; border-radius: 50%; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 500; flex: 0 0 auto; margin-top: 12px; z-index: 1; }
.mbcrm-avatar-ic { background: var(--mb-bg); color: var(--mb-fg2); border: 1px solid var(--mb-borda); }
.mbcrm-avatar-org { background: #5f6368; margin-top: 0; }
.mbcrm-ev .mbcrm-evento { flex: 1 1 auto; min-width: 0; padding: 12px 16px; border-radius: 8px; gap: 6px; }
.mbcrm-ev-comentario { border-left: 3px solid #f6bd55 !important; }
.mbcrm-evento-cab strong { font-size: 15px; font-weight: 500; }
.mbcrm-evento-texto { font-size: 15px; }
.mbcrm-ev-acoes { margin-left: auto; display: none; gap: 2px; }
.mbcrm-ev:hover .mbcrm-ev-acoes { display: inline-flex; }
.mbcrm-icone.mbcrm-mini { width: 28px; height: 28px; font-size: 15px; }
.mbcrm-ev-sistema { color: var(--mb-fg2); font-size: 14px; align-items: center; }
.mbcrm-ponto-tempo { width: 10px; height: 10px; border-radius: 50%; background: var(--mb-borda); margin: 0 10px 0 11px; z-index: 1; flex: 0 0 auto; }
.mbcrm-chip-pipe { background: var(--mb-chip); color: var(--mb-fg2); border-radius: 4px; padding: 2px 8px; font-size: 13px; }
.mbcrm-chip-etapa { border-radius: 4px; padding: 2px 8px; font-size: 13px; }
.mbcrm-dir { gap: 16px; }
.mbcrm-linha-etapa { gap: 14px; }
.mbcrm-etapa-sel { display: flex; align-items: center; gap: 10px; width: 320px; max-width: 100%; font: inherit; font-size: 16px; border: none; border-radius: 4px; padding: 9px 14px; cursor: pointer; text-align: left; }
.mbcrm-etapa-sel:hover { filter: brightness(1.05); }
.mbcrm-resumo-linha { display: flex; align-items: center; gap: 10px; border: 1px solid #7986cb; border-radius: 4px; padding: 16px 20px; font-size: 15px; min-width: 0; }
.mbcrm-resumo-texto { color: var(--mb-fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mbcrm-secao2 { border: 1px solid var(--mb-borda); border-radius: 4px; }
.mbcrm-secao-cab { display: flex; align-items: center; gap: 14px; padding: 16px 20px; cursor: pointer; user-select: none; }
.mbcrm-secao-cab strong { font-size: 15px; font-weight: 500; }
.mbcrm-secao-seta { color: var(--mb-fg2); font-size: 18px; width: 24px; text-align: center; }
.mbcrm-secao-corpo { padding: 0 20px 18px; display: flex; flex-direction: column; gap: 12px; }
.mbcrm-cp-grade { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(0, 1.2fr) minmax(110px, 1fr) minmax(0, 1.2fr); gap: 10px 14px; align-items: center; }
@media (max-width: 1300px) { .mbcrm-cp-grade { grid-template-columns: minmax(110px, 1fr) minmax(0, 2fr); } }
.mbcrm-cp-rotulo { color: var(--mb-fg2); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mbcrm-cp-valor { font-size: 14px; min-height: 28px; display: flex; align-items: center; border-radius: 4px; padding: 2px 4px; min-width: 0; }
.mbcrm-cp-valor select, .mbcrm-cp-valor input { width: 100%; }
.mbcrm-chip-valor-lista { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.mbcrm-chip-valor { background: var(--mb-chip); border-radius: 4px; padding: 2px 8px; font-size: 13px; }
.mbcrm-vazio-campo { color: var(--mb-fg2); }
.mbcrm-link-acao { color: #3f51b5; text-decoration: none; font-size: 15px; font-weight: 500; padding: 4px 0; }
.mbcrm-link-acao:hover { text-decoration: underline; }
.mbcrm-busca-caixa { display: flex; align-items: center; gap: 12px; border-radius: 6px; padding: 4px 6px; }
.mbcrm-busca-caixa:focus-within { box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.mbcrm-mais-azul { color: #3f51b5; font-size: 22px; }
.mbcrm-busca-pessoa { flex: 1 1 auto; border: none !important; font-size: 15px !important; color: #3f51b5; padding: 6px 0 !important; }
.mbcrm-busca-pessoa::placeholder { color: #3f51b5; opacity: 1; font-weight: 500; }
.mbcrm-busca-pessoa:focus::placeholder { color: var(--mb-fg2); font-weight: 400; }
.mbcrm-contato { border-bottom: none; gap: 12px; }
.mbcrm-contato .mbcrm-avatar { margin-top: 0; }
.mbcrm-contato a { color: var(--mb-fg); text-decoration: none; }
.mbcrm-contato a:hover { text-decoration: underline; }
.mbcrm-notas { border: none !important; padding: 0 !important; font-size: 15px !important; min-height: 60px !important; }
.mbcrm-notas:focus { border: 1px solid var(--mb-borda) !important; padding: 6px 8px !important; }
.mbcrm-zap { border-left: 3px solid #25d366; }
.mbcrm-zap-ic { font-size: 18px; }
.mbcrm-zap-arquivo { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--mb-borda); }
.mbcrm-zap-arquivo .mbcrm-rotulo { font-size: 12px; color: var(--mb-fg2); margin-bottom: 4px; }
.mbcrm-zap-anexo { display: block; margin-top: 6px; font-size: 13px; }
.mbcrm-zap-mini { display: flex; gap: 8px; align-items: flex-start; margin: -4px 0 6px 42px; padding: 6px 10px; border-radius: 6px; background: var(--mb-chip); font-size: 13px; }
.mbcrm-zap-mini .mbcrm-cresce { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mbcrm-sem-quebra { flex-wrap: nowrap; }
.mbcrm-sem-quebra > input { flex: 1 1 auto; }
.mbcrm-evento-texto a, .mbcrm-dica a { color: var(--mb-acento); }
.mbcrm-atalho { width: 36px; height: 36px; border-radius: 50%; border: none; background: var(--mb-chip); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.mbcrm-atalho:hover { filter: brightness(.93); }
.mbcrm-filtro-ativo { color: var(--mb-acento); background: var(--mb-chip); }
.mbcrm-ev-arquivo { border-left: 3px solid #9aa0a6 !important; }
.mbcrm-soltar { outline: 2px dashed var(--mb-acento); outline-offset: 6px; border-radius: 8px; }
.mbcrm-linha-etapa { flex-wrap: nowrap; align-items: flex-start; }
.mbcrm-resps { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 40px; padding: 4px 6px; border-radius: 6px; flex: 1 1 auto; min-width: 0; cursor: text; }
.mbcrm-resps:focus-within { box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.mbcrm-resp { display: inline-flex; align-items: center; gap: 8px; background: var(--mb-chip); border-radius: 16px; padding: 3px 6px 3px 3px; max-width: 240px; }
.mbcrm-resp-nome { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mbcrm-resp-x { border: none; background: transparent; color: var(--mb-fg2); cursor: pointer; font-size: 15px; padding: 0 2px; }
.mbcrm-resp-x:hover { color: var(--mb-fg); }
.mbcrm-avatar-p { width: 26px; height: 26px; margin: 0; font-size: 13px; }
.mbcrm-resp-input { border: none !important; padding: 4px !important; min-width: 120px; flex: 1 1 120px; font-size: 14px !important; }
.mbcrm-resps-mini { display: inline-flex; }
.mbcrm-resps-mini .mbcrm-avatar-p { width: 22px; height: 22px; font-size: 11px; margin-right: -4px; border: 2px solid var(--mb-bg); }
.mbcrm-resumo-cartao { border: 1px solid #7986cb; border-radius: 4px; }
.mbcrm-resumo-cab { display: flex; align-items: center; gap: 12px; padding: 16px 20px; cursor: pointer; min-width: 0; font-size: 15px; }
.mbcrm-resumo-cab strong { font-weight: 500; white-space: nowrap; }
.mbcrm-gerando .mbcrm-resumo-cab .mbcrm-ic { animation: mbcrm-pulso 1.2s ease-in-out infinite; }
@keyframes mbcrm-pulso { 50% { opacity: .35; } }
.mbcrm-resumo-corpo { padding: 0 24px 4px; font-size: 15px; line-height: 1.5; }
.mbcrm-resumo-corpo p { margin: 0 0 12px; }
.mbcrm-resumo-rodape { display: flex; align-items: center; gap: 6px; margin: 0 20px; padding: 10px 0 12px; border-top: 1px solid var(--mb-borda); }
.mbcrm-clicavel { cursor: pointer; }
.mbcrm-clicavel:hover { filter: brightness(.92); text-decoration: underline; }
.mbcrm-google { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border: 1px solid var(--mb-borda); border-radius: 8px; padding: 8px 12px; }
.mbcrm-google-logo { display: inline-flex; }
.mbcrm-wa-id { font: inherit; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; border: 1px solid #25d36655; background: #25d3661a; color: var(--mb-fg); border-radius: 6px; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.mbcrm-wa-id:hover { background: #25d36633; }
.mbcrm-pl-cel { display: inline-flex; align-items: center; gap: 6px; }
.mbcrm-add-pl { font: inherit; font-size: 12px; border: 1px dashed var(--mb-borda); background: transparent; color: var(--mb-acento); border-radius: 6px; padding: 1px 8px; cursor: pointer; white-space: nowrap; opacity: .75; }
.mbcrm-caixa-linha:hover .mbcrm-add-pl, .mbcrm-add-pl:focus { opacity: 1; }
.mbcrm-add-pl:hover { background: var(--mb-chip); }
.mbcrm-th-menu { font: inherit; color: inherit; background: transparent; border: none; padding: 0; cursor: pointer; white-space: nowrap; }
.mbcrm-th-menu:hover { color: var(--mb-fg); }
.mbcrm-th-seta { opacity: .5; font-size: 11px; }
.mbcrm-th-menu:hover .mbcrm-th-seta { opacity: 1; }
.mbcrm-th-ativo { color: var(--mb-acento) !important; font-weight: 500; }
.mbcrm-th-ativo .mbcrm-th-seta { opacity: 1; }
.mbcrm-chips-filtro { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.mbcrm-chips-filtro:empty { display: none; }
.mbcrm-chip-filtro { display: inline-flex; align-items: center; gap: 4px; background: var(--mb-chip); border: 1px solid var(--mb-borda); border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 12px; }
.mbcrm-chip-filtro button { border: none; background: transparent; color: var(--mb-fg2); cursor: pointer; font-size: 14px; padding: 0 4px; }
.mbcrm-chip-filtro button:hover { color: var(--mb-fg); }
`;
export function injetarEstilos(): void {
  if (document.getElementById("mbcrm-css") !== null) return;
  const s = document.createElement("style"); s.id = "mbcrm-css"; s.textContent = CSS; document.head.append(s);
}
