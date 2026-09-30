-- Núcleo do WP0 (docs/ARQUITETURA_EXPANSAO.md §3.4, §3.8, §4.1, §5.1, §5.3, §8.5):
-- _transicionar (transição inexistente, papel errado, motivo, validações, efeitos uma vez); auditoria imutável e purga;
-- somente inclusão; profiles só por RPC (protege_campos_profile v4); is_admin/is_super com MFA exigido; hook_token_acesso.
-- Funções internas (sem grant) são chamadas como postgres com o JWT do usuário (pg_temp.como), como dentro de uma RPC.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(208);

-- ============ DADOS DESTE TESTE (como postgres) ============
-- I1: rascunho incompleto do CA1a; I2: aprovado (cadastrado por interno) para os contratos
insert into public.imoveis (id, nome, status, criado_por) values
  ('f0000000-0000-4000-8000-000000000101', 'Casa incompleta', 'rascunho', pg_temp.usuario('ca1a'));
insert into public.imoveis (id, nome, tipo, status, valor, cep, uf, cidade, logradouro, numero, criado_por) values
  ('f0000000-0000-4000-8000-000000000102', 'Apto aprovado', 'apartamento', 'aprovado', 500000, '01001000', 'SP', 'São Paulo',
   'Praça da Sé', '100', pg_temp.usuario('admin'));
insert into public.unidades (id, empreendimento_id, identificador, valor)
select 'f0000000-0000-4000-8000-000000000201', e.id, 'APTO 91', 400000 from public.empreendimentos e order by e.slug limit 1;

-- D1: solicitação avulsa (RG) do c1, pendente
insert into public.cliente_documentos (id, cliente_id, nome) values
  ('f0000000-0000-4000-8000-000000000301', pg_temp.cliente('c1'), 'RG');

-- contratos do c2: K0 em rascunho (unidade, sem minuta); K1 e K2 com o imóvel I2
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, imovel_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, pdf_path, pdf_sha256, pdf_versao, pdf_gerado_em, pdf_desatualizado)
values
  ('f0000000-0000-4000-8000-000000000400', pg_temp.cliente('c2'), public.modelo_vigente_id('parcelado'), 'parcelado', 'rascunho',
   'f0000000-0000-4000-8000-000000000201', null, public.parametros_vigente_id(),
   400000, 30, 120000, 20000, 100000, 280000, 60, 8.5, 1808.33, 108500, null, null, 0, null, true),
  ('f0000000-0000-4000-8000-000000000401', pg_temp.cliente('c2'), public.modelo_vigente_id('parcelado'), 'parcelado', 'em_analise',
   null, 'f0000000-0000-4000-8000-000000000102', public.parametros_vigente_id(),
   500000, 30, 150000, 50000, 100000, 350000, 60, 8.5, 1808.33, 108500,
   'f0000000-0000-4000-8000-000000000401/minuta-v1-0123abcd.pdf', repeat('a', 64), 1, now(), false);

-- ============ _transicionar: acesso e entrada ============
select pg_temp.entrar('ca1a');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'contato_iniciado', null, 'usuario')$$,
                 '42501', null, '_transicionar não é executável pela API');
select pg_temp.como('ca1a');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'contato_iniciado', null, 'migracao')$$,
                 '22023', null, 'origem migracao é recusada (o corte grava direto)');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-0000000000ff', 'contato_iniciado', null, 'usuario')$$,
                 '42501', 'Sem acesso a este registro', 'registro inexistente: 42501 (não revela)');

-- ============ transição inexistente ou desligada ============
select is(pg_temp.erro($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'documentacao', null, 'usuario')$$),
          '{"sqlstate":"P0001","mensagem":"TRANSICAO_INVALIDA","detalhe":{"entidade":"cliente_etapa","de":"novo_contato","para":"documentacao"}}'::jsonb,
          'NC → DO não existe: TRANSICAO_INVALIDA com {entidade, de, para}');
select is(public._transicionar('cliente_etapa', pg_temp.cliente('c1'), 'contato_iniciado', null, 'usuario'), 'novo_contato',
          'CA1a: NC → CI; devolve o status anterior');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'novo_contato', null, 'usuario')$$,
                 'P0001', 'TRANSICAO_INVALIDA', 'CI → NC existe mas está desligada (F2): TRANSICAO_INVALIDA');

-- ============ papel errado ============
select pg_temp.como('ga1');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000004', 'finalizado', null, 'usuario')$$,
                 '42501', 'Sem permissão para esta mudança de status', 'FI é só do sistema: o gerente não aciona');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000004', 'contato_iniciado', null, 'sistema')$$,
                 '42501', null, 'origem sistema não aciona transição manual (coluna sistema desligada)');
select pg_temp.como('bloqueado');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000005', 'contato_iniciado', null, 'usuario')$$,
                 '42501', null, 'parceiro bloqueado não transiciona');
select pg_temp.como('titular_c1');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'perdido', 'quero sair', 'usuario')$$,
                 '42501', null, 'o titular não mexe na etapa do funil');
select pg_temp.como('ca2a');
select throws_ok($$select public._transicionar('imovel', 'f0000000-0000-4000-8000-000000000101', 'pendente', null, 'usuario')$$,
                 '42501', null, 'imóvel RA → PE: outro corretor não é o criador');
select pg_temp.como('admin');
select throws_ok($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000401', 'assinatura_pendente', null, 'usuario')$$,
                 '42501', null, 'envio para assinatura é só do sistema (nem o admin aciona como usuário)');
select pg_temp.sair();

-- ============ motivo ============
select pg_temp.como('ca1a');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'perdido', null, 'usuario')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'perdido sem motivo: MOTIVO_OBRIGATORIO');
select throws_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'perdido', '  ab  ', 'usuario')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'motivo com menos de 3 caracteres: MOTIVO_OBRIGATORIO');
select is(public._transicionar('cliente_etapa', pg_temp.cliente('c1'), 'perdido', 'Desistiu da compra', 'usuario'), 'contato_iniciado',
          'CI → PE com motivo');
select is((select motivo_perda from public.clientes where id = pg_temp.cliente('c1')), 'Desistiu da compra', 'o motivo fica em motivo_perda');
select is(public._transicionar('cliente_etapa', pg_temp.cliente('c1'), 'novo_contato', null, 'usuario'), 'perdido', 'PE → NC (reativar)');
select is((select motivo_perda from public.clientes where id = pg_temp.cliente('c1')), null, 'efeito limpar_motivo_perda');

-- ============ efeitos uma vez: documentos básicos (CRM-3) ============
select lives_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'contato_iniciado', null, 'usuario');
                  select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'documentacao', null, 'usuario')$$,
                'NC → CI → DO');
select is((select array_agg(nome order by nome collate "C") from public.cliente_documentos where cliente_id = pg_temp.cliente('c1') and basico),
          array['CNH', 'CPF', 'Comprovante de renda', 'Comprovante de residência'], 'CI → DO cria os 4 documentos básicos');
select is((select count(*)::int from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'documento_solicitado'), 4,
          'uma linha de timeline por documento solicitado');
select is((select count(*)::int from public.notificacoes where tipo = 'crm.documento_solicitado'), 0,
          'notificação desligada (N10): nada entra na fila');
select lives_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'perdido', 'Sem retorno', 'usuario');
                  select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'novo_contato', null, 'usuario');
                  select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'contato_iniciado', null, 'usuario');
                  select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000001', 'documentacao', null, 'usuario')$$,
                'DO → PE → NC → CI → DO de novo');
select ok((select count(*) from public.cliente_documentos where cliente_id = pg_temp.cliente('c1') and basico) = 4
          and (select count(*) from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'documento_solicitado') = 4,
          'repetir CI → DO não duplica os básicos nem a timeline');
select ok((select count(*) from public.historico_status where entidade = 'cliente_etapa' and entidade_id = pg_temp.cliente('c1')) = 9
          and (select bool_and(ator_id = pg_temp.usuario('ca1a') and origem = 'usuario') from public.historico_status
               where entidade = 'cliente_etapa' and entidade_id = pg_temp.cliente('c1')),
          'historico_status: uma linha por transição, com o ator e a origem');
select is((select motivo from public.historico_status where entidade = 'cliente_etapa' and entidade_id = pg_temp.cliente('c1')
           and para = 'perdido' order by id limit 1), 'Desistiu da compra', 'historico_status guarda o motivo');
select pg_temp.sair();
update public.notificacoes_config set ativo = true where tipo = 'crm.documento_solicitado';
select pg_temp.como('ga1');
select lives_ok($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000004', 'contato_iniciado', null, 'usuario');
                  select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000004', 'documentacao', null, 'usuario')$$,
                'GA1 leva o próprio cliente (c4, A1) até DO');
select ok((select count(*) = 1 and bool_and(cliente_id = pg_temp.cliente('c4') and destinatarios_ids = '{}'
                                             and jsonb_array_length(dados -> 'documento_ids') = 4 and status = 'pendente')
           from public.notificacoes where tipo = 'crm.documento_solicitado'),
          'notificação ligada: uma entrada na fila, só com ids, para o próprio cliente');
select pg_temp.sair();

-- ============ imóvel: validação IMV-2, criador, revisão ============
select pg_temp.como('ca1a');
select is(pg_temp.erro($$select public._transicionar('imovel', 'f0000000-0000-4000-8000-000000000101', 'pendente', null, 'usuario')$$),
          '{"sqlstate":"P0001","mensagem":"CAMPOS_OBRIGATORIOS","detalhe":{"campos":["tipo","cep","logradouro","numero","cidade","uf","valor"]}}'::jsonb,
          'RA → PE com campos faltando: CAMPOS_OBRIGATORIOS com a lista, na ordem do formulário');
select pg_temp.sair();
update public.imoveis set tipo = 'casa', cep = '01001000', logradouro = 'Rua A', numero = '1', cidade = 'São Paulo', uf = 'SP',
       valor = 350000 where id = 'f0000000-0000-4000-8000-000000000101';
select pg_temp.como('ca1a');
select is(public._transicionar('imovel', 'f0000000-0000-4000-8000-000000000101', 'pendente', null, 'usuario'), 'rascunho',
          'o criador leva o rascunho completo para PE (permite_criador)');
select throws_ok($$select public._transicionar('imovel', 'f0000000-0000-4000-8000-000000000101', 'em_revisao', null, 'usuario')$$,
                 '42501', null, 'PE → RE é só de interno');
select pg_temp.como('admin');
select is(public._transicionar('imovel', 'f0000000-0000-4000-8000-000000000101', 'em_revisao', null, 'usuario'), 'pendente', 'admin: PE → RE');
select throws_ok($$select public._transicionar('imovel', 'f0000000-0000-4000-8000-000000000101', 'rascunho', null, 'usuario')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'RE → RA exige a observação');
select is(public._transicionar('imovel', 'f0000000-0000-4000-8000-000000000101', 'rascunho', 'Faltam fotos da fachada', 'usuario'), 'em_revisao',
          'admin devolve RE → RA');
select is((select observacao_revisao from public.imoveis where id = 'f0000000-0000-4000-8000-000000000101'), 'Faltam fotos da fachada',
          'a observação fica em observacao_revisao');
select pg_temp.sair();

-- ============ documento: arquivo_enviado, F4, rejeição notificada, reenvio ============
select pg_temp.como('titular_c1');
select is(pg_temp.erro($$select public._transicionar('documento', 'f0000000-0000-4000-8000-000000000301', 'em_analise', null, 'usuario')$$),
          '{"sqlstate":"P0001","mensagem":"VALIDACAO_FALHOU","detalhe":{"validacoes":["arquivo_enviado"]}}'::jsonb,
          'sem arquivo: VALIDACAO_FALHOU arquivo_enviado');
select pg_temp.sair();
insert into public.cliente_documento_arquivos (id, documento_id, storage_path, mime_type, tamanho_bytes) values
  ('f0000000-0000-4000-8000-000000000311', 'f0000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000301/f0000000-0000-4000-8000-000000000311.pdf',
   'application/pdf', 1000);
update public.cliente_documentos set arquivo_atual_id = 'f0000000-0000-4000-8000-000000000311'
 where id = 'f0000000-0000-4000-8000-000000000301';
select pg_temp.como('titular_c1');
select is(public._transicionar('documento', 'f0000000-0000-4000-8000-000000000301', 'em_analise', null, 'usuario'), 'pendente',
          'o titular (papel cliente) envia: pendente → em_analise');
select pg_temp.sair();
update public.permissoes_rede set permitido = false where acao = 'analisar_documento' and tipo = 'corretor';
select pg_temp.como('ca1a');
select throws_ok($$select public._transicionar('documento', 'f0000000-0000-4000-8000-000000000301', 'aprovado', null, 'usuario')$$,
                 '42501', null, 'F4: com analisar_documento desligado, o corretor não analisa');
select pg_temp.sair();
update public.permissoes_rede set permitido = true where acao = 'analisar_documento' and tipo = 'corretor';
select pg_temp.como('ca1a');
select throws_ok($$select public._transicionar('documento', 'f0000000-0000-4000-8000-000000000301', 'rejeitado', null, 'usuario')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'rejeitar exige motivo');
select is(public._transicionar('documento', 'f0000000-0000-4000-8000-000000000301', 'rejeitado', 'Documento ilegível', 'usuario'), 'em_analise',
          'CA1a rejeita com motivo');
select ok((select status = 'rejeitado' and motivo_rejeicao = 'Documento ilegível' and analisado_por = pg_temp.usuario('ca1a')
                  and analisado_em is not null
           from public.cliente_documentos where id = 'f0000000-0000-4000-8000-000000000301'),
          'rejeição grava motivo, analisado_por e analisado_em');
select ok((select count(*) = 1 and bool_and(cliente_id = pg_temp.cliente('c1') and destinatarios_ids = '{}'
                                             and dados = jsonb_build_object('documento_id', 'f0000000-0000-4000-8000-000000000301'))
           from public.notificacoes where tipo = 'crm.documento_rejeitado'),
          'efeito notificar_documento_rejeitado: uma entrada na fila para o próprio cliente');
select pg_temp.como('titular_c1');
select is(pg_temp.erro($$select public._transicionar('documento', 'f0000000-0000-4000-8000-000000000301', 'em_analise', null, 'usuario')$$) ->> 'mensagem',
          'VALIDACAO_FALHOU', 'reenvio sem arquivo novo (depois da análise) falha');
select pg_temp.sair();
insert into public.cliente_documento_arquivos (id, documento_id, storage_path, mime_type, tamanho_bytes, enviado_em) values
  ('f0000000-0000-4000-8000-000000000312', 'f0000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000301/f0000000-0000-4000-8000-000000000312.pdf',
   'application/pdf', 1000, now() + interval '1 second');
update public.cliente_documentos set arquivo_atual_id = 'f0000000-0000-4000-8000-000000000312'
 where id = 'f0000000-0000-4000-8000-000000000301';
select pg_temp.como('titular_c1');
select is(public._transicionar('documento', 'f0000000-0000-4000-8000-000000000301', 'em_analise', null, 'usuario'), 'rejeitado',
          'reenvio com arquivo novo: rejeitado → em_analise');
select pg_temp.como('ca1a');
select is(public._transicionar('documento', 'f0000000-0000-4000-8000-000000000301', 'aprovado', null, 'usuario'), 'em_analise', 'CA1a aprova');
select is((select motivo_rejeicao from public.cliente_documentos where id = 'f0000000-0000-4000-8000-000000000301'), null,
          'aprovar limpa o motivo da rejeição anterior');
select pg_temp.sair();

-- ============ contrato: pdf_gerado, devolução com motivo, papel e MFA ============
select pg_temp.como('ca2a');
select is(pg_temp.erro($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000400', 'em_analise', null, 'usuario')$$),
          '{"sqlstate":"P0001","mensagem":"VALIDACAO_FALHOU","detalhe":{"validacoes":["pdf_gerado"]}}'::jsonb,
          'rascunho → em_analise sem minuta: VALIDACAO_FALHOU pdf_gerado');
select pg_temp.sair();
update public.contratos set pdf_path = 'f0000000-0000-4000-8000-000000000400/minuta-v1-89abcdef.pdf', pdf_sha256 = repeat('c', 64),
       pdf_versao = 1, pdf_gerado_em = now(), pdf_desatualizado = false
 where id = 'f0000000-0000-4000-8000-000000000400';
select pg_temp.como('ca2a');
select is(public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000400', 'em_analise', null, 'usuario'), 'rascunho',
          'CA2a manda para análise com a minuta gerada');
select throws_ok($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000400', 'rascunho', 'refazer', 'usuario')$$,
                 '42501', null, 'devolver para rascunho é só de interno');
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = true;
select pg_temp.como('admin');
select throws_ok($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000400', 'rascunho', 'refazer', 'usuario')$$,
                 '42501', null, 'MFA exigido: admin com aal1 não aciona transição de interno');
select pg_temp.como('admin', 'aal2');
select throws_ok($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000400', 'rascunho', null, 'usuario')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'devolução exige motivo');
select is(public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000400', 'rascunho', 'Refazer a simulação', 'usuario'), 'em_analise',
          'admin com aal2 devolve para rascunho');
select is((select observacao from public.contratos where id = 'f0000000-0000-4000-8000-000000000400'), 'Refazer a simulação',
          'a devolução grava a observação');
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = false;

-- ============ contrato: envio (validações do sistema), cancelamento e assinatura (efeitos uma vez) ============
select pg_temp.sair();
select is(pg_temp.erro($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000401', 'assinatura_pendente', null, 'sistema')$$),
          '{"sqlstate":"P0001","mensagem":"VALIDACAO_FALHOU","detalhe":{"validacoes":["modelo_liberado","signatarios_configurados","vendedora_configurada"]}}'::jsonb,
          'envio sem modelo liberado, signatários e vendedora: VALIDACAO_FALHOU com as três');
update public.contrato_modelos set liberado_para_envio = true, revisado_juridico = true, liberado_em = now()
 where id = public.modelo_vigente_id('parcelado');
update public.contrato_signatario_regras set email = 'representante@arken.test' where modelo_chave = 'parcelado' and ordem = 2;
update public.configuracao_geral set vendedora_razao_social = 'ARKEN INCORPORADORA LTDA', vendedora_cnpj = '11222335000170',
       vendedora_endereco = 'Rua de Teste, 100, São Paulo/SP';
update public.contrato_signatario_regras set ativo = false where modelo_chave = 'parcelado' and papel = 'cliente';
select is(pg_temp.erro($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000401', 'assinatura_pendente', null, 'sistema')$$) -> 'detalhe',
          '{"validacoes":["signatarios_configurados"]}'::jsonb, 'sem a regra ativa do cliente (comprador), o envio falha');
update public.contrato_signatario_regras set ativo = true where modelo_chave = 'parcelado' and papel = 'cliente';
update public.contrato_signatario_regras set ativo = false where modelo_chave = 'parcelado' and papel = 'representante_arken';
select is(pg_temp.erro($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000401', 'assinatura_pendente', null, 'sistema')$$) -> 'detalhe',
          '{"validacoes":["signatarios_configurados"]}'::jsonb, 'sem a regra ativa do representante da Arken (vendedora), o envio falha');
update public.contrato_signatario_regras set ativo = true where modelo_chave = 'parcelado' and papel = 'representante_arken';
select is(public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000401', 'assinatura_pendente', null, 'sistema'), 'em_analise',
          'com tudo configurado, o sistema envia para assinatura');
select ok((select status = 'no_contrato' from public.imoveis where id = 'f0000000-0000-4000-8000-000000000102')
          and (select enviado_assinatura_em is not null and envio_lock_em is null from public.contratos
               where id = 'f0000000-0000-4000-8000-000000000401'),
          'efeito imovel_no_contrato e enviado_assinatura_em gravado');
select is((select count(*)::int from public.historico_status where entidade = 'imovel' and entidade_id = 'f0000000-0000-4000-8000-000000000102'
           and de = 'aprovado' and para = 'no_contrato' and origem = 'sistema'), 1, 'o efeito também grava historico_status (origem sistema)');
select throws_ok($$update public.imoveis set valor = 1 where id = 'f0000000-0000-4000-8000-000000000102'$$, '23514', null,
                 'IMV-3: valor travado em no_contrato');
select throws_ok($$update public.contratos set valor_entrada = 1 where id = 'f0000000-0000-4000-8000-000000000401'$$, '23514', null,
                 'contrato congelado a partir do envio');
select pg_temp.como('admin');
select throws_ok($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000401', 'cancelado', null, 'usuario')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'cancelar exige motivo');
select is(public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000401', 'cancelado', 'Cliente desistiu', 'usuario'), 'assinatura_pendente',
          'admin cancela o envio');
select ok((select status = 'aprovado' from public.imoveis where id = 'f0000000-0000-4000-8000-000000000102')
          and (select encerrado_em is not null from public.contratos where id = 'f0000000-0000-4000-8000-000000000401'),
          'efeito imovel_aprovado: o imóvel volta a AP; encerrado_em gravado');
select pg_temp.sair();

insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, imovel_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, pdf_path, pdf_sha256, pdf_versao, pdf_gerado_em, pdf_desatualizado)
values ('f0000000-0000-4000-8000-000000000402', pg_temp.cliente('c2'), public.modelo_vigente_id('parcelado'), 'parcelado', 'em_analise',
   'f0000000-0000-4000-8000-000000000102', public.parametros_vigente_id(),
   500000, 30, 150000, 50000, 100000, 350000, 60, 8.5, 1808.33, 108500,
   'f0000000-0000-4000-8000-000000000402/minuta-v1-fedcba98.pdf', repeat('d', 64), 1, now(), false);
select lives_ok($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000402', 'assinatura_pendente', null, 'sistema')$$,
                'segundo contrato do mesmo imóvel (o primeiro foi cancelado) vai para assinatura');
select is(public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000402', 'assinado', null, 'webhook'), 'assinatura_pendente',
          'retorno do D4Sign: assinado');
select ok((select etapa = 'finalizado' from public.clientes where id = pg_temp.cliente('c2'))
          and (select assinado_em is not null from public.contratos where id = 'f0000000-0000-4000-8000-000000000402'),
          'efeito cliente_finalizado: c2 vai para FI');
select ok((select count(*) = 1 and bool_and(entidade_id = 'f0000000-0000-4000-8000-000000000402'
                                             and dados ->> 'cliente_id' = pg_temp.cliente('c2')::text
                                             and dados ->> 'corretor_id' = pg_temp.parceiro('ca2a')::text)
           from public.eventos_dominio where tipo = 'contrato.assinado'),
          'efeito evento_contrato_assinado: um evento de domínio, com a cadeia congelada');
select is((select count(*)::int from public.cliente_eventos where cliente_id = pg_temp.cliente('c2') and tipo = 'etapa'
           and dados ->> 'contrato_id' = 'f0000000-0000-4000-8000-000000000402'), 1, 'a finalização grava uma linha de timeline');
select throws_ok($$select public._transicionar('contrato', 'f0000000-0000-4000-8000-000000000402', 'assinado', null, 'webhook')$$,
                 'P0001', 'TRANSICAO_INVALIDA', 'repetir o retorno "assinado" não transiciona de novo');
select ok((select count(*) from public.eventos_dominio where tipo = 'contrato.assinado') = 1
          and (select count(*) from public.historico_status where entidade = 'cliente_etapa' and entidade_id = pg_temp.cliente('c2')) = 1,
          'efeitos aplicados uma vez só');
select is(pg_temp.erro($$select public._transicionar('cliente_etapa', 'd0000000-0000-4000-8000-000000000003', 'finalizado', null, 'sistema')$$),
          '{"sqlstate":"P0001","mensagem":"VALIDACAO_FALHOU","detalhe":{"validacoes":["contrato_assinado"]}}'::jsonb,
          'FI sem contrato assinado: VALIDACAO_FALHOU contrato_assinado');

-- ============ AUDITORIA: somente inclusão, inclusive para a service_role (§5.1) ============
do $$ begin
  perform public._auditar('operacao', 'criar', 'teste', 'x1');
  perform public._auditar('acesso', 'consultar', 'teste', 'x2');
end $$;
select throws_ok($$update public.auditoria set acao = 'editar' where entidade = 'teste'$$, '42501', 'Auditoria é somente inclusão',
                 'auditoria: o dono (postgres) não altera');
select throws_ok($$delete from public.auditoria where entidade = 'teste'$$, '42501', 'Auditoria é somente inclusão',
                 'auditoria: o dono não apaga sem a variável da purga');
select throws_ok($$truncate public.auditoria$$, '42501', 'Auditoria é somente inclusão', 'auditoria: truncate recusado');
select pg_temp.entrar_servico();
select lives_ok($$insert into public.auditoria (categoria, acao, entidade, origem) values ('integracao', 'enviar_assinatura', 'contratos', 'edge:contrato-assinatura')$$,
                'service_role inclui (eventos de integração das Edge Functions)');
select throws_ok($$update public.auditoria set acao = 'editar' where entidade = 'teste'$$, '42501', null, 'service_role não altera');
select throws_ok($$delete from public.auditoria where entidade = 'teste'$$, '42501', null, 'service_role não apaga');
select throws_ok($$truncate public.auditoria$$, '42501', null, 'service_role não trunca');
set local arken.purga_auditoria = 'on';
select throws_ok($$delete from public.auditoria where entidade = 'teste'$$, '42501', null, 'a variável da purga não abre nada para a service_role');
reset arken.purga_auditoria;
select pg_temp.entrar('admin');
select throws_ok($$select count(*) from public.auditoria$$, '42501', null, 'nem o admin lê a auditoria direto (auditoria_consultar)');
select throws_ok($$insert into public.auditoria (categoria, acao, entidade) values ('acesso', 'login', 'profiles')$$, '42501', null,
                 'authenticated não inclui direto');
select pg_temp.sair();
set local arken.purga_auditoria = 'on';
select throws_ok($$update public.auditoria set acao = 'editar' where entidade = 'teste'$$, '42501', null,
                 'com a variável da purga ligada, update continua recusado');
select throws_ok($$truncate public.auditoria$$, '42501', null, 'com a variável da purga ligada, truncate continua recusado');
select lives_ok($$delete from public.auditoria where entidade = 'teste' and acao = 'consultar'$$, 'purga: com a variável ligada, o delete passa');
reset arken.purga_auditoria;
select ok((select count(*) from public.auditoria where entidade = 'teste') = 1
          and not exists (select 1 from public.auditoria where entidade = 'teste' and acao = 'consultar'),
          'a purga apagou só o que foi pedido');
select throws_ok($$delete from public.auditoria where entidade = 'teste'$$, '42501', null, 'desligada a variável, o delete volta a ser recusado');

-- somente inclusão (genérico) e a purga de integracao_chamadas
insert into public.integracao_chamadas (provedor, operacao) values ('d4sign', 'upload');
select throws_ok($$update public.historico_status set motivo = 'x'$$, '42501', null, 'historico_status: somente inclusão');
select throws_ok($$delete from public.eventos_dominio$$, '42501', null, 'eventos_dominio: somente inclusão');
select throws_ok($$delete from public.integracao_chamadas$$, '42501', null, 'integracao_chamadas: sem a variável, não apaga');
set local arken.purga_auditoria = 'on';
select lives_ok($$delete from public.integracao_chamadas where provedor = 'd4sign'$$, 'integracao_chamadas: a purga apaga');
reset arken.purga_auditoria;
select lives_ok($$update public.lgpd_consentimentos set revogado_em = now(), motivo_revogacao = 'pedido do titular'
                  where cliente_id = 'd0000000-0000-4000-8000-000000000003'$$, 'consentimento: revogar preenche revogado_* uma vez');
select throws_ok($$update public.lgpd_consentimentos set motivo_revogacao = 'outro' where cliente_id = 'd0000000-0000-4000-8000-000000000003'$$,
                 '42501', null, 'consentimento: a revogação não é reescrita');
select throws_ok($$update public.lgpd_consentimentos set origem = 'portal' where cliente_id = 'd0000000-0000-4000-8000-000000000004'$$,
                 '42501', null, 'consentimento: os demais campos nunca mudam');
select throws_ok($$delete from public.configuracao_geral$$, '42501', null, 'configuracao_geral: a linha única não é excluída');

-- ponte do gatilho de auditoria: recusa fora de gatilho
select pg_temp.entrar('ca1a');
select throws_ok($$select public.auditar_linha_gravar('operacao', 'criar', 'forjado', 'x', null, null, null, null)$$,
                 '42501', 'Uso restrito aos gatilhos de auditoria', 'auditar_linha_gravar: chamada direta pela API é recusada');
select pg_temp.sair();

-- ============ profiles: escrita só por RPC (§3.4; 17 e protege_campos_profile v4 na 18, WP1R-03/WP1R-05) ============
-- authenticated não tem UPDATE em profiles: papel é equipe_definir_papel; status é das RPCs da rede; e-mail e CPF
-- não mudam pela API. O gatilho v4 fica como defesa em profundidade (conferido abaixo com um grant temporário).
select ok(not has_table_privilege('authenticated', 'public.profiles', 'update')
          and not has_any_column_privilege('authenticated', 'public.profiles', 'update')
          and has_table_privilege('authenticated', 'public.profiles', 'select'),
          'authenticated só lê profiles (nenhum UPDATE, nem por coluna)');
select pg_temp.entrar('admin');
select throws_ok($$update public.profiles set papel = 'super' where id = 'a0000000-0000-4000-8000-000000000001'$$,
                 '42501', null, 'o admin não se promove a Super pela API');
select throws_ok($$update public.profiles set status_parceiro = 'aprovado' where id = 'a0000000-0000-4000-8000-000000000043'$$,
                 '42501', null, 'o admin não aprova autocadastro pela API (só rede_aprovar_autocadastro) [WP1R-05]');
select throws_ok($$update public.profiles set status_parceiro = 'inativo' where id = 'a0000000-0000-4000-8000-000000000014'$$,
                 '42501', null, 'ninguém põe status inativo pela API (só pela RPC de inativação)');
select throws_ok($$update public.profiles set status_parceiro = 'aprovado' where id = 'a0000000-0000-4000-8000-000000000041'$$,
                 '42501', null, 'ninguém tira o status inativo pela API (só pela RPC de reativação)');
select throws_ok($$update public.profiles set inativado_em = now() where id = 'a0000000-0000-4000-8000-000000000013'$$,
                 '42501', null, 'inativado_em nunca muda pela API');
select pg_temp.entrar('pendente');
select throws_ok($$update public.profiles set email = 'vitima@outro.test' where id = 'a0000000-0000-4000-8000-000000000043'$$,
                 '42501', null, 'o próprio usuário não troca o e-mail do perfil pela API [WP1R-03]');
select throws_ok($$update public.profiles set cpf = '12345671483' where id = 'a0000000-0000-4000-8000-000000000043'$$,
                 '42501', null, 'o próprio usuário não troca o CPF do perfil pela API [WP1R-03]');
select pg_temp.sair();
select is((select array_agg(pr.papel::text || '/' || pr.status_parceiro::text || '/' || (pr.inativado_em is null)::text
                            order by pr.id)
           from public.profiles pr where pr.id in (pg_temp.usuario('admin'), pg_temp.usuario('pendente'),
                                                   pg_temp.usuario('ca1a'), pg_temp.usuario('inativo'), pg_temp.usuario('ga2'))),
          array['admin/aprovado/true', 'gerente/aprovado/true', 'corretor/aprovado/true', 'corretor/inativo/true',
                'parceiro/pendente/true'],
          'as tentativas recusadas não mudaram nada (papel, status, inativação)');
select is((select count(*)::int from public.auditoria where entidade = 'profiles'
           and entidade_id in (pg_temp.usuario('ca1a')::text, pg_temp.usuario('inativo')::text, pg_temp.usuario('ga2')::text,
                               pg_temp.usuario('admin')::text, pg_temp.usuario('pendente')::text)), 0,
          'tentativa recusada não gera auditoria');
select pg_temp.entrar('admin');
select throws_ok($$delete from public.profiles where id = 'a0000000-0000-4000-8000-000000000043'$$, '42501', null,
                 'perfil não é excluído pela API (nem pelo admin)');
select throws_ok($$insert into public.profiles (id, papel, nome) values ('a0000000-0000-4000-8000-0000000000e9', 'super', 'x')$$,
                 '42501', null, 'perfil não é incluído pela API: o admin não recria um perfil como Super');
select pg_temp.entrar('super');
select throws_ok($$update public.profiles set papel = 'admin' where id = 'a0000000-0000-4000-8000-000000000001'$$,
                 '42501', null, 'nem o Super troca papel pela API (só por equipe_definir_papel, que trava os Supers)');
select throws_ok($$update public.profiles set inativado_em = now() where id = 'a0000000-0000-4000-8000-000000000002'$$,
                 '42501', null, 'nem o Super mexe em inativado_em pela API');
select pg_temp.sair();

-- v4, defesa em profundidade: com um UPDATE concedido por engano, o gatilho reverte em silêncio papel, status,
-- inativação, e-mail, CPF e o id da linha (só o nome muda)
grant update on public.profiles to authenticated;
select pg_temp.entrar('admin');
update public.profiles set status_parceiro = 'aprovado', papel = 'admin' where id = pg_temp.usuario('pendente');
update public.profiles set status_parceiro = 'aprovado', inativado_em = null where id = pg_temp.usuario('inativo');
select pg_temp.entrar('super');
update public.profiles set papel = 'super' where id = pg_temp.usuario('admin');
select pg_temp.entrar('pendente');
update public.profiles set email = 'vitima@outro.test', cpf = '12345671483', nome = 'Nome Novo', inativado_em = now()
 where id = pg_temp.usuario('pendente');
select pg_temp.sair();
revoke update on public.profiles from authenticated;
select is((select array_agg(pr.papel::text || '/' || pr.status_parceiro::text || '/' || coalesce(pr.email, '-') || '/'
                            || coalesce(pr.cpf, '-') || '/' || (pr.inativado_em is null)::text order by pr.id)
           from public.profiles pr where pr.id in (pg_temp.usuario('admin'), pg_temp.usuario('pendente'), pg_temp.usuario('inativo'))),
          array['admin/aprovado/admin@fixture.test/-/true', 'corretor/inativo/inativo@fixture.test/-/true',
                'parceiro/pendente/pendente@fixture.test/-/true'],
          'v4: mesmo com grant, papel, status, inativação, e-mail e CPF não mudam pela API');
select is((select nome from public.profiles where id = pg_temp.usuario('pendente')), 'Nome Novo',
          'v4: o que não é protegido (nome) muda normalmente');

select pg_temp.entrar_servico();
update public.profiles set papel = 'cliente' where id = pg_temp.usuario('pendente');
select pg_temp.sair();
select is((select papel::text from public.profiles where id = pg_temp.usuario('pendente')), 'cliente',
          'a service role (cliente-login) define o papel: a regra vale só para a API');

-- ============ is_admin / is_super com MFA (H5) ============
select pg_temp.entrar('admin');
select ok(public.is_admin() and not public.is_super(), 'MFA desligado: admin com aal1 é interno');
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = true;
select pg_temp.entrar('admin');
select ok(not public.is_admin() and not public.is_parceiro_aprovado(), 'MFA exigido: admin com aal1 não é interno (is_admin falso)');
select ok((public.meu_escopo() ->> 'interno')::boolean = false and (public.meu_escopo() ->> 'mfa_exigido')::boolean
          and public.meu_escopo() ->> 'aal' = 'aal1', 'meu_escopo: mfa_exigido com aal1 (o front manda para a tela de segurança)');
select pg_temp.entrar('admin', 'aal2');
select ok(public.is_admin(), 'MFA exigido: admin com aal2 é interno');
select pg_temp.entrar('super');
select ok(not public.is_super() and not public.is_admin(), 'MFA exigido: Super com aal1 não é Super');
select pg_temp.entrar('super', 'aal2');
select ok(public.is_super() and public.is_admin(), 'MFA exigido: Super com aal2 é Super');
select pg_temp.entrar('ca1a');
select ok(public.is_parceiro_aprovado() and not public.is_admin(), 'MFA exigido não afeta parceiro');
select pg_temp.entrar_anon();
select ok(not public.is_admin(), 'anon: is_admin falso');
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = false;
update public.profiles set inativado_em = now() where id = pg_temp.usuario('admin');
select pg_temp.entrar('admin');
select ok(not public.is_admin(), 'interno inativado (inativado_em) perde o acesso na hora');
select pg_temp.sair();
update public.profiles set inativado_em = null where id = pg_temp.usuario('admin');

-- ============ hook_token_acesso (§4.1) ============
select is(public.hook_token_acesso(jsonb_build_object('user_id', pg_temp.usuario('inativo'), 'authentication_method', 'password', 'claims', '{}'::jsonb)),
          '{"error":{"http_code":403,"message":"ACESSO_INATIVO"}}'::jsonb, 'hook recusa perfil com status inativo');
select is(public.hook_token_acesso(jsonb_build_object('user_id', pg_temp.usuario('inativo'), 'authentication_method', 'token_refresh', 'claims', '{}'::jsonb)),
          '{"error":{"http_code":403,"message":"ACESSO_INATIVO"}}'::jsonb, 'hook recusa também o refresh (o acesso cai em até 1 h)');
update public.profiles set inativado_em = now() where id = pg_temp.usuario('ga2');
select is(public.hook_token_acesso(jsonb_build_object('user_id', pg_temp.usuario('ga2'), 'authentication_method', 'password', 'claims', '{}'::jsonb)) -> 'error' ->> 'message',
          'ACESSO_INATIVO', 'hook recusa perfil com inativado_em');
select is(public.hook_token_acesso(jsonb_build_object('user_id', pg_temp.usuario('ca1a'), 'authentication_method', 'password', 'claims', '{"aal":"aal1"}'::jsonb)),
          jsonb_build_object('user_id', pg_temp.usuario('ca1a'), 'authentication_method', 'password', 'claims', '{"aal":"aal1"}'::jsonb),
          'hook devolve o evento sem mudar as claims (sem escopo no token)');
select ok((select count(*) = 1 and bool_and(categoria = 'acesso' and acao = 'login' and origem = 'hook'
                                             and ator_parceiro_id = pg_temp.parceiro('ca1a') and ator_papel = 'corretor')
           from public.auditoria where entidade = 'profiles' and ator_id = pg_temp.usuario('ca1a') and acao = 'login'),
          'o login de parceiro fica na auditoria (acesso/login, origem hook)');
do $$ begin
  perform public.hook_token_acesso(jsonb_build_object('user_id', pg_temp.usuario('ca1a'), 'authentication_method', 'token_refresh', 'claims', '{}'::jsonb));
  perform public.hook_token_acesso(jsonb_build_object('user_id', pg_temp.usuario('titular_c1'), 'authentication_method', 'otp', 'claims', '{}'::jsonb));
end $$;
select ok((select count(*) from public.auditoria where acao = 'login' and ator_id = pg_temp.usuario('ca1a')) = 1
          and not exists (select 1 from public.auditoria where acao = 'login' and ator_id = pg_temp.usuario('titular_c1')),
          'token_refresh e login do portal não são registrados');
select is(public.hook_token_acesso(jsonb_build_object('user_id', pg_temp.usuario('bloqueado'), 'authentication_method', 'password', 'claims', '{}'::jsonb)) ? 'error',
          false, 'bloqueado entra (vê a tela informativa, sem escopo)');
select is(public.hook_token_acesso('{"user_id":"nao-e-uuid","claims":{}}'::jsonb), '{"user_id":"nao-e-uuid","claims":{}}'::jsonb,
          'evento sem user_id válido volta intacto');
update public.profiles set inativado_em = null where id = pg_temp.usuario('ga2');

-- ============ fila de notificações e autorização de download (funções internas) ============
select is(pg_temp.erro($$select public._notificar('tipo.inexistente', '{}', null, '{}')$$) ->> 'sqlstate', '22023',
          '_notificar: tipo desconhecido é erro');
create temp table x_fila as select public._notificar('crm.documento_rejeitado', '{}', pg_temp.cliente('c3'), '{}') as id;
select ok((select x.id is not null and n.cliente_id = pg_temp.cliente('c3') from x_fila x join public.notificacoes n on n.id = x.id),
          '_notificar devolve o id da fila');
select is((select n.status::text from x_fila x join public.notificacoes n on n.id = x.id), 'ignorado',
          '_notificar: consentimento revogado (c3) grava ignorado, sem disparo');
select is(public._notificar('rede.transferencia', array[pg_temp.usuario('ga1')], null, '{}'), null,
          '_notificar: tipo desligado não entra na fila');
set local arken.migracao = 'on';
select is(public._notificar('crm.documento_rejeitado', '{}', pg_temp.cliente('c1'), '{}'), null,
          '_notificar: durante o corte (arken.migracao) nada entra na fila');
reset arken.migracao;
select pg_temp.como('ca1a');
select ok((select j ->> 'bucket' = 'crm-documentos' and j ->> 'path' = 'd0000000-0000-4000-8000-000000000001/x/y.pdf'
                  and (j ->> 'expira_em')::timestamptz = now() + interval '60 seconds'
           from (select public._autorizar_download('crm-documentos', 'd0000000-0000-4000-8000-000000000001/x/y.pdf') as j) s),
          '_autorizar_download: {bucket, path, expira_em} com o TTL da configuração');
select pg_temp.entrar('ca1a');
select ok(public.download_autorizado('crm-documentos', 'd0000000-0000-4000-8000-000000000001/x/y.pdf')
          and not public.download_autorizado('contratos', 'd0000000-0000-4000-8000-000000000001/x/y.pdf'),
          'a autorização criada vale só para quem chamou, no bucket e caminho exatos');
select pg_temp.entrar('ga1');
select ok(not public.download_autorizado('crm-documentos', 'd0000000-0000-4000-8000-000000000001/x/y.pdf'), 'outro usuário não usa a autorização');
select pg_temp.sair();
select throws_ok($$select public._autorizar_download('crm-documentos', 'x/y.pdf')$$, '42501', null, '_autorizar_download exige usuário');

-- ============ handle_new_user v2 (§3.4, §5.4) ============
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('a0000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'novo1@fixture.test',
   jsonb_build_object('nome', repeat('x', 300), 'papel', 'super', 'status_parceiro', 'aprovado', 'telefone', repeat('9', 50),
                      'termo_id', public._termo_vigente_id('termos_parceiro')), now(), now()),
  ('a0000000-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'novo2@fixture.test',
   '{"nome":"Termo inválido","termo_id":"nao-e-uuid"}', now(), now()),
  ('a0000000-0000-4000-8000-0000000000e3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'novo3@fixture.test',
   jsonb_build_object('nome', 'Termo de outro tipo', 'termo_id', public._termo_vigente_id('consentimento_cliente')), now(), now());
select ok((select papel = 'parceiro' and status_parceiro = 'pendente' and length(nome) = 200 and length(telefone) = 30
           from public.profiles where id = 'a0000000-0000-4000-8000-0000000000e1'),
          'handle_new_user: papel e status nunca vêm dos metadados; contato com limite de tamanho');
select ok((select count(*) = 1 and bool_and(titular = 'parceiro' and origem = 'cadastro_parceiro'
                                             and termo_id = public._termo_vigente_id('termos_parceiro'))
           from public.lgpd_consentimentos where profile_id = 'a0000000-0000-4000-8000-0000000000e1'),
          'handle_new_user: o aceite do termo vigente de parceiro vira consentimento');
select is((select count(*)::int from public.lgpd_consentimentos
           where profile_id in ('a0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-0000000000e3')), 0,
          'handle_new_user: termo inválido ou de outro tipo não grava consentimento (e não impede o cadastro)');

-- ============ meu_escopo (formato da interface Escopo do front) ============
select pg_temp.entrar_anon();
select throws_ok($$select public.meu_escopo()$$, '42501', null, 'meu_escopo: anon não executa');
select pg_temp.entrar('ca1a');
select ok(public.meu_escopo() ->> 'parceiro_id' = pg_temp.parceiro('ca1a')::text and public.meu_escopo() ->> 'tipo' = 'corretor'
          and public.meu_escopo() ->> 'gerente_id' = pg_temp.parceiro('ga1')::text
          and public.meu_escopo() -> 'imobiliaria' ->> 'id' = pg_temp.imobiliaria('a')::text
          and public.meu_escopo() -> 'pendencias' = '[]'::jsonb and public.meu_escopo() -> 'parceiro' ->> 'codigo_indicacao' = 'linkcaumaa',
          'meu_escopo do corretor: vínculo, cadeia e sem pendências');
select ok(public.meu_escopo() -> 'permissoes' ?& array['painel.acessar', 'crm.ver', 'crm.cadastrar', 'crm.links', 'imoveis.cadastrar']
          and not public.meu_escopo() -> 'permissoes' ?| array['rede.ver', 'crm.transferir', 'admin.acessar', 'config.ver'],
          'meu_escopo do corretor: permissões conforme permissoes_rede');
select pg_temp.entrar('ga1');
select ok(public.meu_escopo() ->> 'gerente_id' = pg_temp.parceiro('ga1')::text
          and public.meu_escopo() -> 'permissoes' ?& array['rede.ver', 'rede.cadastrar_corretor', 'crm.transferir', 'crm.links']
          and not public.meu_escopo() -> 'permissoes' ?| array['rede.cadastrar_gerente', 'rede.transferir_corretor'],
          'meu_escopo do gerente: a equipe e o A1 (links)');
select pg_temp.entrar('bloqueado');
select ok(public.meu_escopo() -> 'parceiro_id' = 'null'::jsonb and public.meu_escopo() -> 'permissoes' = '[]'::jsonb
          and public.meu_escopo() ->> 'status_parceiro' = 'bloqueado', 'meu_escopo do bloqueado: sem vínculo nem permissões');
select pg_temp.entrar('titular_c1');
select ok((public.meu_escopo() ->> 'interno')::boolean = false and public.meu_escopo() -> 'permissoes' = '[]'::jsonb,
          'meu_escopo do titular do portal: sem permissões');
select pg_temp.entrar('admin');
select ok(public.meu_escopo() -> 'permissoes' ?& array['admin.acessar', 'auditoria.ver', 'rede.aprovar']
          and not public.meu_escopo() -> 'permissoes' ? 'config.ver' and (public.meu_escopo() ->> 'super')::boolean = false,
          'meu_escopo do admin: operação sem configuração crítica');
select pg_temp.entrar('super');
select ok(public.meu_escopo() -> 'permissoes' ? 'config.ver' and (public.meu_escopo() ->> 'super')::boolean,
          'meu_escopo do Super: configuração');
select pg_temp.sair();
update public.lgpd_consentimentos set revogado_em = now() where profile_id = pg_temp.usuario('ca2a');
select pg_temp.entrar('ca2a');
select is(public.meu_escopo() -> 'pendencias', '["termo"]'::jsonb, 'meu_escopo: termo de parceiro revogado vira pendência');
select pg_temp.sair();

-- ============ status_transicoes: o Super edita papéis, motivo e ativa, dentro da lista fechada (§3.8) ============
select pg_temp.entrar('super');
select throws_ok($$update public.status_transicoes set papeis = papeis || '{cliente}'::public.papel[]
                   where entidade = 'documento' and de = 'em_analise' and para = 'aprovado'$$,
                 '23514', null, 'o cliente nunca analisa documento');
select throws_ok($$update public.status_transicoes set papeis = '{corretor}'
                   where entidade = 'contrato' and de = 'em_analise' and para = 'assinatura_pendente'$$,
                 '23514', 'Esta transição é só do sistema', 'envio para assinatura continua só do sistema');
select throws_ok($$update public.status_transicoes set papeis = papeis || '{colaborador}'::public.papel[]
                   where entidade = 'cliente_etapa' and de = 'novo_contato' and para = 'contato_iniciado'$$,
                 '23514', null, 'colaborador nunca aciona');
-- cancelar contrato em assinatura depende do D4Sign (cancela lá antes, pela Edge contrato-assinatura; §3.8, §6.4):
-- um parceiro acrescentado aqui cancelaria só no banco, com o envelope aberto e o imóvel de volta a AP
select throws_ok($$update public.status_transicoes set papeis = '{corretor,admin,super}'
                   where entidade = 'contrato' and de = 'assinatura_pendente' and para = 'cancelado'$$,
                 '23514', 'A saída da assinatura pendente depende do D4Sign: só admin e super',
                 'cancelamento em assinatura: o Super não acrescenta papel de parceiro');
select lives_ok($$update public.status_transicoes set papeis = '{super}'
                  where entidade = 'contrato' and de = 'assinatura_pendente' and para = 'cancelado'$$,
                'cancelamento em assinatura: o Super pode restringir aos Supers');
select throws_ok($$update public.status_transicoes set validacoes = '{}' where entidade = 'cliente_etapa' and para = 'finalizado'$$,
                 '42501', null, 'validações e efeitos não são editáveis (fora do grant de coluna)');
update public.status_transicoes set ativa = true where entidade = 'cliente_etapa' and de = 'contato_iniciado' and para = 'novo_contato';
select pg_temp.entrar('admin');
update public.status_transicoes set ativa = true where entidade = 'cliente_etapa' and de = 'documentacao' and para = 'novo_contato';
select pg_temp.sair();
select is((select array_agg(de || '>' || para || ':' || ativa order by de) from public.status_transicoes
           where entidade = 'cliente_etapa' and para in ('novo_contato', 'contato_iniciado') and de in ('contato_iniciado', 'documentacao')),
          array['contato_iniciado>novo_contato:true', 'documentacao>contato_iniciado:false', 'documentacao>novo_contato:false'],
          'o Super liga uma volta de etapa (F2); o admin não');

-- ============ cascata da cadeia na rede (gatilhos da 04–07; as RPCs do WP1 só mudam o pai direto) ============
insert into public.propostas (id, parceiro_id, empreendimento_id, texto)
select 'f0000000-0000-4000-8000-000000000501', pg_temp.usuario('ca1a'), e.id, 'sem cliente' from public.empreendimentos e order by e.slug limit 1;
insert into public.propostas (id, parceiro_id, cliente_id, empreendimento_id, texto)
select 'f0000000-0000-4000-8000-000000000502', pg_temp.usuario('ca1a'), pg_temp.cliente('c1'), e.id, 'com cliente' from public.empreendimentos e order by e.slug limit 1;
insert into public.unidades (id, empreendimento_id, identificador, valor)
select 'f0000000-0000-4000-8000-000000000202', e.id, 'APTO 92', 300000 from public.empreendimentos e order by e.slug limit 1;
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, imovel_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, valor_minimo_flex, pdf_path, pdf_sha256, pdf_versao, pdf_gerado_em, pdf_desatualizado,
  enviado_assinatura_em)
values
  ('f0000000-0000-4000-8000-000000000403', pg_temp.cliente('c1'), public.modelo_vigente_id('flexivel'), 'flexivel', 'rascunho',
   'f0000000-0000-4000-8000-000000000202', null, public.parametros_vigente_id(),
   300000, 30, 90000, 0, 90000, 210000, null, null, null, null, 1000, null, null, 0, null, true, null),
  ('f0000000-0000-4000-8000-000000000404', pg_temp.cliente('c1'), public.modelo_vigente_id('parcelado'), 'parcelado', 'assinatura_pendente',
   null, 'f0000000-0000-4000-8000-000000000101', public.parametros_vigente_id(),
   350000, 30, 105000, 5000, 100000, 245000, 60, 8.5, 1808.33, 108500, null,
   'f0000000-0000-4000-8000-000000000404/minuta-v1-01234567.pdf', repeat('e', 64), 1, now(), false, now());
set local arken.motivo_vinculo = 'teste: corretor muda de equipe';
update public.parceiros set gerente_id = pg_temp.parceiro('ga2') where id = pg_temp.parceiro('ca1a');
reset arken.motivo_vinculo;
select ok((select gerente_id = pg_temp.parceiro('ga2') and imobiliaria_id = pg_temp.imobiliaria('a') from public.clientes
           where id = pg_temp.cliente('c1')), 'corretor muda de gerente: os clientes acompanham na mesma transação');
select ok((select bool_and(gerente_id = pg_temp.parceiro('ga2') and corretor_id = pg_temp.parceiro('ca1a')) from public.propostas
           where id in ('f0000000-0000-4000-8000-000000000501', 'f0000000-0000-4000-8000-000000000502')),
          'as propostas (com e sem cliente) acompanham');
select is((select gerente_id from public.imoveis where id = 'f0000000-0000-4000-8000-000000000101'), pg_temp.parceiro('ga2'),
          'os imóveis cadastrados pelo corretor acompanham');
select ok((select gerente_id = pg_temp.parceiro('ga2') from public.contratos where id = 'f0000000-0000-4000-8000-000000000403')
          and (select gerente_id = pg_temp.parceiro('ga1') from public.contratos where id = 'f0000000-0000-4000-8000-000000000404'),
          'contrato editável acompanha; a partir do envio a cadeia fica congelada');
select ok((select count(*) = 2 and count(*) filter (where vigente_ate is null and gerente_id = pg_temp.parceiro('ga2')
                                                     and motivo = 'teste: corretor muda de equipe') = 1
           from public.parceiro_vinculos_historico where parceiro_id = pg_temp.parceiro('ca1a')),
          'parceiro_vinculos_historico: fecha o vínculo antigo e abre o novo com o motivo');
select ok((select count(*) = 2 and count(*) filter (where vigente_ate is null and gerente_id = pg_temp.parceiro('ga2')) = 1
           from public.cliente_vinculos_historico where cliente_id = pg_temp.cliente('c1')),
          'cliente_vinculos_historico: fecha e abre (base do B5)');
update public.parceiros set gerente_id = pg_temp.parceiro('gb1'), imobiliaria_id = pg_temp.imobiliaria('a')
 where id = pg_temp.parceiro('ca2a');
select ok((select imobiliaria_id = pg_temp.imobiliaria('b') from public.parceiros where id = pg_temp.parceiro('ca2a'))
          and (select imobiliaria_id = pg_temp.imobiliaria('b') and gerente_id = pg_temp.parceiro('gb1') from public.clientes
               where id = pg_temp.cliente('c2')),
          'a imobiliária do corretor é derivada do gerente (o valor enviado é descartado) e os clientes acompanham');
select throws_ok($$update public.parceiros set inativado_em = now() where id = 'c0000000-0000-4000-8000-000000000014'$$,
                 '23514', 'Transfira os clientes antes de inativar o parceiro', 'não inativa corretor com cliente ativo');
select throws_ok($$update public.parceiros set inativado_em = now() where id = 'c0000000-0000-4000-8000-000000000012'$$,
                 '23514', null, 'não inativa gerente com corretor ativo');
select throws_ok($$update public.imobiliarias set inativado_em = now() where id = 'b0000000-0000-4000-8000-00000000000b'$$,
                 '23514', null, 'não inativa imobiliária com parceiro ativo');
select throws_ok($$update public.parceiros set gerente_id = 'c0000000-0000-4000-8000-000000000012'
                   where id = (select corretor_casa_id from public.configuracao_geral)$$,
                 '23514', 'A cadeia da casa não pode ser movida nem inativada', 'a Carteira Arken não sai da casa');
select throws_ok($$update public.parceiros set tipo = 'gerente', gerente_id = null where id = 'c0000000-0000-4000-8000-000000000014'$$,
                 '23514', null, 'o tipo do parceiro não muda');
select throws_ok($$update public.parceiros set gerente_id = 'c0000000-0000-4000-8000-000000000041' where id = 'c0000000-0000-4000-8000-000000000015'$$,
                 '23514', null, 'corretor só se vincula a gerente');

-- ============ SOMENTE INCLUSÃO: dentro das RPCs (postgres) os grants não valem; os gatilhos são a barreira ============
-- (§3.5, §3.6, §4.3, §5.1, §5.5) Tudo aqui roda como postgres, o dono que executa as RPCs security definer.
insert into public.cliente_notas (id, cliente_id, texto, autor_id) values
  ('f0000000-0000-4000-8000-000000000601', pg_temp.cliente('c3'), 'Nota de teste', pg_temp.usuario('cb1a'));
select throws_ok($$update public.cliente_notas set texto = 'reescrita' where id = 'f0000000-0000-4000-8000-000000000601'$$,
                 '42501', 'Nota é somente inclusão', 'nota: o texto não é reescrito');
select throws_ok($$update public.cliente_notas set removido_lgpd = true, texto = 'apagada' where id = 'f0000000-0000-4000-8000-000000000601'$$,
                 '42501', 'Nota é somente inclusão', 'nota: a anonimização só aceita o texto padrão');
select throws_ok($$delete from public.cliente_notas where id = 'f0000000-0000-4000-8000-000000000601'$$,
                 '42501', 'Nota é somente inclusão', 'nota: nunca é excluída');
select lives_ok($$update public.cliente_notas set removido_lgpd = true, texto = '[removido — LGPD]'
                  where id = 'f0000000-0000-4000-8000-000000000601'$$, 'nota: a anonimização (§5.5) é a alteração permitida');
select throws_ok($$update public.cliente_notas set removido_lgpd = false, texto = 'Nota de teste'
                   where id = 'f0000000-0000-4000-8000-000000000601'$$, '42501', 'Nota é somente inclusão', 'nota anonimizada não volta');

insert into public.cliente_eventos (cliente_id, tipo, titulo) values (pg_temp.cliente('c3'), 'nota', 'Nota criada');
select throws_ok($$update public.cliente_eventos set titulo = 'outro' where cliente_id = 'd0000000-0000-4000-8000-000000000003'$$,
                 '42501', null, 'timeline: somente inclusão (update)');
select throws_ok($$delete from public.cliente_eventos where cliente_id = 'd0000000-0000-4000-8000-000000000003'$$,
                 '42501', null, 'timeline: somente inclusão (delete)');

select throws_ok($$update public.cliente_vinculos_historico set motivo = 'reescrito' where cliente_id = 'd0000000-0000-4000-8000-000000000003'$$,
                 '42501', null, 'cliente_vinculos_historico: o motivo não é reescrito');
select throws_ok($$delete from public.cliente_vinculos_historico where cliente_id = 'd0000000-0000-4000-8000-000000000003'$$,
                 '42501', null, 'cliente_vinculos_historico: nunca é excluído');
select lives_ok($$update public.cliente_vinculos_historico set vigente_ate = now()
                  where cliente_id = 'd0000000-0000-4000-8000-000000000003' and vigente_ate is null$$,
                'cliente_vinculos_historico: fechar o vínculo (vigente_ate) é permitido uma vez');
select throws_ok($$update public.cliente_vinculos_historico set vigente_ate = now() + interval '1 day'
                   where cliente_id = 'd0000000-0000-4000-8000-000000000003'$$, '42501', null,
                 'cliente_vinculos_historico: vínculo fechado não é reaberto nem redatado');

select throws_ok($$update public.parceiro_vinculos_historico set motivo = 'reescrito' where parceiro_id = 'c0000000-0000-4000-8000-000000000023'$$,
                 '42501', null, 'parceiro_vinculos_historico: o motivo não é reescrito');
select throws_ok($$delete from public.parceiro_vinculos_historico where parceiro_id = 'c0000000-0000-4000-8000-000000000023'$$,
                 '42501', null, 'parceiro_vinculos_historico: nunca é excluído');

insert into public.cliente_documentos (id, cliente_id, nome, status) values
  ('f0000000-0000-4000-8000-000000000611', pg_temp.cliente('c3'), 'RG', 'pendente');
insert into public.cliente_documento_arquivos (id, documento_id, storage_path, mime_type, tamanho_bytes) values
  ('f0000000-0000-4000-8000-000000000612', 'f0000000-0000-4000-8000-000000000611',
   'd0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000611/f0000000-0000-4000-8000-000000000613.pdf',
   'application/pdf', 1000);
select throws_ok($$update public.cliente_documento_arquivos set tamanho_bytes = 1 where id = 'f0000000-0000-4000-8000-000000000612'$$,
                 '42501', null, 'arquivo enviado: tamanho, tipo e caminho não mudam');
select throws_ok($$delete from public.cliente_documento_arquivos where id = 'f0000000-0000-4000-8000-000000000612'$$,
                 '42501', null, 'arquivo enviado: nunca é excluído (versões ficam, inclusive as rejeitadas)');
select lives_ok($$update public.cliente_documento_arquivos set removido_em = now() where id = 'f0000000-0000-4000-8000-000000000612'$$,
                'arquivo enviado: removido_em (anonimização) é preenchido uma vez');
select throws_ok($$update public.cliente_documento_arquivos set removido_em = null where id = 'f0000000-0000-4000-8000-000000000612'$$,
                 '42501', null, 'arquivo removido não volta');

select throws_ok($$update public.contrato_modelos set conteudo = conteudo || ' alterado' where chave = 'servico_corretor'$$,
                 '42501', null, 'modelo de contrato: o texto não muda (publica-se nova versão)');
select throws_ok($$delete from public.contrato_modelos where chave = 'servico_corretor'$$, '42501', null, 'modelo de contrato: nunca é excluído');
select lives_ok($$update public.contrato_modelos set liberado_para_envio = true, revisado_juridico = true, liberado_em = now(),
                  liberado_por = 'a0000000-0000-4000-8000-000000000002' where chave = 'servico_corretor'$$,
                'modelo de contrato: a liberação (uma vez) é a alteração permitida');
select throws_ok($$update public.contrato_modelos set liberado_para_envio = false where chave = 'servico_corretor'$$,
                 '42501', null, 'modelo de contrato: liberação não é desfeita');
select throws_ok($$update public.contrato_modelos set liberado_em = now() - interval '1 day' where chave = 'servico_corretor'$$,
                 '42501', null, 'modelo de contrato: a data da liberação não é reescrita');

select throws_ok($$update public.parametros_simulacao set taxa_aporte_proprio = 1$$, '42501', null,
                 'parâmetros de simulação: somente inclusão (publica-se nova versão)');
select throws_ok($$delete from public.parametros_simulacao$$, '42501', null, 'parâmetros de simulação: nunca são excluídos');
select throws_ok($$update public.lgpd_termos set texto = 'outro texto'$$, '42501', null, 'termos LGPD: somente inclusão');

-- ============ CPF do cliente (A2): na inclusão e na troca; linha antiga com CPF inválido continua gravando ============
select throws_ok($$insert into public.clientes (nome, cpf, origem) values ('CPF inválido', '12345678900', 'portal_admin')$$,
                 '23514', 'CPF inválido', 'cliente: CPF com dígito verificador inválido é recusado na inclusão');
select throws_ok($$update public.clientes set cpf = '12345678900' where id = 'd0000000-0000-4000-8000-000000000003'$$,
                 '23514', 'CPF inválido', 'cliente: troca para CPF inválido é recusada');
select throws_ok($$insert into public.clientes (nome, cpf, origem) values ('CPF com máscara', '123.456.720-21', 'portal_admin')$$,
                 '23514', 'CPF inválido', 'cliente: CPF só com dígitos');
-- cliente do portal gravado antes do gatilho (simulado desligando-o) com CPF de DV inválido
alter table public.clientes disable trigger clientes_cpf_valido;
insert into public.clientes (id, nome, cpf, email, origem) values
  ('f0000000-0000-4000-8000-000000000701', 'Cliente antigo do portal', '12345678900', 'antigo@portal.test', 'portal_admin');
alter table public.clientes enable trigger clientes_cpf_valido;
select lives_ok($$update public.clientes set telefone = '11999990000', user_id = null, cpf = cpf, nome = 'Cliente antigo'
                  where id = 'f0000000-0000-4000-8000-000000000701'$$,
                'cliente antigo com CPF inválido: as demais colunas continuam gravando (backfill da 06, cliente-login, tela antiga)');
select lives_ok($$update public.clientes set corretor_id = (select corretor_casa_id from public.configuracao_geral)
                  where id = 'f0000000-0000-4000-8000-000000000701'$$,
                'cliente antigo com CPF inválido: a cascata da rede também grava');
select lives_ok($$update public.clientes set cpf = '12345672021' where id = 'f0000000-0000-4000-8000-000000000701'$$,
                'cliente antigo: a correção para um CPF válido é aceita');

-- ============ remoção do usuário Auth de quem criou linhas (§3.1: *_por "on delete set null") ============
-- A ação da FK roda como o dono da tabela e passa pelo carimbar: criado_por pode virar nulo fora da API.
-- Um Super temporário grava (cliente, tipo de imóvel e uma transição) e depois é removido. Depois do corte (18) nem
-- internos incluem cliente pela API: a inclusão é por RPC (security definer: roda como postgres com o JWT de quem
-- chama, e o carimbo vem de auth.uid()), simulada aqui como postgres com o JWT do Super; o resto vai pela API.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('a0000000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'super.temporario@fixture.test', '{"nome":"Super temporário"}', now(), now());
update public.profiles set papel = 'super', status_parceiro = 'aprovado' where id = 'a0000000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000f1","role":"authenticated","aal":"aal1"}', true);
insert into public.clientes (nome, cpf, email) values ('Criado pelo Super temporário', '12345672102', 'criado@super.test');
set local role authenticated;
insert into public.imovel_tipos (codigo, rotulo) values ('galpao', 'Galpão');
update public.status_transicoes set exige_motivo = true
 where entidade = 'cliente_etapa' and de = 'novo_contato' and para = 'contato_iniciado';
select throws_ok($$update public.clientes set criado_por = null where cpf = '12345672102'$$, '42501', null,
                 'pela API ninguém mexe em criado_por (sem grant de coluna)');
select pg_temp.sair();
select ok((select criado_por = 'a0000000-0000-4000-8000-0000000000f1' from public.clientes where cpf = '12345672102')
          and (select criado_por = 'a0000000-0000-4000-8000-0000000000f1' from public.imovel_tipos where codigo = 'galpao')
          and (select atualizado_por = 'a0000000-0000-4000-8000-0000000000f1' from public.status_transicoes
               where entidade = 'cliente_etapa' and de = 'novo_contato' and para = 'contato_iniciado'),
          'o que o Super gravou pela API guarda o autor');
update public.clientes set nome = 'Criado pelo Super (editado)', criado_por = pg_temp.usuario('admin') where cpf = '12345672102';
select is((select criado_por from public.clientes where cpf = '12345672102'), 'a0000000-0000-4000-8000-0000000000f1'::uuid,
          'carimbar: criado_por não é trocado por outro autor (nem pelo dono)');
select lives_ok($$delete from auth.users where id = 'a0000000-0000-4000-8000-0000000000f1'$$,
                'remover do Auth quem criou cliente e tipo de imóvel e alterou uma transição não esbarra em FK');
select ok((select criado_por is null and nome = 'Criado pelo Super (editado)' from public.clientes where cpf = '12345672102')
          and (select criado_por is null from public.imovel_tipos where codigo = 'galpao')
          and (select atualizado_por is null and exige_motivo from public.status_transicoes
               where entidade = 'cliente_etapa' and de = 'novo_contato' and para = 'contato_iniciado'),
          'as referências ao usuário removido viram nulo (as linhas ficam)');
select throws_ok($$delete from auth.users where id = 'a0000000-0000-4000-8000-000000000001'$$, '23503', null,
                 'exceção documentada (§3.7): quem cadastrou imóvel (imoveis.criado_por not null) é inativado, não removido');

select * from finish();
rollback;
