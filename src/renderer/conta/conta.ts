/**
 * Conta meu-bot deste Mac, lado da tela: guarda a última ContaView que o main mandou, avisa quem desenha com ela
 * (painel "Sua conta" das Configurações, bloqueio Pro do Navegador) e monta o bloco "Entrar / e-mail · Sair".
 */
import type { ContaView } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";

let view: ContaView | null = null;
const ouvintes = new Set<() => void>();
export const contaAtual = (): ContaView | null => view;
export const contaEntrou = (): boolean => view !== null && view.situacao === "dentro";
export function aoMudarConta(cb: () => void): () => void { ouvintes.add(cb); return () => ouvintes.delete(cb); }
const mudou = (v: ContaView): void => { view = v; for (const cb of ouvintes) cb(); };
/** Na abertura: pega a conta e passa a receber as mudanças. */
export function ligarConta(): void {
  window.meuBot.on("conta:changed", mudou);
  void window.meuBot.contaGet().then(mudou).catch(() => undefined);
}

/** O bloco da conta para o painel "Sua conta": botão Entrar, "aguardando o navegador", ou e-mail com Sair. */
export function blocoConta(): HTMLElement {
  const box = el("div", "conta-bloco");
  const pinta = (): void => {
    box.replaceChildren();
    const c = view;
    if (c === null) { box.append(el("p", "hint", "Lendo a conta…")); return; }
    if (c.situacao === "dentro" && c.conta !== null) {
      const linha = el("p", "", "");
      linha.append(el("strong", "", c.conta.email), document.createTextNode(c.conta.nome !== null ? ` · ${c.conta.nome}` : ""), document.createTextNode(c.conta.admin !== null ? " · admin" : ""));
      const sair = el("button", "btn btn-ghost", "Sair"); sair.type = "button";
      sair.addEventListener("click", () => { sair.disabled = true; void window.meuBot.contaSair().then(mudou).catch((err: unknown) => { sair.disabled = false; box.append(el("p", "error", `Não consegui sair: ${ipcErrorText(err)}`)); }); });
      const acoes = el("div", "actions"); acoes.append(sair);
      const este = c.conta.devices.find((d) => d.este);
      box.append(linha, el("p", "hint", `Plano da conta: ${c.conta.licenca.plan === "pro" ? "Pro" : "Free"} · ${c.conta.devices.length} device${c.conta.devices.length === 1 ? "" : "s"}${c.conta.pedidos > 0 ? ` · ${c.conta.pedidos} pedido${c.conta.pedidos === 1 ? "" : "s"} aberto${c.conta.pedidos === 1 ? "" : "s"}` : ""}. Nesta versão a licença da máquina ainda vem do backend dela.`));
      if (este !== undefined && este.status === "pending") box.append(el("p", "error", `Este Mac aguarda a liberação do admin: a conta já usa ${c.conta.licenca.deviceLimit} device${c.conta.licenca.deviceLimit === 1 ? "" : "s"}.`));
      box.append(acoes);
      return;
    }
    if (c.situacao === "entrando") {
      const cancelar = el("button", "btn btn-ghost", "Cancelar"); cancelar.type = "button";
      cancelar.addEventListener("click", () => { void window.meuBot.contaCancelar().then(mudou).catch(() => undefined); });
      const acoes = el("div", "actions"); acoes.append(cancelar);
      box.append(el("p", "", "Aguardando o login no navegador…"), el("p", "hint", `A página ${c.urlLogin.replace(/^https:\/\//, "")} abriu no seu navegador. Entre com o Google ou peça o link por e-mail; o app volta sozinho quando terminar.`), acoes);
      return;
    }
    const entrar = el("button", "btn btn-primary", "Entrar com Google ou e-mail"); entrar.type = "button";
    entrar.addEventListener("click", () => { entrar.disabled = true; void window.meuBot.contaEntrar().then(mudou).catch((err: unknown) => { entrar.disabled = false; box.append(el("p", "error", `Não consegui abrir o login: ${ipcErrorText(err)}`)); }); });
    const acoes = el("div", "actions"); acoes.append(entrar);
    box.append(el("p", "", "Você ainda não entrou com sua conta meu-bot neste Mac."), el("p", "hint", "O login abre no seu navegador e volta para o app sozinho. O plano free continua funcionando sem conta."));
    if (c.situacao === "erro" && c.erro !== null) box.append(el("p", "error", `O último login não terminou: ${c.erro}`));
    box.append(acoes);
  };
  pinta();
  // Enquanto o bloco está na tela, repinta a cada mudança (o deep link chega com o painel aberto).
  const solta = aoMudarConta(() => { if (box.isConnected) pinta(); else solta(); });
  return box;
}
