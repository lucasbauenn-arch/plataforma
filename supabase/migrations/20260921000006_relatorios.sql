-- Relatórios do admin: agregados calculados no banco (uma chamada; sem o limite de 1000 linhas da Data API).
-- security invoker + checagem de admin: roda com as permissões e a RLS de quem chama.
create or replace function public.relatorio(p_desde timestamptz, p_ate timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_duracao interval := p_ate - p_desde;
  v_hoje timestamp := date_trunc('month', now() at time zone 'America/Sao_Paulo');
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'leads', (select count(*) from public.leads where created_at >= p_desde and created_at <= p_ate),
    'leads_anterior', (select count(*) from public.leads where created_at >= p_desde - v_duracao and created_at < p_desde),
    'parceiros_novos', (select count(*) from public.profiles where papel = 'parceiro' and created_at >= p_desde and created_at <= p_ate),
    'parceiros_pendentes', (select count(*) from public.profiles where papel = 'parceiro' and status_parceiro = 'pendente'),
    'acessos_portal', (select count(*) from public.portal_acessos where sucesso and created_at >= p_desde and created_at <= p_ate),

    'propostas', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status, count(*) as n from public.propostas where created_at >= p_desde and created_at <= p_ate group by status) s),

    -- últimos 12 meses (fuso de São Paulo), meses sem lead aparecem com zero
    'leads_mensal', (select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'total', n) order by m) from (
        select m, (select count(*) from public.leads l
                   where date_trunc('month', l.created_at at time zone 'America/Sao_Paulo') = m) as n
        from generate_series(v_hoje - interval '11 months', v_hoje, interval '1 month') as m) s),

    'leads_por_empreendimento', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'total', n) order by n desc, nome), '[]'::jsonb) from (
        select coalesce(e.nome, 'Contato geral') as nome, count(*) as n
        from public.leads l left join public.empreendimentos e on e.id = l.empreendimento_id
        where l.created_at >= p_desde and l.created_at <= p_ate group by 1) s),

    'leads_por_origem', (select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'total', n) order by n desc), '[]'::jsonb) from (
        select coalesce(origem, 'site') as origem, count(*) as n
        from public.leads where created_at >= p_desde and created_at <= p_ate group by 1) s),

    'parceiros_ranking', (select coalesce(jsonb_agg(jsonb_build_object(
          'nome', coalesce(nullif(p.nome, ''), p.email), 'total', s.total, 'aprovadas', s.aprovadas) order by s.total desc, s.aprovadas desc), '[]'::jsonb)
        from (select parceiro_id, count(*) as total, count(*) filter (where status = 'aprovada') as aprovadas
              from public.propostas where created_at >= p_desde and created_at <= p_ate
              group by parceiro_id order by count(*) desc limit 10) s
        join public.profiles p on p.id = s.parceiro_id),

    -- estoque atual (não depende do período)
    'estoque', (select coalesce(jsonb_agg(jsonb_build_object(
          'nome', e.nome, 'disponivel', u.disponivel, 'reservada', u.reservada, 'vendida', u.vendida,
          'vgv_disponivel', u.vgv_disponivel, 'vgv_vendido', u.vgv_vendido) order by e.ordem, e.nome), '[]'::jsonb)
        from (select empreendimento_id,
                     count(*) filter (where status = 'disponivel') as disponivel,
                     count(*) filter (where status = 'reservada') as reservada,
                     count(*) filter (where status = 'vendida') as vendida,
                     coalesce(sum(valor) filter (where status = 'disponivel'), 0) as vgv_disponivel,
                     coalesce(sum(valor) filter (where status = 'vendida'), 0) as vgv_vendido
              from public.unidades group by empreendimento_id) u
        join public.empreendimentos e on e.id = u.empreendimento_id)
  ) into v;
  return v;
end $$;

revoke execute on function public.relatorio(timestamptz, timestamptz) from public, anon;
grant execute on function public.relatorio(timestamptz, timestamptz) to authenticated, service_role;
