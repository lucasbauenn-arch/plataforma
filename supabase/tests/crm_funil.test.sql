-- CRM: funil e atividades [WP3] (docs/ARQUITETURA_EXPANSAO.md §1.1 F1–F4 e N13, §3.5, §3.8, §3.10, §4.3–§4.6, §7.3,
-- §8.5): todos os pares de transição do funil × papel; NC → DO falha; CI → DO cria os 4 documentos básicos sem
-- duplicar; PE sem motivo falha; reativar limpa o motivo; FI manual falha (N13); o Super liga uma volta de etapa;
-- kanban com o filtro cruzado com o escopo (§4.5) e PAR-3; timeline paginada; notas somente inclusão; responsável de
-- tarefa fora do escopo falha; a tarefa some de crm_minhas_tarefas depois da transferência e o novo dono trata as
-- órfãs; PAR-3 nunca ao lado nem em outra cadeia (transferência); documento: caminho,
-- autor, tamanho e MIME REAIS do Storage, análise por permissoes_rede (F4), reenvio, titular envia e não baixa.
-- Cada RPC: negada fora do escopo (escrita: 42501 com a mesma mensagem para inexistente; leitura: nulo + acesso_negado)
-- e auditada. Dados como postgres (fixture comum + o que está abaixo); só as RPCs deste pacote são chamadas.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(269);

-- ============ DADOS DESTE TESTE (como postgres) ============
-- colaborador (papel previsto, sem acesso nenhum)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-4000-8000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'colab@fixture.test', '{"nome":"Colaborador Fixture"}', now(), now());
update public.profiles set papel = 'colaborador', status_parceiro = 'aprovado' where id = 'a0000000-0000-4000-8000-000000000051';

-- c6: cliente do CA1a já inativado; c7: cliente do CA1a só para a matriz de transições
insert into public.clientes (id, nome, cpf, email, telefone, corretor_id, origem, portal_liberado) values
  ('d0000000-0000-4000-8000-000000000006', 'Cliente Seis', '12345671483', 'c6@cliente.test', '11900000006', pg_temp.parceiro('ca1a'), 'cadastro_interno', false),
  ('d0000000-0000-4000-8000-000000000007', 'Cliente Sete', '12345671564', 'c7@cliente.test', '11900000007', pg_temp.parceiro('ca1a'), 'cadastro_interno', false);
update public.clientes set inativado_em = now(), motivo_inativacao = 'fixture' where id = 'd0000000-0000-4000-8000-000000000006';

-- solicitações de documento com ids fixos (as do efeito CI → DO têm id aleatório)
--   01 c1 Holerite {pdf}     02 c1 Foto {jpeg,png}     03 c2 Holerite {pdf}     04 c1 Extrato {pdf,planilha}     05 c6 Holerite {pdf}
insert into public.cliente_documentos (id, cliente_id, nome, formatos_aceitos, criado_por) values
  ('f3000000-0000-4000-8000-000000000001', pg_temp.cliente('c1'), 'Holerite', '{pdf}', pg_temp.usuario('ca1a')),
  ('f3000000-0000-4000-8000-000000000002', pg_temp.cliente('c1'), 'Foto do imóvel', '{jpeg,png}', pg_temp.usuario('ca1a')),
  ('f3000000-0000-4000-8000-000000000003', pg_temp.cliente('c2'), 'Holerite', '{pdf}', pg_temp.usuario('ca2a')),
  ('f3000000-0000-4000-8000-000000000004', pg_temp.cliente('c1'), 'Extrato', '{pdf,planilha}', pg_temp.usuario('ca1a')),
  ('f3000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000006', 'Holerite', '{pdf}', pg_temp.usuario('ca1a'));

create function pg_temp.doc(n int) returns uuid language sql immutable as $$
  select ('f3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- caminho no bucket crm-documentos: <cliente_id>/<documento_id>/<uuid>.<ext>
create function pg_temp.obj(p_cliente uuid, p_doc int, p_arq int, p_ext text) returns text language sql immutable as $$
  select p_cliente || '/' || pg_temp.doc(p_doc) || '/e3000000-0000-4000-8000-' || lpad(p_arq::text, 12, '0') || '.' || p_ext
$$;

-- objetos como o Storage grava depois do upload (metadata.size e mimetype do servidor; owner/owner_id = quem enviou)
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
select 'crm-documentos', pg_temp.obj(pg_temp.cliente(o.cli), o.doc, o.arq, o.ext), pg_temp.usuario(o.dono),
       pg_temp.usuario(o.dono)::text, o.meta::jsonb
from (values
  ('c1', 1, 1,  'pdf', 'ca1a',       '{"size":1000,"mimetype":"application/pdf"}'),      -- válido (Holerite)
  ('c1', 2, 2,  'png', 'ca1a',       '{"size":6000000,"mimetype":"image/png"}'),         -- maior que 5 MB
  ('c1', 2, 3,  'png', 'ca1a',       '{"size":1000,"mimetype":"application/pdf"}'),      -- extensão × MIME
  ('c1', 2, 4,  'pdf', 'ca1a',       '{"size":1000,"mimetype":"application/pdf"}'),      -- formato não aceito
  ('c1', 2, 5,  'png', 'ga1',        '{"size":1000,"mimetype":"image/png"}'),            -- enviado por outro
  ('c1', 1, 6,  'pdf', 'ca1a',       '{"size":1500,"mimetype":"application/pdf"}'),      -- reenvio do Holerite
  ('c1', 4, 7,  'pdf', 'titular_c1', '{"size":800,"mimetype":"application/pdf"}'),       -- titular pelo portal
  ('c2', 3, 8,  'pdf', 'titular_c1', '{"size":800,"mimetype":"application/pdf"}'),       -- titular em cliente alheio
  ('c1', 2, 10, 'png', 'ca1a',       '{"size":1000,"mimetype":"image/png"}'),            -- limite configurado menor
  ('c1', 2, 11, 'jpg', 'ca1a',       '{"size":2000,"mimetype":"image/jpeg; charset=binary"}') -- válido (Foto)
) as o(cli, doc, arq, ext, dono, meta);
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('crm-documentos', pg_temp.obj(pg_temp.cliente('c1'), 2, 9, 'png'), pg_temp.usuario('ca1a'), pg_temp.usuario('ca1a')::text, null);

-- imóvel aprovado e contrato em rascunho do c1 (documento de contrato)
insert into public.imoveis (id, nome, tipo, status, cep, uf, cidade, logradouro, numero, valor, criado_por) values
  ('e3000000-0000-4000-8000-000000000101', 'Casa do contrato', 'casa', 'aprovado', '01310100', 'SP', 'São Paulo',
   'Avenida Paulista', '1000', 500000, pg_temp.usuario('admin'));
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, imovel_id, parametros_id, valor_imovel,
  perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte, valor_parcela,
  valor_total_parcelas)
values ('e3000000-0000-4000-8000-000000000201', pg_temp.cliente('c1'), public.modelo_vigente_id('parcelado'), 'parcelado',
        'rascunho', 'e3000000-0000-4000-8000-000000000101', public.parametros_vigente_id(),
        500000, 30, 150000, 50000, 100000, 350000, 60, 8.5, 1808.33, 108499.80);

-- ============ AJUDANTES ============
-- ids gerados pelas RPCs, guardados por quem chamou (authenticated) para os passos seguintes
create temp table t_ids (chave text primary key, valor uuid not null);
grant select, insert on t_ids to authenticated;
create function pg_temp.id(p text) returns uuid language sql as $$ select valor from t_ids where chave = p $$;

create function pg_temp.entrar_colab() returns text language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000051","role":"authenticated","aal":"aal1"}', true);
  perform set_config('role', 'authenticated', true);
  return '';
end $$;

-- última linha da auditoria, sem ip/user_agent (chame como postgres)
create function pg_temp.aud() returns jsonb language sql as $$
  select to_jsonb(a) - 'ip' - 'user_agent' - 'id' - 'ocorrido_em' from public.auditoria a order by a.id desc limit 1
$$;
create function pg_temp.conta_aud() returns int language sql as $$ select count(*)::int from public.auditoria $$;
create function pg_temp.etapa(p uuid) returns text language sql as $$ select etapa::text from public.clientes where id = p $$;
create function pg_temp.eventos(p uuid, p_tipo text) returns int language sql as $$
  select count(*)::int from public.cliente_eventos e where e.cliente_id = p and e.tipo = p_tipo
$$;
create function pg_temp.hoje() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
-- ids de uma coluna do kanban (no formato devolvido)
create function pg_temp.col(p jsonb, p_etapa text) returns uuid[] language sql as $$
  select coalesce(array_agg((i ->> 'id')::uuid order by o), '{}')
  from jsonb_array_elements(p -> 'colunas') c, jsonb_array_elements(c -> 'itens') with ordinality as x(i, o)
  where c ->> 'etapa' = p_etapa
$$;
create function pg_temp.col_total(p jsonb, p_etapa text) returns int language sql as $$
  select (c ->> 'total')::int from jsonb_array_elements(p -> 'colunas') c where c ->> 'etapa' = p_etapa
$$;
create function pg_temp.status_doc(n int) returns text language sql as $$
  select status::text from public.cliente_documentos where id = pg_temp.doc(n)
$$;

-- ============ GRANTS ============
select ok(bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('anon', p.oid, 'execute')
                   and not has_function_privilege('service_role', p.oid, 'execute'))
          and count(*) = 18,
          'as 18 RPCs do funil: só authenticated executa (grants da 09 preservados)')
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('crm_kanban', 'crm_kanban_coluna', 'crm_mudar_etapa', 'crm_timeline', 'crm_notas', 'crm_tarefas',
                    'crm_documentos', 'crm_nota_criar', 'crm_tarefa_criar', 'crm_tarefa_editar', 'crm_tarefa_concluir',
                    'crm_responsaveis', 'crm_minhas_tarefas', 'crm_documento_solicitar', 'crm_documento_cancelar',
                    'crm_documento_registrar_envio', 'crm_documento_analisar', 'crm_documento_baixar');
select ok(bool_and(not has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('anon', p.oid, 'execute')
                   and not has_function_privilege('service_role', p.oid, 'execute')
                   and p.proconfig @> array['search_path=""']) and count(*) = 18,
          'as 18 funções internas _funil_*: ninguém executa pela API; search_path vazio')
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_funil\_%';
select ok(bool_and(p.provolatile = 'v' and p.prosecdef), 'as RPCs do funil são volatile e security definer')
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname ~ '^crm_(kanban|kanban_coluna|mudar_etapa|timeline|notas|tarefas|documentos|nota_criar|tarefa_criar|tarefa_editar|tarefa_concluir|responsaveis|minhas_tarefas|documento_solicitar|documento_cancelar|documento_registrar_envio|documento_analisar|documento_baixar)$';

-- ============ KANBAN (§7.3, §4.5) ============
select pg_temp.entrar('ca1a');
select is((select array_agg(c ->> 'etapa' order by o) from jsonb_array_elements(public.crm_kanban('{}', 50) -> 'colunas') with ordinality as x(c, o)),
          array['novo_contato', 'contato_iniciado', 'documentacao', 'finalizado', 'perdido'],
          'kanban: as 5 colunas na ordem do funil, Perdidos por último');
select is(pg_temp.col(public.crm_kanban('{}', 50), 'novo_contato'), array[pg_temp.cliente('c1'), 'd0000000-0000-4000-8000-000000000007'::uuid],
          'CA1a: só os próprios clientes ativos (c1 e c7; o c6 inativado fica de fora)');
select is((select i - 'etapa_desde' from jsonb_array_elements(public.crm_kanban('{}', 50) -> 'colunas') c, jsonb_array_elements(c -> 'itens') i
           where i ->> 'id' = pg_temp.cliente('c1')::text),
          jsonb_build_object('id', pg_temp.cliente('c1'), 'nome', 'Cliente Um', 'telefone', '11900000001', 'corretor', null,
                             'etapa', 'novo_contato', 'dias_na_etapa', 0, 'documentos_pendentes', 3, 'tarefa_atrasada', false,
                             'motivo_perda', null),
          'cartão: nome, telefone só com dígitos, dias na etapa, documentos pendentes; sem corretor para o próprio corretor');
select is(pg_temp.col(public.crm_kanban(jsonb_build_object('corretor_id', pg_temp.parceiro('ca2a')), 50), 'novo_contato'), '{}'::uuid[],
          '§4.5: CA1a filtrando pelo corretor CA2a não recebe nada (o filtro é cruzado com o escopo)');
select is(pg_temp.col(public.crm_kanban(jsonb_build_object('imobiliaria_id', pg_temp.imobiliaria('b')), 50), 'novo_contato'), '{}'::uuid[],
          'nem filtrando pela imobiliária B');

select pg_temp.entrar('ga1');
select is(pg_temp.col(public.crm_kanban('{}', 50), 'novo_contato'),
          array[pg_temp.cliente('c1'), pg_temp.cliente('c4'), pg_temp.cliente('c5'), 'd0000000-0000-4000-8000-000000000007'::uuid],
          'GA1: a equipe inteira (c1, c4 do A1, c5 do corretor bloqueado e c7)');
select is((select i -> 'corretor' from jsonb_array_elements(public.crm_kanban('{}', 50) -> 'colunas') c, jsonb_array_elements(c -> 'itens') i
           where i ->> 'id' = pg_temp.cliente('c1')::text),
          jsonb_build_object('id', pg_temp.parceiro('ca1a'), 'nome', 'CA1a Corretor'), 'para o gestor, o cartão traz o corretor');
select is(pg_temp.col(public.crm_kanban(jsonb_build_object('corretor_id', pg_temp.parceiro('ca1a')), 50), 'novo_contato'),
          array[pg_temp.cliente('c1'), 'd0000000-0000-4000-8000-000000000007'::uuid], 'GA1 filtrando pelo CA1a');
select is(pg_temp.col(public.crm_kanban('{"so_meus":true}', 50), 'novo_contato'), array[pg_temp.cliente('c4')],
          '"só os meus" do gerente = os clientes dele como corretor (A1)');
select is(pg_temp.col(public.crm_kanban('{"busca":"QUATRO"}', 50), 'novo_contato'), array[pg_temp.cliente('c4')], 'busca por nome, sem distinguir maiúsculas');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'listar', 'entidade', 'clientes', 'ator_id', pg_temp.usuario('ga1'),
                                              'detalhe', jsonb_build_object('rpc', 'crm_kanban', 'ids', jsonb_build_array(pg_temp.cliente('c4')),
                                                                            'filtros', jsonb_build_object('busca', true)))
          and (pg_temp.aud() ->> 'detalhe') !~* 'quatro',
          'kanban audita acesso/listar com os ids devolvidos; a busca vira {busca:true}, nunca o texto');
select pg_temp.entrar('ga1');
select is((public.crm_kanban('{}', 1) #> '{colunas,0}') - 'itens', '{"etapa":"novo_contato","total":4}'::jsonb, 'p_limite_coluna: o total é da etapa inteira');
select is(jsonb_array_length(public.crm_kanban('{}', 1) #> '{colunas,0,itens}'), 1, 'com até p_limite_coluna cartões');

select is((select array_agg((i ->> 'id')::uuid order by o) from jsonb_array_elements(public.crm_kanban_coluna('novo_contato', '{}', 1) -> 'itens') with ordinality as x(i, o)),
          array[pg_temp.cliente('c4'), pg_temp.cliente('c5'), 'd0000000-0000-4000-8000-000000000007'::uuid],
          'crm_kanban_coluna: "Ver mais" a partir do offset');
select is(public.crm_kanban_coluna('novo_contato', '{}', 1) - 'itens', '{"etapa":"novo_contato","total":4}'::jsonb, 'crm_kanban_coluna: etapa e total');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'listar', 'entidade', 'clientes', 'ator_id', pg_temp.usuario('ga1'),
                                              'detalhe', jsonb_build_object('rpc', 'crm_kanban_coluna', 'etapa', 'novo_contato', 'offset', 1)),
          'crm_kanban_coluna audita acesso/listar');

select pg_temp.entrar('ia');
select is(pg_temp.col(public.crm_kanban('{}', 50), 'novo_contato'),
          array[pg_temp.cliente('c1'), pg_temp.cliente('c2'), pg_temp.cliente('c4'), pg_temp.cliente('c5'), 'd0000000-0000-4000-8000-000000000007'::uuid],
          'IA: a imobiliária A inteira');
select pg_temp.entrar('ib');
select is(pg_temp.col(public.crm_kanban('{}', 50), 'novo_contato'), array[pg_temp.cliente('c3')], 'IB: só a imobiliária B');
select pg_temp.entrar('admin');
select is(public.crm_kanban('{}', 50) -> 'contadores', '{"total":6,"finalizados":0,"perdidos":0}'::jsonb, 'admin: contadores de todos os clientes ativos');
select is(pg_temp.col_total(public.crm_kanban('{"busca":"%"}', 50), 'novo_contato'), 0, 'busca com % é literal (escapada)');

select pg_temp.entrar('pendente');
select throws_ok($$select public.crm_kanban('{}', 50)$$, '42501', 'Sem acesso a este registro', 'autocadastro pendente: sem kanban');
select pg_temp.entrar('bloqueado');
select throws_ok($$select public.crm_kanban('{}', 50)$$, '42501', 'Sem acesso a este registro', 'bloqueado: sem kanban');
select throws_ok($$select public.crm_kanban_coluna('novo_contato', '{}', 0)$$, '42501', 'Sem acesso a este registro', 'bloqueado: sem "ver mais"');
select pg_temp.entrar('inativo');
select throws_ok($$select public.crm_kanban('{}', 50)$$, '42501', 'Sem acesso a este registro', 'inativo: sem kanban');
select pg_temp.entrar('titular_c1');
select throws_ok($$select public.crm_kanban('{}', 50)$$, '42501', 'Sem acesso a este registro', 'titular do portal: sem kanban');
select pg_temp.entrar_colab();
select throws_ok($$select public.crm_kanban('{}', 50)$$, '42501', 'Sem acesso a este registro', 'colaborador: sem kanban');
select pg_temp.entrar_anon();
select throws_ok($$select public.crm_kanban('{}', 50)$$, '42501', null, 'visitante não executa');

select pg_temp.entrar('ca1a');
select is(pg_temp.erro($$select public.crm_kanban('{"corretor_id":"abc"}', 50)$$),
          '{"sqlstate":"P0001","mensagem":"DADOS_INVALIDOS","detalhe":{"campos":["corretor_id"]}}'::jsonb, 'filtro com uuid inválido: DADOS_INVALIDOS');
select is(pg_temp.erro($$select public.crm_kanban('[]', 50)$$) ->> 'mensagem', 'DADOS_INVALIDOS', 'p_filtros precisa ser objeto');
select is(pg_temp.erro($$select public.crm_kanban('{"periodo_de":"2026-09-10","periodo_ate":"2026-09-01"}', 50)$$) ->> 'mensagem', 'DADOS_INVALIDOS',
          'período invertido: DADOS_INVALIDOS');

-- H5: interno sem 2FA quando exigida não é interno
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = true;
select pg_temp.entrar('admin');
select throws_ok($$select public.crm_kanban('{}', 50)$$, '42501', 'Sem acesso a este registro', 'admin em aal1 com 2FA exigida: sem kanban');
select pg_temp.entrar('admin', 'aal2');
select is((public.crm_kanban('{}', 50) #>> '{contadores,total}')::int, 6, 'admin em aal2: kanban completo');
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = false;

-- ============ MATRIZ: TODOS OS PARES DO FUNIL × PAPEL (§3.8, F1, F2, N13) ============
-- c7 (do CA1a) posto em cada etapa como postgres; cada papel tenta cada destino com motivo.
create temp table t_matriz (quem text, de text, para text, resultado text);
create function pg_temp.matriz() returns void language plpgsql as $$
declare
  v_quem text;
  v_de public.etapa_funil;
  v_para public.etapa_funil;
  v_r jsonb;
begin
  foreach v_quem in array array['ca1a', 'ga1', 'ia', 'admin', 'super', 'ca2a', 'ib', 'gb1', 'bloqueado', 'inativo', 'pendente', 'titular_c1', 'colab'] loop
    foreach v_de in array enum_range(null::public.etapa_funil) loop
      foreach v_para in array enum_range(null::public.etapa_funil) loop
        continue when v_de = v_para;
        perform pg_temp.sair();
        update public.clientes set etapa = v_de, etapa_desde = now(), motivo_perda = case when v_de = 'perdido' then 'fixture' end
         where id = 'd0000000-0000-4000-8000-000000000007';
        if v_quem = 'colab' then perform pg_temp.entrar_colab(); else perform pg_temp.entrar(v_quem); end if;
        v_r := pg_temp.erro(format('select public.crm_mudar_etapa(%L, %L, %L)', 'd0000000-0000-4000-8000-000000000007', v_para, 'motivo do teste'));
        perform pg_temp.sair();
        insert into t_matriz values (v_quem, v_de, v_para,
          case when v_r is null then 'ok' when v_r ->> 'sqlstate' = '42501' then '42501' else v_r ->> 'mensagem' end);
      end loop;
    end loop;
  end loop;
end $$;
select pg_temp.matriz();

select is((select array_agg(quem || ':' || de || '>' || para order by quem, de, para) from t_matriz where resultado = 'ok'),
          (select array_agg(q || ':' || t.de || '>' || t.para order by q, t.de, t.para)
           from unnest(array['ca1a', 'ga1', 'ia', 'admin', 'super']) q,
                (values ('novo_contato', 'contato_iniciado'), ('contato_iniciado', 'documentacao'), ('novo_contato', 'perdido'),
                        ('contato_iniciado', 'perdido'), ('documentacao', 'perdido'), ('perdido', 'novo_contato')) as t(de, para)),
          'matriz: só NC→CI, CI→DO, NC/CI/DO→PE e PE→NC, e só para corretor, gerente, imobiliária e internos com escopo');
select is((select array_agg(distinct resultado) from t_matriz where quem in ('ca1a', 'ga1', 'ia', 'admin', 'super') and resultado <> 'ok'),
          array['TRANSICAO_INVALIDA'], 'com escopo, os demais pares dão TRANSICAO_INVALIDA (inclusive voltar de etapa e FI manual)');
select is((select array_agg(distinct resultado) from t_matriz where quem not in ('ca1a', 'ga1', 'ia', 'admin', 'super')),
          array['42501'], 'sem escopo (outra equipe, outra imobiliária, bloqueado, inativo, pendente, titular, colaborador): sempre 42501');
select is((select count(*)::int from t_matriz where para = 'finalizado' and resultado = 'ok'), 0, 'N13: ninguém leva a FI manualmente');

-- o Super liga uma volta de etapa (F2): CI → NC passa a valer para quem tem escopo
select pg_temp.entrar('super');
update public.status_transicoes set ativa = true where entidade = 'cliente_etapa' and de = 'contato_iniciado' and para = 'novo_contato';
select pg_temp.sair();
update public.clientes set etapa = 'contato_iniciado' where id = 'd0000000-0000-4000-8000-000000000007';
select pg_temp.entrar('ca1a');
select is(public.crm_mudar_etapa('d0000000-0000-4000-8000-000000000007', 'novo_contato', null) ->> 'para', 'novo_contato',
          'com a linha ligada pelo Super, CI → NC passa');
select pg_temp.sair();
update public.status_transicoes set ativa = false where entidade = 'cliente_etapa' and de = 'contato_iniciado' and para = 'novo_contato';
update public.clientes set inativado_em = now() where id = 'd0000000-0000-4000-8000-000000000007';  -- fora do kanban daqui em diante

-- ============ MUDAR ETAPA NO c1 (F1, F2, CRM-3) ============
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.crm_mudar_etapa(%L, ''documentacao'', null)', pg_temp.cliente('c1'))),
          '{"sqlstate":"P0001","mensagem":"TRANSICAO_INVALIDA","detalhe":{"entidade":"cliente_etapa","de":"novo_contato","para":"documentacao"}}'::jsonb,
          'NC → DO falha com TRANSICAO_INVALIDA e o par no detalhe');
select is(pg_temp.erro(format('select public.crm_mudar_etapa(%L, ''finalizado'', null)', pg_temp.cliente('c1'))) ->> 'mensagem', 'TRANSICAO_INVALIDA',
          'FI manual falha (só o contrato assinado leva a FI)');
select is(public.crm_mudar_etapa(pg_temp.cliente('c1'), 'contato_iniciado', null) - 'etapa_desde',
          '{"de":"novo_contato","para":"contato_iniciado","documentos_solicitados":[]}'::jsonb, 'NC → CI: devolve de, para e nenhum documento');
select pg_temp.sair();
select is(pg_temp.etapa(pg_temp.cliente('c1')), 'contato_iniciado', 'c1 em contato iniciado');
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'operacao', 'acao', 'mudar_status', 'entidade', 'clientes',
                                              'entidade_id', pg_temp.cliente('c1'), 'cliente_id', pg_temp.cliente('c1'), 'ator_id', pg_temp.usuario('ca1a'),
                                              'antes', '{"etapa":"novo_contato"}'::jsonb, 'depois', '{"etapa":"contato_iniciado"}'::jsonb),
          'mudança de etapa auditada (operacao/mudar_status, antes e depois)');
select is((select dados from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'etapa' order by id desc limit 1),
          '{"de":"novo_contato","para":"contato_iniciado","motivo":null}'::jsonb, 'timeline "etapa" com de e para');
select is((select count(*)::int from public.historico_status where entidade = 'cliente_etapa' and entidade_id = pg_temp.cliente('c1')
             and de = 'novo_contato' and para = 'contato_iniciado' and origem = 'usuario' and ator_id = pg_temp.usuario('ca1a')), 1,
          'historico_status gravado pela transição');

select pg_temp.entrar('ca1a');
select is(public.crm_mudar_etapa(pg_temp.cliente('c1'), 'documentacao', null) -> 'documentos_solicitados',
          '["CPF","CNH","Comprovante de residência","Comprovante de renda"]'::jsonb,
          'CI → DO cria as 4 solicitações básicas (CRM-3), na ordem da configuração');
select pg_temp.sair();
select is((select count(*)::int from public.cliente_documentos where cliente_id = pg_temp.cliente('c1') and basico and inativado_em is null), 4,
          'c1 com 4 documentos básicos');
select is(pg_temp.eventos(pg_temp.cliente('c1'), 'documento_solicitado'), 4, 'uma linha de timeline por documento solicitado');

select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.crm_mudar_etapa(%L, ''perdido'', null)', pg_temp.cliente('c1'))) ->> 'mensagem', 'MOTIVO_OBRIGATORIO',
          'DO → PE sem motivo falha');
select is(pg_temp.erro(format('select public.crm_mudar_etapa(%L, ''perdido'', ''ab'')', pg_temp.cliente('c1'))) ->> 'mensagem', 'MOTIVO_OBRIGATORIO',
          'motivo curto demais também');
select is(public.crm_mudar_etapa(pg_temp.cliente('c1'), 'perdido', '  Cliente desistiu da compra  ') ->> 'para', 'perdido', 'DO → PE com motivo');
select pg_temp.sair();
select is((select motivo_perda from public.clientes where id = pg_temp.cliente('c1')), 'Cliente desistiu da compra', 'motivo da perda gravado');
select ok(pg_temp.aud() @> '{"campos":["etapa","etapa_desde","motivo_perda"],"detalhe":{"com_motivo":true}}'::jsonb
          and pg_temp.aud()::text !~ 'desistiu', 'a auditoria marca que houve motivo sem guardar o texto');
select is((select dados ->> 'motivo' from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'etapa' order by id desc limit 1),
          'Cliente desistiu da compra', 'o motivo vai para a timeline');

select pg_temp.entrar('admin');
select is(public.crm_kanban('{}', 50) -> 'contadores', '{"total":5,"finalizados":0,"perdidos":1}'::jsonb, 'contadores: 1 perdido');
select is(public.crm_kanban(jsonb_build_object('periodo_de', pg_temp.hoje()), 50) #>> '{contadores,perdidos}', '1', 'perdidos no período de hoje');
select is(public.crm_kanban(jsonb_build_object('periodo_ate', pg_temp.hoje() - 1), 50) #>> '{contadores,perdidos}', '0', 'nenhum perdido até ontem');
select is((select i ->> 'motivo_perda' from jsonb_array_elements(public.crm_kanban('{}', 50) -> 'colunas') c, jsonb_array_elements(c -> 'itens') i
           where i ->> 'id' = pg_temp.cliente('c1')::text), 'Cliente desistiu da compra', 'o cartão em Perdidos traz o motivo');

select pg_temp.entrar('ga1');
select is(public.crm_mudar_etapa(pg_temp.cliente('c1'), 'novo_contato', null) - 'etapa_desde',
          '{"de":"perdido","para":"novo_contato","documentos_solicitados":[]}'::jsonb, 'PE → NC (reativar) pelo gerente');
select pg_temp.sair();
select is((select motivo_perda from public.clientes where id = pg_temp.cliente('c1')), null, 'reativar limpa o motivo da perda');

select pg_temp.entrar('ia');
select is(public.crm_mudar_etapa(pg_temp.cliente('c1'), 'contato_iniciado', null) ->> 'para', 'contato_iniciado', 'NC → CI pela imobiliária');
select is(public.crm_mudar_etapa(pg_temp.cliente('c1'), 'documentacao', null) -> 'documentos_solicitados', '[]'::jsonb,
          'CI → DO de novo: nenhum documento novo');
select pg_temp.sair();
select is((select count(*)::int from public.cliente_documentos where cliente_id = pg_temp.cliente('c1') and basico and inativado_em is null), 4,
          'CI → DO repetido não duplica os básicos');

select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_mudar_etapa(%L, ''perdido'', ''motivo qualquer'')', pg_temp.cliente('c1')),
                 '42501', 'Sem acesso a este registro', 'CA2a não muda a etapa do cliente do CA1a');
select throws_ok($$select public.crm_mudar_etapa('d0000000-0000-4000-8000-0000000000ff', 'perdido', 'motivo qualquer')$$,
                 '42501', 'Sem acesso a este registro', 'cliente inexistente: a mesma mensagem');
select pg_temp.entrar('admin');
select throws_ok($$select public.crm_mudar_etapa('d0000000-0000-4000-8000-000000000006', 'contato_iniciado', null)$$,
                 'P0001', 'Cliente inativo não muda de etapa.', 'cliente inativado não muda de etapa (nem pelo interno)');

-- ============ TIMELINE (F3) ============
select pg_temp.sair();
insert into public.cliente_eventos (cliente_id, tipo, titulo, dados, ator_id, ocorrido_em)
select pg_temp.cliente('c2'), e.tipo, e.titulo, e.dados::jsonb, case when e.ator is not null then pg_temp.usuario(e.ator) end,
       now() - make_interval(days => e.dias)
from (values
  ('nota',                'Nota adicionada', '{"nota_id":"f4000000-0000-4000-8000-000000000001"}', 'ca2a',  1),
  ('etapa',               'Etapa: Contato iniciado', '{"de":"novo_contato","para":"contato_iniciado","motivo":null}', 'ga2', 2),
  ('tentativa_duplicada', 'Tentativa de cadastro duplicado', '{"resultado":"bloqueado_exclusividade"}', 'cb1a', 3),
  ('nota',                'Nota adicionada', '{"nota_id":"f4000000-0000-4000-8000-000000000002"}', 'admin', 4),
  ('cadastro',            'Cadastro', '{"origem":"cadastro_interno"}', null, 5)
) as e(tipo, titulo, dados, ator, dias);
insert into public.cliente_eventos (cliente_id, tipo, titulo, dados, ator_id)
select pg_temp.cliente('c3'), 'nota', 'Nota adicionada', '{}', pg_temp.usuario('cb1a') from generate_series(1, 3);
create temp table t_ev_cadastro as select id, ocorrido_em from public.cliente_eventos where cliente_id = pg_temp.cliente('c2') and tipo = 'cadastro';
grant select on t_ev_cadastro to authenticated;

select pg_temp.entrar('ca2a');
select is((select jsonb_agg(jsonb_build_object('tipo', i ->> 'tipo', 'ator', i ->> 'ator_nome', 'papel', i ->> 'ator_papel')) from jsonb_array_elements(public.crm_timeline(pg_temp.cliente('c2'), null, 2) -> 'itens') i),
          '[{"tipo":"nota","ator":"CA2a Corretor","papel":"corretor"},{"tipo":"etapa","ator":"Gerência","papel":"gerente"}]'::jsonb,
          'timeline: do mais novo ao mais antigo; o gerente acima do corretor aparece como "Gerência" (PAR-3)');
select is(public.crm_timeline(pg_temp.cliente('c2'), null, 2) -> 'mais', 'true'::jsonb, 'há eventos mais antigos');
select is((select jsonb_agg(jsonb_build_object('tipo', i ->> 'tipo', 'ator', i ->> 'ator_nome', 'papel', i ->> 'ator_papel'))
           from jsonb_array_elements(public.crm_timeline(pg_temp.cliente('c2'),
                  (public.crm_timeline(pg_temp.cliente('c2'), null, 2) #>> '{itens,1,ocorrido_em}')::timestamptz, 2) -> 'itens') i),
          '[{"tipo":"tentativa_duplicada","ator":null,"papel":null},{"tipo":"nota","ator":"Equipe Arken","papel":"admin"}]'::jsonb,
          'p_antes pagina; a tentativa duplicada não revela quem tentou; interno aparece como "Equipe Arken"');
select is(public.crm_timeline(pg_temp.cliente('c2'), now() - interval '4 days 12 hours', 2),
          jsonb_build_object('itens', jsonb_build_array(jsonb_build_object(
            'id', (select id from t_ev_cadastro),
            'tipo', 'cadastro', 'titulo', 'Cadastro', 'ator_nome', null, 'ator_papel', null, 'dados', '{"origem":"cadastro_interno"}'::jsonb,
            'ocorrido_em', (select ocorrido_em from t_ev_cadastro))),
            'mais', false),
          'última página: formato completo do evento e mais = false');
select pg_temp.entrar('ga2');
select is((public.crm_timeline(pg_temp.cliente('c2'), null, 1) #>> '{itens,0,ator_nome}'), 'CA2a Corretor', 'o gerente vê o nome do corretor abaixo');
select pg_temp.entrar('admin');
select is((select i ->> 'ator_nome' from jsonb_array_elements(public.crm_timeline(pg_temp.cliente('c2'), null, 30) -> 'itens') i where i ->> 'tipo' = 'tentativa_duplicada'),
          'CB1a Corretor', 'o interno vê quem tentou o cadastro duplicado');
select pg_temp.entrar('cb1a');
select is(jsonb_array_length(public.crm_timeline(pg_temp.cliente('c3'), null, 2) -> 'itens'), 3,
          'a página não corta eventos do mesmo instante (vem maior que p_limite)');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'consultar', 'entidade', 'cliente_eventos',
                                              'entidade_id', pg_temp.cliente('c3'), 'cliente_id', pg_temp.cliente('c3'), 'ator_id', pg_temp.usuario('cb1a')),
          'crm_timeline audita acesso/consultar com o cliente');
select pg_temp.entrar('ca1a');
select is(public.crm_timeline(pg_temp.cliente('c2'), null, 30), null, 'fora do escopo: nulo');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'acesso_negado', 'entidade', 'cliente_eventos',
                                              'cliente_id', pg_temp.cliente('c2'), 'ator_id', pg_temp.usuario('ca1a')),
          'e grava acesso_negado com o cliente e o ator');
select pg_temp.entrar('ca1a');
select ok((select bool_or(i ->> 'tipo' = 'etapa') and bool_or(i ->> 'tipo' = 'documento_solicitado')
           from jsonb_array_elements(public.crm_timeline(pg_temp.cliente('c1'), null, 100) -> 'itens') i),
          'CA1a vê a timeline do c1 (etapas e documentos solicitados)');

-- ============ NOTAS (§3.5: somente inclusão) ============
select pg_temp.entrar('ca1a');
insert into t_ids values ('nota_ca1a', public.crm_nota_criar(pg_temp.cliente('c1'), '  Cliente prefere contato à tarde <b>ok</b>  '));
select pg_temp.entrar('ga1');
insert into t_ids values ('nota_ga1', public.crm_nota_criar(pg_temp.cliente('c1'), 'Nota do GA1'));
select pg_temp.entrar('ia');
insert into t_ids values ('nota_ia', public.crm_nota_criar(pg_temp.cliente('c1'), 'Nota da IA'));
select pg_temp.entrar('admin');
insert into t_ids values ('nota_admin', public.crm_nota_criar(pg_temp.cliente('c1'), 'Nota da equipe'));
select pg_temp.sair();
select is((select texto from public.cliente_notas where id = pg_temp.id('nota_ca1a')), 'Cliente prefere contato à tarde <b>ok</b>',
          'nota gravada sem espaços nas pontas (o HTML é escapado só na exibição)');
select is((select autor_id from public.cliente_notas where id = pg_temp.id('nota_ca1a')), pg_temp.usuario('ca1a'), 'autor = quem chamou');
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'operacao', 'acao', 'criar', 'entidade', 'cliente_notas',
                                              'entidade_id', pg_temp.id('nota_admin'), 'cliente_id', pg_temp.cliente('c1'), 'campos', array['texto'])
          and pg_temp.aud()::text !~ 'Nota da equipe', 'nota auditada (operacao/criar, só o nome do campo)');
select is((select dados from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'nota' order by id desc limit 1),
          jsonb_build_object('nota_id', pg_temp.id('nota_admin')), 'timeline "nota" só com o id');

select pg_temp.entrar('ca1a');
select throws_ok(format('select public.crm_nota_criar(%L, %L)', pg_temp.cliente('c1'), '   '), 'P0001', 'Escreva o texto da nota.', 'nota vazia falha');
select throws_ok(format('select public.crm_nota_criar(%L, %L)', pg_temp.cliente('c1'), repeat('x', 10001)), 'P0001',
                 'A nota pode ter no máximo 10.000 caracteres.', 'nota com mais de 10.000 caracteres falha');
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_nota_criar(%L, %L)', pg_temp.cliente('c1'), 'intrusa'), '42501', 'Sem acesso a este registro',
                 'CA2a não escreve nota no cliente do CA1a');
select throws_ok($$select public.crm_nota_criar('d0000000-0000-4000-8000-0000000000ff', 'x')$$, '42501', 'Sem acesso a este registro',
                 'cliente inexistente: a mesma mensagem');
select pg_temp.entrar('admin');
select throws_ok($$select public.crm_nota_criar('d0000000-0000-4000-8000-000000000006', 'x')$$, 'P0001', 'Cliente inativo não recebe notas.',
                 'cliente inativado não recebe nota');

select pg_temp.entrar('ca1a');
select is((select jsonb_object_agg(n ->> 'texto', jsonb_build_array(n ->> 'autor_nome', n ->> 'autor_papel', n -> 'minha'))
           from jsonb_array_elements(public.crm_notas(pg_temp.cliente('c1'))) n),
          '{"Cliente prefere contato à tarde <b>ok</b>":["CA1a Corretor","corretor",true],"Nota do GA1":["Gerência","gerente",false],"Nota da IA":["Imobiliária","imobiliaria",false],"Nota da equipe":["Equipe Arken","admin",false]}'::jsonb,
          'CA1a: autores acima aparecem genéricos (PAR-3); "minha" marca a própria nota');
select is((select n - 'criado_em' from jsonb_array_elements(public.crm_notas(pg_temp.cliente('c1'))) n where n ->> 'texto' = 'Nota do GA1'),
          jsonb_build_object('id', pg_temp.id('nota_ga1'), 'texto', 'Nota do GA1', 'autor_nome', 'Gerência', 'autor_papel', 'gerente',
                             'migrado_legado', false, 'removido_lgpd', false, 'minha', false), 'formato do item de crm_notas');
select pg_temp.entrar('ga1');
select is((select n ->> 'autor_nome' from jsonb_array_elements(public.crm_notas(pg_temp.cliente('c1'))) n where n ->> 'texto' like 'Cliente prefere%'),
          'CA1a Corretor', 'GA1 vê o nome do corretor abaixo');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'consultar', 'entidade', 'cliente_notas',
                                              'cliente_id', pg_temp.cliente('c1'), 'ator_id', pg_temp.usuario('ga1'), 'detalhe', '{"itens":4}'::jsonb),
          'crm_notas audita acesso/consultar');
select pg_temp.entrar('ca2a');
select is(public.crm_notas(pg_temp.cliente('c1')), null, 'CA2a: notas do cliente alheio = nulo');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('acao', 'acesso_negado', 'entidade', 'cliente_notas', 'cliente_id', pg_temp.cliente('c1'),
                                              'ator_id', pg_temp.usuario('ca2a')), 'e grava acesso_negado');
select pg_temp.entrar('admin');
select is(public.crm_notas('d0000000-0000-4000-8000-000000000006'), '[]'::jsonb, 'o interno lê o cliente inativado');
select pg_temp.entrar('ca1a');
select is(public.crm_notas('d0000000-0000-4000-8000-000000000006'), null, 'o corretor não lê o cliente inativado');
select pg_temp.sair();
select throws_ok(format('update public.cliente_notas set texto = %L where id = %L', 'editada', pg_temp.id('nota_ca1a')), '42501', null,
                 'nota não é editada nem pelo dono do banco (somente inclusão)');

-- ============ TAREFAS ============
select pg_temp.entrar('ca1a');
select is((select array_agg(r ->> 'profile_id') from jsonb_array_elements(public.crm_responsaveis(pg_temp.cliente('c1'))) r),
          array[pg_temp.usuario('ca1a')::text], 'crm_responsaveis: o corretor só escolhe a si mesmo');
select is(public.crm_responsaveis(pg_temp.cliente('c1')) -> 0,
          jsonb_build_object('profile_id', pg_temp.usuario('ca1a'), 'nome', 'CA1a Corretor', 'papel', 'corretor', 'tipo', 'corretor'),
          'formato do responsável');
select pg_temp.entrar('ga1');
select is((select array_agg(r ->> 'profile_id') from jsonb_array_elements(public.crm_responsaveis(pg_temp.cliente('c1'))) r),
          array[pg_temp.usuario('ga1')::text, pg_temp.usuario('ca1a')::text], 'GA1: ele e o corretor do cliente');
select is((select array_agg(r ->> 'profile_id') from jsonb_array_elements(public.crm_responsaveis(pg_temp.cliente('c4'))) r),
          array[pg_temp.usuario('ga1')::text], 'GA1 no próprio cliente (A1): só ele');
select pg_temp.entrar('ia');
select is((select array_agg(r ->> 'profile_id') from jsonb_array_elements(public.crm_responsaveis(pg_temp.cliente('c1'))) r),
          array[pg_temp.usuario('ia')::text, pg_temp.usuario('ga1')::text, pg_temp.usuario('ca1a')::text], 'IA: a cadeia do cliente abaixo dela');
select pg_temp.entrar('admin');
select is((select array_agg(r ->> 'profile_id' order by r ->> 'profile_id') from jsonb_array_elements(public.crm_responsaveis(pg_temp.cliente('c1'))) r),
          array[pg_temp.usuario('admin')::text, pg_temp.usuario('super')::text, pg_temp.usuario('ia')::text, pg_temp.usuario('ga1')::text,
                pg_temp.usuario('ca1a')::text], 'interno: a cadeia e os internos');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'consultar', 'entidade', 'clientes',
                                              'cliente_id', pg_temp.cliente('c1'), 'detalhe', '{"rpc":"crm_responsaveis","itens":5}'::jsonb),
          'crm_responsaveis audita acesso/consultar');
select pg_temp.entrar('ca2a');
select is(public.crm_responsaveis(pg_temp.cliente('c1')), null, 'CA2a: responsáveis do cliente alheio = nulo');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('acao', 'acesso_negado', 'cliente_id', pg_temp.cliente('c1'), 'ator_id', pg_temp.usuario('ca2a'),
                                              'detalhe', '{"rpc":"crm_responsaveis"}'::jsonb), 'e grava acesso_negado');

select pg_temp.entrar('ca1a');
insert into t_ids values ('t1', public.crm_tarefa_criar(pg_temp.cliente('c1'), 'Ligar para o cliente', null, pg_temp.usuario('ca1a'), pg_temp.hoje() + 3));
select is(pg_temp.erro(format('select public.crm_tarefa_criar(%L, ''x'', null, %L, null)', pg_temp.cliente('c1'), pg_temp.usuario('ga1'))),
          '{"sqlstate":"P0001","mensagem":"DESTINO_INVALIDO","detalhe":{"campos":["responsavel_id"]}}'::jsonb,
          'o corretor não põe o gerente como responsável (acima dele)');
select is(pg_temp.erro(format('select public.crm_tarefa_criar(%L, ''x'', null, %L, null)', pg_temp.cliente('c1'), pg_temp.usuario('ca2a'))) ->> 'mensagem',
          'DESTINO_INVALIDO', 'responsável sem escopo sobre o cliente falha');
select is(pg_temp.erro(format('select public.crm_tarefa_criar(%L, ''x'', null, null, null)', pg_temp.cliente('c1'))) ->> 'mensagem',
          'DESTINO_INVALIDO', 'responsável é obrigatório');
select throws_ok(format('select public.crm_tarefa_criar(%L, ''x'', null, %L, %L)', pg_temp.cliente('c1'), pg_temp.usuario('ca1a'), pg_temp.hoje() - 1),
                 'P0001', 'O prazo não pode estar no passado.', 'prazo no passado falha');
select throws_ok(format('select public.crm_tarefa_criar(%L, %L, null, %L, null)', pg_temp.cliente('c1'), repeat('x', 201), pg_temp.usuario('ca1a')),
                 'P0001', 'Informe o que deve ser feito (até 200 caracteres).', 'título longo demais falha');
select throws_ok(format('select public.crm_tarefa_criar(%L, ''  '', null, %L, null)', pg_temp.cliente('c1'), pg_temp.usuario('ca1a')),
                 'P0001', 'Informe o que deve ser feito (até 200 caracteres).', 'título vazio falha');
select pg_temp.entrar('ga1');
insert into t_ids values ('t2', public.crm_tarefa_criar(pg_temp.cliente('c1'), 'Enviar proposta', 'Detalhes da proposta', pg_temp.usuario('ca1a'), pg_temp.hoje() + 1));
select pg_temp.entrar('ia');
insert into t_ids values ('t3', public.crm_tarefa_criar(pg_temp.cliente('c1'), 'Tarefa da imobiliária', null, pg_temp.usuario('ia'), null));
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_tarefa_criar(%L, ''x'', null, %L, null)', pg_temp.cliente('c1'), pg_temp.usuario('ca2a')),
                 '42501', 'Sem acesso a este registro', 'CA2a não cria tarefa no cliente do CA1a');
select pg_temp.entrar('admin');
select throws_ok(format('select public.crm_tarefa_criar(%L, ''x'', null, %L, null)', 'd0000000-0000-4000-8000-000000000006', pg_temp.usuario('admin')),
                 'P0001', 'Cliente inativo não recebe tarefas.', 'cliente inativado não recebe tarefa');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'operacao', 'acao', 'criar', 'entidade', 'cliente_tarefas', 'entidade_id', pg_temp.id('t3'),
                                              'cliente_id', pg_temp.cliente('c1'), 'ator_id', pg_temp.usuario('ia'),
                                              'depois', jsonb_build_object('status', 'pendente', 'responsavel_id', pg_temp.usuario('ia'), 'prazo', null))
          and pg_temp.aud()::text !~ 'imobiliária', 'tarefa auditada (operacao/criar) sem o texto');
select is((select titulo || ' ' || dados::text from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'tarefa_criada' order by id desc limit 1),
          'Tarefa criada ' || jsonb_build_object('tarefa_id', pg_temp.id('t3'))::text, 'timeline "tarefa_criada" sem o texto da tarefa');
-- tarefa atrasada (gravada direto)
insert into public.cliente_tarefas (id, cliente_id, titulo, responsavel_id, prazo, criado_por)
values ('f5000000-0000-4000-8000-000000000004', pg_temp.cliente('c1'), 'Tarefa atrasada', pg_temp.usuario('ca1a'), pg_temp.hoje() - 2, pg_temp.usuario('ca1a'));
insert into t_ids values ('t4', 'f5000000-0000-4000-8000-000000000004');

select pg_temp.entrar('ca1a');
select is((select array_agg(t ->> 'titulo' order by o) from jsonb_array_elements(public.crm_tarefas(pg_temp.cliente('c1'))) with ordinality as x(t, o)),
          array['Tarefa atrasada', 'Enviar proposta', 'Ligar para o cliente', 'Tarefa da imobiliária'], 'crm_tarefas: pendentes por prazo, sem prazo por último');
select is((select jsonb_object_agg(t ->> 'titulo', jsonb_build_array(t -> 'atrasada', t -> 'pode_editar', t -> 'pode_concluir'))
           from jsonb_array_elements(public.crm_tarefas(pg_temp.cliente('c1'))) t),
          '{"Tarefa atrasada":[true,true,true],"Enviar proposta":[false,true,true],"Ligar para o cliente":[false,true,true],"Tarefa da imobiliária":[false,false,false]}'::jsonb,
          'CA1a: "atrasada" calculada; edita e conclui as dele, não a da imobiliária');
select is((select t - 'criado_em' from jsonb_array_elements(public.crm_tarefas(pg_temp.cliente('c1'))) t where t ->> 'titulo' = 'Enviar proposta'),
          jsonb_build_object('id', pg_temp.id('t2'), 'cliente_id', pg_temp.cliente('c1'), 'titulo', 'Enviar proposta', 'descricao', 'Detalhes da proposta',
                             'responsavel', jsonb_build_object('id', pg_temp.usuario('ca1a'), 'nome', 'CA1a Corretor'), 'prazo', pg_temp.hoje() + 1,
                             'status', 'pendente', 'atrasada', false, 'concluida_em', null, 'concluida_por', null,
                             'criado_por', jsonb_build_object('id', pg_temp.usuario('ga1'), 'nome', 'Gerência'), 'pode_editar', true, 'pode_concluir', true),
          'formato da tarefa (criador acima aparece como "Gerência")');
select pg_temp.entrar('ga1');
select is((select jsonb_object_agg(t ->> 'titulo', t -> 'pode_editar') from jsonb_array_elements(public.crm_tarefas(pg_temp.cliente('c1'))) t),
          '{"Tarefa atrasada":true,"Enviar proposta":true,"Ligar para o cliente":true,"Tarefa da imobiliária":false}'::jsonb,
          'GA1 edita as tarefas do corretor abaixo dele, não a da imobiliária');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'consultar', 'entidade', 'cliente_tarefas',
                                              'cliente_id', pg_temp.cliente('c1'), 'ator_id', pg_temp.usuario('ga1')), 'crm_tarefas audita acesso/consultar');
select pg_temp.entrar('ca2a');
select is(public.crm_tarefas(pg_temp.cliente('c1')), null, 'CA2a: tarefas do cliente alheio = nulo');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('acao', 'acesso_negado', 'entidade', 'cliente_tarefas', 'cliente_id', pg_temp.cliente('c1'),
                                              'ator_id', pg_temp.usuario('ca2a')), 'e grava acesso_negado');

-- editar
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), '{"titulo":"Ligar amanhã","ignorada":1}'), 'CA1a edita a própria tarefa');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'operacao', 'acao', 'editar', 'entidade', 'cliente_tarefas', 'entidade_id', pg_temp.id('t1'),
                                              'campos', array['titulo'], 'antes', '{}'::jsonb, 'depois', '{}'::jsonb),
          'edição auditada com os nomes dos campos (texto fora do log)');
select is((select titulo from public.cliente_tarefas where id = pg_temp.id('t1')), 'Ligar amanhã', 'título alterado');
create temp table t_aud as select pg_temp.conta_aud() as n;
grant select on t_aud to authenticated;
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), '{"titulo":"Ligar amanhã"}'), 'edição sem mudança');
select pg_temp.sair();
select is(pg_temp.conta_aud(), (select n from t_aud), 'edição sem mudança não grava auditoria');
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), jsonb_build_object('responsavel_id', pg_temp.usuario('ga1')))) ->> 'mensagem',
          'DESTINO_INVALIDO', 'o corretor não passa a tarefa para o gerente');
select is(pg_temp.erro(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), '{"prazo":"amanhã"}')),
          '{"sqlstate":"P0001","mensagem":"DADOS_INVALIDOS","detalhe":{"campos":["prazo"]}}'::jsonb, 'prazo inválido');
select throws_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), jsonb_build_object('prazo', pg_temp.hoje() - 1)),
                 'P0001', 'O prazo não pode estar no passado.', 'novo prazo no passado falha');
select is(pg_temp.erro(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), '[]')) ->> 'mensagem', 'DADOS_INVALIDOS', 'p_dados precisa ser objeto');
select throws_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t3'), '{"titulo":"x"}'), '42501', 'Sem acesso a este registro',
                 'CA1a não edita a tarefa da imobiliária');
select pg_temp.entrar('ga1');
select lives_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), jsonb_build_object('responsavel_id', pg_temp.usuario('ga1'))),
                'GA1 assume a tarefa do corretor');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('campos', array['responsavel_id'], 'antes', jsonb_build_object('responsavel_id', pg_temp.usuario('ca1a')),
                                              'depois', jsonb_build_object('responsavel_id', pg_temp.usuario('ga1'))),
          'troca de responsável auditada com antes e depois');
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), '{"descricao":"criada por mim"}'), 'o criador continua editando');
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t1'), '{"titulo":"x"}'), '42501', 'Sem acesso a este registro',
                 'CA2a não edita tarefa do cliente alheio');
select throws_ok($$select public.crm_tarefa_editar('f5000000-0000-4000-8000-0000000000ff', '{"titulo":"x"}')$$, '42501', 'Sem acesso a este registro',
                 'tarefa inexistente: a mesma mensagem');

-- concluir
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_tarefa_concluir(%L)', pg_temp.id('t2')), 'o responsável conclui');
select throws_ok(format('select public.crm_tarefa_concluir(%L)', pg_temp.id('t2')), 'P0001', 'Esta tarefa já foi concluída.', 'não conclui duas vezes');
select throws_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t2'), '{"titulo":"x"}'), 'P0001', 'Tarefa concluída não pode ser editada.',
                 'tarefa concluída não é editada');
select throws_ok(format('select public.crm_tarefa_concluir(%L)', pg_temp.id('t3')), '42501', 'Sem acesso a este registro', 'CA1a não conclui a da imobiliária');
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_tarefa_concluir(%L)', pg_temp.id('t4')), '42501', 'Sem acesso a este registro', 'CA2a não conclui tarefa alheia');
select pg_temp.sair();
select is((select status::text || ':' || (concluida_por = pg_temp.usuario('ca1a'))::text from public.cliente_tarefas where id = pg_temp.id('t2')),
          'concluida:true', 'tarefa concluída por quem chamou');
select is((select dados from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'tarefa_concluida' order by id desc limit 1),
          jsonb_build_object('tarefa_id', pg_temp.id('t2')), 'timeline "tarefa_concluida"');
select ok((select to_jsonb(a) from public.auditoria a where a.entidade = 'cliente_tarefas' and a.entidade_id = pg_temp.id('t2')::text
             and a.acao = 'mudar_status' order by a.id desc limit 1)
          @> '{"categoria":"operacao","antes":{"status":"pendente"},"depois":{"status":"concluida"}}'::jsonb, 'conclusão auditada');

-- minhas tarefas
select pg_temp.entrar('ca1a');
select is((select array_agg(t ->> 'id' order by o) from jsonb_array_elements(public.crm_minhas_tarefas('{}') -> 'itens') with ordinality as x(t, o)),
          array[pg_temp.id('t4')::text, pg_temp.id('t2')::text], 'CA1a "minhas": só as que têm ele como responsável (pendentes primeiro)');
select is(public.crm_minhas_tarefas('{"status":"pendente"}') ->> 'total', '1', 'filtro por status');
select is(public.crm_minhas_tarefas('{"atrasadas":true}') #>> '{itens,0,id}', pg_temp.id('t4')::text, 'filtro "atrasadas"');
select is(public.crm_minhas_tarefas('{"atrasadas":true}') #> '{itens,0,cliente}', jsonb_build_object('id', pg_temp.cliente('c1'), 'nome', 'Cliente Um'),
          'o item traz o cliente');
select pg_temp.entrar('ga1');
select is(public.crm_minhas_tarefas('{"escopo":"equipe"}') ->> 'total', '4', 'GA1 "equipe": as tarefas dos clientes da equipe');
select is(jsonb_array_length(public.crm_minhas_tarefas('{"escopo":"equipe","limite":1}') -> 'itens'), 1, 'paginação por limite');
select is(public.crm_minhas_tarefas('{}') #>> '{itens,0,id}', pg_temp.id('t1')::text, 'GA1 "minhas": a tarefa que ele assumiu');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'listar', 'entidade', 'cliente_tarefas', 'ator_id', pg_temp.usuario('ga1'),
                                              'detalhe', jsonb_build_object('rpc', 'crm_minhas_tarefas', 'ids', jsonb_build_array(pg_temp.id('t1')),
                                                                            'cliente_ids', jsonb_build_array(pg_temp.cliente('c1')))),
          'crm_minhas_tarefas audita os ids das tarefas e dos clientes');
select pg_temp.entrar('ca2a');
select is(public.crm_minhas_tarefas('{"escopo":"equipe"}') ->> 'total', '0', 'CA2a não vê tarefas de clientes fora do escopo');
select is(pg_temp.erro($$select public.crm_minhas_tarefas('{"escopo":"todas"}')$$) ->> 'mensagem', 'DADOS_INVALIDOS', 'escopo inválido');
select is(pg_temp.erro($$select public.crm_minhas_tarefas('{"status":"feita"}')$$) ->> 'mensagem', 'DADOS_INVALIDOS', 'status inválido');
select pg_temp.entrar('bloqueado');
select throws_ok($$select public.crm_minhas_tarefas('{}')$$, '42501', 'Sem acesso a este registro', 'bloqueado: sem tarefas');
select pg_temp.entrar('pendente');
select throws_ok($$select public.crm_minhas_tarefas('{}')$$, '42501', 'Sem acesso a este registro', 'pendente: sem tarefas');

-- ============ DOCUMENTOS ============
-- solicitar
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_documento_solicitar(%L, ''Certidão de casamento'', ''{pdf,jpeg,pdf}'', null)', pg_temp.cliente('c1')),
                'CA1a solicita um documento');
select pg_temp.sair();
select is((select jsonb_build_object('tipo', tipo, 'formatos', formatos_aceitos, 'status', status, 'basico', basico, 'criado_por', criado_por = pg_temp.usuario('ca1a'))
           from public.cliente_documentos where cliente_id = pg_temp.cliente('c1') and nome = 'Certidão de casamento'),
          '{"tipo":"cliente","formatos":["jpeg","pdf"],"status":"pendente","basico":false,"criado_por":true}'::jsonb,
          'solicitação gravada (formatos sem repetição, na ordem da lista)');
insert into t_ids select 'certidao', id from public.cliente_documentos where cliente_id = pg_temp.cliente('c1') and nome = 'Certidão de casamento';
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'operacao', 'acao', 'criar', 'entidade', 'cliente_documentos', 'entidade_id', pg_temp.id('certidao'),
                                              'cliente_id', pg_temp.cliente('c1'), 'ator_id', pg_temp.usuario('ca1a')), 'solicitação auditada');
select is((select titulo from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'documento_solicitado' order by id desc limit 1),
          'Documento solicitado: Certidão de casamento', 'timeline "documento_solicitado"');
select is((select count(*)::int from public.notificacoes where tipo = 'crm.documento_solicitado'), 0, 'e-mail de solicitação desligado por padrão (N10)');

select pg_temp.entrar('ca1a');
select throws_ok(format('select public.crm_documento_solicitar(%L, ''certidão de casamento'', ''{pdf}'', null)', pg_temp.cliente('c1')),
                 'P0001', 'Já existe uma solicitação aberta com este nome.', 'não abre duas solicitações com o mesmo nome');
select is(pg_temp.erro(format('select public.crm_documento_solicitar(%L, ''RG'', ''{}'', null)', pg_temp.cliente('c1'))),
          '{"sqlstate":"P0001","mensagem":"DADOS_INVALIDOS","detalhe":{"campos":["formatos_aceitos"]}}'::jsonb, 'sem formato: DADOS_INVALIDOS');
select is(pg_temp.erro(format('select public.crm_documento_solicitar(%L, ''RG'', ''{pdf,exe}'', null)', pg_temp.cliente('c1'))) ->> 'mensagem',
          'DADOS_INVALIDOS', 'formato fora da lista: DADOS_INVALIDOS');
select throws_ok(format('select public.crm_documento_solicitar(%L, ''R'', ''{pdf}'', null)', pg_temp.cliente('c1')),
                 'P0001', 'Informe o nome do documento (de 2 a 120 caracteres).', 'nome curto demais');
select throws_ok(format('select public.crm_documento_solicitar(%L, ''RG'', ''{pdf}'', %L)', pg_temp.cliente('c1'), 'e3000000-0000-4000-8000-0000000002ff'),
                 'P0001', 'O contrato informado não aceita novas solicitações de documento.', 'contrato inexistente');
select pg_temp.sair();
update public.notificacoes_config set ativo = true where tipo = 'crm.documento_solicitado';
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_documento_solicitar(%L, ''Comprovante do sinal'', ''{pdf}'', %L)', pg_temp.cliente('c1'), 'e3000000-0000-4000-8000-000000000201'),
                'documento de contrato do próprio cliente');
select pg_temp.sair();
select is((select tipo::text || ':' || contrato_id::text from public.cliente_documentos where nome = 'Comprovante do sinal'),
          'contrato:e3000000-0000-4000-8000-000000000201', 'solicitação de contrato gravada com o contrato');
select is((select jsonb_build_object('dest', destinatarios_ids, 'cliente', cliente_id = pg_temp.cliente('c1'), 'status', status)
           from public.notificacoes where tipo = 'crm.documento_solicitado'),
          '{"dest":[],"cliente":true,"status":"pendente"}'::jsonb, 'com o tipo ligado, o e-mail para o cliente entra na fila (só ids)');
update public.notificacoes_config set ativo = false where tipo = 'crm.documento_solicitado';
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_documento_solicitar(%L, ''RG'', ''{pdf}'', %L)', pg_temp.cliente('c2'), 'e3000000-0000-4000-8000-000000000201'),
                 'P0001', 'O contrato informado não aceita novas solicitações de documento.', 'contrato de outro cliente é recusado');
select throws_ok(format('select public.crm_documento_solicitar(%L, ''RG'', ''{pdf}'', null)', pg_temp.cliente('c1')),
                 '42501', 'Sem acesso a este registro', 'CA2a não solicita documento ao cliente alheio');
select pg_temp.entrar('admin');
select throws_ok($$select public.crm_documento_solicitar('d0000000-0000-4000-8000-000000000006', 'RG', '{pdf}', null)$$,
                 'P0001', 'Cliente inativo não recebe solicitações.', 'cliente inativado não recebe solicitação');

-- registrar envio: caminho, autor, tamanho e MIME reais
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 1, 1, 'pdf'))),
          '{"sqlstate":"P0001","mensagem":"ARQUIVO_INVALIDO","detalhe":{"motivo":"caminho"}}'::jsonb, 'caminho de outra solicitação');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), 'qualquer/coisa.png')) -> 'detalhe',
          '{"motivo":"caminho"}'::jsonb, 'caminho fora do formato');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 2, 99, 'png'))) -> 'detalhe',
          '{"motivo":"nao_encontrado"}'::jsonb, 'objeto que não existe no Storage');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 2, 5, 'png'))) -> 'detalhe',
          '{"motivo":"autor"}'::jsonb, 'objeto enviado por outra pessoa');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 2, 2, 'png'))) -> 'detalhe',
          '{"motivo":"tamanho","max_bytes":5242880}'::jsonb, 'tamanho REAL acima do limite');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 2, 9, 'png'))) -> 'detalhe',
          '{"motivo":"tamanho","max_bytes":5242880}'::jsonb, 'objeto sem metadados (sem tamanho)');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 2, 3, 'png'))) -> 'detalhe',
          '{"motivo":"tipo","formatos_aceitos":["jpeg","png"]}'::jsonb, 'MIME REAL diferente da extensão');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 2, 4, 'pdf'))) -> 'detalhe',
          '{"motivo":"tipo","formatos_aceitos":["jpeg","png"]}'::jsonb, 'formato não aceito pela solicitação');
select pg_temp.sair();
update public.configuracao_geral set documento_max_bytes = 500;
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 2, 10, 'png'))) -> 'detalhe',
          '{"motivo":"tamanho","max_bytes":500}'::jsonb, 'o limite vem de configuracao_geral.documento_max_bytes');
select pg_temp.sair();
update public.configuracao_geral set documento_max_bytes = 5242880;
select is(pg_temp.status_doc(2), 'pendente', 'nenhuma tentativa inválida mudou o documento');
select is((select count(*)::int from public.cliente_documento_arquivos where documento_id = pg_temp.doc(2)), 0, 'nem gravou versão');

select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(1), pg_temp.obj(pg_temp.cliente('c1'), 1, 1, 'pdf')),
                 '42501', 'Sem acesso a este registro', 'CA2a não registra envio em documento do cliente alheio');
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(1), pg_temp.obj(pg_temp.cliente('c1'), 1, 1, 'pdf')),
                'CA1a registra o envio do Holerite');
select lives_ok(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(2), pg_temp.obj(pg_temp.cliente('c1'), 2, 11, 'jpg')),
                'e da Foto (MIME com parâmetro é normalizado)');
select throws_ok(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(1), pg_temp.obj(pg_temp.cliente('c1'), 1, 6, 'pdf')),
                 'P0001', 'Este documento não está aguardando envio.', 'documento em análise não recebe outro envio');
select pg_temp.sair();
select is(pg_temp.status_doc(1), 'em_analise', 'documento em análise');
select is((select jsonb_build_object('mime', a.mime_type, 'bytes', a.tamanho_bytes, 'por', a.enviado_por = pg_temp.usuario('ca1a'), 'atual', d.arquivo_atual_id = a.id)
           from public.cliente_documento_arquivos a join public.cliente_documentos d on d.id = a.documento_id where a.documento_id = pg_temp.doc(1)),
          '{"mime":"application/pdf","bytes":1000,"por":true,"atual":true}'::jsonb, 'versão gravada com o tamanho e o MIME do Storage');
insert into t_ids select 'arq1', id from public.cliente_documento_arquivos where storage_path = pg_temp.obj(pg_temp.cliente('c1'), 1, 1, 'pdf');
select is((select dados from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'documento_enviado' order by id limit 1),
          jsonb_build_object('documento_id', pg_temp.doc(1), 'arquivo_id', pg_temp.id('arq1')), 'timeline "documento_enviado"');
select is((select count(*)::int from public.auditoria where cliente_id = pg_temp.cliente('c1') and ator_id = pg_temp.usuario('ca1a')
             and ((entidade = 'cliente_documento_arquivos' and entidade_id = pg_temp.id('arq1')::text and acao = 'criar')
                  or (entidade = 'cliente_documentos' and entidade_id = pg_temp.doc(1)::text and acao = 'mudar_status'
                      and antes = '{"status":"pendente"}' and depois = '{"status":"em_analise"}'))), 2,
          'envio auditado: a versão (criar) e a mudança de status');

-- titular pelo portal: envia, não baixa, não mexe em cliente alheio
select pg_temp.entrar('titular_c1');
select lives_ok(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(4), pg_temp.obj(pg_temp.cliente('c1'), 4, 7, 'pdf')),
                'o titular envia o próprio documento pelo portal');
select throws_ok(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(3), pg_temp.obj(pg_temp.cliente('c2'), 3, 8, 'pdf')),
                 '42501', 'Sem acesso a este registro', 'o titular não envia documento de outro cliente');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('acao', 'mudar_status', 'entidade', 'cliente_documentos', 'entidade_id', pg_temp.doc(4),
                                              'ator_id', pg_temp.usuario('titular_c1'), 'detalhe', '{"portal":true}'::jsonb),
          'envio do titular auditado como portal');
insert into t_ids select 'arq7', id from public.cliente_documento_arquivos where storage_path = pg_temp.obj(pg_temp.cliente('c1'), 4, 7, 'pdf');
select pg_temp.entrar('admin');
select throws_ok(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(5), pg_temp.obj('d0000000-0000-4000-8000-000000000006'::uuid, 5, 12, 'pdf')),
                 'P0001', 'Cliente inativo não recebe documentos.', 'cliente inativado não recebe documento');

-- documentos (leitura)
select pg_temp.entrar('ca1a');
select is((select jsonb_build_object('status', d ->> 'status', 'arquivos', jsonb_array_length(d -> 'arquivos'), 'enviado_por', d #>> '{arquivos,0,enviado_por_nome}',
                                     'atual', d #> '{arquivos,0,atual}')
           from jsonb_array_elements(public.crm_documentos(pg_temp.cliente('c1'))) d where d ->> 'id' = pg_temp.doc(4)::text),
          '{"status":"em_analise","arquivos":1,"enviado_por":"Cliente","atual":true}'::jsonb, 'crm_documentos: o envio do titular aparece como "Cliente"');
select is((select d - 'criado_em' - 'arquivos' from jsonb_array_elements(public.crm_documentos(pg_temp.cliente('c1'))) d where d ->> 'id' = pg_temp.doc(1)::text),
          jsonb_build_object('id', pg_temp.doc(1), 'cliente_id', pg_temp.cliente('c1'), 'tipo', 'cliente', 'nome', 'Holerite', 'formatos_aceitos', '["pdf"]'::jsonb,
                             'status', 'em_analise', 'basico', false, 'contrato_id', null, 'analisado_em', null, 'analisado_por', null, 'motivo_rejeicao', null),
          'formato do documento (sem caminho do arquivo)');
select ok(public.crm_documentos(pg_temp.cliente('c1'))::text !~ 'e3000000-0000-4000-8000-000000000001', 'nenhum caminho de Storage sai na lista');
select is((select count(*)::int from jsonb_array_elements(public.crm_documentos(pg_temp.cliente('c1')))), 9, 'c1: 4 básicos + 5 solicitações ativas');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'consultar', 'entidade', 'cliente_documentos', 'cliente_id', pg_temp.cliente('c1'),
                                              'ator_id', pg_temp.usuario('ca1a')), 'crm_documentos audita acesso/consultar');
select pg_temp.entrar('ca2a');
select is(public.crm_documentos(pg_temp.cliente('c1')), null, 'CA2a: documentos do cliente alheio = nulo');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('acao', 'acesso_negado', 'entidade', 'cliente_documentos', 'cliente_id', pg_temp.cliente('c1'),
                                              'ator_id', pg_temp.usuario('ca2a')), 'e grava acesso_negado');
select pg_temp.entrar('titular_c1');
select is(public.crm_documentos(pg_temp.cliente('c1')), null, 'o titular não usa a lista do CRM (tem a do portal)');

-- analisar (F4)
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_documento_analisar(%L, true, null)', pg_temp.doc(2)), 'CA1a aprova a Foto');
select is(pg_temp.erro(format('select public.crm_documento_analisar(%L, false, null)', pg_temp.doc(1))) ->> 'mensagem', 'MOTIVO_OBRIGATORIO',
          'rejeitar sem motivo falha');
select lives_ok(format('select public.crm_documento_analisar(%L, false, %L)', pg_temp.doc(1), 'Holerite ilegível'), 'CA1a rejeita o Holerite com motivo');
select is(pg_temp.erro(format('select public.crm_documento_analisar(%L, true, null)', pg_temp.doc(1))) ->> 'mensagem', 'TRANSICAO_INVALIDA',
          'documento rejeitado não é aprovado sem novo envio');
select is(pg_temp.erro(format('select public.crm_documento_analisar(%L, null, null)', pg_temp.doc(4))) ->> 'mensagem', 'DADOS_INVALIDOS', 'p_aprovar é obrigatório');
select pg_temp.sair();
select is((select jsonb_build_object('status', status, 'motivo', motivo_rejeicao, 'por', analisado_por = pg_temp.usuario('ca1a'), 'em', analisado_em is not null)
           from public.cliente_documentos where id = pg_temp.doc(1)),
          '{"status":"rejeitado","motivo":"Holerite ilegível","por":true,"em":true}'::jsonb, 'rejeição gravada com motivo e analista');
select is(pg_temp.status_doc(2), 'aprovado', 'Foto aprovada');
select is((select jsonb_build_object('dest', destinatarios_ids, 'cliente', cliente_id = pg_temp.cliente('c1'), 'dados', dados)
           from public.notificacoes where tipo = 'crm.documento_rejeitado'),
          jsonb_build_object('dest', '[]'::jsonb, 'cliente', true, 'dados', jsonb_build_object('documento_id', pg_temp.doc(1))),
          'rejeição põe crm.documento_rejeitado na fila, para o cliente');
select is((select dados from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'documento_analisado' order by id desc limit 1),
          jsonb_build_object('documento_id', pg_temp.doc(1), 'status', 'rejeitado'), 'timeline "documento_analisado"');
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'operacao', 'acao', 'mudar_status', 'entidade', 'cliente_documentos', 'entidade_id', pg_temp.doc(1),
                                              'antes', '{"status":"em_analise"}'::jsonb, 'depois', '{"status":"rejeitado"}'::jsonb)
          and pg_temp.aud()::text !~ 'ilegível', 'análise auditada sem o texto do motivo');

-- reenvio depois da rejeição; caminho já registrado
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(1), pg_temp.obj(pg_temp.cliente('c1'), 1, 1, 'pdf'))) -> 'detalhe',
          '{"motivo":"ja_registrado"}'::jsonb, 'o arquivo já registrado não é reaproveitado no reenvio');
select lives_ok(format('select public.crm_documento_registrar_envio(%L, %L)', pg_temp.doc(1), pg_temp.obj(pg_temp.cliente('c1'), 1, 6, 'pdf')),
                'reenvio com arquivo novo (rejeitado → em análise)');
select pg_temp.sair();
select is(pg_temp.status_doc(1), 'em_analise', 'Holerite de novo em análise');
select is((select count(*)::int from public.cliente_documento_arquivos where documento_id = pg_temp.doc(1)), 2, 'as duas versões ficam guardadas');

-- F4: análise por permissoes_rede
update public.permissoes_rede set permitido = false where acao = 'analisar_documento' and tipo = 'corretor';
select pg_temp.entrar('ca1a');
select throws_ok(format('select public.crm_documento_analisar(%L, true, null)', pg_temp.doc(4)), '42501', 'Sem acesso a este registro',
                 'F4: corretor sem analisar_documento não analisa');
select pg_temp.entrar('ga1');
select lives_ok(format('select public.crm_documento_analisar(%L, true, null)', pg_temp.doc(4)), 'F4: o gerente (permitido) analisa');
select pg_temp.sair();
update public.permissoes_rede set permitido = true where acao = 'analisar_documento' and tipo = 'corretor';
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_documento_analisar(%L, true, null)', pg_temp.doc(1)), '42501', 'Sem acesso a este registro',
                 'CA2a não analisa documento do cliente alheio');
select pg_temp.entrar('titular_c1');
select throws_ok(format('select public.crm_documento_analisar(%L, true, null)', pg_temp.doc(1)), '42501', 'Sem acesso a este registro',
                 'o titular não analisa o próprio documento');

-- baixar (§4.3): P+I com escopo; o titular não baixa
select pg_temp.entrar('ca1a');
select is(public.crm_documento_baixar(pg_temp.id('arq1')) - 'expira_em',
          jsonb_build_object('bucket', 'crm-documentos', 'path', pg_temp.obj(pg_temp.cliente('c1'), 1, 1, 'pdf')),
          'CA1a baixa a versão rejeitada (bucket e caminho)');
select is((public.crm_documento_baixar(pg_temp.id('arq1')) ->> 'expira_em')::timestamptz, now() + interval '60 seconds',
          'a autorização vale download_ttl_segundos');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'acesso', 'acao', 'baixar', 'entidade', 'cliente_documento_arquivos', 'entidade_id', pg_temp.id('arq1'),
                                              'cliente_id', pg_temp.cliente('c1'), 'ator_id', pg_temp.usuario('ca1a')), 'download auditado (acesso/baixar)');
select is((select count(*)::int from public.download_autorizacoes where profile_id = pg_temp.usuario('ca1a') and bucket = 'crm-documentos'
             and path = pg_temp.obj(pg_temp.cliente('c1'), 1, 1, 'pdf') and expira_em > now()), 2, 'autorização gravada para quem baixou');
select pg_temp.entrar('titular_c1');
select throws_ok(format('select public.crm_documento_baixar(%L)', pg_temp.id('arq7')), '42501', 'Sem acesso a este registro',
                 'o titular não baixa nem o arquivo que ele mesmo enviou');
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_documento_baixar(%L)', pg_temp.id('arq1')), '42501', 'Sem acesso a este registro', 'CA2a não baixa');
select throws_ok($$select public.crm_documento_baixar('f6000000-0000-4000-8000-0000000000ff')$$, '42501', 'Sem acesso a este registro',
                 'arquivo inexistente: a mesma mensagem');
select pg_temp.entrar('admin');
select is(public.crm_documento_baixar(pg_temp.id('arq7')) ->> 'bucket', 'crm-documentos', 'o interno baixa');
select pg_temp.sair();
update public.cliente_documento_arquivos set removido_em = now() where id = pg_temp.id('arq7');
select pg_temp.entrar('admin');
select throws_ok(format('select public.crm_documento_baixar(%L)', pg_temp.id('arq7')), 'P0001', 'Este arquivo foi removido.', 'arquivo removido (LGPD) não é baixado');

-- cancelar
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.crm_documento_cancelar(%L, ''ab'')', pg_temp.id('certidao'))) ->> 'mensagem', 'MOTIVO_OBRIGATORIO', 'cancelar exige motivo');
select throws_ok(format('select public.crm_documento_cancelar(%L, ''não precisa mais'')', pg_temp.doc(2)), 'P0001', 'Documento aprovado não pode ser cancelado.',
                 'documento aprovado não é cancelado');
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.crm_documento_cancelar(%L, ''não precisa mais'')', pg_temp.id('certidao')), '42501', 'Sem acesso a este registro',
                 'CA2a não cancela solicitação do cliente alheio');
select pg_temp.entrar('ca1a');
select lives_ok(format('select public.crm_documento_cancelar(%L, ''Não é mais necessária'')', pg_temp.id('certidao')), 'CA1a cancela a solicitação');
select throws_ok(format('select public.crm_documento_cancelar(%L, ''de novo'')', pg_temp.id('certidao')), '42501', 'Sem acesso a este registro',
                 'solicitação já cancelada não é encontrada');
select ok(not exists (select 1 from jsonb_array_elements(public.crm_documentos(pg_temp.cliente('c1'))) d where d ->> 'id' = pg_temp.id('certidao')::text),
          'a solicitação cancelada sai da lista');
select pg_temp.sair();
select is((select jsonb_build_object('inativado', inativado_em is not null, 'por', inativado_por = pg_temp.usuario('ca1a'), 'motivo', motivo_inativacao)
           from public.cliente_documentos where id = pg_temp.id('certidao')),
          '{"inativado":true,"por":true,"motivo":"Não é mais necessária"}'::jsonb, 'cancelar = inativar (nunca excluir)');
select ok((select to_jsonb(a) from public.auditoria a where a.entidade = 'cliente_documentos' and a.entidade_id = pg_temp.id('certidao')::text
             and a.acao = 'inativar')
          @> jsonb_build_object('categoria', 'operacao', 'cliente_id', pg_temp.cliente('c1'), 'ator_id', pg_temp.usuario('ca1a'),
                                'antes', '{"status":"pendente"}'::jsonb)
          and not exists (select 1 from public.auditoria a where a.entidade_id = pg_temp.id('certidao')::text and a::text ~ 'necessária'),
          'cancelamento auditado sem o texto do motivo');

-- o kanban conta os documentos pendentes e a tarefa atrasada
select pg_temp.entrar('ca1a');
select is((select jsonb_build_object('docs', i -> 'documentos_pendentes', 'atrasada', i -> 'tarefa_atrasada', 'etapa', i ->> 'etapa')
           from jsonb_array_elements(public.crm_kanban('{}', 50) -> 'colunas') c, jsonb_array_elements(c -> 'itens') i where i ->> 'id' = pg_temp.cliente('c1')::text),
          '{"docs":5,"atrasada":true,"etapa":"documentacao"}'::jsonb, 'cartão do c1: 5 documentos pendentes (4 básicos e o do contrato) e tarefa atrasada');

-- ============ TRANSFERÊNCIA: QUEM PERDE O CLIENTE PERDE A TAREFA (§4.4) ============
select pg_temp.sair();
set local arken.motivo_vinculo = 'teste: transferência';
update public.clientes set corretor_id = pg_temp.parceiro('ca2a') where id = pg_temp.cliente('c1');
select pg_temp.entrar('ca1a');
select is(public.crm_minhas_tarefas('{}') ->> 'total', '0', 'CA1a perde as tarefas do cliente transferido');
select is(public.crm_tarefas(pg_temp.cliente('c1')), null, 'e a lista de tarefas do cliente');
select throws_ok(format('select public.crm_tarefa_concluir(%L)', pg_temp.id('t4')), '42501', 'Sem acesso a este registro', 'e não conclui mais a tarefa');
select pg_temp.entrar('ga1');
select is(public.crm_minhas_tarefas('{"escopo":"equipe"}') ->> 'total', '0', 'GA1 também (o cliente foi para a equipe do GA2)');
select pg_temp.entrar('ca2a');
select is(public.crm_minhas_tarefas('{"escopo":"equipe"}') ->> 'total', '4', 'o novo corretor vê as tarefas do cliente');
select is(pg_temp.col(public.crm_kanban('{}', 50), 'documentacao'), array[pg_temp.cliente('c1')], 'e o cartão no kanban');
select pg_temp.entrar('ia');
select is(public.crm_minhas_tarefas('{"escopo":"equipe"}') ->> 'total', '4', 'a imobiliária continua vendo (mesma imobiliária)');

-- ============ PAR-3 DEPOIS DA TRANSFERÊNCIA: NUNCA AO LADO NEM EM OUTRA CADEIA (WP3R-01) ============
-- c1 agora é do CA2a (equipe do GA2). CA1a (corretor de outra equipe) e GA1 (gerente do mesmo nível, outra equipe)
-- escreveram notas, criaram tarefas, enviaram e analisaram documentos: para o CA2a e o GA2 saem genéricos.
select pg_temp.entrar('ca2a');
select is((select jsonb_object_agg(n ->> 'texto', n ->> 'autor_nome') from jsonb_array_elements(public.crm_notas(pg_temp.cliente('c1'))) n
           where n ->> 'texto' in ('Cliente prefere contato à tarde <b>ok</b>', 'Nota do GA1', 'Nota da IA', 'Nota da equipe')),
          '{"Cliente prefere contato à tarde <b>ok</b>":"Corretor","Nota do GA1":"Gerência","Nota da IA":"Imobiliária","Nota da equipe":"Equipe Arken"}'::jsonb,
          'CA2a: a nota do corretor anterior sai "Corretor" (ao lado), a do GA1 "Gerência" (PAR-3)');
select ok(public.crm_notas(pg_temp.cliente('c1'))::text !~ 'CA1a Corretor|GA1 Gerente'
          and public.crm_timeline(pg_temp.cliente('c1'), null, 100)::text !~ 'CA1a Corretor|GA1 Gerente'
          and public.crm_tarefas(pg_temp.cliente('c1'))::text !~ 'CA1a Corretor|GA1 Gerente'
          and public.crm_documentos(pg_temp.cliente('c1'))::text !~ 'CA1a Corretor|GA1 Gerente'
          and public.crm_minhas_tarefas('{"escopo":"equipe"}')::text !~ 'CA1a Corretor|GA1 Gerente',
          'CA2a: nenhum nome real do CA1a ou do GA1 na timeline, notas, tarefas, documentos e lista de tarefas');
select is((select jsonb_build_object('resp', t -> 'responsavel', 'criador', t -> 'criado_por')
           from jsonb_array_elements(public.crm_tarefas(pg_temp.cliente('c1'))) t where t ->> 'id' = pg_temp.id('t4')::text),
          jsonb_build_object('resp', jsonb_build_object('id', pg_temp.usuario('ca1a'), 'nome', 'Corretor'),
                             'criador', jsonb_build_object('id', pg_temp.usuario('ca1a'), 'nome', 'Corretor')),
          'CA2a: responsável e criador da tarefa herdada saem "Corretor"');
select is((select array_agg(distinct d #>> '{analisado_por,nome}') from jsonb_array_elements(public.crm_documentos(pg_temp.cliente('c1'))) d
           where d -> 'analisado_por' <> 'null'::jsonb),
          array['Corretor', 'Gerência'], 'CA2a: quem analisou (CA1a e GA1) sai genérico');
select ok(exists (select 1 from jsonb_array_elements(public.crm_documentos(pg_temp.cliente('c1'))) d, jsonb_array_elements(d -> 'arquivos') a
                  where a ->> 'enviado_por_nome' = 'Corretor')
          and exists (select 1 from jsonb_array_elements(public.crm_documentos(pg_temp.cliente('c1'))) d, jsonb_array_elements(d -> 'arquivos') a
                      where a ->> 'enviado_por_nome' = 'Cliente'),
          'CA2a: arquivo enviado pelo CA1a sai "Corretor"; pelo portal, "Cliente"');
select pg_temp.entrar('ga2');
select is((select jsonb_object_agg(n ->> 'texto', n ->> 'autor_nome') from jsonb_array_elements(public.crm_notas(pg_temp.cliente('c1'))) n
           where n ->> 'texto' in ('Cliente prefere contato à tarde <b>ok</b>', 'Nota do GA1')),
          '{"Cliente prefere contato à tarde <b>ok</b>":"Corretor","Nota do GA1":"Gerência"}'::jsonb,
          'GA2: o gerente do mesmo nível (GA1) sai "Gerência" e o corretor de outra equipe, "Corretor"');
select ok(public.crm_timeline(pg_temp.cliente('c1'), null, 100)::text !~ 'CA1a Corretor|GA1 Gerente'
          and public.crm_tarefas(pg_temp.cliente('c1'))::text !~ 'CA1a Corretor|GA1 Gerente'
          and public.crm_documentos(pg_temp.cliente('c1'))::text !~ 'CA1a Corretor|GA1 Gerente',
          'GA2: nenhum nome real do CA1a ou do GA1 na timeline, tarefas e documentos');
select ok(public.crm_timeline(pg_temp.cliente('c2'), null, 100)::text ~ 'CA2a Corretor', 'GA2 continua vendo o nome do corretor abaixo dele');
select pg_temp.entrar('ia');
select is((select jsonb_object_agg(n ->> 'texto', n ->> 'autor_nome') from jsonb_array_elements(public.crm_notas(pg_temp.cliente('c1'))) n
           where n ->> 'texto' in ('Cliente prefere contato à tarde <b>ok</b>', 'Nota do GA1')),
          '{"Cliente prefere contato à tarde <b>ok</b>":"CA1a Corretor","Nota do GA1":"GA1 Gerente"}'::jsonb,
          'IA: todos da mesma imobiliária estão abaixo dela (nomes reais)');

-- ============ TAREFA ÓRFÃ: QUEM TEM O CLIENTE AGORA TRATA (WP3R-02) ============
select pg_temp.sair();
select is(array[public._funil_tem_escopo(pg_temp.usuario('ca1a'), pg_temp.cliente('c1')),
                public._funil_tem_escopo(pg_temp.usuario('ga1'), pg_temp.cliente('c1')),
                public._funil_tem_escopo(pg_temp.usuario('ca2a'), pg_temp.cliente('c1')),
                public._funil_tem_escopo(pg_temp.usuario('ga2'), pg_temp.cliente('c1')),
                public._funil_tem_escopo(pg_temp.usuario('ia'), pg_temp.cliente('c1')),
                public._funil_tem_escopo(pg_temp.usuario('admin'), pg_temp.cliente('c1')),
                public._funil_tem_escopo(pg_temp.usuario('ib'), pg_temp.cliente('c1')),
                public._funil_tem_escopo(pg_temp.usuario('bloqueado'), pg_temp.cliente('c5')),
                public._funil_tem_escopo(pg_temp.usuario('titular_c1'), pg_temp.cliente('c1')),
                public._funil_tem_escopo(null, pg_temp.cliente('c1')),
                public._funil_tem_escopo(pg_temp.usuario('gb1'), pg_temp.cliente('c3')),
                public._funil_tem_escopo(pg_temp.usuario('admin'), 'd0000000-0000-4000-8000-000000000006'),
                public._funil_tem_escopo(pg_temp.usuario('ca1a'), 'd0000000-0000-4000-8000-000000000006')],
          array[false, false, true, true, true, true, false, false, false, false, true, true, false],
          '_funil_tem_escopo: só a cadeia atual e internos; perfil bloqueado, titular, nulo e cliente inativo (parceiro) não');
select pg_temp.entrar('ca2a');
select is((select jsonb_object_agg(t ->> 'id', jsonb_build_array(t -> 'pode_editar', t -> 'pode_concluir'))
           from jsonb_array_elements(public.crm_tarefas(pg_temp.cliente('c1'))) t),
          jsonb_build_object(pg_temp.id('t1'), '[true,true]'::jsonb, pg_temp.id('t4'), '[true,true]'::jsonb,
                             pg_temp.id('t3'), '[false,false]'::jsonb, pg_temp.id('t2'), '[false,false]'::jsonb),
          'CA2a trata as tarefas órfãs (responsável CA1a e GA1 sem escopo); a da IA (ainda com escopo) e a concluída, não');
select lives_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t4'), jsonb_build_object('responsavel_id', pg_temp.usuario('ca2a'))),
                'CA2a assume a tarefa herdada do corretor anterior');
select pg_temp.sair();
select ok(pg_temp.aud() @> jsonb_build_object('categoria', 'operacao', 'acao', 'editar', 'entidade_id', pg_temp.id('t4')::text,
                                              'ator_id', pg_temp.usuario('ca2a'), 'campos', array['responsavel_id'],
                                              'antes', jsonb_build_object('responsavel_id', pg_temp.usuario('ca1a')),
                                              'depois', jsonb_build_object('responsavel_id', pg_temp.usuario('ca2a'))),
          'reatribuição da tarefa herdada auditada com antes e depois');
select pg_temp.entrar('ca2a');
select is(public.crm_minhas_tarefas('{}') #>> '{itens,0,id}', pg_temp.id('t4')::text, 'e ela passa a aparecer em "minhas" do CA2a');
select lives_ok(format('select public.crm_tarefa_concluir(%L)', pg_temp.id('t4')), 'CA2a conclui a tarefa atrasada herdada');
select is((select i -> 'tarefa_atrasada' from jsonb_array_elements(public.crm_kanban('{}', 50) -> 'colunas') c, jsonb_array_elements(c -> 'itens') i
           where i ->> 'id' = pg_temp.cliente('c1')::text), 'false'::jsonb, 'e o cartão do c1 deixa de mostrar "tarefa atrasada"');
select lives_ok(format('select public.crm_tarefa_concluir(%L)', pg_temp.id('t1')), 'CA2a conclui a tarefa órfã que era do GA1');
select throws_ok(format('select public.crm_tarefa_concluir(%L)', pg_temp.id('t3')), '42501', 'Sem acesso a este registro',
                 'CA2a não conclui a tarefa da IA, que ainda tem escopo (acima dele)');
select throws_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t3'), jsonb_build_object('responsavel_id', pg_temp.usuario('ca2a'))),
                 '42501', 'Sem acesso a este registro', 'nem a reatribui');
select pg_temp.entrar('ga1');
select throws_ok(format('select public.crm_tarefa_editar(%L, %L)', pg_temp.id('t3'), '{"titulo":"x"}'), '42501', 'Sem acesso a este registro',
                 'o GA1, sem escopo, não mexe em tarefa do c1');

select * from finish();
rollback;
