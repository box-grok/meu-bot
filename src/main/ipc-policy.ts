/**
 * Política de variante dos canais IPC: cada canal está em exatamente uma lista. O registro (ipc/registry.ts)
 * é tipado por elas, então um canal novo sem lista não compila. "client" = só o meu-bot normal (no
 * meu-bot-admin vira um stub que recusa com ADMIN_READONLY_MSG); "admin" = só o meu-bot-admin; "shared" = os
 * dois. Puro: testável com node --test (o teste confere que todo canal dos preloads está aqui, uma vez só).
 */

/** Os dois apps: leituras da máquina e o que é só deste Mac (configurações, memória, arquivar). */
export const SHARED_CHANNELS = [
  // janela principal
  "window:info", "ui:open-picker", "shell:open-external", "settings:get", "settings:set", "memory:get", "memory:set",
  "whatsapp:status", "whatsapp:chats", "whatsapp:thread", "whatsapp:export", "ui:wa-menu",
  // limpar o histórico de um contato: a pessoa e o admin (no admin fica no registro da máquina dela)
  "whatsapp:clear-plan", "whatsapp:clear",
  "claude-login:auth", "xai-login:auth", "xai-key:status",
  // terminal na máquina da janela (os dois apps; no admin a pessoa vê no registro dela)
  "term:open", "term:input", "term:resize", "term:close", "term:replay",
  // atualização automática do próprio app
  "update:state", "update:apply",
  // seletor
  "picker:list", "picker:probe", "picker:choose", "picker:shortcut", "picker:relief-shortcut", "picker:relieve",
  "picker:open-grokbot-reset", "picker:open-url", "picker:tailscale-credential", "picker:cancel",
  // alívio do Grok Bot (relief.ts registra sozinho)
  "relief:close", "relief:open-reset",
] as const;

/** Só o meu-bot normal: tudo que conversa com o agente ou escreve na máquina. */
export const CLIENT_CHANNELS = [
  // conversas com o agente
  "chat:send", "chat:cancel", "chat:new", "chat:list", "chat:rename", "chat:set-model", "chat:reorder", "chat:close",
  "chat:delete", "chat:open", "chat:archive", "chat:duplicate", "chat:branch", "chat:export", "ui:tab-menu", "ui:notify",
  "backend:account",
  // entrada rápida (quickEntry.ts registra sozinho, e só sobe com caps.chat)
  "ui:quick-toggle", "quick:submit", "quick:hide", "quick:ack",
  // WhatsApp: o que mexe na máquina ou no agente dela
  "whatsapp:pair", "whatsapp:audio", "whatsapp:logout", "whatsapp:dm-policy", "whatsapp:branch", "whatsapp:pause",
  "whatsapp:cancel",
  // logins
  "claude-login:start", "claude-login:code", "claude-login:logout", "claude-login:cancel",
  "xai-login:prepare", "xai-login:start", "xai-login:logout", "xai-login:cancel",
  // instalar e configurar a máquina
  "statusline:status", "statusline:install", "statusline:segments", "statusline:set-segments", "statusline:uninstall",
  "tailscale:disable-check", "tailscale:restore",
  // suporte, lado da pessoa
  "support:info", "support:set", "support:progress", "support:name", "support:deliver", "support:code", "support:share", "support:reset",
  // seletor
  "picker:install", "picker:install-statusline", "picker:install-transcricao", "picker:remove-host", "picker:rename-host",
  "picker:sync-ssh", "picker:open-direct", "picker:onboarding-done", "picker:claude-login",
  "picker:approve-tailscale", "picker:tailscale-disable-check", "picker:tailscale-credential-save", "picker:tailscale-credential-forget",
] as const;

/** Só o meu-bot-admin: a página "Suporte" e as pessoas do seletor. */
export const ADMIN_CHANNELS = ["admin:health", "admin:logs", "admin:action", "admin:bot-chats", "admin:bot-thread", "admin:bot-delete", "picker:support-refresh", "picker:support-add", "picker:support-archive"] as const;

export type SharedChannel = (typeof SHARED_CHANNELS)[number];
export type ClientChannel = (typeof CLIENT_CHANNELS)[number];
export type AdminChannel = (typeof ADMIN_CHANNELS)[number];
export type IpcChannel = SharedChannel | ClientChannel | AdminChannel;

/** O que um canal de cliente responde no meu-bot-admin. */
export const ADMIN_READONLY_MSG = "o meu-bot-admin só lê; use as ações de suporte";
/** O que um canal de admin responde no meu-bot normal (ninguém chama; é só a recusa). */
export const NOT_ADMIN_MSG = "origem inválida";
