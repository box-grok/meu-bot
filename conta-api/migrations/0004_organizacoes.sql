-- Organizações (molde Rambox Enterprise: console.rambox.app/organizations/<slug>/members). Uma organização tem slug
-- (o futuro `<slug>.agentesgrok.com`), dona, assentos e membros convidados por e-mail. O convite é o e-mail cadastrado:
-- quando aquele e-mail entra (Google ou link), `aceitarConvites` liga a conta e o membro vira ativo.
CREATE TABLE organizacoes (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  dona_conta_id TEXT NOT NULL REFERENCES contas(id),
  dominio_email TEXT,                      -- "coflow.com.br": convites só desse domínio (null = qualquer e-mail)
  assentos INTEGER NOT NULL DEFAULT 5,     -- ativos + convidados cabem até aqui; o super admin muda
  criada_em TEXT NOT NULL,
  atualizada_em TEXT NOT NULL,
  apagada_em TEXT                          -- soft delete: o slug vira 'apagada:<id>:<slug>' e continua único
);

CREATE TABLE membros (
  org_id TEXT NOT NULL REFERENCES organizacoes(id),
  email TEXT NOT NULL,                     -- minúsculas; a chave do convite
  conta_id TEXT REFERENCES contas(id),     -- null enquanto convidado
  papel TEXT NOT NULL,                     -- dona | admin | membro
  status TEXT NOT NULL,                    -- convidado | ativo
  convidado_por TEXT,                      -- e-mail de quem convidou
  convidado_em TEXT NOT NULL,
  entrou_em TEXT,
  PRIMARY KEY (org_id, email)
);
CREATE INDEX membros_conta ON membros(conta_id);
