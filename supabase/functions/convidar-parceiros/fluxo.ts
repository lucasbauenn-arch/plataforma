// Fluxo do convite de parceiros (docs/ARQUITETURA_EXPANSAO.md §6.2), sem Deno nem supabase-js: o index.ts liga as
// dependências às APIs (RPCs com o JWT de quem pede, Auth admin e RPCs de sistema com a service role) e os testes
// (src/lib/convites.test.ts) usam dublês. Módulo PURO: sem imports, sem Deno.*, sem npm:.
//
// Ordem no caso "novo" [WP1R-02]: a conta nasce SEM e-mail (generateLink invite), é vinculada ao parceiro
// (rede_vincular_login) e o convite é auditado (rede_registrar_convite); só então o link é devolvido (modo "link") ou o
// e-mail sai (modo "email": inviteUserByEmail reenvia para a MESMA conta, ainda não confirmada). Se o vínculo falhar,
// a conta criada por ESTE convite é apagada (continua sem vínculo, nunca entrou, não confirmou e nasceu durante esta
// chamada); assim não sobra conta órfã que prenderia o e-mail ("email_em_uso" para sempre).

export type Modo = "email" | "link";
export type Situacao = "novo" | "reenviar" | "email_em_uso" | "ja_ativo" | "sem_email" | "indisponivel";

/** Situação de cada parceiro na resposta (a mesma união de StatusConvite em src/lib/convites.ts). */
export const STATUS = [
  "convidado", "reenviado", "email_em_uso", "ja_ativo", "sem_email", "indisponivel",
  "sem_permissao", "modo_nao_permitido", "limite", "erro",
] as const;
export type Status = (typeof STATUS)[number];

/** Resposta de rede_pode_convidar (src/modulos/rede/tipos.ts, PodeConvidar). */
export type PodeConvidar = {
  pode: boolean;
  situacao: Situacao;
  email: string | null;
  nome: string;
  modo_link: boolean;
  profile_id?: string | null;
};

export type Resultado = {
  parceiro_id: string;
  nome: string | null;
  email: string | null;
  status: Status;
  mensagem: string;
  link?: string;
};

export type Pedido = { ids: string[]; modo: Modo; origem: string | null };

/** Erro de PostgREST ou do Auth, só com o que o fluxo lê. */
export type ErroApi = { code?: string | null; message?: string | null; details?: string | null } | null;

/** Conta do Auth (User do supabase-js), só com o que o fluxo lê. */
export type ContaAuth = {
  id: string;
  created_at?: string | null;
  invited_at?: string | null;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
};

export interface Dependencias {
  /** rede_pode_convidar com o JWT de quem pede (matriz, escopo, aal2 e limite por hora decididos pelo banco). */
  podeConvidar(parceiroId: string): Promise<{ data: PodeConvidar | null; error: ErroApi }>;
  /** Auth admin generateLink({type:'invite'}): cria a conta (ou devolve a mesma, não confirmada) SEM enviar e-mail. */
  gerarConvite(email: string, nome: string, redirectTo: string): Promise<{ conta: ContaAuth | null; tokenHash: string | null; error: ErroApi }>;
  /** Auth admin inviteUserByEmail: envia o e-mail de convite (conta nova ou não confirmada). */
  enviarConvite(email: string, nome: string, redirectTo: string): Promise<{ conta: ContaAuth | null; error: ErroApi }>;
  /** RPC de sistema rede_vincular_login. */
  vincular(parceiroId: string, contaId: string): Promise<{ error: ErroApi }>;
  /** RPC de sistema rede_registrar_convite (auditoria de quem gerou, para quem e o modo). */
  registrar(parceiroId: string, modo: Modo): Promise<{ error: ErroApi }>;
  /** Parceiro vinculado à conta (parceiros.profile_id), lido com a service role. */
  vinculoDaConta(contaId: string): Promise<{ parceiroId: string | null; error: ErroApi }>;
  /** Auth admin getUserById. */
  buscarConta(contaId: string): Promise<{ conta: ContaAuth | null; error: ErroApi }>;
  /** Auth admin deleteUser. */
  apagarConta(contaId: string): Promise<{ error: ErroApi }>;
  /** Relógio (ms). */
  agora(): number;
  /** Log sem dado pessoal: etapa, parceiro e a mensagem limpa. */
  registrarErro(etapa: string, parceiroId: string, erro: unknown): void;
}

export const MAXIMO = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Folga para a diferença de relógio entre a Edge e o Auth ao decidir se a conta nasceu nesta chamada. */
export const FOLGA_RELOGIO_MS = 60_000;

export const MENSAGENS: Record<Exclude<Status, "convidado" | "reenviado">, string> = {
  email_em_uso: "Este e-mail já tem uma conta na plataforma: nenhum convite foi gerado. Confira o e-mail cadastrado ou fale com a equipe Arken.",
  ja_ativo: "Esta pessoa já tem acesso: oriente a usar \"Esqueci a senha\" na tela de login.",
  sem_email: "Cadastre um e-mail antes de convidar.",
  indisponivel: "Parceiro inativo ou da cadeia da casa: não recebe convite.",
  sem_permissao: "Você não tem acesso a este parceiro.",
  modo_nao_permitido: "Seu perfil convida só por e-mail.",
  limite: "Muitas consultas de e-mails que já têm conta na última hora. Aguarde e tente de novo.",
  erro: "Não foi possível gerar o convite agora. Tente de novo.",
};

const MSG_VINCULO_DESFEITO = "O acesso não pôde ser vinculado a este parceiro. Nenhum convite foi enviado: tente de novo.";
const MSG_VINCULO_PENDENTE = "O acesso não pôde ser vinculado a este parceiro. Nenhum convite foi enviado: fale com a equipe Arken.";
const MSG_SEM_REGISTRO = "O acesso foi criado, mas o convite não pôde ser registrado e não foi enviado. Tente convidar de novo.";
const MSG_EMAIL_FALHOU = "O acesso foi criado, mas o e-mail não pôde ser enviado. Tente convidar de novo para reenviar.";

export function lerPedido(corpo: Record<string, unknown>): { ok: true; valor: Pedido } | { ok: false; erro: string } {
  const bruto = corpo.parceiro_ids;
  if (!Array.isArray(bruto) || bruto.length === 0) return { ok: false, erro: "Informe ao menos um parceiro." };
  if (bruto.length > MAXIMO) return { ok: false, erro: `Máximo de ${MAXIMO} parceiros por vez.` };
  if (!bruto.every((x) => typeof x === "string" && UUID.test(x))) return { ok: false, erro: "Parceiro inválido." };
  const modo = corpo.modo;
  if (modo !== "email" && modo !== "link") return { ok: false, erro: "Modo de convite inválido." };
  const origem = typeof corpo.origem === "string" ? corpo.origem.trim() : null;
  const ids = [...new Set((bruto as string[]).map((x) => x.toLowerCase()))];
  return { ok: true, valor: { ids, modo, origem } };
}

/** O Auth responde email_exists / "already registered" quando a conta já existe e já foi confirmada. */
export function jaExiste(erro: ErroApi): boolean {
  if (!erro) return false;
  return erro.code === "email_exists" || /already|registered|exists/i.test(erro.message ?? "");
}

/** `motivo` do detail de DADOS_INVALIDOS (rede_vincular_login), ou nulo. */
export function motivoDoErro(erro: ErroApi): string | null {
  if (!erro || erro.code !== "P0001" || !erro.details) return null;
  try {
    const d = JSON.parse(erro.details) as { motivo?: unknown };
    return typeof d.motivo === "string" ? d.motivo : null;
  } catch {
    return null;
  }
}

/**
 * Recusas do vínculo em que a conta é a que ESTE convite criou e ficou sem uso: o e-mail do parceiro mudou, o parceiro
 * foi inativado ou outro convite o vinculou antes. As demais (com_senha, ja_entrou, perfil_antigo, perfil,
 * perfil_vinculado, nao_convidado) dizem que a conta é de outra pessoa ou de outro fluxo: nunca é apagada.
 * Falha sem resposta do banco (rede, 5xx): decide a conferência do vínculo e da conta.
 */
const MOTIVOS_DA_CONTA_NOVA = new Set(["email_diferente", "parceiro", "parceiro_ja_vinculado"]);

/** A conta nasceu do convite desta chamada e nunca foi usada? */
export function contaRecemCriada(conta: ContaAuth, inicioMs: number): boolean {
  if (!conta.invited_at || conta.last_sign_in_at || conta.email_confirmed_at || !conta.created_at) return false;
  const criada = Date.parse(conta.created_at);
  return Number.isFinite(criada) && criada >= inicioMs - FOLGA_RELOGIO_MS;
}

export type Desfecho = "vinculada_a_este" | "apagada" | "mantida";

/** Depois de o vínculo falhar: apaga a conta criada por este convite, se ainda estiver sem uso. */
export async function desfazerConta(d: Dependencias, parceiroId: string, contaId: string, erro: ErroApi, inicioMs: number): Promise<Desfecho> {
  const motivo = motivoDoErro(erro);
  if (erro?.code === "P0001" && (motivo === null || !MOTIVOS_DA_CONTA_NOVA.has(motivo))) return "mantida";
  const v = await d.vinculoDaConta(contaId);
  if (v.error) {
    d.registrarErro("conferir vínculo", parceiroId, v.error);
    return "mantida";
  }
  // a resposta do vínculo se perdeu, mas ele foi gravado: segue o convite
  if (v.parceiroId === parceiroId) return "vinculada_a_este";
  if (v.parceiroId) return "mantida";
  const c = await d.buscarConta(contaId);
  if (c.error || !c.conta) {
    d.registrarErro("conferir conta", parceiroId, c.error ?? "conta não encontrada");
    return "mantida";
  }
  if (!contaRecemCriada(c.conta, inicioMs)) return "mantida";
  const a = await d.apagarConta(contaId);
  if (a.error) {
    d.registrarErro("apagar conta sem vínculo", parceiroId, a.error);
    return "mantida";
  }
  return "apagada";
}

export const linkDefinirSenha = (base: string, tokenHash: string) =>
  `${base}/parceiros/definir-senha?token_hash=${encodeURIComponent(tokenHash)}&type=invite`;

export async function convidarUm(d: Dependencias, id: string, modo: Modo, base: string): Promise<Resultado> {
  const resposta = await d.podeConvidar(id);
  if (resposta.error || !resposta.data) {
    const e = resposta.error;
    if (e?.code === "42501") return { parceiro_id: id, nome: null, email: null, status: "sem_permissao", mensagem: MENSAGENS.sem_permissao };
    if (e?.code === "P0001" && e.message === "LIMITE_CONVITES") {
      return { parceiro_id: id, nome: null, email: null, status: "limite", mensagem: MENSAGENS.limite };
    }
    d.registrarErro("rede_pode_convidar", id, e ?? "resposta vazia");
    return { parceiro_id: id, nome: null, email: null, status: "erro", mensagem: MENSAGENS.erro };
  }
  const p = resposta.data;
  const r = (status: Status, mensagem: string, link?: string): Resultado =>
    ({ parceiro_id: id, nome: p.nome ?? null, email: p.email ?? null, status, mensagem, ...(link ? { link } : {}) });

  if (p.situacao === "email_em_uso" || p.situacao === "ja_ativo" || p.situacao === "sem_email" || p.situacao === "indisponivel") {
    return r(p.situacao, MENSAGENS[p.situacao]);
  }
  if (!p.pode || !p.email || (p.situacao !== "novo" && p.situacao !== "reenviar")) return r("erro", MENSAGENS.erro);
  if (modo === "link" && !p.modo_link) return r("modo_nao_permitido", MENSAGENS.modo_nao_permitido);

  const redirectTo = `${base}/parceiros/definir-senha`;
  const nome = p.nome;

  if (p.situacao === "novo") {
    const inicio = d.agora();
    // 1. a conta nasce SEM e-mail
    const g = await d.gerarConvite(p.email, nome, redirectTo);
    if (g.error) {
      if (jaExiste(g.error)) return r("email_em_uso", MENSAGENS.email_em_uso);
      d.registrarErro("generateLink", id, g.error);
      return r("erro", MENSAGENS.erro);
    }
    const conta = g.conta;
    if (!conta?.id) return r("erro", MENSAGENS.erro);
    // 2. vínculo (só o perfil recém-criado por ESTE convite: convidado, sem senha, nunca entrou, < 10 min, mesmo e-mail)
    const v = await d.vincular(id, conta.id);
    if (v.error) {
      d.registrarErro("rede_vincular_login", id, v.error);
      const desfecho = await desfazerConta(d, id, conta.id, v.error, inicio);
      if (desfecho === "apagada") return r("erro", MSG_VINCULO_DESFEITO);
      if (desfecho === "mantida") return r("erro", MSG_VINCULO_PENDENTE);
    }
    // 3. auditoria antes de qualquer entrega
    const a = await d.registrar(id, modo);
    if (a.error) {
      d.registrarErro("rede_registrar_convite", id, a.error);
      return r("erro", MSG_SEM_REGISTRO);
    }
    // 4. entrega
    if (modo === "link") {
      if (!g.tokenHash) return r("erro", MSG_SEM_REGISTRO);
      return r("convidado", "Link gerado: vale 24 h e só pode ser usado uma vez.", linkDefinirSenha(base, g.tokenHash));
    }
    const e = await d.enviarConvite(p.email, nome, redirectTo);
    if (e.error || e.conta?.id !== conta.id) {
      d.registrarErro("inviteUserByEmail", id, e.error ?? "a conta do e-mail não é a vinculada");
      return r("erro", MSG_EMAIL_FALHOU);
    }
    return r("convidado", "Convite enviado por e-mail.");
  }

  // reenviar: conta já vinculada a ESTE parceiro e que nunca entrou (o id devolvido pelo Auth é conferido)
  if (modo === "link") {
    const g = await d.gerarConvite(p.email, nome, redirectTo);
    if (g.error) {
      if (jaExiste(g.error)) return r("ja_ativo", MENSAGENS.ja_ativo);
      d.registrarErro("generateLink", id, g.error);
      return r("erro", MENSAGENS.erro);
    }
    if (!g.conta?.id || g.conta.id !== p.profile_id || !g.tokenHash) {
      d.registrarErro("reenviar", id, "a conta devolvida pelo Auth não é a vinculada ao parceiro");
      return r("erro", MENSAGENS.erro);
    }
    const a = await d.registrar(id, modo);
    if (a.error) {
      d.registrarErro("rede_registrar_convite", id, a.error);
      return r("erro", MENSAGENS.erro);
    }
    return r("reenviado", "Link gerado: vale 24 h e só pode ser usado uma vez.", linkDefinirSenha(base, g.tokenHash));
  }
  const a = await d.registrar(id, modo);
  if (a.error) {
    d.registrarErro("rede_registrar_convite", id, a.error);
    return r("erro", MENSAGENS.erro);
  }
  const e = await d.enviarConvite(p.email, nome, redirectTo);
  if (e.error) {
    if (jaExiste(e.error)) return r("ja_ativo", MENSAGENS.ja_ativo);
    d.registrarErro("inviteUserByEmail", id, e.error);
    return r("erro", MENSAGENS.erro);
  }
  if (e.conta?.id !== p.profile_id) {
    d.registrarErro("reenviar", id, "a conta devolvida pelo Auth não é a vinculada ao parceiro");
    return r("erro", MENSAGENS.erro);
  }
  return r("reenviado", "Convite reenviado por e-mail.");
}
