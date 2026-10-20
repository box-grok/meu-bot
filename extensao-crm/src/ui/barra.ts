/** Botões de toolbar: "Adicionar ao pipeline" (thread/linha/seleção) e "CRM" (atalho aos pipelines na lista). */
import type { InboxSDK, ThreadRowView, ThreadView } from "@inboxsdk/core";
import type { Estado } from "../estado.ts";
import { ROTA_CAIXA, ROTA_INICIO, ROTA_PIPELINE, normThreadId, threadIdValido } from "../rotas.ts";
import { T } from "../textos.ts";
import { h, limpar } from "./h.ts";
import { escolherPipeline, formularioNovaCaixa } from "./painel-thread.ts";
import { textoDoErro } from "./avisos.ts";

const ICONE = (): string => chrome.runtime.getURL("icones/crm-16.png");
async function threadsDe(tvs: ThreadView[], rows: ThreadRowView[]): Promise<{ gid: string; assunto: string; emails: string[]; nomes: string[] }[]> {
  const out: { gid: string; assunto: string; emails: string[]; nomes: string[] }[] = [];
  for (const tv of tvs) { const id = await tv.getThreadIDAsync(); if (threadIdValido(id)) out.push({ gid: normThreadId(id), assunto: tv.getSubject(), emails: [], nomes: [] }); }
  for (const r of rows) { const id = await r.getThreadIDIfStableAsync(); if (id !== null && threadIdValido(id)) out.push({ gid: normThreadId(id), assunto: r.getSubject(), emails: r.getContacts().map((c) => c.emailAddress), nomes: r.getContacts().map((c) => c.name) }); }
  return out;
}

export function registrarBarra(sdk: InboxSDK, estado: Estado, tema: () => string): void {
  sdk.Toolbars.registerThreadButton({
    title: T.adicionarAoPipeline, iconUrl: ICONE(), positions: ["THREAD", "ROW", "LIST"], hasDropdown: true, orderHint: 0,
    onClick: (ev) => {
      const el = ev.dropdown?.el; if (!el) return;
      const root = h("div", { class: `mbcrm mbcrm-menu ${tema()}` }, h("div", { class: "mbcrm-dica" }, T.carregando)); el.append(root);
      void (async () => {
        const ts = await threadsDe(ev.selectedThreadViews, ev.selectedThreadRowViews);
        if (ts.length === 0) { limpar(root); root.append(h("div", { class: "mbcrm-dica" }, "Selecione uma conversa.")); return; }
        const primeira = ts[0] as (typeof ts)[number];
        const atual = await estado.caixaDaThread(primeira.gid).catch(() => null);
        limpar(root);
        if (atual !== null && ts.length === 1) { root.append(h("div", { class: "mbcrm-dica" }, T.jaEstaEm(atual.name)), h("button", { class: "mbcrm-btn mbcrm-pequeno", onClick: () => { ev.dropdown?.close(); void sdk.Router.goto(ROTA_CAIXA, { key: atual.key }); } }, T.abrirCaixa)); return; }
        root.append(h("h2", null, ts.length === 1 ? T.adicionarAoPipeline : `${T.adicionarAoPipeline} (${ts.length})`));
        const alvo = h("div", null); root.append(alvo);
        await escolherPipeline(sdk, estado, alvo, (p) => {
          ev.dropdown?.close();
          void formularioNovaCaixa(sdk, estado, p, primeira, (b) => { void (async () => { for (const t of ts.slice(1)) { try { await estado.vincularThread(b.key, { threadGmailId: t.gid, assunto: t.assunto, emails: t.emails, nomes: t.nomes }); } catch (e) { sdk.ButterBar.showError({ text: T.erro(textoDoErro(e)), time: 5000 }); } } })(); });
        });
      })();
    },
  });
  // Entrada "CRM" na lista: sobrevive aos recortes que escondem o menu esquerdo do Gmail.
  sdk.Toolbars.registerThreadButton({
    title: T.crm, iconUrl: ICONE(), positions: ["LIST"], hasDropdown: true, orderHint: 1,
    onClick: (ev) => {
      const el = ev.dropdown?.el; if (!el) return;
      const root = h("div", { class: `mbcrm mbcrm-menu ${tema()}` }); el.append(root);
      void escolherPipeline(sdk, estado, root, (p) => { ev.dropdown?.close(); void sdk.Router.goto(ROTA_PIPELINE, { key: p.key }); }).then(() => { root.append(h("a", { href: "#", onClick: (e: Event) => { e.preventDefault(); ev.dropdown?.close(); void sdk.Router.goto(ROTA_INICIO); } }, "Início do CRM · novo pipeline")); });
    },
  });
}
