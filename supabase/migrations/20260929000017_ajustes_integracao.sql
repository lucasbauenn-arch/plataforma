-- Ajustes de integração (WP7; docs/ARQUITETURA_EXPANSAO.md §3.4 "profiles", §4.2, §4.6, §10.1).
-- Correções que caberiam nas 20260929000001–09 (já aplicadas no remoto e, por isso, nunca editadas) e ajustes entre
-- pacotes apontados nas revisões da onda 1. As correções nas 10–16 (ainda não aplicadas em lugar nenhum) foram feitas
-- nos próprios arquivos; o corte e a contração ficam na 20260929000018.
-- Nenhuma referência a objeto de migration posterior.

-- ============ PROFILES: nenhuma escrita direta pela API (WP1R-03, WP1R-05) ============
-- A 20260921000002 deu UPDATE de TABELA em profiles a authenticated (a 03 só tirou INSERT e DELETE). Com isso, pela
-- política "profile: editar o próprio", cada usuário trocava o próprio e-mail, CPF, CRECI e até o id da linha
-- (WP1R-03: um autocadastro pendente trocava o e-mail antes da aprovação), e um interno contornava as transições da
-- rede com um PATCH em status_parceiro (WP1R-05: o protege_campos_profile v3 só barrava a troca de ou para 'inativo';
-- um autocadastro pendente ou recusado virava 'aprovado' sem rede_aprovar_autocadastro).
-- Nenhuma tela grava em profiles pela API: papel é equipe_definir_papel (Super), status é das RPCs da rede
-- (aprovar, recusar, bloquear, desbloquear, inativar, reativar), dados de contato do parceiro são
-- rede_atualizar_meu_cadastro (que copia nome e telefone para o perfil) e o cliente do portal é gravado pela
-- service role. Caminho conservador: authenticated só LÊ profiles (a própria linha; internos, todas). As políticas
-- de UPDATE e o protege_campos_profile (v4 na 18) ficam como defesa em profundidade; service role e RPCs não mudam.
revoke update on public.profiles from authenticated;

-- ============ EXCLUSÃO DE USUÁRIO PELO AUTH: auditoria das cascatas (achado do teste na stack real, WP7) ============
-- auth.admin.deleteUser (GoTrue, papel supabase_auth_admin) apaga auth.users; o ON DELETE SET NULL de
-- clientes.user_id (usuário do portal) e o CASCADE para profiles → SET NULL de parceiros.profile_id (login de parceiro)
-- disparam o gatilho auditar_linha (security invoker) como supabase_auth_admin, que não executava a ponte
-- auditar_linha_gravar: o GoTrue respondia "Database error deleting user" (42501) e a lgpd-anonimizar terminava em
-- 502 remocao_incompleta, sem nunca conseguir remover o acesso do titular ao portal. A ponte continua recusando
-- chamada fora de gatilho (pg_trigger_depth); o registro sai com origem 'trigger' e ator nulo (o sistema).
grant execute on function public.auditar_linha_gravar(public.categoria_auditoria, text, text, text, uuid, text[], jsonb, jsonb)
  to supabase_auth_admin;

-- ============ AVISO "NOVO PARCEIRO": só cadastro espontâneo, avaliado no COMMIT (achado do teste na stack real) ============
-- notificar_evento (20260921000005) já ignora contas convidadas (auth.users.invited_at) e as do portal, mas o gatilho
-- AFTER INSERT em profiles roda DENTRO do insert em auth.users: o GoTrue cria o usuário e só depois, na mesma
-- transação, grava invited_at (generateLink/inviteUserByEmail). Assim todo convite da rede (convidar-parceiros, até 50
-- por vez) mandava à equipe "Novo parceiro aguardando aprovação" com o nome e o e-mail do convidado, que já entra
-- aprovado. Como gatilho de restrição adiado, a checagem roda no fim da transação, com invited_at já gravado; o
-- autocadastro (signUp, sem convite) continua avisando a equipe. Mesmo nome, mesma condição, mesma função.
drop trigger notificar_novo_parceiro on public.profiles;
create constraint trigger notificar_novo_parceiro after insert on public.profiles
  deferrable initially deferred
  for each row when (new.papel = 'parceiro')
  execute function public.notificar_evento();

-- ============ REVISÃO FINAL (WP7): auditoria, Storage, transições e aviso de conta do portal ============

-- ---- WP7R1-06: acesso_negado com teto por ator ----
-- As RPCs de leitura registram 'acesso_negado' para qualquer id fora do escopo (§4.6) e devolvem nulo sem lançar, então
-- o registro fica. A auditoria é somente inclusão e só é purgada depois de 24 meses: uma conta descartável (autocadastro
-- pendente, sessão do portal) enchia o banco e poluía o histórico por titular com ids que ela escolhia.
-- Agora: até 30 negações por ator em 10 minutos ficam registradas uma a uma; acima disso entra UM registro-resumo por
-- janela (detalhe.limitado = true, sem id nem titular) e o resto não grava nada. O titular (cliente_id) só é gravado
-- quando o cliente existe: um id inexistente não vira "titular" de nada. Mesma assinatura e mesmo corpo da v2 (04).
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
  c_max_negacoes constant int := 30;
  c_janela constant interval := interval '10 minutes';
  v_uid uuid := auth.uid();
  v_papel public.papel;
  v_parceiro uuid;
  v_cab jsonb;
  v_ip inet;
  v_ua text;
  v_n int;
  v_resumo boolean;
begin
  if p_acao = 'acesso_negado' then
    if v_uid is not null then
      select count(*), coalesce(bool_or(a.detalhe ? 'limitado'), false) into v_n, v_resumo
        from public.auditoria a
       where a.ator_id = v_uid and a.acao = 'acesso_negado' and a.ocorrido_em > now() - c_janela;
      if v_n >= c_max_negacoes then
        if v_resumo then
          return;
        end if;
        p_entidade_id := null;
        p_cliente_id := null;
        p_detalhe := jsonb_build_object('limitado', true, 'limite', c_max_negacoes, 'janela_minutos', 10);
      end if;
    end if;
    if p_cliente_id is not null and not exists (select 1 from public.clientes c where c.id = p_cliente_id) then
      p_cliente_id := null;
    end if;
  end if;
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

-- ---- WP7R1-04: o Storage não se esgota com envios sem registro ----
-- O INSERT em crm-documentos e imoveis só confere o formato do caminho e a permissão sobre o documento/imóvel; o nome
-- do objeto (um uuid) é de quem envia e o registro do envio é opcional. Sem teto, cada titular do portal (que entra só
-- com o CPF e sempre tem documentos pendentes) e cada corretor do escopo enviava objetos de até 5 MB sem parar, e nada
-- limpava objeto sem registro: o bucket (1 GB no plano gratuito) enchia e parava os uploads do projeto inteiro,
-- inclusive o PDF assinado gravado pelo webhook do D4Sign. Objeto REGISTRADO (cliente_documento_arquivos; imovel_fotos)
-- é limitado pelas próprias RPCs (só entra em documento pendente ou rejeitado; máximo de fotos); o que enche o bucket é
-- o objeto SEM registro. Tetos: 20 por usuário no bucket e, em crm-documentos, 10 por usuário em cada pasta de
-- documento (FR1-05: o teto da pasta conta os objetos DE QUEM ENVIA; contando os de todos, quem tem escopo sobre o
-- cliente e sobe 10 objetos sem registro bloqueava o titular do portal e os demais nesse documento, e a equipe só
-- liberava apagando à mão); em imoveis, 20 por usuário e 2 × imovel_fotos_max + 10 por pasta do imóvel (original +
-- miniatura; quem edita o imóvel é da equipe). Quem passa do teto recebe o 42501 da política (o upload falha); a
-- equipe libera apagando os objetos órfãos pelo painel do Storage (a limpeza automática dos órfãos com mais de 24 h
-- é pendência: precisa de Edge com a service role e da API do Storage; apagar por SQL não remove o arquivo do S3).
create function public._storage_sem_registro_do_usuario(p_bucket text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects o
   where o.bucket_id = p_bucket
     and coalesce(nullif(o.owner_id, ''), o.owner::text) = (select auth.uid())::text
     and case p_bucket
           when 'crm-documentos' then not exists (select 1 from public.cliente_documento_arquivos a where a.storage_path = o.name)
           when 'imoveis' then not exists (select 1 from public.imovel_fotos f
                                          where f.storage_path = o.name or f.miniatura_path = o.name)
           else false
         end
$$;
revoke execute on function public._storage_sem_registro_do_usuario(text) from public, anon, authenticated, service_role;

create or replace function public.pode_enviar_documento(p_objeto text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_objeto ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf|doc|docx|xls|xlsx|csv)$', false)
     and exists (select 1 from public.cliente_documentos d
       where d.cliente_id::text = split_part(p_objeto, '/', 1) and d.id::text = split_part(p_objeto, '/', 2)
         and d.status in ('pendente', 'rejeitado') and d.inativado_em is null
         and (public.pode_ver_cliente(d.cliente_id) or d.cliente_id = public.meu_cliente_id()))
     and public._storage_sem_registro_do_usuario('crm-documentos') < 20
     and (select count(*) from storage.objects o
           where o.bucket_id = 'crm-documentos'
             and o.name like split_part(p_objeto, '/', 1) || '/' || split_part(p_objeto, '/', 2) || '/%'
             and coalesce(nullif(o.owner_id, ''), o.owner::text) = (select auth.uid())::text
             and not exists (select 1 from public.cliente_documento_arquivos a where a.storage_path = o.name)) < 10
$$;

create function public.pode_enviar_foto_imovel(p_objeto text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_objeto ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-z-]{1,80}\.(webp|jpg|jpeg|png)$', false)
     and public.pode_editar_imovel(
           case when p_objeto ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                then split_part(p_objeto, '/', 1)::uuid end)
     and public._storage_sem_registro_do_usuario('imoveis') < 20
     and (select count(*) from storage.objects o
           where o.bucket_id = 'imoveis' and o.name like split_part(p_objeto, '/', 1) || '/%')
         < (select 2 * c.imovel_fotos_max + 10 from public.configuracao_geral c)
$$;
revoke execute on function public.pode_enviar_foto_imovel(text) from public, anon;
grant execute on function public.pode_enviar_foto_imovel(text) to authenticated, service_role;

drop policy "storage imoveis: envio" on storage.objects;
create policy "storage imoveis: envio" on storage.objects for insert to authenticated
  with check (bucket_id = 'imoveis' and public.pode_enviar_foto_imovel(name));

-- ---- WP7RN-04: linhas de transição só do sistema não se desligam ----
-- O Super edita `ativa` (09: grant update em papeis, exige_motivo, ativa). Desligar uma saída de assinatura_pendente
-- faz contrato_registrar_retorno falhar com TRANSICAO_INVALIDA: o webhook e o reconciliador repetem para sempre, o
-- contrato assinado fica em assinatura_pendente e o cliente não vai a FI (CTR-2, CTR-4, D5); desligar imóvel aprovado
-- ↔ no_contrato faz o efeito imovel_aprovado/imovel_no_contrato levantar erro. Essas 6 linhas ficam sempre ativas;
-- em_analise → assinatura_pendente continua desligável (é a forma de suspender os envios) e as demais também.
-- Mesmo corpo da 08 mais a regra do fim (CREATE OR REPLACE preserva o gatilho).
create or replace function public._status_transicoes_valida() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_valores text[];
  v_x text;
begin
  v_valores := case new.entidade
    when 'cliente_etapa' then enum_range(null::public.etapa_funil)::text[]
    when 'documento' then enum_range(null::public.status_documento)::text[]
    when 'contrato' then enum_range(null::public.status_contrato)::text[]
    when 'imovel' then enum_range(null::public.status_imovel)::text[]
  end;
  if new.de <> all (v_valores) or new.para <> all (v_valores) then
    raise exception 'Status inválido para a entidade % (% → %)', new.entidade, new.de, new.para using errcode = '23514';
  end if;

  foreach v_x in array new.validacoes loop
    if not (case v_x
              when 'contrato_assinado' then new.entidade = 'cliente_etapa'
              when 'campos_obrigatorios_imovel' then new.entidade = 'imovel'
              when 'arquivo_enviado' then new.entidade = 'documento'
              else new.entidade = 'contrato'
            end) then
      raise exception 'A validação % não se aplica a %', v_x, new.entidade using errcode = '23514';
    end if;
  end loop;
  foreach v_x in array new.efeitos loop
    if not (case v_x
              when 'solicitar_documentos_basicos' then new.entidade = 'cliente_etapa'
              when 'limpar_motivo_perda' then new.entidade = 'cliente_etapa'
              when 'notificar_documento_rejeitado' then new.entidade = 'documento'
              else new.entidade = 'contrato'
            end) then
      raise exception 'O efeito % não se aplica a %', v_x, new.entidade using errcode = '23514';
    end if;
  end loop;

  if 'colaborador' = any (new.papeis)
     or ('cliente' = any (new.papeis) and not (new.entidade = 'documento' and new.para = 'em_analise')) then
    raise exception 'Papel não permitido nesta transição' using errcode = '23514';
  end if;
  if cardinality(new.papeis) > 0
     and ((new.entidade = 'contrato' and new.para in ('assinatura_pendente', 'assinado', 'recusado', 'expirado'))
          or (new.entidade = 'imovel' and 'no_contrato' in (new.de, new.para))) then
    raise exception 'Esta transição é só do sistema' using errcode = '23514';
  end if;
  if new.entidade = 'contrato' and new.de = 'assinatura_pendente'
     and not (new.papeis <@ array['admin', 'super']::public.papel[]) then
    raise exception 'A saída da assinatura pendente depende do D4Sign: só admin e super' using errcode = '23514';
  end if;
  -- WP7RN-04: as saídas de assinatura_pendente (retorno do D4Sign e cancelamento) e a troca aprovado ↔ no_contrato do
  -- imóvel são o que o webhook e o reconciliador acionam: sempre ativas
  if not new.ativa
     and ((new.entidade = 'contrato' and new.de = 'assinatura_pendente')
          or (new.entidade = 'imovel' and (new.de, new.para) in (('aprovado', 'no_contrato'), ('no_contrato', 'aprovado')))) then
    raise exception 'Esta transição é acionada pelo sistema (D4Sign e imóvel do contrato) e não pode ser desligada'
      using errcode = '23514';
  end if;
  return new;
end $$;

-- ---- WP7R1-02: aviso de conta com o e-mail interno do portal ----
-- Contas do portal são criadas pela Edge cliente-login com o marcador app_metadata.portal_cliente_id (só a service role
-- grava app_metadata). O aviso "novo parceiro" seguia ignorando QUALQUER cadastro com o domínio do portal, o que
-- escondia da equipe quem se cadastra pelo signUp público com o e-mail interno de um cliente (para assumir o portal
-- dele no primeiro login por CPF). Agora só a conta com o marcador é ignorada; o cadastro espontâneo com o e-mail do
-- portal e SEM o marcador avisa a equipe como qualquer autocadastro (e o cliente-login nunca a adota). Mesmo corpo
-- da 05; o gatilho adiado (acima) avalia no fim da transação, com o app_metadata já gravado.
create or replace function public.notificar_evento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notificar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'notificar_secret';
  if v_url is null or v_segredo is null then return null; end if;
  -- novo parceiro: só cadastro espontâneo (convidados já entram aprovados; contas do portal levam o marcador)
  -- (if aninhado: new.email só existe em profiles; a expressão não pode ser preparada para as outras tabelas)
  if tg_table_name = 'profiles' then
    if exists (select 1 from auth.users u where u.id = new.id
                and (u.invited_at is not null
                     or (coalesce(new.email, '') like '%@portal.arkenincorporadora.com.br'
                         and u.raw_app_meta_data ? 'portal_cliente_id'))) then
      return null;
    end if;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_segredo),
    body := jsonb_build_object(
      'tabela', tg_table_name,
      'evento', tg_op,
      'registro', to_jsonb(new),
      'anterior', case when tg_op = 'UPDATE' then to_jsonb(old) end
    )
  );
  return null;
exception when others then
  raise warning 'notificar_evento: %', sqlerrm;
  return null;
end $$;
