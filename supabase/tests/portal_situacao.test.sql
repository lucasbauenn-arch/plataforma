-- portal_situacao_cpf: só service_role; bloqueado, inativo, anonimizado e inexistente.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(9);

-- c1 é o titular do portal na fixture: liberado
select is(public.portal_situacao_cpf((select cpf from public.clientes where id = pg_temp.cliente('c1'))), 'liberado', 'titular liberado');

update public.clientes set portal_liberado = false where id = pg_temp.cliente('c1');
select is(public.portal_situacao_cpf((select cpf from public.clientes where id = pg_temp.cliente('c1'))), 'bloqueado', 'portal suspenso');
select is(public.portal_situacao_cpf(regexp_replace((select cpf from public.clientes where id = pg_temp.cliente('c1')), '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4')), 'bloqueado', 'aceita CPF com máscara');

update public.clientes set inativado_em = now() where id = pg_temp.cliente('c1');
select is(public.portal_situacao_cpf((select cpf from public.clientes where id = pg_temp.cliente('c1'))), 'inativo', 'cadastro inativo');

update public.clientes set anonimizado_em = now() where id = pg_temp.cliente('c1');
select is(public.portal_situacao_cpf((select cpf from public.clientes where id = pg_temp.cliente('c1'))), 'nao_encontrado', 'anonimizado não é revelado');

select is(public.portal_situacao_cpf('11144477735'), 'nao_encontrado', 'CPF sem cadastro');
select is(public.portal_situacao_cpf('123'), 'nao_encontrado', 'CPF inválido');

select ok(not has_function_privilege('anon', 'public.portal_situacao_cpf(text)', 'execute'), 'anon não executa');
select ok(not has_function_privilege('authenticated', 'public.portal_situacao_cpf(text)', 'execute'), 'authenticated não executa');

select * from finish();
rollback;
