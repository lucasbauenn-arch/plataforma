-- Regras de acesso (grants + RLS) por papel. Rodar: supabase test db (banco local com migrations + seed).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- ---------- dados de teste ----------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@t.com', '{"nome":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pend@t.com', '{"nome":"Pendente"}', now(), now()),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aprov@t.com', '{"nome":"Aprovado"}', now(), now()),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cli@t.com', '{"nome":"Cliente"}', now(), now());
update public.profiles set papel = 'admin', status_parceiro = 'aprovado' where email = 'admin@t.com';
update public.profiles set status_parceiro = 'aprovado' where email = 'aprov@t.com';
update public.profiles set papel = 'cliente' where email = 'cli@t.com';
select is((select papel::text from public.profiles where email = 'admin@t.com'), 'admin', 'SQL editor/service role consegue definir papel (trigger não bloqueia)');

insert into public.unidades (empreendimento_id, identificador, valor) select id, 'APTO 01', 300000 from public.empreendimentos where slug = 'eixo-leste';
insert into public.empreendimento_materiais (empreendimento_id, drive_url) select id, 'https://drive/x' from public.empreendimentos where slug = 'eixo-leste';
insert into public.clientes (id, user_id, nome, cpf) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000d', 'Cliente', '52998224725'),
  ('00000000-0000-0000-0000-0000000000c2', null, 'Outro', '11144477735');
insert into public.cliente_negocios (cliente_id, empreendimento_id) select '00000000-0000-0000-0000-0000000000c1', id from public.empreendimentos where slug = 'eixo-leste';
insert into public.obra_atualizacoes (empreendimento_id, titulo) select id, 'Fundação' from public.empreendimentos where slug = 'eixo-leste';
insert into public.obra_atualizacoes (empreendimento_id, titulo) select id, 'Outra obra' from public.empreendimentos where slug <> 'eixo-leste' limit 1;
insert into public.leads (nome, telefone) values ('Lead', '11999999999');

-- ---------- visitante ----------
set local role anon;
select ok((select count(*) from public.empreendimentos) > 0, 'visitante lê empreendimentos publicados');
select is((select count(*)::int from public.empreendimentos where not publicado), 0, 'visitante não vê rascunhos');
select throws_ok('select count(*) from public.unidades', '42501', null, 'visitante não lê unidades');
select throws_ok('select count(*) from public.empreendimento_materiais', '42501', null, 'visitante não lê materiais (Drive)');
select throws_ok('select count(*) from public.clientes', '42501', null, 'visitante não lê clientes');
select throws_ok('select count(*) from public.profiles', '42501', null, 'visitante não lê perfis');
select throws_ok($$insert into public.leads (nome, telefone) values ('robô', '1')$$, '42501', null, 'visitante não grava lead direto (só pela função com Turnstile)');
select throws_ok($$insert into public.empreendimentos (slug, nome) values ('x', 'x')$$, '42501', null, 'visitante não cria empreendimento');
reset role;

-- ---------- parceiro pendente ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.unidades), 0, 'pendente não vê unidades');
select is((select count(*)::int from public.empreendimento_materiais), 0, 'pendente não vê materiais');
update public.profiles set papel = 'admin', status_parceiro = 'aprovado' where id = '00000000-0000-0000-0000-00000000000b';
select is((select papel::text || '/' || status_parceiro::text from public.profiles where id = '00000000-0000-0000-0000-00000000000b'),
  'parceiro/pendente', 'usuário não altera o próprio papel nem status');
select throws_ok($$insert into public.parceiro_clientes (parceiro_id, nome, telefone) values ('00000000-0000-0000-0000-00000000000b', 'x', '1')$$,
  '42501', null, 'pendente não cadastra clientes');
reset role;

-- ---------- parceiro aprovado ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select is((select count(*)::int from public.unidades), 1, 'aprovado vê unidades');
select is((select count(*)::int from public.empreendimento_materiais), 1, 'aprovado vê materiais');
select lives_ok($$insert into public.parceiro_clientes (parceiro_id, nome, telefone) values ('00000000-0000-0000-0000-00000000000c', 'Fulano', '11988887777')$$,
  'aprovado cadastra o próprio cliente');
select throws_ok($$insert into public.parceiro_clientes (parceiro_id, nome, telefone) values ('00000000-0000-0000-0000-00000000000b', 'Forjado', '1')$$,
  '42501', null, 'aprovado não cadastra cliente em nome de outro parceiro');
select throws_ok($$insert into public.propostas (parceiro_id, empreendimento_id, texto, status)
  select '00000000-0000-0000-0000-00000000000c', id, 'x', 'aprovada' from public.empreendimentos where slug = 'eixo-leste'$$,
  '42501', null, 'aprovado não cria proposta já aprovada');
select is((select count(*)::int from public.leads), 0, 'aprovado não vê leads');
reset role;

-- ---------- cliente do portal ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is((select count(*)::int from public.clientes), 1, 'cliente vê só o próprio cadastro');
select is((select count(*)::int from public.cliente_negocios), 1, 'cliente vê os próprios negócios');
select is((select count(*)::int from public.obra_atualizacoes), 1, 'cliente vê só a obra do próprio empreendimento');
select is((select count(*)::int from public.unidades), 0, 'cliente não vê tabela de unidades');
select is((select count(*)::int from public.portal_acessos), 0, 'cliente não vê auditoria de acessos');
reset role;

-- ---------- admin ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is((select count(*)::int from public.leads), 1, 'admin lê leads');
select is((select count(*)::int from public.profiles), 4, 'admin lê todos os perfis');
update public.profiles set status_parceiro = 'aprovado' where id = '00000000-0000-0000-0000-00000000000b';
select is((select status_parceiro::text from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 'aprovado', 'admin aprova parceiro');
select lives_ok($$delete from public.leads where nome = 'Lead'$$, 'admin exclui lead');
reset role;

select * from finish();
rollback;
