import type { NetState } from "../../shared/ipc";
import { byId as $ } from "../lib/dom.js";
import { offlineBarText } from "../lib/offline-text.js";
import { ctx } from "./ctx.js";

/* ---------- Internet deste Mac: faixa OFFLINE (como no Rambox), para a pessoa saber que o problema é na conexão dela ---------- */
const offlineBar = $<HTMLElement>("offline-bar");
const offlineText = $<HTMLElement>("offline-text");
const offlineCheck = $<HTMLButtonElement>("offline-check");
export let net: NetState = { online: null, checking: false, since: null, checkedAt: null };
/** Última vez que a pessoa clicou em "Verificar agora" (a faixa diz "ainda sem internet (verificado agora)"). */
let netManualAt: number | null = null;
let netTick: ReturnType<typeof setInterval> | null = null;
export function paintNet(): void {
  const off = net.online === false;
  offlineBar.hidden = !off;
  if (off) {
    offlineText.textContent = offlineBarText({ localAddr: ctx.hostLocalAddr, checking: net.checking, since: net.since, checkedAt: net.checkedAt, manual: netManualAt !== null && net.checkedAt !== null && net.checkedAt >= netManualAt, now: Date.now() });
    offlineCheck.disabled = net.checking;
    offlineCheck.textContent = net.checking ? "verificando…" : "Verificar agora";
  }
  // "há N min" precisa andar enquanto a faixa está à vista; online, nenhum timer.
  if (off && netTick === null) netTick = setInterval(paintNet, 30_000);
  if (!off && netTick !== null) { clearInterval(netTick); netTick = null; }
  const tab = ctx.active();
  ctx.paintStatus(tab !== null ? tab.host : null);
}
export function setNet(st: NetState): void {
  const was = net.online;
  net = st;
  paintNet();
  if (was === false && st.online === true) {
    netManualAt = null;
    const tab = ctx.active();
    if (tab !== null) ctx.addNotice(tab, ctx.hostLocalAddr ? "✓ internet de volta; o Claude já responde de novo." : "✓ internet de volta; reabrindo o túnel da máquina…", "info");
  }
}

/** Liga eventos e o estado inicial desta parte; o renderer.ts chama uma vez, no ponto em que isto rodava antes. */
export function ligarRede(): void {
  window.meuBot.on("net:state", setNet);
  // A interface de rede caiu/voltou (Wi-Fi desligado): reação imediata; a sondagem do main confirma.
  window.addEventListener("offline", () => { void window.meuBot.netCheck(true).then(setNet).catch(() => { /* a sondagem periódica cobre */ }); });
  window.addEventListener("online", () => { void window.meuBot.netCheck(true).then(setNet).catch(() => { /* idem */ }); });
  offlineCheck.addEventListener("click", () => {
    netManualAt = Date.now(); offlineCheck.disabled = true; offlineCheck.textContent = "verificando…";
    void window.meuBot.netCheck(true).then(setNet).catch(() => { offlineCheck.disabled = false; offlineCheck.textContent = "Verificar agora"; });
  });
}
