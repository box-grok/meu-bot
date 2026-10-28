/** meu-bot-admin-mac: as contas deste Mac (src/main/usuarios-mac/). Só tipos. */

export interface UsuarioMac {
  nome: string;
  uid: number;
  /** Nome completo (RealName), o "apelido" na tela. */
  apelido: string;
  admin: boolean;
  /** Não pode ser apagada daqui (a conta de quem usa o app, quem está na tela, sistema) e o porquê. */
  protegida: string | null;
}

export interface UsuariosMacVisao { usuarios: UsuarioMac[]; atual: string; naTela: string | null }

/** Conta criada: a senha aparece só aqui, uma vez. `repo`: o meu-bot clonado na mesa da conta nova. */
export interface UsuarioMacCriado { nome: string; senha: string; repo: "ok" | "falhou" | "sem-git"; visao: UsuariosMacVisao }

export interface UsuariosMacApi {
  listar(): Promise<UsuariosMacVisao>;
  criar(nome: string): Promise<UsuarioMacCriado>;
  apagar(nome: string): Promise<UsuariosMacVisao>;
  apelido(nome: string, apelido: string): Promise<UsuariosMacVisao>;
}
