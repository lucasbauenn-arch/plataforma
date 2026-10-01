-- propostas_criar (20260929000022): a unidade opcional tem de ser do empreendimento e estar DISPONÍVEL; o parceiro
-- aprovado lê as unidades para montar o seletor, anon e parceiro pendente não; a lista devolve a unidade.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(14);

create temp table p22 (id uuid) on commit drop;
grant all on p22 to authenticated;

insert into public.empreendimentos (id, slug, nome, publicado) values
  ('e2200000-0000-4000-8000-000000000001', 'p22-residencial', 'Residencial P22', true),
  ('e2200000-0000-4000-8000-000000000002', 'p22-vizinho', 'Vizinho P22', true);
insert into public.unidades (id, empreendimento_id, identificador, metragem, valor, status) values
  ('e2200000-0000-4000-8000-000000000011', 'e2200000-0000-4000-8000-000000000001', 'APTO 11', 42.5, 400000, 'disponivel'),
  ('e2200000-0000-4000-8000-000000000012', 'e2200000-0000-4000-8000-000000000001', 'APTO 12', 42.5, 410000, 'reservada'),
  ('e2200000-0000-4000-8000-000000000013', 'e2200000-0000-4000-8000-000000000001', 'APTO 13', 55, 500000, 'vendida'),
  ('e2200000-0000-4000-8000-000000000021', 'e2200000-0000-4000-8000-000000000002', 'APTO 21', 60, 600000, 'disponivel');

-- ============ leitura das unidades (seletor do formulário) ============
select pg_temp.entrar('ca1a');
select is((select count(*)::int from public.unidades u where u.empreendimento_id = 'e2200000-0000-4000-8000-000000000001'
             and u.status = 'disponivel'), 1, 'parceiro aprovado lê as unidades disponíveis do empreendimento');
select pg_temp.entrar('pendente');
select is((select count(*)::int from public.unidades u where u.empreendimento_id = 'e2200000-0000-4000-8000-000000000001'), 0,
          'parceiro pendente não lê unidades');
select pg_temp.entrar_anon();
select throws_ok($$select 1 from public.unidades$$, '42501', null, 'anon não lê unidades (sem grant)');

-- ============ propostas_criar: validação da unidade ============
select pg_temp.entrar('ca1a');
select is((pg_temp.erro($$select public.propostas_criar('e2200000-0000-4000-8000-000000000001', null,
            'e2200000-0000-4000-8000-000000000012', 'Proposta para a unidade reservada')$$)) -> 'detalhe',
          '{"campos":["unidade_id"]}'::jsonb, 'unidade reservada recusada');
select is((pg_temp.erro($$select public.propostas_criar('e2200000-0000-4000-8000-000000000001', null,
            'e2200000-0000-4000-8000-000000000013', 'Proposta para a unidade vendida')$$)) -> 'detalhe',
          '{"campos":["unidade_id"]}'::jsonb, 'unidade vendida recusada');
select is((pg_temp.erro($$select public.propostas_criar('e2200000-0000-4000-8000-000000000001', null,
            'e2200000-0000-4000-8000-000000000021', 'Unidade disponível de outro empreendimento')$$)) -> 'detalhe',
          '{"campos":["unidade_id"]}'::jsonb, 'unidade de outro empreendimento recusada');
select is((pg_temp.erro($$select public.propostas_criar('e2200000-0000-4000-8000-000000000001', null,
            'e2200000-0000-4000-8000-0000000000ff', 'Unidade que não existe no banco')$$)) -> 'detalhe',
          '{"campos":["unidade_id"]}'::jsonb, 'unidade inexistente recusada');

insert into p22 select public.propostas_criar('e2200000-0000-4000-8000-000000000001', pg_temp.cliente('c1'),
  'e2200000-0000-4000-8000-000000000011', 'Proposta para o APTO 11 com entrada e FGTS');
select isnt((select id from p22), null, 'unidade disponível do empreendimento aceita');
select isnt(public.propostas_criar('e2200000-0000-4000-8000-000000000001', null, null, 'Proposta sem unidade definida'), null,
            'unidade continua opcional');

-- ============ lista devolve a unidade ============
select is((select i -> 'unidade' ->> 'identificador'
             from jsonb_array_elements(public.propostas_listar(jsonb_build_object('cliente_id', pg_temp.cliente('c1'))) -> 'itens') i
            where (i ->> 'id')::uuid = (select id from p22)), 'APTO 11', 'propostas_listar devolve a unidade');

select pg_temp.sair();
select is((select p.unidade_id from public.propostas p where p.id = (select id from p22)),
          'e2200000-0000-4000-8000-000000000011'::uuid, 'proposta gravada com a unidade');
select is((select u.status::text from public.unidades u where u.id = 'e2200000-0000-4000-8000-000000000011'), 'disponivel',
          'proposta não reserva a unidade');

-- ============ assinatura e grants preservados ============
select ok(has_function_privilege('authenticated', 'public.propostas_criar(uuid, uuid, uuid, text)', 'execute'),
          'authenticated executa propostas_criar');
select ok(not has_function_privilege('anon', 'public.propostas_criar(uuid, uuid, uuid, text)', 'execute'),
          'anon não executa propostas_criar');

select * from finish();
rollback;
