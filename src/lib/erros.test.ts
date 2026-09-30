import { describe, expect, it } from 'vitest'
import { ErroRpc, listaDoDetalhe, mensagemErro, mensagemErroEdge, MENSAGENS, rotuloCampo, traduzirErro } from './erros'

const t = traduzirErro

describe('traduzirErro: códigos de acesso (§4.4, §4.6)', () => {
  it('42501 é sempre a mesma mensagem genérica, inclusive para o texto nativo do Postgres (não revela existência)', () => {
    expect(t({ code: '42501', message: 'Sem acesso a este registro' })).toMatchObject({ codigo: 'SEM_ACESSO', message: 'Você não tem acesso a este registro.' })
    expect(t({ code: '42501', message: 'permission denied for table clientes' })).toMatchObject({ codigo: 'SEM_ACESSO', message: 'Você não tem acesso a este registro.' })
  })

  it('função fora do ar (0A000 ou PGRST202) vira indisponibilidade, nunca "Em construção"', () => {
    for (const e of [{ code: '0A000', message: 'nao_implementado' }, { code: 'PGRST202', message: 'Could not find the function public.crm_ficha' }]) {
      const r = t(e)
      expect(r.codigo).toBe('NAO_IMPLEMENTADO')
      expect(r.message).not.toMatch(/constru/i)
      expect(r.message).not.toMatch(/crm_ficha/)
    }
  })

  it('sessão: JWT vencido e 401 pedem novo login; ACESSO_INATIVO do hook encerra', () => {
    expect(t({ code: 'PGRST301', message: 'JWT expired' }).codigo).toBe('SESSAO_EXPIRADA')
    expect(t({ status: 401, message: 'Unauthorized' }).codigo).toBe('SESSAO_EXPIRADA')
    expect(t({ status: 403, message: 'ACESSO_INATIVO' })).toMatchObject({ codigo: 'ACESSO_INATIVO', message: MENSAGENS.ACESSO_INATIVO })
  })

  it('falha de rede sem SQLSTATE vira SEM_CONEXAO; o resto, DESCONHECIDO', () => {
    expect(t({ code: '', message: 'TypeError: Failed to fetch' }).codigo).toBe('SEM_CONEXAO')
    expect(t(new Error('qualquer')).codigo).toBe('DESCONHECIDO')
    expect(t(null).codigo).toBe('DESCONHECIDO')
  })

  it('um ErroRpc passa sem mudança e guarda sqlstate, detalhe e rpc', () => {
    const r = t({ code: 'P0001', message: 'CAMPOS_OBRIGATORIOS', details: '{"campos":["nome"]}' }, 'crm_editar_cliente')
    expect(r).toBeInstanceOf(ErroRpc)
    expect(r).toMatchObject({ sqlstate: 'P0001', detalhe: { campos: ['nome'] }, rpc: 'crm_editar_cliente' })
    expect(t(r)).toBe(r)
  })
})

describe('traduzirErro: regras de negócio (P0001 com código e detail em JSON)', () => {
  it('códigos conhecidos com a mensagem do catálogo', () => {
    expect(t({ code: 'P0001', message: 'LIMITE_DUPLICIDADE' }).codigo).toBe('LIMITE_DUPLICIDADE')
    expect(t({ code: 'P0001', message: 'DOCUMENTO_INDISPONIVEL' }).codigo).toBe('DOCUMENTO_INDISPONIVEL')
    expect(t({ code: 'P0001', message: 'LIMITE_CONVITES' })).toMatchObject({ codigo: 'LIMITE_CONVITES', message: MENSAGENS.LIMITE_CONVITES })
  })

  it('EMAIL_EM_USO não promete um vínculo que não existe (mesmo texto da Edge convidar-parceiros)', () => {
    expect(t({ code: 'P0001', message: 'EMAIL_EM_USO' }).message)
      .toBe('Este e-mail já tem uma conta na plataforma: nenhum convite foi gerado. Confira o e-mail cadastrado ou fale com a equipe Arken.')
  })

  it('CAMPOS_OBRIGATORIOS, VALIDACAO_FALHOU e SIMULACAO_INVALIDA listam o que falta com rótulos', () => {
    const r = t({ code: 'P0001', message: 'CAMPOS_OBRIGATORIOS', details: '{"campos":["nome","cep","uf"]}' })
    expect(r.message).toBe('Preencha os campos obrigatórios: nome, CEP, estado.')
    expect(listaDoDetalhe(r, 'campos')).toEqual(['nome', 'cep', 'uf'])
    expect(t({ code: 'P0001', message: 'VALIDACAO_FALHOU', details: '{"validacoes":["pdf_gerado","email_cliente"]}' }).message)
      .toBe('Ainda falta: PDF do contrato gerado e atualizado; e-mail do cliente.')
    expect(t({ code: 'P0001', message: 'SIMULACAO_INVALIDA', details: '{"motivos":["n_parcelas_fora_do_limite","forma_invalida"]}' }).message)
      .toBe('Simulação fora dos limites: número de parcelas fora do limite; forma de pagamento inválida.')
  })

  it('DADOS_INVALIDOS cita só os campos com rótulo conhecido; nome interno (p_dados, filtros) fica de fora', () => {
    expect(t({ code: 'P0001', message: 'DADOS_INVALIDOS', details: '{"campos":["cpf","data_nascimento"]}' }).message)
      .toBe('Confira os campos: CPF, data de nascimento.')
    expect(t({ code: 'P0001', message: 'DADOS_INVALIDOS', details: '{"campos":["texto"]}' }).message).toBe('Confira o campo: texto.')
    expect(t({ code: 'P0001', message: 'DADOS_INVALIDOS', details: '{"campos":["p_dados"]}' }).message).toBe(MENSAGENS.DADOS_INVALIDOS)
    expect(t({ code: 'P0001', message: 'DADOS_INVALIDOS', details: '{"motivo":"filtros"}' }).message).toBe(MENSAGENS.DADOS_INVALIDOS)
    expect(t({ code: 'P0001', message: 'DADOS_INVALIDOS' }).message).toBe(MENSAGENS.DADOS_INVALIDOS)
  })

  it('ARQUIVO_INVALIDO explica o motivo, com o limite e os formatos aceitos', () => {
    expect(t({ code: 'P0001', message: 'ARQUIVO_INVALIDO', details: '{"motivo":"tamanho","max_bytes":5242880}' }).message)
      .toBe('O arquivo passa do tamanho permitido. Limite: 5 MB.')
    expect(t({ code: 'P0001', message: 'ARQUIVO_INVALIDO', details: '{"motivo":"tipo","formatos_aceitos":["jpeg","png","pdf"]}' }).message)
      .toBe('Tipo de arquivo não permitido. Formatos aceitos: JPG, PNG, PDF.')
    expect(t({ code: 'P0001', message: 'ARQUIVO_INVALIDO', details: '{"motivo":"tamanho_ou_tipo","max_bytes":2621440}' }).message)
      .toBe('Arquivo com tipo ou tamanho não permitido. Limite: 2,5 MB.')
    expect(t({ code: 'P0001', message: 'ARQUIVO_INVALIDO', details: '{"motivo":"autor"}' }).message).toMatch(/mesma pessoa/)
    expect(t({ code: 'P0001', message: 'ARQUIVO_INVALIDO', details: '{"motivo":"desconhecido"}' }).message).toBe(MENSAGENS.ARQUIVO_INVALIDO)
  })

  it('DESTINO_INVALIDO: responsável de tarefa e motivos da rede', () => {
    expect(t({ code: 'P0001', message: 'DESTINO_INVALIDO', details: '{"campos":["responsavel_id"]}' }).message)
      .toBe('O responsável escolhido não tem acesso a este cliente.')
    expect(t({ code: 'P0001', message: 'DESTINO_INVALIDO', details: '{"motivo":"destino_obrigatorio"}' }).message).toMatch(/Escolha para onde vão/)
    expect(t({ code: 'P0001', message: 'DESTINO_INVALIDO' }).message).toBe(MENSAGENS.DESTINO_INVALIDO)
  })

  it('frase pronta em P0001 aparece como veio; código novo em maiúsculas vira genérico com o código', () => {
    expect(t({ code: 'P0001', message: 'Motivo precisa de 5 caracteres' }).message).toBe('Motivo precisa de 5 caracteres')
    const r = t({ code: 'P0001', message: 'CODIGO_NOVO_QUALQUER' })
    expect(r.codigo).toBe('DESCONHECIDO')
    expect(r.message).toContain('CODIGO_NOVO_QUALQUER')
  })
})

describe('traduzirErro: classes 22 e 23', () => {
  it('frase pt-BR dos gatilhos vai para a tela; violação nativa (inglês, com nome de constraint) não', () => {
    expect(t({ code: '23514', message: 'Transfira os clientes antes de inativar o parceiro' }).message).toBe('Transfira os clientes antes de inativar o parceiro')
    const nativa = t({ code: '23514', message: 'new row for relation "clientes" violates check constraint "clientes_doc_por_pessoa"' })
    expect(nativa).toMatchObject({ codigo: 'DADOS_INVALIDOS', message: MENSAGENS.DADOS_INVALIDOS })
    expect(t({ code: '22001', message: 'value too long for type character varying(200)' }).message).toBe(MENSAGENS.DADOS_INVALIDOS)
    expect(t({ code: '23505', message: 'duplicate key value violates unique constraint "clientes_cpf_key"' }).codigo).toBe('REGISTRO_DUPLICADO')
  })
})

describe('ajudantes', () => {
  it('rotuloCampo usa o rótulo conhecido ou troca _ por espaço (nunca uma chave do protótipo)', () => {
    expect(rotuloCampo('uf')).toBe('estado')
    expect(rotuloCampo('corretor_id')).toBe('corretor responsável')
    expect(rotuloCampo('campo_sem_rotulo')).toBe('campo sem rotulo')
    expect(rotuloCampo('constructor')).toBe('constructor')
    expect(t({ code: 'P0001', message: 'DADOS_INVALIDOS', details: '{"campos":["constructor","toString"]}' }).message).toBe(MENSAGENS.DADOS_INVALIDOS)
    expect(t({ code: 'P0001', message: 'ARQUIVO_INVALIDO', details: '{"motivo":"toString"}' }).message).toBe(MENSAGENS.ARQUIVO_INVALIDO)
  })

  it('listaDoDetalhe só aceita ErroRpc e só strings', () => {
    expect(listaDoDetalhe({ detalhe: { campos: ['x'] } }, 'campos')).toEqual([])
    expect(listaDoDetalhe(new ErroRpc('DADOS_INVALIDOS', 'x', { detalhe: { campos: ['a', 1, null, 'b'] } }), 'campos')).toEqual(['a', 'b'])
  })

  it('mensagemErro devolve o texto pronto para o toast', () => {
    expect(mensagemErro({ code: '42501', message: 'x' })).toBe('Você não tem acesso a este registro.')
  })

  it('mensagemErroEdge lê { erro } do corpo da Edge; sem corpo, traduz', async () => {
    expect(await mensagemErroEdge({ context: { json: async () => ({ erro: 'Limite de tentativas' }) } })).toBe('Limite de tentativas')
    expect(await mensagemErroEdge({ context: { json: async () => { throw new Error('sem corpo') } }, message: 'Failed to fetch' })).toBe(MENSAGENS.SEM_CONEXAO)
  })
})
