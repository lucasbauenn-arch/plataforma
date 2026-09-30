-- Limite de tentativas por IP das rotas públicas: RESERVA ATÔMICA (revisão dinâmica, FR1-01).
-- Antes: a Edge Function conferia a contagem no INÍCIO da requisição e só gravava a tentativa no FIM. Uma rajada de
-- requisições simultâneas do mesmo IP via, toda ela, a contagem ainda vazia e passava inteira pelo limite:
--   - a varredura de CPFs contra o login do portal (a única mitigação do login só por CPF) deixava de ser limitada a
--     10 erros por 15 min e passava a ser limitada só pela concorrência;
--   - uma rajada de ~300 falhas estourava o teto global do portal e o derrubava para todos os clientes por 15 min;
--   - enviar-lead e pre-cadastro aceitavam centenas de envios de um IP (cada um dispara e-mail).
-- Agora quem confere também reserva, na MESMA transação e sob trava consultiva por (rota, IP): a tentativa entra na
-- tabela já como FALHA antes de a função processar o pedido; ao terminar com sucesso, a Edge a marca como sucesso
-- (tentativas_confirmar). Quem cair no meio do caminho (erro, timeout) continua contado como falha, que é o lado
-- conservador. A tabela continua só com select e insert para a service role (20260929000002): a atualização acontece
-- só dentro destas duas funções (security definer), que só a service role executa.
-- Vários baldes na mesma chamada (o login do portal reserva o do IP e o global): todos ou nenhum, com as travas
-- tomadas em ordem crescente de chave (sem deadlock entre chamadas com baldes em ordens diferentes).
-- Nenhuma referência a objeto de migration posterior.

-- p_baldes: jsonb array de 1 a 4 objetos
--   {"rota": "cliente-login", "ip": "203.0.113.9" | null, "janela_segundos": 900, "max_erros": 10, "max_total": 30}
-- Devolve {"permitido": true, "ids": [..]} ou {"permitido": false, "motivo": "erros" | "total", "rota": "<balde que bloqueou>"}.
-- Mesma regra do módulo supabase/functions/_shared/limite-ip.ts (decidirLimite): chegou ao máximo de erros ou ao total
-- → bloqueia (10 erros já bloqueiam a 11ª tentativa). O IP nulo é o balde comum dos sem IP (e do teto global).
-- lock_timeout: quem não conseguir a trava em 3 s recebe erro (a Edge responde 503, nunca libera sem contar).
create function public.tentativas_reservar(p_baldes jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  c_max_baldes constant int := 4;
  v_r record;
  v_chave int;
  v_agora timestamptz;
  v_total int;
  v_erros int;
  v_ids bigint[] := '{}';
  v_id bigint;
begin
  if jsonb_typeof(p_baldes) is distinct from 'array' or jsonb_array_length(p_baldes) not between 1 and c_max_baldes then
    raise exception 'BALDES_INVALIDOS' using errcode = '22023';
  end if;

  -- formato de cada balde (a Edge já valida; aqui é a última barreira e protege contra chamada direta)
  begin
    for v_r in
      select b.rota, b.ip, b.janela_segundos, b.max_erros, b.max_total
        from jsonb_to_recordset(p_baldes) as b(rota text, ip inet, janela_segundos int, max_erros int, max_total int)
    loop
      if v_r.rota is null or v_r.rota !~ '^[a-z0-9_-]{1,60}$'
         or v_r.janela_segundos is null or v_r.janela_segundos not between 1 and 86400
         or v_r.max_erros is null or v_r.max_erros < 1
         or v_r.max_total is null or v_r.max_total < v_r.max_erros or v_r.max_total > 10000 then
        raise exception 'BALDES_INVALIDOS' using errcode = '22023';
      end if;
    end loop;
  exception when others then
    raise exception 'BALDES_INVALIDOS' using errcode = '22023';
  end;

  -- trava por (rota, IP), em ordem crescente de chave: duas chamadas com os mesmos baldes em ordens diferentes não
  -- travam uma à outra. A trava dura até o fim da transação (a RPC), depois da inserção das reservas.
  for v_chave in
    select distinct pg_catalog.hashtext(b.rota || ':' || coalesce(pg_catalog.host(b.ip), ''))
      from jsonb_to_recordset(p_baldes) as b(rota text, ip inet, janela_segundos int, max_erros int, max_total int)
     order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arken.tentativas'), v_chave);
  end loop;

  -- com as travas na mão, o relógio é o de agora (não o do início da transação, que pode ter esperado a trava)
  v_agora := clock_timestamp();

  for v_r in
    select b.rota, b.ip, b.janela_segundos, b.max_erros, b.max_total
      from jsonb_to_recordset(p_baldes) as b(rota text, ip inet, janela_segundos int, max_erros int, max_total int)
  loop
    if v_r.ip is null then
      select count(*)::int, (count(*) filter (where not s.sucesso))::int into v_total, v_erros
        from (select t.sucesso from public.tentativas_publicas t
               where t.rota = v_r.rota and t.ip is null
                 and t.criado_em >= v_agora - make_interval(secs => v_r.janela_segundos)
               limit v_r.max_total) s;
    else
      select count(*)::int, (count(*) filter (where not s.sucesso))::int into v_total, v_erros
        from (select t.sucesso from public.tentativas_publicas t
               where t.rota = v_r.rota and t.ip = v_r.ip
                 and t.criado_em >= v_agora - make_interval(secs => v_r.janela_segundos)
               limit v_r.max_total) s;
    end if;
    if v_erros >= v_r.max_erros then
      return jsonb_build_object('permitido', false, 'motivo', 'erros', 'rota', v_r.rota);
    end if;
    if v_total >= v_r.max_total then
      return jsonb_build_object('permitido', false, 'motivo', 'total', 'rota', v_r.rota);
    end if;
  end loop;

  -- todos os baldes têm folga: reserva em todos, já como falha (a Edge confirma o sucesso no fim)
  for v_r in
    select b.rota, b.ip
      from jsonb_to_recordset(p_baldes) as b(rota text, ip inet, janela_segundos int, max_erros int, max_total int)
  loop
    insert into public.tentativas_publicas (rota, ip, sucesso, criado_em)
    values (v_r.rota, v_r.ip, false, v_agora)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  return jsonb_build_object('permitido', true, 'ids', to_jsonb(v_ids));
end $$;

-- Marca como SUCESSO as reservas da operação aceita (ids devolvidos por tentativas_reservar). Só mexe em reserva ainda
-- falha e recente (1 h): não reescreve o histórico. Devolve quantas linhas mudou.
create function public.tentativas_confirmar(p_ids bigint[])
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n int;
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 8 then
    raise exception 'IDS_INVALIDOS' using errcode = '22023';
  end if;
  update public.tentativas_publicas t
     set sucesso = true
   where t.id = any (p_ids) and not t.sucesso and t.criado_em > now() - interval '1 hour';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ============ GRANTS ============
-- RPCs de sistema: só a service role (Edge Functions públicas). Nem anon nem authenticated.
revoke execute on function public.tentativas_reservar(jsonb), public.tentativas_confirmar(bigint[])
  from public, anon, authenticated, service_role;
grant execute on function public.tentativas_reservar(jsonb), public.tentativas_confirmar(bigint[]) to service_role;

comment on function public.tentativas_reservar(jsonb) is
  'Reserva atômica de tentativas nas rotas públicas (limite por IP): confere a janela sob trava por (rota, IP) e já grava a tentativa como falha. Só service_role.';
comment on function public.tentativas_confirmar(bigint[]) is
  'Marca como sucesso as reservas de tentativas_reservar. Só service_role.';
