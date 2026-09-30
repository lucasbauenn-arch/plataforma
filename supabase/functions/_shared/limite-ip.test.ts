import { describe, expect, it, vi } from 'vitest'
import {
  MAX_BALDES,
  REGRA_ENVIAR_LEAD,
  REGRA_PRE_CADASTRO,
  chaveIp,
  decidirLimite,
  inicioDaJanela,
  lerRespostaReserva,
  mensagemLimite,
  reservarTentativa,
  respostaDoBloqueio,
  validarRegra,
  type ArmazemTentativas,
  type PedidoBalde,
  type RegraLimite,
} from './limite-ip.ts'
import { armazemEmMemoria, armazemQuebrado } from './limite-ip.memoria.ts'

const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

describe('regra do pré-cadastro (§6.1)', () => {
  it('10 erros ou 20 tentativas em 15 min', () => {
    expect(REGRA_PRE_CADASTRO).toEqual({ rota: 'pre-cadastro', janelaMs: 900_000, maxErros: 10, maxTotal: 20 })
    expect(() => validarRegra(REGRA_PRE_CADASTRO)).not.toThrow()
    expect(Object.isFrozen(REGRA_PRE_CADASTRO)).toBe(true)
  })
})

describe('regra do formulário de contato (WP7R1-05)', () => {
  it('10 erros ou 20 envios em 15 min, rota própria e congelada', () => {
    expect(REGRA_ENVIAR_LEAD).toEqual({ rota: 'enviar-lead', janelaMs: 900_000, maxErros: 10, maxTotal: 20 })
    expect(() => validarRegra(REGRA_ENVIAR_LEAD)).not.toThrow()
    expect(Object.isFrozen(REGRA_ENVIAR_LEAD)).toBe(true)
    expect(REGRA_ENVIAR_LEAD.rota).not.toBe(REGRA_PRE_CADASTRO.rota)
  })
})

describe('decidirLimite', () => {
  const regra = REGRA_PRE_CADASTRO
  it('bloqueia ao chegar no máximo de erros', () => {
    expect(decidirLimite({ total: 9, erros: 9 }, regra)).toEqual({ permitido: true })
    expect(decidirLimite({ total: 10, erros: 10 }, regra)).toEqual({ permitido: false, motivo: 'erros', tenteEmSegundos: 900 })
  })
  it('bloqueia ao chegar no máximo total, mesmo sem erro', () => {
    expect(decidirLimite({ total: 19, erros: 0 }, regra)).toEqual({ permitido: true })
    expect(decidirLimite({ total: 20, erros: 0 }, regra)).toMatchObject({ permitido: false, motivo: 'total' })
  })
})

describe('validarRegra', () => {
  const ok: RegraLimite = { rota: 'x', janelaMs: 60_000, maxErros: 1, maxTotal: 1 }
  it('recusa configuração absurda', () => {
    expect(() => validarRegra(ok)).not.toThrow()
    for (const ruim of [
      { ...ok, rota: '' },
      { ...ok, rota: 'Pré Cadastro' },
      { ...ok, rota: "x'; drop table" },
      { ...ok, janelaMs: 0 },
      { ...ok, janelaMs: 1.5 },
      { ...ok, maxTotal: 0 },
      { ...ok, maxErros: 0 },
      { ...ok, maxErros: 2, maxTotal: 1 },
    ]) {
      expect(() => validarRegra(ruim)).toThrow()
    }
  })
})

describe('chaveIp', () => {
  it('IPv4 como veio; IPv6 pela rede /64; inválido → nulo', () => {
    expect(chaveIp('203.0.113.9')).toBe('203.0.113.9')
    expect(chaveIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::')
    expect(chaveIp('2001:db8:1:2::1')).toBe(chaveIp('2001:db8:1:2:ffff::9'))
    expect(chaveIp('2001:db8:1:3::1')).not.toBe(chaveIp('2001:db8:1:2::1'))
    expect(chaveIp('::ffff:198.51.100.7')).toBe('198.51.100.7')
    expect(chaveIp('::1')).toBe('::')
    expect(chaveIp('lixo')).toBeNull()
    expect(chaveIp(null)).toBeNull()
  })
})

describe('reservarTentativa (reserva atômica, FR1-01)', () => {
  const regra = REGRA_PRE_CADASTRO

  /** uma requisição inteira: reserva, "processa" (falha ou sucesso) e fecha a reserva */
  async function tentar(armazem: ArmazemTentativas, ip: string | null, sucesso: boolean, r: RegraLimite = regra) {
    const reserva = await reservarTentativa(armazem, [{ regra: r, ip }])
    if (reserva.permitido) await reserva.concluir(sucesso)
    return reserva
  }

  it('manda ao banco a regra, a janela em segundos e a chave do IP; a tentativa entra como falha', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    const reservar = vi.spyOn(armazem, 'reservar')
    const r = await reservarTentativa(armazem, [{ regra, ip: '203.0.113.9' }])
    expect(r.permitido).toBe(true)
    expect(reservar).toHaveBeenCalledTimes(1)
    expect(reservar.mock.calls[0][0]).toEqual<PedidoBalde[]>([
      { rota: 'pre-cadastro', ip: '203.0.113.9', janela_segundos: 900, max_erros: 10, max_total: 20 },
    ])
    expect(linhas).toMatchObject([{ rota: 'pre-cadastro', ip: '203.0.113.9', sucesso: false }])
  })

  it('10 erros bloqueiam a 11ª tentativa; outro IP e outra rota não são afetados', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    for (let i = 0; i < 10; i++) expect((await tentar(armazem, '203.0.113.9', false)).permitido).toBe(true)
    expect(await tentar(armazem, '203.0.113.9', false)).toEqual({ permitido: false, motivo: 'erros', tenteEmSegundos: 900 })
    expect((await tentar(armazem, '203.0.113.10', false)).permitido).toBe(true)
    expect((await tentar(armazem, '203.0.113.9', false, { ...regra, rota: 'outra' })).permitido).toBe(true)
    // a tentativa bloqueada não grava linha: a janela não se estende sozinha
    expect(linhas.filter((l) => l.rota === 'pre-cadastro' && l.ip === '203.0.113.9')).toHaveLength(10)
  })

  it('janela: 15 min e 1 ms depois, as tentativas saíram da contagem', async () => {
    let agora = new Date('2026-09-28T12:00:00Z')
    const { armazem } = armazemEmMemoria({ relogio: () => agora })
    for (let i = 0; i < 10; i++) await tentar(armazem, '203.0.113.9', false)
    expect((await tentar(armazem, '203.0.113.9', false)).permitido).toBe(false)
    agora = new Date(agora.getTime() + regra.janelaMs + 1)
    expect((await tentar(armazem, '203.0.113.9', false)).permitido).toBe(true)
    expect(inicioDaJanela(agora, regra).getTime()).toBe(agora.getTime() - 900_000)
  })

  it('20 tentativas COM sucesso também bloqueiam (total); o sucesso confirmado não conta como erro', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    for (let i = 0; i < 19; i++) expect((await tentar(armazem, '198.51.100.1', true)).permitido).toBe(true)
    expect(linhas.every((l) => l.sucesso)).toBe(true) // concluir(true) trocou a falha da reserva por sucesso
    expect((await tentar(armazem, '198.51.100.1', true)).permitido).toBe(true)
    expect(await tentar(armazem, '198.51.100.1', true)).toMatchObject({ permitido: false, motivo: 'total' })
  })

  it('IPv6 que troca de endereço dentro da mesma /64 continua no mesmo balde', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    for (let i = 1; i <= 10; i++) await tentar(armazem, `2001:db8:1:2::${i.toString(16)}`, false)
    expect(new Set(linhas.map((l) => l.ip))).toEqual(new Set(['2001:db8:1:2::']))
    expect(await tentar(armazem, '2001:db8:1:2:dead:beef::1', false)).toMatchObject({ permitido: false })
    expect((await tentar(armazem, '2001:db8:1:3::1', false)).permitido).toBe(true)
  })

  it('sem IP identificável: todos dividem um balde (ip nulo), não ficam sem limite', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    for (let i = 0; i < 10; i++) await tentar(armazem, i % 2 ? null : 'unknown', false)
    expect(linhas.every((l) => l.ip === null)).toBe(true)
    expect(await tentar(armazem, undefined as unknown as null, false)).toMatchObject({ permitido: false, motivo: 'erros' })
  })

  it('concluir: falha não vai ao banco; sucesso confirma uma vez, com os ids; só o primeiro fechamento vale', async () => {
    const { armazem, linhas, chamadas } = armazemEmMemoria()
    const confirmar = vi.spyOn(armazem, 'confirmar')
    const falha = await reservarTentativa(armazem, [{ regra, ip: '203.0.113.1' }])
    if (!falha.permitido) throw new Error('inesperado')
    expect(await falha.concluir(false)).toBe(true)
    expect(confirmar).not.toHaveBeenCalled()
    expect(linhas[0].sucesso).toBe(false)

    const ok = await reservarTentativa(armazem, [{ regra, ip: '203.0.113.2' }])
    if (!ok.permitido) throw new Error('inesperado')
    const [x, y, z] = await Promise.all([ok.concluir(true), ok.concluir(true), ok.concluir(false)]) // chamadas seguidas
    expect([x, y, z]).toEqual([true, true, true])
    expect(await ok.concluir(false)).toBe(true) // depois de fechada, continua valendo o primeiro fechamento
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(confirmar.mock.calls[0][0]).toEqual([linhas[1].id])
    expect(linhas[1].sucesso).toBe(true)
    expect(chamadas.reservar).toBe(2)
  })

  it('confirmar falhou: concluir devolve false sem lançar e a tentativa segue contada como falha', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    armazem.confirmar = () => Promise.reject(new Error('banco caiu no meio'))
    const r = await reservarTentativa(armazem, [{ regra, ip: '203.0.113.3' }])
    if (!r.permitido) throw new Error('inesperado')
    await expect(r.concluir(true)).resolves.toBe(false)
    expect(linhas[0].sucesso).toBe(false)
  })

  it('banco fora do ar: recusa (503), nunca libera', async () => {
    const d = await reservarTentativa(armazemQuebrado, [{ regra, ip: '203.0.113.9' }])
    expect(d).toEqual({ permitido: false, motivo: 'indisponivel', tenteEmSegundos: 60 })
    if (d.permitido) throw new Error('inesperado')
    expect(respostaDoBloqueio(d, regra)).toMatchObject({ status: 503, codigo: 'indisponivel', cabecalhos: { 'Retry-After': '60' } })
  })

  it('regra inválida ou número de baldes fora de 1..4 é erro de programação (não vira "liberado")', async () => {
    const { armazem } = armazemEmMemoria()
    await expect(reservarTentativa(armazem, [{ regra: { ...regra, maxTotal: 0 }, ip: '1.1.1.1' }])).rejects.toThrow()
    await expect(reservarTentativa(armazem, [])).rejects.toThrow()
    const demais = Array.from({ length: MAX_BALDES + 1 }, (_, i) => ({ regra: { ...regra, rota: `r${i}` }, ip: null }))
    await expect(reservarTentativa(armazem, demais)).rejects.toThrow()
  })

  it('vários baldes: todos ou nenhum; o bloqueio diz a espera do balde que bloqueou', async () => {
    const { armazem, linhas } = armazemEmMemoria()
    const curta: RegraLimite = { rota: 'balde-curto', janelaMs: 60_000, maxErros: 2, maxTotal: 4 }
    const longa: RegraLimite = { rota: 'balde-longo', janelaMs: 900_000, maxErros: 5, maxTotal: 9 }
    const dois = [{ regra: longa, ip: '203.0.113.9' }, { regra: curta, ip: null }]
    for (let i = 0; i < 2; i++) expect((await reservarTentativa(armazem, dois)).permitido).toBe(true)
    expect(linhas).toHaveLength(4) // duas reservas por chamada
    // o balde curto está cheio: a chamada é bloqueada por ele (60 s) e o balde longo não recebe reserva
    expect(await reservarTentativa(armazem, dois)).toEqual({ permitido: false, motivo: 'erros', tenteEmSegundos: 60 })
    expect(linhas).toHaveLength(4)
    expect(linhas.filter((l) => l.rota === 'balde-longo')).toHaveLength(2)
    // e o balde do IP cheio (o longo) bloqueia sem tocar no curto
    const { armazem: outro, linhas: outras } = armazemEmMemoria()
    for (let i = 0; i < 5; i++) await reservarTentativa(outro, [{ regra: longa, ip: '203.0.113.9' }])
    expect(await reservarTentativa(outro, dois)).toEqual({ permitido: false, motivo: 'erros', tenteEmSegundos: 900 })
    expect(outras.filter((l) => l.rota === 'balde-curto')).toHaveLength(0)
  })

  it('a reserva acontece ANTES do processamento: uma requisição em andamento já conta', async () => {
    const { armazem } = armazemEmMemoria()
    for (let i = 0; i < 10; i++) {
      expect((await reservarTentativa(armazem, [{ regra, ip: '203.0.113.9' }])).permitido).toBe(true) // ninguém concluiu
    }
    expect(await reservarTentativa(armazem, [{ regra, ip: '203.0.113.9' }])).toMatchObject({ permitido: false, motivo: 'erros' })
  })
})

describe('reservarTentativa: rajada simultânea (o achado FR1-01)', () => {
  /** o que a Edge Function faz: reserva, trabalha (com espera), fecha. Devolve quantas foram PROCESSADAS. */
  async function rajada(
    armazem: ArmazemTentativas, n: number, regra: RegraLimite, ip: (i: number) => string | null, sucesso: boolean,
  ) {
    let processadas = 0
    const bloqueios: string[] = []
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      const reserva = await reservarTentativa(armazem, [{ regra, ip: ip(i) }])
      if (!reserva.permitido) {
        bloqueios.push(reserva.motivo)
        return
      }
      processadas++
      await esperar(15) // o trabalho da requisição (banco, Auth, e-mail)
      await reserva.concluir(sucesso)
    }))
    return { processadas, bloqueios }
  }

  it('300 falhas simultâneas do MESMO IP: só maxErros (10) são processadas, o resto leva 429', async () => {
    const { armazem, linhas } = armazemEmMemoria({ latenciaMs: 5 })
    const { processadas, bloqueios } = await rajada(armazem, 300, REGRA_PRE_CADASTRO, () => '203.0.113.9', false)
    expect(processadas).toBe(10)
    expect(bloqueios).toHaveLength(290)
    expect(new Set(bloqueios)).toEqual(new Set(['erros']))
    expect(linhas).toHaveLength(10)
  })

  it('em andamento a reserva conta como falha: 50 envios simultâneos que dariam certo processam só 10 por onda', async () => {
    const { armazem, linhas } = armazemEmMemoria({ latenciaMs: 3 })
    const onda1 = await rajada(armazem, 50, REGRA_ENVIAR_LEAD, () => '198.51.100.7', true)
    expect(onda1.processadas).toBe(REGRA_ENVIAR_LEAD.maxErros) // conservador: quem ainda não concluiu vale como erro
    expect(onda1.bloqueios).toHaveLength(40)
    expect(linhas.filter((l) => l.sucesso)).toHaveLength(10) // as aceitas foram confirmadas
    // concluídas com sucesso, as vagas de erro voltam; o TOTAL (20) segue valendo
    const onda2 = await rajada(armazem, 50, REGRA_ENVIAR_LEAD, () => '198.51.100.7', true)
    expect(onda2.processadas).toBe(10)
    const onda3 = await rajada(armazem, 50, REGRA_ENVIAR_LEAD, () => '198.51.100.7', true)
    expect(onda3.processadas).toBe(0)
    expect(new Set(onda3.bloqueios)).toEqual(new Set(['total']))
    expect(linhas.filter((l) => l.sucesso)).toHaveLength(REGRA_ENVIAR_LEAD.maxTotal)
  })

  it('50 chamadas de 50 IPs diferentes não se atrapalham (cada IP tem o seu balde)', async () => {
    const { armazem } = armazemEmMemoria({ latenciaMs: 3 })
    const { processadas, bloqueios } = await rajada(armazem, 50, REGRA_PRE_CADASTRO, (i) => `203.0.113.${i + 1}`, false)
    expect(processadas).toBe(50)
    expect(bloqueios).toHaveLength(0)
  })

  it('contra-prova: com conferir e gravar em passos separados (o defeito antigo), a mesma rajada passa inteira', async () => {
    const { armazem } = armazemEmMemoria({ latenciaMs: 5, atomico: false })
    const { processadas } = await rajada(armazem, 300, REGRA_PRE_CADASTRO, () => '203.0.113.9', false)
    expect(processadas).toBeGreaterThan(REGRA_PRE_CADASTRO.maxErros) // o teste enxerga a corrida
  })
})

describe('lerRespostaReserva', () => {
  it('aceita a resposta permitida (ids inteiros positivos, um por balde) e a bloqueada', () => {
    expect(lerRespostaReserva({ permitido: true, ids: [7, 8] }, 2)).toEqual({ permitido: true, ids: [7, 8] })
    expect(lerRespostaReserva({ permitido: false, motivo: 'total', rota: 'pre-cadastro' }, 1))
      .toEqual({ permitido: false, motivo: 'total', rota: 'pre-cadastro' })
    expect(lerRespostaReserva({ permitido: false, motivo: 'erros' }, 1)).toEqual({ permitido: false, motivo: 'erros', rota: '' })
  })

  it('qualquer outra forma vira erro (nunca "liberado")', () => {
    for (const ruim of [
      null, undefined, 'permitido', 42, [], {},
      { permitido: 'true', ids: [1] },
      { permitido: true },
      { permitido: true, ids: [] },
      { permitido: true, ids: [1, 2] }, // esperados: 1
      { permitido: true, ids: ['1'] },
      { permitido: true, ids: [0] },
      { permitido: true, ids: [-3] },
      { permitido: true, ids: [1.5] },
      { permitido: true, ids: [Number.MAX_SAFE_INTEGER + 1] },
      { permitido: false },
      { permitido: false, motivo: 'indisponivel' },
      { permitido: false, motivo: 'outro' },
    ]) {
      expect(() => lerRespostaReserva(ruim, 1), JSON.stringify(ruim)).toThrow()
    }
  })
})

describe('mensagens', () => {
  it('429 com os minutos da janela e Retry-After', () => {
    expect(mensagemLimite(REGRA_PRE_CADASTRO)).toBe('Muitas tentativas. Aguarde 15 minutos e tente de novo.')
    expect(mensagemLimite({ ...REGRA_PRE_CADASTRO, janelaMs: 60_000 })).toBe('Muitas tentativas. Aguarde 1 minuto e tente de novo.')
    const d = decidirLimite({ total: 20, erros: 0 }, REGRA_PRE_CADASTRO)
    if (d.permitido) throw new Error('inesperado')
    expect(respostaDoBloqueio(d, REGRA_PRE_CADASTRO)).toEqual({
      status: 429,
      mensagem: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.',
      codigo: 'muitas_tentativas',
      cabecalhos: { 'Retry-After': '900' },
    })
  })
})
