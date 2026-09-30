-- Contratos e configuração de contratos (docs/ARQUITETURA_EXPANSAO.md §1.1 D1–D6, §3.6, §3.10, §3.11, §8.1).
-- Simulação calculada só no servidor (FIN-1/FIN-2, SEG-4) por calcular_simulacao(); o valor do contrato é sempre o do
-- produto (N16). A cadeia acompanha o cliente até o envio e congela a partir dele (base do B5).
-- Tabelas de contratos sem grant para authenticated (tudo por RPC); configuração: leitura pela RLS da 09.
-- Nenhuma referência a objeto de migration posterior.

-- ============ PARÂMETROS DE SIMULAÇÃO (versionada, somente inclusão) ============
-- vigente = maior vigente_desde <= now()
create table public.parametros_simulacao (
  id uuid primary key default gen_random_uuid(),
  vigente_desde timestamptz not null default now(),
  taxa_aporte_proprio numeric(7,4) not null check (taxa_aporte_proprio between 0 and 100),  -- semente 8.5 ⚑ N14
  taxa_financeiro numeric(7,4) check (taxa_financeiro between 0 and 100),                    -- só guardados; fora do cálculo
  juros_ao_mes numeric(7,4) check (juros_ao_mes between 0 and 100),
  igpm_atual numeric(7,4) check (igpm_atual between -100 and 100),
  parcela_minima int not null check (parcela_minima >= 1),                                  -- 12 ⚑
  parcela_maxima int not null check (parcela_maxima >= parcela_minima and parcela_maxima <= 600), -- 360 ⚑
  valor_minimo numeric(14,2) check (valor_minimo > 0),
  valor_minimo_flex numeric(14,2) check (valor_minimo_flex > 0),                             -- nulo: flexível bloqueado
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null
);
create index parametros_simulacao_vigente_idx on public.parametros_simulacao (vigente_desde desc);
create trigger carimbar before insert or update on public.parametros_simulacao
  for each row execute function public.carimbar();
create trigger somente_inclusao before update or delete on public.parametros_simulacao
  for each row execute function public._somente_inclusao();
create trigger auditar_linha after insert on public.parametros_simulacao
  for each row execute function public.auditar_linha('*', 'configuracao', 'valores', 'id');

insert into public.parametros_simulacao (taxa_aporte_proprio, parcela_minima, parcela_maxima)
values (8.5, 12, 360);                                                                      -- ⚑ N14 (valores da Ocka)

-- versão vigente (usada nas políticas da 09 e pelas RPCs de contrato)
create function public.parametros_vigente_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.parametros_simulacao p
  where p.vigente_desde <= now()
  order by p.vigente_desde desc, p.criado_em desc, p.id
  limit 1
$$;

-- ============ MODELOS DE CONTRATO (versionada, somente inclusão; só a liberação muda) ============
-- vigente = maior versão da chave. conteudo em marcação restrita "marcacao_v1" (§6.3), nunca HTML.
create table public.contrato_modelos (
  id uuid primary key default gen_random_uuid(),
  chave public.modelo_chave not null,
  versao int not null check (versao >= 1),
  titulo text not null check (length(btrim(titulo)) between 3 and 200),
  conteudo text not null check (length(btrim(conteudo)) between 20 and 200000),
  variaveis text[] not null default '{}',                   -- extraídas do conteúdo pelo gatilho (lista permitida)
  revisado_juridico boolean not null default false,
  liberado_para_envio boolean not null default false,       -- só o Super libera; sem isso não há envio
  liberado_por uuid references public.profiles(id) on delete set null,
  liberado_em timestamptz,
  publicado_em timestamptz not null default now(),
  publicado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  unique (chave, versao),
  check (not liberado_para_envio or liberado_em is not null)
);

-- variáveis do modelo: extraídas de {{...}} e conferidas contra a lista permitida (§6.3). Variável desconhecida ou
-- chave solta ({{ ou }} sem par) recusa a publicação; o que foi enviado em variaveis é descartado.
create function public._contrato_modelos_variaveis() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_permitidas constant text[] := array[
    'codigo', 'nome', 'sobrenome', 'cpf-cnpj', 'logradouro', 'numero', 'bairro', 'cidade', 'estado', 'cep',
    'valor-propriedade', 'valor-parcela',
    'data', 'rg', 'estado-civil', 'nacionalidade', 'complemento', 'produto', 'produto-matricula', 'percentual-aporte',
    'valor-aporte', 'valor-entrada', 'base-parcelada', 'numero-parcelas', 'taxa-aporte', 'valor-minimo-flex',
    'corretor-nome', 'corretor-creci', 'imobiliaria-nome', 'vendedora-razao-social', 'vendedora-cnpj',
    'vendedora-endereco'];
  v_usadas text[];
  v_invalidas text[];
begin
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}') into v_usadas
  from regexp_matches(new.conteudo, '\{\{([^{}]*)\}\}', 'g') m;
  select coalesce(array_agg(v order by v), '{}') into v_invalidas from unnest(v_usadas) v where v <> all (v_permitidas);
  if cardinality(v_invalidas) > 0 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001',
      detail = jsonb_build_object('variaveis_invalidas', to_jsonb(v_invalidas))::text;
  end if;
  if regexp_replace(new.conteudo, '\{\{[^{}]*\}\}', '', 'g') ~ '(\{\{|\}\})' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"chaves_sem_par"}';
  end if;
  new.variaveis := v_usadas;
  return new;
end $$;

-- somente inclusão, exceto a liberação (uma vez): liberado_para_envio e revisado_juridico de false para true,
-- liberado_em/liberado_por de nulo para valor; *_por podem virar nulo (FK set null)
create function public._contrato_modelos_imutavel() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and (new.id, new.chave, new.versao, new.titulo, new.conteudo, new.variaveis, new.publicado_em)
         is not distinct from (old.id, old.chave, old.versao, old.titulo, old.conteudo, old.variaveis, old.publicado_em)
     and (new.publicado_por is not distinct from old.publicado_por or new.publicado_por is null)
     and (new.liberado_para_envio = old.liberado_para_envio or (not old.liberado_para_envio and new.liberado_para_envio))
     and (new.revisado_juridico = old.revisado_juridico or (not old.revisado_juridico and new.revisado_juridico))
     and (new.liberado_em is not distinct from old.liberado_em or old.liberado_em is null)
     and (new.liberado_por is not distinct from old.liberado_por or old.liberado_por is null or new.liberado_por is null) then
    return new;
  end if;
  raise exception 'Modelo de contrato é somente inclusão (publique uma nova versão)' using errcode = '42501';
end $$;

create trigger contrato_modelos_variaveis before insert on public.contrato_modelos
  for each row execute function public._contrato_modelos_variaveis();
create trigger somente_inclusao before update or delete on public.contrato_modelos
  for each row execute function public._contrato_modelos_imutavel();
create trigger auditar_linha after insert or update on public.contrato_modelos
  for each row execute function public.auditar_linha('chave,versao,titulo,revisado_juridico,liberado_para_envio',
                                                     'configuracao', 'valores', 'id');

create function public.modelo_vigente_id(p_chave public.modelo_chave) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.contrato_modelos m where m.chave = p_chave order by m.versao desc limit 1
$$;

-- Semente (D2, D6 ⚑): esqueletos "MODELO PROVISÓRIO" (os textos da Ocka não estão no repositório). Não liberados:
-- nenhum envio acontece até o jurídico revisar e o Super publicar e liberar a versão definitiva.
insert into public.contrato_modelos (chave, versao, titulo, conteudo) values
('parcelado', 1, 'MODELO PROVISÓRIO — Aquisição, plano parcelado', $modelo$# MODELO PROVISÓRIO — CONTRATO DE AQUISIÇÃO (PLANO PARCELADO)

**Esqueleto provisório, sem valor jurídico.** O texto definitivo precisa ser redigido e revisado pelo jurídico da Arken e publicado pelo Super antes de qualquer envio para assinatura.

Contrato nº {{codigo}}, emitido em {{data}}.

## 1. Partes

**Vendedora:** {{vendedora-razao-social}}, CNPJ {{vendedora-cnpj}}, com sede em {{vendedora-endereco}}.

**Comprador(a):** {{nome}}, CPF/CNPJ {{cpf-cnpj}}, com endereço em {{logradouro}}, {{numero}}, {{bairro}}, {{cidade}}/{{estado}}, CEP {{cep}}.

## 2. Objeto

Aquisição de {{produto}}, pelo valor de {{valor-propriedade}}.

## 3. Pagamento

- Aporte próprio de {{percentual-aporte}} do valor, correspondente a {{valor-aporte}};
- Entrada de {{valor-entrada}};
- Saldo de {{base-parcelada}}, em {{numero-parcelas}} parcelas mensais de {{valor-parcela}}, com taxa de {{taxa-aporte}}.

## 4. Intermediação

Corretor(a) responsável: {{corretor-nome}} ({{imobiliaria-nome}}).

---

## Assinaturas

As partes assinam eletronicamente este contrato.$modelo$),
('flexivel', 1, 'MODELO PROVISÓRIO — Aquisição, plano flexível', $modelo$# MODELO PROVISÓRIO — CONTRATO DE AQUISIÇÃO (PLANO FLEXÍVEL)

**Esqueleto provisório, sem valor jurídico.** O texto definitivo precisa ser redigido e revisado pelo jurídico da Arken e publicado pelo Super antes de qualquer envio para assinatura.

Contrato nº {{codigo}}, emitido em {{data}}.

## 1. Partes

**Vendedora:** {{vendedora-razao-social}}, CNPJ {{vendedora-cnpj}}, com sede em {{vendedora-endereco}}.

**Comprador(a):** {{nome}}, CPF/CNPJ {{cpf-cnpj}}, com endereço em {{logradouro}}, {{numero}}, {{bairro}}, {{cidade}}/{{estado}}, CEP {{cep}}.

## 2. Objeto

Aquisição de {{produto}}, pelo valor de {{valor-propriedade}}.

## 3. Pagamento

- Aporte próprio de {{percentual-aporte}} do valor, correspondente a {{valor-aporte}};
- Entrada de {{valor-entrada}};
- Saldo de {{base-parcelada}}, pago em pagamentos livres de no mínimo {{valor-minimo-flex}} cada.

## 4. Intermediação

Corretor(a) responsável: {{corretor-nome}} ({{imobiliaria-nome}}).

---

## Assinaturas

As partes assinam eletronicamente este contrato.$modelo$),
('servico_corretor', 1, 'MODELO PROVISÓRIO — Prestação de serviços, corretor', $modelo$# MODELO PROVISÓRIO — CONTRATO DE PRESTAÇÃO DE SERVIÇOS (CORRETOR)

**Esqueleto provisório, só para pré-visualização.** Este modelo não é gravado nem enviado para assinatura nesta etapa.

Emitido em {{data}}.

## 1. Partes

**Contratante:** {{vendedora-razao-social}}, CNPJ {{vendedora-cnpj}}.

**Corretor(a):** {{corretor-nome}}, CRECI {{corretor-creci}}.$modelo$),
('servico_imobiliaria', 1, 'MODELO PROVISÓRIO — Prestação de serviços, imobiliária', $modelo$# MODELO PROVISÓRIO — CONTRATO DE PRESTAÇÃO DE SERVIÇOS (IMOBILIÁRIA)

**Esqueleto provisório, só para pré-visualização.** Este modelo não é gravado nem enviado para assinatura nesta etapa.

Emitido em {{data}}.

## 1. Partes

**Contratante:** {{vendedora-razao-social}}, CNPJ {{vendedora-cnpj}}.

**Imobiliária:** {{imobiliaria-nome}}.$modelo$);

-- ============ REGRAS DE SIGNATÁRIOS (D3 ⚑) ============
-- E-mail nulo em regra ativa com fonte 'fixo' bloqueia o envio (validação signatarios_configurados), de propósito.
create table public.contrato_signatario_regras (
  id uuid primary key default gen_random_uuid(),
  modelo_chave public.modelo_chave not null,
  ordem smallint not null check (ordem between 1 and 50),
  papel public.papel_signatario not null,
  fonte text not null check (fonte in ('cliente', 'corretor_do_cliente', 'fixo')),
  nome text check (length(btrim(nome)) between 2 and 200),
  email text check (length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ato text not null default 'assinar' check (ato in ('assinar', 'testemunhar')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  unique (modelo_chave, ordem),
  check (fonte <> 'fixo' or nome is not null),
  check ((fonte = 'cliente') = (papel = 'cliente')),
  check (fonte <> 'corretor_do_cliente' or papel = 'corretor')
);
create trigger carimbar before insert or update on public.contrato_signatario_regras
  for each row execute function public.carimbar();
-- nome e e-mail do representante e das testemunhas: só os nomes dos campos
create trigger auditar_linha after insert or update or delete on public.contrato_signatario_regras
  for each row execute function public.auditar_linha('*', 'configuracao', 'nomes', 'id');

insert into public.contrato_signatario_regras (modelo_chave, ordem, papel, fonte, nome, email, ato, ativo) values
  ('parcelado', 1, 'cliente',             'cliente', null,                  null, 'assinar',     true),
  ('parcelado', 2, 'representante_arken', 'fixo',    'Representante Arken', null, 'assinar',     true),
  ('parcelado', 3, 'testemunha',          'fixo',    'Testemunha 1',        null, 'testemunhar', false),
  ('parcelado', 4, 'testemunha',          'fixo',    'Testemunha 2',        null, 'testemunhar', false),
  ('flexivel',  1, 'cliente',             'cliente', null,                  null, 'assinar',     true),
  ('flexivel',  2, 'representante_arken', 'fixo',    'Representante Arken', null, 'assinar',     true),
  ('flexivel',  3, 'testemunha',          'fixo',    'Testemunha 1',        null, 'testemunhar', false),
  ('flexivel',  4, 'testemunha',          'fixo',    'Testemunha 2',        null, 'testemunhar', false);

-- ============ CONTRATOS ============
create table public.contratos (
  id uuid primary key default gen_random_uuid(),
  codigo bigint generated always as identity unique,      -- {{codigo}}; exibido como #0000123
  cliente_id uuid not null references public.clientes(id),
  tipo public.tipo_contrato not null default 'aquisicao',
  modelo_id uuid not null references public.contrato_modelos(id),     -- versão exata usada
  forma_pagamento public.forma_pagamento not null,
  status public.status_contrato not null default 'rascunho',
  unidade_id uuid references public.unidades(id),
  imovel_id uuid references public.imoveis(id),
  -- simulação: sempre gravada pelo servidor (FIN-1/FIN-2, SEG-4); valor_imovel = valor do produto (N16)
  parametros_id uuid not null references public.parametros_simulacao(id),
  valor_imovel numeric(14,2) not null check (valor_imovel > 0),
  perc_aporte numeric(7,4) not null check (perc_aporte > 0 and perc_aporte <= 100),
  valor_aporte numeric(14,2) not null check (valor_aporte > 0),
  valor_entrada numeric(14,2) not null default 0 check (valor_entrada >= 0),
  base_parcelada numeric(14,2) not null check (base_parcelada >= 0),   -- valor × %aporte − entrada (FIN-1, ⚑ N17)
  valor_restante numeric(14,2) not null,                               -- valor − aporte (informativo)
  n_parcelas int,
  taxa_aporte numeric(7,4),
  valor_parcela numeric(14,2),
  valor_total_parcelas numeric(14,2),
  valor_minimo_flex numeric(14,2),
  -- cadeia: acompanha o cliente até o envio e congela a partir dele (base do B5)
  imobiliaria_id uuid references public.imobiliarias(id),
  gerente_id uuid references public.parceiros(id),
  corretor_id uuid references public.parceiros(id),
  -- documento e assinatura
  texto_sha256 text check (texto_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_path text check (pdf_path ~ '^[0-9a-f-]{36}/minuta-v[0-9]{1,6}-[0-9a-f]{8}\.pdf$'),
  pdf_sha256 text check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_versao int not null default 0 check (pdf_versao >= 0),
  pdf_gerado_em timestamptz,
  pdf_desatualizado boolean not null default true,
  pdf_assinado_path text check (pdf_assinado_path ~ '^[0-9a-f-]{36}/assinado-[0-9a-f]{8}\.pdf$'),
  pdf_assinado_sha256 text check (pdf_assinado_sha256 ~ '^[0-9a-f]{64}$'),
  d4sign_uuid text unique check (length(d4sign_uuid) between 1 and 100),
  webhook_token_hash text check (webhook_token_hash ~ '^[0-9a-f]{64}$'),
  envio_lock_em timestamptz,
  enviado_assinatura_em timestamptz,
  enviado_por uuid references public.profiles(id) on delete set null,
  assinado_em timestamptz,
  encerrado_em timestamptz,
  observacao text check (length(observacao) <= 2000),
  -- colunas de auditoria (§3.1)
  criado_em timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  atualizado_em timestamptz,
  atualizado_por uuid references public.profiles(id) on delete set null,
  inativado_em timestamptz,
  inativado_por uuid references public.profiles(id) on delete set null,
  motivo_inativacao text check (length(motivo_inativacao) <= 2000),
  check (num_nonnulls(unidade_id, imovel_id) = 1),
  check (valor_entrada <= valor_aporte),
  check (forma_pagamento <> 'parcelado' or (n_parcelas > 0 and valor_parcela is not null and taxa_aporte is not null
                                             and valor_total_parcelas is not null)),
  check (forma_pagamento <> 'flexivel' or (valor_minimo_flex is not null and n_parcelas is null and valor_parcela is null)),
  check (pdf_path is null or split_part(pdf_path, '/', 1) = id::text),
  check (pdf_assinado_path is null or split_part(pdf_assinado_path, '/', 1) = id::text),
  check (status <> 'assinado' or assinado_em is not null)
);
create unique index contratos_unidade_ativa on public.contratos (unidade_id)
  where unidade_id is not null and status not in ('recusado', 'expirado', 'cancelado', 'arquivado');
create unique index contratos_imovel_ativo on public.contratos (imovel_id)
  where imovel_id is not null and status not in ('recusado', 'expirado', 'cancelado', 'arquivado');
create index contratos_cliente_idx on public.contratos (cliente_id);
create index contratos_status_idx on public.contratos (status);
create index contratos_modelo_idx on public.contratos (modelo_id);
create index contratos_parametros_idx on public.contratos (parametros_id);
create index contratos_corretor_idx on public.contratos (corretor_id);
create index contratos_gerente_idx on public.contratos (gerente_id);
create index contratos_imobiliaria_idx on public.contratos (imobiliaria_id);
create index contratos_unidade_idx on public.contratos (unidade_id) where unidade_id is not null;
create index contratos_imovel_idx on public.contratos (imovel_id) where imovel_id is not null;
create index contratos_pendentes_idx on public.contratos (atualizado_em) where status = 'assinatura_pendente';

create table public.contrato_signatarios (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id),
  ordem smallint not null check (ordem between 1 and 50),
  papel public.papel_signatario not null,
  nome text not null check (length(btrim(nome)) between 2 and 200),
  email text not null check (length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ato text not null default 'assinar' check (ato in ('assinar', 'testemunhar')),
  d4sign_chave text check (length(d4sign_chave) <= 200),
  status public.status_assinatura not null default 'pendente',
  assinado_em timestamptz,
  recusado_em timestamptz,
  motivo text check (length(motivo) <= 2000),
  atualizado_em timestamptz,
  unique (contrato_id, email)
);
create index contrato_signatarios_contrato_idx on public.contrato_signatarios (contrato_id, ordem);
create trigger carimbar before insert or update on public.contrato_signatarios
  for each row execute function public.carimbar();

-- ============ GATILHOS DE CONTRATOS (§3.6) ============
-- contratos_cadeia (BEFORE): enquanto editável (rascunho, documentacao_pendente, em_analise), a cadeia é a do
-- cliente; o que foi enviado é descartado. A partir do envio fica congelada (contratos_imutavel recusa mudança).
create function public._contratos_cadeia() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cli record;
begin
  if tg_op = 'INSERT' or old.status in ('rascunho', 'documentacao_pendente', 'em_analise') then
    select c.imobiliaria_id, c.gerente_id, c.corretor_id into v_cli from public.clientes c where c.id = new.cliente_id;
    if not found then
      raise exception 'Cliente não encontrado' using errcode = '23503';
    end if;
    new.imobiliaria_id := v_cli.imobiliaria_id;
    new.gerente_id := v_cli.gerente_id;
    new.corretor_id := v_cli.corretor_id;
  end if;
  return new;
end $$;

-- contratos_imutavel (BEFORE UPDATE, §3.6):
--  * valores, parâmetros, modelo, produto, cliente, tipo e forma só mudam em rascunho; qualquer mudança marca
--    pdf_desatualizado;
--  * a cadeia e o PDF da minuta só mudam em rascunho, documentacao_pendente ou em_analise;
--  * a partir de assinatura_pendente tudo congela, menos status, campos de assinatura (pdf assinado, assinado_em,
--    trava de envio) e encerrado_em.
create function public._contratos_imutavel() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_editavel constant boolean := old.status in ('rascunho', 'documentacao_pendente', 'em_analise');
begin
  if (new.cliente_id, new.tipo, new.modelo_id, new.forma_pagamento, new.unidade_id, new.imovel_id, new.parametros_id,
      new.valor_imovel, new.perc_aporte, new.valor_aporte, new.valor_entrada, new.base_parcelada, new.valor_restante,
      new.n_parcelas, new.taxa_aporte, new.valor_parcela, new.valor_total_parcelas, new.valor_minimo_flex)
     is distinct from
     (old.cliente_id, old.tipo, old.modelo_id, old.forma_pagamento, old.unidade_id, old.imovel_id, old.parametros_id,
      old.valor_imovel, old.perc_aporte, old.valor_aporte, old.valor_entrada, old.base_parcelada, old.valor_restante,
      old.n_parcelas, old.taxa_aporte, old.valor_parcela, old.valor_total_parcelas, old.valor_minimo_flex) then
    if old.status <> 'rascunho' then
      raise exception 'Valores, modelo, produto e cliente do contrato só mudam em rascunho' using errcode = '23514';
    end if;
    new.pdf_desatualizado := true;
  end if;

  if not v_editavel then
    if (new.imobiliaria_id, new.gerente_id, new.corretor_id) is distinct from (old.imobiliaria_id, old.gerente_id, old.corretor_id) then
      raise exception 'A cadeia do contrato fica congelada a partir do envio para assinatura' using errcode = '23514';
    end if;
    -- *_por podem virar nulo (FK "on delete set null" quando o usuário Auth é removido)
    if (new.texto_sha256, new.pdf_path, new.pdf_sha256, new.pdf_versao, new.pdf_gerado_em, new.pdf_desatualizado,
        new.d4sign_uuid, new.webhook_token_hash, new.enviado_assinatura_em, new.observacao, new.criado_em,
        new.inativado_em, new.motivo_inativacao)
       is distinct from
       (old.texto_sha256, old.pdf_path, old.pdf_sha256, old.pdf_versao, old.pdf_gerado_em, old.pdf_desatualizado,
        old.d4sign_uuid, old.webhook_token_hash, old.enviado_assinatura_em, old.observacao, old.criado_em,
        old.inativado_em, old.motivo_inativacao)
       or (new.enviado_por is distinct from old.enviado_por and new.enviado_por is not null)
       or (new.inativado_por is distinct from old.inativado_por and new.inativado_por is not null) then
      raise exception 'O contrato fica congelado a partir do envio para assinatura' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger carimbar before insert or update on public.contratos
  for each row execute function public.carimbar();
create trigger contratos_cadeia before insert or update of cliente_id, imobiliaria_id, gerente_id, corretor_id
  on public.contratos for each row execute function public._contratos_cadeia();
create trigger contratos_imutavel before update on public.contratos
  for each row execute function public._contratos_imutavel();

-- clientes_cascata_contratos (AFTER): a cadeia do cliente vai para os contratos ainda editáveis (§3.3, §3.6).
-- Contratos a partir de assinatura_pendente não são tocados, então a cascata nunca colide com o congelamento.
create function public._clientes_cascata_contratos() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.corretor_id, new.gerente_id, new.imobiliaria_id) is distinct from (old.corretor_id, old.gerente_id, old.imobiliaria_id) then
    update public.contratos k
       set corretor_id = new.corretor_id, gerente_id = new.gerente_id, imobiliaria_id = new.imobiliaria_id
     where k.cliente_id = new.id and k.status in ('rascunho', 'documentacao_pendente', 'em_analise')
       and (k.corretor_id, k.gerente_id, k.imobiliaria_id)
           is distinct from (new.corretor_id, new.gerente_id, new.imobiliaria_id);
  end if;
  return null;
end $$;
create trigger clientes_cascata_contratos after update of corretor_id, gerente_id, imobiliaria_id on public.clientes
  for each row execute function public._clientes_cascata_contratos();

-- ============ CÁLCULO DA SIMULAÇÃO (§3.6, FIN-1/FIN-2): única fonte de verdade ============
-- Pura (immutable): recebe os parâmetros vigentes lidos pela RPC. Arredondamento numeric (metade para longe do zero):
--   valor_aporte          = round(valor × perc / 100, 2)
--   base_parcelada        = valor_aporte − entrada
--   valor_parcela         = round(base / n × (1 + taxa / 100), 2)
--   valor_total_parcelas  = round(base × (1 + taxa / 100), 2)
--   residuo               = valor_total_parcelas − valor_parcela × n   (vai para a última parcela no financeiro ⚑)
--   valor_restante        = valor − valor_aporte (informativo, N17)
-- perc é arredondado a 4 casas e a entrada a 2 antes do cálculo (precisão das colunas). Fora dos limites: erro
-- SIMULACAO_INVALIDA (P0001) com detail {"motivos":[...]}: n_parcelas_fora_do_limite, entrada_maior_que_aporte,
-- entrada_invalida, valor_abaixo_do_minimo, flexivel_sem_minimo, percentual_invalido, produto_sem_valor.
create function public.calcular_simulacao(
  p_forma public.forma_pagamento,
  p_valor numeric,
  p_perc_aporte numeric,
  p_entrada numeric,
  p_n_parcelas int,
  p_taxa numeric,
  p_parcela_minima int,
  p_parcela_maxima int,
  p_valor_minimo numeric,
  p_valor_minimo_flex numeric
) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_motivos text[] := '{}';
  v_perc numeric := round(p_perc_aporte, 4);
  v_entrada numeric := round(coalesce(p_entrada, 0), 2);
  v_aporte numeric;
  v_base numeric;
  v_parcela numeric;
  v_total numeric;
begin
  if p_forma is null then
    raise exception 'SIMULACAO_INVALIDA' using errcode = 'P0001', detail = '{"motivos":["forma_invalida"]}';
  end if;
  if p_valor is null or p_valor <= 0 then v_motivos := v_motivos || 'produto_sem_valor'::text; end if;
  if v_perc is null or v_perc <= 0 or v_perc > 100 then v_motivos := v_motivos || 'percentual_invalido'::text; end if;
  if v_entrada < 0 then v_motivos := v_motivos || 'entrada_invalida'::text; end if;
  if p_valor_minimo is not null and p_valor is not null and p_valor < p_valor_minimo then
    v_motivos := v_motivos || 'valor_abaixo_do_minimo'::text;
  end if;
  if p_forma = 'parcelado' and (p_n_parcelas is null or p_parcela_minima is null or p_parcela_maxima is null
                                or p_n_parcelas < p_parcela_minima or p_n_parcelas > p_parcela_maxima or p_taxa is null) then
    v_motivos := v_motivos || 'n_parcelas_fora_do_limite'::text;
  end if;
  if p_forma = 'flexivel' and p_valor_minimo_flex is null then
    v_motivos := v_motivos || 'flexivel_sem_minimo'::text;
  end if;
  if cardinality(v_motivos) = 0 then
    v_aporte := round(p_valor * v_perc / 100, 2);
    if v_entrada > v_aporte then v_motivos := v_motivos || 'entrada_maior_que_aporte'::text; end if;
  end if;
  if cardinality(v_motivos) > 0 then
    raise exception 'SIMULACAO_INVALIDA' using errcode = 'P0001',
      detail = jsonb_build_object('motivos', to_jsonb(v_motivos))::text;
  end if;

  v_base := v_aporte - v_entrada;
  if p_forma = 'parcelado' then
    v_parcela := round(v_base / p_n_parcelas * (1 + p_taxa / 100), 2);
    v_total := round(v_base * (1 + p_taxa / 100), 2);
  end if;
  return jsonb_build_object(
    'valor_imovel', round(p_valor, 2),
    'perc_aporte', v_perc,
    'valor_aporte', v_aporte,
    'valor_entrada', v_entrada,
    'base_parcelada', v_base,
    'valor_restante', round(p_valor, 2) - v_aporte,
    'n_parcelas', case when p_forma = 'parcelado' then p_n_parcelas end,
    'taxa_aporte', case when p_forma = 'parcelado' then p_taxa end,
    'valor_parcela', v_parcela,
    'valor_total_parcelas', v_total,
    'residuo', case when p_forma = 'parcelado' then v_total - v_parcela * p_n_parcelas end,
    'valor_minimo_flex', case when p_forma = 'flexivel' then p_valor_minimo_flex end);
end $$;

-- ============ LIGAÇÕES COM O CRM E O PORTAL (§3.4, §3.6) ============
alter table public.cliente_documentos add column contrato_id uuid references public.contratos(id);
create index cliente_documentos_contrato_idx on public.cliente_documentos (contrato_id) where contrato_id is not null;
alter table public.cliente_negocios
  add column contrato_id uuid references public.contratos(id),
  add column imovel_id uuid references public.imoveis(id);
create index cliente_negocios_contrato_idx on public.cliente_negocios (contrato_id) where contrato_id is not null;
create index cliente_negocios_imovel_idx on public.cliente_negocios (imovel_id) where imovel_id is not null;

-- ============ STORAGE (§3.10): só PDF; só a service role grava; leitura só com autorização (política na 09) ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('contratos', 'contratos', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============ RLS (políticas na 20260929000009) ============
alter table public.parametros_simulacao       enable row level security;
alter table public.contrato_modelos           enable row level security;
alter table public.contrato_signatario_regras enable row level security;
alter table public.contratos                  enable row level security;
alter table public.contrato_signatarios       enable row level security;

-- ============ GRANTS (§4.2, §4.3) ============
revoke all on public.parametros_simulacao, public.contrato_modelos, public.contrato_signatario_regras,
  public.contratos, public.contrato_signatarios from anon, authenticated, service_role;
-- configuração: leitura (políticas na 09: vigentes para parceiros; regras de signatários só internos);
-- versões novas só por RPC (config_publicar_*); regras de signatários: o Super edita estas colunas
grant select on public.parametros_simulacao, public.contrato_modelos, public.contrato_signatario_regras to authenticated;
grant update (ordem, nome, email, ato, ativo) on public.contrato_signatario_regras to authenticated;
-- contratos e signatários: nenhum grant a authenticated (nem admin), só RPC
grant select, insert on public.parametros_simulacao, public.contrato_modelos to service_role;
grant select, insert, update, delete on public.contrato_signatario_regras, public.contratos, public.contrato_signatarios
  to service_role;

revoke execute on function public._contrato_modelos_variaveis(), public._contrato_modelos_imutavel(),
  public._contratos_cadeia(), public._contratos_imutavel(), public._clientes_cascata_contratos(),
  public.calcular_simulacao(public.forma_pagamento, numeric, numeric, numeric, int, numeric, int, int, numeric, numeric),
  public.parametros_vigente_id(), public.modelo_vigente_id(public.modelo_chave)
  from public, anon, authenticated, service_role;
-- helpers de versão vigente: usados nas políticas de leitura (09)
grant execute on function public.parametros_vigente_id(), public.modelo_vigente_id(public.modelo_chave)
  to authenticated, service_role;
