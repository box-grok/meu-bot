import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { deveHerdar, entradaHerdavel } = createRequire(import.meta.url)("../../dist/main/user-data-core.js");

test("deveHerdar: só sem carimbo e sem conversas de verdade", () => {
  assert.equal(deveHerdar(false, null), true, "pasta nova");
  assert.equal(deveHerdar(false, "[]"), true); assert.equal(deveHerdar(false, '{"conversations":[]}'), true); assert.equal(deveHerdar(false, "lixo"), true);
  assert.equal(deveHerdar(false, '{"conversations":[{"id":"x","messages":[]}]}'), true, "só a conversa em branco que o app cria ao abrir");
  assert.equal(deveHerdar(false, '{"conversations":[{"id":"x","messages":[{"role":"user","text":"oi"}]}]}'), false, "já conversou: nunca sobrescreve");
  assert.equal(deveHerdar(true, null), false, "carimbo: já herdou");
});
test("entradaHerdavel: dados sim; caches, logs, backend local, travas e o que é do admin não", () => {
  for (const ok of ["settings.json", "memory.json", "conversations.json", "transcripts", "Local Storage", "Session Storage", "IndexedDB", "Partitions", "Navegador", "Preferences", "Network", "suporte.json", "tailscale-oauth.bin"]) assert.equal(entradaHerdavel(ok), true, ok);
  for (const nao of ["meu-bot.log", "backend-local", "backend-local.log", "update", "SingletonLock", "SingletonSocket", "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "GraphiteDawnCache", "GPUPersistentCache", "blob_storage", "DIPS", "DevToolsActivePort", "Crashpad", "declarative_performance_observer.db", "declarative_performance_observer.db-journal", "pessoas.json", "produtos.json", "settings.json.tmp"]) assert.equal(entradaHerdavel(nao), false, nao);
});
