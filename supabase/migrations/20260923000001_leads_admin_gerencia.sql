-- Admin só podia ler leads (política "leads: admin" era só select); passa a poder excluir também
-- (ex.: descartar spam/duplicado). Sem update — lead não tem campo de status para editar.
drop policy if exists "leads: admin" on public.leads;
create policy "leads: admin lê e exclui" on public.leads for select using (public.is_admin());
create policy "leads: admin exclui" on public.leads for delete using (public.is_admin());
