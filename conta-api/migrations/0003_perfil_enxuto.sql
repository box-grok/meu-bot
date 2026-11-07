-- O perfil fica só com nome e sobrenome: país, cidade, setor, cargo e tamanho do time saem (ninguém precisava deles).
ALTER TABLE contas DROP COLUMN pais;
ALTER TABLE contas DROP COLUMN cidade;
ALTER TABLE contas DROP COLUMN setor;
ALTER TABLE contas DROP COLUMN cargo;
ALTER TABLE contas DROP COLUMN tamanho_equipe;
