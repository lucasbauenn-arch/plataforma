-- Portal do cliente: mensagem certa quando o CPF existe mas o acesso não está liberado (pedido do dono, 29/09/2026).
-- A Edge cliente-login só chama isto depois de portal_localizar_cliente não achar ninguém. Troca de privacidade aceita:
-- a resposta revela que o CPF é (ou foi) cliente; o limite por IP do cliente-login (tentativas_reservar) contém a
-- enumeração. Anonimizado (LGPD) e pessoa jurídica continuam como "nao_encontrado".
create or replace function public.portal_situacao_cpf(p_cpf text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_inativo boolean;
  v_liberado boolean;
begin
  if v_cpf !~ '^\d{11}$' or not public.cpf_valido(v_cpf) then
    return 'nao_encontrado';
  end if;
  select c.inativado_em is not null, c.portal_liberado into v_inativo, v_liberado
  from public.clientes c
  where c.cpf = v_cpf and c.tipo_pessoa = 'fisica' and c.anonimizado_em is null
  limit 1;
  if not found then return 'nao_encontrado'; end if;
  if v_inativo then return 'inativo'; end if;
  if not v_liberado then return 'bloqueado'; end if;
  return 'liberado';
end $$;

revoke all on function public.portal_situacao_cpf(text) from public, anon, authenticated;
grant execute on function public.portal_situacao_cpf(text) to service_role;
