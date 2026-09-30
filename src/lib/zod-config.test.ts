import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import './zod-config'
import principal from '../main.tsx?raw'

// A CSP do .htaccess (FR1-03) não tem 'unsafe-eval': o zod 4 sonda o eval para compilar o parser (JIT) e a sonda vira
// violação de CSP em toda página. O modo jitless pula a sonda, mas só vale para os schemas criados DEPOIS da configuração.
describe('zod sem JIT (CSP sem unsafe-eval)', () => {
  it('zod-config liga o modo jitless', () => {
    expect(z.config().jitless).toBe(true)
  })

  it('com jitless o parser de objeto funciona (sem new Function)', () => {
    const esquema = z.object({ nome: z.string().min(2), idade: z.number().int().optional() })
    expect(esquema.safeParse({ nome: 'Ana', idade: 30 }).success).toBe(true)
    expect(esquema.safeParse({ nome: 'A' }).success).toBe(false)
  })

  it('main.tsx importa zod-config ANTES de qualquer outro módulo', () => {
    const imports = principal.split('\n').filter((l) => /^import\b/.test(l))
    expect(imports[0]).toMatch(/^import '@\/lib\/zod-config'/)
  })
})
