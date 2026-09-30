-- Governança base da expansão (docs/ARQUITETURA_EXPANSAO.md §3.1, §3.2, §3.9, §5.1, §5.4, §8.1).
-- Conteúdo: enums novos; validadores de CPF/CNPJ; carimbo de autoria; configuração geral (linha única);
-- auditoria somente inclusão; histórico de status; eventos de domínio; fila e configuração de notificações;
-- registros de integração; tentativas públicas; autorizações de download; termos e consentimentos LGPD;
-- matriz de permissões da rede; tabelas da migração de dados.
-- Regras: nenhuma referência a objeto de migration posterior; toda tabela com RLS ligada (as políticas para
-- `authenticated` nascem na 20260929000009); grants explícitos (o schema public não concede nada sozinho).

-- ============ PRIVILÉGIOS PADRÃO: complemento da 20260921000002 ============
-- A 20260921000002 tirou dos privilégios padrão só SELECT/INSERT/UPDATE/DELETE (tabelas) e USAGE/SELECT
-- (sequências). O que sobrou do padrão do Supabase (TRUNCATE, REFERENCES e TRIGGER em tabela; UPDATE em sequência)
-- continuou valendo para anon e authenticated em toda tabela ou sequência criada depois (portal_acessos e as
-- identidades) e para a service_role em todas. O MAINTAIN do Postgres 17 (LOCK TABLE, VACUUM, ANALYZE, REINDEX,
-- CLUSTER, REFRESH) também: anon conseguia `lock table … in access exclusive mode` em portal_acessos por SQL direto.
-- Nenhum desses privilégios é usado pela API: TRUNCATE passa por cima da RLS e dos gatilhos de linha, e a identidade
-- (generated … as identity) não exige privilégio na sequência.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated;

-- ============ ENUMS (§3.2) ============
create type public.tipo_parceiro       as enum ('imobiliaria', 'gerente', 'corretor');
create type public.tipo_pessoa         as enum ('fisica', 'juridica');
create type public.genero              as enum ('masculino', 'feminino', 'outros');
create type public.estado_civil        as enum ('solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel');
create type public.etapa_funil         as enum ('novo_contato', 'contato_iniciado', 'documentacao', 'finalizado', 'perdido');
create type public.origem_cliente      as enum ('cadastro_interno', 'pre_cadastro_link', 'lead_site', 'portal_admin',
                                                'migracao_parceiro_clientes', 'importacao');
create type public.status_lead         as enum ('novo', 'convertido', 'descartado');
create type public.status_tarefa       as enum ('pendente', 'concluida');
create type public.tipo_documento      as enum ('cliente', 'contrato');
create type public.status_documento    as enum ('pendente', 'em_analise', 'aprovado', 'rejeitado');
create type public.tipo_contrato       as enum ('aquisicao');
create type public.forma_pagamento     as enum ('parcelado', 'flexivel');
create type public.modelo_chave        as enum ('parcelado', 'flexivel', 'servico_corretor', 'servico_imobiliaria');
create type public.status_contrato     as enum ('rascunho', 'documentacao_pendente', 'em_analise', 'assinatura_pendente',
                                                'assinado', 'recusado', 'expirado', 'cancelado', 'arquivado');
create type public.papel_signatario    as enum ('cliente', 'representante_arken', 'corretor', 'testemunha');
create type public.status_assinatura   as enum ('pendente', 'assinado', 'recusado');
create type public.status_imovel       as enum ('rascunho', 'pendente', 'em_revisao', 'aprovado', 'no_contrato');
create type public.categoria_auditoria as enum ('acesso', 'operacao', 'configuracao', 'seguranca', 'integracao', 'lgpd');
create type public.status_notificacao  as enum ('pendente', 'enviado', 'erro', 'ignorado');

-- ============ VALIDADORES (§3.1): imutáveis, usáveis em CHECK; espelhados em src/lib/format.ts ============
-- Somente dígitos. Nunca lançam erro (dígito lido por ascii, sem cast), então servem para qualquer entrada.
create function public.cpf_valido(p_cpf text) returns boolean
language sql immutable strict parallel safe set search_path = '' as $$
  select p_cpf ~ '^\d{11}$' and p_cpf !~ '^(\d)\1{10}$'
     and (select sum((ascii(substr(p_cpf, i, 1)) - 48) * (11 - i)) from generate_series(1, 9) i) * 10 % 11 % 10
         = ascii(substr(p_cpf, 10, 1)) - 48
     and (select sum((ascii(substr(p_cpf, i, 1)) - 48) * (12 - i)) from generate_series(1, 10) i) * 10 % 11 % 10
         = ascii(substr(p_cpf, 11, 1)) - 48
$$;

-- CNPJ numérico (14 dígitos), como definido no §3.3. O CNPJ alfanumérico da Receita não é aceito nesta etapa.
create function public.cnpj_valido(p_cnpj text) returns boolean
language sql immutable strict parallel safe set search_path = '' as $$
  with r as (
    select (select sum((ascii(substr(p_cnpj, i, 1)) - 48) * case when i <= 4 then 6 - i else 14 - i end)
              from generate_series(1, 12) i) % 11 as r1,
           (select sum((ascii(substr(p_cnpj, i, 1)) - 48) * case when i <= 5 then 7 - i else 15 - i end)
              from generate_series(1, 13) i) % 11 as r2
  )
  select p_cnpj ~ '^\d{14}$' and p_cnpj !~ '^(\d)\1{13}$'
     and (case when r.r1 < 2 then 0 else 11 - r.r1 end) = ascii(substr(p_cnpj, 13, 1)) - 48
     and (case when r.r2 < 2 then 0 else 11 - r.r2 end) = ascii(substr(p_cnpj, 14, 1)) - 48
  from r
$$;

revoke execute on function public.cpf_valido(text), public.cnpj_valido(text) from public, anon;
-- CHECK constraints conferem EXECUTE de quem grava
grant execute on function public.cpf_valido(text), public.cnpj_valido(text) to authenticated, service_role;

-- ============ CARIMBO DE AUTORIA (§3.1) ============
-- BEFORE INSERT/UPDATE. Tolerante: só mexe nas colunas de carimbo que a tabela tiver
-- (criado_em, criado_por, atualizado_em, atualizado_por, inativado_por).
-- Pela API (anon/authenticated) o carimbo é sempre imposto; dentro de RPC (postgres) e pela service role,
-- um valor explícito no insert é respeitado (migração de dados), senão vale now()/auth.uid().
-- auth.uid() continua sendo o de quem chamou, mesmo dentro de security definer.
-- No UPDATE, criado_em e criado_por não mudam, com UMA exceção: criado_por pode virar nulo fora da API. É o que faz a
-- ação "on delete set null" da FK (roda como o dono da tabela) quando o usuário Auth é removido (§3.1); sem isso a
-- remoção de quem criou qualquer linha falhava com 23503. Pela API (anon/authenticated) nunca muda.
-- Nas tabelas, o gatilho se chama só "carimbar", para rodar antes dos demais BEFORE (ordem alfabética).
create function public.carimbar() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_api constant boolean := current_user in ('anon', 'authenticated');
  v_uid constant uuid := auth.uid();
  v_novo jsonb := to_jsonb(new);
  v_antigo jsonb;
  v_ajuste jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    if v_novo ? 'criado_em' and (v_api or jsonb_typeof(v_novo -> 'criado_em') = 'null') then
      v_ajuste := v_ajuste || jsonb_build_object('criado_em', now());
    end if;
    if v_novo ? 'criado_por' and (v_api or jsonb_typeof(v_novo -> 'criado_por') = 'null') then
      v_ajuste := v_ajuste || jsonb_build_object('criado_por', v_uid);
    end if;
    if v_api then
      if v_novo ? 'atualizado_em' then v_ajuste := v_ajuste || jsonb_build_object('atualizado_em', null); end if;
      if v_novo ? 'atualizado_por' then v_ajuste := v_ajuste || jsonb_build_object('atualizado_por', null); end if;
    end if;
  elsif tg_op = 'UPDATE' then
    v_antigo := to_jsonb(old);
    if v_novo ? 'criado_em' then v_ajuste := v_ajuste || jsonb_build_object('criado_em', v_antigo -> 'criado_em'); end if;
    if v_novo ? 'criado_por' and (v_api or jsonb_typeof(v_novo -> 'criado_por') <> 'null') then
      v_ajuste := v_ajuste || jsonb_build_object('criado_por', v_antigo -> 'criado_por');
    end if;
    if v_novo ? 'atualizado_em' then v_ajuste := v_ajuste || jsonb_build_object('atualizado_em', now()); end if;
    if v_novo ? 'atualizado_por' then v_ajuste := v_ajuste || jsonb_build_object('atualizado_por', v_uid); end if;
    if v_novo ? 'inativado_por' and v_novo ? 'inativado_em'
       and jsonb_typeof(v_antigo -> 'inativado_em') = 'null' and jsonb_typeof(v_novo -> 'inativado_em') <> 'null' then
      v_ajuste := v_ajuste || jsonb_build_object('inativado_por',
        case when v_api or jsonb_typeof(v_novo -> 'inativado_por') = 'null' then to_jsonb(v_uid) else v_novo -> 'inativado_por' end);
    end if;
  end if;
  if v_ajuste <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_ajuste);
  end if;
  return new;
end $$;

-- ============ SOMENTE INCLUSÃO (genérico) ============
-- BEFORE UPDATE OR DELETE. Nega exclusão e alteração, para todos (inclusive service_role e postgres), com duas
-- exceções: (1) colunas listadas no argumento do gatilho podem ser preenchidas uma vez (de nulo para valor),
-- ex.: 'vigente_ate' ou 'revogado_em,revogado_por,motivo_revogacao'; (2) colunas *_por e profile_id podem virar
-- nulo (FK "on delete set null" quando o usuário Auth é removido, p.ex. pela anonimização do portal).
create function public._somente_inclusao() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_preencher text[] := case when tg_nargs > 0 then string_to_array(replace(tg_argv[0], ' ', ''), ',') else '{}' end;
  v_antigo jsonb;
  v_novo jsonb;
  v_col text;
begin
  if tg_op = 'UPDATE' then
    v_antigo := to_jsonb(old);
    v_novo := to_jsonb(new);
    for v_col in select jsonb_object_keys(v_novo) loop
      continue when (v_antigo -> v_col) is not distinct from (v_novo -> v_col);
      continue when v_col = any (v_preencher) and jsonb_typeof(v_antigo -> v_col) = 'null';
      continue when (v_col like '%\_por' or v_col = 'profile_id') and jsonb_typeof(v_novo -> v_col) = 'null';
      raise exception 'Registro somente inclusão (%.%)', tg_table_name, v_col using errcode = '42501';
    end loop;
    return new;
  end if;
  raise exception 'Registro somente inclusão (%)', tg_table_name using errcode = '42501';
end $$;

-- ============ CONFIGURAÇÃO GERAL (§3.9): uma linha só ============
create table public.configuracao_geral (
  id boolean primary key default true check (id),
  -- casa (A4): preenchidas na 20260929000004, que também cria as FKs
  imobiliaria_casa_id uuid,
  gerente_casa_id uuid,
  corretor_casa_id uuid,
  -- CRM
  exclusividade_dias int not null default 90 check (exclusividade_dias between 1 and 3650),              -- A2 ⚑
  duplicidade_bloqueios_hora int not null default 10 check (duplicidade_bloqueios_hora between 1 and 1000),
  documentos_basicos text[] not null
    default array['CPF', 'CNH', 'Comprovante de residência', 'Comprovante de renda']                  -- CRM-3, F2 ⚑
    check (cardinality(documentos_basicos) between 1 and 20 and array_position(documentos_basicos, null) is null),
  documento_max_bytes int not null default 5242880 check (documento_max_bytes between 1 and 5242880), -- ≤ bucket
  portal_libera_pre_cadastro boolean not null default false,                                           -- N9 ⚑
  -- contratos (N7, D4): nulos bloqueiam o envio para assinatura
  vendedora_razao_social text check (length(btrim(vendedora_razao_social)) between 2 and 200),
  vendedora_cnpj text check (vendedora_cnpj ~ '^\d{14}$' and public.cnpj_valido(vendedora_cnpj)),
  vendedora_endereco text check (length(btrim(vendedora_endereco)) between 5 and 500),
  prazo_assinatura_dias int check (prazo_assinatura_dias between 1 and 365),
  -- imóveis
  imovel_fotos_max int not null default 20 check (imovel_fotos_max between 1 and 100),                -- ⚑
  imovel_foto_max_bytes int not null default 5242880 check (imovel_foto_max_bytes between 1 and 5242880),
  -- segurança
  exigir_mfa_interno boolean not null default false,                                                   -- H5 ⚑
  sessao_inatividade_horas int not null default 8 check (sessao_inatividade_horas between 1 and 72),   -- H1 ⚑
  retencao_acesso_meses int not null default 24 check (retencao_acesso_meses between 6 and 120),       -- H3 ⚑ (mín. Marco Civil)
  retencao_operacao_meses int not null default 60 check (retencao_operacao_meses between 6 and 240),   -- H3 ⚑
  download_ttl_segundos int not null default 60 check (download_ttl_segundos between 10 and 3600),
  -- carimbo
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null
);
insert into public.configuracao_geral default values;

create function public._configuracao_unica() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'configuracao_geral tem uma linha só e não pode ser excluída' using errcode = '42501';
end $$;
create trigger configuracao_nao_exclui before delete on public.configuracao_geral
  for each row execute function public._configuracao_unica();
create trigger configuracao_nao_trunca before truncate on public.configuracao_geral
  for each statement execute function public._configuracao_unica();
create trigger carimbar before insert or update on public.configuracao_geral
  for each row execute function public.carimbar();

-- ============ AUDITORIA (§5.1): somente inclusão ============
create table public.auditoria (
  id bigint generated always as identity primary key,
  ocorrido_em timestamptz not null default now(),
  categoria public.categoria_auditoria not null,
  acao text not null check (acao ~ '^[a-z][a-z_]{1,39}$'),
  -- consultar, listar, baixar, exportar, criar, editar, excluir, inativar, reativar, transferir, mudar_status, gerar,
  -- enviar_assinatura, assinar, anonimizar, login, acesso_negado, link_gerado, migracao, aprovar, recusar, ...
  entidade text not null check (entidade ~ '^[a-z][a-z0-9_]{1,59}$'),
  entidade_id text check (length(entidade_id) <= 200),
  cliente_id uuid,                     -- titular afetado (LGPD); sem FK, sobrevive à anonimização
  ator_id uuid,                        -- sem FK, idem
  ator_papel public.papel,
  ator_parceiro_id uuid,
  origem text not null default 'rpc'
    check (origem ~ '^(rpc|trigger|cron|hook|migracao|edge:[a-z0-9-]{1,60}|webhook:[a-z0-9-]{1,60})$'),
  campos text[],                       -- NOMES das colunas alteradas; nunca valores pessoais
  antes jsonb,                         -- só campos NÃO pessoais: status, etapa, ids de vínculo, valores de contrato
  depois jsonb,
  detalhe jsonb not null default '{}', -- ids devolvidos, contagens, filtros sem texto livre
  ip inet,
  user_agent text check (length(user_agent) <= 500)
);
create index auditoria_entidade_idx on public.auditoria (entidade, entidade_id, ocorrido_em desc);
create index auditoria_cliente_idx on public.auditoria (cliente_id, ocorrido_em desc) where cliente_id is not null;
create index auditoria_ator_idx on public.auditoria (ator_id, ocorrido_em desc);
create index auditoria_categoria_idx on public.auditoria (categoria, ocorrido_em);

-- Nem o dono passa: UPDATE, DELETE e TRUNCATE falham sempre, exceto o DELETE da purga mensal (H3), que liga
-- localmente arken.purga_auditoria (auditoria_purgar, rodando como postgres pelo pg_cron).
create function public._auditoria_imutavel() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('arken.purga_auditoria', true) = 'on' then
    return old;
  end if;
  raise exception 'Auditoria é somente inclusão' using errcode = '42501';
end $$;
create trigger auditoria_imutavel before update or delete on public.auditoria
  for each row execute function public._auditoria_imutavel();
create trigger auditoria_sem_truncate before truncate on public.auditoria
  for each statement execute function public._auditoria_imutavel();

-- _auditar: registro feito pelas RPCs (e por auditar_linha_gravar). Interna: sem grant a ninguém.
-- Preenche o ator (auth.uid(), papel) e IP/user agent dos cabeçalhos do PostgREST.
-- A 20260929000004 substitui o corpo (mesma assinatura) para preencher também ator_parceiro_id.
create function public._auditar(
  p_categoria public.categoria_auditoria,
  p_acao text,
  p_entidade text,
  p_entidade_id text,
  p_cliente_id uuid default null,
  p_campos text[] default null,
  p_antes jsonb default null,
  p_depois jsonb default null,
  p_detalhe jsonb default '{}',
  p_origem text default 'rpc'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_papel public.papel;
  v_cab jsonb;
  v_ip inet;
  v_ua text;
begin
  if v_uid is not null then
    select pr.papel into v_papel from public.profiles pr where pr.id = v_uid;
  end if;
  begin
    v_cab := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_cab := null;
  end;
  if v_cab is not null then
    begin
      v_ip := nullif(btrim(split_part(coalesce(v_cab ->> 'cf-connecting-ip', v_cab ->> 'x-real-ip',
                                               v_cab ->> 'x-forwarded-for'), ',', 1)), '')::inet;
    exception when others then
      v_ip := null;
    end;
    v_ua := left(v_cab ->> 'user-agent', 500);
  end if;
  insert into public.auditoria (categoria, acao, entidade, entidade_id, cliente_id, ator_id, ator_papel,
                                ator_parceiro_id, origem, campos, antes, depois, detalhe, ip, user_agent)
  values (p_categoria, p_acao, p_entidade, p_entidade_id, p_cliente_id, v_uid, v_papel,
          null, coalesce(p_origem, 'rpc'), p_campos, p_antes, p_depois, coalesce(p_detalhe, '{}'::jsonb), v_ip, v_ua);
end $$;

-- auditar_linha_gravar: ponte entre o gatilho genérico (security invoker) e _auditar. Só funciona dentro de
-- gatilho (pg_trigger_depth() > 0): chamada direta pela API (/rpc) é recusada.
create function public.auditar_linha_gravar(
  p_categoria public.categoria_auditoria,
  p_acao text,
  p_entidade text,
  p_entidade_id text,
  p_cliente_id uuid,
  p_campos text[],
  p_antes jsonb,
  p_depois jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'Uso restrito aos gatilhos de auditoria' using errcode = '42501';
  end if;
  perform public._auditar(p_categoria, p_acao, p_entidade, p_entidade_id, p_cliente_id, p_campos,
                          p_antes, p_depois, '{}'::jsonb, 'trigger');
end $$;

-- auditar_linha(<colunas>, <categoria>, <modo>, <chaves>): gatilho genérico AFTER INSERT/UPDATE/DELETE (§5.2).
--   colunas   lista separada por vírgula das colunas observadas ('*' = todas menos as de carimbo)
--   categoria categoria_auditoria (padrão 'operacao')
--   modo      'nomes' (padrão: grava só os NOMES das colunas) | 'valores' (grava antes/depois; só para tabelas
--             sem dado pessoal, como configuração)
--   chaves    colunas que identificam a linha (padrão 'id'; composta: 'acao,tipo')
-- security invoker de propósito: registra só gravações diretas pela API ou pela service role
-- (current_user <> 'postgres'). Dentro de uma RPC security definer o current_user é postgres e a própria RPC audita.
-- UPDATE sem mudança nas colunas observadas não gera registro.
create function public.auditar_linha() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_colunas text[];
  v_categoria public.categoria_auditoria := 'operacao';
  v_valores boolean := false;
  v_chaves text[] := array['id'];
  v_ignorar constant text[] := array['criado_em', 'criado_por', 'atualizado_em', 'atualizado_por', 'created_at', 'updated_at'];
  v_antigo jsonb;
  v_novo jsonb;
  v_ref jsonb;
  v_campos text[] := '{}';
  v_antes jsonb;
  v_depois jsonb;
  v_col text;
  v_entidade_id text;
  v_cliente uuid;
begin
  if current_user = 'postgres' then
    return null;
  end if;
  if tg_nargs > 0 and btrim(tg_argv[0]) not in ('', '*') then
    v_colunas := string_to_array(replace(tg_argv[0], ' ', ''), ',');
  end if;
  if tg_nargs > 1 and btrim(tg_argv[1]) <> '' then v_categoria := btrim(tg_argv[1])::public.categoria_auditoria; end if;
  if tg_nargs > 2 then v_valores := btrim(tg_argv[2]) = 'valores'; end if;
  if tg_nargs > 3 and btrim(tg_argv[3]) <> '' then v_chaves := string_to_array(replace(tg_argv[3], ' ', ''), ','); end if;

  if tg_op in ('UPDATE', 'DELETE') then v_antigo := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_novo := to_jsonb(new); end if;
  v_ref := coalesce(v_novo, v_antigo);
  if v_colunas is null then
    select coalesce(array_agg(k order by k), '{}') into v_colunas
    from jsonb_object_keys(v_ref) k where k <> all (v_ignorar);
  end if;

  foreach v_col in array v_colunas loop
    continue when not (v_ref ? v_col);
    if tg_op = 'UPDATE' then
      if (v_antigo -> v_col) is distinct from (v_novo -> v_col) then v_campos := v_campos || v_col; end if;
    elsif jsonb_typeof(v_ref -> v_col) <> 'null' then
      v_campos := v_campos || v_col;
    end if;
  end loop;
  if tg_op = 'UPDATE' and cardinality(v_campos) = 0 then
    return null;
  end if;

  if v_valores and cardinality(v_campos) > 0 then
    if v_antigo is not null then select jsonb_object_agg(c, v_antigo -> c) into v_antes from unnest(v_campos) c; end if;
    if v_novo is not null then select jsonb_object_agg(c, v_novo -> c) into v_depois from unnest(v_campos) c; end if;
  end if;

  select string_agg(coalesce(v_ref ->> k, ''), ':' order by o) into v_entidade_id
  from unnest(v_chaves) with ordinality u(k, o);
  if tg_table_name = 'clientes' then
    v_cliente := (v_ref ->> 'id')::uuid;
  elsif v_ref ? 'cliente_id' then
    v_cliente := (v_ref ->> 'cliente_id')::uuid;
  end if;

  perform public.auditar_linha_gravar(
    v_categoria,
    case tg_op when 'INSERT' then 'criar' when 'UPDATE' then 'editar' else 'excluir' end,
    tg_table_name, v_entidade_id, v_cliente, v_campos, v_antes, v_depois);
  return null;
end $$;

create trigger auditar_linha after update on public.configuracao_geral
  for each row execute function public.auditar_linha('*', 'configuracao', 'valores', 'id');

-- ============ HISTÓRICO DE STATUS (§3.8): somente inclusão, sem dado pessoal ============
create table public.historico_status (
  id bigint generated always as identity primary key,
  entidade text not null check (entidade in ('cliente_etapa', 'documento', 'contrato', 'imovel')),
  entidade_id uuid not null,
  de text,
  para text not null,
  motivo text check (length(motivo) <= 2000),
  origem text not null default 'usuario' check (origem in ('usuario', 'sistema', 'webhook', 'migracao')),
  ator_id uuid,                        -- sem FK: sobrevive à remoção do usuário do portal
  ocorrido_em timestamptz not null default now()
);
create index historico_status_entidade_idx on public.historico_status (entidade, entidade_id, ocorrido_em desc);
create trigger somente_inclusao before update or delete on public.historico_status
  for each row execute function public._somente_inclusao();

-- ============ EVENTOS DE DOMÍNIO (§3.11) ============
create table public.eventos_dominio (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),   -- ex.: contrato.assinado
  entidade_id uuid,
  dados jsonb not null default '{}',
  ocorrido_em timestamptz not null default now()
);
create index eventos_dominio_tipo_idx on public.eventos_dominio (tipo, id);
create trigger somente_inclusao before update or delete on public.eventos_dominio
  for each row execute function public._somente_inclusao();

create table public.eventos_consumo (
  consumidor text not null check (consumidor ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)*$'),  -- ex.: financeiro.gerar_parcelas
  evento_id bigint not null references public.eventos_dominio(id),
  processado_em timestamptz not null default now(),
  resultado text,
  primary key (consumidor, evento_id)
);
create index eventos_consumo_evento_idx on public.eventos_consumo (evento_id);

-- ============ NOTIFICAÇÕES (§3.9, N10) ============
create table public.notificacoes_config (
  tipo text primary key check (tipo ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  ativo boolean not null default false,
  descricao text not null check (length(btrim(descricao)) between 3 and 300),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null
);
insert into public.notificacoes_config (tipo, ativo, descricao) values
  ('crm.boas_vindas',          true,  'Boas-vindas ao cliente que fez o pré-cadastro pelo link do corretor'),
  ('crm.documento_rejeitado',  true,  'Aviso de documento rejeitado, com o motivo'),
  ('crm.documento_solicitado', false, 'Aviso de documento solicitado ao cliente'),
  ('crm.novo_lead_corretor',   false, 'Aviso ao corretor de cliente novo na carteira'),
  ('contratos.enviado',        false, 'Aviso de contrato enviado para assinatura'),
  ('contratos.assinado',       false, 'Aviso de contrato assinado por todos'),
  ('rede.transferencia',       false, 'Aviso de transferência de cliente ou corretor');
create trigger carimbar before insert or update on public.notificacoes_config
  for each row execute function public.carimbar();
create trigger auditar_linha after insert or update or delete on public.notificacoes_config
  for each row execute function public.auditar_linha('ativo,descricao', 'configuracao', 'valores', 'tipo');

-- fila de saída: só ids (nunca e-mails nem dados pessoais); o envio reaproveita notificar_evento() (pg_net + Vault)
create table public.notificacoes (
  id bigint generated always as identity primary key,
  tipo text not null references public.notificacoes_config(tipo),
  destinatarios_ids uuid[] not null default '{}',
  cliente_id uuid references public.clientes(id) on delete set null,
  dados jsonb not null default '{}',
  status public.status_notificacao not null default 'pendente',
  tentativas int not null default 0 check (tentativas >= 0),
  ultimo_erro text check (length(ultimo_erro) <= 2000),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  check (status <> 'enviado' or enviado_em is not null)
);
create index notificacoes_fila_idx on public.notificacoes (criado_em) where status in ('pendente', 'erro');
create index notificacoes_tipo_idx on public.notificacoes (tipo);
create index notificacoes_cliente_idx on public.notificacoes (cliente_id) where cliente_id is not null;
-- durante o corte (arken.migracao = 'on') nada é disparado
create trigger notificacoes_enviar after insert on public.notificacoes
  for each row when (new.status = 'pendente' and coalesce(current_setting('arken.migracao', true), '') <> 'on')
  execute function public.notificar_evento();

-- ============ INTEGRAÇÕES (§3.9) ============
create table public.integracao_eventos (
  id bigint generated always as identity primary key,
  provedor text not null check (provedor in ('d4sign', 'asaas')),
  chave_idempotencia text not null check (length(chave_idempotencia) between 1 and 300),
  tipo text check (length(tipo) <= 100),
  documento_ref text check (length(documento_ref) <= 200),
  payload jsonb not null default '{}',   -- sem tokens
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  resultado text check (length(resultado) <= 200),
  erro text check (length(erro) <= 2000),
  unique (provedor, chave_idempotencia)
);
create index integracao_eventos_pendentes_idx on public.integracao_eventos (recebido_em) where processado_em is null;
create index integracao_eventos_documento_idx on public.integracao_eventos (provedor, documento_ref);

-- nunca guarda a URL (o D4Sign leva token e chave na query string)
create table public.integracao_chamadas (
  id bigint generated always as identity primary key,
  provedor text not null check (provedor ~ '^[a-z0-9_]{2,30}$'),
  operacao text not null check (length(operacao) between 1 and 100),
  entidade text check (length(entidade) <= 60),
  entidade_id uuid,
  http_status int,
  duracao_ms int check (duracao_ms >= 0),
  erro text check (length(erro) <= 2000),
  criado_em timestamptz not null default now()
);
create index integracao_chamadas_criado_idx on public.integracao_chamadas (criado_em);
create index integracao_chamadas_entidade_idx on public.integracao_chamadas (entidade, entidade_id);
create trigger somente_inclusao before update or delete on public.integracao_chamadas
  for each row when (current_setting('arken.purga_auditoria', true) is distinct from 'on')
  execute function public._somente_inclusao();

-- limite por IP das rotas públicas (pré-cadastro); portal_acessos continua como está
create table public.tentativas_publicas (
  id bigint generated always as identity primary key,
  rota text not null check (rota ~ '^[a-z0-9_-]{1,60}$'),
  ip inet,
  sucesso boolean not null,
  criado_em timestamptz not null default now()
);
create index tentativas_publicas_ip_idx on public.tentativas_publicas (rota, ip, criado_em desc);
create index tentativas_publicas_criado_idx on public.tentativas_publicas (criado_em);

-- autorização de download de curta duração (§4.3): criada só pelas RPCs que conferem escopo e auditam
create table public.download_autorizacoes (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null check (bucket in ('crm-documentos', 'contratos')),
  path text not null check (length(path) between 3 and 500),
  expira_em timestamptz not null,
  criado_em timestamptz not null default now(),
  check (expira_em > criado_em)
);
create index download_autorizacoes_busca_idx on public.download_autorizacoes (profile_id, bucket, path, expira_em);
create index download_autorizacoes_expira_idx on public.download_autorizacoes (expira_em);

-- ============ LGPD (§5.4, H4) ============
create table public.lgpd_termos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('consentimento_cliente', 'termos_parceiro')),
  versao text not null check (length(btrim(versao)) between 1 and 40),
  texto text not null check (length(btrim(texto)) >= 20),
  vigente_desde timestamptz not null default now(),
  revisado_juridico boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  unique (tipo, versao)
);
create index lgpd_termos_vigente_idx on public.lgpd_termos (tipo, vigente_desde desc);
create trigger carimbar before insert or update on public.lgpd_termos
  for each row execute function public.carimbar();
create trigger somente_inclusao before update or delete on public.lgpd_termos
  for each row execute function public._somente_inclusao();
create trigger auditar_linha after insert on public.lgpd_termos
  for each row execute function public.auditar_linha('tipo,versao,vigente_desde,revisado_juridico', 'lgpd', 'valores', 'id');

-- vigente = maior vigente_desde já iniciado, por tipo. Interna (as RPCs lgpd_* e handle_new_user usam).
create function public._termo_vigente_id(p_tipo text) returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.lgpd_termos t
  where t.tipo = p_tipo and t.vigente_desde <= now()
  order by t.vigente_desde desc, t.criado_em desc, t.id
  limit 1
$$;

-- Versão provisória (H4 ⚑): texto atual das páginas públicas, revisado_juridico = false. O pré-cadastro público
-- não vai ao ar sem uma versão revisada. Cliente: política de privacidade. Parceiro: termos de uso + política de
-- privacidade (é o que o cadastro de parceiro pede para aceitar hoje).
insert into public.lgpd_termos (tipo, versao, texto, revisado_juridico) values
  ('consentimento_cliente', '0-provisória', $termo$1. OBJETIVO

A ARKEN INCORPORADORA LTDA é um Grupo Imobiliário fundado em 1989 com atuação no mercado brasileiro há quase duas décadas. Uma empresa de origem europeia que já realizou inúmeros empreendimentos imobiliários no setor da construção civil (comercial, residencial e industrial) em Madrid, capital espanhola, bem como na cidade de São Paulo.

Nesse sentido, a presente Política de Privacidade visa descrever como as informações e dados pessoais serão coletados, usados, compartilhados e armazenados a partir do seu acesso e/ou cadastro em nosso site, pois nosso objetivo é agir de acordo com os interesses de nossos clientes e ser transparente sobre o processamento de dados pessoais, seguindo os termos das leis aplicáveis, em especial a Lei n.º 13.709/2018 (“Lei Geral de Proteção de Dados Pessoais”).

Este documento foi redigido de forma simples e acessível, contando com exemplos de coleta e de uso dos dados, para que o titular de dados compreenda facilmente a forma como os seus dados são utilizados, com o objetivo de oferecer uma experiência segura e confortável.

Esta Política de Privacidade se aplica a qualquer tipo de informação coletada através da nossa plataforma ou outros meios conectados a estas plataformas (como, por exemplo, entrar em contato com nossa equipe ou acessar nossas redes sociais).

Essa Política de Privacidade pode ser alterada. Se você se importa com sua privacidade, visite a nossa página regularmente para ficar atualizado. Se as alterações da Política de Privacidade afetarem você (por exemplo, se nós quisermos processar seus dados pessoais para fins que não foram expressos anteriormente nesta Política de Privacidade), iremos notificar você dessas alterações antes de dar início às novas atividades.

Se Você não estiver de acordo com essa Política de Privacidade ou deseja obter maiores esclarecimentos, pedimos a gentileza de entrar em contato conosco através dos canais disponibilizados em nosso site.

2. SOBRE OS DADOS QUE COLETAMOS

A ARKEN INCORPORADORA LTDA coleta dados para atender as solicitações de seus clientes.

Isso significa que podemos solicitar nome completo, CPF, endereço, e-mail, telefone, nacionalidade, informações de renda do cliente, de seus cônjuges, familiares e tudo o mais que seja necessário para a correta condução dos trabalhos.

Incluem-se nos dados que coletamos, eventuais dados pessoais sensíveis, conforme descrito na Lei Geral de Proteção de Dados, desde que estritamente necessários para a condução dos trabalhos contratados.

Além disso, quando ocorre a visita de qualquer pessoa em nosso site ou nossas redes sociais, dados como endereço de IP, localização geográfica, Dispositivo, Versão, Registro de data e horário de ações e telas acessadas são coletados para identificarmos melhor os interesses dos visitantes.

3. SOBRE O QUE FAZEMOS COM OS DADOS COLETADOS

Os dados coletados são para garantir a prestação dos serviços, haja vista que eles dependem diretamente das informações recebidas por nossos clientes para concretização. Caso você opte por não fornecer alguns desses dados, podemos ficar impossibilitados de prestar total ou parcialmente nossos serviços à você.

Além disso, os dados pessoais podem ser utilizados para:

Oferecer conteúdo relevante divulgado pela ARKEN INCORPORADORA LTDA, tais como newsletters, convites para eventos, lembretes, notas de agradecimento, comunicados, entre outros;

Para composição de banco de dados de fornecedores e prestadores de serviços da ARKEN INCORPORADORA LTDA;

Para formação de banco de dados de candidatos a vagas em nosso quadro de sócios de serviço, estágios e demais prestadores de serviços;

Para o cumprimento de legislação aplicável;

Para proteção dos interesses da ARKEN INCORPORADORA LTDA;

Para o cumprimento de qualquer demanda solicitada por nossos clientes ou não a ARKEN INCORPORADORA LTDA.

A ARKEN INCORPORADORA LTDA se compromete a solicitar apenas os dados estritamente necessários para o atendimento e prestação dos serviços.

4. BASE DE DADOS

A base de dados formada por meio da coleta de dados é de nossa propriedade e está sob nossa responsabilidade, sendo que seu uso, acesso e compartilhamento, quando necessários, serão feitos dentro dos limites e propósitos dos negócios descritos nesta Política.

5. PERÍODO DE ARMAZENAMENTO DE DADOS

A ARKEN INCORPORADORA LTDA poderá armazenar dados pessoais pelo tempo necessário ao cumprimento dos serviços e demais finalidades mencionadas nesta Política de Privacidade.

Você poderá solicitar o descadastramento de seus dados, entretanto, ressaltamos que isso pode afetar os serviços prestados, haja vista que eles dependem necessariamente de tais informações.

6. COMPARTILHAMENTO DE DADOS

A ARKEN INCORPORADORA LTDA LTDA em hipótese alguma comercializará dados pessoais. Apesar disso, podemos compartilhar seus dados com terceiros com o objetivo de garantir a prestação de serviços ou as demais finalidades aqui mencionadas, sempre de acordo com a legislação aplicável.

Os Dados coletados e as atividades registradas podem ser compartilhados:

(i) Com nosso parceiro que gerencia nossos procedimentos de seleção e recrutamento através do item “Trabalhe Conosco”, disponibilizado para cadastro de currículos caso Você tenha interesse em participar da nossa equipe;

(ii) Com autoridades judiciais, administrativas ou governamentais competentes, sempre que houver determinação legal, requerimento, requisição ou ordem judicial; e

(iii) De forma automática, em caso de movimentações societárias, como fusão, cisão, aquisição e incorporação;

A ARKEN INCORPORADORA LTDA se compromete a compartilhar apenas os dados que se fizerem necessários ao cumprimento das respectivas finalidades.

7. QUAIS SÃO OS DIREITOS DOS TITULARES DE DADOS?

O titular do dado pessoal sempre poderá optar em não divulgar seus dados para a ARKEN INCORPORADORA LTDA mas deve ter em mente que alguns desses dados podem ser necessários para a prestação dos serviços. Independentemente disso, o titular dos dados sempre possuirá direitos relativos a privacidade e a proteção dos seus dados pessoais, e a ARKEN INCORPORADORA LTDA além de se preocupar com a segurança desses dados, também se preocupa que seus clientes tenham acesso e conhecimento de todos os direitos relativos aos dados pessoais.

Dessa forma, indicamos a seguir todos os direitos que o titular de dados tem relativos a proteção de dados (“LGPD” – Lei Geral de Proteção de Dados):

(i) Acesso – o direito de ser informado e ter acesso aos seus dados pessoais sob nosso tratamento

(ii) Correção – o direito de solicitar a atualização ou alteração dos seus dados pessoais desatualizados, incompletos ou incorretos

(iii) Portabilidade – o direito de requerer que os dados pessoais sob nosso tratamento sejam transferidos a outro prestador de serviço indicado por Você

(iv) Eliminação – o direito de ter seus dados pessoais eliminados das nossas bases de dados, ressalvadas as hipóteses legais de armazenamento

(v) Anonimização ou bloqueio – o direito de solicitar que os dados pessoais excessivos ao tratamento sejam submetidos à anonimização ou que este tratamento excessivo seja suspenso por nós

(vi) Revogação – o direito de revogar o seu consentimento para as finalidades de tratamento de dados pessoais a ele atreladas

(vii) Informação sobre as consequências da revogação – o direito de ser informado sobre os desdobramentos da relação conosco e execução de determinada finalidade tratamento caso Você deseje revogar o seu consentimento

(viii) Oposição – o direito de Você se opor ao tratamento de dados pessoais que esteja desalinhado às determinações da Lei Geral de Proteção de Dados Pessoais

!   Você também poderá enviar pedidos ou reclamações relativas ao tratamento dos seus dados pessoais à Autoridade Nacional de Proteção de Dados.

8. SEGURANÇA

Manter a segurança dos titulares de dados e de suas informações pessoais é muito importante para a ARKEN INCORPORADORA LTDA. Em razão disso, algumas medidas razoáveis para tentar proteger as informações pessoais que você fornece de acessos não autorizados e do mau uso de dados pessoais.

Assim, observamos os padrões de segurança necessários à prevenção e remediação do acesso desautorizado de dados pessoais, empregando os meios aplicáveis e padrões de segurança recomendados para protegê-los, na medida em que forem técnica e operacionalmente viáveis.

9. LINKS EXTERNOS

A ARKEN INCORPORADORA LTDA pode oferecer links para redirecionamento a websites de terceiros com a finalidade de prestar serviços ou melhor sua experiência com nosso escritório.

Entretanto, esclarecemos que a ARKEN INCORPORADORA LTDA não detém qualquer responsabilidade pela navegação em web sites externos, mesmo quando referenciados pela ARKEN INCORPORADORA LTDA, cujos conteúdos e políticas de privacidade não são de sua responsabilidade.

Assim, recomendamos que, ao serem redirecionados para sites externos, os usuários consultem sempre as respectivas políticas de privacidade antes de fornecerem seus dados ou informações.

10. COMO VOCÊ PODE ENTRAR EM CONTATO CONOSCO?

Em caso de qualquer dúvida em relação a esta Política ou solicitações para o cumprimento de seus direitos, Você ou seu responsável legal poderá entrar em contato diretamente pelos canais abaixo:

atendimento@doiscontinentes.com.br – (11) 93803-7732

11. MUDANÇAS NA POLÍTICA DE PRIVACIDADE

Como estamos sempre buscando melhorar nossos serviços, essa Política de Privacidade pode passar por atualizações. Desta forma, recomendamos visitar periodicamente esta página para que tenha conhecimento sobre as modificações. Caso sejam feitas alterações iremos publicar essa atualização e solicitar um novo consentimento.$termo$, false),
  ('termos_parceiro', '0-provisória', $termo$TERMOS DE USO

A ARKEN INCORPORADORA LTDA pode oferecer links para redirecionamento a websites de terceiros com a finalidade de prestar serviços ou melhor sua experiência com nosso escritório.

Nesse sentido, o presente Termos de Uso e Condições visa descrever como nosso site funciona, pois nosso objetivo é agir de acordo com os interesses de nossos clientes e ser transparente sobre o processamento de dados pessoais, seguindo os termos das leis aplicáveis, em especial a Lei n.º 13.709/2018 (“Lei Geral de Proteção de Dados Pessoais”).

Quando você acessa nosso site, está confiando a ARKEN INCORPORADORA LTDA suas informações. Entendemos que isso é uma grande responsabilidade e trabalhamos para proteger suas informações e manter você no controle delas.

Assim, as regras do presente Termos de Uso e Condições visam descrever como será realizada a navegação e uso do site pelo usuário que acessar o link: https://doiscontinentes.com.br/

1. ACEITAÇÃO.

Bem-vindo ao site https://doiscontinentes.com.br/ O presente documento estabelece os Termos de Uso e Condições aplicáveis ao site acima descrito.

Por favor, revise os termos cuidadosamente antes de utilizar o site, pois ao nos contatar, acessar, navegar ou utilizar esse site, todos os usuários e visitantes declaram estar cientes com das regras do presente Termos de Uso e Condições.

Caso você não concorde com esses Termos, por favor não use ou acesse o conteúdo disponível.

A ARKEN INCORPORADORA LTDA reserva o direito de atualizar os Termos de Uso e Condições periodicamente, a seu exclusivo critério.

2. FUNÇÕES DO WHATSAPP E DO SITE.

As ferramentas permitem que o usuário realize o cadastro para solicitar informações sobre produtos e/ou revendedores, pedidos e compras.

A ARKEN INCORPORADORA LTDA visa assegurar que as ferramentas sejam mais úteis e eficientes para os seus usuários. Portanto, se reserva ao direito de fazer alterações no Site ou nos serviços oferecidos a qualquer momento e por qualquer motivo em que entender necessário para manutenção da qualidade das informações e serviços prestados.

É possível que ocorram ocasiões em que os serviços disponibilizados pelo Site sejam interrompidos sem aviso prévio para manutenções, upgrades ou reparos de emergência. A ARKEN INCORPORADORA LTDA reserva o direito de excluir qualquer conteúdo ou mesmo o Site, por qualquer motivo, sem aviso prévio.

3. CADASTRO.

As ferramentas estão disponíveis apenas para pessoas físicas e jurídicas que desejem receber nossos conteúdos e/ou contratar algum de nossos Serviços.

Para que o usuário acesse o conteúdo do Site, bem como obtenha maiores informações sobre nossos conteúdos e /ou serviços, é necessária a realização de cadastro mediante o fornecimento de alguns dados cadastrais, tais como nome, cadastro de e-mail e telefone.

O usuário se responsabiliza pela precisão e veracidade dos dados informados e reconhece que a inconsistência poderá implicar na impossibilidade de realizar o cadastro e/ou efetivar pedidos e compras.

A ARKEN INCORPORADORA LTDA se reserva ao direito de prestar informações com a única finalidade de informar sobre seus conteúdos e serviços, bem como utilizar os dados cadastrais para efetuar estudos e/ou relatórios acerca dos usuários, seja pelas informações obtidas pelo WhatsApp ou pelo Site, sem, entretanto, divulgar informações dos usuários, pelos quais o usuário desde já concorda expressamente.

4. PROPRIEDADE INTELECTUAL.

Todos os direitos de propriedade intelectual pertencem à ARKEN INCORPORADORA LTDA grande parte do Site é protegida por direitos autorais, marcas, banco de dados e outros direitos de propriedade intelectual. Salvo disposição em contrário, o usuário está autorizado a utilizar o Site apenas para seu uso pessoal, solicitação de cadastros e contatos prévios.

O Site não poderá ser copiado, modificado, adaptado, distribuído, vendido, publicado, licenciado ou de qualquer outra forma transferido, parcial ou totalmente. O usuário não poderá, ainda, desmontar, decompilar, fazer engenharia reversa, quebrar ou tentar quebrar a encriptação que protege as configurações do Site, sob qualquer pretexto e/ou hipótese.

Todos os códigos de texto, informações, dados, fotografias, gráficos, softwares, áudio, vídeo, marcas logotipos, anúncios e tudo o mais o que apareça neste Site pertencem exclusivamente a ARKEN INCORPORADORA LTDA.

5. USO DO SITE.

A ARKEN INCORPORADORA LTDA não se responsabiliza por qualquer perda ou dano direto, indireto e/ou incidental causado pela má utilização do Site, seu uso ou impossibilidade de uso. Isso inclui perda de dados ou danos causado por uso inadequado do usuário. Da mesma forma, a ARKEN INCORPORADORA LTDA não se responsabiliza por qualquer vírus que possa vir a atacar o dispositivo do usuário em decorrência do acesso, utilização ou navegação na internet ou como consequência da transferência de dados, arquivos, imagens, textos ou áudios.

A ARKEN INCORPORADORA LTDA, possui serviço para dúvidas e consultas em relação ao uso do Site, através do canal de contato, disponível no link: https://doiscontinentes.com.br/

O uso completo do Site depende de conexão com a internet. A conexão deve ser via cabo de rede, Wi-Fi ou através da rede do provedor de serviço de dados móveis, mas a ARKEN INCORPORADORA LTDA não é responsável pelo mau funcionamento do Site, bem como caso o dispositivo não tenha conexão Wi-Fi ou excedeu o uso de dados limite.

Ressaltamos que se o uso do Site for realizado fora de uma área com Wi-Fi, o provedor de serviços de rede móvel pode aplicar os termos do contrato, no tocante à aplicação de tarifas de dados, roaming de dados para uso do Site fora do território de origem e outros encargos, pelos quais a ARKEN INCORPORADORA LTDA não se responsabiliza.

O usuário, neste ato, renuncia todas as reinvindicações, demandas, atribuições de responsabilidades, causa legal, ação judicial, pedido de indenização, entre outros, com relação à este Site.

6. VIOLAÇÕES.

O usuário não poderá praticar as seguintes ações em razão ou por meio da utilização do Site:

i. Qualquer ato ilícito ou violação da legislação vigente;

ii. Atos contrários à moral e aos bons costumes;

iii. Violação de direito de terceiros;

iv. Violação dos direitos de sigilo e privacidade alheios;

v. Atos que causem ou propiciem a contaminação ou prejudiquem quaisquer equipamentos da ARKEN INCORPORADORA LTDA e/ou de terceiros, inclusive por meio de vírus, trojans, malware, worm, bot, backdoor, spyware, tootkit ou por qualquer outros dispositivos que venham a ser criados;

vi. Praticar qualquer ato que, direta ou indiretamente, no todo ou em parte, possam causar prejuízo à ARKEN INCORPORADORA LTDA, qualquer usuário e/ou terceiros;

7. OBRIGAÇÕES DA ARKEN INCORPORADORA LTDA

A ARKEN INCORPORADORA LTDA se obriga com seus internautas e usuários a:

i. Manter o ambiente virtual seguro, salvo por ato destrutivo de terceiro que vá além dos esforços empenhados, hipótese que não se responsabilizará por danos oriundos dessa prática danosa.

ii. Preservar a funcionalidade do site, com links não quebrados, utilizando layout que respeita a usabilidade e navegabilidade, facilitando a navegação sempre que possível.

iii. Exibir as funcionalidades de maneira clara, completa, precisa e suficiente de modo que exista a exata percepção das operações realizadas.

8. OBRIGAÇÕES DO INTERNAUTA E USUÁRIO.

Os internautas e usuários se obrigam a:

i. Realizar à navegação com retidão ética, sempre respeitando as condições que regem a utilização do Portal.

ii. Cuidar do sigilo e segurança dos seus dados, pois estas informações permitem o seu cadastro e devem ser verdadeiras pois determinam a sua identidade digital, imputando-lhe a autoria de todos os atos praticados em seu nome, ainda que seja por terceiro que tenha conhecimento desses dados.

iii. Todo usuário que fornecer dados a DOIS CONTINENTES CONSTRUTORA E INCORPORADORA se obriga a manter seus dados cadastrais sempre atualizados, sob pena de responder civil e criminalmente pelos danos decorrentes da imprecisão e inexatidão das informações armazenadas.

iv. Ao fornecer dados e informações ao site ou em cadastros da DOIS CONTINENTES CONSTRUTORA E INCORPORADORA, o internauta e usuário se obrigam a fazê-lo sempre com compromisso de veracidade e autenticidade, sob pena da aplicação das penas da lei, de indenizar a quem causar dano e de ter a conta de acesso do presente Portal excluída.

v. O usuário deve utilizar os recursos do presente Portal para a finalidade que foi constituída, sob pena da aplicação da lei, de indenizar a quem causar dano e de ter a conta de acesso do presente site excluída.

9. CONTEÚDO NÃO APROPRIADO PARA MENORES.

O conteúdo completo ou parcial disponível no Site pode ser inadequado para crianças e/ou menores de determinada idade. Os pais ou tutores devem monitorar o acesso e uso dos menores, pelos quais a DOIS CONTINENTES CONSTRUTORA E INCORPORADORA não tem qualquer responsabilidade.

10. VERSÕES E SISTEMA OPERACIONAL.

O Site será regularmente atualizado e tais atualizações podem fazer com que o Site deixe de ser compatível com o navegador utilizado. A DOIS CONTINENTES CONSTRUTORA E INCORPORADORA não garante que as atualizações necessárias serão compatíveis com o navegador instalado no seu dispositivo.

11. DISPOSIÇÕES GERAIS.

A tolerância quanto ao eventual descumprimento de quaisquer das disposições destes termos e condições por qualquer usuário não constituirá renúncia ao direito de exigir o cumprimento da obrigação, nem perdão, nem alteração do que consta aqui previsto.

Todos os itens destes termos e condições são regidos pelas leis vigentes na República Federativa do Brasil, independentemente dos conflitos dessas leis com leis de outros estados ou países, sendo competente o Foro da Comarca de São Paulo, para dirimir qualquer dúvida decorrente deste instrumento.

A utilização e acesso, deste Site significa que o usuário leu e está ciente de todos estes termos e condições.

O usuário deve parar de utilizar este Site imediatamente se não concordar ou aceitar a integralidade destes termos e condições.

Última atualização dos termos e condições: [Abril/2024]

POLÍTICA DE PRIVACIDADE

1. OBJETIVO

A ARKEN INCORPORADORA LTDA é um Grupo Imobiliário fundado em 1989 com atuação no mercado brasileiro há quase duas décadas. Uma empresa de origem europeia que já realizou inúmeros empreendimentos imobiliários no setor da construção civil (comercial, residencial e industrial) em Madrid, capital espanhola, bem como na cidade de São Paulo.

Nesse sentido, a presente Política de Privacidade visa descrever como as informações e dados pessoais serão coletados, usados, compartilhados e armazenados a partir do seu acesso e/ou cadastro em nosso site, pois nosso objetivo é agir de acordo com os interesses de nossos clientes e ser transparente sobre o processamento de dados pessoais, seguindo os termos das leis aplicáveis, em especial a Lei n.º 13.709/2018 (“Lei Geral de Proteção de Dados Pessoais”).

Este documento foi redigido de forma simples e acessível, contando com exemplos de coleta e de uso dos dados, para que o titular de dados compreenda facilmente a forma como os seus dados são utilizados, com o objetivo de oferecer uma experiência segura e confortável.

Esta Política de Privacidade se aplica a qualquer tipo de informação coletada através da nossa plataforma ou outros meios conectados a estas plataformas (como, por exemplo, entrar em contato com nossa equipe ou acessar nossas redes sociais).

Essa Política de Privacidade pode ser alterada. Se você se importa com sua privacidade, visite a nossa página regularmente para ficar atualizado. Se as alterações da Política de Privacidade afetarem você (por exemplo, se nós quisermos processar seus dados pessoais para fins que não foram expressos anteriormente nesta Política de Privacidade), iremos notificar você dessas alterações antes de dar início às novas atividades.

Se Você não estiver de acordo com essa Política de Privacidade ou deseja obter maiores esclarecimentos, pedimos a gentileza de entrar em contato conosco através dos canais disponibilizados em nosso site.

2. SOBRE OS DADOS QUE COLETAMOS

A ARKEN INCORPORADORA LTDA coleta dados para atender as solicitações de seus clientes.

Isso significa que podemos solicitar nome completo, CPF, endereço, e-mail, telefone, nacionalidade, informações de renda do cliente, de seus cônjuges, familiares e tudo o mais que seja necessário para a correta condução dos trabalhos.

Incluem-se nos dados que coletamos, eventuais dados pessoais sensíveis, conforme descrito na Lei Geral de Proteção de Dados, desde que estritamente necessários para a condução dos trabalhos contratados.

Além disso, quando ocorre a visita de qualquer pessoa em nosso site ou nossas redes sociais, dados como endereço de IP, localização geográfica, Dispositivo, Versão, Registro de data e horário de ações e telas acessadas são coletados para identificarmos melhor os interesses dos visitantes.

3. SOBRE O QUE FAZEMOS COM OS DADOS COLETADOS

Os dados coletados são para garantir a prestação dos serviços, haja vista que eles dependem diretamente das informações recebidas por nossos clientes para concretização. Caso você opte por não fornecer alguns desses dados, podemos ficar impossibilitados de prestar total ou parcialmente nossos serviços à você.

Além disso, os dados pessoais podem ser utilizados para:

Oferecer conteúdo relevante divulgado pela ARKEN INCORPORADORA LTDA, tais como newsletters, convites para eventos, lembretes, notas de agradecimento, comunicados, entre outros;

Para composição de banco de dados de fornecedores e prestadores de serviços da ARKEN INCORPORADORA LTDA;

Para formação de banco de dados de candidatos a vagas em nosso quadro de sócios de serviço, estágios e demais prestadores de serviços;

Para o cumprimento de legislação aplicável;

Para proteção dos interesses da ARKEN INCORPORADORA LTDA;

Para o cumprimento de qualquer demanda solicitada por nossos clientes ou não a ARKEN INCORPORADORA LTDA.

A ARKEN INCORPORADORA LTDA se compromete a solicitar apenas os dados estritamente necessários para o atendimento e prestação dos serviços.

4. BASE DE DADOS

A base de dados formada por meio da coleta de dados é de nossa propriedade e está sob nossa responsabilidade, sendo que seu uso, acesso e compartilhamento, quando necessários, serão feitos dentro dos limites e propósitos dos negócios descritos nesta Política.

5. PERÍODO DE ARMAZENAMENTO DE DADOS

A ARKEN INCORPORADORA LTDA poderá armazenar dados pessoais pelo tempo necessário ao cumprimento dos serviços e demais finalidades mencionadas nesta Política de Privacidade.

Você poderá solicitar o descadastramento de seus dados, entretanto, ressaltamos que isso pode afetar os serviços prestados, haja vista que eles dependem necessariamente de tais informações.

6. COMPARTILHAMENTO DE DADOS

A ARKEN INCORPORADORA LTDA LTDA em hipótese alguma comercializará dados pessoais. Apesar disso, podemos compartilhar seus dados com terceiros com o objetivo de garantir a prestação de serviços ou as demais finalidades aqui mencionadas, sempre de acordo com a legislação aplicável.

Os Dados coletados e as atividades registradas podem ser compartilhados:

(i) Com nosso parceiro que gerencia nossos procedimentos de seleção e recrutamento através do item “Trabalhe Conosco”, disponibilizado para cadastro de currículos caso Você tenha interesse em participar da nossa equipe;

(ii) Com autoridades judiciais, administrativas ou governamentais competentes, sempre que houver determinação legal, requerimento, requisição ou ordem judicial; e

(iii) De forma automática, em caso de movimentações societárias, como fusão, cisão, aquisição e incorporação;

A ARKEN INCORPORADORA LTDA se compromete a compartilhar apenas os dados que se fizerem necessários ao cumprimento das respectivas finalidades.

7. QUAIS SÃO OS DIREITOS DOS TITULARES DE DADOS?

O titular do dado pessoal sempre poderá optar em não divulgar seus dados para a ARKEN INCORPORADORA LTDA mas deve ter em mente que alguns desses dados podem ser necessários para a prestação dos serviços. Independentemente disso, o titular dos dados sempre possuirá direitos relativos a privacidade e a proteção dos seus dados pessoais, e a ARKEN INCORPORADORA LTDA além de se preocupar com a segurança desses dados, também se preocupa que seus clientes tenham acesso e conhecimento de todos os direitos relativos aos dados pessoais.

Dessa forma, indicamos a seguir todos os direitos que o titular de dados tem relativos a proteção de dados (“LGPD” – Lei Geral de Proteção de Dados):

(i) Acesso – o direito de ser informado e ter acesso aos seus dados pessoais sob nosso tratamento

(ii) Correção – o direito de solicitar a atualização ou alteração dos seus dados pessoais desatualizados, incompletos ou incorretos

(iii) Portabilidade – o direito de requerer que os dados pessoais sob nosso tratamento sejam transferidos a outro prestador de serviço indicado por Você

(iv) Eliminação – o direito de ter seus dados pessoais eliminados das nossas bases de dados, ressalvadas as hipóteses legais de armazenamento

(v) Anonimização ou bloqueio – o direito de solicitar que os dados pessoais excessivos ao tratamento sejam submetidos à anonimização ou que este tratamento excessivo seja suspenso por nós

(vi) Revogação – o direito de revogar o seu consentimento para as finalidades de tratamento de dados pessoais a ele atreladas

(vii) Informação sobre as consequências da revogação – o direito de ser informado sobre os desdobramentos da relação conosco e execução de determinada finalidade tratamento caso Você deseje revogar o seu consentimento

(viii) Oposição – o direito de Você se opor ao tratamento de dados pessoais que esteja desalinhado às determinações da Lei Geral de Proteção de Dados Pessoais

!   Você também poderá enviar pedidos ou reclamações relativas ao tratamento dos seus dados pessoais à Autoridade Nacional de Proteção de Dados.

8. SEGURANÇA

Manter a segurança dos titulares de dados e de suas informações pessoais é muito importante para a ARKEN INCORPORADORA LTDA. Em razão disso, algumas medidas razoáveis para tentar proteger as informações pessoais que você fornece de acessos não autorizados e do mau uso de dados pessoais.

Assim, observamos os padrões de segurança necessários à prevenção e remediação do acesso desautorizado de dados pessoais, empregando os meios aplicáveis e padrões de segurança recomendados para protegê-los, na medida em que forem técnica e operacionalmente viáveis.

9. LINKS EXTERNOS

A ARKEN INCORPORADORA LTDA pode oferecer links para redirecionamento a websites de terceiros com a finalidade de prestar serviços ou melhor sua experiência com nosso escritório.

Entretanto, esclarecemos que a ARKEN INCORPORADORA LTDA não detém qualquer responsabilidade pela navegação em web sites externos, mesmo quando referenciados pela ARKEN INCORPORADORA LTDA, cujos conteúdos e políticas de privacidade não são de sua responsabilidade.

Assim, recomendamos que, ao serem redirecionados para sites externos, os usuários consultem sempre as respectivas políticas de privacidade antes de fornecerem seus dados ou informações.

10. COMO VOCÊ PODE ENTRAR EM CONTATO CONOSCO?

Em caso de qualquer dúvida em relação a esta Política ou solicitações para o cumprimento de seus direitos, Você ou seu responsável legal poderá entrar em contato diretamente pelos canais abaixo:

atendimento@doiscontinentes.com.br – (11) 93803-7732

11. MUDANÇAS NA POLÍTICA DE PRIVACIDADE

Como estamos sempre buscando melhorar nossos serviços, essa Política de Privacidade pode passar por atualizações. Desta forma, recomendamos visitar periodicamente esta página para que tenha conhecimento sobre as modificações. Caso sejam feitas alterações iremos publicar essa atualização e solicitar um novo consentimento.$termo$, false);

create table public.lgpd_consentimentos (
  id uuid primary key default gen_random_uuid(),
  titular text not null check (titular in ('cliente', 'parceiro')),
  cliente_id uuid references public.clientes(id),
  profile_id uuid references public.profiles(id) on delete set null,
  termo_id uuid references public.lgpd_termos(id),
  aceito_em timestamptz not null default now(),
  origem text not null check (origem in ('pre_cadastro_link', 'declarado', 'cadastro_parceiro', 'portal', 'migracao')),
  ip inet,
  user_agent text check (length(user_agent) <= 500),
  registrado_por uuid references public.profiles(id) on delete set null,   -- N12: quem declarou
  revogado_em timestamptz,
  revogado_por uuid references public.profiles(id) on delete set null,
  motivo_revogacao text check (length(motivo_revogacao) <= 2000),
  check (titular <> 'cliente' or cliente_id is not null),
  check (termo_id is not null or origem = 'migracao'),                     -- migrados: sem termo aceito de fato ⚑
  check (revogado_em is not null or (revogado_por is null and motivo_revogacao is null))
);
create index lgpd_consentimentos_cliente_idx on public.lgpd_consentimentos (cliente_id) where cliente_id is not null;
create index lgpd_consentimentos_profile_idx on public.lgpd_consentimentos (profile_id) where profile_id is not null;
create index lgpd_consentimentos_termo_idx on public.lgpd_consentimentos (termo_id);
-- revogar só preenche revogado_* (uma vez); o resto nunca muda
create trigger somente_inclusao before update or delete on public.lgpd_consentimentos
  for each row execute function public._somente_inclusao('revogado_em,revogado_por,motivo_revogacao');

-- ============ PERMISSÕES DA REDE (§3.3, area-parceiros §4) ============
-- Chave = tipo do parceiro (não o papel do perfil). A tabela só liga ou desliga a ação; o que está entre
-- parênteses na matriz é regra fixa dentro das RPCs. Células "não se aplica" não existem.
create table public.permissoes_rede (
  acao text not null check (acao in (
    'cadastrar_gerente', 'cadastrar_corretor', 'cadastrar_cliente', 'editar_subordinado', 'inativar_subordinado',
    'transferir_corretor', 'transferir_cliente', 'gerente_como_corretor', 'convite_por_link', 'criar_contrato',
    'analisar_documento', 'cadastrar_imovel')),
  tipo public.tipo_parceiro not null,
  permitido boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  primary key (acao, tipo),
  check (acao <> 'gerente_como_corretor' or tipo = 'gerente'),   -- A1
  check (acao <> 'convite_por_link' or tipo <> 'corretor')
);
insert into public.permissoes_rede (acao, tipo, permitido) values
  ('cadastrar_gerente',     'imobiliaria', true),  ('cadastrar_gerente',     'gerente', false), ('cadastrar_gerente',     'corretor', false),
  ('cadastrar_corretor',    'imobiliaria', true),  ('cadastrar_corretor',    'gerente', true),  ('cadastrar_corretor',    'corretor', false),
  ('cadastrar_cliente',     'imobiliaria', true),  ('cadastrar_cliente',     'gerente', true),  ('cadastrar_cliente',     'corretor', true),
  ('editar_subordinado',    'imobiliaria', true),  ('editar_subordinado',    'gerente', true),  ('editar_subordinado',    'corretor', false),
  ('inativar_subordinado',  'imobiliaria', true),  ('inativar_subordinado',  'gerente', true),  ('inativar_subordinado',  'corretor', false),
  ('transferir_corretor',   'imobiliaria', true),  ('transferir_corretor',   'gerente', false), ('transferir_corretor',   'corretor', false),
  ('transferir_cliente',    'imobiliaria', true),  ('transferir_cliente',    'gerente', true),  ('transferir_cliente',    'corretor', false),
  ('gerente_como_corretor', 'gerente', true),                                                                       -- A1 ⚑
  ('convite_por_link',      'imobiliaria', false), ('convite_por_link',      'gerente', false),                     -- ⚑
  ('criar_contrato',        'imobiliaria', true),  ('criar_contrato',        'gerente', true),  ('criar_contrato',        'corretor', true),  -- ⚑
  ('analisar_documento',    'imobiliaria', true),  ('analisar_documento',    'gerente', true),  ('analisar_documento',    'corretor', true),  -- F4 ⚑
  ('cadastrar_imovel',      'imobiliaria', true),  ('cadastrar_imovel',      'gerente', true),  ('cadastrar_imovel',      'corretor', true);  -- E4 ⚑
create trigger carimbar before insert or update on public.permissoes_rede
  for each row execute function public.carimbar();
create trigger auditar_linha after insert or update or delete on public.permissoes_rede
  for each row execute function public.auditar_linha('permitido', 'configuracao', 'valores', 'acao,tipo');

-- ============ MIGRAÇÃO DE DADOS (§2.4) ============
-- Decisões do negócio preenchidas pelo runbook antes do corte. Contém CPF: só postgres e service_role.
-- Esvaziada na contração.
create table public.migracao_decisoes (
  tipo text not null check (tipo in ('dono_cpf', 'etapa_cliente_portal')),
  chave text not null check (length(chave) between 1 and 200),
  valor text not null check (length(valor) between 1 and 200),
  decidido_por text check (length(decidido_por) <= 200),
  decidido_em timestamptz not null default now(),
  primary key (tipo, chave)
);

-- fila da tela "Pendências da migração" (internos); detalhe sem dado pessoal
create table public.migracao_pendencias (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo ~ '^[a-z][a-z_]{2,59}$'),   -- cpf_invalido, cpf_conflito_portal, cpf_conflito_parceiros, …
  tabela text not null check (tabela ~ '^[a-z][a-z0-9_]{1,59}$'),   -- tabela de origem do registro pendente
  registro_id uuid not null,
  relacionado_id uuid,                                                -- ex.: o cliente do portal com o mesmo CPF
  detalhe text check (length(detalhe) <= 2000),
  decisao text check (length(decisao) <= 2000),                       -- gravada por migracao_pendencias_resolver
  resolvido_em timestamptz,
  resolvido_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  check (resolvido_em is not null or (resolvido_por is null and decisao is null))
);
create index migracao_pendencias_abertas_idx on public.migracao_pendencias (tipo, criado_em) where resolvido_em is null;

-- ============ RLS: ligada em tudo; políticas para authenticated na 20260929000009 ============
alter table public.configuracao_geral    enable row level security;
alter table public.auditoria             enable row level security;
alter table public.historico_status      enable row level security;
alter table public.eventos_dominio       enable row level security;
alter table public.eventos_consumo       enable row level security;
alter table public.notificacoes_config   enable row level security;
alter table public.notificacoes          enable row level security;
alter table public.integracao_eventos    enable row level security;
alter table public.integracao_chamadas   enable row level security;
alter table public.tentativas_publicas   enable row level security;
alter table public.download_autorizacoes enable row level security;
alter table public.lgpd_termos           enable row level security;
alter table public.lgpd_consentimentos   enable row level security;
alter table public.permissoes_rede       enable row level security;
alter table public.migracao_decisoes     enable row level security;
alter table public.migracao_pendencias   enable row level security;

-- ============ GRANTS (§4.2, §4.3) ============
revoke all on public.configuracao_geral, public.auditoria, public.historico_status, public.eventos_dominio,
  public.eventos_consumo, public.notificacoes_config, public.notificacoes, public.integracao_eventos,
  public.integracao_chamadas, public.tentativas_publicas, public.download_autorizacoes, public.lgpd_termos,
  public.lgpd_consentimentos, public.permissoes_rede, public.migracao_decisoes, public.migracao_pendencias
  from anon, authenticated, service_role;

-- authenticated: só leitura onde a §4.2 diz S (as linhas visíveis dependem das políticas da 09);
-- escrita do Super só nas colunas editáveis (políticas is_super na 09). Configuração geral muda por config_atualizar.
grant select on public.configuracao_geral, public.historico_status, public.notificacoes_config, public.lgpd_termos,
  public.permissoes_rede, public.migracao_pendencias to authenticated;
grant update (ativo) on public.notificacoes_config to authenticated;
grant update (permitido) on public.permissoes_rede to authenticated;

-- service_role: S/I/U/D nas tabelas mutáveis; S/I nas somente inclusão (auditoria inclusive: Edge Functions
-- registram eventos de integração); configuração geral só S/U (linha única)
grant select, update on public.configuracao_geral to service_role;
grant select, insert on public.auditoria, public.historico_status, public.eventos_dominio, public.integracao_chamadas,
  public.tentativas_publicas, public.lgpd_termos, public.lgpd_consentimentos to service_role;
grant select, insert, update, delete on public.eventos_consumo, public.notificacoes_config, public.notificacoes,
  public.integracao_eventos, public.download_autorizacoes, public.permissoes_rede, public.migracao_decisoes,
  public.migracao_pendencias to service_role;

-- ============ FUNÇÕES: nada executável por padrão ============
revoke execute on function public.carimbar(), public._somente_inclusao(), public._configuracao_unica(),
  public._auditoria_imutavel(), public.auditar_linha(), public._termo_vigente_id(text),
  public._auditar(public.categoria_auditoria, text, text, text, uuid, text[], jsonb, jsonb, jsonb, text),
  public.auditar_linha_gravar(public.categoria_auditoria, text, text, text, uuid, text[], jsonb, jsonb)
  from public, anon, authenticated, service_role;
-- chamada pelo gatilho auditar_linha (security invoker) de quem grava pela API; recusa fora de gatilho
grant execute on function public.auditar_linha_gravar(public.categoria_auditoria, text, text, text, uuid, text[], jsonb, jsonb)
  to authenticated, service_role;
