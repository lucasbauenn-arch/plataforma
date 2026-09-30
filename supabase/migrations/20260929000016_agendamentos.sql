-- Tarefas agendadas pelo pg_cron [WP6] (docs/ARQUITETURA_EXPANSAO.md §5.3, §6.5, §6.6, §6.8, §8.1).
--   arken-d4sign-reconciliar   de hora em hora (min. 7)   chama a Edge d4sign-reconciliar (WP4) por pg_net
--   arken-notificacoes-fila    a cada 10 minutos           public.notificacoes_reenviar() (fila de e-mails, §6.6)
--   arken-auditoria-purgar     mensal (dia 1, 03:30 UTC)   public.auditoria_purgar() (retenção H3 ⚑, §5.3)
--   arken-limpar-temporarios   mensal (dia 1, 04:00 UTC)   public.limpar_temporarios() (downloads vencidos, tentativas)
--   arken-cron-historico       mensal (dia 1, 04:30 UTC)   histórico do próprio pg_cron com mais de 30 dias
-- As tarefas que saem do banco (D4Sign e e-mails) ficam SEM EFEITO enquanto o Vault não tiver os segredos:
--   d4sign_reconciliar_url + cron_segredo    (reconciliação; o segredo vai no cabeçalho x-cron-secret, §6.5)
--   notificar_url + notificar_secret         (fila de e-mails; os mesmos do gatilho notificar_evento, 20260921000005)
-- Todas rodam como postgres (dono das funções); nenhuma tem grant para a API. cron.schedule com nome é idempotente
-- (atualiza a tarefa de mesmo nome), então reaplicar a migration não duplica nada.

create extension if not exists pg_cron with schema pg_catalog;

-- Chamada da Edge d4sign-reconciliar (§6.5): POST sem corpo útil, autenticado pelo segredo próprio (CRON_SEGREDO,
-- igual ao 'cron_segredo' do Vault; a Edge recusa sem ele). pg_net é assíncrono: a resposta fica em net._http_response
-- e a própria Edge registra o resultado em integracao_chamadas. Sem os dois segredos no Vault: não faz nada.
create function public._cron_d4sign_reconciliar() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'd4sign_reconciliar_url';
  select s.decrypted_secret into v_segredo from vault.decrypted_secrets s where s.name = 'cron_segredo';
  if nullif(btrim(v_url), '') is null or nullif(btrim(v_segredo), '') is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_segredo),
    timeout_milliseconds := 120000);
end $$;
revoke execute on function public._cron_d4sign_reconciliar() from public, anon, authenticated, service_role;

select cron.schedule('arken-d4sign-reconciliar', '7 * * * *', $$select public._cron_d4sign_reconciliar()$$);
select cron.schedule('arken-notificacoes-fila', '*/10 * * * *', $$select public.notificacoes_reenviar()$$);
select cron.schedule('arken-auditoria-purgar', '30 3 1 * *', $$select public.auditoria_purgar()$$);
select cron.schedule('arken-limpar-temporarios', '0 4 1 * *', $$select public.limpar_temporarios()$$);
select cron.schedule('arken-cron-historico', '30 4 1 * *',
  $$delete from cron.job_run_details where end_time < now() - interval '30 days'$$);
