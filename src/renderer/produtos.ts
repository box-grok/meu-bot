/** Janela Produtos do meu-bot-admin: só monta a vista (admin/produtos-page.ts) sobre window.produtos. */
import { byId } from "./lib/dom.js";
import { mountProdutosView } from "./admin/produtos-page.js";

const api = window.produtos;
const vista = mountProdutosView({ container: byId<HTMLElement>("pr-lista"), api, catalogo: () => api.catalogo() });
byId<HTMLButtonElement>("pr-novo").addEventListener("click", () => { vista.novo(); byId<HTMLElement>("pr-lista").scrollTo({ top: 0 }); });
void vista.refresh();
