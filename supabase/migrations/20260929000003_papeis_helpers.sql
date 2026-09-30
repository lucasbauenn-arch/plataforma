-- Papéis e helpers v2 (docs/ARQUITETURA_EXPANSAO.md §2.1, §3.4 "profiles", §4.1, §8.1).
-- Dependem só de profiles, configuracao_geral e lgpd_* (20260929000002). Os helpers de escopo da rede
-- (escopo_*, pode_ver_cliente, tem_permissao, …) nascem na 20260929000009, depois das tabelas que consultam.

-- ============ PROFILES ============
alter table public.profiles
  add column inativado_em timestamptz,
  add column inativado_por uuid references public.profiles(id) on delete set null;

-- §4.2: pela API o perfil só é lido e atualizado (nasce em handle_new_user e some com o usuário Auth). Com o INSERT e o
-- DELETE herdados da 20260921000002 (política "profile: admin gerencia", FOR ALL), um admin excluiria um perfil e o
-- incluiria de novo com papel 'super', contornando protege_campos_profile (que só vale no UPDATE).
revoke insert, delete on public.profiles from authenticated;

-- ============ HELPERS DE PAPEL ============
-- is_admin(): internos (admin e super). Com exigir_mfa_interno ligado (H5), só vale com sessão aal2.
-- Perfil inativado (inativado_em ou status 'inativo') perde o acesso na hora.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select pr.papel in ('admin', 'super') and pr.inativado_em is null and pr.status_parceiro <> 'inativo'
                   from public.profiles pr where pr.id = (select auth.uid())), false)
     and (not coalesce((select c.exigir_mfa_interno from public.configuracao_geral c), false)
          or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2')
$$;

-- is_super(): o que é crítico (configuração, termos, papéis internos, anonimização, …); mesma regra de MFA.
create or replace function public.is_super() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select pr.papel = 'super' and pr.inativado_em is null and pr.status_parceiro <> 'inativo'
                   from public.profiles pr where pr.id = (select auth.uid())), false)
     and (not coalesce((select c.exigir_mfa_interno from public.configuracao_geral c), false)
          or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2')
$$;

-- is_parceiro_aprovado() v2: unidades, materiais e obra. Legados ('parceiro') e papéis novos da rede continuam
-- vendo; só 'aprovado' dá acesso (pendente, bloqueado e inativo não).
create or replace function public.is_parceiro_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or coalesce((select pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
                          and pr.status_parceiro = 'aprovado' and pr.inativado_em is null
                   from public.profiles pr where pr.id = (select auth.uid())), false)
$$;

-- meu_papel(): mesma semântica, search_path vazio
create or replace function public.meu_papel() returns public.papel
language sql stable security definer set search_path = '' as $$
  select pr.papel from public.profiles pr where pr.id = (select auth.uid())
$$;

-- anon executa só is_admin (como hoje, usada nas políticas do conteúdo público). is_parceiro_aprovado e meu_papel
-- tinham grant a anon desde a 20260921000002, mas nenhuma política alcançável por anon as usa: revogado.
revoke execute on function public.is_admin(), public.is_super(), public.is_parceiro_aprovado(), public.meu_papel()
  from public, anon;
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.is_super(), public.is_parceiro_aprovado(), public.meu_papel()
  to authenticated, service_role;

-- ============ protege_campos_profile v3 ============
-- Vale para quem grava pela API (anon/authenticated); dentro das RPCs (postgres) e na service role não se aplica,
-- e as RPCs fazem a própria checagem. A reversão é silenciosa (o que rls.test.sql espera).
--   papel:            só muda se quem chama é Super e a troca é entre papéis internos (admin, super, colaborador);
--                     o último Super não deixa de ser Super por aqui
--   status_parceiro:  só muda se quem chama é interno, e nunca de ou para 'inativo'
--   inativado_*:      nunca muda
create or replace function public.protege_campos_profile() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.papel is distinct from old.papel and not (
         public.is_super()
         and old.papel in ('admin', 'super', 'colaborador')
         and new.papel in ('admin', 'super', 'colaborador')
         and (old.papel <> 'super' or exists (
               select 1 from public.profiles o
               where o.papel = 'super' and o.id <> old.id and o.inativado_em is null and o.status_parceiro <> 'inativo'))) then
      new.papel := old.papel;
    end if;
    if new.status_parceiro is distinct from old.status_parceiro and not (
         public.is_admin() and old.status_parceiro <> 'inativo' and new.status_parceiro <> 'inativo') then
      new.status_parceiro := old.status_parceiro;
    end if;
    new.inativado_em := old.inativado_em;
    new.inativado_por := old.inativado_por;
  end if;
  return new;
end $$;
revoke execute on function public.protege_campos_profile() from public, anon, authenticated;

-- papel, status e inativação de perfil gravados pela API (tela de parceiros do admin, cliente-login pela
-- service role) ficam na auditoria (§5.2). Dentro das RPCs (postgres) a própria RPC registra.
create trigger auditar_linha after update on public.profiles
  for each row execute function public.auditar_linha('papel,status_parceiro,inativado_em', 'seguranca', 'valores', 'id');

-- ============ handle_new_user v2 ============
-- Continua criando o perfil 'parceiro'/'pendente'. Nunca lê papel, tipo nem cadeia dos metadados (o usuário
-- controla raw_user_meta_data). Lê só dados de contato (com limite de tamanho) e termo_id: se for o termo
-- vigente de 'termos_parceiro', grava o consentimento. Se faltar, nada é gravado e o painel pede o aceite
-- (lgpd_aceitar_termo). Falha no consentimento nunca impede o cadastro.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_termo text := v_meta ->> 'termo_id';
begin
  insert into public.profiles (id, nome, email, telefone, creci, imobiliaria)
  values (
    new.id,
    left(coalesce(btrim(v_meta ->> 'nome'), ''), 200),
    new.email,
    left(nullif(btrim(v_meta ->> 'telefone'), ''), 30),
    left(nullif(btrim(v_meta ->> 'creci'), ''), 30),
    left(nullif(btrim(v_meta ->> 'imobiliaria'), ''), 200)
  )
  on conflict (id) do nothing;

  if coalesce(v_termo ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) then
    if v_termo::uuid = public._termo_vigente_id('termos_parceiro') then
      begin
        insert into public.lgpd_consentimentos (titular, profile_id, termo_id, origem)
        select 'parceiro', new.id, v_termo::uuid, 'cadastro_parceiro'
        where not exists (select 1 from public.lgpd_consentimentos c
                          where c.profile_id = new.id and c.termo_id = v_termo::uuid and c.revogado_em is null);
      exception when others then
        raise warning 'handle_new_user: consentimento não registrado (%)', sqlstate;
      end;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ============ relatorio() v2 ============
-- security definer (antes invoker): continua funcionando depois do corte, quando authenticated perde o SELECT
-- direto em leads e propostas. A checagem de admin (com MFA, H5) é a barreira; só agregados.
-- "parceiros_novos" passa a contar também os papéis novos da rede; "pendentes" continua sendo autocadastro.
create or replace function public.relatorio(p_desde timestamptz, p_ate timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    'parceiros_novos', (select count(*) from public.profiles
                        where papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
                          and created_at >= p_desde and created_at <= p_ate),
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
