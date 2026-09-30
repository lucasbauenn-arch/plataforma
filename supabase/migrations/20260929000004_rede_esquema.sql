-- Rede de parceiros (docs/ARQUITETURA_EXPANSAO.md §2.2, §2.3, §3.3, §8.1).
-- imobiliarias (organização) → parceiros (imobiliaria | gerente | corretor) com histórico de vínculos.
-- A verdade é o pai direto (parceiros.gerente_id); imobiliaria_id do corretor é derivada por gatilho.
-- Semente da casa (A4): Imobiliária Arken + Gerência Arken + Carteira Arken, virtuais e sem login.
-- RLS ligada; políticas para authenticated na 20260929000009. Escrita só por RPC (20260929000010) e service role.
-- A cascata para clientes/propostas (20260929000006) e contratos (20260929000007) entra nessas migrations,
-- como gatilhos próprios em parceiros; a de imóveis está na 20260929000005.

-- ============ IMOBILIÁRIAS ============
create table public.imobiliarias (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 2 and 200),
  razao_social text check (length(btrim(razao_social)) between 2 and 200),
  cnpj text unique check (cnpj ~ '^\d{14}$' and public.cnpj_valido(cnpj)),
  creci_pj text check (length(btrim(creci_pj)) between 1 and 60),
  email text check (length(email) <= 200),
  telefone text check (length(telefone) <= 30),
  cep text check (cep ~ '^\d{8}$'),
  logradouro text check (length(logradouro) <= 200),
  numero text check (length(numero) <= 20),
  complemento text check (length(complemento) <= 100),
  bairro text check (length(bairro) <= 100),
  cidade text check (length(cidade) <= 100),
  uf char(2) check (uf ~ '^[A-Z]{2}$'),
  da_casa boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  inativado_em timestamptz,
  inativado_por uuid references public.profiles(id) on delete set null,
  motivo_inativacao text check (length(motivo_inativacao) <= 2000),
  check (da_casa or (cnpj is not null and creci_pj is not null))                 -- PAR-4 (a casa: ⚑ N7)
);
create unique index imobiliarias_uma_casa on public.imobiliarias ((true)) where da_casa;

-- ============ PARCEIROS ============
create table public.parceiros (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,     -- existe antes do convite; virtuais nunca têm
  tipo public.tipo_parceiro not null,
  imobiliaria_id uuid not null references public.imobiliarias(id),
  gerente_id uuid references public.parceiros(id),
  nome text not null check (btrim(nome) <> '' and length(nome) <= 200),
  cpf text unique check (cpf ~ '^\d{11}$' and public.cpf_valido(cpf)),
  creci text check (length(creci) <= 60),
  email text check (length(email) <= 200),
  telefone text check (length(telefone) <= 30),
  codigo_indicacao text unique check (codigo_indicacao ~ '^[a-z2-7]{10}$'),      -- aleatório (50 bits), nunca o id
  virtual boolean not null default false,
  migrado_legado boolean not null default false,
  imobiliaria_declarada text check (length(imobiliaria_declarada) <= 200),        -- texto livre do cadastro antigo
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  inativado_em timestamptz,
  inativado_por uuid references public.profiles(id) on delete set null,
  motivo_inativacao text check (length(motivo_inativacao) <= 2000),
  check ((tipo = 'corretor') = (gerente_id is not null)),
  check (gerente_id is distinct from id),
  check (virtual or migrado_legado or tipo = 'imobiliaria' or cpf is not null),   -- PAR-4 (gerente e corretor: CPF)
  check (tipo <> 'corretor' or virtual or migrado_legado or creci is not null),   -- PAR-4 (corretor: CRECI PF)
  check (not virtual or profile_id is null)
);
create index parceiros_imob_idx on public.parceiros (imobiliaria_id, tipo) where inativado_em is null;
create index parceiros_ger_idx on public.parceiros (gerente_id) where inativado_em is null;

-- ============ HISTÓRICO DE VÍNCULOS (somente inclusão, fechado por vigente_ate) ============
create table public.parceiro_vinculos_historico (
  id bigint generated always as identity primary key,
  parceiro_id uuid not null references public.parceiros(id),
  imobiliaria_id uuid not null references public.imobiliarias(id),
  gerente_id uuid references public.parceiros(id),
  vigente_de timestamptz not null default now(),
  vigente_ate timestamptz,
  motivo text check (length(motivo) <= 500),
  alterado_por uuid references public.profiles(id) on delete set null,
  check (vigente_ate is null or vigente_ate >= vigente_de)
);
create unique index parceiro_vinculos_vigente_idx on public.parceiro_vinculos_historico (parceiro_id) where vigente_ate is null;
create index parceiro_vinculos_parceiro_idx on public.parceiro_vinculos_historico (parceiro_id, vigente_de desc);
create index parceiro_vinculos_gerente_idx on public.parceiro_vinculos_historico (gerente_id) where gerente_id is not null;
create trigger somente_inclusao before update or delete on public.parceiro_vinculos_historico
  for each row execute function public._somente_inclusao('vigente_ate');

-- ============ CONFIGURAÇÃO: FKs da casa (as colunas nasceram na 02, sem FK) ============
alter table public.configuracao_geral
  add constraint cg_imob_casa foreign key (imobiliaria_casa_id) references public.imobiliarias(id),
  add constraint cg_ger_casa  foreign key (gerente_casa_id)     references public.parceiros(id),
  add constraint cg_cor_casa  foreign key (corretor_casa_id)    references public.parceiros(id);

-- ============ GATILHOS ============
-- imobiliárias: da_casa não muda; a casa não é inativada; inativar exige não ter parceiro ativo.
create function public._imobiliarias_protege() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.da_casa is distinct from old.da_casa then
    raise exception 'A marcação da imobiliária da casa não muda' using errcode = '23514';
  end if;
  if old.inativado_em is null and new.inativado_em is not null then
    if new.da_casa then
      raise exception 'A imobiliária da casa não pode ser inativada' using errcode = '23514';
    end if;
    if exists (select 1 from public.parceiros p where p.imobiliaria_id = new.id and p.inativado_em is null) then
      raise exception 'Inative ou transfira os parceiros ativos antes de inativar a imobiliária' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- parceiros_valida_cadeia (BEFORE):
--  * tipo e virtual não mudam; a imobiliária de um gerente não muda (⚑; para trocar, cria-se outro gerente);
--  * corretor: gerente_id aponta para um gerente (ativo quando o vínculo é criado, trocado ou reativado);
--    imobiliaria_id é derivada do gerente e o valor enviado é descartado;
--  * a imobiliária precisa estar ativa ao cadastrar, trocar ou reativar; virtual só na imobiliária da casa;
--  * a cadeia da casa (Gerência e Carteira Arken) não é movida nem inativada;
--  * gerente só é inativado sem corretor ativo (a RPC transfere antes).
create function public._parceiros_valida_cadeia() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ger public.parceiros%rowtype;
  v_imob public.imobiliarias%rowtype;
  v_casa boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.tipo is distinct from old.tipo then
      raise exception 'O tipo do parceiro não muda depois de criado' using errcode = '23514';
    end if;
    if new.virtual is distinct from old.virtual then
      raise exception 'A marcação de parceiro virtual não muda' using errcode = '23514';
    end if;
    if new.tipo = 'gerente' and new.imobiliaria_id is distinct from old.imobiliaria_id then
      raise exception 'A imobiliária de um gerente não muda; cadastre outro gerente' using errcode = '23514';
    end if;
    select exists (select 1 from public.configuracao_geral c where old.id in (c.gerente_casa_id, c.corretor_casa_id))
      into v_casa;
  end if;

  if new.tipo = 'corretor' then
    select * into v_ger from public.parceiros g where g.id = new.gerente_id;
    if not found or v_ger.tipo <> 'gerente' then
      raise exception 'O corretor precisa estar vinculado a um gerente' using errcode = '23514';
    end if;
    if (tg_op = 'INSERT' or new.gerente_id is distinct from old.gerente_id
        or (old.inativado_em is not null and new.inativado_em is null))
       and v_ger.inativado_em is not null then
      raise exception 'O gerente informado está inativo' using errcode = '23514';
    end if;
    new.imobiliaria_id := v_ger.imobiliaria_id;
  end if;

  if tg_op = 'INSERT' or new.imobiliaria_id is distinct from old.imobiliaria_id
     or (old.inativado_em is not null and new.inativado_em is null) then
    select * into v_imob from public.imobiliarias i where i.id = new.imobiliaria_id;
    if not found then
      raise exception 'Imobiliária não encontrada' using errcode = '23503';
    end if;
    if v_imob.inativado_em is not null then
      raise exception 'A imobiliária está inativa' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and new.virtual and not v_imob.da_casa then
      raise exception 'Parceiro virtual só existe na imobiliária da casa' using errcode = '23514';
    end if;
  end if;

  if v_casa and (new.gerente_id is distinct from old.gerente_id or new.imobiliaria_id is distinct from old.imobiliaria_id
                 or new.inativado_em is not null) then
    raise exception 'A cadeia da casa não pode ser movida nem inativada' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.tipo = 'gerente' and old.inativado_em is null and new.inativado_em is not null
     and exists (select 1 from public.parceiros p where p.gerente_id = new.id and p.inativado_em is null) then
    raise exception 'Transfira os corretores antes de inativar o gerente' using errcode = '23514';
  end if;
  return new;
end $$;

-- parceiros_cascata_cadeia (AFTER): abre e fecha parceiro_vinculos_historico no cadastro, na troca de gerente ou
-- imobiliária, na inativação e na reativação. O motivo vem de arken.motivo_vinculo (a RPC liga localmente com
-- set_config(..., true)); sem ele, um motivo padrão. As cascatas para as tabelas filhas são gatilhos próprios.
create function public._parceiros_historico() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := left(nullif(btrim(current_setting('arken.motivo_vinculo', true)), ''), 500);
begin
  if tg_op = 'INSERT' then
    if new.inativado_em is null then
      insert into public.parceiro_vinculos_historico (parceiro_id, imobiliaria_id, gerente_id, motivo, alterado_por)
      values (new.id, new.imobiliaria_id, new.gerente_id, coalesce(v_motivo, 'cadastro'), auth.uid());
    end if;
    return null;
  end if;

  if new.imobiliaria_id is not distinct from old.imobiliaria_id
     and new.gerente_id is not distinct from old.gerente_id
     and (new.inativado_em is null) = (old.inativado_em is null) then
    return null;
  end if;
  update public.parceiro_vinculos_historico h set vigente_ate = now()
  where h.parceiro_id = new.id and h.vigente_ate is null;
  if new.inativado_em is null then
    insert into public.parceiro_vinculos_historico (parceiro_id, imobiliaria_id, gerente_id, motivo, alterado_por)
    values (new.id, new.imobiliaria_id, new.gerente_id,
            coalesce(v_motivo, case when old.inativado_em is not null then 'reativacao' else 'alteracao' end), auth.uid());
  end if;
  return null;
end $$;

-- parceiros_sincroniza_profile: a saudação do painel usa profiles.nome. Copia o nome e, se houver, o telefone.
create function public._parceiros_sincroniza_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.profile_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.profile_id is not distinct from old.profile_id
     and new.nome is not distinct from old.nome and new.telefone is not distinct from old.telefone then
    return null;
  end if;
  update public.profiles pr
     set nome = new.nome, telefone = coalesce(new.telefone, pr.telefone)
   where pr.id = new.profile_id
     and (pr.nome is distinct from new.nome or pr.telefone is distinct from coalesce(new.telefone, pr.telefone));
  return null;
end $$;

create trigger carimbar before insert or update on public.imobiliarias
  for each row execute function public.carimbar();
create trigger imobiliarias_protege before update on public.imobiliarias
  for each row execute function public._imobiliarias_protege();
create trigger auditar_linha after insert or update on public.imobiliarias
  for each row execute function public.auditar_linha('*', 'operacao', 'nomes', 'id');

create trigger carimbar before insert or update on public.parceiros
  for each row execute function public.carimbar();
create trigger parceiros_valida_cadeia before insert or update on public.parceiros
  for each row execute function public._parceiros_valida_cadeia();
create trigger parceiros_cascata_cadeia after insert or update of gerente_id, imobiliaria_id, inativado_em on public.parceiros
  for each row execute function public._parceiros_historico();
create trigger parceiros_sincroniza_profile after insert or update of nome, telefone, profile_id on public.parceiros
  for each row execute function public._parceiros_sincroniza_profile();
create trigger auditar_linha after insert or update on public.parceiros
  for each row execute function public.auditar_linha('*', 'operacao', 'nomes', 'id');

-- ============ _auditar v2: preenche ator_parceiro_id (mesma assinatura da 02) ============
create or replace function public._auditar(
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
  v_parceiro uuid;
  v_cab jsonb;
  v_ip inet;
  v_ua text;
begin
  if v_uid is not null then
    select pr.papel into v_papel from public.profiles pr where pr.id = v_uid;
    select p.id into v_parceiro from public.parceiros p where p.profile_id = v_uid;
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
          v_parceiro, coalesce(p_origem, 'rpc'), p_campos, p_antes, p_depois, coalesce(p_detalhe, '{}'::jsonb), v_ip, v_ua);
end $$;

-- ============ CÓDIGO DE INDICAÇÃO ============
-- 10 caracteres base32 minúsculos (50 bits aleatórios), único. Interna: rede_gerar_codigo_indicacao (WP1) usa.
create function public._gerar_codigo_indicacao() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_alfabeto constant text := 'abcdefghijklmnopqrstuvwxyz234567';
  v_bytes bytea;
  v_codigo text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(10);
    select string_agg(substr(v_alfabeto, get_byte(v_bytes, i) % 32 + 1, 1), '' order by i) into v_codigo
    from generate_series(0, 9) i;
    exit when not exists (select 1 from public.parceiros p where p.codigo_indicacao = v_codigo);
  end loop;
  return v_codigo;
end $$;

-- ============ SEMENTE DA CASA (§2.3, A4 ⚑) ============
do $$
declare
  v_imob uuid;
  v_ger uuid;
  v_cor uuid;
begin
  insert into public.imobiliarias (nome, da_casa) values ('Imobiliária Arken', true) returning id into v_imob;
  insert into public.parceiros (tipo, imobiliaria_id, nome, virtual)
    values ('gerente', v_imob, 'Gerência Arken', true) returning id into v_ger;
  insert into public.parceiros (tipo, imobiliaria_id, gerente_id, nome, virtual, codigo_indicacao)
    values ('corretor', v_imob, v_ger, 'Carteira Arken', true, public._gerar_codigo_indicacao()) returning id into v_cor;
  update public.configuracao_geral
     set imobiliaria_casa_id = v_imob, gerente_casa_id = v_ger, corretor_casa_id = v_cor;
end $$;

alter table public.configuracao_geral
  alter column imobiliaria_casa_id set not null,
  alter column gerente_casa_id set not null,
  alter column corretor_casa_id set not null;

-- ============ RLS (políticas na 20260929000009) ============
alter table public.imobiliarias enable row level security;
alter table public.parceiros enable row level security;
alter table public.parceiro_vinculos_historico enable row level security;

-- ============ GRANTS (§4.2, §4.3) ============
revoke all on public.imobiliarias, public.parceiros, public.parceiro_vinculos_historico
  from anon, authenticated, service_role;
-- leitura por escopo (políticas na 09); escrita só por RPC
grant select on public.imobiliarias to authenticated;
-- sem a coluna cpf: o CPF de parceiro só sai por rede_parceiro_detalhe (auditada)
grant select (id, profile_id, tipo, imobiliaria_id, gerente_id, nome, creci, email, telefone, codigo_indicacao,
              virtual, migrado_legado, imobiliaria_declarada, criado_em, inativado_em)
  on public.parceiros to authenticated;
grant select, insert, update, delete on public.imobiliarias, public.parceiros to service_role;
grant select, insert on public.parceiro_vinculos_historico to service_role;

revoke execute on function public._imobiliarias_protege(), public._parceiros_valida_cadeia(),
  public._parceiros_historico(), public._parceiros_sincroniza_profile(), public._gerar_codigo_indicacao()
  from public, anon, authenticated, service_role;
