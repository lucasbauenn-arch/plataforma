import { describe, expect, it } from 'vitest'
import { chaveIp, type ArmazemTentativas } from '../_shared/limite-ip.ts'
import { armazemEmMemoria, armazemQuebrado } from '../_shared/limite-ip.memoria.ts'
import {
  ACESSO_SUSPENSO,
  CADASTRO_INATIVO,
  NAO_ENCONTRADO,
  respostaSemAcesso,
  situacaoDoCpf,
  REGRA_PORTAL_GLOBAL,
  REGRA_PORTAL_IP,
  avaliarConta,
  cpfValido,
  emailDoPortal,
  localizarClientePortal,
  reservarLoginPortal,
  resolverContaDoPortal,
  soDigitos,
  type ClientePortal,
  type ContaAuth,
  type GatewayPortal,
  type PortaLocalizar,
} from './portal.ts'

const CLIENTE = '11111111-1111-4111-8111-111111111111'
const OUTRO = '22222222-2222-4222-8222-222222222222'
const EMAIL = emailDoPortal(CLIENTE)

const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

// ---------------------------------------------------------------------------------------------- limite (WP7R1-01, FR1-01)

/** Uma tentativa de login inteira: reserva nos dois baldes, "processa" (com espera) e fecha a reserva. */
async function tentarLogin(armazem: ArmazemTentativas, ip: string | null, sucesso: boolean, trabalhoMs = 0) {
  const reserva = await reservarLoginPortal(armazem, ip)
  if (!reserva.permitido) return reserva
  if (trabalhoMs) await esperar(trabalhoMs)
  await reserva.concluir(sucesso)
  return reserva
}

describe('limite do login do portal', () => {
  it('as regras têm o formato aceito por tentativas_publicas', () => {
    expect(REGRA_PORTAL_IP).toMatchObject({ rota: 'cliente-login', janelaMs: 900_000, maxErros: 10, maxTotal: 30 })
    expect(REGRA_PORTAL_GLOBAL.rota).toMatch(/^[a-z0-9_-]{1,60}$/)
    expect(REGRA_PORTAL_GLOBAL.maxErros).toBeLessThanOrEqual(REGRA_PORTAL_GLOBAL.maxTotal)
  })

  it('cada tentativa reserva os DOIS baldes (o do IP e o global) numa chamada só', async () => {
    const { armazem, linhas, chamadas } = armazemEmMemoria()
    expect((await reservarLoginPortal(armazem, '203.0.113.9')).permitido).toBe(true)
    expect(chamadas.reservar).toBe(1)
    expect(linhas.map((l) => [l.rota, l.ip, l.sucesso])).toEqual([
      ['cliente-login', '203.0.113.9', false],
      ['cliente-login-global', null, false],
    ])
  })

  it('10 erros do mesmo IPv4 bloqueiam a 11ª tentativa', async () => {
    const { armazem } = armazemEmMemoria()
    for (let i = 0; i < 10; i++) expect((await tentarLogin(armazem, '203.0.113.9', false)).permitido).toBe(true)
    expect(await tentarLogin(armazem, '203.0.113.9', false)).toMatchObject({ permitido: false, motivo: 'erros' })
    expect((await tentarLogin(armazem, '203.0.113.10', false)).permitido).toBe(true)
  })

  it('IPv6: trocar de endereço dentro da mesma /64 NÃO contorna o limite', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    for (let i = 1; i <= 10; i++) await tentarLogin(armazem, `2001:db8:1:2::${i.toString(16)}`, false)
    expect(new Set(linhas.filter((l) => l.rota === 'cliente-login').map((l) => l.ip))).toEqual(new Set(['2001:db8:1:2::']))
    // 11º endereço da mesma rede: bloqueado
    expect(await tentarLogin(armazem, '2001:db8:1:2:aaaa:bbbb:cccc:dddd', false)).toMatchObject({ permitido: false, motivo: 'erros' })
    // outra /64: livre
    expect((await tentarLogin(armazem, '2001:db8:1:3::1', false)).permitido).toBe(true)
  })

  it('sem IP identificável: um balde comum (antes não havia limite nenhum)', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    for (let i = 0; i < 10; i++) await tentarLogin(armazem, null, false)
    expect(linhas.filter((l) => l.rota === 'cliente-login').every((l) => l.ip === null)).toBe(true)
    expect(await tentarLogin(armazem, null, false)).toMatchObject({ permitido: false, motivo: 'erros' })
    // IP nulo por cabeçalho inválido é o mesmo balde
    expect(await tentarLogin(armazem, 'lixo', false)).toMatchObject({ permitido: false })
  })

  it('30 tentativas (mesmo com sucesso) bloqueiam o IP', async () => {
    const { armazem } = armazemEmMemoria()
    for (let i = 0; i < 30; i++) expect((await tentarLogin(armazem, '198.51.100.7', true)).permitido).toBe(true)
    expect(await tentarLogin(armazem, '198.51.100.7', true)).toMatchObject({ permitido: false, motivo: 'total' })
  })

  it('teto global: muitos IPs, cada um com poucos erros, ainda esbarram no total de falhas', async () => {
    const { armazem } = armazemEmMemoria()
    for (let i = 0; i < REGRA_PORTAL_GLOBAL.maxErros; i++) {
      expect((await tentarLogin(armazem, `203.0.${Math.floor(i / 200)}.${(i % 200) + 1}`, false)).permitido).toBe(true)
    }
    // um IP que nunca errou é bloqueado pelo teto global
    expect(await tentarLogin(armazem, '192.0.2.200', false)).toMatchObject({ permitido: false, motivo: 'erros' })
  })

  it('logins com sucesso não gastam o teto global de FALHAS (a reserva é confirmada)', async () => {
    const { armazem } = armazemEmMemoria()
    for (let i = 0; i < 100; i++) await tentarLogin(armazem, `203.0.${Math.floor(i / 50)}.${(i % 50) + 1}`, true)
    for (let i = 0; i < REGRA_PORTAL_GLOBAL.maxErros - 1; i++) {
      await tentarLogin(armazem, `198.18.${Math.floor(i / 200)}.${(i % 200) + 1}`, false)
    }
    expect((await tentarLogin(armazem, '192.0.2.201', true)).permitido).toBe(true) // 299 falhas: ainda cabe uma
  })

  it('janela: erros de mais de 15 minutos atrás não contam', async () => {
    let agora = new Date('2026-09-28T12:00:00Z')
    const { armazem } = armazemEmMemoria({ relogio: () => agora })
    for (let i = 0; i < 10; i++) await tentarLogin(armazem, '203.0.113.9', false)
    expect((await tentarLogin(armazem, '203.0.113.9', false)).permitido).toBe(false)
    agora = new Date(agora.getTime() + 15 * 60_000 + 1)
    expect((await tentarLogin(armazem, '203.0.113.9', false)).permitido).toBe(true)
  })

  it('banco fora do ar: recusa (503), nunca libera; sem a migration 19 (função inexistente) também', async () => {
    expect(await reservarLoginPortal(armazemQuebrado, '203.0.113.9')).toMatchObject({ permitido: false, motivo: 'indisponivel' })
    const semMigration: ArmazemTentativas = {
      reservar: () => Promise.reject(new Error('tentativas_reservar: PGRST202 Could not find the function')),
      confirmar: async () => {},
    }
    expect(await reservarLoginPortal(semMigration, '203.0.113.9')).toMatchObject({ permitido: false, motivo: 'indisponivel' })
  })

  it('a chave de IP é a mesma usada pelo pre-cadastro', () => {
    expect(chaveIp('2001:db8:1:2::1')).toBe(chaveIp('2001:db8:1:2::2'))
  })
})

describe('login do portal: rajada simultânea (FR1-01)', () => {
  /** n tentativas ao mesmo tempo; cada uma processada demora 15 ms. Devolve quantas PROCESSARAM e os motivos dos bloqueios. */
  async function rajada(armazem: ArmazemTentativas, n: number, ip: (i: number) => string | null, sucesso = false) {
    let processadas = 0
    const bloqueios: string[] = []
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      const r = await reservarLoginPortal(armazem, ip(i))
      if (!r.permitido) {
        bloqueios.push(r.motivo)
        return
      }
      processadas++
      await esperar(15)
      await r.concluir(sucesso)
    }))
    return { processadas, bloqueios }
  }

  it('varredura de CPFs: 300 tentativas simultâneas do MESMO IP processam só 10 (o limite de erros do IP)', async () => {
    const { armazem } = armazemEmMemoria({ latenciaMs: 5 })
    const { processadas, bloqueios } = await rajada(armazem, 300, () => '203.0.113.9')
    expect(processadas).toBe(REGRA_PORTAL_IP.maxErros)
    expect(bloqueios).toHaveLength(290)
  })

  it('uma rajada de um IP só NÃO derruba o portal para os outros (só consome 10 do teto global de 300)', async () => {
    const { armazem, linhas } = armazemEmMemoria({ latenciaMs: 5 })
    await rajada(armazem, 300, () => '203.0.113.9')
    expect(linhas.filter((l) => l.rota === 'cliente-login-global')).toHaveLength(10)
    expect((await tentarLogin(armazem, '198.51.100.20', true)).permitido).toBe(true) // outro cliente entra normalmente
  })

  it('teto global: 1000 tentativas simultâneas de 250 IPs processam só 300 (o teto), e um IP novo é recusado', async () => {
    const { armazem } = armazemEmMemoria({ latenciaMs: 2 })
    const { processadas, bloqueios } = await rajada(armazem, 1000, (i) => `10.${Math.floor((i % 250) / 100)}.${(i % 250) % 100}.1`)
    expect(processadas).toBe(REGRA_PORTAL_GLOBAL.maxErros)
    expect(bloqueios).toHaveLength(700)
    expect(await tentarLogin(armazem, '192.0.2.9', false)).toMatchObject({ permitido: false, motivo: 'erros' })
  })

  it('logins legítimos simultâneos: 10 por onda (em andamento vale como erro) e 30 por IP em 15 min; os 30 são confirmados', async () => {
    const { armazem, linhas } = armazemEmMemoria({ latenciaMs: 2 })
    const processadas: number[] = []
    for (let onda = 0; onda < 4; onda++) processadas.push((await rajada(armazem, 60, () => '203.0.113.77', true)).processadas)
    expect(processadas).toEqual([10, 10, 10, 0]) // a 4ª onda esbarra no total de 30
    expect(linhas.filter((l) => l.rota === 'cliente-login' && l.sucesso)).toHaveLength(REGRA_PORTAL_IP.maxTotal)
  })
})

// ---------------------------------------------------------------------------------------------- CPF

describe('CPF', () => {
  it('valida dígitos verificadores', () => {
    expect(cpfValido('52998224725')).toBe(true)
    expect(cpfValido('52998224726')).toBe(false)
    expect(cpfValido('11111111111')).toBe(false)
    expect(cpfValido('123')).toBe(false)
    expect(soDigitos(' 529.982.247-25 ')).toBe('52998224725')
    expect(soDigitos(42)).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------- localizar (DEP-01)

const cliente: ClientePortal = { id: CLIENTE, nome: 'Fulano', user_id: null }
const esqueleto = { data: null, error: { code: '0A000', message: 'nao_implementado' } }

function porta(rpc: () => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>, direto = async () => ({ data: [cliente], error: null }) as never) {
  const chamadas = { rpc: 0, direto: 0 }
  const p: PortaLocalizar = {
    rpc: async () => { chamadas.rpc++; return rpc() },
    direto: async () => { chamadas.direto++; return direto() },
  }
  return { p, chamadas }
}

describe('localizarClientePortal (funciona antes e depois da migration 15)', () => {
  it('banco novo: usa a RPC e não toca na tabela', async () => {
    const { p, chamadas } = porta(async () => ({ data: [cliente], error: null }))
    expect(await localizarClientePortal(p, '52998224725')).toEqual(cliente)
    expect(chamadas).toEqual({ rpc: 1, direto: 0 })
  })

  it('banco novo sem cliente: nulo, sem tentar a leitura direta', async () => {
    const { p, chamadas } = porta(async () => ({ data: [], error: null }))
    expect(await localizarClientePortal(p, '52998224725')).toBeNull()
    expect(chamadas.direto).toBe(0)
  })

  it('banco anterior à migration 15 (esqueleto 0A000): a leitura direta faz o mesmo', async () => {
    const { p, chamadas } = porta(async () => esqueleto)
    expect(await localizarClientePortal(p, '52998224725')).toEqual(cliente)
    expect(chamadas).toEqual({ rpc: 1, direto: 1 })
  })

  it('banco anterior sem cliente liberado: nulo', async () => {
    const { p } = porta(async () => esqueleto, async () => ({ data: [], error: null }))
    expect(await localizarClientePortal(p, '52998224725')).toBeNull()
  })

  it('outro erro da RPC ou da leitura direta: lança (não segue às cegas)', async () => {
    await expect(localizarClientePortal(porta(async () => ({ data: null, error: { code: '42501', message: 'negado' } })).p, '52998224725')).rejects.toThrow(/portal_localizar_cliente: 42501/)
    await expect(localizarClientePortal(porta(async () => esqueleto, async () => ({ data: null, error: { code: '42P01', message: 'x' } })).p, '52998224725')).rejects.toThrow(/leitura direta/)
  })

  it('resposta em formato inesperado: nulo', async () => {
    expect(await localizarClientePortal(porta(async () => ({ data: [{ nome: 'sem id' }], error: null })).p, '52998224725')).toBeNull()
    expect(await localizarClientePortal(porta(async () => ({ data: null, error: null })).p, '52998224725')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------- conta do Auth (WP7R1-02)

const AGORA = '2026-09-29T12:00:00.000Z'
const conta = (extra: Partial<ContaAuth> = {}): ContaAuth => ({
  id: 'conta-1', email: EMAIL, app_metadata: { provider: 'email', portal_cliente_id: CLIENTE },
  email_confirmed_at: AGORA, created_at: AGORA, ...extra,
})

describe('avaliarConta', () => {
  it('com o marcador do cliente e perfil de cliente: válida', () => {
    expect(avaliarConta(CLIENTE, conta(), 'cliente')).toBe('valida')
  })
  it('marcador de outro cliente: inválida', () => {
    expect(avaliarConta(CLIENTE, conta({ app_metadata: { portal_cliente_id: OUTRO } }), 'cliente')).toBe('invalida')
  })
  it('perfil que não é de cliente (ex.: promovida a admin): inválida', () => {
    expect(avaliarConta(CLIENTE, conta(), 'admin')).toBe('invalida')
    expect(avaliarConta(CLIENTE, conta(), 'parceiro')).toBe('invalida')
    expect(avaliarConta(CLIENTE, conta(), null)).toBe('invalida')
  })
  it('e-mail diferente do interno do cliente: inválida (não é a conta dele)', () => {
    expect(avaliarConta(CLIENTE, conta({ email: `cliente-${OUTRO}@portal.arkenincorporadora.com.br` }), 'cliente')).toBe('invalida')
    expect(avaliarConta(CLIENTE, conta({ email: 'admin@arken.com' }), 'cliente')).toBe('invalida')
  })
  it('conta nula: inválida', () => {
    expect(avaliarConta(CLIENTE, null, 'cliente')).toBe('invalida')
  })
  it('legada (sem marcador): só se nasceu confirmada, como o createUser da versão antiga', () => {
    expect(avaliarConta(CLIENTE, conta({ app_metadata: { provider: 'email' } }), 'cliente')).toBe('legada')
  })
  it('signUp público confirmado depois (pelo próprio login por CPF): inválida', () => {
    const semMarcador = { app_metadata: { provider: 'email' } }
    expect(avaliarConta(CLIENTE, conta({ ...semMarcador, created_at: '2026-09-20T10:00:00Z', email_confirmed_at: '2026-09-29T12:00:00Z' }), 'cliente')).toBe('invalida')
    expect(avaliarConta(CLIENTE, conta({ ...semMarcador, email_confirmed_at: null }), 'cliente')).toBe('invalida')
    expect(avaliarConta(CLIENTE, conta({ ...semMarcador, created_at: null }), 'cliente')).toBe('invalida')
  })
})

/** Auth e banco em memória, com a semântica de e-mail único do GoTrue. */
function mundo(inicial: { contas?: (ContaAuth & { papel: string })[]; userIdDoCliente?: string | null } = {}) {
  const contas = new Map<string, ContaAuth & { papel: string }>((inicial.contas ?? []).map((c) => [c.id, { ...c }]))
  let vinculo: string | null = inicial.userIdDoCliente ?? null
  const eventos: string[] = []
  let seq = 0
  const gw: GatewayPortal = {
    async contaPorId(id) { const c = contas.get(id); return c ? { ...c } : null },
    async contasPorEmail(email) { return [...contas.values()].filter((c) => c.email === email).map((c) => ({ ...c })) },
    async criarConta(clienteId, nome) {
      const email = emailDoPortal(clienteId)
      if ([...contas.values()].some((c) => c.email === email)) return { conta: null }
      const nova = { id: `nova-${++seq}`, email, app_metadata: { provider: 'email', portal_cliente_id: clienteId },
                     email_confirmed_at: AGORA, created_at: AGORA, papel: 'parceiro', nome }
      contas.set(nova.id, nova)
      eventos.push('criou')
      return { conta: { ...nova } }
    },
    async papelDoPerfil(id) { return contas.get(id)?.papel ?? null },
    async promoverPerfil(id) { const c = contas.get(id); if (c) c.papel = 'cliente'; eventos.push('promoveu') },
    async ligarAoCliente(_c, userId) { if (vinculo) return false; vinculo = userId; eventos.push('ligou'); return true },
    async userIdDoCliente() { return vinculo },
    async estamparMarcador(id, clienteId) {
      const c = contas.get(id)
      if (c) c.app_metadata = { ...(c.app_metadata ?? {}), portal_cliente_id: clienteId }
      eventos.push('estampou')
    },
  }
  return { gw, contas, eventos, vinculo: () => vinculo }
}

describe('resolverContaDoPortal', () => {
  it('primeiro login: cria a conta com o marcador, promove o perfil e liga ao cliente', async () => {
    const m = mundo()
    const r = await resolverContaDoPortal(m.gw, cliente)
    expect(r).toEqual({ ok: true, userId: 'nova-1', email: EMAIL })
    expect(m.eventos).toEqual(['criou', 'promoveu', 'ligou'])
    expect(m.contas.get('nova-1')?.app_metadata).toMatchObject({ portal_cliente_id: CLIENTE })
    expect(m.vinculo()).toBe('nova-1')
  })

  it('WP7R1-02: conta com o e-mail interno criada por signUp público (sem marcador) NÃO é adotada', async () => {
    const hostil = { id: 'hostil', email: EMAIL, app_metadata: { provider: 'email' }, email_confirmed_at: null, created_at: '2026-09-20T10:00:00Z', papel: 'parceiro' }
    const m = mundo({ contas: [hostil] })
    const r = await resolverContaDoPortal(m.gw, cliente)
    expect(r).toEqual({ ok: false, motivo: 'email_ocupado' })
    expect(m.eventos).toEqual([])                        // nada promovido, nada ligado
    expect(m.contas.get('hostil')?.papel).toBe('parceiro')
    expect(m.vinculo()).toBeNull()
  })

  it('WP7R1-02: conta hostil com marcador de OUTRO cliente também não é adotada', async () => {
    const m = mundo({ contas: [{ id: 'x', email: EMAIL, app_metadata: { portal_cliente_id: OUTRO }, email_confirmed_at: AGORA, created_at: AGORA, papel: 'cliente' }] })
    expect(await resolverContaDoPortal(m.gw, cliente)).toEqual({ ok: false, motivo: 'email_ocupado' })
  })

  it('corrida entre dois primeiros logins legítimos: o segundo acha a conta marcada do próprio cliente', async () => {
    const m = mundo({ contas: [{ id: 'primeira', email: EMAIL, app_metadata: { portal_cliente_id: CLIENTE }, email_confirmed_at: AGORA, created_at: AGORA, papel: 'parceiro' }] })
    const r = await resolverContaDoPortal(m.gw, cliente)
    expect(r).toEqual({ ok: true, userId: 'primeira', email: EMAIL })
    expect(m.vinculo()).toBe('primeira')
  })

  it('a ligação já feita por outro login à mesma conta é aceita; a outra conta, não', async () => {
    const primeira = { id: 'primeira', email: EMAIL, app_metadata: { portal_cliente_id: CLIENTE }, email_confirmed_at: AGORA, created_at: AGORA, papel: 'cliente' }
    const igual = mundo({ contas: [primeira], userIdDoCliente: 'primeira' })
    // cliente lido antes da ligação (user_id nulo), mas o vínculo já existe para a mesma conta
    expect(await resolverContaDoPortal(igual.gw, cliente)).toMatchObject({ ok: true, userId: 'primeira' })
    const outra = mundo({ contas: [primeira], userIdDoCliente: 'outra-conta' })
    expect(await resolverContaDoPortal(outra.gw, cliente)).toEqual({ ok: false, motivo: 'ligacao_concorrente' })
  })

  it('cliente já ligado a conta válida: reaproveita, sem criar nada', async () => {
    const m = mundo({ contas: [{ ...conta({ id: 'ligada' }), papel: 'cliente' }] })
    const r = await resolverContaDoPortal(m.gw, { ...cliente, user_id: 'ligada' })
    expect(r).toEqual({ ok: true, userId: 'ligada', email: EMAIL })
    expect(m.eventos).toEqual([])
  })

  it('cliente ligado a conta legada (versão antiga): aceita e estampa o marcador', async () => {
    const legada = { id: 'legada', email: EMAIL, app_metadata: { provider: 'email' }, email_confirmed_at: AGORA, created_at: AGORA, papel: 'cliente' }
    const m = mundo({ contas: [legada] })
    expect(await resolverContaDoPortal(m.gw, { ...cliente, user_id: 'legada' })).toMatchObject({ ok: true })
    expect(m.eventos).toEqual(['estampou'])
    expect(marcador(m.contas.get('legada'))).toBe(CLIENTE)
  })

  it('WP7R1-02: cliente ligado (por adoção antiga) a conta de signUp confirmada depois: recusa', async () => {
    const adotada = { id: 'adotada', email: EMAIL, app_metadata: { provider: 'email' }, email_confirmed_at: '2026-09-29T12:00:00Z', created_at: '2026-09-20T10:00:00Z', papel: 'cliente' }
    const m = mundo({ contas: [adotada] })
    expect(await resolverContaDoPortal(m.gw, { ...cliente, user_id: 'adotada' })).toEqual({ ok: false, motivo: 'conta_ligada_invalida' })
    expect(m.eventos).toEqual([])
  })

  it('cliente ligado a perfil que virou admin ou parceiro: recusa (nunca sessão interna a partir de CPF)', async () => {
    for (const papel of ['admin', 'super', 'corretor', 'parceiro']) {
      const m = mundo({ contas: [{ ...conta({ id: 'p' }), papel }] })
      expect(await resolverContaDoPortal(m.gw, { ...cliente, user_id: 'p' })).toEqual({ ok: false, motivo: 'conta_ligada_invalida' })
    }
  })

  it('cliente ligado a conta que não existe mais: recusa', async () => {
    const m = mundo()
    expect(await resolverContaDoPortal(m.gw, { ...cliente, user_id: 'sumiu' })).toEqual({ ok: false, motivo: 'conta_ligada_invalida' })
  })
})

function marcador(c: ContaAuth | undefined) {
  return c?.app_metadata?.portal_cliente_id
}

describe('mensagem quando o CPF não entra', () => {
  it('suspenso e inativo têm mensagem própria (403); o resto é "não encontrado" (404)', () => {
    expect(respostaSemAcesso('bloqueado')).toEqual({ status: 403, mensagem: ACESSO_SUSPENSO, codigo: 'acesso_bloqueado' })
    expect(respostaSemAcesso('inativo')).toEqual({ status: 403, mensagem: CADASTRO_INATIVO, codigo: 'cadastro_suspenso' })
    expect(respostaSemAcesso('nao_encontrado')).toEqual({ status: 404, mensagem: NAO_ENCONTRADO, codigo: 'nao_encontrado' })
  })
  it('situação vinda do banco; erro, exceção ou valor estranho viram "não encontrado"', async () => {
    expect(await situacaoDoCpf(async () => ({ data: 'bloqueado', error: null }), '1')).toBe('bloqueado')
    expect(await situacaoDoCpf(async () => ({ data: 'inativo', error: null }), '1')).toBe('inativo')
    expect(await situacaoDoCpf(async () => ({ data: 'liberado', error: null }), '1')).toBe('nao_encontrado')
    expect(await situacaoDoCpf(async () => ({ data: null, error: { code: '42883', message: 'não existe' } }), '1')).toBe('nao_encontrado')
    expect(await situacaoDoCpf(async () => { throw new Error('rede') }, '1')).toBe('nao_encontrado')
  })
})
