import { test } from "node:test";
import assert from "node:assert/strict";
import { lerCsv, planejarContatos } from "../../extensao-crm/src/csv.ts";
import { sugestoesDaConversa } from "../../extensao-crm/src/sugestoes.ts";

test("planejarContatos: CSV novo do Google Contatos (vários e-mails com :::, empresa, cargo)", () => {
  const csv = 'First Name,Middle Name,Last Name,Organization Name,Organization Title,E-mail 1 - Label,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Label,Phone 1 - Value,Notes\n' +
    'Junior,,Rezende,Loja do Junior,Dono,* Work,junior@lojadojunior.com.br ::: JR@gmail.com,,Mobile,+595 994 402904,via WhatsApp\n' +
    ',,,,,* Work,,,Mobile,,\n' + 'Só,Telefone,,,,,,,,11 98888-7777,\n';
  const r = planejarContatos(lerCsv(csv));
  assert.equal(r.ignoradas, 1); assert.equal(r.contatos.length, 2);
  assert.deepEqual(r.contatos[0], { nome: "Junior Rezende", emails: ["junior@lojadojunior.com.br", "jr@gmail.com"], telefones: ["+595 994 402904"], cargo: "Dono", empresa: "Loja do Junior", notas: "via WhatsApp" });
  assert.equal(r.contatos[1].nome, "Só Telefone");
});

test("planejarContatos: formato antigo (Name, Organization 1 - Name) e planilha simples em português com ;", () => {
  const antigo = planejarContatos(lerCsv('Name,Given Name,Family Name,E-mail 1 - Value,Phone 1 - Value,Organization 1 - Name,Organization 1 - Title\nAna Souza,Ana,Souza,ana@acme.com,,Acme,Compras\n'));
  assert.deepEqual(antigo.contatos[0], { nome: "Ana Souza", emails: ["ana@acme.com"], telefones: [], cargo: "Compras", empresa: "Acme", notas: "" });
  const pt = planejarContatos(lerCsv('Nome;E-mail;Telefone;Empresa;Cargo\nBeto;beto@x.com.br;(11) 3333-4444;X Ltda;CEO\n'));
  assert.deepEqual(pt.contatos[0], { nome: "Beto", emails: ["beto@x.com.br"], telefones: ["(11) 3333-4444"], cargo: "CEO", empresa: "X Ltda", notas: "" });
});

test("sugestoesDaConversa: tira você, automáticos, quem já está na caixa e repetidos; guarda o nome", () => {
  const s = sugestoesDaConversa([
    { email: "eu@minha.com", nome: "Eu" }, { email: "noreply@banco.com", nome: "" }, { email: "Ana@Acme.com", nome: "" },
    { email: "ana@acme.com", nome: "Ana Souza" }, { email: "beto@x.com", nome: "Beto" }, { email: "lixo", nome: "x" },
  ], "EU@minha.com", ["beto@x.com"]);
  assert.deepEqual(s, [{ email: "ana@acme.com", nome: "Ana Souza" }]);
});

test("separarContato: nome + telefone, nome + e-mail, só um deles", async () => {
  const { separarContato } = await import("../../extensao-crm/src/sugestoes.ts");
  assert.deepEqual(separarContato("Manager Martins +55 (11) 98869-8139"), { nome: "Manager Martins", telefone: "+55 (11) 98869-8139" });
  assert.deepEqual(separarContato("Ana Souza <Ana@Acme.com>"), { nome: "Ana Souza", email: "ana@acme.com" });
  assert.deepEqual(separarContato("11 98888-7777"), { nome: "", telefone: "11 98888-7777" });
  assert.deepEqual(separarContato("Junior Rezende"), { nome: "Junior Rezende" });
  assert.deepEqual(separarContato("Beto · beto@x.com · +55 11 3333-4444"), { nome: "Beto", email: "beto@x.com", telefone: "+55 11 3333-4444" });
});
