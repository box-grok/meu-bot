/**
 * Ponte das notificações das páginas do Navegador (do REA do Rambox: `injected.js` troca `window.Notification` por
 * uma classe que manda título/corpo/ícone ao app por `window.rambox.sendNotificationToApp`). Aqui a ponte é só
 * isto: `window.meuBotNav.notify(payload)` → `ipcRenderer.sendToHost("nav:notification")`, que chega ao
 * <webview> da janela (evento `ipc-message`). O substituto de `Notification` em si o renderer injeta no mundo da
 * página (`NAV_NOTIFY_JS`), porque este preload roda no mundo isolado. Registrado por `session.registerPreloadScript`
 * (tipo "frame") na partição do Navegador; só age em páginas http(s), nunca em extensões.
 */
import { contextBridge, ipcRenderer } from "electron";

(() => {
  const loc = (globalThis as { location?: { protocol?: string } }).location; // sem lib DOM no tsconfig do main
  if (loc === undefined || !/^https?:$/.test(loc.protocol ?? "")) return;
  try {
    contextBridge.exposeInMainWorld("meuBotNav", {
      notify: (n: unknown): void => { try { ipcRenderer.sendToHost("nav:notification", n); } catch { /* host fechou */ } },
    });
  } catch { /* contexto sem contextBridge: sem notificações desta página */ }
})();
