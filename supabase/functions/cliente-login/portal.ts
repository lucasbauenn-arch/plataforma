// Regras do login do portal por CPF (docs/ARQUITETURA_EXPANSAO.md §1.2 N1, §6.7). Módulo PURO: sem Deno.*, sem npm:/jsr:;
// roda no Deno e no Vitest (portal.test.ts). O acesso ao banco e ao Auth entra por `PortaLocalizar`/`GatewayPortal`,
// implementados com a service role em index.ts.
//
// Três decisões de segurança vivem aqui (revisão final, WP7R1-01 e WP7R1-02):
//   1. LIMITE: por IP (IPv6 agrupado pela rede /64; sem IP identificável = um balde comum, nunca "sem limite") e
//      um teto global de falhas, porque o login só por CPF não tem outro fator. Tudo sobre tentativas_publicas, com
//      RESERVA ATÔMICA no banco (FR1-01): conferir e gravar são um passo só; uma rajada simultânea não passa do limite.
//   2. CONTA: a conta do Auth do portal só é criada por esta função, com app_metadata.portal_cliente_id (só a service
//      role grava app_metadata). Uma conta que já tenha o e-mail interno do cliente mas NÃO tenha o marcador (por exemplo,
//      criada por quem se cadastrou pelo signUp público com esse e-mail) NUNCA é adotada: o primeiro login promoveria o
//      perfil dela a 'cliente', ligaria à ficha do cliente e confirmaria o e-mail, e o atacante entraria com a senha dele.
//   3. COMPATIBILIDADE DE DEPLOY (DEP-01): a função nova funciona com o banco ANTES da migration 15 (portal_localizar_cliente
//      ainda é o esqueleto, erro 0A000: cai na leitura direta, que segue o mesmo contrato) e DEPOIS dela. O limite (item 1)
//      depende da migration 19 (tentativas_reservar): publicada antes do db push, a função responde 503 até o push
//      terminar (falha fechada; scripts/migracao/DEPLOY.md, passos 1 e 2 em sequência).
import { type ArmazemTentativas, type RegraLimite, type ResultadoReserva, reservarTentativa } from "../_shared/limite-ip.ts";

export const DOMINIO_PORTAL = "portal.arkenincorporadora.com.br";
export const NAO_ENCONTRADO = "CPF não encontrado. Fale com nosso atendimento.";
export const MENSAGEM_LIMITE = "Muitas tentativas. Aguarde 15 minutos e tente de novo.";

/** Por IP (/64 no IPv6; sem IP, balde comum): 10 erros ou 30 tentativas em 15 min (o limite que já existia). */
export const REGRA_PORTAL_IP: RegraLimite = Object.freeze({
  rota: "cliente-login", janelaMs: 15 * 60_000, maxErros: 10, maxTotal: 30,
});
/**
 * Global (todas as origens): 300 falhas ou 600 tentativas em 15 min. Cobre a varredura distribuída (muitos IPs) de CPFs,
 * que o limite por IP não vê. Aceita o custo de disponibilidade: quem consegue gerar 20 falhas por minuto tira o portal
 * do ar por janelas de 15 min (o portal só atende clientes; site, painel e parceiros não dependem dele).
 */
export const REGRA_PORTAL_GLOBAL: RegraLimite = Object.freeze({
  rota: "cliente-login-global", janelaMs: 15 * 60_000, maxErros: 300, maxTotal: 600,
});

/**
 * Reserva a tentativa de login nos DOIS baldes de uma vez (o do IP e o global), sem corrida (FR1-01): antes, o limite
 * era conferido no início e gravado no fim, e uma rajada simultânea do mesmo IP passava inteira (e podia estourar o teto
 * global sozinha). O IP nulo (nenhum cabeçalho válido) usa o balde comum. Chame no INÍCIO da requisição e feche com
 * `reserva.concluir(sucesso)` no fim; quem cai no meio do caminho fica contado como falha. Se o balde do IP bloqueia,
 * o global nem é tocado (um IP bloqueado não consome o teto dos outros).
 */
export function reservarLoginPortal(armazem: ArmazemTentativas, ip: string | null): Promise<ResultadoReserva> {
  return reservarTentativa(armazem, [{ regra: REGRA_PORTAL_IP, ip }, { regra: REGRA_PORTAL_GLOBAL, ip: null }]);
}

export const soDigitos = (v: unknown) => (typeof v === "string" ? v : "").replace(/\D/g, "");

export function cpfValido(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

// ============ localizar o cliente ============

export type ClientePortal = { id: string; nome: string; user_id: string | null };
export type RespostaBanco = { data: unknown; error: { code?: string; message?: string } | null };

export interface PortaLocalizar {
  /** RPC de sistema portal_localizar_cliente (migration 15; na 09 é um esqueleto que responde 0A000) */
  rpc(cpf: string): Promise<RespostaBanco>;
  /** mesma regra por leitura direta: pessoa física, portal liberado, não inativado, não anonimizado */
  direto(cpf: string): Promise<RespostaBanco>;
}

function primeiroCliente(data: unknown): ClientePortal | null {
  const linha = (Array.isArray(data) ? data[0] : data) as Partial<ClientePortal> | null | undefined;
  if (!linha || typeof linha.id !== "string") return null;
  return { id: linha.id, nome: typeof linha.nome === "string" ? linha.nome : "", user_id: typeof linha.user_id === "string" ? linha.user_id : null };
}

/**
 * Localiza o cliente do portal pelo CPF. A RPC é o caminho normal; enquanto a migration 15 não foi aplicada
 * (esqueleto, 0A000), a leitura direta faz o mesmo. Outro erro do banco: lança (o login não segue às cegas).
 */
export async function localizarClientePortal(porta: PortaLocalizar, cpf: string): Promise<ClientePortal | null> {
  const viaRpc = await porta.rpc(cpf);
  if (!viaRpc.error) return primeiroCliente(viaRpc.data);
  if (viaRpc.error.code !== "0A000") {
    throw new Error(`portal_localizar_cliente: ${viaRpc.error.code ?? ""} ${viaRpc.error.message ?? ""}`);
  }
  const direto = await porta.direto(cpf);
  if (direto.error) throw new Error(`clientes (leitura direta): ${direto.error.code ?? ""} ${direto.error.message ?? ""}`);
  return primeiroCliente(direto.data);
}

// ============ conta do Auth do cliente ============

export type ContaAuth = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  email_confirmed_at?: string | null;
  created_at?: string | null;
};

export const emailDoPortal = (clienteId: string) => `cliente-${clienteId}@${DOMINIO_PORTAL}`;

export function marcadorDaConta(conta: ContaAuth | null): string | null {
  const m = conta?.app_metadata?.portal_cliente_id;
  return typeof m === "string" && m ? m : null;
}

/** Contas criadas pela versão antiga (sem marcador) nasceram confirmadas: confirmação e criação no mesmo instante. */
const TOLERANCIA_LEGADA_MS = 60_000;

export type AvaliacaoConta = "valida" | "legada" | "invalida";

/**
 * A conta é a do portal DESTE cliente?
 *   valida   = e-mail interno do cliente + marcador com o id dele + perfil de cliente;
 *   legada   = criada pela versão anterior desta função (sem marcador): e-mail interno do cliente, perfil de cliente e
 *              e-mail confirmado NA CRIAÇÃO (createUser com email_confirm). Uma conta de signUp público só ganha a
 *              confirmação depois (na verificação do link mágico), com dias ou minutos de diferença: não passa;
 *   invalida = qualquer outra (nunca recebe sessão do portal).
 */
export function avaliarConta(clienteId: string, conta: ContaAuth | null, papel: string | null): AvaliacaoConta {
  if (!conta || papel !== "cliente") return "invalida";
  if ((conta.email ?? "").toLowerCase() !== emailDoPortal(clienteId).toLowerCase()) return "invalida";
  const marcador = marcadorDaConta(conta);
  if (marcador !== null) return marcador === clienteId ? "valida" : "invalida";
  const criada = Date.parse(conta.created_at ?? "");
  const confirmada = Date.parse(conta.email_confirmed_at ?? "");
  if (Number.isNaN(criada) || Number.isNaN(confirmada)) return "invalida";
  return Math.abs(confirmada - criada) <= TOLERANCIA_LEGADA_MS ? "legada" : "invalida";
}

export interface GatewayPortal {
  contaPorId(id: string): Promise<ContaAuth | null>;
  /** contas do Auth cujo e-mail é este (via profiles.email, conferindo o e-mail do Auth) */
  contasPorEmail(email: string): Promise<ContaAuth[]>;
  /** createUser com email_confirm e app_metadata.portal_cliente_id; conta = nula quando o e-mail já existe */
  criarConta(clienteId: string, nome: string): Promise<{ conta: ContaAuth | null }>;
  papelDoPerfil(userId: string): Promise<string | null>;
  promoverPerfil(userId: string, nome: string): Promise<void>;
  /** clientes.user_id = userId onde ainda é nulo; true se ligou agora */
  ligarAoCliente(clienteId: string, userId: string): Promise<boolean>;
  userIdDoCliente(clienteId: string): Promise<string | null>;
  estamparMarcador(userId: string, clienteId: string): Promise<void>;
}

export type MotivoRecusa = "conta_ligada_invalida" | "email_ocupado" | "ligacao_concorrente" | "perfil_invalido";
export type ResultadoConta = { ok: true; userId: string; email: string } | { ok: false; motivo: MotivoRecusa };

/**
 * Descobre (ou cria) a conta do Auth do cliente e devolve o e-mail interno para emitir a sessão. Nunca adota uma conta
 * que não seja a do portal deste cliente (ver o cabeçalho): o motivo da recusa vai para o log e a auditoria.
 */
export async function resolverContaDoPortal(gw: GatewayPortal, cliente: ClientePortal): Promise<ResultadoConta> {
  const email = emailDoPortal(cliente.id);

  if (cliente.user_id) {
    const [conta, papel] = await Promise.all([gw.contaPorId(cliente.user_id), gw.papelDoPerfil(cliente.user_id)]);
    const avaliacao = avaliarConta(cliente.id, conta, papel);
    if (avaliacao === "invalida") return { ok: false, motivo: "conta_ligada_invalida" };
    if (avaliacao === "legada") await gw.estamparMarcador(cliente.user_id, cliente.id);
    return { ok: true, userId: cliente.user_id, email };
  }

  let { conta } = await gw.criarConta(cliente.id, cliente.nome);
  if (!conta) {
    // o e-mail já existe: só vale a conta marcada para ESTE cliente (corrida entre dois primeiros logins legítimos)
    const candidatas = await gw.contasPorEmail(email);
    conta = candidatas.find((c) => (c.email ?? "").toLowerCase() === email.toLowerCase() && marcadorDaConta(c) === cliente.id) ?? null;
    if (!conta) return { ok: false, motivo: "email_ocupado" };
  }
  await gw.promoverPerfil(conta.id, cliente.nome);
  if (!(await gw.ligarAoCliente(cliente.id, conta.id)) && (await gw.userIdDoCliente(cliente.id)) !== conta.id) {
    return { ok: false, motivo: "ligacao_concorrente" };
  }
  // confere o resultado como qualquer login futuro conferiria
  const [final, papel] = await Promise.all([gw.contaPorId(conta.id), gw.papelDoPerfil(conta.id)]);
  if (avaliarConta(cliente.id, final, papel) !== "valida") return { ok: false, motivo: "perfil_invalido" };
  return { ok: true, userId: conta.id, email };
}
