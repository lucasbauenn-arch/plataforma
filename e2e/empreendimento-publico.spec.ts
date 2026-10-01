import { expect as expectBase, test } from '@playwright/test'
import { empreendimentoTeste, isolarSupabase, responderRest, simularTurnstile } from './apoio'

// Página pública do empreendimento: ícones do catálogo (lazer e proximidades) e os ícones antigos do WordPress
// (imagens vermelhas no Storage) pintados no bronze da marca por máscara, sem editar os arquivos.

test.describe.configure({ timeout: 120_000 })
const expect = expectBase.configure({ timeout: 40_000 })

const EMP = empreendimentoTeste.id
const BRONZE = 'rgb(194, 126, 74)'

function empreendimento() {
  return {
    ...empreendimentoTeste, chamada: null, tagline: null, titulo_hero: null, descricao: 'Descrição', titulo_lazer: null, descricao_lazer: null,
    endereco: 'Rua A', bairro: 'Tatuapé', cidade: 'São Paulo', uf: 'SP', cep: '03333050', titulo_localizacao: null, texto_localizacao: null,
    waze_url: null, latitude: null, longitude: null, dormitorios: null, vagas: null, metragem: null, categoria: null, construtora: null,
    total_unidades: null, previsao_entrega: null, tour_virtual_url: null,
    empreendimento_midias: [],
    empreendimento_ficha: [{ id: 'f1', empreendimento_id: EMP, titulo: 'Torres: 1', descricao: null, icone_url: 'wp/2025/09/2-3.webp', ordem: 0 }],
    empreendimento_lazer: [
      { id: 'l1', empreendimento_id: EMP, titulo: 'Piscina', descricao: null, icone: 'wp/2025/09/9.webp', icone_catalogo: 'piscina', imagem_url: null, ordem: 0 },
      { id: 'l2', empreendimento_id: EMP, titulo: 'Academia Equipada', descricao: null, icone: 'wp/2025/09/10.webp', icone_catalogo: null, imagem_url: null, ordem: 1 },
      { id: 'l3', empreendimento_id: EMP, titulo: 'Bicicletário', descricao: null, icone: null, icone_catalogo: null, imagem_url: null, ordem: 2 },
    ],
    empreendimento_proximidades: [
      { id: 'p1', empreendimento_id: EMP, nome: 'Estação Tatuapé', distancia: '800 m', tempo_pe: '10 min', tempo_carro: null, tempo_transporte: null, tempo_bike: null, foto_url: null, icone_catalogo: 'metro', ordem: 0 },
      { id: 'p2', empreendimento_id: EMP, nome: 'Praça', distancia: '200 m', tempo_pe: null, tempo_carro: null, tempo_transporte: null, tempo_bike: null, foto_url: null, icone_catalogo: null, ordem: 1 },
    ],
  }
}

test('ícones do lazer, da ficha e das proximidades no bronze da marca (catálogo ou imagem antiga por máscara)', async ({ page }) => {
  await isolarSupabase(page)
  await simularTurnstile(page)
  await page.route('**/rest/v1/empreendimentos**', (r) => responderRest(r, [empreendimento()]))
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))
  await page.goto(`/empreendimentos/${empreendimentoTeste.slug}`)
  await expect(page.getByRole('heading', { name: 'Residencial E2E', level: 1 })).toBeVisible()

  // o ícone do catálogo tem prioridade sobre a imagem antiga
  const piscina = page.locator('svg[data-icone-catalogo="piscina"]')
  await expect(piscina).toBeVisible()
  await expect(piscina).toHaveCSS('color', BRONZE)
  await expect(page.locator('[data-icone-tingido="wp/2025/09/9.webp"]')).toHaveCount(0)

  // imagens antigas (ficha e lazer sem chave): máscara + fundo bronze, nunca a <img> vermelha
  for (const caminho of ['wp/2025/09/2-3.webp', 'wp/2025/09/10.webp']) {
    const icone = page.locator(`[data-icone-tingido="${caminho}"]`)
    await expect(icone).toBeVisible()
    await expect(icone).toHaveCSS('background-color', BRONZE)
    expect(await icone.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)).toContain(caminho)
    await expect(page.locator(`img[src*="${caminho.split('/').pop()}"]`)).toHaveCount(0)
  }

  // proximidade com categoria mostra o ícone; sem categoria, só o nome
  await expect(page.locator('svg[data-icone-catalogo="metro"]')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Praça' })).toBeVisible()
  expect(erros).toEqual([])
})
