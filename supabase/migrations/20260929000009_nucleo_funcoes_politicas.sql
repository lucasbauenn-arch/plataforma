-- Núcleo de acesso da expansão (docs/ARQUITETURA_EXPANSAO.md §4.1–§4.6, §5.2, §6, §8.1, §8.4).
-- 1. Helpers de escopo (escalares, security definer; nas políticas sempre dentro de (select …) → initPlan).
-- 2. meu_escopo() com corpo real (formato = interface Escopo de src/lib/types.ts).
-- 3. Funções internas reais (prefixo _, sem grant): _evento_cliente, _evento_dominio, _notificar,
--    _autorizar_download, _crm_solicitar_documentos_basicos, _imovel_campos_faltando, _transicao_validacoes_falhas e
--    _transicionar (lista fechada de validações e efeitos da §3.8, por CASE, sem SQL dinâmico).
-- 4. hook_token_acesso (Auth: custom access token hook).
-- 5. Políticas das tabelas e buckets novos; políticas atuais reescritas (neg, arq, obra, storage cli, prop) com a
--    mesma semântica do portal; view configuracao_publica.
-- 6. Esqueletos de TODAS as RPCs da §4.4 com a assinatura final e os grants finais. Cada pacote troca o corpo com
--    create or replace (sem mudar nome, parâmetros nem retorno), o que preserva dono e grants.
-- Convenções de erro (src/lib/erros.ts): 42501 'Sem acesso a este registro'; esqueleto 'nao_implementado' (0A000);
-- regra de negócio: raise '<CODIGO>' using errcode = 'P0001', detail = '<json>'.

-- ============ 1. HELPERS DE ESCOPO (§4.1) ============
-- Escopo só com vínculo ativo em parceiros, perfil de parceiro 'aprovado' e não inativado (conferido a cada chamada).
-- Nulo = não se aplica (comparação com nulo nunca é verdadeira).
create function public.escopo_corretor() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.parceiros p join public.profiles pr on pr.id = p.profile_id
  where p.profile_id = (select auth.uid()) and p.tipo = 'corretor' and p.inativado_em is null
    and pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
    and pr.status_parceiro = 'aprovado' and pr.inativado_em is null
$$;

create function public.escopo_gerente() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.parceiros p join public.profiles pr on pr.id = p.profile_id
  where p.profile_id = (select auth.uid()) and p.tipo = 'gerente' and p.inativado_em is null
    and pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
    and pr.status_parceiro = 'aprovado' and pr.inativado_em is null
$$;

create function public.escopo_imobiliaria() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.imobiliaria_id from public.parceiros p join public.profiles pr on pr.id = p.profile_id
  where p.profile_id = (select auth.uid()) and p.tipo = 'imobiliaria' and p.inativado_em is null
    and pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
    and pr.status_parceiro = 'aprovado' and pr.inativado_em is null
$$;

create function public.minha_imobiliaria_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.imobiliaria_id from public.parceiros p join public.profiles pr on pr.id = p.profile_id
  where p.profile_id = (select auth.uid()) and p.inativado_em is null
    and pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
    and pr.status_parceiro = 'aprovado' and pr.inativado_em is null
$$;

create function public.meu_parceiro_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.parceiros p join public.profiles pr on pr.id = p.profile_id
  where p.profile_id = (select auth.uid()) and p.inativado_em is null
    and pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
    and pr.status_parceiro = 'aprovado' and pr.inativado_em is null
$$;

-- false para "não existe" e para "fora do escopo": não revela a existência. NÃO inclui o titular (portal).
create function public.pode_ver_cliente(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = p_cliente_id and (
       public.is_admin()
    or (c.inativado_em is null and (c.corretor_id = public.escopo_corretor()
        or c.gerente_id = public.escopo_gerente() or c.imobiliaria_id = public.escopo_imobiliaria()))))
$$;

-- só o portal usa; nunca combinado com pode_ver_cliente
create function public.meu_cliente_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clientes c
  where c.user_id = (select auth.uid()) and c.portal_liberado and c.inativado_em is null and c.anonimizado_em is null
$$;

-- internos podem tudo o que a tabela liga; parceiros conforme permissoes_rede do tipo do vínculo ativo
create function public.tem_permissao(p_acao text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce((select r.permitido from public.permissoes_rede r
    join public.parceiros p on p.tipo = r.tipo join public.profiles pr on pr.id = p.profile_id
    where p.profile_id = (select auth.uid()) and p.inativado_em is null
      and pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
      and pr.status_parceiro = 'aprovado' and pr.inativado_em is null
      and r.acao = p_acao), false)
$$;

-- upload em crm-documentos: <cliente_id>/<documento_id>/<uuid>.<ext>, solicitação aberta (pendente ou rejeitada),
-- com escopo sobre o cliente ou pelo próprio titular no portal
create function public.pode_enviar_documento(p_objeto text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_objeto ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf|doc|docx|xls|xlsx|csv)$', false)
     and exists (select 1 from public.cliente_documentos d
       where d.cliente_id::text = split_part(p_objeto, '/', 1) and d.id::text = split_part(p_objeto, '/', 2)
         and d.status in ('pendente', 'rejeitado') and d.inativado_em is null
         and (public.pode_ver_cliente(d.cliente_id) or d.cliente_id = public.meu_cliente_id()))
$$;

-- autorização vigente de quem chama para um arquivo de crm-documentos ou contratos (criada por RPC que conferiu o
-- escopo e auditou). Não é usada em política de Storage: esses buckets não têm SELECT para authenticated e a URL é
-- assinada pela Edge baixar-arquivo (ver "storage (§4.3)" abaixo).
create function public.download_autorizado(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.download_autorizacoes a where a.profile_id = (select auth.uid())
    and a.bucket = p_bucket and a.path = p_path and a.expira_em > now())
$$;

-- regra E4 (§1.1): em RA/PE/RE veem o criador (aprovado), a cadeia acima dele e os internos; em AP/NC, todos os
-- parceiros aprovados e os internos
create function public.pode_ver_imovel(p_imovel_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.imoveis i where i.id = p_imovel_id and (
       public.is_admin()
    or (i.criado_por = (select auth.uid()) and public.is_parceiro_aprovado())
    or i.imobiliaria_id = public.escopo_imobiliaria()
    or i.gerente_id = public.escopo_gerente()
    or (i.status in ('aprovado', 'no_contrato') and i.inativado_em is null and public.is_parceiro_aprovado())))
$$;

-- editam: criador (aprovado) em RA/PE e internos
create function public.pode_editar_imovel(p_imovel_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.imoveis i where i.id = p_imovel_id and (
       public.is_admin()
    or (i.criado_por = (select auth.uid()) and i.status in ('rascunho', 'pendente') and i.inativado_em is null
        and public.is_parceiro_aprovado())))
$$;

-- ============ 2. meu_escopo() (§4.1; formato = interface Escopo de src/lib/types.ts) ============
-- Lê só profiles, parceiros, imobiliarias, permissoes_rede, configuracao_geral, lgpd_* e o JWT. Não grava auditoria.
-- As permissões seguem permissoesDeReferencia() de src/lib/menu.ts:
--   aprovado = papel de parceiro, status 'aprovado' e não inativado; vinculo = aprovado + linha ativa em parceiros;
--   acao(x) = interno ou (vinculo e permissoes_rede(x, tipo).permitido) — igual a tem_permissao(x).
create function public.meu_escopo() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_pr public.profiles%rowtype;
  v_parc public.parceiros%rowtype;
  v_imob public.imobiliarias%rowtype;
  v_cfg public.configuracao_geral%rowtype;
  v_interno boolean;
  v_super boolean;
  v_aal text;
  v_aprovado boolean;
  v_vinculo boolean := false;
  v_acoes text[] := '{}';
  v_termo uuid;
  v_perm text[];
  v_pend text[] := '{}';
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_pr from public.profiles pr where pr.id = v_uid;
  if not found then
    return null;
  end if;
  select * into v_cfg from public.configuracao_geral c;
  v_interno := public.is_admin();
  v_super := public.is_super();
  v_aal := case when coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then 'aal2' else 'aal1' end;
  v_aprovado := v_pr.papel in ('parceiro', 'corretor', 'gerente', 'imobiliaria')
                and v_pr.status_parceiro = 'aprovado' and v_pr.inativado_em is null;
  if v_aprovado then
    select * into v_parc from public.parceiros p where p.profile_id = v_uid and p.inativado_em is null;
    v_vinculo := found;
  end if;
  if v_vinculo then
    select * into v_imob from public.imobiliarias i where i.id = v_parc.imobiliaria_id;
    select coalesce(array_agg(r.acao order by r.acao), '{}') into v_acoes
    from public.permissoes_rede r where r.tipo = v_parc.tipo and r.permitido;
  end if;

  select coalesce(array_agg(t.p order by t.o), '{}') into v_perm
  from (values
    (1,  'painel.acessar',              v_interno or v_aprovado),
    (2,  'empreendimentos.ver',         v_interno or v_aprovado),
    (3,  'propostas.ver',               v_interno or v_aprovado),
    (4,  'propostas.criar',             v_aprovado),
    (5,  'imoveis.ver',                 v_interno or v_aprovado),
    (6,  'imoveis.cadastrar',           v_interno or (v_vinculo and 'cadastrar_imovel' = any (v_acoes))),
    (7,  'crm.ver',                     v_interno or v_vinculo),
    (8,  'crm.cadastrar',               v_interno or (v_vinculo and 'cadastrar_cliente' = any (v_acoes))),
    (9,  'crm.transferir',              v_interno or (v_vinculo and 'transferir_cliente' = any (v_acoes))),
    (10, 'crm.analisar_documento',      v_interno or (v_vinculo and 'analisar_documento' = any (v_acoes))),
    (11, 'crm.links',                   v_vinculo and (v_parc.tipo = 'corretor'
                                          or (v_parc.tipo = 'gerente' and 'gerente_como_corretor' = any (v_acoes)))),
    (12, 'contratos.ver',               v_interno or v_vinculo),
    (13, 'contratos.criar',             v_interno or (v_vinculo and 'criar_contrato' = any (v_acoes))),
    (14, 'rede.ver',                    v_interno or (v_vinculo and v_parc.tipo in ('imobiliaria', 'gerente'))),
    (15, 'rede.cadastrar_gerente',      v_interno or (v_vinculo and 'cadastrar_gerente' = any (v_acoes))),
    (16, 'rede.cadastrar_corretor',     v_interno or (v_vinculo and 'cadastrar_corretor' = any (v_acoes))),
    (17, 'rede.editar_subordinado',     v_interno or (v_vinculo and 'editar_subordinado' = any (v_acoes))),
    (18, 'rede.inativar_subordinado',   v_interno or (v_vinculo and 'inativar_subordinado' = any (v_acoes))),
    (19, 'rede.transferir_corretor',    v_interno or (v_vinculo and 'transferir_corretor' = any (v_acoes))),
    (20, 'rede.convite_por_link',       v_interno or (v_vinculo and 'convite_por_link' = any (v_acoes))),
    (21, 'meu_cadastro.editar',         v_aprovado),
    (22, 'admin.acessar',               v_interno),
    (23, 'relatorios.ver',              v_interno),
    (24, 'leads.ver',                   v_interno),
    (25, 'propostas.responder',         v_interno),
    (26, 'rede.aprovar',                v_interno),
    (27, 'crm.duplicidades',            v_interno),
    (28, 'crm.portal',                  v_interno),
    (29, 'contratos.enviar_assinatura', v_interno),
    (30, 'imoveis.revisar',             v_interno),
    (31, 'empreendimentos.gerenciar',   v_interno),
    (32, 'auditoria.ver',               v_interno),
    (33, 'migracao.ver',                v_interno),
    (34, 'config.ver',                  v_super)
  ) as t(o, p, ok)
  where t.ok;

  if v_vinculo and v_parc.tipo in ('gerente', 'corretor') and v_parc.cpf is null then
    v_pend := v_pend || 'cpf'::text;
  end if;
  if v_vinculo and v_parc.tipo = 'corretor' and v_parc.creci is null then
    v_pend := v_pend || 'creci'::text;
  end if;
  if v_aprovado then
    v_termo := public._termo_vigente_id('termos_parceiro');
    if v_termo is not null and not exists (select 1 from public.lgpd_consentimentos c
                                           where c.profile_id = v_uid and c.termo_id = v_termo and c.revogado_em is null) then
      v_pend := v_pend || 'termo'::text;
    end if;
  end if;

  return jsonb_build_object(
    'profile_id', v_uid,
    'papel', v_pr.papel,
    'status_parceiro', v_pr.status_parceiro,
    'inativado', v_pr.inativado_em is not null,
    'interno', v_interno,
    'super', v_super,
    'mfa_exigido', coalesce(v_cfg.exigir_mfa_interno, false) and v_pr.papel in ('admin', 'super'),
    'aal', v_aal,
    'parceiro_id', case when v_vinculo then v_parc.id end,
    'tipo', case when v_vinculo then v_parc.tipo end,
    'imobiliaria_id', case when v_vinculo then v_parc.imobiliaria_id end,
    'gerente_id', case when v_vinculo then
                    case v_parc.tipo when 'corretor' then v_parc.gerente_id when 'gerente' then v_parc.id end end,
    'parceiro', case when v_vinculo then jsonb_build_object(
                  'id', v_parc.id, 'tipo', v_parc.tipo, 'nome', v_parc.nome, 'codigo_indicacao', v_parc.codigo_indicacao,
                  'creci', v_parc.creci, 'virtual', v_parc.virtual, 'migrado_legado', v_parc.migrado_legado) end,
    'imobiliaria', case when v_vinculo then jsonb_build_object(
                     'id', v_imob.id, 'nome', v_imob.nome, 'da_casa', v_imob.da_casa) end,
    'permissoes', to_jsonb(v_perm),
    'pendencias', to_jsonb(v_pend),
    'sessao_inatividade_horas', v_cfg.sessao_inatividade_horas);
end $$;

-- ============ 3. FUNÇÕES INTERNAS (reais; sem grant: só as RPCs security definer chamam) ============
-- timeline (F3): título e dados SEM dado pessoal (ids, etapas, status, motivo). Ator = quem chamou (auth.uid()).
create function public._evento_cliente(p_cliente_id uuid, p_tipo text, p_titulo text, p_dados jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  insert into public.cliente_eventos (cliente_id, tipo, titulo, dados, ator_id)
  values (p_cliente_id, p_tipo, left(p_titulo, 200), coalesce(p_dados, '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- eventos de domínio (§3.11): consumidos depois pelo financeiro (eventos_consumo evita processar duas vezes)
create function public._evento_dominio(p_tipo text, p_entidade_id uuid, p_dados jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  insert into public.eventos_dominio (tipo, entidade_id, dados)
  values (p_tipo, p_entidade_id, coalesce(p_dados, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- fila de e-mails (§6.6). Só ids (nunca e-mails nem texto pessoal em dados). Destinatários = perfis; destinatários
-- vazios + cliente_id = e-mail para o próprio cliente. Respeita notificacoes_config.ativo (desligado: nada entra na
-- fila) e o consentimento revogado ou a anonimização do cliente (linha 'ignorado', sem disparo). Durante o corte
-- (arken.migracao = 'on') nada entra na fila. Devolve o id da fila ou nulo.
create function public._notificar(p_tipo text, p_destinatarios uuid[], p_cliente_id uuid, p_dados jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_ativo boolean;
  v_dest uuid[];
  v_ignorar boolean := false;
  v_id bigint;
begin
  if coalesce(current_setting('arken.migracao', true), '') = 'on' then
    return null;
  end if;
  select n.ativo into v_ativo from public.notificacoes_config n where n.tipo = p_tipo;
  if not found then
    raise exception 'Tipo de notificação desconhecido: %', p_tipo using errcode = '22023';
  end if;
  if not v_ativo then
    return null;
  end if;
  select coalesce(array_agg(distinct d), '{}') into v_dest from unnest(coalesce(p_destinatarios, '{}'::uuid[])) d
  where d is not null;
  if cardinality(v_dest) = 0 and p_cliente_id is null then
    return null;
  end if;
  if cardinality(v_dest) = 0 then
    v_ignorar := exists (select 1 from public.clientes c where c.id = p_cliente_id and c.anonimizado_em is not null)
      or (exists (select 1 from public.lgpd_consentimentos l where l.cliente_id = p_cliente_id and l.revogado_em is not null)
          and not exists (select 1 from public.lgpd_consentimentos l where l.cliente_id = p_cliente_id and l.revogado_em is null));
  end if;
  insert into public.notificacoes (tipo, destinatarios_ids, cliente_id, dados, status, ultimo_erro)
  values (p_tipo, v_dest, p_cliente_id, coalesce(p_dados, '{}'::jsonb),
          case when v_ignorar then 'ignorado'::public.status_notificacao else 'pendente'::public.status_notificacao end,
          case when v_ignorar then 'consentimento revogado ou titular anonimizado' end)
  returning id into v_id;
  return v_id;
end $$;

-- autorização de download de curta duração (§4.3) para quem chamou; a RPC confere o escopo e audita antes.
-- Devolve o formato DownloadAutorizado do front: {bucket, path, expira_em}.
create function public._autorizar_download(p_bucket text, p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_expira timestamptz;
begin
  if v_uid is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select now() + make_interval(secs => c.download_ttl_segundos) into v_expira from public.configuracao_geral c;
  insert into public.download_autorizacoes (profile_id, bucket, path, expira_em)
  values (v_uid, p_bucket, p_path, v_expira);
  return jsonb_build_object('bucket', p_bucket, 'path', p_path, 'expira_em', v_expira);
end $$;

-- CRM-3 / F2: cria as solicitações básicas que ainda não existem (idempotente pelo índice único parcial), grava a
-- timeline (uma linha por documento) e põe na fila crm.documento_solicitado. Devolve quantas criou.
create function public._crm_solicitar_documentos_basicos(p_cliente_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_nomes text[];
  v_nome text;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  select c.documentos_basicos into v_nomes from public.configuracao_geral c;
  foreach v_nome in array coalesce(v_nomes, '{}'::text[]) loop
    v_id := null;
    insert into public.cliente_documentos (cliente_id, tipo, nome, formatos_aceitos, basico)
    values (p_cliente_id, 'cliente', left(btrim(v_nome), 120), array['jpeg', 'png', 'pdf'], true)
    on conflict (cliente_id, nome) where basico and inativado_em is null do nothing
    returning id into v_id;
    if v_id is not null then
      v_ids := v_ids || v_id;
      perform public._evento_cliente(p_cliente_id, 'documento_solicitado', 'Documento solicitado: ' || left(btrim(v_nome), 120),
                                     jsonb_build_object('documento_id', v_id));
    end if;
  end loop;
  if cardinality(v_ids) > 0 then
    perform public._notificar('crm.documento_solicitado', '{}'::uuid[], p_cliente_id,
                              jsonb_build_object('documento_ids', to_jsonb(v_ids)));
  end if;
  return cardinality(v_ids);
end $$;

-- IMV-2: campos obrigatórios do imóvel na saída do rascunho, na ordem do formulário
create function public._imovel_campos_faltando(p_imovel_id uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(v.campo order by v.ordem), '{}')
  from public.imoveis i
  cross join lateral (values
    (1, 'nome',       nullif(btrim(i.nome), '') is null),
    (2, 'tipo',       i.tipo is null),
    (3, 'cep',        i.cep is null),
    (4, 'logradouro', nullif(btrim(i.logradouro), '') is null),
    (5, 'numero',     nullif(btrim(i.numero), '') is null),
    (6, 'cidade',     nullif(btrim(i.cidade), '') is null),
    (7, 'uf',         i.uf is null),
    (8, 'valor',      i.valor is null or i.valor <= 0)
  ) as v(ordem, campo, falta)
  where i.id = p_imovel_id and v.falta
$$;

-- Lista fechada de validações (§3.8), por CASE. Devolve os nomes das que FALHARAM (vazio = tudo certo).
-- Também serve de "ensaio" para as RPCs (ex.: contrato_preparar_envio e destinos da ficha) sem transicionar.
--   contrato_assinado          cliente com contrato 'assinado'
--   campos_obrigatorios_imovel IMV-2 (a lista de campos sai de _imovel_campos_faltando)
--   pdf_gerado                 minuta gerada e não desatualizada
--   modelo_liberado            versão do modelo do contrato liberada para envio
--   signatarios_configurados   há regra ativa do cliente (comprador) e do representante da Arken (vendedora) para a
--                              chave do modelo; toda regra ativa 'fixo' tem nome e e-mail; 'corretor_do_cliente' exige
--                              e-mail do corretor do contrato
--   vendedora_configurada      razão social, CNPJ e endereço da vendedora preenchidos (N7)
--   email_cliente              cliente com e-mail válido
--   valor_produto_atual        valor do contrato = valor atual do produto; unidade não vendida; imóvel aprovado e ativo
--   arquivo_enviado            documento com arquivo atual não removido, enviado depois da última análise
create function public._transicao_validacoes_falhas(p_entidade text, p_id uuid, p_validacoes text[])
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_falhas text[] := '{}';
  v_nome text;
  v_ok boolean;
  v_ctr public.contratos%rowtype;
begin
  if p_entidade = 'contrato' then
    select * into v_ctr from public.contratos k where k.id = p_id;
  end if;
  foreach v_nome in array coalesce(p_validacoes, '{}'::text[]) loop
    v_ok := case v_nome
      when 'contrato_assinado' then
        p_entidade = 'cliente_etapa'
        and exists (select 1 from public.contratos k where k.cliente_id = p_id and k.status = 'assinado')
      when 'campos_obrigatorios_imovel' then
        p_entidade = 'imovel' and cardinality(public._imovel_campos_faltando(p_id)) = 0
      when 'pdf_gerado' then
        p_entidade = 'contrato' and v_ctr.pdf_path is not null and v_ctr.pdf_versao > 0 and not v_ctr.pdf_desatualizado
      when 'modelo_liberado' then
        p_entidade = 'contrato'
        and exists (select 1 from public.contrato_modelos m where m.id = v_ctr.modelo_id and m.liberado_para_envio)
      when 'signatarios_configurados' then
        p_entidade = 'contrato'
        and exists (select 1 from public.contrato_signatario_regras r join public.contrato_modelos m on m.chave = r.modelo_chave
                    where m.id = v_ctr.modelo_id and r.ativo and r.papel = 'cliente')
        and exists (select 1 from public.contrato_signatario_regras r join public.contrato_modelos m on m.chave = r.modelo_chave
                    where m.id = v_ctr.modelo_id and r.ativo and r.papel = 'representante_arken')
        and not exists (select 1 from public.contrato_signatario_regras r join public.contrato_modelos m on m.chave = r.modelo_chave
                        where m.id = v_ctr.modelo_id and r.ativo
                          and ((r.fonte = 'fixo' and (r.email is null or r.nome is null))
                               or (r.fonte = 'corretor_do_cliente'
                                   and not exists (select 1 from public.parceiros p
                                                   where p.id = v_ctr.corretor_id and p.email is not null))))
      when 'vendedora_configurada' then
        exists (select 1 from public.configuracao_geral c where c.vendedora_razao_social is not null
                  and c.vendedora_cnpj is not null and c.vendedora_endereco is not null)
      when 'email_cliente' then
        p_entidade = 'contrato'
        and exists (select 1 from public.clientes c where c.id = v_ctr.cliente_id
                      and c.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
      when 'valor_produto_atual' then
        p_entidade = 'contrato'
        and (exists (select 1 from public.unidades u where u.id = v_ctr.unidade_id
                       and u.valor = v_ctr.valor_imovel and u.status <> 'vendida')
             or exists (select 1 from public.imoveis i where i.id = v_ctr.imovel_id and i.valor = v_ctr.valor_imovel
                          and i.status = 'aprovado' and i.inativado_em is null))
      when 'arquivo_enviado' then
        p_entidade = 'documento'
        and exists (select 1 from public.cliente_documentos d
                    join public.cliente_documento_arquivos a on a.id = d.arquivo_atual_id
                    where d.id = p_id and a.removido_em is null
                      and (d.analisado_em is null or a.enviado_em > d.analisado_em))
      else false
    end;
    if not coalesce(v_ok, false) then
      v_falhas := v_falhas || v_nome;
    end if;
  end loop;
  return v_falhas;
end $$;

-- _transicionar (§4.1, §3.8): única porta de mudança de status. Devolve o status anterior ("de").
--   p_entidade  cliente_etapa | documento | contrato | imovel
--   p_origem    usuario (confere papel ou criador) | sistema | webhook (exigem a coluna sistema)
-- Passos: 1. trava a linha (for update); 2. linha ativa em status_transicoes (senão TRANSICAO_INVALIDA);
-- 3. quem pode (senão 42501); motivo (MOTIVO_OBRIGATORIO; 'perdido' e 'rejeitado' sempre exigem, pelos checks);
-- 4. validações (CAMPOS_OBRIGATORIOS com detail {campos}, VALIDACAO_FALHOU com detail {validacoes});
-- 5. grava o status (e os campos que acompanham); 6. efeitos; 7. historico_status.
-- NÃO grava auditoria nem a timeline da transição principal: isso é da RPC que chamou. Os efeitos que mudam outra
-- entidade (cliente → finalizado ao assinar) gravam a própria timeline, porque nenhuma RPC os envolve.
-- O escopo sobre o registro é conferido pela RPC antes de chamar.
create function public._transicionar(p_entidade text, p_id uuid, p_para text, p_motivo text, p_origem text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_de text;
  v_t public.status_transicoes%rowtype;
  v_papel public.papel;
  v_ok boolean := false;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_campos text[];
  v_falhas text[];
  v_efeito text;
  v_imovel uuid;
  v_cliente uuid;
  v_etapa public.etapa_funil;
  v_dados jsonb;
begin
  if p_origem is null or p_origem not in ('usuario', 'sistema', 'webhook') then
    raise exception 'Origem de transição inválida' using errcode = '22023';
  end if;
  if p_id is null or p_para is null then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;

  -- 1. trava e lê o status atual
  case p_entidade
    when 'cliente_etapa' then
      select c.etapa::text into v_de from public.clientes c where c.id = p_id for update;
    when 'documento' then
      select d.status::text into v_de from public.cliente_documentos d where d.id = p_id for update;
    when 'contrato' then
      select k.status::text into v_de from public.contratos k where k.id = p_id for update;
    when 'imovel' then
      select i.status::text into v_de from public.imoveis i where i.id = p_id for update;
    else
      raise exception 'Entidade de transição inválida' using errcode = '22023';
  end case;
  if v_de is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;

  -- 2. linha ativa
  select * into v_t from public.status_transicoes t
  where t.entidade = p_entidade and t.de = v_de and t.para = p_para and t.ativa;
  if not found then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001',
      detail = jsonb_build_object('entidade', p_entidade, 'de', v_de, 'para', p_para)::text;
  end if;

  -- 3. quem pode
  if p_origem = 'usuario' then
    if v_uid is not null then
      select pr.papel into v_papel from public.profiles pr where pr.id = v_uid and pr.inativado_em is null;
    end if;
    if v_papel in ('admin', 'super') then
      v_ok := v_papel = any (v_t.papeis) and public.is_admin();
    elsif v_papel in ('corretor', 'gerente', 'imobiliaria', 'parceiro') then
      v_ok := v_papel = any (v_t.papeis) and public.is_parceiro_aprovado()
              and (p_entidade <> 'documento' or p_para not in ('aprovado', 'rejeitado')
                   or public.tem_permissao('analisar_documento'));                      -- F4
    elsif v_papel = 'cliente' then
      v_ok := 'cliente' = any (v_t.papeis) and public.meu_cliente_id() is not null;
    end if;
    if not coalesce(v_ok, false) and v_t.permite_criador and p_entidade = 'imovel' then
      v_ok := exists (select 1 from public.imoveis i where i.id = p_id and i.criado_por = v_uid and i.inativado_em is null)
              and public.is_parceiro_aprovado();
    end if;
  else
    v_ok := v_t.sistema;
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'Sem permissão para esta mudança de status' using errcode = '42501';
  end if;

  if (v_t.exige_motivo or (p_entidade = 'cliente_etapa' and p_para = 'perdido')
      or (p_entidade = 'documento' and p_para = 'rejeitado'))
     and (v_motivo is null or length(v_motivo) < 3) then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001';
  end if;
  v_motivo := left(v_motivo, 2000);

  -- 4. validações
  if 'campos_obrigatorios_imovel' = any (v_t.validacoes) then
    v_campos := public._imovel_campos_faltando(p_id);
    if cardinality(v_campos) > 0 then
      raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001',
        detail = jsonb_build_object('campos', to_jsonb(v_campos))::text;
    end if;
  end if;
  v_falhas := public._transicao_validacoes_falhas(p_entidade, p_id, array_remove(v_t.validacoes, 'campos_obrigatorios_imovel'));
  if cardinality(v_falhas) > 0 then
    raise exception 'VALIDACAO_FALHOU' using errcode = 'P0001',
      detail = jsonb_build_object('validacoes', to_jsonb(v_falhas))::text;
  end if;

  -- 5. grava o novo status
  case p_entidade
    when 'cliente_etapa' then
      update public.clientes c
         set etapa = p_para::public.etapa_funil, etapa_desde = now(),
             motivo_perda = case when p_para = 'perdido' then v_motivo else c.motivo_perda end
       where c.id = p_id;
    when 'documento' then
      update public.cliente_documentos d
         set status = p_para::public.status_documento,
             analisado_em = case when p_para in ('aprovado', 'rejeitado') then now() else d.analisado_em end,
             analisado_por = case when p_para in ('aprovado', 'rejeitado') then v_uid else d.analisado_por end,
             motivo_rejeicao = case when p_para = 'rejeitado' then v_motivo
                                    when p_para = 'aprovado' then null else d.motivo_rejeicao end
       where d.id = p_id;
    when 'contrato' then
      update public.contratos k
         set status = p_para::public.status_contrato,
             enviado_assinatura_em = case when p_para = 'assinatura_pendente' then now() else k.enviado_assinatura_em end,
             envio_lock_em = case when v_de = 'em_analise' then null else k.envio_lock_em end,
             assinado_em = case when p_para = 'assinado' then now() else k.assinado_em end,
             encerrado_em = case when p_para in ('recusado', 'expirado', 'cancelado', 'arquivado')
                                 then coalesce(k.encerrado_em, now()) else k.encerrado_em end,
             observacao = case when v_de = 'em_analise' and p_para in ('rascunho', 'documentacao_pendente')
                               then v_motivo else k.observacao end
       where k.id = p_id;
    when 'imovel' then
      update public.imoveis i
         set status = p_para::public.status_imovel,
             observacao_revisao = case when v_de = 'em_revisao' and p_para = 'rascunho' then v_motivo
                                       else i.observacao_revisao end
       where i.id = p_id;
  end case;

  -- 6. efeitos (lista fechada)
  foreach v_efeito in array v_t.efeitos loop
    case v_efeito
      when 'solicitar_documentos_basicos' then
        perform public._crm_solicitar_documentos_basicos(p_id);
      when 'limpar_motivo_perda' then
        update public.clientes c set motivo_perda = null where c.id = p_id;
      when 'notificar_documento_rejeitado' then
        select d.cliente_id into v_cliente from public.cliente_documentos d where d.id = p_id;
        perform public._notificar('crm.documento_rejeitado', '{}'::uuid[], v_cliente, jsonb_build_object('documento_id', p_id));
      when 'imovel_no_contrato' then
        -- estrito: o produto fica comprometido no envio; se o imóvel não estiver aprovado, o envio falha
        select k.imovel_id into v_imovel from public.contratos k where k.id = p_id;
        if v_imovel is not null then
          perform public._transicionar('imovel', v_imovel, 'no_contrato', null, 'sistema');
        end if;
      when 'imovel_aprovado' then
        select k.imovel_id into v_imovel from public.contratos k where k.id = p_id;
        if v_imovel is not null and exists (select 1 from public.imoveis i where i.id = v_imovel and i.status = 'no_contrato') then
          perform public._transicionar('imovel', v_imovel, 'aprovado', null, 'sistema');
        end if;
      when 'cliente_finalizado' then
        -- tolerante: o fato (contrato assinado) já está gravado; a etapa só não muda se o Super desligou a transição
        select k.cliente_id into v_cliente from public.contratos k where k.id = p_id;
        select c.etapa into v_etapa from public.clientes c where c.id = v_cliente;
        if v_etapa is distinct from 'finalizado' then
          if exists (select 1 from public.status_transicoes t where t.entidade = 'cliente_etapa' and t.de = v_etapa::text
                       and t.para = 'finalizado' and t.ativa and t.sistema) then
            perform public._transicionar('cliente_etapa', v_cliente, 'finalizado', null, 'sistema');
            perform public._evento_cliente(v_cliente, 'etapa', 'Etapa: Finalizado',
                                           jsonb_build_object('de', v_etapa, 'para', 'finalizado', 'motivo', null,
                                                              'contrato_id', p_id));
          else
            raise warning '_transicionar: cliente % não foi para finalizado (transição desligada)', v_cliente;
          end if;
        end if;
      when 'evento_contrato_assinado' then
        select jsonb_build_object('contrato_id', k.id, 'cliente_id', k.cliente_id, 'forma_pagamento', k.forma_pagamento,
                                  'imobiliaria_id', k.imobiliaria_id, 'gerente_id', k.gerente_id, 'corretor_id', k.corretor_id)
          into v_dados from public.contratos k where k.id = p_id;
        perform public._evento_dominio('contrato.assinado', p_id, v_dados);
      else
        raise exception 'Efeito de transição desconhecido: %', v_efeito using errcode = '22023';
    end case;
  end loop;

  -- 7. histórico (somente inclusão, sem dado pessoal)
  insert into public.historico_status (entidade, entidade_id, de, para, motivo, origem, ator_id)
  values (p_entidade, p_id, v_de, p_para, v_motivo, p_origem, v_uid);
  return v_de;
end $$;

-- ============ 4. HOOK DE TOKEN (§4.1, §5.2; config.toml [auth.hook.custom_access_token]) ============
-- Recusa emitir token (inclusive no refresh) para perfil 'inativo' ou inativado: o acesso cai em até 1 h.
-- 'bloqueado' continua entrando para ver a tela informativa, sem escopo. Registra o login de parceiros e internos
-- (menos token_refresh; o portal continua em portal_acessos). Não põe escopo em claims. Falha no registro nunca
-- impede o login.
create function public.hook_token_acesso(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_metodo text := event ->> 'authentication_method';
  v_papel public.papel;
  v_status public.status_parceiro;
  v_inativado timestamptz;
  v_parceiro uuid;
begin
  if coalesce(event ->> 'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return event;
  end if;
  v_uid := (event ->> 'user_id')::uuid;
  select pr.papel, pr.status_parceiro, pr.inativado_em into v_papel, v_status, v_inativado
  from public.profiles pr where pr.id = v_uid;
  if not found then
    return event;
  end if;
  if v_status = 'inativo' or v_inativado is not null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'ACESSO_INATIVO'));
  end if;
  if v_metodo is distinct from 'token_refresh' and v_papel <> 'cliente' then
    begin
      select p.id into v_parceiro from public.parceiros p where p.profile_id = v_uid;
      insert into public.auditoria (categoria, acao, entidade, entidade_id, ator_id, ator_papel, ator_parceiro_id,
                                    origem, detalhe)
      values ('acesso', 'login', 'profiles', v_uid::text, v_uid, v_papel, v_parceiro, 'hook',
              jsonb_build_object('metodo', left(coalesce(v_metodo, 'desconhecido'), 40)));
    exception when others then
      raise warning 'hook_token_acesso: login não registrado (%)', sqlstate;
    end;
  end if;
  return event;
end $$;

grant usage on schema public to supabase_auth_admin;
revoke execute on function public.hook_token_acesso(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hook_token_acesso(jsonb) to supabase_auth_admin;

-- ============ 5. POLÍTICAS (§4.2, §4.3) ============
-- ---- rede ----
create policy "imobiliarias: escopo lê" on public.imobiliarias for select to authenticated
  using ((select public.is_admin()) or id = (select public.minha_imobiliaria_id()));

-- sem a coluna cpf (grant por coluna na 04): o CPF de parceiro só sai por rede_parceiro_detalhe (auditada)
-- O próprio vínculo só enquanto ativo e com o perfil aprovado (meu_parceiro_id): bloqueado, inativo e pendente
-- veem zero (§8.5), como nos demais helpers de escopo.
create policy "parceiros: escopo lê" on public.parceiros for select to authenticated using (
  (select public.is_admin()) or id = (select public.meu_parceiro_id())
  or imobiliaria_id = (select public.escopo_imobiliaria())
  or (tipo = 'corretor' and gerente_id = (select public.escopo_gerente())));

-- ---- imóveis (E4) ----
create policy "imoveis: leitura" on public.imoveis for select to authenticated using (
  (select public.is_admin())
  or (criado_por = (select auth.uid()) and (select public.is_parceiro_aprovado()))
  or imobiliaria_id = (select public.escopo_imobiliaria())
  or gerente_id = (select public.escopo_gerente())
  or (status in ('aprovado', 'no_contrato') and inativado_em is null and (select public.is_parceiro_aprovado())));
create policy "imoveis: cadastrar" on public.imoveis for insert to authenticated
  with check (criado_por = (select auth.uid()) and status = 'rascunho' and (select public.tem_permissao('cadastrar_imovel')));
create policy "imoveis: editar" on public.imoveis for update to authenticated
  using ((select public.is_admin())
         or (criado_por = (select auth.uid()) and status in ('rascunho', 'pendente') and inativado_em is null
             and (select public.is_parceiro_aprovado())))
  with check ((select public.is_admin())
              or (criado_por = (select auth.uid()) and status in ('rascunho', 'pendente') and inativado_em is null));

-- fotos seguem o imóvel (a subconsulta passa pela RLS de imoveis); escrita por RPC
create policy "imovel_fotos: segue o imóvel" on public.imovel_fotos for select to authenticated
  using (exists (select 1 from public.imoveis i where i.id = imovel_fotos.imovel_id));

create policy "imovel_tipos: leitura" on public.imovel_tipos for select to authenticated
  using ((select public.is_parceiro_aprovado()));
create policy "imovel_tipos: super inclui" on public.imovel_tipos for insert to authenticated
  with check ((select public.is_super()));
create policy "imovel_tipos: super edita" on public.imovel_tipos for update to authenticated
  using ((select public.is_super())) with check ((select public.is_super()));

-- ---- configuração e governança ----
-- configuracao_geral: internos; parceiros leem a view configuracao_publica; o Super altera por config_atualizar
create policy "configuracao_geral: internos leem" on public.configuracao_geral for select to authenticated
  using ((select public.is_admin()));
create policy "historico_status: internos leem" on public.historico_status for select to authenticated
  using ((select public.is_admin()));
create policy "migracao_pendencias: internos leem" on public.migracao_pendencias for select to authenticated
  using ((select public.is_admin()));

create policy "notificacoes_config: leitura" on public.notificacoes_config for select to authenticated
  using ((select public.is_parceiro_aprovado()));
create policy "notificacoes_config: super edita" on public.notificacoes_config for update to authenticated
  using ((select public.is_super())) with check ((select public.is_super()));

create policy "permissoes_rede: leitura" on public.permissoes_rede for select to authenticated
  using ((select public.is_parceiro_aprovado()));
create policy "permissoes_rede: super edita" on public.permissoes_rede for update to authenticated
  using ((select public.is_super())) with check ((select public.is_super()));

-- versões novas de termos só por lgpd_publicar_termo (RPC); o aceite por lgpd_aceitar_termo
create policy "lgpd_termos: leitura" on public.lgpd_termos for select to authenticated
  using ((select public.is_parceiro_aprovado()));

create policy "status_transicoes: leitura" on public.status_transicoes for select to authenticated
  using ((select public.is_parceiro_aprovado()));
create policy "status_transicoes: super edita" on public.status_transicoes for update to authenticated
  using ((select public.is_super())) with check ((select public.is_super()));

-- ---- contratos (configuração): parceiros aprovados veem só a versão vigente; internos veem todas ----
create policy "parametros_simulacao: leitura" on public.parametros_simulacao for select to authenticated
  using ((select public.is_admin())
         or ((select public.is_parceiro_aprovado()) and id = (select public.parametros_vigente_id())));
create policy "contrato_modelos: leitura" on public.contrato_modelos for select to authenticated
  using ((select public.is_admin())
         or ((select public.is_parceiro_aprovado()) and id = public.modelo_vigente_id(chave)));
-- nome e e-mail do representante e das testemunhas: só internos leem; o Super edita
create policy "contrato_signatario_regras: internos leem" on public.contrato_signatario_regras for select to authenticated
  using ((select public.is_admin()));
create policy "contrato_signatario_regras: super edita" on public.contrato_signatario_regras for update to authenticated
  using ((select public.is_super())) with check ((select public.is_super()));

-- ---- storage (§4.3) ----
-- crm-documentos e contratos: NENHUMA política de leitura para authenticated. O Storage só avalia a RLS ao ASSINAR a
-- URL (POST /object/sign), com o `expiresIn` escolhido pelo cliente e sem teto; o GET com ?token= não passa pela RLS
-- nem pela auditoria. Com uma política de SELECT, quem recebesse uma autorização de 60 s assinaria uma URL válida por
-- anos, que continuaria valendo depois de inativado ou de o cliente ser transferido. Por isso o download é:
--   1. RPC com o JWT do usuário (crm_documento_baixar, contrato_baixar, portal_contrato_baixar): confere o escopo,
--      audita e grava download_autorizacoes (validade = download_ttl_segundos) por _autorizar_download;
--   2. Edge Function baixar-arquivo: valida o JWT no Auth, resgata a autorização vigente DESSE usuário para o mesmo
--      bucket e caminho e assina a URL com a service role, com validade até o fim da autorização (nunca mais que ela).
-- upload em crm-documentos (sem UPDATE nem DELETE para authenticated); contratos: só a service role grava
create policy "storage crm: envio de documento" on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-documentos' and public.pode_enviar_documento(name));

-- imoveis: <imovel_id>/<nome>.<ext>; o CASE evita converter para uuid um caminho fora do formato
create policy "storage imoveis: leitura" on storage.objects for select to authenticated
  using (bucket_id = 'imoveis' and public.pode_ver_imovel(
    case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
         then split_part(name, '/', 1)::uuid end));
create policy "storage imoveis: envio" on storage.objects for insert to authenticated
  with check (bucket_id = 'imoveis' and public.pode_editar_imovel(
    case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-z-]{1,80}\.(webp|jpg|jpeg|png)$'
         then split_part(name, '/', 1)::uuid end));
create policy "storage imoveis: remoção" on storage.objects for delete to authenticated
  using (bucket_id = 'imoveis' and public.pode_editar_imovel(
    case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
         then split_part(name, '/', 1)::uuid end));

-- ---- políticas atuais reescritas: não dependem mais de SELECT em clientes (que o corte revoga) ----
-- Mesma semântica do portal: o titular vê o que é seu (meu_cliente_id exige portal_liberado, não inativado e não
-- anonimizado; os clientes atuais do portal estão com portal_liberado = true). Só authenticated: anon não tem grant
-- nessas tabelas e não executa meu_cliente_id.
drop policy "neg: próprio" on public.cliente_negocios;
create policy "neg: próprio" on public.cliente_negocios for select to authenticated
  using ((select public.is_admin()) or cliente_id = (select public.meu_cliente_id()));

drop policy "arq: próprio" on public.cliente_arquivos;
create policy "arq: próprio" on public.cliente_arquivos for select to authenticated
  using ((select public.is_admin()) or cliente_id = (select public.meu_cliente_id()));

drop policy "obra: leitura" on public.obra_atualizacoes;
create policy "obra: leitura" on public.obra_atualizacoes for select to authenticated using (
  (select public.is_parceiro_aprovado()) or exists (
    select 1 from public.cliente_negocios n
    where n.empreendimento_id = obra_atualizacoes.empreendimento_id and n.cliente_id = (select public.meu_cliente_id())));

drop policy "storage cli: dono lê" on storage.objects;
create policy "storage cli: dono lê" on storage.objects for select to authenticated using (
  bucket_id = 'cliente-arquivos' and (
    (select public.is_admin()) or (storage.foldername(name))[1] = (select public.meu_cliente_id())::text));

-- propostas (vale até o corte, que revoga o grant de select): leitura por cadeia (parceiro aprovado) ou pela autoria
-- quando não há cliente; o parceiro só cria proposta 'enviada' sem cliente (com cliente, só por propostas_criar)
drop policy "prop: dono lê" on public.propostas;
create policy "prop: escopo lê" on public.propostas for select to authenticated using (
  (select public.is_admin()) or ((select public.is_parceiro_aprovado()) and (
     corretor_id = (select public.escopo_corretor()) or gerente_id = (select public.escopo_gerente())
     or imobiliaria_id = (select public.escopo_imobiliaria())
     or (cliente_id is null and parceiro_id = (select auth.uid())))));
drop policy "prop: parceiro cria" on public.propostas;
create policy "prop: parceiro cria" on public.propostas for insert to authenticated
  with check (parceiro_id = (select auth.uid()) and (select public.is_parceiro_aprovado()) and status = 'enviada'
              and cliente_id is null);

-- ============ VIEW configuracao_publica (§4.2) ============
-- Parceiros aprovados (e internos) leem a configuração sem retenção nem MFA. A view roda com o dono (postgres),
-- então não depende da política de configuracao_geral; o filtro de papel está no WHERE.
create view public.configuracao_publica with (security_barrier = true) as
  select c.id, c.imobiliaria_casa_id, c.gerente_casa_id, c.corretor_casa_id,
         c.exclusividade_dias, c.duplicidade_bloqueios_hora, c.documentos_basicos, c.documento_max_bytes,
         c.portal_libera_pre_cadastro, c.vendedora_razao_social, c.vendedora_cnpj, c.vendedora_endereco,
         c.prazo_assinatura_dias, c.imovel_fotos_max, c.imovel_foto_max_bytes, c.sessao_inatividade_horas,
         c.download_ttl_segundos
  from public.configuracao_geral c
  where (select public.is_parceiro_aprovado());
revoke all on public.configuracao_publica from anon, authenticated, service_role;
grant select on public.configuracao_publica to authenticated, service_role;

-- ============ 6. ESQUELETOS DAS RPCs (§4.4) ============
-- Assinatura final (nome, nomes e tipos dos parâmetros, retorno) = contrato com o front (src/lib/rpc.ts e
-- src/modulos/*/tipos.ts). Escrita sem retorno = void; leitura = jsonb (nulo fora do escopo). Todas volatile
-- (gravam auditoria) e security definer com search_path vazio. Corpo provisório: 'nao_implementado' (0A000).

-- ---- Rede [WP1] ----
create function public.rede_cadastrar_imobiliaria(p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_editar_imobiliaria(p_id uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_cadastrar_parceiro(p_tipo public.tipo_parceiro, p_dados jsonb, p_imobiliaria_id uuid, p_gerente_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_editar_parceiro(p_id uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_atualizar_meu_cadastro(p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_parceiro_detalhe(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_aprovar_autocadastro(p_profile_id uuid, p_gerente_id uuid, p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_recusar_autocadastro(p_profile_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_bloquear_parceiro(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_desbloquear_parceiro(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_pode_convidar(p_parceiro_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_vincular_login(p_parceiro_id uuid, p_profile_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_registrar_convite(p_parceiro_id uuid, p_modo text, p_ator uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_transferir_clientes(p_cliente_ids uuid[], p_novo_corretor_id uuid, p_motivo text) returns int
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_transferir_corretor(p_corretor_id uuid, p_novo_gerente_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_mudar_imobiliaria_corretor(p_corretor_id uuid, p_novo_gerente_id uuid, p_destino_carteira_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_regularizar_legado(p_corretor_id uuid, p_novo_gerente_id uuid, p_levar_clientes boolean) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_inativar_parceiro(p_id uuid, p_destino_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_reativar_parceiro(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_inativar_imobiliaria(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_gerar_codigo_indicacao() returns text
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.rede_link_publico(p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;

-- ---- CRM: cadastro, ficha, leads, propostas [WP2] ----
create function public.crm_cadastrar_cliente(p_dados jsonb, p_corretor_id uuid, p_termo_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_editar_cliente(p_id uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_listar(p_filtros jsonb, p_limite int, p_offset int) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_clientes_opcoes(p_busca text) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_ficha(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_inativar_cliente(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_liberar_portal(p_id uuid, p_liberar boolean) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_duplicidades_listar(p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_duplicidade_resolver(p_id uuid, p_decisao text, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.leads_listar(p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.leads_converter(p_lead_id uuid, p_corretor_id uuid, p_dados jsonb, p_termo_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.leads_descartar(p_lead_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.leads_excluir(p_lead_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.leads_exportar(p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.propostas_listar(p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.propostas_criar(p_empreendimento_id uuid, p_cliente_id uuid, p_unidade_id uuid, p_texto text) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.propostas_responder(p_id uuid, p_status public.status_proposta, p_resposta text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_pre_cadastro(p_codigo text, p_dados jsonb, p_termo_id uuid, p_ip inet, p_user_agent text) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;

-- ---- CRM: funil e atividades [WP3] ----
create function public.crm_kanban(p_filtros jsonb, p_limite_coluna int) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_kanban_coluna(p_etapa public.etapa_funil, p_filtros jsonb, p_offset int) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_mudar_etapa(p_id uuid, p_para public.etapa_funil, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_timeline(p_id uuid, p_antes timestamptz, p_limite int) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_notas(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_tarefas(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_documentos(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_nota_criar(p_cliente_id uuid, p_texto text) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_tarefa_criar(p_cliente_id uuid, p_titulo text, p_descricao text, p_responsavel_id uuid, p_prazo date) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_tarefa_editar(p_id uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_tarefa_concluir(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_responsaveis(p_cliente_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_minhas_tarefas(p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_documento_solicitar(p_cliente_id uuid, p_nome text, p_formatos text[], p_contrato_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_documento_cancelar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_documento_registrar_envio(p_documento_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_documento_analisar(p_id uuid, p_aprovar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.crm_documento_baixar(p_arquivo_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;

-- ---- Contratos [WP4] ----
create function public.contrato_simular(p_forma public.forma_pagamento, p_produto jsonb, p_perc_aporte numeric, p_entrada numeric, p_n_parcelas int) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_criar(p_cliente_id uuid, p_forma public.forma_pagamento, p_produto jsonb, p_perc_aporte numeric, p_entrada numeric, p_n_parcelas int) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_atualizar_simulacao(p_id uuid, p_forma public.forma_pagamento, p_perc_aporte numeric, p_entrada numeric, p_n_parcelas int) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_mudar_status(p_id uuid, p_para public.status_contrato, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_dados_modelo(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_registrar_documento(p_id uuid, p_versao int, p_path text, p_sha256 text, p_texto_sha256 text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_preparar_envio(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_registrar_d4sign_uuid(p_id uuid, p_uuid text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_registrar_envio(p_id uuid, p_signatarios jsonb, p_webhook_token_hash text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_falha_envio(p_id uuid, p_erro text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_registrar_retorno(p_d4sign_uuid text, p_status text, p_signatarios jsonb, p_pdf_assinado_path text, p_sha256 text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contratos_listar(p_filtros jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_detalhe(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.contrato_baixar(p_id uuid, p_tipo text, p_versao int) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.config_publicar_parametros(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.config_publicar_modelo(p_chave public.modelo_chave, p_titulo text, p_conteudo text) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.config_liberar_modelo(p_id uuid, p_revisado_juridico boolean) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;

-- ---- Imóveis [WP5] ----
create function public.imovel_mudar_status(p_id uuid, p_para public.status_imovel, p_obs text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.imovel_foto_registrar(p_imovel_id uuid, p_path text, p_miniatura_path text) returns uuid
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.imovel_foto_remover(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.imovel_fotos_ordenar(p_imovel_id uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.imovel_inativar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;

-- ---- Governança, LGPD, portal, painel [WP6/WP7] ----
create function public.auditoria_consultar(p_filtros jsonb, p_limite int, p_offset int) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.config_atualizar(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.equipe_definir_papel(p_profile_id uuid, p_papel public.papel) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.lgpd_termo_vigente(p_tipo text) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.lgpd_publicar_termo(p_tipo text, p_versao text, p_texto text, p_revisado_juridico boolean) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.lgpd_aceitar_termo(p_termo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.lgpd_revogar_consentimento(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.lgpd_anonimizar_cliente(p_cliente_id uuid, p_protocolo text) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.portal_meus_dados() returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.portal_meu_corretor() returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.portal_documentos() returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.portal_contratos() returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.portal_contrato_baixar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.portal_localizar_cliente(p_cpf text) returns table (id uuid, nome text, user_id uuid)
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.painel_resumo() returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.migracao_pendencias_resolver(p_id bigint, p_decisao text) returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.notificacoes_reenviar() returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.auditoria_purgar() returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;
create function public.limpar_temporarios() returns void
language plpgsql security definer set search_path = '' as $$ begin raise exception 'nao_implementado' using errcode = '0A000'; end $$;

-- ============ GRANTS (§4.1, §4.3) ============
-- helpers usados em políticas de tabela e de Storage
revoke execute on function public.escopo_corretor(), public.escopo_gerente(), public.escopo_imobiliaria(),
  public.minha_imobiliaria_id(), public.meu_parceiro_id(), public.pode_ver_cliente(uuid), public.meu_cliente_id(),
  public.tem_permissao(text), public.pode_enviar_documento(text), public.download_autorizado(text, text),
  public.pode_ver_imovel(uuid), public.pode_editar_imovel(uuid)
  from public, anon;
grant execute on function public.escopo_corretor(), public.escopo_gerente(), public.escopo_imobiliaria(),
  public.minha_imobiliaria_id(), public.meu_parceiro_id(), public.pode_ver_cliente(uuid), public.meu_cliente_id(),
  public.tem_permissao(text), public.pode_enviar_documento(text), public.download_autorizado(text, text),
  public.pode_ver_imovel(uuid), public.pode_editar_imovel(uuid)
  to authenticated, service_role;

-- funções internas: ninguém executa pela API
revoke execute on function public._evento_cliente(uuid, text, text, jsonb), public._evento_dominio(text, uuid, jsonb),
  public._notificar(text, uuid[], uuid, jsonb), public._autorizar_download(text, text),
  public._crm_solicitar_documentos_basicos(uuid), public._imovel_campos_faltando(uuid),
  public._transicao_validacoes_falhas(text, uuid, text[]), public._transicionar(text, uuid, text, text, text)
  from public, anon, authenticated, service_role;

-- RPCs (§4.3): de usuário → authenticated; públicas → anon também; de sistema → só service_role;
-- tarefas do pg_cron → ninguém (rodam como postgres). Confere que cada nome existe exatamente uma vez.
do $$
declare
  v_usuario constant text[] := array[
    'meu_escopo',
    'rede_cadastrar_imobiliaria', 'rede_editar_imobiliaria', 'rede_cadastrar_parceiro', 'rede_editar_parceiro',
    'rede_atualizar_meu_cadastro', 'rede_parceiro_detalhe', 'rede_aprovar_autocadastro', 'rede_recusar_autocadastro',
    'rede_bloquear_parceiro', 'rede_desbloquear_parceiro', 'rede_pode_convidar', 'rede_transferir_clientes',
    'rede_transferir_corretor', 'rede_mudar_imobiliaria_corretor', 'rede_regularizar_legado', 'rede_inativar_parceiro',
    'rede_reativar_parceiro', 'rede_inativar_imobiliaria', 'rede_gerar_codigo_indicacao',
    'crm_cadastrar_cliente', 'crm_editar_cliente', 'crm_listar', 'crm_clientes_opcoes', 'crm_ficha',
    'crm_inativar_cliente', 'crm_liberar_portal', 'crm_duplicidades_listar', 'crm_duplicidade_resolver',
    'leads_listar', 'leads_converter', 'leads_descartar', 'leads_excluir', 'leads_exportar',
    'propostas_listar', 'propostas_criar', 'propostas_responder',
    'crm_kanban', 'crm_kanban_coluna', 'crm_mudar_etapa', 'crm_timeline', 'crm_notas', 'crm_tarefas', 'crm_documentos',
    'crm_nota_criar', 'crm_tarefa_criar', 'crm_tarefa_editar', 'crm_tarefa_concluir', 'crm_responsaveis',
    'crm_minhas_tarefas', 'crm_documento_solicitar', 'crm_documento_cancelar', 'crm_documento_registrar_envio',
    'crm_documento_analisar', 'crm_documento_baixar',
    'contrato_simular', 'contrato_criar', 'contrato_atualizar_simulacao', 'contrato_mudar_status',
    'contrato_dados_modelo', 'contrato_preparar_envio', 'contratos_listar', 'contrato_detalhe', 'contrato_baixar',
    'config_publicar_parametros', 'config_publicar_modelo', 'config_liberar_modelo',
    'imovel_mudar_status', 'imovel_foto_registrar', 'imovel_foto_remover', 'imovel_fotos_ordenar', 'imovel_inativar',
    'auditoria_consultar', 'config_atualizar', 'equipe_definir_papel', 'lgpd_publicar_termo', 'lgpd_aceitar_termo',
    'lgpd_revogar_consentimento', 'lgpd_anonimizar_cliente', 'portal_meus_dados', 'portal_meu_corretor',
    'portal_documentos', 'portal_contratos', 'portal_contrato_baixar', 'painel_resumo', 'migracao_pendencias_resolver'];
  v_publicas constant text[] := array['lgpd_termo_vigente', 'rede_link_publico'];
  v_sistema constant text[] := array[
    'crm_pre_cadastro', 'rede_vincular_login', 'rede_registrar_convite', 'contrato_registrar_documento',
    'contrato_registrar_d4sign_uuid', 'contrato_registrar_envio', 'contrato_falha_envio', 'contrato_registrar_retorno',
    'portal_localizar_cliente'];
  v_cron constant text[] := array['notificacoes_reenviar', 'auditoria_purgar', 'limpar_temporarios'];
  v_todas constant text[] := v_usuario || v_publicas || v_sistema || v_cron;
  v_nome text;
  v_fn regprocedure;
  v_n int;
begin
  if cardinality(v_todas) <> 100 or (select count(distinct x) from unnest(v_todas) x) <> 100 then
    raise exception 'Lista de RPCs da §4.4 inconsistente (% nomes)', cardinality(v_todas);
  end if;
  foreach v_nome in array v_todas loop
    select count(*) into v_n from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = v_nome;
    if v_n <> 1 then
      raise exception 'RPC % encontrada % vez(es)', v_nome, v_n;
    end if;
    select p.oid::regprocedure into v_fn from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = v_nome;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    if v_nome = any (v_usuario) then
      execute format('grant execute on function %s to authenticated', v_fn);
    elsif v_nome = any (v_publicas) then
      execute format('grant execute on function %s to anon, authenticated, service_role', v_fn);
    elsif v_nome = any (v_sistema) then
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
end $$;
