-- CRM (docs/ARQUITETURA_EXPANSAO.md §2.4, §3.4, §3.5, §3.10, §8.1).
-- `clientes` (a tabela do portal, estendida) é o núcleo do CRM: uma pessoa = um registro (CPF/CNPJ únicos, A2).
-- A verdade da cadeia é clientes.corretor_id; gerente_id e imobiliaria_id são derivados por gatilho e propagados
-- em cascata (para propostas aqui; para contratos na 20260929000007). Clientes atuais (portal) vão para a Carteira
-- Arken, com portal_liberado = true, e nunca trocam de dono na migração.
-- Tabelas de CRM sem grant para authenticated: tudo passa por RPC auditada (políticas e helpers na 09).
-- Nenhuma referência a objeto de migration posterior.

-- ============ CLIENTES (§3.4, alterações aditivas) ============
alter table public.clientes
  alter column cpf drop not null,                                   -- o unique continua; a tela antiga sempre envia
  add column tipo_pessoa public.tipo_pessoa not null default 'fisica',
  add column cnpj text unique check (cnpj ~ '^\d{14}$' and public.cnpj_valido(cnpj)),
  add column sobrenome text check (length(sobrenome) <= 200),
  add column rg text check (length(rg) <= 30),
  add column data_nascimento date check (data_nascimento >= date '1900-01-01'),
  add column genero public.genero,
  add column estado_civil public.estado_civil,
  add column nacionalidade text check (length(nacionalidade) <= 60),
  add column emails_adicionais text[] not null default '{}'
    check (cardinality(emails_adicionais) <= 10 and array_position(emails_adicionais, null) is null),
  add column telefones_adicionais text[] not null default '{}'
    check (cardinality(telefones_adicionais) <= 10 and array_position(telefones_adicionais, null) is null),
  add column horario_contato text check (length(horario_contato) <= 100),
  add column cep text check (cep ~ '^\d{8}$'),
  add column logradouro text check (length(logradouro) <= 200),
  add column numero text check (length(numero) <= 20),
  add column complemento text check (length(complemento) <= 100),
  add column bairro text check (length(bairro) <= 100),
  add column cidade text check (length(cidade) <= 100),
  add column uf char(2) check (uf ~ '^[A-Z]{2}$'),
  add column pais text not null default 'Brasil' check (length(btrim(pais)) between 2 and 60),
  add column interesses text[] not null default '{}'                -- mesmas opções de INTERESSES (validadas na RPC)
    check (cardinality(interesses) <= 40 and array_position(interesses, null) is null),
  add column imobiliaria_id uuid references public.imobiliarias(id),
  add column gerente_id uuid references public.parceiros(id),
  add column corretor_id uuid references public.parceiros(id),     -- NOT NULL a partir do corte (WP7)
  add column etapa public.etapa_funil not null default 'novo_contato',
  add column etapa_desde timestamptz not null default now(),
  add column motivo_perda text check (length(motivo_perda) <= 2000),
  add column origem public.origem_cliente not null default 'portal_admin', -- a tela antiga do admin não envia origem
  add column exclusividade_ate timestamptz,
  add column portal_liberado boolean not null default true,        -- preenche as linhas atuais (todas são do portal)…
  add column criado_por uuid references public.profiles(id) on delete set null,
  add column atualizado_por uuid references public.profiles(id) on delete set null,
  add column inativado_em timestamptz,
  add column inativado_por uuid references public.profiles(id) on delete set null,
  add column motivo_inativacao text check (length(motivo_inativacao) <= 2000),
  add column anonimizado_em timestamptz,
  add constraint clientes_doc_por_pessoa
    check ((tipo_pessoa = 'fisica' and cnpj is null) or (tipo_pessoa = 'juridica' and cpf is null)),
  add constraint clientes_doc_obrigatorio
    check (cpf is not null or cnpj is not null or origem = 'migracao_parceiro_clientes' or anonimizado_em is not null),
  add constraint clientes_perda_motivo check (etapa <> 'perdido' or motivo_perda is not null);
alter table public.clientes alter column portal_liberado set default false;   -- …e o padrão de agora em diante é FALSE

-- CPF com dígito verificador (A2; §2.4: CPF inválido não migra): gatilho clientes_cpf_valido, mais abaixo. Não é CHECK
-- de propósito: uma CHECK (mesmo NOT VALID) é conferida em TODO update da linha, então um cliente antigo do portal com
-- CPF fora do padrão derrubaria o backfill desta migration e qualquer gravação futura nele (cliente-login ligando o
-- user_id, cascata da rede, corte). O gatilho confere só a inclusão e a troca do CPF.

create index clientes_corretor_idx on public.clientes (corretor_id, etapa)    where inativado_em is null;
create index clientes_gerente_idx  on public.clientes (gerente_id, etapa)     where inativado_em is null;
create index clientes_imob_idx     on public.clientes (imobiliaria_id, etapa) where inativado_em is null;
create index clientes_corretor_fk_idx on public.clientes (corretor_id);

-- ============ HISTÓRICO DE VÍNCULOS DO CLIENTE (base do B5; somente inclusão, fechado por vigente_ate) ============
create table public.cliente_vinculos_historico (
  id bigint generated always as identity primary key,
  cliente_id uuid not null references public.clientes(id),
  imobiliaria_id uuid not null references public.imobiliarias(id),
  gerente_id uuid references public.parceiros(id),
  corretor_id uuid not null references public.parceiros(id),
  vigente_de timestamptz not null default now(),
  vigente_ate timestamptz,
  motivo text check (length(motivo) <= 500),
  alterado_por uuid references public.profiles(id) on delete set null,
  check (vigente_ate is null or vigente_ate >= vigente_de)
);
create unique index cliente_vinculos_vigente_idx on public.cliente_vinculos_historico (cliente_id) where vigente_ate is null;
create index cliente_vinculos_cliente_idx on public.cliente_vinculos_historico (cliente_id, vigente_de desc);
create index cliente_vinculos_corretor_idx on public.cliente_vinculos_historico (corretor_id, vigente_de);
create trigger somente_inclusao before update or delete on public.cliente_vinculos_historico
  for each row execute function public._somente_inclusao('vigente_ate');

-- ============ LEADS (§3.4) ============
alter table public.leads
  add column status public.status_lead not null default 'novo',
  add column cliente_id uuid references public.clientes(id),
  add column tratado_por uuid references public.profiles(id) on delete set null,
  add column tratado_em timestamptz,
  add column motivo_descarte text check (length(motivo_descarte) <= 2000),
  add constraint leads_convertido_cliente check (status <> 'convertido' or cliente_id is not null),
  add constraint leads_descarte_motivo check (status <> 'descartado' or motivo_descarte is not null);
create index leads_status_idx on public.leads (status, created_at desc);
create index leads_cliente_idx on public.leads (cliente_id) where cliente_id is not null;

-- exclusão só de lead ainda não tratado (spam/duplicado); convertido e descartado ficam como histórico
drop policy if exists "leads: admin exclui" on public.leads;
create policy "leads: admin exclui" on public.leads for delete
  using ((select public.is_admin()) and status = 'novo');

-- ============ PROPOSTAS (§3.4) ============
alter table public.propostas
  add column cliente_id uuid references public.clientes(id),
  add column imobiliaria_id uuid references public.imobiliarias(id),   -- anuláveis durante a transição
  add column gerente_id uuid references public.parceiros(id),
  add column corretor_id uuid references public.parceiros(id),
  add column atualizado_por uuid references public.profiles(id) on delete set null;
create index propostas_cliente_idx on public.propostas (cliente_id) where cliente_id is not null;
create index propostas_corretor_idx on public.propostas (corretor_id) where corretor_id is not null;
create index propostas_gerente_idx on public.propostas (gerente_id) where gerente_id is not null;
create index propostas_imobiliaria_idx on public.propostas (imobiliaria_id) where imobiliaria_id is not null;
-- §4.2 (até o corte): parceiro S/I, admin S/U. Ninguém exclui proposta pela API (a política "prop: admin" é FOR ALL).
revoke delete on public.propostas from authenticated;

-- ============ TABELAS DO CRM (§3.5) ============
-- notas: somente inclusão; a única alteração é a anonimização (texto → "[removido — LGPD]", removido_lgpd = true)
create table public.cliente_notas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id),
  texto text not null check (length(btrim(texto)) between 1 and 10000),
  autor_id uuid default auth.uid() references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  migrado_legado boolean not null default false,
  removido_lgpd boolean not null default false
);
create index cliente_notas_cliente_idx on public.cliente_notas (cliente_id, criado_em desc);
create index cliente_notas_autor_idx on public.cliente_notas (autor_id);

create table public.cliente_tarefas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id),
  titulo text not null check (length(btrim(titulo)) between 1 and 200),
  descricao text check (length(descricao) <= 2000),
  responsavel_id uuid references public.profiles(id) on delete set null,
  prazo date,
  status public.status_tarefa not null default 'pendente',
  concluida_em timestamptz,
  concluida_por uuid references public.profiles(id) on delete set null,
  removido_lgpd boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  inativado_em timestamptz,
  inativado_por uuid references public.profiles(id) on delete set null,
  motivo_inativacao text check (length(motivo_inativacao) <= 2000),
  check ((status = 'concluida') = (concluida_em is not null))
);
create index cliente_tarefas_responsavel_idx on public.cliente_tarefas (responsavel_id, status, prazo);
create index cliente_tarefas_cliente_idx on public.cliente_tarefas (cliente_id, status);

-- solicitações de documento (CRM-3): nome + formatos aceitos; o arquivo vem depois (versões em _arquivos)
create table public.cliente_documentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id),
  tipo public.tipo_documento not null default 'cliente',
  nome text not null check (length(btrim(nome)) between 2 and 120),
  formatos_aceitos text[] not null default array['jpeg', 'png', 'pdf']
    check (cardinality(formatos_aceitos) between 1 and 5
           and formatos_aceitos <@ array['jpeg', 'png', 'pdf', 'doc', 'planilha']::text[]),
  status public.status_documento not null default 'pendente',
  arquivo_atual_id uuid,                                           -- FK criada abaixo (referência circular)
  basico boolean not null default false,
  analisado_em timestamptz,
  analisado_por uuid references public.profiles(id) on delete set null,
  motivo_rejeicao text check (length(motivo_rejeicao) <= 2000),
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  inativado_em timestamptz,
  inativado_por uuid references public.profiles(id) on delete set null,
  motivo_inativacao text check (length(motivo_inativacao) <= 2000),
  check (status <> 'rejeitado' or motivo_rejeicao is not null)
);
-- CRM-3 idempotente: um básico de cada nome por cliente
create unique index cliente_documentos_basico_idx on public.cliente_documentos (cliente_id, nome)
  where basico and inativado_em is null;
create index cliente_documentos_cliente_idx on public.cliente_documentos (cliente_id, status);

-- versões enviadas (todas, inclusive as rejeitadas): somente inclusão; a única alteração é removido_em (anonimização)
-- caminho no bucket crm-documentos: <cliente_id>/<documento_id>/<uuid>.<ext> (sem dado pessoal no nome)
create table public.cliente_documento_arquivos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.cliente_documentos(id),
  storage_path text not null unique
    check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf|doc|docx|xls|xlsx|csv)$'
           and split_part(storage_path, '/', 2) = documento_id::text),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv')),
  tamanho_bytes int not null check (tamanho_bytes between 1 and 5242880),   -- ≤ bucket; o limite de config é da RPC
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  enviado_em timestamptz not null default now(),
  enviado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  removido_em timestamptz
);
create index cliente_documento_arquivos_documento_idx on public.cliente_documento_arquivos (documento_id, enviado_em desc);
alter table public.cliente_documentos
  add constraint cliente_documentos_arquivo_atual_fk foreign key (arquivo_atual_id)
  references public.cliente_documento_arquivos(id);
create index cliente_documentos_arquivo_atual_idx on public.cliente_documentos (arquivo_atual_id)
  where arquivo_atual_id is not null;

-- timeline (F3): somente inclusão; título e dados sem dado pessoal (ids, etapas, status, motivo)
create table public.cliente_eventos (
  id bigint generated always as identity primary key,
  cliente_id uuid not null references public.clientes(id),
  tipo text not null check (tipo in (
    'cadastro', 'pre_cadastro', 'etapa', 'nota', 'tarefa_criada', 'tarefa_concluida', 'documento_solicitado',
    'documento_enviado', 'documento_analisado', 'contrato_gerado', 'contrato_enviado', 'contrato_assinado',
    'contrato_encerrado', 'transferencia', 'proposta_enviada', 'proposta_respondida', 'consentimento', 'migracao',
    'tentativa_duplicada')),
  ocorrido_em timestamptz not null default now(),
  ator_id uuid,                                                    -- sem FK: sobrevive à remoção do usuário
  titulo text not null check (length(btrim(titulo)) between 1 and 200),
  dados jsonb not null default '{}' check (jsonb_typeof(dados) = 'object')
);
create index cliente_eventos_cliente_idx on public.cliente_eventos (cliente_id, ocorrido_em desc);
create trigger somente_inclusao before update or delete on public.cliente_eventos
  for each row execute function public._somente_inclusao();

-- tentativas de cadastro com documento já existente (A2). Não guarda o CPF de novo.
create table public.cliente_duplicidades (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id),        -- o que já existe
  tentado_por uuid references public.profiles(id) on delete set null,
  tentado_por_parceiro_id uuid references public.parceiros(id),
  origem public.origem_cliente not null,
  resultado text not null
    check (resultado in ('bloqueado_exclusividade', 'bloqueado_contrato', 'bloqueado_pos_prazo', 'mesmo_dono')),
  ocorrido_em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por uuid references public.profiles(id) on delete set null,
  decisao text check (decisao in ('manter', 'transferir')),
  motivo_decisao text check (length(motivo_decisao) <= 2000),
  check (resolvido_em is not null or (resolvido_por is null and decisao is null and motivo_decisao is null)),
  check (resolvido_em is null or decisao is not null)
);
create index cliente_duplicidades_tentado_idx on public.cliente_duplicidades (tentado_por, ocorrido_em);
create index cliente_duplicidades_cliente_idx on public.cliente_duplicidades (cliente_id);
create index cliente_duplicidades_pendentes_idx on public.cliente_duplicidades (ocorrido_em) where resolvido_em is null;
create index cliente_duplicidades_parceiro_idx on public.cliente_duplicidades (tentado_por_parceiro_id)
  where tentado_por_parceiro_id is not null;

-- ============ GATILHOS: CARIMBO (§3.1) ============
create trigger carimbar before insert or update on public.cliente_tarefas
  for each row execute function public.carimbar();
create trigger carimbar before insert or update on public.cliente_documentos
  for each row execute function public.carimbar();

-- ============ GATILHOS: IMUTABILIDADE ESPECÍFICA ============
-- notas: nunca excluídas; a única alteração permitida é a anonimização (§5.5), mais autor_id → nulo (FK set null)
create function public._cliente_notas_imutavel() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and new.id = old.id and new.cliente_id = old.cliente_id and new.criado_em = old.criado_em
     and new.migrado_legado = old.migrado_legado
     and (new.autor_id is not distinct from old.autor_id or new.autor_id is null)
     and ((new.texto = old.texto and new.removido_lgpd = old.removido_lgpd)
          or (not old.removido_lgpd and new.removido_lgpd and new.texto = '[removido — LGPD]')) then
    return new;
  end if;
  raise exception 'Nota é somente inclusão' using errcode = '42501';
end $$;
create trigger somente_inclusao before update or delete on public.cliente_notas
  for each row execute function public._cliente_notas_imutavel();

create trigger somente_inclusao before update or delete on public.cliente_documento_arquivos
  for each row execute function public._somente_inclusao('removido_em');

-- arquivos: o 1º segmento do caminho é o cliente dono da solicitação
create function public._cliente_documento_arquivos_valida() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.cliente_documentos d
                 where d.id = new.documento_id and d.cliente_id::text = split_part(new.storage_path, '/', 1)) then
    raise exception 'Caminho do arquivo não corresponde ao cliente da solicitação' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger cliente_documento_arquivos_valida before insert on public.cliente_documento_arquivos
  for each row execute function public._cliente_documento_arquivos_valida();

-- ============ GATILHOS DE CLIENTES (§3.4) ============
-- clientes_padroes (BEFORE INSERT): só o insert da tela antiga do admin (origem padrão 'portal_admin', até a
-- contração) libera o portal. As RPCs sempre enviam origem explícita e portal_liberado = false.
create function public._clientes_padroes() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.origem = 'portal_admin' then
    new.portal_liberado := true;
  end if;
  return new;
end $$;

-- clientes_cadeia (BEFORE INSERT/UPDATE da cadeia): corretor nulo no insert = Carteira Arken (mantém o insert da
-- tela antiga); o responsável precisa ser 'corretor', ou 'gerente' com gerente_como_corretor (A1), ativo quando é
-- definido ou trocado; gerente_id e imobiliaria_id são sempre derivados dele (o que foi enviado é descartado).
create function public._clientes_cadeia() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cor public.parceiros%rowtype;
begin
  if tg_op = 'INSERT' and new.corretor_id is null then
    select c.corretor_casa_id into new.corretor_id from public.configuracao_geral c;
  end if;
  if new.corretor_id is null then
    raise exception 'O cliente precisa de um corretor responsável' using errcode = '23502';
  end if;
  select * into v_cor from public.parceiros p where p.id = new.corretor_id;
  if not found then
    raise exception 'Corretor não encontrado' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' or new.corretor_id is distinct from old.corretor_id then
    if v_cor.inativado_em is not null then
      raise exception 'O corretor informado está inativo' using errcode = '23514';
    end if;
    if v_cor.tipo = 'imobiliaria'
       or (v_cor.tipo = 'gerente' and not coalesce((select r.permitido from public.permissoes_rede r
                                                    where r.acao = 'gerente_como_corretor' and r.tipo = 'gerente'), false)) then
      raise exception 'O responsável pelo cliente precisa ser um corretor (ou um gerente, se permitido)' using errcode = '23514';
    end if;
  end if;
  new.imobiliaria_id := v_cor.imobiliaria_id;
  new.gerente_id := case v_cor.tipo when 'corretor' then v_cor.gerente_id else v_cor.id end;
  return new;
end $$;

-- clientes_vinculo_historico (AFTER): fecha e abre cliente_vinculos_historico e leva a cadeia para as propostas do
-- cliente (os contratos ainda editáveis acompanham pelo gatilho da 20260929000007). Motivo: arken.motivo_vinculo.
create function public._clientes_vinculo_historico() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := left(nullif(btrim(current_setting('arken.motivo_vinculo', true)), ''), 500);
begin
  if tg_op = 'UPDATE' and (new.corretor_id, new.gerente_id, new.imobiliaria_id)
                          is not distinct from (old.corretor_id, old.gerente_id, old.imobiliaria_id) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    update public.cliente_vinculos_historico h set vigente_ate = now()
     where h.cliente_id = new.id and h.vigente_ate is null;
  end if;
  insert into public.cliente_vinculos_historico (cliente_id, imobiliaria_id, gerente_id, corretor_id, motivo, alterado_por)
  values (new.id, new.imobiliaria_id, new.gerente_id, new.corretor_id,
          coalesce(v_motivo, case when tg_op = 'INSERT' then 'cadastro' else 'alteracao' end), auth.uid());
  if tg_op = 'UPDATE' then
    update public.propostas pr
       set imobiliaria_id = new.imobiliaria_id, gerente_id = new.gerente_id, corretor_id = new.corretor_id
     where pr.cliente_id = new.id
       and (pr.imobiliaria_id, pr.gerente_id, pr.corretor_id)
           is distinct from (new.imobiliaria_id, new.gerente_id, new.corretor_id);
  end if;
  return null;
end $$;

-- clientes_cpf_valido (BEFORE): CPF de 11 dígitos com DV válido em toda inclusão e em toda troca de CPF, para todos
-- (API, RPC, service role). Linhas antigas com CPF inválido continuam gravando as outras colunas; a migração de
-- dados (WP7) trata esses CPFs antes do go-live (scripts/migracao/previa.sql lista).
create function public._clientes_cpf_valido() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cpf is not null and (tg_op = 'INSERT' or new.cpf is distinct from old.cpf)
     and not (new.cpf ~ '^\d{11}$' and public.cpf_valido(new.cpf)) then
    raise exception 'CPF inválido' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger carimbar before insert or update on public.clientes
  for each row execute function public.carimbar();
create trigger clientes_cpf_valido before insert or update of cpf on public.clientes
  for each row execute function public._clientes_cpf_valido();
create trigger clientes_cadeia before insert or update of corretor_id, gerente_id, imobiliaria_id on public.clientes
  for each row execute function public._clientes_cadeia();
create trigger clientes_padroes before insert on public.clientes
  for each row execute function public._clientes_padroes();
create trigger clientes_vinculo_historico after insert or update of corretor_id, gerente_id, imobiliaria_id
  on public.clientes for each row execute function public._clientes_vinculo_historico();
-- gravações diretas pela API (tela antiga até o corte) e pela service role: só os NOMES dos campos (§5.1)
create trigger auditar_linha after insert or update on public.clientes
  for each row execute function public.auditar_linha('*', 'operacao', 'nomes', 'id');

-- ============ GATILHOS DE PROPOSTAS (§3.4) ============
-- propostas_cadeia (BEFORE): com cliente, a cadeia é a do cliente e o cliente precisa estar no escopo do autor
-- (parceiro_id, vínculo ativo; internos passam) quando o vínculo é criado ou trocado; sem cliente, a cadeia é a do
-- parceiro autor (parceiros.profile_id = parceiro_id); autor sem vínculo (legado antes do corte) fica sem cadeia.
create function public._propostas_cadeia() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cli record;
  v_aut public.parceiros%rowtype;
  v_papel public.papel;
begin
  if new.cliente_id is not null then
    select c.imobiliaria_id, c.gerente_id, c.corretor_id into v_cli from public.clientes c where c.id = new.cliente_id;
    if not found then
      raise exception 'Cliente não encontrado' using errcode = '23503';
    end if;
    if tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id or new.parceiro_id is distinct from old.parceiro_id then
      select pr.papel into v_papel from public.profiles pr where pr.id = new.parceiro_id;
      if v_papel is null or v_papel not in ('admin', 'super') then
        select * into v_aut from public.parceiros p where p.profile_id = new.parceiro_id and p.inativado_em is null;
        if not found or not (v_cli.corretor_id = v_aut.id or v_cli.gerente_id = v_aut.id
                             or (v_aut.tipo = 'imobiliaria' and v_cli.imobiliaria_id = v_aut.imobiliaria_id)) then
          raise exception 'O cliente não está no escopo do autor da proposta' using errcode = '42501';
        end if;
      end if;
    end if;
    new.imobiliaria_id := v_cli.imobiliaria_id;
    new.gerente_id := v_cli.gerente_id;
    new.corretor_id := v_cli.corretor_id;
  else
    -- o vínculo do autor (profile_id é único em parceiros), mesmo inativo: a proposta continua visível para a
    -- cadeia em que foi feita
    select * into v_aut from public.parceiros p where p.profile_id = new.parceiro_id;
    if found then
      new.imobiliaria_id := v_aut.imobiliaria_id;
      new.gerente_id := case v_aut.tipo when 'corretor' then v_aut.gerente_id when 'gerente' then v_aut.id end;
      new.corretor_id := case v_aut.tipo when 'corretor' then v_aut.id end;
    else
      new.imobiliaria_id := null;
      new.gerente_id := null;
      new.corretor_id := null;
    end if;
  end if;
  return new;
end $$;

create trigger carimbar before insert or update on public.propostas
  for each row execute function public.carimbar();
create trigger propostas_cadeia before insert or update of cliente_id, parceiro_id, imobiliaria_id, gerente_id, corretor_id
  on public.propostas for each row execute function public._propostas_cadeia();
create trigger auditar_linha after insert or update on public.propostas
  for each row execute function public.auditar_linha('*', 'operacao', 'nomes', 'id');

-- leads: a exclusão pela API (tela antiga do admin, até o corte) fica registrada
create trigger auditar_linha after delete on public.leads
  for each row execute function public.auditar_linha('*', 'operacao', 'nomes', 'id');

-- ============ CASCATA E PROTEÇÃO NA REDE (§2.2, §3.3) ============
-- parceiros_cascata_clientes (AFTER): o corretor (ou gerente, A1) que muda de gerente ou imobiliária leva a cadeia
-- dos seus clientes na mesma transação (o gatilho clientes_cadeia recalcula; o histórico abre e fecha; as propostas
-- e os contratos editáveis acompanham). Propostas sem cliente seguem o parceiro autor (também ao ligar o login).
-- PAR-6: a RPC transfere a carteira antes de mudar o corretor de imobiliária, então a cascata não acha cliente.
create function public._parceiros_cascata_clientes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.gerente_id is distinct from old.gerente_id or new.imobiliaria_id is distinct from old.imobiliaria_id) then
    update public.clientes c
       set imobiliaria_id = new.imobiliaria_id,
           gerente_id = case new.tipo when 'corretor' then new.gerente_id else new.id end
     where c.corretor_id = new.id;
  end if;
  if new.profile_id is not null
     and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id
          or new.gerente_id is distinct from old.gerente_id or new.imobiliaria_id is distinct from old.imobiliaria_id) then
    update public.propostas pr set corretor_id = null            -- o gatilho propostas_cadeia recalcula
     where pr.cliente_id is null and pr.parceiro_id = new.profile_id;
  end if;
  if tg_op = 'UPDATE' and old.profile_id is not null and new.profile_id is distinct from old.profile_id then
    update public.propostas pr set corretor_id = null
     where pr.cliente_id is null and pr.parceiro_id = old.profile_id;
  end if;
  return null;
end $$;
create trigger parceiros_cascata_clientes after insert or update of gerente_id, imobiliaria_id, profile_id
  on public.parceiros for each row execute function public._parceiros_cascata_clientes();

-- parceiros_protege_carteira (BEFORE): ninguém é inativado com cliente ativo na carteira (a RPC transfere antes).
create function public._parceiros_protege_carteira() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.inativado_em is null and new.inativado_em is not null
     and exists (select 1 from public.clientes c where c.corretor_id = new.id and c.inativado_em is null) then
    raise exception 'Transfira os clientes antes de inativar o parceiro' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger parceiros_protege_carteira before update of inativado_em on public.parceiros
  for each row execute function public._parceiros_protege_carteira();

-- ============ BACKFILL NEUTRO (§3.4, §2.4) ============
-- Clientes atuais (portal) na Carteira Arken; a cadeia vem pelo gatilho e o histórico abre com o motivo abaixo.
-- origem = 'portal_admin' e portal_liberado = true vieram dos padrões das colunas. Nunca trocam de dono.
do $$
begin
  perform set_config('arken.motivo_vinculo', 'migração: clientes do portal na Carteira Arken', true);
  update public.clientes
     set corretor_id = (select c.corretor_casa_id from public.configuracao_geral c)
   where corretor_id is null;
  perform set_config('arken.motivo_vinculo', '', true);
end $$;

-- ============ STORAGE (§3.10): bucket privado; políticas na 20260929000009 ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('crm-documentos', 'crm-documentos', false, 5242880, array[
    'image/jpeg', 'image/png', 'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============ RLS (tabelas novas sem política para authenticated: só RPC) ============
alter table public.cliente_vinculos_historico enable row level security;
alter table public.cliente_notas              enable row level security;
alter table public.cliente_tarefas            enable row level security;
alter table public.cliente_documentos         enable row level security;
alter table public.cliente_documento_arquivos enable row level security;
alter table public.cliente_eventos            enable row level security;
alter table public.cliente_duplicidades       enable row level security;

-- ============ GRANTS (§3.4, §4.2, §4.3) ============
-- clientes: a tela antiga só grava estas colunas; corretor_id e a cadeia só mudam por RPC (auditada, com motivo).
-- O SELECT (e as políticas atuais) ficam até o corte.
revoke insert, update, delete on public.clientes from authenticated;
grant insert (nome, cpf, email, telefone), update (nome, cpf, email, telefone) on public.clientes to authenticated;

-- CRM: nenhum grant a authenticated (nem admin); service_role S/I/U/D, e S/I nas somente inclusão
revoke all on public.cliente_vinculos_historico, public.cliente_notas, public.cliente_tarefas,
  public.cliente_documentos, public.cliente_documento_arquivos, public.cliente_eventos, public.cliente_duplicidades
  from anon, authenticated, service_role;
grant select, insert on public.cliente_vinculos_historico, public.cliente_notas, public.cliente_documento_arquivos,
  public.cliente_eventos to service_role;
grant select, insert, update, delete on public.cliente_tarefas, public.cliente_documentos, public.cliente_duplicidades
  to service_role;

revoke execute on function public._cliente_notas_imutavel(), public._cliente_documento_arquivos_valida(),
  public._clientes_cpf_valido(), public._clientes_padroes(), public._clientes_cadeia(), public._clientes_vinculo_historico(),
  public._propostas_cadeia(), public._parceiros_cascata_clientes(), public._parceiros_protege_carteira()
  from public, anon, authenticated, service_role;
