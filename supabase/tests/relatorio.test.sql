-- Função public.relatorio(): só admin; agregados conferidos com dados conhecidos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@r.com', '{"nome":"Adm"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'par@r.com', '{"nome":"Parceira R"}', now(), now());
update public.profiles set papel = 'admin', status_parceiro = 'aprovado' where email = 'adm@r.com';

-- 3 leads no período (2 do Eixo Leste, 1 geral) e 1 no período anterior
insert into public.leads (nome, telefone, empreendimento_id, origem, created_at)
select 'L' || g, '11999999999', case when g <= 2 then e.id end, case when g <= 2 then 'pagina_empreendimento' else 'site' end, now() - interval '1 day'
from generate_series(1, 3) g, public.empreendimentos e where e.slug = 'eixo-leste';
insert into public.leads (nome, telefone, created_at) values ('Antigo', '11999999999', now() - interval '40 days');

insert into public.propostas (parceiro_id, empreendimento_id, texto, status)
select '00000000-0000-0000-0000-0000000000b1', id, 't', s from public.empreendimentos, unnest(array['enviada','aprovada','aprovada']::public.status_proposta[]) s
where slug = 'eixo-leste';

insert into public.unidades (empreendimento_id, identificador, valor, status)
select id, u, v, s::public.status_unidade from public.empreendimentos,
  (values ('A1', 200000, 'disponivel'), ('A2', 250000, 'disponivel'), ('A3', 300000, 'vendida'), ('A4', 310000, 'reservada')) x(u, v, s)
where slug = 'eixo-leste';

-- não admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.relatorio(now() - interval '30 days')$$, '42501', null, 'parceiro não acessa relatórios');
reset role;
set local role anon;
select throws_ok($$select public.relatorio(now() - interval '30 days')$$, '42501', null, 'visitante não acessa relatórios');
reset role;

-- admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
create temp table r as select public.relatorio(now() - interval '30 days') as j;
select is((select (j->>'leads')::int from r), 3, 'leads no período');
select is((select (j->>'leads_anterior')::int from r), 1, 'leads no período anterior (mesma duração)');
select is((select j->'propostas'->>'aprovada' from r), '2', 'propostas aprovadas');
select is((select jsonb_array_length(j->'leads_mensal') from r), 12, '12 meses no gráfico mensal');
select is((select j->'leads_por_empreendimento'->0->>'nome' from r), 'Eixo Leste', 'empreendimento com mais leads primeiro');
select is((select (j->'leads_por_empreendimento'->0->>'total')::int from r), 2, 'total do empreendimento');
select is((select j->'parceiros_ranking'->0->>'aprovadas' from r), '2', 'ranking de parceiros com aprovadas');
select is((select (j->'estoque'->0->>'disponivel')::int from r), 2, 'estoque: disponíveis');
select is((select (j->'estoque'->0->>'vgv_disponivel')::numeric from r), 450000::numeric, 'estoque: VGV disponível');
select is((select (j->>'parceiros_novos')::int from r), 1, 'parceiros novos no período');
reset role;

select * from finish();
rollback;
