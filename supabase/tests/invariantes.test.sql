-- Invariantes de segurança do schema public (docs/ARQUITETURA_EXPANSAO.md §3.1, §4.1, §4.3, §4.6, §5.1, §8.5).
-- Olham só o catálogo (funções, grants, RLS, buckets e políticas de Storage); não dependem da fixture.
-- Função ou tabela nova que precise de grant para anon/authenticated tem de entrar na lista branca daqui (WP7).
-- O estado conferido é o de depois do corte e da contração (20260929000018): as asserções dessa parte não são mais
-- condicionais — sem a 18 aplicada, este teste falha.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- ============ FUNÇÕES ============
select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and not coalesce(p.proconfig @> array['search_path=""'], false)),
  '{}'::text[], 'toda função security definer de public tem search_path vazio fixo');

select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}') from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  '{}'::text[], 'toda função de public (inclusive security invoker) tem search_path fixo');

select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}') from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')),
  '{}'::text[], 'nenhuma função de public é executável por PUBLIC');

select set_eq(
  $$select p.proname::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')$$,
  array['is_admin', 'lgpd_termo_vigente', 'rede_link_publico'],
  'lista branca: anon executa só is_admin, lgpd_termo_vigente e rede_link_publico');

select set_eq(
  $$select p.proname::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')$$,
  array[
    -- RPCs de usuário (§4.4)
    'meu_escopo',
    'rede_cadastrar_imobiliaria', 'rede_editar_imobiliaria', 'rede_cadastrar_parceiro', 'rede_editar_parceiro',
    'rede_atualizar_meu_cadastro', 'rede_parceiro_detalhe', 'rede_aprovar_autocadastro', 'rede_recusar_autocadastro',
    'rede_bloquear_parceiro', 'rede_desbloquear_parceiro', 'rede_pode_convidar', 'rede_transferir_clientes',
    'rede_transferir_corretor', 'rede_mudar_imobiliaria_corretor', 'rede_regularizar_legado', 'rede_inativar_parceiro',
    'rede_reativar_parceiro', 'rede_inativar_imobiliaria', 'rede_gerar_codigo_indicacao',
    'crm_cadastrar_cliente', 'crm_editar_cliente', 'crm_listar', 'crm_clientes_opcoes', 'crm_ficha',
    'crm_inativar_cliente', 'crm_liberar_portal', 'crm_duplicidades_listar', 'crm_duplicidade_resolver',
    'leads_listar', 'leads_converter', 'leads_descartar', 'leads_excluir', 'leads_exportar',
    'propostas_listar', 'propostas_criar', 'propostas_responder',
    'crm_kanban', 'crm_kanban_coluna', 'crm_mudar_etapa', 'crm_timeline', 'crm_notas', 'crm_tarefas', 'crm_documentos',
    'crm_nota_criar', 'crm_tarefa_criar', 'crm_tarefa_editar', 'crm_tarefa_concluir', 'crm_responsaveis',
    'crm_minhas_tarefas', 'crm_documento_solicitar', 'crm_documento_cancelar', 'crm_documento_registrar_envio',
    'crm_documento_analisar', 'crm_documento_baixar',
    'contrato_simular', 'contrato_criar', 'contrato_atualizar_simulacao', 'contrato_mudar_status',
    'contrato_dados_modelo', 'contrato_preparar_envio', 'contratos_listar', 'contrato_detalhe', 'contrato_baixar',
    'config_publicar_parametros', 'config_publicar_modelo', 'config_liberar_modelo',
    'imovel_mudar_status', 'imovel_foto_registrar', 'imovel_foto_remover', 'imovel_fotos_ordenar', 'imovel_inativar',
    'auditoria_consultar', 'config_atualizar', 'equipe_definir_papel', 'lgpd_publicar_termo', 'lgpd_aceitar_termo',
    'lgpd_revogar_consentimento', 'lgpd_anonimizar_cliente', 'portal_meus_dados', 'portal_meu_corretor',
    'portal_documentos', 'portal_contratos', 'portal_contrato_baixar', 'painel_resumo', 'migracao_pendencias_resolver',
    -- RPCs públicas
    'lgpd_termo_vigente', 'rede_link_publico',
    -- helpers usados em políticas de tabela e de Storage (§4.1); download_autorizado: consulta da própria autorização
    'is_admin', 'is_super', 'is_parceiro_aprovado', 'meu_papel', 'escopo_corretor', 'escopo_gerente',
    'escopo_imobiliaria', 'minha_imobiliaria_id', 'meu_parceiro_id', 'pode_ver_cliente', 'meu_cliente_id',
    'tem_permissao', 'pode_enviar_documento', 'pode_enviar_foto_imovel', 'download_autorizado', 'pode_ver_imovel',
    'pode_editar_imovel', 'parametros_vigente_id', 'modelo_vigente_id',
    -- validadores usados em CHECK, ponte do gatilho de auditoria (recusa fora de gatilho) e relatórios do admin
    'cpf_valido', 'cnpj_valido', 'auditar_linha_gravar', 'relatorio'],
  'lista branca: o que authenticated executa em public');

select is(
  (select coalesce(array_agg(n order by n), '{}') from unnest(array[
      'crm_pre_cadastro', 'rede_vincular_login', 'rede_registrar_convite', 'contrato_registrar_documento',
      'contrato_registrar_d4sign_uuid', 'contrato_registrar_envio', 'contrato_falha_envio', 'contrato_registrar_retorno',
      'portal_localizar_cliente', 'contrato_confirmar_envio', 'tentativas_reservar', 'tentativas_confirmar']) n
    join pg_proc p on p.proname = n and p.pronamespace = 'public'::regnamespace
    where has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
       or not has_function_privilege('service_role', p.oid, 'execute')),
  '{}'::text[], 'RPCs de sistema: só service_role executa (nem authenticated nem anon)');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[
      'crm_pre_cadastro', 'rede_vincular_login', 'rede_registrar_convite', 'contrato_registrar_documento',
      'contrato_registrar_d4sign_uuid', 'contrato_registrar_envio', 'contrato_falha_envio', 'contrato_registrar_retorno',
      'portal_localizar_cliente', 'contrato_confirmar_envio', 'tentativas_reservar', 'tentativas_confirmar',
      'notificacoes_reenviar', 'auditoria_purgar', 'limpar_temporarios'])),
  15, 'as 12 RPCs de sistema (com contrato_confirmar_envio, WP4R-01, e a reserva de tentativas, FR1-01) e as 3 tarefas do pg_cron existem (uma vez cada)');

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('notificacoes_reenviar', 'auditoria_purgar', 'limpar_temporarios')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('service_role', p.oid, 'execute'))),
  '{}'::text[], 'tarefas do pg_cron: ninguém executa pela API (rodam como postgres)');

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like '\_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('service_role', p.oid, 'execute'))),
  '{}'::text[], 'funções internas (prefixo _) não têm grant a anon, authenticated nem service_role');

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any (array[
      'meu_escopo', 'crm_ficha', 'crm_cadastrar_cliente', 'contrato_criar', 'lgpd_anonimizar_cliente', 'equipe_definir_papel',
      'config_atualizar', 'auditoria_consultar', 'portal_meus_dados', 'rede_transferir_clientes'])
      and (has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  '{}'::text[], 'RPCs de usuário: nem anon nem service_role (as Edge Functions chamam com o JWT do usuário, §4.6)');

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.provolatile <> 'v' and p.proname <> 'meu_escopo'
      and (p.proname ~ '^(rede|crm|leads|propostas|contrato|contratos|config|imovel|auditoria|equipe|lgpd|portal|painel|migracao|notificacoes)_'
           or p.proname = 'limpar_temporarios')),
  '{}'::text[], 'RPCs da §4.4 são volatile (gravam auditoria; só por POST), exceto meu_escopo');

select ok(
  has_function_privilege('supabase_auth_admin', 'public.hook_token_acesso(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.hook_token_acesso(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.hook_token_acesso(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.hook_token_acesso(jsonb)', 'execute'),
  'hook_token_acesso: só supabase_auth_admin executa');

select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.auditar_linha()'::regprocedure) is false
  and (select p.prosecdef from pg_proc p where p.oid = 'public.carimbar()'::regprocedure) is false
  and (select p.prosecdef from pg_proc p where p.oid = 'public.protege_campos_profile()'::regprocedure) is false,
  'gatilhos que dependem de current_user (auditar_linha, carimbar, protege_campos_profile) são security invoker');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_transicionar', '_auditar', '_evento_cliente', '_evento_dominio', '_notificar',
                       '_autorizar_download', '_crm_solicitar_documentos_basicos') and p.prosecdef),
  7, 'funções internas do núcleo existem e são security definer');

-- ============ TABELAS ============
select is(
  (select coalesce(array_agg(c.relname::text order by c.relname::text), '{}') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '{}'::text[], 'toda tabela de public tem RLS ligada');

select set_eq(
  $$select c.relname::text || ':' || pr from pg_class c
      cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain']) pr
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('anon', c.oid, pr)$$,
  array['empreendimentos:select', 'empreendimento_midias:select', 'empreendimento_lazer:select',
        'empreendimento_proximidades:select', 'empreendimento_ficha:select'],
  'lista branca: anon só lê o conteúdo público dos empreendimentos');

select is(
  (select coalesce(array_agg(c.relname::text || ':' || r || ':' || pr order by c.relname::text || ':' || r || ':' || pr), '{}') from pg_class c
    cross join unnest(array['anon', 'authenticated', 'service_role']) r
    cross join unnest(array['truncate', 'references', 'trigger', 'maintain']) pr
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege(r, c.oid, pr)),
  '{}'::text[], 'ninguém da API tem TRUNCATE, REFERENCES, TRIGGER ou MAINTAIN (LOCK, VACUUM, REFRESH) em public');

-- privilégios padrão: tabela nova criada por postgres em public (como as migrations dos pacotes) nasce sem NENHUM
-- privilégio para a API; o grant é sempre explícito na migration (CLAUDE.md)
create table public._teste_privilegios_padrao (id int);
select is(
  (select coalesce(array_agg(r || ':' || pr order by r || ':' || pr), '{}') from unnest(array['anon', 'authenticated', 'service_role']) r
    cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain']) pr
    where has_table_privilege(r, 'public._teste_privilegios_padrao'::regclass, pr)),
  '{}'::text[], 'tabela nova em public nasce sem privilégio para anon, authenticated e service_role (nem MAINTAIN)');
drop table public._teste_privilegios_padrao;

select is(
  (select coalesce(array_agg(c.relname::text || ':' || r order by c.relname::text || ':' || r), '{}') from pg_class c
    cross join unnest(array['anon', 'authenticated']) r
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
      and (has_sequence_privilege(r, c.oid, 'usage') or has_sequence_privilege(r, c.oid, 'select')
           or has_sequence_privilege(r, c.oid, 'update'))),
  '{}'::text[], 'anon e authenticated não têm privilégio em sequências de public (identidade não precisa)');

-- §3.1: toda referência a um perfil é "on delete set null" (ou cascade, onde a linha é do próprio perfil), para a
-- remoção do usuário Auth (anonimização, limpeza de testes) não esbarrar em FK. Exceção documentada: imoveis.criado_por
-- (§3.7, not null: a autoria do imóvel é a base da visibilidade E4; quem cadastrou imóvel é inativado, não removido).
select is(
  (select coalesce(array_agg(k.conrelid::regclass::text || '.' || a.attname || ':' || k.confdeltype::text
                             order by k.conrelid::regclass::text || '.' || a.attname), '{}')
     from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where k.contype = 'f' and k.connamespace = 'public'::regnamespace
      and k.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass) and k.confdeltype not in ('n', 'c')),
  array['imoveis.criado_por:a'], 'FKs para perfis: set null ou cascade (só imoveis.criado_por fica, §3.7)');

-- CRM, contratos, auditoria e tabelas de sistema: nenhum acesso direto (nem do admin): só RPC (§4.2, §4.3)
select is(
  (select coalesce(array_agg(t || ':' || r || ':' || pr order by t || ':' || r || ':' || pr), '{}') from unnest(array[
      'cliente_notas', 'cliente_tarefas', 'cliente_documentos', 'cliente_documento_arquivos', 'cliente_eventos',
      'cliente_duplicidades', 'cliente_vinculos_historico', 'contratos', 'contrato_signatarios', 'auditoria',
      'parceiro_vinculos_historico', 'eventos_dominio', 'eventos_consumo', 'notificacoes', 'integracao_eventos',
      'integracao_chamadas', 'tentativas_publicas', 'download_autorizacoes', 'migracao_decisoes',
      'lgpd_consentimentos', 'parceiro_status_historico', 'pre_cadastro_avisos', 'legado_parceiro_clientes',
      'migracao_parceiro_clientes', 'migracao_propostas',
      -- depois do corte (§4.3): nem o núcleo do CRM nem leads e propostas têm acesso direto (tudo por RPC)
      'clientes', 'leads', 'propostas']) t
    cross join unnest(array['anon', 'authenticated']) r
    cross join unnest(array['select', 'insert', 'update']) pr
    where has_any_column_privilege(r, ('public.' || t)::regclass, pr)
       or (pr = 'update' and has_table_privilege(r, ('public.' || t)::regclass, 'delete'))),
  '{}'::text[], 'CRM, clientes, leads, propostas, contratos, auditoria, legado e tabelas de sistema: nenhum grant a anon nem a authenticated');

-- somente inclusão: nem a service_role altera ou apaga (§4.3, §5.1)
select is(
  (select coalesce(array_agg(t || ':' || pr order by t || ':' || pr), '{}') from unnest(array[
      'auditoria', 'historico_status', 'eventos_dominio', 'integracao_chamadas', 'lgpd_termos', 'lgpd_consentimentos',
      'parceiro_vinculos_historico', 'cliente_vinculos_historico', 'cliente_notas', 'cliente_documento_arquivos',
      'cliente_eventos', 'parametros_simulacao', 'contrato_modelos', 'parceiro_status_historico']) t
    cross join unnest(array['update', 'delete', 'truncate']) pr
    where has_table_privilege('service_role', ('public.' || t)::regclass, pr)
       or (pr = 'update' and has_any_column_privilege('service_role', ('public.' || t)::regclass, 'update'))),
  '{}'::text[], 'tabelas somente inclusão: service_role só lê e inclui');

select ok(
  has_table_privilege('service_role', 'public.auditoria', 'select')
  and has_table_privilege('service_role', 'public.auditoria', 'insert'),
  'service_role lê e inclui na auditoria (eventos de integração das Edge Functions)');

select ok(
  (select bool_and(tgenabled = 'O') from pg_trigger
    where tgrelid = 'public.auditoria'::regclass and tgname in ('auditoria_imutavel', 'auditoria_sem_truncate'))
  and (select count(*) from pg_trigger
        where tgrelid = 'public.auditoria'::regclass and tgname in ('auditoria_imutavel', 'auditoria_sem_truncate')) = 2,
  'auditoria: gatilhos de imutabilidade (linha e truncate) presentes e ligados');

-- parceiros: sem a coluna cpf para authenticated (o CPF de parceiro só sai por rede_parceiro_detalhe, auditada)
select ok(
  not has_column_privilege('authenticated', 'public.parceiros', 'cpf', 'select')
  and has_column_privilege('authenticated', 'public.parceiros', 'nome', 'select')
  and not has_table_privilege('authenticated', 'public.parceiros', 'select'),
  'parceiros: authenticated lê por coluna, sem cpf');

select ok(
  not has_any_column_privilege('authenticated', 'public.parceiros', 'insert')
  and not has_any_column_privilege('authenticated', 'public.parceiros', 'update')
  and not has_table_privilege('authenticated', 'public.parceiros', 'delete')
  and not has_any_column_privilege('authenticated', 'public.imobiliarias', 'insert')
  and not has_any_column_privilege('authenticated', 'public.imobiliarias', 'update')
  and not has_table_privilege('authenticated', 'public.imobiliarias', 'delete'),
  'rede: escrita só por RPC (sem insert, update ou delete para authenticated)');

select ok(
  not has_column_privilege('authenticated', 'public.imoveis', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.imoveis', 'criado_por', 'insert')
  and not has_column_privilege('authenticated', 'public.imoveis', 'imobiliaria_id', 'update')
  and not has_column_privilege('authenticated', 'public.imoveis', 'id', 'insert')
  and not has_table_privilege('authenticated', 'public.imoveis', 'delete')
  and has_column_privilege('authenticated', 'public.imoveis', 'valor', 'update'),
  'imoveis: status, autoria e cadeia fora do grant de coluna (mudam por RPC ou gatilho)');

select ok(
  not has_column_privilege('authenticated', 'public.clientes', 'corretor_id', 'insert')
  and not has_column_privilege('authenticated', 'public.clientes', 'corretor_id', 'update')
  and not has_column_privilege('authenticated', 'public.clientes', 'etapa', 'update')
  and not has_column_privilege('authenticated', 'public.clientes', 'portal_liberado', 'update')
  and not has_table_privilege('authenticated', 'public.clientes', 'delete'),
  'clientes: a tela antiga só grava nome, cpf, email e telefone; cadeia, etapa e portal por RPC; sem delete');

select ok(
  not has_table_privilege('authenticated', 'public.configuracao_geral', 'update')
  and not has_any_column_privilege('authenticated', 'public.configuracao_geral', 'update')
  and not has_table_privilege('service_role', 'public.configuracao_geral', 'delete')
  and not has_table_privilege('service_role', 'public.configuracao_geral', 'insert'),
  'configuracao_geral: authenticated não altera direto (config_atualizar); linha única');

select ok(
  not has_table_privilege('anon', 'public.configuracao_publica', 'select')
  and has_table_privilege('authenticated', 'public.configuracao_publica', 'select')
  and not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'configuracao_publica'
                    and column_name in ('exigir_mfa_interno', 'retencao_acesso_meses', 'retencao_operacao_meses')),
  'configuracao_publica: sem MFA nem retenção; anon não lê');

-- ============ CORTE E CONTRAÇÃO (20260929000018, §2.4, §4.3, §8.1, §10.1) ============
select ok(to_regclass('public.migracao_parceiro_clientes') is not null and to_regclass('public.migracao_propostas') is not null,
          'corte aplicado: os mapas da migração existem');
select ok(not has_any_column_privilege('authenticated', 'public.clientes', 'select')
          and not has_any_column_privilege('authenticated', 'public.leads', 'select')
          and not has_any_column_privilege('authenticated', 'public.propostas', 'select')
          and not has_table_privilege('authenticated', 'public.clientes', 'delete')
          and not has_table_privilege('authenticated', 'public.leads', 'delete')
          and not has_table_privilege('authenticated', 'public.propostas', 'delete'),
          'depois do corte: authenticated não lê nem grava clientes, leads e propostas (§4.3)');
select ok(to_regclass('public.parceiro_clientes') is null and to_regclass('public.legado_parceiro_clientes') is not null
          and not exists (select 1 from pg_policy pl where pl.polrelid = 'public.legado_parceiro_clientes'::regclass)
          and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                          cross join unnest(array['select', 'insert', 'update', 'delete']) pr
                          where has_table_privilege(r, 'public.legado_parceiro_clientes'::regclass, pr)),
          'contração: parceiro_clientes virou legado_parceiro_clientes, sem política nem grant (nem da service role)');
select ok(not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'propostas' and column_name = 'parceiro_cliente_id'),
          'contração: propostas não tem mais parceiro_cliente_id (o vínculo antigo fica em migracao_propostas)');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a
            where a.attrelid = 'public.clientes'::regclass and a.attname in ('corretor_id', 'gerente_id', 'imobiliaria_id')
              and a.attnotnull),
          array['corretor_id', 'gerente_id', 'imobiliaria_id'], 'corte: a cadeia do cliente é NOT NULL');
select ok((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
            where d.adrelid = 'public.clientes'::regclass and a.attname = 'origem') like '''cadastro_interno''%'
          and not exists (select 1 from pg_trigger t where t.tgrelid = 'public.clientes'::regclass and t.tgname = 'clientes_padroes')
          and to_regprocedure('public._clientes_padroes()') is null,
          'contração: origem padrão cadastro_interno e fim do ramo portal_admin (sem clientes_padroes)');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'update')
          and not has_any_column_privilege('authenticated', 'public.profiles', 'update')
          and not has_table_privilege('authenticated', 'public.profiles', 'insert')
          and not has_table_privilege('authenticated', 'public.profiles', 'delete'),
          'profiles: authenticated só lê (papel, status, e-mail e CPF mudam só por RPC ou service role)');
select is((select count(*)::int from public.migracao_decisoes), 0,
          'contração: migracao_decisoes (que tem CPF) fica vazia depois do corte');

-- ============ STORAGE (§3.10, §4.3) ============
select is(
  (select coalesce(array_agg(b.id || ':' || b.public::text order by b.id || ':' || b.public::text), '{}') from storage.buckets b
    where b.id in ('crm-documentos', 'contratos', 'imoveis')),
  array['contratos:false', 'crm-documentos:false', 'imoveis:false'], 'buckets novos existem e são privados');

select is(
  (select count(*)::int from pg_policy pl
    where pl.polrelid = 'storage.objects'::regclass and pl.polcmd in ('r', '*')
      and (pg_get_expr(pl.polqual, pl.polrelid) like '%crm-documentos%'
           or pg_get_expr(pl.polqual, pl.polrelid) like '%''contratos''%')),
  0, 'crm-documentos e contratos: nenhuma política de leitura (quem assina a URL é a Edge baixar-arquivo, até o fim da autorização auditada)');

select is(
  (select count(*)::int from pg_policy pl
    where pl.polrelid = 'storage.objects'::regclass and pl.polcmd in ('w', 'd', '*')
      and (coalesce(pg_get_expr(pl.polqual, pl.polrelid), '') || coalesce(pg_get_expr(pl.polwithcheck, pl.polrelid), ''))
          ~ '(crm-documentos|''contratos'')'),
  0, 'crm-documentos e contratos: sem UPDATE nem DELETE para a API');

select is(
  (select count(*)::int from pg_policy pl
    where pl.polrelid = 'storage.objects'::regclass and pl.polcmd = 'a'
      and pg_get_expr(pl.polwithcheck, pl.polrelid) like '%''contratos''%'),
  0, 'contratos: nenhuma política de upload (só a service role grava)');

select ok(
  (select file_size_limit from storage.buckets where id = 'crm-documentos') = 5242880
  and (select file_size_limit from storage.buckets where id = 'imoveis') = 5242880
  and (select allowed_mime_types from storage.buckets where id = 'contratos') = array['application/pdf'],
  'limites dos buckets: 5 MB (crm-documentos, imoveis) e contratos só PDF');

-- ============ VIEWS ============
select is(
  (select coalesce(array_agg(c.relname::text order by c.relname::text), '{}') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
      and not coalesce(c.reloptions @> array['security_barrier=true'], false)),
  '{}'::text[], 'views de public são security_barrier');

select * from finish();
rollback;
