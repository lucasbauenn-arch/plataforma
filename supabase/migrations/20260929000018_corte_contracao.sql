-- Corte e contração num passo só (WP7; docs/ARQUITETURA_EXPANSAO.md §2.4, §4.2, §4.3, §8.1, §10.1).
-- Não há front novo no ar (§10.1): a migração de dados da §2.4 e o fim do legado entram juntos, aplicados com as
-- demais migrations. Antes de aplicar em produção: rodar scripts/migracao/previa.sql, revisar com o negócio e gravar as
-- decisões em migracao_decisoes (dono_cpf, etapa_cliente_portal) — este arquivo lê e depois esvazia essa tabela.
--
-- O que faz, em ordem:
--   1. parceiro_clientes → legado_parceiro_clientes (arquivo, sem acesso pela API) + mapas do corte
--      (migracao_parceiro_clientes, migracao_propostas); propostas.parceiro_cliente_id sai (o vínculo fica no mapa);
--   2. _migracao_corte(): a migração de dados da §2.4 (parceiros legados → corretores migrados na cadeia da casa;
--      etapa dos clientes do portal; parceiro_clientes → clientes do CRM, com notas, conflitos e pendências; propostas
--      pelo mapa), lendo migracao_decisoes, que é esvaziada no fim; grava a auditoria 'migracao' com os totais e as
--      pendências abertas. Durante a execução arken.migracao = 'on' (a fila de e-mails não dispara);
--   3. clientes: corretor/gerente/imobiliária NOT NULL; origem padrão 'cadastro_interno'; fim do ramo 'portal_admin'
--      (o insert da tela antiga não libera mais o portal sozinho);
--   4. revogações da §4.3: clientes e leads sem nenhum acesso direto de authenticated; propostas idem (tudo por RPC);
--   5. protege_campos_profile v4: papel, status e inativação nunca pela API (só RPC, service role ou SQL);
--   6. exceção controlada das guardas de somente inclusão e do contrato congelado para a anonimização a pedido do
--      titular (WP6R-01, §5.5): com arken.anonimizacao = 'on' aceitam só a troca do texto livre por "[removido — LGPD]";
--   7. corpo de migracao_pendencias_resolver (internos).
-- Não há dado pessoal na auditoria nem no detalhe das pendências: só ids, contagens e códigos.

-- ============ 1. LEGADO E MAPAS ============
alter table public.parceiro_clientes rename to legado_parceiro_clientes;
comment on table public.legado_parceiro_clientes is
  'Carteira de clientes do sistema antigo de parceiros (arquivo do corte, WP7). Sem acesso pela API. O destino de cada '
  'linha está em migracao_parceiro_clientes. A anonimização a pedido do titular também limpa estas linhas.';
revoke all on public.legado_parceiro_clientes from anon, authenticated, service_role;
-- sem política: RLS ligada e nenhuma política = nega tudo (a política "pc: dono" era da tela antiga)
drop policy if exists "pc: dono" on public.legado_parceiro_clientes;

-- mapa do corte (§3.9): o destino de cada linha legada. cliente_id = o cliente do CRM que corresponde à linha (o criado
-- a partir dela, aquele em que ela foi juntada ou, nos conflitos, o que já tinha o CPF); resultado diz se migrou.
-- A anonimização a pedido do titular usa este mapa para limpar também as linhas legadas dele.
create table public.migracao_parceiro_clientes (
  parceiro_cliente_id uuid primary key references public.legado_parceiro_clientes(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id),
  resultado text not null check (resultado in (
    'migrado',               -- virou um cliente do CRM (CPF válido)
    'migrado_sem_cpf',       -- virou um cliente sem CPF (não havia CPF no cadastro antigo)
    'migrado_cpf_invalido',  -- virou um cliente sem CPF; o valor digitado ficou numa nota (pendência cpf_invalido)
    'juntado',               -- mesmo CPF no mesmo parceiro: juntado ao cliente de cliente_id
    'conflito_portal',       -- mesmo CPF de um cliente do portal: não migrou (pendência)
    'conflito_cliente',      -- mesmo CPF de um cliente que já estava no CRM: não migrou (pendência)
    'conflito_parceiros')),  -- mesmo CPF na carteira de outro parceiro, que ficou como dono: não migrou (pendência)
  processado_em timestamptz not null default now()
);
create index migracao_parceiro_clientes_cliente_idx on public.migracao_parceiro_clientes (cliente_id)
  where cliente_id is not null;

-- mapa das propostas: o vínculo antigo com parceiro_clientes (a coluna sai de propostas logo abaixo) e o cliente que a
-- proposta recebeu no corte. resultado nulo = ainda não processada por _migracao_corte().
create table public.migracao_propostas (
  proposta_id uuid primary key references public.propostas(id) on delete cascade,
  parceiro_cliente_id uuid not null references public.legado_parceiro_clientes(id) on delete cascade,
  cliente_id uuid references public.clientes(id),
  resultado text check (resultado in (
    'vinculada',             -- recebeu o cliente migrado (cadeia do cliente)
    'cliente_nao_migrado',   -- o registro antigo não migrou (conflito): fica sem cliente, com a cadeia do autor
    'fora_do_escopo')),      -- o cliente migrado não é da carteira do autor: fica sem cliente (pendência)
  processado_em timestamptz,
  check ((resultado = 'vinculada') = (cliente_id is not null))
);
create index migracao_propostas_parceiro_cliente_idx on public.migracao_propostas (parceiro_cliente_id);
create index migracao_propostas_cliente_idx on public.migracao_propostas (cliente_id) where cliente_id is not null;

alter table public.migracao_parceiro_clientes enable row level security;
alter table public.migracao_propostas enable row level security;
revoke all on public.migracao_parceiro_clientes, public.migracao_propostas from anon, authenticated, service_role;

insert into public.migracao_propostas (proposta_id, parceiro_cliente_id)
select p.id, p.parceiro_cliente_id from public.propostas p where p.parceiro_cliente_id is not null;

-- contração: propostas deixa de depender da tabela legada (o índice da FK sai junto com a coluna)
alter table public.propostas drop column parceiro_cliente_id;

-- ============ 2. MIGRAÇÃO DE DADOS (§2.4) ============
-- Pendência de migração (fila da tela "Pendências da migração"); uma por tipo e registro. Detalhe sem dado pessoal.
create function public._migracao_pendencia(p_tipo text, p_tabela text, p_registro uuid, p_relacionado uuid, p_detalhe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.migracao_pendencias (tipo, tabela, registro_id, relacionado_id, detalhe)
  select p_tipo, p_tabela, p_registro, p_relacionado, left(p_detalhe, 2000)
  where not exists (select 1 from public.migracao_pendencias m
                    where m.tipo = p_tipo and m.tabela = p_tabela and m.registro_id = p_registro)
$$;

-- nota migrada (cliente_notas: 1 a 10.000 caracteres): textos maiores viram várias notas, na ordem
create function public._migracao_nota(p_cliente_id uuid, p_texto text, p_autor uuid, p_quando timestamptz)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_texto constant text := btrim(coalesce(p_texto, ''));
  v_parte text;
  v_i int := 1;
  v_n int := 0;
begin
  while v_i <= length(v_texto) loop
    v_parte := substr(v_texto, v_i, 10000);
    v_i := v_i + 10000;
    continue when btrim(v_parte) = '';
    insert into public.cliente_notas (cliente_id, texto, autor_id, criado_em, migrado_legado)
    values (p_cliente_id, v_parte, p_autor, coalesce(p_quando, now()), true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Um cliente do CRM a partir de linhas legadas do MESMO parceiro (a 1ª, a mais antiga, é a base; as demais têm o
-- mesmo CPF e são juntadas). p_cpf: CPF válido (dígitos) ou nulo. p_nota_cpf: o CPF inválido digitado, que vira nota.
-- Responsável: o vínculo ativo do dono antigo (criado no passo 1); sem vínculo ativo, a Carteira Arken + pendência.
-- A cadeia vem do gatilho clientes_cadeia; o histórico de vínculos abre com o rótulo do corte (arken.motivo_vinculo).
create function public._migracao_cliente(p_ids uuid[], p_cpf text, p_nota_cpf text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_base public.legado_parceiro_clientes%rowtype;
  v_corretor uuid;
  v_casa uuid;
  v_dias int;
  v_cliente uuid;
  v_tel text;
  v_tels text[];
  v_rg text;
  v_interesses text[];
  v_r record;
  v_notas int := 0;
  v_diverge_id uuid;
begin
  select * into v_base from public.legado_parceiro_clientes pc where pc.id = p_ids[1];
  select c.corretor_casa_id, c.exclusividade_dias into v_casa, v_dias from public.configuracao_geral c;
  select p.id into v_corretor from public.parceiros p
   where p.profile_id = v_base.parceiro_id and p.inativado_em is null
     and (p.tipo = 'corretor' or (p.tipo = 'gerente' and coalesce((select r.permitido from public.permissoes_rede r
                                   where r.acao = 'gerente_como_corretor' and r.tipo = 'gerente'), false)));

  v_tel := nullif(regexp_replace(coalesce(v_base.telefone, ''), '\D', '', 'g'), '');
  if length(v_tel) > 20 then v_tel := null; end if;
  select coalesce(array_agg(t order by t), '{}') into v_tels from (
    select distinct nullif(regexp_replace(coalesce(pc.telefone, ''), '\D', '', 'g'), '') as t
    from public.legado_parceiro_clientes pc where pc.id = any (p_ids)) x
  where t is not null and t is distinct from v_tel and length(t) <= 20;
  v_tels := v_tels[1:10];
  select nullif(btrim(pc.rg), '') into v_rg from public.legado_parceiro_clientes pc
   where pc.id = any (p_ids) and nullif(btrim(pc.rg), '') is not null and length(btrim(pc.rg)) <= 30
   order by array_position(p_ids, pc.id) limit 1;
  select coalesce(array_agg(i order by i), '{}') into v_interesses from (
    select distinct btrim(i) as i from public.legado_parceiro_clientes pc, unnest(pc.interesses) i
    where pc.id = any (p_ids) and i is not null and btrim(i) <> '') x;
  v_interesses := v_interesses[1:40];

  insert into public.clientes (nome, cpf, telefone, telefones_adicionais, rg, interesses, origem, etapa, etapa_desde,
                               corretor_id, portal_liberado, exclusividade_ate, created_at, criado_por)
  values (coalesce(nullif(btrim(v_base.nome), ''), 'Cliente sem nome (migrado)'), p_cpf, v_tel, v_tels, v_rg,
          v_interesses, 'migracao_parceiro_clientes', 'novo_contato', v_base.created_at,
          coalesce(v_corretor, v_casa), false, v_base.created_at + make_interval(days => v_dias), v_base.created_at,
          v_base.parceiro_id)
  returning id into v_cliente;

  -- anotações de cada registro (a mais antiga primeiro) e o que não coube nas colunas
  for v_r in select pc.*, o.n from public.legado_parceiro_clientes pc
             join unnest(p_ids) with ordinality o(id, n) on o.id = pc.id order by o.n loop
    v_notas := v_notas + public._migracao_nota(v_cliente, v_r.anotacoes, v_r.parceiro_id, v_r.created_at);
    if v_r.n > 1 and lower(btrim(v_r.nome)) is distinct from lower(btrim(v_base.nome)) and btrim(v_r.nome) <> '' then
      v_notas := v_notas + public._migracao_nota(v_cliente,
        'Cadastro juntado do sistema antigo (mesmo CPF), com o nome: ' || btrim(v_r.nome), v_r.parceiro_id, v_r.created_at);
      v_diverge_id := coalesce(v_diverge_id, v_r.id);
    end if;
    -- [MIG-02] o RG de um cadastro juntado que difere do que ficou na coluna também vira nota (antes só o RG com mais de
    -- 30 caracteres virava): dois RGs diferentes com o mesmo CPF indicam CPF digitado errado, e o dado não se perde
    if v_r.n > 1 and length(btrim(coalesce(v_r.rg, ''))) between 1 and 30
       and regexp_replace(lower(btrim(v_r.rg)), '[^0-9a-z]', '', 'g')
           is distinct from regexp_replace(lower(coalesce(v_rg, '')), '[^0-9a-z]', '', 'g') then
      v_notas := v_notas + public._migracao_nota(v_cliente,
        'RG informado em cadastro juntado do sistema antigo (mesmo CPF): ' || btrim(v_r.rg), v_r.parceiro_id, v_r.created_at);
      v_diverge_id := coalesce(v_diverge_id, v_r.id);
    end if;
    if length(btrim(coalesce(v_r.rg, ''))) > 30 then
      v_notas := v_notas + public._migracao_nota(v_cliente, 'RG informado no sistema antigo: ' || btrim(v_r.rg),
                                                 v_r.parceiro_id, v_r.created_at);
    end if;
    if length(regexp_replace(coalesce(v_r.telefone, ''), '\D', '', 'g')) > 20 then
      v_notas := v_notas + public._migracao_nota(v_cliente, 'Telefone informado no sistema antigo: ' || btrim(v_r.telefone),
                                                 v_r.parceiro_id, v_r.created_at);
    end if;
  end loop;
  if p_nota_cpf is not null then
    v_notas := v_notas + public._migracao_nota(v_cliente,
      'CPF informado no sistema antigo, com dígito verificador inválido (o cliente foi migrado sem CPF): ' || p_nota_cpf,
      v_base.parceiro_id, now());
  end if;

  perform public._evento_cliente(v_cliente, 'migracao', 'Cliente migrado da carteira do parceiro no sistema antigo',
    jsonb_build_object('origem', 'migracao_parceiro_clientes', 'registros', cardinality(p_ids), 'notas', v_notas));
  -- [MIG-02] juntada com nome ou RG diferentes: pode ser outra pessoa com o CPF digitado errado. A fusão segue a regra da
  -- §2.4 (mesmo CPF no mesmo parceiro), mas o negócio precisa ver o caso: nome e RG de cada cadastro estão nas notas
  if v_diverge_id is not null then
    perform public._migracao_pendencia('juntada_divergente', 'clientes', v_cliente, v_diverge_id,
      'Cadastros do mesmo parceiro com o mesmo CPF foram juntados neste cliente, mas têm nome ou RG diferentes: podem ser '
      || 'pessoas diferentes com o CPF digitado errado. O nome e o RG de cada cadastro estão nas notas do cliente e as '
      || 'propostas deles ficaram aqui. Se forem pessoas diferentes, cadastre a outra pela ficha e ajuste as propostas.');
  end if;
  if v_corretor is null then
    perform public._migracao_pendencia('dono_sem_vinculo', 'clientes', v_cliente, v_base.parceiro_id,
      'O dono do registro no sistema antigo não tem vínculo ativo de corretor na rede: o cliente foi para a Carteira '
      || 'Arken. Se outro corretor deve atendê-lo, transfira pela ficha.');
  end if;
  return v_cliente;
end $$;

-- A migração de dados da §2.4. Idempotente: só processa o que ainda não foi migrado (perfis 'parceiro' sem vínculo,
-- clientes do portal sem registro de etapa, linhas legadas fora do mapa, propostas do mapa sem resultado). Roda como
-- postgres (sem grant); os testes (migracao.test.sql) a chamam de novo sobre dados legados de exemplo.
create function public._migracao_corte()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_motivo_parceiro constant text := 'migração: parceiro legado na Gerência Arken';
  c_motivo_cliente constant text := 'migração: carteira do parceiro no sistema antigo';
  v_migracao_antes constant text := coalesce(current_setting('arken.migracao', true), '');
  v_motivo_antes constant text := coalesce(current_setting('arken.motivo_vinculo', true), '');
  v_cfg record;
  v_r record;
  v_g record;
  v_pc record;
  v_parceiro uuid;
  v_cpf text;
  v_cpf_ok boolean;
  v_tel text;
  v_creci text;
  v_nome text;
  v_status public.status_parceiro;
  v_valor text;
  v_decisao_ok boolean;
  v_etapa public.etapa_funil;
  v_existente record;
  v_donos uuid[];
  v_dono uuid;
  v_decisao_dono text;
  v_ids_dono uuid[];
  v_cliente uuid;
  v_autor_papel public.papel;
  v_n_decisoes int := 0;
  v_n_parceiros int := 0;
  v_n_pendente_bloqueado int := 0;
  v_n_papel int := 0;
  v_n_portal int := 0;
  v_n_portal_finalizado int := 0;
  v_n_clientes int := 0;
  v_n_juntados int := 0;
  v_n_juntada_diverge int := 0;
  v_n_sem_cpf int := 0;
  v_n_cpf_invalido int := 0;
  v_n_conflito_portal int := 0;
  v_n_conflito_cliente int := 0;
  v_n_conflito_parceiros int := 0;
  v_n_prop_vinculadas int := 0;
  v_n_prop_sem_cliente int := 0;
  v_n_prop_fora int := 0;
  v_pendencias jsonb;
  v_totais jsonb;
begin
  perform set_config('arken.migracao', 'on', true);
  select c.imobiliaria_casa_id, c.gerente_casa_id, c.corretor_casa_id into v_cfg from public.configuracao_geral c;
  select count(*) into v_n_decisoes from public.migracao_decisoes;

  -- ---- 2.1 parceiros legados → corretores migrados na cadeia da casa (§2.4) ----
  -- Papel 'parceiro' sem vínculo, com status aprovado ou bloqueado, ou com carteira no sistema antigo. O pendente com
  -- carteira (foi aprovado e depois voltou a pendente no sistema antigo) entra BLOQUEADO: mantém a carteira sem acesso
  -- (N19) e a equipe decide pela pendência (desbloquear = aprovar). O pendente sem carteira não muda (autocadastro,
  -- aprovado depois por rede_aprovar_autocadastro). CPF do perfil só se válido e livre entre os parceiros; senão, o
  -- vínculo nasce sem CPF (permitido ao legado) e a tela "Meu cadastro" pede para completar. E-mail = o do login.
  perform set_config('arken.motivo_vinculo', c_motivo_parceiro, true);
  for v_r in
    select pr.id, pr.nome, pr.telefone, pr.cpf, pr.creci, pr.imobiliaria, pr.status_parceiro,
           nullif(left(lower(btrim(coalesce(u.email, pr.email, ''))), 200), '') as email
    from public.profiles pr left join auth.users u on u.id = pr.id
    where pr.papel = 'parceiro'
      and not exists (select 1 from public.parceiros p where p.profile_id = pr.id)
      and (pr.status_parceiro in ('aprovado', 'bloqueado')
           or exists (select 1 from public.legado_parceiro_clientes pc
                      where pc.parceiro_id = pr.id
                        and not exists (select 1 from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pc.id)))
    order by pr.created_at, pr.id
  loop
    v_cpf := nullif(regexp_replace(coalesce(v_r.cpf, ''), '\D', '', 'g'), '');
    v_cpf_ok := v_cpf ~ '^\d{11}$' and public.cpf_valido(v_cpf)
                and not exists (select 1 from public.parceiros p where p.cpf = v_cpf);
    v_tel := nullif(regexp_replace(coalesce(v_r.telefone, ''), '\D', '', 'g'), '');
    if length(v_tel) not between 10 and 13 then v_tel := null; end if;     -- fora do formato: fica só no perfil
    v_creci := nullif(btrim(coalesce(v_r.creci, '')), '');
    if length(v_creci) > 60 then v_creci := null; end if;
    v_nome := left(coalesce(nullif(btrim(v_r.nome), ''), nullif(split_part(coalesce(v_r.email, ''), '@', 1), ''),
                            'Parceiro'), 200);
    v_status := case when v_r.status_parceiro = 'pendente' then 'bloqueado'::public.status_parceiro else v_r.status_parceiro end;

    insert into public.parceiros (profile_id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci, email, telefone,
                                  migrado_legado, imobiliaria_declarada, codigo_indicacao)
    values (v_r.id, 'corretor', v_cfg.imobiliaria_casa_id, v_cfg.gerente_casa_id, v_nome,
            case when v_cpf_ok then v_cpf end, v_creci, v_r.email, v_tel, true,
            left(nullif(btrim(coalesce(v_r.imobiliaria, '')), ''), 200),
            case when v_status = 'aprovado' then public._gerar_codigo_indicacao() end)
    returning id into v_parceiro;
    v_n_parceiros := v_n_parceiros + 1;

    if v_status is distinct from v_r.status_parceiro then
      update public.profiles pr set status_parceiro = v_status where pr.id = v_r.id;
      v_n_pendente_bloqueado := v_n_pendente_bloqueado + 1;
      perform public._migracao_pendencia('parceiro_pendente_com_clientes', 'parceiros', v_parceiro, v_r.id,
        'Autocadastro pendente com carteira de clientes no sistema antigo: o vínculo foi criado com o acesso bloqueado. '
        || 'Para aprovar, complete o CPF e o CRECI na Rede e desbloqueie o parceiro (a primeira aprovação exige os dois '
        || 'campos); para recusar, transfira a carteira e inative o parceiro.');
    end if;
    insert into public.parceiro_status_historico (profile_id, parceiro_id, de, para, motivo, origem)
    values (v_r.id, v_parceiro, v_r.status_parceiro, v_status,
            case when v_status is distinct from v_r.status_parceiro
                 then 'Migração do sistema antigo: autocadastro pendente com carteira de clientes (acesso bloqueado até a decisão da equipe).'
                 else 'Migração do sistema antigo: vínculo de corretor na Gerência Arken.' end,
            'migracao');
    if v_cpf is not null and not v_cpf_ok then
      perform public._migracao_pendencia('cpf_parceiro_invalido', 'parceiros', v_parceiro, v_r.id,
        'O CPF do perfil do parceiro no sistema antigo é inválido ou já pertence a outro parceiro: o vínculo foi criado '
        || 'sem CPF. O parceiro completa em "Meu cadastro"; confira o documento antes de aprovar a regularização.');
    end if;
  end loop;

  -- contração: o papel 'parceiro' com vínculo vira o tipo do vínculo (os legados, 'corretor'). Depois disso 'parceiro'
  -- sobra só para o autocadastro sem vínculo (pendente ou recusado), sem escopo.
  update public.profiles pr set papel = p.tipo::text::public.papel
    from public.parceiros p
   where p.profile_id = pr.id and pr.papel = 'parceiro';
  get diagnostics v_n_papel = row_count;

  -- ---- 2.2 clientes do portal (origem 'portal_admin'): etapa inicial; NUNCA trocam de dono ----
  -- finalizado se houver cliente_negocios, senão novo_contato (N15), salvo decisão etapa_cliente_portal (chave = id
  -- do cliente ou CPF). Gravada direto (o _transicionar recusa a origem 'migracao') com historico_status 'migracao'.
  for v_r in
    select c.id, c.cpf, c.created_at,
           (select min(n.created_at) from public.cliente_negocios n where n.cliente_id = c.id) as primeiro_negocio
    from public.clientes c
    where c.origem = 'portal_admin' and c.anonimizado_em is null
      and not exists (select 1 from public.historico_status h where h.entidade = 'cliente_etapa' and h.entidade_id = c.id)
    order by c.created_at, c.id
  loop
    select d.valor into v_valor from public.migracao_decisoes d
     where d.tipo = 'etapa_cliente_portal' and d.chave in (v_r.id::text, coalesce(v_r.cpf, ''))
     order by (d.chave = v_r.id::text) desc limit 1;
    v_decisao_ok := v_valor is not null and v_valor in (select unnest(enum_range(null::public.etapa_funil))::text);
    v_etapa := case when v_decisao_ok then v_valor::public.etapa_funil
                    when v_r.primeiro_negocio is not null then 'finalizado'::public.etapa_funil
                    else 'novo_contato'::public.etapa_funil end;
    update public.clientes c
       set etapa = v_etapa,
           etapa_desde = case when v_etapa = 'finalizado' and v_r.primeiro_negocio is not null then v_r.primeiro_negocio
                              else v_r.created_at end,
           motivo_perda = case when v_etapa = 'perdido' then 'Definido na migração dos dados (decisão do negócio).' end
     where c.id = v_r.id;
    insert into public.historico_status (entidade, entidade_id, de, para, motivo, origem)
    values ('cliente_etapa', v_r.id, null, v_etapa::text,
            case when v_decisao_ok then 'Migração: etapa definida por decisão do negócio.'
                 when v_etapa = 'finalizado' then 'Migração: cliente do portal com negócio registrado.'
                 else 'Migração: cliente do portal sem negócio registrado.' end,
            'migracao');
    perform public._evento_cliente(v_r.id, 'migracao', 'Cliente do portal incluído no CRM',
      jsonb_build_object('origem', 'portal_admin', 'etapa', v_etapa, 'decisao', v_decisao_ok));
    v_n_portal := v_n_portal + 1;
    if v_etapa = 'finalizado' then v_n_portal_finalizado := v_n_portal_finalizado + 1; end if;
    if v_valor is not null and not v_decisao_ok then
      perform public._migracao_pendencia('decisao_invalida', 'clientes', v_r.id, null,
        'A decisão de etapa registrada para este cliente do portal tem um valor inválido: valeu a regra padrão '
        || '(finalizado com negócio registrado; senão, novo contato). Ajuste a etapa pelo funil, se for o caso.');
    end if;
    if v_r.cpf is not null and not (v_r.cpf ~ '^\d{11}$' and public.cpf_valido(v_r.cpf)) then
      perform public._migracao_pendencia('cpf_invalido', 'clientes', v_r.id, null,
        'Cliente do portal com CPF inválido no cadastro: o login do portal não o encontra. Corrija o CPF pela ficha '
        || '(equipe Arken).');
    end if;
  end loop;

  -- ---- 2.3 parceiro_clientes → clientes do CRM (§2.4) ----
  perform set_config('arken.motivo_vinculo', c_motivo_cliente, true);
  -- (a) CPF válido: por CPF, em ordem de antiguidade
  for v_g in
    select x.cpf, array_agg(x.id order by x.created_at, x.id) as ids
    from (select pc.id, pc.created_at, regexp_replace(coalesce(pc.cpf, ''), '\D', '', 'g') as cpf
          from public.legado_parceiro_clientes pc
          where not exists (select 1 from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pc.id)) x
    where x.cpf ~ '^\d{11}$' and public.cpf_valido(x.cpf)
    group by x.cpf
    order by min(x.created_at), x.cpf
  loop
    select d.valor into v_decisao_dono from public.migracao_decisoes d where d.tipo = 'dono_cpf' and d.chave = v_g.cpf;

    -- mesmo CPF de um cliente que já existe (do portal ou do CRM): não migra; o cliente existente nunca troca de dono
    -- na migração (nem por decisão registrada)
    -- (compara só os dígitos: um CPF antigo do portal gravado com máscara também conta)
    select c.id, c.origem into v_existente from public.clientes c
     where c.cpf = v_g.cpf or (c.cpf !~ '^\d{11}$' and regexp_replace(c.cpf, '\D', '', 'g') = v_g.cpf)
     order by (c.cpf = v_g.cpf) desc, c.created_at limit 1;
    if found then
      insert into public.migracao_parceiro_clientes (parceiro_cliente_id, cliente_id, resultado)
      select i, v_existente.id, case when v_existente.origem = 'portal_admin' then 'conflito_portal' else 'conflito_cliente' end
      from unnest(v_g.ids) i;
      for v_pc in select pc.id from public.legado_parceiro_clientes pc where pc.id = any (v_g.ids) loop
        if v_existente.origem = 'portal_admin' then
          v_n_conflito_portal := v_n_conflito_portal + 1;
          perform public._migracao_pendencia('cpf_conflito_portal', 'legado_parceiro_clientes', v_pc.id, v_existente.id,
            'O CPF deste registro do parceiro é o de um cliente do portal (relacionado): o registro não foi migrado e o '
            || 'cliente continua com o dono atual. Se o parceiro deve atendê-lo, transfira o cliente pela ficha.'
            || case when v_decisao_dono is not null then ' A decisão de dono registrada para este CPF não vale para cliente do portal.' else '' end);
        else
          v_n_conflito_cliente := v_n_conflito_cliente + 1;
          perform public._migracao_pendencia('cpf_conflito_cliente', 'legado_parceiro_clientes', v_pc.id, v_existente.id,
            'O CPF deste registro do parceiro já é de um cliente do CRM (relacionado): o registro não foi migrado e o '
            || 'cliente continua com o dono atual. Se o parceiro deve atendê-lo, transfira o cliente pela ficha.');
        end if;
      end loop;
      continue;
    end if;

    -- dono: a decisão registrada (um dos parceiros que têm o CPF) ou o registro mais antigo (A2, dono provisório)
    select array_agg(distinct pc.parceiro_id) into v_donos from public.legado_parceiro_clientes pc where pc.id = any (v_g.ids);
    v_dono := null;
    if v_decisao_dono ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and v_decisao_dono::uuid = any (v_donos) then
      v_dono := v_decisao_dono::uuid;
    end if;
    if v_dono is null then
      select pc.parceiro_id into v_dono from public.legado_parceiro_clientes pc where pc.id = v_g.ids[1];
    end if;
    select array_agg(pc.id order by pc.created_at, pc.id) into v_ids_dono
    from public.legado_parceiro_clientes pc where pc.id = any (v_g.ids) and pc.parceiro_id = v_dono;

    v_cliente := public._migracao_cliente(v_ids_dono, v_g.cpf, null);
    v_n_clientes := v_n_clientes + 1;
    if exists (select 1 from public.migracao_pendencias m
               where m.tipo = 'juntada_divergente' and m.tabela = 'clientes' and m.registro_id = v_cliente) then
      v_n_juntada_diverge := v_n_juntada_diverge + 1;
    end if;
    insert into public.migracao_parceiro_clientes (parceiro_cliente_id, cliente_id, resultado)
    select o.id, v_cliente, case when o.n = 1 then 'migrado' else 'juntado' end
    from unnest(v_ids_dono) with ordinality o(id, n);
    v_n_juntados := v_n_juntados + cardinality(v_ids_dono) - 1;

    -- os registros dos outros parceiros não migram
    for v_pc in select pc.id from public.legado_parceiro_clientes pc
                where pc.id = any (v_g.ids) and pc.parceiro_id <> v_dono order by pc.created_at, pc.id loop
      insert into public.migracao_parceiro_clientes (parceiro_cliente_id, cliente_id, resultado)
      values (v_pc.id, v_cliente, 'conflito_parceiros');
      v_n_conflito_parceiros := v_n_conflito_parceiros + 1;
      perform public._migracao_pendencia('cpf_conflito_parceiros', 'legado_parceiro_clientes', v_pc.id, v_cliente,
        'O mesmo CPF estava na carteira de outro parceiro: '
        || case when v_decisao_dono is not null and v_dono = v_decisao_dono::uuid
                then 'o dono foi definido pela decisão registrada antes do corte'
                else 'o cadastro mais antigo ficou como dono provisório (A2)' end
        || ' (cliente relacionado) e este registro não foi migrado. Se o cliente deve mudar de dono, transfira pela ficha.'
        || case when v_decisao_dono is not null and v_dono is distinct from v_decisao_dono::uuid
                then ' A decisão registrada para este CPF não aponta para um dos parceiros que o têm: valeu a regra do mais antigo.'
                else '' end);
    end loop;
    if v_decisao_dono is not null and cardinality(v_donos) = 1 and v_dono is distinct from v_decisao_dono::uuid then
      perform public._migracao_pendencia('decisao_invalida', 'clientes', v_cliente, null,
        'Havia decisão de dono registrada para este CPF, mas ela não aponta para o parceiro que o tinha na carteira: o '
        || 'cliente ficou com esse parceiro. Se o cliente deve mudar de dono, transfira pela ficha.');
    end if;
  end loop;

  -- (b) sem CPF ou com CPF inválido: cada registro vira um cliente sem CPF (permitido só nesta origem); o CPF inválido
  -- digitado vira nota e abre pendência
  for v_pc in
    select pc.id, nullif(btrim(coalesce(pc.cpf, '')), '') as cpf_txt
    from public.legado_parceiro_clientes pc
    where not exists (select 1 from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pc.id)
    order by pc.created_at, pc.id
  loop
    v_cliente := public._migracao_cliente(array[v_pc.id], null, v_pc.cpf_txt);
    v_n_clientes := v_n_clientes + 1;
    insert into public.migracao_parceiro_clientes (parceiro_cliente_id, cliente_id, resultado)
    values (v_pc.id, v_cliente, case when v_pc.cpf_txt is null then 'migrado_sem_cpf' else 'migrado_cpf_invalido' end);
    if v_pc.cpf_txt is null then
      v_n_sem_cpf := v_n_sem_cpf + 1;
    else
      v_n_cpf_invalido := v_n_cpf_invalido + 1;
      perform public._migracao_pendencia('cpf_invalido', 'clientes', v_cliente, v_pc.id,
        'O CPF deste cliente no sistema antigo tem dígito verificador inválido: ele foi migrado sem CPF e o valor '
        || 'digitado ficou numa nota. Confirme o documento e complete o cadastro pela ficha.');
    end if;
  end loop;

  -- ---- 2.4 propostas: cliente pelo mapa (a cadeia vem do cliente; sem cliente, do autor — gatilho propostas_cadeia) ----
  for v_r in
    select mp.proposta_id, m.cliente_id as destino, pr.parceiro_id as autor
    from public.migracao_propostas mp
    join public.propostas pr on pr.id = mp.proposta_id
    left join public.migracao_parceiro_clientes m on m.parceiro_cliente_id = mp.parceiro_cliente_id
                                                  and m.resultado in ('migrado', 'migrado_sem_cpf', 'migrado_cpf_invalido', 'juntado')
    where mp.resultado is null
    order by pr.created_at, pr.id
  loop
    select pr.papel into v_autor_papel from public.profiles pr where pr.id = v_r.autor;
    if v_r.destino is null then
      update public.migracao_propostas mp set resultado = 'cliente_nao_migrado', processado_em = now()
       where mp.proposta_id = v_r.proposta_id;
      v_n_prop_sem_cliente := v_n_prop_sem_cliente + 1;
    elsif v_autor_papel in ('admin', 'super') or exists (
            select 1 from public.clientes c join public.parceiros p on p.profile_id = v_r.autor and p.inativado_em is null
            where c.id = v_r.destino and (c.corretor_id = p.id or c.gerente_id = p.id
                                          or (p.tipo = 'imobiliaria' and c.imobiliaria_id = p.imobiliaria_id))) then
      update public.propostas pr set cliente_id = v_r.destino where pr.id = v_r.proposta_id;
      update public.migracao_propostas mp set cliente_id = v_r.destino, resultado = 'vinculada', processado_em = now()
       where mp.proposta_id = v_r.proposta_id;
      v_n_prop_vinculadas := v_n_prop_vinculadas + 1;
    else
      update public.migracao_propostas mp set resultado = 'fora_do_escopo', processado_em = now()
       where mp.proposta_id = v_r.proposta_id;
      v_n_prop_fora := v_n_prop_fora + 1;
      perform public._migracao_pendencia('proposta_cliente_outro_parceiro', 'propostas', v_r.proposta_id, v_r.destino,
        'No sistema antigo, esta proposta apontava para um cliente da carteira de outro parceiro: ela ficou sem cliente, '
        || 'com a cadeia do autor. O cliente migrado é o relacionado.');
    end if;
  end loop;

  -- ---- 2.5 contração: as decisões (com CPF) são esvaziadas; a auditoria guarda os totais e as pendências ----
  delete from public.migracao_decisoes;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo) order by m.id), '[]'::jsonb) into v_pendencias
  from public.migracao_pendencias m where m.resolvido_em is null;
  v_totais := jsonb_build_object(
    'decisoes_lidas', v_n_decisoes,
    'parceiros_migrados', v_n_parceiros, 'pendentes_bloqueados', v_n_pendente_bloqueado, 'papeis_trocados', v_n_papel,
    'clientes_portal', v_n_portal, 'clientes_portal_finalizados', v_n_portal_finalizado,
    'clientes_migrados', v_n_clientes, 'registros_juntados', v_n_juntados, 'migrados_sem_cpf', v_n_sem_cpf,
    'migrados_cpf_invalido', v_n_cpf_invalido, 'conflitos_portal', v_n_conflito_portal,
    'conflitos_cliente', v_n_conflito_cliente, 'conflitos_parceiros', v_n_conflito_parceiros,
    'propostas_vinculadas', v_n_prop_vinculadas, 'propostas_sem_cliente', v_n_prop_sem_cliente,
    'propostas_fora_do_escopo', v_n_prop_fora,
    'juntadas_divergentes', v_n_juntada_diverge);
  perform public._auditar('operacao', 'migracao', 'migracao', null, null, null, null, null,
    v_totais || jsonb_build_object('pendencias_abertas', v_pendencias), 'migracao');

  perform set_config('arken.motivo_vinculo', v_motivo_antes, true);
  perform set_config('arken.migracao', v_migracao_antes, true);
  return v_totais || jsonb_build_object('pendencias_abertas', jsonb_array_length(v_pendencias));
end $$;

revoke execute on function public._migracao_pendencia(text, text, uuid, uuid, text), public._migracao_nota(uuid, text, uuid, timestamptz),
  public._migracao_cliente(uuid[], text, text), public._migracao_corte()
  from public, anon, authenticated, service_role;

select public._migracao_corte() as migracao;

-- ============ 3. CLIENTES: cadeia obrigatória e fim do ramo 'portal_admin' ============
-- o gatilho clientes_cadeia garante o corretor em todo insert (nulo = Carteira Arken); gerente e imobiliária derivam dele
alter table public.clientes
  alter column corretor_id set not null,
  alter column gerente_id set not null,
  alter column imobiliaria_id set not null;
-- quem cria cliente agora são as RPCs, que mandam origem explícita e portal_liberado = false; o portal é liberado só
-- por crm_liberar_portal (internos). 'portal_admin' fica no enum para as linhas antigas.
alter table public.clientes alter column origem set default 'cadastro_interno';
drop trigger clientes_padroes on public.clientes;
drop function public._clientes_padroes();

-- ============ 4. REVOGAÇÕES (§4.3) ============
-- As políticas antigas ficam como defesa em profundidade. O portal (cliente_negocios, cliente_arquivos, obra, storage)
-- já usa meu_cliente_id() desde a 09; relatorio() é security definer; Edge Functions usam a service role.
revoke all on public.clientes, public.leads from authenticated;
revoke all on public.propostas from authenticated;

-- ============ 5. protege_campos_profile v4 (status e papel só por RPC) ============
-- A 17 já tirou o UPDATE de profiles de authenticated; esta versão é a defesa em profundidade para qualquer grant
-- futuro: pela API (anon/authenticated) papel, status, inativação, e-mail, CPF e identidade da linha nunca mudam.
-- Papel: equipe_definir_papel (Super) e RPCs da rede; status: rede_aprovar/recusar/bloquear/desbloquear/inativar/
-- reativar; dentro delas (postgres), na service role (cliente-login) e no SQL editor a regra não se aplica.
create or replace function public.protege_campos_profile() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.id := old.id;
    new.papel := old.papel;
    new.status_parceiro := old.status_parceiro;
    new.inativado_em := old.inativado_em;
    new.inativado_por := old.inativado_por;
    new.email := old.email;
    new.cpf := old.cpf;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke execute on function public.protege_campos_profile() from public, anon, authenticated;

-- ============ 6. ANONIMIZAÇÃO: exceção controlada das guardas (WP6R-01, §5.5) ============
-- lgpd_anonimizar_cliente (15) liga arken.anonimizacao = 'on' só em volta dos UPDATEs de limpeza e desliga logo
-- depois; nenhuma outra função liga essa variável, e anon/authenticated/service_role não têm UPDATE nessas tabelas.
-- create or replace preserva dono e ACL (as duas continuam sem grant).
-- 6.1 somente inclusão: com a variável ligada, aceita só (a) a coluna motivo (texto) trocada por "[removido — LGPD]" e
--     (b) em cliente_eventos, dados com a chave motivo (texto) trocada por "[removido — LGPD]" e todo o resto igual.
create or replace function public._somente_inclusao() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_preencher text[] := case when tg_nargs > 0 then string_to_array(replace(tg_argv[0], ' ', ''), ',') else '{}' end;
  v_lgpd constant boolean := coalesce(current_setting('arken.anonimizacao', true), '') = 'on';
  v_antigo jsonb;
  v_novo jsonb;
  v_col text;
begin
  if tg_op = 'UPDATE' then
    v_antigo := to_jsonb(old);
    v_novo := to_jsonb(new);
    for v_col in select jsonb_object_keys(v_novo) loop
      continue when (v_antigo -> v_col) is not distinct from (v_novo -> v_col);
      continue when v_col = any (v_preencher) and jsonb_typeof(v_antigo -> v_col) = 'null';
      continue when (v_col like '%\_por' or v_col = 'profile_id') and jsonb_typeof(v_novo -> v_col) = 'null';
      continue when v_lgpd and v_col = 'motivo' and jsonb_typeof(v_antigo -> v_col) = 'string'
                    and v_novo -> v_col = to_jsonb('[removido — LGPD]'::text);
      continue when v_lgpd and v_col = 'dados' and tg_table_name = 'cliente_eventos'
                    and jsonb_typeof(v_antigo -> 'dados' -> 'motivo') = 'string'
                    and v_novo -> 'dados' = (v_antigo -> 'dados') || jsonb_build_object('motivo', '[removido — LGPD]');
      raise exception 'Registro somente inclusão (%.%)', tg_table_name, v_col using errcode = '42501';
    end loop;
    return new;
  end if;
  raise exception 'Registro somente inclusão (%)', tg_table_name using errcode = '42501';
end $$;
revoke execute on function public._somente_inclusao() from public, anon, authenticated, service_role;

-- 6.2 contrato congelado (a partir de assinatura_pendente): com a variável ligada, observacao e motivo_inativacao
--     (texto) podem virar "[removido — LGPD]"; todo o resto continua congelado.
create or replace function public._contratos_imutavel() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_editavel constant boolean := old.status in ('rascunho', 'documentacao_pendente', 'em_analise');
  v_lgpd constant boolean := coalesce(current_setting('arken.anonimizacao', true), '') = 'on';
  v_obs text := new.observacao;
  v_mot text := new.motivo_inativacao;
begin
  if (new.cliente_id, new.tipo, new.modelo_id, new.forma_pagamento, new.unidade_id, new.imovel_id, new.parametros_id,
      new.valor_imovel, new.perc_aporte, new.valor_aporte, new.valor_entrada, new.base_parcelada, new.valor_restante,
      new.n_parcelas, new.taxa_aporte, new.valor_parcela, new.valor_total_parcelas, new.valor_minimo_flex)
     is distinct from
     (old.cliente_id, old.tipo, old.modelo_id, old.forma_pagamento, old.unidade_id, old.imovel_id, old.parametros_id,
      old.valor_imovel, old.perc_aporte, old.valor_aporte, old.valor_entrada, old.base_parcelada, old.valor_restante,
      old.n_parcelas, old.taxa_aporte, old.valor_parcela, old.valor_total_parcelas, old.valor_minimo_flex) then
    if old.status <> 'rascunho' then
      raise exception 'Valores, modelo, produto e cliente do contrato só mudam em rascunho' using errcode = '23514';
    end if;
    new.pdf_desatualizado := true;
  end if;

  if not v_editavel then
    if (new.imobiliaria_id, new.gerente_id, new.corretor_id) is distinct from (old.imobiliaria_id, old.gerente_id, old.corretor_id) then
      raise exception 'A cadeia do contrato fica congelada a partir do envio para assinatura' using errcode = '23514';
    end if;
    -- anonimização: a troca do texto livre por "[removido — LGPD]" conta como "sem mudança"
    if v_lgpd and old.observacao is not null and new.observacao = '[removido — LGPD]' then
      v_obs := old.observacao;
    end if;
    if v_lgpd and old.motivo_inativacao is not null and new.motivo_inativacao = '[removido — LGPD]' then
      v_mot := old.motivo_inativacao;
    end if;
    -- *_por podem virar nulo (FK "on delete set null" quando o usuário Auth é removido)
    if (new.texto_sha256, new.pdf_path, new.pdf_sha256, new.pdf_versao, new.pdf_gerado_em, new.pdf_desatualizado,
        new.d4sign_uuid, new.webhook_token_hash, new.enviado_assinatura_em, v_obs, new.criado_em,
        new.inativado_em, v_mot)
       is distinct from
       (old.texto_sha256, old.pdf_path, old.pdf_sha256, old.pdf_versao, old.pdf_gerado_em, old.pdf_desatualizado,
        old.d4sign_uuid, old.webhook_token_hash, old.enviado_assinatura_em, old.observacao, old.criado_em,
        old.inativado_em, old.motivo_inativacao)
       or (new.enviado_por is distinct from old.enviado_por and new.enviado_por is not null)
       or (new.inativado_por is distinct from old.inativado_por and new.inativado_por is not null) then
      raise exception 'O contrato fica congelado a partir do envio para assinatura' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public._contratos_imutavel() from public, anon, authenticated, service_role;

-- ============ 7. migracao_pendencias_resolver (§4.4, internos) ============
-- Registra a decisão tomada sobre uma pendência do corte e a fecha. A correção do dado em si é feita pelas telas de
-- sempre (ficha do cliente, transferência, Rede), que auditam cada ação; aqui fica o registro de QUE foi decidido.
-- p_decisao: texto livre (5 a 2.000 caracteres), guardado só em migracao_pendencias.decisao (leitura: internos); a
-- auditoria leva só o tipo, a tabela e os ids. Pendência inexistente e falta de acesso: o mesmo 42501.
create or replace function public.migracao_pendencias_resolver(p_id bigint, p_decisao text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.migracao_pendencias%rowtype;
  v_decisao constant text := btrim(coalesce(p_decisao, ''));
  v_cliente uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  select * into v_p from public.migracao_pendencias m where m.id = p_id for update;
  if not found then
    raise exception 'Sem acesso a este registro' using errcode = '42501';
  end if;
  if v_p.resolvido_em is not null then
    raise exception 'Esta pendência já foi resolvida.' using errcode = 'P0001';
  end if;
  if length(v_decisao) < 5 then
    raise exception 'MOTIVO_OBRIGATORIO' using errcode = 'P0001', detail = '{"minimo":5}';
  end if;
  if length(v_decisao) > 2000 then
    raise exception 'A decisão pode ter no máximo 2.000 caracteres.' using errcode = 'P0001';
  end if;
  update public.migracao_pendencias m
     set resolvido_em = now(), resolvido_por = auth.uid(), decisao = v_decisao
   where m.id = p_id;
  -- titular afetado (LGPD): o cliente do registro ou o relacionado
  select c.id into v_cliente from public.clientes c
   where c.id = case when v_p.tabela = 'clientes' then v_p.registro_id else v_p.relacionado_id end;
  perform public._auditar('operacao', 'resolver', 'migracao_pendencias', p_id::text, v_cliente,
    array['resolvido_em', 'resolvido_por', 'decisao'], jsonb_build_object('resolvido', false),
    jsonb_build_object('resolvido', true),
    jsonb_build_object('tipo', v_p.tipo, 'tabela', v_p.tabela, 'registro_id', v_p.registro_id,
                       'relacionado_id', v_p.relacionado_id));
end $$;
