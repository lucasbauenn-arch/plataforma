-- Notificações por e-mail (Edge Function notificar, envio pelo Resend):
--   admin ← novo parceiro (cadastro espontâneo), nova proposta, novo lead
--   parceiro ← proposta mudou de status / recebeu resposta
-- Os gatilhos chamam a função via pg_net. URL e segredo ficam no Vault ('notificar_url', 'notificar_secret');
-- sem eles (ex.: banco local) nada é enviado. Falha na notificação nunca bloqueia a gravação.
create extension if not exists pg_net with schema extensions;

create or replace function public.notificar_evento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notificar_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'notificar_secret';
  if v_url is null or v_segredo is null then return null; end if;
  -- novo parceiro: só cadastro espontâneo (convidados já entram aprovados; contas do portal usam e-mail interno)
  -- (if aninhado: new.email só existe em profiles; a expressão não pode ser preparada para as outras tabelas)
  if tg_table_name = 'profiles' then
    if coalesce(new.email, '') like '%@portal.arkenincorporadora.com.br'
       or exists (select 1 from auth.users u where u.id = new.id and u.invited_at is not null) then
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
revoke execute on function public.notificar_evento() from public, anon, authenticated;

create trigger notificar_novo_parceiro after insert on public.profiles
for each row when (new.papel = 'parceiro')
execute function public.notificar_evento();

create trigger notificar_nova_proposta after insert on public.propostas
for each row execute function public.notificar_evento();

create trigger notificar_proposta_atualizada after update on public.propostas
for each row when (new.status is distinct from old.status or new.resposta_admin is distinct from old.resposta_admin)
execute function public.notificar_evento();

create trigger notificar_novo_lead after insert on public.leads
for each row execute function public.notificar_evento();
