import { expect as expectBase, test, type Page, type Route } from '@playwright/test'
import { entrarComo, erroRpc, jwtFalso, responderRest, simularEscopo, simularRpc, simularTurnstile, usuario } from './apoio'

// Rede [WP1] (docs/ARQUITETURA_EXPANSAO.md §6.2, §7.2, §8.5): gerente transfere cliente; imobiliária troca corretor de
// gerente e inativa com destino; convite: definir-senha não consome o token antes do clique; cadastro espontâneo com
// CPF, CRECI e termo; admin: convite em lote e aprovação de autocadastro; termo pendente em Meu cadastro.
// Toda a rede do Supabase é simulada (e2e/apoio.ts): nada chega ao banco real.

// Um navegador por vez neste arquivo (outros pacotes rodam E2E na mesma máquina) e prazos folgados para o painel lazy.
test.describe.configure({ mode: 'default', timeout: 60_000 })
const expect = expectBase.configure({ timeout: 15_000 })

const IMOB = 'b0000000-0000-4000-8000-00000000000a'
const IA = 'c0000000-0000-4000-8000-000000000011'
const G1 = 'c0000000-0000-4000-8000-000000000012'
const G2 = 'c0000000-0000-4000-8000-000000000013'
const C1 = 'c0000000-0000-4000-8000-000000000014'
const C2 = 'c0000000-0000-4000-8000-000000000015'
const C3 = 'c0000000-0000-4000-8000-000000000016'
const TERMO = 'e0000000-0000-4000-8000-000000000001'

const imob = { nome: 'Imobiliária A', da_casa: false }
const linha = (id: string, nome: string, tipo: 'imobiliaria' | 'gerente' | 'corretor', gerente: string | null, extra: Record<string, unknown> = {}) => ({
  id, profile_id: null, tipo, imobiliaria_id: IMOB, gerente_id: gerente, nome, creci: tipo === 'corretor' ? `CRECI-${nome}` : null,
  email: `${nome.toLowerCase().replace(/\s+/g, '.')}@e2e.test`, telefone: '11988887777', codigo_indicacao: null, virtual: false,
  migrado_legado: false, imobiliaria_declarada: null, criado_em: '2026-09-01T12:00:00Z', inativado_em: null,
  imobiliaria: imob, gerente: gerente ? { nome: gerente === G1 ? 'GA1 Gerente' : 'GA2 Gerente' } : null, perfil: null, ...extra,
})
const PARCEIROS = [
  linha(IA, 'IA Usuária', 'imobiliaria', null),
  linha(G1, 'GA1 Gerente', 'gerente', null),
  linha(G2, 'GA2 Gerente', 'gerente', null),
  linha(C1, 'CA1a Corretor', 'corretor', G1, { profile_id: 'a1' }),
  linha(C2, 'CA1b Corretor', 'corretor', G1),
  linha(C3, 'CA2a Corretor', 'corretor', G2),
]

function detalhe(extra: Record<string, unknown> = {}) {
  return {
    id: C1, profile_id: 'a1', tipo: 'corretor', nome: 'CA1a Corretor', cpf: '12345670320', creci: 'CRECI-CA1A',
    email: 'ca1a@e2e.test', telefone: '11988887777', codigo_indicacao: 'abcdefghij', virtual: false, migrado_legado: false,
    imobiliaria_declarada: null, imobiliaria: { id: IMOB, nome: 'Imobiliária A', da_casa: false }, gerente: { id: G1, nome: 'GA1 Gerente' },
    status_parceiro: 'aprovado', papel: 'corretor', tem_login: true, ultimo_acesso_em: '2026-09-20T10:00:00Z', convite_pendente: false,
    criado_em: '2026-09-01T12:00:00Z', inativado_em: null, motivo_inativacao: null, corretores_ativos: 0, clientes_ativos: 2,
    historico: [{ imobiliaria: { id: IMOB, nome: 'Imobiliária A' }, gerente: { id: G1, nome: 'GA1 Gerente' }, vigente_de: '2026-09-01T12:00:00Z', vigente_ate: null, motivo: 'cadastro' }],
    status_historico: null,
    ...extra,
  }
}

/** Nada sai para o Supabase real: o que não foi simulado responde 404 (as rotas registradas depois têm precedência). */
async function isolarRede(page: Page) {
  await page.route(/\.supabase\.co\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'não simulado', details: null, hint: null }) }))
}

/** GET /rest/v1/parceiros como o PostgREST, aplicando os filtros que o app usa (tipo, imobiliária, ativos). */
async function simularParceiros(page: Page, linhas = PARCEIROS) {
  await page.route('**/rest/v1/parceiros**', (r: Route) => {
    const u = new URL(r.request().url())
    let itens = linhas
    const tipo = u.searchParams.get('tipo')
    if (tipo?.startsWith('in.(')) {
      const tipos = tipo.slice(4, -1).split(',')
      itens = itens.filter((p) => tipos.includes(p.tipo))
    } else if (tipo?.startsWith('eq.')) itens = itens.filter((p) => p.tipo === tipo.slice(3))
    const imobiliaria = u.searchParams.get('imobiliaria_id')
    if (imobiliaria?.startsWith('eq.')) itens = itens.filter((p) => p.imobiliaria_id === imobiliaria.slice(3))
    const excluir = u.searchParams.get('id')
    if (excluir?.startsWith('neq.')) itens = itens.filter((p) => p.id !== excluir.slice(4))
    return responderRest(r, itens)
  })
}

test.describe('rede', () => {
  test('gerente transfere clientes do próprio corretor (a RPC recebe só ids, destino e motivo)', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000012', 'ga1@e2e.test', 'gerente', {
      nome: 'GA1 Gerente', extra: { parceiro_id: G1, gerente_id: G1, imobiliaria_id: IMOB },
    })
    await simularParceiros(page)
    await simularRpc(page, 'rede_parceiro_detalhe', detalhe())
    await simularRpc(page, 'crm_listar', {
      total: 2,
      itens: [
        { id: 'd0000000-0000-4000-8000-000000000001', nome: 'Cliente Um', sobrenome: null, etapa: 'novo_contato' },
        { id: 'd0000000-0000-4000-8000-000000000002', nome: 'Cliente Dois', sobrenome: 'Silva', etapa: 'contato_iniciado' },
      ],
    })
    const transferencias = await simularRpc(page, 'rede_transferir_clientes', 2)

    await page.goto(`/parceiros/painel/equipe/${C1}`)
    await expect(page.getByRole('heading', { name: 'CA1a Corretor' })).toBeVisible()
    await page.getByRole('button', { name: 'Transferir clientes' }).click()
    const janela = page.getByRole('dialog', { name: /Transferir clientes/ })
    await janela.getByLabel(/Todos \(2\)/).check()
    await janela.getByLabel('Novo responsável').selectOption(C2)
    await janela.getByLabel('Motivo').fill('Redistribuição da carteira')
    await janela.getByRole('button', { name: 'Transferir', exact: true }).click()
    await expect(page.getByText('2 cliente(s) transferido(s).')).toBeVisible()
    expect(transferencias).toHaveLength(1)
    expect(transferencias[0]).toEqual({
      p_cliente_ids: ['d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'],
      p_novo_corretor_id: C2,
      p_motivo: 'Redistribuição da carteira',
    })
  })

  test('imobiliária troca o corretor de gerente e inativa com destino obrigatório', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000011', 'ia@e2e.test', 'imobiliaria', {
      nome: 'IA Usuária', extra: { parceiro_id: IA, imobiliaria_id: IMOB },
    })
    await simularParceiros(page)
    await simularRpc(page, 'rede_parceiro_detalhe', detalhe())
    const trocas = await simularRpc(page, 'rede_transferir_corretor', null)
    const inativacoes = await simularRpc(page, 'rede_inativar_parceiro', null)

    await page.goto(`/parceiros/painel/equipe/${C1}`)
    await page.getByRole('button', { name: 'Trocar de gerente' }).click()
    let janela = page.getByRole('dialog', { name: /Trocar CA1a Corretor de gerente/ })
    await expect(janela.getByLabel('Novo gerente').locator('option', { hasText: 'GA1 Gerente' })).toHaveCount(0)
    await janela.getByLabel('Novo gerente').selectOption(G2)
    await janela.getByLabel('Motivo').fill('Reorganização da equipe')
    await janela.getByRole('button', { name: 'Transferir', exact: true }).click()
    await expect(page.getByText('Corretor transferido. Os clientes acompanham o novo gerente.')).toBeVisible()
    expect(trocas[0]).toEqual({ p_corretor_id: C1, p_novo_gerente_id: G2, p_motivo: 'Reorganização da equipe' })

    await page.getByRole('button', { name: 'Inativar' }).click()
    janela = page.getByRole('dialog', { name: /Inativar CA1a Corretor/ })
    await janela.getByLabel('Motivo').fill('Desligado da imobiliária')
    await janela.getByRole('button', { name: 'Inativar', exact: true }).click()
    await expect(janela.getByText('Escolha o destino')).toBeVisible()
    expect(inativacoes).toHaveLength(0)
    // destino: outro corretor da mesma imobiliária ou o gerente dele (nunca outro gerente nem o próprio)
    const destino = janela.getByLabel('Destino da carteira')
    await expect(destino.locator('option', { hasText: 'GA2 Gerente' })).toHaveCount(0)
    await expect(destino.locator('option', { hasText: 'CA1a Corretor' })).toHaveCount(0)
    await destino.selectOption(C2)
    await janela.getByRole('button', { name: 'Inativar', exact: true }).click()
    await expect(page.getByText('Parceiro inativado. O acesso foi encerrado.')).toBeVisible()
    expect(inativacoes[0]).toEqual({ p_id: C1, p_destino_id: C2, p_motivo: 'Desligado da imobiliária' })
  })

  test('convite: definir-senha só consome o token no clique em "Continuar"', async ({ page }) => {
    await isolarRede(page)
    const id = 'a0000000-0000-4000-8000-0000000000e1'
    const verificacoes: Record<string, unknown>[] = []
    const senhas: Record<string, unknown>[] = []
    await page.route('**/auth/v1/verify**', async (r) => {
      verificacoes.push(r.request().postDataJSON())
      await r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ access_token: jwtFalso(id, 'ga3@e2e.test'), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: usuario(id, 'ga3@e2e.test') }),
      })
    })
    await page.route('**/auth/v1/user**', async (r) => {
      if (r.request().method() === 'PUT') senhas.push(r.request().postDataJSON())
      await r.fulfill({ contentType: 'application/json', body: JSON.stringify(usuario(id, 'ga3@e2e.test')) })
    })
    await page.route('**/rest/v1/profiles**', (r) => responderRest(r, [{ id, papel: 'gerente', nome: 'GA3 Gerente', email: 'ga3@e2e.test', status_parceiro: 'aprovado', created_at: '2026-09-01T00:00:00Z' }]))
    await simularEscopo(page, 'gerente', { nome: 'GA3 Gerente', extra: { profile_id: id } })

    const hash = 'a'.repeat(56)
    await page.goto(`/parceiros/definir-senha?token_hash=${hash}&type=invite`)
    await expect(page.getByRole('heading', { name: 'Ative seu acesso' })).toBeVisible()
    // abrir a página (pré-visualização do WhatsApp, antivírus de e-mail) não gasta o convite
    await page.waitForTimeout(500)
    expect(verificacoes).toHaveLength(0)

    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('heading', { name: 'Crie sua senha' })).toBeVisible()
    expect(verificacoes).toHaveLength(1)
    expect(verificacoes[0]).toMatchObject({ token_hash: hash, type: 'invite' })
    expect(page.url()).not.toContain('token_hash')

    await page.getByLabel('Nova senha').fill('senha1234')
    await page.getByLabel('Repita a senha').fill('senha12345')
    await page.getByRole('button', { name: 'Salvar senha' }).click()
    await expect(page.getByText('As senhas não conferem.')).toBeVisible()
    await page.getByLabel('Repita a senha').fill('senha1234')
    await page.getByRole('button', { name: 'Salvar senha' }).click()
    await expect(page).toHaveURL(/\/parceiros(\/painel)?$/)
    expect(senhas[0]).toMatchObject({ password: 'senha1234' })
  })

  test('convite expirado mostra o caminho de volta, sem pedir senha', async ({ page }) => {
    await isolarRede(page)
    await page.route('**/auth/v1/verify**', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }) }))
    await page.goto(`/parceiros/definir-senha?token_hash=${'b'.repeat(56)}&type=invite`)
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('heading', { name: 'Link expirado' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Esqueci a senha' })).toBeVisible()

    await page.goto('/parceiros/definir-senha?type=invite')
    await expect(page.getByRole('heading', { name: 'Link inválido' })).toBeVisible()
  })

  test('cadastro espontâneo exige CPF e CRECI e envia o termo vigente (N8)', async ({ page }) => {
    await isolarRede(page)
    await simularTurnstile(page)
    await simularRpc(page, 'lgpd_termo_vigente', { id: TERMO, tipo: 'termos_parceiro', versao: '1.0', texto: 'Texto dos termos do parceiro para o teste.', vigente_desde: '2026-09-01T00:00:00Z', revisado_juridico: true })
    let corpo: { email?: string; data?: Record<string, unknown> } = {}
    await page.route('**/auth/v1/signup**', async (r) => {
      corpo = r.request().postDataJSON()
      await r.fulfill({ contentType: 'application/json', body: JSON.stringify(usuario('22222222-2222-2222-2222-222222222222', 'corretor@e2e.com')) })
    })
    await page.goto('/parceiros/cadastro')
    // o Turnstile (simulado) monta e entrega o token antes: o botão só habilita com ele
    await expect(page.getByRole('button', { name: 'Criar cadastro' })).toBeEnabled()
    await expect(page.getByText('(versão 1.0)')).toBeVisible()
    await page.getByLabel('Nome completo').fill('Corretor Autônomo')
    await page.getByLabel('E-mail').fill('Corretor@E2E.com')
    await page.getByLabel('Telefone / WhatsApp').fill('11977776666')
    await page.getByLabel('Senha').fill('senha-de-teste-e2e')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Criar cadastro' }).click()
    await expect(page.getByText('CPF inválido')).toBeVisible()
    await expect(page.getByText('Informe seu CRECI')).toBeVisible()
    await page.getByLabel('CPF').fill('12345678900')
    await page.getByLabel('CRECI').fill('123456-F')
    await page.getByRole('button', { name: 'Criar cadastro' }).click()
    await expect(page.getByText('CPF inválido')).toBeVisible()
    await page.getByLabel('CPF').fill('52998224725')
    await expect(page.getByLabel('CPF')).toHaveValue('529.982.247-25')
    await expect(page.getByText('(versão 1.0)')).toBeVisible()
    await page.getByRole('button', { name: 'Criar cadastro' }).click()
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible()
    expect(corpo.email).toBe('corretor@e2e.com')
    expect(corpo.data).toMatchObject({ nome: 'Corretor Autônomo', cpf: '52998224725', creci: '123456-F', termo_id: TERMO })
    expect(corpo.data).not.toHaveProperty('papel')
  })

  test('admin: /admin/parceiros leva à Rede e o convite em lote por link devolve o link e os bloqueios', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000001', 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
    await page.route('**/rest/v1/profiles**', (r) =>
      new URL(r.request().url()).searchParams.get('status_parceiro') === 'eq.pendente'
        ? responderRest(r, [])
        : responderRest(r, [{ id: 'a0000000-0000-4000-8000-000000000001', papel: 'admin', nome: 'Admin E2E', email: 'admin@e2e.test', status_parceiro: 'aprovado', created_at: '2026-09-01T00:00:00Z' }]))
    await simularParceiros(page)
    await page.route('**/rest/v1/imobiliarias**', (r) => responderRest(r, [{ id: IMOB, nome: 'Imobiliária A', da_casa: false, cnpj: '11222333000181', creci_pj: 'J-1', cidade: 'São Paulo', uf: 'SP', inativado_em: null }]))
    const pedidos: Record<string, unknown>[] = []
    await page.route('**/functions/v1/convidar-parceiros', async (r) => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204 })
      pedidos.push(r.request().postDataJSON())
      await r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ resultados: [
          { parceiro_id: C2, nome: 'CA1b Corretor', email: 'ca1b.corretor@e2e.test', status: 'convidado', mensagem: 'Link gerado: vale 24 h e só pode ser usado uma vez.', link: 'http://localhost/parceiros/definir-senha?token_hash=abc&type=invite' },
          { parceiro_id: C3, nome: 'CA2a Corretor', email: 'ca2a.corretor@e2e.test', status: 'email_em_uso', mensagem: 'Este e-mail já tem uma conta na plataforma: nenhum convite foi gerado. Confira o e-mail cadastrado ou fale com a equipe Arken.' },
        ] }),
      })
    })

    await page.goto('/admin/parceiros')
    await expect(page).toHaveURL(/\/admin\/rede$/)
    await expect(page.getByRole('heading', { name: 'Rede', level: 1 })).toBeVisible()
    await page.getByLabel('Selecionar CA1b Corretor').check()
    await page.getByLabel('Selecionar CA2a Corretor').check()
    await page.getByRole('button', { name: 'Convidar (2)' }).click()
    await page.getByLabel(/Gerar link \(WhatsApp\)/).check()
    await page.getByRole('button', { name: 'Gerar links' }).click()
    await expect(page.getByText('E-mail já tem conta')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copiar link' })).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute('href', /wa\.me\/5511988887777/)
    expect(pedidos[0]).toMatchObject({ parceiro_ids: [C2, C3], modo: 'link' })
    expect(String(pedidos[0].origem)).toMatch(/^http:\/\/localhost:\d+$/)
  })

  test('admin aprova autocadastro na cadeia da casa, com o CPF declarado', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000001', 'admin@e2e.test', 'admin', { nome: 'Admin E2E' })
    const pendente = { id: 'a0000000-0000-4000-8000-000000000043', nome: 'Pendente Autônomo', email: 'pendente@e2e.test', telefone: '11955554444', creci: '999-F', imobiliaria: 'Imob antiga', created_at: '2026-09-20T10:00:00Z', vinculo: null }
    await page.route('**/rest/v1/profiles**', (r) =>
      new URL(r.request().url()).searchParams.get('status_parceiro') === 'eq.pendente'
        ? responderRest(r, [pendente])
        : responderRest(r, [{ id: 'a0000000-0000-4000-8000-000000000001', papel: 'admin', nome: 'Admin E2E', email: 'admin@e2e.test', status_parceiro: 'aprovado', created_at: '2026-09-01T00:00:00Z' }]))
    await simularParceiros(page)
    const aprovacoes = await simularRpc(page, 'rede_aprovar_autocadastro', 'c0000000-0000-4000-8000-0000000000aa')
    const recusas = await simularRpc(page, 'rede_recusar_autocadastro', erroRpc('P0001', 'MOTIVO_OBRIGATORIO'))

    await page.goto('/admin/rede/pendentes')
    await expect(page.getByRole('cell', { name: 'Pendente Autônomo' })).toBeVisible()
    await page.getByRole('button', { name: 'Recusar' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill('CRECI não confere')
    await page.getByRole('dialog').getByRole('button', { name: 'Recusar' }).click()
    await expect(page.getByText('Informe o motivo.')).toBeVisible()
    expect(recusas[0]).toEqual({ p_profile_id: pendente.id, p_motivo: 'CRECI não confere' })
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()

    await page.getByRole('button', { name: 'Aprovar' }).click()
    const janela = page.getByRole('dialog', { name: /Aprovar Pendente Autônomo/ })
    await expect(janela.getByLabel('CRECI')).toHaveValue('999-F')
    await expect(janela.getByLabel('Gerente (cadeia)')).toHaveValue('')
    await janela.getByRole('button', { name: 'Aprovar', exact: true }).click()
    await expect(page.getByText('Pendente Autônomo aprovado como corretor.')).toBeVisible()
    expect(aprovacoes[0]).toEqual({
      p_profile_id: pendente.id, p_gerente_id: null,
      p_dados: { cpf: '', creci: '999-F', nome: 'Pendente Autônomo', telefone: '11955554444' },
    })
  })

  test('termo pendente: o painel só abre Meu cadastro, que registra o aceite', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000014', 'ca1a@e2e.test', 'corretor', {
      nome: 'CA1a Corretor', extra: { parceiro_id: C1, imobiliaria_id: IMOB, gerente_id: G1, pendencias: ['termo'] },
    })
    await simularRpc(page, 'lgpd_termo_vigente', { id: TERMO, tipo: 'termos_parceiro', versao: '2.0', texto: 'Novos termos do parceiro, versão dois.', vigente_desde: '2026-09-25T00:00:00Z', revisado_juridico: true })
    await simularRpc(page, 'rede_parceiro_detalhe', detalhe())
    const aceites = await simularRpc(page, 'lgpd_aceitar_termo', null)

    await page.goto('/parceiros/painel')
    await expect(page.getByRole('heading', { name: 'Aceite os termos atualizados' })).toBeVisible()
    await page.getByRole('link', { name: 'Ir para Meu cadastro' }).first().click()
    await expect(page.getByText('Novos termos do parceiro, versão dois.')).toBeVisible()
    const aceitar = page.getByRole('button', { name: 'Aceitar os termos' })
    await expect(aceitar).toBeDisabled()
    await page.getByLabel(/Li e aceito os termos/).check()
    await aceitar.click()
    await expect(page.getByText('Termos aceitos. Obrigado!')).toBeVisible()
    expect(aceites[0]).toEqual({ p_termo_id: TERMO })
    // os dados do próprio cadastro saem da RPC auditada, com CPF mascarado
    await expect(page.getByText('123.456.703-20')).toBeVisible()
  })

  test('transferir clientes: carteira maior que uma página mostra o total, carrega o resto e transfere tudo (WP1R-06)', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000012', 'ga1@e2e.test', 'gerente', {
      nome: 'GA1 Gerente', extra: { parceiro_id: G1, gerente_id: G1, imobiliaria_id: IMOB },
    })
    await simularParceiros(page)
    await simularRpc(page, 'rede_parceiro_detalhe', detalhe({ clientes_ativos: 201 }))
    const carteira = Array.from({ length: 201 }, (_, i) => ({
      id: `d0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, nome: `Cliente ${String(i + 1).padStart(3, '0')}`, sobrenome: null, etapa: 'novo_contato',
    }))
    const listagens = await simularRpc(page, 'crm_listar', (a) => {
      const inicio = Number(a.p_offset ?? 0)
      return { total: carteira.length, itens: carteira.slice(inicio, inicio + Number(a.p_limite)) }
    })
    const transferencias = await simularRpc(page, 'rede_transferir_clientes', (a) => (a.p_cliente_ids as string[]).length)

    await page.goto(`/parceiros/painel/equipe/${C1}`)
    await page.getByRole('button', { name: 'Transferir clientes' }).click()
    const janela = page.getByRole('dialog', { name: /Transferir clientes/ })
    await expect(janela.getByLabel('Todos os 200 carregados (de 201)')).toBeVisible()
    await expect(janela.getByText('Mostrando 200 de 201 clientes')).toBeVisible()
    await janela.getByRole('button', { name: 'Carregar mais (1 restante(s))' }).click()
    await expect(janela.getByLabel('Todos (201)')).toBeVisible()
    await expect(janela.getByText('Mostrando 200 de 201 clientes')).toHaveCount(0)
    await janela.getByLabel('Todos (201)').check()
    await expect(janela.getByText('201 selecionado(s).')).toBeVisible()
    await janela.getByLabel('Novo responsável').selectOption(C2)
    await janela.getByLabel('Motivo').fill('Redistribuição da carteira')
    await janela.getByRole('button', { name: 'Transferir', exact: true }).click()
    await expect(page.getByText('201 cliente(s) transferido(s).')).toBeVisible()
    expect(listagens.slice(0, 2).map((a) => a.p_offset)).toEqual([0, 200])
    expect(transferencias).toHaveLength(1)
    expect(transferencias[0].p_cliente_ids).toEqual(carteira.map((c) => c.id))
  })

  test('cadastro por parceiro: CPF de outro parceiro volta nulo e aparece como indisponível (WP1R-04)', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000012', 'ga1@e2e.test', 'gerente', {
      nome: 'GA1 Gerente', extra: { parceiro_id: G1, gerente_id: G1, imobiliaria_id: IMOB },
    })
    await simularParceiros(page)
    const cadastros = await simularRpc(page, 'rede_cadastrar_parceiro', null)

    await page.goto('/parceiros/painel/equipe')
    await page.getByRole('button', { name: 'Novo corretor' }).click()
    const janela = page.getByRole('dialog', { name: 'Novo parceiro' })
    await janela.getByLabel('Nome completo').fill('Pedro Sonda')
    await janela.getByLabel('CPF').fill('123.456.703-20')
    await janela.getByLabel('CRECI (PF)').fill('CRECI-1')
    await janela.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText(/Este documento não está disponível para cadastro/)).toBeVisible()
    await expect(janela.getByText('CPF indisponível para cadastro.')).toBeVisible()
    await expect(page.getByText(/cadastrado. Agora envie o convite/)).toHaveCount(0)
    expect(cadastros).toHaveLength(1)
    expect(cadastros[0]).toMatchObject({ p_tipo: 'corretor', p_gerente_id: G1, p_dados: { cpf: '12345670320' } })
  })

  test('Meu cadastro: CPF que já é de outro parceiro não fica gravado e aparece como indisponível (WP1R-04)', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000014', 'ca1a@e2e.test', 'corretor', {
      nome: 'CA1a Corretor', extra: { parceiro_id: C1, imobiliaria_id: IMOB, gerente_id: G1, pendencias: ['cpf'] },
    })
    // a RPC termina sem erro (a tentativa fica na auditoria) e o detalhe relido continua sem CPF
    const leituras = await simularRpc(page, 'rede_parceiro_detalhe', detalhe({ cpf: null, migrado_legado: true }))
    const atualizacoes = await simularRpc(page, 'rede_atualizar_meu_cadastro', null)

    await page.goto('/parceiros/painel/meu-cadastro')
    await expect(page.getByText('Complete seu cadastro')).toBeVisible()
    const antes = leituras.length
    await page.getByRole('button', { name: 'Atualizar' }).click()
    const janela = page.getByRole('dialog', { name: 'Atualizar meu cadastro' })
    await janela.getByLabel('CPF').fill('123.456.703-20')
    await janela.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText(/Este documento não está disponível para cadastro/)).toBeVisible()
    await expect(janela.getByText('CPF indisponível para cadastro.')).toBeVisible()
    await expect(page.getByText('Cadastro atualizado.')).toHaveCount(0)
    expect(atualizacoes).toEqual([{ p_dados: { cpf: '12345670320' } }])
    expect(leituras.length).toBeGreaterThan(antes)
  })

  test('corretor não vê a Equipe (menu e rota)', async ({ page }) => {
    await isolarRede(page)
    await entrarComo(page, 'a0000000-0000-4000-8000-000000000014', 'ca1a@e2e.test', 'corretor', { nome: 'CA1a Corretor' })
    await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, []))
    await page.goto('/parceiros/painel/equipe')
    await expect(page.getByRole('heading', { name: 'Sem acesso a esta área' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Equipe' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Meu cadastro' })).toBeVisible()
  })
})
