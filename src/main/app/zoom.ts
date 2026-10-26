/**
 * Aplica o zoom da janela: um nível só para todas as janelas principais (o Chromium propaga zoom entre
 * páginas da mesma origem, e todas carregam o mesmo index.html), guardado em settings.json e reaplicado ao
 * abrir cada janela (windows.ts). Avisa o renderer por "window:zoom-changed" (toast, rodapé, Configurações).
 */
import { getZoomLevel, setZoomLevel } from "./settings";
import { allMainWindows, broadcast } from "./windows";
import { applyZoomAction, zoomState } from "./zoom-core";
import type { ZoomAction, ZoomState } from "../../shared/ipc";

export const currentZoom = (): ZoomState => zoomState(getZoomLevel());

/** Muda o nível (passo, valor ou volta a 100%), aplica em todas as janelas principais e persiste. */
export function changeWindowZoom(action: ZoomAction): ZoomState {
  const next = applyZoomAction(getZoomLevel(), action);
  setZoomLevel(next);
  const st = zoomState(next);
  for (const win of allMainWindows()) if (!win.isDestroyed()) win.webContents.setZoomLevel(st.level);
  broadcast("window:zoom-changed", st);
  return st;
}
