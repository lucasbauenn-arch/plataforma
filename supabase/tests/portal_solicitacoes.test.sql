-- Portal do cliente sem financeiro (migration 24): linha do tempo da compra (marcos que só a equipe grava; o titular
-- lê os seus por portal_linha_do_tempo) e solicitações (portal_solicitar / portal_solicitacoes; a equipe lista e
-- atende por crm_portal_*). Titular nunca vê dado de outro cliente; anon e parceiro negados; auditoria só com nomes
-- de campos; aviso à equipe sem o texto do pedido; limites por titular; texto livre some na anonimização.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(57);

-- ============ DADOS (como postgres) ============
-- segundo titular do portal: c2
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('a2400000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'cliente-d0000000-0000-4000-8000-000000000002@portal.arkenincorporadora.com.br', '{"nome":"Cliente Dois"}', now(), now());
update public.profiles set papel = 'cliente' where id = 'a2400000-0000-4000-8000-0000000000c2';
update public.clientes set user_id = 'a2400000-0000-4000-8000-0000000000c2', portal_liberado = true where id = pg_temp.cliente('c2');

create function pg_temp.entrar_titular2() returns text language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims',
    '{"sub":"a2400000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
  perform set_config('role', 'authenticated', true);
  return '';
end $$;

insert into public.empreendimentos (id, slug, nome, publicado) values
  ('e2400000-0000-4000-8000-000000000001', 'portal-residencial', 'Residencial Portal', true);
insert into public.unidades (id, empreendimento_id, identificador, valor, status) values
  ('e2400000-0000-4000-8000-000000000011', 'e2400000-0000-4000-8000-000000000001', 'APTO 31', 400000, 'disponivel'),
  ('e2400000-0000-4000-8000-000000000012', 'e2400000-0000-4000-8000-000000000001', 'APTO 32', 400000, 'disponivel');
insert into public.obra_atualizacoes (empreendimento_id, percentual, titulo, data) values
  ('e2400000-0000-4000-8000-000000000001', 20, 'Fundação', current_date - 30),
  ('e2400000-0000-4000-8000-000000000001', 45, 'Estrutura', current_date - 2);
-- contrato assinado do c1 na APTO 31 (data do marco "Contrato assinado" quando a equipe não registra)
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, parametros_id, valor_imovel, perc_aporte,
  valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte, valor_parcela, valor_total_parcelas,
  unidade_id, assinado_em)
select 'e2400000-0000-4000-8000-000000000031', pg_temp.cliente('c1'), public.modelo_vigente_id('parcelado'), 'parcelado',
       'assinado', public.parametros_vigente_id(), 400000, 30, 120000, 40000, 80000, 280000, 60, 8.5, 1500, 90000,
       'e2400000-0000-4000-8000-000000000011', timestamptz '2026-09-20 10:00:00-03';
insert into public.cliente_negocios (id, cliente_id, empreendimento_id, unidade_id, valor, contrato_id) values
  ('e2400000-0000-4000-8000-000000000041', pg_temp.cliente('c1'), 'e2400000-0000-4000-8000-000000000001',
   'e2400000-0000-4000-8000-000000000011', 400000, 'e2400000-0000-4000-8000-000000000031'),
  ('e2400000-0000-4000-8000-000000000042', pg_temp.cliente('c2'), 'e2400000-0000-4000-8000-000000000001',
   'e2400000-0000-4000-8000-000000000012', 400000, null);

create function pg_temp.neg(p text) returns uuid language sql immutable as $$
  select case p when 'c1' then 'e2400000-0000-4000-8000-000000000041'::uuid else 'e2400000-0000-4000-8000-000000000042'::uuid end
$$;
create function pg_temp.marco(p_neg uuid, p_tipo text) returns public.negocio_marcos language sql security definer as $$
  select m from public.negocio_marcos m where m.negocio_id = p_neg and m.tipo = p_tipo
$$;
create temp table t_ids (nome text primary key, id uuid);
grant select, insert on t_ids to authenticated;
create function pg_temp.sol(p_nome text) returns uuid language sql as $$ select id from t_ids where nome = p_nome $$;

-- ============ 1. GRANTS ============
select ok(not has_function_privilege('anon', 'public.portal_linha_do_tempo()', 'execute')
          and not has_function_privilege('anon', 'public.portal_solicitar(text, uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.portal_solicitacoes()', 'execute')
          and not has_function_privilege('anon', 'public.crm_portal_solicitacoes(jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.crm_portal_marco_salvar(uuid, text, date, date, text)', 'execute'),
          'anon não executa nenhuma RPC nova');
select ok(has_function_privilege('authenticated', 'public.portal_solicitar(text, uuid, text)', 'execute')
          and not has_function_privilege('service_role', 'public.portal_solicitar(text, uuid, text)', 'execute')
          and not has_function_privilege('service_role', 'public.crm_portal_marcos(uuid)', 'execute'),
          'RPCs de usuário: authenticated sim, service_role não');
select ok(not has_table_privilege('authenticated', 'public.negocio_marcos', 'select')
          and not has_table_privilege('authenticated', 'public.portal_solicitacoes', 'select')
          and not has_table_privilege('anon', 'public.portal_solicitacoes', 'select')
          and not has_any_column_privilege('authenticated', 'public.portal_solicitacoes', 'insert')
          and not has_any_column_privilege('authenticated', 'public.negocio_marcos', 'update'),
          'tabelas novas sem acesso direto pela API (só RPC)');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.negocio_marcos'::regclass, 'public.portal_solicitacoes'::regclass)), 'RLS ligada nas duas tabelas');
select pg_temp.entrar_anon();
select throws_ok($$select public.portal_solicitar('outro', null, 'oi')$$, '42501', null, 'anon: portal_solicitar negado');
select throws_ok($$select public.portal_linha_do_tempo()$$, '42501', null, 'anon: portal_linha_do_tempo negado');
select pg_temp.sair();

-- ============ 2. EQUIPE REGISTRA OS MARCOS ============
select pg_temp.entrar('admin');
select lives_ok($$select public.crm_portal_marco_salvar(pg_temp.neg('c1'), 'vistoria', date '2027-03-10', null, 'Agendar com a engenharia')$$,
                'admin registra a vistoria prevista');
select lives_ok($$select public.crm_portal_marco_salvar(pg_temp.neg('c1'), 'entrega_chaves', date '2027-04-01', null, null)$$,
                'admin registra a entrega prevista');
select lives_ok($$select public.crm_portal_marco_salvar(pg_temp.neg('c1'), 'obra', date '2027-02-01', null, null)$$,
                'admin registra a conclusão prevista da obra');
select lives_ok($$select public.crm_portal_marco_salvar(pg_temp.neg('c2'), 'vistoria', date '2027-05-05', null, 'Vistoria do c2')$$,
                'admin registra marco de outro cliente');
select is((pg_temp.erro($$select public.crm_portal_marco_salvar(pg_temp.neg('c1'), 'obra', null, current_date + 1, null)$$)) ->> 'mensagem',
          'A data realizada não pode estar no futuro.', 'data realizada no futuro: recusada');
select is((pg_temp.erro($$select public.crm_portal_marco_salvar(pg_temp.neg('c1'), 'boleto', current_date, null, null)$$)) -> 'detalhe',
          '{"campos":["tipo"]}'::jsonb, 'tipo de marco fora da lista: recusado');
select pg_temp.sair();
select ok((select m.data_prevista = date '2027-03-10' and m.observacao = 'Agendar com a engenharia' and m.criado_por = pg_temp.usuario('admin')
           from pg_temp.marco(pg_temp.neg('c1'), 'vistoria') m), 'marco gravado com autoria');
select ok(exists (select 1 from public.auditoria a where a.entidade = 'negocio_marcos' and a.acao = 'criar'
                    and a.cliente_id = pg_temp.cliente('c1') and a.ator_id = pg_temp.usuario('admin')
                    and a.campos = array['data_prevista', 'observacao'] and a::text not like '%engenharia%'),
          'auditoria do marco: só nomes de campos, nunca a observação');

select pg_temp.entrar('ca1a');
select throws_ok($$select public.crm_portal_marco_salvar(pg_temp.neg('c1'), 'vistoria', date '2027-01-01', null, null)$$,
                 '42501', 'Sem acesso a este registro', 'parceiro (mesmo o corretor do cliente) não grava marco');
select ok(public.crm_portal_marcos(pg_temp.cliente('c1')) is null, 'parceiro não lê os marcos da equipe (nulo)');
select pg_temp.sair();
select ok(exists (select 1 from public.auditoria a where a.acao = 'acesso_negado' and a.entidade = 'negocio_marcos'
                    and a.ator_id = pg_temp.usuario('ca1a')), 'negação registrada');
select pg_temp.entrar('titular_c1');
select throws_ok($$select public.crm_portal_marco_salvar(pg_temp.neg('c1'), 'vistoria', date '2027-01-01', null, null)$$,
                 '42501', 'Sem acesso a este registro', 'titular não grava marco');
select pg_temp.sair();

select pg_temp.entrar('admin');
select is(jsonb_array_length(public.crm_portal_marcos(pg_temp.cliente('c1'))), 1, 'equipe lê os negócios do cliente');
select ok((public.crm_portal_marcos(pg_temp.cliente('c1')) -> 0 -> 'marcos' -> 2) ? 'id', 'a equipe recebe o id do marco');
select pg_temp.sair();

-- ============ 3. TITULAR LÊ SÓ OS PRÓPRIOS MARCOS ============
create temp table t_linha (l jsonb);
grant insert on t_linha to authenticated;
select pg_temp.entrar('titular_c1');
insert into t_linha select public.portal_linha_do_tempo();
select pg_temp.sair();
select is((select jsonb_array_length(l) from t_linha), 1, 'titular vê só o próprio negócio');
select is((select l -> 0 ->> 'negocio_id' from t_linha), pg_temp.neg('c1')::text, 'é o negócio do titular');
select is((select l -> 0 ->> 'titulo' from t_linha), 'Residencial Portal — APTO 31', 'título do negócio');
select is((select l -> 0 -> 'obra_percentual' from t_linha), '45'::jsonb, 'último percentual publicado da obra');
select is((select jsonb_agg(m ->> 'tipo') from t_linha, jsonb_array_elements(l -> 0 -> 'marcos') m),
          '["contrato_assinado", "obra", "vistoria", "entrega_chaves"]'::jsonb, 'os quatro marcos, na ordem da compra');
select is((select l -> 0 -> 'marcos' -> 0 from t_linha),
          '{"tipo":"contrato_assinado","data_prevista":null,"data_realizada":"2026-09-20","origem":"contrato","observacao":null}'::jsonb,
          'contrato assinado: data lida do contrato, sem id nem autoria para o titular');
select is((select l -> 0 -> 'marcos' -> 2 ->> 'data_prevista' from t_linha), '2027-03-10', 'vistoria prevista registrada pela equipe');
select ok((select l::text not like '%Vistoria do c2%' and l::text not like '%' || pg_temp.neg('c2') || '%' from t_linha),
          'nada do outro cliente aparece');
select ok(exists (select 1 from public.auditoria a where a.entidade = 'negocio_marcos' and a.acao = 'listar'
                    and a.cliente_id = pg_temp.cliente('c1') and a.ator_id = pg_temp.usuario('titular_c1')),
          'leitura do titular auditada');

select pg_temp.entrar_titular2();
select is((select jsonb_agg(n ->> 'negocio_id') from jsonb_array_elements(public.portal_linha_do_tempo()) n),
          jsonb_build_array(pg_temp.neg('c2')::text), 'outro titular vê só o próprio negócio');
select pg_temp.sair();

-- parceiro (sem cliente do portal): lista vazia
select pg_temp.entrar('ca1a');
select is(public.portal_linha_do_tempo(), '[]'::jsonb, 'quem não é titular recebe lista vazia');
select pg_temp.sair();

-- apagar um marco (tudo nulo)
select pg_temp.entrar('admin');
select public.crm_portal_marco_salvar(pg_temp.neg('c1'), 'obra', null, null, null);
select pg_temp.sair();
select ok((select m.id is null from pg_temp.marco(pg_temp.neg('c1'), 'obra') m), 'tudo nulo apaga o marco');

-- ============ 4. SOLICITAÇÕES DO TITULAR ============
select pg_temp.entrar('titular_c1');
insert into t_ids select 'vistoria', public.portal_solicitar('agendar_vistoria', pg_temp.neg('c1'), '  Posso no sábado de manhã?  ');
select throws_ok($$select public.portal_solicitar('agendar_vistoria', pg_temp.neg('c2'), 'negócio de outro')$$,
                 '42501', 'Sem acesso a este registro', 'negócio de outro cliente: negado');
select is((pg_temp.erro($$select public.portal_solicitar('boleto_real', null, 'x')$$)) -> 'detalhe', '{"campos":["tipo"]}'::jsonb,
          'tipo fora da lista: recusado');
select is((pg_temp.erro($$select public.portal_solicitar('outro', null, '   ')$$)) -> 'detalhe', '{"campos":["mensagem"]}'::jsonb,
          '"outro" sem mensagem: recusado');
select pg_temp.sair();
select ok((select s.cliente_id = pg_temp.cliente('c1') and s.status = 'aberta' and s.mensagem = 'Posso no sábado de manhã?'
                  and s.criado_por = pg_temp.usuario('titular_c1') and s.negocio_id = pg_temp.neg('c1')
           from public.portal_solicitacoes s where s.id = pg_temp.sol('vistoria')), 'pedido gravado aberto, para o titular');
select ok(exists (select 1 from public.auditoria a where a.entidade = 'portal_solicitacoes' and a.acao = 'criar'
                    and a.entidade_id = pg_temp.sol('vistoria')::text and a.campos = array['tipo', 'negocio_id', 'mensagem']
                    and a::text not like '%sábado%'),
          'criação auditada só com nomes de campos');
select ok((select n.destinatarios_ids @> array[pg_temp.usuario('admin'), pg_temp.usuario('super')]
                  and not (n.destinatarios_ids && array[pg_temp.usuario('ca1a'), pg_temp.usuario('titular_c1')])
                  and n.dados = jsonb_build_object('solicitacao_id', pg_temp.sol('vistoria'),
                                                   'numero', (select numero from public.portal_solicitacoes where id = pg_temp.sol('vistoria')),
                                                   'tipo_solicitacao', 'agendar_vistoria')
           from public.notificacoes n where n.tipo = 'portal.solicitacao'),
          'equipe avisada (internos), sem o texto do pedido');

select pg_temp.entrar_titular2();
insert into t_ids select 'c2', public.portal_solicitar('duvida_contrato', null, 'Pedido do c2');
select is((select jsonb_agg(s ->> 'id') from jsonb_array_elements(public.portal_solicitacoes()) s),
          jsonb_build_array(pg_temp.sol('c2')::text), 'outro titular vê só o próprio pedido');
select pg_temp.sair();
select pg_temp.entrar('titular_c1');
select is((select jsonb_agg(s ->> 'id') from jsonb_array_elements(public.portal_solicitacoes()) s),
          jsonb_build_array(pg_temp.sol('vistoria')::text), 'titular vê só os próprios pedidos');
select is(public.portal_solicitacoes() -> 0 -> 'negocio' ->> 'titulo', 'Residencial Portal — APTO 31', 'pedido com o negócio');
select ok(not ((public.portal_solicitacoes() -> 0) ? 'cliente') and not ((public.portal_solicitacoes() -> 0) ? 'atualizado_por'),
          'o titular não recebe quem atendeu nem dados de cliente');
-- limites: 5 em 24 h
insert into t_ids select 'l2', public.portal_solicitar('segunda_via_boleto', null, null);
insert into t_ids select 'l3', public.portal_solicitar('antecipacao_parcelas', null, null);
insert into t_ids select 'l4', public.portal_solicitar('outro', null, 'quarto');
insert into t_ids select 'l5', public.portal_solicitar('outro', null, 'quinto');
select is((pg_temp.erro($$select public.portal_solicitar('outro', null, 'sexto')$$)) ->> 'mensagem',
          'Você já fez 5 solicitações nas últimas 24 horas. Aguarde o retorno da equipe.', 'limite de 5 pedidos em 24 h');
select pg_temp.sair();

-- ============ 5. EQUIPE ATENDE ============
select pg_temp.entrar('ca1a');
select throws_ok($$select public.crm_portal_solicitacoes('{}')$$, '42501', 'Sem acesso a este registro', 'parceiro não lista os pedidos');
select throws_ok($$select public.crm_portal_solicitacao_atualizar(pg_temp.sol('vistoria'), 'concluida', 'ok')$$, '42501',
                 'Sem acesso a este registro', 'parceiro não atende pedido');
select pg_temp.sair();
select pg_temp.entrar('titular_c1');
select throws_ok($$select public.crm_portal_solicitacoes('{}')$$, '42501', 'Sem acesso a este registro', 'titular não lista a fila da equipe');
select pg_temp.sair();

select pg_temp.entrar('admin');
select is((public.crm_portal_solicitacoes('{"abertas":true}') ->> 'total')::int, 6, 'equipe vê os pedidos abertos de todos');
select is(public.crm_portal_solicitacoes(jsonb_build_object('cliente_id', pg_temp.cliente('c1'), 'limite', 1)) -> 'itens' -> 0 -> 'cliente' ->> 'nome',
          'Cliente Um', 'filtro por cliente, com o nome para a equipe; a fila começa pelo mais antigo');
select lives_ok($$select public.crm_portal_solicitacao_atualizar(pg_temp.sol('vistoria'), 'em_atendimento', null)$$, 'em atendimento');
select is((pg_temp.erro($$select public.crm_portal_solicitacao_atualizar(pg_temp.sol('vistoria'), 'aberta', null)$$)) ->> 'mensagem',
          'TRANSICAO_INVALIDA', 'em atendimento não volta para aberta');
select is((pg_temp.erro($$select public.crm_portal_solicitacao_atualizar(pg_temp.sol('vistoria'), 'concluida', '  ')$$)) ->> 'mensagem',
          'Escreva a resposta ao cliente para concluir.', 'concluir exige resposta');
select lives_ok($$select public.crm_portal_solicitacao_atualizar(pg_temp.sol('vistoria'), 'concluida', 'Vistoria marcada para 10/03, 9h.')$$,
                'concluída com resposta');
select is((pg_temp.erro($$select public.crm_portal_solicitacao_atualizar(pg_temp.sol('vistoria'), 'em_atendimento', null)$$)) ->> 'mensagem',
          'Esta solicitação já foi concluída.', 'concluída é final');
select pg_temp.sair();
select ok(exists (select 1 from public.auditoria a where a.entidade = 'portal_solicitacoes' and a.acao = 'mudar_status'
                    and a.entidade_id = pg_temp.sol('vistoria')::text and a.antes = '{"status":"em_atendimento"}'::jsonb
                    and a.depois = '{"status":"concluida"}'::jsonb and a.campos = array['status', 'concluida_em', 'resposta']
                    and a::text not like '%10/03%'),
          'mudança de status auditada (antes/depois, sem o texto da resposta)');
select pg_temp.entrar('titular_c1');
select is((select s ->> 'status' || ' | ' || (s ->> 'resposta') from jsonb_array_elements(public.portal_solicitacoes()) s
           where s ->> 'id' = pg_temp.sol('vistoria')::text), 'concluida | Vistoria marcada para 10/03, 9h.',
          'titular vê o status e a resposta');
select pg_temp.sair();

-- ============ 6. ANONIMIZAÇÃO ============
select pg_temp.entrar('super');
select lives_ok($$select public.lgpd_anonimizar_cliente(pg_temp.cliente('c2'), 'LGPD-2026-001')$$, 'anonimização do c2');
select pg_temp.sair();
select ok((select s.mensagem = '[removido — LGPD]' from public.portal_solicitacoes s where s.id = pg_temp.sol('c2'))
          and (select m.observacao is null from pg_temp.marco(pg_temp.neg('c2'), 'vistoria') m),
          'anonimização remove o texto dos pedidos e das observações dos marcos');

select * from finish();
rollback;
