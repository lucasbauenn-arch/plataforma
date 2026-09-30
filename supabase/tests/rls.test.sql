-- Regras de acesso (grants + RLS) por papel. Rodar: supabase test db (banco local com migrations + seed).
-- Papéis do site/portal de antes da expansão (parceiro legado sem vínculo em parceiros). O escopo da rede nova
-- (imobiliária, gerente, corretor) está em escopo.test.sql; o que mudou de propósito aqui segue a §4.2.
-- Depois do corte e da contração (20260929000018, §4.3): clientes, leads e propostas não têm nenhum acesso direto de
-- authenticated (nem do admin: tudo por RPC); a carteira antiga (parceiro_clientes) virou legado_parceiro_clientes, sem
-- acesso; profiles só é lido pela API (17: escrita só por RPC, service role ou SQL).
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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
-- o cliente do portal (como o corte deixa os clientes antigos: origem portal_admin, portal liberado, Carteira Arken)
insert into public.clientes (id, user_id, nome, cpf, origem, portal_liberado) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000d', 'Cliente', '52998224725', 'portal_admin', true),
  ('00000000-0000-0000-0000-0000000000c2', null, 'Outro', '11144477735', 'cadastro_interno', false);
insert into public.cliente_negocios (cliente_id, empreendimento_id) select '00000000-0000-0000-0000-0000000000c1', id from public.empreendimentos where slug = 'eixo-leste';
insert into public.obra_atualizacoes (empreendimento_id, titulo) select id, 'Fundação' from public.empreendimentos where slug = 'eixo-leste';
insert into public.obra_atualizacoes (empreendimento_id, titulo) select id, 'Outra obra' from public.empreendimentos where slug <> 'eixo-leste' limit 1;
insert into public.leads (nome, telefone) values ('Lead', '11999999999');
insert into public.leads (nome, telefone, status, motivo_descarte) values ('Lead descartado', '11999999998', 'descartado', 'spam');
insert into public.propostas (parceiro_id, empreendimento_id, texto)
  select '00000000-0000-0000-0000-00000000000c', id, 'quero a unidade 01' from public.empreendimentos where slug = 'eixo-leste';
insert into public.legado_parceiro_clientes (parceiro_id, nome, telefone) values ('00000000-0000-0000-0000-00000000000c', 'Fulano', '11988887777');

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
select throws_ok($$select public.is_parceiro_aprovado()$$, '42501', null, 'visitante executa só is_admin (is_parceiro_aprovado revogado)');
select throws_ok('select count(*) from public.legado_parceiro_clientes', '42501', null, 'visitante não lê a carteira legada');
reset role;

-- ---------- parceiro pendente ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.unidades), 0, 'pendente não vê unidades');
select is((select count(*)::int from public.empreendimento_materiais), 0, 'pendente não vê materiais');
select throws_ok($$update public.profiles set papel = 'admin', status_parceiro = 'aprovado' where id = '00000000-0000-0000-0000-00000000000b'$$,
  '42501', null, 'usuário não altera o próprio papel nem status (profiles só é lido pela API)');
select is((select papel::text || '/' || status_parceiro::text from public.profiles where id = '00000000-0000-0000-0000-00000000000b'),
  'parceiro/pendente', 'o perfil continua pendente');
select throws_ok($$insert into public.legado_parceiro_clientes (parceiro_id, nome, telefone) values ('00000000-0000-0000-0000-00000000000b', 'x', '1')$$,
  '42501', null, 'ninguém grava na carteira legada (arquivo do corte)');
reset role;

-- ---------- parceiro aprovado (papel legado, sem vínculo em parceiros) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select is((select count(*)::int from public.unidades), 1, 'aprovado vê unidades');
select is((select count(*)::int from public.empreendimento_materiais), 1, 'aprovado vê materiais');
select throws_ok('select count(*) from public.legado_parceiro_clientes', '42501', null,
  'nem o dono lê a carteira legada direto (os clientes migraram para o CRM)');
select throws_ok($$insert into public.propostas (parceiro_id, empreendimento_id, texto)
  select '00000000-0000-0000-0000-00000000000c', id, 'quero a unidade 01' from public.empreendimentos where slug = 'eixo-leste'$$,
  '42501', null, 'depois do corte, proposta só por propostas_criar (sem INSERT direto)');
select throws_ok($$insert into public.propostas (parceiro_id, empreendimento_id, texto, status)
  select '00000000-0000-0000-0000-00000000000c', id, 'x', 'aprovada' from public.empreendimentos where slug = 'eixo-leste'$$,
  '42501', null, 'aprovado não cria proposta já aprovada');
select throws_ok('select count(*) from public.propostas', '42501', null,
  'depois do corte, nem a própria proposta é lida direto (só propostas_listar)');
select ok(public.meu_parceiro_id() is null and not public.pode_ver_cliente('00000000-0000-0000-0000-0000000000c2'),
  'legado sem vínculo em parceiros não tem escopo de rede (o escopo nunca vem do papel)');
select throws_ok('select count(*) from public.leads', '42501', null, 'aprovado não lê leads');
select throws_ok('select count(*) from public.clientes', '42501', null, 'aprovado não lê clientes');
reset role;

-- ---------- cliente do portal ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select throws_ok('select count(*) from public.clientes', '42501', null,
  'depois do corte o titular não lê clientes direto (o portal usa as RPCs portal_*)');
select is(public.meu_cliente_id(), '00000000-0000-0000-0000-0000000000c1'::uuid, 'o titular continua identificado (meu_cliente_id)');
select is((select count(*)::int from public.cliente_negocios), 1, 'cliente vê os próprios negócios');
select is((select count(*)::int from public.obra_atualizacoes), 1, 'cliente vê só a obra do próprio empreendimento');
select is((select count(*)::int from public.unidades), 0, 'cliente não vê tabela de unidades');
select is((select count(*)::int from public.portal_acessos), 0, 'cliente não vê auditoria de acessos');
reset role;

-- ---------- admin ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select throws_ok('select count(*) from public.leads', '42501', null, 'admin não lê leads direto (só leads_listar)');
select is((select count(*)::int from public.profiles), 4, 'admin lê todos os perfis');
select throws_ok($$update public.profiles set status_parceiro = 'aprovado' where id = '00000000-0000-0000-0000-00000000000b'$$,
  '42501', null, 'admin não aprova parceiro pela API (só rede_aprovar_autocadastro) [WP1R-05]');
select throws_ok($$update public.profiles set papel = 'admin' where id = '00000000-0000-0000-0000-00000000000c'$$,
  '42501', null, 'admin não troca papel pela API');
select throws_ok($$delete from public.profiles where id = '00000000-0000-0000-0000-00000000000b'$$, '42501', null,
  'admin não exclui perfil');
select throws_ok($$delete from public.leads where nome = 'Lead'$$, '42501', null, 'admin não exclui lead direto (só leads_excluir)');
select throws_ok($$delete from public.clientes where id = '00000000-0000-0000-0000-0000000000c2'$$, '42501', null,
  'admin não exclui cliente (sem D)');
select throws_ok($$insert into public.clientes (nome, cpf, corretor_id) select 'X', '12345671483', corretor_casa_id from public.configuracao_geral$$,
  '42501', null, 'admin não define a cadeia do cliente direto');
select throws_ok($$insert into public.clientes (nome, cpf, email) values ('Pela tela antiga', '12345671564', 'antiga@t.com')$$,
  '42501', null, 'depois do corte nem o admin inclui cliente direto (só crm_cadastrar_cliente)');
select throws_ok($$update public.clientes set email = 'novo@t.com' where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '42501', null, 'depois do corte nem o admin altera cliente direto (só crm_editar_cliente)');
select throws_ok('select count(*) from public.clientes', '42501', null, 'admin não lê clientes direto (só crm_listar/crm_ficha)');
select throws_ok($$delete from public.propostas$$, '42501', null, 'ninguém exclui proposta pela API');
select throws_ok($$update public.propostas set status = 'aprovada'$$, '42501', null, 'admin não responde proposta direto (só propostas_responder)');
reset role;
select is((select count(*)::int from public.leads), 2, 'os leads continuam (exclusão só pela RPC, e só de lead novo)');
select is((select status_parceiro::text from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 'pendente',
  'o autocadastro continua pendente depois das tentativas pela API');

-- contração: o insert sem origem (a tela antiga) não libera mais o portal; o padrão é cadastro interno
insert into public.clientes (nome, cpf, email) values ('Sem origem', '12345671564', 'antiga@t.com');
insert into public.clientes (nome, cpf, origem) values ('Origem antiga', '12345671645', 'portal_admin');
select ok((select corretor_id = (select corretor_casa_id from public.configuracao_geral) and not portal_liberado
                  and origem = 'cadastro_interno'
           from public.clientes where cpf = '12345671564'),
  'contração: cliente sem origem é cadastro interno, na Carteira Arken e com o portal fechado');
select ok((select not portal_liberado from public.clientes where cpf = '12345671645'),
  'contração: origem portal_admin não libera o portal sozinha (só crm_liberar_portal)');

select * from finish();
rollback;
