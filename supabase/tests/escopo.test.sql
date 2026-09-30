-- Escopo por papel só com grants, políticas e helpers (docs/ARQUITETURA_EXPANSAO.md §4.1, §4.2, §4.3, §4.5, §8.5).
-- As linhas da §4.5 que dependem de corpo de RPC ficam nos testes de cada pacote e no escopo_ponta_a_ponta (WP7).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(148);

-- ============ DADOS DESTE TESTE (como postgres) ============
-- propostas (a cadeia vem do cliente ou, sem cliente, do vínculo do autor)
insert into public.propostas (id, parceiro_id, cliente_id, empreendimento_id, texto, status)
select v.id::uuid, pg_temp.usuario(v.autor), case when v.cli is not null then pg_temp.cliente(v.cli) end,
       (select e.id from public.empreendimentos e order by e.slug limit 1), 'proposta de teste', 'enviada'
from (values
  ('e0000000-0000-4000-8000-000000000101', 'ca1a', 'c1'),
  ('e0000000-0000-4000-8000-000000000102', 'ca1a', null),
  ('e0000000-0000-4000-8000-000000000103', 'ca2a', 'c2'),
  ('e0000000-0000-4000-8000-000000000104', 'cb1a', 'c3'),
  ('e0000000-0000-4000-8000-000000000105', 'ga1',  'c4'),
  ('e0000000-0000-4000-8000-000000000106', 'bloqueado', 'c5')
) as v(id, autor, cli);

create function pg_temp.propostas_visiveis() returns text[] language sql as $$
  select coalesce(array_agg(v.k order by v.k), '{}')
  from (values ('p1_ca1a_c1', 'e0000000-0000-4000-8000-000000000101'::uuid),
               ('p2_ca1a_sem_cliente', 'e0000000-0000-4000-8000-000000000102'::uuid),
               ('p3_ca2a_c2', 'e0000000-0000-4000-8000-000000000103'::uuid),
               ('p4_cb1a_c3', 'e0000000-0000-4000-8000-000000000104'::uuid),
               ('p5_ga1_c4', 'e0000000-0000-4000-8000-000000000105'::uuid),
               ('p6_bloqueado_c5', 'e0000000-0000-4000-8000-000000000106'::uuid)) as v(k, id)
  where exists (select 1 from public.propostas p where p.id = v.id)
$$;

-- imóveis: rascunho do CA1a; aprovado do CB1a; aprovado e inativado do CB1a
insert into public.imoveis (id, nome, tipo, status, valor, criado_por, inativado_em) values
  ('e0000000-0000-4000-8000-000000000201', 'Casa do CA1a', 'casa', 'rascunho', null, pg_temp.usuario('ca1a'), null),
  ('e0000000-0000-4000-8000-000000000202', 'Apto do CB1a', 'apartamento', 'aprovado', 300000, pg_temp.usuario('cb1a'), null),
  ('e0000000-0000-4000-8000-000000000203', 'Terreno inativado', 'terreno', 'aprovado', 90000, pg_temp.usuario('cb1a'), now());
insert into public.imovel_fotos (imovel_id, storage_path) values
  ('e0000000-0000-4000-8000-000000000201', 'e0000000-0000-4000-8000-000000000201/foto-a.webp'),
  ('e0000000-0000-4000-8000-000000000202', 'e0000000-0000-4000-8000-000000000202/foto-b.webp');

create function pg_temp.imoveis_visiveis() returns text[] language sql as $$
  select coalesce(array_agg(v.k order by v.k), '{}')
  from (values ('i1_rascunho_ca1a', 'e0000000-0000-4000-8000-000000000201'::uuid),
               ('i2_aprovado_cb1a', 'e0000000-0000-4000-8000-000000000202'::uuid),
               ('i3_inativado_cb1a', 'e0000000-0000-4000-8000-000000000203'::uuid)) as v(k, id)
  where exists (select 1 from public.imoveis i where i.id = v.id)
$$;

-- solicitações de documento (c1: pendente e aprovada; c2: pendente)
insert into public.cliente_documentos (id, cliente_id, nome, status) values
  ('e0000000-0000-4000-8000-000000000301', pg_temp.cliente('c1'), 'RG', 'pendente'),
  ('e0000000-0000-4000-8000-000000000302', pg_temp.cliente('c1'), 'CNH', 'aprovado'),
  ('e0000000-0000-4000-8000-000000000303', pg_temp.cliente('c2'), 'RG', 'pendente');

-- objetos no Storage (gravados como postgres, como faria a service role)
insert into storage.objects (bucket_id, name) values
  ('crm-documentos', 'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000401.pdf'),
  ('contratos', 'e0000000-0000-4000-8000-000000000501/minuta-v1-abcdef12.pdf'),
  ('imoveis', 'e0000000-0000-4000-8000-000000000201/foto-a.webp'),
  ('imoveis', 'e0000000-0000-4000-8000-000000000202/foto-b.webp'),
  ('cliente-arquivos', 'd0000000-0000-4000-8000-000000000001/extrato.pdf'),
  ('cliente-arquivos', 'd0000000-0000-4000-8000-000000000002/extrato.pdf');

-- portal: negócios, arquivos e obra de dois empreendimentos diferentes; uma unidade e um material para contraste
insert into public.cliente_negocios (cliente_id, empreendimento_id)
select pg_temp.cliente('c1'), e.id from public.empreendimentos e order by e.slug limit 1;
insert into public.cliente_negocios (cliente_id, empreendimento_id)
select pg_temp.cliente('c2'), e.id from public.empreendimentos e order by e.slug offset 1 limit 1;
insert into public.cliente_arquivos (cliente_id, nome, storage_path) values
  (pg_temp.cliente('c1'), 'Extrato', 'd0000000-0000-4000-8000-000000000001/extrato.pdf'),
  (pg_temp.cliente('c2'), 'Extrato', 'd0000000-0000-4000-8000-000000000002/extrato.pdf');
insert into public.obra_atualizacoes (empreendimento_id, titulo)
select e.id, 'Obra ' || e.slug from (select id, slug from public.empreendimentos order by slug limit 2) e;
insert into public.unidades (empreendimento_id, identificador, valor)
select e.id, 'APTO 01', 250000 from public.empreendimentos e order by e.slug limit 1;
insert into public.empreendimento_materiais (empreendimento_id, drive_url)
select e.id, 'https://drive.test/x' from public.empreendimentos e order by e.slug limit 1;

-- ============ AJUDANTES DESTE TESTE (rodam com o papel atual) ============
create function pg_temp.clientes_no_escopo() returns text[] language sql as $$
  select coalesce(array_agg(n order by n), '{}') from unnest(array['c1', 'c2', 'c3', 'c4', 'c5']) n
  where public.pode_ver_cliente(pg_temp.cliente(n))
$$;

create function pg_temp.parceiros_visiveis() returns text[] language sql as $$
  select coalesce(array_agg(k order by k), '{}')
  from unnest(array['ia', 'ga1', 'ga2', 'ca1a', 'ca2a', 'ib', 'gb1', 'cb1a', 'inativo', 'bloqueado']) k
  where exists (select 1 from public.parceiros p where p.id = pg_temp.parceiro(k))
$$;

-- tabelas que NÃO recusaram a leitura com 42501
create function pg_temp.tabelas_legiveis(p_tabelas text[]) returns text[] language plpgsql as $$
declare
  t text;
  v text[] := '{}';
begin
  foreach t in array p_tabelas loop
    begin
      execute format('select count(*) from public.%I', t);
      v := v || t;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  return v;
end $$;

-- tabelas com alguma linha visível ("tabela:quantidade"); sem grant (42501) conta como nenhuma linha visível — depois
-- do corte é o caso de clientes, leads, propostas e da carteira legada para todo authenticated
create function pg_temp.tabelas_com_linhas(p_tabelas text[]) returns text[] language plpgsql as $$
declare
  t text;
  n bigint;
  v text[] := '{}';
begin
  foreach t in array p_tabelas loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when insufficient_privilege then
      n := 0;
    end;
    if n > 0 then
      v := v || (t || ':' || n);
    end if;
  end loop;
  return v;
end $$;

create function pg_temp.tabelas_de_parceiro() returns text[] language sql immutable as $$
  select array['parceiros', 'imobiliarias', 'clientes', 'propostas', 'imoveis', 'imovel_fotos', 'unidades',
               'empreendimento_materiais', 'obra_atualizacoes', 'configuracao_publica', 'configuracao_geral',
               'status_transicoes', 'permissoes_rede', 'lgpd_termos', 'notificacoes_config', 'imovel_tipos',
               'parametros_simulacao', 'contrato_modelos', 'contrato_signatario_regras', 'historico_status',
               'migracao_pendencias', 'cliente_negocios', 'cliente_arquivos', 'leads', 'legado_parceiro_clientes',
               'portal_acessos']
$$;

create function pg_temp.tabelas_crm() returns text[] language sql immutable as $$
  select array['cliente_notas', 'cliente_tarefas', 'cliente_documentos', 'cliente_documento_arquivos', 'cliente_eventos',
               'cliente_duplicidades', 'cliente_vinculos_historico', 'contratos', 'contrato_signatarios', 'auditoria',
               'lgpd_consentimentos', 'download_autorizacoes', 'notificacoes', 'eventos_dominio',
               'parceiro_vinculos_historico', 'migracao_decisoes']
$$;

-- ============ VISITANTE ============
select pg_temp.entrar_anon();
select is(pg_temp.tabelas_legiveis(array['clientes', 'parceiros', 'imobiliarias', 'imoveis', 'propostas',
          'configuracao_publica', 'lgpd_termos', 'status_transicoes', 'leads']), '{}'::text[],
          'visitante: sem leitura de clientes, rede, imóveis, propostas, configuração e termos (42501)');
select throws_ok($$select public.pode_ver_cliente('d0000000-0000-4000-8000-000000000001')$$, '42501', null,
                 'visitante não executa helpers de escopo');
select is((select count(*)::int from storage.objects), 0, 'visitante não vê nenhum objeto dos buckets privados');

-- ============ REDE: parceiros e imobiliárias por papel (§4.2, §8.5) ============
select pg_temp.entrar('ga1');
select is(pg_temp.parceiros_visiveis(), array['bloqueado', 'ca1a', 'ga1', 'inativo'],
          'GA1 vê a si e os próprios corretores (CA1a), e não CA2a, GA2 nem IA');
select is((select count(*)::int from public.parceiros), 4, 'GA1: nenhuma linha além das da equipe');
select is((select array_agg(i.nome order by i.nome) from public.imobiliarias i), array['Imobiliária A'], 'GA1 vê só a própria imobiliária');
select throws_ok($$select cpf from public.parceiros$$, '42501', null, 'sem a coluna cpf de parceiros (grant por coluna)');
select lives_ok($$select id, profile_id, tipo, imobiliaria_id, gerente_id, nome, creci, email, telefone, codigo_indicacao,
                  virtual, migrado_legado, imobiliaria_declarada, criado_em, inativado_em from public.parceiros$$,
                'as demais colunas de parceiros são legíveis');
select throws_ok($$update public.parceiros set nome = 'x' where id = 'c0000000-0000-4000-8000-000000000014'$$, '42501', null,
                 'GA1 não altera parceiro direto (só por RPC)');
select throws_ok($$insert into public.parceiros (tipo, imobiliaria_id, nome) values ('gerente', 'b0000000-0000-4000-8000-00000000000a', 'x')$$,
                 '42501', null, 'GA1 não cadastra parceiro direto');

select pg_temp.entrar('ia');
select is(pg_temp.parceiros_visiveis(), array['bloqueado', 'ca1a', 'ca2a', 'ga1', 'ga2', 'ia', 'inativo'],
          'IA vê a imobiliária A inteira');
select is((select count(*)::int from public.parceiros), 7, 'IA: nada da imobiliária B nem da casa');
select throws_ok($$update public.imobiliarias set nome = 'x'$$, '42501', null, 'IA não altera a imobiliária direto');

select pg_temp.entrar('ib');
select is(pg_temp.parceiros_visiveis(), array['cb1a', 'gb1', 'ib'], 'IB não vê nada da imobiliária A');
select is((select array_agg(i.nome order by i.nome) from public.imobiliarias i), array['Imobiliária B'], 'IB vê só a imobiliária B');

select pg_temp.entrar('ga2');
select is(pg_temp.parceiros_visiveis(), array['ca2a', 'ga2'], 'GA2 vê só a própria equipe');

select pg_temp.entrar('ca1a');
select is(pg_temp.parceiros_visiveis(), array['ca1a'], 'CA1a vê só o próprio vínculo');
select is((select count(*)::int from public.imobiliarias), 1, 'CA1a vê só a própria imobiliária');

select pg_temp.entrar('admin');
select is((select count(*)::int from public.parceiros), 12, 'admin vê todos os parceiros (inclusive a casa)');
select is((select count(*)::int from public.imobiliarias), 3, 'admin vê todas as imobiliárias');
select throws_ok($$select cpf from public.parceiros$$, '42501', null, 'nem o admin lê o cpf de parceiros direto');

-- ============ HELPERS DE ESCOPO ============
select pg_temp.entrar('ca1a');
select is(pg_temp.clientes_no_escopo(), array['c1'], 'pode_ver_cliente: CA1a só c1');
select ok(public.escopo_corretor() = pg_temp.parceiro('ca1a') and public.escopo_gerente() is null
          and public.escopo_imobiliaria() is null and public.minha_imobiliaria_id() = pg_temp.imobiliaria('a')
          and public.meu_parceiro_id() = pg_temp.parceiro('ca1a') and public.meu_cliente_id() is null,
          'helpers escalares do corretor');
select ok(public.tem_permissao('cadastrar_cliente') and not public.tem_permissao('cadastrar_corretor')
          and not public.tem_permissao('transferir_cliente') and not public.tem_permissao('acao_inexistente'),
          'tem_permissao do corretor segue permissoes_rede');

select pg_temp.entrar('ga1');
select is(pg_temp.clientes_no_escopo(), array['c1', 'c4', 'c5'],
          'pode_ver_cliente: GA1 vê os clientes da equipe e o próprio (A1), não c2 nem c3');
select ok(public.escopo_gerente() = pg_temp.parceiro('ga1') and public.escopo_corretor() is null
          and public.tem_permissao('cadastrar_corretor') and not public.tem_permissao('cadastrar_gerente')
          and public.tem_permissao('gerente_como_corretor'), 'helpers e permissões do gerente');

select pg_temp.entrar('ia');
select is(pg_temp.clientes_no_escopo(), array['c1', 'c2', 'c4', 'c5'], 'pode_ver_cliente: IA vê a imobiliária A inteira');
select ok(public.escopo_imobiliaria() = pg_temp.imobiliaria('a') and public.tem_permissao('cadastrar_gerente')
          and public.tem_permissao('transferir_corretor'), 'helpers e permissões da imobiliária');

select pg_temp.entrar('ib');
select is(pg_temp.clientes_no_escopo(), array['c3'], 'pode_ver_cliente: IB só a imobiliária B');

select pg_temp.entrar('ca2a');
select is(pg_temp.clientes_no_escopo(), array['c2'], 'pode_ver_cliente: CA2a só c2');

select pg_temp.entrar('admin');
select is(pg_temp.clientes_no_escopo(), array['c1', 'c2', 'c3', 'c4', 'c5'], 'pode_ver_cliente: admin vê todos');
select ok(public.tem_permissao('cadastrar_gerente') and public.tem_permissao('transferir_corretor'),
          'tem_permissao: internos podem as ações da rede');

select pg_temp.entrar('titular_c1');
select is(pg_temp.clientes_no_escopo(), '{}'::text[], 'pode_ver_cliente não inclui o titular do portal');
select is(public.meu_cliente_id(), pg_temp.cliente('c1'), 'meu_cliente_id: o titular é c1');

select pg_temp.entrar('ca1a');
select is(public.pode_ver_cliente('d0000000-0000-4000-8000-0000000000ff'), false,
          'pode_ver_cliente: falso para cliente inexistente (não revela existência)');

-- escopo conferido a cada consulta: bloqueio e inativação do perfil derrubam o escopo na hora (§4.5)
select pg_temp.sair();
update public.profiles set status_parceiro = 'bloqueado' where id = pg_temp.usuario('ca1a');
select pg_temp.entrar('ca1a');
select ok(pg_temp.clientes_no_escopo() = '{}' and public.escopo_corretor() is null and not public.tem_permissao('cadastrar_cliente')
          and pg_temp.parceiros_visiveis() = '{}', 'CA1a bloqueado com a sessão aberta: escopo some na hora');
select pg_temp.sair();
update public.profiles set status_parceiro = 'aprovado', inativado_em = now() where id = pg_temp.usuario('ca1a');
select pg_temp.entrar('ca1a');
select ok(pg_temp.clientes_no_escopo() = '{}' and public.escopo_corretor() is null and not public.is_parceiro_aprovado(),
          'perfil inativado (inativado_em) também perde o escopo');
select pg_temp.sair();
update public.profiles set inativado_em = null where id = pg_temp.usuario('ca1a');

-- cliente inativado sai do escopo da rede (§4.1: c.inativado_em is null); os internos continuam vendo
update public.clientes set inativado_em = now(), motivo_inativacao = 'teste de escopo' where id = pg_temp.cliente('c1');
select pg_temp.entrar('ca1a');
select is(pg_temp.clientes_no_escopo(), '{}'::text[], 'cliente inativado: CA1a deixa de ver c1');
select pg_temp.entrar('ga1');
select is(pg_temp.clientes_no_escopo(), array['c4', 'c5'], 'cliente inativado: GA1 deixa de ver c1');
select pg_temp.entrar('ia');
select is(pg_temp.clientes_no_escopo(), array['c2', 'c4', 'c5'], 'cliente inativado: IA deixa de ver c1');
select pg_temp.entrar('admin');
select is(pg_temp.clientes_no_escopo(), array['c1', 'c2', 'c3', 'c4', 'c5'], 'cliente inativado: o admin continua vendo');
select pg_temp.sair();
update public.clientes set inativado_em = null, motivo_inativacao = null where id = pg_temp.cliente('c1');

-- ============ CLIENTES E CRM (§4.3, §4.5): depois do corte, nenhum acesso direto a clientes; CRM sempre 42501 ============
select pg_temp.entrar('ca1a');
select throws_ok($$select count(*) from public.clientes where id = 'd0000000-0000-4000-8000-000000000001'$$, '42501', null,
                 'CA1a: GET clientes?id=eq.c1 → 42501 (depois do corte, sem grant)');
select is(pg_temp.tabelas_legiveis(pg_temp.tabelas_crm()), '{}'::text[],
          'CA1a: CRM, contratos, auditoria e tabelas de sistema recusam leitura (42501)');
select throws_ok($$select count(*) from public.cliente_documentos where cliente_id = 'd0000000-0000-4000-8000-000000000001'$$,
                 '42501', null, 'CA1a: GET cliente_documentos?cliente_id=eq.c1 → 42501');
select pg_temp.entrar('ga1');
select throws_ok($$select count(*) from public.clientes$$, '42501', null, 'GA1 não lê clientes direto');
select pg_temp.entrar('ia');
select throws_ok($$select count(*) from public.clientes$$, '42501', null, 'IA não lê clientes direto');
select pg_temp.entrar('admin');
select throws_ok($$select count(*) from public.clientes$$, '42501', null,
                 'depois do corte nem o admin lê clientes direto (só crm_listar / crm_ficha)');
select is(pg_temp.tabelas_legiveis(pg_temp.tabelas_crm()), '{}'::text[], 'nem o admin lê CRM, contratos e auditoria direto (só RPC)');
select throws_ok($$delete from public.clientes where id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'admin não exclui cliente (sem D)');
select throws_ok($$update public.clientes set corretor_id = 'c0000000-0000-4000-8000-000000000015' where id = 'd0000000-0000-4000-8000-000000000001'$$,
                 '42501', null, 'admin não muda a cadeia do cliente direto (só por RPC)');
select throws_ok($$update public.clientes set email = 'novo.c2@cliente.test' where id = 'd0000000-0000-4000-8000-000000000002'$$,
                 '42501', null, 'depois do corte nem o admin edita cliente direto (só crm_editar_cliente)');
-- gravação direta que sobra: a service role (Edge Functions) — o gatilho auditar_linha registra só os nomes
select pg_temp.entrar_servico();
update public.clientes set email = 'novo.c2@cliente.test', telefone = '11911112222' where id = pg_temp.cliente('c2');
select pg_temp.sair();
select ok((select count(*) = 1 and bool_and(categoria = 'operacao' and acao = 'editar' and cliente_id = pg_temp.cliente('c2')
                                             and campos @> '{email,telefone}' and antes is null and depois is null
                                             and ator_id is null and origem = 'trigger')
           from public.auditoria where entidade = 'clientes' and entidade_id = pg_temp.cliente('c2')::text),
          'edição direta pela service role: auditoria só com os NOMES dos campos, com o titular (LGPD)');
select pg_temp.entrar('titular_c1');
select throws_ok($$select count(*) from public.clientes$$, '42501', null,
                 'titular não lê clientes direto (o portal usa as RPCs portal_*)');
select is(pg_temp.tabelas_legiveis(pg_temp.tabelas_crm()), '{}'::text[], 'titular: CRM só pelas RPCs portal_*');

-- cadeia forjada é descartada e recalculada pelo gatilho clientes_cadeia (§4.5)
select pg_temp.sair();
insert into public.clientes (id, nome, cpf, corretor_id, gerente_id, imobiliaria_id, origem)
values ('d0000000-0000-4000-8000-0000000000f1', 'Forjado', '12345671483', pg_temp.parceiro('ca1a'),
        pg_temp.parceiro('gb1'), pg_temp.imobiliaria('b'), 'cadastro_interno');
select ok((select gerente_id = pg_temp.parceiro('ga1') and imobiliaria_id = pg_temp.imobiliaria('a')
           from public.clientes where id = 'd0000000-0000-4000-8000-0000000000f1'),
          'cadeia enviada no insert é descartada: vem do corretor');
update public.clientes set gerente_id = pg_temp.parceiro('gb1'), imobiliaria_id = pg_temp.imobiliaria('b')
 where id = pg_temp.cliente('c1');
select ok((select gerente_id = pg_temp.parceiro('ga1') and imobiliaria_id = pg_temp.imobiliaria('a')
           from public.clientes where id = pg_temp.cliente('c1')),
          'cadeia alterada direto é recalculada a partir do corretor');
select throws_ok($$insert into public.clientes (nome, cpf, corretor_id, origem)
                   values ('Gerente B', '12345671564', 'c0000000-0000-4000-8000-000000000021', 'cadastro_interno')$$,
                 '23514', null, 'responsável do tipo imobiliária é recusado');
select throws_ok($$insert into public.clientes (nome, cpf, corretor_id, origem)
                   values ('Do inativo', '12345671564', 'c0000000-0000-4000-8000-000000000041', 'cadastro_interno')$$,
                 '23514', null, 'corretor inativo não recebe cliente');
update public.permissoes_rede set permitido = false where acao = 'gerente_como_corretor';
select throws_ok($$insert into public.clientes (nome, cpf, corretor_id, origem)
                   values ('Do gerente', '12345671564', 'c0000000-0000-4000-8000-000000000012', 'cadastro_interno')$$,
                 '23514', null, 'gerente só é responsável com gerente_como_corretor (A1) ligado');
update public.permissoes_rede set permitido = true where acao = 'gerente_como_corretor';
insert into public.clientes (nome, cpf, origem) values ('Tela antiga', '12345671645', 'portal_admin');
select ok((select corretor_id = (select corretor_casa_id from public.configuracao_geral) and not portal_liberado
           from public.clientes where cpf = '12345671645'),
          'insert sem corretor cai na Carteira Arken; depois da contração, origem portal_admin não libera o portal sozinha');

-- ============ PROPOSTAS (§4.3): depois do corte, nenhum acesso direto (só propostas_listar/criar/responder) ============
select pg_temp.entrar('ca1a');
select throws_ok($$select count(*) from public.propostas$$, '42501', null, 'CA1a não lê propostas direto (só propostas_listar)');
select pg_temp.entrar('ga1');
select throws_ok($$select count(*) from public.propostas$$, '42501', null, 'GA1 não lê propostas direto');
select pg_temp.entrar('ga2');
select throws_ok($$select count(*) from public.propostas$$, '42501', null, 'GA2 não lê propostas direto');
select pg_temp.entrar('ia');
select throws_ok($$select count(*) from public.propostas$$, '42501', null, 'IA não lê propostas direto');
select pg_temp.entrar('ib');
select throws_ok($$select count(*) from public.propostas$$, '42501', null, 'IB não lê propostas direto');
select pg_temp.entrar('bloqueado');
select throws_ok($$select count(*) from public.propostas$$, '42501', null, 'corretor bloqueado não lê propostas direto');
select pg_temp.entrar('admin');
select throws_ok($$select count(*) from public.propostas$$, '42501', null, 'nem o admin lê propostas direto (só propostas_listar)');

-- defesa em profundidade: as políticas por cadeia (da 09) continuam certas — conferidas com um SELECT concedido só aqui
select pg_temp.sair();
grant select on public.propostas to authenticated;
select pg_temp.entrar('ca1a');
select is(pg_temp.propostas_visiveis(), array['p1_ca1a_c1', 'p2_ca1a_sem_cliente'], 'política: CA1a, as propostas da própria carteira e as sem cliente');
select pg_temp.entrar('ga1');
select is(pg_temp.propostas_visiveis(), array['p1_ca1a_c1', 'p2_ca1a_sem_cliente', 'p5_ga1_c4', 'p6_bloqueado_c5'],
          'política: GA1, as propostas da equipe (inclusive do corretor bloqueado) e as próprias');
select pg_temp.entrar('ga2');
select is(pg_temp.propostas_visiveis(), array['p3_ca2a_c2'], 'política: GA2, só a equipe dele');
select pg_temp.entrar('ia');
select is(pg_temp.propostas_visiveis(), array['p1_ca1a_c1', 'p2_ca1a_sem_cliente', 'p3_ca2a_c2', 'p5_ga1_c4', 'p6_bloqueado_c5'],
          'política: IA, todas as propostas da imobiliária A');
select pg_temp.entrar('ib');
select is(pg_temp.propostas_visiveis(), array['p4_cb1a_c3'], 'política: IB, só a imobiliária B');
select pg_temp.entrar('bloqueado');
select is(pg_temp.propostas_visiveis(), '{}'::text[], 'política: corretor bloqueado não vê nem a própria proposta');
select pg_temp.entrar('admin');
select is(pg_temp.propostas_visiveis(), array['p1_ca1a_c1', 'p2_ca1a_sem_cliente', 'p3_ca2a_c2', 'p4_cb1a_c3', 'p5_ga1_c4', 'p6_bloqueado_c5'],
          'política: admin vê todas');
select pg_temp.sair();
revoke select on public.propostas from authenticated;

select pg_temp.entrar('ca1a');
select throws_ok($$insert into public.propostas (id, parceiro_id, empreendimento_id, texto, status)
                   select 'e0000000-0000-4000-8000-000000000109', 'a0000000-0000-4000-8000-000000000014', e.id, 'nova', 'enviada'
                   from public.empreendimentos e order by e.slug limit 1$$,
                 '42501', null, 'CA1a não cria proposta direto, nem sem cliente (só propostas_criar)');
select throws_ok($$insert into public.propostas (parceiro_id, cliente_id, empreendimento_id, texto, status)
                   select 'a0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000001', e.id, 'x', 'enviada'
                   from public.empreendimentos e order by e.slug limit 1$$,
                 '42501', null, 'com cliente, só por propostas_criar');
select throws_ok($$insert into public.propostas (parceiro_id, empreendimento_id, texto, status)
                   select 'a0000000-0000-4000-8000-000000000015', e.id, 'x', 'enviada' from public.empreendimentos e limit 1$$,
                 '42501', null, 'CA1a não cria proposta em nome de outro');
select throws_ok($$insert into public.propostas (parceiro_id, empreendimento_id, texto, status)
                   select 'a0000000-0000-4000-8000-000000000014', e.id, 'x', 'aprovada' from public.empreendimentos e limit 1$$,
                 '42501', null, 'CA1a não cria proposta já aprovada');
select pg_temp.entrar('bloqueado');
select throws_ok($$insert into public.propostas (parceiro_id, empreendimento_id, texto, status)
                   select 'a0000000-0000-4000-8000-000000000042', e.id, 'x', 'enviada' from public.empreendimentos e limit 1$$,
                 '42501', null, 'corretor bloqueado não cria proposta');
select pg_temp.sair();
-- a cadeia continua vindo do gatilho propostas_cadeia (a RPC grava como postgres, simulado aqui)
insert into public.propostas (id, parceiro_id, empreendimento_id, texto, status)
select 'e0000000-0000-4000-8000-000000000109', pg_temp.usuario('ca1a'), e.id, 'nova', 'enviada'
from public.empreendimentos e order by e.slug limit 1;
select ok((select corretor_id = pg_temp.parceiro('ca1a') and gerente_id = pg_temp.parceiro('ga1')
                  and imobiliaria_id = pg_temp.imobiliaria('a') and cliente_id is null
           from public.propostas where id = 'e0000000-0000-4000-8000-000000000109'),
          'proposta sem cliente recebe a cadeia do autor');
select ok((select corretor_id = pg_temp.parceiro('ga1') and gerente_id = pg_temp.parceiro('ga1')
           from public.propostas where id = 'e0000000-0000-4000-8000-000000000105'),
          'proposta com cliente recebe a cadeia do cliente (c4, do gerente pelo A1)');
select throws_ok($$insert into public.propostas (parceiro_id, cliente_id, empreendimento_id, texto)
                   select 'a0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000001', e.id, 'x'
                   from public.empreendimentos e limit 1$$,
                 '42501', null, 'gatilho: cliente fora do escopo do autor é recusado (CA2a com c1)');


-- ============ IMÓVEIS (E4) ============
select pg_temp.entrar('ca1a');
select is(pg_temp.imoveis_visiveis(), array['i1_rascunho_ca1a', 'i2_aprovado_cb1a'], 'CA1a: o próprio rascunho e os aprovados ativos');
select is((select count(*)::int from public.imovel_fotos), 2, 'CA1a: fotos seguem o imóvel');
select pg_temp.entrar('ga1');
select is(pg_temp.imoveis_visiveis(), array['i1_rascunho_ca1a', 'i2_aprovado_cb1a'], 'GA1: o rascunho do corretor (cadeia acima)');
select pg_temp.entrar('ia');
select is(pg_temp.imoveis_visiveis(), array['i1_rascunho_ca1a', 'i2_aprovado_cb1a'], 'IA: o rascunho do corretor (cadeia acima)');
select pg_temp.entrar('ga2');
select is(pg_temp.imoveis_visiveis(), array['i2_aprovado_cb1a'], 'GA2: fora da cadeia, só o aprovado');
select pg_temp.entrar('ca2a');
select is(pg_temp.imoveis_visiveis(), array['i2_aprovado_cb1a'], 'CA2a: só o aprovado ativo');
select is((select count(*)::int from public.imovel_fotos), 1, 'CA2a: só a foto do aprovado');
select pg_temp.entrar('ib');
select is(pg_temp.imoveis_visiveis(), array['i2_aprovado_cb1a', 'i3_inativado_cb1a'], 'IB: os imóveis da cadeia, inclusive o inativado');
select pg_temp.entrar('admin');
select is(pg_temp.imoveis_visiveis(), array['i1_rascunho_ca1a', 'i2_aprovado_cb1a', 'i3_inativado_cb1a'], 'admin vê todos');

select pg_temp.entrar('ca1a');
select ok(public.pode_ver_imovel('e0000000-0000-4000-8000-000000000201') and public.pode_editar_imovel('e0000000-0000-4000-8000-000000000201')
          and public.pode_ver_imovel('e0000000-0000-4000-8000-000000000202') and not public.pode_editar_imovel('e0000000-0000-4000-8000-000000000202')
          and not public.pode_ver_imovel('e0000000-0000-4000-8000-000000000203'),
          'pode_ver_imovel / pode_editar_imovel do criador');
select lives_ok($$update public.imoveis set nome = 'Casa do CA1a (editada)' where id = 'e0000000-0000-4000-8000-000000000201'$$,
                'criador edita o rascunho');
select throws_ok($$update public.imoveis set status = 'pendente' where id = 'e0000000-0000-4000-8000-000000000201'$$,
                 '42501', null, 'criador não muda o status direto (grant de coluna)');
select throws_ok($$insert into public.imoveis (nome, status) values ('x', 'aprovado')$$, '42501', null,
                 'insert não aceita status');
select throws_ok($$insert into public.imoveis (id, nome) values ('e0000000-0000-4000-8000-0000000002ff', 'x')$$, '42501', null,
                 'insert não aceita id');
select lives_ok($$insert into public.imoveis (nome, tipo) values ('Novo do CA1a', 'casa')$$, 'CA1a cadastra imóvel em rascunho');
select throws_ok($$insert into public.imovel_fotos (imovel_id, storage_path) values
                   ('e0000000-0000-4000-8000-000000000201', 'e0000000-0000-4000-8000-000000000201/foto-z.webp')$$,
                 '42501', null, 'fotos só por RPC');
select pg_temp.entrar('ga1');
update public.imoveis set nome = 'hackeado' where id = 'e0000000-0000-4000-8000-000000000201';
select pg_temp.entrar('ca2a');
update public.imoveis set nome = 'hackeado' where id = 'e0000000-0000-4000-8000-000000000201';
select pg_temp.entrar('bloqueado');
select throws_ok($$insert into public.imoveis (nome) values ('x')$$, '42501', null, 'corretor bloqueado não cadastra imóvel');
select pg_temp.sair();
select is((select nome from public.imoveis where id = 'e0000000-0000-4000-8000-000000000201'), 'Casa do CA1a (editada)',
          'só o criador (ou interno) edita: GA1 e CA2a não alteram o rascunho do CA1a');
select ok((select criado_por = pg_temp.usuario('ca1a') and criado_por_parceiro_id = pg_temp.parceiro('ca1a')
                  and gerente_id = pg_temp.parceiro('ga1') and imobiliaria_id = pg_temp.imobiliaria('a') and status = 'rascunho'
           from public.imoveis where nome = 'Novo do CA1a'),
          'imóvel cadastrado pela API: autoria e cadeia impostas pelos gatilhos');
select ok((select count(*) = 1 and bool_and(categoria = 'operacao' and acao = 'criar' and ator_id = pg_temp.usuario('ca1a')
                                             and ator_papel = 'corretor' and ator_parceiro_id = pg_temp.parceiro('ca1a')
                                             and campos @> '{nome,tipo}' and antes is null and depois is null)
           from public.auditoria where entidade = 'imoveis' and entidade_id = (select id::text from public.imoveis where nome = 'Novo do CA1a')),
          'gravação direta pela API fica na auditoria com o ator e o vínculo, sem valores');

-- ============ STORAGE (§4.3, §4.5) ============
-- crm-documentos e contratos: nenhuma leitura direta, nem com autorização vigente. Com SELECT, o usuário assinaria a
-- URL com a validade que quisesse (POST /object/sign não tem teto) e o GET não passaria pela auditoria. O download
-- é: RPC auditada (download_autorizacoes) → Edge baixar-arquivo, que resgata a autorização com a service role e
-- assina até o fim dela.
select pg_temp.entrar('ca1a');
select is((select count(*)::int from storage.objects where bucket_id in ('crm-documentos', 'contratos')), 0,
          'CA1a (com escopo sobre c1) não lê o documento sem autorização de download');
select pg_temp.sair();
insert into public.download_autorizacoes (profile_id, bucket, path, expira_em) values
  (pg_temp.usuario('ca1a'), 'crm-documentos',
   'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000401.pdf',
   now() + interval '60 seconds');
insert into public.download_autorizacoes (profile_id, bucket, path, criado_em, expira_em) values
  (pg_temp.usuario('ga1'), 'crm-documentos',
   'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000401.pdf',
   now() - interval '2 minutes', now() - interval '1 minute');
select pg_temp.entrar('ca1a');
select is((select count(*)::int from storage.objects where bucket_id in ('crm-documentos', 'contratos')), 0,
          'nem com autorização vigente CA1a lê o objeto direto: sem SELECT, não assina URL com validade própria');
select ok(public.download_autorizado('crm-documentos',
          'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000401.pdf'),
          'download_autorizado: verdadeiro para quem recebeu a autorização vigente');
select pg_temp.entrar('ga1');
select ok(not public.download_autorizado('crm-documentos',
          'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000401.pdf'),
          'autorização vencida não vale');
select pg_temp.entrar('ca2a');
select ok(not public.download_autorizado('crm-documentos',
          'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000401.pdf'),
          'a autorização é pessoal');
-- a consulta que a Edge baixar-arquivo faz com a service role (usuário validado no Auth, mesmo bucket e caminho, vigente)
select pg_temp.entrar_servico();
select is((select array_agg(a.profile_id order by a.profile_id) from public.download_autorizacoes a
           where a.bucket = 'crm-documentos' and a.expira_em > now()
             and a.path = 'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000401.pdf'),
          array[pg_temp.usuario('ca1a')], 'service role (Edge baixar-arquivo) resgata só a autorização vigente, com o dono');
select pg_temp.entrar('admin');
select is((select count(*)::int from storage.objects where bucket_id in ('crm-documentos', 'contratos')), 0,
          'nem o admin lê crm-documentos ou contratos sem autorização (createSignedUrl sem RPC falha)');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('contratos', 'e0000000-0000-4000-8000-000000000501/minuta-v2-abcdef12.pdf')$$,
                 '42501', null, 'bucket contratos: nem o admin grava (só a service role)');

-- upload em crm-documentos por pode_enviar_documento
select pg_temp.entrar('ca2a');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('crm-documentos',
                   'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000411.pdf')$$,
                 '42501', null, 'CA2a não envia arquivo para documento de c1');
select pg_temp.entrar('ca1a');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('crm-documentos',
                  'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000412.pdf')$$,
                'CA1a envia arquivo para a solicitação pendente de c1');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('crm-documentos',
                   'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000302/e0000000-0000-4000-8000-000000000413.pdf')$$,
                 '42501', null, 'solicitação já aprovada não recebe arquivo');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('crm-documentos',
                   'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/cpf-do-cliente.pdf')$$,
                 '42501', null, 'nome de arquivo fora do formato <uuid>.<ext> é recusado');
select pg_temp.entrar('titular_c1');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('crm-documentos',
                  'd0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000414.pdf')$$,
                'o titular envia arquivo para a própria solicitação pendente');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('crm-documentos',
                   'd0000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000303/e0000000-0000-4000-8000-000000000415.pdf')$$,
                 '42501', null, 'o titular não envia arquivo para outro cliente');
select pg_temp.entrar('bloqueado');
select ok(not public.pode_enviar_documento('d0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000301/e0000000-0000-4000-8000-000000000416.pdf'),
          'pode_enviar_documento: falso sem escopo');

-- bucket imoveis
select pg_temp.entrar('ca2a');
select is((select array_agg(o.name order by o.name) from storage.objects o where o.bucket_id = 'imoveis'),
          array['e0000000-0000-4000-8000-000000000202/foto-b.webp'], 'imoveis: CA2a vê só a foto do aprovado');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('imoveis', 'e0000000-0000-4000-8000-000000000201/foto-d.webp')$$,
                 '42501', null, 'imoveis: CA2a não envia foto para o imóvel do CA1a');
select pg_temp.entrar('ca1a');
select is((select count(*)::int from storage.objects o where o.bucket_id = 'imoveis'), 2, 'imoveis: CA1a vê as fotos do rascunho e do aprovado');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('imoveis', 'e0000000-0000-4000-8000-000000000201/foto-c.webp')$$,
                'imoveis: o criador envia foto para o rascunho');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('imoveis', 'e0000000-0000-4000-8000-000000000202/foto-e.webp')$$,
                 '42501', null, 'imoveis: não envia foto para imóvel aprovado de outro');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('imoveis', 'e0000000-0000-4000-8000-000000000201/Foto.PNG')$$,
                 '42501', null, 'imoveis: nome fora do formato é recusado');

-- ============ PORTAL: políticas reescritas com meu_cliente_id() (mesma semântica) ============
select pg_temp.entrar('titular_c1');
select ok((select count(*) from public.cliente_negocios) = 1 and (select count(*) from public.cliente_arquivos) = 1
          and not exists (select 1 from public.cliente_negocios where cliente_id <> pg_temp.cliente('c1')),
          'titular vê só os próprios negócios e arquivos');
select is((select count(*)::int from public.obra_atualizacoes), 1, 'titular vê só a obra do empreendimento do seu negócio');
select is((select array_agg(o.name) from storage.objects o where o.bucket_id = 'cliente-arquivos'),
          array['d0000000-0000-4000-8000-000000000001/extrato.pdf'], 'titular vê só a própria pasta em cliente-arquivos');
select is(pg_temp.tabelas_com_linhas(array['unidades', 'empreendimento_materiais', 'parceiros', 'imoveis', 'propostas',
          'configuracao_publica', 'lgpd_termos']), '{}'::text[], 'titular não vê nada da área de parceiros');
select pg_temp.sair();
update public.clientes set portal_liberado = false where id = pg_temp.cliente('c1');
select pg_temp.entrar('titular_c1');
select is(pg_temp.tabelas_com_linhas(array['cliente_negocios', 'cliente_arquivos', 'obra_atualizacoes']), '{}'::text[],
          'portal_liberado = false: o titular deixa de ver negócios, arquivos e obra');
select is((select count(*)::int from storage.objects), 0, 'portal_liberado = false: nenhum arquivo');
select pg_temp.sair();
update public.clientes set portal_liberado = true, anonimizado_em = now() where id = pg_temp.cliente('c1');
select pg_temp.entrar('titular_c1');
select ok(public.meu_cliente_id() is null and (select count(*) from public.cliente_negocios) = 0, 'titular anonimizado não vê nada');
select pg_temp.sair();
update public.clientes set anonimizado_em = null where id = pg_temp.cliente('c1');
select pg_temp.entrar('ca1a');
select is(pg_temp.tabelas_com_linhas(array['cliente_negocios', 'cliente_arquivos']), '{}'::text[],
          'CA1a não vê negócios nem arquivos do portal');
select is((select count(*)::int from storage.objects o where o.bucket_id = 'cliente-arquivos'), 0, 'CA1a não vê cliente-arquivos');
select pg_temp.entrar('admin');
select ok((select count(*) from public.cliente_negocios) = 2 and (select count(*) from public.cliente_arquivos) = 2
          and (select count(*) from storage.objects o where o.bucket_id = 'cliente-arquivos') = 2,
          'admin continua vendo negócios, arquivos e a pasta do portal');

-- ============ CONFIGURAÇÃO, TERMOS E TRANSIÇÕES ============
select pg_temp.entrar('ca1a');
select is((select count(*)::int from public.configuracao_publica), 1, 'parceiro aprovado lê configuracao_publica');
select is((select count(*)::int from public.configuracao_geral), 0, 'parceiro não lê configuracao_geral (MFA e retenção)');
select ok((select count(*) from public.status_transicoes) > 0 and (select count(*) from public.permissoes_rede) = 33
          and (select count(*) from public.lgpd_termos) = 2 and (select count(*) from public.imovel_tipos) = 3,
          'parceiro aprovado lê transições, permissões, termos e tipos de imóvel');
select ok((select count(*) from public.parametros_simulacao) = 1 and (select count(*) from public.contrato_modelos) = 4,
          'parceiro vê só as versões vigentes de parâmetros e modelos');
select is(pg_temp.tabelas_com_linhas(array['contrato_signatario_regras', 'historico_status', 'migracao_pendencias', 'leads']),
          '{}'::text[], 'parceiro não vê regras de signatários (e-mails), histórico de status, pendências nem leads');
update public.permissoes_rede set permitido = true where acao = 'convite_por_link' and tipo = 'gerente';
select throws_ok($$update public.permissoes_rede set acao = 'cadastrar_imovel' where acao = 'convite_por_link'$$, '42501', null,
                 'permissoes_rede: fora da coluna permitido não há grant');
select pg_temp.entrar('admin');
select ok((select count(*) from public.configuracao_geral) = 1 and (select count(*) from public.contrato_signatario_regras) = 8,
          'admin lê a configuração geral e as regras de signatários');
update public.permissoes_rede set permitido = true where acao = 'convite_por_link' and tipo = 'gerente';
select pg_temp.entrar('super');
update public.permissoes_rede set permitido = true where acao = 'convite_por_link' and tipo = 'imobiliaria';
select pg_temp.sair();
select is((select array_agg(tipo::text || ':' || permitido order by tipo) from public.permissoes_rede where acao = 'convite_por_link'),
          array['imobiliaria:true', 'gerente:false'], 'permissoes_rede: só o Super altera (nem o parceiro nem o admin)');
select ok((select count(*) = 1 and bool_and(categoria = 'configuracao' and ator_id = pg_temp.usuario('super')
                                             and antes = '{"permitido":false}' and depois = '{"permitido":true}')
           from public.auditoria where entidade = 'permissoes_rede' and entidade_id = 'convite_por_link:imobiliaria'),
          'configuração alterada pelo Super: auditoria com antes e depois');

-- ============ INATIVO, BLOQUEADO E PENDENTE VEEM ZERO ============
select pg_temp.entrar('inativo');
select is(pg_temp.tabelas_com_linhas(pg_temp.tabelas_de_parceiro()), '{}'::text[], 'parceiro inativo vê zero');
select ok(pg_temp.clientes_no_escopo() = '{}' and public.meu_parceiro_id() is null and (select count(*) from storage.objects) = 0,
          'parceiro inativo: sem escopo e sem arquivos');
select pg_temp.entrar('bloqueado');
select is(pg_temp.tabelas_com_linhas(pg_temp.tabelas_de_parceiro()), '{}'::text[], 'parceiro bloqueado vê zero (nem o próprio vínculo)');
select ok(pg_temp.clientes_no_escopo() = '{}' and public.escopo_corretor() is null and not public.tem_permissao('cadastrar_cliente')
          and (select count(*) from storage.objects) = 0, 'parceiro bloqueado: sem escopo, nem sobre o próprio cliente (c5)');
select pg_temp.entrar('pendente');
select is(pg_temp.tabelas_com_linhas(pg_temp.tabelas_de_parceiro()), '{}'::text[], 'autocadastro pendente vê zero');
select pg_temp.entrar('ca1a');
select ok(cardinality(pg_temp.tabelas_com_linhas(pg_temp.tabelas_de_parceiro())) >= 12,
          'contraste: o parceiro aprovado vê linhas nessas tabelas');

select pg_temp.sair();
select * from finish();
rollback;
