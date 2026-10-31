/** Objetivo do agente no WhatsApp (tutorial 8): os cartões de objetivo e os três níveis de liberdade. Puro, com teste. */
import type { FreedomLevel } from "../../shared/ipc";

/** Tutorial 8, passo 1: os cartões de objetivo (o rótulo vai para o SKILL.md; "outro" exige a frase). */
export interface ObjectiveOption { id: string; label: string; text: string; needsText: boolean }
export const OBJECTIVE_OPTIONS: readonly ObjectiveOption[] = [
  { id: "atendimento", label: "Atender clientes", text: "Tirar dúvidas, dar informações e encaminhar o que não resolver.", needsText: false },
  { id: "vendas", label: "Vender", text: "Apresentar produtos ou serviços, tirar objeções e fechar pedidos.", needsText: false },
  { id: "agenda", label: "Marcar horários", text: "Agendar, confirmar e remarcar compromissos.", needsText: false },
  { id: "suporte", label: "Dar suporte", text: "Ajudar quem já é cliente a resolver problemas passo a passo.", needsText: false },
  { id: "outro", label: "Outro", text: "Descreva em uma frase o que você quer resolver.", needsText: true },
];
/** Tutorial 8, passo 2: os três níveis de liberdade (os mesmos ids do main, que grava a trava). */
export const LEVEL_OPTIONS: readonly { id: FreedomLevel; title: string; text: string; isDefault: boolean }[] = [
  { id: "conversa", title: "Só conversa", text: "Responde, orienta e combina coisas, mas não mexe em nada: não roda comandos, não grava arquivos, não agenda.", isDefault: true },
  { id: "consulta", title: "Consulta e organiza", text: "Lê arquivos e a internet, anota e organiza no workspace dele, mas não roda comandos nem agenda.", isDefault: false },
  { id: "age", title: "Age por mim", text: "Faz o que for preciso: roda comandos, mexe em arquivos e agenda, como se fosse você.", isDefault: false },
];
