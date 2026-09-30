-- Integração com o Auth (GoTrue) achada no teste da stack local completa (WP7; migration 20260929000017):
--   1. o aviso "novo parceiro" à equipe é só do cadastro espontâneo: no convite (generateLink/inviteUserByEmail) o
--      GoTrue grava invited_at DEPOIS do insert em auth.users, na mesma transação, então o gatilho em profiles é de
--      restrição adiado (avalia no fim da transação). A conta do portal criada pela Edge cliente-login leva o marcador
--      app_metadata.portal_cliente_id e fica de fora; um cadastro com o e-mail interno do portal SEM o marcador (signUp
--      público, WP7R1-02) avisa a equipe como qualquer autocadastro;
--   2. auth.admin.deleteUser roda como supabase_auth_admin e as cascatas (clientes.user_id e parceiros.profile_id
--      SET NULL) passam pelo gatilho de auditoria, que precisa da ponte auditar_linha_gravar.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

do $$ begin
  perform vault.create_secret('http://127.0.0.1:9/notificar', 'notificar_url');
  perform vault.create_secret('segredo-de-teste-1234567890', 'notificar_secret');
end $$;
create temp table t_net on commit drop as select coalesce(max(id), 0) as id from net.http_request_queue;

-- ============ 1. aviso de novo parceiro ============
select ok((select t.tgdeferrable and t.tginitdeferred and t.tgconstraint <> 0 from pg_trigger t
           where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'notificar_novo_parceiro'),
          'notificar_novo_parceiro: gatilho de restrição adiado para o fim da transação');

-- convite: como o GoTrue faz (insere e, na mesma transação, grava invited_at)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('a7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'convidado@teste.local', '{"nome": "Convidado da Rede"}', now(), now());
update auth.users set invited_at = now() where id = 'a7000000-0000-4000-8000-000000000001';
-- autocadastro (signUp, sem convite)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('a7000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'espontaneo@teste.local', '{"nome": "Cadastro Espontâneo"}', now(), now());
-- conta do portal (cliente-login: createUser com app_metadata.portal_cliente_id)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
  ('a7000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cliente-a7000000-0000-4000-8000-000000000003@portal.arkenincorporadora.com.br', '{"nome": "Titular"}',
   '{"provider": "email", "providers": ["email"], "portal_cliente_id": "a7000000-0000-4000-8000-000000000003"}', now(), now());
-- signUp público com o e-mail interno do portal, sem o marcador (só a service role grava app_metadata)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('a7000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cliente-a7000000-0000-4000-8000-000000000004@portal.arkenincorporadora.com.br', '{"nome": "Sem marcador"}', now(), now());

select is((select count(*)::int from public.profiles where id::text like 'a7000000-%' and papel = 'parceiro'), 4,
          'os quatro perfis nascem com o papel padrão (parceiro)');
select is((select count(*)::int from net.http_request_queue where id > (select id from t_net)), 0,
          'nada é chamado durante a transação (a checagem é adiada)');
set constraints all immediate;
select is((select count(*)::int from net.http_request_queue where id > (select id from t_net) and url = 'http://127.0.0.1:9/notificar'), 2,
          'no fim da transação, avisam a equipe o cadastro espontâneo e o cadastro com e-mail do portal SEM o marcador');
select is((select array_agg(convert_from(q.body, 'utf8')::jsonb -> 'registro' ->> 'email' order by q.id) from net.http_request_queue q
           where q.id > (select id from t_net) and q.url = 'http://127.0.0.1:9/notificar'),
          array['espontaneo@teste.local', 'cliente-a7000000-0000-4000-8000-000000000004@portal.arkenincorporadora.com.br'],
          'convidado e conta do portal com o marcador ficam de fora do aviso');

-- ============ 2. exclusão pelo Auth ============
select ok(has_function_privilege('supabase_auth_admin',
            'public.auditar_linha_gravar(public.categoria_auditoria, text, text, text, uuid, text[], jsonb, jsonb)', 'execute'),
          'supabase_auth_admin executa a ponte da auditoria (cascatas do deleteUser)');
select ok(not has_function_privilege('anon',
            'public.auditar_linha_gravar(public.categoria_auditoria, text, text, text, uuid, text[], jsonb, jsonb)', 'execute'),
          'anon continua sem a ponte');
select throws_ok($$select public.auditar_linha_gravar('operacao', 'excluir', 'forjado', 'x', null, null, null, null)$$,
                 '42501', 'Uso restrito aos gatilhos de auditoria', 'a ponte segue recusando chamada fora de gatilho');
-- a cascata que o GoTrue dispara (como postgres aqui: o papel do Auth não é assumível no teste; a stack real prova o resto)
delete from auth.users where id = 'a7000000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.profiles where id = 'a7000000-0000-4000-8000-000000000002'), 0,
          'excluir o usuário no Auth remove o perfil em cascata');

select * from finish();
rollback;
