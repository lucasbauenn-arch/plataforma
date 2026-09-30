// Modelos da função notificar (módulo puro). Roda no npm test (test.include cobre supabase/functions/**/*.test.ts).
import { describe, expect, it } from 'vitest'
import {
  codigoContrato, ehTipoFila, emailValido, esc, falhaDeConfiguracao, montarEmail, primeiroNome, TIPOS_FILA, URL_RESEND, urlResend,
} from './modelos'

const SITE = 'https://arkenincorporadora.com.br'

describe('modelos da fila de e-mails', () => {
  it('reconhece os 7 tipos semeados em notificacoes_config', () => {
    expect(TIPOS_FILA).toHaveLength(7)
    expect(ehTipoFila('crm.boas_vindas')).toBe(true)
    expect(ehTipoFila('crm.outro')).toBe(false)
    expect(ehTipoFila(null)).toBe(false)
  })

  it('escapa conteúdo variável (SEG-6)', () => {
    expect(esc('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;')
    const e = montarEmail('crm.documento_rejeitado', {
      site: SITE, publico: 'cliente', primeiroNome: '<script>', portalLiberado: false,
      documentos: [{ nome: 'CNH <img>', motivo: 'Foto <b>ilegível</b>' }],
    })
    expect(e?.html).not.toContain('<script>')
    expect(e?.html).not.toContain('<img>')
    expect(e?.html).toContain('Foto &lt;b&gt;ilegível&lt;/b&gt;')
  })

  it('documento rejeitado: link do portal só quando liberado', () => {
    const comPortal = montarEmail('crm.documento_rejeitado', { site: SITE, publico: 'cliente', portalLiberado: true, documentos: [{ nome: 'RG' }] })
    const semPortal = montarEmail('crm.documento_rejeitado', { site: SITE, publico: 'cliente', portalLiberado: false, documentos: [{ nome: 'RG' }] })
    expect(comPortal?.html).toContain(`${SITE}/portal-do-cliente`)
    expect(semPortal?.html).not.toContain('/portal-do-cliente')
    expect(semPortal?.assunto).toBe('Documento para reenviar: RG')
  })

  it('sem documento resolvido, não há e-mail de documento', () => {
    expect(montarEmail('crm.documento_rejeitado', { site: SITE, publico: 'cliente', documentos: [] })).toBeNull()
    expect(montarEmail('crm.documento_solicitado', { site: SITE, publico: 'cliente' })).toBeNull()
  })

  it('tipos para o cliente não vão para perfis e vice-versa', () => {
    expect(montarEmail('crm.boas_vindas', { site: SITE, publico: 'painel' })).toBeNull()
    expect(montarEmail('crm.novo_lead_corretor', { site: SITE, publico: 'cliente' })).toBeNull()
    expect(montarEmail('rede.transferencia', { site: SITE, publico: 'cliente' })).toBeNull()
  })

  it('novo cliente para o corretor: sem o nome do cliente, com o link da ficha na área certa', () => {
    const id = 'd0000000-0000-4000-8000-000000000001'
    const painel = montarEmail('crm.novo_lead_corretor', { site: SITE, publico: 'painel', primeiroNome: 'Ana', clienteId: id })
    const admin = montarEmail('crm.novo_lead_corretor', { site: SITE, publico: 'admin', clienteId: id })
    expect(painel?.html).toContain(`${SITE}/parceiros/painel/crm/${id}`)
    expect(admin?.html).toContain(`${SITE}/admin/crm/${id}`)
    expect(painel?.html).toContain('Olá, Ana!')
  })

  it('contratos: código com 7 dígitos e texto por público', () => {
    expect(codigoContrato(123)).toBe('#0000123')
    const cli = montarEmail('contratos.enviado', { site: SITE, publico: 'cliente', contratoCodigo: 123, contratoId: 'x' })
    expect(cli?.assunto).toBe('Contrato #0000123 enviado para assinatura')
    expect(cli?.html).not.toContain('/contratos/')
    const par = montarEmail('contratos.assinado', { site: SITE, publico: 'painel', contratoCodigo: 5, contratoId: 'k1' })
    expect(par?.html).toContain(`${SITE}/parceiros/painel/contratos/k1`)
  })

  it('boas-vindas cita o corretor (ou a equipe)', () => {
    expect(montarEmail('crm.boas_vindas', { site: SITE, publico: 'cliente', corretorNome: 'Carla' })?.html).toContain('Carla')
    expect(montarEmail('crm.boas_vindas', { site: SITE, publico: 'cliente' })?.html).toContain('nossa equipe')
  })

  it('transferência com quantidade', () => {
    expect(montarEmail('rede.transferencia', { site: SITE, publico: 'painel', quantidade: 3 })?.html).toContain('3 clientes')
    expect(montarEmail('rede.transferencia', { site: SITE, publico: 'painel', quantidade: 1 })?.html).toContain('1 cliente.')
  })

  it('auxiliares', () => {
    expect(primeiroNome('  Maria  da Silva ')).toBe('Maria')
    expect(primeiroNome('')).toBeNull()
    expect(emailValido('a@b.co')).toBe(true)
    expect(emailValido('sem-arroba')).toBe(false)
    expect(emailValido(null)).toBe(false)
    expect(falhaDeConfiguracao(null)).toBe(true)
    expect(falhaDeConfiguracao(403)).toBe(true)
    expect(falhaDeConfiguracao(422)).toBe(false)
    expect(falhaDeConfiguracao(500)).toBe(false)
  })

  it('RESEND_URL: produção sempre no Resend; fora dela só um simulador local, e valor errado não envia', () => {
    expect(urlResend(null, false)).toBe(URL_RESEND)
    expect(urlResend('  ', false)).toBe(URL_RESEND)
    expect(urlResend('http://host.docker.internal:54870/emails', false)).toBe('http://host.docker.internal:54870/emails')
    expect(urlResend('http://127.0.0.1:54870/emails', false)).toBe('http://127.0.0.1:54870/emails')
    // produção ignora a variável (nunca troca o destino dos e-mails reais)
    expect(urlResend('http://host.docker.internal:54870/emails', true)).toBe(URL_RESEND)
    expect(urlResend('https://outro-provedor.example/emails', true)).toBe(URL_RESEND)
    // fora de produção: host que não é local, credencial, query, fragmento ou outro protocolo → não envia
    expect(urlResend('https://outro-provedor.example/emails', false)).toBeNull()
    expect(urlResend('https://localhost.evil.example/emails', false)).toBeNull()
    expect(urlResend('http://usuario:senha@localhost:54870/emails', false)).toBeNull()
    expect(urlResend('http://localhost:54870/emails?chave=x', false)).toBeNull()
    expect(urlResend('http://localhost:54870/emails#x', false)).toBeNull()
    expect(urlResend('ftp://localhost/emails', false)).toBeNull()
    expect(urlResend('não é url', false)).toBeNull()
  })

  it('cantos retos: nenhum border-radius no HTML', () => {
    for (const t of TIPOS_FILA) {
      for (const publico of ['cliente', 'painel', 'admin'] as const) {
        const e = montarEmail(t, { site: SITE, publico, documentos: [{ nome: 'RG' }], contratoCodigo: 1, contratoId: 'k', clienteId: 'c' })
        if (e) expect(e.html).not.toMatch(/border-radius/i)
      }
    }
  })
})
