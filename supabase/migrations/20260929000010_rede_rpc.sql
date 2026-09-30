-- Rede de parceiros: corpos das RPCs [WP1] (docs/ARQUITETURA_EXPANSAO.md §1.1 A1–A8, N2, N3, N8, N18, N19; §2;
-- §3.3; §4.4 "Rede"; §4.5; §5.2; §6.2).
-- Troca os corpos dos esqueletos da 20260929000009 com create or replace e a MESMA assinatura (o que preserva dono e
-- grants: usuário → authenticated; rede_link_publico → anon também; rede_vincular_login e rede_registrar_convite → só
-- service_role). Aditivo: a tabela parceiro_status_historico e ajudantes internos com prefixo _ (sem grant).
--
-- Regras comuns (§4.4, §4.6):
-- - security definer ignora a RLS: o escopo é conferido aqui, explicitamente, com os helpers da 09 (is_admin, is_super,
--   escopo_imobiliaria, escopo_gerente, meu_parceiro_id, tem_permissao), a cada chamada (bloqueado/inativo perdem na hora);
-- - sem acesso e registro inexistente dão o MESMO erro: 42501 'Sem acesso a este registro' (não revela existência);
--   leitura negada (rede_parceiro_detalhe) devolve nulo e grava acesso/acesso_negado;
-- - matriz (§3.3, permissoes_rede): a tabela só liga ou desliga a ação; o que está entre parênteses é regra fixa aqui:
--   imobiliária = gerentes e corretores da própria imobiliária; gerente = só os corretores dele; corretor = nada;
--   usuários de imobiliária (tipo 'imobiliaria') e a cadeia da casa: só internos. Internos podem tudo, menos o que é
--   do Super (mudar corretor de imobiliária, transferir cliente entre imobiliárias e regularizar legado — §2.1);
-- - toda escrita grava _auditar (nomes dos campos; antes/depois só status e ids de vínculo; nunca CPF, e-mail,
--   telefone ou texto livre); transferência de cliente grava a timeline 'transferencia' (_evento_cliente);
-- - mudança de cadeia liga arken.motivo_vinculo antes do UPDATE: o motivo vai para parceiro_vinculos_historico e
--   cliente_vinculos_historico; a cascata (clientes, propostas, contratos editáveis, imóveis) é dos gatilhos da 04–07;
-- - o motivo de bloqueio, recusa e inativação (texto livre) fica em parceiro_status_historico / motivo_inativacao,
--   nunca na auditoria (§5.1);
-- - erros de regra: P0001 com código de src/lib/erros.ts (MOTIVO_OBRIGATORIO, DESTINO_INVALIDO, DESCENDENTES_ATIVOS,
--   CAMPOS_OBRIGATORIOS {campos}, DADOS_INVALIDOS {motivo|campos}, DOCUMENTO_INDISPONIVEL, REGISTRO_DUPLICADO) ou
--   frase pronta em pt-BR, que o front mostra como veio;
-- - linhas mudadas são travadas (for update) ANTES das conferências de escopo, para não correr com outra RPC;
-- - linhas LIDAS que sustentam a regra (o destino de uma carteira ou de corretores, o novo gerente, o gerente e a
--   imobiliária de um cadastro ou de uma reativação) são travadas com FOR SHARE (_rede_travar_parceiro,
--   _rede_travar_imobiliaria) ANTES de conferir se estão ativas [WP1R-01]. FOR SHARE conflita com o FOR UPDATE da
--   inativação e do bloqueio: quem chega depois espera o commit e relê a versão gravada. Sem isso, o gatilho da cadeia
--   (que confere 'ativo' pelo snapshot do comando) deixava um cliente ativo sob um corretor recém-inativado. Ordem de
--   travamento: o alvo (for update) antes do destino; a imobiliária antes do parceiro; o perfil do autocadastro antes
--   de tudo. Um impasse ainda possível (duas inativações cruzadas, uma como destino da outra) termina em 40P01 para uma
--   delas, sem estado inconsistente;
-- - rede_pode_convidar e o CPF repetido (cadastro por parceiro, Meu cadastro) deixam rastro e têm limite por hora;
--   completar o CPF de outro parceiro é só dos internos [WP1R-04].

-- ============ HISTÓRICO DE STATUS DO ACESSO (aditivo; somente inclusão) ============
-- Aprovação, recusa, bloqueio, desbloqueio, inativação, reativação e vínculo por convite (N19). Guarda o motivo, que
-- não pode ir para a auditoria (texto livre). Sem grant a authenticated: sai só por rede_parceiro_detalhe (internos).
create table public.parceiro_status_historico (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  parceiro_id uuid references public.parceiros(id),
  de public.status_parceiro,
  para public.status_parceiro not null,
  motivo text check (length(motivo) <= 2000),
  ator_id uuid,                        -- sem FK (como historico_status): sobrevive à remoção do usuário
  -- 'migracao': registro gravado pelo corte (20260929000018, WP7) ao criar o vínculo do parceiro legado
  origem text not null default 'rpc' check (origem ~ '^(rpc|migracao|edge:[a-z0-9-]{1,60})$'),
  ocorrido_em timestamptz not null default now()
);
create index parceiro_status_historico_parceiro_idx on public.parceiro_status_historico (parceiro_id, ocorrido_em desc)
  where parceiro_id is not null;
create index parceiro_status_historico_profile_idx on public.parceiro_status_historico (profile_id, ocorrido_em desc)
  where profile_id is not null;
create trigger somente_inclusao before update or delete on public.parceiro_status_historico
  for each row execute function public._somente_inclusao();
alter table public.parceiro_status_historico enable row level security;
revoke all on public.parceiro_status_historico from anon, authenticated, service_role;
grant select, insert on public.parceiro_status_historico to service_role;

-- ============ AJUDANTES INTERNOS (prefixo _, sem grant) ============

-- quem chama enxerga o parceiro? Mesma regra da política "parceiros: escopo lê" (internos; o próprio vínculo ativo;
-- a imobiliária inteira; o gerente e os corretores dele).
create function public._rede_ve(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_id is not null and (public.is_admin() or exists (
    select 1 from public.parceiros p where p.id = p_id and (
         p.id = public.meu_parceiro_id()
      or p.imobiliaria_id = public.escopo_imobiliaria()
      or (p.tipo = 'corretor' and p.gerente_id = public.escopo_gerente()))))
$$;

-- quem chama gere o parceiro para a ação da matriz? Internos: qualquer um que não seja virtual. Imobiliária: gerentes e
-- corretores da própria imobiliária. Gerente: só os corretores dele. Usuários de imobiliária: só internos.
create function public._rede_gere(p_id uuid, p_acao text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_id is not null and exists (
    select 1 from public.parceiros p where p.id = p_id and not p.virtual and (
         public.is_admin()
      or (public.tem_permissao(p_acao) and p.tipo in ('gerente', 'corretor') and p.imobiliaria_id = public.escopo_imobiliaria())
      or (public.tem_permissao(p_acao) and p.tipo = 'corretor' and p.gerente_id = public.escopo_gerente())))
$$;

-- destino de carteira ou de corretores: vínculo ativo e, se houver login, acesso aprovado (bloqueado não recebe)
create function public._rede_destino_ativo(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.parceiros p left join public.profiles pr on pr.id = p.profile_id
    where p.id = p_id and p.inativado_em is null
      and (p.profile_id is null or (pr.status_parceiro = 'aprovado' and pr.inativado_em is null)))
$$;

-- A1: gerente pode ser o responsável pelo cliente?
create function public._rede_a1_ligado() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.permitido from public.permissoes_rede r
                   where r.acao = 'gerente_como_corretor' and r.tipo = 'gerente'), false)
$$;

-- motivo obrigatório (texto livre), aparado; no máximo 500 caracteres (cabe no histórico de vínculos)
create function public._rede_motivo(p_motivo text, p_minimo int default 5) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := btrim(coalesce(p_motivo, ''));
begin
  if length(v) < p_minimo then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001', detail = jsonb_build_object('minimo', p_minimo)::text;
  end if;
  if length(v) > 500 then
    raise exception 'O motivo pode ter no máximo 500 caracteres.' using errcode = 'P0001';
  end if;
  return v;
end $$;

-- lê um campo de texto de p_dados: só string ou null; vazio → nulo
create function public._rede_campo(p_dados jsonb, p_chave text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if not (p_dados ? p_chave) or jsonb_typeof(p_dados -> p_chave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_dados -> p_chave) <> 'string' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', array[p_chave])::text;
  end if;
  return nullif(btrim(p_dados ->> p_chave), '');
end $$;

-- confere que p_dados é um objeto só com chaves permitidas
create function public._rede_chaves(p_dados jsonb, p_permitidas text[]) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_extras text[];
begin
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"formato"}';
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_extras
  from jsonb_object_keys(p_dados) k where k <> all (p_permitidas);
  if cardinality(v_extras) > 0 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001',
      detail = jsonb_build_object('motivo', 'campos_desconhecidos', 'campos', v_extras)::text;
  end if;
end $$;

-- p_dados de parceiro (nome, cpf, creci, email, telefone) validado e normalizado; devolve só as chaves enviadas.
-- CPF e telefone só com dígitos; e-mail em minúsculas. Obrigatoriedade (PAR-4) é de quem chama.
create function public._rede_dados_parceiro(p_dados jsonb, p_permitidas text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_saida jsonb := '{}'::jsonb;
  v_chave text;
  v text;
begin
  perform public._rede_chaves(p_dados, p_permitidas);
  foreach v_chave in array p_permitidas loop
    continue when not (p_dados ? v_chave);
    v := public._rede_campo(p_dados, v_chave);
    case v_chave
      when 'nome' then
        if v is not null and length(v) not between 2 and 200 then
          raise exception 'O nome precisa ter entre 2 e 200 caracteres.' using errcode = 'P0001';
        end if;
      when 'cpf' then
        v := nullif(regexp_replace(coalesce(v, ''), '\D', '', 'g'), '');
        if v is not null and not (v ~ '^\d{11}$' and public.cpf_valido(v)) then
          raise exception 'CPF inválido.' using errcode = 'P0001';
        end if;
      when 'creci' then
        if v is not null and length(v) > 60 then
          raise exception 'O CRECI pode ter no máximo 60 caracteres.' using errcode = 'P0001';
        end if;
      when 'email' then
        v := lower(v);
        if v is not null and (length(v) > 200 or v !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
          raise exception 'E-mail inválido.' using errcode = 'P0001';
        end if;
      when 'telefone' then
        v := nullif(regexp_replace(coalesce(v, ''), '\D', '', 'g'), '');
        if v is not null and length(v) not between 10 and 13 then
          raise exception 'Telefone inválido: informe o DDD e o número.' using errcode = 'P0001';
        end if;
      else
        null;
    end case;
    v_saida := v_saida || jsonb_build_object(v_chave, v);
  end loop;
  return v_saida;
end $$;

-- p_dados de imobiliária validado e normalizado (CNPJ, CEP e telefone só com dígitos; UF em maiúsculas)
create function public._rede_dados_imobiliaria(p_dados jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_chaves constant text[] := array['nome', 'razao_social', 'cnpj', 'creci_pj', 'email', 'telefone', 'cep',
                                    'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
  v_ufs constant text[] := array['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
                                 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  v_saida jsonb := '{}'::jsonb;
  v_chave text;
  v text;
begin
  perform public._rede_chaves(p_dados, v_chaves);
  foreach v_chave in array v_chaves loop
    continue when not (p_dados ? v_chave);
    v := public._rede_campo(p_dados, v_chave);
    case v_chave
      when 'nome' then
        if v is not null and length(v) not between 2 and 200 then
          raise exception 'O nome precisa ter entre 2 e 200 caracteres.' using errcode = 'P0001';
        end if;
      when 'razao_social' then
        if v is not null and length(v) not between 2 and 200 then
          raise exception 'A razão social precisa ter entre 2 e 200 caracteres.' using errcode = 'P0001';
        end if;
      when 'cnpj' then
        v := nullif(regexp_replace(coalesce(v, ''), '\D', '', 'g'), '');
        if v is not null and not (v ~ '^\d{14}$' and public.cnpj_valido(v)) then
          raise exception 'CNPJ inválido.' using errcode = 'P0001';
        end if;
      when 'creci_pj' then
        if v is not null and length(v) > 60 then
          raise exception 'O CRECI PJ pode ter no máximo 60 caracteres.' using errcode = 'P0001';
        end if;
      when 'email' then
        v := lower(v);
        if v is not null and (length(v) > 200 or v !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
          raise exception 'E-mail inválido.' using errcode = 'P0001';
        end if;
      when 'telefone' then
        v := nullif(regexp_replace(coalesce(v, ''), '\D', '', 'g'), '');
        if v is not null and length(v) not between 10 and 13 then
          raise exception 'Telefone inválido: informe o DDD e o número.' using errcode = 'P0001';
        end if;
      when 'cep' then
        v := nullif(regexp_replace(coalesce(v, ''), '\D', '', 'g'), '');
        if v is not null and v !~ '^\d{8}$' then
          raise exception 'CEP inválido.' using errcode = 'P0001';
        end if;
      when 'uf' then
        v := upper(v);
        if v is not null and v <> all (v_ufs) then
          raise exception 'UF inválida.' using errcode = 'P0001';
        end if;
      when 'logradouro' then
        if length(v) > 200 then raise exception 'Logradouro muito longo.' using errcode = 'P0001'; end if;
      when 'numero' then
        if length(v) > 20 then raise exception 'Número muito longo.' using errcode = 'P0001'; end if;
      when 'complemento' then
        if length(v) > 100 then raise exception 'Complemento muito longo.' using errcode = 'P0001'; end if;
      when 'bairro' then
        if length(v) > 100 then raise exception 'Bairro muito longo.' using errcode = 'P0001'; end if;
      when 'cidade' then
        if length(v) > 100 then raise exception 'Cidade muito longa.' using errcode = 'P0001'; end if;
      else
        null;
    end case;
    v_saida := v_saida || jsonb_build_object(v_chave, v);
  end loop;
  return v_saida;
end $$;

-- histórico do status de acesso (motivo fora da auditoria)
create function public._rede_status(p_profile_id uuid, p_parceiro_id uuid, p_de public.status_parceiro,
                                    p_para public.status_parceiro, p_motivo text, p_origem text default 'rpc')
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.parceiro_status_historico (profile_id, parceiro_id, de, para, motivo, ator_id, origem)
  values (p_profile_id, p_parceiro_id, p_de, p_para, nullif(btrim(coalesce(p_motivo, '')), ''), auth.uid(),
          coalesce(p_origem, 'rpc'));
end $$;

-- o CPF declarado no autocadastro (raw_user_meta_data) sai dos metadados do Auth depois da aprovação ou da recusa:
-- o CPF de parceiro fica só em parceiros.cpf, lido por rede_parceiro_detalhe (auditada). Minimização (LGPD).
create function public._rede_limpar_cpf_declarado(p_profile_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update auth.users u set raw_user_meta_data = u.raw_user_meta_data - 'cpf'
   where u.id = p_profile_id and u.raw_user_meta_data ? 'cpf';
end $$;

-- move clientes ATIVOS para p_destino (quem chama já conferiu escopo e destino e travou as linhas). Pula quem já é do
-- destino e quem tem contrato em assinatura_pendente (cadeia congelada ⚑, §4.4). Cada cliente: cadeia pelo gatilho
-- clientes_cadeia (histórico com o motivo, propostas e contratos editáveis acompanham), timeline 'transferencia' e
-- auditoria operacao/transferir (de → para). Devolve quantos moveu.
create function public._rede_mover_clientes(p_ids uuid[], p_destino uuid, p_motivo text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_c record;
  v_novo record;
  v_n int := 0;
begin
  perform set_config('arken.motivo_vinculo', left(coalesce(p_motivo, ''), 500), true);
  for v_c in
    select c.id, c.corretor_id, c.gerente_id, c.imobiliaria_id from public.clientes c
    where c.id = any (coalesce(p_ids, '{}'::uuid[])) and c.inativado_em is null
      and c.corretor_id is distinct from p_destino
    order by c.id
    for update
  loop
    continue when exists (select 1 from public.contratos k where k.cliente_id = v_c.id and k.status = 'assinatura_pendente');
    update public.clientes c set corretor_id = p_destino where c.id = v_c.id
      returning c.corretor_id, c.gerente_id, c.imobiliaria_id into v_novo;
    perform public._evento_cliente(v_c.id, 'transferencia', 'Transferência de corretor',
      jsonb_build_object('de_corretor_id', v_c.corretor_id, 'para_corretor_id', p_destino));
    perform public._auditar('operacao', 'transferir', 'clientes', v_c.id::text, v_c.id,
      array['corretor_id', 'gerente_id', 'imobiliaria_id'],
      jsonb_build_object('corretor_id', v_c.corretor_id, 'gerente_id', v_c.gerente_id, 'imobiliaria_id', v_c.imobiliaria_id),
      jsonb_build_object('corretor_id', v_novo.corretor_id, 'gerente_id', v_novo.gerente_id,
                         'imobiliaria_id', v_novo.imobiliaria_id));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ids dos clientes ativos em que o parceiro é o responsável (corretor, ou gerente pelo A1), já travados
create function public._rede_carteira(p_parceiro_id uuid) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  v uuid[];
begin
  select coalesce(array_agg(t.id order by t.id), '{}') into v from (
    select c.id from public.clientes c where c.corretor_id = p_parceiro_id and c.inativado_em is null
    order by c.id for update) t;
  return v;
end $$;

-- aviso opcional de transferência (notificacoes_config 'rede.transferencia', desligado na semente ⚑ N10): só ids
create function public._rede_avisar_transferencia(p_destinatarios uuid[], p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v uuid[];
begin
  select coalesce(array_agg(distinct d), '{}') into v from unnest(coalesce(p_destinatarios, '{}'::uuid[])) d
  where d is not null;
  if cardinality(v) > 0 then
    perform public._notificar('rede.transferencia', v, null, coalesce(p_dados, '{}'::jsonb));
  end if;
end $$;

-- [WP1R-01] trava com FOR SHARE o parceiro que sustenta a regra (destino, novo gerente, gerente do cadastro) e o
-- perfil dele, e devolve a linha JÁ travada (a versão gravada, se outra transação a mudou enquanto esperávamos).
-- Inexistente: linha toda nula (confira v.id is null). Quem chama confere ativo/tipo/imobiliária DEPOIS disto.
create function public._rede_travar_parceiro(p_id uuid) returns public.parceiros
language plpgsql security definer set search_path = '' as $$
declare
  v public.parceiros%rowtype;
begin
  select * into v from public.parceiros p where p.id = p_id for share;
  if found and v.profile_id is not null then
    perform 1 from public.profiles pr where pr.id = v.profile_id for share;
  end if;
  return v;
end $$;

-- [WP1R-01] o mesmo para a imobiliária (cadastro e reativação contra rede_inativar_imobiliaria)
create function public._rede_travar_imobiliaria(p_id uuid) returns public.imobiliarias
language plpgsql security definer set search_path = '' as $$
declare
  v public.imobiliarias%rowtype;
begin
  select * into v from public.imobiliarias i where i.id = p_id for share;
  return v;
end $$;

-- [WP1R-04] limite por hora de quem chama (parceiros; internos não têm limite): quantas vezes a auditoria registrou
-- p_acao com detalhe @> p_filtro na última hora já chegou a configuracao_geral.duplicidade_bloqueios_hora? Trava
-- consultiva por quem chama e por ação ANTES de contar (volatile: a contagem vê o que a chamada anterior gravou),
-- para chamadas em paralelo não furarem o limite. As tentativas contadas ficam gravadas (a função que conta devolve
-- normalmente em vez de lançar), então o limite vale mesmo para quem só erra.
create function public._rede_limite_excedido(p_acao text, p_filtro jsonb default '{}') returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.rede.limite:' || p_acao),
                                           pg_catalog.hashtext(auth.uid()::text));
  return (select count(*) from public.auditoria a
          where a.ator_id = auth.uid() and a.ocorrido_em > now() - interval '1 hour'
            and a.acao = p_acao and a.detalhe @> coalesce(p_filtro, '{}'::jsonb))
         >= (select c.duplicidade_bloqueios_hora from public.configuracao_geral c);
end $$;

-- [WP7RN-01] PAR-4/N8: parceiro legado migrado (migrado_legado) que NUNCA foi aprovado (o histórico de status não tem
-- nenhum 'aprovado': foi bloqueado no sistema antigo, ou era um autocadastro pendente com carteira que o corte deixou
-- bloqueado) e ainda não tem CPF e CRECI só vira aprovado depois de completá-los. Devolve os campos que faltam ('{}'
-- quando a regra não se aplica). O legado que JÁ foi aprovado (o corte grava aprovado → aprovado) volta sem exigência.
create function public._rede_faltam_cpf_creci_legado(p_parceiro_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array_remove(array[case when p.cpf is null then 'cpf' end, case when p.creci is null then 'creci' end], null)
    from public.parceiros p
    where p.id = p_parceiro_id and p.migrado_legado and p.tipo = 'corretor'
      and not exists (select 1 from public.parceiro_status_historico h
                      where h.profile_id = p.profile_id and h.para = 'aprovado')), '{}'::text[])
$$;

revoke execute on function public._rede_ve(uuid), public._rede_gere(uuid, text), public._rede_destino_ativo(uuid),
  public._rede_faltam_cpf_creci_legado(uuid),
  public._rede_a1_ligado(), public._rede_motivo(text, int), public._rede_campo(jsonb, text),
  public._rede_chaves(jsonb, text[]), public._rede_dados_parceiro(jsonb, text[]), public._rede_dados_imobiliaria(jsonb),
  public._rede_status(uuid, uuid, public.status_parceiro, public.status_parceiro, text, text),
  public._rede_limpar_cpf_declarado(uuid), public._rede_mover_clientes(uuid[], uuid, text),
  public._rede_carteira(uuid), public._rede_avisar_transferencia(uuid[], jsonb),
  public._rede_travar_parceiro(uuid), public._rede_travar_imobiliaria(uuid), public._rede_limite_excedido(text, jsonb)
  from public, anon, authenticated, service_role;

-- ============ IMOBILIÁRIAS (I) ============

-- PAR-4: CNPJ (DV, único) e CRECI PJ obrigatórios. Só internos. A casa já existe (semente da 04).
create or replace function public.rede_cadastrar_imobiliaria(p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_d jsonb;
  v_faltando text[] := '{}';
  v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_d := public._rede_dados_imobiliaria(p_dados);
  if v_d ->> 'nome' is null then v_faltando := v_faltando || 'nome'::text; end if;
  if v_d ->> 'cnpj' is null then v_faltando := v_faltando || 'cnpj'::text; end if;
  if v_d ->> 'creci_pj' is null then v_faltando := v_faltando || 'creci_pj'::text; end if;
  if cardinality(v_faltando) > 0 then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = jsonb_build_object('campos', v_faltando)::text;
  end if;
  if exists (select 1 from public.imobiliarias i where i.cnpj = v_d ->> 'cnpj') then
    raise exception 'REGISTRO_DUPLICADO' using errcode = 'P0001', detail = '{"campos":["cnpj"]}';
  end if;

  insert into public.imobiliarias (nome, razao_social, cnpj, creci_pj, email, telefone, cep, logradouro, numero,
                                   complemento, bairro, cidade, uf)
  values (v_d ->> 'nome', v_d ->> 'razao_social', v_d ->> 'cnpj', v_d ->> 'creci_pj', v_d ->> 'email',
          v_d ->> 'telefone', v_d ->> 'cep', v_d ->> 'logradouro', v_d ->> 'numero', v_d ->> 'complemento',
          v_d ->> 'bairro', v_d ->> 'cidade', v_d ->> 'uf')
  returning id into v_id;

  perform public._auditar('operacao', 'criar', 'imobiliarias', v_id::text, null,
    (select coalesce(array_agg(k order by k), '{}') from jsonb_each(v_d) e(k, v) where jsonb_typeof(v) <> 'null'),
    null, jsonb_build_object('da_casa', false));
  return v_id;
end $$;

-- Só as chaves enviadas mudam. CNPJ (DV, único) e CRECI PJ não podem ficar vazios fora da casa. Só internos.
create or replace function public.rede_editar_imobiliaria(p_id uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.imobiliarias%rowtype;
  v_d jsonb;
  v_campos text[];
  v_depois public.imobiliarias%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_i from public.imobiliarias i where i.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_d := public._rede_dados_imobiliaria(p_dados);
  if v_d ? 'nome' and v_d ->> 'nome' is null then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = '{"campos":["nome"]}';
  end if;
  if not v_i.da_casa and ((v_d ? 'cnpj' and v_d ->> 'cnpj' is null) or (v_d ? 'creci_pj' and v_d ->> 'creci_pj' is null)) then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001',
      detail = jsonb_build_object('campos', array_remove(array[
        case when v_d ? 'cnpj' and v_d ->> 'cnpj' is null then 'cnpj' end,
        case when v_d ? 'creci_pj' and v_d ->> 'creci_pj' is null then 'creci_pj' end], null))::text;
  end if;
  if v_d ->> 'cnpj' is not null
     and exists (select 1 from public.imobiliarias i where i.cnpj = v_d ->> 'cnpj' and i.id <> v_i.id) then
    raise exception 'REGISTRO_DUPLICADO' using errcode = 'P0001', detail = '{"campos":["cnpj"]}';
  end if;

  update public.imobiliarias i set
    nome = case when v_d ? 'nome' then v_d ->> 'nome' else i.nome end,
    razao_social = case when v_d ? 'razao_social' then v_d ->> 'razao_social' else i.razao_social end,
    cnpj = case when v_d ? 'cnpj' then v_d ->> 'cnpj' else i.cnpj end,
    creci_pj = case when v_d ? 'creci_pj' then v_d ->> 'creci_pj' else i.creci_pj end,
    email = case when v_d ? 'email' then v_d ->> 'email' else i.email end,
    telefone = case when v_d ? 'telefone' then v_d ->> 'telefone' else i.telefone end,
    cep = case when v_d ? 'cep' then v_d ->> 'cep' else i.cep end,
    logradouro = case when v_d ? 'logradouro' then v_d ->> 'logradouro' else i.logradouro end,
    numero = case when v_d ? 'numero' then v_d ->> 'numero' else i.numero end,
    complemento = case when v_d ? 'complemento' then v_d ->> 'complemento' else i.complemento end,
    bairro = case when v_d ? 'bairro' then v_d ->> 'bairro' else i.bairro end,
    cidade = case when v_d ? 'cidade' then v_d ->> 'cidade' else i.cidade end,
    uf = case when v_d ? 'uf' then v_d ->> 'uf' else i.uf end
  where i.id = v_i.id
  returning i.* into v_depois;

  select coalesce(array_agg(k order by k), '{}') into v_campos
  from jsonb_each(to_jsonb(v_depois)) e(k, v)
  where k = any (array['nome', 'razao_social', 'cnpj', 'creci_pj', 'email', 'telefone', 'cep', 'logradouro', 'numero',
                       'complemento', 'bairro', 'cidade', 'uf'])
    and v is distinct from to_jsonb(v_i) -> k;
  if cardinality(v_campos) > 0 then
    perform public._auditar('operacao', 'editar', 'imobiliarias', v_i.id::text, null, v_campos);
  end if;
end $$;

-- Imobiliária sem parceiro ativo (a casa nunca). Só internos.
create or replace function public.rede_inativar_imobiliaria(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.imobiliarias%rowtype;
  v_motivo text;
  v_ativos int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_i from public.imobiliarias i where i.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_i.da_casa then
    raise exception 'A imobiliária da casa não pode ser inativada.' using errcode = 'P0001';
  end if;
  if v_i.inativado_em is not null then
    raise exception 'A imobiliária já está inativa.' using errcode = 'P0001';
  end if;
  v_motivo := public._rede_motivo(p_motivo);
  perform 1 from public.parceiros p where p.imobiliaria_id = v_i.id for update;
  select count(*) into v_ativos from public.parceiros p where p.imobiliaria_id = v_i.id and p.inativado_em is null;
  if v_ativos > 0 then
    raise exception 'DESCENDENTES_ATIVOS' using errcode = 'P0001', detail = jsonb_build_object('parceiros', v_ativos)::text;
  end if;
  update public.imobiliarias i set inativado_em = now(), motivo_inativacao = v_motivo where i.id = v_i.id;
  perform public._auditar('operacao', 'inativar', 'imobiliarias', v_i.id::text, null,
    array['inativado_em', 'inativado_por', 'motivo_inativacao'],
    jsonb_build_object('ativa', true), jsonb_build_object('ativa', false));
end $$;

-- ============ PARCEIROS: CADASTRO E EDIÇÃO ============

-- Matriz §3.3 + escopo:
--   imobiliaria (usuário da organização): só internos, fora da casa, CPF opcional;
--   gerente: internos (p_imobiliaria_id obrigatório) ou imobiliária com cadastrar_gerente (a própria); CPF obrigatório;
--   corretor: internos (p_gerente_id obrigatório), imobiliária com cadastrar_corretor (gerente da própria imobiliária)
--             ou gerente com cadastrar_corretor (só sob si; p_gerente_id nulo = ele); CPF e CRECI obrigatórios.
-- CPF único (DOCUMENTO_INDISPONIVEL, sem dizer de quem). O corretor nasce com código de indicação.
-- [WP1R-04] Para parceiros (não internos) o CPF repetido não lança: devolve NULO (nada criado), grava
-- seguranca/documento_indisponivel e conta no limite por hora (configuracao_geral.duplicidade_bloqueios_hora); acima
-- dele, LIMITE_DUPLICIDADE antes de olhar o CPF. Internos continuam recebendo DOCUMENTO_INDISPONIVEL.
-- [WP1R-01] A imobiliária e o gerente são travados (FOR SHARE) e conferidos depois da trava.
create or replace function public.rede_cadastrar_parceiro(p_tipo public.tipo_parceiro, p_dados jsonb,
                                                          p_imobiliaria_id uuid, p_gerente_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_interno boolean;
  v_esc_imob uuid;
  v_esc_ger uuid;
  v_d jsonb;
  v_imob public.imobiliarias%rowtype;
  v_ger public.parceiros%rowtype;
  v_imob_id uuid;
  v_ger_id uuid;
  v_faltando text[] := '{}';
  v_id uuid;
begin
  if auth.uid() is null or p_tipo is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_interno := public.is_admin();
  v_esc_imob := public.escopo_imobiliaria();
  v_esc_ger := public.escopo_gerente();

  if p_tipo = 'imobiliaria' then
    if not v_interno then
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
    if p_gerente_id is not null then
      raise exception 'Usuário de imobiliária não tem gerente.' using errcode = 'P0001';
    end if;
    v_imob_id := p_imobiliaria_id;
  elsif p_tipo = 'gerente' then
    if p_gerente_id is not null then
      raise exception 'Gerente não tem gerente acima dele.' using errcode = 'P0001';
    end if;
    if v_interno then
      v_imob_id := p_imobiliaria_id;
    elsif public.tem_permissao('cadastrar_gerente') and v_esc_imob is not null
          and (p_imobiliaria_id is null or p_imobiliaria_id = v_esc_imob) then
      v_imob_id := v_esc_imob;
    else
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
  else -- corretor
    if v_interno then
      v_ger_id := p_gerente_id;
    elsif public.tem_permissao('cadastrar_corretor') and v_esc_imob is not null then
      v_ger_id := p_gerente_id;
    elsif public.tem_permissao('cadastrar_corretor') and v_esc_ger is not null
          and (p_gerente_id is null or p_gerente_id = v_esc_ger) then
      v_ger_id := v_esc_ger;
    else
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
    if v_ger_id is null then
      raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = '{"campos":["gerente"]}';
    end if;
    -- a imobiliária do gerente é travada antes dele (ordem estável contra rede_inativar_imobiliaria)
    select g.imobiliaria_id into v_imob_id from public.parceiros g where g.id = v_ger_id;
    if v_imob_id is not null then
      v_imob := public._rede_travar_imobiliaria(v_imob_id);
    end if;
    v_ger := public._rede_travar_parceiro(v_ger_id);   -- [WP1R-01] conferido depois de travado
    if v_ger.id is null or (not v_interno and v_esc_imob is not null and v_ger.imobiliaria_id <> v_esc_imob) then
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
    if v_ger.tipo <> 'gerente' or v_ger.inativado_em is not null or v_ger.imobiliaria_id is distinct from v_imob_id then
      raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"gerente"}';
    end if;
    if p_imobiliaria_id is not null and p_imobiliaria_id <> v_ger.imobiliaria_id then
      raise exception 'O gerente escolhido não é da imobiliária informada.' using errcode = 'P0001';
    end if;
  end if;

  if v_imob_id is null then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = '{"campos":["imobiliaria"]}';
  end if;
  if p_tipo <> 'corretor' then
    v_imob := public._rede_travar_imobiliaria(v_imob_id);   -- [WP1R-01] contra rede_inativar_imobiliaria
  end if;
  if v_imob.id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_imob.inativado_em is not null then
    raise exception 'A imobiliária está inativa.' using errcode = 'P0001';
  end if;
  if p_tipo = 'imobiliaria' and v_imob.da_casa then
    raise exception 'A imobiliária da casa é administrada pela equipe Arken: cadastre gerentes e corretores nela.'
      using errcode = 'P0001';
  end if;

  v_d := public._rede_dados_parceiro(p_dados, array['nome', 'cpf', 'creci', 'email', 'telefone']);
  if v_d ->> 'nome' is null then v_faltando := v_faltando || 'nome'::text; end if;
  if p_tipo in ('gerente', 'corretor') and v_d ->> 'cpf' is null then v_faltando := v_faltando || 'cpf'::text; end if;
  if p_tipo = 'corretor' and v_d ->> 'creci' is null then v_faltando := v_faltando || 'creci'::text; end if;
  if cardinality(v_faltando) > 0 then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = jsonb_build_object('campos', v_faltando)::text;
  end if;
  if v_d ->> 'cpf' is not null then
    -- trava consultiva por CPF: dois cadastros do mesmo CPF em paralelo não passam os dois pela conferência
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.parceiros.cpf:' || (v_d ->> 'cpf')));
    -- [WP1R-04] parceiro: limite de CPFs repetidos por hora, conferido ANTES de olhar o CPF
    if public._rede_limite_excedido('documento_indisponivel') then
      raise exception 'LIMITE_DUPLICIDADE' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.parceiros p where p.cpf = v_d ->> 'cpf') then
      if v_interno then
        raise exception 'DOCUMENTO_INDISPONIVEL' using errcode = 'P0001';
      end if;
      -- [WP1R-04] parceiro: nada é criado; a tentativa fica na auditoria (sem o CPF) e conta no limite. Devolver
      -- nulo, em vez de lançar, é o que mantém o registro (uma exceção desfaria a linha). O front mostra
      -- DOCUMENTO_INDISPONIVEL (resposta genérica, sem dizer de quem é).
      perform public._auditar('seguranca', 'documento_indisponivel', 'parceiros', 'novo', null, array['cpf'], null, null,
        jsonb_build_object('tipo', p_tipo, 'imobiliaria_id', v_imob_id,
                           'gerente_id', case when p_tipo = 'corretor' then v_ger.id end));
      return null;
    end if;
  end if;

  perform set_config('arken.motivo_vinculo', 'cadastro', true);
  insert into public.parceiros (tipo, imobiliaria_id, gerente_id, nome, cpf, creci, email, telefone, codigo_indicacao)
  values (p_tipo, v_imob_id, case when p_tipo = 'corretor' then v_ger.id end, v_d ->> 'nome', v_d ->> 'cpf',
          v_d ->> 'creci', v_d ->> 'email', v_d ->> 'telefone',
          case when p_tipo = 'corretor' then public._gerar_codigo_indicacao() end)
  returning id into v_id;

  perform public._auditar('operacao', 'criar', 'parceiros', v_id::text, null,
    (select coalesce(array_agg(k order by k), '{}') from jsonb_each(v_d) e(k, v) where jsonb_typeof(v) <> 'null'),
    null, jsonb_build_object('tipo', p_tipo, 'imobiliaria_id', v_imob_id,
                             'gerente_id', case when p_tipo = 'corretor' then v_ger.id end));
  return v_id;
end $$;

-- matriz editar_subordinado + escopo (usuários de imobiliária: só internos; virtual e inativo: não). Só as chaves
-- enviadas mudam. CPF só se estiver vazio; e-mail não muda depois do login (o e-mail do login é do Auth).
-- [WP1R-04] Completar o CPF vazio de OUTRO parceiro é só dos internos. Para parceiros não tem uso (gerente e corretor
-- fora da casa sempre nascem com CPF; os legados sem CPF ficam na casa, que só os internos administram) e seria um
-- oráculo de CPF sem limite (a colisão lança e não deixa rastro). O próprio parceiro completa em Meu cadastro.
create or replace function public.rede_editar_parceiro(p_id uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.parceiros%rowtype;
  v_d jsonb;
  v_depois public.parceiros%rowtype;
  v_campos text[];
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_p from public.parceiros p where p.id = p_id for update;
  if not found or not public._rede_gere(v_p.id, 'editar_subordinado') then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_p.inativado_em is not null then
    raise exception 'Parceiro inativo não é editado: reative antes.' using errcode = 'P0001';
  end if;
  v_d := public._rede_dados_parceiro(p_dados, array['nome', 'cpf', 'creci', 'email', 'telefone']);
  if v_d ? 'nome' and v_d ->> 'nome' is null then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = '{"campos":["nome"]}';
  end if;
  if v_d ? 'cpf' and v_p.cpf is not null and (v_d ->> 'cpf') is distinct from v_p.cpf then
    raise exception 'O CPF já cadastrado não pode ser alterado.' using errcode = 'P0001';
  end if;
  if v_d ? 'cpf' and v_d ->> 'cpf' is null and v_p.tipo in ('gerente', 'corretor') and not v_p.migrado_legado then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = '{"campos":["cpf"]}';
  end if;
  if v_d ? 'creci' and v_d ->> 'creci' is null and v_p.tipo = 'corretor' and not v_p.migrado_legado then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = '{"campos":["creci"]}';
  end if;
  if v_d ? 'email' and v_p.profile_id is not null and (v_d ->> 'email') is distinct from v_p.email then
    raise exception 'O e-mail de quem já tem login não muda por aqui: é o e-mail de acesso.' using errcode = 'P0001';
  end if;
  if v_d ->> 'cpf' is not null and v_p.cpf is null then
    if not public.is_admin() then   -- [WP1R-04]
      raise exception 'O CPF de outro parceiro só é completado pela equipe Arken.' using errcode = 'P0001';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.parceiros.cpf:' || (v_d ->> 'cpf')));
    if exists (select 1 from public.parceiros p where p.cpf = v_d ->> 'cpf' and p.id <> v_p.id) then
      raise exception 'DOCUMENTO_INDISPONIVEL' using errcode = 'P0001';
    end if;
  end if;

  update public.parceiros p set
    nome = case when v_d ? 'nome' then v_d ->> 'nome' else p.nome end,
    cpf = case when v_d ? 'cpf' then coalesce(p.cpf, v_d ->> 'cpf') else p.cpf end,
    creci = case when v_d ? 'creci' then v_d ->> 'creci' else p.creci end,
    email = case when v_d ? 'email' then v_d ->> 'email' else p.email end,
    telefone = case when v_d ? 'telefone' then v_d ->> 'telefone' else p.telefone end
  where p.id = v_p.id
  returning p.* into v_depois;

  select coalesce(array_agg(k order by k), '{}') into v_campos
  from jsonb_each(to_jsonb(v_depois)) e(k, v)
  where k = any (array['nome', 'cpf', 'creci', 'email', 'telefone']) and v is distinct from to_jsonb(v_p) -> k;
  if cardinality(v_campos) > 0 then
    perform public._auditar('operacao', 'editar', 'parceiros', v_p.id::text, null, v_campos);
  end if;
end $$;

-- O próprio parceiro (vínculo ativo e aprovado): completa CPF e CRECI (PAR-4 dos legados) e ajusta nome e telefone.
-- E-mail é o do login: não muda por aqui.
-- [WP1R-04] CPF que já é de outro parceiro: NADA muda (nem os outros campos), a tentativa fica na auditoria
-- (seguranca/documento_indisponivel, sem o CPF) e conta no limite por hora (duplicidade_bloqueios_hora; acima dele,
-- LIMITE_DUPLICIDADE antes de olhar o CPF). Devolver normalmente, em vez de lançar, é o que mantém o registro; o front
-- confere se o CPF ficou gravado e, se não ficou, mostra DOCUMENTO_INDISPONIVEL.
create or replace function public.rede_atualizar_meu_cadastro(p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := public.meu_parceiro_id();
  v_p public.parceiros%rowtype;
  v_d jsonb;
  v_depois public.parceiros%rowtype;
  v_campos text[];
begin
  if auth.uid() is null or v_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_p from public.parceiros p where p.id = v_id for update;
  v_d := public._rede_dados_parceiro(p_dados, array['nome', 'cpf', 'creci', 'email', 'telefone']);
  if v_d ? 'nome' and v_d ->> 'nome' is null then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = '{"campos":["nome"]}';
  end if;
  if v_d ? 'email' and (v_d ->> 'email') is distinct from v_p.email then
    raise exception 'O e-mail é o do seu login e não muda por aqui. Fale com a equipe Arken.' using errcode = 'P0001';
  end if;
  if v_d ? 'cpf' and v_p.cpf is not null and (v_d ->> 'cpf') is distinct from v_p.cpf then
    raise exception 'O CPF já cadastrado não pode ser alterado. Fale com a equipe Arken.' using errcode = 'P0001';
  end if;
  if v_d ? 'creci' and v_d ->> 'creci' is null and v_p.tipo = 'corretor' and (v_p.creci is not null or not v_p.migrado_legado) then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = '{"campos":["creci"]}';
  end if;
  if v_d ->> 'cpf' is not null and v_p.cpf is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.parceiros.cpf:' || (v_d ->> 'cpf')));
    if public._rede_limite_excedido('documento_indisponivel') then   -- [WP1R-04]
      raise exception 'LIMITE_DUPLICIDADE' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.parceiros p where p.cpf = v_d ->> 'cpf' and p.id <> v_p.id) then
      perform public._auditar('seguranca', 'documento_indisponivel', 'parceiros', v_p.id::text, null, array['cpf'], null,
                              null, '{"proprio":true}'::jsonb);
      return;
    end if;
  end if;

  update public.parceiros p set
    nome = case when v_d ? 'nome' then v_d ->> 'nome' else p.nome end,
    cpf = case when v_d ? 'cpf' then coalesce(p.cpf, v_d ->> 'cpf') else p.cpf end,
    creci = case when v_d ? 'creci' then v_d ->> 'creci' else p.creci end,
    telefone = case when v_d ? 'telefone' then v_d ->> 'telefone' else p.telefone end
  where p.id = v_p.id
  returning p.* into v_depois;

  select coalesce(array_agg(k order by k), '{}') into v_campos
  from jsonb_each(to_jsonb(v_depois)) e(k, v)
  where k = any (array['nome', 'cpf', 'creci', 'telefone']) and v is distinct from to_jsonb(v_p) -> k;
  if cardinality(v_campos) > 0 then
    perform public._auditar('operacao', 'editar', 'parceiros', v_p.id::text, null, v_campos, null, null,
                            '{"proprio":true}'::jsonb);
  end if;
end $$;

-- ============ PARCEIROS: LEITURA (auditada: inclui CPF) ============

-- Escopo = política "parceiros: escopo lê". Fora dele (ou inexistente): nulo + acesso/acesso_negado. PAR-3: nomes da
-- cadeia acima de quem consulta saem nulos (o corretor não vê o nome do gerente; o gerente não vê o de outro gerente).
-- status_historico (com os motivos): só para internos.
create or replace function public.rede_parceiro_detalhe(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.parceiros%rowtype;
  v_i public.imobiliarias%rowtype;
  v_pr public.profiles%rowtype;
  v_ultimo timestamptz;
  v_convidado timestamptz;
  v_interno boolean;
  v_minha_imob uuid;
  v_r jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into v_p from public.parceiros p where p.id = p_id;
  if not found or not public._rede_ve(v_p.id) then
    perform public._auditar('acesso', 'acesso_negado', 'parceiros', coalesce(p_id::text, 'nulo'));
    return null;
  end if;
  v_interno := public.is_admin();
  v_minha_imob := public.minha_imobiliaria_id();
  select * into v_i from public.imobiliarias i where i.id = v_p.imobiliaria_id;
  if v_p.profile_id is not null then
    select * into v_pr from public.profiles pr where pr.id = v_p.profile_id;
    select u.last_sign_in_at, u.invited_at into v_ultimo, v_convidado from auth.users u where u.id = v_p.profile_id;
  end if;

  v_r := jsonb_build_object(
    'id', v_p.id,
    'profile_id', v_p.profile_id,
    'tipo', v_p.tipo,
    'nome', v_p.nome,
    'cpf', v_p.cpf,
    'creci', v_p.creci,
    'email', v_p.email,
    'telefone', v_p.telefone,
    'codigo_indicacao', v_p.codigo_indicacao,
    'virtual', v_p.virtual,
    'migrado_legado', v_p.migrado_legado,
    'imobiliaria_declarada', v_p.imobiliaria_declarada,
    'imobiliaria', jsonb_build_object('id', v_i.id, 'nome', v_i.nome, 'da_casa', v_i.da_casa),
    'gerente', case when v_p.tipo = 'corretor' and public._rede_ve(v_p.gerente_id) then
                 (select jsonb_build_object('id', g.id, 'nome', g.nome) from public.parceiros g where g.id = v_p.gerente_id)
               end,
    'status_parceiro', case when v_p.profile_id is not null then v_pr.status_parceiro end,
    'papel', case when v_p.profile_id is not null then v_pr.papel end,
    'tem_login', v_p.profile_id is not null,
    'ultimo_acesso_em', v_ultimo,
    'convite_pendente', v_p.profile_id is not null and v_convidado is not null and v_ultimo is null,
    'criado_em', v_p.criado_em,
    'inativado_em', v_p.inativado_em,
    'motivo_inativacao', v_p.motivo_inativacao,
    'corretores_ativos', case when v_p.tipo = 'gerente' then
                           (select count(*) from public.parceiros c where c.gerente_id = v_p.id and c.inativado_em is null)
                         else 0 end,
    'clientes_ativos', (select count(*) from public.clientes c where c.corretor_id = v_p.id and c.inativado_em is null),
    'historico', coalesce((
      select jsonb_agg(jsonb_build_object(
               'imobiliaria', case when v_interno or h.imobiliaria_id = v_minha_imob then
                                (select jsonb_build_object('id', i.id, 'nome', i.nome) from public.imobiliarias i
                                 where i.id = h.imobiliaria_id) end,
               'gerente', case when h.gerente_id is not null and public._rede_ve(h.gerente_id) then
                            (select jsonb_build_object('id', g.id, 'nome', g.nome) from public.parceiros g
                             where g.id = h.gerente_id) end,
               'vigente_de', h.vigente_de,
               'vigente_ate', h.vigente_ate,
               'motivo', h.motivo) order by h.vigente_de desc, h.id desc)
      from (select * from public.parceiro_vinculos_historico x where x.parceiro_id = v_p.id
            order by x.vigente_de desc, x.id desc limit 100) h), '[]'::jsonb),
    'status_historico', case when v_interno then coalesce((
      select jsonb_agg(jsonb_build_object('de', s.de, 'para', s.para, 'motivo', s.motivo, 'ocorrido_em', s.ocorrido_em)
                       order by s.ocorrido_em desc, s.id desc)
      from (select * from public.parceiro_status_historico x
            where x.parceiro_id = v_p.id or (v_p.profile_id is not null and x.profile_id = v_p.profile_id)
            order by x.ocorrido_em desc, x.id desc limit 100) s), '[]'::jsonb) end);

  perform public._auditar('acesso', 'consultar', 'parceiros', v_p.id::text);
  return v_r;
end $$;

-- ============ AUTOCADASTRO (N8, N18): aprovação interna ============

-- Perfil 'parceiro' pendente, sem linha em parceiros e com o e-mail confirmado → corretor sob p_gerente_id (nulo =
-- Gerência Arken, a casa ⚑ A4). CPF: p_dados.cpf ou, vazio, o declarado no cadastro (metadados do Auth, que saem
-- de lá depois). CRECI: p_dados.creci ou o do cadastro. Papel → corretor, status → aprovado. E-mail: o do login
-- (auth.users), nunca profiles.email [WP1R-03].
create or replace function public.rede_aprovar_autocadastro(p_profile_id uuid, p_gerente_id uuid, p_dados jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pr public.profiles%rowtype;
  v_confirmado timestamptz;
  v_meta jsonb;
  v_d jsonb;
  v_cpf text;
  v_creci text;
  v_nome text;
  v_tel text;
  v_ger public.parceiros%rowtype;
  v_ger_id uuid := p_gerente_id;
  v_imob_id uuid;
  v_email text;
  v_faltando text[] := '{}';
  v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_pr from public.profiles pr where pr.id = p_profile_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_pr.papel <> 'parceiro' or v_pr.status_parceiro <> 'pendente' or v_pr.inativado_em is not null
     or exists (select 1 from public.parceiros p where p.profile_id = v_pr.id) then
    raise exception 'Este cadastro não está pendente de aprovação.' using errcode = 'P0001';
  end if;
  -- [WP1R-03] o e-mail do parceiro é o do LOGIN (auth.users, verificado), nunca profiles.email: esse o próprio
  -- usuário edita pela API e viraria o "E-mail (login)" do corretor e o do signatário nos contratos
  select u.email_confirmed_at, coalesce(u.raw_user_meta_data, '{}'::jsonb), nullif(left(lower(btrim(u.email)), 200), '')
    into v_confirmado, v_meta, v_email
  from auth.users u where u.id = v_pr.id;
  if v_confirmado is null then
    raise exception 'O parceiro ainda não confirmou o e-mail do cadastro.' using errcode = 'P0001';
  end if;

  v_d := public._rede_dados_parceiro(coalesce(p_dados, '{}'::jsonb), array['nome', 'cpf', 'creci', 'telefone']);
  v_cpf := v_d ->> 'cpf';
  if v_cpf is null and jsonb_typeof(v_meta -> 'cpf') = 'string' then
    v_cpf := nullif(regexp_replace(v_meta ->> 'cpf', '\D', '', 'g'), '');
    if v_cpf is not null and not (v_cpf ~ '^\d{11}$' and public.cpf_valido(v_cpf)) then
      raise exception 'O CPF informado no cadastro é inválido. Informe o CPF correto.' using errcode = 'P0001';
    end if;
  end if;
  v_creci := coalesce(v_d ->> 'creci', nullif(btrim(coalesce(v_pr.creci, '')), ''));
  v_nome := coalesce(v_d ->> 'nome', nullif(btrim(v_pr.nome), ''), split_part(coalesce(v_email, ''), '@', 1));
  v_tel := coalesce(v_d ->> 'telefone', nullif(regexp_replace(coalesce(v_pr.telefone, ''), '\D', '', 'g'), ''));
  if v_tel is not null and length(v_tel) not between 10 and 13 then
    v_tel := null;   -- o telefone antigo fora do formato fica só no perfil
  end if;
  if v_cpf is null then v_faltando := v_faltando || 'cpf'::text; end if;
  if v_creci is null then v_faltando := v_faltando || 'creci'::text; end if;
  if coalesce(length(v_nome), 0) < 2 then v_faltando := v_faltando || 'nome'::text; end if;
  if cardinality(v_faltando) > 0 then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = jsonb_build_object('campos', v_faltando)::text;
  end if;
  if length(v_creci) > 60 then
    raise exception 'O CRECI pode ter no máximo 60 caracteres.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.parceiros p where p.cpf = v_cpf) then
    raise exception 'DOCUMENTO_INDISPONIVEL' using errcode = 'P0001';
  end if;

  if v_ger_id is null then
    select c.gerente_casa_id into v_ger_id from public.configuracao_geral c;
  end if;
  -- [WP1R-01] imobiliária e gerente travados (nessa ordem) e conferidos depois da trava
  select g.imobiliaria_id into v_imob_id from public.parceiros g where g.id = v_ger_id;
  if v_imob_id is not null then
    perform public._rede_travar_imobiliaria(v_imob_id);
  end if;
  v_ger := public._rede_travar_parceiro(v_ger_id);
  if v_ger.id is null or v_ger.tipo <> 'gerente' or v_ger.inativado_em is not null
     or v_ger.imobiliaria_id is distinct from v_imob_id
     or exists (select 1 from public.imobiliarias i where i.id = v_ger.imobiliaria_id and i.inativado_em is not null) then
    raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"gerente"}';
  end if;

  perform set_config('arken.motivo_vinculo', 'aprovação de autocadastro', true);
  insert into public.parceiros (profile_id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci, email, telefone,
                                imobiliaria_declarada, codigo_indicacao)
  values (v_pr.id, 'corretor', v_ger.imobiliaria_id, v_ger.id, left(v_nome, 200), v_cpf, v_creci,
          v_email, v_tel, left(nullif(btrim(coalesce(v_pr.imobiliaria, '')), ''), 200),
          public._gerar_codigo_indicacao())
  returning id into v_id;
  update public.profiles pr set papel = 'corretor', status_parceiro = 'aprovado' where pr.id = v_pr.id;
  perform public._rede_status(v_pr.id, v_id, 'pendente', 'aprovado', null);
  perform public._rede_limpar_cpf_declarado(v_pr.id);

  perform public._auditar('operacao', 'aprovar', 'parceiros', v_id::text, null,
    array_remove(array['profile_id', 'nome', 'cpf', 'creci', case when v_email is not null then 'email' end,
                       case when v_tel is not null then 'telefone' end, 'papel', 'status_parceiro'], null),
    jsonb_build_object('papel', 'parceiro', 'status_parceiro', 'pendente'),
    jsonb_build_object('papel', 'corretor', 'status_parceiro', 'aprovado', 'tipo', 'corretor',
                       'imobiliaria_id', v_ger.imobiliaria_id, 'gerente_id', v_ger.id),
    jsonb_build_object('profile_id', v_pr.id));
  return v_id;
end $$;

-- Perfil 'parceiro' pendente, sem linha em parceiros → status 'bloqueado' (o motivo fica no histórico de status).
create or replace function public.rede_recusar_autocadastro(p_profile_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pr public.profiles%rowtype;
  v_motivo text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_pr from public.profiles pr where pr.id = p_profile_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_pr.papel <> 'parceiro' or v_pr.status_parceiro <> 'pendente' or v_pr.inativado_em is not null
     or exists (select 1 from public.parceiros p where p.profile_id = v_pr.id) then
    raise exception 'Este cadastro não está pendente de aprovação.' using errcode = 'P0001';
  end if;
  v_motivo := public._rede_motivo(p_motivo);
  update public.profiles pr set status_parceiro = 'bloqueado' where pr.id = v_pr.id;
  perform public._rede_status(v_pr.id, null, 'pendente', 'bloqueado', v_motivo);
  perform public._rede_limpar_cpf_declarado(v_pr.id);
  perform public._auditar('operacao', 'recusar', 'profiles', v_pr.id::text, null, array['status_parceiro'],
    jsonb_build_object('status_parceiro', 'pendente'), jsonb_build_object('status_parceiro', 'bloqueado'));
end $$;

-- ============ BLOQUEIO (N19: temporário, mantém a carteira) — só internos ============

create or replace function public.rede_bloquear_parceiro(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.parceiros%rowtype;
  v_pr public.profiles%rowtype;
  v_motivo text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_p from public.parceiros p where p.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_motivo := public._rede_motivo(p_motivo);
  if v_p.profile_id is null then
    raise exception 'Este parceiro não tem login para bloquear.' using errcode = 'P0001';
  end if;
  select * into v_pr from public.profiles pr where pr.id = v_p.profile_id for update;
  if v_p.inativado_em is not null or v_pr.status_parceiro = 'inativo' then
    raise exception 'Parceiro inativo: o acesso já está encerrado.' using errcode = 'P0001';
  end if;
  if v_pr.status_parceiro = 'bloqueado' then
    raise exception 'O acesso deste parceiro já está bloqueado.' using errcode = 'P0001';
  end if;
  update public.profiles pr set status_parceiro = 'bloqueado' where pr.id = v_pr.id;
  perform public._rede_status(v_pr.id, v_p.id, v_pr.status_parceiro, 'bloqueado', v_motivo);
  perform public._auditar('seguranca', 'bloquear', 'parceiros', v_p.id::text, null, array['status_parceiro'],
    jsonb_build_object('status_parceiro', v_pr.status_parceiro), jsonb_build_object('status_parceiro', 'bloqueado'),
    jsonb_build_object('profile_id', v_pr.id));
end $$;

create or replace function public.rede_desbloquear_parceiro(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.parceiros%rowtype;
  v_pr public.profiles%rowtype;
  v_faltando text[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_p from public.parceiros p where p.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_p.profile_id is null then
    raise exception 'Este parceiro não tem login.' using errcode = 'P0001';
  end if;
  select * into v_pr from public.profiles pr where pr.id = v_p.profile_id for update;
  if v_pr.status_parceiro <> 'bloqueado' then
    raise exception 'O acesso deste parceiro não está bloqueado.' using errcode = 'P0001';
  end if;
  if v_p.inativado_em is not null then
    raise exception 'Parceiro inativo: use a reativação.' using errcode = 'P0001';
  end if;
  -- [WP7RN-01] legado que nunca foi aprovado: o desbloqueio é a primeira aprovação, então vale o PAR-4 (CPF e CRECI)
  v_faltando := public._rede_faltam_cpf_creci_legado(v_p.id);
  if cardinality(v_faltando) > 0 then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = jsonb_build_object('campos', v_faltando)::text;
  end if;
  update public.profiles pr set status_parceiro = 'aprovado' where pr.id = v_pr.id;
  perform public._rede_status(v_pr.id, v_p.id, 'bloqueado', 'aprovado', null);
  perform public._auditar('seguranca', 'desbloquear', 'parceiros', v_p.id::text, null, array['status_parceiro'],
    jsonb_build_object('status_parceiro', 'bloqueado'), jsonb_build_object('status_parceiro', 'aprovado'),
    jsonb_build_object('profile_id', v_pr.id));
end $$;

-- ============ CONVITE (§6.2) ============

-- Com o JWT de quem convida (também pela Edge convidar-parceiros). Matriz: internos; imobiliária convida gerentes
-- (cadastrar_gerente) e corretores (cadastrar_corretor) da própria imobiliária; gerente, os corretores dele. Fora
-- disso: 42501. situacao: novo | reenviar | email_em_uso | ja_ativo | sem_email | indisponivel. Nenhum link para
-- conta que não seja deste parceiro (email_em_uso) ou que já entrou (ja_ativo).
-- [WP1R-04] A resposta diz se um e-mail tem conta no Auth (email_em_uso), e o e-mail de um parceiro sem login é
-- editável: toda consulta grava seguranca/convite_consulta (a situação, nunca o e-mail) e, para parceiros, depois de
-- configuracao_geral.duplicidade_bloqueios_hora respostas email_em_uso na última hora, QUALQUER consulta é recusada
-- com LIMITE_CONVITES até a hora passar (conferido antes de olhar o Auth, para a recusa não revelar nada).
create or replace function public.rede_pode_convidar(p_parceiro_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.parceiros%rowtype;
  v_permitido boolean;
  v_situacao text;
  v_ultimo timestamptz;
  v_convidado timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_p from public.parceiros p where p.id = p_parceiro_id;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_permitido := public.is_admin()
    or (v_p.tipo = 'gerente' and public._rede_gere(v_p.id, 'cadastrar_gerente'))
    or (v_p.tipo = 'corretor' and public._rede_gere(v_p.id, 'cadastrar_corretor'));
  if not v_permitido then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if public._rede_limite_excedido('convite_consulta', '{"situacao":"email_em_uso"}') then
    raise exception 'LIMITE_CONVITES' using errcode = 'P0001';
  end if;

  if v_p.virtual or v_p.inativado_em is not null then
    v_situacao := 'indisponivel';
  elsif v_p.profile_id is not null then
    select u.last_sign_in_at, u.invited_at into v_ultimo, v_convidado from auth.users u where u.id = v_p.profile_id;
    v_situacao := case when v_convidado is not null and v_ultimo is null then 'reenviar' else 'ja_ativo' end;
  elsif v_p.email is null then
    v_situacao := 'sem_email';
  elsif exists (select 1 from auth.users u where lower(u.email) = lower(v_p.email)) then
    v_situacao := 'email_em_uso';
  else
    v_situacao := 'novo';
  end if;

  perform public._auditar('seguranca', 'convite_consulta', 'parceiros', v_p.id::text, null, null, null, null,
    jsonb_build_object('situacao', v_situacao));
  return jsonb_build_object(
    'pode', v_situacao in ('novo', 'reenviar'),
    'situacao', v_situacao,
    'email', v_p.email,
    'nome', v_p.nome,
    'modo_link', public.tem_permissao('convite_por_link'),
    'profile_id', v_p.profile_id);
end $$;

-- Só service_role (Edge convidar-parceiros, depois de criar o usuário no Auth). Aceita só o perfil recém-criado por
-- AQUELE convite: papel 'parceiro' pendente e sem vínculo; no Auth, convidado (invited_at), nunca entrou, sem senha
-- (a conta nasceu do convite, não de um cadastro de terceiro), criado há menos de 10 min e com o mesmo e-mail do
-- parceiro. Papel = parceiros.tipo; status 'aprovado'. Repetir com o mesmo par é idempotente.
create or replace function public.rede_vincular_login(p_parceiro_id uuid, p_profile_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.parceiros%rowtype;
  v_pr public.profiles%rowtype;
  v_u record;
  v_motivo text;
begin
  select * into v_p from public.parceiros p where p.id = p_parceiro_id for update;
  if not found or v_p.virtual or v_p.inativado_em is not null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"parceiro"}';
  end if;
  if v_p.profile_id is not null then
    if v_p.profile_id = p_profile_id then
      return;
    end if;
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"parceiro_ja_vinculado"}';
  end if;
  select * into v_pr from public.profiles pr where pr.id = p_profile_id for update;
  if not found or v_pr.papel <> 'parceiro' or v_pr.status_parceiro <> 'pendente' or v_pr.inativado_em is not null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"perfil"}';
  end if;
  if exists (select 1 from public.parceiros p where p.profile_id = v_pr.id) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"perfil_vinculado"}';
  end if;
  select u.email, u.invited_at, u.last_sign_in_at, u.created_at, coalesce(u.encrypted_password, '') as senha
    into v_u from auth.users u where u.id = v_pr.id;
  v_motivo := case
    when v_u.invited_at is null then 'nao_convidado'
    when v_u.last_sign_in_at is not null then 'ja_entrou'
    when v_u.senha <> '' then 'com_senha'
    when v_u.created_at < now() - interval '10 minutes' then 'perfil_antigo'
    when v_p.email is null or lower(btrim(coalesce(v_u.email, ''))) <> lower(btrim(v_p.email)) then 'email_diferente'
  end;
  if v_motivo is not null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('motivo', v_motivo)::text;
  end if;

  update public.parceiros p set profile_id = v_pr.id where p.id = v_p.id;
  update public.profiles pr set papel = v_p.tipo::text::public.papel, status_parceiro = 'aprovado' where pr.id = v_pr.id;
  perform public._rede_status(v_pr.id, v_p.id, 'pendente', 'aprovado', null, 'edge:convidar-parceiros');
  perform public._auditar('seguranca', 'convite', 'parceiros', v_p.id::text, null,
    array['profile_id', 'papel', 'status_parceiro'],
    jsonb_build_object('papel', 'parceiro', 'status_parceiro', 'pendente'),
    jsonb_build_object('papel', v_p.tipo, 'status_parceiro', 'aprovado'),
    jsonb_build_object('profile_id', v_pr.id), 'edge:convidar-parceiros');
end $$;

-- Só service_role: registra quem gerou o convite, para quem e o modo (nunca o link). O ator é quem chamou a Edge (o
-- JWT dele já passou por rede_pode_convidar); por isso a linha é gravada aqui, e não por _auditar (auth.uid() é nulo
-- na service role).
create or replace function public.rede_registrar_convite(p_parceiro_id uuid, p_modo text, p_ator uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.parceiros%rowtype;
  v_papel public.papel;
  v_ator_parceiro uuid;
begin
  if p_modo is null or p_modo not in ('email', 'link') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"modo"}';
  end if;
  select * into v_p from public.parceiros p where p.id = p_parceiro_id;
  if not found then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"parceiro"}';
  end if;
  select pr.papel into v_papel from public.profiles pr where pr.id = p_ator;
  if not found then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"ator"}';
  end if;
  select p.id into v_ator_parceiro from public.parceiros p where p.profile_id = p_ator;
  insert into public.auditoria (categoria, acao, entidade, entidade_id, ator_id, ator_papel, ator_parceiro_id, origem,
                                detalhe)
  values ('seguranca', 'link_gerado', 'parceiros', v_p.id::text, p_ator, v_papel, v_ator_parceiro,
          'edge:convidar-parceiros', jsonb_build_object('modo', p_modo, 'profile_id', v_p.profile_id));
end $$;

-- ============ TRANSFERÊNCIAS ============

-- Motivo ≥ 5. Destino ativo (sem login ou aprovado): corretor, ou gerente com A1. Escopo: imobiliária (clientes e
-- destino dela); gerente (clientes da equipe, inclusive os dele pelo A1; destino = ele ou um corretor dele); internos
-- (entre imobiliárias só o Super). Cliente inexistente, inativo ou fora do escopo: 42501 (tudo ou nada). Clientes com
-- contrato em assinatura_pendente ficam (cadeia congelada ⚑). Devolve quantos foram transferidos.
create or replace function public.rede_transferir_clientes(p_cliente_ids uuid[], p_novo_corretor_id uuid, p_motivo text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_interno boolean;
  v_super boolean;
  v_esc_imob uuid;
  v_esc_ger uuid;
  v_ids uuid[];
  v_dest public.parceiros%rowtype;
  v_motivo text;
  v_total int;
  v_fora int;
  v_inativos int;
  v_outra_imob int;
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_interno := public.is_admin();
  v_super := public.is_super();
  if not v_interno then
    v_esc_imob := public.escopo_imobiliaria();
    v_esc_ger := public.escopo_gerente();
    if not public.tem_permissao('transferir_cliente') or (v_esc_imob is null and v_esc_ger is null) then
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
  end if;
  if p_cliente_ids is null or cardinality(p_cliente_ids) = 0 or array_position(p_cliente_ids, null) is not null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"clientes"}';
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_cliente_ids) x;
  if cardinality(v_ids) > 500 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"limite","maximo":500}';
  end if;
  v_motivo := public._rede_motivo(p_motivo);

  -- [WP1R-01] o destino é travado (FOR SHARE) antes de conferir: uma inativação ou um bloqueio em andamento termina
  -- antes, e o destino é conferido na versão gravada (sem isso o cliente ficava sob um corretor recém-inativado)
  v_dest := public._rede_travar_parceiro(p_novo_corretor_id);
  if v_dest.id is null or not (v_interno
      or (v_esc_imob is not null and v_dest.imobiliaria_id = v_esc_imob)
      or (v_esc_ger is not null and (v_dest.id = v_esc_ger or (v_dest.tipo = 'corretor' and v_dest.gerente_id = v_esc_ger)))) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_dest.tipo = 'imobiliaria' or not public._rede_destino_ativo(v_dest.id)
     or (v_dest.tipo = 'gerente' and not public._rede_a1_ligado()) then
    raise exception 'DESTINO_INVALIDO' using errcode = 'P0001';
  end if;

  -- trava antes de conferir: a cadeia conferida é a que vai ser movida
  perform 1 from public.clientes c where c.id = any (v_ids) order by c.id for update;
  select count(*),
         count(*) filter (where not (v_interno
                                     or (v_esc_imob is not null and c.imobiliaria_id = v_esc_imob)
                                     or (v_esc_ger is not null and c.gerente_id = v_esc_ger))),
         count(*) filter (where c.inativado_em is not null),
         count(*) filter (where c.imobiliaria_id is distinct from v_dest.imobiliaria_id)
    into v_total, v_fora, v_inativos, v_outra_imob
  from public.clientes c where c.id = any (v_ids);
  if v_total <> cardinality(v_ids) or v_fora > 0 or (not v_interno and v_inativos > 0) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_inativos > 0 then
    raise exception 'Cliente inativo não é transferido.' using errcode = 'P0001';
  end if;
  if v_outra_imob > 0 and not v_super then
    raise exception 'Transferência de cliente entre imobiliárias só pelo Super.' using errcode = 'P0001';
  end if;

  v_n := public._rede_mover_clientes(v_ids, v_dest.id, v_motivo);
  if v_n > 0 then
    perform public._rede_avisar_transferencia(array[v_dest.profile_id],
      jsonb_build_object('tipo', 'clientes', 'quantidade', v_n, 'para_corretor_id', v_dest.id));
  end if;
  return v_n;
end $$;

-- Corretor para outro gerente da MESMA imobiliária: imobiliária (transferir_corretor) ou internos. A cascata leva os
-- clientes, as propostas e os contratos editáveis na mesma transação; os históricos guardam o motivo.
create or replace function public.rede_transferir_corretor(p_corretor_id uuid, p_novo_gerente_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_interno boolean;
  v_esc_imob uuid;
  v_c public.parceiros%rowtype;
  v_g public.parceiros%rowtype;
  v_motivo text;
  v_clientes int;
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_interno := public.is_admin();
  v_esc_imob := case when v_interno then null else public.escopo_imobiliaria() end;
  select * into v_c from public.parceiros p where p.id = p_corretor_id for update;
  if not found or not (v_interno or (public.tem_permissao('transferir_corretor') and v_esc_imob is not null
                                     and v_c.imobiliaria_id = v_esc_imob)) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_c.tipo <> 'corretor' then
    raise exception 'Só corretores mudam de gerente.' using errcode = 'P0001';
  end if;
  if v_c.virtual then
    raise exception 'A cadeia da casa não pode ser movida.' using errcode = 'P0001';
  end if;
  if v_c.inativado_em is not null then
    raise exception 'Parceiro inativo não muda de gerente.' using errcode = 'P0001';
  end if;
  v_motivo := public._rede_motivo(p_motivo);
  v_g := public._rede_travar_parceiro(p_novo_gerente_id);   -- [WP1R-01] conferido depois de travado
  if v_g.id is null or not (v_interno or v_g.imobiliaria_id = v_esc_imob) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_g.tipo <> 'gerente' or v_g.inativado_em is not null or v_g.imobiliaria_id <> v_c.imobiliaria_id then
    raise exception 'DESTINO_INVALIDO' using errcode = 'P0001';
  end if;
  if v_g.id = v_c.gerente_id then
    raise exception 'O corretor já está com este gerente.' using errcode = 'P0001';
  end if;

  select count(*) into v_clientes from public.clientes c where c.corretor_id = v_c.id and c.inativado_em is null;
  perform set_config('arken.motivo_vinculo', v_motivo, true);
  update public.parceiros p set gerente_id = v_g.id where p.id = v_c.id;
  perform public._auditar('operacao', 'transferir', 'parceiros', v_c.id::text, null, array['gerente_id'],
    jsonb_build_object('gerente_id', v_c.gerente_id, 'imobiliaria_id', v_c.imobiliaria_id),
    jsonb_build_object('gerente_id', v_g.id, 'imobiliaria_id', v_c.imobiliaria_id),
    jsonb_build_object('clientes', v_clientes));
  perform public._rede_avisar_transferencia(array[v_c.profile_id, v_g.profile_id],
    jsonb_build_object('tipo', 'corretor', 'corretor_id', v_c.id, 'para_gerente_id', v_g.id));
end $$;

-- PAR-6: o corretor muda de imobiliária e a carteira FICA na origem (transferida antes para p_destino_carteira_id, um
-- corretor da imobiliária de origem, ou o gerente dela pelo A1). Reatribuir cadeia entre imobiliárias é do Super (§2.1 ⚑).
create or replace function public.rede_mudar_imobiliaria_corretor(p_corretor_id uuid, p_novo_gerente_id uuid,
                                                                  p_destino_carteira_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.parceiros%rowtype;
  v_g public.parceiros%rowtype;
  v_dest public.parceiros%rowtype;
  v_motivo text;
  v_carteira uuid[];
  v_n int := 0;
  v_restam int;
begin
  if auth.uid() is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_c from public.parceiros p where p.id = p_corretor_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_c.tipo <> 'corretor' or v_c.virtual or v_c.inativado_em is not null then
    raise exception 'Só um corretor ativo muda de imobiliária.' using errcode = 'P0001';
  end if;
  v_motivo := public._rede_motivo(p_motivo);
  v_g := public._rede_travar_parceiro(p_novo_gerente_id);   -- [WP1R-01] conferido depois de travado
  if v_g.id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_g.tipo <> 'gerente' or v_g.inativado_em is not null then
    raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"gerente"}';
  end if;
  if v_g.imobiliaria_id = v_c.imobiliaria_id then
    raise exception 'O gerente é da mesma imobiliária: use a transferência de corretor.' using errcode = 'P0001';
  end if;

  v_carteira := public._rede_carteira(v_c.id);
  if cardinality(v_carteira) > 0 then
    v_dest := public._rede_travar_parceiro(p_destino_carteira_id);   -- [WP1R-01]
    if v_dest.id is null or v_dest.id = v_c.id or v_dest.imobiliaria_id <> v_c.imobiliaria_id
       or v_dest.tipo = 'imobiliaria' or not public._rede_destino_ativo(v_dest.id)
       or (v_dest.tipo = 'gerente' and not public._rede_a1_ligado()) then
      raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"carteira"}';
    end if;
    v_n := public._rede_mover_clientes(v_carteira, v_dest.id, v_motivo);
  end if;
  select count(*) into v_restam from public.clientes c where c.corretor_id = v_c.id and c.inativado_em is null;
  if v_restam > 0 then
    raise exception 'DESCENDENTES_ATIVOS' using errcode = 'P0001',
      detail = jsonb_build_object('clientes', v_restam, 'motivo', 'assinatura_pendente')::text;
  end if;

  perform set_config('arken.motivo_vinculo', v_motivo, true);
  update public.parceiros p set gerente_id = v_g.id where p.id = v_c.id;
  perform public._auditar('operacao', 'transferir', 'parceiros', v_c.id::text, null, array['gerente_id', 'imobiliaria_id'],
    jsonb_build_object('gerente_id', v_c.gerente_id, 'imobiliaria_id', v_c.imobiliaria_id),
    jsonb_build_object('gerente_id', v_g.id, 'imobiliaria_id', v_g.imobiliaria_id),
    jsonb_build_object('clientes_transferidos', v_n, 'destino_carteira_id', case when v_n > 0 then v_dest.id end));
  perform public._rede_avisar_transferencia(array[v_c.profile_id, v_g.profile_id],
    jsonb_build_object('tipo', 'corretor', 'corretor_id', v_c.id, 'para_gerente_id', v_g.id));
end $$;

-- N3: só o Super, só um corretor migrado (migrado_legado) que ainda está na imobiliária da casa e nunca saiu dela (uma
-- vez só); vai para um gerente de imobiliária real. p_levar_clientes sem padrão: true leva a carteira (exceção
-- declarada ao PAR-6); false a deixa na Carteira Arken. CPF e CRECI precisam estar completos (PAR-4).
create or replace function public.rede_regularizar_legado(p_corretor_id uuid, p_novo_gerente_id uuid,
                                                          p_levar_clientes boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.parceiros%rowtype;
  v_g public.parceiros%rowtype;
  v_cfg public.configuracao_geral%rowtype;
  v_carteira uuid[];
  v_n int := 0;
  v_restam int;
  v_faltando text[] := '{}';
begin
  if auth.uid() is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_levar_clientes is null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"levar_clientes"}';
  end if;
  select * into v_cfg from public.configuracao_geral c;
  select * into v_c from public.parceiros p where p.id = p_corretor_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_c.tipo <> 'corretor' or not v_c.migrado_legado or v_c.virtual or v_c.inativado_em is not null
     or v_c.imobiliaria_id <> v_cfg.imobiliaria_casa_id
     or exists (select 1 from public.parceiro_vinculos_historico h
                where h.parceiro_id = v_c.id and h.imobiliaria_id <> v_cfg.imobiliaria_casa_id) then
    raise exception 'Só um corretor migrado que ainda está na imobiliária da casa pode ser regularizado (uma vez).'
      using errcode = 'P0001';
  end if;
  if v_c.cpf is null then v_faltando := v_faltando || 'cpf'::text; end if;
  if v_c.creci is null then v_faltando := v_faltando || 'creci'::text; end if;
  if cardinality(v_faltando) > 0 then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001', detail = jsonb_build_object('campos', v_faltando)::text;
  end if;
  v_g := public._rede_travar_parceiro(p_novo_gerente_id);   -- [WP1R-01] conferido depois de travado
  if v_g.id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_g.tipo <> 'gerente' or v_g.inativado_em is not null or v_g.imobiliaria_id = v_cfg.imobiliaria_casa_id then
    raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"gerente"}';
  end if;

  if not p_levar_clientes then
    v_carteira := public._rede_carteira(v_c.id);
    v_n := public._rede_mover_clientes(v_carteira, v_cfg.corretor_casa_id, 'regularização de legado: a carteira fica na casa');
    select count(*) into v_restam from public.clientes c where c.corretor_id = v_c.id and c.inativado_em is null;
    if v_restam > 0 then
      raise exception 'DESCENDENTES_ATIVOS' using errcode = 'P0001',
        detail = jsonb_build_object('clientes', v_restam, 'motivo', 'assinatura_pendente')::text;
    end if;
  else
    select count(*) into v_n from public.clientes c where c.corretor_id = v_c.id and c.inativado_em is null;
  end if;

  perform set_config('arken.motivo_vinculo', 'regularização de legado', true);
  update public.parceiros p set gerente_id = v_g.id where p.id = v_c.id;
  perform public._auditar('operacao', 'regularizar', 'parceiros', v_c.id::text, null, array['gerente_id', 'imobiliaria_id'],
    jsonb_build_object('gerente_id', v_c.gerente_id, 'imobiliaria_id', v_c.imobiliaria_id),
    jsonb_build_object('gerente_id', v_g.id, 'imobiliaria_id', v_g.imobiliaria_id),
    jsonb_build_object('levar_clientes', p_levar_clientes, 'clientes', v_n));
end $$;

-- ============ INATIVAÇÃO E REATIVAÇÃO ============

-- Matriz inativar_subordinado + escopo (usuários de imobiliária: só internos). Nunca deixa cliente órfão:
--   corretor: a carteira ativa vai para p_destino_id = corretor ativo da mesma imobiliária e dentro do escopo de quem
--             chama (gerente: só a própria equipe; imobiliária: a imobiliária), ou o gerente dele (A1);
--   gerente:  corretores e clientes diretos (A1) vão para p_destino_id = gerente ativo da mesma imobiliária.
-- Sem nada a mover o destino é dispensado. Falha se sobrar descendente ativo (ex.: contrato em assinatura_pendente).
-- Efeito: vínculo inativado, código de indicação apagado, acesso 'inativo' (o hook recusa novos tokens).
create or replace function public.rede_inativar_parceiro(p_id uuid, p_destino_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_interno boolean;
  v_esc_imob uuid;
  v_esc_ger uuid;
  v_p public.parceiros%rowtype;
  v_dest public.parceiros%rowtype;
  v_status public.status_parceiro;
  v_motivo text;
  v_carteira uuid[];
  v_corretores uuid[] := '{}';
  v_cor uuid;
  v_n_cli int := 0;
  v_restam_cli int;
  v_restam_cor int;
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_interno := public.is_admin();
  v_esc_imob := public.escopo_imobiliaria();
  v_esc_ger := public.escopo_gerente();
  select * into v_p from public.parceiros p where p.id = p_id for update;
  if not found or not (
       (v_interno and not v_p.virtual)
    or (v_p.tipo = 'corretor' and public._rede_gere(v_p.id, 'inativar_subordinado'))
    or (v_p.tipo = 'gerente' and not v_p.virtual and public.tem_permissao('inativar_subordinado')
        and v_esc_imob is not null and v_p.imobiliaria_id = v_esc_imob)) then
    if found and v_p.virtual and v_interno then
      raise exception 'A cadeia da casa não pode ser inativada.' using errcode = 'P0001';
    end if;
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_p.inativado_em is not null then
    raise exception 'O parceiro já está inativo.' using errcode = 'P0001';
  end if;
  v_motivo := public._rede_motivo(p_motivo);

  v_carteira := public._rede_carteira(v_p.id);
  if v_p.tipo = 'gerente' then
    select coalesce(array_agg(t.id order by t.id), '{}') into v_corretores from (
      select c.id from public.parceiros c where c.gerente_id = v_p.id and c.inativado_em is null
      order by c.id for update) t;
  end if;

  if cardinality(v_carteira) + cardinality(v_corretores) > 0 or p_destino_id is not null then
    if p_destino_id is null then
      raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"destino_obrigatorio"}';
    end if;
    -- [WP1R-01] o destino é travado (FOR SHARE) depois do alvo, da carteira e dos corretores, e conferido travado
    v_dest := public._rede_travar_parceiro(p_destino_id);
    if v_dest.id is null or not public._rede_ve(v_dest.id) then
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
    if v_dest.id = v_p.id or v_dest.imobiliaria_id <> v_p.imobiliaria_id or not public._rede_destino_ativo(v_dest.id)
       or (v_p.tipo = 'corretor' and not (
             (v_dest.tipo = 'corretor' and (v_interno or v_esc_imob is not null or v_dest.gerente_id = v_esc_ger))
          or (v_dest.tipo = 'gerente' and v_dest.id = v_p.gerente_id)))
       or (v_p.tipo = 'gerente' and v_dest.tipo <> 'gerente')
       or (v_p.tipo = 'imobiliaria') then
      raise exception 'DESTINO_INVALIDO' using errcode = 'P0001';
    end if;

    if v_p.tipo = 'gerente' then
      foreach v_cor in array v_corretores loop
        perform set_config('arken.motivo_vinculo', v_motivo, true);
        update public.parceiros p set gerente_id = v_dest.id where p.id = v_cor;
        perform public._auditar('operacao', 'transferir', 'parceiros', v_cor::text, null, array['gerente_id'],
          jsonb_build_object('gerente_id', v_p.id), jsonb_build_object('gerente_id', v_dest.id),
          jsonb_build_object('inativacao_de', v_p.id));
      end loop;
    end if;
    if cardinality(v_carteira) > 0 then
      if v_dest.tipo = 'gerente' and not public._rede_a1_ligado() then
        raise exception 'DESTINO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"gerente_como_corretor"}';
      end if;
      v_n_cli := public._rede_mover_clientes(v_carteira, v_dest.id, v_motivo);
    end if;
  end if;

  select count(*) into v_restam_cli from public.clientes c where c.corretor_id = v_p.id and c.inativado_em is null;
  select count(*) into v_restam_cor from public.parceiros c where c.gerente_id = v_p.id and c.inativado_em is null;
  if v_restam_cli > 0 or v_restam_cor > 0 then
    raise exception 'DESCENDENTES_ATIVOS' using errcode = 'P0001',
      detail = jsonb_build_object('clientes', v_restam_cli, 'corretores', v_restam_cor)::text;
  end if;

  perform set_config('arken.motivo_vinculo', v_motivo, true);
  update public.parceiros p set inativado_em = now(), motivo_inativacao = v_motivo, codigo_indicacao = null
   where p.id = v_p.id;
  if v_p.profile_id is not null then
    select pr.status_parceiro into v_status from public.profiles pr where pr.id = v_p.profile_id for update;
    update public.profiles pr set status_parceiro = 'inativo' where pr.id = v_p.profile_id;
    perform public._rede_status(v_p.profile_id, v_p.id, v_status, 'inativo', v_motivo);
  end if;
  perform public._auditar('operacao', 'inativar', 'parceiros', v_p.id::text, null,
    array['inativado_em', 'inativado_por', 'motivo_inativacao', 'codigo_indicacao', 'status_parceiro'],
    jsonb_build_object('ativo', true, 'status_parceiro', v_status),
    jsonb_build_object('ativo', false, 'status_parceiro', case when v_p.profile_id is not null then 'inativo' end),
    jsonb_build_object('destino_id', v_dest.id, 'clientes_transferidos', v_n_cli,
                       'corretores_transferidos', cardinality(v_corretores)));
end $$;

-- Só internos. A imobiliária precisa estar ativa e, para corretor, o gerente também (gatilho parceiros_valida_cadeia).
-- O acesso volta a 'aprovado'; o corretor ganha um código de indicação novo.
create or replace function public.rede_reativar_parceiro(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.parceiros%rowtype;
  v_status public.status_parceiro;
  v_novo public.status_parceiro;
  v_faltando text[];
  v_imob_id uuid;
  v_ger_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  -- [WP1R-01] a imobiliária e o gerente (corretor) são travados (FOR SHARE) antes do parceiro e do UPDATE, na mesma
  -- ordem de rede_inativar_imobiliaria (imobiliária → parceiros): uma inativação deles em andamento termina antes, e
  -- o gatilho da cadeia (parceiros_valida_cadeia) confere a versão gravada; ao contrário, a inativação deles espera
  -- esta e passa a ver o parceiro reativado
  select p.imobiliaria_id, p.gerente_id into v_imob_id, v_ger_id from public.parceiros p where p.id = p_id;
  if v_imob_id is not null then
    perform public._rede_travar_imobiliaria(v_imob_id);
    if v_ger_id is not null then
      perform public._rede_travar_parceiro(v_ger_id);
    end if;
  end if;
  select * into v_p from public.parceiros p where p.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_p.inativado_em is null then
    raise exception 'O parceiro já está ativo.' using errcode = 'P0001';
  end if;
  if v_p.imobiliaria_id is distinct from v_imob_id or v_p.gerente_id is distinct from v_ger_id then
    raise exception 'O vínculo do parceiro mudou durante a reativação. Tente de novo.' using errcode = 'P0001';
  end if;
  -- [WP7RN-01] a reativação devolve o acesso 'aprovado'. Legado migrado que NUNCA foi aprovado e ainda não tem CPF e
  -- CRECI não pode ser aprovado por aqui (PAR-4/N8): o vínculo volta ativo (e a equipe consegue completar o cadastro,
  -- que não se edita com o parceiro inativo), mas o acesso volta BLOQUEADO; a aprovação é rede_desbloquear_parceiro,
  -- que exige os dois campos. Recusar a reativação travaria: o parceiro inativo não é editado.
  v_faltando := public._rede_faltam_cpf_creci_legado(v_p.id);
  if v_p.profile_id is not null then
    select pr.status_parceiro into v_status from public.profiles pr where pr.id = v_p.profile_id for update;
  end if;
  v_novo := case when v_status = 'inativo' then
              case when cardinality(v_faltando) > 0 then 'bloqueado'::public.status_parceiro else 'aprovado'::public.status_parceiro end
            else v_status end;
  perform set_config('arken.motivo_vinculo', 'reativação', true);
  update public.parceiros p set inativado_em = null, inativado_por = null, motivo_inativacao = null,
         codigo_indicacao = case when p.tipo = 'corretor' then public._gerar_codigo_indicacao() end
   where p.id = v_p.id;
  if v_p.profile_id is not null and v_status = 'inativo' then
    update public.profiles pr set status_parceiro = v_novo where pr.id = v_p.profile_id;
    perform public._rede_status(v_p.profile_id, v_p.id, 'inativo', v_novo,
      case when v_novo = 'bloqueado' then 'Reativação de legado sem CPF e CRECI: o acesso segue bloqueado até completar o cadastro e desbloquear (PAR-4).' end);
  end if;
  perform public._auditar('operacao', 'reativar', 'parceiros', v_p.id::text, null,
    array['inativado_em', 'inativado_por', 'motivo_inativacao', 'codigo_indicacao', 'status_parceiro'],
    jsonb_build_object('ativo', false, 'status_parceiro', v_status),
    jsonb_build_object('ativo', true, 'status_parceiro', v_novo));
end $$;

-- ============ LINK DE INDICAÇÃO ============

-- Corretor (ou gerente com A1), com vínculo ativo e aprovado: invalida o código anterior e devolve o novo.
create or replace function public.rede_gerar_codigo_indicacao() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := public.meu_parceiro_id();
  v_p public.parceiros%rowtype;
  v_codigo text;
begin
  if auth.uid() is null or v_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_p from public.parceiros p where p.id = v_id for update;
  if not (v_p.tipo = 'corretor' or (v_p.tipo = 'gerente' and public.tem_permissao('gerente_como_corretor'))) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_codigo := public._gerar_codigo_indicacao();
  update public.parceiros p set codigo_indicacao = v_codigo where p.id = v_p.id;
  perform public._auditar('operacao', 'gerar', 'parceiros', v_p.id::text, null, array['codigo_indicacao'], null, null,
                          jsonb_build_object('tinha_codigo', v_p.codigo_indicacao is not null));
  return v_codigo;
end $$;

-- Público (anon): código ativo de corretor (ou gerente com A1) com vínculo ativo, acesso aprovado (ou sem login) e
-- imobiliária ativa. A mesma resposta (nulo) para código inexistente, inativo, bloqueado ou fora do formato. O link
-- da casa (Carteira Arken) aparece como "Arken Incorporadora", sem imobiliária. Não grava (visitante anônimo).
create or replace function public.rede_link_publico(p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text := lower(btrim(coalesce(p_codigo, '')));
  v_r jsonb;
begin
  if v_codigo !~ '^[a-z2-7]{10}$' then
    return null;
  end if;
  select jsonb_build_object(
           'nome_corretor', case when p.virtual then 'Arken Incorporadora' else p.nome end,
           'nome_imobiliaria', case when i.da_casa then null else i.nome end)
    into v_r
  from public.parceiros p
  join public.imobiliarias i on i.id = p.imobiliaria_id
  left join public.profiles pr on pr.id = p.profile_id
  where p.codigo_indicacao = v_codigo and p.inativado_em is null and i.inativado_em is null
    and (p.tipo = 'corretor' or (p.tipo = 'gerente' and public._rede_a1_ligado()))
    and (p.profile_id is null or (pr.status_parceiro = 'aprovado' and pr.inativado_em is null))
    and (p.tipo <> 'corretor' or p.gerente_id is not null);
  return v_r;
end $$;
