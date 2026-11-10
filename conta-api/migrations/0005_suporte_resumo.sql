-- Janelas de suporte no console (console.agentesgrok.com/support-window): o último resumo de cada pessoa que um
-- admin abriu no meu-bot-admin-gestao (saúde da máquina, licença, uso do app, aberturas). Os dados moram nas
-- máquinas e só o admin chega nelas (SSH); o app dele envia o que acabou de ler e o super admin vê pelo site.
CREATE TABLE suporte_resumo (
  id TEXT PRIMARY KEY,            -- id da máquina da pessoa (12 hex, o machineId do código de suporte)
  nome TEXT NOT NULL,             -- nome da pessoa como o admin vê
  maquina TEXT,                   -- apelido da máquina (ex.: este-mac), se houver
  enviado_por TEXT NOT NULL,      -- e-mail do admin cujo app enviou
  atualizado_em TEXT NOT NULL,
  resumo TEXT NOT NULL            -- JSON: { saude, licenca, uso: [{texto, ok}], aberturas: [texto] }
);
CREATE INDEX suporte_resumo_atualizado ON suporte_resumo (atualizado_em);
