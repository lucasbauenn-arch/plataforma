-- Corte e contração: migração de dados da §2.4 (docs/ARQUITETURA_EXPANSAO.md §2.4, §3.9, §4.3, §4.4, §8.5; WP7).
-- A 20260929000018 roda _migracao_corte() uma vez, sobre os dados reais. Aqui, dentro da transação do teste, dados
-- legados de exemplo são gravados como postgres (como estariam no banco antes do corte) e a MESMA função roda de novo
-- (é idempotente: só processa o que ainda não migrou). Confere: contagens, o cliente do portal nunca troca de dono,
-- conflitos viram pendência sem dado pessoal, migracao_decisoes prevalece e é esvaziada, mapa das propostas, CPF
-- inválido vira nota, auditoria 'migracao', e o corpo de migracao_pendencias_resolver.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(68);

-- ============ AJUDANTES DESTE TESTE ============
create function pg_temp.leg(p text) returns uuid language sql immutable as $$
  select (case p
    when 'leg1' then 'a7000000-0000-4000-8000-000000000001' when 'leg2' then 'a7000000-0000-4000-8000-000000000002'
    when 'leg3' then 'a7000000-0000-4000-8000-000000000003' when 'leg4' then 'a7000000-0000-4000-8000-000000000004'
    -- clientes do portal
    when 'p1' then 'd7000000-0000-4000-8000-000000000001' when 'p2' then 'd7000000-0000-4000-8000-000000000002'
    when 'p3' then 'd7000000-0000-4000-8000-000000000003' when 'p4' then 'd7000000-0000-4000-8000-000000000004'
    when 'p5' then 'd7000000-0000-4000-8000-000000000005'
    -- linhas legadas (parceiro_clientes)
    when 'a1' then 'f7000000-0000-4000-8000-0000000000a1' when 'a2' then 'f7000000-0000-4000-8000-0000000000a2'
    when 'b1' then 'f7000000-0000-4000-8000-0000000000b1'
    when 'c1' then 'f7000000-0000-4000-8000-0000000000c1' when 'c2' then 'f7000000-0000-4000-8000-0000000000c2'
    when 'd1' then 'f7000000-0000-4000-8000-0000000000d1' when 'd2' then 'f7000000-0000-4000-8000-0000000000d2'
    when 'e1' then 'f7000000-0000-4000-8000-0000000000e1' when 'f1' then 'f7000000-0000-4000-8000-0000000000f1'
    when 'h1' then 'f7000000-0000-4000-8000-0000000000a8' when 'i1' then 'f7000000-0000-4000-8000-0000000000a9'
    when 'j1' then 'f7000000-0000-4000-8000-0000000000aa' when 'j2' then 'f7000000-0000-4000-8000-0000000000ab'
    when 'j3' then 'f7000000-0000-4000-8000-0000000000ac'
    -- propostas
    when 'pr1' then 'e7000000-0000-4000-8000-000000000001' when 'pr2' then 'e7000000-0000-4000-8000-000000000002'
    when 'pr3' then 'e7000000-0000-4000-8000-000000000003' when 'pr4' then 'e7000000-0000-4000-8000-000000000004'
    when 'pr5' then 'e7000000-0000-4000-8000-000000000005'
  end)::uuid
$$;
-- o cliente do CRM criado a partir de uma linha legada (pelo mapa)
create function pg_temp.migrado(p text) returns uuid language sql stable as $$
  select m.cliente_id from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pg_temp.leg(p)
$$;
create function pg_temp.vinculo(p text) returns uuid language sql stable as $$
  select p2.id from public.parceiros p2 where p2.profile_id = pg_temp.leg(p)
$$;

-- ============ DADOS LEGADOS (como postgres, como estavam antes do corte) ============
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
select pg_temp.leg(x.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email,
       jsonb_build_object('nome', x.n), now(), now(), now()
from (values ('leg1', 'Leg1@Legado.test'), ('leg2', 'leg2@legado.test'), ('leg3', 'leg3@legado.test'),
             ('leg4', 'leg4@legado.test')) as x(n, email);
-- leg1: aprovado, nome vazio (o vínculo usa o e-mail), CPF válido e livre, CRECI, telefone com máscara
update public.profiles set nome = '', status_parceiro = 'aprovado', cpf = '12345671483', creci = ' CRECI-L1 ',
       telefone = '(11) 98888-7777', imobiliaria = 'Imobiliária Antiga Ltda', email = 'outro@adulterado.test'
 where id = pg_temp.leg('leg1');
-- leg2: bloqueado, CPF de DV inválido; leg3: pendente COM carteira; leg4: aprovado com o CPF de outro parceiro (CA1a)
update public.profiles set nome = 'Legado Dois', status_parceiro = 'bloqueado', cpf = '11111111111' where id = pg_temp.leg('leg2');
update public.profiles set nome = 'Legado Três', status_parceiro = 'pendente' where id = pg_temp.leg('leg3');
update public.profiles set nome = 'Legado Quatro', status_parceiro = 'aprovado', cpf = '12345670320' where id = pg_temp.leg('leg4');

-- clientes do portal (tela antiga do admin: origem portal_admin, portal liberado, Carteira Arken)
alter table public.clientes disable trigger clientes_cpf_valido;
insert into public.clientes (id, nome, cpf, origem, portal_liberado, created_at) values
  (pg_temp.leg('p1'), 'Portal Um',    '52998224725', 'portal_admin', true, '2025-06-01'),
  (pg_temp.leg('p2'), 'Portal Dois',  '11144477735', 'portal_admin', true, '2025-07-01'),
  (pg_temp.leg('p3'), 'Portal Três',  '12345678900', 'portal_admin', true, '2025-08-01'),   -- CPF de DV inválido
  (pg_temp.leg('p4'), 'Portal Quatro','12345678909', 'portal_admin', true, '2025-09-01'),
  (pg_temp.leg('p5'), 'Portal Cinco', '98765432100', 'portal_admin', true, '2025-10-01');
alter table public.clientes enable trigger clientes_cpf_valido;
insert into public.cliente_negocios (cliente_id, empreendimento_id, created_at)
select pg_temp.leg('p1'), e.id, '2025-06-15' from public.empreendimentos e order by e.slug limit 1;

-- carteira antiga dos parceiros
insert into public.legado_parceiro_clientes (id, parceiro_id, nome, rg, cpf, telefone, anotacoes, interesses, created_at) values
  (pg_temp.leg('a1'), pg_temp.leg('leg1'), 'Fulano A',   '11.222.333-4', '390.533.447-05', '(11) 91111-1111', 'Nota A1', '{Apartamento}',    '2026-01-01'),
  (pg_temp.leg('a2'), pg_temp.leg('leg1'), 'Fulano B',   null,           '39053344705',    '11922222222',     'Nota A2', '{Casa,Apartamento}', '2026-01-10'),
  (pg_temp.leg('b1'), pg_temp.leg('leg1'), 'Do portal',  null,           '529.982.247-25', '11933333333',     'quer outro apto', '{}',       '2026-01-02'),
  (pg_temp.leg('c1'), pg_temp.leg('leg1'), 'Cê Um',      null,           '87748248800',    '11944444444',     null,      '{}',               '2026-02-01'),
  (pg_temp.leg('c2'), pg_temp.leg('leg3'), 'Cê Dois',    null,           '87748248800',    '11955555555',     'da carteira do leg3', '{}',   '2026-03-01'),
  (pg_temp.leg('d1'), pg_temp.leg('leg1'), 'Dê Um',      null,           '71428793860',    '11966666666',     null,      '{}',               '2026-02-15'),
  (pg_temp.leg('d2'), pg_temp.leg('leg4'), 'Dê Dois',    null,           '71428793860',    '11977777777',     null,      '{}',               '2026-01-15'),
  (pg_temp.leg('e1'), pg_temp.leg('leg3'), 'Sem CPF',    null,           null,             '11988888888',     'sem documento', '{Terreno}',  '2026-04-01'),
  (pg_temp.leg('f1'), pg_temp.leg('leg3'), 'CPF Errado', null,           '123.456.789-00', '11999999999',     null,      '{}',               '2026-04-02'),
  (pg_temp.leg('h1'), pg_temp.usuario('admin'), 'Do admin', null,        '12345671564',    '11900001111',     null,      '{}',               '2026-04-03'),
  (pg_temp.leg('i1'), pg_temp.leg('leg4'), 'Já no CRM',  null,           '12345671050',    '11900002222',     null,      '{}',               '2026-04-04'),
  -- MIG-02: mesmo CPF e mesmo parceiro, mesmo nome, mas RG diferente (j2): pode ser outra pessoa com o CPF digitado
  -- errado; j3 tem o mesmo RG de j1 escrito de outro jeito (não diverge)
  (pg_temp.leg('j1'), pg_temp.leg('leg1'), 'Joana',      '12.345.678-9', '12345671645',    '11900003333',     null,      '{}',               '2026-04-05'),
  (pg_temp.leg('j2'), pg_temp.leg('leg1'), 'Joana',      '98.765.432-1', '123.456.716-45', '11900004444',     null,      '{}',               '2026-04-06'),
  (pg_temp.leg('j3'), pg_temp.leg('leg1'), 'JOANA ',     '12345678-9',   '12345671645',    '11900003333',     null,      '{}',               '2026-04-07');

-- propostas antigas (a cadeia vem do gatilho; o vínculo antigo com parceiro_clientes fica no mapa migracao_propostas)
insert into public.propostas (id, parceiro_id, empreendimento_id, texto, created_at)
select pg_temp.leg(x.id), x.autor, (select e.id from public.empreendimentos e order by e.slug limit 1), 'proposta antiga', x.quando
from (values ('pr1', pg_temp.leg('leg1'), timestamptz '2026-05-01'), ('pr2', pg_temp.leg('leg3'), '2026-05-02'),
             ('pr3', pg_temp.leg('leg3'), '2026-05-03'), ('pr4', pg_temp.leg('leg1'), '2026-05-04'),
             ('pr5', pg_temp.usuario('admin'), '2026-05-05')) as x(id, autor, quando);
insert into public.migracao_propostas (proposta_id, parceiro_cliente_id) values
  (pg_temp.leg('pr1'), pg_temp.leg('a2')),   -- juntada: vai para o cliente de A
  (pg_temp.leg('pr2'), pg_temp.leg('c2')),   -- não migrou (conflito entre parceiros)
  (pg_temp.leg('pr3'), pg_temp.leg('a1')),   -- cliente de outro parceiro (leg1): fora do escopo do autor (leg3)
  (pg_temp.leg('pr5'), pg_temp.leg('e1'));   -- autor interno: recebe o cliente

-- decisões do negócio (runbook, antes do corte)
insert into public.migracao_decisoes (tipo, chave, valor, decidido_por) values
  ('dono_cpf', '71428793860', 'a7000000-0000-4000-8000-000000000001', 'reunião 01'),   -- D: leg1, mesmo sendo o mais novo
  ('etapa_cliente_portal', 'd7000000-0000-4000-8000-000000000004', 'contato_iniciado', 'reunião 01'),   -- P4 pelo id
  ('etapa_cliente_portal', '98765432100', 'xyz', 'reunião 01');                                        -- P5 pelo CPF, inválida

create temp table t_ini on commit drop as
select (select coalesce(max(id), 0) from public.auditoria) as auditoria,
       (select coalesce(max(id), 0) from public.notificacoes) as notificacoes,
       (select count(*) from public.migracao_pendencias) as pendencias;

-- ============ O CORTE ============
create temp table t_res on commit drop as select public._migracao_corte() as r;

select is((select r - 'pendencias_abertas' from t_res), jsonb_build_object(
    'decisoes_lidas', 3, 'parceiros_migrados', 4, 'pendentes_bloqueados', 1, 'papeis_trocados', 4,
    'clientes_portal', 5, 'clientes_portal_finalizados', 1, 'clientes_migrados', 7, 'registros_juntados', 3,
    'migrados_sem_cpf', 1, 'migrados_cpf_invalido', 1, 'conflitos_portal', 1, 'conflitos_cliente', 1,
    'conflitos_parceiros', 2, 'propostas_vinculadas', 2, 'propostas_sem_cliente', 1, 'propostas_fora_do_escopo', 1,
    'juntadas_divergentes', 2),
  'totais do corte batem com os dados de exemplo');
select is((select (r ->> 'pendencias_abertas')::int from t_res), 14, '14 pendências abertas');
select is(coalesce(current_setting('arken.migracao', true), ''), '', 'arken.migracao volta ao que era depois do corte');

-- ---- parceiros legados (§2.4) ----
select ok((select p.tipo = 'corretor' and p.gerente_id = c.gerente_casa_id and p.imobiliaria_id = c.imobiliaria_casa_id
                  and p.migrado_legado and not p.virtual and p.inativado_em is null
                  and p.cpf = '12345671483' and p.creci = 'CRECI-L1' and p.telefone = '11988887777'
                  and p.imobiliaria_declarada = 'Imobiliária Antiga Ltda' and p.codigo_indicacao ~ '^[a-z2-7]{10}$'
           from public.parceiros p cross join public.configuracao_geral c where p.profile_id = pg_temp.leg('leg1')),
          'leg1 vira corretor migrado na Gerência Arken, com CPF, CRECI, telefone, imobiliária declarada e link');
select is((select p.email from public.parceiros p where p.profile_id = pg_temp.leg('leg1')), 'leg1@legado.test',
          'o e-mail do vínculo é o do login (auth.users, normalizado), nunca o profiles.email');
select is((select p.nome || '|' || pr.nome from public.parceiros p join public.profiles pr on pr.id = p.profile_id
           where p.profile_id = pg_temp.leg('leg1')), 'leg1|leg1',
          'nome vazio no perfil: o vínculo usa o início do e-mail e o perfil acompanha (saudação do painel)');
select is((select array_agg(pr.papel::text || '/' || pr.status_parceiro::text order by pr.id) from public.profiles pr
           where pr.id in (pg_temp.leg('leg1'), pg_temp.leg('leg2'), pg_temp.leg('leg3'), pg_temp.leg('leg4'))),
          array['corretor/aprovado', 'corretor/bloqueado', 'corretor/bloqueado', 'corretor/aprovado'],
          'contração: papel parceiro → corretor para quem tem vínculo; pendente com carteira entra bloqueado');
select ok((select p.cpf is null and p.codigo_indicacao is null from public.parceiros p where p.profile_id = pg_temp.leg('leg2'))
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'cpf_parceiro_invalido'
                        and m.tabela = 'parceiros' and m.registro_id = pg_temp.vinculo('leg2')),
          'leg2 (CPF de DV inválido): vínculo sem CPF, sem link (bloqueado) e pendência cpf_parceiro_invalido');
select ok((select p.cpf is null from public.parceiros p where p.profile_id = pg_temp.leg('leg4'))
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'cpf_parceiro_invalido'
                        and m.registro_id = pg_temp.vinculo('leg4')),
          'leg4 (CPF já de outro parceiro): vínculo sem CPF e pendência');
select ok(exists (select 1 from public.migracao_pendencias m where m.tipo = 'parceiro_pendente_com_clientes'
                    and m.registro_id = pg_temp.vinculo('leg3') and m.relacionado_id = pg_temp.leg('leg3'))
          and exists (select 1 from public.parceiro_status_historico h where h.profile_id = pg_temp.leg('leg3')
                        and h.de = 'pendente' and h.para = 'bloqueado' and h.origem = 'migracao'),
          'leg3 (pendente com carteira): bloqueado, com histórico de status (origem migracao) e pendência');
select is((select count(*)::int from public.parceiro_status_historico h
           where h.profile_id in (pg_temp.leg('leg1'), pg_temp.leg('leg2'), pg_temp.leg('leg3'), pg_temp.leg('leg4'))
             and h.origem = 'migracao'), 4, 'um registro de status (origem migracao) por parceiro migrado');
select ok((select h.motivo = 'migração: parceiro legado na Gerência Arken' and h.vigente_ate is null
           from public.parceiro_vinculos_historico h where h.parceiro_id = pg_temp.vinculo('leg1')),
          'histórico de vínculo do parceiro abre com o rótulo do corte');
select ok((select pr.papel = 'parceiro' and pr.status_parceiro = 'pendente' from public.profiles pr where pr.id = pg_temp.usuario('pendente'))
          and pg_temp.vinculo('pendente') is null,
          'autocadastro pendente SEM carteira não muda (aprovação por rede_aprovar_autocadastro)');

-- ---- clientes do portal: etapa inicial, nunca trocam de dono ----
select is((select array_agg(c.etapa::text order by c.id) from public.clientes c
           where c.id in (pg_temp.leg('p1'), pg_temp.leg('p2'), pg_temp.leg('p3'), pg_temp.leg('p4'), pg_temp.leg('p5'))),
          array['finalizado', 'novo_contato', 'novo_contato', 'contato_iniciado', 'novo_contato'],
          'etapa: finalizado com negócio, senão novo contato; a decisão (P4, pelo id) prevalece');
select ok((select bool_and(c.corretor_id = cg.corretor_casa_id and c.portal_liberado and c.origem = 'portal_admin'
                           and c.inativado_em is null)
           from public.clientes c cross join public.configuracao_geral cg
           where c.id in (pg_temp.leg('p1'), pg_temp.leg('p2'), pg_temp.leg('p3'), pg_temp.leg('p4'), pg_temp.leg('p5'))),
          'cliente do portal NUNCA troca de dono: continua na Carteira Arken, com o portal liberado');
select ok((select c.etapa_desde = timestamptz '2025-06-15' from public.clientes c where c.id = pg_temp.leg('p1'))
          and (select c.etapa_desde = timestamptz '2025-07-01' from public.clientes c where c.id = pg_temp.leg('p2')),
          'etapa_desde: o primeiro negócio (finalizado) ou o cadastro');
select is((select count(*)::int from public.historico_status h
           where h.entidade = 'cliente_etapa' and h.origem = 'migracao' and h.de is null
             and h.entidade_id in (pg_temp.leg('p1'), pg_temp.leg('p2'), pg_temp.leg('p3'), pg_temp.leg('p4'), pg_temp.leg('p5'))),
          5, 'a etapa de cada cliente do portal fica em historico_status com origem migracao');
select is((select count(*)::int from public.cliente_eventos e where e.tipo = 'migracao' and e.ator_id is null
             and e.cliente_id in (pg_temp.leg('p1'), pg_temp.leg('p2'), pg_temp.leg('p3'), pg_temp.leg('p4'), pg_temp.leg('p5'))),
          5, 'timeline: um evento "migracao" por cliente do portal');
select ok(exists (select 1 from public.migracao_pendencias m where m.tipo = 'cpf_invalido' and m.tabela = 'clientes'
                    and m.registro_id = pg_temp.leg('p3'))
          and (select c.cpf = '12345678900' from public.clientes c where c.id = pg_temp.leg('p3')),
          'cliente do portal com CPF inválido: pendência cpf_invalido; o CPF não é apagado (a equipe corrige)');
select ok(exists (select 1 from public.migracao_pendencias m where m.tipo = 'decisao_invalida' and m.registro_id = pg_temp.leg('p5')),
          'decisão de etapa inválida (P5, pelo CPF): vale a regra padrão e abre pendência');

-- ---- parceiro_clientes → clientes (§2.4) ----
select ok((select c.cpf = '39053344705' and c.corretor_id = pg_temp.vinculo('leg1')
                  and c.gerente_id = cg.gerente_casa_id and c.imobiliaria_id = cg.imobiliaria_casa_id
                  and c.origem = 'migracao_parceiro_clientes' and c.etapa = 'novo_contato' and not c.portal_liberado
                  and c.nome = 'Fulano A' and c.rg = '11.222.333-4' and c.telefone = '11911111111'
                  and c.created_at = timestamptz '2026-01-01' and c.etapa_desde = timestamptz '2026-01-01'
                  and c.exclusividade_ate = timestamptz '2026-01-01' + make_interval(days => cg.exclusividade_dias)
                  and c.criado_por = pg_temp.leg('leg1')
           from public.clientes c cross join public.configuracao_geral cg where c.id = pg_temp.migrado('a1')),
          'A: cliente do CRM com a cadeia do parceiro, NC, portal fechado e exclusividade = cadastro + prazo');
select ok((select c.telefones_adicionais = '{11922222222}' and c.interesses = '{Apartamento,Casa}'
           from public.clientes c where c.id = pg_temp.migrado('a1')),
          'mesmo CPF no mesmo parceiro: telefone e interesses do outro registro são juntados');
select is((select array_agg(m.resultado order by m.parceiro_cliente_id) from public.migracao_parceiro_clientes m
           where m.parceiro_cliente_id in (pg_temp.leg('a1'), pg_temp.leg('a2')) and m.cliente_id = pg_temp.migrado('a1')),
          array['migrado', 'juntado'], 'mapa: A1 migrado e A2 juntado no mesmo cliente');
select is((select array_agg(n.texto order by n.criado_em, n.texto) from public.cliente_notas n where n.cliente_id = pg_temp.migrado('a1')),
          array['Nota A1', 'Cadastro juntado do sistema antigo (mesmo CPF), com o nome: Fulano B', 'Nota A2'],
          'anotações viram notas (a mais antiga primeiro), e o nome do registro juntado também');
select ok((select bool_and(n.migrado_legado and n.autor_id = pg_temp.leg('leg1') and not n.removido_lgpd)
           from public.cliente_notas n where n.cliente_id = pg_temp.migrado('a1')),
          'notas migradas: migrado_legado, autor = o parceiro');
select ok((select h.motivo = 'migração: carteira do parceiro no sistema antigo' and h.corretor_id = pg_temp.vinculo('leg1')
                  and h.vigente_ate is null
           from public.cliente_vinculos_historico h where h.cliente_id = pg_temp.migrado('a1')),
          'histórico de vínculo do cliente abre com o rótulo do corte (preservado pela anonimização)');
select is((select count(*)::int from public.cliente_eventos e where e.cliente_id = pg_temp.migrado('a1') and e.tipo = 'migracao'
             and e.dados ->> 'registros' = '2'), 1, 'timeline: evento "migracao" do cliente juntado (2 registros)');

-- conflitos
select ok((select m.resultado = 'conflito_portal' and m.cliente_id = pg_temp.leg('p1')
           from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pg_temp.leg('b1'))
          and (select count(*) = 1 from public.clientes c where c.cpf = '52998224725')
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'cpf_conflito_portal'
                        and m.tabela = 'legado_parceiro_clientes' and m.registro_id = pg_temp.leg('b1')
                        and m.relacionado_id = pg_temp.leg('p1')),
          'mesmo CPF de cliente do portal: não migra, o cliente do portal fica com o dono e abre pendência');
select ok((select c.corretor_id = pg_temp.vinculo('leg1') from public.clientes c where c.id = pg_temp.migrado('c1'))
          and (select m.resultado = 'conflito_parceiros' and m.cliente_id = pg_temp.migrado('c1')
               from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pg_temp.leg('c2'))
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'cpf_conflito_parceiros'
                        and m.registro_id = pg_temp.leg('c2') and m.relacionado_id = pg_temp.migrado('c1')
                        and m.detalhe like '%mais antigo ficou como dono provisório (A2)%'),
          'mesmo CPF em parceiros diferentes: o mais antigo é o dono provisório (A2); o outro não migra e abre pendência');
select ok((select c.corretor_id = pg_temp.vinculo('leg1') from public.clientes c where c.id = pg_temp.migrado('d1'))
          and (select m.resultado = 'conflito_parceiros' from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pg_temp.leg('d2'))
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'cpf_conflito_parceiros'
                        and m.registro_id = pg_temp.leg('d2') and m.detalhe like '%decisão registrada antes do corte%'),
          'migracao_decisoes (dono_cpf) prevalece: leg1 fica com D mesmo com o registro do leg4 mais antigo');
select ok((select m.resultado = 'conflito_cliente' and m.cliente_id = pg_temp.cliente('c2')
           from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pg_temp.leg('i1'))
          and (select c.corretor_id = pg_temp.parceiro('ca2a') from public.clientes c where c.id = pg_temp.cliente('c2'))
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'cpf_conflito_cliente' and m.registro_id = pg_temp.leg('i1')),
          'mesmo CPF de um cliente que já estava no CRM: não migra, o dono atual continua e abre pendência');

-- sem CPF, CPF inválido e dono sem vínculo
select ok((select c.cpf is null and c.corretor_id = pg_temp.vinculo('leg3') and c.origem = 'migracao_parceiro_clientes'
                  and c.interesses = '{Terreno}'
           from public.clientes c where c.id = pg_temp.migrado('e1'))
          and (select m.resultado = 'migrado_sem_cpf' from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pg_temp.leg('e1'))
          and not exists (select 1 from public.migracao_pendencias m where m.registro_id = pg_temp.migrado('e1')),
          'sem CPF: migra com cpf nulo (permitido só nesta origem), para o parceiro (mesmo bloqueado), sem pendência');
select ok((select c.cpf is null from public.clientes c where c.id = pg_temp.migrado('f1'))
          and (select m.resultado = 'migrado_cpf_invalido' from public.migracao_parceiro_clientes m where m.parceiro_cliente_id = pg_temp.leg('f1'))
          and exists (select 1 from public.cliente_notas n where n.cliente_id = pg_temp.migrado('f1') and n.migrado_legado
                        and n.texto = 'CPF informado no sistema antigo, com dígito verificador inválido (o cliente foi migrado sem CPF): 123.456.789-00')
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'cpf_invalido' and m.tabela = 'clientes'
                        and m.registro_id = pg_temp.migrado('f1') and m.relacionado_id = pg_temp.leg('f1')),
          'CPF inválido: migra sem CPF, o valor digitado vira nota e abre pendência cpf_invalido');
select ok((select c.corretor_id = cg.corretor_casa_id and c.cpf = '12345671564'
           from public.clientes c cross join public.configuracao_geral cg where c.id = pg_temp.migrado('h1'))
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'dono_sem_vinculo'
                        and m.registro_id = pg_temp.migrado('h1') and m.relacionado_id = pg_temp.usuario('admin')),
          'dono antigo sem vínculo de corretor (ex.: admin): cliente na Carteira Arken e pendência');
select is((select count(*)::int from public.cliente_eventos e where e.tipo = 'migracao'
           and e.cliente_id in (select m.cliente_id from public.migracao_parceiro_clientes m
                                 where m.resultado in ('migrado', 'migrado_sem_cpf', 'migrado_cpf_invalido'))),
          7, 'timeline: um evento "migracao" por cliente criado a partir da carteira antiga');

-- [MIG-02] juntada com nome ou RG diferentes: nada se perde (vai para nota) e o negócio vê o caso
select is((select array_agg(n.texto order by n.criado_em, n.texto) from public.cliente_notas n where n.cliente_id = pg_temp.migrado('j1')),
          array['RG informado em cadastro juntado do sistema antigo (mesmo CPF): 98.765.432-1'],
          'juntada com RG diferente: o RG do registro juntado vira nota; o mesmo RG escrito de outro jeito (j3) não');
select ok((select c.rg = '12.345.678-9' and c.nome = 'Joana' from public.clientes c where c.id = pg_temp.migrado('j1'))
          and (select array_agg(m.resultado order by m.parceiro_cliente_id) from public.migracao_parceiro_clientes m
                where m.cliente_id = pg_temp.migrado('j1')) = array['migrado', 'juntado', 'juntado'],
          'juntada: o cliente fica com o RG do registro-base e os três registros apontam para ele');
select ok(exists (select 1 from public.migracao_pendencias m where m.tipo = 'juntada_divergente' and m.tabela = 'clientes'
                    and m.registro_id = pg_temp.migrado('j1') and m.relacionado_id = pg_temp.leg('j2')
                    and m.detalhe not like '%98.765%' and m.detalhe not like '%Joana%')
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'juntada_divergente'
                        and m.registro_id = pg_temp.migrado('a1') and m.relacionado_id = pg_temp.leg('a2')),
          'pendência juntada_divergente: para RG diferente (j2) e para nome diferente (a2), sem dado pessoal no detalhe');
select is((select count(*)::int from public.migracao_pendencias m where m.tipo = 'juntada_divergente'), 2,
          'só as duas juntadas divergentes abrem pendência (o mesmo RG com outra grafia não)');

-- ---- propostas pelo mapa ----
select ok((select p.cliente_id = pg_temp.migrado('a1') and p.corretor_id = pg_temp.vinculo('leg1')
                  and p.gerente_id = cg.gerente_casa_id and p.imobiliaria_id = cg.imobiliaria_casa_id
           from public.propostas p cross join public.configuracao_geral cg where p.id = pg_temp.leg('pr1')),
          'proposta de registro juntado: recebe o cliente e a cadeia dele');
select ok((select p.cliente_id is null and p.corretor_id = pg_temp.vinculo('leg3') from public.propostas p where p.id = pg_temp.leg('pr2'))
          and (select mp.resultado = 'cliente_nao_migrado' from public.migracao_propostas mp where mp.proposta_id = pg_temp.leg('pr2')),
          'proposta de registro que não migrou: sem cliente, com a cadeia do autor');
select ok((select p.cliente_id is null from public.propostas p where p.id = pg_temp.leg('pr3'))
          and (select mp.resultado = 'fora_do_escopo' from public.migracao_propostas mp where mp.proposta_id = pg_temp.leg('pr3'))
          and exists (select 1 from public.migracao_pendencias m where m.tipo = 'proposta_cliente_outro_parceiro'
                        and m.tabela = 'propostas' and m.registro_id = pg_temp.leg('pr3') and m.relacionado_id = pg_temp.migrado('a1')),
          'proposta que apontava para cliente de outro parceiro: fica sem cliente e abre pendência');
select ok((select p.cliente_id is null and p.corretor_id = pg_temp.vinculo('leg1') from public.propostas p where p.id = pg_temp.leg('pr4')),
          'proposta sem registro antigo: ganha a cadeia do autor quando o vínculo nasce');
select ok((select p.cliente_id = pg_temp.migrado('e1') from public.propostas p where p.id = pg_temp.leg('pr5'))
          and (select mp.resultado = 'vinculada' and mp.cliente_id = pg_temp.migrado('e1')
               from public.migracao_propostas mp where mp.proposta_id = pg_temp.leg('pr5')),
          'proposta de autor interno: recebe o cliente migrado');

-- ---- contração, auditoria e privacidade ----
select is((select count(*)::int from public.migracao_decisoes), 0, 'migracao_decisoes (com CPF) é esvaziada no fim');
select ok((select count(*) = 1 and bool_and(a.categoria = 'operacao' and a.entidade = 'migracao' and a.origem = 'migracao'
                                             and a.ator_id is null and (a.detalhe ->> 'clientes_migrados')::int = 7
                                             and jsonb_array_length(a.detalhe -> 'pendencias_abertas') = 14)
           from public.auditoria a where a.acao = 'migracao' and a.id > (select auditoria from t_ini)),
          'auditoria "migracao" com os totais e a lista de pendências abertas');
select ok((select bool_and(a.detalhe::text !~ '\d{3}\.?\d{3}\.?\d{3}-?\d{2}' and a.detalhe::text !~* 'fulano|legado\.test')
           from public.auditoria a where a.id > (select auditoria from t_ini)),
          'a auditoria do corte não tem CPF, nome nem e-mail');
select is((select count(*)::int from public.migracao_pendencias m where m.id > 0 and m.criado_em >= now() - interval '1 hour'
             and (m.detalhe ~ '\d{3}\.?\d{3}\.?\d{3}-?\d{2}' or m.detalhe ~* 'fulano|portal um|legado\.test' or m.detalhe is null)),
          0, 'detalhe das pendências: texto explicativo, sem CPF, nome nem e-mail');
select is(((select count(*) from public.migracao_pendencias) - (select pendencias from t_ini))::int, 14,
          '14 pendências novas: 2 CPF de parceiro, 1 pendente com carteira, 2 CPF inválido, 1 decisão inválida, 4 conflitos, 1 sem vínculo, 1 proposta, 2 juntadas divergentes');
select is((select count(*)::int from public.notificacoes n where n.id > (select notificacoes from t_ini)), 0,
          'durante o corte nada entra na fila de e-mails');

-- ---- idempotência ----
select is((select r - 'pendencias_abertas' from (select public._migracao_corte() as r) x), jsonb_build_object(
    'decisoes_lidas', 0, 'parceiros_migrados', 0, 'pendentes_bloqueados', 0, 'papeis_trocados', 0,
    'clientes_portal', 0, 'clientes_portal_finalizados', 0, 'clientes_migrados', 0, 'registros_juntados', 0,
    'migrados_sem_cpf', 0, 'migrados_cpf_invalido', 0, 'conflitos_portal', 0, 'conflitos_cliente', 0,
    'conflitos_parceiros', 0, 'propostas_vinculadas', 0, 'propostas_sem_cliente', 0, 'propostas_fora_do_escopo', 0,
    'juntadas_divergentes', 0),
  'rodar de novo não migra nada outra vez (idempotente)');
select is(((select count(*) from public.migracao_pendencias) - (select pendencias from t_ini))::int, 14,
          'rodar de novo não duplica pendências');

-- ---- grants: nada disso é legível pela API ----
create temp table t_pend on commit drop as
select m.id, (select count(*) from public.migracao_pendencias)::int as total
from public.migracao_pendencias m where m.tipo = 'cpf_invalido' and m.registro_id = pg_temp.migrado('f1');
grant select on t_pend to authenticated;
select pg_temp.entrar('admin');
select throws_ok($$select count(*) from public.migracao_parceiro_clientes$$, '42501', null, 'mapa do corte: nem o admin lê direto');
select throws_ok($$select count(*) from public.migracao_propostas$$, '42501', null, 'mapa das propostas: nem o admin lê direto');
select throws_ok($$select count(*) from public.legado_parceiro_clientes$$, '42501', null, 'carteira legada: nem o admin lê');
select throws_ok($$select public._migracao_corte()$$, '42501', null, 'a função do corte não é executável pela API');
select is((select count(*)::int from public.migracao_pendencias), (select total from t_pend),
          'o admin lê todas as pendências (política "internos leem"), para a tela "Pendências da migração"');
select pg_temp.entrar('ca1a');
select is((select count(*)::int from public.migracao_pendencias), 0, 'parceiro não vê pendências da migração');

-- ============ migracao_pendencias_resolver (§4.4, internos) ============
select throws_ok(format('select public.migracao_pendencias_resolver(%s, %L)', (select id from t_pend), 'CPF confirmado com o corretor'),
                 '42501', 'Sem acesso a este registro', 'parceiro não resolve pendência da migração');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.migracao_pendencias_resolver(%s, %L)', (select id from t_pend), ' ok ')) ->> 'mensagem',
          'MOTIVO_OBRIGATORIO', 'decisão com menos de 5 caracteres: MOTIVO_OBRIGATORIO');
select throws_ok($$select public.migracao_pendencias_resolver(999999999, 'decisão qualquer')$$, '42501', 'Sem acesso a este registro',
                 'pendência inexistente: o mesmo 42501');
select lives_ok(format('select public.migracao_pendencias_resolver(%s, %L)', (select id from t_pend),
                       'CPF confirmado com o corretor e completado na ficha pela equipe.'),
                'admin resolve a pendência com a decisão');
select throws_ok(format('select public.migracao_pendencias_resolver(%s, %L)', (select id from t_pend), 'de novo, outra decisão'),
                 'P0001', 'Esta pendência já foi resolvida.', 'pendência resolvida não é reaberta nem reescrita');
select pg_temp.sair();
select ok((select m.resolvido_em is not null and m.resolvido_por = pg_temp.usuario('admin')
                  and m.decisao = 'CPF confirmado com o corretor e completado na ficha pela equipe.'
           from public.migracao_pendencias m where m.id = (select id from t_pend)),
          'a decisão, quem e quando ficam na pendência');
select ok((select count(*) = 1 and bool_and(a.categoria = 'operacao' and a.acao = 'resolver' and a.entidade = 'migracao_pendencias'
                                             and a.cliente_id = pg_temp.migrado('f1') and a.ator_id = pg_temp.usuario('admin')
                                             and a.detalhe ->> 'tipo' = 'cpf_invalido'
                                             and a.detalhe::text not like '%confirmado%')
           from public.auditoria a where a.entidade = 'migracao_pendencias' and a.entidade_id = (select id::text from t_pend)),
          'auditoria operacao/resolver com o titular e o tipo, sem o texto da decisão');
update public.configuracao_geral set exigir_mfa_interno = true;
create temp table t_outra on commit drop as
select min(m.id) as id from public.migracao_pendencias m where m.resolvido_em is null;
grant select on t_outra to authenticated;
select pg_temp.entrar('super');
select throws_ok(format('select public.migracao_pendencias_resolver(%s, %L)', (select id from t_outra), 'decisão do Super'),
                 '42501', 'Sem acesso a este registro', 'com MFA exigido, interno em aal1 não resolve');
select pg_temp.entrar('super', 'aal2');
select lives_ok(format('select public.migracao_pendencias_resolver(%s, %L)', (select id from t_outra), 'decisão do Super'),
                'com MFA exigido, o Super em aal2 resolve');
select pg_temp.sair();
select ok((select m.resolvido_por = pg_temp.usuario('super') from public.migracao_pendencias m where m.id = (select id from t_outra)),
          'a pendência fica com o Super como quem resolveu');

select * from finish();
rollback;
