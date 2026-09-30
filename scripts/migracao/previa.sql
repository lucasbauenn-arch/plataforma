-- Prévia do corte (docs/ARQUITETURA_EXPANSAO.md §2.4; migration 20260929000018_corte_contracao.sql) — SOMENTE LEITURA.
--
-- Para que serve: antes de aplicar o corte, listar para o negócio o que vai acontecer com os dados atuais e o que
-- precisa de decisão: conflitos de CPF (portal × parceiro e parceiro × parceiro), CPFs inválidos, parceiros sem CPF ou
-- CRECI, clientes do portal com e sem negócio (etapa prevista) e o destino de cada proposta. As decisões entram em
-- public.migracao_decisoes ANTES do corte (o corte lê e depois esvazia a tabela):
--   ('dono_cpf', '<CPF, 11 dígitos>', '<id do perfil do parceiro que fica com o cliente>')
--       vale só para conflito parceiro × parceiro e só entre os parceiros que têm aquele CPF; sem decisão, fica o
--       registro mais antigo (A2). Cliente do portal NUNCA troca de dono no corte (a transferência é feita depois,
--       pela ficha, com motivo e auditoria).
--   ('etapa_cliente_portal', '<id do cliente ou CPF>', '<novo_contato|contato_iniciado|documentacao|finalizado|perdido>')
--       sem decisão: finalizado se houver negócio registrado; senão, novo contato.
--
-- Seções: 1 resumo · 2 conflito com cliente existente · 3 conflito entre parceiros · 4 CPF inválido/em uso · 5 parceiro sem
-- CPF/CRECI · 6 clientes do portal · 7 dono sem vínculo · 8 propostas · 9 decisões sem efeito · 10 cadastros juntados com nome
-- ou RG diferentes (podem ser pessoas diferentes com o CPF digitado errado; o corte junta e abre a pendência juntada_divergente).
--
-- Como rodar: no estado ATUAL do banco (migrations até a 20260929000009 aplicadas, antes da 18), como postgres:
--   psql "<url do banco>" -X -f scripts/migracao/previa.sql      (ou colar no SQL editor do Supabase)
-- É uma única consulta (SELECT), então o editor mostra o relatório inteiro. Depois do corte ela deixa de funcionar
-- (parceiro_clientes vira legado_parceiro_clientes), o que é esperado.
--
-- ATENÇÃO — DADO PESSOAL: a saída tem nomes, e-mails e, na seção de conflito entre parceiros, o CPF completo (é a
-- chave da decisão). Rode só pelo operador responsável e não salve a saída no repositório, em tickets nem em e-mail;
-- nas demais seções o CPF sai mascarado.
--
-- Colunas: secao (ordem do relatório), item (o registro, por id), detalhe (o que acontece / o que decidir).
-- A lógica espelha public._migracao_corte() (migration 18); scripts/migracao/previa.sql e a migration são revisados juntos.

with
cfg as (
  select c.exclusividade_dias, c.corretor_casa_id from public.configuracao_geral c
),
-- ---------- parceiros legados que ganham vínculo de corretor na cadeia da casa ----------
legados as (
  select pr.id, coalesce(nullif(btrim(pr.nome), ''), '(sem nome)') as nome, lower(coalesce(u.email, pr.email, '')) as email,
         pr.status_parceiro, pr.created_at,
         nullif(regexp_replace(coalesce(pr.cpf, ''), '\D', '', 'g'), '') as cpf,
         nullif(btrim(coalesce(pr.creci, '')), '') as creci,
         exists (select 1 from public.parceiro_clientes pc where pc.parceiro_id = pr.id) as tem_carteira
  from public.profiles pr left join auth.users u on u.id = pr.id
  where pr.papel = 'parceiro'
    and not exists (select 1 from public.parceiros p where p.profile_id = pr.id)
    and (pr.status_parceiro in ('aprovado', 'bloqueado')
         or exists (select 1 from public.parceiro_clientes pc where pc.parceiro_id = pr.id))
),
-- cpf_em_uso espelha o laço do corte (parceiros legados na ordem created_at, id): o CPF já é de um parceiro que existe OU de um
-- legado mais antigo que o receberia antes (o corte cria o vínculo do 2º sem CPF e abre cpf_parceiro_invalido)
legados2 as (
  select l.*,
         (l.cpf ~ '^\d{11}$' and public.cpf_valido(l.cpf)) as cpf_dv_ok,
         (exists (select 1 from public.parceiros p where p.cpf = l.cpf)
          or (l.cpf ~ '^\d{11}$' and public.cpf_valido(l.cpf)
              and row_number() over (partition by l.cpf order by l.created_at, l.id) > 1)) as cpf_em_uso
  from legados l
),
-- dono com vínculo depois do corte: legado migrado, ou vínculo ativo de corretor (ou gerente com A1) que já existe
com_vinculo as (
  select l.id as profile_id from legados l
  union
  select p.profile_id from public.parceiros p
  where p.profile_id is not null and p.inativado_em is null
    and (p.tipo = 'corretor' or (p.tipo = 'gerente' and coalesce((select r.permitido from public.permissoes_rede r
                                   where r.acao = 'gerente_como_corretor' and r.tipo = 'gerente'), false)))
),
-- ---------- carteira antiga (parceiro_clientes) ----------
pc as (
  select pc.id, pc.parceiro_id, pc.nome, pc.created_at, pc.anotacoes, pc.rg,
         nullif(btrim(coalesce(pc.cpf, '')), '') as cpf_txt,
         regexp_replace(coalesce(pc.cpf, ''), '\D', '', 'g') as cpf_dig,
         coalesce(nullif(btrim(pr.nome), ''), pr.email, '(perfil)') as parceiro_nome, pr.papel as parceiro_papel
  from public.parceiro_clientes pc left join public.profiles pr on pr.id = pc.parceiro_id
),
pc2 as (
  select p.*, coalesce(p.cpf_dig ~ '^\d{11}$' and public.cpf_valido(p.cpf_dig), false) as cpf_ok,
         case when p.cpf_dig ~ '^\d{11}$' then left(p.cpf_dig, 3) || '.***.***-' || right(p.cpf_dig, 2)
              when p.cpf_txt is not null then '*** (' || length(p.cpf_txt) || ' caracteres)' end as cpf_mascara
  from pc p
),
grupos as (
  select p.cpf_dig, array_agg(p.id order by p.created_at, p.id) as ids,
         array_agg(distinct p.parceiro_id) as donos, count(*) as n
  from pc2 p where p.cpf_ok group by p.cpf_dig
),
existente as (
  select g.cpf_dig, c.id as cliente_id, c.origem, c.nome as cliente_nome
  from grupos g
  join lateral (select c.id, c.origem, c.nome from public.clientes c
                where c.cpf = g.cpf_dig or (c.cpf !~ '^\d{11}$' and regexp_replace(c.cpf, '\D', '', 'g') = g.cpf_dig)
                order by (c.cpf = g.cpf_dig) desc, c.created_at limit 1) c on true
),
dono as (
  select g.cpf_dig, d.valor as decisao,
         coalesce(case when d.valor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            and d.valor::uuid = any (g.donos) then d.valor::uuid end,
                  (select p.parceiro_id from pc2 p where p.id = g.ids[1])) as dono,
         (d.valor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and d.valor::uuid = any (g.donos)) as decisao_ok
  from grupos g left join public.migracao_decisoes d on d.tipo = 'dono_cpf' and d.chave = g.cpf_dig
),
-- resultado previsto de cada linha (o mesmo de migracao_parceiro_clientes.resultado depois do corte)
classe as (
  select p.id, p.parceiro_id, p.parceiro_nome, p.parceiro_papel, p.nome, p.rg, p.created_at, p.cpf_ok, p.cpf_txt, p.cpf_dig,
         p.cpf_mascara, e.cliente_id as existente_id, e.origem as existente_origem, e.cliente_nome as existente_nome,
         d.dono, d.decisao, d.decisao_ok,
         case
           when not p.cpf_ok and p.cpf_txt is null then 'migrado_sem_cpf'
           when not p.cpf_ok then 'migrado_cpf_invalido'
           when e.cliente_id is not null and e.origem = 'portal_admin' then 'conflito_portal'
           when e.cliente_id is not null then 'conflito_cliente'
           when p.parceiro_id <> d.dono then 'conflito_parceiros'
           when p.id = (select q.id from pc2 q where q.cpf_ok and q.cpf_dig = p.cpf_dig and q.parceiro_id = d.dono
                        order by q.created_at, q.id limit 1) then 'migrado'
           else 'juntado'
         end as resultado,
         -- dono do cliente criado (ou em que a linha foi juntada)
         case when p.cpf_ok then d.dono else p.parceiro_id end as dono_alvo
  from pc2 p
  left join existente e on p.cpf_ok and e.cpf_dig = p.cpf_dig
  left join dono d on p.cpf_ok and d.cpf_dig = p.cpf_dig
),
-- ---------- juntadas com nome ou RG diferentes (MIG-02): a mesma regra de _migracao_cliente ----------
-- o RG que fica na coluna é o do primeiro registro (mais antigo) com RG de até 30 caracteres; o RG de um registro juntado que
-- difere dele (ignorando pontuação e caixa) e o nome diferente do registro-base fazem o corte abrir juntada_divergente
rg_do_grupo as (
  select b.cpf_dig, b.dono_alvo,
         (select nullif(btrim(q.rg), '') from classe q
           where q.cpf_dig = b.cpf_dig and q.dono_alvo = b.dono_alvo and q.resultado in ('migrado', 'juntado')
             and nullif(btrim(q.rg), '') is not null and length(btrim(q.rg)) <= 30
           order by q.created_at, q.id limit 1) as rg
  from classe b where b.resultado = 'migrado' and b.cpf_ok
),
juntadas as (
  select j.id, j.cpf_mascara, j.nome as nome_juntado, b.nome as nome_base, b.id as base_id,
         (btrim(j.nome) <> '' and lower(btrim(j.nome)) is distinct from lower(btrim(b.nome))) as nome_diverge,
         (length(btrim(coalesce(j.rg, ''))) between 1 and 30
          and regexp_replace(lower(btrim(j.rg)), '[^0-9a-z]', '', 'g')
              is distinct from regexp_replace(lower(coalesce(g.rg, '')), '[^0-9a-z]', '', 'g')) as rg_diverge
  from classe j
  join classe b on b.resultado = 'migrado' and b.cpf_ok and b.cpf_dig = j.cpf_dig and b.dono_alvo = j.dono_alvo
  join rg_do_grupo g on g.cpf_dig = b.cpf_dig and g.dono_alvo = b.dono_alvo
  where j.resultado = 'juntado'
),
-- ---------- clientes do portal ----------
portal as (
  select c.id, c.nome, c.cpf, c.created_at,
         exists (select 1 from public.cliente_negocios n where n.cliente_id = c.id) as tem_negocio,
         (select d.valor from public.migracao_decisoes d
           where d.tipo = 'etapa_cliente_portal' and d.chave in (c.id::text, coalesce(c.cpf, ''))
           order by (d.chave = c.id::text) desc limit 1) as decisao
  from public.clientes c
  where c.origem = 'portal_admin' and c.anonimizado_em is null
    and not exists (select 1 from public.historico_status h where h.entidade = 'cliente_etapa' and h.entidade_id = c.id)
),
portal2 as (
  select p.*, coalesce(p.decisao in (select unnest(enum_range(null::public.etapa_funil))::text), false) as decisao_ok,
         coalesce(p.cpf ~ '^\d{11}$' and public.cpf_valido(p.cpf), false) as cpf_ok
  from portal p
),
-- ---------- propostas com vínculo a parceiro_clientes ----------
props as (
  select pr.id, pr.parceiro_id as autor, pr.parceiro_cliente_id, pr.status, pr.created_at, k.resultado, k.dono_alvo,
         coalesce(pa.papel in ('admin', 'super'), false) as autor_interno
  from public.propostas pr
  join classe k on k.id = pr.parceiro_cliente_id
  left join public.profiles pa on pa.id = pr.parceiro_id
),
props2 as (
  select p.*,
         case when p.resultado not in ('migrado', 'migrado_sem_cpf', 'migrado_cpf_invalido', 'juntado') then 'cliente_nao_migrado'
              when p.autor_interno then 'vinculada'
              when p.autor = p.dono_alvo and exists (select 1 from com_vinculo v where v.profile_id = p.dono_alvo) then 'vinculada'
              else 'fora_do_escopo' end as destino
  from props p
),
relatorio as (
  -- 1. RESUMO
  select 1 as ordem, '1. Resumo' as secao, 'perfis' as item,
         (select string_agg(x.papel || '/' || x.status || ': ' || x.n, ', ' order by x.papel, x.status)
          from (select pr.papel::text as papel, pr.status_parceiro::text as status, count(*) as n
                from public.profiles pr group by 1, 2) x) as detalhe
  union all select 1, '1. Resumo', 'parceiros legados que viram corretor migrado',
         (select count(*) || ' (aprovados ' || count(*) filter (where status_parceiro = 'aprovado')
                 || ', bloqueados ' || count(*) filter (where status_parceiro = 'bloqueado')
                 || ', pendentes com carteira → bloqueados ' || count(*) filter (where status_parceiro = 'pendente') || ')'
          from legados)
  union all select 1, '1. Resumo', 'autocadastros pendentes sem carteira (não mudam)',
         (select count(*)::text from public.profiles pr where pr.papel = 'parceiro' and pr.status_parceiro = 'pendente'
            and not exists (select 1 from public.parceiro_clientes pc where pc.parceiro_id = pr.id)
            and not exists (select 1 from public.parceiros p where p.profile_id = pr.id))
  union all select 1, '1. Resumo', 'clientes do portal (a migrar)',
         (select count(*) || ' (com negócio → finalizado: ' || count(*) filter (where tem_negocio)
                 || '; sem negócio → novo contato: ' || count(*) filter (where not tem_negocio) || ')' from portal)
  union all select 1, '1. Resumo', 'linhas de parceiro_clientes',
         (select count(*) || ' → clientes novos: ' || count(*) filter (where resultado in ('migrado', 'migrado_sem_cpf', 'migrado_cpf_invalido'))
                 || '; juntados: ' || count(*) filter (where resultado = 'juntado')
                 || '; sem CPF: ' || count(*) filter (where resultado = 'migrado_sem_cpf')
                 || '; CPF inválido: ' || count(*) filter (where resultado = 'migrado_cpf_invalido')
                 || '; conflito com portal: ' || count(*) filter (where resultado = 'conflito_portal')
                 || '; conflito com cliente do CRM: ' || count(*) filter (where resultado = 'conflito_cliente')
                 || '; conflito entre parceiros: ' || count(*) filter (where resultado = 'conflito_parceiros')
          from classe)
  union all select 1, '1. Resumo', 'juntadas com nome ou RG diferentes (pendência juntada_divergente)',
         (select count(*)::text from juntadas j where j.nome_diverge or j.rg_diverge)
  union all select 1, '1. Resumo', 'propostas com cliente do parceiro',
         (select count(*) || ' → vinculadas: ' || count(*) filter (where destino = 'vinculada')
                 || '; ficam sem cliente (registro não migra): ' || count(*) filter (where destino = 'cliente_nao_migrado')
                 || '; fora do escopo do autor: ' || count(*) filter (where destino = 'fora_do_escopo') from props2)
  union all select 1, '1. Resumo', 'propostas sem cliente (ficam com a cadeia do autor)',
         (select count(*)::text from public.propostas pr where pr.parceiro_cliente_id is null)
  union all select 1, '1. Resumo', 'decisões registradas em migracao_decisoes',
         (select count(*) || ' (dono_cpf ' || count(*) filter (where tipo = 'dono_cpf') || ', etapa_cliente_portal '
                 || count(*) filter (where tipo = 'etapa_cliente_portal') || ')' from public.migracao_decisoes)
  union all select 1, '1. Resumo', 'leads (continuam em leads, status novo)', (select count(*)::text from public.leads)

  -- 2. CONFLITO COM CLIENTE EXISTENTE (portal ou CRM) × PARCEIRO: não migra; o cliente existente fica com o dono
  union all
  select 2, '2. Conflito de CPF: cliente existente (portal ou CRM) × parceiro', 'parceiro_clientes ' || k.id,
         'CPF ' || k.cpf_mascara || ' | registro do parceiro "' || k.parceiro_nome || '" (cliente "' || k.nome || '", '
         || to_char(k.created_at, 'DD/MM/YYYY') || ') | já é o cliente ' || k.existente_id || ' ("' || k.existente_nome || '", '
         || case when k.existente_origem = 'portal_admin' then 'portal' else 'CRM' end
         || '). Não migra; o cliente continua com o dono atual. Se o parceiro deve atendê-lo, transferir depois pela ficha.'
         || case when k.decisao is not null then ' (a decisão dono_cpf registrada não vale para este caso)' else '' end
  from classe k where k.resultado in ('conflito_portal', 'conflito_cliente')

  -- 3. CONFLITO PARCEIRO × PARCEIRO: o mais antigo fica (A2), salvo decisão dono_cpf
  union all
  select 3, '3. Conflito de CPF: parceiro × parceiro', 'CPF ' || g.cpf_dig,
         (select string_agg('"' || p.parceiro_nome || '" (perfil ' || p.parceiro_id || ', registro de '
                            || to_char(p.created_at, 'DD/MM/YYYY') || ')', '; ' order by p.created_at, p.id)
          from pc2 p where p.cpf_ok and p.cpf_dig = g.cpf_dig)
         || ' → fica com: ' || coalesce((select distinct p.parceiro_nome from pc2 p where p.parceiro_id = d.dono limit 1), '?')
         || case when d.decisao_ok then ' (decisão registrada)'
                 when d.decisao is not null then ' (mais antigo; a decisão registrada é INVÁLIDA: não aponta para um destes perfis)'
                 else ' (mais antigo, A2 — para mudar: dono_cpf com o id do perfil)' end
  from grupos g join dono d on d.cpf_dig = g.cpf_dig
  where cardinality(g.donos) > 1 and not exists (select 1 from existente e where e.cpf_dig = g.cpf_dig)

  -- 4. CPFs INVÁLIDOS
  union all
  select 4, '4. CPF inválido', 'parceiro_clientes ' || k.id,
         'CPF ' || k.cpf_mascara || ' (DV inválido) | cliente "' || k.nome || '" do parceiro "' || k.parceiro_nome
         || '". Migra SEM CPF; o valor digitado vira nota e abre pendência cpf_invalido.'
  from classe k where k.resultado = 'migrado_cpf_invalido'
  union all
  select 4, '4. CPF inválido', 'clientes ' || p.id,
         'Cliente do portal "' || p.nome || '" com CPF ' || coalesce(left(p.cpf, 3) || '***' || right(p.cpf, 2), '(vazio)')
         || ' inválido: o login do portal não o encontra. O CPF não é apagado; abre pendência para a equipe corrigir.'
  from portal2 p where p.cpf is not null and not p.cpf_ok
  union all
  select 4, '4. CPF inválido', 'profiles ' || l.id,
         'Parceiro "' || l.nome || '" (' || l.email || ') com CPF ' || left(l.cpf, 3) || '***' || right(l.cpf, 2)
         || case when not coalesce(l.cpf_dv_ok, false) then ' inválido' else ' já usado por outro parceiro (existente ou legado mais antigo)' end
         || ': o vínculo nasce sem CPF (pendência cpf_parceiro_invalido); o parceiro completa em "Meu cadastro".'
  from legados2 l where l.cpf is not null and (not coalesce(l.cpf_dv_ok, false) or l.cpf_em_uso)

  -- 5. PARCEIROS SEM CPF OU CRECI (PAR-4 só é exigida em cadastros novos; "Meu cadastro" pede para completar)
  union all
  select 5, '5. Parceiro sem CPF ou CRECI', 'profiles ' || l.id,
         '"' || l.nome || '" (' || l.email || ', ' || l.status_parceiro || ')'
         || case when l.cpf is null then ' sem CPF' else '' end || case when l.creci is null then ' sem CRECI' else '' end
         || case when l.status_parceiro = 'pendente' then ' | pendente COM carteira: entra BLOQUEADO (pendência parceiro_pendente_com_clientes); para aprovar, completar CPF e CRECI e desbloquear' else '' end
         || case when l.status_parceiro = 'bloqueado' and (l.cpf is null or l.creci is null) then ' | bloqueado: desbloquear (primeira aprovação) exige CPF e CRECI' else '' end
  from legados2 l where l.cpf is null or l.creci is null or l.status_parceiro = 'pendente'

  -- 6. CLIENTES DO PORTAL: etapa prevista (nunca trocam de dono)
  union all
  select 6, '6. Cliente do portal', 'clientes ' || p.id,
         '"' || p.nome || '" | ' || case when p.tem_negocio then 'com negócio' else 'sem negócio' end || ' → etapa '
         || case when p.decisao_ok then p.decisao || ' (decisão registrada)'
                 when p.tem_negocio then 'finalizado' else 'novo_contato' end
         || case when p.decisao is not null and not p.decisao_ok then ' (a decisão registrada "' || p.decisao || '" é INVÁLIDA)' else '' end
         || ' | continua na Carteira Arken, portal liberado'
  from portal2 p

  -- 7. DONO SEM VÍNCULO: o registro vai para a Carteira Arken
  union all
  select 7, '7. Dono sem vínculo de corretor', 'parceiro_clientes ' || k.id,
         'Registro de "' || k.parceiro_nome || '" (papel ' || coalesce(k.parceiro_papel::text, '?')
         || '), sem vínculo de corretor: o cliente vai para a Carteira Arken (pendência dono_sem_vinculo).'
  from classe k
  where k.resultado in ('migrado', 'migrado_sem_cpf', 'migrado_cpf_invalido')
    and not exists (select 1 from com_vinculo v where v.profile_id = k.dono_alvo)

  -- 8. PROPOSTAS: destino de cada uma
  union all
  select 8, '8. Proposta', 'propostas ' || p.id,
         to_char(p.created_at, 'DD/MM/YYYY') || ' (' || p.status || ') → '
         || case p.destino when 'vinculada' then 'recebe o cliente migrado (cadeia do cliente)'
                           when 'cliente_nao_migrado' then 'fica sem cliente: o registro antigo não migra (' || p.resultado || ')'
                           else 'fica sem cliente: o cliente migrado é de outro parceiro (pendência)' end
  from props2 p

  -- 9. DECISÕES SEM EFEITO (chave que não corresponde a nada)
  union all
  select 9, '9. Decisão sem efeito', d.tipo || ' ' || case when d.tipo = 'dono_cpf' then left(d.chave, 3) || '***' || right(d.chave, 2) else d.chave end,
         'Não corresponde a nenhum ' || case when d.tipo = 'dono_cpf' then 'conflito de CPF entre parceiros' else 'cliente do portal' end
         || ' a migrar: será ignorada.'
  from public.migracao_decisoes d
  where (d.tipo = 'dono_cpf' and not exists (select 1 from grupos g where g.cpf_dig = d.chave and cardinality(g.donos) > 1))
     or (d.tipo = 'etapa_cliente_portal' and not exists (select 1 from portal p where d.chave in (p.id::text, coalesce(p.cpf, ''))))

  -- 10. JUNTADAS COM NOME OU RG DIFERENTES (MIG-02): pode ser outra pessoa com o CPF digitado errado
  union all
  select 10, '10. Juntada com nome ou RG diferentes', 'parceiro_clientes ' || j.id,
         'CPF ' || j.cpf_mascara || ' | o registro "' || j.nome_juntado || '" será JUNTADO ao cliente "' || j.nome_base
         || '" (parceiro_clientes ' || j.base_id || ') pelo mesmo CPF e mesmo parceiro, mas '
         || case when j.nome_diverge and j.rg_diverge then 'o nome e o RG são diferentes'
                 when j.nome_diverge then 'o nome é diferente' else 'o RG é diferente' end
         || '. O corte junta (regra da §2.4), guarda nome e RG nas notas do cliente e abre a pendência juntada_divergente; '
         || 'se forem pessoas diferentes, cadastrar a outra pela ficha depois do corte e ajustar as propostas.'
  from juntadas j where j.nome_diverge or j.rg_diverge
)
select r.secao, r.item, r.detalhe from relatorio r order by r.ordem, r.item;
