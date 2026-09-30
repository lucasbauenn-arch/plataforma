import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrarComo, erroRpc, responderRest, simularDownload, simularRpc } from './apoio'
import type { EtapaFunil } from '../src/lib/types'
import type {
  ClienteDocumento, ClienteNota, ClienteTarefa, CrmFicha, KanbanCartao, KanbanResultado, TarefaItem, TimelinePagina,
} from '../src/modulos/crm/tipos'

// Funil e atividades do CRM [WP3] com a rede simulada (nada chega ao Supabase real): kanban (arrastar, "Mover
// para…", Perdidos com motivo, Documentação com confirmação, FI desabilitada, erro devolve o cartão), ficha (timeline,
// notas, tarefas, documentos: enviar, rejeitar, baixar) e a página de tarefas.

test.describe.configure({ timeout: 120_000 })

/** Argumentos recebidos por `simularRpc` (nomes `p_…`). */
type Args = Record<string, unknown>

const CORRETOR = { id: '0e000000-0000-4000-8000-000000000001', email: 'corretor@e2e.test' }
const C1 = 'd0000000-0000-4000-8000-000000000001'
const C2 = 'd0000000-0000-4000-8000-000000000002'
const C3 = 'd0000000-0000-4000-8000-000000000003'
const DOC_PEND = 'f3000000-0000-4000-8000-000000000001'
const DOC_ANALISE = 'f3000000-0000-4000-8000-000000000002'
const ARQ = 'f6000000-0000-4000-8000-000000000001'

const P = ['corretor', 'gerente', 'imobiliaria', 'parceiro', 'admin', 'super']
const tr = (de: EtapaFunil, para: EtapaFunil, o: Record<string, unknown> = {}) =>
  ({ de, para, papeis: P, sistema: false, exige_motivo: false, efeitos: [], ativa: true, ...o })
/** Semente de status_transicoes (migration 20260929000008), entidade cliente_etapa. */
const TRANSICOES = [
  tr('novo_contato', 'contato_iniciado'),
  tr('contato_iniciado', 'documentacao', { efeitos: ['solicitar_documentos_basicos'] }),
  tr('novo_contato', 'perdido', { exige_motivo: true }),
  tr('contato_iniciado', 'perdido', { exige_motivo: true }),
  tr('documentacao', 'perdido', { exige_motivo: true }),
  tr('perdido', 'novo_contato', { efeitos: ['limpar_motivo_perda'] }),
  ...(['novo_contato', 'contato_iniciado', 'documentacao', 'perdido'] as EtapaFunil[]).map((de) =>
    tr(de, 'finalizado', { papeis: [], sistema: true, validacoes: ['contrato_assinado'] })),
  tr('contato_iniciado', 'novo_contato', { ativa: false }),
  tr('documentacao', 'contato_iniciado', { ativa: false }),
  tr('documentacao', 'novo_contato', { ativa: false }),
]
const BASICOS = ['CPF', 'CNH', 'Comprovante de residência', 'Comprovante de renda']

const cartao = (id: string, nome: string, etapa: EtapaFunil, extra: Partial<KanbanCartao> = {}): KanbanCartao => ({
  id, nome, telefone: '11900000001', corretor: null, etapa, etapa_desde: '2026-09-20T12:00:00Z', dias_na_etapa: 8,
  documentos_pendentes: 0, tarefa_atrasada: false, motivo_perda: null, ...extra,
})

/** Kanban simulado: o estado muda quando crm_mudar_etapa responde bem, como no servidor. */
function modeloKanban(cartoes: KanbanCartao[]) {
  const estado = new Map(cartoes.map((c) => [c.id, c]))
  const resultado = (): KanbanResultado => {
    const todos = [...estado.values()]
    const colunas = (['novo_contato', 'contato_iniciado', 'documentacao', 'finalizado', 'perdido'] as EtapaFunil[]).map((etapa) => {
      const itens = todos.filter((c) => c.etapa === etapa)
      return { etapa, total: itens.length, itens }
    })
    return { colunas, contadores: { total: todos.length, finalizados: 0, perdidos: todos.filter((c) => c.etapa === 'perdido').length } }
  }
  const mover = (id: string, para: EtapaFunil, motivo: unknown) => {
    const c = estado.get(id)!
    estado.set(id, { ...c, etapa: para, dias_na_etapa: 0, motivo_perda: para === 'perdido' ? String(motivo) : null })
    return c.etapa
  }
  return { resultado, mover }
}

/** Sessão de corretor aprovado, com tudo o que não é do teste respondendo vazio (nada vai à rede real). */
async function entrarCorretor(page: Page) {
  await page.route('**/rest/v1/**', (r) => responderRest(r, []))
  await page.route('**/storage/v1/**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"não simulado"}' }))
  await page.route('**/functions/v1/**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"erro":"não simulado"}' }))
  await entrarComo(page, CORRETOR.id, CORRETOR.email, 'corretor', { nome: 'Corretor E2E' })
  await page.route('**/rest/v1/status_transicoes**', (r) => responderRest(r, TRANSICOES))
  await page.route('**/rest/v1/configuracao_publica**', (r) => responderRest(r, [{ documentos_basicos: BASICOS, documento_max_bytes: 5242880 }]))
}

/** A primeira carga do painel (chunks lazy compilados sob demanda pelo dev server) pode passar dos 5 s padrão. */
const CARGA = 30_000

/**
 * Abre a rota e espera `pronto`. Com o dev server frio (vários pacotes rodando E2E ao mesmo tempo), o Vite pode
 * reotimizar dependências no meio da carga e deixar o import lazy da tela pendurado: aí recarrega a página.
 */
async function irPara(page: Page, url: string, pronto: () => Locator) {
  await expect(async () => {
    await page.goto(url)
    await expect(pronto()).toBeVisible({ timeout: 20_000 })
  }).toPass({ timeout: 80_000 })
}

async function abrirFunil(page: Page) {
  await irPara(page, '/parceiros/painel/crm', () => page.getByLabel('Contadores do funil'))
  await expect(page.getByRole('heading', { name: 'Funil' })).toBeVisible()
}

const coluna = (page: Page, etapa: EtapaFunil) => page.locator(`section[data-etapa="${etapa}"]`)
const cartaoNa = (page: Page, etapa: EtapaFunil, nome: string) => coluna(page, etapa).getByRole('article', { name: nome })

test.describe('kanban do corretor', () => {
  test('arrasta NC → CI: chama crm_mudar_etapa e o cartão muda de coluna; FI fica desabilitada', async ({ page }) => {
    await entrarCorretor(page)
    const k = modeloKanban([cartao(C1, 'Cliente Um', 'novo_contato', { documentos_pendentes: 2, tarefa_atrasada: true })])
    await simularRpc(page, 'crm_kanban', () => k.resultado())
    const chamadas = await simularRpc(page, 'crm_mudar_etapa', (a: Args) => {
      const de = k.mover(String(a.p_id), a.p_para as EtapaFunil, a.p_motivo)
      return { de, para: a.p_para, etapa_desde: '2026-09-28T12:00:00Z', documentos_solicitados: [] }
    })

    await abrirFunil(page)
    const c1 = cartaoNa(page, 'novo_contato', 'Cliente Um')
    await expect(c1).toBeVisible({ timeout: CARGA })
    await expect(c1.getByText('2 documentos pendentes')).toBeVisible()
    await expect(c1.getByText('Tarefa atrasada')).toBeVisible()
    await expect(c1.getByRole('link', { name: 'WhatsApp de Cliente Um' })).toHaveAttribute('href', 'https://wa.me/5511900000001')
    await expect(page.getByLabel('Contadores do funil')).toContainText('Clientes ativos1')

    // Finalizado: ninguém entra manualmente (N13)
    await expect(coluna(page, 'finalizado')).toHaveAttribute('aria-disabled', 'true')
    await expect(coluna(page, 'finalizado')).toContainText('Finaliza automaticamente quando o contrato é assinado.')

    await c1.dragTo(coluna(page, 'contato_iniciado'))
    await expect(cartaoNa(page, 'contato_iniciado', 'Cliente Um')).toBeVisible()
    await expect(cartaoNa(page, 'novo_contato', 'Cliente Um')).toHaveCount(0)
    expect(chamadas).toEqual([{ p_id: C1, p_para: 'contato_iniciado', p_motivo: null }])
    await expect(page.getByText('Cliente Um foi para Contato iniciado.')).toBeVisible()
  })

  test('arrastar para Finalizado não chama o servidor e o menu não oferece FI', async ({ page }) => {
    await entrarCorretor(page)
    const k = modeloKanban([cartao(C1, 'Cliente Um', 'contato_iniciado')])
    await simularRpc(page, 'crm_kanban', () => k.resultado())
    const chamadas = await simularRpc(page, 'crm_mudar_etapa', erroRpc('P0001', 'TRANSICAO_INVALIDA'))

    await abrirFunil(page)
    const c1 = cartaoNa(page, 'contato_iniciado', 'Cliente Um')
    const menu = c1.getByLabel('Mover Cliente Um para…')
    await expect(menu.locator('option')).toHaveText(['Mover para…', 'Documentação', 'Perdido'])

    await c1.dragTo(coluna(page, 'finalizado'))
    await expect(cartaoNa(page, 'contato_iniciado', 'Cliente Um')).toBeVisible()
    await page.waitForTimeout(300)
    expect(chamadas).toHaveLength(0)
  })

  test('Perdidos exige motivo (pelo menu acessível) e o cartão vai para a coluna recolhida', async ({ page }) => {
    await entrarCorretor(page)
    const k = modeloKanban([cartao(C1, 'Cliente Um', 'novo_contato'), cartao(C2, 'Cliente Dois', 'novo_contato')])
    await simularRpc(page, 'crm_kanban', () => k.resultado())
    const chamadas = await simularRpc(page, 'crm_mudar_etapa', (a: Args) => {
      const de = k.mover(String(a.p_id), a.p_para as EtapaFunil, a.p_motivo)
      return { de, para: a.p_para, etapa_desde: '2026-09-28T12:00:00Z', documentos_solicitados: [] }
    })

    await abrirFunil(page)
    await cartaoNa(page, 'novo_contato', 'Cliente Dois').getByLabel('Mover Cliente Dois para…').selectOption('perdido')
    const modal = page.getByRole('dialog', { name: 'Marcar Cliente Dois como perdido' })
    await expect(modal).toBeVisible()
    const confirmar = modal.getByRole('button', { name: 'Marcar como perdido' })
    await expect(confirmar).toBeDisabled()
    await modal.getByLabel('Motivo da perda').fill('ok')
    await expect(confirmar).toBeDisabled()
    await modal.getByLabel('Motivo da perda').fill('Comprou com outra empresa')
    await confirmar.click()
    await expect(modal).toBeHidden()
    expect(chamadas).toEqual([{ p_id: C2, p_para: 'perdido', p_motivo: 'Comprou com outra empresa' }])

    const perdidos = coluna(page, 'perdido')
    await expect(perdidos.getByLabel('1 cliente', { exact: true })).toBeVisible()
    await perdidos.getByRole('button', { name: 'Mostrar Perdido' }).click()
    await expect(cartaoNa(page, 'perdido', 'Cliente Dois')).toContainText('Motivo: Comprou com outra empresa')
  })

  test('Documentação pede confirmação com os documentos básicos', async ({ page }) => {
    await entrarCorretor(page)
    const k = modeloKanban([cartao(C3, 'Cliente Três', 'contato_iniciado')])
    await simularRpc(page, 'crm_kanban', () => k.resultado())
    const chamadas = await simularRpc(page, 'crm_mudar_etapa', (a: Args) => {
      const de = k.mover(String(a.p_id), a.p_para as EtapaFunil, a.p_motivo)
      return { de, para: a.p_para, etapa_desde: '2026-09-28T12:00:00Z', documentos_solicitados: BASICOS }
    })

    await abrirFunil(page)
    await cartaoNa(page, 'contato_iniciado', 'Cliente Três').dragTo(coluna(page, 'documentacao'))
    const modal = page.getByRole('dialog', { name: 'Mover Cliente Três para Documentação' })
    await expect(modal).toContainText('CPF, CNH, Comprovante de residência, Comprovante de renda')
    expect(chamadas).toHaveLength(0)
    await modal.getByRole('button', { name: 'Mover e solicitar' }).click()
    await expect(cartaoNa(page, 'documentacao', 'Cliente Três')).toBeVisible()
    expect(chamadas).toEqual([{ p_id: C3, p_para: 'documentacao', p_motivo: null }])
    await expect(page.getByText('Documentos solicitados: CPF, CNH, Comprovante de residência, Comprovante de renda.')).toBeVisible()
  })

  test('recusa do servidor devolve o cartão e mostra a mensagem', async ({ page }) => {
    await entrarCorretor(page)
    const k = modeloKanban([cartao(C1, 'Cliente Um', 'novo_contato')])
    await simularRpc(page, 'crm_kanban', () => k.resultado())
    await simularRpc(page, 'crm_mudar_etapa', erroRpc('42501', 'Sem acesso a este registro'))

    await abrirFunil(page)
    await cartaoNa(page, 'novo_contato', 'Cliente Um').getByLabel('Mover Cliente Um para…').selectOption('contato_iniciado')
    await expect(page.getByText('Você não tem acesso a este registro.')).toBeVisible()
    await expect(cartaoNa(page, 'novo_contato', 'Cliente Um')).toBeVisible()
    await expect(cartaoNa(page, 'contato_iniciado', 'Cliente Um')).toHaveCount(0)
  })

  test('filtros vão para a RPC (busca e período); o corretor não tem filtro de responsável', async ({ page }) => {
    await entrarCorretor(page)
    const pedidos = await simularRpc(page, 'crm_kanban', () => modeloKanban([]).resultado())
    await abrirFunil(page)
    await expect(page.getByLabel('Contadores do funil')).toBeVisible()
    await expect(page.getByText('Responsável', { exact: true })).toHaveCount(0)
    await page.getByLabel('Buscar cliente por nome').fill('Maria')
    await expect.poll(() => pedidos.at(-1)?.p_filtros).toEqual({ busca: 'Maria' })
    await page.getByLabel('Período de').fill('2026-09-01')
    await expect.poll(() => pedidos.at(-1)?.p_filtros).toEqual({ busca: 'Maria', periodo_de: '2026-09-01' })
    expect(pedidos.every((p) => p.p_limite_coluna === 50)).toBe(true)
  })
})

// ---------- ficha ----------

function ficha(): CrmFicha {
  return {
    cliente: {
      id: C1, tipo_pessoa: 'fisica', nome: 'Cliente', sobrenome: 'Um', cpf: '52998224725', cnpj: null, rg: null, data_nascimento: null,
      genero: null, estado_civil: null, nacionalidade: null, email: 'c1@e2e.test', emails_adicionais: [], telefone: '11900000001',
      telefones_adicionais: [], horario_contato: null, cep: null, logradouro: null, numero: null, complemento: null, bairro: null,
      cidade: null, uf: null, pais: 'Brasil', interesses: [], etapa: 'documentacao', etapa_desde: '2026-09-20T12:00:00Z',
      motivo_perda: null, origem: 'cadastro_interno', exclusividade_ate: null, portal_liberado: false, tem_login_portal: false,
      criado_em: '2026-09-01T12:00:00Z', atualizado_em: null, inativado_em: null, motivo_inativacao: null, anonimizado_em: null,
    },
    cadeia: { corretor: { id: 'c0000000-0000-4000-8000-000000000014', nome: 'Corretor E2E' }, gerente: null, imobiliaria: null },
    destinos_etapa: [],
    permissoes: {
      editar: true, editar_documento: false, mudar_etapa: true, criar_nota: true, criar_tarefa: true, solicitar_documento: true,
      enviar_documento: true, analisar_documento: true, baixar_documento: true, transferir: false, criar_contrato: true,
      criar_proposta: true, inativar: false, liberar_portal: false, ver_portal: false,
    },
    contadores: { documentos_pendentes: 1, documentos_em_analise: 1, tarefas_pendentes: 1, tarefas_atrasadas: 0, notas: 1, contratos_ativos: 0, propostas: 0 },
    historico_vinculos: [],
    consentimentos: [],
  }
}

const TIMELINE: TimelinePagina = {
  itens: [
    { id: 3, tipo: 'etapa', ocorrido_em: '2026-09-20T12:00:00Z', titulo: 'Etapa: Documentação', ator_nome: 'Corretor E2E', ator_papel: 'corretor', dados: { de: 'contato_iniciado', para: 'documentacao', motivo: null } },
    { id: 2, tipo: 'nota', ocorrido_em: '2026-09-10T12:00:00Z', titulo: 'Nota adicionada', ator_nome: 'Gerência', ator_papel: 'gerente', dados: { nota_id: 'n1' } },
    { id: 1, tipo: 'cadastro', ocorrido_em: '2026-08-05T12:00:00Z', titulo: 'Cadastro', ator_nome: null, ator_papel: null, dados: { origem: 'cadastro_interno' } },
  ],
  mais: false,
}

const nota = (texto: string, minha: boolean): ClienteNota => ({
  id: `n-${texto.length}`, texto, autor_nome: minha ? 'Corretor E2E' : 'Gerência', autor_papel: minha ? 'corretor' : 'gerente',
  criado_em: '2026-09-10T12:00:00Z', migrado_legado: false, removido_lgpd: false, minha,
})

function documentos(): ClienteDocumento[] {
  return [
    { id: DOC_PEND, cliente_id: C1, tipo: 'cliente', nome: 'CPF', formatos_aceitos: ['jpeg', 'png', 'pdf'], status: 'pendente', basico: true,
      contrato_id: null, analisado_em: null, analisado_por: null, motivo_rejeicao: null, criado_em: '2026-09-20T12:00:00Z', arquivos: [] },
    { id: DOC_ANALISE, cliente_id: C1, tipo: 'cliente', nome: 'CNH', formatos_aceitos: ['jpeg', 'png', 'pdf'], status: 'em_analise', basico: true,
      contrato_id: null, analisado_em: null, analisado_por: null, motivo_rejeicao: null, criado_em: '2026-09-20T12:00:00Z',
      arquivos: [{ id: ARQ, mime_type: 'application/pdf', tamanho_bytes: 250000, enviado_em: '2026-09-21T12:00:00Z', enviado_por_nome: 'Cliente', atual: true, removido: false }] },
  ]
}

/** Depois de `entrarCorretor` e das simulações do teste (a rota registrada por último vale). */
async function abrirFicha(page: Page, aba: string) {
  await simularRpc(page, 'crm_ficha', ficha())
  const titulo = { timeline: 'Timeline', notas: 'Notas', tarefas: 'Tarefas', documentos: 'Documentos' }[aba] ?? aba
  // a aba também é lazy: espera o título dela (h3), não só o da ficha
  await irPara(page, `/parceiros/painel/crm/${C1}?aba=${aba}`, () => page.getByRole('heading', { name: titulo, level: 3 }))
  await expect(page.getByRole('heading', { name: 'Cliente Um' })).toBeVisible()
}

test.describe('ficha do cliente', () => {
  test('timeline agrupada por mês/ano', async ({ page }) => {
    await entrarCorretor(page)
    await simularRpc(page, 'crm_timeline', TIMELINE)
    await abrirFicha(page, 'timeline')
    await expect(page.getByRole('region', { name: 'Setembro de 2026' })).toContainText('Etapa: Documentação', { timeout: CARGA })
    await expect(page.getByRole('region', { name: 'Setembro de 2026' })).toContainText('Contato iniciado → Documentação')
    await expect(page.getByRole('region', { name: 'Agosto de 2026' })).toContainText('Cadastro')
    await expect(page.getByRole('region', { name: 'Agosto de 2026' })).toContainText('Sistema')
  })

  test('notas: cria (texto enviado como veio, exibido sem HTML) e não oferece editar nem excluir', async ({ page }) => {
    await entrarCorretor(page)
    let notas = [nota('Primeira nota do gerente', false)]
    await simularRpc(page, 'crm_notas', () => notas)
    const criadas = await simularRpc(page, 'crm_nota_criar', (a: Args) => {
      notas = [nota(String(a.p_texto), true), ...notas]
      return 'f4000000-0000-4000-8000-000000000001'
    })
    await simularRpc(page, 'crm_timeline', { itens: [], mais: false })
    await abrirFicha(page, 'notas')
    await expect(page.getByText('Primeira nota do gerente')).toBeVisible({ timeout: CARGA })
    await page.getByRole('button', { name: 'Adicionar nota' }).click()
    await expect(page.getByText('Escreva o texto da nota.')).toBeVisible()
    expect(criadas).toHaveLength(0)
    await page.getByLabel('Nova nota').fill('Ligar <b>amanhã</b> às 10h')
    await page.getByRole('button', { name: 'Adicionar nota' }).click()
    await expect(page.getByText('Nota adicionada.')).toBeVisible()
    expect(criadas).toEqual([{ p_cliente_id: C1, p_texto: 'Ligar <b>amanhã</b> às 10h' }])
    await expect(page.getByText('Ligar <b>amanhã</b> às 10h')).toBeVisible()
    await expect(page.getByRole('button', { name: /Editar|Excluir/ })).toHaveCount(0)
  })

  test('tarefas: cria com responsável do escopo e conclui', async ({ page }) => {
    await entrarCorretor(page)
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const tarefa: ClienteTarefa = {
      id: 'f5000000-0000-4000-8000-000000000001', cliente_id: C1, titulo: 'Ligar para o cliente', descricao: null,
      responsavel: { id: CORRETOR.id, nome: 'Corretor E2E' }, prazo: '2026-09-01', status: 'pendente', atrasada: true, concluida_em: null,
      concluida_por: null, criado_em: '2026-08-30T12:00:00Z', criado_por: { id: CORRETOR.id, nome: 'Corretor E2E' }, pode_editar: true, pode_concluir: true,
    }
    let tarefas = [tarefa]
    await simularRpc(page, 'crm_tarefas', () => tarefas)
    await simularRpc(page, 'crm_responsaveis', [{ profile_id: CORRETOR.id, nome: 'Corretor E2E', papel: 'corretor', tipo: 'corretor' }])
    const criadas = await simularRpc(page, 'crm_tarefa_criar', 'f5000000-0000-4000-8000-000000000002')
    const concluidas = await simularRpc(page, 'crm_tarefa_concluir', (a: Args) => {
      tarefas = tarefas.map((t) => (t.id === a.p_id ? { ...t, status: 'concluida', atrasada: false, concluida_em: '2026-09-28T12:00:00Z', pode_concluir: false, pode_editar: false } : t))
      return null
    })
    await simularRpc(page, 'crm_timeline', { itens: [], mais: false })
    await abrirFicha(page, 'tarefas')

    await expect(page.getByText('Atrasada')).toBeVisible({ timeout: CARGA })
    await page.getByRole('button', { name: 'Nova tarefa' }).click()
    const modal = page.getByRole('dialog', { name: 'Nova tarefa' })
    await modal.getByLabel('O que fazer').fill('Enviar simulação')
    await expect(modal.getByLabel('Responsável')).toHaveValue(CORRETOR.id)
    await modal.getByLabel('Prazo').fill(hoje)
    await modal.getByRole('button', { name: 'Salvar' }).click()
    await expect(modal).toBeHidden()
    expect(criadas).toEqual([{ p_cliente_id: C1, p_titulo: 'Enviar simulação', p_descricao: null, p_responsavel_id: CORRETOR.id, p_prazo: hoje }])

    await page.getByRole('button', { name: 'Concluir: Ligar para o cliente' }).click()
    await expect(page.getByText('Tarefa concluída.')).toBeVisible()
    expect(concluidas).toEqual([{ p_id: tarefa.id }])
  })

  test('tarefas: a herdada de um cliente transferido (responsável sem acesso) é reatribuída pelo novo corretor', async ({ page }) => {
    await entrarCorretor(page)
    // o servidor manda o corretor anterior com nome genérico (PAR-3: outra equipe) e libera a tarefa órfã
    const ANTERIOR = '0e000000-0000-4000-8000-000000000099'
    const tarefa: ClienteTarefa = {
      id: 'f5000000-0000-4000-8000-000000000009', cliente_id: C1, titulo: 'Retornar ligação', descricao: null,
      responsavel: { id: ANTERIOR, nome: 'Corretor' }, prazo: '2026-09-01', status: 'pendente', atrasada: true, concluida_em: null,
      concluida_por: null, criado_em: '2026-08-30T12:00:00Z', criado_por: { id: ANTERIOR, nome: 'Corretor' }, pode_editar: true, pode_concluir: true,
    }
    let tarefas = [tarefa]
    await simularRpc(page, 'crm_tarefas', () => tarefas)
    await simularRpc(page, 'crm_responsaveis', [{ profile_id: CORRETOR.id, nome: 'Corretor E2E', papel: 'corretor', tipo: 'corretor' }])
    const editadas = await simularRpc(page, 'crm_tarefa_editar', (a: Args) => {
      tarefas = tarefas.map((t) => (t.id === a.p_id ? { ...t, responsavel: { id: CORRETOR.id, nome: 'Corretor E2E' } } : t))
      return null
    })
    await simularRpc(page, 'crm_timeline', { itens: [], mais: false })
    await abrirFicha(page, 'tarefas')

    await expect(page.getByText('Responsável: Corretor ·')).toBeVisible({ timeout: CARGA })
    await page.getByRole('button', { name: 'Editar: Retornar ligação' }).click()
    const modal = page.getByRole('dialog', { name: 'Editar tarefa' })
    // o responsável atual continua na lista (a RPC só confere na troca), ao lado de quem pode ser escolhido
    await expect(modal.getByLabel('Responsável')).toHaveValue(ANTERIOR)
    await modal.getByLabel('Responsável').selectOption(CORRETOR.id)
    await modal.getByRole('button', { name: 'Salvar' }).click()
    await expect(modal).toBeHidden()
    await expect(page.getByText('Tarefa atualizada.')).toBeVisible()
    expect(editadas).toEqual([{ p_id: tarefa.id, p_dados: { responsavel_id: CORRETOR.id } }])
    await expect(page.getByText('Responsável: Corretor E2E ·')).toBeVisible()
  })

  test('documentos: envia em nome do cliente, rejeita com motivo e baixa pela Edge', async ({ page }) => {
    await entrarCorretor(page)
    let docs = documentos()
    await simularRpc(page, 'crm_documentos', () => docs)
    await simularRpc(page, 'crm_timeline', { itens: [], mais: false })
    const uploads: { url: string; upsert: string | undefined; tipo: string | undefined }[] = []
    await page.route('**/storage/v1/object/crm-documentos/**', async (r) => {
      uploads.push({ url: r.request().url(), upsert: r.request().headers()['x-upsert'], tipo: r.request().headers()['content-type'] })
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'crm-documentos/x', Id: 'x' }) })
    })
    const registros = await simularRpc(page, 'crm_documento_registrar_envio', (a: Args) => {
      docs = docs.map((d) => (d.id === a.p_documento_id ? { ...d, status: 'em_analise' } : d))
      return null
    })
    const analises = await simularRpc(page, 'crm_documento_analisar', (a: Args) => {
      docs = docs.map((d) => (d.id === a.p_id ? { ...d, status: 'rejeitado', motivo_rejeicao: String(a.p_motivo) } : d))
      return null
    })
    const baixas = await simularRpc(page, 'crm_documento_baixar', { bucket: 'crm-documentos', path: `${C1}/${DOC_ANALISE}/arquivo.pdf`, expira_em: '2026-09-28T12:01:00Z' })
    await page.context().route('https://arquivos.e2e.test/**', (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' }))
    const edge = await simularDownload(page)
    await abrirFicha(page, 'documentos')

    // enviar: tipo errado nem sai do navegador; PDF vai para <cliente>/<documento>/<uuid>.pdf sem upsert
    const cpf = page.getByRole('listitem', { name: 'CPF' })
    await expect(cpf).toBeVisible({ timeout: CARGA })
    await cpf.getByLabel('Arquivo para CPF').setInputFiles({ name: 'cpf.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
    await expect(page.getByText('Formato não aceito. Envie JPEG, PNG, PDF.')).toBeVisible()
    expect(uploads).toHaveLength(0)
    await cpf.getByLabel('Arquivo para CPF').setInputFiles({ name: 'cpf.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 teste') })
    await expect(page.getByText('CPF: arquivo enviado para análise.')).toBeVisible()
    expect(uploads).toHaveLength(1)
    expect(uploads[0].upsert).toBe('false')
    const caminho = String(registros[0]?.p_path)
    expect(caminho).toMatch(new RegExp(`^${C1}/${DOC_PEND}/[0-9a-f-]{36}\\.pdf$`))
    expect(decodeURIComponent(uploads[0].url)).toContain(`/crm-documentos/${caminho}`)
    expect(registros).toEqual([{ p_documento_id: DOC_PEND, p_path: caminho }])

    // rejeitar exige motivo
    const cnh = page.getByRole('listitem', { name: 'CNH' })
    await cnh.getByRole('button', { name: 'Rejeitar CNH' }).click()
    const modal = page.getByRole('dialog', { name: 'Rejeitar CNH' })
    await expect(modal.getByRole('button', { name: 'Rejeitar' })).toBeDisabled()
    await modal.getByLabel('Motivo da rejeição').fill('Imagem ilegível')
    await modal.getByRole('button', { name: 'Rejeitar' }).click()
    await expect(modal).toBeHidden()
    expect(analises).toEqual([{ p_id: DOC_ANALISE, p_aprovar: false, p_motivo: 'Imagem ilegível' }])
    await expect(cnh).toContainText('Rejeitado: Imagem ilegível')

    // baixar: RPC auditada e depois a Edge baixar-arquivo (nunca createSignedUrl no navegador)
    const popup = page.waitForEvent('popup')
    await cnh.getByRole('button', { name: /Baixar versão/ }).click()
    await popup
    await expect.poll(() => edge.length).toBe(1)
    expect(baixas).toEqual([{ p_arquivo_id: ARQ }])
    expect(edge[0]).toEqual({ bucket: 'crm-documentos', path: `${C1}/${DOC_ANALISE}/arquivo.pdf` })
  })
})

// ---------- página de tarefas ----------

test('tarefas: minhas tarefas, filtro de atrasadas e concluir', async ({ page }) => {
  await entrarCorretor(page)
  const item: TarefaItem = {
    id: 'f5000000-0000-4000-8000-000000000009', cliente_id: C1, cliente: { id: C1, nome: 'Cliente Um' }, titulo: 'Retornar ligação',
    descricao: 'Cliente pediu retorno', responsavel: { id: CORRETOR.id, nome: 'Corretor E2E' }, prazo: '2026-09-01', status: 'pendente',
    atrasada: true, concluida_em: null, concluida_por: null, criado_em: '2026-08-30T12:00:00Z', criado_por: null, pode_editar: true, pode_concluir: true,
  }
  const pedidos = await simularRpc(page, 'crm_minhas_tarefas', { total: 1, itens: [item] })
  const concluidas = await simularRpc(page, 'crm_tarefa_concluir', null)

  await irPara(page, '/parceiros/painel/tarefas', () => page.getByText('Retornar ligação', { exact: true }))
  await expect(page.getByRole('link', { name: 'Cliente Um' })).toHaveAttribute('href', `/parceiros/painel/crm/${C1}?aba=tarefas`)
  await expect(page.getByRole('cell', { name: '01/09/2026' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Da equipe' })).toHaveCount(0)
  expect(pedidos[0]).toEqual({ p_filtros: { escopo: 'minhas', status: 'pendente', atrasadas: false, limite: 50, offset: 0 } })

  await page.getByLabel('Só atrasadas').click()
  await expect(page.getByLabel('Só atrasadas')).toBeChecked()
  await expect.poll(() => pedidos.at(-1)).toEqual({ p_filtros: { escopo: 'minhas', status: 'pendente', atrasadas: true, limite: 50, offset: 0 } })
  await page.getByRole('button', { name: 'Concluir: Retornar ligação' }).click()
  await expect(page.getByText('Tarefa concluída.')).toBeVisible()
  expect(concluidas).toEqual([{ p_id: item.id }])
})

test('gerente: vê o corretor no cartão, filtra por responsável e tem a aba "Da equipe"', async ({ page }) => {
  await page.route('**/rest/v1/**', (r) => responderRest(r, []))
  await entrarComo(page, '0e000000-0000-4000-8000-000000000002', 'gerente@e2e.test', 'gerente', { nome: 'Gerente E2E' })
  await page.route('**/rest/v1/status_transicoes**', (r) => responderRest(r, TRANSICOES))
  await page.route('**/rest/v1/configuracao_publica**', (r) => responderRest(r, [{ documentos_basicos: BASICOS, documento_max_bytes: 5242880 }]))
  await page.route('**/rest/v1/parceiros**', (r) => responderRest(r, [
    { id: 'c0000000-0000-4000-8000-000000000014', nome: 'CA1a Corretor', tipo: 'corretor', imobiliaria_id: 'b1', gerente_id: 'g1', virtual: false },
  ]))
  const pedidos = await simularRpc(page, 'crm_kanban', modeloKanban([
    cartao(C1, 'Cliente Um', 'novo_contato', { corretor: { id: 'c0000000-0000-4000-8000-000000000014', nome: 'CA1a Corretor' } }),
  ]).resultado())
  const tarefas = await simularRpc(page, 'crm_minhas_tarefas', { total: 0, itens: [] })

  await abrirFunil(page)
  await expect(cartaoNa(page, 'novo_contato', 'Cliente Um')).toContainText('CA1a Corretor')
  await page.getByLabel(/Responsável/).selectOption('c0000000-0000-4000-8000-000000000014')
  await expect.poll(() => pedidos.at(-1)?.p_filtros).toEqual({ corretor_id: 'c0000000-0000-4000-8000-000000000014' })
  await page.getByLabel('Só os meus').click()
  await expect(page.getByLabel('Só os meus')).toBeChecked()
  await expect.poll(() => pedidos.at(-1)?.p_filtros).toEqual({ corretor_id: 'c0000000-0000-4000-8000-000000000014', so_meus: true })

  await irPara(page, '/parceiros/painel/tarefas?aba=equipe', () => page.getByRole('tab', { name: 'Da equipe', selected: true }))
  await expect.poll(() => tarefas.at(-1)?.p_filtros).toMatchObject({ escopo: 'equipe' })
})
