-- Contratos e D4Sign — corpos das RPCs [WP4] (docs/ARQUITETURA_EXPANSAO.md §1.1 D1–D6, N4, N5, N7, N14, N16, N17,
-- §3.6, §3.8, §3.10, §3.11, §4.3–§4.6, §6.3–§6.5, §7.3, §8.5; docs_new/modulo-crm.md §8, modulo-financeiro.md §3,
-- integracoes.md §2 e §4).
-- Troca os corpos dos esqueletos da 20260929000009 com create or replace, com a MESMA assinatura (preserva dono e
-- grants: contrato_* de usuário só para authenticated; contrato_registrar_* e contrato_falha_envio só para
-- service_role) e devolve o JSON no formato de src/modulos/contratos/tipos.ts.
-- Aditivo: funções internas novas (prefixo _contrato_, sem grant a ninguém) e UMA RPC de sistema nova,
-- contrato_confirmar_envio (só service_role; revisão WP4R-01). Nenhuma tabela ou coluna nova.
--
-- Regras comuns (§4.4, §4.6):
-- - security definer ignora a RLS: o escopo é conferido aqui, explicitamente. O contrato segue a visibilidade do
--   CLIENTE (pode_ver_cliente: internos, ou parceiro aprovado com vínculo ativo na cadeia do cliente ativo), porque
--   traz dado pessoal dele; a cadeia congelada do contrato é base do B5 (comissões), não de visibilidade;
-- - leitura fora do escopo (contrato_detalhe) devolve NULO e grava 'acesso_negado'; escrita, geração e download fora
--   do escopo dão 42501 'Sem acesso a este registro' (mesma mensagem para inexistente) e não gravam nada;
-- - o valor do contrato é SEMPRE o do produto, lido aqui (N16); o front manda só as escolhas (forma, % de aporte,
--   entrada, nº de parcelas) e o servidor recalcula tudo com calcular_simulacao() (07), a única fonte de verdade;
-- - status muda só por _transicionar (tabela status_transicoes, §3.8), que grava historico_status e aplica os
--   efeitos (imóvel NC no envio e AP no encerramento; cliente → finalizado e eventos_dominio ao assinar);
-- - a auditoria guarda só ids, status, valores de contrato e nomes de campos: nunca texto livre nem dado pessoal;
-- - PAR-3: nomes da cadeia acima ou ao lado de quem consulta saem nulos (corretor não vê gerente nem imobiliária;
--   gerente não vê a imobiliária); autores acima saem genéricos ("Gerência", "Imobiliária", "Equipe Arken").
--
-- D4Sign (§6.4, §6.5): as Edge Functions chamam contrato_preparar_envio com o JWT do interno (trava de 15 min) e as
-- RPCs de sistema com a service role. Enquanto a trava vale, nada muda o contrato por fora da Edge (status e PDF
-- recusam com ENVIO_EM_ANDAMENTO) e a Edge reconfere tudo com contrato_confirmar_envio logo antes do disparo.
-- O cancelamento de um contrato em assinatura_pendente só é aceito depois de a Edge contrato-assinatura gravar em
-- integracao_chamadas (grant só da service role) a prova 'cancelar_confirmado' do cancelamento feito no D4Sign nos
-- últimos 15 minutos: um admin chamando a RPC direto não cancela só no banco (nota R1-03 do WP0; WP4R-03).

-- ============ FUNÇÕES INTERNAS (sem grant; só as RPCs deste arquivo chamam) ============

-- quem chama tem acesso ao módulo: interno (is_admin, com MFA quando exigida) ou parceiro aprovado com vínculo ativo
create function public._contrato_pode_operar()
returns boolean language sql stable set search_path = '' as $$
  select public.is_admin() or public.meu_parceiro_id() is not null
$$;

-- nível de quem chama: interno 4, imobiliária 3, gerente 2, corretor (ou parceiro legado com vínculo) 1, demais 0
create function public._contrato_nivel()
returns int language sql stable set search_path = '' as $$
  select case when public.is_admin() then 4
    else coalesce((select case p.tipo when 'imobiliaria' then 3 when 'gerente' then 2 else 1 end
                   from public.parceiros p where p.id = public.meu_parceiro_id()), 0) end
$$;

-- nome de uma pessoa (perfil) para quem consulta (PAR-3): internos veem todos; o próprio nome sempre; parceiros veem
-- o nome só de quem está abaixo deles pelo vínculo em parceiros — a mesma regra da política "parceiros: escopo lê" e
-- do _funil_nome (WP3R-01): a imobiliária vê os vínculos da sua imobiliária; o gerente, os corretores dele. Acima, ao
-- lado ou em outra cadeia (ex.: o corretor antigo depois de uma transferência entre imobiliárias) sai genérico pelo
-- tipo do vínculo. [WP7: antes decidia só pelo nível e mostrava o nome real de quem estava em outra cadeia]
create function public._contrato_nome_perfil(p_profile_id uuid, p_nivel int)
returns text language sql stable set search_path = '' as $$
  select case
    when p_profile_id is null then null
    when pr.id is null then 'Usuário removido'
    when pr.papel = 'cliente' then 'Cliente'
    when pr.id = auth.uid() or p_nivel >= 4 then coalesce(nullif(btrim(pr.nome), ''), 'Sem nome')
    when pr.papel in ('admin', 'super', 'colaborador') then 'Equipe Arken'
    when p.id is not null and (p.imobiliaria_id = public.escopo_imobiliaria()
                               or (p.tipo = 'corretor' and p.gerente_id = public.escopo_gerente()))
      then coalesce(nullif(btrim(pr.nome), ''), 'Sem nome')
    else case coalesce(p.tipo::text, pr.papel::text)
           when 'imobiliaria' then 'Imobiliária' when 'gerente' then 'Gerência' when 'corretor' then 'Corretor'
           else 'Parceiro' end
  end
  from (select 1) x
  left join public.profiles pr on pr.id = p_profile_id
  left join public.parceiros p on p.profile_id = p_profile_id
$$;

create function public._contrato_ref_perfil(p_profile_id uuid, p_nivel int)
returns jsonb language sql stable set search_path = '' as $$
  select case when p_profile_id is null then null
              else jsonb_build_object('id', p_profile_id, 'nome', public._contrato_nome_perfil(p_profile_id, p_nivel)) end
$$;

-- cadeia (CadeiaCliente) com PAR-3: cada nível só aparece para internos ou para quem está nele ou acima dele
create function public._contrato_cadeia(p_imobiliaria_id uuid, p_gerente_id uuid, p_corretor_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'corretor', (select jsonb_build_object('id', p.id, 'nome', p.nome) from public.parceiros p
                 where p.id = p_corretor_id
                   and (public.is_admin() or p.id = public.meu_parceiro_id()
                        or p.gerente_id = public.escopo_gerente() or p.imobiliaria_id = public.escopo_imobiliaria())),
    'gerente', (select jsonb_build_object('id', p.id, 'nome', p.nome) from public.parceiros p
                where p.id = p_gerente_id
                  and (public.is_admin() or p.id = public.escopo_gerente() or p.imobiliaria_id = public.escopo_imobiliaria())),
    'imobiliaria', (select jsonb_build_object('id', i.id, 'nome', i.nome, 'da_casa', i.da_casa) from public.imobiliarias i
                    where i.id = p_imobiliaria_id and (public.is_admin() or i.id = public.escopo_imobiliaria())))
$$;

-- produto para exibição (ProdutoResumo): valor = valor ATUAL do produto
create function public._contrato_produto_json(p_unidade_id uuid, p_imovel_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('tipo', 'unidade', 'id', u.id, 'nome', e.nome || ' · ' || u.identificador, 'codigo', null,
                               'empreendimento', jsonb_build_object('id', e.id, 'nome', e.nome), 'valor', u.valor)
       from public.unidades u join public.empreendimentos e on e.id = u.empreendimento_id where u.id = p_unidade_id),
    (select jsonb_build_object('tipo', 'imovel', 'id', i.id,
                               'nome', coalesce(nullif(btrim(i.nome), ''), 'Imóvel #' || lpad(i.codigo::text, 7, '0')),
                               'codigo', i.codigo, 'empreendimento', null, 'valor', i.valor)
       from public.imoveis i where i.id = p_imovel_id))
$$;

-- valor atual do produto (nulo se não existir)
create function public._contrato_valor_produto(p_unidade_id uuid, p_imovel_id uuid)
returns numeric language sql stable set search_path = '' as $$
  select coalesce((select u.valor from public.unidades u where u.id = p_unidade_id),
                  (select i.valor from public.imoveis i where i.id = p_imovel_id))
$$;

-- lê o p_produto (ProdutoRef: exatamente um de unidade_id/imovel_id, nenhuma outra chave — o front nunca manda
-- valor, SEG-4) e confere se o produto pode ir para contrato: unidade existente e não vendida (N5); imóvel aprovado e
-- ativo (E2). Com p_travar, trava a linha do produto (contrato_criar), o que serializa dois contratos para o mesmo
-- produto. Devolve {unidade_id, imovel_id, valor}. Formato inválido: DADOS_INVALIDOS; indisponível: PRODUTO_INDISPONIVEL.
create function public._contrato_produto_ler(p_produto jsonb, p_travar boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_u text;
  v_i text;
  v_valor numeric;
  v_status text;
  v_inativo boolean;
begin
  if p_produto is null or jsonb_typeof(p_produto) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_produto) k where k not in ('unidade_id', 'imovel_id')) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["produto"]}';
  end if;
  v_u := case when jsonb_typeof(p_produto -> 'unidade_id') = 'string' then lower(btrim(p_produto ->> 'unidade_id')) end;
  v_i := case when jsonb_typeof(p_produto -> 'imovel_id') = 'string' then lower(btrim(p_produto ->> 'imovel_id')) end;
  if (v_u is null) = (v_i is null)
     or (p_produto ? 'unidade_id' and jsonb_typeof(p_produto -> 'unidade_id') not in ('string', 'null'))
     or (p_produto ? 'imovel_id' and jsonb_typeof(p_produto -> 'imovel_id') not in ('string', 'null'))
     or coalesce(v_u, v_i) !~ v_re then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["produto"]}';
  end if;

  if v_u is not null then
    if p_travar then
      select u.valor, u.status::text into v_valor, v_status from public.unidades u where u.id = v_u::uuid for update;
    else
      select u.valor, u.status::text into v_valor, v_status from public.unidades u where u.id = v_u::uuid;
    end if;
    if not found or v_status = 'vendida' then
      raise exception 'PRODUTO_INDISPONIVEL' using errcode = 'P0001';
    end if;
    return jsonb_build_object('unidade_id', v_u::uuid, 'imovel_id', null, 'valor', v_valor);
  end if;

  if p_travar then
    select i.valor, i.status::text, i.inativado_em is not null into v_valor, v_status, v_inativo
    from public.imoveis i where i.id = v_i::uuid for update;
  else
    select i.valor, i.status::text, i.inativado_em is not null into v_valor, v_status, v_inativo
    from public.imoveis i where i.id = v_i::uuid;
  end if;
  if not found or v_status <> 'aprovado' or v_inativo then
    raise exception 'PRODUTO_INDISPONIVEL' using errcode = 'P0001';
  end if;
  return jsonb_build_object('unidade_id', null, 'imovel_id', v_i::uuid, 'valor', v_valor);
end $$;

-- simulação com os parâmetros VIGENTES (calcular_simulacao da 07). Devolve os valores calculados + parametros_id +
-- limites (LimitesSimulacao). Erros de limite: SIMULACAO_INVALIDA {motivos} (da própria calcular_simulacao).
create function public._contrato_calcular(p_forma public.forma_pagamento, p_valor numeric, p_perc_aporte numeric,
                                          p_entrada numeric, p_n_parcelas int)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_par public.parametros_simulacao%rowtype;
  v_calc jsonb;
begin
  select * into v_par from public.parametros_simulacao p where p.id = public.parametros_vigente_id();
  if not found then
    raise exception 'Parâmetros de simulação não configurados. Fale com a equipe Arken.' using errcode = 'P0001';
  end if;
  v_calc := public.calcular_simulacao(p_forma, p_valor, p_perc_aporte, p_entrada, p_n_parcelas,
                                      v_par.taxa_aporte_proprio, v_par.parcela_minima, v_par.parcela_maxima,
                                      v_par.valor_minimo, v_par.valor_minimo_flex);
  -- percentual tão pequeno que o aporte arredonda para zero (contratos.valor_aporte > 0)
  if (v_calc ->> 'valor_aporte')::numeric <= 0 then
    raise exception 'SIMULACAO_INVALIDA' using errcode = 'P0001', detail = '{"motivos":["percentual_invalido"]}';
  end if;
  return v_calc || jsonb_build_object(
    'parametros_id', v_par.id,
    'limites', jsonb_build_object('parcela_minima', v_par.parcela_minima, 'parcela_maxima', v_par.parcela_maxima,
                                  'valor_minimo', v_par.valor_minimo, 'valor_minimo_flex', v_par.valor_minimo_flex));
end $$;

-- valores do contrato para a auditoria (não pessoais: status, forma, produto, valores, versão dos parâmetros)
create function public._contrato_valores_json(p_k public.contratos)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'status', p_k.status, 'forma_pagamento', p_k.forma_pagamento, 'modelo_id', p_k.modelo_id,
    'unidade_id', p_k.unidade_id, 'imovel_id', p_k.imovel_id, 'parametros_id', p_k.parametros_id,
    'valor_imovel', p_k.valor_imovel, 'perc_aporte', p_k.perc_aporte, 'valor_aporte', p_k.valor_aporte,
    'valor_entrada', p_k.valor_entrada, 'base_parcelada', p_k.base_parcelada, 'valor_restante', p_k.valor_restante,
    'n_parcelas', p_k.n_parcelas, 'taxa_aporte', p_k.taxa_aporte, 'valor_parcela', p_k.valor_parcela,
    'valor_total_parcelas', p_k.valor_total_parcelas, 'valor_minimo_flex', p_k.valor_minimo_flex)
$$;

-- "#0000123"
create function public._contrato_rotulo(p_codigo bigint)
returns text language sql immutable set search_path = '' as $$
  select '#' || lpad(p_codigo::text, 7, '0')
$$;

-- perfis a avisar sobre um contrato (fila notificacoes): o corretor da cadeia (se tiver login) e quem enviou.
-- Nunca vazio + cliente_id: isso seria e-mail para o próprio cliente (§6.6), que não é o destino destes avisos.
create function public._contrato_destinatarios(p_k public.contratos)
returns uuid[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct d) filter (where d is not null), '{}'::uuid[])
  from unnest(array[(select p.profile_id from public.parceiros p where p.id = p_k.corretor_id), p_k.enviado_por]) d
$$;

-- houve cancelamento CONFIRMADO no D4Sign pela Edge contrato-assinatura (integracao_chamadas, só a service role grava)?
-- A prova é uma linha própria, operacao 'cancelar_confirmado', que a Edge grava só DEPOIS de o D4Sign confirmar o
-- cancelamento (ou de o documento já constar como cancelado). O registro genérico das chamadas ao D4Sign nunca usa essa
-- operação (grava 'cancelar', inclusive com erro e HTTP 200 quando a resposta não é JSON), então uma chamada que falhou
-- não serve de prova (WP4R-03).
--   p_janela: só os feitos dentro dela (nulo = qualquer época)
create function public._contrato_cancelamento_d4sign(p_id uuid, p_janela interval)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.integracao_chamadas ch
                 where ch.provedor = 'd4sign' and ch.operacao = 'cancelar_confirmado' and ch.entidade = 'contrato'
                   and ch.entidade_id = p_id and ch.http_status between 200 and 299 and ch.erro is null
                   and (p_janela is null or ch.criado_em > now() - p_janela))
$$;

-- envio para assinatura em andamento: em análise com a trava de 15 min de contrato_preparar_envio ainda valendo. Enquanto
-- isso a Edge contrato-assinatura fala com o D4Sign e nada pode mudar o contrato por fora dela (status, PDF): senão o
-- documento fica vivo no D4Sign com o contrato fora de assinatura (WP4R-01).
create function public._contrato_envio_travado(p_k public.contratos)
returns boolean language sql stable set search_path = '' as $$
  select p_k.status = 'em_analise' and p_k.envio_lock_em is not null and p_k.envio_lock_em > now() - interval '15 minutes'
$$;

-- comprador (cliente) e vendedora (representante_arken) sempre ASSINAM (D3): regra ativa de um desses papéis com ato
-- 'testemunhar' bloqueia o envio (a validação signatarios_configurados da 09 não confere o ato; ver notas ao WP7).
create function public._contrato_atos_obrigatorios_ok(p_modelo_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select not exists (select 1 from public.contrato_signatario_regras r
                     join public.contrato_modelos m on m.chave = r.modelo_chave
                     where m.id = p_modelo_id and r.ativo and r.papel in ('cliente', 'representante_arken')
                       and r.ato <> 'assinar')
$$;

-- validações do envio para assinatura (as da transição em_analise → assinatura_pendente, §3.8) + o ato obrigatório.
-- Devolve as que falharam (vazio = pode enviar); sem a transição ativa do sistema, nulo.
create function public._contrato_bloqueios_envio(p_k public.contratos)
returns text[] language plpgsql stable set search_path = '' as $$
declare
  v_validacoes text[];
  v_falhas text[];
begin
  select t.validacoes into v_validacoes from public.status_transicoes t
  where t.entidade = 'contrato' and t.de = 'em_analise' and t.para = 'assinatura_pendente' and t.ativa and t.sistema;
  if not found then
    return null;
  end if;
  v_falhas := public._transicao_validacoes_falhas('contrato', p_k.id, v_validacoes);
  if not public._contrato_atos_obrigatorios_ok(p_k.modelo_id) and not ('signatarios_configurados' = any (v_falhas)) then
    v_falhas := v_falhas || 'signatarios_configurados'::text;
  end if;
  return v_falhas;
end $$;

-- ============ SIMULAÇÃO E CRIAÇÃO (§3.6, FIN-1/FIN-2, SEG-4) ============

-- P+I. Não grava nada (nem auditoria): o valor é lido do produto e os limites dos parâmetros vigentes.
create or replace function public.contrato_simular(p_forma public.forma_pagamento, p_produto jsonb, p_perc_aporte numeric,
                                                   p_entrada numeric, p_n_parcelas int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prod jsonb;
  v_calc jsonb;
begin
  if auth.uid() is null or not public._contrato_pode_operar() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  v_prod := public._contrato_produto_ler(p_produto, false);
  v_calc := public._contrato_calcular(p_forma, (v_prod ->> 'valor')::numeric, p_perc_aporte, p_entrada, p_n_parcelas);
  return v_calc || jsonb_build_object(
    'forma', p_forma,
    'produto', public._contrato_produto_json((v_prod ->> 'unidade_id')::uuid, (v_prod ->> 'imovel_id')::uuid));
end $$;

-- criar_contrato + escopo sobre o cliente (ativo). Recalcula tudo no servidor; produto disponível; um contrato ativo
-- por produto (índices únicos da 07 + conferência com a linha do produto travada); modelo vigente da forma.
create or replace function public.contrato_criar(p_cliente_id uuid, p_forma public.forma_pagamento, p_produto jsonb,
                                                 p_perc_aporte numeric, p_entrada numeric, p_n_parcelas int)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_cli public.clientes%rowtype;
  v_prod jsonb;
  v_calc jsonb;
  v_modelo uuid;
  v_k public.contratos%rowtype;
begin
  if v_uid is null or p_cliente_id is null or not public.tem_permissao('criar_contrato')
     or not public.pode_ver_cliente(p_cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_cli from public.clientes c where c.id = p_cliente_id;
  if v_cli.inativado_em is not null or v_cli.anonimizado_em is not null then
    raise exception 'Cliente inativo não recebe contrato.' using errcode = 'P0001';
  end if;

  v_prod := public._contrato_produto_ler(p_produto, true);
  if exists (select 1 from public.contratos k
             where (k.unidade_id = (v_prod ->> 'unidade_id')::uuid or k.imovel_id = (v_prod ->> 'imovel_id')::uuid)
               and k.status not in ('recusado', 'expirado', 'cancelado', 'arquivado')) then
    raise exception 'CONTRATO_ATIVO' using errcode = 'P0001';
  end if;
  v_calc := public._contrato_calcular(p_forma, (v_prod ->> 'valor')::numeric, p_perc_aporte, p_entrada, p_n_parcelas);
  v_modelo := public.modelo_vigente_id(p_forma::text::public.modelo_chave);
  if v_modelo is null then
    raise exception 'Nenhum modelo de contrato publicado para esta forma de pagamento.' using errcode = 'P0001';
  end if;

  begin
    insert into public.contratos (cliente_id, modelo_id, forma_pagamento, unidade_id, imovel_id, parametros_id,
      valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
      valor_parcela, valor_total_parcelas, valor_minimo_flex)
    values (p_cliente_id, v_modelo, p_forma, (v_prod ->> 'unidade_id')::uuid, (v_prod ->> 'imovel_id')::uuid,
      (v_calc ->> 'parametros_id')::uuid, (v_calc ->> 'valor_imovel')::numeric, (v_calc ->> 'perc_aporte')::numeric,
      (v_calc ->> 'valor_aporte')::numeric, (v_calc ->> 'valor_entrada')::numeric, (v_calc ->> 'base_parcelada')::numeric,
      (v_calc ->> 'valor_restante')::numeric, (v_calc ->> 'n_parcelas')::int, (v_calc ->> 'taxa_aporte')::numeric,
      (v_calc ->> 'valor_parcela')::numeric, (v_calc ->> 'valor_total_parcelas')::numeric,
      (v_calc ->> 'valor_minimo_flex')::numeric)
    returning * into v_k;
  exception when unique_violation then
    raise exception 'CONTRATO_ATIVO' using errcode = 'P0001';
  end;

  perform public._evento_cliente(p_cliente_id, 'contrato_gerado', 'Contrato ' || public._contrato_rotulo(v_k.codigo) || ' criado',
                                 jsonb_build_object('contrato_id', v_k.id));
  perform public._auditar('operacao', 'criar', 'contratos', v_k.id::text, p_cliente_id, null, null,
                          public._contrato_valores_json(v_k), jsonb_build_object('rpc', 'contrato_criar', 'codigo', v_k.codigo));
  return v_k.id;
end $$;

-- mesmo acesso de contrato_criar; só em rascunho. Relê o valor do produto e os parâmetros e o modelo vigentes (a
-- simulação de um rascunho é sempre refeita com o que vale hoje); o gatilho marca o PDF como desatualizado.
create or replace function public.contrato_atualizar_simulacao(p_id uuid, p_forma public.forma_pagamento,
                                                               p_perc_aporte numeric, p_entrada numeric, p_n_parcelas int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_k public.contratos%rowtype;
  v_novo public.contratos%rowtype;
  v_prod jsonb;
  v_calc jsonb;
  v_modelo uuid;
  v_campos text[];
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_k from public.contratos k where k.id = p_id for update;
  if not found or not public.tem_permissao('criar_contrato') or not public.pode_ver_cliente(v_k.cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_k.status <> 'rascunho' then
    raise exception 'A simulação só pode ser alterada com o contrato em rascunho.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.clientes c where c.id = v_k.cliente_id
               and (c.inativado_em is not null or c.anonimizado_em is not null)) then
    raise exception 'Cliente inativo não recebe contrato.' using errcode = 'P0001';
  end if;

  v_prod := public._contrato_produto_ler(
    case when v_k.unidade_id is not null then jsonb_build_object('unidade_id', v_k.unidade_id)
         else jsonb_build_object('imovel_id', v_k.imovel_id) end, true);
  v_calc := public._contrato_calcular(p_forma, (v_prod ->> 'valor')::numeric, p_perc_aporte, p_entrada, p_n_parcelas);
  v_modelo := public.modelo_vigente_id(p_forma::text::public.modelo_chave);
  if v_modelo is null then
    raise exception 'Nenhum modelo de contrato publicado para esta forma de pagamento.' using errcode = 'P0001';
  end if;

  update public.contratos k
     set forma_pagamento = p_forma, modelo_id = v_modelo, parametros_id = (v_calc ->> 'parametros_id')::uuid,
         valor_imovel = (v_calc ->> 'valor_imovel')::numeric, perc_aporte = (v_calc ->> 'perc_aporte')::numeric,
         valor_aporte = (v_calc ->> 'valor_aporte')::numeric, valor_entrada = (v_calc ->> 'valor_entrada')::numeric,
         base_parcelada = (v_calc ->> 'base_parcelada')::numeric, valor_restante = (v_calc ->> 'valor_restante')::numeric,
         n_parcelas = (v_calc ->> 'n_parcelas')::int, taxa_aporte = (v_calc ->> 'taxa_aporte')::numeric,
         valor_parcela = (v_calc ->> 'valor_parcela')::numeric,
         valor_total_parcelas = (v_calc ->> 'valor_total_parcelas')::numeric,
         valor_minimo_flex = (v_calc ->> 'valor_minimo_flex')::numeric
   where k.id = p_id
  returning * into v_novo;
  v_campos := (select coalesce(array_agg(a.key order by a.key), '{}') from jsonb_each(public._contrato_valores_json(v_novo)) a
               where a.value is distinct from public._contrato_valores_json(v_k) -> a.key);

  -- valores mudaram: além do pdf_desatualizado (gatilho da 07), a versão esperada do próximo PDF avança. Um PDF que a
  -- Edge contrato-gerar montou com os dados lidos ANTES desta mudança chega com p_versao = versão antiga + 1 e cai em
  -- CONFLITO_VERSAO em contrato_registrar_documento, em vez de ser registrado como atual (WP4R-04). O número do
  -- arquivo pode pular (v1, v3): contrato_detalhe lista as versões que existem no bucket.
  if cardinality(v_campos) > 0 then
    update public.contratos k set pdf_versao = k.pdf_versao + 1 where k.id = p_id returning * into v_novo;
  end if;

  perform public._auditar('operacao', 'editar', 'contratos', p_id::text, v_k.cliente_id, v_campos,
    public._contrato_valores_json(v_k), public._contrato_valores_json(v_novo),
    jsonb_build_object('rpc', 'contrato_atualizar_simulacao', 'pdf_versao', v_novo.pdf_versao));
end $$;

-- ============ STATUS (§3.8) ============
-- Papel pela tabela status_transicoes; parceiros também precisam de criar_contrato + escopo (internos: escopo total).
-- Cancelar a partir de assinatura_pendente só depois do cancelamento no D4Sign (Edge contrato-assinatura).
create or replace function public.contrato_mudar_status(p_id uuid, p_para public.status_contrato, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_k public.contratos%rowtype;
  v_papel public.papel;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 2000);
  v_de text;
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_k from public.contratos k where k.id = p_id for update;
  if not found or not public.pode_ver_cliente(v_k.cliente_id) or not public.tem_permissao('criar_contrato') then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_para is null then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001';
  end if;
  select pr.papel into v_papel from public.profiles pr where pr.id = v_uid;
  if not exists (select 1 from public.status_transicoes t
                 where t.entidade = 'contrato' and t.de = v_k.status::text and t.para = p_para::text and t.ativa
                   and v_papel = any (t.papeis)) then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001',
      detail = jsonb_build_object('entidade', 'contrato', 'de', v_k.status, 'para', p_para)::text;
  end if;
  -- em análise com o envio para assinatura em andamento (trava de 15 min): devolver ou arquivar agora deixaria o
  -- documento vivo no D4Sign com o contrato fora de assinatura (e o produto livre para outro cliente). WP4R-01.
  if public._contrato_envio_travado(v_k) then
    raise exception 'ENVIO_EM_ANDAMENTO' using errcode = 'P0001';
  end if;
  if v_k.status = 'assinatura_pendente' and p_para = 'cancelado'
     and not public._contrato_cancelamento_d4sign(p_id, interval '15 minutes') then
    raise exception 'O envio para assinatura é cancelado pelo painel de assinatura do contrato, que cancela antes no D4Sign.'
      using errcode = 'P0001';
  end if;

  v_de := public._transicionar('contrato', p_id, p_para::text, v_motivo, 'usuario');

  if p_para in ('cancelado', 'arquivado') then
    perform public._evento_cliente(v_k.cliente_id, 'contrato_encerrado',
      'Contrato ' || public._contrato_rotulo(v_k.codigo) || case p_para when 'cancelado' then ' cancelado' else ' arquivado' end,
      jsonb_build_object('contrato_id', p_id, 'status', p_para));
  end if;
  -- o motivo é texto livre: fica em historico_status (e na observação da devolução), nunca na auditoria
  perform public._auditar('operacao', 'mudar_status', 'contratos', p_id::text, v_k.cliente_id, array['status'],
    jsonb_build_object('status', v_de), jsonb_build_object('status', p_para),
    jsonb_build_object('rpc', 'contrato_mudar_status', 'com_motivo', v_motivo is not null));
end $$;

-- ============ TEXTO E PDF (§6.3) ============
-- criar_contrato + escopo; status rascunho, documentacao_pendente ou em_analise. Todas as variáveis da lista
-- permitida, com o valor cru ou nulo (a formatação é do renderizarModelo em _shared/modelo-contrato.ts).
-- Usada pela Edge contrato-gerar (com o JWT do usuário) e pela prévia do texto no front. Auditoria operacao/gerar.
create or replace function public.contrato_dados_modelo(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.contratos%rowtype;
  v_c public.clientes%rowtype;
  v_m public.contrato_modelos%rowtype;
  v_cfg public.configuracao_geral%rowtype;
  v_corretor public.parceiros%rowtype;
  v_imob text;
  v_prod jsonb;
  v_var jsonb;
begin
  if auth.uid() is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_k from public.contratos k where k.id = p_id;
  if not found or not public.pode_ver_cliente(v_k.cliente_id) or not public.tem_permissao('criar_contrato') then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_k.status not in ('rascunho', 'documentacao_pendente', 'em_analise') then
    raise exception 'O texto do contrato só é gerado antes do envio para assinatura.' using errcode = 'P0001';
  end if;

  select * into v_c from public.clientes c where c.id = v_k.cliente_id;
  select * into v_m from public.contrato_modelos m where m.id = v_k.modelo_id;
  select * into v_cfg from public.configuracao_geral g;
  select * into v_corretor from public.parceiros p where p.id = v_k.corretor_id;
  select i.nome into v_imob from public.imobiliarias i where i.id = v_k.imobiliaria_id;
  v_prod := public._contrato_produto_json(v_k.unidade_id, v_k.imovel_id);

  v_var := jsonb_build_object(
    'codigo', v_k.codigo,
    'nome', nullif(btrim(v_c.nome), ''),
    'sobrenome', nullif(btrim(v_c.sobrenome), ''),
    'cpf-cnpj', coalesce(v_c.cpf, v_c.cnpj),
    'logradouro', v_c.logradouro,
    'numero', v_c.numero,
    'bairro', v_c.bairro,
    'cidade', v_c.cidade,
    'estado', v_c.uf,
    'cep', v_c.cep,
    'valor-propriedade', v_k.valor_imovel,
    'valor-parcela', v_k.valor_parcela,
    'data', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
    'rg', v_c.rg,
    'estado-civil', v_c.estado_civil,
    'nacionalidade', v_c.nacionalidade,
    'complemento', v_c.complemento,
    'produto', v_prod ->> 'nome',
    'produto-matricula', (select nullif(btrim(i.matricula), '') from public.imoveis i where i.id = v_k.imovel_id)
  ) || jsonb_build_object(
    'percentual-aporte', v_k.perc_aporte,
    'valor-aporte', v_k.valor_aporte,
    'valor-entrada', v_k.valor_entrada,
    'base-parcelada', v_k.base_parcelada,
    'numero-parcelas', v_k.n_parcelas,
    'taxa-aporte', v_k.taxa_aporte,
    'valor-minimo-flex', v_k.valor_minimo_flex,
    'corretor-nome', nullif(btrim(v_corretor.nome), ''),
    'corretor-creci', nullif(btrim(v_corretor.creci), ''),
    'imobiliaria-nome', nullif(btrim(v_imob), ''),
    'vendedora-razao-social', v_cfg.vendedora_razao_social,
    'vendedora-cnpj', v_cfg.vendedora_cnpj,
    'vendedora-endereco', v_cfg.vendedora_endereco);

  perform public._auditar('operacao', 'gerar', 'contratos', p_id::text, v_k.cliente_id, null, null, null,
    jsonb_build_object('rpc', 'contrato_dados_modelo', 'modelo_id', v_m.id, 'pdf_versao', v_k.pdf_versao));
  return jsonb_build_object(
    'modelo', jsonb_build_object('id', v_m.id, 'chave', v_m.chave, 'versao', v_m.versao, 'titulo', v_m.titulo,
                                 'conteudo', v_m.conteudo),
    'variaveis', v_var,
    'codigo', v_k.codigo,
    'pdf_versao', v_k.pdf_versao);
end $$;

-- [service] Edge contrato-gerar, depois do upload: concorrência pela versão (p_versao = pdf_versao + 1, senão
-- CONFLITO_VERSAO); caminho <id>/minuta-v<n>-<sha8>.pdf com o sha do próprio arquivo; objeto já gravado no bucket.
create or replace function public.contrato_registrar_documento(p_id uuid, p_versao int, p_path text, p_sha256 text,
                                                               p_texto_sha256 text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.contratos%rowtype;
begin
  if p_id is null or p_versao is null or p_sha256 is null or p_texto_sha256 is null
     or p_sha256 !~ '^[0-9a-f]{64}$' or p_texto_sha256 !~ '^[0-9a-f]{64}$'
     or p_path is distinct from (p_id::text || '/minuta-v' || p_versao::text || '-' || left(p_sha256, 8) || '.pdf') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
  end if;
  select * into v_k from public.contratos k where k.id = p_id for update;
  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;
  if v_k.status not in ('rascunho', 'documentacao_pendente', 'em_analise') then
    raise exception 'O PDF só pode ser trocado antes do envio para assinatura.' using errcode = 'P0001';
  end if;
  -- durante o envio para assinatura a minuta é a que a Edge contrato-assinatura está mandando ao D4Sign (WP4R-01)
  if public._contrato_envio_travado(v_k) then
    raise exception 'ENVIO_EM_ANDAMENTO' using errcode = 'P0001';
  end if;
  if p_versao <> v_k.pdf_versao + 1 then
    raise exception 'CONFLITO_VERSAO' using errcode = 'P0001',
      detail = jsonb_build_object('esperada', v_k.pdf_versao + 1, 'recebida', p_versao)::text;
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'contratos' and o.name = p_path) then
    raise exception 'O arquivo do PDF não foi encontrado no armazenamento.' using errcode = 'P0001';
  end if;

  update public.contratos k
     set pdf_path = p_path, pdf_sha256 = p_sha256, texto_sha256 = p_texto_sha256, pdf_versao = p_versao,
         pdf_gerado_em = now(), pdf_desatualizado = false
   where k.id = p_id;
  perform public._auditar('operacao', 'gerar', 'contratos', p_id::text, v_k.cliente_id,
    array['pdf_path', 'pdf_sha256', 'texto_sha256', 'pdf_versao', 'pdf_gerado_em', 'pdf_desatualizado'],
    jsonb_build_object('pdf_versao', v_k.pdf_versao), jsonb_build_object('pdf_versao', p_versao),
    jsonb_build_object('rpc', 'contrato_registrar_documento'), 'edge:contrato-gerar');
end $$;

-- ============ ENVIO PARA ASSINATURA (§6.4) ============

-- I, com o JWT (a Edge contrato-assinatura chama): em_analise; transição ativa; nenhuma trava vigente (15 min);
-- validações da §3.8 (as mesmas que _transicionar vai repetir no registro do envio). Trava o envio, guarda quem
-- enviou e resolve os signatários pelas regras ativas da chave do modelo (D3). Auditoria operacao/enviar_assinatura.
create or replace function public.contrato_preparar_envio(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_k public.contratos%rowtype;
  v_t public.status_transicoes%rowtype;
  v_falhas text[];
  v_sig jsonb;
begin
  if v_uid is null or p_id is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_k from public.contratos k where k.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_t from public.status_transicoes t
  where t.entidade = 'contrato' and t.de = v_k.status::text and t.para = 'assinatura_pendente' and t.ativa and t.sistema;
  if v_k.status <> 'em_analise' or not found then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001',
      detail = jsonb_build_object('entidade', 'contrato', 'de', v_k.status, 'para', 'assinatura_pendente')::text;
  end if;
  if v_k.envio_lock_em is not null and v_k.envio_lock_em > now() - interval '15 minutes' then
    raise exception 'ENVIO_EM_ANDAMENTO' using errcode = 'P0001';
  end if;
  -- validações da transição + comprador e vendedora com ato 'assinar' (D3)
  v_falhas := public._contrato_bloqueios_envio(v_k);
  if cardinality(v_falhas) > 0 then
    raise exception 'VALIDACAO_FALHOU' using errcode = 'P0001',
      detail = jsonb_build_object('validacoes', to_jsonb(v_falhas))::text;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('ordem', s.ordem, 'papel', s.papel, 'nome', s.nome, 'email', s.email,
                                               'ato', s.ato) order by s.ordem), '[]'::jsonb)
    into v_sig
  from (
    select r.ordem, r.papel, r.ato,
           case r.fonte when 'cliente' then btrim(concat_ws(' ', btrim(c.nome), nullif(btrim(c.sobrenome), '')))
                        when 'corretor_do_cliente' then btrim(p.nome)
                        else btrim(r.nome) end as nome,
           lower(btrim(case r.fonte when 'cliente' then c.email when 'corretor_do_cliente' then p.email else r.email end)) as email
    from public.contrato_signatario_regras r
    join public.contrato_modelos m on m.chave = r.modelo_chave and m.id = v_k.modelo_id
    join public.clientes c on c.id = v_k.cliente_id
    left join public.parceiros p on p.id = v_k.corretor_id
    where r.ativo
  ) s;
  if exists (select 1 from jsonb_array_elements(v_sig) e
             where coalesce(e ->> 'email', '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(coalesce(e ->> 'nome', '')) < 2) then
    raise exception 'VALIDACAO_FALHOU' using errcode = 'P0001', detail = '{"validacoes":["signatarios_configurados"]}';
  end if;
  if (select count(distinct e ->> 'email') from jsonb_array_elements(v_sig) e) <> jsonb_array_length(v_sig) then
    raise exception 'Dois signatários com o mesmo e-mail: ajuste o e-mail do cliente ou as regras de signatários.'
      using errcode = 'P0001';
  end if;

  update public.contratos k set envio_lock_em = now(), enviado_por = v_uid where k.id = p_id;
  perform public._auditar('operacao', 'enviar_assinatura', 'contratos', p_id::text, v_k.cliente_id, null, null, null,
    jsonb_build_object('rpc', 'contrato_preparar_envio', 'fase', 'preparar', 'signatarios', jsonb_array_length(v_sig),
                       'reenvio', v_k.d4sign_uuid is not null));
  return jsonb_build_object(
    'contrato_id', v_k.id, 'codigo', v_k.codigo, 'pdf_path', v_k.pdf_path, 'pdf_sha256', v_k.pdf_sha256,
    'texto_sha256', v_k.texto_sha256, 'pdf_gerado_em', v_k.pdf_gerado_em, 'd4sign_uuid', v_k.d4sign_uuid,
    'signatarios', v_sig);
end $$;

-- [service] grava o uuid do documento no D4Sign logo depois do upload (permite retomar sem duplicar). Idempotente
-- para o mesmo uuid; outro uuid só durante um envio travado (a Edge cancelou o anterior, que tinha outra minuta).
create or replace function public.contrato_registrar_d4sign_uuid(p_id uuid, p_uuid text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.contratos%rowtype;
begin
  if p_id is null or p_uuid is null or p_uuid !~ '^[A-Za-z0-9-]{1,100}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
  end if;
  select * into v_k from public.contratos k where k.id = p_id for update;
  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;
  if v_k.d4sign_uuid is not distinct from p_uuid then
    return;
  end if;
  if v_k.status <> 'em_analise' or v_k.envio_lock_em is null then
    raise exception 'O contrato não está em envio para assinatura.' using errcode = 'P0001';
  end if;
  update public.contratos k set d4sign_uuid = p_uuid where k.id = p_id;
  perform public._auditar('integracao', 'enviar_assinatura', 'contratos', p_id::text, v_k.cliente_id, array['d4sign_uuid'],
    null, null, jsonb_build_object('rpc', 'contrato_registrar_d4sign_uuid', 'fase', 'documento',
                                   'substituido', v_k.d4sign_uuid is not null), 'edge:contrato-assinatura');
end $$;

-- [service] NOVA (aditiva, WP4R-01): a Edge contrato-assinatura chama logo ANTES do disparo no D4Sign (sendtosigner).
-- Confere de novo, com a linha travada, que o envio ainda vale: contrato em análise, trava de 15 min ainda valendo,
-- documento do D4Sign = o registrado, e as validações do envio (valor do produto, modelo liberado, signatários com o ato
-- certo, vendedora, e-mail do cliente, PDF atual). Não grava nada: se algo mudou desde contrato_preparar_envio, o erro
-- faz a Edge desistir antes de o e-mail sair para os signatários.
create function public.contrato_confirmar_envio(p_id uuid, p_uuid text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.contratos%rowtype;
  v_falhas text[];
begin
  if p_id is null or p_uuid is null or p_uuid !~ '^[A-Za-z0-9-]{1,100}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
  end if;
  select * into v_k from public.contratos k where k.id = p_id for update;
  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;
  if not public._contrato_envio_travado(v_k) or v_k.d4sign_uuid is distinct from p_uuid then
    raise exception 'O contrato não está em envio para assinatura.' using errcode = 'P0001';
  end if;
  v_falhas := public._contrato_bloqueios_envio(v_k);
  if v_falhas is null then
    raise exception 'TRANSICAO_INVALIDA' using errcode = 'P0001',
      detail = jsonb_build_object('entidade', 'contrato', 'de', v_k.status, 'para', 'assinatura_pendente')::text;
  end if;
  if cardinality(v_falhas) > 0 then
    raise exception 'VALIDACAO_FALHOU' using errcode = 'P0001',
      detail = jsonb_build_object('validacoes', to_jsonb(v_falhas))::text;
  end if;
end $$;

-- [service] registra o envio feito no D4Sign: signatários (com a chave do D4Sign), hash do token do webhook e a
-- transição em_analise → assinatura_pendente (validações de novo; efeito imovel_no_contrato; cadeia congelada).
-- Idempotente: com o contrato já em assinatura_pendente, não faz nada.
create or replace function public.contrato_registrar_envio(p_id uuid, p_signatarios jsonb, p_webhook_token_hash text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.contratos%rowtype;
  v_dest uuid[];
  v_n int;
begin
  if p_id is null or p_webhook_token_hash is null or p_webhook_token_hash !~ '^[0-9a-f]{64}$'
     or p_signatarios is null or jsonb_typeof(p_signatarios) <> 'array'
     or jsonb_array_length(p_signatarios) not between 1 and 50 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_signatarios) e
             where jsonb_typeof(e) <> 'object'
                or jsonb_typeof(e -> 'ordem') <> 'number'
                or coalesce(e ->> 'papel', '') not in ('cliente', 'representante_arken', 'corretor', 'testemunha')
                or length(btrim(coalesce(e ->> 'nome', ''))) not between 2 and 200
                or coalesce(e ->> 'email', '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e ->> 'email') > 200
                or coalesce(e ->> 'ato', '') not in ('assinar', 'testemunhar')
                or length(coalesce(e ->> 'd4sign_chave', '')) > 200) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
  end if;

  select * into v_k from public.contratos k where k.id = p_id for update;
  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;
  if v_k.status = 'assinatura_pendente' then
    return;
  end if;
  if v_k.status <> 'em_analise' or v_k.d4sign_uuid is null or v_k.envio_lock_em is null then
    raise exception 'O contrato não está em envio para assinatura.' using errcode = 'P0001';
  end if;

  delete from public.contrato_signatarios s where s.contrato_id = p_id;
  insert into public.contrato_signatarios (contrato_id, ordem, papel, nome, email, ato, d4sign_chave)
  select p_id, (e ->> 'ordem')::numeric::smallint, (e ->> 'papel')::public.papel_signatario, btrim(e ->> 'nome'),
         lower(btrim(e ->> 'email')), e ->> 'ato', nullif(btrim(coalesce(e ->> 'd4sign_chave', '')), '')
  from jsonb_array_elements(p_signatarios) e;
  get diagnostics v_n = row_count;
  -- comprador e vendedora sempre assinam (D3): testemunha não conta
  if not exists (select 1 from public.contrato_signatarios s where s.contrato_id = p_id and s.papel = 'cliente' and s.ato = 'assinar')
     or not exists (select 1 from public.contrato_signatarios s
                    where s.contrato_id = p_id and s.papel = 'representante_arken' and s.ato = 'assinar') then
    raise exception 'VALIDACAO_FALHOU' using errcode = 'P0001', detail = '{"validacoes":["signatarios_configurados"]}';
  end if;

  update public.contratos k set webhook_token_hash = p_webhook_token_hash where k.id = p_id;
  perform public._transicionar('contrato', p_id, 'assinatura_pendente', null, 'sistema');
  select * into v_k from public.contratos k where k.id = p_id;

  perform public._evento_cliente(v_k.cliente_id, 'contrato_enviado',
    'Contrato ' || public._contrato_rotulo(v_k.codigo) || ' enviado para assinatura', jsonb_build_object('contrato_id', p_id));
  perform public._auditar('operacao', 'enviar_assinatura', 'contratos', p_id::text, v_k.cliente_id,
    array['status', 'webhook_token_hash', 'enviado_assinatura_em'],
    jsonb_build_object('status', 'em_analise'), jsonb_build_object('status', 'assinatura_pendente'),
    jsonb_build_object('rpc', 'contrato_registrar_envio', 'signatarios', v_n, 'enviado_por', v_k.enviado_por),
    'edge:contrato-assinatura');
  v_dest := public._contrato_destinatarios(v_k);
  if cardinality(v_dest) > 0 then
    perform public._notificar('contratos.enviado', v_dest, v_k.cliente_id, jsonb_build_object('contrato_id', p_id));
  end if;
end $$;

-- [service] falha no envio: libera a trava (o contrato fica em em_analise; o reenvio reaproveita o d4sign_uuid) e
-- grava o erro (já sem segredo, mensagemSegura na Edge) em integracao_chamadas. Idempotente.
create or replace function public.contrato_falha_envio(p_id uuid, p_erro text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.contratos%rowtype;
begin
  if p_id is null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
  end if;
  select * into v_k from public.contratos k where k.id = p_id for update;
  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;
  insert into public.integracao_chamadas (provedor, operacao, entidade, entidade_id, erro)
  values ('d4sign', 'enviar:falha', 'contrato', p_id, left(coalesce(nullif(btrim(p_erro), ''), 'falha no envio'), 2000));
  if v_k.status = 'em_analise' and v_k.envio_lock_em is not null then
    update public.contratos k set envio_lock_em = null, enviado_por = null where k.id = p_id;
    perform public._auditar('integracao', 'enviar_assinatura', 'contratos', p_id::text, v_k.cliente_id,
      array['envio_lock_em', 'enviado_por'], null, null,
      jsonb_build_object('rpc', 'contrato_falha_envio', 'fase', 'falha'), 'edge:contrato-assinatura');
  end if;
end $$;

-- [service] retorno do D4Sign (webhook reconsultado na API, ou reconciliação). Nunca confia no webhook: a Edge
-- reconsulta o documento e manda o estado já mapeado. Idempotente: contrato fora de assinatura_pendente não muda
-- (assinado seguido de recusado é ignorado); estado igual não faz nada.
--   assinado    → PDF assinado (<id>/assinado-<sha8>.pdf, já gravado) e transição; efeitos D5 (cliente finalizado,
--                 eventos_dominio 'contrato.assinado'); timeline e aviso contratos.assinado
--   recusado / expirado → transição; efeito imovel_aprovado
--   cancelado   → cancelamento pedido pela plataforma nos últimos 15 min: nada (a Edge conclui com o motivo do
--                 interno); pedido antes disso (a Edge caiu no meio): cancelado pelo sistema; sem pedido nosso (recusa
--                 de signatário ou cancelamento direto no painel do D4Sign): recusado ⚑
--   assinatura_pendente → só o andamento por signatário
create or replace function public.contrato_registrar_retorno(p_d4sign_uuid text, p_status text, p_signatarios jsonb,
                                                             p_pdf_assinado_path text, p_sha256 text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.contratos%rowtype;
  v_e jsonb;
  v_n int;
  v_sig int := 0;
  v_para text;
  v_motivo text;
  v_dest uuid[];
begin
  if p_d4sign_uuid is null or p_status is null
     or p_status not in ('assinatura_pendente', 'assinado', 'recusado', 'expirado', 'cancelado')
     or (p_signatarios is not null and jsonb_typeof(p_signatarios) not in ('array', 'null')) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
  end if;
  select * into v_k from public.contratos k where k.d4sign_uuid = p_d4sign_uuid for update;
  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;
  if v_k.status <> 'assinatura_pendente' then
    return;
  end if;

  -- andamento por signatário (e-mail como chave; só o que mudou)
  if jsonb_typeof(p_signatarios) = 'array' then
    for v_e in select e from jsonb_array_elements(p_signatarios) e loop
      continue when jsonb_typeof(v_e) <> 'object' or coalesce(v_e ->> 'status', '') not in ('pendente', 'assinado', 'recusado');
      update public.contrato_signatarios s
         set status = (v_e ->> 'status')::public.status_assinatura,
             assinado_em = case when v_e ->> 'status' = 'assinado'
                                then coalesce(s.assinado_em, (nullif(v_e ->> 'assinado_em', ''))::timestamptz, now()) end,
             recusado_em = case when v_e ->> 'status' = 'recusado'
                                then coalesce(s.recusado_em, (nullif(v_e ->> 'recusado_em', ''))::timestamptz, now()) end,
             motivo = case when v_e ->> 'status' = 'recusado' then left(nullif(btrim(v_e ->> 'motivo'), ''), 2000) end
       where s.contrato_id = v_k.id and s.email = lower(btrim(coalesce(v_e ->> 'email', '')))
         and s.status is distinct from (v_e ->> 'status')::public.status_assinatura;
      get diagnostics v_n = row_count;
      v_sig := v_sig + v_n;
    end loop;
  end if;

  v_para := p_status;
  if p_status = 'cancelado' then
    if public._contrato_cancelamento_d4sign(v_k.id, interval '15 minutes') then
      v_para := 'assinatura_pendente';
    elsif public._contrato_cancelamento_d4sign(v_k.id, null) then
      v_motivo := 'Cancelamento pedido na plataforma e confirmado pelo D4Sign';
    else
      v_para := 'recusado';
      v_motivo := 'Documento cancelado no D4Sign sem pedido da plataforma';
    end if;
  elsif p_status in ('recusado', 'expirado') then
    v_motivo := 'Informado pelo D4Sign';
  end if;

  if v_para = 'assinado' then
    if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
       or p_pdf_assinado_path is distinct from (v_k.id::text || '/assinado-' || left(p_sha256, 8) || '.pdf') then
      raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratos' and o.name = p_pdf_assinado_path) then
      raise exception 'O arquivo do PDF assinado não foi encontrado no armazenamento.' using errcode = 'P0001';
    end if;
    update public.contratos k set pdf_assinado_path = p_pdf_assinado_path, pdf_assinado_sha256 = p_sha256
     where k.id = v_k.id;
    update public.contrato_signatarios s set status = 'assinado', assinado_em = coalesce(s.assinado_em, now())
     where s.contrato_id = v_k.id and s.status = 'pendente';
    perform public._transicionar('contrato', v_k.id, 'assinado', null, 'webhook');
    perform public._evento_cliente(v_k.cliente_id, 'contrato_assinado',
      'Contrato ' || public._contrato_rotulo(v_k.codigo) || ' assinado', jsonb_build_object('contrato_id', v_k.id));
    perform public._auditar('integracao', 'assinar', 'contratos', v_k.id::text, v_k.cliente_id,
      array['status', 'assinado_em', 'pdf_assinado_path', 'pdf_assinado_sha256'],
      jsonb_build_object('status', 'assinatura_pendente'), jsonb_build_object('status', 'assinado'),
      jsonb_build_object('rpc', 'contrato_registrar_retorno'), 'webhook:d4sign');
    v_dest := public._contrato_destinatarios(v_k);
    if cardinality(v_dest) > 0 then
      perform public._notificar('contratos.assinado', v_dest, v_k.cliente_id, jsonb_build_object('contrato_id', v_k.id));
    end if;
  elsif v_para in ('recusado', 'expirado', 'cancelado') then
    perform public._transicionar('contrato', v_k.id, v_para, v_motivo, 'webhook');
    perform public._evento_cliente(v_k.cliente_id, 'contrato_encerrado',
      'Contrato ' || public._contrato_rotulo(v_k.codigo) || case v_para when 'recusado' then ' recusado'
        when 'expirado' then ' expirado' else ' cancelado' end,
      jsonb_build_object('contrato_id', v_k.id, 'status', v_para));
    perform public._auditar('integracao', 'mudar_status', 'contratos', v_k.id::text, v_k.cliente_id, array['status'],
      jsonb_build_object('status', 'assinatura_pendente'), jsonb_build_object('status', v_para),
      jsonb_build_object('rpc', 'contrato_registrar_retorno', 'status_d4sign', p_status), 'webhook:d4sign');
  elsif v_sig > 0 then
    perform public._auditar('integracao', 'atualizar', 'contrato_signatarios', v_k.id::text, v_k.cliente_id,
      array['status', 'assinado_em', 'recusado_em'], null, null,
      jsonb_build_object('rpc', 'contrato_registrar_retorno', 'signatarios', v_sig), 'webhook:d4sign');
  end if;
end $$;

-- ============ LEITURAS (escopo do cliente) ============

-- P+I. p_filtros: status[] (StatusContrato), cliente_id, imovel_id, unidade_id (o produto; WP7, para o link "Ver
-- contrato" do imóvel em NC), forma, busca (#código, nome do cliente ou do produto; não vai para a auditoria),
-- corretor_id (cruzado com o escopo), limite (padrão 50, máx. 200), offset. Mais novos primeiro. Todo filtro é cruzado
-- com o escopo do cliente (um imovel_id de outra cadeia devolve lista vazia). Auditoria acesso/listar com os ids
-- devolvidos.
create or replace function public.contratos_listar(p_filtros jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_f constant jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_interno boolean;
  v_ec uuid;
  v_eg uuid;
  v_ei uuid;
  v_status public.status_contrato[];
  v_cliente uuid;
  v_imovel uuid;
  v_unidade uuid;
  v_forma public.forma_pagamento;
  v_corretor uuid;
  v_busca text;
  v_codigo bigint;
  v_padrao text;
  v_lim int;
  v_off int;
  v_invalidos text[] := '{}'::text[];
  v_total int;
  v_todos uuid[];
  v_pagina uuid[];
  v_itens jsonb;
begin
  if auth.uid() is null or not public._contrato_pode_operar() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if jsonb_typeof(v_f) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["filtros"]}';
  end if;
  -- filtros (ausente/nulo/vazio = sem filtro; tipo errado = DADOS_INVALIDOS)
  if jsonb_typeof(v_f -> 'status') = 'array' then
    if exists (select 1 from jsonb_array_elements(v_f -> 'status') s
               where jsonb_typeof(s) <> 'string' or (s #>> '{}') not in (select unnest(enum_range(null::public.status_contrato))::text)) then
      v_invalidos := v_invalidos || 'status'::text;
    else
      select nullif(array_agg((s #>> '{}')::public.status_contrato), '{}') into v_status from jsonb_array_elements(v_f -> 'status') s;
    end if;
  elsif coalesce(jsonb_typeof(v_f -> 'status'), 'null') <> 'null' then
    v_invalidos := v_invalidos || 'status'::text;
  end if;
  if coalesce(jsonb_typeof(v_f -> 'cliente_id'), 'null') <> 'null' then
    if jsonb_typeof(v_f -> 'cliente_id') <> 'string' or lower(v_f ->> 'cliente_id') !~ v_re then
      v_invalidos := v_invalidos || 'cliente_id'::text;
    else
      v_cliente := (v_f ->> 'cliente_id')::uuid;
    end if;
  end if;
  if coalesce(jsonb_typeof(v_f -> 'imovel_id'), 'null') <> 'null' then
    if jsonb_typeof(v_f -> 'imovel_id') <> 'string' or lower(v_f ->> 'imovel_id') !~ v_re then
      v_invalidos := v_invalidos || 'imovel_id'::text;
    else
      v_imovel := (v_f ->> 'imovel_id')::uuid;
    end if;
  end if;
  if coalesce(jsonb_typeof(v_f -> 'unidade_id'), 'null') <> 'null' then
    if jsonb_typeof(v_f -> 'unidade_id') <> 'string' or lower(v_f ->> 'unidade_id') !~ v_re then
      v_invalidos := v_invalidos || 'unidade_id'::text;
    else
      v_unidade := (v_f ->> 'unidade_id')::uuid;
    end if;
  end if;
  if coalesce(jsonb_typeof(v_f -> 'corretor_id'), 'null') <> 'null' then
    if jsonb_typeof(v_f -> 'corretor_id') <> 'string' or lower(v_f ->> 'corretor_id') !~ v_re then
      v_invalidos := v_invalidos || 'corretor_id'::text;
    else
      v_corretor := (v_f ->> 'corretor_id')::uuid;
    end if;
  end if;
  if coalesce(jsonb_typeof(v_f -> 'forma'), 'null') <> 'null' then
    if coalesce(v_f ->> 'forma', '') not in ('parcelado', 'flexivel') then
      v_invalidos := v_invalidos || 'forma'::text;
    else
      v_forma := (v_f ->> 'forma')::public.forma_pagamento;
    end if;
  end if;
  if coalesce(jsonb_typeof(v_f -> 'busca'), 'null') not in ('null', 'string') then
    v_invalidos := v_invalidos || 'busca'::text;
  end if;
  v_busca := left(nullif(btrim(coalesce(v_f ->> 'busca', '')), ''), 100);
  if coalesce(jsonb_typeof(v_f -> 'limite'), 'null') not in ('null', 'number')
     or coalesce(jsonb_typeof(v_f -> 'offset'), 'null') not in ('null', 'number') then
    v_invalidos := v_invalidos || 'paginacao'::text;
  end if;
  if cardinality(v_invalidos) > 0 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', to_jsonb(v_invalidos))::text;
  end if;
  -- faixa conferida em numeric ANTES do cast (1e20 estouraria o int com 22003; WP4R-08)
  v_lim := least(greatest(coalesce(floor((v_f ->> 'limite')::numeric), 50), 1), 200)::int;
  v_off := least(greatest(coalesce(floor((v_f ->> 'offset')::numeric), 0), 0), 1000000000)::int;
  if v_busca is not null then
    if v_busca ~ '^#?[0-9]{1,15}$' then
      v_codigo := ltrim(v_busca, '#')::bigint;
    end if;
    v_padrao := '%' || replace(replace(replace(v_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  v_interno := public.is_admin();
  v_ec := public.escopo_corretor();
  v_eg := public.escopo_gerente();
  v_ei := public.escopo_imobiliaria();

  -- todos os ids do filtro, na ordem da lista (mais novos primeiro); a página é uma fatia deles
  select coalesce(array_agg(x.id order by x.criado_em desc, x.codigo desc), '{}'::uuid[]) into v_todos
  from (
    select k.id, k.criado_em, k.codigo
    from public.contratos k
    join public.clientes c on c.id = k.cliente_id
    left join public.unidades u on u.id = k.unidade_id
    left join public.empreendimentos e on e.id = u.empreendimento_id
    left join public.imoveis i on i.id = k.imovel_id
    where (v_interno or (c.inativado_em is null
                         and (c.corretor_id = v_ec or c.gerente_id = v_eg or c.imobiliaria_id = v_ei)))
      and (v_status is null or k.status = any (v_status))
      and (v_cliente is null or k.cliente_id = v_cliente)
      and (v_imovel is null or k.imovel_id = v_imovel)
      and (v_unidade is null or k.unidade_id = v_unidade)
      and (v_forma is null or k.forma_pagamento = v_forma)
      and (v_corretor is null or k.corretor_id = v_corretor)
      and (v_busca is null
           or k.codigo = v_codigo
           or concat_ws(' ', c.nome, c.sobrenome) ilike v_padrao
           or (e.nome || ' · ' || u.identificador) ilike v_padrao
           or i.nome ilike v_padrao)
  ) x;
  v_total := cardinality(v_todos);
  v_pagina := coalesce(v_todos[v_off + 1 : v_off + v_lim], '{}'::uuid[]);

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', k.id, 'codigo', k.codigo,
             'cliente', jsonb_build_object('id', c.id, 'nome', btrim(concat_ws(' ', c.nome, nullif(btrim(c.sobrenome), '')))),
             'status', k.status, 'forma_pagamento', k.forma_pagamento,
             'produto', public._contrato_produto_json(k.unidade_id, k.imovel_id),
             'valor_imovel', k.valor_imovel, 'n_parcelas', k.n_parcelas, 'valor_parcela', k.valor_parcela,
             'pdf_desatualizado', k.pdf_desatualizado, 'criado_em', k.criado_em,
             'enviado_assinatura_em', k.enviado_assinatura_em, 'assinado_em', k.assinado_em)
           || public._contrato_cadeia(k.imobiliaria_id, k.gerente_id, k.corretor_id)
           order by p.ordem), '[]'::jsonb)
    into v_itens
  from unnest(v_pagina) with ordinality as p(id, ordem)
  join public.contratos k on k.id = p.id
  join public.clientes c on c.id = k.cliente_id;

  perform public._auditar('acesso', 'listar', 'contratos', null, v_cliente, null, null, null,
    jsonb_build_object('rpc', 'contratos_listar', 'ids', to_jsonb(v_pagina), 'total', v_total, 'busca', v_busca is not null,
                       'filtros', jsonb_strip_nulls(jsonb_build_object('status', to_jsonb(v_status), 'forma', v_forma,
                                                                       'cliente_id', v_cliente, 'corretor_id', v_corretor,
                                                                       'imovel_id', v_imovel, 'unidade_id', v_unidade)),
                       'limite', v_lim, 'offset', v_off));
  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

-- P+I. Fora do escopo (ou inexistente): nulo + acesso_negado. Traz os bloqueios do envio (ensaio das validações), os
-- destinos de status que quem consulta pode acionar e as permissões da tela (o servidor confere de novo).
-- E-mails de signatários que não são o cliente nem o corretor (representante da Arken, testemunhas) só para internos.
create or replace function public.contrato_detalhe(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_k public.contratos%rowtype;
  v_c public.clientes%rowtype;
  v_m public.contrato_modelos%rowtype;
  v_interno boolean;
  v_nivel int;
  v_papel public.papel;
  v_editor boolean;
  v_valor_atual numeric;
  v_bloqueios text[] := '{}'::text[];
  v_destinos jsonb;
  v_sig jsonb;
  v_editavel boolean;
  v_travado boolean;
  v_versoes jsonb;
begin
  if v_uid is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_id is not null then
    select * into v_k from public.contratos k where k.id = p_id;
  end if;
  if v_k.id is null or not public.pode_ver_cliente(v_k.cliente_id) then
    perform public._auditar('acesso', 'acesso_negado', 'contratos', p_id::text, v_k.cliente_id, null, null, null,
                            jsonb_build_object('rpc', 'contrato_detalhe'));
    return null;
  end if;

  v_interno := public.is_admin();
  v_nivel := public._contrato_nivel();
  select pr.papel into v_papel from public.profiles pr where pr.id = v_uid;
  v_editor := public.tem_permissao('criar_contrato');
  select * into v_c from public.clientes c where c.id = v_k.cliente_id;
  select * into v_m from public.contrato_modelos m where m.id = v_k.modelo_id;
  v_valor_atual := public._contrato_valor_produto(v_k.unidade_id, v_k.imovel_id);
  v_editavel := v_k.status in ('rascunho', 'documentacao_pendente', 'em_analise');
  v_travado := public._contrato_envio_travado(v_k);
  if v_editavel then
    v_bloqueios := coalesce(public._contrato_bloqueios_envio(v_k), '{}'::text[]);
  end if;
  -- versões da minuta que existem no bucket (o número pode pular: contrato_atualizar_simulacao avança a versão esperada)
  select coalesce(jsonb_agg(x.v order by x.v desc), '[]'::jsonb) into v_versoes
  from (select distinct substring(o.name from '/minuta-v([0-9]{1,6})-[0-9a-f]{8}\.pdf$')::int as v
        from storage.objects o where o.bucket_id = 'contratos' and o.name like p_id::text || '/minuta-v%') x
  where x.v is not null and x.v <= v_k.pdf_versao;

  -- com o envio em andamento nenhum destino manual vale (contrato_mudar_status recusa com ENVIO_EM_ANDAMENTO)
  select coalesce(jsonb_agg(jsonb_build_object('para', t.para, 'exige_motivo', t.exige_motivo,
                                               'validacoes', to_jsonb(t.validacoes), 'efeitos', to_jsonb(t.efeitos))
                            order by array_position(enum_range(null::public.status_contrato), t.para::public.status_contrato)),
                  '[]'::jsonb)
    into v_destinos
  from public.status_transicoes t
  where v_editor and not v_travado and t.entidade = 'contrato' and t.de = v_k.status::text and t.ativa
    and v_papel = any (t.papeis);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'ordem', s.ordem, 'papel', s.papel, 'nome', s.nome,
           'email', case when v_interno or s.papel in ('cliente', 'corretor') then s.email else '' end,
           'ato', s.ato, 'status', s.status, 'assinado_em', s.assinado_em, 'recusado_em', s.recusado_em,
           'motivo', s.motivo) order by s.ordem), '[]'::jsonb)
    into v_sig
  from public.contrato_signatarios s where s.contrato_id = p_id;

  perform public._auditar('acesso', 'consultar', 'contratos', p_id::text, v_k.cliente_id, null, null, null,
                          jsonb_build_object('rpc', 'contrato_detalhe'));
  return jsonb_build_object(
    'id', v_k.id, 'codigo', v_k.codigo, 'tipo', v_k.tipo, 'status', v_k.status, 'forma_pagamento', v_k.forma_pagamento,
    'cliente', jsonb_build_object('id', v_c.id, 'nome', btrim(concat_ws(' ', v_c.nome, nullif(btrim(v_c.sobrenome), ''))),
                                  'email_presente', coalesce(v_c.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', false)),
    'produto', public._contrato_produto_json(v_k.unidade_id, v_k.imovel_id),
    'modelo', jsonb_build_object('id', v_m.id, 'chave', v_m.chave, 'versao', v_m.versao, 'titulo', v_m.titulo,
                                 'revisado_juridico', v_m.revisado_juridico, 'liberado_para_envio', v_m.liberado_para_envio),
    'cadeia', public._contrato_cadeia(v_k.imobiliaria_id, v_k.gerente_id, v_k.corretor_id),
    'parametros_id', v_k.parametros_id,
    'valor_imovel', v_k.valor_imovel, 'perc_aporte', v_k.perc_aporte, 'valor_aporte', v_k.valor_aporte,
    'valor_entrada', v_k.valor_entrada, 'base_parcelada', v_k.base_parcelada, 'valor_restante', v_k.valor_restante,
    'n_parcelas', v_k.n_parcelas, 'taxa_aporte', v_k.taxa_aporte, 'valor_parcela', v_k.valor_parcela,
    'valor_total_parcelas', v_k.valor_total_parcelas, 'valor_minimo_flex', v_k.valor_minimo_flex,
    'valor_produto_alterado', v_valor_atual is distinct from v_k.valor_imovel
  ) || jsonb_build_object(
    'pdf', jsonb_build_object('versao', coalesce(substring(v_k.pdf_path from '/minuta-v([0-9]{1,6})-')::int, 0),
                              'gerado_em', v_k.pdf_gerado_em, 'desatualizado', v_k.pdf_desatualizado,
                              'disponivel', v_k.pdf_path is not null, 'versoes', v_versoes),
    'pdf_assinado_disponivel', v_k.pdf_assinado_path is not null,
    'd4sign_enviado', v_k.d4sign_uuid is not null,
    'envio_em_andamento', v_travado,
    'signatarios', v_sig,
    'bloqueios_envio', to_jsonb(v_bloqueios),
    'destinos_status', v_destinos,
    'permissoes', jsonb_build_object(
      'editar_simulacao', v_editor and v_k.status = 'rascunho' and v_c.inativado_em is null,
      'gerar_pdf', v_editor and v_editavel and not v_travado,
      'enviar_analise', v_k.status in ('rascunho', 'documentacao_pendente')
                        and exists (select 1 from jsonb_array_elements(v_destinos) d where d ->> 'para' = 'em_analise'),
      'enviar_assinatura', v_interno and v_k.status = 'em_analise',
      'cancelar_envio', v_interno and v_k.status = 'assinatura_pendente'
                        and exists (select 1 from jsonb_array_elements(v_destinos) d where d ->> 'para' = 'cancelado'),
      'atualizar_assinatura', v_interno and v_k.status = 'assinatura_pendente',
      'arquivar', exists (select 1 from jsonb_array_elements(v_destinos) d where d ->> 'para' = 'arquivado'),
      'baixar_minuta', v_k.pdf_path is not null,
      'baixar_assinado', v_k.pdf_assinado_path is not null),
    'observacao', v_k.observacao,
    'criado_em', v_k.criado_em,
    'criado_por', public._contrato_ref_perfil(v_k.criado_por, v_nivel),
    'enviado_assinatura_em', v_k.enviado_assinatura_em,
    'enviado_por', case when v_k.enviado_assinatura_em is not null then public._contrato_ref_perfil(v_k.enviado_por, v_nivel) end,
    'assinado_em', v_k.assinado_em,
    'encerrado_em', v_k.encerrado_em);
end $$;

-- P+I com escopo. 'minuta': a versão atual (p_versao nulo) ou uma anterior guardada no bucket; 'assinado': o PDF
-- assinado. Auditoria acesso/baixar e autorização de curta duração (_autorizar_download → Edge baixar-arquivo).
create or replace function public.contrato_baixar(p_id uuid, p_tipo text, p_versao int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_k public.contratos%rowtype;
  v_path text;
begin
  if auth.uid() is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_k from public.contratos k where k.id = p_id;
  if not found or not public.pode_ver_cliente(v_k.cliente_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_tipo = 'minuta' then
    -- a atual: p_versao nulo ou o número do arquivo atual (pdf_versao pode estar à frente dele: ver
    -- contrato_atualizar_simulacao); as anteriores, pelo número do arquivo guardado no bucket
    if p_versao is null or p_versao = substring(v_k.pdf_path from '/minuta-v([0-9]{1,6})-')::int then
      v_path := v_k.pdf_path;
      if v_path is null then
        raise exception 'O PDF deste contrato ainda não foi gerado.' using errcode = 'P0001';
      end if;
    elsif p_versao between 1 and v_k.pdf_versao then
      select o.name into v_path from storage.objects o
      where o.bucket_id = 'contratos'
        and o.name ~ ('^' || p_id::text || '/minuta-v' || p_versao::text || '-[0-9a-f]{8}\.pdf$')
      order by o.created_at desc limit 1;
      if v_path is null then
        raise exception 'Esta versão do PDF não está mais disponível.' using errcode = 'P0001';
      end if;
    else
      raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["versao"]}';
    end if;
  elsif p_tipo = 'assinado' then
    v_path := v_k.pdf_assinado_path;
    if v_path is null then
      raise exception 'O PDF assinado ainda não está disponível.' using errcode = 'P0001';
    end if;
  else
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["tipo"]}';
  end if;

  perform public._auditar('acesso', 'baixar', 'contratos', p_id::text, v_k.cliente_id, null, null, null,
    jsonb_build_object('rpc', 'contrato_baixar', 'tipo', p_tipo,
                       'versao', case when p_tipo = 'minuta' then coalesce(p_versao, v_k.pdf_versao) end));
  return public._autorizar_download('contratos', v_path);
end $$;

-- ============ CONFIGURAÇÃO (Super) ============

-- nova versão de parametros_simulacao, vigente a partir de agora (N14). Chaves exatas de ParametrosPublicacao;
-- percentuais na unidade "%" com até 4 casas, valores com até 2. Auditoria configuracao com antes (vigente) e depois.
create or replace function public.config_publicar_parametros(p jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_chaves constant text[] := array['taxa_aporte_proprio', 'taxa_financeiro', 'juros_ao_mes', 'igpm_atual',
                                    'parcela_minima', 'parcela_maxima', 'valor_minimo', 'valor_minimo_flex'];
  v_invalidos text[] := '{}'::text[];
  v_k text;
  v_num numeric;
  v_antes jsonb;
  v_novo public.parametros_simulacao%rowtype;
begin
  if auth.uid() is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["parametros"]}';
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_invalidos from jsonb_object_keys(p) k where k <> all (v_chaves);
  foreach v_k in array v_chaves loop
    if coalesce(jsonb_typeof(p -> v_k), 'null') = 'null' then
      if v_k in ('taxa_aporte_proprio', 'parcela_minima', 'parcela_maxima') then
        v_invalidos := v_invalidos || v_k;
      end if;
      continue;
    end if;
    if jsonb_typeof(p -> v_k) <> 'number' then
      v_invalidos := v_invalidos || v_k;
      continue;
    end if;
    v_num := (p ->> v_k)::numeric;
    if not (case
              when v_k in ('taxa_aporte_proprio', 'taxa_financeiro', 'juros_ao_mes')
                then v_num between 0 and 100 and v_num = round(v_num, 4)
              when v_k = 'igpm_atual' then v_num between -100 and 100 and v_num = round(v_num, 4)
              when v_k in ('parcela_minima', 'parcela_maxima') then v_num between 1 and 600 and v_num = trunc(v_num)
              else v_num > 0 and v_num < 1000000000000 and v_num = round(v_num, 2)
            end) then
      v_invalidos := v_invalidos || v_k;
    end if;
  end loop;
  if cardinality(v_invalidos) = 0 and (p ->> 'parcela_maxima')::numeric < (p ->> 'parcela_minima')::numeric then
    v_invalidos := v_invalidos || 'parcela_maxima'::text;
  end if;
  if cardinality(v_invalidos) > 0 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', to_jsonb(v_invalidos))::text;
  end if;

  select to_jsonb(x) - 'criado_por' - 'criado_em' into v_antes
  from public.parametros_simulacao x where x.id = public.parametros_vigente_id();
  insert into public.parametros_simulacao (taxa_aporte_proprio, taxa_financeiro, juros_ao_mes, igpm_atual,
                                           parcela_minima, parcela_maxima, valor_minimo, valor_minimo_flex)
  values ((p ->> 'taxa_aporte_proprio')::numeric, (p ->> 'taxa_financeiro')::numeric, (p ->> 'juros_ao_mes')::numeric,
          (p ->> 'igpm_atual')::numeric, (p ->> 'parcela_minima')::numeric::int, (p ->> 'parcela_maxima')::numeric::int,
          (p ->> 'valor_minimo')::numeric, (p ->> 'valor_minimo_flex')::numeric)
  returning * into v_novo;
  perform public._auditar('configuracao', 'publicar', 'parametros_simulacao', v_novo.id::text, null,
    array['taxa_aporte_proprio', 'taxa_financeiro', 'juros_ao_mes', 'igpm_atual', 'parcela_minima', 'parcela_maxima',
          'valor_minimo', 'valor_minimo_flex'],
    v_antes, to_jsonb(v_novo) - 'criado_por' - 'criado_em', jsonb_build_object('rpc', 'config_publicar_parametros'));
end $$;

-- nova versão de um modelo (marcação restrita "marcacao_v1", nunca HTML). O gatilho da 07 extrai e valida as
-- variáveis (DADOS_INVALIDOS {variaveis_invalidas} ou {motivo:'chaves_sem_par'}). A versão nova nasce NÃO liberada.
create or replace function public.config_publicar_modelo(p_chave public.modelo_chave, p_titulo text, p_conteudo text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_conteudo text := replace(replace(coalesce(p_conteudo, ''), E'\r\n', E'\n'), E'\r', E'\n');
  v_invalidos text[] := '{}'::text[];
  v_versao int;
  v_m public.contrato_modelos%rowtype;
begin
  if auth.uid() is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_chave is null then v_invalidos := v_invalidos || 'chave'::text; end if;
  if length(v_titulo) not between 3 and 200 then v_invalidos := v_invalidos || 'titulo'::text; end if;
  if length(btrim(v_conteudo)) not between 20 and 200000 then v_invalidos := v_invalidos || 'conteudo'::text; end if;
  if cardinality(v_invalidos) > 0 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', to_jsonb(v_invalidos))::text;
  end if;
  -- a marcação é própria (§6.3): etiqueta HTML não é aceita (seria exibida como texto no contrato)
  if v_conteudo ~* '<\s*/?\s*(html|head|body|p|div|span|br|hr|b|i|u|strong|em|h[1-6]|ul|ol|li|table|tr|td|th|a|img|script|style|iframe)\y' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"html_nao_permitido"}';
  end if;

  perform pg_advisory_xact_lock(hashtext('contrato_modelos:' || p_chave::text));
  select coalesce(max(m.versao), 0) + 1 into v_versao from public.contrato_modelos m where m.chave = p_chave;
  insert into public.contrato_modelos (chave, versao, titulo, conteudo)
  values (p_chave, v_versao, v_titulo, v_conteudo)
  returning * into v_m;
  perform public._auditar('configuracao', 'publicar', 'contrato_modelos', v_m.id::text, null,
    array['chave', 'versao', 'titulo', 'conteudo', 'variaveis'], null,
    jsonb_build_object('chave', v_m.chave, 'versao', v_m.versao, 'variaveis', to_jsonb(v_m.variaveis)),
    jsonb_build_object('rpc', 'config_publicar_modelo'));
  return v_m.id;
end $$;

-- libera a versão VIGENTE de um modelo de aquisição para envio, registrando a revisão jurídica (confirmação
-- obrigatória). Modelos de serviço são só pré-visualização (D6). Idempotente.
create or replace function public.config_liberar_modelo(p_id uuid, p_revisado_juridico boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_m public.contrato_modelos%rowtype;
begin
  if v_uid is null or p_id is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_revisado_juridico is not true then
    raise exception 'Confirme a revisão jurídica para liberar o modelo para envio.' using errcode = 'P0001';
  end if;
  select * into v_m from public.contrato_modelos m where m.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_m.chave in ('servico_corretor', 'servico_imobiliaria') then
    raise exception 'Modelos de prestação de serviço são só para pré-visualização e não são liberados para envio.'
      using errcode = 'P0001';
  end if;
  if v_m.id <> public.modelo_vigente_id(v_m.chave) then
    raise exception 'Só a versão vigente do modelo pode ser liberada.' using errcode = 'P0001';
  end if;
  if v_m.liberado_para_envio then
    return;
  end if;
  update public.contrato_modelos m
     set liberado_para_envio = true, revisado_juridico = true, liberado_em = now(), liberado_por = v_uid
   where m.id = p_id;
  perform public._auditar('configuracao', 'liberar', 'contrato_modelos', p_id::text, null,
    array['liberado_para_envio', 'revisado_juridico', 'liberado_em', 'liberado_por'],
    jsonb_build_object('liberado_para_envio', false, 'revisado_juridico', v_m.revisado_juridico),
    jsonb_build_object('liberado_para_envio', true, 'revisado_juridico', true),
    jsonb_build_object('rpc', 'config_liberar_modelo', 'chave', v_m.chave, 'versao', v_m.versao));
end $$;

-- ============ GRANTS ============
-- As RPCs acima mantêm os grants da 09 (create or replace). As internas novas: ninguém executa pela API.
revoke execute on function
  public._contrato_pode_operar(), public._contrato_nivel(), public._contrato_nome_perfil(uuid, int),
  public._contrato_ref_perfil(uuid, int), public._contrato_cadeia(uuid, uuid, uuid),
  public._contrato_produto_json(uuid, uuid), public._contrato_valor_produto(uuid, uuid),
  public._contrato_produto_ler(jsonb, boolean),
  public._contrato_calcular(public.forma_pagamento, numeric, numeric, numeric, int),
  public._contrato_valores_json(public.contratos), public._contrato_rotulo(bigint),
  public._contrato_destinatarios(public.contratos), public._contrato_cancelamento_d4sign(uuid, interval),
  public._contrato_envio_travado(public.contratos), public._contrato_atos_obrigatorios_ok(uuid),
  public._contrato_bloqueios_envio(public.contratos)
  from public, anon, authenticated, service_role;

-- RPC de sistema nova (WP4R-01): só a service role (Edge contrato-assinatura), como as contrato_registrar_*
revoke execute on function public.contrato_confirmar_envio(uuid, text) from public, anon, authenticated;
grant execute on function public.contrato_confirmar_envio(uuid, text) to service_role;
