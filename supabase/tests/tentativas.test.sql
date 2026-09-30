-- Reserva atômica de tentativas nas rotas públicas (migration 20260929000019, FR1-01).
-- tentativas_reservar confere a janela e JÁ grava a tentativa como falha, sob trava consultiva por (rota, IP);
-- tentativas_confirmar marca o sucesso. Só a service role executa. A concorrência de verdade (várias conexões ao mesmo
-- tempo) foi exercitada num Postgres 17 real com 60 conexões (300 requisições do mesmo IP → 10 passam; ver "O que foi
-- testado" em scripts/migracao/DEPLOY.md) e, no Edge, por supabase/functions/_shared/limite-ip.test.ts (armazém com trava).
-- Aqui: a regra, a janela, o tudo-ou-nada, a trava consultiva e os grants.
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- ============ GRANTS E FORMA ============
select ok(
  has_function_privilege('service_role', 'public.tentativas_reservar(jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.tentativas_confirmar(bigint[])', 'execute')
  and not has_function_privilege('anon', 'public.tentativas_reservar(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.tentativas_confirmar(bigint[])', 'execute')
  and not has_function_privilege('authenticated', 'public.tentativas_reservar(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.tentativas_confirmar(bigint[])', 'execute'),
  'só a service_role executa as duas RPCs (nem anon nem authenticated)');
select ok(
  (select bool_and(p.prosecdef and p.provolatile = 'v' and p.proconfig @> array['search_path=""']) and count(*) = 2
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('tentativas_reservar', 'tentativas_confirmar')),
  'security definer, volatile e search_path vazio');
select ok(
  (select p.proconfig @> array['lock_timeout=3s'] from pg_proc p where p.oid = 'public.tentativas_reservar(jsonb)'::regprocedure),
  'tentativas_reservar não espera a trava para sempre (lock_timeout de 3 s)');
select ok(
  not has_any_column_privilege('service_role', 'public.tentativas_publicas', 'update')
  and not has_table_privilege('service_role', 'public.tentativas_publicas', 'delete')
  and has_table_privilege('service_role', 'public.tentativas_publicas', 'insert'),
  'a tabela segue só com select e insert para a service_role: o update só acontece dentro das funções');

set local role anon;
select throws_ok($$select public.tentativas_reservar('[{"rota":"x","ip":null,"janela_segundos":60,"max_erros":1,"max_total":1}]')$$,
  '42501', null, 'anon não reserva tentativas');
reset role;
set local role authenticated;
select throws_ok($$select public.tentativas_reservar('[{"rota":"x","ip":null,"janela_segundos":60,"max_erros":1,"max_total":1}]')$$,
  '42501', null, 'authenticated não reserva tentativas');
select throws_ok($$select public.tentativas_confirmar(array[1]::bigint[])$$, '42501', null, 'authenticated não confirma tentativas');
reset role;

-- ============ REGRA: erros (3 erros bloqueiam a 4ª tentativa) ============
set local role service_role;
select is(public.tentativas_reservar('[{"rota":"t-erros","ip":"203.0.113.9","janela_segundos":900,"max_erros":3,"max_total":5}]') ->> 'permitido',
  'true', 'erros: 1ª tentativa passa');
select is(jsonb_array_length(public.tentativas_reservar('[{"rota":"t-erros","ip":"203.0.113.9","janela_segundos":900,"max_erros":3,"max_total":5}]') -> 'ids'),
  1, 'erros: 2ª passa e devolve o id da reserva');
select is(public.tentativas_reservar('[{"rota":"t-erros","ip":"203.0.113.9","janela_segundos":900,"max_erros":3,"max_total":5}]') ->> 'permitido',
  'true', 'erros: 3ª passa');
select is(public.tentativas_reservar('[{"rota":"t-erros","ip":"203.0.113.9","janela_segundos":900,"max_erros":3,"max_total":5}]'),
  '{"permitido": false, "motivo": "erros", "rota": "t-erros"}'::jsonb, 'erros: a 4ª é bloqueada (3 reservas já contam como 3 falhas)');
select is((select count(*)::int from public.tentativas_publicas where rota = 't-erros'), 3,
  'a tentativa bloqueada não grava linha (a janela não se estende sozinha)');
select is((select count(*)::int from public.tentativas_publicas where rota = 't-erros' and not sucesso and ip = '203.0.113.9'), 3,
  'as reservas entram como falha, com o IP');

-- confirmar libera uma vaga de erro
select is(public.tentativas_confirmar(array[(select min(id) from public.tentativas_publicas where rota = 't-erros')]), 1,
  'confirmar marca a reserva como sucesso (1 linha)');
select is(public.tentativas_confirmar(array[(select min(id) from public.tentativas_publicas where rota = 't-erros')]), 0,
  'confirmar de novo não muda nada (só reserva ainda falha)');
select is(public.tentativas_reservar('[{"rota":"t-erros","ip":"203.0.113.9","janela_segundos":900,"max_erros":3,"max_total":5}]') ->> 'permitido',
  'true', 'com 1 sucesso e 2 falhas, cabe mais uma');
select is(public.tentativas_reservar('[{"rota":"t-erros","ip":"203.0.113.9","janela_segundos":900,"max_erros":3,"max_total":5}]') ->> 'motivo',
  'erros', 'e a seguinte volta a ser bloqueada por erros (3 falhas de novo)');

-- outro IP e outra rota não são afetados
select is(public.tentativas_reservar('[{"rota":"t-erros","ip":"203.0.113.10","janela_segundos":900,"max_erros":3,"max_total":5}]') ->> 'permitido',
  'true', 'outro IP não é afetado');
select is(public.tentativas_reservar('[{"rota":"t-outra","ip":"203.0.113.9","janela_segundos":900,"max_erros":3,"max_total":5}]') ->> 'permitido',
  'true', 'outra rota não é afetada');

-- ============ REGRA: total (5 tentativas, mesmo com sucesso, bloqueiam a 6ª) ============
select is(public.tentativas_confirmar((select array_agg(x) from (
  select (public.tentativas_reservar('[{"rota":"t-total","ip":"198.51.100.1","janela_segundos":900,"max_erros":5,"max_total":5}]') -> 'ids' ->> 0)::bigint x
    from generate_series(1, 5)) s)), 5, 'total: 5 tentativas reservadas e confirmadas como sucesso');
select is(public.tentativas_reservar('[{"rota":"t-total","ip":"198.51.100.1","janela_segundos":900,"max_erros":5,"max_total":5}]'),
  '{"permitido": false, "motivo": "total", "rota": "t-total"}'::jsonb, 'total: a 6ª é bloqueada mesmo sem nenhum erro');

-- ============ IP NULO: balde comum dos sem IP ============
select is(public.tentativas_reservar('[{"rota":"t-nulo","ip":null,"janela_segundos":900,"max_erros":2,"max_total":5}]') ->> 'permitido', 'true', 'sem IP: 1ª passa');
select is(public.tentativas_reservar('[{"rota":"t-nulo","janela_segundos":900,"max_erros":2,"max_total":5}]') ->> 'permitido', 'true', 'sem IP (chave ausente): 2ª passa, no mesmo balde');
select is(public.tentativas_reservar('[{"rota":"t-nulo","ip":null,"janela_segundos":900,"max_erros":2,"max_total":5}]') ->> 'motivo', 'erros', 'sem IP: a 3ª é bloqueada');
select is(public.tentativas_reservar('[{"rota":"t-nulo","ip":"203.0.113.9","janela_segundos":900,"max_erros":2,"max_total":5}]') ->> 'permitido', 'true',
  'o balde sem IP não bloqueia um IP');

-- ============ JANELA ============
reset role;
insert into public.tentativas_publicas (rota, ip, sucesso, criado_em)
select 't-janela', '192.0.2.5', false, now() - interval '20 minutes' from generate_series(1, 3);
set local role service_role;
select is(public.tentativas_reservar('[{"rota":"t-janela","ip":"192.0.2.5","janela_segundos":900,"max_erros":3,"max_total":5}]') ->> 'permitido', 'true',
  'janela de 15 min: 3 falhas de 20 min atrás já saíram da contagem');
select is(public.tentativas_reservar('[{"rota":"t-janela","ip":"192.0.2.5","janela_segundos":1800,"max_erros":3,"max_total":5}]') ->> 'motivo', 'erros',
  'janela de 30 min: as 3 falhas antigas voltam a contar');

-- ============ VÁRIOS BALDES: TUDO OU NADA ============
-- balde do IP com folga + balde global cheio: bloqueia pelo global e NÃO grava a reserva do IP
reset role;
insert into public.tentativas_publicas (rota, ip, sucesso) select 't-global', null, false from generate_series(1, 4);
set local role service_role;
select is(public.tentativas_reservar('[{"rota":"t-multi","ip":"203.0.113.50","janela_segundos":900,"max_erros":10,"max_total":30},
                                       {"rota":"t-global","ip":null,"janela_segundos":900,"max_erros":4,"max_total":8}]'),
  '{"permitido": false, "motivo": "erros", "rota": "t-global"}'::jsonb, 'balde global cheio bloqueia a chamada e diz qual balde foi');
select is((select count(*)::int from public.tentativas_publicas where rota = 't-multi'), 0,
  'tudo ou nada: o balde do IP não recebeu reserva porque o global bloqueou');
select is(jsonb_array_length(public.tentativas_reservar('[{"rota":"t-multi","ip":"203.0.113.50","janela_segundos":900,"max_erros":10,"max_total":30},
                                                          {"rota":"t-global2","ip":null,"janela_segundos":900,"max_erros":4,"max_total":8}]') -> 'ids'),
  2, 'com folga nos dois, reserva nos dois e devolve os dois ids');
select is((select count(*)::int from public.tentativas_publicas where rota in ('t-multi', 't-global2') and not sucesso), 2,
  'as duas reservas entraram como falha');
-- o IP bloqueado não consome o global
reset role;
insert into public.tentativas_publicas (rota, ip, sucesso) select 't-multi-ip', '203.0.113.60', false from generate_series(1, 3);
set local role service_role;
select is(public.tentativas_reservar('[{"rota":"t-multi-ip","ip":"203.0.113.60","janela_segundos":900,"max_erros":3,"max_total":30},
                                       {"rota":"t-global3","ip":null,"janela_segundos":900,"max_erros":4,"max_total":8}]') ->> 'rota',
  't-multi-ip', 'o balde do IP cheio bloqueia primeiro');
select is((select count(*)::int from public.tentativas_publicas where rota = 't-global3'), 0, 'e o global não recebeu a reserva');

-- ============ TRAVA CONSULTIVA ============
-- a trava (chave por rota + IP) fica presa à transação até o fim: é ela que serializa as chamadas concorrentes
select ok(exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
       and l.classid = (pg_catalog.hashtext('arken.tentativas')::bigint & 4294967295)::oid
       and l.objid = (pg_catalog.hashtext('t-erros:203.0.113.9')::bigint & 4294967295)::oid),
  'a reserva segura a trava consultiva da rota e do IP até o fim da transação');
select ok(exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
       and l.classid = (pg_catalog.hashtext('arken.tentativas')::bigint & 4294967295)::oid
       and l.objid = (pg_catalog.hashtext('t-nulo:')::bigint & 4294967295)::oid),
  'o balde sem IP tem a própria chave de trava (rota + vazio)');
select ok(exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
       and l.classid = (pg_catalog.hashtext('arken.tentativas')::bigint & 4294967295)::oid
       and l.objid = (pg_catalog.hashtext('t-global:')::bigint & 4294967295)::oid),
  'o balde global também trava, mesmo quando o outro balde da chamada é que decide');

-- ============ ENTRADA INVÁLIDA (última barreira; a Edge já valida) ============
select throws_ok($$select public.tentativas_reservar('{"rota":"x"}')$$, '22023', 'BALDES_INVALIDOS', 'não é array');
select throws_ok($$select public.tentativas_reservar('[]')$$, '22023', 'BALDES_INVALIDOS', 'array vazio');
select throws_ok($$select public.tentativas_reservar(null)$$, '22023', 'BALDES_INVALIDOS', 'nulo');
select throws_ok($$select public.tentativas_reservar('[{"rota":"a","ip":null,"janela_segundos":60,"max_erros":1,"max_total":1},
  {"rota":"b","ip":null,"janela_segundos":60,"max_erros":1,"max_total":1},{"rota":"c","ip":null,"janela_segundos":60,"max_erros":1,"max_total":1},
  {"rota":"d","ip":null,"janela_segundos":60,"max_erros":1,"max_total":1},{"rota":"e","ip":null,"janela_segundos":60,"max_erros":1,"max_total":1}]')$$,
  '22023', 'BALDES_INVALIDOS', 'mais de 4 baldes');
select throws_ok($$select public.tentativas_reservar('[{"rota":"Rota Ruim","ip":null,"janela_segundos":60,"max_erros":1,"max_total":1}]')$$,
  '22023', 'BALDES_INVALIDOS', 'rota fora do padrão da tabela');
select throws_ok($$select public.tentativas_reservar('[{"rota":"x","ip":"lixo","janela_segundos":60,"max_erros":1,"max_total":1}]')$$,
  '22023', 'BALDES_INVALIDOS', 'IP inválido');
select throws_ok($$select public.tentativas_reservar('[{"rota":"x","ip":null,"janela_segundos":0,"max_erros":1,"max_total":1}]')$$,
  '22023', 'BALDES_INVALIDOS', 'janela zero');
select throws_ok($$select public.tentativas_reservar('[{"rota":"x","ip":null,"janela_segundos":60,"max_erros":2,"max_total":1}]')$$,
  '22023', 'BALDES_INVALIDOS', 'mais erros permitidos do que o total');
select throws_ok($$select public.tentativas_reservar('[{"rota":"x","ip":null,"janela_segundos":60,"max_erros":1,"max_total":100000}]')$$,
  '22023', 'BALDES_INVALIDOS', 'total acima do teto');
select throws_ok($$select public.tentativas_reservar('[42]')$$, '22023', 'BALDES_INVALIDOS', 'elemento que não é objeto');
select throws_ok($$select public.tentativas_reservar('[{"rota":"x","ip":null,"janela_segundos":"muito","max_erros":1,"max_total":1}]')$$,
  '22023', 'BALDES_INVALIDOS', 'número que não é número');

-- ============ CONFIRMAR ============
select throws_ok($$select public.tentativas_confirmar(null)$$, '22023', 'IDS_INVALIDOS', 'confirmar sem ids');
select throws_ok($$select public.tentativas_confirmar('{}'::bigint[])$$, '22023', 'IDS_INVALIDOS', 'confirmar com lista vazia');
select throws_ok($$select public.tentativas_confirmar(array[1,2,3,4,5,6,7,8,9]::bigint[])$$, '22023', 'IDS_INVALIDOS', 'confirmar com mais de 8 ids');
select is(public.tentativas_confirmar(array[-1]::bigint[]), 0, 'id que não existe: nada muda');
reset role;
insert into public.tentativas_publicas (rota, ip, sucesso, criado_em) values ('t-antiga', '192.0.2.77', false, now() - interval '2 hours');
select is(public.tentativas_confirmar(array[(select id from public.tentativas_publicas where rota = 't-antiga')]), 0,
  'reserva com mais de 1 hora não é reescrita (o histórico não muda)');

select * from finish();
rollback;
