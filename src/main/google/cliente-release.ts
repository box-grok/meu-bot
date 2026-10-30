/**
 * Busca o client OAuth do Google na última release quando o build veio sem (IO de cliente-release-core.ts): consulta
 * o feed estável, baixa `<nome>` e `<nome>.sig`, confere a assinatura com UPDATE_PUBLIC_KEYS (a mesma das
 * atualizações), valida o JSON e grava em userData/google-cliente-baixado/. Uma busca por vez; sem o arquivo na
 * release, só tenta de novo depois de 6 h ou a pedido.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { UPDATE_PUBLIC_KEYS, releasesUrl, verificaAssinatura } from "../atualizacao/updater-core";
import { appTitle } from "../app/variant";
import { parseClienteOAuth } from "./google-core";
import { gravar } from "./comum";
import { log } from "../maquina/backend";
import { CLIENTES_GOOGLE, MAX_CLIENTE_BYTES, PASTA_BAIXADOS, deveBuscar, motivoSemCliente, pickClienteAsset, type NomeCliente } from "./cliente-release-core";

const PRAZO_MS = 15_000;
export const caminhoBaixado = (nome: NomeCliente): string => path.join(app.getPath("userData"), PASTA_BAIXADOS, nome);
const temBaixado = (nome: NomeCliente): boolean => { try { return parseClienteOAuth(JSON.parse(fs.readFileSync(caminhoBaixado(nome), "utf8"))) !== null; } catch { return false; } };

let ultima: number | null = null;
let emCurso: Promise<string | null> | null = null;

async function texto(url: string): Promise<string> {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": `${appTitle()}/${app.getVersion()}` }, signal: AbortSignal.timeout(PRAZO_MS) });
  if (!r.ok) throw new Error(`${url.split("/").pop() ?? url}: HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > MAX_CLIENTE_BYTES) throw new Error("arquivo grande demais para ser um client OAuth");
  return b.toString("utf8");
}

/**
 * Garante os clients que faltam. Devolve null quando não falta nada (ou tudo foi baixado); senão o motivo para a
 * tela. Nunca lança: sem internet é só um motivo.
 */
export function garantirClientesGoogle(opts: { forcar?: boolean } = {}): Promise<string | null> {
  const faltam = CLIENTES_GOOGLE.filter((n) => !temBaixado(n));
  if (faltam.length === 0) return Promise.resolve(null);
  if (emCurso !== null) return emCurso;
  if (!deveBuscar(ultima, Date.now(), opts.forcar === true)) return Promise.resolve(motivoSemCliente({ tag: null, faltam, erro: "tentei há pouco; peça de novo para repetir agora" }));
  emCurso = (async (): Promise<string | null> => {
    ultima = Date.now();
    let tag: string | null = null;
    try {
      const feed = await fetch(releasesUrl("estavel"), { headers: { "User-Agent": `${appTitle()}/${app.getVersion()}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(PRAZO_MS) });
      if (!feed.ok) throw new Error(`GitHub respondeu ${feed.status}`);
      const raw: unknown = await feed.json();
      const aindaFaltam: NomeCliente[] = [];
      for (const nome of faltam) {
        const c = pickClienteAsset(raw, nome);
        if (c === null) { aindaFaltam.push(nome); tag = tag ?? ((raw as { tag_name?: unknown }).tag_name as string | undefined) ?? null; continue; }
        tag = c.tag;
        const [json, sig] = await Promise.all([texto(c.asset.url), texto(c.sig.url)]);
        if (!verificaAssinatura(Buffer.from(json, "utf8"), sig, UPDATE_PUBLIC_KEYS.map((k) => k.chave))) { log(`[google] ${nome} da release ${c.tag} não confere com a chave da release: ignorado`); aindaFaltam.push(nome); continue; }
        if (parseClienteOAuth(JSON.parse(json)) === null) { log(`[google] ${nome} da release ${c.tag} não é um client OAuth válido: ignorado`); aindaFaltam.push(nome); continue; }
        fs.mkdirSync(path.dirname(caminhoBaixado(nome)), { recursive: true, mode: 0o700 });
        gravar(caminhoBaixado(nome), json);
        log(`[google] ${nome} baixado da release ${c.tag} (assinatura ok)`);
      }
      return motivoSemCliente({ tag, faltam: aindaFaltam, erro: null });
    } catch (e) {
      return motivoSemCliente({ tag, faltam, erro: e instanceof Error ? e.message : String(e) });
    } finally {
      emCurso = null;
    }
  })();
  return emCurso;
}
