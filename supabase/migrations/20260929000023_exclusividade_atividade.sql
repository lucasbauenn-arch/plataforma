-- Exclusividade do cliente por ATIVIDADE (decisão do dono, 29/09/2026; substitui a A2 provisória).
-- 1. O prazo (clientes.exclusividade_ate) é de 180 dias SEM atividade: renova para agora + exclusividade_dias a cada
--    atividade da equipe ou do parceiro com o cliente (cadastro, pré-cadastro, etapa, nota, tarefa criada/concluída,
--    documento solicitado/enviado/analisado, proposta, contrato, transferência). O gatilho fica em cliente_eventos
--    (toda atividade da timeline passa por _evento_cliente), então nenhuma RPC precisa lembrar de renovar. Não renovam:
--    o próprio titular pelo portal (ator com papel 'cliente'), a tentativa de cadastro duplicado (senão a tentativa de
--    OUTRO parceiro renovaria o dono), consentimento e migração.
-- 2. Depois do prazo, quando outro parceiro cadastra o mesmo CPF/CNPJ (crm_cadastrar_cliente, ou o pré-cadastro pelo
--    link dele), o cliente PASSA para esse parceiro, pela mesma lógica de rede_transferir_clientes
--    (_rede_mover_clientes: cadeia pelo gatilho, histórico de vínculo com o motivo 'exclusividade vencida', timeline
--    'transferencia' e auditoria operacao/transferir). A tentativa fica em cliente_duplicidades já resolvida
--    ('transferido_exclusividade'), o antigo dono recebe a notificação crm.exclusividade_transferida (sem dado pessoal)
--    e quem cadastrou recebe {situacao:'transferido', id}.
--    NÃO é tomado (vira aviso, e o caso segue para a fila de Duplicidades): cliente com contrato ativo (rascunho até
--    assinado), cliente do portal (origem portal_admin, portal liberado ou com login do portal), inativo, anonimizado
--    ou sem prazo registrado (exclusividade_ate nula: caminho conservador).
-- 3. Mensagem de CPF dentro da exclusividade de OUTRO parceiro: a resposta 'indisponivel' ganha exclusividade_ate
--    (só quando o motivo é o prazo; nunca o dono). O limite por hora (LIMITE_DUPLICIDADE) e o registro em
--    cliente_duplicidades continuam.
-- Mesmas assinaturas (create or replace); nenhuma referência a objeto de migration posterior.

-- ============ CONFIGURAÇÃO ============
alter table public.configuracao_geral alter column exclusividade_dias set default 180;
update public.configuracao_geral set exclusividade_dias = 180 where exclusividade_dias is distinct from 180;

-- tentativa que virou transferência automática (já resolvida)
alter table public.cliente_duplicidades drop constraint cliente_duplicidades_resultado_check;
alter table public.cliente_duplicidades add constraint cliente_duplicidades_resultado_check
  check (resultado in ('bloqueado_exclusividade', 'bloqueado_contrato', 'bloqueado_pos_prazo', 'mesmo_dono',
                       'transferido_exclusividade'));

-- aviso ao antigo dono (ligado: pedido do dono). Só ids na fila; o e-mail não traz o nome do cliente.
insert into public.notificacoes_config (tipo, ativo, descricao) values
  ('crm.exclusividade_transferida', true,
   'Aviso ao corretor de que um cliente da carteira passou para outro parceiro (exclusividade vencida)')
on conflict (tipo) do nothing;

-- ============ 1. RENOVAÇÃO POR ATIVIDADE ============
-- tipos da timeline que contam como atividade com o cliente
create function public._exclusividade_tipos_atividade() returns text[]
language sql immutable set search_path = '' as $$
  select array['cadastro', 'pre_cadastro', 'etapa', 'nota', 'tarefa_criada', 'tarefa_concluida', 'documento_solicitado',
               'documento_enviado', 'documento_analisado', 'contrato_gerado', 'contrato_enviado', 'contrato_assinado',
               'contrato_encerrado', 'transferencia', 'proposta_enviada', 'proposta_respondida']::text[]
$$;

-- AFTER INSERT em cliente_eventos. Ator nulo = sistema (webhook do D4Sign, pré-cadastro, efeitos): conta, porque é
-- atividade do atendimento. Ator com papel 'cliente' (o titular pelo portal) não conta. Nunca encurta o prazo.
create function public._exclusividade_renovar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (new.tipo = any (public._exclusividade_tipos_atividade())) then
    return null;
  end if;
  if new.ator_id is not null and (
       exists (select 1 from public.profiles pr where pr.id = new.ator_id and pr.papel = 'cliente')
       or exists (select 1 from public.clientes c where c.id = new.cliente_id and c.user_id = new.ator_id)) then
    return null;
  end if;
  update public.clientes c
     set exclusividade_ate = now() + make_interval(days => (select g.exclusividade_dias from public.configuracao_geral g))
   where c.id = new.cliente_id and c.anonimizado_em is null
     and (c.exclusividade_ate is null
          or c.exclusividade_ate < now() + make_interval(days => (select g.exclusividade_dias from public.configuracao_geral g)));
  return null;
end $$;

create trigger exclusividade_renovar after insert on public.cliente_eventos
  for each row execute function public._exclusividade_renovar();

-- recálculo pela regra nova: última atividade (da equipe/parceiro) + 180 dias; nunca encurta o prazo de hoje. Sem
-- atividade registrada, vale o cadastro. Os clientes do portal antigo (sem prazo) ganham prazo, mas continuam
-- protegidos pela regra do item 2.
with atividade as (
  select e.cliente_id, max(e.ocorrido_em) as ultima
  from public.cliente_eventos e
  left join public.profiles pr on pr.id = e.ator_id
  where e.tipo = any (public._exclusividade_tipos_atividade()) and pr.papel is distinct from 'cliente'
  group by e.cliente_id
), prazo as (
  select c.id, greatest(c.created_at, coalesce(a.ultima, c.created_at)) + make_interval(days => g.exclusividade_dias) as novo
  from public.clientes c
  cross join public.configuracao_geral g
  left join atividade a on a.cliente_id = c.id
  where c.anonimizado_em is null
)
update public.clientes c
   set exclusividade_ate = p.novo
  from prazo p
 where p.id = c.id and (c.exclusividade_ate is null or c.exclusividade_ate < p.novo);

-- ============ 2. TRANSFERÊNCIA DEPOIS DO PRAZO ============
-- O cliente pode ser tomado por p_destino? (quem chama já travou a linha). Prazo vencido e registrado; ativo; sem
-- contrato ativo (rascunho até assinado); não é do portal (origem portal_admin, portal liberado ou login do portal).
create function public._exclusividade_livre(p_cliente_id uuid, p_destino uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clientes c
    where c.id = p_cliente_id and p_destino is not null
      and c.exclusividade_ate is not null and c.exclusividade_ate <= now()
      and c.inativado_em is null and c.anonimizado_em is null
      and c.origem <> 'portal_admin' and not c.portal_liberado and c.user_id is null
      and c.corretor_id is distinct from p_destino
      and not exists (select 1 from public.contratos k where k.cliente_id = c.id
                        and k.status in ('rascunho', 'documentacao_pendente', 'em_analise', 'assinatura_pendente', 'assinado')))
$$;

-- Transfere para p_destino se a exclusividade venceu (confere de novo com a linha travada). Mesma lógica de
-- rede_transferir_clientes (_rede_mover_clientes), motivo 'exclusividade vencida'; tentativa registrada já resolvida;
-- antigo dono avisado (crm.exclusividade_transferida); novo responsável avisado como cliente novo na carteira (se não
-- foi ele quem cadastrou). Devolve true se transferiu.
create function public._exclusividade_transferir(p_cliente_id uuid, p_destino uuid, p_origem public.origem_cliente,
                                                 p_rpc text, p_origem_auditoria text default 'rpc')
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  c_motivo constant text := 'exclusividade vencida';
  v_de uuid;
  v_perfil_de uuid;
  v_n int;
  v_dup uuid;
begin
  -- conferência sem trava primeiro (o caso comum, dentro do prazo, não trava a linha do dono); depois, com a linha
  -- travada, de novo (uma atividade concorrente pode ter renovado o prazo)
  if not public._exclusividade_livre(p_cliente_id, p_destino) then
    return false;
  end if;
  select c.corretor_id into v_de from public.clientes c where c.id = p_cliente_id for update;
  if not found or not public._exclusividade_livre(p_cliente_id, p_destino) then
    return false;
  end if;
  v_n := public._rede_mover_clientes(array[p_cliente_id], p_destino, c_motivo);
  perform set_config('arken.motivo_vinculo', '', true);
  if v_n <> 1 then
    return false;
  end if;

  insert into public.cliente_duplicidades (cliente_id, tentado_por, tentado_por_parceiro_id, origem, resultado,
                                           resolvido_em, decisao, motivo_decisao)
  values (p_cliente_id, auth.uid(), p_destino, p_origem, 'transferido_exclusividade', now(), 'transferir', c_motivo)
  returning id into v_dup;
  perform public._auditar('operacao', 'tentativa_duplicada', 'cliente_duplicidades', v_dup::text, p_cliente_id, null, null,
    null, jsonb_build_object('rpc', p_rpc, 'resultado', 'transferido_exclusividade', 'origem', p_origem,
                             'de_corretor_id', v_de, 'para_corretor_id', p_destino, 'motivo', c_motivo),
    p_origem_auditoria);

  select p.profile_id into v_perfil_de from public.parceiros p where p.id = v_de;
  if v_perfil_de is not null then
    perform public._notificar('crm.exclusividade_transferida', array[v_perfil_de], p_cliente_id,
                              jsonb_build_object('quantidade', 1));
  end if;
  perform public._crmcad_avisar_corretor(p_cliente_id, p_destino, p_origem);
  return true;
end $$;

-- ============ 3. CADASTRO (núcleo de crm_cadastrar_cliente e leads_converter) ============
-- Igual à 11, mais: documento de outro dono com a exclusividade vencida → transferência (item 2); dentro do prazo, a
-- resposta 'indisponivel' traz exclusividade_ate (nunca o dono). O interno vê tudo (pode_ver_cliente): nunca transfere
-- por aqui, recebe 'ja_na_sua_carteira'.
create or replace function public._crmcad_cadastrar(p_dados jsonb, p_corretor_id uuid, p_termo_id uuid,
                                                    p_origem public.origem_cliente, p_rpc text)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_dados jsonb := public._crmcad_objeto(p_dados, 'p_dados');
  v_tipo_txt text := public._crmcad_txt(v_dados, 'tipo_pessoa');
  v_tipo public.tipo_pessoa;
  v_n jsonb;
  v_corretor uuid;
  v_doc text;
  v_existe uuid;
  v_mesmo boolean;
  v_res text;
  v_id uuid;
  v_cli public.clientes%rowtype;
begin
  if v_tipo_txt is null or v_tipo_txt not in ('fisica', 'juridica') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["tipo_pessoa"]}';
  end if;
  v_tipo := v_tipo_txt::public.tipo_pessoa;
  v_n := public._crmcad_normalizar(v_dados, v_tipo, true, '{}');
  v_corretor := public._crmcad_resolver_corretor(p_corretor_id);
  if p_termo_id is null or p_termo_id is distinct from public._termo_vigente_id('consentimento_cliente') then
    raise exception 'TERMO_DESATUALIZADO' using errcode = 'P0001';
  end if;
  -- antes de olhar o documento: depois do limite, nenhuma resposta revela se o CPF existe
  if public._crmcad_limite_excedido() then
    raise exception 'LIMITE_DUPLICIDADE' using errcode = 'P0001';
  end if;

  v_doc := coalesce(v_n ->> 'cpf', v_n ->> 'cnpj');
  v_existe := public._crmcad_travar_documento(v_tipo, v_doc);
  if v_existe is not null then
    v_mesmo := public.pode_ver_cliente(v_existe);
    if not v_mesmo and public._exclusividade_transferir(v_existe, v_corretor, p_origem, p_rpc) then
      return jsonb_build_object('situacao', 'transferido', 'id', v_existe);
    end if;
    v_res := public._crmcad_registrar_tentativa(v_existe, v_corretor, p_origem, v_mesmo);
    perform public._auditar('operacao', 'tentativa_duplicada', 'cliente_duplicidades', null, v_existe, null, null, null,
      jsonb_build_object('rpc', p_rpc, 'resultado', v_res, 'origem', p_origem));
    if v_mesmo then
      return jsonb_build_object('situacao', 'ja_na_sua_carteira', 'id', v_existe);
    end if;
    -- a data só quando o motivo é o prazo (com contrato ou do portal a data enganaria: o cliente não fica livre)
    return jsonb_build_object('situacao', 'indisponivel', 'id', null)
      || case when v_res = 'bloqueado_exclusividade'
              then jsonb_build_object('exclusividade_ate',
                                      (select c.exclusividade_ate from public.clientes c where c.id = v_existe))
              else '{}'::jsonb end;
  end if;

  v_id := public._crmcad_inserir(v_n, v_tipo, v_corretor, p_origem, false);
  insert into public.lgpd_consentimentos (titular, cliente_id, termo_id, origem, registrado_por)
  values ('cliente', v_id, p_termo_id, 'declarado', v_uid);

  perform public._evento_cliente(v_id, 'cadastro', 'Cliente cadastrado', jsonb_build_object('origem', p_origem));
  perform public._evento_cliente(v_id, 'consentimento', 'Consentimento LGPD registrado (declarado)',
                                 jsonb_build_object('termo_id', p_termo_id, 'origem', 'declarado'));
  select * into v_cli from public.clientes c where c.id = v_id;
  perform public._auditar('operacao', 'criar', 'clientes', v_id::text, v_id,
    public._crmcad_campos_preenchidos(v_n) || array['tipo_pessoa'], null,
    jsonb_build_object('etapa', v_cli.etapa, 'origem', v_cli.origem, 'portal_liberado', v_cli.portal_liberado,
                       'corretor_id', v_cli.corretor_id, 'gerente_id', v_cli.gerente_id, 'imobiliaria_id', v_cli.imobiliaria_id),
    jsonb_build_object('rpc', p_rpc, 'termo_id', p_termo_id));
  perform public._crmcad_avisar_corretor(v_id, v_corretor, p_origem);
  return jsonb_build_object('situacao', 'criado', 'id', v_id);
end $$;

-- ============ 4. PRÉ-CADASTRO PELO LINK (service_role) ============
-- Igual à 11, mais a transferência do item 2 para o dono do link. A resposta ao visitante não muda ('duplicado': a
-- Edge responde igual a 'criado'), nem a confirmação por e-mail (os dois caminhos).
create or replace function public.crm_pre_cadastro(p_codigo text, p_dados jsonb, p_termo_id uuid, p_ip inet, p_user_agent text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cod text := lower(btrim(coalesce(p_codigo, '')));
  v_parc public.parceiros%rowtype;
  v_termo public.lgpd_termos%rowtype;
  v_dados jsonb := public._crmcad_objeto(p_dados, 'p_dados');
  v_tipo_txt text := public._crmcad_txt(v_dados, 'tipo_pessoa');
  v_tipo public.tipo_pessoa;
  v_doc text;
  v_entrada jsonb;
  v_n jsonb;
  v_existe uuid;
  v_mesmo boolean;
  v_res text;
  v_portal boolean;
  v_id uuid;
  v_docs int;
begin
  if v_cod !~ '^[a-z2-7]{10}$' then
    return jsonb_build_object('situacao', 'codigo_invalido');
  end if;
  select p.* into v_parc from public.parceiros p where p.codigo_indicacao = v_cod;
  if not found or not public._crmcad_pode_receber(v_parc.id) then
    return jsonb_build_object('situacao', 'codigo_invalido');
  end if;
  select * into v_termo from public.lgpd_termos t where t.id = public._termo_vigente_id('consentimento_cliente');
  if not found or not v_termo.revisado_juridico then
    return jsonb_build_object('situacao', 'termo_invalido');
  end if;
  if p_termo_id is distinct from v_termo.id then
    return jsonb_build_object('situacao', 'termo_desatualizado');
  end if;

  if v_tipo_txt is null or v_tipo_txt not in ('fisica', 'juridica') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["tipo_pessoa"]}';
  end if;
  v_tipo := v_tipo_txt::public.tipo_pessoa;
  v_doc := public._crmcad_txt(v_dados, 'documento');
  v_entrada := jsonb_build_object(
    'nome', v_dados -> 'nome', 'sobrenome', case when v_tipo = 'fisica' then v_dados -> 'sobrenome' end,
    'cpf', case when v_tipo = 'fisica' then to_jsonb(v_doc) end, 'cnpj', case when v_tipo = 'juridica' then to_jsonb(v_doc) end,
    'email', v_dados -> 'email', 'telefone', v_dados -> 'telefone');
  v_n := public._crmcad_normalizar(v_entrada, v_tipo, true, '{}');
  if v_n ->> 'telefone' is null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["telefone"]}';
  end if;
  -- antes de olhar o documento: acima do limite, nenhuma resposta revela se o CPF existe
  if public._crmcad_limite_link_excedido(v_parc.id) then
    return jsonb_build_object('situacao', 'limite');
  end if;
  -- portal conforme a configuração (só PF), calculado igual nos dois caminhos (vai para o aviso)
  v_portal := v_tipo = 'fisica' and coalesce((select c.portal_libera_pre_cadastro from public.configuracao_geral c), false);

  v_existe := public._crmcad_travar_documento(v_tipo, coalesce(v_n ->> 'cpf', v_n ->> 'cnpj'));
  if v_existe is not null then
    v_mesmo := exists (select 1 from public.clientes c where c.id = v_existe and c.corretor_id = v_parc.id);
    if not v_mesmo and public._exclusividade_transferir(v_existe, v_parc.id, 'pre_cadastro_link', 'crm_pre_cadastro',
                                                         'edge:pre-cadastro') then
      perform public._crmcad_aviso_pre_cadastro(v_n, v_parc.id, v_portal);
      return jsonb_build_object('situacao', 'duplicado');
    end if;
    v_res := public._crmcad_registrar_tentativa(v_existe, v_parc.id, 'pre_cadastro_link', v_mesmo);
    perform public._auditar('operacao', 'tentativa_duplicada', 'cliente_duplicidades', null, v_existe, null, null, null,
      jsonb_build_object('rpc', 'crm_pre_cadastro', 'resultado', v_res, 'parceiro_id', v_parc.id), 'edge:pre-cadastro');
    perform public._crmcad_aviso_pre_cadastro(v_n, v_parc.id, v_portal);
    return jsonb_build_object('situacao', 'duplicado');
  end if;

  v_id := public._crmcad_inserir(v_n, v_tipo, v_parc.id, 'pre_cadastro_link', v_portal);
  insert into public.lgpd_consentimentos (titular, cliente_id, termo_id, origem, ip, user_agent)
  values ('cliente', v_id, v_termo.id, 'pre_cadastro_link', p_ip, left(nullif(btrim(coalesce(p_user_agent, '')), ''), 500));

  perform public._evento_cliente(v_id, 'pre_cadastro', 'Pré-cadastro pelo link de indicação',
                                 jsonb_build_object('corretor_id', v_parc.id));
  perform public._evento_cliente(v_id, 'consentimento', 'Consentimento LGPD aceito no pré-cadastro',
                                 jsonb_build_object('termo_id', v_termo.id, 'origem', 'pre_cadastro_link'));
  v_docs := public._crm_solicitar_documentos_basicos(v_id);
  -- o e-mail de documentos solicitados iria para o endereço digitado só no caminho criado (canal lateral, §6.1): fica
  -- registrado como ignorado, antes do commit (a Edge notificar só envia linha 'pendente' ou 'erro')
  update public.notificacoes n
     set status = 'ignorado', ultimo_erro = 'pré-cadastro: sem e-mail de documentos na criação (resposta igual, §6.1)'
   where n.cliente_id = v_id and n.tipo = 'crm.documento_solicitado' and n.status = 'pendente';
  perform public._auditar('operacao', 'criar', 'clientes', v_id::text, v_id,
    public._crmcad_campos_preenchidos(v_n) || array['tipo_pessoa'], null,
    (select jsonb_build_object('etapa', c.etapa, 'origem', c.origem, 'portal_liberado', c.portal_liberado,
                               'corretor_id', c.corretor_id, 'gerente_id', c.gerente_id, 'imobiliaria_id', c.imobiliaria_id)
     from public.clientes c where c.id = v_id),
    jsonb_build_object('rpc', 'crm_pre_cadastro', 'termo_id', v_termo.id, 'documentos_solicitados', v_docs),
    'edge:pre-cadastro');
  perform public._crmcad_avisar_corretor(v_id, v_parc.id, 'pre_cadastro_link');
  perform public._crmcad_aviso_pre_cadastro(v_n, v_parc.id, v_portal);
  return jsonb_build_object('situacao', 'criado');
end $$;

-- ============ 5. FILA DE DUPLICIDADES: filtro pelo resultado novo ============
create or replace function public.crm_duplicidades_listar(p_filtros jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_f jsonb := public._crmcad_objeto(p_filtros, 'p_filtros');
  v_pend boolean := public._crmcad_filtro_bool(v_f, 'pendentes');
  v_res text := public._crmcad_filtro_opcao(v_f, 'resultado',
                  array['bloqueado_exclusividade', 'bloqueado_contrato', 'bloqueado_pos_prazo', 'mesmo_dono',
                        'transferido_exclusividade']);
  v_lim int := least(greatest(coalesce(public._crmcad_filtro_int(v_f, 'limite'), 50), 1), 200);
  v_off int := coalesce(public._crmcad_filtro_int(v_f, 'offset'), 0);
  v_total int;
  v_itens jsonb;
  v_ids uuid[];
  v_clientes uuid[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  with base as (
    select d.* from public.cliente_duplicidades d
    where (v_pend is null or (v_pend and d.resolvido_em is null) or (not v_pend and d.resolvido_em is not null))
      and (v_res is null or d.resultado = v_res)
  ), pagina as (
    select b.* from base b order by (b.resolvido_em is null) desc, b.ocorrido_em desc, b.id limit v_lim offset v_off
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'cliente', jsonb_build_object(
                'id', c.id, 'nome', btrim(c.nome || ' ' || coalesce(c.sobrenome, '')), 'etapa', c.etapa,
                'corretor', jsonb_build_object('id', cor.id, 'nome', cor.nome),
                'imobiliaria', jsonb_build_object('id', im.id, 'nome', im.nome),
                'exclusividade_ate', c.exclusividade_ate),
             'tentado_por', case when p.tentado_por is not null then jsonb_build_object(
                'profile_id', pr.id, 'nome', coalesce(nullif(btrim(pr.nome), ''), 'Sem nome'), 'papel', pr.papel) end,
             'tentado_por_parceiro', case when tp.id is not null then jsonb_build_object(
                'id', tp.id, 'nome', tp.nome, 'tipo', tp.tipo,
                'imobiliaria', (select jsonb_build_object('id', i2.id, 'nome', i2.nome) from public.imobiliarias i2
                                where i2.id = tp.imobiliaria_id)) end,
             'origem', p.origem, 'resultado', p.resultado, 'ocorrido_em', p.ocorrido_em,
             'resolvido_em', p.resolvido_em,
             'resolvido_por', (select jsonb_build_object('id', r.id, 'nome', coalesce(nullif(btrim(r.nome), ''), 'Sem nome'))
                               from public.profiles r where r.id = p.resolvido_por),
             'decisao', p.decisao, 'motivo_decisao', p.motivo_decisao,
             'pode_transferir', p.resolvido_em is null and p.resultado <> 'mesmo_dono' and tp.id is not null
                                and c.inativado_em is null and c.anonimizado_em is null
                                and (c.exclusividade_ate is null or c.exclusividade_ate <= now())
                                and c.corretor_id is distinct from tp.id and public._crmcad_pode_receber(tp.id))
             order by (p.resolvido_em is null) desc, p.ocorrido_em desc, p.id)
           from pagina p
           join public.clientes c on c.id = p.cliente_id
           left join public.parceiros cor on cor.id = c.corretor_id
           left join public.imobiliarias im on im.id = c.imobiliaria_id
           left join public.profiles pr on pr.id = p.tentado_por
           left join public.parceiros tp on tp.id = p.tentado_por_parceiro_id), '[]'::jsonb),
         coalesce((select array_agg(p.id) from pagina p), '{}'::uuid[]),
         coalesce((select array_agg(distinct p.cliente_id) from pagina p), '{}'::uuid[])
    into v_total, v_itens, v_ids, v_clientes;

  perform public._auditar('acesso', 'listar', 'cliente_duplicidades', null, null, null, null, null,
    jsonb_build_object('rpc', 'crm_duplicidades_listar', 'ids', to_jsonb(v_ids), 'clientes', to_jsonb(v_clientes),
                       'total', v_total, 'filtros', jsonb_strip_nulls(jsonb_build_object('pendentes', v_pend, 'resultado', v_res))));
  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

-- ============ GRANTS ============
-- As RPCs acima mantêm os grants anteriores (create or replace). As internas novas: ninguém executa pela API.
revoke execute on function
  public._exclusividade_tipos_atividade(), public._exclusividade_renovar(), public._exclusividade_livre(uuid, uuid),
  public._exclusividade_transferir(uuid, uuid, public.origem_cliente, text, text)
  from public, anon, authenticated, service_role;
