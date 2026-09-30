import { expect, test, type Page, type Response } from '@playwright/test'
import sharp from 'sharp'
import {
  cnpj, cpf, entrar, ESPERA, escolherOpcao, ESTADO, irPara, isolar, novaPessoa, pdfMinimo, SENHA, SUFIXO,
} from './apoio'

// Fluxos principais contra a stack Supabase LOCAL completa, SEM simular rede: Auth (GoTrue + hook), PostgREST, Storage
// e Edge Functions de verdade. Cada execução cria a própria rede (sufixo único). Rodar pelo verificar.sh (etapa e2e).
test.describe.configure({ mode: 'serial' })

const IMOB = `Imobiliária Real ${SUFIXO}`
const GERENTE = `Gerente Real ${SUFIXO}`
const CORRETOR = `Corretor Real ${SUFIXO}`
const CORRETORA = `Corretora Real ${SUFIXO}`
const semente = Number(String(Date.now()).slice(-7))
const email = (quem: string) => `${quem}-${SUFIXO}@arken-stack.test`

/** Estado compartilhado entre os passos (a ordem é fixa: modo serial). */
const rede: Record<string, { parceiro: string; email: string; link?: string }> = {}
const cliente = { nome: 'Helena', sobrenome: `Real ${SUFIXO}`, cpf: cpf(semente + 11), id: '' }
const cliente2 = { nome: 'Otávio', sobrenome: `Real ${SUFIXO}`, cpf: cpf(semente + 12), id: '' }
let imovelId = ''

/** Rótulo exato de campo, com ou sem o " *" de obrigatório (evita casar "Cidade" com "…Privacidade…"). */
const rotulo = (texto: string) => new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*)?$`)

const idDaUrl = (page: Page) => page.url().split('?')[0].split('/').pop() ?? ''

test('admin cadastra imobiliária, gerente e dois corretores e gera os convites por link (Edge convidar-parceiros)', async ({ page }) => {
  const guarda = await isolar(page)
  await entrar(page, ESTADO.admin.email)

  // imobiliária
  await irPara(page, '/admin/rede?aba=imobiliarias', () => page.getByRole('button', { name: 'Nova imobiliária' }))
  await page.getByRole('button', { name: 'Nova imobiliária' }).click()
  let janela = page.getByRole('dialog')
  await janela.getByLabel(/^Nome/).fill(IMOB)
  await janela.getByLabel(rotulo('Razão social')).fill(`${IMOB} Ltda`)
  await janela.getByLabel(rotulo('CNPJ')).fill(cnpj(semente))
  await janela.getByLabel(rotulo('CRECI PJ')).fill(`J-${SUFIXO}`)
  await janela.getByLabel(rotulo('E-mail')).fill(email('imob'))
  await janela.getByLabel(rotulo('Telefone')).fill('41999990000')
  await janela.getByLabel(rotulo('Cidade')).fill('Curitiba')
  await janela.getByLabel(/^UF/).selectOption('PR')
  await janela.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Imobiliária cadastrada.')).toBeVisible(ESPERA)

  // gerente e corretores
  const novoParceiro = async (tipo: 'gerente' | 'corretor', nome: string, quem: string, fone: string) => {
    await irPara(page, '/admin/rede', () => page.getByRole('button', { name: 'Novo parceiro' }))
    await page.getByRole('button', { name: 'Novo parceiro' }).click()
    janela = page.getByRole('dialog')
    await janela.getByLabel(/^Tipo/).selectOption(tipo)
    if (tipo === 'gerente') await escolherOpcao(janela.getByLabel(/^Imobiliária/), IMOB)
    else await escolherOpcao(janela.getByLabel(/^Gerente/), GERENTE)
    await janela.getByLabel(rotulo('Nome completo')).fill(nome)
    await janela.getByLabel(rotulo('CPF')).fill(cpf(semente + fone.length + Number(fone.slice(-2))))
    if (tipo === 'corretor') await janela.getByLabel(rotulo('CRECI (PF)')).fill(`F-${SUFIXO}-${quem}`)
    await janela.getByLabel(rotulo('E-mail (login)')).fill(email(quem))
    await janela.getByLabel(rotulo('Telefone / WhatsApp')).fill(fone)
    await janela.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText(/cadastrado\. Agora envie o convite para o acesso\./)).toBeVisible(ESPERA)
    rede[quem] = { parceiro: '', email: email(quem) }
  }
  await novoParceiro('gerente', GERENTE, 'gerente', '41988880001')
  await novoParceiro('corretor', CORRETOR, 'corretor', '41977770002')
  await novoParceiro('corretor', CORRETORA, 'corretora', '41966660003')

  // convite em lote por link
  await irPara(page, `/admin/rede?busca=${encodeURIComponent(SUFIXO)}`, () => page.getByLabel(`Selecionar ${GERENTE}`))
  for (const nome of [GERENTE, CORRETOR, CORRETORA]) await page.getByLabel(`Selecionar ${nome}`).check()
  await page.getByRole('button', { name: 'Convidar (3)' }).click()
  await page.getByLabel(/Gerar link \(WhatsApp\)/).check()
  const resposta: Promise<Response> = page.waitForResponse((r) => r.url().includes('/functions/v1/convidar-parceiros') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Gerar links' }).click()
  const corpo = await (await resposta).json() as { resultados: { parceiro_id: string; nome: string; status: string; link?: string }[] }
  expect(corpo.resultados.map((r) => r.status)).toEqual(['convidado', 'convidado', 'convidado'])
  for (const r of corpo.resultados) {
    const quem = r.nome === GERENTE ? 'gerente' : r.nome === CORRETOR ? 'corretor' : 'corretora'
    rede[quem].parceiro = r.parceiro_id
    rede[quem].link = r.link
    expect(r.link).toMatch(/\/parceiros\/definir-senha\?token_hash=[0-9a-f]+&type=invite$/)
  }
  await expect(page.getByRole('button', { name: 'Copiar link' })).toHaveCount(3)
  await expect(page.getByRole('link', { name: 'Enviar pelo WhatsApp' }).first()).toHaveAttribute('href', /wa\.me\/55/)
  guarda.conferir()
})

test('cada convidado abre o link, o token só é consumido no clique em "Continuar", e define a senha', async ({ browser, baseURL }) => {
  for (const quem of ['gerente', 'corretor', 'corretora']) {
    const p = await novaPessoa(browser, baseURL)
    const verificacoes: string[] = []
    p.page.on('request', (req) => { if (req.url().includes('/auth/v1/verify')) verificacoes.push(req.url()) })
    const link = new URL(rede[quem].link!)
    await irPara(p.page, `${link.pathname}${link.search}`, () => p.page.getByRole('heading', { name: 'Ative seu acesso' }))
    await p.page.waitForTimeout(1500)
    expect(verificacoes, 'abrir a página não consome o token').toEqual([])
    await p.page.getByRole('button', { name: 'Continuar' }).click()
    await expect(p.page.getByRole('heading', { name: 'Crie sua senha' })).toBeVisible(ESPERA)
    expect(verificacoes.length).toBe(1)
    await p.page.getByLabel(rotulo('Nova senha')).fill(SENHA)
    await p.page.getByLabel(rotulo('Repita a senha')).fill(SENHA)
    await p.page.getByRole('button', { name: 'Salvar senha' }).click()
    await p.page.waitForURL(/\/parceiros\/painel/, ESPERA)
    // primeiro acesso: o painel só abre depois do aceite dos termos vigentes do parceiro (lgpd_aceitar_termo)
    await expect(p.page.getByRole('heading', { name: 'Aceite os termos atualizados' })).toBeVisible(ESPERA)
    await p.page.getByRole('link', { name: 'Ir para Meu cadastro' }).first().click()
    await p.page.getByLabel(/Li e aceito os termos/).check()
    await p.page.getByRole('button', { name: 'Aceitar os termos' }).click()
    await expect(p.page.getByText('Termos aceitos. Obrigado!')).toBeVisible(ESPERA)
    p.guarda.conferir()
    await p.fechar()
  }
})

test('corretor cadastra dois clientes, move no kanban até Documentação e envia documento pela Storage API', async ({ page }) => {
  const guarda = await isolar(page)
  await entrar(page, rede.corretor.email)

  for (const c of [cliente, cliente2]) {
    await irPara(page, '/parceiros/painel/crm/novo', () => page.getByRole('button', { name: 'Cadastrar cliente' }))
    await page.getByLabel(rotulo('CEP')).fill('80010000') // pode disparar o ViaCEP de verdade: os campos abaixo sobrescrevem
    await page.waitForTimeout(1500)
    await page.getByLabel(/^Nome/).fill(c.nome)
    await page.getByLabel(rotulo('Sobrenome')).fill(c.sobrenome)
    await page.getByLabel(rotulo('CPF')).fill(c.cpf)
    await page.getByLabel(rotulo('RG')).fill('12345678')
    await page.getByLabel(rotulo('Data de nascimento')).fill('1988-03-15')
    await page.getByLabel(/^Gênero/).selectOption('feminino')
    await page.getByLabel(/^Estado civil/).selectOption('casado')
    await page.getByLabel(rotulo('Nacionalidade')).fill('brasileira')
    await page.getByLabel(rotulo('Telefone / WhatsApp')).fill('41991230000')
    await page.getByLabel('E-mail', { exact: true }).fill(email(c.nome.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')))
    await page.getByLabel(rotulo('Logradouro')).fill('Rua das Flores')
    await page.getByLabel(rotulo('Número')).fill('100')
    await page.getByLabel(rotulo('Complemento')).fill('Ap 12')
    await page.getByLabel(rotulo('Bairro')).fill('Centro')
    await page.getByLabel(rotulo('Cidade')).fill('Curitiba')
    await page.getByLabel(/^UF/).selectOption('PR')
    await page.getByLabel(rotulo('País')).fill('Brasil')
    await page.getByRole('checkbox', { name: /Declaro que o cliente consentiu/ }).check()
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByRole('heading', { name: `${c.nome} ${c.sobrenome}` })).toBeVisible(ESPERA)
    c.id = idDaUrl(page)
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/)
  }

  // kanban: NC → CI pelo menu acessível; CI → Documentação pede confirmação e cria os documentos básicos
  await irPara(page, '/parceiros/painel/crm', () => page.getByLabel(rotulo('Contadores do funil')))
  const nome = `${cliente.nome} ${cliente.sobrenome}`
  const cartao = (etapa: string) => page.locator(`section[data-etapa="${etapa}"]`).getByRole('article', { name: new RegExp(nome) })
  await cartao('novo_contato').getByLabel(`Mover ${nome} para…`).selectOption('contato_iniciado')
  await expect(cartao('contato_iniciado')).toBeVisible(ESPERA)
  await cartao('contato_iniciado').getByLabel(`Mover ${nome} para…`).selectOption('documentacao')
  const modal = page.getByRole('dialog', { name: `Mover ${nome} para Documentação` })
  await modal.getByRole('button', { name: 'Mover e solicitar' }).click()
  await expect(cartao('documentacao')).toBeVisible(ESPERA)

  // documentos: solicita um a mais e envia o arquivo do CPF em nome do cliente
  await irPara(page, `/parceiros/painel/crm/${cliente.id}?aba=documentos`, () => page.getByRole('button', { name: 'Solicitar documento' }))
  await page.getByRole('button', { name: 'Solicitar documento' }).click()
  const sol = page.getByRole('dialog', { name: 'Solicitar documento' })
  await sol.getByLabel(/^Documento/).fill('Holerite')
  await sol.getByRole('button', { name: 'Solicitar' }).click()
  await expect(page.getByRole('listitem', { name: 'Holerite' })).toBeVisible(ESPERA)
  const doc = page.getByRole('listitem', { name: 'CPF' })
  await doc.getByLabel(rotulo('Arquivo para CPF')).setInputFiles({ name: 'cpf.pdf', mimeType: 'application/pdf', buffer: pdfMinimo(`CPF ${SUFIXO}`) })
  await expect(page.getByText('CPF: arquivo enviado para análise.')).toBeVisible(ESPERA)
  await expect(doc).toContainText(/Em análise/i, ESPERA)
  guarda.conferir()
})

test('gerente transfere o segundo cliente do corretor para a corretora da equipe', async ({ page }) => {
  const guarda = await isolar(page)
  await entrar(page, rede.gerente.email)
  await irPara(page, `/parceiros/painel/equipe/${rede.corretor.parceiro}`, () => page.getByRole('heading', { name: CORRETOR }))
  await page.getByRole('button', { name: 'Transferir clientes' }).click()
  const janela = page.getByRole('dialog', { name: /Transferir clientes/ })
  await janela.getByLabel(new RegExp(`${cliente2.nome} ${cliente2.sobrenome}`)).check()
  await escolherOpcao(janela.getByLabel(/^Novo responsável/), CORRETORA)
  await janela.getByLabel(rotulo('Motivo')).fill('Redistribuição da carteira (E2E real)')
  await janela.getByRole('button', { name: 'Transferir', exact: true }).click()
  await expect(page.getByText('1 cliente(s) transferido(s).')).toBeVisible(ESPERA)
  guarda.conferir()

  // a corretora vê o cliente; o corretor não
  const corretora = await novaPessoa(page.context().browser()!, test.info().project.use.baseURL)
  await entrar(corretora.page, rede.corretora.email)
  await irPara(corretora.page, `/parceiros/painel/crm/${cliente2.id}`, () => corretora.page.getByRole('heading', { name: `${cliente2.nome} ${cliente2.sobrenome}` }))
  corretora.guarda.conferir()
  await corretora.fechar()
})

test('imóvel: corretor cadastra com foto (Storage) e finaliza (RA→PE); admin revisa e aprova (PE→RE→AP); a corretora vê a foto', async ({ page, browser, baseURL }) => {
  const guarda = await isolar(page)
  await entrar(page, rede.corretor.email)
  await irPara(page, '/parceiros/painel/imoveis/novo', () => page.getByRole('heading', { name: 'Cadastrar imóvel' }))
  const nomeImovel = `Casa Real ${SUFIXO}`
  await page.getByLabel(rotulo('Nome do imóvel')).fill(nomeImovel)
  await page.getByLabel(/^Tipo/).selectOption('casa')
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByRole('heading', { name: nomeImovel })).toBeVisible(ESPERA)
  imovelId = idDaUrl(page)

  await page.getByLabel(rotulo('CEP')).fill('80010000')
  await page.waitForTimeout(1500)
  await page.getByLabel(rotulo('Logradouro')).fill('Rua do Imóvel')
  await page.getByLabel(rotulo('Número')).fill('42')
  await page.getByLabel(rotulo('Bairro')).fill('Centro')
  await page.getByLabel(rotulo('Cidade')).fill('Curitiba')
  await page.getByLabel(/^Estado \(UF\)/).selectOption('PR')
  await page.getByRole('textbox', { name: rotulo('Valor') }).fill('48000000')
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByText(/salv/i).first()).toBeVisible(ESPERA)

  const foto = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#8a6d4b' } }).png().toBuffer()
  await page.getByTestId('entrada-fotos').setInputFiles({ name: 'fachada.png', mimeType: 'image/png', buffer: foto })
  const fotos = page.getByRole('list', { name: 'Fotos do imóvel' })
  await expect(fotos.getByRole('img').first()).toBeVisible(ESPERA)

  await page.getByRole('button', { name: 'Finalizar cadastro' }).click()
  await expect(page.getByRole('main').getByText('Pendente', { exact: true }).first()).toBeVisible(ESPERA)
  guarda.conferir()

  const admin = await novaPessoa(browser, baseURL)
  await entrar(admin.page, ESTADO.admin.email)
  await irPara(admin.page, `/admin/imoveis/${imovelId}`, () => admin.page.getByRole('heading', { name: nomeImovel }))
  await admin.page.getByRole('button', { name: 'Iniciar revisão' }).click()
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Iniciar revisão' }).click()
  await expect(admin.page.getByRole('button', { name: 'Aprovar' })).toBeVisible(ESPERA)
  await admin.page.getByRole('button', { name: 'Aprovar' }).click()
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Aprovar' }).click()
  await expect(admin.page.getByRole('main').getByText('Aprovado', { exact: true }).first()).toBeVisible(ESPERA)
  admin.guarda.conferir()
  await admin.fechar()

  const corretora = await novaPessoa(browser, baseURL)
  await entrar(corretora.page, rede.corretora.email)
  await irPara(corretora.page, `/parceiros/painel/imoveis/${imovelId}`, () => corretora.page.getByRole('heading', { name: nomeImovel }))
  const img = corretora.page.getByRole('list', { name: 'Fotos do imóvel' }).getByRole('img').first()
  await expect(img).toBeVisible(ESPERA)
  // a galeria usa loading="lazy": a foto só é baixada quando entra (ou chega perto) da janela; sem rolar até ela,
  // naturalWidth fica 0 mesmo com a URL assinada correta (a requisição da imagem nem sai)
  await img.scrollIntoViewIfNeeded()
  await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth), ESPERA).toBeGreaterThan(0)
  corretora.guarda.conferir()
  await corretora.fechar()
})

test('contrato: corretor cria pela ficha (unidade à venda) e gera o PDF (Edge contrato-gerar)', async ({ page }) => {
  const guarda = await isolar(page)
  await entrar(page, rede.corretor.email)
  await irPara(page, `/parceiros/painel/crm/${cliente.id}?aba=contratos`, () => page.getByRole('button', { name: 'Novo contrato' }))
  await page.getByRole('button', { name: 'Novo contrato' }).click()
  const modal = page.getByRole('dialog', { name: 'Novo contrato' })
  // unidade nova por execução (o verificar.sh cria e informa em STACK_UNIDADE): a de uma execução anterior já tem contrato
  // ativo (CONTRATO_ATIVO). Sem a variável, usa a unidade semeada STACK-05 (primeira execução numa stack recém-criada).
  const unidade = process.env.STACK_UNIDADE || 'STACK-05'
  await modal.getByLabel(rotulo('Buscar produto')).fill(unidade)
  await modal.getByRole('list', { name: 'Produtos disponíveis' }).getByRole('button', { name: new RegExp(unidade) }).click()
  await modal.getByLabel(rotulo('% de aporte próprio')).fill('30')
  await modal.getByRole('textbox', { name: rotulo('Entrada') }).fill('2000000')
  await modal.getByLabel(/^Número de parcelas/).fill('60') // o rótulo acessível traz a dica "Entre 12 e 360 parcelas."
  await modal.getByRole('button', { name: 'Criar contrato' }).click()
  await expect(page.getByRole('heading', { name: /Contrato #\d{7}/ })).toBeVisible(ESPERA)

  const geracao = page.waitForResponse((r) => r.url().includes('/functions/v1/contrato-gerar') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Gerar PDF' }).click()
  const r = await geracao
  expect(r.status()).toBe(200)
  expect(await r.json()).toMatchObject({ ok: true, versao: 1 })
  await expect(page.getByText('PDF gerado (versão 1).')).toBeVisible(ESPERA)
  await expect(page.getByText(/Versão 1 · gerada em/)).toBeVisible(ESPERA)
  guarda.conferir()
})

test('portal: admin libera o acesso e o cliente entra só com o CPF (Edge cliente-login)', async ({ page, browser, baseURL }) => {
  const guarda = await isolar(page)
  await entrar(page, ESTADO.admin.email)
  await irPara(page, `/admin/crm/${cliente.id}?aba=portal`, () => page.getByRole('heading', { name: 'Acesso ao portal' }))
  await page.getByRole('button', { name: 'Liberar acesso ao portal' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Liberar/ }).click()
  await expect(page.getByText('Liberado', { exact: true })).toBeVisible(ESPERA)
  guarda.conferir()

  const titular = await novaPessoa(browser, baseURL)
  await irPara(titular.page, '/portal-do-cliente', () => titular.page.getByLabel(rotulo('CPF')))
  await titular.page.getByLabel(rotulo('CPF')).fill(cliente.cpf)
  await titular.page.getByRole('button', { name: 'Entrar' }).click()
  await titular.page.waitForURL(/\/portal-do-cliente\/meus-imoveis/, ESPERA)
  await expect(titular.page.getByRole('heading', { name: `Bem-vindo(a), ${cliente.nome}` })).toBeVisible(ESPERA)
  const documentos = titular.page.getByRole('region', { name: /Documentos solicitados/ })
  await expect(documentos.getByText('Holerite', { exact: true })).toBeVisible(ESPERA)
  titular.guarda.conferir()
  await titular.fechar()
})
