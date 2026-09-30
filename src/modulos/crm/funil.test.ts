import { describe, expect, it } from 'vitest'
import type { EtapaFunil, Papel } from '@/lib/types'
import {
  DICAS_ETAPA, acceptDosFormatos, agruparPorMes, caminhoDoArquivo, conferirArquivo, dataSemFuso, destinoPara, destinosDoCartao, destinosPermitidos, hojeSaoPaulo,
  formatoDoArquivo, moverCartao, tamanhoLegivel, textoDiasNaEtapa, type TransicaoFunil,
} from './funil'
import type { KanbanCartao, KanbanResultado, TimelineEvento } from './tipos'

// Semente de status_transicoes da migration 20260929000008 (entidade cliente_etapa), igual ao banco.
const P: Papel[] = ['corretor', 'gerente', 'imobiliaria', 'parceiro', 'admin', 'super']
const t = (de: EtapaFunil, para: EtapaFunil, o: Partial<TransicaoFunil> = {}): TransicaoFunil =>
  ({ de, para, papeis: P, sistema: false, exige_motivo: false, efeitos: [], ativa: true, ...o })
const SEMENTE: TransicaoFunil[] = [
  t('novo_contato', 'contato_iniciado'),
  t('contato_iniciado', 'documentacao', { efeitos: ['solicitar_documentos_basicos'] }),
  t('novo_contato', 'perdido', { exige_motivo: true }),
  t('contato_iniciado', 'perdido', { exige_motivo: true }),
  t('documentacao', 'perdido', { exige_motivo: true }),
  t('perdido', 'novo_contato', { efeitos: ['limpar_motivo_perda'] }),
  t('novo_contato', 'finalizado', { papeis: [], sistema: true }),
  t('contato_iniciado', 'finalizado', { papeis: [], sistema: true }),
  t('documentacao', 'finalizado', { papeis: [], sistema: true }),
  t('perdido', 'finalizado', { papeis: [], sistema: true }),
  t('contato_iniciado', 'novo_contato', { ativa: false }),
  t('documentacao', 'contato_iniciado', { ativa: false }),
  t('documentacao', 'novo_contato', { ativa: false }),
]
const ETAPAS: EtapaFunil[] = ['novo_contato', 'contato_iniciado', 'documentacao', 'finalizado', 'perdido']

/** Pares permitidos para um papel, como "de>para". */
const permitidos = (papel: Papel | null, trans = SEMENTE) =>
  ETAPAS.flatMap((de) => destinosPermitidos(trans, papel, de).map((d) => `${de}>${d.para}`)).sort()

describe('destinos de arraste a partir de status_transicoes', () => {
  const ESPERADO = [
    'contato_iniciado>documentacao', 'contato_iniciado>perdido', 'documentacao>perdido', 'novo_contato>contato_iniciado',
    'novo_contato>perdido', 'perdido>novo_contato',
  ]

  it('corretor, gerente, imobiliária, parceiro legado e internos: os mesmos 6 pares da semente', () => {
    for (const papel of P) expect(permitidos(papel)).toEqual(ESPERADO)
  })

  it('cliente, colaborador e sem escopo: nenhum destino', () => {
    expect(permitidos('cliente')).toEqual([])
    expect(permitidos('colaborador')).toEqual([])
    expect(permitidos(null)).toEqual([])
  })

  it('Finalizado nunca é destino manual (N13) e explica o porquê', () => {
    for (const de of ETAPAS.filter((e) => e !== 'finalizado')) {
      const d = destinoPara(SEMENTE, 'admin', de, 'finalizado')
      expect(d).toMatchObject({ permitido: false, acao: null, dica: DICAS_ETAPA.finalizaSozinho })
    }
  })

  it('Perdidos pede motivo; Documentação pede confirmação dos documentos; o resto move direto', () => {
    expect(destinoPara(SEMENTE, 'corretor', 'contato_iniciado', 'perdido')).toMatchObject({ permitido: true, acao: 'pedir_motivo', exigeMotivo: true })
    expect(destinoPara(SEMENTE, 'corretor', 'contato_iniciado', 'documentacao')).toMatchObject({ permitido: true, acao: 'confirmar_documentos', exigeMotivo: false })
    expect(destinoPara(SEMENTE, 'corretor', 'novo_contato', 'contato_iniciado')).toMatchObject({ permitido: true, acao: 'mover' })
    expect(destinoPara(SEMENTE, 'corretor', 'perdido', 'novo_contato')).toMatchObject({ permitido: true, acao: 'mover' })
  })

  it('Perdido sempre exige motivo, mesmo com a linha sem exige_motivo', () => {
    const trans = SEMENTE.map((x) => (x.para === 'perdido' ? { ...x, exige_motivo: false } : x))
    expect(destinoPara(trans, 'gerente', 'novo_contato', 'perdido')).toMatchObject({ acao: 'pedir_motivo', exigeMotivo: true })
  })

  it('dicas das colunas esmaecidas', () => {
    expect(destinoPara(SEMENTE, 'corretor', 'contato_iniciado', 'novo_contato').dica).toBe(DICAS_ETAPA.voltar)
    expect(destinoPara(SEMENTE, 'corretor', 'documentacao', 'contato_iniciado').dica).toBe(DICAS_ETAPA.voltar)
    expect(destinoPara(SEMENTE, 'corretor', 'novo_contato', 'documentacao').dica).toBe(DICAS_ETAPA.pular)
    expect(destinoPara(SEMENTE, 'corretor', 'perdido', 'contato_iniciado').dica).toBe(DICAS_ETAPA.reativar)
    expect(destinoPara(SEMENTE, 'corretor', 'finalizado', 'perdido').dica).toBe(DICAS_ETAPA.finalizado)
    expect(destinoPara(SEMENTE, 'cliente', 'novo_contato', 'contato_iniciado').dica).toBe(DICAS_ETAPA.papel)
  })

  it('o Super liga uma volta de etapa (F2): passa a ser destino', () => {
    const trans = SEMENTE.map((x) => (x.de === 'contato_iniciado' && x.para === 'novo_contato' ? { ...x, ativa: true } : x))
    expect(permitidos('corretor', trans)).toContain('contato_iniciado>novo_contato')
  })

  it('o Super desliga uma transição ou tira um papel: deixa de ser destino', () => {
    const semCi = SEMENTE.map((x) => (x.de === 'novo_contato' && x.para === 'contato_iniciado' ? { ...x, ativa: false } : x))
    expect(destinoPara(semCi, 'corretor', 'novo_contato', 'contato_iniciado')).toMatchObject({ permitido: false, dica: DICAS_ETAPA.desligada })
    const soInternos = SEMENTE.map((x) => (x.para === 'perdido' ? { ...x, papeis: ['admin', 'super'] as Papel[] } : x))
    expect(destinoPara(soInternos, 'corretor', 'novo_contato', 'perdido')).toMatchObject({ permitido: false, dica: DICAS_ETAPA.papel })
    expect(destinoPara(soInternos, 'admin', 'novo_contato', 'perdido').permitido).toBe(true)
  })

  it('destinosDoCartao lista as outras 4 colunas na ordem do funil', () => {
    expect(destinosDoCartao(SEMENTE, 'corretor', 'contato_iniciado').map((d) => d.para))
      .toEqual(['novo_contato', 'documentacao', 'finalizado', 'perdido'])
  })

  it('sem linhas carregadas, nada é permitido', () => {
    expect(permitidos('admin', [])).toEqual([])
  })
})

describe('movimento otimista', () => {
  const cartao = (id: string, etapa: EtapaFunil): KanbanCartao => ({
    id, nome: `Cliente ${id}`, telefone: null, corretor: null, etapa, etapa_desde: '2026-09-01T12:00:00Z', dias_na_etapa: 5,
    documentos_pendentes: 0, tarefa_atrasada: false, motivo_perda: null,
  })
  const k: KanbanResultado = {
    colunas: [
      { etapa: 'novo_contato', total: 3, itens: [cartao('a', 'novo_contato'), cartao('b', 'novo_contato')] },
      { etapa: 'contato_iniciado', total: 1, itens: [cartao('c', 'contato_iniciado')] },
      { etapa: 'documentacao', total: 0, itens: [] },
      { etapa: 'finalizado', total: 0, itens: [] },
      { etapa: 'perdido', total: 0, itens: [] },
    ],
    contadores: { total: 4, finalizados: 0, perdidos: 0 },
  }

  it('tira da coluna de origem e põe no topo do destino, ajustando os totais', () => {
    const m = moverCartao(k, 'b', 'contato_iniciado', '2026-09-28T15:00:00Z')
    expect(m.colunas[0]).toMatchObject({ total: 2, itens: [{ id: 'a' }] })
    expect(m.colunas[1].total).toBe(2)
    expect(m.colunas[1].itens.map((i) => i.id)).toEqual(['b', 'c'])
    expect(m.colunas[1].itens[0]).toMatchObject({ etapa: 'contato_iniciado', etapa_desde: '2026-09-28T15:00:00Z', dias_na_etapa: 0 })
    expect(k.colunas[0].itens).toHaveLength(2) // não altera o original
  })

  it('em Perdidos guarda o motivo; fora dele, limpa', () => {
    const m = moverCartao(k, 'a', 'perdido', '2026-09-28T15:00:00Z', 'Desistiu')
    expect(m.colunas[4].itens[0]).toMatchObject({ id: 'a', motivo_perda: 'Desistiu' })
    const volta = moverCartao(m, 'a', 'novo_contato', '2026-09-28T16:00:00Z')
    expect(volta.colunas[0].itens[0]).toMatchObject({ id: 'a', motivo_perda: null })
  })

  it('cartão desconhecido ou mesma etapa: sem mudança', () => {
    expect(moverCartao(k, 'x', 'perdido', '2026-09-28T15:00:00Z')).toBe(k)
    expect(moverCartao(k, 'a', 'novo_contato', '2026-09-28T15:00:00Z')).toBe(k)
  })

  it('data sem hora não muda de dia pelo fuso', () => {
    expect(dataSemFuso('2026-09-01')).toBe('01/09/2026')
    expect(dataSemFuso(null)).toBe('—')
    expect(hojeSaoPaulo(new Date('2026-10-01T02:30:00Z'))).toBe('2026-09-30')
    expect(hojeSaoPaulo(new Date('2026-10-01T12:00:00Z'))).toBe('2026-10-01')
  })

  it('dias na etapa por extenso', () => {
    expect(textoDiasNaEtapa(0)).toBe('Hoje')
    expect(textoDiasNaEtapa(1)).toBe('1 dia')
    expect(textoDiasNaEtapa(12)).toBe('12 dias')
  })
})

describe('timeline por mês/ano', () => {
  const ev = (id: number, quando: string): TimelineEvento => ({
    id, tipo: 'nota', ocorrido_em: quando, titulo: 'Nota adicionada', ator_nome: null, ator_papel: null, dados: { nota_id: 'x' },
  })

  it('agrupa na ordem recebida, no fuso de São Paulo', () => {
    const g = agruparPorMes([
      ev(4, '2026-10-01T02:00:00Z'), // ainda 30/09 em São Paulo
      ev(3, '2026-09-15T12:00:00Z'),
      ev(2, '2026-08-31T12:00:00Z'),
      ev(1, '2025-08-10T12:00:00Z'),
    ])
    expect(g.map((x) => [x.chave, x.rotulo, x.eventos.map((e) => e.id)])).toEqual([
      ['2026-09', 'Setembro de 2026', [4, 3]],
      ['2026-08', 'Agosto de 2026', [2]],
      ['2025-08', 'Agosto de 2025', [1]],
    ])
  })

  it('sem eventos, sem grupos', () => {
    expect(agruparPorMes([])).toEqual([])
  })
})

describe('arquivo de documento', () => {
  const MB5 = 5 * 1024 * 1024

  it('extensão e MIME precisam ser da mesma família', () => {
    expect(formatoDoArquivo('rg.JPG', 'image/jpeg')).toEqual({ formato: 'jpeg', ext: 'jpg', mime: 'image/jpeg' })
    expect(formatoDoArquivo('rg.pdf', 'image/png')).toBeNull()
    expect(formatoDoArquivo('planilha.csv', 'text/csv; charset=utf-8')).toEqual({ formato: 'planilha', ext: 'csv', mime: 'text/csv' })
    expect(formatoDoArquivo('sem-extensao', 'application/pdf')).toBeNull()
    expect(formatoDoArquivo('virus.exe', 'application/pdf')).toBeNull()
  })

  it('MIME vazio (alguns navegadores): usa o da extensão', () => {
    expect(formatoDoArquivo('contrato.docx', '')).toEqual({
      formato: 'doc', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(formatoDoArquivo('foto.jpeg', '')).toEqual({ formato: 'jpeg', ext: 'jpeg', mime: 'image/jpeg' })
  })

  it('confere formato aceito e tamanho', () => {
    expect(conferirArquivo({ name: 'a.pdf', type: 'application/pdf', size: 1000 }, ['pdf'], MB5)).toEqual({ ok: true, ext: 'pdf', mime: 'application/pdf' })
    expect(conferirArquivo({ name: 'a.png', type: 'image/png', size: 1000 }, ['pdf'], MB5)).toEqual({ ok: false, erro: 'Formato não aceito. Envie PDF.' })
    expect(conferirArquivo({ name: 'a.pdf', type: 'application/pdf', size: MB5 + 1 }, ['pdf'], MB5)).toEqual({ ok: false, erro: 'O arquivo passa do limite de 5 MB.' })
    expect(conferirArquivo({ name: 'a.pdf', type: 'application/pdf', size: 0 }, ['pdf'], MB5)).toEqual({ ok: false, erro: 'O arquivo está vazio.' })
  })

  it('caminho no bucket sem dado pessoal', () => {
    expect(caminhoDoArquivo('c1', 'd1', 'ABCDEF', 'PDF')).toBe('c1/d1/abcdef.pdf')
  })

  it('accept do input a partir dos formatos', () => {
    expect(acceptDosFormatos(['pdf', 'png'])).toBe('.pdf,application/pdf,.png,image/png')
  })

  it('tamanho legível', () => {
    expect(tamanhoLegivel(MB5)).toBe('5 MB')
    expect(tamanhoLegivel(1536 * 1024)).toBe('1,5 MB')
    expect(tamanhoLegivel(800 * 1024)).toBe('800 KB')
    expect(tamanhoLegivel(120)).toBe('120 bytes')
  })
})
