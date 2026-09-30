-- §4.5 de ponta a ponta, com todos os corpos implementados e depois do corte (docs/ARQUITETURA_EXPANSAO.md §4.3–§4.6,
-- §8.5; WP7): "um corretor não consegue ver o cliente de outro, nem pela API".
-- Cenário: o corretor A (CA1a, carteira {c1}) sabe o id do cliente X (c2, do corretor B = CA2a). Cada linha da tabela da
-- §4.5 é uma asserção (ou um grupo delas), mais os contrastes (quem tem escopo continua vendo) e as regras da contração.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(65);

-- ============ DADOS DESTE TESTE (como postgres) ============
-- termo vigente de consentimento (a RPC de cadastro exige), lido como postgres
create temp table t_termo on commit drop as select public._termo_vigente_id('consentimento_cliente') as id;
grant select on t_termo to authenticated;
-- documento do X com um arquivo enviado (objeto no bucket, como a Storage API grava)
insert into public.cliente_documentos (id, cliente_id, nome, status) values
  ('e8000000-0000-4000-8000-000000000001', pg_temp.cliente('c2'), 'RG', 'pendente');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('crm-documentos', 'd0000000-0000-4000-8000-000000000002/e8000000-0000-4000-8000-000000000001/e8000000-0000-4000-8000-000000000011.pdf',
   pg_temp.usuario('ca2a')::text, '{"size": 1000, "mimetype": "application/pdf"}');
insert into public.cliente_documento_arquivos (id, documento_id, storage_path, mime_type, tamanho_bytes, enviado_por) values
  ('e8000000-0000-4000-8000-000000000021', 'e8000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002/e8000000-0000-4000-8000-000000000001/e8000000-0000-4000-8000-000000000011.pdf',
   'application/pdf', 1000, pg_temp.usuario('ca2a'));
-- contratos em rascunho: K2 do X (c2) e K1 do c1, este criado por alguém de outra imobiliária (CB1a) para o PAR-3
insert into public.unidades (id, empreendimento_id, identificador, valor)
select v.id::uuid, (select e.id from public.empreendimentos e order by e.slug limit 1), v.ident, 300000
from (values ('e8000000-0000-4000-8000-000000000031', 'APTO E2E-1'), ('e8000000-0000-4000-8000-000000000032', 'APTO E2E-2')) v(id, ident);
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, parametros_id, valor_imovel,
  perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte, valor_parcela,
  valor_total_parcelas, criado_por)
values
  ('e8000000-0000-4000-8000-000000000042', pg_temp.cliente('c2'), public.modelo_vigente_id('parcelado'), 'parcelado', 'rascunho',
   'e8000000-0000-4000-8000-000000000032', public.parametros_vigente_id(), 300000, 30, 90000, 10000, 80000, 210000, 60, 8.5,
   1446.67, 86800, pg_temp.usuario('ca2a')),
  ('e8000000-0000-4000-8000-000000000041', pg_temp.cliente('c1'), public.modelo_vigente_id('parcelado'), 'parcelado', 'rascunho',
   'e8000000-0000-4000-8000-000000000031', public.parametros_vigente_id(), 300000, 30, 90000, 10000, 80000, 210000, 60, 8.5,
   1446.67, 86800, pg_temp.usuario('cb1a'));
-- propostas: uma do X (pelo CA2a) e uma do c1 (pelo CA1a)
insert into public.propostas (id, parceiro_id, cliente_id, empreendimento_id, texto) values
  ('e8000000-0000-4000-8000-000000000051', pg_temp.usuario('ca2a'), pg_temp.cliente('c2'),
   (select e.id from public.empreendimentos e order by e.slug limit 1), 'proposta do X'),
  ('e8000000-0000-4000-8000-000000000052', pg_temp.usuario('ca1a'), pg_temp.cliente('c1'),
   (select e.id from public.empreendimentos e order by e.slug limit 1), 'proposta do c1');
insert into public.leads (nome, telefone) values ('Lead do site', '11999990000');

-- ajudantes (security definer: a sessão do usuário não lê clientes nem auditoria)
create function pg_temp.negacoes(p_ator text, p_cliente text) returns int language sql security definer as $$
  select count(*)::int from public.auditoria a
  where a.acao = 'acesso_negado' and a.ator_id = pg_temp.usuario(p_ator) and a.cliente_id = pg_temp.cliente(p_cliente)
$$;
create function pg_temp.kanban_ids(p jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((i ->> 'id')::uuid order by i ->> 'id'), '{}')
  from jsonb_array_elements(p -> 'colunas') c, jsonb_array_elements(c -> 'itens') i
$$;
create function pg_temp.cadeia_cliente_cpf(p_cpf text) returns text language sql security definer as $$
  select c.corretor_id || '/' || c.gerente_id || '/' || c.imobiliaria_id from public.clientes c where c.cpf = p_cpf
$$;
create function pg_temp.downloads(p_ator text) returns int language sql security definer as $$
  select count(*)::int from public.download_autorizacoes d where d.profile_id = pg_temp.usuario(p_ator)
$$;

-- ============ LEITURA DIRETA PELA API (§4.5, linhas 1–2): 42501 depois do corte ============
select pg_temp.entrar('ca1a');
select throws_ok($$select * from public.clientes where id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'GET /rest/v1/clientes?id=eq.X (depois do corte): 42501, sem grant');
select throws_ok($$select * from public.cliente_documentos where cliente_id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'GET cliente_documentos?cliente_id=eq.X: 42501');
select throws_ok($$select * from public.cliente_notas where cliente_id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'GET cliente_notas?cliente_id=eq.X: 42501');
select throws_ok($$select * from public.cliente_tarefas where cliente_id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'GET cliente_tarefas?cliente_id=eq.X: 42501');
select throws_ok($$select * from public.cliente_eventos where cliente_id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'GET cliente_eventos?cliente_id=eq.X: 42501');
select throws_ok($$select * from public.contratos where cliente_id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'GET contratos?cliente_id=eq.X: 42501');
select throws_ok($$select * from public.contrato_signatarios$$, '42501', null, 'GET contrato_signatarios: 42501');
select throws_ok($$select * from public.propostas where cliente_id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'GET propostas?cliente_id=eq.X (depois do corte): 42501');
select throws_ok($$select * from public.leads$$, '42501', null, 'GET leads: 42501');
select throws_ok($$select * from public.legado_parceiro_clientes$$, '42501', null, 'GET da carteira legada: 42501');

-- ============ RPC DE LEITURA (§4.5, linha 3): nulo + acesso_negado gravado ============
select is(public.crm_ficha(pg_temp.cliente('c2')), null, 'POST rpc/crm_ficha {p_id: X}: null');
select is(public.crm_ficha('d0000000-0000-4000-8000-0000000000ff'), null, 'crm_ficha de cliente inexistente: o mesmo null');
select is(public.contrato_detalhe('e8000000-0000-4000-8000-000000000042'), null, 'contrato_detalhe do contrato de X: null');
select is(public.crm_timeline(pg_temp.cliente('c2'), null, 30), null, 'crm_timeline de X: null');
select is(public.crm_notas(pg_temp.cliente('c2')), null, 'crm_notas de X: null');
select is(public.crm_documentos(pg_temp.cliente('c2')), null, 'crm_documentos de X: null');
select pg_temp.sair();
select ok(pg_temp.negacoes('ca1a', 'c2') >= 5,
          'a auditoria grava acesso_negado com ator_id = A e cliente_id = X (ficha, contrato, timeline, notas, documentos)');
select ok((select count(*) = 1 from public.auditoria a where a.acao = 'acesso_negado' and a.ator_id = pg_temp.usuario('ca1a')
             and a.entidade = 'clientes' and a.entidade_id = pg_temp.cliente('c2')::text and a.categoria = 'acesso'),
          'a negação da ficha fica registrada uma vez, na categoria acesso, com o id do cliente');

-- ============ RPC DE ESCRITA (§4.5, linha 4): 42501 com a mesma mensagem para inexistente ============
select pg_temp.entrar('ca1a');
select throws_ok(format('select public.crm_mudar_etapa(%L, %L, null)', pg_temp.cliente('c2'), 'contato_iniciado'),
                 '42501', 'Sem acesso a este registro', 'crm_mudar_etapa em X: 42501');
select throws_ok($$select public.crm_mudar_etapa('d0000000-0000-4000-8000-0000000000ff', 'contato_iniciado', null)$$,
                 '42501', 'Sem acesso a este registro', 'crm_mudar_etapa em cliente inexistente: a mesma mensagem');
select throws_ok(format('select public.crm_nota_criar(%L, %L)', pg_temp.cliente('c2'), 'nota intrusa'),
                 '42501', 'Sem acesso a este registro', 'crm_nota_criar em X: 42501');
select throws_ok($$select public.crm_nota_criar('d0000000-0000-4000-8000-0000000000ff', 'nota intrusa')$$,
                 '42501', 'Sem acesso a este registro', 'crm_nota_criar em inexistente: a mesma mensagem');
select throws_ok(format('select public.rede_transferir_clientes(array[%L]::uuid[], %L, %L)', pg_temp.cliente('c2'),
                        pg_temp.parceiro('ca1a'), 'quero este cliente para mim'),
                 '42501', 'Sem acesso a este registro', 'rede_transferir_clientes de X para A: 42501');
select throws_ok(format('select public.crm_tarefa_criar(%L, %L, null, null, null)', pg_temp.cliente('c2'), 'tarefa intrusa'),
                 '42501', 'Sem acesso a este registro', 'crm_tarefa_criar em X: 42501');
select throws_ok(format('select public.crm_documento_solicitar(%L, %L, array[%L], null)', pg_temp.cliente('c2'), 'CNH', 'pdf'),
                 '42501', 'Sem acesso a este registro', 'crm_documento_solicitar em X: 42501');
select throws_ok(format('select public.crm_editar_cliente(%L, %L)', pg_temp.cliente('c2'), '{"telefone":"11911112222"}'),
                 '42501', 'Sem acesso a este registro', 'crm_editar_cliente em X: 42501');
select throws_ok(format('select public.propostas_criar((select e.id from public.empreendimentos e order by e.slug limit 1), %L, null, %L)',
                        pg_temp.cliente('c2'), 'proposta para o cliente de outro corretor'),
                 '42501', null, 'propostas_criar com o cliente X: 42501');

-- ============ KANBAN (§4.5, linha 5): o filtro é cruzado com o escopo ============
select is(pg_temp.kanban_ids(public.crm_kanban(jsonb_build_object('corretor_id', pg_temp.parceiro('ca2a')), 50)), '{}'::uuid[],
          'crm_kanban {"p_filtros":{"corretor_id":"<B>"}}: nenhum cliente de B');
select is(pg_temp.kanban_ids(public.crm_kanban('{}', 50)), array[pg_temp.cliente('c1')], 'crm_kanban sem filtro: só os clientes de A');
select ok(not (public.crm_listar(jsonb_build_object('corretor_id', pg_temp.parceiro('ca2a')), 50, 0) -> 'itens')
          @> jsonb_build_array(jsonb_build_object('id', pg_temp.cliente('c2')))
          and (public.crm_listar('{}', 50, 0) ->> 'total')::int = 1,
          'crm_listar: o filtro por B também é cruzado com o escopo (só c1)');
select ok(not exists (select 1 from jsonb_array_elements(public.propostas_listar('{}') -> 'itens') i
                      where i ->> 'id' = 'e8000000-0000-4000-8000-000000000051')
          and exists (select 1 from jsonb_array_elements(public.propostas_listar('{}') -> 'itens') i
                      where i ->> 'id' = 'e8000000-0000-4000-8000-000000000052'),
          'propostas_listar: a proposta de X não aparece; a do c1 aparece');
select ok(not exists (select 1 from jsonb_array_elements(public.contratos_listar('{}') -> 'itens') i
                      where i ->> 'id' = 'e8000000-0000-4000-8000-000000000042'),
          'contratos_listar: o contrato de X não aparece');

-- ============ STORAGE (§4.5, linhas 6–7) ============
select is((select count(*)::int from storage.objects where bucket_id = 'crm-documentos'), 0,
          'createSignedUrl(crm-documentos, X/…) sem RPC: A não enxerga o objeto (sem SELECT) e a assinatura falha');
select throws_ok($$select public.crm_documento_baixar('e8000000-0000-4000-8000-000000000021')$$, '42501', 'Sem acesso a este registro',
                 'crm_documento_baixar do arquivo de X: 42501');
select is(pg_temp.downloads('ca1a'), 0, 'nenhuma autorização de download é criada para A');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('crm-documentos',
                   'd0000000-0000-4000-8000-000000000002/e8000000-0000-4000-8000-000000000001/e8000000-0000-4000-8000-000000000012.pdf')$$,
                 '42501', null, 'upload em crm-documentos/X/<doc>/…: negado por pode_enviar_documento');
select ok(not public.pode_enviar_documento(
            'd0000000-0000-4000-8000-000000000002/e8000000-0000-4000-8000-000000000001/e8000000-0000-4000-8000-000000000013.pdf'),
          'pode_enviar_documento: falso para o documento de X');

-- ============ CADASTRO (§4.5, linhas 8–9) ============
select throws_ok(format('select public.crm_cadastrar_cliente(%L, %L, %L)',
                        jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Para o B', 'cpf', '12345671483', 'telefone', '11988887777'),
                        pg_temp.parceiro('ca2a'), (select id from t_termo)),
                 '42501', null, 'crm_cadastrar_cliente(p_corretor_id := B): 42501 (o corretor só cadastra para si)');
select is(public.crm_cadastrar_cliente(
            jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Cadeia forjada', 'cpf', '12345671564', 'telefone', '11988887777',
                               'gerente_id', pg_temp.parceiro('gb1'), 'imobiliaria_id', pg_temp.imobiliaria('b'),
                               'corretor_id', pg_temp.parceiro('cb1a')),
            null, (select id from t_termo)) ->> 'situacao', 'criado', 'cadastro com cadeia forjada no corpo é aceito…');
select is(pg_temp.cadeia_cliente_cpf('12345671564'),
          pg_temp.parceiro('ca1a') || '/' || pg_temp.parceiro('ga1') || '/' || pg_temp.imobiliaria('a'),
          '…mas a cadeia enviada é descartada e recalculada (gatilho clientes_cadeia): o cliente é de A');
select pg_temp.sair();
update public.configuracao_geral set duplicidade_bloqueios_hora = 2;
select pg_temp.entrar('ca1a');
select is(public.crm_cadastrar_cliente(jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Tentativa 1', 'cpf', '12345671050',
                                                          'telefone', '11988887777'), null, (select id from t_termo)),
          '{"situacao":"indisponivel","id":null}'::jsonb, 'crm_cadastrar_cliente com o CPF de X: indisponível, sem dono nem data');
select is(public.crm_cadastrar_cliente(jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Tentativa 2', 'cpf', '12345671050',
                                                          'telefone', '11988887777'), null, (select id from t_termo)) ->> 'situacao',
          'indisponivel', 'segunda tentativa: indisponível');
select is(pg_temp.erro(format('select public.crm_cadastrar_cliente(%L, null, %L)',
                              jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Tentativa 3', 'cpf', '12345671645', 'telefone', '11988887777'),
                              (select id from t_termo))) ->> 'mensagem',
          'LIMITE_DUPLICIDADE', 'acima do limite na hora: LIMITE_DUPLICIDADE, inclusive com CPF livre (sem oráculo)');

-- ============ CONTRATO / EDGE contrato-gerar (§4.5, linha 10): o JWT de A não gera o contrato de X ============
select throws_ok($$select public.contrato_dados_modelo('e8000000-0000-4000-8000-000000000042')$$, '42501', 'Sem acesso a este registro',
                 'Edge contrato-gerar com o contrato de X: contrato_dados_modelo com o JWT de A é negado');
select throws_ok($$select public.contrato_baixar('e8000000-0000-4000-8000-000000000042', 'minuta', null)$$, '42501', null,
                 'contrato_baixar do contrato de X: 42501');
select throws_ok($$select public.contrato_atualizar_simulacao('e8000000-0000-4000-8000-000000000042', 'parcelado', 30, 10000, 60)$$,
                 '42501', 'Sem acesso a este registro', 'contrato_atualizar_simulacao do contrato de X: 42501');
select throws_ok($$select public.contrato_preparar_envio('e8000000-0000-4000-8000-000000000042')$$, '42501', null,
                 'contrato_preparar_envio: parceiro não prepara envio (só internos, pela Edge)');

-- ============ PAR-3 nos contratos (correção do WP7 em _contrato_nome_perfil) ============
select pg_temp.entrar('ia');
select is(public.contrato_detalhe('e8000000-0000-4000-8000-000000000041') -> 'criado_por' ->> 'nome', 'Corretor',
          'PAR-3: quem criou o contrato em outra cadeia (CB1a, imobiliária B) aparece genérico para a IA');
select pg_temp.entrar('ib');
select is(public.contrato_detalhe('e8000000-0000-4000-8000-000000000041'), null, 'a IB não vê o contrato do cliente da imobiliária A');
select pg_temp.entrar('ga2');
select is(public.contrato_detalhe('e8000000-0000-4000-8000-000000000042') -> 'criado_por' ->> 'nome', 'CA2a Corretor',
          'PAR-3: o gerente vê o nome do próprio corretor que criou o contrato');
-- filtro por produto (WP7, para o link "Ver contrato" do imóvel/unidade em NC), cruzado com o escopo
select is((public.contratos_listar(jsonb_build_object('unidade_id', 'e8000000-0000-4000-8000-000000000032')) ->> 'total')::int, 1,
          'contratos_listar {unidade_id}: o contrato do produto, para quem tem o cliente');
select is((public.contratos_listar(jsonb_build_object('unidade_id', 'e8000000-0000-4000-8000-000000000031')) ->> 'total')::int, 0,
          'contratos_listar {unidade_id}: produto de outra cadeia não aparece');
select is(pg_temp.erro($$select public.contratos_listar('{"imovel_id":"nao-e-uuid"}')$$) -> 'detalhe', '{"campos":["imovel_id"]}'::jsonb,
          'contratos_listar {imovel_id} inválido: DADOS_INVALIDOS {campos:[imovel_id]}');

-- ============ CONTRASTE: quem tem escopo continua vendo pelas RPCs ============
select ok(public.crm_ficha(pg_temp.cliente('c2')) -> 'cliente' ->> 'id' = pg_temp.cliente('c2')::text,
          'GA2 (gerente de B) lê a ficha de X');
select pg_temp.entrar('ca2a');
select ok(public.crm_ficha(pg_temp.cliente('c2')) is not null and public.contrato_detalhe('e8000000-0000-4000-8000-000000000042') is not null,
          'B (CA2a) lê a ficha e o contrato de X');
select pg_temp.entrar('admin');
select ok(public.crm_ficha(pg_temp.cliente('c2')) is not null, 'o admin lê a ficha de X (só pela RPC)');
select throws_ok($$select * from public.clientes$$, '42501', null, 'nem o admin lê clientes direto');
select pg_temp.entrar('titular_c1');
select is(public.portal_meus_dados() ->> 'id', pg_temp.cliente('c1')::text, 'o titular do portal lê só os próprios dados, pela RPC');
select is(public.crm_ficha(pg_temp.cliente('c2')), null, 'o titular não lê fichas do CRM');
select pg_temp.entrar_anon();
select throws_ok($$select public.crm_ficha('d0000000-0000-4000-8000-000000000002')$$, '42501', null, 'anon não executa crm_ficha');

-- ============ SESSÃO ABERTA DEPOIS DE INATIVADO (§4.5, última linha) ============
select pg_temp.entrar('ca1a');
select ok(public.escopo_corretor() = pg_temp.parceiro('ca1a') and public.crm_ficha(pg_temp.cliente('c1')) is not null,
          'antes: A tem escopo e lê a ficha de c1');
select pg_temp.sair();
update public.profiles set status_parceiro = 'inativo' where id = pg_temp.usuario('ca1a');
select pg_temp.entrar('ca1a');   -- a mesma sessão (o JWT ainda vale)
select ok(public.escopo_corretor() is null and public.meu_parceiro_id() is null and not public.pode_ver_cliente(pg_temp.cliente('c1')),
          'depois: os helpers exigem status aprovado a cada consulta e o escopo some na hora');
select is(public.crm_ficha(pg_temp.cliente('c1')), null, 'depois: nem a própria ficha de c1');
select throws_ok($$select public.crm_kanban('{}', 50)$$, '42501', null, 'depois: o kanban recusa (sem vínculo ativo)');
select pg_temp.sair();
select is(public.hook_token_acesso(jsonb_build_object('user_id', pg_temp.usuario('ca1a'), 'authentication_method', 'token_refresh',
                                                      'claims', '{}'::jsonb)) -> 'error' ->> 'message',
          'ACESSO_INATIVO', 'o hook recusa renovar a sessão do inativado');

select * from finish();
rollback;
