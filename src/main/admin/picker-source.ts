/**
 * Variante: admin. O seletor do meu-bot-admin lista pessoas, não máquinas: os aliases `suporte-…` das pessoas
 * com suporte ligado (admin/support-admin.ts). Os handlers só dele: atualizar pela caixa de entrada e
 * "Adicionar pessoa" colando o código. Nada de instalar, renomear ou remover: a máquina é dela.
 */
import type { PickerSource } from "../picker";
import { handleAdmin } from "../ipc/registry";
import { addSupportCode, adminKeyExists, knownPeople, supportPeople } from "./support-admin";

export const adminPickerSource: PickerSource = {
  title: "meu-bot-admin · escolher pessoa",
  hosts: () => knownPeople().filter((p) => p.on).map((p) => p.alias),
  support: () => ({ people: knownPeople(), adminKey: adminKeyExists() }),
  registerIpc: ({ fromPicker }) => {
    handleAdmin("picker:support-refresh", async (event) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return supportPeople();
    });
    handleAdmin("picker:support-add", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return addSupportCode(String((payload as { code?: unknown } | null)?.code ?? ""));
    });
  },
};
