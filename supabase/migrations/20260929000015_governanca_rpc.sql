-- Governança, LGPD, portal do cliente, painel e tarefas do pg_cron: corpos das RPCs [WP6]
-- (docs/ARQUITETURA_EXPANSAO.md §1.1 H1–H5, §1.2 N1, N2, N9, N10, N20, §3.9, §4.4 "Governança, portal,
-- configuração", §5, §6.6, §6.7, §8.5).
-- Troca os corpos dos esqueletos da 20260929000009 com create or replace, com a MESMA assinatura (o que preserva dono e
-- grants: usuário → authenticated; lgpd_termo_vigente → anon também; portal_localizar_cliente → só service_role;
-- tarefas do pg_cron → ninguém). Aditivo: a coluna notificacoes.reservado_em e quatro funções internas (prefixo _, sem
-- grant): _requisicao_ip, _requisicao_agente, _portal_cliente_id e _lgpd_caminhos_cliente.
--
-- Regras comuns (§4.4, §4.6):
-- - security definer ignora a RLS: o papel e o escopo são conferidos aqui, explicitamente (is_admin / is_super já
--   exigem aal2 quando configuracao_geral.exigir_mfa_interno está ligada, H5);
-- - escrita sem acesso ou registro inexistente: 42501 'Sem acesso a este registro' (mesma mensagem nos dois casos);
--   leitura sem acesso: devolve nulo (ou lista vazia) e GRAVA acesso_negado — um raise desfaria o registro;
-- - toda leitura de dado pessoal e toda escrita gravam _auditar na mesma transação; o log guarda só NOMES de campos,
--   ids, códigos e contagens (nunca CPF, e-mail, telefone, nome ou texto livre);
-- - timeline do cliente (_evento_cliente) só com ids, status e origem.
--
-- Portal (N1): o titular só chega aos PRÓPRIOS dados, por _portal_cliente_id() = meu_cliente_id() (portal liberado,
-- não inativado, não anonimizado) de pessoa física com CPF. Nenhuma RPC do portal recebe id de cliente. Documentos
-- pessoais: só envio (o titular não baixa); contratos: só a partir de assinatura_pendente; download: só o PDF
-- assinado. Negócios, arquivos e obra continuam pelas tabelas antigas (políticas reescritas na 09).

-- ============ ADITIVO: reserva na fila de notificações (§6.6) ============
-- A Edge notificar reserva a linha antes de enviar: incrementa `tentativas` comparando com o valor lido e grava
-- reservado_em; a reserva só é aceita se não houver outra nos últimos 5 minutos. Assim o disparo do gatilho e o
-- reenvio do pg_cron nunca mandam o mesmo e-mail duas vezes, e uma reserva abandonada (função caiu) volta para a fila.
alter table public.notificacoes add column reservado_em timestamptz;
create index notificacoes_reenvio_idx on public.notificacoes (criado_em)
  where status in ('pendente', 'erro') and tentativas < 5;

-- ============ INTERNAS ============
-- IP e navegador de quem chamou (cabeçalhos do PostgREST), como em _auditar. Para o registro de consentimento.
create function public._requisicao_ip() returns inet
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cab jsonb;
begin
  v_cab := nullif(current_setting('request.headers', true), '')::jsonb;
  return nullif(btrim(split_part(coalesce(v_cab ->> 'cf-connecting-ip', v_cab ->> 'x-real-ip',
                                          v_cab ->> 'x-forwarded-for'), ',', 1)), '')::inet;
exception when others then
  return null;
end $$;

create function public._requisicao_agente() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  return left(nullif(btrim(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent'), ''), 500);
exception when others then
  return null;
end $$;

-- Cliente do portal de quem chamou: meu_cliente_id() (portal liberado, não inativado, não anonimizado) de pessoa
-- física com CPF (o login do portal é só por CPF). Nulo para qualquer outro usuário.
create function public._portal_cliente_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clientes c
  where c.id = public.meu_cliente_id() and c.tipo_pessoa = 'fisica' and c.cpf is not null
$$;

-- Caminhos a apagar no Storage na anonimização (§5.5, WP6R-02): os registrados em cliente_documento_arquivos e TODO
-- objeto que exista sob <cliente_id>/ no bucket crm-documentos. O envio sobe o objeto antes de
-- crm_documento_registrar_envio; se o registro for recusado (tamanho, tipo, documento que deixou de aguardar envio,
-- queda de rede), o objeto fica sem linha e só aparece aqui. Ler storage.objects por SQL é permitido; apagar é só pela
-- API do Storage (na Edge lgpd-anonimizar). Nomes comparados sem caixa (a Edge confere o 1º segmento da mesma forma).
create function public._lgpd_caminhos_cliente(p_cliente_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(x.path order by x.path collate "C"), '{}')
  from (select a.storage_path as path
        from public.cliente_documento_arquivos a join public.cliente_documentos d on d.id = a.documento_id
        where d.cliente_id = p_cliente_id
        union
        select o.name from storage.objects o
        where o.bucket_id = 'crm-documentos' and lower(o.name) like p_cliente_id::text || '/%') x
$$;

-- [WP7R1-03] Caminhos a apagar no bucket cliente-arquivos (portal antigo: contratos, boletos e plantas do cliente, gravados
-- pela equipe em cliente_arquivos): os registrados e TODO objeto sob <cliente_id>/ no bucket. O nome do arquivo costuma
-- trazer o nome do titular. Mesma leitura por SQL e mesma regra de caixa de _lgpd_caminhos_cliente; a Edge lgpd-anonimizar
-- apaga pela API do Storage, por bucket.
create function public._lgpd_caminhos_portal(p_cliente_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(x.path order by x.path collate "C"), '{}')
  from (select a.storage_path as path from public.cliente_arquivos a
        where a.cliente_id = p_cliente_id and a.storage_path not like 'removido-lgpd/%'
        union
        select o.name from storage.objects o
        where o.bucket_id = 'cliente-arquivos' and lower(o.name) like p_cliente_id::text || '/%') x
$$;

revoke execute on function public._requisicao_ip(), public._requisicao_agente(), public._portal_cliente_id(),
  public._lgpd_caminhos_cliente(uuid), public._lgpd_caminhos_portal(uuid)
  from public, anon, authenticated, service_role;

-- ============ AUDITORIA (§5.1, N20) ============
-- Internos (admin e super) leem; a própria leitura é registrada (acesso/consultar, com o cliente filtrado, se houver).
-- Filtros validados (códigos e ids; nada de texto livre no registro). Página: limite 1–200 (padrão 50).
-- Datas `de`/`ate` no fuso de São Paulo, inclusivas.
create or replace function public.auditoria_consultar(p_filtros jsonb, p_limite int, p_offset int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_limite int := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_categoria public.categoria_auditoria;
  v_acao text;
  v_entidade text;
  v_entidade_id text;
  v_cliente uuid;
  v_ator uuid;
  v_de date;
  v_ate date;
  v_total bigint;
  v_itens jsonb;
  v_ids bigint[];
  v_registro jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if not public.is_admin() then
    perform public._auditar('acesso', 'acesso_negado', 'auditoria', null);
    return null;
  end if;
  if jsonb_typeof(v_f) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"filtros"}';
  end if;

  begin
    v_categoria := nullif(btrim(v_f ->> 'categoria'), '')::public.categoria_auditoria;
    v_acao := nullif(btrim(v_f ->> 'acao'), '');
    v_entidade := nullif(btrim(v_f ->> 'entidade'), '');
    v_entidade_id := nullif(btrim(v_f ->> 'entidade_id'), '');
    v_cliente := nullif(btrim(v_f ->> 'cliente_id'), '')::uuid;
    v_ator := nullif(btrim(v_f ->> 'ator_id'), '')::uuid;
    v_de := nullif(btrim(v_f ->> 'de'), '')::date;
    v_ate := nullif(btrim(v_f ->> 'ate'), '')::date;
  exception when others then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"filtros"}';
  end;
  -- mesmos formatos das colunas (acao e entidade são códigos, nunca texto livre); datas numa faixa plausível (fora
  -- dela, 'ate' + 1 e a conversão para timestamp estourariam com erro cru, WP6R-04)
  if (v_acao is not null and v_acao !~ '^[a-z][a-z_]{1,39}$')
     or (v_entidade is not null and v_entidade !~ '^[a-z][a-z0-9_]{1,59}$')
     or (v_entidade_id is not null and length(v_entidade_id) > 200)
     or (v_de is not null and v_de not between date '2000-01-01' and date '2100-12-31')
     or (v_ate is not null and v_ate not between date '2000-01-01' and date '2100-12-31')
     or (v_de is not null and v_ate is not null and v_ate < v_de) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"filtros"}';
  end if;

  select count(*) into v_total
  from public.auditoria a
  where (v_categoria is null or a.categoria = v_categoria)
    and (v_acao is null or a.acao = v_acao)
    and (v_entidade is null or a.entidade = v_entidade)
    and (v_entidade_id is null or a.entidade_id = v_entidade_id)
    and (v_cliente is null or a.cliente_id = v_cliente)
    and (v_ator is null or a.ator_id = v_ator)
    and (v_de is null or a.ocorrido_em >= (v_de::timestamp at time zone 'America/Sao_Paulo'))
    and (v_ate is null or a.ocorrido_em < ((v_ate + 1)::timestamp at time zone 'America/Sao_Paulo'));

  select coalesce(jsonb_agg(x.item order by x.ocorrido_em desc, x.id desc), '[]'::jsonb),
         coalesce(array_agg(x.id order by x.ocorrido_em desc, x.id desc), '{}')
    into v_itens, v_ids
  from (
    select a.id, a.ocorrido_em, jsonb_build_object(
             'id', a.id, 'ocorrido_em', a.ocorrido_em, 'categoria', a.categoria, 'acao', a.acao,
             'entidade', a.entidade, 'entidade_id', a.entidade_id, 'cliente_id', a.cliente_id,
             'ator_id', a.ator_id, 'ator_nome', coalesce(nullif(btrim(pr.nome), ''), pr.email),
             'ator_papel', a.ator_papel, 'ator_parceiro_id', a.ator_parceiro_id, 'origem', a.origem,
             'campos', a.campos, 'antes', a.antes, 'depois', a.depois, 'detalhe', a.detalhe,
             'ip', host(a.ip), 'user_agent', a.user_agent) as item
    from public.auditoria a
    left join public.profiles pr on pr.id = a.ator_id
    where (v_categoria is null or a.categoria = v_categoria)
      and (v_acao is null or a.acao = v_acao)
      and (v_entidade is null or a.entidade = v_entidade)
      and (v_entidade_id is null or a.entidade_id = v_entidade_id)
      and (v_cliente is null or a.cliente_id = v_cliente)
      and (v_ator is null or a.ator_id = v_ator)
      and (v_de is null or a.ocorrido_em >= (v_de::timestamp at time zone 'America/Sao_Paulo'))
      and (v_ate is null or a.ocorrido_em < ((v_ate + 1)::timestamp at time zone 'America/Sao_Paulo'))
    order by a.ocorrido_em desc, a.id desc
    limit v_limite offset v_offset
  ) x;

  -- o registro da leitura vem depois da consulta: não aparece na própria página
  v_registro := jsonb_strip_nulls(jsonb_build_object(
    'categoria', v_categoria, 'acao', v_acao, 'entidade', v_entidade,
    'entidade_id', case when v_entidade_id is null then null
                        when v_entidade_id ~* c_uuid or v_entidade_id ~ '^\d{1,19}$' then to_jsonb(v_entidade_id)
                        else to_jsonb(true) end,
    'cliente_id', v_cliente, 'ator_id', v_ator, 'de', v_de, 'ate', v_ate));
  perform public._auditar('acesso', 'consultar', 'auditoria', null, v_cliente, null, null, null,
    jsonb_build_object('filtros', v_registro, 'total', v_total, 'limite', v_limite, 'offset', v_offset,
                       'ids', to_jsonb(v_ids)));

  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

-- ============ CONFIGURAÇÃO GERAL (§3.9) ============
-- Só o Super. Muda só as chaves enviadas e só as da lista permitida (os ids da casa e o carimbo nunca mudam por aqui).
-- Cada chave é gravada à parte, para devolver exatamente quais falharam (DADOS_INVALIDOS com detail {campos}); os checks
-- da tabela são a validação (tipos, faixas, CNPJ com DV). Textos são aparados (vazio = nulo); o CNPJ aceita máscara.
-- Ligar exigir_mfa_interno (H5) exige que o próprio Super esteja com a sessão em aal2: senão ele se trancaria fora.
-- Auditoria configuracao/editar com antes e depois só dos campos que mudaram (nenhum é dado pessoal).
create or replace function public.config_atualizar(p jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c_permitidas constant text[] := array[
    'exclusividade_dias', 'duplicidade_bloqueios_hora', 'documentos_basicos', 'documento_max_bytes',
    'portal_libera_pre_cadastro', 'vendedora_razao_social', 'vendedora_cnpj', 'vendedora_endereco',
    'prazo_assinatura_dias', 'imovel_fotos_max', 'imovel_foto_max_bytes', 'exigir_mfa_interno',
    'sessao_inatividade_horas', 'retencao_acesso_meses', 'retencao_operacao_meses', 'download_ttl_segundos'];
  v_p jsonb;
  v_chaves text[];
  v_invalidas text[] := '{}';
  v_chave text;
  v_valor jsonb;
  v_docs text[];
  v_antes jsonb;
  v_depois jsonb;
  v_mudou text[];
begin
  if auth.uid() is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"formato"}';
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_invalidas from jsonb_object_keys(p) k where k <> all (c_permitidas);
  if cardinality(v_invalidas) > 0 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001',
      detail = jsonb_build_object('campos', to_jsonb(v_invalidas))::text;
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_chaves from jsonb_object_keys(p) k;
  if cardinality(v_chaves) = 0 then
    return;
  end if;

  -- normalização
  v_p := p;
  foreach v_chave in array array['vendedora_razao_social', 'vendedora_endereco'] loop
    if v_p ? v_chave and jsonb_typeof(v_p -> v_chave) = 'string' then
      v_p := jsonb_set(v_p, array[v_chave], coalesce(to_jsonb(nullif(btrim(v_p ->> v_chave), '')), 'null'::jsonb));
    end if;
  end loop;
  if v_p ? 'vendedora_cnpj' and jsonb_typeof(v_p -> 'vendedora_cnpj') = 'string' then
    v_p := jsonb_set(v_p, '{vendedora_cnpj}',
                     coalesce(to_jsonb(nullif(regexp_replace(v_p ->> 'vendedora_cnpj', '\D', '', 'g'), '')), 'null'::jsonb));
  end if;
  -- booleano só como booleano JSON (null também é inválido: a coluna é not null). Conferido ANTES da regra do aal2
  -- abaixo, que lê o valor: uma string solta sairia como erro cru de conversão (WP6R-04)
  if v_p ? 'exigir_mfa_interno' and jsonb_typeof(v_p -> 'exigir_mfa_interno') is distinct from 'boolean' then
    v_invalidas := v_invalidas || 'exigir_mfa_interno'::text;
  end if;
  if v_p ? 'documentos_basicos' then
    if jsonb_typeof(v_p -> 'documentos_basicos') <> 'array'
       or exists (select 1 from jsonb_array_elements(v_p -> 'documentos_basicos') e where jsonb_typeof(e) <> 'string') then
      v_invalidas := v_invalidas || 'documentos_basicos'::text;
    else
      select coalesce(array_agg(btrim(e) order by o), '{}') into v_docs
      from jsonb_array_elements_text(v_p -> 'documentos_basicos') with ordinality as t(e, o);
      if exists (select 1 from unnest(v_docs) d where length(d) not between 2 and 120)
         or (select count(distinct lower(d)) from unnest(v_docs) d) <> cardinality(v_docs) then
        v_invalidas := v_invalidas || 'documentos_basicos'::text;
      else
        v_p := jsonb_set(v_p, '{documentos_basicos}', to_jsonb(v_docs));
      end if;
    end if;
  end if;

  select to_jsonb(c) into v_antes from public.configuracao_geral c where c.id for update;

  if v_p -> 'exigir_mfa_interno' = 'true'::jsonb and not coalesce((v_antes ->> 'exigir_mfa_interno')::boolean, false)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Para exigir a verificação em duas etapas dos internos, conclua antes a sua (menu Segurança) e entre de novo com o código.'
      using errcode = 'P0001';
  end if;

  -- grava chave a chave (cada uma num subbloco): os checks dizem exatamente quais valores são inválidos
  foreach v_chave in array v_chaves loop
    continue when v_chave = any (v_invalidas);
    v_valor := jsonb_build_object(v_chave, v_p -> v_chave);
    begin
      execute format('update public.configuracao_geral c set %1$I = (jsonb_populate_record(null::public.configuracao_geral, $1)).%1$I where c.id',
                     v_chave)
        using v_valor;
    exception when others then
      v_invalidas := v_invalidas || v_chave;
    end;
  end loop;
  if cardinality(v_invalidas) > 0 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001',
      detail = jsonb_build_object('campos', to_jsonb(v_invalidas))::text;
  end if;

  select to_jsonb(c) into v_depois from public.configuracao_geral c where c.id;
  select coalesce(array_agg(k order by k), '{}') into v_mudou
  from unnest(v_chaves) k where (v_antes -> k) is distinct from (v_depois -> k);
  if cardinality(v_mudou) = 0 then
    return;
  end if;
  perform public._auditar('configuracao', 'editar', 'configuracao_geral', 'true', null, v_mudou,
    (select jsonb_object_agg(k, v_antes -> k) from unnest(v_mudou) k),
    (select jsonb_object_agg(k, v_depois -> k) from unnest(v_mudou) k));
end $$;

-- ============ EQUIPE INTERNA (N2) ============
-- Só o Super; só entre admin, super e colaborador (de e para); nunca remove o último Super ativo (ULTIMO_SUPER);
-- perfil inativado não recebe papel com acesso. Os Supers ficam travados durante a troca (duas trocas simultâneas não
-- deixam o sistema sem Super). Auditoria seguranca/editar com o papel antes e depois.
create or replace function public.equipe_definir_papel(p_profile_id uuid, p_papel public.papel)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c_internos constant public.papel[] := array['admin', 'super', 'colaborador']::public.papel[];
  v_alvo public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_profile_id is null or p_papel is null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001';
  end if;
  if p_papel <> all (c_internos) then
    raise exception 'Só é possível trocar entre Admin, Super e Colaborador.' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles pr where pr.papel = 'super' order by pr.id for update;
  select * into v_alvo from public.profiles pr where pr.id = p_profile_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_alvo.papel <> all (c_internos) then
    raise exception 'Só é possível trocar entre Admin, Super e Colaborador.' using errcode = 'P0001';
  end if;
  if v_alvo.papel = p_papel then
    return;
  end if;
  if p_papel in ('admin', 'super') and (v_alvo.inativado_em is not null or v_alvo.status_parceiro = 'inativo') then
    raise exception 'Perfil inativado não pode receber papel com acesso.' using errcode = 'P0001';
  end if;
  if v_alvo.papel = 'super' and not exists (
       select 1 from public.profiles o
       where o.papel = 'super' and o.id <> v_alvo.id and o.inativado_em is null and o.status_parceiro <> 'inativo') then
    raise exception 'ULTIMO_SUPER' using errcode = 'P0001';
  end if;

  update public.profiles pr set papel = p_papel where pr.id = p_profile_id;

  perform public._auditar('seguranca', 'editar', 'profiles', p_profile_id::text, null, array['papel'],
                          jsonb_build_object('papel', v_alvo.papel), jsonb_build_object('papel', p_papel));
end $$;

-- ============ LGPD: termos e consentimentos (§5.4, H4) ============
-- Termo vigente de um tipo (anon: pré-cadastro e cadastro de parceiro). Texto público: a leitura não é auditada.
create or replace function public.lgpd_termo_vigente(p_tipo text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_termo jsonb;
begin
  if p_tipo is null or p_tipo not in ('consentimento_cliente', 'termos_parceiro') then
    return null;
  end if;
  v_id := public._termo_vigente_id(p_tipo);
  if v_id is null then
    return null;
  end if;
  select jsonb_build_object('id', t.id, 'tipo', t.tipo, 'versao', t.versao, 'texto', t.texto,
                            'vigente_desde', t.vigente_desde, 'revisado_juridico', t.revisado_juridico)
    into v_termo
  from public.lgpd_termos t where t.id = v_id;
  return v_termo;
end $$;

-- Nova versão (somente inclusão), vigente a partir de agora. Só o Super. Uma versão de parceiro nova faz todos os
-- parceiros aceitarem de novo (pendência 'termo' em meu_escopo); sem revisado_juridico o pré-cadastro fica fechado (H4).
-- Auditoria lgpd/criar com tipo, versão e revisão (o texto fica na própria tabela).
create or replace function public.lgpd_publicar_termo(p_tipo text, p_versao text, p_texto text, p_revisado_juridico boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_versao text := btrim(coalesce(p_versao, ''));
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
begin
  if auth.uid() is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('consentimento_cliente', 'termos_parceiro') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["tipo"]}';
  end if;
  if length(v_versao) not between 1 and 40 or v_versao ~ '[[:cntrl:]]' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["versao"]}';
  end if;
  if length(v_texto) not between 20 and 200000 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["texto"]}';
  end if;
  if exists (select 1 from public.lgpd_termos t where t.tipo = p_tipo and t.versao = v_versao) then
    raise exception 'Já existe uma versão com esse nome para este termo.' using errcode = 'P0001';
  end if;

  -- criado_em pelo relógio: desempata duas versões publicadas na mesma transação (a vigente é a mais recente)
  insert into public.lgpd_termos (tipo, versao, texto, vigente_desde, revisado_juridico, criado_em, criado_por)
  values (p_tipo, v_versao, v_texto, now(), coalesce(p_revisado_juridico, false), clock_timestamp(), auth.uid())
  returning id into v_id;

  perform public._auditar('lgpd', 'criar', 'lgpd_termos', v_id::text, null,
    array['tipo', 'versao', 'texto', 'vigente_desde', 'revisado_juridico'], null,
    jsonb_build_object('tipo', p_tipo, 'versao', v_versao, 'revisado_juridico', coalesce(p_revisado_juridico, false)));
end $$;

-- Aceite do termo VIGENTE por quem está logado (idempotente: aceite ativo repetido não grava de novo).
--   termos_parceiro:       perfis de parceiro (resolve a pendência 'termo'); origem cadastro_parceiro
--   consentimento_cliente: o titular no portal (_portal_cliente_id); origem portal; timeline 'consentimento'
-- Termo antigo ou inexistente: TERMO_DESATUALIZADO. IP e navegador dos cabeçalhos da requisição.
create or replace function public.lgpd_aceitar_termo(p_termo_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_pr public.profiles%rowtype;
  v_termo public.lgpd_termos%rowtype;
  v_cliente uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_pr from public.profiles pr where pr.id = v_uid;
  if not found or v_pr.inativado_em is not null or v_pr.status_parceiro = 'inativo' then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_termo from public.lgpd_termos t where t.id = p_termo_id;
  if not found or v_termo.id is distinct from public._termo_vigente_id(v_termo.tipo) then
    raise exception 'TERMO_DESATUALIZADO' using errcode = 'P0001';
  end if;

  if v_termo.tipo = 'termos_parceiro' then
    if v_pr.papel not in ('parceiro', 'corretor', 'gerente', 'imobiliaria') then
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
    if exists (select 1 from public.lgpd_consentimentos c
               where c.profile_id = v_uid and c.termo_id = v_termo.id and c.revogado_em is null) then
      return;
    end if;
    insert into public.lgpd_consentimentos (titular, profile_id, termo_id, origem, ip, user_agent)
    values ('parceiro', v_uid, v_termo.id, 'cadastro_parceiro', public._requisicao_ip(), public._requisicao_agente())
    returning id into v_id;
  else
    v_cliente := public._portal_cliente_id();
    if v_cliente is null then
      raise exception 'Sem acesso a este registro' using errcode = '42501';
    end if;
    -- o aceite do próprio titular vale por si (o 'declarado' pelo parceiro ou pela equipe é de outra base, N12):
    -- idempotente só sobre o aceite ativo pelo portal
    if exists (select 1 from public.lgpd_consentimentos c
               where c.cliente_id = v_cliente and c.termo_id = v_termo.id and c.origem = 'portal'
                 and c.revogado_em is null) then
      return;
    end if;
    insert into public.lgpd_consentimentos (titular, cliente_id, profile_id, termo_id, origem, ip, user_agent)
    values ('cliente', v_cliente, v_uid, v_termo.id, 'portal', public._requisicao_ip(), public._requisicao_agente())
    returning id into v_id;
    perform public._evento_cliente(v_cliente, 'consentimento', 'Consentimento aceito no portal',
                                   jsonb_build_object('termo_id', v_termo.id, 'origem', 'portal'));
  end if;

  perform public._auditar('lgpd', 'aceitar', 'lgpd_consentimentos', v_id::text, v_cliente, null, null, null,
    jsonb_build_object('termo_id', v_termo.id, 'tipo', v_termo.tipo, 'versao', v_termo.versao));
end $$;

-- Revogação (só o Super): preenche revogado_* uma vez (a tabela só aceita isso). O cliente continua existindo; sem
-- nenhum consentimento ativo, os e-mails para ele deixam de sair (fila marcada 'ignorado'). O motivo fica na tabela
-- (nunca na auditoria, que é texto livre). Parceiro revogado volta a ter a pendência 'termo'.
create or replace function public.lgpd_revogar_consentimento(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_c public.lgpd_consentimentos%rowtype;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 2000);
begin
  if v_uid is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_c from public.lgpd_consentimentos c where c.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_c.revogado_em is not null then
    raise exception 'Este consentimento já foi revogado.' using errcode = 'P0001';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001';
  end if;

  update public.lgpd_consentimentos c
     set revogado_em = now(), revogado_por = v_uid, motivo_revogacao = v_motivo
   where c.id = p_id;

  if v_c.cliente_id is not null then
    perform public._evento_cliente(v_c.cliente_id, 'consentimento', 'Consentimento revogado',
                                   jsonb_build_object('termo_id', v_c.termo_id, 'origem', v_c.origem, 'revogado', true));
    if not exists (select 1 from public.lgpd_consentimentos c where c.cliente_id = v_c.cliente_id and c.revogado_em is null) then
      update public.notificacoes n
         set status = 'ignorado', ultimo_erro = 'consentimento revogado'
       where n.cliente_id = v_c.cliente_id and cardinality(n.destinatarios_ids) = 0 and n.status in ('pendente', 'erro');
    end if;
  end if;

  perform public._auditar('lgpd', 'revogar', 'lgpd_consentimentos', p_id::text, v_c.cliente_id,
    array['revogado_em', 'revogado_por', 'motivo_revogacao'], null, null,
    jsonb_build_object('titular', v_c.titular, 'termo_id', v_c.termo_id, 'origem', v_c.origem));
end $$;

-- ============ LGPD: anonimização a pedido do titular (§5.5) ============
-- Só o Super, COM O JWT (a Edge lgpd-anonimizar chama com o token de quem pediu; is_super respeita o aal2).
-- Irreversível. Recusa com contrato em assinatura_pendente (o D4Sign ainda depende dos dados).
--   1. nome → "Titular anonimizado #<6 do hash do id>"; 2. anula documentos, contatos, endereço, nascimento,
--   gênero, estado civil, horário e interesses; textos livres do cadastro → "[removido — LGPD]";
--   3. notas, e título e descrição das tarefas → "[removido — LGPD]" (removido_lgpd); motivos livres de documentos,
--   de duplicidades e dos contratos (observação da devolução, motivo da inativação) idem; 4. lead convertido ligado, as
--   linhas legadas de parceiro_clientes do mapa do corte (migracao_parceiro_clientes, quando existir) e as de mesmo
--   CPF; texto e resposta das propostas do cliente; nome e e-mail do titular como signatário; 5. anonimizado_em,
--   inativado_em e portal_liberado = false; consentimentos ativos revogados; e-mails pendentes para ele ignorados;
--   nome, telefone e CPF do perfil do portal apagados (a Edge remove o usuário Auth em seguida); 6. MANTÉM valores e
--   datas de contratos, vínculos, timeline, historico_status e auditoria — mas o TEXTO LIVRE copiado para esses
--   registros somente inclusão (motivo das transições do cliente, dos documentos e dos contratos dele; dados.motivo da
--   timeline; motivo dos vínculos, menos os rótulos fixos do sistema) também vira "[removido — LGPD]" (WP6R-01, ver
--   abaixo); 7. marca removido_em nos
--   arquivos de documentos e devolve os caminhos a apagar pela API do Storage — os registrados E todos os objetos que
--   existirem sob <cliente_id>/ no bucket (envio recusado depois do upload deixa objeto sem registro, WP6R-02) —, mais
--   o user_id do portal (a Edge remove o usuário Auth). 8. [WP7R1-03] portal antigo: nome e caminho de cliente_arquivos
--   e descrição de cliente_negocios (texto livre) viram "[removido — LGPD]"/marcador, e os objetos do bucket
--   cliente-arquivos (os registrados e todos sob <cliente_id>/) saem em `paths_portal` para a Edge apagar.
-- Texto livre nos registros somente inclusão (WP6R-01): as guardas (_somente_inclusao, _contratos_imutavel) só aceitam a
-- troca do motivo por "[removido — LGPD]" com arken.anonimizacao = 'on', ligada só aqui e só em volta desses UPDATEs
-- (exceção criada pelo WP7 em migration nova, porque as 01–09 não mudam). Sem essa exceção a anonimização é recusada
-- INTEIRA (nada muda): o titular nunca fica "anonimizado" com o texto ainda guardado.
-- Repetição (a Edge pode tentar de novo depois de uma falha no Storage): não muda nada e devolve de novo os caminhos e
-- o usuário. Auditoria lgpd/anonimizar com os NOMES dos campos, contagens e o protocolo (identificador do pedido).
create or replace function public.lgpd_anonimizar_cliente(p_cliente_id uuid, p_protocolo text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_removido constant text := '[removido — LGPD]';
  c_campos constant text[] := array[
    'nome', 'sobrenome', 'cpf', 'cnpj', 'rg', 'email', 'telefone', 'emails_adicionais', 'telefones_adicionais',
    'data_nascimento', 'genero', 'estado_civil', 'nacionalidade', 'horario_contato', 'cep', 'logradouro', 'numero',
    'complemento', 'bairro', 'cidade', 'uf', 'interesses', 'motivo_perda', 'motivo_inativacao', 'anonimizado_em',
    'inativado_em', 'portal_liberado'];
  -- motivos de vínculo que são rótulos do sistema (gatilhos das 04/06, RPCs da rede e o corte), não texto digitado
  c_motivos_sistema constant text[] := array[
    'cadastro', 'alteracao', 'reativacao', 'reativação', 'aprovação de autocadastro', 'regularização de legado',
    'migração: clientes do portal na Carteira Arken', 'migração: carteira do parceiro no sistema antigo'];
  v_uid constant uuid := auth.uid();
  v_protocolo text := btrim(coalesce(p_protocolo, ''));
  v_c public.clientes%rowtype;
  v_hash text;
  v_rotulo text;
  v_paths text[];
  v_n_arquivos int := 0;
  v_n_notas int := 0;
  v_n_tarefas int := 0;
  v_n_legado int := 0;
  v_n_mapa int := 0;
  v_n_hist int := 0;
  v_n_eventos int := 0;
  v_n_vinculos int := 0;
  v_n_contratos int := 0;
  v_paths_portal text[];
  v_n_arq_portal int := 0;
  v_n_neg_portal int := 0;
  v_n int;
  v_legada text;
  v_usuario uuid;
begin
  if v_uid is null or not public.is_super() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_protocolo !~ '^[A-Za-z0-9][A-Za-z0-9._/#-]{2,59}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["protocolo"]}';
  end if;
  select * into v_c from public.clientes c where c.id = p_cliente_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  -- usuário do portal a remover: só se o perfil ligado for mesmo de cliente (um user_id legado apontando para um
  -- interno ou parceiro nunca é devolvido — a Edge apagaria a conta dele)
  select pr.id into v_usuario from public.profiles pr where pr.id = v_c.user_id and pr.papel = 'cliente';

  -- repetição: nada muda; devolve de novo o que a Edge precisa apagar
  if v_c.anonimizado_em is not null then
    v_paths := public._lgpd_caminhos_cliente(p_cliente_id);
    v_paths_portal := public._lgpd_caminhos_portal(p_cliente_id);
    perform public._auditar('lgpd', 'anonimizar', 'clientes', p_cliente_id::text, p_cliente_id, null, null, null,
      jsonb_build_object('protocolo', v_protocolo, 'repeticao', true, 'arquivos', cardinality(v_paths),
                         'arquivos_portal', cardinality(v_paths_portal)));
    return jsonb_build_object('paths', to_jsonb(v_paths), 'paths_portal', to_jsonb(v_paths_portal), 'user_id', v_usuario);
  end if;

  if exists (select 1 from public.contratos k where k.cliente_id = p_cliente_id and k.status = 'assinatura_pendente') then
    raise exception 'Há contrato aguardando assinatura. Cancele o envio ou aguarde a conclusão antes de anonimizar.'
      using errcode = 'P0001';
  end if;

  v_hash := left(encode(extensions.digest(p_cliente_id::text, 'sha256'), 'hex'), 6);
  v_rotulo := 'Titular anonimizado #' || v_hash;

  -- 4. registros ligados (antes de apagar o CPF, que identifica as linhas legadas). A tabela legada muda de nome na
  -- contração (parceiro_clientes → legado_parceiro_clientes, WP7) e o mapa só existe depois do corte: SQL dinâmico,
  -- só sobre o que existir (objetos de migration posterior nunca são citados diretamente).
  foreach v_legada in array array['parceiro_clientes', 'legado_parceiro_clientes'] loop
    continue when to_regclass('public.' || v_legada) is null;
    if v_c.cpf is not null then
      execute format('update public.%I pc
                         set nome = $1, rg = null, cpf = null, telefone = '''', anotacoes = null, interesses = ''{}''
                       where regexp_replace(coalesce(pc.cpf, ''''), ''\D'', '''', ''g'') = $2', v_legada)
        using v_rotulo, v_c.cpf;
      get diagnostics v_n = row_count;
      v_n_legado := v_n_legado + v_n;
    end if;
    if to_regclass('public.migracao_parceiro_clientes') is not null then
      execute format('update public.%I pc
                         set nome = $1, rg = null, cpf = null, telefone = '''', anotacoes = null, interesses = ''{}''
                        from public.migracao_parceiro_clientes m
                       where m.cliente_id = $2 and pc.id = m.parceiro_cliente_id and pc.nome is distinct from $1', v_legada)
        using v_rotulo, p_cliente_id;
      get diagnostics v_n = row_count;
      v_n_mapa := v_n_mapa + v_n;
    end if;
  end loop;
  update public.leads l
     set nome = v_rotulo, email = null, telefone = null, mensagem = null,
         motivo_descarte = case when l.motivo_descarte is not null then c_removido end
   where l.cliente_id = p_cliente_id;
  update public.propostas pr
     set texto = c_removido, resposta_admin = case when pr.resposta_admin is not null then c_removido end
   where pr.cliente_id = p_cliente_id
     and (pr.texto <> c_removido or pr.resposta_admin is distinct from
                                     case when pr.resposta_admin is not null then c_removido end);
  update public.contrato_signatarios s
     set nome = v_rotulo, email = 'titular-' || v_hash || '-' || left(s.id::text, 8) || '@anonimizado.invalid',
         motivo = case when s.motivo is not null then c_removido end
    from public.contratos k
   where k.id = s.contrato_id and k.cliente_id = p_cliente_id and s.papel = 'cliente';

  -- 3. notas, tarefas, documentos, duplicidades
  update public.cliente_notas n set texto = c_removido, removido_lgpd = true
   where n.cliente_id = p_cliente_id and not n.removido_lgpd;
  get diagnostics v_n_notas = row_count;
  update public.cliente_tarefas t
     set titulo = c_removido, descricao = case when t.descricao is not null then c_removido end,
         motivo_inativacao = case when t.motivo_inativacao is not null then c_removido end, removido_lgpd = true
   where t.cliente_id = p_cliente_id and not t.removido_lgpd;
  get diagnostics v_n_tarefas = row_count;
  update public.cliente_documentos d
     set motivo_rejeicao = case when d.motivo_rejeicao is not null then c_removido end,
         motivo_inativacao = case when d.motivo_inativacao is not null then c_removido end
   where d.cliente_id = p_cliente_id and (d.motivo_rejeicao is not null or d.motivo_inativacao is not null);
  update public.cliente_duplicidades x set motivo_decisao = c_removido
   where x.cliente_id = p_cliente_id and x.motivo_decisao is not null;
  -- 8. portal antigo [WP7R1-03]: os caminhos saem ANTES de o registro perder o caminho; o nome do arquivo (que costuma
  -- trazer o nome do titular) e o texto livre da descrição do negócio são removidos; valor, status, unidade e datas ficam
  v_paths_portal := public._lgpd_caminhos_portal(p_cliente_id);
  update public.cliente_arquivos a set nome = c_removido, storage_path = 'removido-lgpd/' || a.id::text
   where a.cliente_id = p_cliente_id and a.storage_path not like 'removido-lgpd/%';
  get diagnostics v_n_arq_portal = row_count;
  update public.cliente_negocios n set descricao = c_removido
   where n.cliente_id = p_cliente_id and n.descricao is not null and n.descricao <> c_removido;
  get diagnostics v_n_neg_portal = row_count;

  -- 6. texto livre copiado para os registros somente inclusão e o dos contratos (WP6R-01). A exceção das guardas vale
  -- só com arken.anonimizacao = 'on' e só para "[removido — LGPD]"; sem ela (guarda recusa: 42501 da somente inclusão,
  -- 23514 do congelamento do contrato) a anonimização inteira é desfeita — nunca termina com o texto ainda guardado.
  perform set_config('arken.anonimizacao', 'on', true);
  begin
    update public.historico_status h set motivo = c_removido
     where h.motivo is not null and h.motivo <> c_removido
       and ((h.entidade = 'cliente_etapa' and h.entidade_id = p_cliente_id)
            or (h.entidade = 'documento'
                and h.entidade_id in (select d.id from public.cliente_documentos d where d.cliente_id = p_cliente_id))
            or (h.entidade = 'contrato'
                and h.entidade_id in (select k.id from public.contratos k where k.cliente_id = p_cliente_id)));
    get diagnostics v_n_hist = row_count;
    update public.cliente_eventos e set dados = e.dados || jsonb_build_object('motivo', c_removido)
     where e.cliente_id = p_cliente_id and jsonb_typeof(e.dados -> 'motivo') = 'string'
       and e.dados ->> 'motivo' <> c_removido;
    get diagnostics v_n_eventos = row_count;
    -- os rótulos fixos gravados pelos gatilhos e pelas RPCs (sem texto digitado) ficam; o resto é texto livre
    update public.cliente_vinculos_historico v set motivo = c_removido
     where v.cliente_id = p_cliente_id and v.motivo is not null and v.motivo <> c_removido
       and v.motivo <> all (c_motivos_sistema);
    get diagnostics v_n_vinculos = row_count;
    update public.contratos k
       set observacao = case when k.observacao is not null then c_removido end,
           motivo_inativacao = case when k.motivo_inativacao is not null then c_removido end
     where k.cliente_id = p_cliente_id
       and ((k.observacao is not null and k.observacao <> c_removido)
            or (k.motivo_inativacao is not null and k.motivo_inativacao <> c_removido));
    get diagnostics v_n_contratos = row_count;
  exception when insufficient_privilege or check_violation then
    raise exception 'Não foi possível remover o texto livre dos históricos do titular (motivos de status, da linha do tempo, dos vínculos ou dos contratos). Nada foi alterado. Avise o suporte técnico.'
      using errcode = 'P0001', detail = '{"motivo":"historicos_somente_inclusao"}';
  end;
  perform set_config('arken.anonimizacao', 'off', true);

  -- 7. arquivos: marca a remoção e devolve os caminhos (a Edge apaga pela API do Storage)
  update public.cliente_documento_arquivos a set removido_em = now()
    from public.cliente_documentos d
   where d.id = a.documento_id and d.cliente_id = p_cliente_id and a.removido_em is null;
  get diagnostics v_n_arquivos = row_count;
  v_paths := public._lgpd_caminhos_cliente(p_cliente_id);

  -- 1, 2 e 5. o cadastro
  update public.clientes c
     set nome = v_rotulo, sobrenome = null, cpf = null, cnpj = null, rg = null, email = null, telefone = null,
         emails_adicionais = '{}', telefones_adicionais = '{}', data_nascimento = null, genero = null,
         estado_civil = null, nacionalidade = null, horario_contato = null, cep = null, logradouro = null,
         numero = null, complemento = null, bairro = null, cidade = null, uf = null, interesses = '{}',
         motivo_perda = case when c.motivo_perda is not null then c_removido end,
         anonimizado_em = now(), portal_liberado = false,
         inativado_em = coalesce(c.inativado_em, now()),
         inativado_por = case when c.inativado_em is null then v_uid else c.inativado_por end,
         motivo_inativacao = c_removido
   where c.id = p_cliente_id;

  -- consentimentos ativos: revogados (a anonimização encerra o tratamento); fila de e-mails para ele: ignorada
  update public.lgpd_consentimentos l
     set revogado_em = now(), revogado_por = v_uid, motivo_revogacao = 'Anonimização a pedido do titular'
   where l.cliente_id = p_cliente_id and l.revogado_em is null;
  update public.notificacoes n set status = 'ignorado', ultimo_erro = 'titular anonimizado'
   where n.cliente_id = p_cliente_id and n.status in ('pendente', 'erro');
  get diagnostics v_n = row_count;

  -- perfil do portal (a Edge remove o usuário Auth em seguida; se falhar, o nome já não fica no perfil)
  if v_c.user_id is not null then
    update public.profiles pr set nome = v_rotulo, telefone = null, cpf = null
     where pr.id = v_c.user_id and pr.papel = 'cliente';
  end if;

  perform public._auditar('lgpd', 'anonimizar', 'clientes', p_cliente_id::text, p_cliente_id, c_campos, null, null,
    jsonb_build_object('protocolo', v_protocolo, 'arquivos', cardinality(v_paths), 'arquivos_marcados', v_n_arquivos,
                       'notas', v_n_notas, 'tarefas', v_n_tarefas, 'legado', v_n_legado + v_n_mapa,
                       'historico_status', v_n_hist, 'timeline', v_n_eventos, 'vinculos', v_n_vinculos,
                       'contratos', v_n_contratos, 'arquivos_portal', cardinality(v_paths_portal),
                       'arquivos_portal_marcados', v_n_arq_portal, 'negocios', v_n_neg_portal,
                       'notificacoes_ignoradas', v_n, 'usuario_portal', v_c.user_id is not null));

  return jsonb_build_object('paths', to_jsonb(v_paths), 'paths_portal', to_jsonb(v_paths_portal), 'user_id', v_usuario);
end $$;

-- ============ PORTAL DO CLIENTE (§6.7, N1) ============
-- Todas por _portal_cliente_id(); sem cliente do portal: nulo (ou lista vazia) e acesso_negado registrado.
-- Cada leitura é registrada (categoria acesso, com o cliente titular).
create or replace function public.portal_meus_dados()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_dados jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_cliente := public._portal_cliente_id();
  if v_cliente is null then
    perform public._auditar('acesso', 'acesso_negado', 'clientes', null, null, null, null, null, '{"portal":true}'::jsonb);
    return null;
  end if;
  select jsonb_build_object('id', c.id, 'nome', c.nome, 'sobrenome', c.sobrenome, 'cpf', c.cpf, 'email', c.email,
                            'telefone', c.telefone, 'cep', c.cep, 'logradouro', c.logradouro, 'numero', c.numero,
                            'complemento', c.complemento, 'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf)
    into v_dados
  from public.clientes c where c.id = v_cliente;
  perform public._auditar('acesso', 'consultar', 'clientes', v_cliente::text, v_cliente, null, null, null,
                          '{"portal":true}'::jsonb);
  return v_dados;
end $$;

-- "Seu corretor": o responsável atual (corretor, ou gerente pelo A1). Para a Carteira Arken (virtual) o front mostra
-- o contato da empresa. A imobiliária é a do cliente.
create or replace function public.portal_meu_corretor()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_dados jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_cliente := public._portal_cliente_id();
  if v_cliente is null then
    perform public._auditar('acesso', 'acesso_negado', 'parceiros', null, null, null, null, null, '{"portal":true}'::jsonb);
    return null;
  end if;
  select jsonb_build_object('nome', p.nome, 'telefone', p.telefone, 'email', p.email, 'creci', p.creci,
                            'imobiliaria_nome', i.nome, 'virtual', p.virtual)
    into v_dados
  from public.clientes c
  join public.parceiros p on p.id = c.corretor_id
  left join public.imobiliarias i on i.id = c.imobiliaria_id
  where c.id = v_cliente;
  perform public._auditar('acesso', 'consultar', 'parceiros', null, v_cliente, null, null, null,
                          '{"portal":true,"corretor":true}'::jsonb);
  return v_dados;
end $$;

-- Documentos solicitados (ativos): só o que o titular precisa para ENVIAR; nunca o caminho do arquivo (não baixa).
-- max_bytes = limite configurado pelo Super (configuracao_geral.documento_max_bytes, ≤ bucket): o portal confere antes
-- de subir, para não deixar no bucket um objeto que o registro do envio recusaria (WP6R-02).
create or replace function public.portal_documentos()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_itens jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  v_cliente := public._portal_cliente_id();
  if v_cliente is null then
    perform public._auditar('acesso', 'acesso_negado', 'cliente_documentos', null, null, null, null, null,
                            '{"portal":true}'::jsonb);
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'tipo', d.tipo, 'nome', d.nome, 'formatos_aceitos', to_jsonb(d.formatos_aceitos),
           'status', d.status, 'motivo_rejeicao', d.motivo_rejeicao,
           'pode_enviar', d.status in ('pendente', 'rejeitado'), 'ultimo_envio_em', a.enviado_em,
           'max_bytes', g.documento_max_bytes)
         order by (d.status in ('pendente', 'rejeitado')) desc, d.criado_em, d.nome), '[]'::jsonb)
    into v_itens
  from public.cliente_documentos d
  cross join public.configuracao_geral g
  left join public.cliente_documento_arquivos a on a.id = d.arquivo_atual_id and a.removido_em is null
  where d.cliente_id = v_cliente and d.inativado_em is null;
  perform public._auditar('acesso', 'listar', 'cliente_documentos', null, v_cliente, null, null, null,
    jsonb_build_object('portal', true, 'quantidade', jsonb_array_length(v_itens)));
  return v_itens;
end $$;

-- Contratos do titular: só assinatura_pendente e assinado (rascunho e análise são internos). Valores oficiais do
-- servidor; o PDF assinado aparece como disponível só depois de guardado.
create or replace function public.portal_contratos()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_itens jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  v_cliente := public._portal_cliente_id();
  if v_cliente is null then
    perform public._auditar('acesso', 'acesso_negado', 'contratos', null, null, null, null, null, '{"portal":true}'::jsonb);
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id, 'codigo', k.codigo, 'status', k.status, 'forma_pagamento', k.forma_pagamento,
           'produto', case when k.unidade_id is not null
                           then jsonb_build_object('tipo', 'unidade',
                                  'nome', coalesce(e.nome || ' — ' || u.identificador, u.identificador, 'Unidade'))
                           else jsonb_build_object('tipo', 'imovel',
                                  'nome', coalesce(nullif(btrim(i.nome), ''), 'Imóvel #' || lpad(i.codigo::text, 7, '0')))
                      end,
           'valor_imovel', k.valor_imovel, 'n_parcelas', k.n_parcelas, 'valor_parcela', k.valor_parcela,
           'enviado_assinatura_em', k.enviado_assinatura_em, 'assinado_em', k.assinado_em,
           'pdf_assinado_disponivel', k.status = 'assinado' and k.pdf_assinado_path is not null)
         order by coalesce(k.assinado_em, k.enviado_assinatura_em, k.criado_em) desc), '[]'::jsonb)
    into v_itens
  from public.contratos k
  left join public.unidades u on u.id = k.unidade_id
  left join public.empreendimentos e on e.id = u.empreendimento_id
  left join public.imoveis i on i.id = k.imovel_id
  where k.cliente_id = v_cliente and k.status in ('assinatura_pendente', 'assinado') and k.inativado_em is null;
  perform public._auditar('acesso', 'listar', 'contratos', null, v_cliente, null, null, null,
    jsonb_build_object('portal', true, 'quantidade', jsonb_array_length(v_itens)));
  return v_itens;
end $$;

-- Download do PDF ASSINADO do próprio contrato (autorização curta + Edge baixar-arquivo). Qualquer outro caso: nulo
-- e acesso_negado registrado (mesma resposta para contrato de outro, inexistente, não assinado ou sem PDF).
create or replace function public.portal_contrato_baixar(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cliente uuid;
  v_path text;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_cliente := public._portal_cliente_id();
  if v_cliente is not null then
    select k.pdf_assinado_path into v_path from public.contratos k
    where k.id = p_id and k.cliente_id = v_cliente and k.status = 'assinado' and k.inativado_em is null
      and k.pdf_assinado_path is not null;
  end if;
  if v_path is null then
    perform public._auditar('acesso', 'acesso_negado', 'contratos', p_id::text, v_cliente, null, null, null,
                            '{"portal":true,"arquivo":"assinado"}'::jsonb);
    return null;
  end if;
  perform public._auditar('acesso', 'baixar', 'contratos', p_id::text, v_cliente, null, null, null,
                          '{"portal":true,"arquivo":"assinado"}'::jsonb);
  return public._autorizar_download('contratos', v_path);
end $$;

-- Login do portal só por CPF (decisão do usuário): a Edge cliente-login (service role) localiza o cliente. Só devolve
-- pessoa física com portal liberado, não inativada e não anonimizada; qualquer outro caso = nenhuma linha (a Edge
-- responde "não encontrado", sem revelar o motivo). O acesso é registrado pela Edge em portal_acessos.
create or replace function public.portal_localizar_cliente(p_cpf text)
returns table (id uuid, nome text, user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if v_cpf !~ '^\d{11}$' or not public.cpf_valido(v_cpf) then
    return;
  end if;
  return query
    select c.id, c.nome, c.user_id from public.clientes c
    where c.cpf = v_cpf and c.tipo_pessoa = 'fisica' and c.portal_liberado
      and c.inativado_em is null and c.anonimizado_em is null
    limit 1;
end $$;

-- ============ PAINEL (§7.4 admin/Dashboard) ============
-- Cartões por papel e escopo. Cada seção é nula sem a permissão correspondente de meu_escopo(); as contagens seguem
-- as mesmas regras de visibilidade das RPCs e das políticas (cliente: cadeia; imóvel: E4; proposta: cadeia ou autoria
-- sem cliente). Só agregados: não registra auditoria.
create or replace function public.painel_resumo()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_esc jsonb;
  v_perm jsonb;
  v_interno boolean;
  v_aprovado boolean;
  v_cor uuid;
  v_ger uuid;
  v_imob uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_emp jsonb;
  v_crm jsonb;
  v_ctr jsonb;
  v_imv jsonb;
  v_prop jsonb;
  v_rede jsonb;
  v_leads jsonb;
  v_dup int;
  v_mig int;
begin
  if v_uid is null then
    return null;
  end if;
  v_esc := public.meu_escopo();
  if v_esc is null then
    return null;
  end if;
  v_perm := coalesce(v_esc -> 'permissoes', '[]'::jsonb);
  v_interno := coalesce((v_esc ->> 'interno')::boolean, false);
  v_aprovado := public.is_parceiro_aprovado();
  v_cor := public.escopo_corretor();
  v_ger := public.escopo_gerente();
  v_imob := public.escopo_imobiliaria();

  if v_perm ? 'empreendimentos.ver' then
    select jsonb_build_object(
             'publicados', (select count(*) from public.empreendimentos e where e.publicado),
             'unidades_disponiveis', (select count(*) from public.unidades u
                                      join public.empreendimentos e on e.id = u.empreendimento_id
                                      where e.publicado and u.status = 'disponivel'))
      into v_emp;
  end if;

  if v_perm ? 'crm.ver' then
    with cli as (
      select c.id, c.etapa from public.clientes c
      where c.inativado_em is null
        and (v_interno or c.corretor_id = v_cor or c.gerente_id = v_ger or c.imobiliaria_id = v_imob)
    )
    select jsonb_build_object(
             'total', (select count(*) from cli),
             'por_etapa', jsonb_build_object(
               'novo_contato', (select count(*) from cli where cli.etapa = 'novo_contato'),
               'contato_iniciado', (select count(*) from cli where cli.etapa = 'contato_iniciado'),
               'documentacao', (select count(*) from cli where cli.etapa = 'documentacao'),
               'finalizado', (select count(*) from cli where cli.etapa = 'finalizado'),
               'perdido', (select count(*) from cli where cli.etapa = 'perdido')),
             'tarefas_pendentes', (select count(*) from public.cliente_tarefas t join cli on cli.id = t.cliente_id
                                   where t.status = 'pendente' and t.inativado_em is null),
             'tarefas_atrasadas', (select count(*) from public.cliente_tarefas t join cli on cli.id = t.cliente_id
                                   where t.status = 'pendente' and t.inativado_em is null and t.prazo < v_hoje),
             'documentos_em_analise', (select count(*) from public.cliente_documentos d join cli on cli.id = d.cliente_id
                                       where d.status = 'em_analise' and d.inativado_em is null))
      into v_crm;
  end if;

  if v_perm ? 'contratos.ver' then
    select jsonb_build_object('por_status', coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)) into v_ctr
    -- parceiros: a cadeia do cliente (ativo) no escopo, a MESMA regra de contratos_listar e contrato_detalhe (PAR-3);
    -- [WP7RN-05] a cadeia congelada do contrato não entra: contava contratos que o parceiro (depois de transferir o
    -- cliente ou mudar de imobiliária) não consegue listar nem abrir
    from (select k.status, count(*) as n from public.contratos k join public.clientes c on c.id = k.cliente_id
          where k.inativado_em is null
            and (v_interno
                 or (c.inativado_em is null
                     and (c.corretor_id = v_cor or c.gerente_id = v_ger or c.imobiliaria_id = v_imob)))
          group by k.status) s;
  end if;

  if v_perm ? 'imoveis.ver' then
    select jsonb_build_object('por_status', coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)) into v_imv
    from (select i.status, count(*) as n from public.imoveis i
          where i.inativado_em is null
            and (v_interno or (i.criado_por = v_uid and v_aprovado) or i.imobiliaria_id = v_imob or i.gerente_id = v_ger
                 or (i.status in ('aprovado', 'no_contrato') and v_aprovado))
          group by i.status) s;
  end if;

  if v_perm ? 'propostas.ver' then
    select jsonb_build_object('por_status', jsonb_build_object(
             'enviada', count(*) filter (where p.status = 'enviada'),
             'em_analise', count(*) filter (where p.status = 'em_analise'),
             'aprovada', count(*) filter (where p.status = 'aprovada'),
             'recusada', count(*) filter (where p.status = 'recusada')))
      into v_prop
    from public.propostas p
    where v_interno or (v_aprovado and (p.corretor_id = v_cor or p.gerente_id = v_ger or p.imobiliaria_id = v_imob
                                        or (p.cliente_id is null and p.parceiro_id = v_uid)));
  end if;

  if v_perm ? 'rede.ver' then
    if v_interno then
      select jsonb_build_object(
               'imobiliarias', (select count(*) from public.imobiliarias i where i.inativado_em is null),
               'gerentes', (select count(*) from public.parceiros p
                            where p.tipo = 'gerente' and not p.virtual and p.inativado_em is null),
               'corretores', (select count(*) from public.parceiros p
                              where p.tipo = 'corretor' and not p.virtual and p.inativado_em is null),
               'autocadastros_pendentes', (select count(*) from public.profiles pr
                                           where pr.papel = 'parceiro' and pr.status_parceiro = 'pendente'
                                             and pr.inativado_em is null
                                             and not exists (select 1 from public.parceiros p where p.profile_id = pr.id)))
        into v_rede;
    elsif v_imob is not null then
      select jsonb_build_object(
               'imobiliarias', 1,
               'gerentes', (select count(*) from public.parceiros p where p.imobiliaria_id = v_imob and p.tipo = 'gerente'
                              and not p.virtual and p.inativado_em is null),
               'corretores', (select count(*) from public.parceiros p where p.imobiliaria_id = v_imob and p.tipo = 'corretor'
                                and not p.virtual and p.inativado_em is null),
               'autocadastros_pendentes', null)
        into v_rede;
    elsif v_ger is not null then
      select jsonb_build_object(
               'imobiliarias', 1,
               'gerentes', 1,
               'corretores', (select count(*) from public.parceiros p where p.gerente_id = v_ger and p.tipo = 'corretor'
                                and not p.virtual and p.inativado_em is null),
               'autocadastros_pendentes', null)
        into v_rede;
    end if;
  end if;

  if v_perm ? 'leads.ver' then
    select jsonb_build_object('novos', count(*) filter (where l.status = 'novo'), 'total', count(*)) into v_leads
    from public.leads l;
  end if;
  if v_perm ? 'crm.duplicidades' then
    select count(*) into v_dup from public.cliente_duplicidades x where x.resolvido_em is null;
  end if;
  if v_perm ? 'migracao.ver' then
    select count(*) into v_mig from public.migracao_pendencias m where m.resolvido_em is null;
  end if;

  return jsonb_build_object(
    'papel', v_esc ->> 'papel',
    'empreendimentos', v_emp, 'crm', v_crm, 'contratos', v_ctr, 'imoveis', v_imv, 'propostas', v_prop,
    'rede', v_rede, 'leads', v_leads, 'duplicidades_pendentes', v_dup, 'migracao_pendencias', v_mig);
end $$;

-- ============ TAREFAS DO PG_CRON (rodam como postgres; nenhum grant) ============
-- Fila de e-mails (§6.6): reenvia pendente/erro com menos de 5 tentativas, criados há mais de 2 minutos (o gatilho já
-- disparou o primeiro envio) e sem reserva nos últimos 10 minutos. Sem notificar_url/notificar_secret no Vault (banco
-- local, projeto sem configuração): não faz nada. A Edge reserva cada linha antes de enviar (reservado_em), então um
-- disparo repetido não duplica o e-mail. No máximo 100 por rodada.
create or replace function public.notificacoes_reenviar()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
  v_n public.notificacoes%rowtype;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'notificar_url';
  select s.decrypted_secret into v_segredo from vault.decrypted_secrets s where s.name = 'notificar_secret';
  if v_url is null or v_segredo is null then
    return;
  end if;
  for v_n in
    select * from public.notificacoes n
    where n.status in ('pendente', 'erro') and n.tentativas < 5 and n.criado_em < now() - interval '2 minutes'
      and (n.reservado_em is null or n.reservado_em < now() - interval '10 minutes')
    order by n.criado_em, n.id
    limit 100
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_segredo),
      body := jsonb_build_object('tabela', 'notificacoes', 'evento', 'REENVIO', 'registro', to_jsonb(v_n), 'anterior', null));
  end loop;
end $$;

-- Retenção (§5.3, H3 ⚑): auditoria de acesso > retencao_acesso_meses (24), demais > retencao_operacao_meses (60);
-- integracao_chamadas > 12 meses; portal_acessos > retencao_acesso_meses; tentativas_publicas > 90 dias;
-- download_autorizacoes vencidas. A guarda da auditoria e de integracao_chamadas só libera o DELETE com
-- arken.purga_auditoria = 'on', ligada só dentro desta transação. A própria purga fica registrada (com as contagens).
create or replace function public.auditoria_purgar()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.configuracao_geral%rowtype;
  v_acesso int;
  v_demais int;
  v_integracao int;
  v_portal int;
  v_tentativas int;
  v_downloads int;
begin
  select * into v_cfg from public.configuracao_geral c;
  perform set_config('arken.purga_auditoria', 'on', true);
  delete from public.auditoria a
   where a.categoria = 'acesso' and a.ocorrido_em < now() - make_interval(months => v_cfg.retencao_acesso_meses);
  get diagnostics v_acesso = row_count;
  delete from public.auditoria a
   where a.categoria <> 'acesso' and a.ocorrido_em < now() - make_interval(months => v_cfg.retencao_operacao_meses);
  get diagnostics v_demais = row_count;
  delete from public.integracao_chamadas i where i.criado_em < now() - interval '12 months';
  get diagnostics v_integracao = row_count;
  perform set_config('arken.purga_auditoria', 'off', true);

  delete from public.portal_acessos p where p.created_at < now() - make_interval(months => v_cfg.retencao_acesso_meses);
  get diagnostics v_portal = row_count;
  delete from public.tentativas_publicas t where t.criado_em < now() - interval '90 days';
  get diagnostics v_tentativas = row_count;
  delete from public.download_autorizacoes d where d.expira_em < now();
  get diagnostics v_downloads = row_count;

  perform public._auditar('operacao', 'purgar', 'auditoria', null, null, null, null, null,
    jsonb_build_object('auditoria_acesso', v_acesso, 'auditoria_demais', v_demais, 'integracao_chamadas', v_integracao,
                       'portal_acessos', v_portal, 'tentativas_publicas', v_tentativas,
                       'download_autorizacoes', v_downloads,
                       'retencao_acesso_meses', v_cfg.retencao_acesso_meses,
                       'retencao_operacao_meses', v_cfg.retencao_operacao_meses), 'cron');
end $$;

-- Limpeza dos registros de vida curta, sem dado de negócio: autorizações de download vencidas e tentativas das rotas
-- públicas com mais de 90 dias (a purga mensal faz o mesmo; esta pode rodar com mais frequência).
create or replace function public.limpar_temporarios()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.download_autorizacoes d where d.expira_em < now();
  delete from public.tentativas_publicas t where t.criado_em < now() - interval '90 days';
end $$;
