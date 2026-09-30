// Validação do corpo do pré-cadastro público (docs/ARQUITETURA_EXPANSAO.md §6.1, passo 3): formato do código de
// indicação, DV de CPF/CNPJ, telefone com DDD, e-mail opcional e termo_id uuid. A RPC crm_pre_cadastro confere tudo
// de novo no banco (a Edge é só a primeira barreira).
// Módulo PURO: sem Deno.* nem npm:, testado no Vitest (dados.test.ts).

export type TipoPessoa = "fisica" | "juridica";

/** `p_dados` de crm_pre_cadastro (PreCadastroDados em src/modulos/crm/tipos.ts). */
export type DadosPreCadastro = {
  tipo_pessoa: TipoPessoa;
  nome: string;
  sobrenome: string | null;
  /** CPF (11) ou CNPJ (14), só dígitos, conforme tipo_pessoa. */
  documento: string;
  email: string | null;
  telefone: string;
};

export type PedidoPreCadastro = {
  /** Código de indicação normalizado (minúsculas). */
  codigo: string;
  termoId: string;
  dados: DadosPreCadastro;
};

export type ValidacaoPreCadastro =
  | { ok: true; valor: PedidoPreCadastro }
  /** `codigo` inválido responde 404 (como código inexistente); os demais campos, 422. */
  | { ok: false; campos: string[] };

const CODIGO = /^[a-z2-7]{10}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const soDigitos = (v: string) => v.replace(/\D/g, "");

/** Mesma regra de public.cpf_valido. */
export function cpfValido(v: string): boolean {
  const cpf = soDigitos(v);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

/** Mesma regra de public.cnpj_valido. */
export function cnpjValido(v: string): boolean {
  const cnpj = soDigitos(v);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(cnpj[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
}

/** Texto aparado; vazio, ausente ou de outro tipo = nulo. */
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Valida e normaliza o corpo JSON recebido. Nunca devolve os valores recusados (só os nomes dos campos). */
export function validarPreCadastro(corpo: Record<string, unknown>): ValidacaoPreCadastro {
  const codigo = (texto(corpo.codigo) ?? "").toLowerCase();
  if (!CODIGO.test(codigo)) return { ok: false, campos: ["codigo"] };

  const campos: string[] = [];
  const tipo = corpo.tipo_pessoa === "fisica" || corpo.tipo_pessoa === "juridica" ? corpo.tipo_pessoa : null;
  if (!tipo) campos.push("tipo_pessoa");

  const nome = texto(corpo.nome);
  if (!nome || nome.length < 2 || nome.length > 200) campos.push("nome");

  const sobrenome = tipo === "fisica" ? texto(corpo.sobrenome) : null;
  if (sobrenome && sobrenome.length > 200) campos.push("sobrenome");

  const documento = soDigitos(texto(corpo.documento) ?? "");
  if (tipo === "fisica" && !cpfValido(documento)) campos.push("cpf");
  if (tipo === "juridica" && !cnpjValido(documento)) campos.push("cnpj");

  const email = texto(corpo.email)?.toLowerCase() ?? null;
  if (email && (email.length > 200 || !EMAIL.test(email))) campos.push("email");

  const telefone = soDigitos(texto(corpo.telefone) ?? "");
  if (!/^\d{10,11}$/.test(telefone)) campos.push("telefone");

  const termoId = texto(corpo.termo_id) ?? "";
  if (!UUID.test(termoId)) campos.push("termo_id");

  if (campos.length || !tipo || !nome) return { ok: false, campos };
  return {
    ok: true,
    valor: {
      codigo,
      termoId: termoId.toLowerCase(),
      dados: { tipo_pessoa: tipo, nome, sobrenome, documento, email, telefone },
    },
  };
}

/**
 * Resultado de crm_pre_cadastro → resposta HTTP. Criado e duplicado são IGUAIS para quem chama (§6.1): mesmo status,
 * mesmo corpo (e, no banco, a mesma confirmação por e-mail para o endereço digitado).
 * - `termo_invalido`: não há termo vigente revisado pelo jurídico (H4) → 503;
 * - `termo_desatualizado`: há, mas a página enviou outro (versão publicada com a página aberta) → 409, a página relê o
 *   termo e pede o aceite de novo;
 * - `limite`: o link passou do limite de bloqueios por hora da A2 (conferido antes de olhar o documento) → 429.
 */
export type SituacaoPreCadastro =
  | "criado" | "duplicado" | "codigo_invalido" | "termo_invalido" | "termo_desatualizado" | "limite";

export const MENSAGEM_LINK_INVALIDO = "Este link de indicação não é válido ou foi desativado. Peça um link novo a quem indicou você.";
export const MENSAGEM_INDISPONIVEL = "O pré-cadastro está temporariamente indisponível. Tente de novo mais tarde.";
export const MENSAGEM_TERMO_DESATUALIZADO = "O termo de consentimento foi atualizado. Leia a nova versão e aceite para continuar.";
export const MENSAGEM_LIMITE_LINK = "Muitas tentativas por este link. Aguarde uma hora e tente de novo, ou fale com quem indicou você.";
export const MENSAGEM_DADOS = "Confira os dados informados e tente de novo.";

export type RespostaPreCadastro =
  | { status: 200; corpo: { ok: true }; sucesso: true }
  | { status: 404 | 409 | 429 | 503; mensagem: string; codigo: string; sucesso: false };

export function respostaDaSituacao(situacao: unknown): RespostaPreCadastro | null {
  switch (situacao) {
    case "criado":
    case "duplicado":
      return { status: 200, corpo: { ok: true }, sucesso: true };
    case "codigo_invalido":
      return { status: 404, mensagem: MENSAGEM_LINK_INVALIDO, codigo: "codigo_invalido", sucesso: false };
    case "termo_invalido":
      return { status: 503, mensagem: MENSAGEM_INDISPONIVEL, codigo: "indisponivel", sucesso: false };
    case "termo_desatualizado":
      return { status: 409, mensagem: MENSAGEM_TERMO_DESATUALIZADO, codigo: "termo_desatualizado", sucesso: false };
    case "limite":
      return { status: 429, mensagem: MENSAGEM_LIMITE_LINK, codigo: "limite_link", sucesso: false };
    default:
      return null;
  }
}

/** Campos do `detail` de um DADOS_INVALIDOS da RPC ({"campos":[...]}), só nomes conhecidos. */
export function camposDoDetalhe(detalhe: unknown): string[] {
  if (typeof detalhe !== "string") return [];
  try {
    const d = JSON.parse(detalhe) as { campos?: unknown };
    return Array.isArray(d.campos) ? d.campos.filter((c): c is string => typeof c === "string" && /^[a-z_]{1,40}$/.test(c)) : [];
  } catch {
    return [];
  }
}
