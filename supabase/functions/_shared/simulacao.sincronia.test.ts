// O SQL (public.calcular_simulacao) é a única fonte de verdade da simulação; o espelho TS só serve para a prévia.
// Os dois são testados contra os MESMOS vetores: este teste falha se o bloco "-- VETORES:INICIO … -- VETORES:FIM" do
// supabase/tests/contratos.test.sql divergir de simulacao.vetores.json (§1.3, §8.5).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import vetores from './simulacao.vetores.json' with { type: 'json' }

const TESTE_SQL = new URL('../../tests/contratos.test.sql', import.meta.url)

function vetoresDoSql(sql: string): unknown {
  const ini = sql.indexOf('-- VETORES:INICIO')
  const fim = sql.indexOf('-- VETORES:FIM')
  if (ini < 0 || fim < ini) throw new Error('bloco VETORES não encontrado em contratos.test.sql')
  const bloco = sql.slice(ini, fim)
  const partes = bloco.split('$vetores$')
  if (partes.length !== 3) throw new Error('o bloco VETORES precisa ter exatamente um literal $vetores$…$vetores$')
  return JSON.parse(partes[1])
}

describe('sincronia dos vetores de simulação (SQL × TS)', () => {
  const sql = readFileSync(TESTE_SQL, 'utf8')

  it('o bloco VETORES do contratos.test.sql é igual ao simulacao.vetores.json', () => {
    expect(vetoresDoSql(sql)).toEqual(vetores)
  })

  it('o pgTAP confere cada vetor (plano soma a quantidade de vetores)', () => {
    expect(sql).toContain('select plan(')
    expect(sql).toContain('(select count(*)::int from vetores)')
    expect(sql).toContain("pg_temp.simular_vetor(v.vetor -> 'entrada'), v.vetor -> 'esperado'")
  })

  it('o JSON não está vazio e cobre os vetores da §8.5', () => {
    const lista = vetores as { entrada: { valor: number | null; entrada: number | null } }[]
    expect(lista.length).toBeGreaterThanOrEqual(30)
    expect(lista.some((v) => v.entrada.valor === 500000 && v.entrada.entrada === 50000)).toBe(true)
    expect(lista.some((v) => v.entrada.valor === 300000 && v.entrada.entrada === 10000)).toBe(true)
  })
})
