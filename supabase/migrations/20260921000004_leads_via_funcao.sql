-- Leads passam a entrar só pela Edge Function enviar-lead, que valida o Cloudflare Turnstile.
-- Sem isso, um robô postaria direto na Data API com a chave publishable e o anti-spam seria contornado.
drop policy if exists "leads: inserir" on public.leads;
revoke insert on public.leads from anon, authenticated;
