-- Fechamento da expansão (WP7, revisões finais; docs/ARQUITETURA_EXPANSAO.md §4.3, §4.6, §5.1, §10):
--   WP7R1-06  negação de acesso registrada na auditoria, mas com teto por ator (spam por qualquer autenticado);
--   WP7R1-04  esgotamento do Storage: teto de objetos SEM registro por usuário e por pasta (crm-documentos e imoveis);
--   FR1-05    o teto da pasta de documento conta os objetos de QUEM ENVIA (o corretor não bloqueia o titular);
--   WP7RN-04  linhas de transição só do sistema não podem ser desligadas (webhook e reconciliador ficariam repetindo);
--   WP7RN-05  o cartão de contratos do painel conta pela mesma regra da lista (cadeia do cliente);
--   WP7RN-01  desbloquear e reativar não aprovam legado migrado que nunca foi aprovado e não tem CPF e CRECI (PAR-4/N8).
-- (WP7R1-03 está em lgpd.test.sql, MIG-02 em migracao.test.sql e WP7R1-02 em auth_integracao.test.sql.)
-- Dados como postgres (fixture comum + o que está abaixo); as chamadas testadas rodam com o papel do usuário.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(59);

-- ============ 1. WP7R1-06: auditoria de acesso negado com teto por ator ============
-- ca1a consulta 45 clientes que não existem: os 30 primeiros ficam registrados um a um; depois, UM registro-resumo por
-- janela de 10 minutos (sem id) e nada mais. Outro usuário não é afetado. Cliente que existe (fora do escopo) mantém o
-- titular no registro; id que não existe não vira "titular" de nada.
select pg_temp.entrar('ca1a');
select is(public.crm_ficha('f7000000-0000-4000-8000-000000000001'::uuid), null, 'ficha de id inexistente: nulo');
select is(public.crm_ficha(pg_temp.cliente('c3')), null, 'ficha de cliente fora do escopo: nulo');
do $$ begin
  for i in 1..45 loop
    perform public.crm_ficha(('f7000000-0000-4000-8000-' || lpad((100 + i)::text, 12, '0'))::uuid);
  end loop;
end $$;
select pg_temp.sair();
select cmp_ok((select count(*)::int from public.auditoria a where a.ator_id = pg_temp.usuario('ca1a') and a.acao = 'acesso_negado'),
              '<=', 31, 'acesso_negado: no máximo 30 registros individuais + 1 resumo por janela');
select cmp_ok((select count(*)::int from public.auditoria a where a.ator_id = pg_temp.usuario('ca1a') and a.acao = 'acesso_negado'),
              '>=', 30, 'acesso_negado: os primeiros 30 continuam registrados');
select is((select count(*)::int from public.auditoria a where a.ator_id = pg_temp.usuario('ca1a') and a.acao = 'acesso_negado'
             and a.detalhe ->> 'limitado' = 'true'), 1, 'acesso_negado: um único registro-resumo quando o teto é atingido');
select is((select a.entidade_id from public.auditoria a where a.ator_id = pg_temp.usuario('ca1a') and a.acao = 'acesso_negado'
             and a.detalhe ->> 'limitado' = 'true'), null, 'o resumo não leva id escolhido pelo chamador');
select is((select a.cliente_id from public.auditoria a where a.ator_id = pg_temp.usuario('ca1a') and a.acao = 'acesso_negado'
             and a.entidade_id = 'f7000000-0000-4000-8000-000000000001'), null,
          'negação de id inexistente não grava o id como titular (cliente_id nulo)');
select is((select a.cliente_id from public.auditoria a where a.ator_id = pg_temp.usuario('ca1a') and a.acao = 'acesso_negado'
             and a.entidade_id = pg_temp.cliente('c3')::text), pg_temp.cliente('c3'),
          'negação de cliente que existe grava o titular (LGPD)');
select pg_temp.entrar('ga1');
select is(public.crm_ficha(pg_temp.cliente('c3')), null, 'outro usuário: ficha fora do escopo também nula');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.ator_id = pg_temp.usuario('ga1') and a.acao = 'acesso_negado'), 1,
          'o teto é por ator: a negação de outro usuário continua registrada');

-- ============ 2. WP7R1-04: Storage sem esgotamento ============
-- Objeto de upload sem registro (o registro é opcional para quem envia) é o que enche o bucket: o teto é 20 por
-- usuário e 10 por usuário em cada pasta de documento (FR1-05: por usuário, para um não bloquear o outro). Objeto
-- registrado (cliente_documento_arquivos) não conta.
insert into public.cliente_documentos (id, cliente_id, nome, status) values
  ('f7000000-0000-4000-8000-000000000301', pg_temp.cliente('c1'), 'RG', 'pendente'),
  ('f7000000-0000-4000-8000-000000000302', pg_temp.cliente('c1'), 'CNH', 'pendente');
create function pg_temp.up(p_bucket text, p_name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id) values (p_bucket, p_name, auth.uid(), auth.uid()::text)
$$;
create function pg_temp.obj7(p_doc int, p_n int) returns text language sql immutable as $$
  select pg_temp.cliente('c1') || '/f7000000-0000-4000-8000-' || lpad((300 + p_doc)::text, 12, '0')
         || '/f7000000-0000-4000-8000-' || lpad(p_n::text, 12, '0') || '.pdf'
$$;

select pg_temp.entrar('ca1a');
select lives_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(1, 1))$$,
                'CA1a envia o primeiro arquivo do RG');
select pg_temp.sair();
-- pasta do RG com 10 objetos sem registro de CA1a (o 1º é o do teste acima; os outros 9 entram direto)
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'crm-documentos', pg_temp.obj7(1, n), pg_temp.usuario('ca1a'), pg_temp.usuario('ca1a')::text from generate_series(2, 10) n;
select pg_temp.entrar('ca1a');
select throws_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(1, 11))$$,
                 '42501', null, 'pasta do documento com 10 objetos sem registro do próprio usuário: novo envio recusado');
select lives_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(2, 1))$$,
                'outro documento do mesmo cliente segue aceitando envio');
-- FR1-05: o corretor encheu a pasta do RG, mas isso NÃO bloqueia o titular do portal nem o gerente dele (antes o teto
-- contava os objetos de todos, e o titular recebia 42501 ao enviar o próprio documento)
select pg_temp.entrar('titular_c1');
select lives_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(1, 12))$$,
                'FR1-05: o corretor encheu a pasta do RG e o titular do portal ainda envia o documento');
select pg_temp.entrar('ga1');
select lives_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(1, 13))$$,
                'FR1-05: o gerente do corretor também segue enviando para essa pasta');
select pg_temp.sair();
-- o teto da pasta vale para CADA usuário: GA1 chega a 10 objetos sem registro na pasta e não envia o 11º
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'crm-documentos', pg_temp.obj7(1, n), pg_temp.usuario('ga1'), pg_temp.usuario('ga1')::text from generate_series(20, 28) n;
select pg_temp.entrar('ga1');
select throws_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(1, 29))$$,
                 '42501', null, 'FR1-05: o teto por pasta vale para cada usuário (GA1 tem 10 na pasta e não envia o 11º)');
select pg_temp.sair();
-- CA1a chega a 20 objetos sem registro em pastas quaisquer (19 antes do próximo envio): 10 no RG + 1 na CNH + 9 aqui
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'crm-documentos', 'f7000000-0000-4000-8000-000000000999/f7000000-0000-4000-8000-000000000998/f7000000-0000-4000-8000-'
       || lpad(n::text, 12, '0') || '.pdf', pg_temp.usuario('ca1a'), pg_temp.usuario('ca1a')::text
from generate_series(1, 9) n;
select is((select count(*)::int from storage.objects o where o.bucket_id = 'crm-documentos'
             and o.owner_id = pg_temp.usuario('ca1a')::text), 20, 'preparo: CA1a tem 20 objetos sem registro');
select pg_temp.entrar('ca1a');
select throws_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(2, 2))$$,
                 '42501', null, 'usuário com 20 objetos sem registro: novo envio recusado (esgotamento do Storage)');
select pg_temp.entrar('titular_c1');
select lives_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(2, 3))$$,
                'o teto é por usuário: o titular do portal segue enviando');
select pg_temp.sair();
-- registrar um dos objetos (o que o fluxo normal faz) tira-o da conta de "sem registro"
insert into public.cliente_documento_arquivos (id, documento_id, storage_path, mime_type, tamanho_bytes, enviado_por)
values ('f7000000-0000-4000-8000-000000000311', 'f7000000-0000-4000-8000-000000000302', pg_temp.obj7(2, 1),
        'application/pdf', 1000, pg_temp.usuario('ca1a'));
select pg_temp.entrar('ca1a');
select lives_ok($$select pg_temp.up('crm-documentos', pg_temp.obj7(2, 4))$$,
                'com um objeto registrado (19 sem registro) o envio volta a ser aceito');
select pg_temp.sair();
select ok(public.pode_enviar_documento(pg_temp.obj7(2, 5)) is not null, 'pode_enviar_documento segue devolvendo booleano');

-- imoveis: <imovel_id>/<nome>.<ext>; teto por pasta = 2 × imovel_fotos_max + 10 (original + miniatura) e o mesmo
-- teto de 20 objetos sem registro por usuário
update public.configuracao_geral set imovel_fotos_max = 1;                    -- teto por pasta: 12
insert into public.imoveis (id, nome, tipo, status, criado_por) values
  ('f7000000-0000-4000-8000-000000000201', 'Rascunho do CA1a', 'casa', 'rascunho', pg_temp.usuario('ca1a')),
  ('f7000000-0000-4000-8000-000000000202', 'Outro rascunho do CA1a', 'casa', 'rascunho', pg_temp.usuario('ca1a'));
select pg_temp.entrar('ca1a');
select lives_ok($$select pg_temp.up('imoveis', 'f7000000-0000-4000-8000-000000000201/foto-1.webp')$$,
                'imoveis: a primeira foto do rascunho é aceita');
select pg_temp.sair();
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'imoveis', 'f7000000-0000-4000-8000-000000000201/foto-x' || n || '.webp', pg_temp.usuario('admin'), pg_temp.usuario('admin')::text
from generate_series(2, 12) n;
select pg_temp.entrar('ca1a');
select throws_ok($$select pg_temp.up('imoveis', 'f7000000-0000-4000-8000-000000000201/foto-z.webp')$$,
                 '42501', null, 'imoveis: pasta com 12 objetos (2 × máximo + 10): novo envio recusado');
select lives_ok($$select pg_temp.up('imoveis', 'f7000000-0000-4000-8000-000000000202/foto-1.webp')$$,
                'imoveis: outra pasta segue aceitando');
select throws_ok($$select pg_temp.up('imoveis', 'f7000000-0000-4000-8000-000000000202/foto 1.webp')$$,
                 '42501', null, 'imoveis: nome fora do formato continua recusado');
select pg_temp.sair();
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'imoveis', 'f7000000-0000-4000-8000-000000000998/f' || n || '.webp', pg_temp.usuario('ca1a'), pg_temp.usuario('ca1a')::text
from generate_series(1, 18) n;
select pg_temp.entrar('ca1a');
select throws_ok($$select pg_temp.up('imoveis', 'f7000000-0000-4000-8000-000000000202/foto-2.webp')$$,
                 '42501', null, 'imoveis: 20 objetos sem registro do usuário: novo envio recusado');
select pg_temp.sair();
insert into public.imovel_fotos (imovel_id, storage_path) values
  ('f7000000-0000-4000-8000-000000000202', 'f7000000-0000-4000-8000-000000000202/foto-1.webp');
select pg_temp.entrar('ca1a');
select lives_ok($$select pg_temp.up('imoveis', 'f7000000-0000-4000-8000-000000000202/foto-2.webp')$$,
                'imoveis: foto registrada deixa de contar como "sem registro"');
select pg_temp.sair();
select ok(has_function_privilege('authenticated', 'public.pode_enviar_foto_imovel(text)', 'execute')
          and not has_function_privilege('anon', 'public.pode_enviar_foto_imovel(text)', 'execute'),
          'pode_enviar_foto_imovel: authenticated executa (política de Storage), anon não');

-- ============ 3. WP7RN-04: linhas só do sistema não desligam ============
select pg_temp.entrar('super');
select throws_ok($$update public.status_transicoes set ativa = false
                     where entidade = 'contrato' and de = 'assinatura_pendente' and para = 'assinado'$$, '23514', null,
                 'assinatura_pendente → assinado não pode ser desligada (o webhook ficaria falhando)');
select throws_ok($$update public.status_transicoes set ativa = false
                     where entidade = 'contrato' and de = 'assinatura_pendente' and para = 'recusado'$$, '23514', null,
                 'assinatura_pendente → recusado não pode ser desligada');
select throws_ok($$update public.status_transicoes set ativa = false
                     where entidade = 'contrato' and de = 'assinatura_pendente' and para = 'expirado'$$, '23514', null,
                 'assinatura_pendente → expirado não pode ser desligada');
select throws_ok($$update public.status_transicoes set ativa = false
                     where entidade = 'contrato' and de = 'assinatura_pendente' and para = 'cancelado'$$, '23514', null,
                 'assinatura_pendente → cancelado não pode ser desligada (a saída depende do D4Sign)');
select throws_ok($$update public.status_transicoes set ativa = false
                     where entidade = 'imovel' and de = 'aprovado' and para = 'no_contrato'$$, '23514', null,
                 'imóvel aprovado → no_contrato não pode ser desligada');
select throws_ok($$update public.status_transicoes set ativa = false
                     where entidade = 'imovel' and de = 'no_contrato' and para = 'aprovado'$$, '23514', null,
                 'imóvel no_contrato → aprovado não pode ser desligada');
select lives_ok($$update public.status_transicoes set ativa = false
                    where entidade = 'contrato' and de = 'em_analise' and para = 'assinatura_pendente'$$,
                'o envio para assinatura pode ser suspenso (é o desligamento que o Super tem à mão)');
select pg_temp.sair();
select is((select t.ativa from public.status_transicoes t where t.entidade = 'contrato' and t.de = 'em_analise'
             and t.para = 'assinatura_pendente'), false, 'a suspensão do envio foi gravada');
select is((select count(*)::int from public.status_transicoes t where t.ativa and t.entidade = 'contrato'
             and t.de = 'assinatura_pendente'), 4, 'as quatro saídas de assinatura_pendente seguem ativas');
select pg_temp.entrar('super');
select lives_ok($$update public.status_transicoes set ativa = true
                    where entidade = 'contrato' and de = 'em_analise' and para = 'assinatura_pendente'$$,
                'e pode ser religado');
select lives_ok($$update public.status_transicoes set ativa = true, exige_motivo = true
                    where entidade = 'contrato' and de = 'assinatura_pendente' and para = 'assinado'$$,
                'editar outros campos da linha protegida (ativa = true) continua permitido');
select pg_temp.sair();

-- ============ 4. WP7RN-05: cartão de contratos do painel = regra da lista ============
-- c1 (CA1a) tem contrato ASSINADO (cadeia congelada em CA1a); depois o cliente é transferido para CA2a. O contrato passa
-- a ser de CA2a (contratos_listar usa a cadeia do cliente): o painel do CA1a não pode mais contá-lo.
insert into public.unidades (id, empreendimento_id, identificador, valor)
values ('f7000000-0000-4000-8000-000000000401', (select e.id from public.empreendimentos e order by e.slug limit 1), 'FECH 01', 400000);
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, assinado_em, enviado_assinatura_em)
values ('f7000000-0000-4000-8000-000000000501', pg_temp.cliente('c1'), public.modelo_vigente_id('parcelado'), 'parcelado',
  'assinado', 'f7000000-0000-4000-8000-000000000401', public.parametros_vigente_id(),
  400000, 30, 120000, 20000, 100000, 280000, 60, 8.5, 1808.33, 108500, now(), now());
select is((select k.corretor_id from public.contratos k where k.id = 'f7000000-0000-4000-8000-000000000501'), pg_temp.parceiro('ca1a'),
          'preparo: o contrato nasce na cadeia do CA1a');
select pg_temp.entrar('ca1a');
select is((public.painel_resumo() -> 'contratos' -> 'por_status' ->> 'assinado')::int, 1, 'antes da transferência o painel do CA1a conta o contrato');
select pg_temp.sair();
set local arken.motivo_vinculo = 'fixture: transferência';
update public.clientes set corretor_id = pg_temp.parceiro('ca2a') where id = pg_temp.cliente('c1');
set local arken.motivo_vinculo = '';
select is((select k.corretor_id from public.contratos k where k.id = 'f7000000-0000-4000-8000-000000000501'), pg_temp.parceiro('ca1a'),
          'preparo: a cadeia do contrato assinado continua congelada no CA1a');
select pg_temp.entrar('ca1a');
select is(coalesce((public.painel_resumo() -> 'contratos' -> 'por_status' ->> 'assinado')::int, 0), 0,
          'depois da transferência o painel do CA1a não conta o contrato que ele não lista nem abre');
select is(public.contratos_listar('{}'::jsonb) ->> 'total', '0', 'e a lista do CA1a também está vazia (mesma regra)');
select pg_temp.entrar('ca2a');
select is((public.painel_resumo() -> 'contratos' -> 'por_status' ->> 'assinado')::int, 1, 'o painel do CA2a conta o contrato do cliente que agora é dele');
select is(public.contratos_listar('{}'::jsonb) ->> 'total', '1', 'e a lista do CA2a mostra o mesmo contrato');
select pg_temp.entrar('admin');
select is((public.painel_resumo() -> 'contratos' -> 'por_status' ->> 'assinado')::int, 1, 'o interno conta todos os contratos');
select pg_temp.sair();

-- ============ 5. WP7RN-01: legado migrado só é aprovado com CPF e CRECI ============
-- A: bloqueado no sistema antigo, nunca aprovado (histórico só com a origem "migracao"), sem CPF nem CRECI.
-- B: aprovado no sistema antigo e bloqueado depois (o histórico tem "aprovado"): desbloquear é devolver o que já tinha.
-- C: legado inativado, nunca aprovado, sem CPF e CRECI: reativar não aprova (nasce bloqueado).
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select ('f7000000-0000-4000-8000-0000000006' || x.n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       x.email, jsonb_build_object('nome', x.nome), now(), now()
from (values ('01', 'legado-a@fixture.test', 'Legado A'), ('02', 'legado-b@fixture.test', 'Legado B'),
             ('03', 'legado-c@fixture.test', 'Legado C')) as x(n, email, nome);
update public.profiles set papel = 'corretor', status_parceiro = 'bloqueado'
 where id::text like 'f7000000-0000-4000-8000-0000000006%';
update public.profiles set status_parceiro = 'inativo' where id = 'f7000000-0000-4000-8000-000000000603';
insert into public.parceiros (id, profile_id, tipo, imobiliaria_id, gerente_id, nome, email, migrado_legado, inativado_em, motivo_inativacao)
select ('f7000000-0000-4000-8000-0000000007' || x.n)::uuid, ('f7000000-0000-4000-8000-0000000006' || x.n)::uuid, 'corretor',
       (select c.imobiliaria_casa_id from public.configuracao_geral c), (select c.gerente_casa_id from public.configuracao_geral c),
       x.nome, x.email, true, case when x.n = '03' then now() end, case when x.n = '03' then 'fixture' end
from (values ('01', 'legado-a@fixture.test', 'Legado A'), ('02', 'legado-b@fixture.test', 'Legado B'),
             ('03', 'legado-c@fixture.test', 'Legado C')) as x(n, email, nome);
insert into public.parceiro_status_historico (profile_id, parceiro_id, de, para, motivo, origem) values
  ('f7000000-0000-4000-8000-000000000601', 'f7000000-0000-4000-8000-000000000701', 'bloqueado', 'bloqueado', 'Migração', 'migracao'),
  ('f7000000-0000-4000-8000-000000000602', 'f7000000-0000-4000-8000-000000000702', 'aprovado', 'aprovado', 'Migração', 'migracao'),
  ('f7000000-0000-4000-8000-000000000602', 'f7000000-0000-4000-8000-000000000702', 'aprovado', 'bloqueado', 'Bloqueio', 'rpc'),
  ('f7000000-0000-4000-8000-000000000603', 'f7000000-0000-4000-8000-000000000703', 'bloqueado', 'bloqueado', 'Migração', 'migracao'),
  ('f7000000-0000-4000-8000-000000000603', 'f7000000-0000-4000-8000-000000000703', 'bloqueado', 'inativo', 'Desligamento', 'rpc');

select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.rede_desbloquear_parceiro('f7000000-0000-4000-8000-000000000701')$$),
          jsonb_build_object('sqlstate', 'P0001', 'mensagem', 'CAMPOS_OBRIGATORIOS', 'detalhe', jsonb_build_object('campos', jsonb_build_array('cpf', 'creci'))),
          'A: desbloquear legado nunca aprovado e sem CPF e CRECI → CAMPOS_OBRIGATORIOS {cpf, creci}');
select is((select pr.status_parceiro::text from public.profiles pr where pr.id = 'f7000000-0000-4000-8000-000000000601'), 'bloqueado',
          'A: continua bloqueado');
select lives_ok($$select public.rede_editar_parceiro('f7000000-0000-4000-8000-000000000701',
                    '{"cpf": "12345671483", "creci": "CRECI-LEG-A"}'::jsonb)$$, 'A: a equipe completa CPF e CRECI pela Rede');
select lives_ok($$select public.rede_desbloquear_parceiro('f7000000-0000-4000-8000-000000000701')$$,
                'A: com CPF e CRECI o desbloqueio (primeira aprovação) passa');
select is((select pr.status_parceiro::text from public.profiles pr where pr.id = 'f7000000-0000-4000-8000-000000000601'), 'aprovado',
          'A: agora aprovado');
select lives_ok($$select public.rede_desbloquear_parceiro('f7000000-0000-4000-8000-000000000702')$$,
                'B: legado que já foi aprovado volta sem exigir CPF e CRECI');
select is((select pr.status_parceiro::text from public.profiles pr where pr.id = 'f7000000-0000-4000-8000-000000000602'), 'aprovado',
          'B: aprovado');
select lives_ok($$select public.rede_reativar_parceiro('f7000000-0000-4000-8000-000000000703')$$,
                'C: reativar o legado nunca aprovado funciona, mas...');
select is((select pr.status_parceiro::text from public.profiles pr where pr.id = 'f7000000-0000-4000-8000-000000000603'), 'bloqueado',
          'C: ...o acesso volta BLOQUEADO (sem CPF e CRECI não vira aprovado pela reativação)');
select is((select p.inativado_em is null from public.parceiros p where p.id = 'f7000000-0000-4000-8000-000000000703'), true,
          'C: o vínculo foi reativado (dá para completar o cadastro)');
select is(pg_temp.erro($$select public.rede_desbloquear_parceiro('f7000000-0000-4000-8000-000000000703')$$),
          jsonb_build_object('sqlstate', 'P0001', 'mensagem', 'CAMPOS_OBRIGATORIOS', 'detalhe', jsonb_build_object('campos', jsonb_build_array('cpf', 'creci'))),
          'C: desbloquear continua exigindo CPF e CRECI');
select pg_temp.sair();
select is((select h.para::text from public.parceiro_status_historico h where h.parceiro_id = 'f7000000-0000-4000-8000-000000000703'
             order by h.id desc limit 1), 'bloqueado', 'C: o histórico registra inativo → bloqueado');

select * from finish();
rollback;
