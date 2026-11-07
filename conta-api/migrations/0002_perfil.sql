-- Perfil editável no console (molde Rambox), provedores de login vistos e o toggle de dados de uso.
-- `nome` continua sendo o do Firebase (sobrescrito a cada login); o que a pessoa digita fica em nome_proprio/sobrenome.
ALTER TABLE contas ADD COLUMN nome_proprio TEXT;
ALTER TABLE contas ADD COLUMN sobrenome TEXT;
ALTER TABLE contas ADD COLUMN pais TEXT;
ALTER TABLE contas ADD COLUMN cidade TEXT;
ALTER TABLE contas ADD COLUMN setor TEXT;
ALTER TABLE contas ADD COLUMN cargo TEXT;
ALTER TABLE contas ADD COLUMN tamanho_equipe TEXT;             -- '1' | '2-10' | '11-50' | '51-200' | '201+'
ALTER TABLE contas ADD COLUMN provedores TEXT NOT NULL DEFAULT '[]';  -- JSON: ["google.com", "emailLink", "password"]
ALTER TABLE contas ADD COLUMN dados_uso INTEGER NOT NULL DEFAULT 1;   -- 0 = não guardar nome/usuário/apps dos devices
