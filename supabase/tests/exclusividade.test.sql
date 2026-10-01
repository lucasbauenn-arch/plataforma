-- Exclusividade por atividade (migration 23, decisão do dono de 29/09/2026): 180 dias sem atividade; renova a cada
-- atividade da equipe/parceiro (nunca pelo titular, nunca pela tentativa de outro parceiro, nunca encurta); dentro do
-- prazo, o outro parceiro recebe 'indisponivel' com a data (sem o dono); depois do prazo, o cliente passa para quem
-- cadastrou (mesma lógica de rede_transferir_clientes, motivo 'exclusividade vencida', antigo dono avisado), inclusive
-- pelo pré-cadastro do link; cliente com contrato ou do portal nunca é tomado; o limite por hora continua.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(48);

-- ============ AJUDANTES ============
create temp table t_termo as select public._termo_vigente_id('consentimento_cliente') as id;
grant select on t_termo to authenticated, anon, service_role;
create function pg_temp.termo() returns uuid language sql as $$ select id from t_termo $$;

create function pg_temp.cadastrar(p_nome text, p_cpf text, p_corretor uuid default null) returns jsonb language sql as $$
  select public.crm_cadastrar_cliente(jsonb_build_object('tipo_pessoa', 'fisica', 'nome', p_nome, 'cpf', p_cpf,
           'telefone', '11988887777'), p_corretor, pg_temp.termo())
$$;

-- prazo atual do cliente (lido como postgres: security definer)
create function pg_temp.ate(p_cliente uuid) returns timestamptz language sql security definer as $$
  select c.exclusividade_ate from public.clientes c where c.id = p_cliente
$$;
create function pg_temp.dono(p_cliente uuid) returns uuid language sql security definer as $$
  select c.corretor_id from public.clientes c where c.id = p_cliente
$$;
-- o prazo foi renovado para agora + 180 dias (margem de 1 minuto)
create function pg_temp.renovado(p_cliente uuid) returns boolean language sql security definer as $$
  select pg_temp.ate(p_cliente) between now() + interval '180 days' - interval '1 minute' and now() + interval '180 days' + interval '1 minute'
$$;
create function pg_temp.prazo(p_cliente uuid, p_ate timestamptz) returns void language sql security definer as $$
  update public.clientes set exclusividade_ate = p_ate where id = p_cliente
$$;
create function pg_temp.dup(p_cliente uuid, p_resultado text) returns int language sql as $$
  select count(*)::int from public.cliente_duplicidades d where d.cliente_id = p_cliente and d.resultado = p_resultado
$$;

-- empreendimento e unidades para os contratos deste teste
insert into public.empreendimentos (id, slug, nome, publicado) values
  ('e2300000-0000-4000-8000-000000000001', 'excl-residencial', 'Residencial Exclusividade', true);
insert into public.unidades (id, empreendimento_id, identificador, valor, status) values
  ('e2300000-0000-4000-8000-000000000011', 'e2300000-0000-4000-8000-000000000001', 'APTO 21', 400000, 'disponivel'),
  ('e2300000-0000-4000-8000-000000000012', 'e2300000-0000-4000-8000-000000000001', 'APTO 22', 400000, 'disponivel');
create function pg_temp.contrato(p_cliente uuid, p_unidade uuid, p_status public.status_contrato) returns void language sql as $$
  insert into public.contratos (cliente_id, modelo_id, forma_pagamento, status, parametros_id, valor_imovel, perc_aporte,
    valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte, valor_parcela, valor_total_parcelas,
    unidade_id, assinado_em)
  select p_cliente, public.modelo_vigente_id('parcelado'), 'parcelado', p_status, public.parametros_vigente_id(),
         400000, 30, 120000, 40000, 80000, 280000, 60, 8.5, 1500, 90000, p_unidade,
         case when p_status = 'assinado' then now() end
$$;

-- ============ 1. CONFIGURAÇÃO E CADASTRO ============
select is((select exclusividade_dias from public.configuracao_geral), 180, 'exclusividade_dias = 180 (decisão do dono)');
select is((select n.ativo from public.notificacoes_config n where n.tipo = 'crm.exclusividade_transferida'), true,
          'aviso ao antigo dono existe e começa ligado');

select pg_temp.entrar('ca1a');
select is(pg_temp.cadastrar('Novo Excl', '12345671483') ->> 'situacao', 'criado', 'corretor cadastra');
select pg_temp.sair();
select ok(pg_temp.renovado((select id from public.clientes where cpf = '12345671483')), 'cliente novo: exclusividade de 180 dias');

-- ============ 2. RENOVAÇÃO POR ATIVIDADE ============
select pg_temp.prazo(pg_temp.cliente('c2'), now() + interval '10 days');
select pg_temp.entrar('ca2a');
select lives_ok($$select public.crm_nota_criar(pg_temp.cliente('c2'), 'Ligou e pediu tabela')$$, 'nota criada');
select pg_temp.sair();
select ok(pg_temp.renovado(pg_temp.cliente('c2')), 'nota renova para agora + 180 dias');

select pg_temp.prazo(pg_temp.cliente('c2'), now() + interval '1 day');
select pg_temp.entrar('ca2a');
select lives_ok($$select public.crm_mudar_etapa(pg_temp.cliente('c2'), 'contato_iniciado', null)$$, 'etapa mudada');
select pg_temp.sair();
select ok(pg_temp.renovado(pg_temp.cliente('c2')), 'mudança de etapa renova');

select pg_temp.prazo(pg_temp.cliente('c2'), now() + interval '1 day');
select pg_temp.entrar('ca2a');
select lives_ok($$select public.crm_tarefa_criar(pg_temp.cliente('c2'), 'Retornar', null, pg_temp.usuario('ca2a'), null)$$,
                'tarefa criada');
select pg_temp.sair();
select ok(pg_temp.renovado(pg_temp.cliente('c2')), 'tarefa criada renova');

-- todos os tipos de atividade renovam (evento gravado como o parceiro, como faria cada RPC)
create temp table t_tipos (tipo text, renovou boolean);
do $$
declare
  v_tipo text;
begin
  foreach v_tipo in array array['cadastro', 'pre_cadastro', 'etapa', 'nota', 'tarefa_criada', 'tarefa_concluida',
      'documento_solicitado', 'documento_enviado', 'documento_analisado', 'contrato_gerado', 'contrato_enviado',
      'contrato_assinado', 'contrato_encerrado', 'transferencia', 'proposta_enviada', 'proposta_respondida'] loop
    perform pg_temp.sair();
    perform pg_temp.prazo(pg_temp.cliente('c2'), now() + interval '1 day');
    perform pg_temp.como('ca2a');
    perform public._evento_cliente(pg_temp.cliente('c2'), v_tipo, 'Atividade ' || v_tipo, '{}'::jsonb);
    perform pg_temp.sair();
    insert into t_tipos values (v_tipo, pg_temp.renovado(pg_temp.cliente('c2')));
  end loop;
end $$;
select is((select array_agg(tipo order by tipo) from t_tipos where not renovou), null::text[],
          'cadastro, etapa, nota, tarefa, documento, proposta, contrato e transferência: todos renovam');

-- sistema (ator nulo, ex.: webhook do D4Sign) também renova
select pg_temp.prazo(pg_temp.cliente('c2'), now() + interval '1 day');
select pg_temp.sair();
select public._evento_cliente(pg_temp.cliente('c2'), 'contrato_assinado', 'Contrato assinado', '{}'::jsonb);
select ok(pg_temp.renovado(pg_temp.cliente('c2')), 'atividade do sistema (webhook) renova');

-- não renovam: tentativa de outro parceiro, consentimento, migração
select pg_temp.prazo(pg_temp.cliente('c2'), now() + interval '1 day');
select pg_temp.como('cb1a');
select public._evento_cliente(pg_temp.cliente('c2'), 'tentativa_duplicada', 'Tentativa', '{}'::jsonb);
select public._evento_cliente(pg_temp.cliente('c2'), 'consentimento', 'Consentimento', '{}'::jsonb);
select public._evento_cliente(pg_temp.cliente('c2'), 'migracao', 'Migração', '{}'::jsonb);
select pg_temp.sair();
select ok(pg_temp.ate(pg_temp.cliente('c2')) < now() + interval '2 days',
          'tentativa duplicada, consentimento e migração não renovam');

-- o titular pelo portal não renova
select pg_temp.prazo(pg_temp.cliente('c1'), now() + interval '1 day');
select pg_temp.como('titular_c1');
select public._evento_cliente(pg_temp.cliente('c1'), 'documento_enviado', 'Documento enviado: RG', '{}'::jsonb);
select pg_temp.sair();
select ok(pg_temp.ate(pg_temp.cliente('c1')) < now() + interval '2 days', 'envio do próprio titular pelo portal não renova');

-- nunca encurta
select pg_temp.prazo(pg_temp.cliente('c2'), now() + interval '400 days');
select pg_temp.entrar('ca2a');
select public.crm_nota_criar(pg_temp.cliente('c2'), 'Outra nota');
select pg_temp.sair();
select ok(pg_temp.ate(pg_temp.cliente('c2')) > now() + interval '399 days', 'a renovação nunca encurta um prazo maior');

-- ============ 3. DENTRO DO PRAZO: MENSAGEM COM A DATA, SEM O DONO ============
select pg_temp.prazo(pg_temp.cliente('c3'), timestamptz '2027-01-15 15:00:00-03');
create temp table t_r (r jsonb);
grant insert on t_r to authenticated;
select pg_temp.entrar('ca1a');
insert into t_r select pg_temp.cadastrar('Tentativa', '12345671130');
select pg_temp.sair();
select is((select r - 'exclusividade_ate' from t_r), '{"situacao":"indisponivel","id":null}'::jsonb,
          'dentro do prazo de outro parceiro: indisponível, sem id');
select is((select (r ->> 'exclusividade_ate')::timestamptz from t_r), timestamptz '2027-01-15 15:00:00-03',
          'a resposta traz a data da exclusividade');
select ok((select r::text not ilike '%CB1a%' and r::text not like '%' || pg_temp.parceiro('cb1a') || '%'
                  and r::text not like '%' || pg_temp.imobiliaria('b') || '%' from t_r),
          'a resposta nunca traz o nome nem o id do dono (nem da imobiliária)');
select is(pg_temp.dono(pg_temp.cliente('c3')), pg_temp.parceiro('cb1a'), 'dentro do prazo o dono não muda');
select is(pg_temp.ate(pg_temp.cliente('c3')), timestamptz '2027-01-15 15:00:00-03',
          'a tentativa do outro parceiro não renova o prazo do dono');
select is(pg_temp.dup(pg_temp.cliente('c3'), 'bloqueado_exclusividade'), 1, 'tentativa registrada em cliente_duplicidades');

-- mesmo dono: já está na sua carteira
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('Mesmo dono', '12345671130'),
          jsonb_build_object('situacao', 'ja_na_sua_carteira', 'id', pg_temp.cliente('c3')), 'mesmo dono: já na sua carteira');
select pg_temp.sair();

-- ============ 4. DEPOIS DO PRAZO: TRANSFERÊNCIA PARA QUEM CADASTROU ============
select pg_temp.prazo(pg_temp.cliente('c3'), now() - interval '1 day');
select pg_temp.entrar('ca1a');
select is(pg_temp.cadastrar('Tentativa depois', '12345671130'),
          jsonb_build_object('situacao', 'transferido', 'id', pg_temp.cliente('c3')),
          'prazo vencido: sucesso para o novo parceiro (transferido, com o id)');
select ok(public.crm_ficha(pg_temp.cliente('c3')) is not null, 'o novo dono já abre a ficha');
select pg_temp.sair();
select ok((select c.corretor_id = pg_temp.parceiro('ca1a') and c.gerente_id = pg_temp.parceiro('ga1')
             and c.imobiliaria_id = pg_temp.imobiliaria('a') from public.clientes c where c.id = pg_temp.cliente('c3')),
          'cadeia recalculada (corretor, gerente e imobiliária do novo dono)');
select ok(pg_temp.renovado(pg_temp.cliente('c3')), 'a transferência abre 180 dias para o novo dono');
select ok(exists (select 1 from public.cliente_vinculos_historico h where h.cliente_id = pg_temp.cliente('c3')
                    and h.vigente_ate is null and h.corretor_id = pg_temp.parceiro('ca1a') and h.motivo = 'exclusividade vencida'),
          'histórico de vínculo com o motivo "exclusividade vencida"');
select ok(exists (select 1 from public.cliente_eventos e where e.cliente_id = pg_temp.cliente('c3') and e.tipo = 'transferencia'
                    and e.dados = jsonb_build_object('de_corretor_id', pg_temp.parceiro('cb1a'), 'para_corretor_id', pg_temp.parceiro('ca1a'))),
          'timeline: transferência de → para');
select ok(exists (select 1 from public.auditoria a where a.acao = 'transferir' and a.entidade = 'clientes'
                    and a.cliente_id = pg_temp.cliente('c3') and a.ator_id = pg_temp.usuario('ca1a'))
          and exists (select 1 from public.auditoria a where a.acao = 'tentativa_duplicada' and a.cliente_id = pg_temp.cliente('c3')
                        and a.detalhe ->> 'resultado' = 'transferido_exclusividade' and a.detalhe ->> 'motivo' = 'exclusividade vencida'),
          'auditoria da transferência e da tentativa');
select ok(exists (select 1 from public.cliente_duplicidades d where d.cliente_id = pg_temp.cliente('c3')
                    and d.resultado = 'transferido_exclusividade' and d.resolvido_em is not null and d.decisao = 'transferir'
                    and d.tentado_por = pg_temp.usuario('ca1a') and d.tentado_por_parceiro_id = pg_temp.parceiro('ca1a')),
          'tentativa registrada já resolvida (não entra na fila pendente)');
select ok(exists (select 1 from public.notificacoes n where n.tipo = 'crm.exclusividade_transferida'
                    and n.destinatarios_ids = array[pg_temp.usuario('cb1a')] and n.dados = '{"quantidade":1}'::jsonb),
          'antigo dono avisado (só ids na fila, sem dado pessoal)');
select pg_temp.entrar('cb1a');
select ok(public.crm_ficha(pg_temp.cliente('c3')) is null, 'o antigo dono perde o acesso à ficha');
select pg_temp.sair();

-- ============ 5. PROTEGIDOS: CONTRATO E PORTAL ============
-- contrato assinado
select pg_temp.contrato(pg_temp.cliente('c2'), 'e2300000-0000-4000-8000-000000000011', 'assinado');
select pg_temp.prazo(pg_temp.cliente('c2'), now() - interval '1 day');
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('Tentativa c2', '12345671050'), '{"situacao":"indisponivel","id":null}'::jsonb,
          'cliente com contrato assinado: não é tomado (sem data na resposta)');
select pg_temp.sair();
select is(pg_temp.dono(pg_temp.cliente('c2')), pg_temp.parceiro('ca2a'), 'contrato assinado: dono mantido');
select is(pg_temp.dup(pg_temp.cliente('c2'), 'bloqueado_contrato'), 1, 'registrado como bloqueado_contrato');

-- contrato em assinatura (c4, do gerente GA1 pelo A1)
select pg_temp.contrato(pg_temp.cliente('c4'), 'e2300000-0000-4000-8000-000000000012', 'assinatura_pendente');
select pg_temp.prazo(pg_temp.cliente('c4'), now() - interval '1 day');
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('Tentativa c4', '12345671211') ->> 'situacao', 'indisponivel', 'contrato em assinatura: não é tomado');
select pg_temp.sair();
select is(pg_temp.dono(pg_temp.cliente('c4')), pg_temp.parceiro('ga1'), 'contrato em assinatura: dono mantido');

-- cliente do portal (c1: portal liberado, com login)
select pg_temp.prazo(pg_temp.cliente('c1'), now() - interval '1 day');
select pg_temp.entrar('ca2a');
select is(pg_temp.cadastrar('Tentativa c1', '12345670916'), '{"situacao":"indisponivel","id":null}'::jsonb,
          'cliente do portal: não é tomado depois do prazo');
select pg_temp.sair();
select ok(pg_temp.dono(pg_temp.cliente('c1')) = pg_temp.parceiro('ca1a') and pg_temp.dup(pg_temp.cliente('c1'), 'bloqueado_pos_prazo') = 1,
          'cliente do portal: dono mantido; o caso vai para a fila (bloqueado_pos_prazo)');

-- origem portal_admin (Carteira Arken do portal antigo), sem portal liberado nem login
insert into public.clientes (id, nome, cpf, corretor_id, origem, portal_liberado, exclusividade_ate) values
  ('e2300000-0000-4000-8000-000000000021', 'Portal Antigo', '12345671564', null, 'portal_admin', false, now() - interval '1 day');
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('Tentativa portal antigo', '12345671564') ->> 'situacao', 'indisponivel', 'origem portal_admin: não é tomado');
select pg_temp.sair();
select is(pg_temp.dono('e2300000-0000-4000-8000-000000000021'), (select corretor_casa_id from public.configuracao_geral),
          'origem portal_admin: continua na Carteira Arken');

-- sem prazo registrado: caminho conservador (não é tomado)
insert into public.clientes (id, nome, cpf, corretor_id, origem, portal_liberado, exclusividade_ate) values
  ('e2300000-0000-4000-8000-000000000022', 'Sem Prazo', '12345671645', pg_temp.parceiro('ca2a'), 'cadastro_interno', false, null);
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('Tentativa sem prazo', '12345671645') ->> 'situacao', 'indisponivel', 'sem prazo registrado: não é tomado');
select pg_temp.sair();

-- ============ 6. PRÉ-CADASTRO PELO LINK DEPOIS DO PRAZO ============
insert into public.lgpd_termos (tipo, versao, texto, revisado_juridico)
values ('consentimento_cliente', '1-revisada-excl', 'Texto revisado do consentimento para o teste de exclusividade.', true);
update t_termo set id = public._termo_vigente_id('consentimento_cliente');
insert into public.clientes (id, nome, cpf, corretor_id, origem, portal_liberado, exclusividade_ate) values
  ('e2300000-0000-4000-8000-000000000023', 'Vencido Link', '12345671726', pg_temp.parceiro('cb1a'), 'cadastro_interno', false,
   now() - interval '1 day');
select pg_temp.entrar_servico();
select is(public.crm_pre_cadastro('linkcadois', jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Visitante',
            'documento', '12345671726', 'email', 'visitante@link.test', 'telefone', '(11) 96666-5555'),
            pg_temp.termo(), '203.0.113.7', 'Navegador/1.0'),
          '{"situacao":"duplicado"}'::jsonb, 'pré-cadastro: a resposta ao visitante não muda');
select pg_temp.sair();
select is(pg_temp.dono('e2300000-0000-4000-8000-000000000023'), pg_temp.parceiro('ca2a'),
          'pré-cadastro pelo link depois do prazo: o cliente passa para o dono do link');
select ok(exists (select 1 from public.auditoria a where a.acao = 'tentativa_duplicada'
                    and a.cliente_id = 'e2300000-0000-4000-8000-000000000023' and a.origem = 'edge:pre-cadastro'
                    and a.detalhe ->> 'resultado' = 'transferido_exclusividade'),
          'pré-cadastro: tentativa auditada com a origem da Edge');

-- ============ 7. LIMITE POR HORA CONTINUA ============
update public.configuracao_geral set duplicidade_bloqueios_hora =
  (select count(*) from public.cliente_duplicidades d where d.tentado_por = pg_temp.usuario('cb1a') and d.resultado <> 'mesmo_dono');
select pg_temp.entrar('cb1a');
select is((pg_temp.erro($$select pg_temp.cadastrar('Livre', '12345671807')$$)) ->> 'mensagem', 'LIMITE_DUPLICIDADE',
          'acima do limite por hora: LIMITE_DUPLICIDADE (antes de olhar o documento)');
select pg_temp.sair();

-- ============ 8. INTERNAS SEM GRANT ============
select ok(not has_function_privilege('authenticated', 'public._exclusividade_transferir(uuid, uuid, public.origem_cliente, text, text)', 'execute')
          and not has_function_privilege('service_role', 'public._exclusividade_livre(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public._exclusividade_renovar()', 'execute'),
          'funções internas da exclusividade: sem grant');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.cliente_eventos'::regclass and tgname = 'exclusividade_renovar'), 1,
          'gatilho de renovação em cliente_eventos');

select * from finish();
rollback;
