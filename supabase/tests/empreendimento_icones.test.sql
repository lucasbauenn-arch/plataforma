-- icone_catalogo em empreendimento_lazer e empreendimento_proximidades (migration 21): coluna nula por padrão, formato
-- da chave conferido no banco, dados antigos intactos, leitura pública e escrita só do admin (RLS das tabelas).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(18);

insert into public.empreendimentos (id, slug, nome) values ('e2100000-0000-4000-8000-000000000001', 'icones-teste', 'Ícones Teste');
insert into public.empreendimento_lazer (id, empreendimento_id, titulo, icone, ordem) values
  ('e2100000-0000-4000-8000-0000000000a1', 'e2100000-0000-4000-8000-000000000001', 'Academia antiga', 'wp/2025/09/10.webp', 0);
insert into public.empreendimento_proximidades (id, empreendimento_id, nome, distancia, ordem) values
  ('e2100000-0000-4000-8000-0000000000b1', 'e2100000-0000-4000-8000-000000000001', 'Mercado do bairro', '300 m', 0);

-- estrutura
select has_column('public', 'empreendimento_lazer', 'icone_catalogo', 'lazer tem icone_catalogo');
select col_is_null('public', 'empreendimento_lazer', 'icone_catalogo', 'lazer: icone_catalogo aceita nulo');
select has_column('public', 'empreendimento_proximidades', 'icone_catalogo', 'proximidades tem icone_catalogo');
select col_is_null('public', 'empreendimento_proximidades', 'icone_catalogo', 'proximidades: icone_catalogo aceita nulo');

-- item antigo continua como estava: imagem do WordPress preservada, sem ícone do catálogo
select is((select icone from public.empreendimento_lazer where id = 'e2100000-0000-4000-8000-0000000000a1'), 'wp/2025/09/10.webp', 'imagem antiga do lazer preservada');
select is((select icone_catalogo from public.empreendimento_lazer where id = 'e2100000-0000-4000-8000-0000000000a1'), null, 'item antigo sem ícone do catálogo');

-- formato da chave
select lives_ok($$update public.empreendimento_lazer set icone_catalogo = 'piscina_infantil' where id = 'e2100000-0000-4000-8000-0000000000a1'$$, 'chave válida no lazer');
select throws_ok($$update public.empreendimento_lazer set icone_catalogo = 'Piscina' where id = 'e2100000-0000-4000-8000-0000000000a1'$$, '23514', null, 'maiúscula recusada');
select throws_ok($$update public.empreendimento_lazer set icone_catalogo = 'wp/2025/09/10.webp' where id = 'e2100000-0000-4000-8000-0000000000a1'$$, '23514', null, 'caminho de imagem recusado');
select throws_ok($$update public.empreendimento_lazer set icone_catalogo = '' where id = 'e2100000-0000-4000-8000-0000000000a1'$$, '23514', null, 'texto vazio recusado');
select throws_ok($$update public.empreendimento_proximidades set icone_catalogo = repeat('a', 41) where id = 'e2100000-0000-4000-8000-0000000000b1'$$, '23514', null, 'chave longa demais recusada');
select throws_ok($$update public.empreendimento_proximidades set icone_catalogo = '<svg>' where id = 'e2100000-0000-4000-8000-0000000000b1'$$, '23514', null, 'marcação recusada');

-- escrita: admin grava; corretor não altera (RLS barra em silêncio: 0 linhas)
select pg_temp.entrar('admin');
select lives_ok($$update public.empreendimento_proximidades set icone_catalogo = 'mercado' where id = 'e2100000-0000-4000-8000-0000000000b1'$$, 'admin grava a categoria da proximidade');
select lives_ok($$insert into public.empreendimento_lazer (empreendimento_id, titulo, icone_catalogo, ordem) values ('e2100000-0000-4000-8000-000000000001', 'Piscina', 'piscina', 1)$$, 'admin cria item de lazer do catálogo');

select pg_temp.entrar('ca1a');
update public.empreendimento_proximidades set icone_catalogo = 'escola' where id = 'e2100000-0000-4000-8000-0000000000b1';
select throws_ok($$insert into public.empreendimento_lazer (empreendimento_id, titulo, icone_catalogo) values ('e2100000-0000-4000-8000-000000000001', 'Invasor', 'piscina')$$, '42501', null, 'corretor não cria item de lazer');

-- leitura pública da coluna nova
select pg_temp.entrar_anon();
select is((select icone_catalogo from public.empreendimento_proximidades where id = 'e2100000-0000-4000-8000-0000000000b1'), 'mercado', 'visitante lê a categoria; o corretor não a trocou');
select is((select count(*)::int from public.empreendimento_lazer where empreendimento_id = 'e2100000-0000-4000-8000-000000000001' and icone_catalogo = 'piscina'), 1, 'visitante lê o ícone do lazer');
select throws_ok($$update public.empreendimento_lazer set icone_catalogo = 'sauna'$$, '42501', null, 'visitante não altera');

select pg_temp.sair();
select * from finish();
rollback;
