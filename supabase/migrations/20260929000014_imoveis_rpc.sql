-- Imóveis: corpos das RPCs [WP5] (docs/ARQUITETURA_EXPANSAO.md §1.1 E2–E4, §3.7, §3.8, §3.10, §4.2–§4.5).
-- Troca os corpos dos esqueletos da 20260929000009 com create or replace, com a MESMA assinatura (o que preserva
-- dono e grants: execute só para authenticated). Nenhuma tabela nem coluna nova. Único acréscimo (aditivo): o gatilho
-- imoveis_campos_obrigatorios (fim do arquivo), que impede esvaziar um campo do IMV-2 fora do rascunho.
--
-- Regras comuns (§4.4):
-- - security definer ignora a RLS: o escopo é conferido aqui, explicitamente, com os helpers da 09
--   (pode_ver_imovel / pode_editar_imovel = regra E4; is_admin = internos, com MFA quando exigida);
-- - sem acesso e registro inexistente dão o MESMO erro: 42501 'Sem acesso a este registro' (não revela existência);
-- - status só muda por _transicionar (tabela status_transicoes, §3.8), que também grava historico_status;
-- - toda escrita grava _auditar (categoria operacao, sem dado pessoal nem texto livre); imóvel não tem cliente,
--   então não há timeline (_evento_cliente) nem notificação (§6.6: e-mail de imóvel não entra nesta etapa);
-- - a linha do imóvel é travada (for update) antes das conferências, para não correr com outra RPC
--   (inativação × mudança de status; contagem de fotos × registro simultâneo);
-- - erros de regra: P0001 com código de src/lib/erros.ts (LIMITE_FOTOS, ARQUIVO_INVALIDO, MOTIVO_OBRIGATORIO,
--   CONTRATO_ATIVO, DADOS_INVALIDOS; detail em JSON) ou frase pronta em pt-BR.
--
-- Fotos (§3.10, §7.3): o navegador reduz a imagem (WebP ≤ 1920 px + miniatura de 480 px), envia ao bucket privado
-- 'imoveis' pela API do Storage (política de INSERT = pode_editar_imovel e caminho <imovel_id>/<nome>.<ext>) e só
-- então registra aqui. O registro confere no próprio storage.objects que os objetos existem, o tamanho REAL
-- (metadata.size, calculado pelo Storage) e o tipo, sem confiar no que o navegador diz. Largura e altura vêm do
-- user_metadata do upload quando existirem: são só informativas (proporção na galeria).
-- A remoção apaga a linha; o arquivo é apagado pelo navegador em seguida (política de DELETE = pode_editar_imovel).
-- Apagar direto em storage.objects deixaria o arquivo órfão no armazenamento do Storage.

-- ============ STATUS (E2; tabela §3.8) ============
-- RA → PE: criador (permite_criador) ou interno, com IMV-2 (CAMPOS_OBRIGATORIOS com detail {campos}).
-- PE → RE, RE → AP: internos. RE → RA: internos, com observação obrigatória (vai para observacao_revisao).
-- AP ↔ NC: só o sistema (envio do contrato e retorno do D4Sign); pelo usuário dá 42501 em _transicionar.
-- Escopo: só quem enxerga o imóvel pela regra E4. Os papéis e o criador são conferidos por _transicionar.
-- Imóvel inativado não muda de status (caminho conservador: a inativação encerra o fluxo).
-- IMV-2 vale em todo o caminho até a aprovação (PE, RE e AP), não só na saída do rascunho: imóvel incompleto não
-- avança na revisão nem é aprovado (a devolução RE → RA continua livre, para o ajuste).
-- A observação da devolução é só para quem ajusta o rascunho: sai do imóvel quando ele deixa o rascunho de novo e na
-- aprovação (depois de AP a linha é legível por todos os parceiros aprovados). O texto continua em historico_status,
-- que só internos leem.
create or replace function public.imovel_mudar_status(p_id uuid, p_para public.status_imovel, p_obs text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_imovel public.imoveis%rowtype;
  v_de text;
  v_obs text := nullif(btrim(coalesce(p_obs, '')), '');
  v_campos text[];
  v_limpou boolean := false;
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_imovel from public.imoveis i where i.id = p_id for update;
  if not found or not public.pode_ver_imovel(p_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_imovel.inativado_em is not null then
    raise exception 'Imóvel inativado não muda de status.' using errcode = 'P0001';
  end if;

  -- papéis, criador, linha ativa da tabela, observação e (em RA → PE) IMV-2: tudo em _transicionar
  v_de := public._transicionar('imovel', p_id, p_para::text, v_obs, 'usuario');

  -- IMV-2 também em PE → RE e RE → AP (dado antigo ou gravado fora do fluxo). Vem depois de _transicionar para que
  -- quem não pode mudar o status receba 42501, e não a lista de campos; o raise desfaz a transição acima.
  if p_para in ('pendente', 'em_revisao', 'aprovado') then
    v_campos := public._imovel_campos_faltando(p_id);
    if cardinality(v_campos) > 0 then
      raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001',
        detail = jsonb_build_object('campos', to_jsonb(v_campos))::text;
    end if;
  end if;

  if v_de = 'rascunho' or p_para = 'aprovado' then
    update public.imoveis i set observacao_revisao = null where i.id = p_id and i.observacao_revisao is not null;
    v_limpou := found;
  end if;

  perform public._auditar(
    'operacao', 'mudar_status', 'imoveis', p_id::text, null,
    case when (v_de = 'em_revisao' and p_para = 'rascunho') or v_limpou then array['status', 'observacao_revisao']
         else array['status'] end,
    jsonb_build_object('status', v_de),
    jsonb_build_object('status', p_para),
    -- a observação é texto livre: fica em historico_status/observacao_revisao, nunca na auditoria
    jsonb_build_object('com_observacao', v_obs is not null)
      || case when v_limpou then '{"observacao_removida":true}'::jsonb else '{}'::jsonb end);
end $$;

-- ============ FOTOS ============
-- Registra a foto já enviada ao bucket. Quem pode: pode_editar_imovel (criador aprovado em RA/PE; internos).
-- Confere: formato e prefixo dos caminhos; objetos existentes no bucket 'imoveis'; tamanho real ≤
-- configuracao_geral.imovel_foto_max_bytes; tipo jpeg/png/webp; caminhos ainda não registrados; quantidade
-- < configuracao_geral.imovel_fotos_max (LIMITE_FOTOS com detail {maximo}). A foto nova entra no fim da ordem.
create or replace function public.imovel_foto_registrar(p_imovel_id uuid, p_path text, p_miniatura_path text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_formato constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-z-]{1,80}\.(webp|jpg|jpeg|png)$';
  v_tipos constant text[] := array['image/jpeg', 'image/png', 'image/webp'];
  v_imovel public.imoveis%rowtype;
  v_cfg public.configuracao_geral%rowtype;
  v_path text := btrim(coalesce(p_path, ''));
  v_min text := nullif(btrim(coalesce(p_miniatura_path, '')), '');
  v_obj jsonb;
  v_min_obj jsonb;
  v_bytes bigint;
  v_min_bytes bigint;
  v_largura int;
  v_altura int;
  v_qtd int;
  v_id uuid;
begin
  if v_uid is null or p_imovel_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_imovel from public.imoveis i where i.id = p_imovel_id for update;
  if not found or not public.pode_editar_imovel(p_imovel_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_imovel.inativado_em is not null then
    raise exception 'Imóvel inativado não pode ser alterado.' using errcode = 'P0001';
  end if;

  -- caminhos: <imovel_id>/<nome>.<ext>, sempre na pasta deste imóvel, principal ≠ miniatura
  if v_path !~ v_formato or split_part(v_path, '/', 1) <> p_imovel_id::text
     or (v_min is not null and (v_min !~ v_formato or split_part(v_min, '/', 1) <> p_imovel_id::text or v_min = v_path)) then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"caminho"}';
  end if;
  if exists (select 1 from public.imovel_fotos f
             where f.storage_path in (v_path, v_min) or f.miniatura_path in (v_path, v_min)) then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"ja_registrado"}';
  end if;

  select * into v_cfg from public.configuracao_geral c;

  -- quantidade (a linha do imóvel está travada: dois registros simultâneos não passam do limite)
  select count(*) into v_qtd from public.imovel_fotos f where f.imovel_id = p_imovel_id;
  if v_qtd >= v_cfg.imovel_fotos_max then
    raise exception 'LIMITE_FOTOS' using errcode = 'P0001',
      detail = jsonb_build_object('maximo', v_cfg.imovel_fotos_max)::text;
  end if;

  -- objetos reais no Storage (to_jsonb: tolera versões do Storage sem a coluna user_metadata)
  select to_jsonb(o) into v_obj from storage.objects o where o.bucket_id = 'imoveis' and o.name = v_path;
  if v_obj is null then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"nao_encontrado"}';
  end if;
  if v_min is not null then
    select to_jsonb(o) into v_min_obj from storage.objects o where o.bucket_id = 'imoveis' and o.name = v_min;
    if v_min_obj is null then
      raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001', detail = '{"motivo":"nao_encontrado"}';
    end if;
  end if;

  v_bytes := case when (v_obj #>> '{metadata,size}') ~ '^\d{1,12}$' then (v_obj #>> '{metadata,size}')::bigint end;
  if v_bytes is null or v_bytes < 1 or v_bytes > v_cfg.imovel_foto_max_bytes
     or coalesce(lower(v_obj #>> '{metadata,mimetype}'), '') <> all (v_tipos) then
    raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001',
      detail = jsonb_build_object('motivo', 'tamanho_ou_tipo', 'max_bytes', v_cfg.imovel_foto_max_bytes)::text;
  end if;
  if v_min is not null then
    v_min_bytes := case when (v_min_obj #>> '{metadata,size}') ~ '^\d{1,12}$' then (v_min_obj #>> '{metadata,size}')::bigint end;
    if v_min_bytes is null or v_min_bytes < 1 or v_min_bytes > v_cfg.imovel_foto_max_bytes
       or coalesce(lower(v_min_obj #>> '{metadata,mimetype}'), '') <> all (v_tipos) then
      raise exception 'ARQUIVO_INVALIDO' using errcode = 'P0001',
        detail = jsonb_build_object('motivo', 'tamanho_ou_tipo', 'max_bytes', v_cfg.imovel_foto_max_bytes)::text;
    end if;
  end if;

  -- dimensões informadas no upload (informativas; fora do intervalo ficam nulas)
  v_largura := case when (v_obj #>> '{user_metadata,largura}') ~ '^\d{1,5}$'
                     and (v_obj #>> '{user_metadata,largura}')::int between 1 and 20000
                    then (v_obj #>> '{user_metadata,largura}')::int end;
  v_altura := case when (v_obj #>> '{user_metadata,altura}') ~ '^\d{1,5}$'
                    and (v_obj #>> '{user_metadata,altura}')::int between 1 and 20000
                   then (v_obj #>> '{user_metadata,altura}')::int end;

  insert into public.imovel_fotos (imovel_id, storage_path, miniatura_path, ordem, largura, altura, bytes, criado_por)
  values (p_imovel_id, v_path, v_min,
          (select coalesce(max(f.ordem) + 1, 0) from public.imovel_fotos f where f.imovel_id = p_imovel_id),
          v_largura, v_altura, v_bytes::int, v_uid)
  returning id into v_id;

  perform public._auditar(
    'operacao', 'criar', 'imovel_fotos', v_id::text, null, null, null, null,
    jsonb_build_object('imovel_id', p_imovel_id, 'bytes', v_bytes, 'miniatura', v_min is not null));
  return v_id;
end $$;

-- Remove o registro da foto e fecha a ordem das restantes. Quem pode: pode_editar_imovel (inclusive internos em
-- imóvel inativado, para retirar conteúdo impróprio). O navegador apaga os arquivos do bucket em seguida.
create or replace function public.imovel_foto_remover(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_foto public.imovel_fotos%rowtype;
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_foto from public.imovel_fotos f where f.id = p_id;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  -- trava o imóvel (mesma ordem de travas das demais RPCs) e relê a foto já sob a trava
  perform 1 from public.imoveis i where i.id = v_foto.imovel_id for update;
  select * into v_foto from public.imovel_fotos f where f.id = p_id for update;
  if not found or not public.pode_editar_imovel(v_foto.imovel_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;

  delete from public.imovel_fotos f where f.id = p_id;
  -- ordem contínua (0, 1, 2…) depois da remoção
  update public.imovel_fotos f set ordem = (x.pos - 1)::smallint
    from (select g.id, row_number() over (order by g.ordem, g.criado_em, g.id) as pos
          from public.imovel_fotos g where g.imovel_id = v_foto.imovel_id) x
   where f.id = x.id and f.ordem is distinct from (x.pos - 1)::smallint;

  perform public._auditar(
    'operacao', 'excluir', 'imovel_fotos', p_id::text, null, null, null, null,
    jsonb_build_object('imovel_id', v_foto.imovel_id));
end $$;

-- Nova ordem das fotos: p_ids = TODAS as fotos do imóvel, cada uma uma vez, na ordem desejada (a primeira é a capa).
-- Lista incompleta, repetida ou com foto de outro imóvel → DADOS_INVALIDOS {motivo:'lista_fotos'}.
create or replace function public.imovel_fotos_ordenar(p_imovel_id uuid, p_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_imovel public.imoveis%rowtype;
  v_qtd int;
  v_n int := coalesce(cardinality(p_ids), 0);
begin
  if v_uid is null or p_imovel_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_imovel from public.imoveis i where i.id = p_imovel_id for update;
  if not found or not public.pode_editar_imovel(p_imovel_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_imovel.inativado_em is not null then
    raise exception 'Imóvel inativado não pode ser alterado.' using errcode = 'P0001';
  end if;

  select count(*) into v_qtd from public.imovel_fotos f where f.imovel_id = p_imovel_id;
  if v_n <> v_qtd or array_position(p_ids, null) is not null
     or (select count(distinct x) from unnest(p_ids) x) <> v_n
     or exists (select 1 from unnest(p_ids) x
                where not exists (select 1 from public.imovel_fotos f where f.id = x and f.imovel_id = p_imovel_id)) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"motivo":"lista_fotos"}';
  end if;

  update public.imovel_fotos f set ordem = (x.pos - 1)::smallint
    from unnest(p_ids) with ordinality as x(id, pos)
   where f.id = x.id and f.imovel_id = p_imovel_id and f.ordem is distinct from (x.pos - 1)::smallint;

  perform public._auditar(
    'operacao', 'ordenar_fotos', 'imoveis', p_imovel_id::text, null, array['ordem'], null, null,
    jsonb_build_object('fotos', v_n));
end $$;

-- ============ INATIVAÇÃO ============
-- Só internos. Sem contrato ativo (qualquer status fora de recusado/expirado/cancelado/arquivado, inclusive
-- assinado) → CONTRATO_ATIVO. Motivo com pelo menos 5 caracteres (MOTIVO_OBRIGATORIO), guardado no imóvel
-- (motivo_inativacao) e fora da auditoria. Não há reativação nesta etapa. O imóvel inativado some para os
-- parceiros fora da cadeia (E4) e não entra em contrato novo (valor_produto_atual exige imóvel ativo).
create or replace function public.imovel_inativar(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_imovel public.imoveis%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null or p_id is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_imovel from public.imoveis i where i.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_imovel.inativado_em is not null then
    raise exception 'Este imóvel já está inativado.' using errcode = 'P0001';
  end if;
  if v_motivo is null or length(v_motivo) < 5 then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001';
  end if;
  if v_imovel.status = 'no_contrato'
     or exists (select 1 from public.contratos k where k.imovel_id = p_id
                  and k.status not in ('recusado', 'expirado', 'cancelado', 'arquivado')) then
    raise exception 'CONTRATO_ATIVO' using errcode = 'P0001';
  end if;

  update public.imoveis i
     set inativado_em = now(), inativado_por = v_uid, motivo_inativacao = left(v_motivo, 2000)
   where i.id = p_id;

  perform public._auditar(
    'operacao', 'inativar', 'imoveis', p_id::text, null, array['inativado_em', 'motivo_inativacao'],
    jsonb_build_object('status', v_imovel.status, 'inativado', false),
    jsonb_build_object('status', v_imovel.status, 'inativado', true),
    '{}'::jsonb);
end $$;

-- ============ IMV-2 FORA DO RASCUNHO (gatilho) ============
-- O rascunho pode ficar incompleto; depois que sai dele (PE, RE, AP, NC), nenhum campo do IMV-2 pode ser esvaziado,
-- nem pelo criador em PE nem pelo interno em qualquer status: senão um imóvel aprovado ficaria visível a todos os
-- parceiros, e disponível para contrato, sem valor ou sem endereço. Só age quando um campo do IMV-2 muda (UPDATE OF +
-- WHEN): mudanças de status, da cadeia e dos demais campos não passam por aqui. AFTER: _imovel_campos_faltando() lê a
-- linha já gravada (lista única, a mesma da transição RA → PE). O raise desfaz o UPDATE inteiro.
-- security definer: _imovel_campos_faltando() não tem grant para authenticated (função interna).
create function public._imoveis_campos_obrigatorios() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_campos text[];
begin
  v_campos := public._imovel_campos_faltando(new.id);
  if cardinality(v_campos) > 0 then
    raise exception 'CAMPOS_OBRIGATORIOS' using errcode = 'P0001',
      detail = jsonb_build_object('campos', to_jsonb(v_campos))::text;
  end if;
  return null;
end $$;

create trigger imoveis_campos_obrigatorios
  after update of nome, tipo, cep, logradouro, numero, cidade, uf, valor on public.imoveis
  for each row
  when (new.status <> 'rascunho'
        and (old.nome, old.tipo, old.cep, old.logradouro, old.numero, old.cidade, old.uf, old.valor)
            is distinct from (new.nome, new.tipo, new.cep, new.logradouro, new.numero, new.cidade, new.uf, new.valor))
  execute function public._imoveis_campos_obrigatorios();

revoke execute on function public._imoveis_campos_obrigatorios() from public, anon, authenticated, service_role;
