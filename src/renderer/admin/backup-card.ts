/**
 * Variante: admin. Cartão "Backup e mudança de máquina" da página Suporte de uma pessoa: fazer o backup completo
 * (com a permissão dela), a lista dos backups e, no app do super admin, restaurar um backup NESTA máquina e depois
 * trocar o WhatsApp para ela. O nó é um só (a página re-anexa a cada render); o estado fica aqui.
 */
import type { BackupIndiceView, BackupRestauracao, MeuBotApi } from "../../shared/ipc";
import { el } from "../lib/dom.js";
import { ipcErrorText } from "../lib/ipc-error.js";

export interface BackupCardDeps {
  api: Pick<MeuBotApi, "adminBackupListar" | "adminBackupCriar" | "adminBackupConferir" | "adminBackupRestaurar" | "adminBackupWhatsapp" | "on">;
  armConfirm(btn: HTMLButtonElement, label: string, run: () => void): void;
  /** Quem é a pessoa desta janela (para os textos). */
  who: string;
}
const mb = (n: number): string => `${(n / 1048576).toFixed(n > 100 * 1048576 ? 0 : 1)} MB`;
const quando = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); };

export function mountBackupCard(deps: BackupCardDeps): { el: HTMLElement; refresh(permitido: boolean): void } {
  const card = el("div", "admin-card");
  let permitido = false;
  let doDestino: BackupIndiceView[] = []; let todos: BackupIndiceView[] = [];
  let podeRestaurar = false; let podeCriar = false; let carregado = false;
  let busy: "criar" | "conferir" | "restaurar" | "whatsapp" | null = null;
  let bytes = 0; let linhas: string[] = []; let msg: { text: string; bad: boolean } | null = null;
  let escolhido = ""; let substituir = false; let pre: BackupRestauracao | null = null; let restaurado = "";
  deps.api.on("admin:backup-progress", (p) => { if (typeof p.bytes === "number") bytes = p.bytes; if (typeof p.line === "string") linhas.push(p.line); if (busy !== null) desenhar(); });

  async function carregar(): Promise<void> {
    try {
      const daqui = await deps.api.adminBackupListar(); doDestino = daqui.backups; podeRestaurar = daqui.podeRestaurar; podeCriar = daqui.podeCriar;
      todos = podeRestaurar ? (await deps.api.adminBackupListar(true)).backups : [];
    } catch (err) { msg = { text: ipcErrorText(err), bad: true }; }
    carregado = true; desenhar();
  }
  function desenhar(): void {
    card.replaceChildren(el("strong", "", "Backup e mudança de máquina"));
    card.append(el("p", "hint", "Leva tudo o que é dela nesta máquina (WhatsApp, conversas e memória do agente, CRM, logins, licença) para outra. O pacote fica cifrado e só o super admin abre."));
    // Fazer backup
    const acoes = el("div", "admin-actions");
    const criar = el("button", "btn btn-ghost btn-small", busy === "criar" ? `Copiando… ${mb(bytes)}` : "Fazer backup agora"); criar.type = "button";
    criar.disabled = busy !== null || !permitido || !podeCriar;
    criar.title = !permitido ? `${deps.who} ainda não liberou o backup (Configurações › Suporte, no meu-bot dela)` : !podeCriar ? "este meu-bot-admin não tem o destinatário de backup (suporte-setup)" : "O gateway e o backend param por ~1 min durante a cópia";
    criar.addEventListener("click", () => deps.armConfirm(criar, "Confirmar? o WhatsApp dela fica fora ~1 min", () => {
      busy = "criar"; bytes = 0; msg = null; desenhar();
      void deps.api.adminBackupCriar().then((b) => { msg = { text: `✓ backup de ${b.arquivos} arquivos (${mb(b.tamanho)} cifrado) guardado neste Mac`, bad: false }; })
        .catch((err: unknown) => { msg = { text: ipcErrorText(err), bad: true }; }).finally(() => { busy = null; void carregar(); });
    }));
    acoes.append(criar);
    card.append(acoes);
    if (!permitido) card.append(el("p", "hint", `${deps.who} precisa ligar "Permitir backup completo pelo admin" em Configurações › Suporte.`));
    if (doDestino.length > 0) {
      card.append(el("p", "hint strong-hint", "Backups desta máquina"));
      const ul = el("ul", "support-log");
      for (const b of doDestino) ul.append(el("li", "", `${quando(b.criadoEm)} · ${b.arquivos} arquivos · ${mb(b.tamanho)} · por ${b.por}`));
      card.append(ul);
    } else if (carregado) card.append(el("p", "hint", "Nenhum backup desta máquina ainda."));
    // Restaurar aqui (super admin)
    if (podeRestaurar) {
      const outros = todos.filter((b) => !doDestino.some((x) => x.arquivo === b.arquivo));
      card.append(el("p", "hint strong-hint", "Restaurar um backup NESTA máquina (mudança)"));
      if (outros.length === 0) card.append(el("p", "hint", "Nenhum backup de outra máquina neste Mac."));
      else {
        const sel = el("select") as HTMLSelectElement;
        sel.append(Object.assign(el("option", "", "escolha o backup…") as HTMLOptionElement, { value: "" }));
        for (const b of outros) { const o = el("option", "", `${b.pessoa} · ${quando(b.criadoEm)} · ${b.usuario} · ${mb(b.tamanho)}`) as HTMLOptionElement; o.value = b.arquivo; o.selected = b.arquivo === escolhido; sel.append(o); }
        sel.disabled = busy !== null;
        sel.addEventListener("change", () => { escolhido = sel.value; pre = null; linhas = []; restaurado = ""; desenhar(); if (escolhido !== "") void conferir(); });
        const sub = el("label", "switch switch-row"); const cb = el("input"); cb.type = "checkbox"; cb.checked = substituir; cb.disabled = busy !== null;
        cb.addEventListener("change", () => { substituir = cb.checked; if (escolhido !== "") void conferir(); });
        sub.append(cb, el("span", "track"), el("span", "switch-label", "substituir o WhatsApp que já estiver pareado aqui"));
        card.append(sel, sub);
        if (busy === "conferir") card.append(el("p", "hint", "Conferindo esta máquina…"));
        if (pre !== null) {
          for (const x of pre.bloqueios) card.append(el("p", "hint guide-pair-note", `✗ ${x}`));
          for (const x of pre.avisos) card.append(el("p", "hint", `• ${x}`));
          const rest = el("button", "btn btn-bad btn-small", busy === "restaurar" ? "Restaurando…" : "Restaurar aqui"); rest.type = "button";
          rest.disabled = busy !== null || pre.bloqueios.length > 0;
          rest.addEventListener("click", () => deps.armConfirm(rest, "Confirmar? o que há aqui vai para uma pasta de reserva", () => {
            busy = "restaurar"; linhas = []; msg = null; desenhar();
            void deps.api.adminBackupRestaurar(escolhido, substituir).then(() => { restaurado = escolhido; msg = { text: "✓ restaurado; o WhatsApp continua desligado aqui até a troca", bad: false }; })
              .catch((err: unknown) => { msg = { text: ipcErrorText(err), bad: true }; }).finally(() => { busy = null; desenhar(); });
          }));
          card.append(rest);
        }
        if (restaurado !== "") {
          const antiga = el("label", "switch switch-row"); const ab = el("input"); ab.type = "checkbox"; ab.id = "backup-antiga";
          antiga.append(ab, el("span", "track"), el("span", "switch-label", "a máquina antiga já está desligada (se ela não estiver mais no suporte)"));
          const troca = el("button", "btn btn-primary btn-small", busy === "whatsapp" ? "Trocando…" : "Trocar o WhatsApp para esta máquina"); troca.type = "button"; troca.disabled = busy !== null;
          troca.addEventListener("click", () => deps.armConfirm(troca, "Confirmar? desliga na antiga e liga aqui", () => {
            busy = "whatsapp"; msg = null; desenhar();
            void deps.api.adminBackupWhatsapp(restaurado, ab.checked).then((r) => { linhas.push(...r.log); msg = { text: "✓ o WhatsApp agora responde nesta máquina", bad: false }; })
              .catch((err: unknown) => { msg = { text: ipcErrorText(err), bad: true }; }).finally(() => { busy = null; desenhar(); });
          }));
          card.append(antiga, troca);
        }
      }
    }
    if (linhas.length > 0) { const ul = el("ul", "support-log"); for (const l of linhas.slice(-30)) ul.append(el("li", "", l)); card.append(ul); }
    if (msg !== null) card.append(el("p", `hint ${msg.bad ? "guide-pair-note" : "audio-ok"}`, msg.text));
  }
  async function conferir(): Promise<void> {
    busy = "conferir"; pre = null; desenhar();
    try { pre = await deps.api.adminBackupConferir(escolhido, substituir); } catch (err) { msg = { text: ipcErrorText(err), bad: true }; }
    busy = null; desenhar();
  }
  return { el: card, refresh: (p) => { const mudou = p !== permitido || !carregado; permitido = p; if (mudou && busy === null) void carregar(); else desenhar(); } };
}
