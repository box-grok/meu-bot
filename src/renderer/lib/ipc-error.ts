/**
 * Texto de um erro vindo do main pelo IPC, sem o prefixo que o Electron põe ("Error invoking remote method
 * 'canal': Error: …"). Puro: testável com node --test.
 */
const PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;

export const ipcErrorText = (err: unknown): string => (err instanceof Error ? err.message.replace(PREFIX, "") : String(err));
