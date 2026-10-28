/**
 * O que vai para a máquina da pessoa, por componente (parte pura): os arquivos que cada instalador copia de
 * backend-colima/ e onde mora a versão de cada um. O hostProbe.ts instala com estas listas; o release
 * (scripts/release.mjs) as usa para recusar publicar um componente que mudou sem subir a versão, senão as
 * máquinas nunca recebem a mudança (o seletor só atualiza para cima).
 */

// Tudo que o install.sh copia: server.js exige providers.js e account-status.js ao lado (sem eles o cp aborta
// e a VM nova fica sem backend). A status line vai junto e o install.sh a encadeia no fim; VERSION ele grava por último.
export const BUNDLE_FILES = [
  "server.js", "session-map.js", "nivel-ferramentas.js", "providers.js", "providers.json", "account-status.js", "contas-claude.js", "tool-events.js", "navegador.js", "licenca.js", "crm-modelo.js", "crm-store.js", "crm-api.js", "finance-modelo.js", "finance-store.js", "finance-api.js", "finance-crm-sync.js", "crm-finance-vendas.js", "autenticador.js", "auditoria.py", "meu-bot-backend.service", "install.sh", "VERSION",
  "statusline.sh", "install-statusline.sh", "uninstall-statusline.sh",
  // Porteiro do claude (rodízio de contas para o OpenClaw/WhatsApp e o Terminal).
  "claude-porteiro.js", "claude-porteiro.sh", "install-porteiro.sh", "uninstall-porteiro.sh",
];
/** Guarda do WhatsApp: o plugin (pasta guarda/) e os dois scripts. */
export const GUARDA_FILES = ["install-guarda.sh", "uninstall-guarda.sh"];
export const GUARDA_PLUGIN_FILES = ["index.js", "regras.mjs", "package.json", "openclaw.plugin.json", "vigia-gateway.sh"];
export const CRM_FILES = ["install-crm.sh", "uninstall-crm.sh", "skill-streak-crm-api.md", "skill-crm-api.md"];
export const CRM_PLUGIN_FILES = ["index.js", "regras.mjs", "licenca-crm.mjs", "crm-job.mjs", "backend.mjs", "crm.mjs", "streak.mjs", "importar-streak.mjs", "package.json", "openclaw.plugin.json"];
export const FINANCE_FILES = ["install-finance.sh", "skill-finance-api.md"];
export const FINANCE_PLUGIN_FILES = ["index.js", "regras.mjs", "backend.mjs", "finance.mjs", "package.json", "openclaw.plugin.json"];

export interface ComponenteVersionado {
  nome: string;
  /** Caminhos no repositório que, se mudarem, exigem subir a versão. */
  arquivos: string[];
  /** Arquivo da versão: VERSION (texto) ou package.json (campo version). */
  versao: string;
}
const B = (f: string): string => `backend-colima/${f}`;
/** Os componentes que o seletor atualiza sozinho nas máquinas (picker.ts › ensure*), cada um com a sua versão. */
export const COMPONENTES: readonly ComponenteVersionado[] = [
  { nome: "backend", arquivos: BUNDLE_FILES.filter((f) => f !== "VERSION").map(B), versao: B("VERSION") },
  { nome: "financeiro", arquivos: [...FINANCE_FILES.map(B), ...FINANCE_PLUGIN_FILES.map((f) => B(`finance/${f}`))], versao: B("finance/package.json") },
  { nome: "crm", arquivos: [...CRM_FILES.map(B), ...CRM_PLUGIN_FILES.map((f) => B(`crm/${f}`))], versao: B("crm/package.json") },
  { nome: "guarda", arquivos: [...GUARDA_FILES.map(B), ...GUARDA_PLUGIN_FILES.map((f) => B(`guarda/${f}`))], versao: B("guarda/package.json") },
];
