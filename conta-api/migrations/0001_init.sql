-- Conta meu-bot: contas, licença da conta, devices (Macs), máquinas (VMs), sessões e os códigos do login.
-- Datas em ISO 8601 (texto); ids em uuid v4; e-mail sempre em minúsculas. O que vem do Firebase é identidade; o
-- que o admin grava (licenças, admins) é autoridade; o resto é telemetria.

CREATE TABLE contas (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  email_verificado INTEGER NOT NULL DEFAULT 0,
  nome TEXT,
  foto TEXT,
  criada_em TEXT NOT NULL,
  atualizada_em TEXT NOT NULL,
  apagada_em TEXT
);

-- 1:1 com contas; os mesmos campos de License (src/shared/ipc/licenca.ts). Sem linha = free com um device.
CREATE TABLE licencas (
  conta_id TEXT PRIMARY KEY REFERENCES contas(id),
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'free',
  interval TEXT,
  member_since TEXT NOT NULL,
  trial_end TEXT,
  expires_at TEXT,
  device_limit INTEGER NOT NULL DEFAULT 1,
  produtos TEXT NOT NULL DEFAULT '[]',
  pagamento TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system'
);

-- Os Macs da conta. `id` é o uuid do device.json do app; `alias_legado` o hash antigo (12 hex de hostname+usuário),
-- para casar o maquinas.json que a VM já tem. O primeiro cabe sempre; acima do device_limit entra pendente.
CREATE TABLE devices (
  conta_id TEXT NOT NULL REFERENCES contas(id),
  id TEXT NOT NULL,
  alias_legado TEXT,
  name TEXT,
  user TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  requested_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  apps TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (conta_id, id)
);
CREATE INDEX devices_alias ON devices(alias_legado);

-- As VMs ligadas à conta (N máquinas : 1 conta). `id` é o uuid do maquina.json do backend-colima.
CREATE TABLE maquinas (
  id TEXT PRIMARY KEY,
  conta_id TEXT REFERENCES contas(id),
  apelido TEXT,
  vinculada_por TEXT NOT NULL DEFAULT 'app',
  criada_em TEXT NOT NULL,
  ultima_emissao_em TEXT,
  ultimo_hello_em TEXT
);
CREATE INDEX maquinas_conta ON maquinas(conta_id);

-- Refresh tokens rotativos: guarda só o hash; `familia` liga a cadeia de rotações (reuso de um token já trocado
-- derruba a família inteira, como no RFC 6819).
CREATE TABLE sessoes (
  id TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL REFERENCES contas(id),
  refresh_hash TEXT UNIQUE NOT NULL,
  familia TEXT NOT NULL,
  device_id TEXT,
  app TEXT,
  versao_app TEXT,
  criada_em TEXT NOT NULL,
  usada_em TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  revogada_em TEXT
);
CREATE INDEX sessoes_familia ON sessoes(familia);
CREATE INDEX sessoes_conta ON sessoes(conta_id);

-- O código que vai no deep link (<esquema>://auth?code=…): uso único, 120 s, preso ao state e ao PKCE do app.
CREATE TABLE codigos_login (
  code TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL REFERENCES contas(id),
  state TEXT NOT NULL,
  challenge TEXT NOT NULL,
  esquema TEXT NOT NULL,
  app TEXT,
  versao_app TEXT,
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  usado_em TEXT
);

-- Quem administra (allowlist de e-mails; o primeiro super vem de ADMIN_BOOTSTRAP_EMAIL no primeiro login).
CREATE TABLE admins (
  email TEXT PRIMARY KEY,
  papel TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

-- "Pedir o Pro ao admin", add-on, device além do limite, importação de licença legada.
CREATE TABLE pedidos (
  id TEXT PRIMARY KEY,
  conta_id TEXT NOT NULL REFERENCES contas(id),
  tipo TEXT NOT NULL,
  detalhe TEXT,
  maquina_id TEXT,
  criado_em TEXT NOT NULL,
  atendido_em TEXT,
  atendido_por TEXT
);
CREATE INDEX pedidos_abertos ON pedidos(atendido_em, criado_em);

CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quando TEXT NOT NULL,
  quem TEXT NOT NULL,
  acao TEXT NOT NULL,
  conta_id TEXT,
  detalhe TEXT
);

-- Contador simples por chave e janela (rate limit do /sessao por IP).
CREATE TABLE limites (
  chave TEXT PRIMARY KEY,
  janela TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0
);
