-- Grants explícitos na Data API + ajustes do linter do Supabase.
-- O Supabase está deixando de conceder SELECT/INSERT/UPDATE/DELETE automáticos a anon/authenticated
-- em tabelas novas do schema public. Aqui a exposição fica explícita (RLS continua filtrando as linhas)
-- e o projeto já adota o novo padrão: toda tabela/função nova precisa de GRANT na própria migration.

-- ============ PADRÃO: nada exposto automaticamente ============
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- zera o que já foi concedido pelo padrão antigo e concede só o necessário
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- ============ TABELAS ============
-- visitante (anon): conteúdo público dos empreendimentos + envio de lead
grant select on public.empreendimentos, public.empreendimento_midias, public.empreendimento_lazer,
  public.empreendimento_proximidades, public.empreendimento_ficha
  to anon, authenticated;
grant insert on public.leads to anon, authenticated;

-- usuário logado: RLS decide o que cada papel vê/altera
grant select, insert, update, delete on
  public.profiles, public.empreendimentos, public.empreendimento_midias, public.empreendimento_lazer,
  public.empreendimento_proximidades, public.empreendimento_ficha, public.empreendimento_materiais,
  public.unidades, public.obra_atualizacoes, public.parceiro_clientes, public.propostas,
  public.clientes, public.cliente_negocios, public.cliente_arquivos, public.leads
  to authenticated;

-- service role (Edge Functions / scripts locais)
grant select, insert, update, delete on all tables in schema public to service_role;

-- ============ FUNÇÕES ============
-- usadas nas políticas de RLS: precisam de EXECUTE para quem consulta
grant execute on function public.is_admin(), public.is_parceiro_aprovado(), public.meu_papel()
  to anon, authenticated, service_role;
-- funções de trigger não são chamadas pela API
grant execute on function public.handle_new_user(), public.protege_campos_profile(), public.touch_updated_at()
  to service_role;

-- linter: search_path fixo em toda função
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- correção: a versão anterior era security definer (current_user = dono) e sem auth.uid() barrava também
-- o SQL editor e a service role — impedia criar o primeiro admin e o cliente-login de marcar papel 'cliente'.
-- Agora só usuários da API (anon/authenticated) que não são admin têm papel/status travados.
create or replace function public.protege_campos_profile() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    new.papel := old.papel;
    new.status_parceiro := old.status_parceiro;
  end if;
  return new;
end $$;

-- ============ ÍNDICES DE FK (linter de performance) ============
create index if not exists propostas_empreendimento_idx on public.propostas (empreendimento_id);
create index if not exists propostas_parceiro_cliente_idx on public.propostas (parceiro_cliente_id);
create index if not exists propostas_unidade_idx on public.propostas (unidade_id);
create index if not exists cliente_negocios_cliente_idx on public.cliente_negocios (cliente_id);
create index if not exists cliente_negocios_empreendimento_idx on public.cliente_negocios (empreendimento_id);
create index if not exists cliente_negocios_unidade_idx on public.cliente_negocios (unidade_id);
create index if not exists cliente_arquivos_cliente_idx on public.cliente_arquivos (cliente_id);
create index if not exists cliente_arquivos_negocio_idx on public.cliente_arquivos (negocio_id);
create index if not exists leads_empreendimento_idx on public.leads (empreendimento_id);
create index if not exists leads_created_idx on public.leads (created_at desc);
