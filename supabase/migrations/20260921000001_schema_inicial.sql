-- Arken Incorporadora — schema inicial (rascunho; será refinado com o dump do WordPress)

create extension if not exists pgcrypto;

-- ============ ENUMS ============
create type public.papel as enum ('admin', 'parceiro', 'cliente');
create type public.status_parceiro as enum ('pendente', 'aprovado', 'bloqueado');
create type public.estagio_empreendimento as enum (
  'futuro_lancamento', 'lancamento', 'obras_iniciadas', 'obras_aceleradas',
  'em_construcao', 'pronto_para_morar', 'portfolio'
);
create type public.tipo_midia as enum ('fachada', 'area_comum', 'planta', 'decorado', 'obra');
create type public.status_unidade as enum ('disponivel', 'reservada', 'vendida');
create type public.status_proposta as enum ('enviada', 'em_analise', 'aprovada', 'recusada');

-- ============ PERFIS ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  papel public.papel not null default 'parceiro',
  nome text not null default '',
  email text,
  telefone text,
  cpf text unique,
  creci text,
  imobiliaria text,
  status_parceiro public.status_parceiro not null default 'pendente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- helpers (security definer p/ evitar recursão de RLS)
create or replace function public.meu_papel() returns public.papel
language sql stable security definer set search_path = public as $$
  select papel from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_parceiro_aprovado() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel in ('parceiro','admin') and (papel = 'admin' or status_parceiro = 'aprovado')
                   from public.profiles where id = auth.uid()), false)
$$;

-- cria profile ao registrar usuário (papel sempre 'parceiro' pendente; admin/cliente definidos no servidor)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, email, telefone, creci, imobiliaria)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.email,
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'creci',
    new.raw_user_meta_data->>'imobiliaria'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ============ EMPREENDIMENTOS ============
create table public.empreendimentos (
  id uuid primary key default gen_random_uuid(),
  wp_id integer unique,                    -- id original no WordPress (migração)
  slug text not null unique,
  nome text not null,
  chamada text,                            -- ex.: "More ao lado de tudo"
  titulo_hero text,
  descricao text,
  descricao_lazer text,
  estagio public.estagio_empreendimento not null default 'lancamento',
  pais text not null default 'Brasil',
  categoria text default 'Residencial',
  construtora text default 'Arken',
  endereco text,
  bairro text,
  cidade text default 'São Paulo',
  uf text default 'SP',
  cep text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  texto_localizacao text,
  dormitorios text,                        -- "1-2 dorms"
  metragem text,                           -- "52-55m²"
  previsao_entrega date,
  tagline text,                            -- frase curta do hero
  titulo_lazer text,
  titulo_localizacao text,
  perspectiva_url text,
  tour_virtual_url text,                   -- iframe do tour 360°
  waze_url text,
  mostrar_no_portfolio boolean not null default false,
  vagas text,                              -- "15 vagas" / "0-1"
  total_unidades integer,
  aceita_fgts boolean not null default false,
  capa_url text,
  logo_url text,
  videos text[] not null default '{}',     -- URLs do YouTube
  destaque_home boolean not null default false,
  publicado boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.empreendimentos (estagio) where publicado;

create table public.empreendimento_midias (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  tipo public.tipo_midia not null,
  url text not null,
  legenda text,
  ordem integer not null default 0
);
create index on public.empreendimento_midias (empreendimento_id, tipo, ordem);

create table public.empreendimento_lazer (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  titulo text not null,
  descricao text,
  icone text,
  imagem_url text,
  ordem integer not null default 0
);
create index on public.empreendimento_lazer (empreendimento_id, ordem);

create table public.empreendimento_proximidades (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  nome text not null,
  distancia text,
  tempo_pe text,
  tempo_carro text,
  tempo_transporte text,
  tempo_bike text,
  foto_url text,
  ordem integer not null default 0
);

create table public.empreendimento_ficha (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  titulo text not null,                    -- "TORRES: 1"
  descricao text,
  icone_url text,
  ordem integer not null default 0
);
create index on public.empreendimento_ficha (empreendimento_id, ordem);
create index on public.empreendimento_proximidades (empreendimento_id, ordem);

-- andamento de obra (exibido no portal do cliente)
create table public.obra_atualizacoes (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  percentual smallint check (percentual between 0 and 100),
  titulo text not null,
  descricao text,
  fotos text[] not null default '{}',
  data date not null default current_date,
  created_at timestamptz not null default now()
);
create index on public.obra_atualizacoes (empreendimento_id, data desc);

-- tabela de unidades/preços (só parceiros aprovados e admin)
create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  identificador text not null,             -- "APTO 01"
  metragem numeric(8,2),
  valor numeric(14,2),
  dormitorios smallint,
  andar text,
  status public.status_unidade not null default 'disponivel',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.unidades (empreendimento_id, status);

-- ============ PARCEIROS ============
create table public.parceiro_clientes (
  id uuid primary key default gen_random_uuid(),
  parceiro_id uuid not null references public.profiles(id) on delete cascade,
  nome text not null,
  rg text,
  cpf text,
  telefone text not null,
  anotacoes text,
  interesses text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.parceiro_clientes (parceiro_id, created_at desc);

create table public.propostas (
  id uuid primary key default gen_random_uuid(),
  parceiro_id uuid not null references public.profiles(id) on delete cascade,
  empreendimento_id uuid not null references public.empreendimentos(id) on delete restrict,
  parceiro_cliente_id uuid references public.parceiro_clientes(id) on delete set null,
  unidade_id uuid references public.unidades(id) on delete set null,
  texto text not null,
  status public.status_proposta not null default 'enviada',
  resposta_admin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.propostas (parceiro_id, created_at desc);

-- ============ PORTAL DO CLIENTE ============
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  nome text not null,
  cpf text not null unique,               -- somente dígitos
  email text,
  telefone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cliente_negocios (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  unidade_id uuid references public.unidades(id) on delete set null,
  descricao text,
  status text default 'ativo',
  valor numeric(14,2),
  created_at timestamptz not null default now()
);

create table public.cliente_arquivos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  negocio_id uuid references public.cliente_negocios(id) on delete set null,
  nome text not null,
  storage_path text not null,             -- bucket 'cliente-arquivos'
  created_at timestamptz not null default now()
);

-- contatos do site público
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text,
  telefone text,
  mensagem text,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  origem text default 'site',
  created_at timestamptz not null default now()
);

-- updated_at triggers
do $$ declare t text; begin
  foreach t in array array['profiles','empreendimentos','unidades','parceiro_clientes','propostas','clientes'] loop
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ============ RLS ============
alter table public.profiles enable row level security;
alter table public.empreendimentos enable row level security;
alter table public.empreendimento_midias enable row level security;
alter table public.empreendimento_lazer enable row level security;
alter table public.empreendimento_proximidades enable row level security;
alter table public.empreendimento_ficha enable row level security;
alter table public.unidades enable row level security;
alter table public.obra_atualizacoes enable row level security;
alter table public.parceiro_clientes enable row level security;
alter table public.propostas enable row level security;
alter table public.clientes enable row level security;
alter table public.cliente_negocios enable row level security;
alter table public.cliente_arquivos enable row level security;
alter table public.leads enable row level security;

-- profiles
create policy "profile: ler o próprio" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profile: admin gerencia" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
-- usuário edita só dados de contato (papel/status protegidos por trigger abaixo)
create policy "profile: editar o próprio" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.protege_campos_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.papel := old.papel;
    new.status_parceiro := old.status_parceiro;
  end if;
  return new;
end $$;
create trigger protege_profile before update on public.profiles
for each row execute function public.protege_campos_profile();

-- conteúdo público
create policy "emp: público lê publicados" on public.empreendimentos for select using (publicado or public.is_admin());
create policy "emp: admin" on public.empreendimentos for all using (public.is_admin()) with check (public.is_admin());

create policy "midias: leitura" on public.empreendimento_midias for select using (true);
create policy "midias: admin" on public.empreendimento_midias for all using (public.is_admin()) with check (public.is_admin());
create policy "lazer: leitura" on public.empreendimento_lazer for select using (true);
create policy "lazer: admin" on public.empreendimento_lazer for all using (public.is_admin()) with check (public.is_admin());
create policy "prox: leitura" on public.empreendimento_proximidades for select using (true);
create policy "ficha: leitura" on public.empreendimento_ficha for select using (true);
create policy "ficha: admin" on public.empreendimento_ficha for all using (public.is_admin()) with check (public.is_admin());
create policy "prox: admin" on public.empreendimento_proximidades for all using (public.is_admin()) with check (public.is_admin());

-- materiais de venda (link do Drive etc.) ficam em tabela separada, só p/ parceiros
create table public.empreendimento_materiais (
  empreendimento_id uuid primary key references public.empreendimentos(id) on delete cascade,
  drive_url text,
  observacoes text
);
alter table public.empreendimento_materiais enable row level security;
create policy "mat: parceiros leem" on public.empreendimento_materiais for select using (public.is_parceiro_aprovado());
create policy "mat: admin" on public.empreendimento_materiais for all using (public.is_admin()) with check (public.is_admin());

-- unidades: parceiros aprovados
create policy "unid: parceiros leem" on public.unidades for select using (public.is_parceiro_aprovado());
create policy "unid: admin" on public.unidades for all using (public.is_admin()) with check (public.is_admin());

-- andamento da obra: admin gerencia; cliente vê obras dos seus negócios; parceiros aprovados veem todas
create policy "obra: admin" on public.obra_atualizacoes for all using (public.is_admin()) with check (public.is_admin());
create policy "obra: leitura" on public.obra_atualizacoes for select using (
  public.is_parceiro_aprovado() or exists (
    select 1 from public.cliente_negocios n join public.clientes c on c.id = n.cliente_id
    where n.empreendimento_id = obra_atualizacoes.empreendimento_id and c.user_id = auth.uid()
  )
);

-- clientes do parceiro
create policy "pc: dono" on public.parceiro_clientes for all
  using (parceiro_id = auth.uid() or public.is_admin())
  with check ((parceiro_id = auth.uid() and public.is_parceiro_aprovado()) or public.is_admin());

-- propostas
create policy "prop: dono lê" on public.propostas for select using (parceiro_id = auth.uid() or public.is_admin());
create policy "prop: parceiro cria" on public.propostas for insert
  with check (parceiro_id = auth.uid() and public.is_parceiro_aprovado() and status = 'enviada');
create policy "prop: admin" on public.propostas for all using (public.is_admin()) with check (public.is_admin());

-- portal do cliente
create policy "cli: próprio" on public.clientes for select using (user_id = auth.uid() or public.is_admin());
create policy "cli: admin" on public.clientes for all using (public.is_admin()) with check (public.is_admin());
create policy "neg: próprio" on public.cliente_negocios for select
  using (public.is_admin() or exists (select 1 from public.clientes c where c.id = cliente_id and c.user_id = auth.uid()));
create policy "neg: admin" on public.cliente_negocios for all using (public.is_admin()) with check (public.is_admin());
create policy "arq: próprio" on public.cliente_arquivos for select
  using (public.is_admin() or exists (select 1 from public.clientes c where c.id = cliente_id and c.user_id = auth.uid()));
create policy "arq: admin" on public.cliente_arquivos for all using (public.is_admin()) with check (public.is_admin());

-- leads: qualquer um envia, só admin lê
create policy "leads: inserir" on public.leads for insert with check (true);
create policy "leads: admin" on public.leads for select using (public.is_admin());

-- ============ STORAGE ============
insert into storage.buckets (id, name, public) values
  ('empreendimentos', 'empreendimentos', true),
  ('cliente-arquivos', 'cliente-arquivos', false)
on conflict (id) do nothing;

create policy "storage emp: admin escreve" on storage.objects for all
  using (bucket_id = 'empreendimentos' and public.is_admin())
  with check (bucket_id = 'empreendimentos' and public.is_admin());

-- arquivos do cliente: caminho = <cliente_id>/<arquivo>
create policy "storage cli: dono lê" on storage.objects for select using (
  bucket_id = 'cliente-arquivos' and (
    public.is_admin() or exists (
      select 1 from public.clientes c
      where c.user_id = auth.uid() and c.id::text = (storage.foldername(name))[1]
    )
  )
);
create policy "storage cli: admin escreve" on storage.objects for all
  using (bucket_id = 'cliente-arquivos' and public.is_admin())
  with check (bucket_id = 'cliente-arquivos' and public.is_admin());
