-- CRM: cadastro, ficha, lista, duplicidades, leads, propostas e pré-cadastro — corpos das RPCs [WP2]
-- (docs/ARQUITETURA_EXPANSAO.md §1.1 A1/A2/N9/N11/N12/N16, §1.3, §3.4, §3.5, §4.4, §4.5, §4.6, §5.2, §5.4, §6.1,
-- §7.3; docs_new/modulo-crm.md §1–§2, regras-negocio.md PAR-3/PAR-7/CRM-2/CRM-3).
-- Troca os corpos dos esqueletos da 20260929000009 com create or replace, com a MESMA assinatura (preserva dono e
-- grants: execute só para authenticated; crm_pre_cadastro só para service_role) e devolve o JSON no formato de
-- src/modulos/crm/tipos.ts. Aditivo: funções internas novas (prefixo _crmcad_, sem grant a ninguém), a tabela
-- pre_cadastro_avisos (RLS, só a service role lê e apaga) e um índice parcial em cliente_duplicidades.
--
-- Regras comuns (§4.4, §4.6):
-- - security definer ignora a RLS: o escopo é conferido aqui, explicitamente, com os helpers da 09;
-- - leitura de um registro fora do escopo (ou inexistente) devolve NULO e grava 'acesso_negado' com o cliente_id;
--   escrita fora do escopo dá 42501 'Sem acesso a este registro' (mesma mensagem para inexistente) e não grava nada;
-- - listas sem vínculo nenhum (pendente, bloqueado, inativo, titular do portal, colaborador) dão 42501;
-- - a auditoria nunca guarda texto livre nem dado pessoal: só ids, status, etapas, contagens e NOMES de campos
--   (a busca vira {busca: true});
-- - PAR-3: nomes de quem está acima ou ao lado de quem consulta saem nulos (cadeia) ou genéricos (autor/ator);
--   a visibilidade de um parceiro é a mesma da política "parceiros: escopo lê" (o próprio vínculo, os corretores do
--   gerente, a imobiliária inteira); internos veem tudo;
-- - A2 (duplicidade): uma pessoa = um registro. Qualquer tentativa com documento já existente fora do escopo de
--   quem cadastra é bloqueada com resposta genérica (sem dono nem data), registrada em cliente_duplicidades e na
--   timeline do dono (sem dizer por quem); dentro do escopo, "já está na sua carteira". Nunca há transferência
--   automática. O limite de bloqueios por hora (configuracao_geral.duplicidade_bloqueios_hora) é conferido ANTES de
--   olhar o documento, para a resposta não virar oráculo de CPF, com trava consultiva por usuário (chamadas
--   simultâneas esperam a anterior gravar a tentativa); no pré-cadastro, o mesmo limite por link (dono do código).
--   Trava consultiva por documento contra corrida.
-- - pré-cadastro público (§6.1): criado e duplicado dão a mesma resposta E o mesmo e-mail (confirmação para o
--   endereço digitado, pela tabela pre_cadastro_avisos), para nenhum canal revelar se o CPF está na base.
-- - a cadeia (gerente_id, imobiliaria_id) é sempre derivada do corretor pelo gatilho clientes_cadeia; a origem,
--   a etapa (novo_contato, CRM-2) e portal_liberado nunca vêm do front.

-- ============ FUNÇÕES INTERNAS (sem grant; só as RPCs deste arquivo chamam) ============

-- p_filtros / p_dados precisam ser objeto (ou nulo = vazio)
create function public._crmcad_objeto(p jsonb, p_nome text)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_nome))::text;
  end if;
  return p;
end $$;

-- texto de uma chave: string aparada ('' = nulo), número como texto, nulo/ausente = nulo; outro tipo = marcador de
-- inválido (chr(1)), para o chamador acumular a lista de campos inválidos
create function public._crmcad_txt(p jsonb, p_chave text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p -> p_chave is null or jsonb_typeof(p -> p_chave) = 'null' then null
    when jsonb_typeof(p -> p_chave) = 'string' then nullif(btrim(p ->> p_chave), '')
    when jsonb_typeof(p -> p_chave) = 'number' then p ->> p_chave
    else chr(1) end
$$;

-- lista de textos de uma chave: nulo/ausente = nulo; não lista ou item que não é texto = {chr(1)}
create function public._crmcad_lista(p jsonb, p_chave text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p -> p_chave is null or jsonb_typeof(p -> p_chave) = 'null' then null
    when jsonb_typeof(p -> p_chave) <> 'array' then array[chr(1)]
    when exists (select 1 from jsonb_array_elements(p -> p_chave) e where jsonb_typeof(e) <> 'string') then array[chr(1)]
    else coalesce((select array_agg(btrim(e) order by o) from jsonb_array_elements_text(p -> p_chave) with ordinality as t(e, o)
                   where btrim(e) <> ''), '{}'::text[])
  end
$$;

-- lista normalizada (já validada) de volta para text[]
create function public._crmcad_arr(p jsonb, p_chave text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce((select array_agg(e order by o) from jsonb_array_elements_text(p -> p_chave) with ordinality as t(e, o)),
                  '{}'::text[])
$$;

-- filtros: valor ausente/nulo/vazio = sem filtro; tipo errado = DADOS_INVALIDOS
create function public._crmcad_filtro_uuid(p jsonb, p_chave text)
returns uuid language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p ->> p_chave, '')), '');
begin
  if v is null then
    return null;
  end if;
  if jsonb_typeof(p -> p_chave) <> 'string' or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  return v::uuid;
end $$;

create function public._crmcad_filtro_data(p jsonb, p_chave text)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p ->> p_chave, '')), '');
begin
  if v is null then
    return null;
  end if;
  if jsonb_typeof(p -> p_chave) <> 'string' or v !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  begin
    return v::date;
  exception when others then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end;
end $$;

create function public._crmcad_filtro_bool(p jsonb, p_chave text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p -> p_chave is null or jsonb_typeof(p -> p_chave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_chave) <> 'boolean' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  return (p -> p_chave)::boolean;
end $$;

create function public._crmcad_filtro_int(p jsonb, p_chave text)
returns int language plpgsql immutable set search_path = '' as $$
begin
  if p -> p_chave is null or jsonb_typeof(p -> p_chave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_chave) <> 'number' or (p ->> p_chave) !~ '^\d{1,9}$' then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  return (p ->> p_chave)::int;
end $$;

-- texto de filtro que precisa estar numa lista fechada (status, resultado, origem…); nulo = sem filtro
create function public._crmcad_filtro_opcao(p jsonb, p_chave text, p_opcoes text[])
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p ->> p_chave, '')), '');
begin
  if v is null then
    return null;
  end if;
  if jsonb_typeof(p -> p_chave) <> 'string' or not (v = any (p_opcoes)) then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(p_chave))::text;
  end if;
  return v;
end $$;

-- padrão ILIKE com %, _ e \ escapados (até 100 caracteres); nulo = sem busca
create function public._crmcad_padrao(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select case when nullif(btrim(coalesce(p_texto, '')), '') is null then null
    else '%' || replace(replace(replace(left(btrim(p_texto), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' end
$$;

create function public._crmcad_busca(p jsonb)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p -> 'busca' is not null and jsonb_typeof(p -> 'busca') not in ('string', 'null') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["busca"]}';
  end if;
  return public._crmcad_padrao(p ->> 'busca');
end $$;

-- só os dígitos da busca, para achar telefone (mínimo 4); nulo = não busca por telefone
create function public._crmcad_busca_digitos(p jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when length(regexp_replace(coalesce(p ->> 'busca', ''), '\D', '', 'g')) >= 4
              then '%' || left(regexp_replace(p ->> 'busca', '\D', '', 'g'), 20) || '%' end
$$;

create function public._crmcad_hoje()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

create function public._crmcad_rotulo_etapa(p_etapa public.etapa_funil)
returns text language sql immutable set search_path = '' as $$
  select case p_etapa
    when 'novo_contato' then 'Novo contato' when 'contato_iniciado' then 'Contato iniciado'
    when 'documentacao' then 'Documentação' when 'finalizado' then 'Finalizado' when 'perdido' then 'Perdido' end
$$;

create function public._crmcad_rotulo_proposta(p_status public.status_proposta)
returns text language sql immutable set search_path = '' as $$
  select case p_status
    when 'enviada' then 'Enviada' when 'em_analise' then 'Em análise' when 'aprovada' then 'Aprovada'
    when 'recusada' then 'Recusada' end
$$;

-- opções de interesse: as mesmas de INTERESSES (src/lib/constants.ts)
create function public._crmcad_interesses()
returns text[] language sql immutable set search_path = '' as $$
  select array['Até 100 mil', 'De 101 a 200 mil', 'De 201 a 300 mil', 'De 301 a 400 mil', 'Acima de 400 mil',
               'Acima de 1 milhão', '1 dormitório', '2 dormitórios', '3 dormitórios', 'Zona leste', 'Zona norte',
               'Zona sul', 'Centro', 'Guarulhos', 'Poá', 'Suzano', 'Mairiporã', 'Mogi Mirim', 'Apartamento', 'Casa',
               'Casa de condomínio', 'Terreno', 'Apartamento na planta/lançamento', 'Apartamento em obras',
               'Apartamento pronto', 'Não tem interesse']::text[]
$$;

-- status de contrato que ainda "ocupam" o cliente (STATUS_CONTRATO_ATIVO do front)
create function public._crmcad_contrato_ativo(p_cliente_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.contratos k where k.cliente_id = p_cliente_id
                   and k.status in ('rascunho', 'documentacao_pendente', 'em_analise', 'assinatura_pendente', 'assinado'))
$$;

-- parceiro que pode ser o responsável (corretor_id) de um cliente: vínculo ativo, tipo corretor (ou gerente com
-- gerente_como_corretor, A1) e, se tiver login, perfil aprovado e não inativado (o bloqueado mantém a carteira, N19,
-- mas não recebe cliente novo). Os virtuais da casa (Carteira Arken) e quem ainda não aceitou o convite podem.
create function public._crmcad_pode_receber(p_parceiro_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.parceiros p left join public.profiles pr on pr.id = p.profile_id
    where p.id = p_parceiro_id and p.inativado_em is null
      and (p.tipo = 'corretor'
           or (p.tipo = 'gerente' and coalesce((select r.permitido from public.permissoes_rede r
                                                where r.acao = 'gerente_como_corretor' and r.tipo = 'gerente'), false)))
      and (p.profile_id is null or (pr.status_parceiro = 'aprovado' and pr.inativado_em is null)))
$$;

-- ---- PAR-3: o que quem consulta pode ver da rede (mesma regra da política "parceiros: escopo lê") ----
-- Contexto de quem consulta, calculado uma vez por RPC: p_admin = is_admin(); p_eu = meu_parceiro_id();
-- p_ger = escopo_gerente(); p_imob = escopo_imobiliaria().
create function public._crmcad_ref_parceiro(p_id uuid, p_admin boolean, p_eu uuid, p_ger uuid, p_imob uuid)
returns jsonb language sql stable set search_path = '' as $$
  select case when p.id is not null
                   and (p_admin or p.id = p_eu or p.imobiliaria_id = p_imob or (p.tipo = 'corretor' and p.gerente_id = p_ger))
              then jsonb_build_object('id', p.id, 'nome', p.nome) end
  from (select 1) x left join public.parceiros p on p.id = p_id
$$;

create function public._crmcad_ref_imobiliaria(p_id uuid, p_admin boolean, p_imob uuid)
returns jsonb language sql stable set search_path = '' as $$
  select case when i.id is not null and (p_admin or i.id = p_imob)
              then jsonb_build_object('id', i.id, 'nome', i.nome, 'da_casa', i.da_casa) end
  from (select 1) x left join public.imobiliarias i on i.id = p_id
$$;

-- CadeiaCliente {corretor, gerente, imobiliaria}: nível acima de quem consulta vem nulo
create function public._crmcad_cadeia(p_imob_id uuid, p_ger_id uuid, p_cor_id uuid, p_admin boolean, p_eu uuid,
                                      p_ger uuid, p_imob uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'corretor', public._crmcad_ref_parceiro(p_cor_id, p_admin, p_eu, p_ger, p_imob),
    'gerente', public._crmcad_ref_parceiro(p_ger_id, p_admin, p_eu, p_ger, p_imob),
    'imobiliaria', public._crmcad_ref_imobiliaria(p_imob_id, p_admin, p_imob))
$$;

-- nome de uma pessoa (perfil) para quem consulta, com PAR-3: internos e a própria pessoa veem o nome; parceiro
-- visível pela regra acima também; senão, genérico pelo papel/tipo. O titular do portal aparece como "Cliente".
create function public._crmcad_nome_perfil(p_profile_id uuid, p_admin boolean, p_eu uuid, p_ger uuid, p_imob uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when p_profile_id is null then null
    when pr.id is null then 'Usuário removido'
    when p_admin or pr.id = auth.uid() then coalesce(nullif(btrim(pr.nome), ''), 'Sem nome')
    when pr.papel = 'cliente' then 'Cliente'
    when pr.papel in ('admin', 'super', 'colaborador') then 'Equipe Arken'
    when p.id is not null and (p.id = p_eu or p.imobiliaria_id = p_imob or (p.tipo = 'corretor' and p.gerente_id = p_ger))
      then coalesce(nullif(btrim(pr.nome), ''), p.nome)
    when p.tipo = 'imobiliaria' then 'Imobiliária'
    when p.tipo = 'gerente' then 'Gerência'
    else 'Parceiro'
  end
  from (select 1) x
  left join public.profiles pr on pr.id = p_profile_id
  left join public.parceiros p on p.profile_id = p_profile_id
$$;

create function public._crmcad_ref_perfil(p_profile_id uuid, p_admin boolean, p_eu uuid, p_ger uuid, p_imob uuid)
returns jsonb language sql stable set search_path = '' as $$
  select case when p_profile_id is null then null
              else jsonb_build_object('id', p_profile_id,
                                      'nome', public._crmcad_nome_perfil(p_profile_id, p_admin, p_eu, p_ger, p_imob)) end
$$;

-- ---- dados do cliente (ClienteDados / ClienteEdicao) ----
-- Normaliza e valida as chaves da lista fechada (as demais são ignoradas: cadeia, etapa, origem e portal_liberado
-- nunca vêm do front). Cadastro: todas as chaves, com os obrigatórios (nome; CPF para PF, CNPJ para PJ). Edição:
-- só as chaves enviadas. Tudo o que for inválido sai junto em DADOS_INVALIDOS {campos}. Na edição, interesses que
-- o cliente já tinha (ex.: migrados do legado) continuam aceitos.
create function public._crmcad_normalizar(p_dados jsonb, p_tipo public.tipo_pessoa, p_cadastro boolean,
                                          p_interesses_atuais text[])
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_inv text[] := '{}';
  v_t text;
  v_l text[];
  v_d date;
  v_x text;
  v_ok text[];
  v_email constant text := '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  v_ufs constant text[] := array['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
                                 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  -- textos simples: chave, tamanho máximo
  v_simples constant text[][] := array[['sobrenome', '200'], ['rg', '30'], ['nacionalidade', '60'],
                                       ['horario_contato', '100'], ['logradouro', '200'], ['numero', '20'],
                                       ['complemento', '100'], ['bairro', '100'], ['cidade', '100']];
begin
  -- tamanho antes de qualquer laço: um cadastro completo tem poucos KB; listas acima do limite são recusadas sem
  -- percorrer os itens (a remoção de repetidos abaixo é quadrática e não pode prender a conexão)
  if octet_length(p_dados::text) > 65536 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["p_dados"]}';
  end if;
  foreach v_x in array array['emails_adicionais', 'telefones_adicionais', 'interesses'] loop
    if jsonb_typeof(p_dados -> v_x) = 'array'
       and jsonb_array_length(p_dados -> v_x) > (case v_x when 'interesses' then 40 else 10 end) then
      v_inv := v_inv || v_x;
    end if;
  end loop;

  -- nome
  if p_cadastro or p_dados ? 'nome' then
    v_t := public._crmcad_txt(p_dados, 'nome');
    if v_t is null or v_t = chr(1) or length(v_t) < 2 or length(v_t) > 200 then
      v_inv := v_inv || 'nome'::text;
    else
      v_out := v_out || jsonb_build_object('nome', v_t);
    end if;
  end if;

  for i in 1 .. array_length(v_simples, 1) loop
    continue when not (p_cadastro or p_dados ? v_simples[i][1]);
    v_t := public._crmcad_txt(p_dados, v_simples[i][1]);
    if v_t = chr(1) or length(v_t) > v_simples[i][2]::int then
      v_inv := v_inv || v_simples[i][1];
    else
      v_out := v_out || jsonb_build_object(v_simples[i][1], v_t);
    end if;
  end loop;

  -- documento: PF → CPF (DV); PJ → CNPJ (DV); o outro precisa ficar vazio
  if p_cadastro or p_dados ? 'cpf' then
    v_t := public._crmcad_txt(p_dados, 'cpf');
    if v_t = chr(1) then
      v_inv := v_inv || 'cpf'::text;
    else
      v_t := nullif(regexp_replace(coalesce(v_t, ''), '[\s.\-/]', '', 'g'), '');
      if p_tipo = 'juridica' then
        if v_t is not null then v_inv := v_inv || 'cpf'::text; else v_out := v_out || jsonb_build_object('cpf', null); end if;
      elsif v_t is null then
        if p_cadastro then v_inv := v_inv || 'cpf'::text; else v_out := v_out || jsonb_build_object('cpf', null); end if;
      elsif v_t !~ '^\d{11}$' or not public.cpf_valido(v_t) then
        v_inv := v_inv || 'cpf'::text;
      else
        v_out := v_out || jsonb_build_object('cpf', v_t);
      end if;
    end if;
  end if;
  if p_cadastro or p_dados ? 'cnpj' then
    v_t := public._crmcad_txt(p_dados, 'cnpj');
    if v_t = chr(1) then
      v_inv := v_inv || 'cnpj'::text;
    else
      v_t := nullif(regexp_replace(coalesce(v_t, ''), '[\s.\-/]', '', 'g'), '');
      if p_tipo = 'fisica' then
        if v_t is not null then v_inv := v_inv || 'cnpj'::text; else v_out := v_out || jsonb_build_object('cnpj', null); end if;
      elsif v_t is null then
        if p_cadastro then v_inv := v_inv || 'cnpj'::text; else v_out := v_out || jsonb_build_object('cnpj', null); end if;
      elsif v_t !~ '^\d{14}$' or not public.cnpj_valido(v_t) then
        v_inv := v_inv || 'cnpj'::text;
      else
        v_out := v_out || jsonb_build_object('cnpj', v_t);
      end if;
    end if;
  end if;

  -- nascimento: YYYY-MM-DD, de 1900 até hoje
  if p_cadastro or p_dados ? 'data_nascimento' then
    v_t := public._crmcad_txt(p_dados, 'data_nascimento');
    if v_t is null then
      v_out := v_out || jsonb_build_object('data_nascimento', null);
    elsif v_t = chr(1) or v_t !~ '^\d{4}-\d{2}-\d{2}$' then
      v_inv := v_inv || 'data_nascimento'::text;
    else
      begin
        v_d := v_t::date;
      exception when others then
        v_d := null;
      end;
      if v_d is null or v_d < date '1900-01-01' or v_d > public._crmcad_hoje() then
        v_inv := v_inv || 'data_nascimento'::text;
      else
        v_out := v_out || jsonb_build_object('data_nascimento', v_d);
      end if;
    end if;
  end if;

  if p_cadastro or p_dados ? 'genero' then
    v_t := public._crmcad_txt(p_dados, 'genero');
    if v_t is not null and (v_t = chr(1) or not (v_t = any (enum_range(null::public.genero)::text[]))) then
      v_inv := v_inv || 'genero'::text;
    else
      v_out := v_out || jsonb_build_object('genero', v_t);
    end if;
  end if;
  if p_cadastro or p_dados ? 'estado_civil' then
    v_t := public._crmcad_txt(p_dados, 'estado_civil');
    if v_t is not null and (v_t = chr(1) or not (v_t = any (enum_range(null::public.estado_civil)::text[]))) then
      v_inv := v_inv || 'estado_civil'::text;
    else
      v_out := v_out || jsonb_build_object('estado_civil', v_t);
    end if;
  end if;

  -- contatos
  if p_cadastro or p_dados ? 'email' then
    v_t := lower(public._crmcad_txt(p_dados, 'email'));
    if v_t is not null and (v_t = chr(1) or length(v_t) > 200 or v_t !~ v_email) then
      v_inv := v_inv || 'email'::text;
    else
      v_out := v_out || jsonb_build_object('email', v_t);
    end if;
  end if;
  if (p_cadastro or p_dados ? 'emails_adicionais') and not ('emails_adicionais' = any (v_inv)) then
    v_l := public._crmcad_lista(p_dados, 'emails_adicionais');
    v_ok := '{}';
    foreach v_x in array coalesce(v_l, '{}'::text[]) loop
      v_x := lower(v_x);
      if v_x = chr(1) or length(v_x) > 200 or v_x !~ v_email then
        v_ok := null;
        exit;
      end if;
      if not (v_x = any (v_ok)) then v_ok := v_ok || v_x; end if;
    end loop;
    if v_ok is null or cardinality(v_ok) > 10 then
      v_inv := v_inv || 'emails_adicionais'::text;
    else
      v_out := v_out || jsonb_build_object('emails_adicionais', to_jsonb(v_ok));
    end if;
  end if;
  if p_cadastro or p_dados ? 'telefone' then
    v_t := public._crmcad_txt(p_dados, 'telefone');
    if v_t = chr(1) then
      v_inv := v_inv || 'telefone'::text;
    else
      v_t := nullif(regexp_replace(coalesce(v_t, ''), '\D', '', 'g'), '');
      if v_t is not null and v_t !~ '^\d{10,11}$' then
        v_inv := v_inv || 'telefone'::text;
      else
        v_out := v_out || jsonb_build_object('telefone', v_t);
      end if;
    end if;
  end if;
  if (p_cadastro or p_dados ? 'telefones_adicionais') and not ('telefones_adicionais' = any (v_inv)) then
    v_l := public._crmcad_lista(p_dados, 'telefones_adicionais');
    v_ok := '{}';
    foreach v_x in array coalesce(v_l, '{}'::text[]) loop
      v_x := regexp_replace(v_x, '\D', '', 'g');
      if v_x !~ '^\d{10,11}$' then
        v_ok := null;
        exit;
      end if;
      if not (v_x = any (v_ok)) then v_ok := v_ok || v_x; end if;
    end loop;
    if v_ok is null or cardinality(v_ok) > 10 then
      v_inv := v_inv || 'telefones_adicionais'::text;
    else
      v_out := v_out || jsonb_build_object('telefones_adicionais', to_jsonb(v_ok));
    end if;
  end if;

  -- endereço
  if p_cadastro or p_dados ? 'cep' then
    v_t := public._crmcad_txt(p_dados, 'cep');
    if v_t = chr(1) then
      v_inv := v_inv || 'cep'::text;
    else
      v_t := nullif(regexp_replace(coalesce(v_t, ''), '\D', '', 'g'), '');
      if v_t is not null and v_t !~ '^\d{8}$' then
        v_inv := v_inv || 'cep'::text;
      else
        v_out := v_out || jsonb_build_object('cep', v_t);
      end if;
    end if;
  end if;
  if p_cadastro or p_dados ? 'uf' then
    v_t := upper(public._crmcad_txt(p_dados, 'uf'));
    if v_t is not null and (v_t = chr(1) or not (v_t = any (v_ufs))) then
      v_inv := v_inv || 'uf'::text;
    else
      v_out := v_out || jsonb_build_object('uf', v_t);
    end if;
  end if;
  if p_cadastro or p_dados ? 'pais' then
    v_t := public._crmcad_txt(p_dados, 'pais');
    if v_t = chr(1) or length(v_t) < 2 or length(v_t) > 60 then
      v_inv := v_inv || 'pais'::text;
    else
      v_out := v_out || jsonb_build_object('pais', coalesce(v_t, 'Brasil'));
    end if;
  end if;

  -- interesses: opções de INTERESSES (ou as que o cliente já tinha)
  if (p_cadastro or p_dados ? 'interesses') and not ('interesses' = any (v_inv)) then
    v_l := public._crmcad_lista(p_dados, 'interesses');
    v_ok := '{}';
    foreach v_x in array coalesce(v_l, '{}'::text[]) loop
      if not (v_x = any (public._crmcad_interesses()) or v_x = any (coalesce(p_interesses_atuais, '{}'::text[]))) then
        v_ok := null;
        exit;
      end if;
      if not (v_x = any (v_ok)) then v_ok := v_ok || v_x; end if;
    end loop;
    if v_ok is null or cardinality(v_ok) > 40 then
      v_inv := v_inv || 'interesses'::text;
    else
      v_out := v_out || jsonb_build_object('interesses', to_jsonb(v_ok));
    end if;
  end if;

  if cardinality(v_inv) > 0 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', to_jsonb(v_inv))::text;
  end if;
  return v_out;
end $$;

-- Responsável pelo cliente novo (matriz §3.3 + escopo; §4.5: o corretor só cadastra para si):
--   corretor     → ele mesmo (p_corretor_id nulo ou o próprio; outro = 42501);
--   gerente      → um corretor dele, ou ele mesmo (A1, nulo ou o próprio id) se gerente_como_corretor;
--   imobiliária  → obrigatório escolher um corretor (ou gerente, A1) da imobiliária;
--   interno      → qualquer parceiro que possa receber; nulo = Carteira Arken (casa).
-- Fora do escopo = 42501; dentro do escopo mas sem poder receber (inativo, bloqueado, tipo errado) = DESTINO_INVALIDO.
create function public._crmcad_resolver_corretor(p_corretor_id uuid)
returns uuid language plpgsql stable set search_path = '' as $$
declare
  v_eu public.parceiros%rowtype;
  v_alvo public.parceiros%rowtype;
begin
  if public.is_admin() then
    if p_corretor_id is null then
      return (select c.corretor_casa_id from public.configuracao_geral c);
    end if;
    if not public._crmcad_pode_receber(p_corretor_id) then
      raise exception 'DESTINO_INVALIDO' using errcode = 'P0001';
    end if;
    return p_corretor_id;
  end if;

  select * into v_eu from public.parceiros p where p.id = public.meu_parceiro_id();
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_corretor_id is null or p_corretor_id = v_eu.id then
    if v_eu.tipo = 'corretor' or (v_eu.tipo = 'gerente' and public.tem_permissao('gerente_como_corretor')) then
      if not public._crmcad_pode_receber(v_eu.id) then
        raise exception 'DESTINO_INVALIDO' using errcode = 'P0001';
      end if;
      return v_eu.id;
    end if;
    if p_corretor_id is null then
      raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["corretor_id"]}';
    end if;
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_eu.tipo = 'corretor' then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;

  select * into v_alvo from public.parceiros p where p.id = p_corretor_id;
  if not found
     or (v_eu.tipo = 'gerente' and not (v_alvo.tipo = 'corretor' and v_alvo.gerente_id = v_eu.id))
     or (v_eu.tipo = 'imobiliaria' and v_alvo.imobiliaria_id <> v_eu.imobiliaria_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if not public._crmcad_pode_receber(v_alvo.id) then
    raise exception 'DESTINO_INVALIDO' using errcode = 'P0001';
  end if;
  return v_alvo.id;
end $$;

-- A2: trava consultiva do limite por hora de quem chama (até o fim da transação). Sem ela, chamadas simultâneas do
-- mesmo usuário passavam todas pela contagem antes de qualquer uma gravar a tentativa, e o limite virava "limite +
-- conexões do pool". Espaço de chaves de dois inteiros: não colide com a trava por documento (chave única bigint).
-- Ordem das travas em todo o arquivo: limite → linha do cliente (edição) → documento.
create function public._crmcad_travar_limite()
returns void language plpgsql volatile set search_path = '' as $$
begin
  if auth.uid() is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.a2.limite.usuario'),
                                             pg_catalog.hashtext(auth.uid()::text));
  end if;
end $$;

-- A2: bloqueios de quem chama na última hora (sem contar "mesmo dono") chegaram ao limite? Trava antes de contar:
-- volatile, para a contagem ver (novo snapshot) a tentativa gravada pela chamada anterior que segurava a trava.
create function public._crmcad_limite_excedido()
returns boolean language plpgsql volatile set search_path = '' as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  perform public._crmcad_travar_limite();
  return (select count(*) from public.cliente_duplicidades d
          where d.tentado_por = auth.uid() and d.resultado <> 'mesmo_dono' and d.ocorrido_em > now() - interval '1 hour')
         >= (select c.duplicidade_bloqueios_hora from public.configuracao_geral c);
end $$;

-- A2 no pré-cadastro público: o mesmo limite por hora, contado por LINK (dono do código), com trava própria. Sem ele,
-- o dono do link mandava CPFs pelo próprio link e via no CRM se o cliente aparecia, sem limite nenhum além do
-- Turnstile e do limite por IP. Contador separado do limite do usuário: um visitante que abusa do link não bloqueia
-- o cadastro interno do corretor.
create function public._crmcad_limite_link_excedido(p_parceiro_id uuid)
returns boolean language plpgsql volatile set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.a2.limite.link'),
                                           pg_catalog.hashtext(p_parceiro_id::text));
  return (select count(*) from public.cliente_duplicidades d
          where d.origem = 'pre_cadastro_link' and d.tentado_por is null and d.tentado_por_parceiro_id = p_parceiro_id
            and d.resultado <> 'mesmo_dono' and d.ocorrido_em > now() - interval '1 hour')
         >= (select c.duplicidade_bloqueios_hora from public.configuracao_geral c);
end $$;

create index if not exists cliente_duplicidades_link_idx on public.cliente_duplicidades (tentado_por_parceiro_id, ocorrido_em)
  where origem = 'pre_cadastro_link' and tentado_por is null;

-- A2: trava consultiva por documento (serializa cadastros concorrentes do mesmo CPF/CNPJ) e devolve o cliente que
-- já tem o documento, se houver
create function public._crmcad_travar_documento(p_tipo public.tipo_pessoa, p_doc text)
returns uuid language plpgsql volatile set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.clientes.documento:' || p_doc));
  return (select c.id from public.clientes c
          where (p_tipo = 'fisica' and c.cpf = p_doc) or (p_tipo = 'juridica' and c.cnpj = p_doc)
          limit 1);
end $$;

-- A2: registra a tentativa com documento já existente e devolve o resultado. Não guarda o documento de novo.
-- p_parceiro_id = quem seria o responsável (o corretor escolhido, o próprio corretor ou o dono do link), é para quem
-- a fila de duplicidades pode transferir. O dono vê a tentativa na timeline sem saber por quem (o ator só aparece
-- para internos em crm_timeline).
create function public._crmcad_registrar_tentativa(p_cliente_id uuid, p_parceiro_id uuid, p_origem public.origem_cliente,
                                                   p_mesmo_dono boolean)
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_c public.clientes%rowtype;
  v_res text;
begin
  select * into v_c from public.clientes c where c.id = p_cliente_id;
  v_res := case
    when p_mesmo_dono then 'mesmo_dono'
    when public._crmcad_contrato_ativo(p_cliente_id) then 'bloqueado_contrato'
    when v_c.exclusividade_ate is not null and v_c.exclusividade_ate > now() then 'bloqueado_exclusividade'
    else 'bloqueado_pos_prazo' end;
  insert into public.cliente_duplicidades (cliente_id, tentado_por, tentado_por_parceiro_id, origem, resultado)
  values (p_cliente_id, auth.uid(), p_parceiro_id, p_origem, v_res);
  if v_res <> 'mesmo_dono' then
    perform public._evento_cliente(p_cliente_id, 'tentativa_duplicada', 'Tentativa de cadastro com documento já existente',
                                   jsonb_build_object('resultado', v_res));
  end if;
  return v_res;
end $$;

-- grava o cliente novo a partir dos dados já normalizados; etapa inicial NC (CRM-2), exclusividade A2
create function public._crmcad_inserir(p_n jsonb, p_tipo public.tipo_pessoa, p_corretor_id uuid,
                                       p_origem public.origem_cliente, p_portal boolean)
returns uuid language plpgsql volatile set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.clientes (
    tipo_pessoa, nome, sobrenome, cpf, cnpj, rg, data_nascimento, genero, estado_civil, nacionalidade,
    email, emails_adicionais, telefone, telefones_adicionais, horario_contato,
    cep, logradouro, numero, complemento, bairro, cidade, uf, pais, interesses,
    corretor_id, etapa, etapa_desde, origem, exclusividade_ate, portal_liberado)
  values (
    p_tipo, p_n ->> 'nome', p_n ->> 'sobrenome', p_n ->> 'cpf', p_n ->> 'cnpj', p_n ->> 'rg',
    (p_n ->> 'data_nascimento')::date, (p_n ->> 'genero')::public.genero, (p_n ->> 'estado_civil')::public.estado_civil,
    p_n ->> 'nacionalidade', p_n ->> 'email', public._crmcad_arr(p_n, 'emails_adicionais'), p_n ->> 'telefone',
    public._crmcad_arr(p_n, 'telefones_adicionais'), p_n ->> 'horario_contato',
    p_n ->> 'cep', p_n ->> 'logradouro', p_n ->> 'numero', p_n ->> 'complemento', p_n ->> 'bairro', p_n ->> 'cidade',
    (p_n ->> 'uf')::char(2), coalesce(p_n ->> 'pais', 'Brasil'), public._crmcad_arr(p_n, 'interesses'),
    p_corretor_id, 'novo_contato', now(), p_origem,
    now() + make_interval(days => (select c.exclusividade_dias from public.configuracao_geral c)),
    coalesce(p_portal, false))
  returning id into v_id;
  return v_id;
end $$;

-- nomes das colunas preenchidas no cadastro (auditoria: só nomes)
create function public._crmcad_campos_preenchidos(p_n jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(k order by k), '{}'::text[]) from jsonb_each(p_n) as t(k, v)
  where jsonb_typeof(v) <> 'null' and v <> '[]'::jsonb
$$;

-- cliente novo na carteira de alguém: avisa o corretor (se tiver login e não for quem cadastrou)
create function public._crmcad_avisar_corretor(p_cliente_id uuid, p_corretor_id uuid, p_origem public.origem_cliente)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_perfil uuid;
begin
  select p.profile_id into v_perfil from public.parceiros p where p.id = p_corretor_id;
  if v_perfil is not null and v_perfil is distinct from auth.uid() then
    perform public._notificar('crm.novo_lead_corretor', array[v_perfil], p_cliente_id,
                              jsonb_build_object('cliente_id', p_cliente_id, 'origem', p_origem));
  end if;
end $$;

-- Núcleo do cadastro interno (crm_cadastrar_cliente e leads_converter): valida, resolve o responsável, confere o
-- termo vigente, o limite de bloqueios, aplica a A2 e grava cliente, consentimento 'declarado' (N12), timeline e
-- auditoria. Quem chama já conferiu a permissão (cadastrar_cliente ou interno).
create function public._crmcad_cadastrar(p_dados jsonb, p_corretor_id uuid, p_termo_id uuid, p_origem public.origem_cliente,
                                         p_rpc text)
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
    v_res := public._crmcad_registrar_tentativa(v_existe, v_corretor, p_origem, v_mesmo);
    perform public._auditar('operacao', 'tentativa_duplicada', 'cliente_duplicidades', null, v_existe, null, null, null,
      jsonb_build_object('rpc', p_rpc, 'resultado', v_res, 'origem', p_origem));
    if v_mesmo then
      return jsonb_build_object('situacao', 'ja_na_sua_carteira', 'id', v_existe);
    end if;
    return jsonb_build_object('situacao', 'indisponivel', 'id', null);
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

-- Transferência de um cliente (mesma regra de rede_transferir_clientes, §4.4, para a fila de duplicidades):
-- motivo ≥ 5; destino que pode receber; cliente ativo; contrato em assinatura_pendente congela a cadeia; entre
-- imobiliárias só o Super. O motivo vai para cliente_vinculos_historico (arken.motivo_vinculo), nunca para a auditoria.
create function public._crmcad_transferir(p_cliente_id uuid, p_para uuid, p_motivo text, p_rpc text)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_c public.clientes%rowtype;
  v_depois public.clientes%rowtype;
  v_imob_destino uuid;
begin
  select * into v_c from public.clientes c where c.id = p_cliente_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_c.inativado_em is not null or v_c.anonimizado_em is not null then
    raise exception 'Cliente inativo não pode ser transferido.' using errcode = 'P0001';
  end if;
  if p_para is null or v_c.corretor_id = p_para or not public._crmcad_pode_receber(p_para) then
    raise exception 'DESTINO_INVALIDO' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contratos k where k.cliente_id = p_cliente_id and k.status = 'assinatura_pendente') then
    raise exception 'Cliente com contrato em assinatura não pode ser transferido.' using errcode = 'P0001';
  end if;
  select p.imobiliaria_id into v_imob_destino from public.parceiros p where p.id = p_para;
  if v_imob_destino is distinct from v_c.imobiliaria_id and not public.is_super() then
    raise exception 'Transferência entre imobiliárias é exclusiva do Super.' using errcode = 'P0001';
  end if;

  perform set_config('arken.motivo_vinculo', left(btrim(p_motivo), 500), true);
  update public.clientes c set corretor_id = p_para where c.id = p_cliente_id;
  perform set_config('arken.motivo_vinculo', '', true);
  select * into v_depois from public.clientes c where c.id = p_cliente_id;

  perform public._evento_cliente(p_cliente_id, 'transferencia', 'Cliente transferido de corretor',
    jsonb_build_object('de_corretor_id', v_c.corretor_id, 'para_corretor_id', p_para));
  perform public._auditar('operacao', 'transferir', 'clientes', p_cliente_id::text, p_cliente_id,
    array['corretor_id', 'gerente_id', 'imobiliaria_id'],
    jsonb_build_object('corretor_id', v_c.corretor_id, 'gerente_id', v_c.gerente_id, 'imobiliaria_id', v_c.imobiliaria_id),
    jsonb_build_object('corretor_id', v_depois.corretor_id, 'gerente_id', v_depois.gerente_id,
                       'imobiliaria_id', v_depois.imobiliaria_id),
    jsonb_build_object('rpc', p_rpc));
end $$;

-- ClienteResumo de uma linha (lista), com PAR-3 na cadeia
create function public._crmcad_resumo(p_c public.clientes, p_admin boolean, p_eu uuid, p_ger uuid, p_imob uuid, p_hoje date)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_c.id, 'tipo_pessoa', p_c.tipo_pessoa, 'nome', p_c.nome, 'sobrenome', p_c.sobrenome,
    'email', p_c.email, 'telefone', p_c.telefone, 'etapa', p_c.etapa, 'etapa_desde', p_c.etapa_desde,
    'origem', p_c.origem, 'portal_liberado', p_c.portal_liberado, 'exclusividade_ate', p_c.exclusividade_ate,
    'documentos_pendentes', (select count(*) from public.cliente_documentos d
                             where d.cliente_id = p_c.id and d.inativado_em is null and d.status in ('pendente', 'rejeitado')),
    'tarefas_atrasadas', (select count(*) from public.cliente_tarefas t
                          where t.cliente_id = p_c.id and t.inativado_em is null and t.status = 'pendente'
                            and t.prazo < p_hoje),
    'criado_em', p_c.created_at, 'inativado_em', p_c.inativado_em)
    || public._crmcad_cadeia(p_c.imobiliaria_id, p_c.gerente_id, p_c.corretor_id, p_admin, p_eu, p_ger, p_imob)
$$;

-- LeadItem de uma linha (só internos leem leads: nomes reais)
create function public._crmcad_lead(p_l public.leads)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_l.id, 'nome', p_l.nome, 'email', p_l.email, 'telefone', p_l.telefone, 'mensagem', p_l.mensagem,
    'origem', p_l.origem,
    'empreendimento', (select jsonb_build_object('id', e.id, 'nome', e.nome) from public.empreendimentos e
                       where e.id = p_l.empreendimento_id),
    'status', p_l.status, 'cliente_id', p_l.cliente_id,
    'tratado_por', (select jsonb_build_object('id', pr.id, 'nome', coalesce(nullif(btrim(pr.nome), ''), 'Sem nome'))
                    from public.profiles pr where pr.id = p_l.tratado_por),
    'tratado_em', p_l.tratado_em, 'motivo_descarte', p_l.motivo_descarte, 'criado_em', p_l.created_at)
$$;

-- ============ CADASTRO (§4.4, §4.5, A1, A2, N12) ============
-- cadastrar_cliente + escopo (o corretor só para si; gerente para os seus corretores ou para si com A1; imobiliária
-- escolhe o corretor; interno para qualquer um, padrão Carteira Arken). Termo vigente de consentimento_cliente
-- (declarado por quem cadastra, N12). Resultado {situacao, id} (CadastroResultado).
create or replace function public.crm_cadastrar_cliente(p_dados jsonb, p_corretor_id uuid, p_termo_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.is_admin() or public.meu_parceiro_id() is not null)
     or not public.tem_permissao('cadastrar_cliente') then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  return public._crmcad_cadastrar(p_dados, p_corretor_id, p_termo_id, 'cadastro_interno', 'crm_cadastrar_cliente');
end $$;

-- Edição (§4.4): escopo sobre o cliente ativo; só as chaves enviadas mudam; tipo_pessoa e corretor_id nunca por
-- aqui. CPF/CNPJ: parceiro só preenche quando está vazio (ex.: migrado sem CPF); interno também troca. Documento
-- que já existe em outro cliente: interno recebe DOCUMENTO_INDISPONIVEL; parceiro tem a tentativa registrada (A2,
-- conta no limite por hora) e o documento simplesmente não é gravado (o front confere relendo a ficha), para a
-- edição não virar oráculo de CPF sem limite (um raise desfaria o registro da tentativa).
create or replace function public.crm_editar_cliente(p_id uuid, p_dados jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_admin boolean;
  v_c public.clientes%rowtype;
  v_novo public.clientes%rowtype;
  v_dados jsonb;
  v_n jsonb;
  v_doc_col text;
  v_doc text;
  v_existe uuid;
  v_res text;
  v_campos text[];
  v_lista constant text[] := array['nome', 'sobrenome', 'cpf', 'cnpj', 'rg', 'data_nascimento', 'genero', 'estado_civil',
    'nacionalidade', 'email', 'emails_adicionais', 'telefone', 'telefones_adicionais', 'horario_contato', 'cep',
    'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'pais', 'interesses'];
begin
  if v_uid is null or p_id is null then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  -- documento na edição do parceiro conta no limite A2: a trava do limite vem ANTES da trava da linha (mesma ordem
  -- do cadastro, que trava o limite e depois referencia a linha do dono ao registrar a tentativa), contra deadlock
  if (p_dados ? 'cpf' or p_dados ? 'cnpj') and not public.is_admin() then
    perform public._crmcad_travar_limite();
  end if;
  select * into v_c from public.clientes c where c.id = p_id for update;
  if not found or not public.pode_ver_cliente(p_id) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_c.inativado_em is not null or v_c.anonimizado_em is not null then
    raise exception 'Cliente inativo não pode ser editado.' using errcode = 'P0001';
  end if;
  v_admin := public.is_admin();
  v_dados := public._crmcad_objeto(p_dados, 'p_dados');
  v_n := public._crmcad_normalizar(v_dados, v_c.tipo_pessoa, false, v_c.interesses);

  -- documento
  v_doc_col := case v_c.tipo_pessoa when 'fisica' then 'cpf' else 'cnpj' end;
  if v_n ? v_doc_col then
    v_doc := v_n ->> v_doc_col;
    if v_doc is not distinct from (case v_doc_col when 'cpf' then v_c.cpf else v_c.cnpj end) then
      v_n := v_n - v_doc_col;
    elsif v_doc is null then
      raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = jsonb_build_object('campos', jsonb_build_array(v_doc_col))::text;
    elsif (case v_doc_col when 'cpf' then v_c.cpf else v_c.cnpj end) is not null and not v_admin then
      raise exception 'Só a equipe Arken pode alterar o CPF/CNPJ de um cliente.' using errcode = 'P0001';
    else
      if not v_admin and public._crmcad_limite_excedido() then
        raise exception 'LIMITE_DUPLICIDADE' using errcode = 'P0001';
      end if;
      v_existe := public._crmcad_travar_documento(v_c.tipo_pessoa, v_doc);
      if v_existe is not null and v_existe <> p_id then
        if v_admin then
          raise exception 'DOCUMENTO_INDISPONIVEL' using errcode = 'P0001';
        end if;
        v_res := public._crmcad_registrar_tentativa(v_existe, v_c.corretor_id, 'cadastro_interno', public.pode_ver_cliente(v_existe));
        perform public._auditar('operacao', 'tentativa_duplicada', 'cliente_duplicidades', null, v_existe, null, null, null,
          jsonb_build_object('rpc', 'crm_editar_cliente', 'resultado', v_res, 'cliente_editado', p_id));
        v_n := v_n - v_doc_col;
      end if;
    end if;
  end if;
  -- o outro documento (CNPJ de PF, CPF de PJ) só pode continuar vazio: já validado em _crmcad_normalizar
  v_n := v_n - (case v_doc_col when 'cpf' then 'cnpj' else 'cpf' end);

  update public.clientes c set
    nome = case when v_n ? 'nome' then v_n ->> 'nome' else c.nome end,
    sobrenome = case when v_n ? 'sobrenome' then v_n ->> 'sobrenome' else c.sobrenome end,
    cpf = case when v_n ? 'cpf' then v_n ->> 'cpf' else c.cpf end,
    cnpj = case when v_n ? 'cnpj' then v_n ->> 'cnpj' else c.cnpj end,
    rg = case when v_n ? 'rg' then v_n ->> 'rg' else c.rg end,
    data_nascimento = case when v_n ? 'data_nascimento' then (v_n ->> 'data_nascimento')::date else c.data_nascimento end,
    genero = case when v_n ? 'genero' then (v_n ->> 'genero')::public.genero else c.genero end,
    estado_civil = case when v_n ? 'estado_civil' then (v_n ->> 'estado_civil')::public.estado_civil else c.estado_civil end,
    nacionalidade = case when v_n ? 'nacionalidade' then v_n ->> 'nacionalidade' else c.nacionalidade end,
    email = case when v_n ? 'email' then v_n ->> 'email' else c.email end,
    emails_adicionais = case when v_n ? 'emails_adicionais' then public._crmcad_arr(v_n, 'emails_adicionais') else c.emails_adicionais end,
    telefone = case when v_n ? 'telefone' then v_n ->> 'telefone' else c.telefone end,
    telefones_adicionais = case when v_n ? 'telefones_adicionais' then public._crmcad_arr(v_n, 'telefones_adicionais') else c.telefones_adicionais end,
    horario_contato = case when v_n ? 'horario_contato' then v_n ->> 'horario_contato' else c.horario_contato end,
    cep = case when v_n ? 'cep' then v_n ->> 'cep' else c.cep end,
    logradouro = case when v_n ? 'logradouro' then v_n ->> 'logradouro' else c.logradouro end,
    numero = case when v_n ? 'numero' then v_n ->> 'numero' else c.numero end,
    complemento = case when v_n ? 'complemento' then v_n ->> 'complemento' else c.complemento end,
    bairro = case when v_n ? 'bairro' then v_n ->> 'bairro' else c.bairro end,
    cidade = case when v_n ? 'cidade' then v_n ->> 'cidade' else c.cidade end,
    uf = case when v_n ? 'uf' then (v_n ->> 'uf')::char(2) else c.uf end,
    pais = case when v_n ? 'pais' then coalesce(v_n ->> 'pais', 'Brasil') else c.pais end,
    interesses = case when v_n ? 'interesses' then public._crmcad_arr(v_n, 'interesses') else c.interesses end
  where c.id = p_id
  returning * into v_novo;

  select coalesce(array_agg(k order by k), '{}'::text[]) into v_campos
  from unnest(v_lista) k
  where (to_jsonb(v_c) -> k) is distinct from (to_jsonb(v_novo) -> k);
  if cardinality(v_campos) > 0 then
    perform public._auditar('operacao', 'editar', 'clientes', p_id::text, p_id, v_campos, null, null,
                            jsonb_build_object('rpc', 'crm_editar_cliente'));
  end if;
end $$;

-- ============ LISTA E OPÇÕES (§4.4, §7.3) ============
-- P (com vínculo) + I. Escopo por coluna; os filtros de cadeia só estreitam. Parceiro nunca vê inativos; interno só
-- com incluir_inativos. Auditoria acesso/listar com os ids devolvidos e os filtros sem texto ({busca: true}).
create or replace function public.crm_listar(p_filtros jsonb, p_limite int, p_offset int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_f jsonb := public._crmcad_objeto(p_filtros, 'p_filtros');
  v_admin boolean := public.is_admin();
  v_eu uuid := public.meu_parceiro_id();
  v_cor uuid := public.escopo_corretor();
  v_ger uuid := public.escopo_gerente();
  v_imob uuid := public.escopo_imobiliaria();
  v_busca text := public._crmcad_busca(v_f);
  v_busca_dig text := public._crmcad_busca_digitos(v_f);
  v_etapas public.etapa_funil[];
  v_f_cor uuid := public._crmcad_filtro_uuid(v_f, 'corretor_id');
  v_f_ger uuid := public._crmcad_filtro_uuid(v_f, 'gerente_id');
  v_f_imob uuid := public._crmcad_filtro_uuid(v_f, 'imobiliaria_id');
  v_so_meus boolean := coalesce(public._crmcad_filtro_bool(v_f, 'so_meus'), false);
  v_de date := public._crmcad_filtro_data(v_f, 'periodo_de');
  v_ate date := public._crmcad_filtro_data(v_f, 'periodo_ate');
  v_origem text := public._crmcad_filtro_opcao(v_f, 'origem', enum_range(null::public.origem_cliente)::text[]);
  v_inativos boolean := coalesce(public._crmcad_filtro_bool(v_f, 'incluir_inativos'), false);
  v_portal boolean := public._crmcad_filtro_bool(v_f, 'portal_liberado');
  v_ordem text := coalesce(public._crmcad_filtro_opcao(v_f, 'ordem', array['recentes', 'nome', 'etapa_desde']), 'recentes');
  v_lim int := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_hoje date := public._crmcad_hoje();
  v_total int;
  v_itens jsonb;
  v_ids uuid[];
begin
  if v_uid is null or not (v_admin or v_eu is not null) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_f -> 'etapas' is not null and jsonb_typeof(v_f -> 'etapas') <> 'null' then
    if jsonb_typeof(v_f -> 'etapas') <> 'array'
       or exists (select 1 from jsonb_array_elements(v_f -> 'etapas') e
                  where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (enum_range(null::public.etapa_funil)::text[]))) then
      raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["etapas"]}';
    end if;
    select nullif(array_agg(e::public.etapa_funil), '{}') into v_etapas from jsonb_array_elements_text(v_f -> 'etapas') e;
  end if;
  if not v_admin then
    v_inativos := false;
    v_portal := null;
  end if;

  -- a linha inteira (cli, do tipo public.clientes) vai para _crmcad_resumo; n = posição na ordem pedida
  with base as (
    select c as cli from public.clientes c
    where (v_admin or (c.corretor_id = v_cor or c.gerente_id = v_ger or c.imobiliaria_id = v_imob))
      and (c.inativado_em is null or v_inativos)
      and (v_f_cor is null or c.corretor_id = v_f_cor)
      and (v_f_ger is null or c.gerente_id = v_f_ger)
      and (v_f_imob is null or c.imobiliaria_id = v_f_imob)
      and (not v_so_meus or c.corretor_id = v_eu)
      and (v_etapas is null or c.etapa = any (v_etapas))
      and (v_origem is null or c.origem = v_origem::public.origem_cliente)
      and (v_portal is null or c.portal_liberado = v_portal)
      and (v_de is null or (c.created_at at time zone 'America/Sao_Paulo')::date >= v_de)
      and (v_ate is null or (c.created_at at time zone 'America/Sao_Paulo')::date <= v_ate)
      and (v_busca is null
           or (c.nome || ' ' || coalesce(c.sobrenome, '')) ilike v_busca escape '\'
           or c.email ilike v_busca escape '\'
           or (v_busca_dig is not null and c.telefone like v_busca_dig))
  ), pagina as (
    select o.cli, o.n from (
      select b.cli, row_number() over (order by
          case when v_ordem = 'nome' then lower((b.cli).nome || ' ' || coalesce((b.cli).sobrenome, '')) end,
          case when v_ordem = 'etapa_desde' then (b.cli).etapa_desde end,
          case when v_ordem = 'recentes' then (b.cli).created_at end desc,
          (b.cli).id) as n
      from base b) o
    order by o.n
    limit v_lim offset v_off
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(public._crmcad_resumo(p.cli, v_admin, v_eu, v_ger, v_imob, v_hoje) order by p.n)
                   from pagina p), '[]'::jsonb),
         coalesce((select array_agg((p.cli).id order by p.n) from pagina p), '{}'::uuid[])
    into v_total, v_itens, v_ids;

  perform public._auditar('acesso', 'listar', 'clientes', null, null, null, null, null,
    jsonb_build_object('rpc', 'crm_listar', 'ids', to_jsonb(v_ids), 'total', v_total, 'limite', v_lim, 'offset', v_off,
      'filtros', jsonb_strip_nulls(jsonb_build_object('busca', case when v_busca is not null then true end,
        'etapas', to_jsonb(v_etapas), 'corretor_id', v_f_cor, 'gerente_id', v_f_ger, 'imobiliaria_id', v_f_imob,
        'so_meus', case when v_so_meus then true end, 'periodo_de', v_de, 'periodo_ate', v_ate, 'origem', v_origem,
        'incluir_inativos', case when v_inativos then true end, 'portal_liberado', v_portal, 'ordem', v_ordem))));
  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

-- Opções para seletores (propostas, contratos): até 20 clientes ATIVOS no escopo, por nome. Auditoria com os ids.
create or replace function public.crm_clientes_opcoes(p_busca text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_eu uuid := public.meu_parceiro_id();
  v_cor uuid := public.escopo_corretor();
  v_ger uuid := public.escopo_gerente();
  v_imob uuid := public.escopo_imobiliaria();
  v_busca text := public._crmcad_padrao(p_busca);
  v_itens jsonb;
  v_ids uuid[];
begin
  if v_uid is null or not (v_admin or v_eu is not null) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  with sel as (
    select c.id, c.nome, c.sobrenome, c.etapa, c.corretor_id from public.clientes c
    where c.inativado_em is null
      and (v_admin or c.corretor_id = v_cor or c.gerente_id = v_ger or c.imobiliaria_id = v_imob)
      and (v_busca is null or (c.nome || ' ' || coalesce(c.sobrenome, '')) ilike v_busca escape '\')
    order by lower(c.nome || ' ' || coalesce(c.sobrenome, '')), c.id
    limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'nome', btrim(s.nome || ' ' || coalesce(s.sobrenome, '')), 'etapa', s.etapa,
           'corretor_nome', (select (public._crmcad_ref_parceiro(s.corretor_id, v_admin, v_eu, v_ger, v_imob)) ->> 'nome'))
           order by lower(s.nome || ' ' || coalesce(s.sobrenome, '')), s.id), '[]'::jsonb),
         coalesce(array_agg(s.id), '{}'::uuid[])
    into v_itens, v_ids
  from sel s;

  perform public._auditar('acesso', 'listar', 'clientes', null, null, null, null, null,
    jsonb_build_object('rpc', 'crm_clientes_opcoes', 'ids', to_jsonb(v_ids),
                       'filtros', jsonb_strip_nulls(jsonb_build_object('busca', case when v_busca is not null then true end))));
  return v_itens;
end $$;

-- ============ FICHA (§4.4, §4.5, §7.3) ============
-- P+I com escopo (pode_ver_cliente: internos leem também o inativado). Fora do escopo ou inexistente: nulo e
-- 'acesso_negado' com o cliente_id. Devolve também os destinos de etapa que QUEM CONSULTA pode acionar
-- (status_transicoes ativas com o papel dele) e as permissões da tela, para a tela bater com o servidor.
create or replace function public.crm_ficha(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_admin boolean;
  v_eu uuid;
  v_ger uuid;
  v_imob uuid;
  v_papel public.papel;
  v_c public.clientes%rowtype;
  v_ativo boolean;
  v_hoje date := public._crmcad_hoje();
  v_destinos jsonb := '[]'::jsonb;
  v_editar boolean;
  v_gestor boolean;
  v_cliente jsonb;
  v_perm jsonb;
  v_cont jsonb;
  v_hist jsonb;
  v_cons jsonb;
begin
  if v_uid is null then
    return null;
  end if;
  if p_id is null or not public.pode_ver_cliente(p_id) then
    perform public._auditar('acesso', 'acesso_negado', 'clientes', p_id::text, p_id, null, null, null, '{"rpc":"crm_ficha"}'::jsonb);
    return null;
  end if;
  select * into v_c from public.clientes c where c.id = p_id;
  v_admin := public.is_admin();
  v_eu := public.meu_parceiro_id();
  v_ger := public.escopo_gerente();
  v_imob := public.escopo_imobiliaria();
  select pr.papel into v_papel from public.profiles pr where pr.id = v_uid;
  v_ativo := v_c.inativado_em is null and v_c.anonimizado_em is null;
  v_editar := v_ativo;
  v_gestor := v_admin or v_ger is not null or v_imob is not null;

  if v_ativo then
    select coalesce(jsonb_agg(jsonb_build_object(
             'para', t.para, 'exige_motivo', t.exige_motivo or t.para = 'perdido',
             'validacoes', to_jsonb(t.validacoes), 'efeitos', to_jsonb(t.efeitos))
             order by t.para::public.etapa_funil), '[]'::jsonb)
      into v_destinos
    from public.status_transicoes t
    where t.entidade = 'cliente_etapa' and t.de = v_c.etapa::text and t.ativa and v_papel = any (t.papeis);
  end if;

  v_cliente := jsonb_build_object(
    'id', v_c.id, 'tipo_pessoa', v_c.tipo_pessoa, 'nome', v_c.nome, 'sobrenome', v_c.sobrenome,
    'cpf', v_c.cpf, 'cnpj', v_c.cnpj, 'rg', v_c.rg, 'data_nascimento', v_c.data_nascimento, 'genero', v_c.genero,
    'estado_civil', v_c.estado_civil, 'nacionalidade', v_c.nacionalidade, 'email', v_c.email,
    'emails_adicionais', to_jsonb(v_c.emails_adicionais), 'telefone', v_c.telefone,
    'telefones_adicionais', to_jsonb(v_c.telefones_adicionais), 'horario_contato', v_c.horario_contato,
    'cep', v_c.cep, 'logradouro', v_c.logradouro, 'numero', v_c.numero, 'complemento', v_c.complemento,
    'bairro', v_c.bairro, 'cidade', v_c.cidade, 'uf', v_c.uf, 'pais', v_c.pais, 'interesses', to_jsonb(v_c.interesses),
    'etapa', v_c.etapa, 'etapa_desde', v_c.etapa_desde, 'motivo_perda', v_c.motivo_perda, 'origem', v_c.origem,
    'exclusividade_ate', v_c.exclusividade_ate, 'portal_liberado', v_c.portal_liberado,
    'tem_login_portal', v_admin and v_c.user_id is not null,
    'criado_em', v_c.created_at, 'atualizado_em', v_c.updated_at, 'inativado_em', v_c.inativado_em,
    'motivo_inativacao', v_c.motivo_inativacao, 'anonimizado_em', v_c.anonimizado_em);

  v_perm := jsonb_build_object(
    'editar', v_editar,
    'editar_documento', v_editar and (v_admin or (v_c.cpf is null and v_c.cnpj is null)),
    'mudar_etapa', v_editar and jsonb_array_length(v_destinos) > 0,
    'criar_nota', v_editar,
    'criar_tarefa', v_editar,
    'solicitar_documento', v_editar,
    'enviar_documento', v_editar,
    'analisar_documento', v_editar and public.tem_permissao('analisar_documento'),
    'baixar_documento', v_c.anonimizado_em is null,
    'transferir', v_editar and (v_admin or (v_gestor and public.tem_permissao('transferir_cliente'))),
    'criar_contrato', v_editar and public.tem_permissao('criar_contrato'),
    'criar_proposta', v_editar and not v_admin and v_eu is not null,
    'inativar', v_admin and v_ativo,
    'liberar_portal', v_admin and v_ativo and v_c.tipo_pessoa = 'fisica' and v_c.cpf is not null,
    'ver_portal', v_admin);

  v_cont := jsonb_build_object(
    'documentos_pendentes', (select count(*) from public.cliente_documentos d
                             where d.cliente_id = p_id and d.inativado_em is null and d.status in ('pendente', 'rejeitado')),
    'documentos_em_analise', (select count(*) from public.cliente_documentos d
                              where d.cliente_id = p_id and d.inativado_em is null and d.status = 'em_analise'),
    'tarefas_pendentes', (select count(*) from public.cliente_tarefas t
                          where t.cliente_id = p_id and t.inativado_em is null and t.status = 'pendente'),
    'tarefas_atrasadas', (select count(*) from public.cliente_tarefas t
                          where t.cliente_id = p_id and t.inativado_em is null and t.status = 'pendente' and t.prazo < v_hoje),
    'notas', (select count(*) from public.cliente_notas n where n.cliente_id = p_id),
    'contratos_ativos', (select count(*) from public.contratos k
                         where k.cliente_id = p_id and k.status not in ('recusado', 'expirado', 'cancelado', 'arquivado')),
    'propostas', (select count(*) from public.propostas pr where pr.cliente_id = p_id));

  -- histórico de vínculos: PAR-3 nos nomes; o motivo só quando quem consulta vê o corretor daquele período
  select coalesce(jsonb_agg(
           public._crmcad_cadeia(h.imobiliaria_id, h.gerente_id, h.corretor_id, v_admin, v_eu, v_ger, v_imob)
           || jsonb_build_object('vigente_de', h.vigente_de, 'vigente_ate', h.vigente_ate,
                'motivo', case when v_admin or public._crmcad_ref_parceiro(h.corretor_id, v_admin, v_eu, v_ger, v_imob) is not null
                               then h.motivo end)
           order by h.vigente_de desc, h.id desc), '[]'::jsonb)
    into v_hist
  from public.cliente_vinculos_historico h where h.cliente_id = p_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'termo_id', l.termo_id, 'termo_versao', t.versao, 'origem', l.origem, 'aceito_em', l.aceito_em,
           'registrado_por', public._crmcad_ref_perfil(l.registrado_por, v_admin, v_eu, v_ger, v_imob),
           'revogado_em', l.revogado_em, 'motivo_revogacao', l.motivo_revogacao)
           order by l.aceito_em desc, l.id), '[]'::jsonb)
    into v_cons
  from public.lgpd_consentimentos l left join public.lgpd_termos t on t.id = l.termo_id
  where l.titular = 'cliente' and l.cliente_id = p_id;

  perform public._auditar('acesso', 'consultar', 'clientes', p_id::text, p_id, null, null, null, '{"rpc":"crm_ficha"}'::jsonb);
  return jsonb_build_object(
    'cliente', v_cliente,
    'cadeia', public._crmcad_cadeia(v_c.imobiliaria_id, v_c.gerente_id, v_c.corretor_id, v_admin, v_eu, v_ger, v_imob),
    'destinos_etapa', v_destinos,
    'permissoes', v_perm,
    'contadores', v_cont,
    'historico_vinculos', v_hist,
    'consentimentos', v_cons);
end $$;

-- ============ INATIVAR E PORTAL (só internos) ============
-- Inativar: cliente ativo, sem contrato ativo (fora de recusado/expirado/cancelado/arquivado); motivo ≥ 5.
create or replace function public.crm_inativar_cliente(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.clientes%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_c from public.clientes c where c.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_c.inativado_em is not null then
    raise exception 'Este cliente já está inativo.' using errcode = 'P0001';
  end if;
  if v_motivo is null or length(v_motivo) < 5 then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contratos k where k.cliente_id = p_id
               and k.status not in ('recusado', 'expirado', 'cancelado', 'arquivado')) then
    raise exception 'CONTRATO_ATIVO' using errcode = 'P0001';
  end if;
  update public.clientes c set inativado_em = now(), inativado_por = auth.uid(), motivo_inativacao = left(v_motivo, 2000)
  where c.id = p_id;
  perform public._auditar('operacao', 'inativar', 'clientes', p_id::text, p_id,
    array['inativado_em', 'inativado_por', 'motivo_inativacao'], jsonb_build_object('inativado', false),
    jsonb_build_object('inativado', true), '{"rpc":"crm_inativar_cliente"}'::jsonb);
end $$;

-- Portal (N1, N9): só internos liberam; só PF com CPF, ativo e não anonimizado. Revogar vale sempre.
create or replace function public.crm_liberar_portal(p_id uuid, p_liberar boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.clientes%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_c from public.clientes c where c.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_liberar is null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["liberar"]}';
  end if;
  if p_liberar and (v_c.inativado_em is not null or v_c.anonimizado_em is not null) then
    raise exception 'Cliente inativo não pode ter o portal liberado.' using errcode = 'P0001';
  end if;
  if p_liberar and (v_c.tipo_pessoa <> 'fisica' or v_c.cpf is null) then
    raise exception 'O portal é só para pessoa física com CPF.' using errcode = 'P0001';
  end if;
  if v_c.portal_liberado = p_liberar then
    return;
  end if;
  update public.clientes c set portal_liberado = p_liberar where c.id = p_id;
  perform public._auditar('seguranca', case when p_liberar then 'liberar_portal' else 'revogar_portal' end, 'clientes',
    p_id::text, p_id, array['portal_liberado'], jsonb_build_object('portal_liberado', v_c.portal_liberado),
    jsonb_build_object('portal_liberado', p_liberar), '{"rpc":"crm_liberar_portal"}'::jsonb);
end $$;

-- ============ DUPLICIDADES (A2, só internos) ============
create or replace function public.crm_duplicidades_listar(p_filtros jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_f jsonb := public._crmcad_objeto(p_filtros, 'p_filtros');
  v_pend boolean := public._crmcad_filtro_bool(v_f, 'pendentes');
  v_res text := public._crmcad_filtro_opcao(v_f, 'resultado',
                  array['bloqueado_exclusividade', 'bloqueado_contrato', 'bloqueado_pos_prazo', 'mesmo_dono']);
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

-- Resolver: 'manter' (o dono continua; sempre disponível) ou 'transferir' para quem tentou, só depois do prazo de
-- exclusividade (A2) e pela mesma regra de rede_transferir_clientes (entre imobiliárias só o Super). Motivo ≥ 5, guardado em motivo_decisao (e no histórico de vínculos ao transferir).
create or replace function public.crm_duplicidade_resolver(p_id uuid, p_decisao text, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.cliente_duplicidades%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_d from public.cliente_duplicidades d where d.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_d.resolvido_em is not null then
    raise exception 'Esta duplicidade já foi resolvida.' using errcode = 'P0001';
  end if;
  if p_decisao is null or p_decisao not in ('manter', 'transferir') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["decisao"]}';
  end if;
  if v_motivo is null or length(v_motivo) < 5 then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001';
  end if;
  if p_decisao = 'transferir' then
    if v_d.resultado = 'mesmo_dono' or v_d.tentado_por_parceiro_id is null then
      raise exception 'DESTINO_INVALIDO' using errcode = 'P0001';
    end if;
    -- A2: a fila só transfere DEPOIS do prazo de exclusividade (vale o prazo de agora, não o da tentativa); dentro dele
    -- o primeiro cadastro é o dono e só cabe 'manter'
    if exists (select 1 from public.clientes c where c.id = v_d.cliente_id and c.exclusividade_ate > now()) then
      raise exception 'Cliente dentro do prazo de exclusividade: a fila de duplicidades só transfere depois do prazo.'
        using errcode = 'P0001';
    end if;
    perform public._crmcad_transferir(v_d.cliente_id, v_d.tentado_por_parceiro_id, v_motivo, 'crm_duplicidade_resolver');
  end if;
  update public.cliente_duplicidades d
     set resolvido_em = now(), resolvido_por = auth.uid(), decisao = p_decisao, motivo_decisao = left(v_motivo, 2000)
   where d.id = p_id;
  perform public._auditar('operacao', 'resolver', 'cliente_duplicidades', p_id::text, v_d.cliente_id,
    array['resolvido_em', 'resolvido_por', 'decisao', 'motivo_decisao'], null, jsonb_build_object('decisao', p_decisao),
    jsonb_build_object('rpc', 'crm_duplicidade_resolver', 'resultado', v_d.resultado));
end $$;

-- ============ LEADS DO SITE (só internos) ============
create or replace function public.leads_listar(p_filtros jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_f jsonb := public._crmcad_objeto(p_filtros, 'p_filtros');
  v_status text := public._crmcad_filtro_opcao(v_f, 'status', enum_range(null::public.status_lead)::text[]);
  v_busca text := public._crmcad_busca(v_f);
  v_busca_dig text := public._crmcad_busca_digitos(v_f);
  v_emp uuid := public._crmcad_filtro_uuid(v_f, 'empreendimento_id');
  v_de date := public._crmcad_filtro_data(v_f, 'de');
  v_ate date := public._crmcad_filtro_data(v_f, 'ate');
  v_lim int := least(greatest(coalesce(public._crmcad_filtro_int(v_f, 'limite'), 50), 1), 200);
  v_off int := coalesce(public._crmcad_filtro_int(v_f, 'offset'), 0);
  v_total int;
  v_itens jsonb;
  v_ids uuid[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  with base as (
    select l as ld from public.leads l
    where (v_status is null or l.status = v_status::public.status_lead)
      and (v_emp is null or l.empreendimento_id = v_emp)
      and (v_de is null or (l.created_at at time zone 'America/Sao_Paulo')::date >= v_de)
      and (v_ate is null or (l.created_at at time zone 'America/Sao_Paulo')::date <= v_ate)
      and (v_busca is null or l.nome ilike v_busca escape '\' or l.email ilike v_busca escape '\'
           or (v_busca_dig is not null and regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g') like v_busca_dig))
  ), pagina as (
    select b.ld from base b order by (b.ld).created_at desc, (b.ld).id limit v_lim offset v_off
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(public._crmcad_lead(p.ld) order by (p.ld).created_at desc, (p.ld).id) from pagina p), '[]'::jsonb),
         coalesce((select array_agg((p.ld).id) from pagina p), '{}'::uuid[])
    into v_total, v_itens, v_ids;

  perform public._auditar('acesso', 'listar', 'leads', null, null, null, null, null,
    jsonb_build_object('rpc', 'leads_listar', 'ids', to_jsonb(v_ids), 'total', v_total,
      'filtros', jsonb_strip_nulls(jsonb_build_object('status', v_status, 'busca', case when v_busca is not null then true end,
        'empreendimento_id', v_emp, 'de', v_de, 'ate', v_ate))));
  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

-- Converter um lead 'novo' em cliente do CRM (origem lead_site), pela mesma regra A2 do cadastro. O interno vê tudo:
-- documento que já existe = "já na sua carteira" e o lead é ligado a esse cliente.
create or replace function public.leads_converter(p_lead_id uuid, p_corretor_id uuid, p_dados jsonb, p_termo_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.leads%rowtype;
  v_res jsonb;
  v_cliente uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_l from public.leads l where l.id = p_lead_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_l.status <> 'novo' then
    raise exception 'Este contato já foi tratado.' using errcode = 'P0001';
  end if;
  v_res := public._crmcad_cadastrar(p_dados, p_corretor_id, p_termo_id, 'lead_site', 'leads_converter');
  v_cliente := nullif(v_res ->> 'id', '')::uuid;
  if v_cliente is not null then
    update public.leads l set status = 'convertido', cliente_id = v_cliente, tratado_por = auth.uid(), tratado_em = now()
    where l.id = p_lead_id;
    perform public._auditar('operacao', 'converter', 'leads', p_lead_id::text, v_cliente,
      array['status', 'cliente_id', 'tratado_por', 'tratado_em'], jsonb_build_object('status', v_l.status),
      jsonb_build_object('status', 'convertido', 'cliente_id', v_cliente),
      jsonb_build_object('rpc', 'leads_converter', 'situacao', v_res ->> 'situacao'));
  end if;
  return v_res;
end $$;

create or replace function public.leads_descartar(p_lead_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.leads%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_l from public.leads l where l.id = p_lead_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_l.status <> 'novo' then
    raise exception 'Este contato já foi tratado.' using errcode = 'P0001';
  end if;
  if v_motivo is null or length(v_motivo) < 5 then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001';
  end if;
  update public.leads l set status = 'descartado', motivo_descarte = left(v_motivo, 2000), tratado_por = auth.uid(),
                            tratado_em = now()
  where l.id = p_lead_id;
  perform public._auditar('operacao', 'descartar', 'leads', p_lead_id::text, null,
    array['status', 'motivo_descarte', 'tratado_por', 'tratado_em'], jsonb_build_object('status', v_l.status),
    jsonb_build_object('status', 'descartado'), '{"rpc":"leads_descartar"}'::jsonb);
end $$;

-- Excluir só lead ainda não tratado (spam, §1.3); convertido e descartado ficam como histórico
create or replace function public.leads_excluir(p_lead_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.leads%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_l from public.leads l where l.id = p_lead_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_l.status <> 'novo' then
    raise exception 'Só é possível excluir contatos ainda não tratados.' using errcode = 'P0001';
  end if;
  delete from public.leads l where l.id = p_lead_id;
  perform public._auditar('operacao', 'excluir', 'leads', p_lead_id::text, null, null,
    jsonb_build_object('status', v_l.status), null, '{"rpc":"leads_excluir"}'::jsonb);
end $$;

-- Exportação auditada: todas as linhas que passam nos filtros (sem paginação), até 5.000, mais recentes primeiro
create or replace function public.leads_exportar(p_filtros jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_f jsonb := public._crmcad_objeto(p_filtros, 'p_filtros');
  v_status text := public._crmcad_filtro_opcao(v_f, 'status', enum_range(null::public.status_lead)::text[]);
  v_busca text := public._crmcad_busca(v_f);
  v_busca_dig text := public._crmcad_busca_digitos(v_f);
  v_emp uuid := public._crmcad_filtro_uuid(v_f, 'empreendimento_id');
  v_de date := public._crmcad_filtro_data(v_f, 'de');
  v_ate date := public._crmcad_filtro_data(v_f, 'ate');
  v_itens jsonb;
  v_ids uuid[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  with sel as (
    select l as ld from public.leads l
    where (v_status is null or l.status = v_status::public.status_lead)
      and (v_emp is null or l.empreendimento_id = v_emp)
      and (v_de is null or (l.created_at at time zone 'America/Sao_Paulo')::date >= v_de)
      and (v_ate is null or (l.created_at at time zone 'America/Sao_Paulo')::date <= v_ate)
      and (v_busca is null or l.nome ilike v_busca escape '\' or l.email ilike v_busca escape '\'
           or (v_busca_dig is not null and regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g') like v_busca_dig))
    order by l.created_at desc, l.id
    limit 5000
  )
  select coalesce(jsonb_agg(public._crmcad_lead(s.ld) order by (s.ld).created_at desc, (s.ld).id), '[]'::jsonb),
         coalesce(array_agg((s.ld).id), '{}'::uuid[])
    into v_itens, v_ids
  from sel s;

  perform public._auditar('acesso', 'exportar', 'leads', null, null, null, null, null,
    jsonb_build_object('rpc', 'leads_exportar', 'ids', to_jsonb(v_ids), 'total', cardinality(v_ids),
      'filtros', jsonb_strip_nulls(jsonb_build_object('status', v_status, 'busca', case when v_busca is not null then true end,
        'empreendimento_id', v_emp, 'de', v_de, 'ate', v_ate))));
  return v_itens;
end $$;

-- ============ PROPOSTAS (§1.3, §4.2, §4.4) ============
-- Lista: internos veem todas; parceiro aprovado vê pela cadeia (corretor/gerente/imobiliária) e as próprias sem
-- cliente (mesma regra da política "prop: escopo lê"). PAR-3 no autor e na cadeia.
create or replace function public.propostas_listar(p_filtros jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_f jsonb := public._crmcad_objeto(p_filtros, 'p_filtros');
  v_status text := public._crmcad_filtro_opcao(v_f, 'status', enum_range(null::public.status_proposta)::text[]);
  v_emp uuid := public._crmcad_filtro_uuid(v_f, 'empreendimento_id');
  v_cli uuid := public._crmcad_filtro_uuid(v_f, 'cliente_id');
  v_lim int := least(greatest(coalesce(public._crmcad_filtro_int(v_f, 'limite'), 50), 1), 200);
  v_off int := coalesce(public._crmcad_filtro_int(v_f, 'offset'), 0);
  v_admin boolean := public.is_admin();
  v_eu uuid := public.meu_parceiro_id();
  v_cor uuid := public.escopo_corretor();
  v_ger uuid := public.escopo_gerente();
  v_imob uuid := public.escopo_imobiliaria();
  v_total int;
  v_itens jsonb;
  v_ids uuid[];
begin
  if v_uid is null or not (v_admin or public.is_parceiro_aprovado()) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  with base as (
    select pr.* from public.propostas pr
    where (v_admin or pr.corretor_id = v_cor or pr.gerente_id = v_ger or pr.imobiliaria_id = v_imob
           or (pr.cliente_id is null and pr.parceiro_id = v_uid))
      and (v_status is null or pr.status = v_status::public.status_proposta)
      and (v_emp is null or pr.empreendimento_id = v_emp)
      and (v_cli is null or pr.cliente_id = v_cli)
  ), pagina as (
    select b.* from base b order by b.created_at desc, b.id limit v_lim offset v_off
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'empreendimento', jsonb_build_object('id', e.id, 'nome', e.nome),
               'unidade', case when u.id is not null then jsonb_build_object('id', u.id, 'identificador', u.identificador) end,
               'cliente', case when c.id is null then null
                               when v_admin or (c.inativado_em is null and (c.corretor_id = v_cor or c.gerente_id = v_ger
                                                                           or c.imobiliaria_id = v_imob))
                                 then jsonb_build_object('id', c.id, 'nome', btrim(c.nome || ' ' || coalesce(c.sobrenome, '')))
                               else jsonb_build_object('id', c.id, 'nome', 'Cliente indisponível') end,
               'autor', public._crmcad_ref_perfil(p.parceiro_id, v_admin, v_eu, v_ger, v_imob),
               'texto', p.texto, 'status', p.status, 'resposta_admin', p.resposta_admin,
               'criado_em', p.created_at, 'atualizado_em', p.updated_at, 'pode_responder', v_admin)
             || public._crmcad_cadeia(p.imobiliaria_id, p.gerente_id, p.corretor_id, v_admin, v_eu, v_ger, v_imob)
             order by p.created_at desc, p.id)
           from pagina p
           join public.empreendimentos e on e.id = p.empreendimento_id
           left join public.unidades u on u.id = p.unidade_id
           left join public.clientes c on c.id = p.cliente_id), '[]'::jsonb),
         coalesce((select array_agg(p.id) from pagina p), '{}'::uuid[])
    into v_total, v_itens, v_ids;

  perform public._auditar('acesso', 'listar', 'propostas', null, v_cli, null, null, null,
    jsonb_build_object('rpc', 'propostas_listar', 'ids', to_jsonb(v_ids), 'total', v_total,
      'filtros', jsonb_strip_nulls(jsonb_build_object('status', v_status, 'empreendimento_id', v_emp, 'cliente_id', v_cli))));
  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

-- Criar: parceiro aprovado (interno não cria proposta). Com cliente: cliente ativo no escopo (o gatilho
-- propostas_cadeia confere de novo pelo vínculo do autor). Empreendimento publicado; unidade do empreendimento e
-- não vendida. Os gatilhos de e-mail atuais (notificar_nova_proposta) continuam.
create or replace function public.propostas_criar(p_empreendimento_id uuid, p_cliente_id uuid, p_unidade_id uuid, p_texto text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid constant uuid := auth.uid();
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_emp public.empreendimentos%rowtype;
  v_id uuid;
begin
  if v_uid is null or public.is_admin() or not public.is_parceiro_aprovado() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_cliente_id is not null and not (public.pode_ver_cliente(p_cliente_id)
                                       and exists (select 1 from public.clientes c where c.id = p_cliente_id
                                                     and c.inativado_em is null)) then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_emp from public.empreendimentos e where e.id = p_empreendimento_id and e.publicado;
  if not found then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["empreendimento_id"]}';
  end if;
  if p_unidade_id is not null and not exists (select 1 from public.unidades u where u.id = p_unidade_id
                                                and u.empreendimento_id = p_empreendimento_id and u.status <> 'vendida') then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["unidade_id"]}';
  end if;
  if v_texto is null or length(v_texto) < 10 or length(v_texto) > 5000 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["texto"]}';
  end if;

  insert into public.propostas (parceiro_id, empreendimento_id, cliente_id, unidade_id, texto, status)
  values (v_uid, p_empreendimento_id, p_cliente_id, p_unidade_id, v_texto, 'enviada')
  returning id into v_id;

  if p_cliente_id is not null then
    perform public._evento_cliente(p_cliente_id, 'proposta_enviada', left('Proposta enviada: ' || v_emp.nome, 200),
                                   jsonb_build_object('proposta_id', v_id));
  end if;
  perform public._auditar('operacao', 'criar', 'propostas', v_id::text, p_cliente_id,
    array['empreendimento_id', 'unidade_id', 'cliente_id', 'texto'], null, jsonb_build_object('status', 'enviada'),
    jsonb_build_object('rpc', 'propostas_criar', 'empreendimento_id', p_empreendimento_id, 'unidade_id', p_unidade_id));
  return v_id;
end $$;

-- Responder: só internos; status e resposta ao parceiro. Timeline do cliente quando houver.
create or replace function public.propostas_responder(p_id uuid, p_status public.status_proposta, p_resposta text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.propostas%rowtype;
  v_resp text := nullif(btrim(coalesce(p_resposta, '')), '');
  v_campos text[] := '{}';
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_p from public.propostas pr where pr.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["status"]}';
  end if;
  if length(v_resp) > 5000 then
    raise exception 'DADOS_INVALIDOS' using errcode = 'P0001', detail = '{"campos":["resposta_admin"]}';
  end if;
  if v_p.status is distinct from p_status then v_campos := v_campos || 'status'::text; end if;
  if v_p.resposta_admin is distinct from v_resp then v_campos := v_campos || 'resposta_admin'::text; end if;
  if cardinality(v_campos) = 0 then
    return;
  end if;
  update public.propostas pr set status = p_status, resposta_admin = v_resp where pr.id = p_id;
  if v_p.cliente_id is not null then
    perform public._evento_cliente(v_p.cliente_id, 'proposta_respondida',
      'Proposta respondida: ' || public._crmcad_rotulo_proposta(p_status),
      jsonb_build_object('proposta_id', p_id, 'status', p_status));
  end if;
  perform public._auditar('operacao', 'responder', 'propostas', p_id::text, v_p.cliente_id, v_campos,
    jsonb_build_object('status', v_p.status), jsonb_build_object('status', p_status), '{"rpc":"propostas_responder"}'::jsonb);
end $$;

-- ============ PRÉ-CADASTRO PÚBLICO (§6.1, N9, H4, CRM-3) — só service_role (Edge pre-cadastro) ============
-- Confirmação de recebimento (crm.boas_vindas, N10) IGUAL para criado e duplicado (§6.1: "para ninguém descobrir se
-- um CPF está na base"). Se as boas-vindas saíssem só para o cliente criado (pelo e-mail gravado em clientes), quem
-- tem um link público digitaria o próprio e-mail e saberia pelo e-mail recebido se o CPF é novo. Por isso o e-mail
-- digitado fica aqui, e a fila aponta para esta linha nos DOIS caminhos, com o mesmo formato. Só a service role lê e
-- apaga (Edge notificar, depois de enviar); nada de cliente_id (a linha não pode revelar o dono). Vida curta: cada
-- chamada de crm_pre_cadastro apaga as de mais de 7 dias (a fila ignora notificação com mais de 7 dias).
create table if not exists public.pre_cadastro_avisos (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  primeiro_nome text check (length(primeiro_nome) <= 60),
  parceiro_id uuid not null references public.parceiros(id) on delete cascade,
  portal boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists pre_cadastro_avisos_criado_idx on public.pre_cadastro_avisos (criado_em);
alter table public.pre_cadastro_avisos enable row level security;
revoke all on public.pre_cadastro_avisos from public, anon, authenticated, service_role;
grant select, delete on public.pre_cadastro_avisos to service_role;

-- Põe na fila a confirmação do pré-cadastro para o e-mail DIGITADO (mesmos argumentos nos dois caminhos). Mesmas
-- regras de _notificar (tipo ligado, nada durante o corte), que não serve aqui: ela exige destinatário ou cliente_id.
-- dados = só o id do aviso (a fila não guarda dado pessoal).
create function public._crmcad_aviso_pre_cadastro(p_n jsonb, p_parceiro_id uuid, p_portal boolean)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_aviso uuid;
begin
  delete from public.pre_cadastro_avisos a where a.criado_em < now() - interval '7 days';
  if p_n ->> 'email' is null or coalesce(current_setting('arken.migracao', true), '') = 'on'
     or not coalesce((select n.ativo from public.notificacoes_config n where n.tipo = 'crm.boas_vindas'), false) then
    return;
  end if;
  insert into public.pre_cadastro_avisos (email, primeiro_nome, parceiro_id, portal)
  values (p_n ->> 'email', nullif(left(split_part(btrim(p_n ->> 'nome'), ' ', 1), 60), ''), p_parceiro_id,
          coalesce(p_portal, false))
  returning id into v_aviso;
  insert into public.notificacoes (tipo, destinatarios_ids, cliente_id, dados)
  values ('crm.boas_vindas', '{}'::uuid[], null, jsonb_build_object('aviso_id', v_aviso));
end $$;

-- 1. código ativo de um parceiro que pode receber (corretor, ou gerente com A1; a Carteira Arken tem código próprio);
--    senão {situacao:'codigo_invalido'} (a Edge responde 404);
-- 2. termo vigente de consentimento_cliente revisado pelo jurídico; sem ele 'termo_invalido' (503, H4); com ele,
--    mas outro termo_id (versão publicada com a página aberta), 'termo_desatualizado' (409: a página relê o termo);
-- 3. dados válidos (DV de CPF/CNPJ, telefone com DDD); senão DADOS_INVALIDOS (a Edge já validou antes);
-- 4. limite A2 por link (bloqueios por hora do dono do código), conferido ANTES de olhar o documento: 'limite' (429);
-- 5. A2 com trava consultiva: documento existente → tentativa registrada, timeline do dono sem dizer por quem,
--    {situacao:'duplicado'}; a Edge responde 200 igual ao criado;
-- 6. cria o cliente (NC, origem pre_cadastro_link, portal conforme portal_libera_pre_cadastro, só PF), o
--    consentimento com IP e navegador, as solicitações básicas (CRM-3), timeline, auditoria (edge:pre-cadastro) e
--    crm.novo_lead_corretor (para o corretor);
-- 7. nos DOIS caminhos (criado e duplicado): a confirmação crm.boas_vindas para o e-mail digitado (aviso acima). O
--    e-mail de documentos solicitados da criação fica 'ignorado' (só existiria no caminho criado); as solicitações
--    continuam criadas e o corretor pede de novo quando for o caso.
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
    v_res := public._crmcad_registrar_tentativa(v_existe, v_parc.id, 'pre_cadastro_link',
               exists (select 1 from public.clientes c where c.id = v_existe and c.corretor_id = v_parc.id));
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

-- ============ GRANTS ============
-- As RPCs acima mantêm os grants da 09 (create or replace). As internas novas: ninguém executa pela API.
revoke execute on function
  public._crmcad_objeto(jsonb, text), public._crmcad_txt(jsonb, text), public._crmcad_lista(jsonb, text),
  public._crmcad_arr(jsonb, text), public._crmcad_filtro_uuid(jsonb, text), public._crmcad_filtro_data(jsonb, text),
  public._crmcad_filtro_bool(jsonb, text), public._crmcad_filtro_int(jsonb, text),
  public._crmcad_filtro_opcao(jsonb, text, text[]), public._crmcad_padrao(text), public._crmcad_busca(jsonb),
  public._crmcad_busca_digitos(jsonb), public._crmcad_hoje(), public._crmcad_rotulo_etapa(public.etapa_funil),
  public._crmcad_rotulo_proposta(public.status_proposta), public._crmcad_interesses(), public._crmcad_contrato_ativo(uuid),
  public._crmcad_pode_receber(uuid), public._crmcad_ref_parceiro(uuid, boolean, uuid, uuid, uuid),
  public._crmcad_ref_imobiliaria(uuid, boolean, uuid), public._crmcad_cadeia(uuid, uuid, uuid, boolean, uuid, uuid, uuid),
  public._crmcad_nome_perfil(uuid, boolean, uuid, uuid, uuid), public._crmcad_ref_perfil(uuid, boolean, uuid, uuid, uuid),
  public._crmcad_normalizar(jsonb, public.tipo_pessoa, boolean, text[]), public._crmcad_resolver_corretor(uuid),
  public._crmcad_travar_limite(), public._crmcad_limite_excedido(), public._crmcad_limite_link_excedido(uuid),
  public._crmcad_travar_documento(public.tipo_pessoa, text), public._crmcad_aviso_pre_cadastro(jsonb, uuid, boolean),
  public._crmcad_registrar_tentativa(uuid, uuid, public.origem_cliente, boolean),
  public._crmcad_inserir(jsonb, public.tipo_pessoa, uuid, public.origem_cliente, boolean),
  public._crmcad_campos_preenchidos(jsonb), public._crmcad_avisar_corretor(uuid, uuid, public.origem_cliente),
  public._crmcad_cadastrar(jsonb, uuid, uuid, public.origem_cliente, text), public._crmcad_transferir(uuid, uuid, text, text),
  public._crmcad_resumo(public.clientes, boolean, uuid, uuid, uuid, date), public._crmcad_lead(public.leads)
  from public, anon, authenticated, service_role;
