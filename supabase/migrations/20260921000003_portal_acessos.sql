-- Portal do cliente: login só com CPF (decisão do cliente em 21/09/2026, risco aceito — ver PRD 4.3/12).
-- Esta tabela registra cada tentativa: serve de auditoria (quem entrou, de onde) e de limite de tentativas por IP
-- na Edge Function cliente-login. Escrita só pela service role; admin lê.
create table public.portal_acessos (
  id bigint generated always as identity primary key,
  cliente_id uuid references public.clientes(id) on delete set null,
  ip text,
  user_agent text,
  sucesso boolean not null,
  created_at timestamptz not null default now()
);
create index portal_acessos_ip_idx on public.portal_acessos (ip, created_at desc);
create index portal_acessos_cliente_idx on public.portal_acessos (cliente_id, created_at desc);

alter table public.portal_acessos enable row level security;
create policy "acessos: admin lê" on public.portal_acessos for select using (public.is_admin());

grant select on public.portal_acessos to authenticated;
grant select, insert, update, delete on public.portal_acessos to service_role;
