-- Propostas: a unidade opcional precisa estar DISPONÍVEL (pedido do dono, 30/09/2026). O formulário "Fazer proposta"
-- (painel do parceiro e aba Propostas da ficha) só oferece as unidades com status 'disponivel' do empreendimento
-- escolhido; a 11 aceitava qualquer unidade não vendida (inclusive 'reservada'). Só o corpo muda (create or replace,
-- mesma assinatura); os grants da 09 continuam valendo. Resto idêntico à 20260929000011.
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
  -- unidade do mesmo empreendimento e disponível (reservada e vendida ficam de fora)
  if p_unidade_id is not null and not exists (select 1 from public.unidades u where u.id = p_unidade_id
                                                and u.empreendimento_id = p_empreendimento_id
                                                and u.status = 'disponivel') then
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
