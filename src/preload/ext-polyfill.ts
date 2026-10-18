/**
 * Polyfill mínimo das APIs chrome.* que o Electron não oferece a extensões (service worker MV3 e páginas da
 * extensão, como o popup). Sem isto, extensões como o Streak morrem na primeira linha
 * (`chrome.permissions.onAdded` é undefined → TypeError) e nada mais roda. Aqui só se cria o que falta, com
 * eventos inertes e promessas que resolvem vazio; o que o Electron já tem fica intocado. Registrado por
 * `session.registerPreloadScript` (tipos "service-worker" e "frame"); em frames, só age em chrome-extension://.
 * Sem imports: roda em sandbox, nos dois contextos.
 */
(() => {
  const g = globalThis as unknown as { chrome?: Record<string, unknown>; location?: { protocol?: string }; ServiceWorkerGlobalScope?: unknown };
  const isWorker = typeof g.ServiceWorkerGlobalScope !== "undefined";
  const chrome = g.chrome;
  // Content script (mundo isolado de uma página comum): o Electron dá chrome.runtime/storage/i18n, mas não
  // chrome.extension, e extensões como o Streak testam `chrome.extension` para decidir se há background para falar.
  const isContent = !isWorker && g.location?.protocol !== "chrome-extension:" && typeof (chrome?.["runtime"] as { id?: unknown } | undefined)?.id === "string";
  if (!isWorker && !isContent && g.location?.protocol !== "chrome-extension:") return;
  // Marcador no console (o main registra erros dos service workers): confirma em que contexto o polyfill rodou.
  try { console.error(`meu-bot polyfill: ${isWorker ? "service worker" : isContent ? "content script" : "frame"}; chrome=${chrome === undefined ? "undefined" : Object.keys(chrome).sort().join(",").slice(0, 200)}`); } catch { /* ignore */ }
  if (chrome === undefined || chrome === null || typeof chrome !== "object") return;

  const event = (): unknown => ({ addListener: () => undefined, removeListener: () => undefined, hasListener: () => false, hasListeners: () => false, dispatch: () => undefined });
  const resolve = (value: unknown) => (...args: unknown[]) => { const cb = args.find((a) => typeof a === "function") as ((v: unknown) => void) | undefined; if (cb) { try { cb(value); } catch { /* ignore */ } } return Promise.resolve(value); };
  const ensure = (nsName: string, members: Record<string, unknown>): void => {
    let ns = chrome[nsName] as Record<string, unknown> | undefined;
    if (ns === undefined || ns === null || typeof ns !== "object") { ns = {}; try { chrome[nsName] = ns; } catch { return; } }
    for (const [k, v] of Object.entries(members)) { if (ns[k] === undefined) { try { ns[k] = v; } catch { /* só leitura */ } } }
  };

  const runtime = chrome["runtime"] as { getURL?: (p: string) => string } | undefined;
  ensure("extension", { getURL: (p: string) => (runtime?.getURL ? runtime.getURL(p) : p), inIncognitoContext: false, isAllowedIncognitoAccess: resolve(false), isAllowedFileSchemeAccess: resolve(false), getViews: () => [], getBackgroundPage: () => null, ViewType: { TAB: "tab", POPUP: "popup" } });
  if (isContent) return; // o resto é para o service worker e as páginas da extensão
  ensure("permissions", { onAdded: event(), onRemoved: event(), contains: resolve(true), request: resolve(true), remove: resolve(true), getAll: resolve({ permissions: [], origins: [] }) });
  ensure("declarativeNetRequest", {
    getDynamicRules: resolve([]), getSessionRules: resolve([]), updateDynamicRules: resolve(undefined), updateSessionRules: resolve(undefined),
    getEnabledRulesets: resolve([]), updateEnabledRulesets: resolve(undefined), getAvailableStaticRuleCount: resolve(0), getMatchedRules: resolve({ rulesMatchedInfo: [] }),
    setExtensionActionOptions: resolve(undefined), isRegexSupported: resolve({ isSupported: false }), onRuleMatchedDebug: event(),
    MAX_NUMBER_OF_DYNAMIC_RULES: 30000, MAX_NUMBER_OF_SESSION_RULES: 5000, GUARANTEED_MINIMUM_STATIC_RULES: 30000,
  });
  ensure("runtime", { onMessageExternal: event(), onUpdateAvailable: event(), onConnectExternal: event(), onRestartRequired: event(), setUninstallURL: resolve(undefined), requestUpdateCheck: resolve({ status: "no_update" }), getContexts: resolve([]), openOptionsPage: resolve(undefined) });
  ensure("tabs", { onUpdated: event(), onCreated: event(), onRemoved: event(), onActivated: event(), onReplaced: event(), onMoved: event(), onAttached: event(), onDetached: event(), onHighlighted: event(), onZoomChange: event(), create: resolve({ id: -1 }), remove: resolve(undefined), get: resolve({ id: -1 }), getCurrent: resolve(undefined), sendMessage: resolve(undefined), group: resolve(-1), highlight: resolve({}), move: resolve({}), setZoom: resolve(undefined), getZoom: resolve(1), captureVisibleTab: resolve(""), detectLanguage: resolve("und"), duplicate: resolve({}), discard: resolve(undefined), goBack: resolve(undefined), goForward: resolve(undefined), TAB_ID_NONE: -1 });
  ensure("windows", { onCreated: event(), onRemoved: event(), onFocusChanged: event(), onBoundsChanged: event(), get: resolve({ id: 1, focused: true }), getCurrent: resolve({ id: 1, focused: true }), getLastFocused: resolve({ id: 1, focused: true }), getAll: resolve([{ id: 1, focused: true }]), create: resolve({ id: 1 }), update: resolve({ id: 1 }), remove: resolve(undefined), WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2 });
  ensure("action", { onClicked: event(), setBadgeText: resolve(undefined), getBadgeText: resolve(""), setBadgeBackgroundColor: resolve(undefined), getBadgeBackgroundColor: resolve([0, 0, 0, 0]), setBadgeTextColor: resolve(undefined), setTitle: resolve(undefined), getTitle: resolve(""), setIcon: resolve(undefined), setPopup: resolve(undefined), getPopup: resolve(""), enable: resolve(undefined), disable: resolve(undefined), isEnabled: resolve(true), openPopup: resolve(undefined), getUserSettings: resolve({ isOnToolbar: true }) });
  ensure("alarms", { onAlarm: event(), create: resolve(undefined), get: resolve(undefined), getAll: resolve([]), clear: resolve(true), clearAll: resolve(true) });
  ensure("notifications", { onClicked: event(), onClosed: event(), onButtonClicked: event(), onPermissionLevelChanged: event(), create: resolve(""), update: resolve(false), clear: resolve(false), getAll: resolve({}), getPermissionLevel: resolve("denied") });
  ensure("contextMenus", { onClicked: event(), create: () => undefined, update: resolve(undefined), remove: resolve(undefined), removeAll: resolve(undefined), ACTION_MENU_TOP_LEVEL_LIMIT: 6 });
  ensure("cookies", { onChanged: event(), get: resolve(null), getAll: resolve([]), set: resolve(null), remove: resolve(null), getAllCookieStores: resolve([]) });
  ensure("webNavigation", { onBeforeNavigate: event(), onCommitted: event(), onCompleted: event(), onDOMContentLoaded: event(), onErrorOccurred: event(), onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event(), onCreatedNavigationTarget: event(), onTabReplaced: event(), getFrame: resolve(null), getAllFrames: resolve([]) });
  ensure("identity", { getAuthToken: resolve(undefined), getProfileUserInfo: resolve({ email: "", id: "" }), removeCachedAuthToken: resolve(undefined), launchWebAuthFlow: resolve(undefined), getRedirectURL: () => "", onSignInChanged: event() });
  ensure("idle", { onStateChanged: event(), queryState: resolve("active"), setDetectionInterval: () => undefined });
  ensure("management", { onInstalled: event(), onUninstalled: event(), onEnabled: event(), onDisabled: event(), getAll: resolve([]), getSelf: resolve({ id: "", enabled: true, installType: "normal" }), setEnabled: resolve(undefined), uninstallSelf: resolve(undefined) });
  ensure("offscreen", { createDocument: resolve(undefined), closeDocument: resolve(undefined), hasDocument: resolve(false) });
  ensure("storage", {});
  const storage = chrome["storage"] as Record<string, unknown>;
  if (storage !== undefined && storage["session"] === undefined && storage["local"] !== undefined) { try { storage["session"] = storage["local"]; } catch { /* idem */ } }
  if (storage !== undefined && storage["sync"] === undefined && storage["local"] !== undefined) { try { storage["sync"] = storage["local"]; } catch { /* idem */ } }
  if (storage !== undefined && storage["onChanged"] === undefined) { try { storage["onChanged"] = event(); } catch { /* idem */ } }
})();
