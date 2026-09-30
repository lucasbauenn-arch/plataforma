-- Imóveis de terceiros (docs/ARQUITETURA_EXPANSAO.md §3.7, §3.10, §4.2, §8.1; docs_new/modulo-imobiliario.md).
-- Entidade separada de empreendimentos/unidades. Status RA → PE → RE → AP → NC só por _transicionar (09).
-- IMV-2 (campos obrigatórios) é validado na saída do rascunho, não aqui: o rascunho pode ficar incompleto.
-- RLS ligada; políticas (regra E4) e as do bucket na 20260929000009 (pode_ver_imovel / pode_editar_imovel).

-- ============ TIPOS (E3 ⚑) ============
create table public.imovel_tipos (
  codigo text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,39}$'),
  rotulo text not null check (length(btrim(rotulo)) between 2 and 60),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null
);
insert into public.imovel_tipos (codigo, rotulo) values
  ('casa', 'Casa'),
  ('apartamento', 'Apartamento'),
  ('terreno', 'Terreno');
create trigger carimbar before insert or update on public.imovel_tipos
  for each row execute function public.carimbar();
create trigger auditar_linha after insert or update or delete on public.imovel_tipos
  for each row execute function public.auditar_linha('rotulo,ativo', 'configuracao', 'valores', 'codigo');

-- ============ IMÓVEIS ============
create table public.imoveis (
  id uuid primary key default gen_random_uuid(),
  codigo bigint generated always as identity unique,            -- exibido como #0000007
  nome text check (length(nome) <= 200),
  matricula text check (length(matricula) <= 100),
  tipo text references public.imovel_tipos(codigo),
  descricao text check (length(descricao) <= 10000),
  status public.status_imovel not null default 'rascunho',
  -- endereço
  cep text check (cep ~ '^\d{8}$'),
  pais text not null default 'Brasil' check (length(btrim(pais)) between 2 and 60),
  uf char(2) check (uf ~ '^[A-Z]{2}$'),
  cidade text check (length(cidade) <= 100),
  bairro text check (length(bairro) <= 100),
  logradouro text check (length(logradouro) <= 200),
  numero text check (length(numero) <= 20),
  complemento text check (length(complemento) <= 100),
  -- características
  valor numeric(14,2) check (valor is null or valor > 0),
  area_total numeric(10,2) check (area_total is null or area_total > 0),
  area_construida numeric(10,2) check (area_construida is null or area_construida > 0),
  idade_anos smallint check (idade_anos is null or idade_anos between 0 and 500),
  andar text check (length(andar) <= 20),
  quartos smallint check (quartos is null or quartos between 0 and 100),
  banheiros smallint check (banheiros is null or banheiros between 0 and 100),
  suites smallint check (suites is null or suites between 0 and 100),
  vagas smallint check (vagas is null or vagas between 0 and 1000),
  adicionais text[] not null default '{}'
    check (adicionais <@ array['churrasqueira', 'ar_condicionado', 'perto_metro', 'perto_parque', 'perto_onibus',
                               'piscina', 'aceita_pet']::text[]),              -- "Chip" fica fora (E5)
  observacao_revisao text check (length(observacao_revisao) <= 2000),
  -- autoria e cadeia do criador (derivada pelo gatilho imoveis_cadeia; base da visibilidade E4 para cima)
  criado_por uuid not null default auth.uid() references public.profiles(id),
  criado_por_parceiro_id uuid references public.parceiros(id),
  imobiliaria_id uuid references public.imobiliarias(id),
  gerente_id uuid references public.parceiros(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  inativado_em timestamptz,
  inativado_por uuid references public.profiles(id) on delete set null,
  motivo_inativacao text check (length(motivo_inativacao) <= 2000)
);
create index imoveis_status_idx on public.imoveis (status);
create index imoveis_criado_por_idx on public.imoveis (criado_por);
create index imoveis_imobiliaria_idx on public.imoveis (imobiliaria_id);
create index imoveis_gerente_idx on public.imoveis (gerente_id);
create index imoveis_criador_parceiro_idx on public.imoveis (criado_por_parceiro_id);
create index imoveis_tipo_idx on public.imoveis (tipo);

-- ============ FOTOS ============
-- caminho no bucket imoveis: <imovel_id>/<uuid>.<ext> (+ miniatura <uuid>-min.<ext>); sem dado pessoal no nome
create table public.imovel_fotos (
  id uuid primary key default gen_random_uuid(),
  imovel_id uuid not null references public.imoveis(id),
  storage_path text not null unique
    check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-z-]{1,80}\.(webp|jpg|jpeg|png)$'),
  miniatura_path text unique
    check (miniatura_path ~ '^[0-9a-f-]{36}/[0-9a-z-]{1,80}\.(webp|jpg|jpeg|png)$'),
  ordem smallint not null default 0 check (ordem >= 0),
  largura int check (largura > 0),
  altura int check (altura > 0),
  bytes int check (bytes > 0),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = imovel_id::text),
  check (miniatura_path is null or split_part(miniatura_path, '/', 1) = imovel_id::text)
);
create index imovel_fotos_imovel_idx on public.imovel_fotos (imovel_id, ordem);
create trigger carimbar before insert or update on public.imovel_fotos
  for each row execute function public.carimbar();

-- ============ GATILHOS DE IMÓVEIS ============
-- imoveis_cadeia (BEFORE): o parceiro criador é fixado no cadastro (parceiro ativo do criado_por; interno = nenhum);
-- imobiliaria_id e gerente_id são sempre derivados dele e o que for enviado é descartado.
-- gerente_id: o gerente do corretor criador, ou o próprio gerente quando é ele quem cadastra.
create function public._imoveis_cadeia() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_parc public.parceiros%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_parc from public.parceiros p
    where p.profile_id = new.criado_por and p.inativado_em is null;
    new.criado_por_parceiro_id := v_parc.id;
  else
    new.criado_por_parceiro_id := old.criado_por_parceiro_id;
    if new.criado_por_parceiro_id is not null then
      select * into v_parc from public.parceiros p where p.id = new.criado_por_parceiro_id;
    end if;
  end if;
  if new.criado_por_parceiro_id is null then
    new.imobiliaria_id := null;
    new.gerente_id := null;
  else
    new.imobiliaria_id := v_parc.imobiliaria_id;
    new.gerente_id := case v_parc.tipo when 'corretor' then v_parc.gerente_id when 'gerente' then v_parc.id end;
  end if;
  return new;
end $$;

-- imoveis_valor_bloqueado (IMV-3): o valor não muda em no_contrato (nem na entrada nesse status).
create function public._imoveis_valor_bloqueado() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.valor is distinct from old.valor and (old.status = 'no_contrato' or new.status = 'no_contrato') then
    raise exception 'O valor de um imóvel em contrato não pode ser alterado' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger carimbar before insert or update on public.imoveis
  for each row execute function public.carimbar();
create trigger imoveis_cadeia before insert or update on public.imoveis
  for each row execute function public._imoveis_cadeia();
create trigger imoveis_valor_bloqueado before update on public.imoveis
  for each row execute function public._imoveis_valor_bloqueado();
-- gravações diretas pela API (cadastro e edição pelo criador): só os nomes dos campos
create trigger auditar_linha after insert or update on public.imoveis
  for each row execute function public.auditar_linha('*', 'operacao', 'nomes', 'id');

-- cascata da rede (§3.3): quando o parceiro criador muda de gerente ou imobiliária, a cadeia dos imóveis dele
-- acompanha na mesma transação (o gatilho imoveis_cadeia recalcula a partir do parceiro).
create function public._parceiros_cascata_imoveis() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.gerente_id is distinct from old.gerente_id or new.imobiliaria_id is distinct from old.imobiliaria_id then
    update public.imoveis i
       set imobiliaria_id = new.imobiliaria_id,
           gerente_id = case new.tipo when 'corretor' then new.gerente_id when 'gerente' then new.id end
     where i.criado_por_parceiro_id = new.id;
  end if;
  return null;
end $$;
create trigger parceiros_cascata_imoveis after update of gerente_id, imobiliaria_id on public.parceiros
  for each row execute function public._parceiros_cascata_imoveis();

-- ============ STORAGE (§3.10): bucket privado, URL assinada; políticas na 09 ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('imoveis', 'imoveis', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============ RLS (políticas na 20260929000009) ============
alter table public.imovel_tipos enable row level security;
alter table public.imoveis enable row level security;
alter table public.imovel_fotos enable row level security;

-- ============ GRANTS (§4.2, §4.3) ============
revoke all on public.imovel_tipos, public.imoveis, public.imovel_fotos from anon, authenticated, service_role;

-- tipos: todos os logados leem; o Super inclui e edita (política is_super na 09)
grant select on public.imovel_tipos to authenticated;
grant insert (codigo, rotulo, ativo), update (rotulo, ativo) on public.imovel_tipos to authenticated;

-- imóveis: leitura pela regra E4; cadastro e edição só nas colunas editáveis (sem status, codigo, criado_por,
-- cadeia, observacao_revisao nem inativação: esses mudam por RPC)
grant select on public.imoveis to authenticated;
grant insert (nome, matricula, tipo, descricao, cep, pais, uf, cidade, bairro, logradouro, numero, complemento, valor,
              area_total, area_construida, idade_anos, andar, quartos, banheiros, suites, vagas, adicionais)
  on public.imoveis to authenticated;
grant update (nome, matricula, tipo, descricao, cep, pais, uf, cidade, bairro, logradouro, numero, complemento, valor,
              area_total, area_construida, idade_anos, andar, quartos, banheiros, suites, vagas, adicionais)
  on public.imoveis to authenticated;

-- fotos: leitura segue o imóvel; escrita por RPC (imovel_foto_*)
grant select on public.imovel_fotos to authenticated;

grant select, insert, update, delete on public.imovel_tipos, public.imoveis, public.imovel_fotos to service_role;

revoke execute on function public._imoveis_cadeia(), public._imoveis_valor_bloqueado(),
  public._parceiros_cascata_imoveis()
  from public, anon, authenticated, service_role;
