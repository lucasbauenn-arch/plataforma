-- Imóveis [WP5] (docs/ARQUITETURA_EXPANSAO.md §1.1 E2–E4, §3.7, §3.8, §4.2, §4.4, §4.5, §8.5):
-- IMV-2 na saída do rascunho (lista de campos) e fora dele (nada de esvaziar; revisão e aprovação conferem de novo);
-- observação da devolução fora do imóvel depois do rascunho; IMV-3; corretor não altera status por update (grant de coluna);
-- RE → RA sem observação falha; fluxo RA → PE → RE → AP com historico_status e auditoria; visibilidade E4 (cadeia
-- acima vê o rascunho; outro parceiro só vê AP/NC); limite de fotos; tamanho e tipo REAIS do Storage; ordem; remoção;
-- inativação sem contrato ativo. Cada RPC: negada fora do escopo (42501, mesma mensagem para inexistente) e auditada.
-- Dados como postgres (fixture comum + imóveis e objetos do Storage abaixo); só as RPCs deste pacote são chamadas.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(152);

-- ============ DADOS DESTE TESTE (como postgres) ============
-- i01 rascunho incompleto do CA1a       i02 rascunho completo do CA1a (fluxo de status)
-- i03 aprovado do CB1a (com contrato)    i04 no contrato (cadastrado por interno)
-- i05 rascunho completo do CA2a          i06 pendente do GA1 (gerente cadastra)
-- i07 rascunho do corretor bloqueado     i08 rascunho do CA1a já inativado
-- i09 rascunho do CA1a (fotos)           i10 aprovado do CB1a, sem contrato (inativação)
insert into public.imoveis (id, nome, tipo, status, cep, uf, cidade, logradouro, numero, valor, criado_por, inativado_em)
select v.id::uuid, v.nome, v.tipo, v.status::public.status_imovel,
       case when v.completo then '01310100' end, case when v.completo then 'SP' end,
       case when v.completo then 'São Paulo' end, case when v.completo then 'Avenida Paulista' end,
       case when v.completo then '1000' end, case when v.completo then 850000 end,
       pg_temp.usuario(v.quem), case when v.inativo then now() end
from (values
  ('e5000000-0000-4000-8000-000000000001', 'Incompleto do CA1a', null,          'rascunho',    false, 'ca1a',      false),
  ('e5000000-0000-4000-8000-000000000002', 'Casa do CA1a',       'casa',        'rascunho',    true,  'ca1a',      false),
  ('e5000000-0000-4000-8000-000000000003', 'Apto do CB1a',       'apartamento', 'aprovado',    true,  'cb1a',      false),
  ('e5000000-0000-4000-8000-000000000004', 'Terreno em contrato','terreno',     'no_contrato', true,  'admin',     false),
  ('e5000000-0000-4000-8000-000000000005', 'Casa do CA2a',       'casa',        'rascunho',    true,  'ca2a',      false),
  ('e5000000-0000-4000-8000-000000000006', 'Pendente do GA1',    'casa',        'pendente',    true,  'ga1',       false),
  ('e5000000-0000-4000-8000-000000000007', 'Casa do bloqueado',  'casa',        'rascunho',    true,  'bloqueado', false),
  ('e5000000-0000-4000-8000-000000000008', 'Inativado do CA1a',  'casa',        'rascunho',    true,  'ca1a',      true),
  ('e5000000-0000-4000-8000-000000000009', 'Fotos do CA1a',      'casa',        'rascunho',    true,  'ca1a',      false),
  ('e5000000-0000-4000-8000-000000000010', 'Sala do CB1a',       'casa',        'aprovado',    true,  'cb1a',      false)
) as v(id, nome, tipo, status, completo, quem, inativo);
-- o incompleto tem só o nome (tipo nulo); o 'tipo' acima já é nulo para ele

-- contrato ativo (rascunho) com o imóvel i03
insert into public.contratos (cliente_id, modelo_id, forma_pagamento, status, imovel_id, parametros_id, valor_imovel,
  perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte, valor_parcela,
  valor_total_parcelas)
values (pg_temp.cliente('c3'), public.modelo_vigente_id('parcelado'), 'parcelado', 'rascunho',
        'e5000000-0000-4000-8000-000000000003', public.parametros_vigente_id(),
        850000, 30, 255000, 0, 255000, 595000, 60, 8.5, 4611.25, 276675);

-- objetos no bucket imoveis, como o Storage grava (metadata.size e mimetype calculados pelo servidor)
insert into storage.objects (bucket_id, name, metadata, user_metadata) values
  ('imoveis', 'e5000000-0000-4000-8000-000000000009/f1.webp',      '{"size":150000,"mimetype":"image/webp"}', '{"largura":1920,"altura":1080}'),
  ('imoveis', 'e5000000-0000-4000-8000-000000000009/f1-min.webp',  '{"size":20000,"mimetype":"image/webp"}',  null),
  ('imoveis', 'e5000000-0000-4000-8000-000000000009/f2.webp',      '{"size":140000,"mimetype":"image/webp"}', '{"largura":"x","altura":99999999}'),
  ('imoveis', 'e5000000-0000-4000-8000-000000000009/f3.jpg',       '{"size":130000,"mimetype":"image/jpeg"}', null),
  ('imoveis', 'e5000000-0000-4000-8000-000000000009/f4.png',       '{"size":120000,"mimetype":"image/png"}',  null),
  ('imoveis', 'e5000000-0000-4000-8000-000000000009/grande.webp',  '{"size":6000000,"mimetype":"image/webp"}', null),
  ('imoveis', 'e5000000-0000-4000-8000-000000000009/falso.webp',   '{"size":1000,"mimetype":"application/pdf"}', null),
  ('imoveis', 'e5000000-0000-4000-8000-000000000009/sem-meta.webp', null, null),
  ('imoveis', 'e5000000-0000-4000-8000-000000000003/interna.webp', '{"size":100000,"mimetype":"image/webp"}', null),
  ('imoveis', 'e5000000-0000-4000-8000-000000000005/do-ca2a.webp', '{"size":100000,"mimetype":"image/webp"}', null),
  ('imoveis', 'e5000000-0000-4000-8000-000000000008/inat.webp',    '{"size":100000,"mimetype":"image/webp"}', null);

create function pg_temp.visiveis() returns text[] language sql as $$
  select coalesce(array_agg(right(i.id::text, 2) order by i.id), '{}') from public.imoveis i
  where i.id::text like 'e5000000-%'
$$;
create function pg_temp.status(p text) returns text language sql as $$
  select i.status::text from public.imoveis i where i.id = ('e5000000-0000-4000-8000-0000000000' || p)::uuid
$$;
create function pg_temp.auditorias(p_entidade text, p_id text, p_acao text) returns int language sql as $$
  select count(*)::int from public.auditoria a where a.entidade = p_entidade and a.entidade_id = p_id and a.acao = p_acao
$$;
create function pg_temp.eventos() returns int language sql as $$ select count(*)::int from public.cliente_eventos $$;
create temp table eventos_antes as select pg_temp.eventos() as n;
-- linhas afetadas por um UPDATE com o papel atual (a RLS filtra em silêncio: 0 linhas, sem erro)
create function pg_temp.afetadas(p_sql text) returns int language plpgsql as $$
declare
  n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
-- ids das fotos registradas (gerados pela RPC), guardados como postgres para os testes com outros papéis
create temp table fotos_ids (storage_path text primary key, id uuid not null);
grant select on fotos_ids to authenticated;
create function pg_temp.foto(p text) returns uuid language sql as $$
  select f.id from fotos_ids f where f.storage_path like '%/' || p
$$;
create function pg_temp.ordem9() returns text[] language sql as $$
  select array_agg(split_part(f.storage_path, '/', 2) order by f.ordem) from public.imovel_fotos f
  where f.imovel_id = 'e5000000-0000-4000-8000-000000000009'
$$;

-- ============ GRANTS ============
select ok(bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('anon', p.oid, 'execute')
                   and not has_function_privilege('service_role', p.oid, 'execute'))
          and count(*) = 5,
          'as 5 RPCs de imóveis: só authenticated executa')
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('imovel_mudar_status', 'imovel_foto_registrar', 'imovel_foto_remover', 'imovel_fotos_ordenar', 'imovel_inativar');

-- ============ VISIBILIDADE E4 (antes do fluxo) ============
select pg_temp.entrar('ca1a');
select is(pg_temp.visiveis(), array['01', '02', '03', '04', '08', '09', '10'], 'CA1a: os próprios (inclusive o inativado) e os AP/NC ativos');
select pg_temp.entrar('ga1');
select is(pg_temp.visiveis(), array['01', '02', '03', '04', '06', '07', '08', '09', '10'],
          'GA1: os da equipe em qualquer status (cadeia acima), o próprio pendente e os AP/NC');
select pg_temp.entrar('ia');
select is(pg_temp.visiveis(), array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'], 'IA: tudo da imobiliária A e os AP/NC');
select pg_temp.entrar('ca2a');
select is(pg_temp.visiveis(), array['03', '04', '05', '10'], 'CA2a: o próprio rascunho e os AP/NC ativos; nada em RA/PE de outra equipe');
select pg_temp.entrar('ib');
select is(pg_temp.visiveis(), array['03', '04', '10'], 'IB: os AP/NC ativos; nenhum rascunho da imobiliária A');
select pg_temp.entrar('bloqueado');
select is(pg_temp.visiveis(), '{}'::text[], 'bloqueado vê zero, nem o próprio rascunho');
select pg_temp.entrar('admin');
select is(pg_temp.visiveis(), array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'], 'admin vê todos');

-- ============ imovel_mudar_status: IMV-2, escopo e papéis ============
select pg_temp.entrar('ca1a');
select is(pg_temp.erro($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000001', 'pendente', null)$$),
          '{"sqlstate":"P0001","mensagem":"CAMPOS_OBRIGATORIOS","detalhe":{"campos":["tipo","cep","logradouro","numero","cidade","uf","valor"]}}'::jsonb,
          'IMV-2: RA → PE com campos faltando devolve a lista, na ordem do formulário');
select is(pg_temp.status('01'), 'rascunho', 'IMV-2: o rascunho incompleto continua em rascunho');
select throws_ok($$update public.imoveis set status = 'aprovado' where id = 'e5000000-0000-4000-8000-000000000002'$$,
                 '42501', null, 'corretor não altera status por update direto (sem grant de coluna)');
select throws_ok($$update public.imoveis set observacao_revisao = 'x' where id = 'e5000000-0000-4000-8000-000000000002'$$,
                 '42501', null, 'nem a observação da revisão por update direto');
select throws_ok($$update public.imoveis set inativado_em = now() where id = 'e5000000-0000-4000-8000-000000000002'$$,
                 '42501', null, 'nem a inativação por update direto');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-0000000000ff', 'pendente', null)$$,
                 '42501', 'Sem acesso a este registro', 'imóvel inexistente: 42501 (não revela)');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000008', 'pendente', null)$$,
                 'P0001', 'Imóvel inativado não muda de status.', 'imóvel inativado não muda de status');

select pg_temp.entrar('ca2a');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'pendente', null)$$,
                 '42501', 'Sem acesso a este registro', 'CA2a (fora da cadeia) não finaliza o rascunho do CA1a: mesma mensagem');
select pg_temp.entrar('ga1');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'pendente', null)$$,
                 '42501', null, 'GA1 vê o rascunho do CA1a mas não finaliza (não é o criador nem interno)');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000006', 'em_revisao', null)$$,
                 '42501', null, 'GA1 não inicia a revisão do próprio imóvel (só internos)');
select pg_temp.entrar('ia');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'pendente', null)$$,
                 '42501', null, 'IA vê o rascunho do CA1a mas não finaliza');
select pg_temp.entrar('bloqueado');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000007', 'pendente', null)$$,
                 '42501', 'Sem acesso a este registro', 'corretor bloqueado não finaliza nem o próprio rascunho');
select pg_temp.entrar_anon();
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'pendente', null)$$,
                 '42501', null, 'anon não executa');
select pg_temp.sair();
select is(pg_temp.auditorias('imoveis', 'e5000000-0000-4000-8000-000000000002', 'mudar_status'), 0,
          'tentativas negadas não mudam nada (o raise desfaz tudo)');

-- ============ imovel_mudar_status: fluxo RA → PE → RE → RA → PE → RE → AP ============
select pg_temp.entrar('ca1a');
select lives_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'pendente', null)$$,
                'o criador finaliza o cadastro completo (RA → PE, permite_criador)');
select is(pg_temp.status('02'), 'pendente', 'imóvel em pendente');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'em_revisao', null)$$,
                 '42501', null, 'o criador não inicia a revisão (PE → RE é de interno)');
select lives_ok($$update public.imoveis set descricao = 'Ajuste enquanto pendente' where id = 'e5000000-0000-4000-8000-000000000002'$$,
                'o criador ainda edita em PE');
select pg_temp.sair();
select ok((select count(*) = 1 and bool_and(h.de = 'rascunho' and h.para = 'pendente' and h.origem = 'usuario'
                                            and h.ator_id = pg_temp.usuario('ca1a') and h.motivo is null)
           from public.historico_status h where h.entidade = 'imovel' and h.entidade_id = 'e5000000-0000-4000-8000-000000000002'),
          'historico_status: RA → PE pelo criador');
select ok((select count(*) = 1 and bool_and(a.categoria = 'operacao' and a.ator_id = pg_temp.usuario('ca1a')
                                            and a.ator_papel = 'corretor' and a.ator_parceiro_id = pg_temp.parceiro('ca1a')
                                            and a.origem = 'rpc' and a.campos = array['status']
                                            and a.antes = '{"status":"rascunho"}' and a.depois = '{"status":"pendente"}'
                                            and a.cliente_id is null)
           from public.auditoria a where a.entidade = 'imoveis' and a.acao = 'mudar_status'
             and a.entidade_id = 'e5000000-0000-4000-8000-000000000002'),
          'auditoria: operacao/mudar_status com ator, vínculo e status antes/depois');

select pg_temp.entrar('admin');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'aprovado', null)$$,
                 'P0001', 'TRANSICAO_INVALIDA', 'PE → AP não existe: passa pela revisão');
select lives_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'em_revisao', null)$$,
                'interno inicia a revisão (PE → RE)');
select is(pg_temp.erro($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'rascunho', null)$$),
          '{"sqlstate":"P0001","mensagem":"MOTIVO_OBRIGATORIO","detalhe":null}'::jsonb, 'RE → RA sem observação falha');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'rascunho', '   ')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'RE → RA com observação em branco falha');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'rascunho', 'ok')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'RE → RA com observação curta demais falha');
select lives_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'rascunho', '  Faltam fotos da fachada  ')$$,
                'interno devolve com observação (RE → RA)');
select pg_temp.sair();
select is((select i.status::text || ' | ' || i.observacao_revisao from public.imoveis i where i.id = 'e5000000-0000-4000-8000-000000000002'),
          'rascunho | Faltam fotos da fachada', 'a observação (sem espaços nas pontas) fica em observacao_revisao');
select is((select h.motivo from public.historico_status h where h.entidade_id = 'e5000000-0000-4000-8000-000000000002'
             and h.de = 'em_revisao' and h.para = 'rascunho'),
          'Faltam fotos da fachada', 'historico_status guarda a observação da devolução');
select ok((select a.campos = array['status', 'observacao_revisao'] and a.detalhe = '{"com_observacao":true}'
                  and a.ator_id = pg_temp.usuario('admin') and a.ator_papel = 'admin'
           from public.auditoria a where a.entidade = 'imoveis' and a.acao = 'mudar_status'
             and a.entidade_id = 'e5000000-0000-4000-8000-000000000002' and a.depois = '{"status":"rascunho"}'),
          'auditoria da devolução: campos e indicação de observação');
select is((select count(*)::int from public.auditoria a where a.entidade_id = 'e5000000-0000-4000-8000-000000000002'
             and a::text like '%fachada%'),
          0, 'o texto da observação nunca vai para a auditoria');

select pg_temp.entrar('ca1a');
select lives_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'pendente', null)$$,
                'o criador finaliza de novo depois da devolução');
select pg_temp.entrar('ca2a');
select is(pg_temp.visiveis(), array['03', '04', '05', '10'], 'E4: CA2a ainda não vê o imóvel do CA1a em PE');

-- a observação da devolução é só para quem ajusta o rascunho: sai do imóvel na nova finalização (WP5R-02)
select pg_temp.sair();
select is((select i.observacao_revisao from public.imoveis i where i.id = 'e5000000-0000-4000-8000-000000000002'), null,
          'finalizado de novo, a observação da devolução sai do imóvel');
select is((select array_agg(a.campos::text || ' ' || a.detalhe::text order by a.id) from public.auditoria a
            where a.entidade = 'imoveis' and a.acao = 'mudar_status' and a.antes = '{"status":"rascunho"}'
              and a.entidade_id = 'e5000000-0000-4000-8000-000000000002'),
          array['{status} {"com_observacao": false}',
                '{status,observacao_revisao} {"com_observacao": false, "observacao_removida": true}'],
          'auditoria: a segunda finalização registra a remoção da observação (sem o texto)');
select is((select count(*)::int from public.historico_status h
            where h.entidade = 'imovel' and h.entidade_id = 'e5000000-0000-4000-8000-000000000002'
              and h.motivo = 'Faltam fotos da fachada'),
          1, 'o texto da devolução continua em historico_status (só internos leem)');

-- MFA exigida (H5): interno em aal1 não é interno
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = true;
select pg_temp.entrar('admin');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'em_revisao', null)$$,
                 '42501', null, 'com 2FA exigida, interno em aal1 não revisa (is_admin falso)');
select pg_temp.entrar('admin', 'aal2');
select lives_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'em_revisao', null)$$,
                'com 2FA exigida, interno em aal2 inicia a revisão');
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = false;

select pg_temp.entrar('ca1a');
select is(pg_temp.afetadas($$update public.imoveis set nome = 'mudado' where id = 'e5000000-0000-4000-8000-000000000002'$$), 0,
          'em RE o criador não edita mais (política de update)');
select pg_temp.entrar('super');
select lives_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'aprovado', 'Conferido')$$,
                'Super aprova (RE → AP)');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'no_contrato', null)$$,
                 '42501', null, 'AP → NC é só do sistema (envio do contrato)');
select is(pg_temp.erro($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000002', 'rascunho', 'voltar')$$),
          '{"sqlstate":"P0001","mensagem":"TRANSICAO_INVALIDA","detalhe":{"entidade":"imovel","de":"aprovado","para":"rascunho"}}'::jsonb,
          'AP → RA não existe: TRANSICAO_INVALIDA com {entidade, de, para}');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000004', 'aprovado', null)$$,
                 '42501', null, 'NC → AP é só do sistema (retorno do contrato)');
select pg_temp.sair();
select is((select array_agg(h.de || '>' || h.para order by h.id) from public.historico_status h
            where h.entidade = 'imovel' and h.entidade_id = 'e5000000-0000-4000-8000-000000000002'),
          array['rascunho>pendente', 'pendente>em_revisao', 'em_revisao>rascunho', 'rascunho>pendente', 'pendente>em_revisao',
                'em_revisao>aprovado'],
          'historico_status: o fluxo inteiro, uma linha por transição');
select is(pg_temp.auditorias('imoveis', 'e5000000-0000-4000-8000-000000000002', 'mudar_status'), 6,
          'auditoria: uma linha por transição feita pela RPC');

-- visibilidade E4 depois da aprovação
select pg_temp.entrar('ca2a');
select is(pg_temp.visiveis(), array['02', '03', '04', '05', '10'], 'E4: aprovado, o imóvel do CA1a aparece para CA2a');
select pg_temp.entrar('cb1a');
select ok('02' = any (pg_temp.visiveis()), 'E4: e para a outra imobiliária');
select is((select i.observacao_revisao from public.imoveis i where i.id = 'e5000000-0000-4000-8000-000000000002'), null,
          'a outra imobiliária não lê a observação da revisão interna no imóvel aprovado');
select is(pg_temp.afetadas($$update public.imoveis set valor = 1 where id = 'e5000000-0000-4000-8000-000000000003'$$), 0,
          'depois de AP o criador não edita (só internos)');

-- ============ IMV-3: valor travado em no_contrato ============
select pg_temp.entrar('admin');
select throws_ok($$update public.imoveis set valor = 900000 where id = 'e5000000-0000-4000-8000-000000000004'$$,
                 '23514', 'O valor de um imóvel em contrato não pode ser alterado', 'IMV-3: nem o interno muda o valor em NC');
select lives_ok($$update public.imoveis set descricao = 'Descrição revisada' where id = 'e5000000-0000-4000-8000-000000000004'$$,
                'IMV-3: os outros campos continuam editáveis pelo interno em NC');
select lives_ok($$update public.imoveis set valor = 850000 where id = 'e5000000-0000-4000-8000-000000000004'$$,
                'IMV-3: gravar o mesmo valor não conta como mudança');

-- ============ IMV-2 fora do rascunho (WP5R-01): nada de esvaziar; revisão e aprovação conferem de novo ============
-- Ids e51…, fora de pg_temp.visiveis(). j1 completo do CA1a (rascunho); j2 PE incompleto e j3 PE completo com observação
-- ainda no imóvel: dados antigos, gravados como postgres.
select pg_temp.sair();
insert into public.imoveis (id, nome, tipo, status, cep, uf, cidade, logradouro, numero, valor, observacao_revisao, criado_por)
values
  ('e5100000-0000-4000-8000-000000000001', 'Casa j1 do CA1a', 'casa', 'rascunho', '01310100', 'SP', 'São Paulo',
   'Avenida Paulista', '1000', 850000, null, pg_temp.usuario('ca1a')),
  ('e5100000-0000-4000-8000-000000000002', 'Antigo incompleto', 'casa', 'pendente', null, null, null, null, null, null, null,
   pg_temp.usuario('ca1a')),
  ('e5100000-0000-4000-8000-000000000003', 'Antigo com observação', 'casa', 'pendente', '01310100', 'SP', 'São Paulo',
   'Avenida Paulista', '2000', 500000, 'Dívida de IPTU do proprietário', pg_temp.usuario('ca1a'));

select pg_temp.entrar('ca1a');
select lives_ok($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000001', 'pendente', null)$$,
                'j1 finalizado (RA → PE)');
select is(pg_temp.erro($$update public.imoveis set valor = null, nome = '  ', cep = null, logradouro = null
                         where id = 'e5100000-0000-4000-8000-000000000001'$$),
          '{"sqlstate":"P0001","mensagem":"CAMPOS_OBRIGATORIOS","detalhe":{"campos":["nome","cep","logradouro","valor"]}}'::jsonb,
          'em PE o criador não esvazia campos do IMV-2 (devolve os que ficariam faltando)');
select lives_ok($$update public.imoveis set valor = 900000, nome = 'Casa j1 (ajustada)' where id = 'e5100000-0000-4000-8000-000000000001'$$,
                'em PE o criador troca um campo do IMV-2 por outro valor válido');
select pg_temp.entrar('admin');
select lives_ok($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000001', 'em_revisao', null)$$, 'j1: PE → RE');
select throws_ok($$update public.imoveis set uf = null where id = 'e5100000-0000-4000-8000-000000000001'$$,
                 'P0001', 'CAMPOS_OBRIGATORIOS', 'em RE nem o interno esvazia campo do IMV-2');
select lives_ok($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000001', 'aprovado', null)$$, 'j1: RE → AP');
select is(pg_temp.erro($$update public.imoveis set valor = null where id = 'e5100000-0000-4000-8000-000000000001'$$),
          '{"sqlstate":"P0001","mensagem":"CAMPOS_OBRIGATORIOS","detalhe":{"campos":["valor"]}}'::jsonb,
          'em AP o interno não tira o valor (imóvel visível a todos os parceiros e disponível para contrato)');
select lives_ok($$update public.imoveis set descricao = 'Revisada', numero = '1000A' where id = 'e5100000-0000-4000-8000-000000000001'$$,
                'em AP o interno continua editando, sem esvaziar');
select pg_temp.sair();
select is((select i.status::text || ' | ' || i.nome || ' | ' || i.valor::text || ' | ' || cardinality(public._imovel_campos_faltando(i.id))
           from public.imoveis i where i.id = 'e5100000-0000-4000-8000-000000000001'),
          'aprovado | Casa j1 (ajustada) | 900000.00 | 0', 'j1 aprovado e completo: as tentativas de esvaziar não gravaram nada');

-- j2: dado antigo incompleto fora do rascunho não avança
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000002', 'em_revisao', null)$$),
          '{"sqlstate":"P0001","mensagem":"CAMPOS_OBRIGATORIOS","detalhe":{"campos":["cep","logradouro","numero","cidade","uf","valor"]}}'::jsonb,
          'PE → RE com campos faltando: CAMPOS_OBRIGATORIOS com a lista');
select pg_temp.entrar('ca1a');
select throws_ok($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000002', 'em_revisao', null)$$,
                 '42501', null, 'quem não pode mudar o status recebe 42501, e não a lista de campos');
select pg_temp.sair();
update public.imoveis set status = 'em_revisao' where id = 'e5100000-0000-4000-8000-000000000002';
select pg_temp.entrar('super');
select is(pg_temp.erro($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000002', 'aprovado', 'Conferido')$$),
          '{"sqlstate":"P0001","mensagem":"CAMPOS_OBRIGATORIOS","detalhe":{"campos":["cep","logradouro","numero","cidade","uf","valor"]}}'::jsonb,
          'RE → AP com campos faltando: nem o Super aprova');
select throws_ok($$update public.imoveis set cep = '01310100' where id = 'e5100000-0000-4000-8000-000000000002'$$,
                 'P0001', 'CAMPOS_OBRIGATORIOS', 'fora do rascunho, completar só parte do IMV-2 também é recusado (tudo de uma vez)');
select lives_ok($$update public.imoveis set descricao = 'Aguardando endereço' where id = 'e5100000-0000-4000-8000-000000000002'$$,
                'os campos fora do IMV-2 continuam editáveis no imóvel incompleto');
select lives_ok($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000002', 'rascunho', 'Complete o endereço e o valor')$$,
                'a devolução (RE → RA) continua livre, para o ajuste');
select pg_temp.sair();
select is((select i.status::text from public.imoveis i where i.id = 'e5100000-0000-4000-8000-000000000002'), 'rascunho',
          'o incompleto não chegou a RE pela RPC nem a AP');
select is((select array_agg(h.de || '>' || h.para order by h.id) from public.historico_status h
            where h.entidade = 'imovel' and h.entidade_id = 'e5100000-0000-4000-8000-000000000002'),
          array['em_revisao>rascunho'], 'as transições recusadas não deixaram rastro em historico_status');
select pg_temp.entrar('ca1a');
select lives_ok($$update public.imoveis set cep = '01310100', uf = 'SP', cidade = 'São Paulo', logradouro = 'Rua Augusta',
                   numero = '10', valor = 400000 where id = 'e5100000-0000-4000-8000-000000000002'$$,
                'no rascunho o criador completa os campos');
select lives_ok($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000002', 'pendente', null)$$,
                'completo, o criador finaliza de novo');
select pg_temp.sair();
select is((select i.observacao_revisao from public.imoveis i where i.id = 'e5100000-0000-4000-8000-000000000002'), null,
          'a observação da devolução saiu na nova finalização');

-- j3: observação que ainda estava no imóvel sai na aprovação (WP5R-02)
select pg_temp.entrar('admin');
select lives_ok($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000003', 'em_revisao', null)$$, 'j3: PE → RE');
select pg_temp.sair();
select is((select i.observacao_revisao from public.imoveis i where i.id = 'e5100000-0000-4000-8000-000000000003'),
          'Dívida de IPTU do proprietário', 'em RE a observação continua no imóvel (RE só é visível a internos e à cadeia)');
select pg_temp.entrar('admin');
select lives_ok($$select public.imovel_mudar_status('e5100000-0000-4000-8000-000000000003', 'aprovado', null)$$, 'j3: RE → AP');
select pg_temp.entrar('cb1a');
select is((select i.status::text || ' | ' || coalesce(i.observacao_revisao, '<nula>') from public.imoveis i
            where i.id = 'e5100000-0000-4000-8000-000000000003'),
          'aprovado | <nula>', 'aprovado, o imóvel aparece para outra imobiliária sem a observação da revisão');
select pg_temp.sair();
select ok((select a.campos = array['status', 'observacao_revisao'] and a.detalhe = '{"com_observacao":false,"observacao_removida":true}'
                  and a::text not like '%IPTU%'
           from public.auditoria a where a.entidade = 'imoveis' and a.acao = 'mudar_status'
             and a.entidade_id = 'e5100000-0000-4000-8000-000000000003' and a.depois = '{"status":"aprovado"}'),
          'auditoria da aprovação: a observação removida entra nos campos, sem o texto');

-- ============ imovel_foto_registrar ============
select pg_temp.entrar('ca2a');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f1.webp', null)$$,
                 '42501', 'Sem acesso a este registro', 'CA2a (fora da cadeia) não registra foto no imóvel do CA1a');
select pg_temp.entrar('ga1');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f1.webp', null)$$,
                 '42501', null, 'GA1 vê o rascunho mas não edita as fotos');
select pg_temp.entrar('ca1a');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-0000000000ff', 'e5000000-0000-4000-8000-0000000000ff/f1.webp', null)$$,
                 '42501', 'Sem acesso a este registro', 'imóvel inexistente: 42501');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000003/interna.webp', null)$$,
                 '42501', null, 'o criador não mexe nas fotos de imóvel aprovado');
select is(pg_temp.erro($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000005/do-ca2a.webp', null)$$),
          '{"sqlstate":"P0001","mensagem":"ARQUIVO_INVALIDO","detalhe":{"motivo":"caminho"}}'::jsonb,
          'caminho na pasta de outro imóvel é recusado');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/Foto.PNG', null)$$,
                 'P0001', 'ARQUIVO_INVALIDO', 'nome fora do formato é recusado');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/../x.webp', null)$$,
                 'P0001', 'ARQUIVO_INVALIDO', 'caminho com subpasta é recusado');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f1.webp', 'e5000000-0000-4000-8000-000000000009/f1.webp')$$,
                 'P0001', 'ARQUIVO_INVALIDO', 'miniatura igual à foto é recusada');
select is(pg_temp.erro($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/nao-enviada.webp', null)$$),
          '{"sqlstate":"P0001","mensagem":"ARQUIVO_INVALIDO","detalhe":{"motivo":"nao_encontrado"}}'::jsonb,
          'arquivo que não está no bucket é recusado');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f1.webp', 'e5000000-0000-4000-8000-000000000009/nao-enviada-min.webp')$$,
                 'P0001', 'ARQUIVO_INVALIDO', 'miniatura que não está no bucket é recusada');
select is(pg_temp.erro($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/grande.webp', null)$$),
          '{"sqlstate":"P0001","mensagem":"ARQUIVO_INVALIDO","detalhe":{"motivo":"tamanho_ou_tipo","max_bytes":5242880}}'::jsonb,
          'tamanho REAL acima do limite é recusado');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/falso.webp', null)$$,
                 'P0001', 'ARQUIVO_INVALIDO', 'tipo REAL fora de jpeg/png/webp é recusado (a extensão não basta)');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/sem-meta.webp', null)$$,
                 'P0001', 'ARQUIVO_INVALIDO', 'objeto sem metadados do Storage é recusado');

select lives_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f1.webp', 'e5000000-0000-4000-8000-000000000009/f1-min.webp')$$,
                'o criador registra a foto com miniatura');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f1.webp', null)$$,
                 'P0001', 'ARQUIVO_INVALIDO', 'o mesmo arquivo não é registrado duas vezes');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f1-min.webp', null)$$,
                 'P0001', 'ARQUIVO_INVALIDO', 'a miniatura de outra foto não vira foto');
select lives_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f2.webp', null)$$,
                'foto sem miniatura');
select lives_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f3.jpg', null)$$,
                'foto jpeg');
select is((select array_agg(f.ordem order by f.criado_em, f.ordem) from public.imovel_fotos f where f.imovel_id = 'e5000000-0000-4000-8000-000000000009'),
          array[0, 1, 2]::smallint[], 'as fotos entram no fim da ordem, a primeira é a capa');
select pg_temp.sair();
select ok((select f.bytes = 150000 and f.largura = 1920 and f.altura = 1080 and f.criado_por = pg_temp.usuario('ca1a')
                  and f.miniatura_path = 'e5000000-0000-4000-8000-000000000009/f1-min.webp'
           from public.imovel_fotos f where f.storage_path = 'e5000000-0000-4000-8000-000000000009/f1.webp'),
          'bytes vêm do Storage; largura e altura do upload; autoria de quem registrou');
select ok((select f.bytes = 140000 and f.largura is null and f.altura is null
           from public.imovel_fotos f where f.storage_path = 'e5000000-0000-4000-8000-000000000009/f2.webp'),
          'dimensões inválidas no upload ficam nulas');
select ok((select count(*) = 3 and bool_and(a.categoria = 'operacao' and a.ator_id = pg_temp.usuario('ca1a')
                                            and a.detalhe ->> 'imovel_id' = 'e5000000-0000-4000-8000-000000000009')
           from public.auditoria a where a.entidade = 'imovel_fotos' and a.acao = 'criar'),
          'auditoria: operacao/criar por foto registrada, com o imóvel no detalhe');

-- limite de fotos (imovel_fotos_max)
update public.configuracao_geral set imovel_fotos_max = 3;
select pg_temp.entrar('ca1a');
select is(pg_temp.erro($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000009/f4.png', null)$$),
          '{"sqlstate":"P0001","mensagem":"LIMITE_FOTOS","detalhe":{"maximo":3}}'::jsonb,
          'limite de fotos: a quarta é recusada com o máximo configurado');
select pg_temp.sair();
update public.configuracao_geral set imovel_fotos_max = 20;
select is((select count(*)::int from public.imovel_fotos f where f.imovel_id = 'e5000000-0000-4000-8000-000000000009'), 3,
          'limite de fotos: nada foi gravado');

-- internos editam fotos em qualquer status; imóvel inativado não recebe foto
select pg_temp.entrar('admin');
select lives_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000003/interna.webp', null)$$,
                'interno registra foto em imóvel aprovado');
select throws_ok($$select public.imovel_foto_registrar('e5000000-0000-4000-8000-000000000008', 'e5000000-0000-4000-8000-000000000008/inat.webp', null)$$,
                 'P0001', 'Imóvel inativado não pode ser alterado.', 'imóvel inativado não recebe foto');

-- ============ imovel_fotos_ordenar ============
select pg_temp.sair();
insert into fotos_ids select f.storage_path, f.id from public.imovel_fotos f
  where f.imovel_id in ('e5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-000000000003');

select pg_temp.entrar('ca2a');
select throws_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000009', array[%L, %L, %L]::uuid[])$$,
                        pg_temp.foto('f3.jpg'), pg_temp.foto('f1.webp'), pg_temp.foto('f2.webp')),
                 '42501', 'Sem acesso a este registro', 'CA2a não ordena as fotos do CA1a');
select pg_temp.entrar('ca1a');
select throws_ok($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-0000000000ff', '{}')$$,
                 '42501', 'Sem acesso a este registro', 'ordenar imóvel inexistente: 42501');
select is(pg_temp.erro(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000009', array[%L, %L]::uuid[])$$,
                              pg_temp.foto('f3.jpg'), pg_temp.foto('f1.webp'))),
          '{"sqlstate":"P0001","mensagem":"DADOS_INVALIDOS","detalhe":{"motivo":"lista_fotos"}}'::jsonb,
          'lista incompleta é recusada');
select throws_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000009', array[%L, %L, %L]::uuid[])$$,
                        pg_temp.foto('f3.jpg'), pg_temp.foto('f3.jpg'), pg_temp.foto('f1.webp')),
                 'P0001', 'DADOS_INVALIDOS', 'lista com repetição é recusada');
select throws_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000009', array[%L, %L, %L]::uuid[])$$,
                        pg_temp.foto('f3.jpg'), pg_temp.foto('f1.webp'), pg_temp.foto('interna.webp')),
                 'P0001', 'DADOS_INVALIDOS', 'lista com foto de outro imóvel é recusada');
select throws_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000009', array[%L, null, %L]::uuid[])$$,
                        pg_temp.foto('f3.jpg'), pg_temp.foto('f1.webp')),
                 'P0001', 'DADOS_INVALIDOS', 'lista com nulo é recusada');
select lives_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000009', array[%L, %L, %L]::uuid[])$$,
                       pg_temp.foto('f3.jpg'), pg_temp.foto('f1.webp'), pg_temp.foto('f2.webp')),
                'o criador reordena (nova capa)');
select is(pg_temp.ordem9(), array['f3.jpg', 'f1.webp', 'f2.webp'], 'nova ordem gravada');
select pg_temp.sair();
select ok((select count(*) = 1 and bool_and(a.detalhe = '{"fotos":3}' and a.campos = array['ordem']
                                            and a.ator_id = pg_temp.usuario('ca1a'))
           from public.auditoria a where a.entidade = 'imoveis' and a.acao = 'ordenar_fotos'
             and a.entidade_id = 'e5000000-0000-4000-8000-000000000009'),
          'auditoria: operacao/ordenar_fotos com a quantidade');

-- ============ imovel_foto_remover ============
select pg_temp.entrar('ca2a');
select throws_ok(format($$select public.imovel_foto_remover(%L)$$, pg_temp.foto('f1.webp')),
                 '42501', 'Sem acesso a este registro', 'CA2a não remove foto do CA1a');
select pg_temp.entrar('ga1');
select throws_ok(format($$select public.imovel_foto_remover(%L)$$, pg_temp.foto('f1.webp')),
                 '42501', null, 'GA1 (cadeia acima) não remove foto');
select pg_temp.entrar('ca1a');
select throws_ok($$select public.imovel_foto_remover('e5000000-0000-4000-8000-0000000000ff')$$,
                 '42501', 'Sem acesso a este registro', 'foto inexistente: 42501');
select lives_ok(format($$select public.imovel_foto_remover(%L)$$, pg_temp.foto('f1.webp')), 'o criador remove a foto');
select is(pg_temp.ordem9(), array['f3.jpg', 'f2.webp'], 'a foto some e a ordem continua contínua');
select is((select array_agg(f.ordem order by f.ordem) from public.imovel_fotos f where f.imovel_id = 'e5000000-0000-4000-8000-000000000009'),
          array[0, 1]::smallint[], 'ordens renumeradas 0, 1');
select pg_temp.sair();
select ok((select count(*) = 1 and bool_and(a.detalhe ->> 'imovel_id' = 'e5000000-0000-4000-8000-000000000009'
                                            and a.ator_id = pg_temp.usuario('ca1a'))
           from public.auditoria a where a.entidade = 'imovel_fotos' and a.acao = 'excluir'
             and a.entidade_id = pg_temp.foto('f1.webp')::text),
          'auditoria: operacao/excluir da foto');

-- depois da finalização o criador não mexe mais nas fotos; o interno sim
update public.imoveis set status = 'em_revisao' where id = 'e5000000-0000-4000-8000-000000000009';
select pg_temp.entrar('ca1a');
select throws_ok(format($$select public.imovel_foto_remover(%L)$$, pg_temp.foto('f2.webp')),
                 '42501', null, 'em RE o criador não remove foto');
select throws_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000009', array[%L, %L]::uuid[])$$,
                        pg_temp.foto('f2.webp'), pg_temp.foto('f3.jpg')),
                 '42501', null, 'em RE o criador não reordena');
select pg_temp.entrar('admin');
select lives_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000009', array[%L, %L]::uuid[])$$,
                       pg_temp.foto('f2.webp'), pg_temp.foto('f3.jpg')),
                'em RE o interno reordena');
select lives_ok(format($$select public.imovel_foto_remover(%L)$$, pg_temp.foto('f3.jpg')), 'em RE o interno remove');
select is(pg_temp.ordem9(), array['f2.webp'], 'sobrou uma foto');

-- ============ imovel_inativar ============
select pg_temp.entrar('ca2a');
select throws_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000005', 'Não quero mais')$$,
                 '42501', 'Sem acesso a este registro', 'nem o criador inativa (só internos)');
select pg_temp.entrar('ia');
select throws_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000005', 'Imóvel vendido por fora')$$,
                 '42501', null, 'a imobiliária não inativa');
select pg_temp.entrar('admin');
select throws_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-0000000000ff', 'Imóvel vendido por fora')$$,
                 '42501', 'Sem acesso a este registro', 'inativar imóvel inexistente: 42501');
select throws_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000005', null)$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'sem motivo falha');
select throws_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000005', '  abc  ')$$,
                 'P0001', 'MOTIVO_OBRIGATORIO', 'motivo curto falha');
select throws_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000004', 'Imóvel vendido por fora')$$,
                 'P0001', 'CONTRATO_ATIVO', 'imóvel no contrato não é inativado');
select throws_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000003', 'Imóvel vendido por fora')$$,
                 'P0001', 'CONTRATO_ATIVO', 'imóvel com contrato ativo (rascunho) não é inativado');
select pg_temp.sair();
update public.contratos set status = 'cancelado', encerrado_em = now() where imovel_id = 'e5000000-0000-4000-8000-000000000003';
select pg_temp.entrar('admin');
select lives_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000003', 'Contrato cancelado; imóvel retirado')$$,
                'com o contrato cancelado, o imóvel pode ser inativado');
select lives_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000010', '  Proprietário desistiu da venda  ')$$,
                'interno inativa imóvel aprovado sem contrato');
select throws_ok($$select public.imovel_inativar('e5000000-0000-4000-8000-000000000010', 'Proprietário desistiu da venda')$$,
                 'P0001', 'Este imóvel já está inativado.', 'inativar de novo falha');
select throws_ok($$select public.imovel_mudar_status('e5000000-0000-4000-8000-000000000010', 'no_contrato', null)$$,
                 'P0001', 'Imóvel inativado não muda de status.', 'imóvel inativado não muda de status nem pelo interno');
select pg_temp.sair();
select ok((select i.inativado_em is not null and i.inativado_por = pg_temp.usuario('admin')
                  and i.motivo_inativacao = 'Proprietário desistiu da venda' and i.status = 'aprovado'
           from public.imoveis i where i.id = 'e5000000-0000-4000-8000-000000000010'),
          'inativação grava quando, quem e o motivo, sem mudar o status');
select ok((select count(*) = 1 and bool_and(a.categoria = 'operacao' and a.ator_id = pg_temp.usuario('admin')
                                            and a.campos = array['inativado_em', 'motivo_inativacao']
                                            and a.antes = '{"status":"aprovado","inativado":false}'
                                            and a.depois = '{"status":"aprovado","inativado":true}'
                                            and a::text not like '%desistiu%')
           from public.auditoria a where a.entidade = 'imoveis' and a.acao = 'inativar'
             and a.entidade_id = 'e5000000-0000-4000-8000-000000000010'),
          'auditoria: operacao/inativar sem o texto do motivo');
select pg_temp.entrar('ca2a');
select is(pg_temp.visiveis(), array['02', '04', '05'], 'E4: inativados somem para quem está fora da cadeia');
select pg_temp.entrar('cb1a');
select ok(pg_temp.visiveis() @> array['03', '10'], 'E4: o criador continua vendo os próprios inativados');

-- ============ fotos de imóvel inativado: só o interno retira (conteúdo impróprio); ninguém reordena ============
select pg_temp.sair();
insert into public.imovel_fotos (imovel_id, storage_path)
values ('e5000000-0000-4000-8000-000000000008', 'e5000000-0000-4000-8000-000000000008/inat.webp');
insert into fotos_ids select f.storage_path, f.id from public.imovel_fotos f
  where f.imovel_id = 'e5000000-0000-4000-8000-000000000008';
select pg_temp.entrar('ca1a');
select throws_ok(format($$select public.imovel_foto_remover(%L)$$, pg_temp.foto('inat.webp')),
                 '42501', 'Sem acesso a este registro', 'o criador não remove foto do próprio imóvel inativado');
select throws_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000008', array[%L]::uuid[])$$,
                        pg_temp.foto('inat.webp')),
                 '42501', null, 'nem reordena');
select pg_temp.entrar('admin');
select throws_ok(format($$select public.imovel_fotos_ordenar('e5000000-0000-4000-8000-000000000008', array[%L]::uuid[])$$,
                        pg_temp.foto('inat.webp')),
                 'P0001', 'Imóvel inativado não pode ser alterado.', 'o interno também não reordena foto de imóvel inativado');
select lives_ok(format($$select public.imovel_foto_remover(%L)$$, pg_temp.foto('inat.webp')),
                'o interno retira a foto de imóvel inativado');
select pg_temp.sair();
select is((select count(*)::int from public.imovel_fotos f where f.imovel_id = 'e5000000-0000-4000-8000-000000000008'), 0,
          'a foto do imóvel inativado saiu');

-- ============ sem timeline de cliente ============
select pg_temp.sair();
select is(pg_temp.eventos(), (select n from eventos_antes), 'imóvel não tem cliente: nenhuma linha na timeline');

select * from finish();
rollback;
