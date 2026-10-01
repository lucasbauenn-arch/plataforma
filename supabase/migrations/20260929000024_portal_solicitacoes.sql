-- Portal do cliente, parte SEM financeiro (decisão do dono, 29/09/2026). Boleto real e parcelas ficam para a etapa
-- financeira; aqui entram:
--   (b) Linha do tempo da compra por negócio (cliente_negocios): marcos Contrato assinado, Obra, Vistoria e Entrega das
--       chaves, com datas previstas e realizadas que a EQUIPE registra (negocio_marcos). "Contrato assinado" sem data
--       registrada usa a data de assinatura do contrato do negócio; "Obra" mostra também o último percentual publicado.
--   (c) Solicitações do titular (portal_solicitacoes): 2ª via de boleto, antecipação de parcelas, agendar vistoria,
--       dúvida sobre o contrato e outro. A equipe vê a lista com status (aberta, em atendimento, concluída) e responde;
--       o titular vê o status e a resposta dos próprios pedidos. Cada pedido novo avisa a equipe (portal.solicitacao).
-- As duas tabelas têm RLS ligada e nenhum grant a anon/authenticated: o titular só lê e grava pelas RPCs portal_*
-- (sempre por _portal_cliente_id(); nunca recebem id de cliente) e a equipe pelas RPCs crm_portal_* (is_admin()).
-- Tudo auditado (_auditar só com nomes de campos). Texto livre (mensagem, resposta, observação) some na anonimização.
-- Nenhuma referência a objeto de migration posterior.

-- ============ TABELAS ============
create table public.negocio_marcos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.cliente_negocios(id) on delete cascade,
  tipo text not null check (tipo in ('contrato_assinado', 'obra', 'vistoria', 'entrega_chaves')),
  data_prevista date,
  data_realizada date,
  observacao text check (length(btrim(observacao)) between 1 and 500),
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  unique (negocio_id, tipo),
  check (data_prevista is not null or data_realizada is not null or observacao is not null)
);
create trigger carimbar before insert or update on public.negocio_marcos
  for each row execute function public.carimbar();

create table public.portal_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  cliente_id uuid not null references public.clientes(id),
  negocio_id uuid references public.cliente_negocios(id) on delete set null,
  tipo text not null check (tipo in ('segunda_via_boleto', 'antecipacao_parcelas', 'agendar_vistoria', 'duvida_contrato',
                                     'outro')),
  mensagem text check (length(btrim(mensagem)) between 1 and 2000),
  status text not null default 'aberta' check (status in ('aberta', 'em_atendimento', 'concluida')),
  resposta text check (length(btrim(resposta)) between 1 and 2000),
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  concluida_em timestamptz,
  check ((status = 'concluida') = (concluida_em is not null)),
  check (status <> 'concluida' or resposta is not null),
  check (tipo <> 'outro' or mensagem is not null)
);
create index portal_solicitacoes_cliente_idx on public.portal_solicitacoes (cliente_id, criado_em desc);
create index portal_solicitacoes_abertas_idx on public.portal_solicitacoes (criado_em) where status <> 'concluida';
create index portal_solicitacoes_negocio_idx on public.portal_solicitacoes (negocio_id) where negocio_id is not null;
create trigger carimbar before insert or update on public.portal_solicitacoes
  for each row execute function public.carimbar();

alter table public.negocio_marcos      enable row level security;
alter table public.portal_solicitacoes enable row level security;
-- sem política: nenhum acesso direto (nem do admin); só as RPCs abaixo (security definer)
revoke all on public.negocio_marcos, public.portal_solicitacoes from anon, authenticated, service_role;
grant select, insert, update, delete on public.negocio_marcos, public.portal_solicitacoes to service_role;

-- aviso à equipe (ligado): só ids na fila, nunca o texto do pedido
insert into public.notificacoes_config (tipo, ativo, descricao) values
  ('portal.solicitacao', true, 'Aviso à equipe Arken de nova solicitação do cliente pelo portal')
on conflict (tipo) do nothing;

-- ============ LGPD: texto livre some na anonimização ============
create function public._portal_anonimizar_textos() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.portal_solicitacoes s
     set mensagem = case when s.mensagem is not null then '[removido — LGPD]' end,
         resposta = case when s.resposta is not null then '[removido — LGPD]' end
   where s.cliente_id = new.id and (s.mensagem is not null or s.resposta is not null);
  update public.negocio_marcos m set observacao = null
    from public.cliente_negocios n
   where n.id = m.negocio_id and n.cliente_id = new.id and m.observacao is not null
     and (m.data_prevista is not null or m.data_realizada is not null);
  delete from public.negocio_marcos m
   using public.cliente_negocios n
   where n.id = m.negocio_id and n.cliente_id = new.id and m.data_prevista is null and m.data_realizada is null;
  return null;
end $$;

create trigger portal_anonimizar_textos after update of anonimizado_em on public.clientes
  for each row when (old.anonimizado_em is null and new.anonimizado_em is not null)
  execute function public._portal_anonimizar_textos();

-- ============ AJUDANTES (internos) ============
create function public._portal_tipos_solicitacao() returns text[]
language sql immutable set search_path = '' as $$
  select array['segunda_via_boleto', 'antecipacao_parcelas', 'agendar_vistoria', 'duvida_contrato', 'outro']::text[]
$$;

create function public._portal_hoje() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- título do negócio para a tela (empreendimento — unidade, ou a descrição). Sem dado pessoal.
create function public._portal_negocio_titulo(p_negocio_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(e.nome || ' — ' || u.identificador, e.nome, u.identificador, nullif(btrim(n.descricao), ''), 'Imóvel')
  from public.cliente_negocios n
  left join public.empreendimentos e on e.id = n.empreendimento_id
  left join public.unidades u on u.id = n.unidade_id
  where n.id = p_negocio_id
$$;

-- os 4 marcos, sempre na mesma ordem (sem registro = datas nulas). "Contrato assinado" sem data realizada registrada
-- usa a assinatura do contrato do negócio (contrato_id, ou o assinado da mesma unidade do mesmo cliente).
-- p_equipe = inclui ids e quem atualizou (só para a equipe).
create function public._portal_marcos(p_negocio_id uuid, p_equipe boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'tipo', t.tipo,
             'data_prevista', m.data_prevista,
             'data_realizada', coalesce(m.data_realizada,
                                        case when t.tipo = 'contrato_assinado'
                                             then (k.assinado_em at time zone 'America/Sao_Paulo')::date end),
             -- de onde veio a data realizada: registrada pela equipe ou lida do contrato assinado
             'origem', case when m.data_realizada is not null then 'equipe'
                            when t.tipo = 'contrato_assinado' and k.assinado_em is not null then 'contrato' end,
             'observacao', m.observacao)
           || case when p_equipe then jsonb_build_object(
                'id', m.id, 'data_realizada_registrada', m.data_realizada, 'atualizado_em', coalesce(m.atualizado_em, m.criado_em),
                'atualizado_por', (select jsonb_build_object('id', pr.id, 'nome', coalesce(nullif(btrim(pr.nome), ''), 'Sem nome'))
                                   from public.profiles pr where pr.id = coalesce(m.atualizado_por, m.criado_por)))
              else '{}'::jsonb end
           order by t.ordem), '[]'::jsonb)
  from (values ('contrato_assinado', 1), ('obra', 2), ('vistoria', 3), ('entrega_chaves', 4)) as t(tipo, ordem)
  left join public.negocio_marcos m on m.negocio_id = p_negocio_id and m.tipo = t.tipo
  left join lateral (
    select kk.assinado_em from public.cliente_negocios n
    join public.contratos kk on kk.cliente_id = n.cliente_id and kk.status = 'assinado' and kk.inativado_em is null
     and (kk.id = n.contrato_id or (n.contrato_id is null and n.unidade_id is not null and kk.unidade_id = n.unidade_id))
    where n.id = p_negocio_id
    order by (kk.id = n.contrato_id) is true desc, kk.assinado_em desc
    limit 1) k on t.tipo = 'contrato_assinado'
$$;

-- negócios do cliente com os marcos (mesmo formato para o titular e a equipe; a equipe recebe ids a mais)
create function public._portal_linha_do_tempo(p_cliente_id uuid, p_equipe boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'negocio_id', n.id,
           'titulo', public._portal_negocio_titulo(n.id),
           'empreendimento_id', n.empreendimento_id,
           'obra_percentual', (select o.percentual from public.obra_atualizacoes o
                               where n.empreendimento_id is not null and o.empreendimento_id = n.empreendimento_id
                                 and o.percentual is not null
                               order by o.data desc, o.created_at desc limit 1),
           'marcos', public._portal_marcos(n.id, p_equipe))
         order by n.created_at, n.id), '[]'::jsonb)
  from public.cliente_negocios n
  where n.cliente_id = p_cliente_id
$$;

-- item de solicitação (titular: sem quem atendeu; equipe: com o cliente e quem atualizou)
create function public._portal_solicitacao_json(p_s public.portal_solicitacoes, p_equipe boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_s.id, 'numero', p_s.numero, 'tipo', p_s.tipo,
    'negocio', case when p_s.negocio_id is not null
                    then jsonb_build_object('id', p_s.negocio_id, 'titulo', public._portal_negocio_titulo(p_s.negocio_id)) end,
    'mensagem', p_s.mensagem, 'status', p_s.status, 'resposta', p_s.resposta,
    'criado_em', p_s.criado_em, 'atualizado_em', p_s.atualizado_em, 'concluida_em', p_s.concluida_em)
  || case when p_equipe then jsonb_build_object(
       'cliente', (select jsonb_build_object('id', c.id, 'nome', btrim(c.nome || ' ' || coalesce(c.sobrenome, '')))
                   from public.clientes c where c.id = p_s.cliente_id),
       'atualizado_por', (select jsonb_build_object('id', pr.id, 'nome', coalesce(nullif(btrim(pr.nome), ''), 'Sem nome'))
                          from public.profiles pr where pr.id = p_s.atualizado_por))
     else '{}'::jsonb end
$$;

-- ============ PORTAL (titular) ============
-- Linha do tempo da compra: negócios do titular com os 4 marcos. Sem cliente do portal: lista vazia e acesso_negado.
create or replace function public.portal_linha_do_tempo()
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_itens jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  v_cliente := public._portal_cliente_id();
  if v_cliente is null then
    perform public._auditar('acesso', 'acesso_negado', 'negocio_marcos', null, null, null, null, null, '{"portal":true}'::jsonb);
    return '[]'::jsonb;
  end if;
  v_itens := public._portal_linha_do_tempo(v_cliente, false);
  perform public._auditar('acesso', 'listar', 'negocio_marcos', null, v_cliente, null, null, null,
    jsonb_build_object('portal', true, 'quantidade', jsonb_array_length(v_itens)));
  return v_itens;
end $$;

-- Pedidos do titular (os mais recentes primeiro; até 100).
create or replace function public.portal_solicitacoes()
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_itens jsonb;
  v_ids uuid[];
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  v_cliente := public._portal_cliente_id();
  if v_cliente is null then
    perform public._auditar('acesso', 'acesso_negado', 'portal_solicitacoes', null, null, null, null, null,
                            '{"portal":true}'::jsonb);
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(public._portal_solicitacao_json(t.s, false) order by (t.s).criado_em desc, (t.s).numero desc),
                  '[]'::jsonb),
         coalesce(array_agg((t.s).id), '{}'::uuid[])
    into v_itens, v_ids
  from (select x as s from public.portal_solicitacoes x where x.cliente_id = v_cliente
        order by x.criado_em desc, x.numero desc limit 100) t;
  perform public._auditar('acesso', 'listar', 'portal_solicitacoes', null, v_cliente, null, null, null,
    jsonb_build_object('portal', true, 'ids', to_jsonb(v_ids)));
  return v_itens;
end $$;

-- Novo pedido do titular. Tipo da lista fechada; negócio (opcional) do próprio titular; mensagem até 2000 caracteres
-- (obrigatória em 'outro'). Limites: 5 pedidos em 24 h e 10 em aberto por titular. Avisa a equipe (internos ativos).
create or replace function public.portal_solicitar(p_tipo text, p_negocio_id uuid, p_mensagem text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_msg text := nullif(btrim(coalesce(p_mensagem, '')), '');
  v_id uuid;
  v_numero bigint;
  v_dest uuid[];
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_cliente := public._portal_cliente_id();
  if v_cliente is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_tipo is null or not (p_tipo = any (public._portal_tipos_solicitacao())) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["tipo"]}';
  end if;
  if (v_msg is null and p_tipo = 'outro') or length(v_msg) > 2000 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["mensagem"]}';
  end if;
  if p_negocio_id is not null
     and not exists (select 1 from public.cliente_negocios n where n.id = p_negocio_id and n.cliente_id = v_cliente) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  -- trava por titular: dois pedidos simultâneos não furam os limites
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.portal.solicitacao'),
                                           pg_catalog.hashtext(v_cliente::text));
  if (select count(*) from public.portal_solicitacoes s
      where s.cliente_id = v_cliente and s.criado_em > now() - interval '24 hours') >= 5 then
    raise exception 'Você já fez 5 solicitações nas últimas 24 horas. Aguarde o retorno da equipe.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.portal_solicitacoes s where s.cliente_id = v_cliente and s.status <> 'concluida') >= 10 then
    raise exception 'Você tem 10 solicitações em aberto. Aguarde o retorno da equipe.' using errcode = 'P0001';
  end if;

  insert into public.portal_solicitacoes (cliente_id, negocio_id, tipo, mensagem)
  values (v_cliente, p_negocio_id, p_tipo, v_msg)
  returning id, numero into v_id, v_numero;
  perform public._auditar('operacao', 'criar', 'portal_solicitacoes', v_id::text, v_cliente,
    array_remove(array['tipo', case when p_negocio_id is not null then 'negocio_id' end,
                       case when v_msg is not null then 'mensagem' end], null),
    null, jsonb_build_object('status', 'aberta', 'tipo', p_tipo), '{"portal":true}'::jsonb);

  select coalesce(array_agg(pr.id), '{}'::uuid[]) into v_dest from public.profiles pr
  where pr.papel in ('admin', 'super') and pr.inativado_em is null;
  if cardinality(v_dest) > 0 then
    perform public._notificar('portal.solicitacao', v_dest, v_cliente,
                              jsonb_build_object('solicitacao_id', v_id, 'numero', v_numero, 'tipo_solicitacao', p_tipo));
  end if;
  return v_id;
end $$;

-- ============ EQUIPE (internos) ============
-- Negócios de um cliente com os marcos (para registrar as datas). Fora do escopo (não interno): nulo e acesso_negado.
create or replace function public.crm_portal_marcos(p_cliente_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_itens jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  if not public.is_admin() or not exists (select 1 from public.clientes c where c.id = p_cliente_id) then
    perform public._auditar('acesso', 'acesso_negado', 'negocio_marcos', null, p_cliente_id, null, null, null,
                            '{"rpc":"crm_portal_marcos"}'::jsonb);
    return null;
  end if;
  v_itens := public._portal_linha_do_tempo(p_cliente_id, true);
  perform public._auditar('acesso', 'consultar', 'negocio_marcos', null, p_cliente_id, null, null, null,
    jsonb_build_object('rpc', 'crm_portal_marcos', 'quantidade', jsonb_array_length(v_itens)));
  return v_itens;
end $$;

-- Registra (ou limpa) as datas de um marco. Tudo nulo = apaga o marco. Data realizada nunca no futuro. Observação
-- até 500 caracteres (aparece para o cliente).
create or replace function public.crm_portal_marco_salvar(p_negocio_id uuid, p_tipo text, p_data_prevista date,
                                                          p_data_realizada date, p_observacao text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_antes public.negocio_marcos%rowtype;
  v_depois public.negocio_marcos%rowtype;
  v_campos text[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select n.cliente_id into v_cliente from public.cliente_negocios n where n.id = p_negocio_id;
  if v_cliente is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if exists (select 1 from public.clientes c where c.id = v_cliente and c.anonimizado_em is not null) then
    raise exception 'Cliente anonimizado: os marcos não mudam.' using errcode = 'P0001';
  end if;
  if p_tipo is null or p_tipo not in ('contrato_assinado', 'obra', 'vistoria', 'entrega_chaves') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["tipo"]}';
  end if;
  if length(v_obs) > 500 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["observacao"]}';
  end if;
  if p_data_realizada is not null and p_data_realizada > public._portal_hoje() then
    raise exception 'A data realizada não pode estar no futuro.' using errcode = 'P0001';
  end if;

  select * into v_antes from public.negocio_marcos m where m.negocio_id = p_negocio_id and m.tipo = p_tipo for update;
  if p_data_prevista is null and p_data_realizada is null and v_obs is null then
    if v_antes.id is null then
      return;
    end if;
    delete from public.negocio_marcos m where m.id = v_antes.id;
  elsif v_antes.id is null then
    insert into public.negocio_marcos (negocio_id, tipo, data_prevista, data_realizada, observacao)
    values (p_negocio_id, p_tipo, p_data_prevista, p_data_realizada, v_obs)
    returning * into v_depois;
  else
    update public.negocio_marcos m
       set data_prevista = p_data_prevista, data_realizada = p_data_realizada, observacao = v_obs
     where m.id = v_antes.id
    returning * into v_depois;
  end if;

  select coalesce(array_agg(k order by k), '{}'::text[]) into v_campos
  from unnest(array['data_prevista', 'data_realizada', 'observacao']) k
  where (to_jsonb(v_antes) -> k) is distinct from (to_jsonb(v_depois) -> k);
  if cardinality(v_campos) > 0 then
    perform public._auditar('operacao', case when v_depois.id is null then 'excluir' when v_antes.id is null then 'criar'
                                             else 'editar' end,
      'negocio_marcos', coalesce(v_depois.id, v_antes.id)::text, v_cliente, v_campos,
      jsonb_build_object('tipo', p_tipo, 'data_prevista', v_antes.data_prevista, 'data_realizada', v_antes.data_realizada),
      jsonb_build_object('tipo', p_tipo, 'data_prevista', v_depois.data_prevista, 'data_realizada', v_depois.data_realizada),
      jsonb_build_object('rpc', 'crm_portal_marco_salvar', 'negocio_id', p_negocio_id));
  end if;
end $$;

-- Lista de pedidos para a equipe: filtros status ('aberta' | 'em_atendimento' | 'concluida'), abertas (não
-- concluídas), cliente_id, limite (até 200) e offset. Abertos primeiro, mais antigos primeiro (fila); concluídos por
-- último. Auditoria com os ids devolvidos.
create or replace function public.crm_portal_solicitacoes(p_filtros jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_status text;
  v_abertas boolean;
  v_cliente uuid;
  v_lim int;
  v_off int;
  v_total int;
  v_itens jsonb;
  v_ids uuid[];
  v_clientes uuid[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if jsonb_typeof(v_f) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["p_filtros"]}';
  end if;
  v_status := nullif(btrim(coalesce(v_f ->> 'status', '')), '');
  if v_status is not null and v_status not in ('aberta', 'em_atendimento', 'concluida') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["status"]}';
  end if;
  begin
    v_abertas := (v_f ->> 'abertas')::boolean;
    v_cliente := nullif(v_f ->> 'cliente_id', '')::uuid;
    v_lim := least(greatest(coalesce((v_f ->> 'limite')::int, 50), 1), 200);
    v_off := greatest(coalesce((v_f ->> 'offset')::int, 0), 0);
  exception when others then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["p_filtros"]}';
  end;

  with base as (
    select s, (s.status = 'concluida') as fim, case when s.status = 'concluida' then null else s.criado_em end as fila
    from public.portal_solicitacoes s
    where (v_status is null or s.status = v_status)
      and (v_abertas is null or (v_abertas and s.status <> 'concluida') or (not v_abertas and s.status = 'concluida'))
      and (v_cliente is null or s.cliente_id = v_cliente)
  ), pagina as (
    select b.s, row_number() over (order by b.fim, b.fila, (b.s).criado_em desc, (b.s).numero) as ordem
    from base b
    order by b.fim, b.fila, (b.s).criado_em desc, (b.s).numero
    limit v_lim offset v_off
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(public._portal_solicitacao_json(p.s, true) order by p.ordem) from pagina p), '[]'::jsonb),
         coalesce((select array_agg((p.s).id order by p.ordem) from pagina p), '{}'::uuid[]),
         coalesce((select array_agg(distinct (p.s).cliente_id) from pagina p), '{}'::uuid[])
    into v_total, v_itens, v_ids, v_clientes;

  perform public._auditar('acesso', 'listar', 'portal_solicitacoes', null, v_cliente, null, null, null,
    jsonb_build_object('rpc', 'crm_portal_solicitacoes', 'ids', to_jsonb(v_ids), 'clientes', to_jsonb(v_clientes),
                       'total', v_total,
                       'filtros', jsonb_strip_nulls(jsonb_build_object('status', v_status, 'abertas', v_abertas,
                                                                       'cliente_id', v_cliente))));
  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

-- Atendimento: aberta → em_atendimento → concluida (ou aberta → concluida); concluída é final. Pode só atualizar a
-- resposta mantendo o status. Concluir exige resposta (o titular a vê no portal).
create or replace function public.crm_portal_solicitacao_atualizar(p_id uuid, p_status text, p_resposta text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.portal_solicitacoes%rowtype;
  v_resp text := nullif(btrim(coalesce(p_resposta, '')), '');
  v_campos text[] := '{}';
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_s from public.portal_solicitacoes s where s.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('aberta', 'em_atendimento', 'concluida') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["status"]}';
  end if;
  if length(v_resp) > 2000 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["resposta"]}';
  end if;
  if v_s.status = 'concluida' then
    raise exception 'Esta solicitação já foi concluída.' using errcode = 'P0001';
  end if;
  if v_s.status = 'em_atendimento' and p_status = 'aberta' then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;
  if p_status = 'concluida' and coalesce(v_resp, v_s.resposta) is null then
    raise exception 'Escreva a resposta ao cliente para concluir.' using errcode = 'P0001';
  end if;
  if p_status = v_s.status and (v_resp is null or v_resp = v_s.resposta) then
    return;
  end if;

  update public.portal_solicitacoes s
     set status = p_status,
         resposta = coalesce(v_resp, s.resposta),
         concluida_em = case when p_status = 'concluida' then now() end
   where s.id = p_id;
  if p_status <> v_s.status then v_campos := v_campos || array['status']; end if;
  if p_status = 'concluida' then v_campos := v_campos || array['concluida_em']; end if;
  if v_resp is not null and v_resp is distinct from v_s.resposta then v_campos := v_campos || array['resposta']; end if;
  perform public._auditar('operacao', case when p_status <> v_s.status then 'mudar_status' else 'editar' end,
    'portal_solicitacoes', p_id::text, v_s.cliente_id, v_campos,
    jsonb_build_object('status', v_s.status), jsonb_build_object('status', p_status),
    jsonb_build_object('rpc', 'crm_portal_solicitacao_atualizar', 'tipo', v_s.tipo));
end $$;

-- ============ GRANTS ============
revoke execute on function
  public._portal_anonimizar_textos(), public._portal_tipos_solicitacao(), public._portal_hoje(),
  public._portal_negocio_titulo(uuid), public._portal_marcos(uuid, boolean), public._portal_linha_do_tempo(uuid, boolean),
  public._portal_solicitacao_json(public.portal_solicitacoes, boolean)
  from public, anon, authenticated, service_role;

revoke execute on function
  public.portal_linha_do_tempo(), public.portal_solicitacoes(), public.portal_solicitar(text, uuid, text),
  public.crm_portal_marcos(uuid), public.crm_portal_marco_salvar(uuid, text, date, date, text),
  public.crm_portal_solicitacoes(jsonb), public.crm_portal_solicitacao_atualizar(uuid, text, text)
  from public, anon, service_role;
grant execute on function
  public.portal_linha_do_tempo(), public.portal_solicitacoes(), public.portal_solicitar(text, uuid, text),
  public.crm_portal_marcos(uuid), public.crm_portal_marco_salvar(uuid, text, date, date, text),
  public.crm_portal_solicitacoes(jsonb), public.crm_portal_solicitacao_atualizar(uuid, text, text)
  to authenticated;
