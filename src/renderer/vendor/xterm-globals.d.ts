/** xterm.js e addons entram como UMD por <script src> (ver scripts/vendor.mjs): globais com os tipos dos pacotes. */
import type * as XTerm from "@xterm/xterm";
import type * as Fit from "@xterm/addon-fit";
import type * as Webgl from "@xterm/addon-webgl";
import type * as WebLinks from "@xterm/addon-web-links";
import type * as Search from "@xterm/addon-search";
import type * as Unicode11 from "@xterm/addon-unicode11";

declare global {
  interface Window {
    /** No navegador o UMD do xterm põe a própria classe em window.Terminal; em Node, o namespace { Terminal }. */
    Terminal: typeof XTerm.Terminal | typeof XTerm;
    FitAddon: typeof Fit;
    WebglAddon: typeof Webgl;
    WebLinksAddon: typeof WebLinks;
    SearchAddon: typeof Search;
    Unicode11Addon: typeof Unicode11;
  }
}
export {};
