-- CRM: funil e atividades — corpos das RPCs [WP3] (docs/ARQUITETURA_EXPANSAO.md §1.1 F1–F4 e N13, §3.5, §3.8,
-- §3.10, §4.3, §4.4, §4.5, §4.6, §7.3, §8.5; docs_new/modulo-crm.md §3–§7).
-- Troca os corpos dos esqueletos da 20260929000009 com create or replace, com a MESMA assinatura (preserva dono e
-- grants: execute só para authenticated) e devolve o JSON no formato de src/modulos/crm/tipos.ts.
-- Aditivo: só funções internas novas (prefixo _funil_, sem grant a ninguém). Nenhuma tabela ou coluna nova.
--
-- Regras comuns (§4.4, §4.6):
-- - security definer ignora a RLS: o escopo é conferido aqui, explicitamente, com os helpers da 09
--   (pode_ver_cliente = internos, ou parceiro aprovado com vínculo ativo na cadeia do cliente ativo);
-- - leitura fora do escopo (ou de registro inexistente) devolve NULO e grava 'acesso_negado' com o cliente_id;
--   escrita fora do escopo dá 42501 'Sem acesso a este registro' (mesma mensagem para inexistente) e não grava nada
--   (um raise desfaz a auditoria da mesma transação);
-- - listas sem vínculo nenhum (pendente, bloqueado, inativo, titular do portal, colaborador) dão 42501;
-- - etapa e status de documento mudam só por _transicionar (tabela status_transicoes, §3.8), que também grava
--   historico_status; a RPC grava _auditar e a timeline (_evento_cliente); notificações por _notificar;
-- - cliente inativado (ou anonimizado) não recebe escrita: continua legível pelos internos;
-- - a auditoria nunca guarda texto livre nem dado pessoal: só ids, status, etapas, contagens e nomes de campos;
-- - PAR-3: o parceiro vê o nome real só de si mesmo e de quem está ABAIXO dele na rede (vínculo em parceiros, mesma
--   regra da política "parceiros: escopo lê"); acima, ao lado ou em outra cadeia sai genérico ("Imobiliária",
--   "Gerência", "Corretor", "Equipe Arken"); o titular do portal aparece como "Cliente". Internos veem todos os nomes.
--
-- Datas "de hoje" (tarefa atrasada, dias na etapa, período dos contadores) no fuso America/Sao_Paulo.

-- ============ FUNÇÕES INTERNAS (sem grant; só as RPCs deste arquivo chamam) ============

-- nível hierárquico de um papel: internos 4, imobiliária 3, gerente 2, corretor/parceiro legado 1, demais 0
create function public._funil_nivel(p_papel public.papel)
returns int language sql immutable set search_path = '' as $$
  select case p_papel
    when 'admin' then 4 when 'super' then 4
    when 'imobiliaria' then 3 when 'gerente' then 2
    when 'corretor' then 1 when 'parceiro' then 1
    else 0 end
$$;

-- nível de quem chama: interno (is_admin, com MFA quando exigida) 4; parceiro pelo TIPO do vínculo ativo; senão 0
create function public._funil_meu_nivel()
returns int language sql stable set search_path = '' as $$
  select case when public.is_admin() then 4
    else coalesce((select case p.tipo when 'imobiliaria' then 3 when 'gerente' then 2 else 1 end
                   from public.parceiros p where p.id = public.meu_parceiro_id()), 0) end
$$;

-- nome de uma pessoa (perfil) para quem consulta, com PAR-3 ("vê-se quem está abaixo na árvore; nunca ao lado ou
-- acima"), pela MESMA regra da política "parceiros: escopo lê" (e de _crmcad_nome_perfil): o parceiro vê o nome real
-- só de si mesmo e de quem está abaixo dele NA REDE, pelo vínculo em parceiros (a imobiliária: os vínculos da sua
-- imobiliária; o gerente: os corretores ligados a ele por gerente_id). Nível sozinho não basta: quem está acima, ao
-- lado (mesmo nível, outra equipe) ou em outra cadeia — o caso típico é o corretor anterior de um cliente transferido
-- — sai genérico pelo tipo do vínculo ("Imobiliária", "Gerência", "Corretor"; sem vínculo, "Parceiro"). Interno sai
-- "Equipe Arken"; o titular do portal, "Cliente". Internos consultando veem todos os nomes.
-- p_ger / p_imob = escopo_gerente() / escopo_imobiliaria() de quem consulta, calculados uma vez pela RPC.
create function public._funil_nome(p_profile_id uuid, p_meu_nivel int, p_ger uuid, p_imob uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when p_profile_id is null then null
    when pr.id is null then 'Usuário removido'
    when pr.papel = 'cliente' then 'Cliente'
    when pr.id = auth.uid() or p_meu_nivel >= 4 then coalesce(nullif(btrim(pr.nome), ''), 'Sem nome')
    when pr.papel in ('admin', 'super', 'colaborador') then 'Equipe Arken'
    when p.id is not null and (p.imobiliaria_id = p_imob or (p.tipo = 'corretor' and p.gerente_id = p_ger))
      then coalesce(nullif(btrim(pr.nome), ''), 'Sem nome')
    else case coalesce(p.tipo::text, pr.papel::text)
           when 'imobiliaria' then 'Imobiliária' when 'gerente' then 'Gerência' when 'corretor' then 'Corretor'
           else 'Parceiro' end
  end
  from (select 1) x
  left join public.profiles pr on pr.id = p_profile_id
  left join public.parceiros p on p.profile_id = p_profile_id
$$;

-- Ref {id, nome} de uma pessoa (id = perfil); nulo quando o perfil não existe mais (FK set null)
create function public._funil_ref(p_profile_id uuid, p_meu_nivel int, p_ger uuid, p_imob uuid)
returns jsonb language sql stable set search_path = '' as $$
  select case when p_profile_id is null then null
              else jsonb_build_object('id', p_profile_id,
                                      'nome', public._funil_nome(p_profile_id, p_meu_nivel, p_ger, p_imob)) end
$$;

create function public._funil_rotulo_etapa(p_etapa public.etapa_funil)
returns text language sql immutable set search_path = '' as $$
  select case p_etapa
    when 'novo_contato' then 'Novo contato' when 'contato_iniciado' then 'Contato iniciado'
    when 'documentacao' then 'Documentação' when 'finalizado' then 'Finalizado' when 'perdido' then 'Perdido' end
$$;

create function public._funil_hoje()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- filtros (p_filtros jsonb): valor ausente/nulo/vazio = sem filtro; valor de tipo errado = DADOS_INVALIDOS
create function public._funil_filtro_uuid(p_filtros jsonb, p_chave text)
returns uuid language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p_filtros ->> p_chave, '')), '');
begin
  if v is null then
    return null;
  end if;
  if jsonb_typeof(p_filtros -> p_chave) <> 'string'
     or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  return v::uuid;
end $$;

create function public._funil_filtro_data(p_filtros jsonb, p_chave text)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p_filtros ->> p_chave, '')), '');
begin
  if v is null then
    return null;
  end if;
  if jsonb_typeof(p_filtros -> p_chave) <> 'string' or v !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  begin
    return v::date;
  exception when others then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end;
end $$;

create function public._funil_filtro_bool(p_filtros jsonb, p_chave text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_filtros -> p_chave is null or jsonb_typeof(p_filtros -> p_chave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_filtros -> p_chave) <> 'boolean' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  return (p_filtros -> p_chave)::boolean;
end $$;

create function public._funil_filtro_int(p_filtros jsonb, p_chave text)
returns int language plpgsql immutable set search_path = '' as $$
begin
  if p_filtros -> p_chave is null or jsonb_typeof(p_filtros -> p_chave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_filtros -> p_chave) <> 'number' or (p_filtros ->> p_chave) !~ '^\d{1,9}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  return (p_filtros ->> p_chave)::int;
end $$;

-- busca por nome: padrão ILIKE com %, _ e \ escapados (até 100 caracteres); nulo = sem busca
create function public._funil_busca(p_filtros jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p_filtros ->> 'busca', '')), '');
begin
  if v is null then
    return null;
  end if;
  if jsonb_typeof(p_filtros -> 'busca') <> 'string' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["busca"]}';
  end if;
  return '%' || replace(replace(replace(left(v, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
end $$;

-- p_filtros precisa ser objeto (ou nulo)
create function public._funil_objeto(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["p_filtros"]}';
  end if;
  return p;
end $$;

-- Kanban (§7.3): clientes ATIVOS no escopo de quem chama, com os filtros já cruzados com o escopo (o filtro por
-- corretor/gerente/imobiliária só estreita; nunca amplia). Uma página por etapa pedida, ordenada por etapa_desde
-- (mais recente primeiro). O corretor do cartão só vai para gestores e internos.
create function public._funil_kanban_paginas(
  p_etapas public.etapa_funil[], p_corretor uuid, p_gerente uuid, p_imobiliaria uuid, p_so_meus boolean, p_busca text,
  p_limite int, p_offset int)
returns table (etapa public.etapa_funil, total int, itens jsonb, ids uuid[])
language sql stable set search_path = '' as $$
  with eu as (
    select public.is_admin() as interno, public.escopo_corretor() as ec, public.escopo_gerente() as eg,
           public.escopo_imobiliaria() as ei, public.meu_parceiro_id() as mp, public._funil_meu_nivel() as nivel,
           public._funil_hoje() as hoje
  ), base as (
    select c.id, c.nome, c.sobrenome, c.telefone, c.corretor_id, c.etapa, c.etapa_desde, c.motivo_perda,
           count(*) over (partition by c.etapa) as total,
           row_number() over (partition by c.etapa order by c.etapa_desde desc, c.id) as n
    from public.clientes c cross join eu
    where c.inativado_em is null and c.etapa = any (p_etapas)
      and (eu.interno or c.corretor_id = eu.ec or c.gerente_id = eu.eg or c.imobiliaria_id = eu.ei)
      and (p_corretor is null or c.corretor_id = p_corretor)
      and (p_gerente is null or c.gerente_id = p_gerente)
      and (p_imobiliaria is null or c.imobiliaria_id = p_imobiliaria)
      and (not coalesce(p_so_meus, false) or c.corretor_id = eu.mp)
      and (p_busca is null or (c.nome || ' ' || coalesce(c.sobrenome, '')) ilike p_busca escape '\')
  ), pagina as (
    select b.*,
      jsonb_build_object(
        'id', b.id,
        'nome', btrim(b.nome || ' ' || coalesce(b.sobrenome, '')),
        'telefone', nullif(regexp_replace(coalesce(b.telefone, ''), '\D', '', 'g'), ''),
        -- PAR-3 (defesa extra; a cadeia derivada por gatilho já garante): só quem está abaixo ou é o próprio
        'corretor', case when eu.nivel >= 2 then
                      (select jsonb_build_object('id', p.id, 'nome', p.nome) from public.parceiros p
                       where p.id = b.corretor_id
                         and (eu.interno or p.id = eu.mp or p.imobiliaria_id = eu.ei
                              or (p.tipo = 'corretor' and p.gerente_id = eu.eg))) end,
        'etapa', b.etapa,
        'etapa_desde', b.etapa_desde,
        'dias_na_etapa', greatest(0, eu.hoje - (b.etapa_desde at time zone 'America/Sao_Paulo')::date),
        'documentos_pendentes', (select count(*) from public.cliente_documentos d
                                 where d.cliente_id = b.id and d.inativado_em is null and d.status in ('pendente', 'rejeitado')),
        'tarefa_atrasada', exists (select 1 from public.cliente_tarefas t
                                   where t.cliente_id = b.id and t.inativado_em is null and t.status = 'pendente'
                                     and t.prazo < eu.hoje),
        'motivo_perda', case when b.etapa = 'perdido' then b.motivo_perda end) as cartao
    from base b cross join eu
    where b.n > p_offset and b.n <= p_offset + p_limite
  )
  select e.etapa,
         coalesce((select max(b.total) from base b where b.etapa = e.etapa), 0)::int,
         coalesce((select jsonb_agg(p.cartao order by p.n) from pagina p where p.etapa = e.etapa), '[]'::jsonb),
         coalesce((select array_agg(p.id order by p.n) from pagina p where p.etapa = e.etapa), '{}'::uuid[])
  from unnest(p_etapas) with ordinality as e(etapa, o)
  order by e.o
$$;

-- Quem pode ser responsável por tarefa do cliente, para quem chama (§4.4): pessoas COM ESCOPO sobre o cliente
-- (corretor, gerente e usuários da imobiliária, com login, vínculo ativo e perfil aprovado; internos ativos) e
-- limitadas à equipe de quem chama (nível igual ou abaixo; o parceiro nunca vê nem escolhe interno).
-- Vazio quando quem chama não tem escopo ou o cliente está inativo.
create function public._funil_responsaveis(p_cliente_id uuid)
returns table (profile_id uuid, nome text, papel public.papel, tipo public.tipo_parceiro, nivel int)
language sql stable set search_path = '' as $$
  with eu as (select public._funil_meu_nivel() as nivel, auth.uid() as uid),
  cli as (select c.id, c.corretor_id, c.gerente_id, c.imobiliaria_id from public.clientes c
          where c.id = p_cliente_id and c.inativado_em is null and public.pode_ver_cliente(c.id)),
  cand as (
    select pr.id as profile_id, coalesce(nullif(btrim(p.nome), ''), pr.nome) as nome, pr.papel, p.tipo,
           case p.tipo when 'imobiliaria' then 3 when 'gerente' then 2 else 1 end as nivel
    from cli
    join public.parceiros p on (p.id = cli.corretor_id or p.id = cli.gerente_id
                                or (p.tipo = 'imobiliaria' and p.imobiliaria_id = cli.imobiliaria_id))
    join public.profiles pr on pr.id = p.profile_id
    where p.inativado_em is null and not p.virtual and pr.inativado_em is null and pr.status_parceiro = 'aprovado'
      and pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
    union
    select pr.id, coalesce(nullif(btrim(pr.nome), ''), 'Sem nome'), pr.papel, null::public.tipo_parceiro, 4
    from cli cross join public.profiles pr
    where pr.papel in ('admin', 'super') and pr.inativado_em is null and pr.status_parceiro <> 'inativo'
  )
  select c.profile_id, c.nome, c.papel, c.tipo, c.nivel
  from cand c cross join eu
  where eu.nivel >= 4 or (c.nivel < 4 and c.nivel <= eu.nivel)
  order by (c.profile_id = eu.uid) desc, c.nivel desc, c.nome, c.profile_id
$$;

-- Uma pessoa (perfil) tem HOJE escopo sobre o cliente? Mesma regra de pode_ver_cliente, avaliada para outra pessoa:
-- interno ativo (a MFA é da sessão dela, não se avalia aqui) ou parceiro aprovado, ativo, com vínculo ativo na cadeia
-- do cliente ativo. Falso para perfil removido (nulo), inexistente, bloqueado, inativado ou transferido para fora.
create function public._funil_tem_escopo(p_profile_id uuid, p_cliente_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles pr cross join public.clientes c
    where pr.id = p_profile_id and c.id = p_cliente_id and pr.inativado_em is null and (
         (pr.papel in ('admin', 'super') and pr.status_parceiro <> 'inativo')
      or (c.inativado_em is null and pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
          and pr.status_parceiro = 'aprovado'
          and exists (select 1 from public.parceiros p
                      where p.profile_id = pr.id and p.inativado_em is null
                        and ((p.tipo = 'corretor' and p.id = c.corretor_id)
                             or (p.tipo = 'gerente' and p.id = c.gerente_id)
                             or (p.tipo = 'imobiliaria' and p.imobiliaria_id = c.imobiliaria_id))))))
$$;

-- Tarefa (§3.8, regra fixa): edita e conclui o responsável, o criador, a cadeia ACIMA do responsável ou interno —
-- sempre com escopo sobre o cliente, conferido pela RPC; só pendente, ativa e fora da anonimização.
-- Tarefa órfã: se o responsável perdeu o escopo sobre o cliente (transferência, bloqueio, inativação, perfil
-- removido), quem tem o cliente no escopo agora (o novo corretor e a cadeia dele) edita, conclui e reatribui —
-- senão o novo dono veria "Tarefa atrasada" no cartão sem poder tratá-la.
create function public._funil_pode_tarefa(p_status public.status_tarefa, p_inativada boolean, p_removido_lgpd boolean,
                                          p_responsavel uuid, p_criador uuid, p_meu_nivel int, p_cliente_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_status = 'pendente' and not p_inativada and not p_removido_lgpd and p_meu_nivel > 0 and (
       p_meu_nivel >= 4
    or p_responsavel = auth.uid()
    or p_criador = auth.uid()
    or p_meu_nivel > coalesce((select public._funil_nivel(pr.papel) from public.profiles pr where pr.id = p_responsavel), 0)
    or not public._funil_tem_escopo(p_responsavel, p_cliente_id))
$$;

-- JSON de uma tarefa (ClienteTarefa de src/modulos/crm/tipos.ts)
create function public._funil_tarefa_json(p_id uuid, p_meu_nivel int, p_cliente_ativo boolean, p_ger uuid, p_imob uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'cliente_id', t.cliente_id, 'titulo', t.titulo, 'descricao', t.descricao,
    'responsavel', public._funil_ref(t.responsavel_id, p_meu_nivel, p_ger, p_imob),
    'prazo', t.prazo, 'status', t.status,
    'atrasada', t.status = 'pendente' and t.prazo is not null and t.prazo < public._funil_hoje(),
    'concluida_em', t.concluida_em, 'concluida_por', public._funil_ref(t.concluida_por, p_meu_nivel, p_ger, p_imob),
    'criado_em', t.criado_em, 'criado_por', public._funil_ref(t.criado_por, p_meu_nivel, p_ger, p_imob),
    'pode_editar', x.pode, 'pode_concluir', x.pode)
  from public.cliente_tarefas t
  cross join lateral (select p_cliente_ativo and public._funil_pode_tarefa(t.status, t.inativado_em is not null,
                               t.removido_lgpd, t.responsavel_id, t.criado_por, p_meu_nivel, t.cliente_id) as pode) x
  where t.id = p_id
$$;

-- formato do arquivo × formatos aceitos pela solicitação (§3.10): extensão e MIME da MESMA família aceita
create function public._funil_formato_do_arquivo(p_ext text, p_mime text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_ext in ('jpg', 'jpeg') and p_mime = 'image/jpeg' then 'jpeg'
    when p_ext = 'png' and p_mime = 'image/png' then 'png'
    when p_ext = 'pdf' and p_mime = 'application/pdf' then 'pdf'
    when p_ext in ('doc', 'docx') and p_mime in ('application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then 'doc'
    when p_ext in ('xls', 'xlsx', 'csv') and p_mime in ('application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv') then 'planilha'
  end
$$;

-- ============ KANBAN (§7.3) ============
-- p_filtros: KanbanFiltros (busca, corretor_id, gerente_id, imobiliaria_id, so_meus, periodo_de, periodo_ate).
-- As 5 colunas na ordem do funil (Perdidos por último), até p_limite_coluna cartões cada (padrão 50, máximo 200).
-- Contadores: total ativo no escopo com os filtros; finalizados e perdidos com etapa_desde no período (sem
-- período = acumulado). Auditoria acesso/listar com os ids devolvidos; a busca é gravada só como {busca:true}.
create or replace function public.crm_kanban(p_filtros jsonb, p_limite_coluna int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_f jsonb := public._funil_objeto(p_filtros);
  v_corretor uuid := public._funil_filtro_uuid(v_f, 'corretor_id');
  v_gerente uuid := public._funil_filtro_uuid(v_f, 'gerente_id');
  v_imob uuid := public._funil_filtro_uuid(v_f, 'imobiliaria_id');
  v_so_meus boolean := coalesce(public._funil_filtro_bool(v_f, 'so_meus'), false);
  v_busca text := public._funil_busca(v_f);
  v_de date := public._funil_filtro_data(v_f, 'periodo_de');
  v_ate date := public._funil_filtro_data(v_f, 'periodo_ate');
  v_lim int := least(greatest(coalesce(p_limite_coluna, 50), 1), 200);
  v_interno boolean := public.is_admin();
  v_mp uuid := public.meu_parceiro_id();
  v_ec uuid := public.escopo_corretor();
  v_eg uuid := public.escopo_gerente();
  v_ei uuid := public.escopo_imobiliaria();
  v_colunas jsonb;
  v_ids uuid[];
  v_contadores jsonb;
begin
  if v_uid is null or not (v_interno or v_mp is not null) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_de is not null and v_ate is not null and v_de > v_ate then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["periodo_de","periodo_ate"]}';
  end if;

  with k as (
    select * from public._funil_kanban_paginas(enum_range(null::public.etapa_funil), v_corretor, v_gerente, v_imob,
                                               v_so_meus, v_busca, v_lim, 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object('etapa', k.etapa, 'total', k.total, 'itens', k.itens) order by k.etapa), '[]'::jsonb),
         (select coalesce(array_agg(i order by k2.etapa), '{}'::uuid[]) from k k2 cross join unnest(k2.ids) i)
    into v_colunas, v_ids
  from k;

  select jsonb_build_object(
           'total', count(*),
           'finalizados', count(*) filter (where c.etapa = 'finalizado'
               and (v_de is null or (c.etapa_desde at time zone 'America/Sao_Paulo')::date >= v_de)
               and (v_ate is null or (c.etapa_desde at time zone 'America/Sao_Paulo')::date <= v_ate)),
           'perdidos', count(*) filter (where c.etapa = 'perdido'
               and (v_de is null or (c.etapa_desde at time zone 'America/Sao_Paulo')::date >= v_de)
               and (v_ate is null or (c.etapa_desde at time zone 'America/Sao_Paulo')::date <= v_ate)))
    into v_contadores
  from public.clientes c
  where c.inativado_em is null
    and (v_interno or c.corretor_id = v_ec or c.gerente_id = v_eg or c.imobiliaria_id = v_ei)
    and (v_corretor is null or c.corretor_id = v_corretor)
    and (v_gerente is null or c.gerente_id = v_gerente)
    and (v_imob is null or c.imobiliaria_id = v_imob)
    and (not v_so_meus or c.corretor_id = v_mp)
    and (v_busca is null or (c.nome || ' ' || coalesce(c.sobrenome, '')) ilike v_busca escape '\');

  perform public._auditar('acesso', 'listar', 'clientes', null, null, null, null, null,
    jsonb_build_object('rpc', 'crm_kanban', 'ids', to_jsonb(v_ids), 'limite_coluna', v_lim,
      'filtros', jsonb_strip_nulls(jsonb_build_object('busca', case when v_busca is not null then true end,
        'corretor_id', v_corretor, 'gerente_id', v_gerente, 'imobiliaria_id', v_imob,
        'so_meus', case when v_so_meus then true end, 'periodo_de', v_de, 'periodo_ate', v_ate))));

  return jsonb_build_object('colunas', v_colunas, 'contadores', v_contadores);
end $$;

-- Próxima página de uma coluna ("Ver mais"): limite fixo de 50, a partir de p_offset.
create or replace function public.crm_kanban_coluna(p_etapa public.etapa_funil, p_filtros jsonb, p_offset int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_f jsonb := public._funil_objeto(p_filtros);
  v_corretor uuid := public._funil_filtro_uuid(v_f, 'corretor_id');
  v_gerente uuid := public._funil_filtro_uuid(v_f, 'gerente_id');
  v_imob uuid := public._funil_filtro_uuid(v_f, 'imobiliaria_id');
  v_so_meus boolean := coalesce(public._funil_filtro_bool(v_f, 'so_meus'), false);
  v_busca text := public._funil_busca(v_f);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_k record;
begin
  if v_uid is null or not (public.is_admin() or public.meu_parceiro_id() is not null) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_etapa is null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["p_etapa"]}';
  end if;

  select * into v_k
  from public._funil_kanban_paginas(array[p_etapa], v_corretor, v_gerente, v_imob, v_so_meus, v_busca, 50, v_offset);

  perform public._auditar('acesso', 'listar', 'clientes', null, null, null, null, null,
    jsonb_build_object('rpc', 'crm_kanban_coluna', 'etapa', p_etapa, 'offset', v_offset, 'ids', to_jsonb(v_k.ids),
      'filtros', jsonb_strip_nulls(jsonb_build_object('busca', case when v_busca is not null then true end,
        'corretor_id', v_corretor, 'gerente_id', v_gerente, 'imobiliaria_id', v_imob,
        'so_meus', case when v_so_meus then true end))));

  return jsonb_build_object('etapa', p_etapa, 'total', v_k.total, 'itens', v_k.itens);
end $$;

-- ============ MUDAR ETAPA (§3.8 funil; F1, F2, N13) ============
-- P+I com escopo sobre o cliente ativo. A transição precisa estar ativa em status_transicoes COM o papel de quem
-- chama (senão TRANSICAO_INVALIDA com detail {entidade, de, para}: FI é só do sistema, voltar de etapa começa
-- desligado); _transicionar confere de novo e aplica motivo (perdido), validações e efeitos (CI → DO cria os
-- documentos básicos sem duplicar; reativar limpa o motivo). Timeline 'etapa' e auditoria operacao/mudar_status.
create or replace function public.crm_mudar_etapa(p_id uuid, p_para public.etapa_funil, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_cli public.clientes%rowtype;
  v_papel public.papel;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 2000);
  v_de text;
  v_basicos uuid[];
  v_novos text[];
  v_desde timestamptz;
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_cli from public.clientes c where c.id = p_id for update;
  if not found or not public.pode_ver_cliente(p_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_cli.inativado_em is not null then
    raise exception 'Cliente inativo não muda de etapa.' using errcode = 'P0001';
  end if;
  if p_para is null then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  select pr.papel into v_papel from public.profiles pr where pr.id = v_uid;
  if not exists (select 1 from public.status_transicoes t
                 where t.entidade = 'cliente_etapa' and t.de = v_cli.etapa::text and t.para = p_para::text and t.ativa
                   and v_papel = any (t.papeis)) then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001',
      detail = jsonb_build_object('entidade', 'cliente_etapa', 'de', v_cli.etapa, 'para', p_para)::text;
  end if;

  select coalesce(array_agg(d.id), '{}'::uuid[]) into v_basicos
  from public.cliente_documentos d where d.cliente_id = p_id and d.basico and d.inativado_em is null;

  v_de := public._transicionar('cliente_etapa', p_id, p_para::text, v_motivo, 'usuario');

  -- na ordem de configuracao_geral.documentos_basicos (a mesma do modal de confirmação do kanban)
  select coalesce(array_agg(d.nome order by array_position(g.documentos_basicos, d.nome) nulls last, d.nome), '{}'::text[])
    into v_novos
  from public.cliente_documentos d cross join public.configuracao_geral g
  where d.cliente_id = p_id and d.basico and d.inativado_em is null and d.id <> all (v_basicos);
  select c.etapa_desde into v_desde from public.clientes c where c.id = p_id;

  perform public._evento_cliente(p_id, 'etapa', 'Etapa: ' || public._funil_rotulo_etapa(p_para),
    jsonb_build_object('de', v_de, 'para', p_para, 'motivo', v_motivo));
  perform public._auditar('operacao', 'mudar_status', 'clientes', p_id::text, p_id,
    case when p_para = 'perdido' or v_de = 'perdido' then array['etapa', 'etapa_desde', 'motivo_perda']
         else array['etapa', 'etapa_desde'] end,
    jsonb_build_object('etapa', v_de), jsonb_build_object('etapa', p_para),
    -- o motivo é texto livre: fica em historico_status e na timeline, nunca na auditoria
    jsonb_build_object('rpc', 'crm_mudar_etapa', 'com_motivo', v_motivo is not null,
                       'documentos_solicitados', cardinality(v_novos)));

  return jsonb_build_object('de', v_de, 'para', p_para, 'etapa_desde', v_desde, 'documentos_solicitados', to_jsonb(v_novos));
end $$;

-- ============ LEITURAS DA FICHA (§7.3 abas Timeline, Notas, Tarefas, Documentos) ============
-- P+I com escopo (pode_ver_cliente: internos leem também o cliente inativado). Fora do escopo: nulo +
-- acesso_negado. Auditoria acesso/consultar com o cliente_id.

-- Timeline (F3): eventos com ocorrido_em < p_antes (nulo = agora), do mais novo ao mais antigo, p_limite (padrão
-- 30, máximo 100). A página nunca corta um grupo de eventos com o mesmo instante (senão o próximo p_antes pularia
-- os que sobraram): pode vir um pouco maior que p_limite. 'mais' = há eventos mais antigos.
-- tentativa_duplicada: o dono vê a tentativa sem saber por quem (ator só para internos).
create or replace function public.crm_timeline(p_id uuid, p_antes timestamptz, p_limite int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_nivel int;
  v_eg uuid;
  v_ei uuid;
  v_antes timestamptz := coalesce(p_antes, 'infinity'::timestamptz);
  v_lim int := least(greatest(coalesce(p_limite, 30), 1), 100);
  v_corte timestamptz;
  v_itens jsonb;
  v_mais boolean;
begin
  if v_uid is null or p_id is null or not public.pode_ver_cliente(p_id) then
    if v_uid is not null then
      perform public._auditar('acesso', 'acesso_negado', 'cliente_eventos', p_id::text, p_id, null, null, null,
                              '{"rpc":"crm_timeline"}'::jsonb);
    end if;
    return null;
  end if;
  v_nivel := public._funil_meu_nivel();
  v_eg := public.escopo_gerente();
  v_ei := public.escopo_imobiliaria();

  select e.ocorrido_em into v_corte from public.cliente_eventos e
  where e.cliente_id = p_id and e.ocorrido_em < v_antes
  order by e.ocorrido_em desc, e.id desc offset v_lim - 1 limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'tipo', e.tipo, 'ocorrido_em', e.ocorrido_em, 'titulo', e.titulo,
           'ator_nome', case when e.tipo = 'tentativa_duplicada' and v_nivel < 4 then null
                             else public._funil_nome(e.ator_id, v_nivel, v_eg, v_ei) end,
           'ator_papel', case when e.tipo = 'tentativa_duplicada' and v_nivel < 4 then null else pr.papel end,
           'dados', e.dados) order by e.ocorrido_em desc, e.id desc), '[]'::jsonb)
    into v_itens
  from public.cliente_eventos e
  left join public.profiles pr on pr.id = e.ator_id
  where e.cliente_id = p_id and e.ocorrido_em < v_antes and (v_corte is null or e.ocorrido_em >= v_corte);

  v_mais := v_corte is not null
            and exists (select 1 from public.cliente_eventos e where e.cliente_id = p_id and e.ocorrido_em < v_corte);

  perform public._auditar('acesso', 'consultar', 'cliente_eventos', p_id::text, p_id, null, null, null,
    jsonb_build_object('rpc', 'crm_timeline', 'itens', jsonb_array_length(v_itens), 'paginado', p_antes is not null));
  return jsonb_build_object('itens', v_itens, 'mais', v_mais);
end $$;

-- Notas (mais nova primeiro). O texto sai como gravado; o front exibe escapado (sem HTML).
create or replace function public.crm_notas(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_nivel int;
  v_eg uuid;
  v_ei uuid;
  v_itens jsonb;
begin
  if v_uid is null or p_id is null or not public.pode_ver_cliente(p_id) then
    if v_uid is not null then
      perform public._auditar('acesso', 'acesso_negado', 'cliente_notas', p_id::text, p_id, null, null, null,
                              '{"rpc":"crm_notas"}'::jsonb);
    end if;
    return null;
  end if;
  v_nivel := public._funil_meu_nivel();
  v_eg := public.escopo_gerente();
  v_ei := public.escopo_imobiliaria();

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'texto', n.texto, 'autor_nome', public._funil_nome(n.autor_id, v_nivel, v_eg, v_ei), 'autor_papel', pr.papel,
           'criado_em', n.criado_em, 'migrado_legado', n.migrado_legado, 'removido_lgpd', n.removido_lgpd,
           'minha', n.autor_id is not distinct from v_uid) order by n.criado_em desc, n.id), '[]'::jsonb)
    into v_itens
  from public.cliente_notas n left join public.profiles pr on pr.id = n.autor_id
  where n.cliente_id = p_id;

  perform public._auditar('acesso', 'consultar', 'cliente_notas', p_id::text, p_id, null, null, null,
    jsonb_build_object('rpc', 'crm_notas', 'itens', jsonb_array_length(v_itens)));
  return v_itens;
end $$;

-- Tarefas ativas do cliente (pendentes primeiro, por prazo), com "atrasada" calculada e o que quem consulta pode fazer.
create or replace function public.crm_tarefas(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_nivel int;
  v_eg uuid;
  v_ei uuid;
  v_ativo boolean;
  v_itens jsonb;
begin
  if v_uid is null or p_id is null or not public.pode_ver_cliente(p_id) then
    if v_uid is not null then
      perform public._auditar('acesso', 'acesso_negado', 'cliente_tarefas', p_id::text, p_id, null, null, null,
                              '{"rpc":"crm_tarefas"}'::jsonb);
    end if;
    return null;
  end if;
  v_nivel := public._funil_meu_nivel();
  v_eg := public.escopo_gerente();
  v_ei := public.escopo_imobiliaria();
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = p_id;

  select coalesce(jsonb_agg(public._funil_tarefa_json(t.id, v_nivel, v_ativo, v_eg, v_ei)
           order by (t.status = 'pendente') desc, t.prazo nulls last, t.criado_em desc, t.id), '[]'::jsonb)
    into v_itens
  from public.cliente_tarefas t
  where t.cliente_id = p_id and t.inativado_em is null;

  perform public._auditar('acesso', 'consultar', 'cliente_tarefas', p_id::text, p_id, null, null, null,
    jsonb_build_object('rpc', 'crm_tarefas', 'itens', jsonb_array_length(v_itens)));
  return v_itens;
end $$;

-- Documentos: solicitações ativas, com todas as versões enviadas (sem caminho: baixar é por crm_documento_baixar).
create or replace function public.crm_documentos(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_nivel int;
  v_eg uuid;
  v_ei uuid;
  v_itens jsonb;
begin
  if v_uid is null or p_id is null or not public.pode_ver_cliente(p_id) then
    if v_uid is not null then
      perform public._auditar('acesso', 'acesso_negado', 'cliente_documentos', p_id::text, p_id, null, null, null,
                              '{"rpc":"crm_documentos"}'::jsonb);
    end if;
    return null;
  end if;
  v_nivel := public._funil_meu_nivel();
  v_eg := public.escopo_gerente();
  v_ei := public.escopo_imobiliaria();

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'cliente_id', d.cliente_id, 'tipo', d.tipo, 'nome', d.nome,
           'formatos_aceitos', to_jsonb(d.formatos_aceitos), 'status', d.status, 'basico', d.basico,
           'contrato_id', d.contrato_id, 'analisado_em', d.analisado_em,
           'analisado_por', public._funil_ref(d.analisado_por, v_nivel, v_eg, v_ei), 'motivo_rejeicao', d.motivo_rejeicao,
           'criado_em', d.criado_em,
           'arquivos', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', a.id, 'mime_type', a.mime_type, 'tamanho_bytes', a.tamanho_bytes, 'enviado_em', a.enviado_em,
                          'enviado_por_nome', public._funil_nome(a.enviado_por, v_nivel, v_eg, v_ei),
                          'atual', a.id is not distinct from d.arquivo_atual_id, 'removido', a.removido_em is not null)
                          order by a.enviado_em desc, a.id), '[]'::jsonb)
                        from public.cliente_documento_arquivos a where a.documento_id = d.id))
           order by d.basico desc, d.criado_em, d.nome), '[]'::jsonb)
    into v_itens
  from public.cliente_documentos d
  where d.cliente_id = p_id and d.inativado_em is null;

  perform public._auditar('acesso', 'consultar', 'cliente_documentos', p_id::text, p_id, null, null, null,
    jsonb_build_object('rpc', 'crm_documentos', 'itens', jsonb_array_length(v_itens)));
  return v_itens;
end $$;

-- Responsáveis possíveis para uma tarefa do cliente (ver _funil_responsaveis). Nulo fora do escopo.
create or replace function public.crm_responsaveis(p_cliente_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_itens jsonb;
begin
  if v_uid is null or p_cliente_id is null or not public.pode_ver_cliente(p_cliente_id) then
    if v_uid is not null then
      perform public._auditar('acesso', 'acesso_negado', 'clientes', p_cliente_id::text, p_cliente_id, null, null, null,
                              '{"rpc":"crm_responsaveis"}'::jsonb);
    end if;
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', r.profile_id, 'nome', r.nome, 'papel', r.papel, 'tipo', r.tipo)),
                  '[]'::jsonb)
    into v_itens
  from public._funil_responsaveis(p_cliente_id) r;

  perform public._auditar('acesso', 'consultar', 'clientes', p_cliente_id::text, p_cliente_id, null, null, null,
    jsonb_build_object('rpc', 'crm_responsaveis', 'itens', jsonb_array_length(v_itens)));
  return v_itens;
end $$;

-- ============ NOTAS (§3.5: somente inclusão) ============
create or replace function public.crm_nota_criar(p_cliente_id uuid, p_texto text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_ativo boolean;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
begin
  if v_uid is null or p_cliente_id is null or not public.pode_ver_cliente(p_cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = p_cliente_id for no key update;
  if not v_ativo then
    raise exception 'Cliente inativo não recebe notas.' using errcode = 'P0001';
  end if;
  if length(v_texto) = 0 then
    raise exception 'Escreva o texto da nota.' using errcode = 'P0001';
  end if;
  if length(v_texto) > 10000 then
    raise exception 'A nota pode ter no máximo 10.000 caracteres.' using errcode = 'P0001';
  end if;

  insert into public.cliente_notas (cliente_id, texto, autor_id) values (p_cliente_id, v_texto, v_uid)
  returning id into v_id;

  perform public._evento_cliente(p_cliente_id, 'nota', 'Nota adicionada', jsonb_build_object('nota_id', v_id));
  perform public._auditar('operacao', 'criar', 'cliente_notas', v_id::text, p_cliente_id, array['texto'], null, null,
                          '{"rpc":"crm_nota_criar"}'::jsonb);
  return v_id;
end $$;

-- ============ TAREFAS (§3.8 "Tarefa": regra fixa, sem status_transicoes) ============
-- O responsável precisa estar em _funil_responsaveis (escopo sobre o cliente e equipe de quem chama) na criação e
-- em cada troca. Prazo novo não pode estar no passado (fuso de São Paulo).
create or replace function public.crm_tarefa_criar(p_cliente_id uuid, p_titulo text, p_descricao text,
                                                   p_responsavel_id uuid, p_prazo date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_ativo boolean;
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_id uuid;
begin
  if v_uid is null or p_cliente_id is null or not public.pode_ver_cliente(p_cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = p_cliente_id for no key update;
  if not v_ativo then
    raise exception 'Cliente inativo não recebe tarefas.' using errcode = 'P0001';
  end if;
  if length(v_titulo) = 0 or length(v_titulo) > 200 then
    raise exception 'Informe o que deve ser feito (até 200 caracteres).' using errcode = 'P0001';
  end if;
  if length(v_desc) > 2000 then
    raise exception 'A descrição pode ter no máximo 2.000 caracteres.' using errcode = 'P0001';
  end if;
  if p_prazo is not null and p_prazo < public._funil_hoje() then
    raise exception 'O prazo não pode estar no passado.' using errcode = 'P0001';
  end if;
  if p_responsavel_id is null
     or not exists (select 1 from public._funil_responsaveis(p_cliente_id) r where r.profile_id = p_responsavel_id) then
    raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"campos":["responsavel_id"]}';
  end if;

  insert into public.cliente_tarefas (cliente_id, titulo, descricao, responsavel_id, prazo, criado_por)
  values (p_cliente_id, v_titulo, v_desc, p_responsavel_id, p_prazo, v_uid)
  returning id into v_id;

  -- título da timeline sem o texto da tarefa (pode ter dado pessoal)
  perform public._evento_cliente(p_cliente_id, 'tarefa_criada', 'Tarefa criada', jsonb_build_object('tarefa_id', v_id));
  perform public._auditar('operacao', 'criar', 'cliente_tarefas', v_id::text, p_cliente_id,
    array['titulo', 'descricao', 'responsavel_id', 'prazo'], null,
    jsonb_build_object('status', 'pendente', 'responsavel_id', p_responsavel_id, 'prazo', p_prazo),
    '{"rpc":"crm_tarefa_criar"}'::jsonb);
  return v_id;
end $$;

-- p_dados: TarefaEdicao (titulo, descricao, responsavel_id, prazo); só as chaves enviadas mudam, as demais são
-- ignoradas. Só tarefa pendente, por quem pode (_funil_pode_tarefa), com o cliente ativo e no escopo.
create or replace function public.crm_tarefa_editar(p_id uuid, p_dados jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_t public.cliente_tarefas%rowtype;
  v_nivel int;
  v_ativo boolean;
  v_d jsonb;
  v_titulo text;
  v_desc text;
  v_resp uuid;
  v_prazo date;
  v_campos text[] := '{}';
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_t from public.cliente_tarefas t where t.id = p_id for update;
  if not found or v_t.inativado_em is not null or not public.pode_ver_cliente(v_t.cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_nivel := public._funil_meu_nivel();
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = v_t.cliente_id;
  if not v_ativo then
    raise exception 'Cliente inativo não recebe alterações.' using errcode = 'P0001';
  end if;
  if v_t.status <> 'pendente' then
    raise exception 'Tarefa concluída não pode ser editada.' using errcode = 'P0001';
  end if;
  if not public._funil_pode_tarefa(v_t.status, false, v_t.removido_lgpd, v_t.responsavel_id, v_t.criado_por, v_nivel,
                                   v_t.cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["p_dados"]}';
  end if;
  v_d := p_dados;
  v_titulo := v_t.titulo;
  v_desc := v_t.descricao;
  v_resp := v_t.responsavel_id;
  v_prazo := v_t.prazo;

  if v_d ? 'titulo' then
    if jsonb_typeof(v_d -> 'titulo') <> 'string' or length(btrim(v_d ->> 'titulo')) not between 1 and 200 then
      raise exception 'Informe o que deve ser feito (até 200 caracteres).' using errcode = 'P0001';
    end if;
    v_titulo := btrim(v_d ->> 'titulo');
  end if;
  if v_d ? 'descricao' then
    if jsonb_typeof(v_d -> 'descricao') not in ('string', 'null') then
      raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["descricao"]}';
    end if;
    v_desc := nullif(btrim(coalesce(v_d ->> 'descricao', '')), '');
    if length(v_desc) > 2000 then
      raise exception 'A descrição pode ter no máximo 2.000 caracteres.' using errcode = 'P0001';
    end if;
  end if;
  if v_d ? 'responsavel_id' then
    v_resp := public._funil_filtro_uuid(v_d, 'responsavel_id');
    if v_resp is null then
      raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"campos":["responsavel_id"]}';
    end if;
    if v_resp is distinct from v_t.responsavel_id
       and not exists (select 1 from public._funil_responsaveis(v_t.cliente_id) r where r.profile_id = v_resp) then
      raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"campos":["responsavel_id"]}';
    end if;
  end if;
  if v_d ? 'prazo' then
    v_prazo := public._funil_filtro_data(v_d, 'prazo');
    if v_prazo is distinct from v_t.prazo and v_prazo < public._funil_hoje() then
      raise exception 'O prazo não pode estar no passado.' using errcode = 'P0001';
    end if;
  end if;

  if v_titulo is distinct from v_t.titulo then v_campos := v_campos || 'titulo'::text; end if;
  if v_desc is distinct from v_t.descricao then v_campos := v_campos || 'descricao'::text; end if;
  if v_resp is distinct from v_t.responsavel_id then v_campos := v_campos || 'responsavel_id'::text; end if;
  if v_prazo is distinct from v_t.prazo then v_campos := v_campos || 'prazo'::text; end if;
  if cardinality(v_campos) = 0 then
    return;
  end if;

  update public.cliente_tarefas t
     set titulo = v_titulo, descricao = v_desc, responsavel_id = v_resp, prazo = v_prazo
   where t.id = p_id;

  perform public._auditar('operacao', 'editar', 'cliente_tarefas', p_id::text, v_t.cliente_id, v_campos,
    jsonb_strip_nulls(jsonb_build_object(
      'responsavel_id', case when 'responsavel_id' = any (v_campos) then v_t.responsavel_id end,
      'prazo', case when 'prazo' = any (v_campos) then v_t.prazo end)),
    jsonb_strip_nulls(jsonb_build_object(
      'responsavel_id', case when 'responsavel_id' = any (v_campos) then v_resp end,
      'prazo', case when 'prazo' = any (v_campos) then v_prazo end)),
    '{"rpc":"crm_tarefa_editar"}'::jsonb);
end $$;

create or replace function public.crm_tarefa_concluir(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_t public.cliente_tarefas%rowtype;
  v_ativo boolean;
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_t from public.cliente_tarefas t where t.id = p_id for update;
  if not found or v_t.inativado_em is not null or not public.pode_ver_cliente(v_t.cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = v_t.cliente_id;
  if not v_ativo then
    raise exception 'Cliente inativo não recebe alterações.' using errcode = 'P0001';
  end if;
  if v_t.status <> 'pendente' then
    raise exception 'Esta tarefa já foi concluída.' using errcode = 'P0001';
  end if;
  if not public._funil_pode_tarefa(v_t.status, false, v_t.removido_lgpd, v_t.responsavel_id, v_t.criado_por,
                                   public._funil_meu_nivel(), v_t.cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;

  update public.cliente_tarefas t set status = 'concluida', concluida_em = now(), concluida_por = v_uid where t.id = p_id;

  perform public._evento_cliente(v_t.cliente_id, 'tarefa_concluida', 'Tarefa concluída', jsonb_build_object('tarefa_id', p_id));
  perform public._auditar('operacao', 'mudar_status', 'cliente_tarefas', p_id::text, v_t.cliente_id,
    array['status', 'concluida_em', 'concluida_por'], '{"status":"pendente"}'::jsonb, '{"status":"concluida"}'::jsonb,
    '{"rpc":"crm_tarefa_concluir"}'::jsonb);
end $$;

-- Tarefas de quem consulta (p_filtros: TarefasFiltros): 'minhas' = responsável é quem chama; 'equipe' = de clientes
-- no escopo. Só voltam tarefas ativas cujo cliente AINDA está no escopo e ativo: quem perde o cliente numa
-- transferência perde a tarefa (e quem recebe o cliente trata as órfãs: ver _funil_pode_tarefa). Paginação em
-- p_filtros (limite padrão 50, máximo 200). Auditoria com os ids.
create or replace function public.crm_minhas_tarefas(p_filtros jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_f jsonb := public._funil_objeto(p_filtros);
  v_escopo text := coalesce(nullif(btrim(coalesce(v_f ->> 'escopo', '')), ''), 'minhas');
  v_status public.status_tarefa;
  v_atrasadas boolean := coalesce(public._funil_filtro_bool(v_f, 'atrasadas'), false);
  v_prazo_ate date := public._funil_filtro_data(v_f, 'prazo_ate');
  v_cliente uuid := public._funil_filtro_uuid(v_f, 'cliente_id');
  v_resp uuid := public._funil_filtro_uuid(v_f, 'responsavel_id');
  v_lim int := least(greatest(coalesce(public._funil_filtro_int(v_f, 'limite'), 50), 1), 200);
  v_off int := greatest(coalesce(public._funil_filtro_int(v_f, 'offset'), 0), 0);
  v_nivel int;
  v_hoje date := public._funil_hoje();
  v_interno boolean := public.is_admin();
  v_ec uuid := public.escopo_corretor();
  v_eg uuid := public.escopo_gerente();
  v_ei uuid := public.escopo_imobiliaria();
  v_total int;
  v_itens jsonb;
  v_ids uuid[];
  v_clientes uuid[];
begin
  if v_uid is null or not (v_interno or public.meu_parceiro_id() is not null) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_escopo not in ('minhas', 'equipe') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["escopo"]}';
  end if;
  if nullif(btrim(coalesce(v_f ->> 'status', '')), '') is not null then
    if (v_f ->> 'status') not in ('pendente', 'concluida') then
      raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["status"]}';
    end if;
    v_status := (v_f ->> 'status')::public.status_tarefa;
  end if;
  v_nivel := public._funil_meu_nivel();

  with sel as (
    select t.id, t.cliente_id,
           row_number() over (order by (t.status = 'pendente') desc, t.prazo nulls last, t.criado_em desc, t.id) as ordem
    from public.cliente_tarefas t
    join public.clientes c on c.id = t.cliente_id
    where t.inativado_em is null and c.inativado_em is null
      and (v_interno or c.corretor_id = v_ec or c.gerente_id = v_eg or c.imobiliaria_id = v_ei)
      and (v_escopo = 'equipe' or t.responsavel_id = v_uid)
      and (v_status is null or t.status = v_status)
      and (not v_atrasadas or (t.status = 'pendente' and t.prazo < v_hoje))
      and (v_prazo_ate is null or t.prazo <= v_prazo_ate)
      and (v_cliente is null or t.cliente_id = v_cliente)
      and (v_resp is null or t.responsavel_id = v_resp)
  ), pag as (
    select s.* from sel s where s.ordem > v_off and s.ordem <= v_off + v_lim
  )
  select (select count(*)::int from sel),
         (select coalesce(jsonb_agg(public._funil_tarefa_json(p.id, v_nivel, true, v_eg, v_ei)
                                      || jsonb_build_object('cliente', jsonb_build_object('id', c.id,
                                           'nome', btrim(c.nome || ' ' || coalesce(c.sobrenome, ''))))
                                    order by p.ordem), '[]'::jsonb)
            from pag p join public.clientes c on c.id = p.cliente_id),
         (select coalesce(array_agg(p.id order by p.ordem), '{}'::uuid[]) from pag p),
         (select coalesce(array_agg(distinct p.cliente_id), '{}'::uuid[]) from pag p)
    into v_total, v_itens, v_ids, v_clientes;

  perform public._auditar('acesso', 'listar', 'cliente_tarefas', null, null, null, null, null,
    jsonb_build_object('rpc', 'crm_minhas_tarefas', 'ids', to_jsonb(v_ids), 'cliente_ids', to_jsonb(v_clientes),
      'filtros', jsonb_strip_nulls(jsonb_build_object('escopo', v_escopo, 'status', v_status,
        'atrasadas', case when v_atrasadas then true end, 'prazo_ate', v_prazo_ate, 'cliente_id', v_cliente,
        'responsavel_id', v_resp, 'limite', v_lim, 'offset', v_off))));
  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

-- ============ DOCUMENTOS (§3.5, §3.8 documento, §3.10, §4.3; F4) ============
-- Solicitar: P+I com escopo sobre o cliente ativo. Nome 2..120; formatos ⊂ {jpeg,png,pdf,doc,planilha} (ao menos 1);
-- p_contrato_id (documento de contrato) só de contrato DESTE cliente ainda editável. Não abre duas solicitações
-- abertas (pendente, em análise ou rejeitada) com o mesmo nome. Timeline 'documento_solicitado' e notificação
-- crm.documento_solicitado (desligada por padrão, N10).
create or replace function public.crm_documento_solicitar(p_cliente_id uuid, p_nome text, p_formatos text[], p_contrato_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_ativo boolean;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_formatos text[];
  v_id uuid;
begin
  if v_uid is null or p_cliente_id is null or not public.pode_ver_cliente(p_cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = p_cliente_id for no key update;
  if not v_ativo then
    raise exception 'Cliente inativo não recebe solicitações.' using errcode = 'P0001';
  end if;
  if length(v_nome) not between 2 and 120 then
    raise exception 'Informe o nome do documento (de 2 a 120 caracteres).' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(f order by o), '{}'::text[]) into v_formatos
  from unnest(array['jpeg', 'png', 'pdf', 'doc', 'planilha']) with ordinality as x(f, o)
  where f = any (coalesce(p_formatos, '{}'::text[]));
  if cardinality(v_formatos) = 0
     or exists (select 1 from unnest(coalesce(p_formatos, '{}'::text[])) f
                where f is null or f not in ('jpeg', 'png', 'pdf', 'doc', 'planilha')) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["formatos_aceitos"]}';
  end if;
  if p_contrato_id is not null and not exists (
       select 1 from public.contratos k where k.id = p_contrato_id and k.cliente_id = p_cliente_id
         and k.status in ('rascunho', 'documentacao_pendente', 'em_analise')) then
    raise exception 'O contrato informado não aceita novas solicitações de documento.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cliente_documentos d
             where d.cliente_id = p_cliente_id and d.inativado_em is null and lower(d.nome) = lower(v_nome)
               and d.status in ('pendente', 'em_analise', 'rejeitado')) then
    raise exception 'Já existe uma solicitação aberta com este nome.' using errcode = 'P0001';
  end if;

  insert into public.cliente_documentos (cliente_id, tipo, nome, formatos_aceitos, basico, contrato_id, criado_por)
  values (p_cliente_id, case when p_contrato_id is null then 'cliente' else 'contrato' end::public.tipo_documento,
          v_nome, v_formatos, false, p_contrato_id, v_uid)
  returning id into v_id;

  perform public._evento_cliente(p_cliente_id, 'documento_solicitado', 'Documento solicitado: ' || v_nome,
                                 jsonb_build_object('documento_id', v_id));
  perform public._notificar('crm.documento_solicitado', '{}'::uuid[], p_cliente_id,
                            jsonb_build_object('documento_ids', jsonb_build_array(v_id)));
  perform public._auditar('operacao', 'criar', 'cliente_documentos', v_id::text, p_cliente_id,
    array['nome', 'formatos_aceitos', 'tipo', 'contrato_id'], null,
    jsonb_strip_nulls(jsonb_build_object('status', 'pendente', 'formatos_aceitos', to_jsonb(v_formatos),
                                         'contrato_id', p_contrato_id)),
    '{"rpc":"crm_documento_solicitar"}'::jsonb);
end $$;

-- Cancelar = inativar a solicitação (nunca excluir; os arquivos enviados ficam como histórico). Não cancela
-- documento aprovado. Motivo obrigatório (3 a 2.000 caracteres). Sem tipo de timeline para isso (F3): só auditoria.
create or replace function public.crm_documento_cancelar(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_d public.cliente_documentos%rowtype;
  v_ativo boolean;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_d from public.cliente_documentos d where d.id = p_id for update;
  if not found or v_d.inativado_em is not null or not public.pode_ver_cliente(v_d.cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = v_d.cliente_id;
  if not v_ativo then
    raise exception 'Cliente inativo não recebe alterações.' using errcode = 'P0001';
  end if;
  if v_d.status = 'aprovado' then
    raise exception 'Documento aprovado não pode ser cancelado.' using errcode = 'P0001';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001';
  end if;

  update public.cliente_documentos d
     set inativado_em = now(), inativado_por = v_uid, motivo_inativacao = left(v_motivo, 2000)
   where d.id = p_id;

  perform public._auditar('operacao', 'inativar', 'cliente_documentos', p_id::text, v_d.cliente_id,
    array['inativado_em', 'inativado_por', 'motivo_inativacao'], jsonb_build_object('status', v_d.status), null,
    '{"rpc":"crm_documento_cancelar"}'::jsonb);
end $$;

-- Registrar o arquivo já enviado ao bucket crm-documentos (upload pela API do Storage, política de INSERT =
-- pode_enviar_documento). Quem: P+I com escopo sobre o cliente ativo, ou o titular pelo portal (meu_cliente_id =
-- cliente do documento; _transicionar não confere isso, então é conferido aqui). Confere, sem confiar no navegador:
-- caminho <cliente_id>/<documento_id>/<uuid>.<ext> deste documento; objeto existente no Storage e enviado por quem
-- chama; tamanho REAL (metadata.size) ≤ configuracao_geral.documento_max_bytes; MIME REAL (metadata.mimetype) e
-- extensão da mesma família e aceitos pela solicitação; caminho ainda não registrado. Grava a versão, aponta o
-- arquivo atual e leva o documento a em_analise (pendente → em_analise; rejeitado → em_analise = reenvio).
create or replace function public.crm_documento_registrar_envio(p_documento_id uuid, p_path text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_formato constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf|doc|docx|xls|xlsx|csv)$';
  v_d public.cliente_documentos%rowtype;
  v_ativo boolean;
  v_titular boolean := false;
  v_path text := btrim(coalesce(p_path, ''));
  v_ext text;
  v_obj jsonb;
  v_bytes bigint;
  v_mime text;
  v_max int;
  v_familia text;
  v_arquivo uuid;
  v_de text;
begin
  if v_uid is null or p_documento_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_d from public.cliente_documentos d where d.id = p_documento_id for update;
  if not found or v_d.inativado_em is not null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if not public.pode_ver_cliente(v_d.cliente_id) then
    v_titular := v_d.cliente_id = public.meu_cliente_id();
    if not coalesce(v_titular, false) then
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
  end if;
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = v_d.cliente_id;
  if not v_ativo then
    raise exception 'Cliente inativo não recebe documentos.' using errcode = 'P0001';
  end if;
  if v_d.status not in ('pendente', 'rejeitado') then
    raise exception 'Este documento não está aguardando envio.' using errcode = 'P0001';
  end if;

  -- caminho deste documento
  if v_path !~ v_formato or split_part(v_path, '/', 1) <> v_d.cliente_id::text
     or split_part(v_path, '/', 2) <> v_d.id::text then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"caminho"}';
  end if;
  if exists (select 1 from public.cliente_documento_arquivos a where a.storage_path = v_path) then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"ja_registrado"}';
  end if;
  v_ext := lower(substring(v_path from '\.([a-z]+)$'));

  -- objeto real no Storage (to_jsonb: tolera versões do Storage com owner ou owner_id)
  select to_jsonb(o) into v_obj from storage.objects o where o.bucket_id = 'crm-documentos' and o.name = v_path;
  if v_obj is null then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"nao_encontrado"}';
  end if;
  if coalesce(nullif(v_obj ->> 'owner_id', ''), v_obj ->> 'owner') is distinct from v_uid::text then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"autor"}';
  end if;

  select c.documento_max_bytes into v_max from public.configuracao_geral c;
  v_bytes := case when (v_obj #>> '{metadata,size}') ~ '^\d{1,12}$' then (v_obj #>> '{metadata,size}')::bigint end;
  v_mime := lower(btrim(split_part(coalesce(v_obj #>> '{metadata,mimetype}', ''), ';', 1)));
  if v_bytes is null or v_bytes < 1 or v_bytes > v_max then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001',
      detail = jsonb_build_object('motivo', 'tamanho', 'max_bytes', v_max)::text;
  end if;
  v_familia := public._funil_formato_do_arquivo(v_ext, v_mime);
  if v_familia is null or not (v_familia = any (v_d.formatos_aceitos)) then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001',
      detail = jsonb_build_object('motivo', 'tipo', 'formatos_aceitos', to_jsonb(v_d.formatos_aceitos))::text;
  end if;

  -- enviado_em pelo relógio (estritamente depois da última análise, também numa mesma transação)
  insert into public.cliente_documento_arquivos (documento_id, storage_path, mime_type, tamanho_bytes, enviado_em, enviado_por)
  values (v_d.id, v_path, v_mime, v_bytes, clock_timestamp(), v_uid)
  returning id into v_arquivo;
  update public.cliente_documentos d set arquivo_atual_id = v_arquivo where d.id = v_d.id;

  v_de := public._transicionar('documento', v_d.id, 'em_analise', null, 'usuario');

  perform public._evento_cliente(v_d.cliente_id, 'documento_enviado', 'Documento enviado: ' || v_d.nome,
                                 jsonb_build_object('documento_id', v_d.id, 'arquivo_id', v_arquivo));
  perform public._auditar('operacao', 'criar', 'cliente_documento_arquivos', v_arquivo::text, v_d.cliente_id,
    array['storage_path', 'mime_type', 'tamanho_bytes'], null,
    jsonb_build_object('documento_id', v_d.id, 'mime_type', v_mime, 'tamanho_bytes', v_bytes),
    jsonb_build_object('rpc', 'crm_documento_registrar_envio', 'portal', v_titular));
  perform public._auditar('operacao', 'mudar_status', 'cliente_documentos', v_d.id::text, v_d.cliente_id,
    array['status', 'arquivo_atual_id'], jsonb_build_object('status', v_de), '{"status":"em_analise"}'::jsonb,
    jsonb_build_object('rpc', 'crm_documento_registrar_envio', 'arquivo_id', v_arquivo, 'portal', v_titular));
end $$;

-- Analisar (F4): tem_permissao('analisar_documento') + escopo sobre o cliente ativo; só em_analise. Rejeitar exige
-- motivo (MOTIVO_OBRIGATORIO) e põe crm.documento_rejeitado na fila (efeito da transição). Timeline
-- 'documento_analisado'.
create or replace function public.crm_documento_analisar(p_id uuid, p_aprovar boolean, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_d public.cliente_documentos%rowtype;
  v_ativo boolean;
  v_para text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_d from public.cliente_documentos d where d.id = p_id for update;
  if not found or v_d.inativado_em is not null or not public.pode_ver_cliente(v_d.cliente_id)
     or not public.tem_permissao('analisar_documento') then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select c.inativado_em is null into v_ativo from public.clientes c where c.id = v_d.cliente_id;
  if not v_ativo then
    raise exception 'Cliente inativo não recebe alterações.' using errcode = 'P0001';
  end if;
  if p_aprovar is null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["p_aprovar"]}';
  end if;
  v_para := case when p_aprovar then 'aprovado' else 'rejeitado' end;

  perform public._transicionar('documento', p_id, v_para, case when p_aprovar then null else v_motivo end, 'usuario');

  perform public._evento_cliente(v_d.cliente_id, 'documento_analisado',
    case when p_aprovar then 'Documento aprovado: ' else 'Documento rejeitado: ' end || v_d.nome,
    jsonb_build_object('documento_id', p_id, 'status', v_para));
  perform public._auditar('operacao', 'mudar_status', 'cliente_documentos', p_id::text, v_d.cliente_id,
    case when p_aprovar then array['status', 'analisado_em', 'analisado_por']
         else array['status', 'analisado_em', 'analisado_por', 'motivo_rejeicao'] end,
    jsonb_build_object('status', v_d.status), jsonb_build_object('status', v_para),
    jsonb_build_object('rpc', 'crm_documento_analisar', 'arquivo_id', v_d.arquivo_atual_id));
end $$;

-- Baixar (§4.3): P+I com escopo sobre o cliente (o titular NÃO baixa pelo CRM; internos também baixam de cliente
-- inativo). Grava acesso/baixar e a autorização de curta duração (_autorizar_download); o front troca por URL
-- assinada na Edge baixar-arquivo. Arquivo removido pela anonimização não é baixado.
create or replace function public.crm_documento_baixar(p_arquivo_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_a public.cliente_documento_arquivos%rowtype;
  v_cliente uuid;
begin
  if v_uid is null or p_arquivo_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_a from public.cliente_documento_arquivos a where a.id = p_arquivo_id;
  if found then
    select d.cliente_id into v_cliente from public.cliente_documentos d where d.id = v_a.documento_id;
  end if;
  if v_cliente is null or not public.pode_ver_cliente(v_cliente) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_a.removido_em is not null then
    raise exception 'Este arquivo foi removido.' using errcode = 'P0001';
  end if;

  perform public._auditar('acesso', 'baixar', 'cliente_documento_arquivos', p_arquivo_id::text, v_cliente, null, null, null,
    jsonb_build_object('rpc', 'crm_documento_baixar', 'documento_id', v_a.documento_id));
  return public._autorizar_download('crm-documentos', v_a.storage_path);
end $$;

-- ============ GRANTS ============
-- As RPCs acima mantêm os grants da 09 (create or replace). As internas novas: ninguém executa pela API.
revoke execute on function
  public._funil_nivel(public.papel), public._funil_meu_nivel(), public._funil_nome(uuid, int, uuid, uuid),
  public._funil_ref(uuid, int, uuid, uuid), public._funil_rotulo_etapa(public.etapa_funil), public._funil_hoje(), public._funil_filtro_uuid(jsonb, text),
  public._funil_filtro_data(jsonb, text), public._funil_filtro_bool(jsonb, text), public._funil_filtro_int(jsonb, text),
  public._funil_busca(jsonb), public._funil_objeto(jsonb),
  public._funil_kanban_paginas(public.etapa_funil[], uuid, uuid, uuid, boolean, text, int, int),
  public._funil_responsaveis(uuid),
  public._funil_tem_escopo(uuid, uuid),
  public._funil_pode_tarefa(public.status_tarefa, boolean, boolean, uuid, uuid, int, uuid),
  public._funil_tarefa_json(uuid, int, boolean, uuid, uuid), public._funil_formato_do_arquivo(text, text)
  from public, anon, authenticated, service_role;
