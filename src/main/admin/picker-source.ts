/**
 * Variante: admin. O seletor do meu-bot-admin lista pessoas, não máquinas: os aliases `suporte-…` das pessoas
 * com suporte ligado (admin/support-admin.ts). Os handlers só dele: atualizar pela caixa de entrada e
 * "Adicionar pessoa" colando o código, arquivar, apelido e "Excluir máquina" (limpa o WhatsApp dela e desliga o
 * suporte). Nada de instalar nem de mexer no ~/.ssh/config: a máquina é dela.
 */
import type { PickerSource } from "../maquina/picker";
import { handleAdmin } from "../ipc/registry";
import { isSupportAlias } from "../suporte/support-code";
import { windowForHost } from "../app/windows";
import { addSupportCode, adminKeyExists, archivePerson, knownPeople, removePerson, renamePerson, supportPeople } from "./support-admin";
import { registerProdutosIpc, showProdutos } from "./produtos-janela";

export const adminPickerSource: PickerSource = {
  title: "meu-bot-admin · escolher pessoa",
  hosts: () => knownPeople().filter((p) => p.on).map((p) => p.alias),
  support: () => ({ people: knownPeople(), adminKey: adminKeyExists() }),
  registerIpc: ({ fromPicker }) => {
    // Produtos (MVPs de bots verticais) moram numa janela própria; o seletor só a abre.
    registerProdutosIpc();
    handleAdmin("picker:produtos-abrir", (event) => { if (!fromPicker(event)) throw new Error("origem inválida"); showProdutos(); });
    handleAdmin("picker:support-refresh", async (event) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return supportPeople();
    });
    handleAdmin("picker:support-add", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return addSupportCode(String((payload as { code?: unknown } | null)?.code ?? ""));
    });
    handleAdmin("picker:support-archive", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const p = payload as { alias?: unknown; archived?: unknown } | null;
      const alias = String(p?.alias ?? "");
      if (!isSupportAlias(alias)) throw new Error("pessoa inválida");
      return archivePerson(alias, p?.archived === true);
    });
    handleAdmin("picker:support-rename", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const p = payload as { alias?: unknown; name?: unknown } | null;
      const alias = String(p?.alias ?? "");
      if (!isSupportAlias(alias)) throw new Error("pessoa inválida");
      return renamePerson(alias, String(p?.name ?? ""));
    });
    handleAdmin("picker:support-remove", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const p = payload as { alias?: unknown; force?: unknown } | null;
      const alias = String(p?.alias ?? "");
      if (!isSupportAlias(alias)) throw new Error("pessoa inválida");
      const r = await removePerson(alias, p?.force === true);
      windowForHost(alias)?.close();
      return r;
    });
  },
};
