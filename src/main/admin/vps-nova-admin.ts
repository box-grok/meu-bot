/**
 * "Nova VPS" (seletor do meu-bot-admin-gestao): o job que leva uma VPS recém-criada ao fluxo do meu-bot, encadeando o
 * que era manual: entra como root pela chave deste Mac (cadastrada no painel do provedor ao criar a VPS), grava o alias
 * `<nome>-root` no ~/.ssh/config, põe a máquina na lista de pessoas (sem a preparação de Claude Code e backend, que é
 * para contas de pessoa), aplica o Preparar máquina, cria o primeiro usuário e termina apontando o que fica para o
 * admin. Cada passo relê antes de escrever: rodar de novo na mesma VPS pula o que já está feito. Puro: vps-nova-core.ts.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import type { PassoVps, VpsNovaResultado } from "../../shared/ipc";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/backend";
import { acrescentarBlocoSshConfig, sshHostsTemplatePath } from "../maquina/sshSync";
import { runSsh } from "../whatsapp/whatsapp";
import { instalarLinkPublico } from "./link-publico-admin";
import { aplicarPreparar, estadoPreparar } from "./preparar-admin";
import { addSupportCode, adminKeyExists, caixaDeEntrada, renamePerson } from "./support-admin";
import { chaveDesteMac, criarUsuario, prepararUsuarioDeNovo, usuariosDaMaquina } from "./usuarios-admin";
import { blocoSshUsuario, configTemHost } from "./usuarios-core";
import { aliasRootDe, blocoModeloDe, motivoAcesso, parseVpsNova, planoVpsNova, TEXTO_ACESSO, textoFinal, type FatosVps } from "./vps-nova-core";

const PRIMEIRO_USUARIO = "box-1";
/** Quanto esperar a pessoa digitar a senha no Terminal (ssh-copy-id) antes de desistir. */
const COPY_ID_WAIT_MS = 15 * 60_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Uma VPS de cada vez por endereço: o segundo clique só avisa. */
const emAndamento = new Set<string>();

const sshDireto = (args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile("ssh", args, { timeout: timeoutMs }, (err, stdout, stderr) => {
    const code = err === null ? 0 : typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : null;
    resolve({ code, stdout: String(stdout), stderr: String(stderr) });
  });
});
const esqueceHostKey = (endereco: string, porta: number): Promise<void> => new Promise((resolve) => {
  const alvo = porta === 22 ? endereco : `[${endereco}]:${porta}`;
  execFile("ssh-keygen", ["-R", alvo], { timeout: 10_000 }, () => resolve());
});
const lerSshConfig = (): string => { try { return fs.readFileSync(`${os.homedir()}/.ssh/config`, "utf8"); } catch { return ""; } };
const lerModelo = (): string => { try { return fs.readFileSync(sshHostsTemplatePath(), "utf8"); } catch { return ""; } };
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function vpsNova(raw: unknown, onLine: (line: string) => void): Promise<VpsNovaResultado> {
  const p = parseVpsNova(raw);
  if (!p.ok) throw new Error(p.reason);
  const { endereco, nome, usuario, porta, dominio, chromium, primeiroUsuario, reinstalada } = p.pedido;
  if (emAndamento.has(endereco)) throw new Error("já estou trazendo esta VPS para o fluxo; espere terminar");
  emAndamento.add(endereco);
  try {
    if (!adminKeyExists()) throw new Error("falta a chave ~/.ssh/meu-bot-admin deste admin (scripts/suporte-setup.mjs)");
    const chave = chaveDesteMac();
    const aliasRoot = aliasRootDe(nome);
    const fatos: FatosVps = { acesso: null, aliasNoConfig: false, pessoa: null, prepararFaltam: null, prepararHumanos: [], usuario: null, primeiroUsuario, modeloTemHost: false };

    // 1. Entrar como root pela chave deste Mac (a VPS nasceu com a pública cadastrada no painel).
    onLine(`1/6 entrando em ${usuario}@${endereco} pela chave ${chave.arquivo}…`);
    if (reinstalada) await esqueceHostKey(endereco, porta);
    const arquivo = chave.arquivo.replace(/^~(?=\/)/, os.homedir());
    const argsAcesso = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "StrictHostKeyChecking=accept-new", "-o", "IdentitiesOnly=yes", "-i", arquivo, "-p", String(porta), "--", `${usuario}@${endereco}`, "hostname; id -u"];
    let a = await sshDireto(argsAcesso, 40_000);
    let motivo = motivoAcesso(a.code, a.stderr);
    if (motivo === "senha") {
      // A VPS aceita senha e a chave deste Mac ainda não está lá: o ssh-copy-id no Terminal (a senha nunca passa pelo
      // app; é o mesmo caminho do login do Claude), e o job espera a chave entrar.
      onLine(`a VPS aceita senha: abrindo o Terminal para o ssh-copy-id; digite a senha de ${usuario}@${endereco} lá (até 15 min)…`);
      const cmd = `ssh-copy-id -i ${chave.arquivo}.pub -o StrictHostKeyChecking=accept-new -p ${porta} ${usuario}@${endereco}`;
      spawn("osascript", ["-e", `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`, "-e", 'tell application "Terminal" to activate'], { stdio: "ignore" }).on("error", () => { /* sem Terminal: o laço abaixo esgota e explica */ });
      const until = Date.now() + COPY_ID_WAIT_MS;
      while (motivo === "senha" && Date.now() < until) {
        await sleep(10_000);
        a = await sshDireto(argsAcesso, 40_000);
        motivo = motivoAcesso(a.code, a.stderr);
      }
      if (motivo === "senha") throw new Error("a chave não entrou em 15 min: cadastre ~/.ssh/id_ed25519.pub no painel do provedor, ou rode o ssh-copy-id no Terminal e clique de novo");
      if (motivo === "ok") onLine("✓ chave deste Mac autorizada na VPS");
    }
    if (motivo !== "ok") { fatos.acesso = motivo; throw new Error(TEXTO_ACESSO[motivo].replace("<endereço>", endereco)); }
    fatos.acesso = "ok";
    const [hostnameRemoto, uid] = a.stdout.trim().split("\n").map((s) => s.trim());
    if (uid !== "0") throw new Error(`${usuario}@${endereco} não é root (uid ${uid ?? "?"}): o Preparar máquina e o Criar usuário são do root`);
    onLine(`✓ entrou: ${hostnameRemoto ?? endereco} como root`);

    // 2. O alias root no ~/.ssh/config deste Mac (o seletor do meu-bot e o Cursor leem o mesmo arquivo).
    if (configTemHost(lerSshConfig(), aliasRoot)) onLine(`2/6 ${aliasRoot} já está no ~/.ssh/config`);
    else {
      acrescentarBlocoSshConfig(blocoSshUsuario({ alias: aliasRoot, hostname: endereco, port: String(porta), user: usuario, chave: chave.arquivo, maquina: nome }));
      onLine(`2/6 ✓ ${aliasRoot} no ~/.ssh/config (backup ao lado)`);
    }
    const t = await runSsh(aliasRoot, "id -u\n", 30_000);
    if (t.code !== 0 || t.stdout.trim() !== "0") throw new Error(`o alias ${aliasRoot} não entra: ${(t.stderr.trim() || t.stdout.trim()).split("\n").pop() ?? "ssh falhou"}`);
    fatos.aliasNoConfig = true;

    // 3. A máquina vira pessoa no admin, sem a preparação silenciosa (Claude Code, login e backend não são para o root).
    onLine(`3/6 pondo ${nome} na lista de pessoas…`);
    let pessoa = await addSupportCode(aliasRoot, { preparar: false });
    if (pessoa.name !== nome) { const lista = await renamePerson(pessoa.alias, nome); pessoa = lista.find((x) => x.alias === pessoa.alias) ?? pessoa; }
    const suporteAlias = pessoa.alias;
    fatos.pessoa = suporteAlias;
    onLine(`✓ ${nome} na lista (${suporteAlias})`);

    // 4. Preparar máquina: tudo que falta e não é humano (o Chromium só se pedido); o link público se veio o domínio.
    let aliasBox: string | null = null;
    try {
      const estado = await estadoPreparar(suporteAlias);
      const ids = [...estado.faltam, ...(chromium ? ["chromium"] : [])];
      onLine(ids.length === 0 ? "4/6 máquina já preparada" : `4/6 preparando a máquina: ${ids.join(", ")}…`);
      const v = ids.length === 0 ? estado : await aplicarPreparar(suporteAlias, ids, onLine);
      fatos.prepararFaltam = v.faltam;
      fatos.prepararHumanos = v.itens.filter((i) => i.estado === "humano").map((i) => i.id);
      if (dominio !== "") {
        onLine(`link público: instalando para ${dominio}…`);
        try { await instalarLinkPublico(suporteAlias, dominio); onLine("✓ link público instalado; falta entrar na Cloudflare e subir o túnel"); } catch (e) { onLine(`✗ link público: ${msg(e)}`); }
      }
    } catch (e) { onLine(`✗ preparar: ${msg(e)}`); }

    // 5. O primeiro usuário (ou o preparo dele de novo, se já existe).
    if (primeiroUsuario) {
      try {
        const antes = await usuariosDaMaquina(suporteAlias);
        const existe = antes.usuarios.some((u) => u.nome === PRIMEIRO_USUARIO);
        onLine(existe ? `5/6 ${PRIMEIRO_USUARIO} já existe: conferindo o preparo…` : `5/6 criando ${PRIMEIRO_USUARIO}…`);
        const v = existe ? await prepararUsuarioDeNovo(suporteAlias, PRIMEIRO_USUARIO, onLine) : await criarUsuario(suporteAlias, PRIMEIRO_USUARIO, 0, onLine);
        aliasBox = v.seletores?.alias ?? `${nome}-${PRIMEIRO_USUARIO}`;
        fatos.usuario = aliasBox;
        onLine(`✓ ${PRIMEIRO_USUARIO} pronto (${aliasBox}): falta só o QR do WhatsApp no meu-bot dele`);
      } catch (e) { onLine(`✗ usuário: ${msg(e)}`); }
    }

    // 6. O modelo versionado (config/ssh-hosts.conf) é do repositório: só sugere o bloco.
    fatos.modeloTemHost = configTemHost(lerModelo(), aliasRoot);
    const blocoModelo = blocoModeloDe({ nome, hostname: endereco, user: usuario, port: porta });
    onLine(fatos.modeloTemHost ? "6/6 o modelo config/ssh-hosts.conf já tem este alias" : "6/6 bloco para o config/ssh-hosts.conf pronto para copiar (o modelo é do repositório)");

    const plano: PassoVps[] = planoVpsNova(fatos);
    // A caixa de entrada do suporte não entra no clique (é do admin, não da VPS; recriar exige o setup e uma release).
    const caixa = caixaDeEntrada();
    const avisoCaixa = caixa.alias === ""
      ? `ℹ Este admin está sem caixa de entrada: as pessoas entram por "Adicionar pessoa" ou por "Nova VPS". Para esta VPS virar a caixa e a central de auditoria: node scripts/suporte-setup.mjs --caixa ${nome}-${PRIMEIRO_USUARIO} --root ${aliasRoot}${caixa.admin !== "" ? ` --nome "${caixa.admin}"` : ""}, e depois uma release (os apps das pessoas levam o suporte.json).`
      : `ℹ A caixa de entrada do suporte continua em ${caixa.alias}; se ela estiver fora do ar, recrie nesta VPS com node scripts/suporte-setup.mjs --caixa ${nome}-${PRIMEIRO_USUARIO} --root ${aliasRoot}${caixa.admin !== "" ? ` --nome "${caixa.admin}"` : ""} e uma release.`;
    const texto = `${textoFinal(nome, plano, { aliasBox, dominio })}\n${avisoCaixa}`;
    const resumo = plano.map((x) => `${x.id}=${x.estado}`).join(" ");
    log(`[vps-nova] ${nome} (${endereco}): ${resumo}`);
    void registrar(suporteAlias, "maquina.vps-nova", nome, resumo);
    onLine(texto);
    return { nome, aliasRoot, suporteAlias, aliasBox, plano, texto, blocoModelo };
  } finally {
    emAndamento.delete(endereco);
  }
}
