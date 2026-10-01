-- Governança do WP6 (docs/ARQUITETURA_EXPANSAO.md §3.9, §4.4, §5.1–§5.3, §6.6, §8.5, H3, H5, N2, N20):
-- auditoria_consultar (só internos; registra a própria leitura; o log não guarda valores pessoais), config_atualizar
-- (só o Super; lista de colunas; antes/depois), equipe_definir_papel (só o Super; só entre papéis internos; nunca o
-- último Super), painel_resumo (seções por permissão, contagens no escopo, sem auditoria) e as tarefas do pg_cron
-- (sem grant; purga só do que venceu; fila e D4Sign sem efeito sem os segredos do Vault).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(129);

create temp table t_ini on commit drop as select coalesce(max(id), 0) as auditoria from public.auditoria;
grant select on t_ini to authenticated;

-- ============ auditoria_consultar: quem pode ============
select pg_temp.entrar_anon();
select throws_ok($$select public.auditoria_consultar('{}', 50, 0)$$, '42501', null, 'anon não executa auditoria_consultar');
select pg_temp.entrar('ca1a');
select is(public.auditoria_consultar('{}', 50, 0), null, 'corretor: nulo');
select pg_temp.entrar('ia');
select is(public.auditoria_consultar('{}', 50, 0), null, 'imobiliária: nulo');
select pg_temp.entrar('titular_c1');
select is(public.auditoria_consultar('{}', 50, 0), null, 'titular do portal: nulo');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'acesso_negado' and a.entidade = 'auditoria'), 3, 'cada negação fica registrada (acesso_negado)');
update public.configuracao_geral set exigir_mfa_interno = true;
select pg_temp.entrar('admin');
select is(public.auditoria_consultar('{}', 50, 0), null, 'com 2FA exigida, o admin em aal1 não lê a auditoria (H5)');
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = false;

-- ============ auditoria_consultar: leitura ============
-- registros de exemplo (como postgres): um do c1, um antigo, um de outra categoria
insert into public.auditoria (ocorrido_em, categoria, acao, entidade, entidade_id, cliente_id, ator_id, detalhe) values
  ('2026-09-01 12:00:00-03', 'operacao', 'editar', 'clientes', pg_temp.cliente('c1')::text, pg_temp.cliente('c1'),
   pg_temp.usuario('ca1a'), '{"exemplo":1}'),
  ('2025-01-01 12:00:00-03', 'acesso', 'consultar', 'clientes', pg_temp.cliente('c2')::text, pg_temp.cliente('c2'),
   pg_temp.usuario('ca2a'), '{"exemplo":2}'),
  ('2026-09-02 12:00:00-03', 'configuracao', 'editar', 'configuracao_geral', 'true', null, pg_temp.usuario('super'),
   '{"exemplo":3}');
select pg_temp.entrar('admin');
create temp table t_pag on commit drop as
select public.auditoria_consultar(jsonb_build_object('cliente_id', pg_temp.cliente('c1')), 10, 0) as p;
select pg_temp.sair();
select is((select (p ->> 'total')::int from t_pag), 1, 'filtro por cliente: total');
select ok((select (p -> 'itens' -> 0 ->> 'entidade') = 'clientes' and (p -> 'itens' -> 0 ->> 'ator_nome') = 'CA1a Corretor'
                  and (p -> 'itens' -> 0 ->> 'categoria') = 'operacao' from t_pag), 'item com o nome do ator');
select is((select array_agg(k order by k) from t_pag, jsonb_object_keys(p -> 'itens' -> 0) k),
          array['acao', 'antes', 'ator_id', 'ator_nome', 'ator_papel', 'ator_parceiro_id', 'campos', 'categoria', 'cliente_id',
                'depois', 'detalhe', 'entidade', 'entidade_id', 'id', 'ip', 'ocorrido_em', 'origem', 'user_agent'],
          'formato AuditoriaItem');
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.categoria = 'acesso' and a.acao = 'consultar' and a.entidade = 'auditoria'
             and a.ator_id = pg_temp.usuario('admin') and a.cliente_id = pg_temp.cliente('c1')
             and (a.detalhe ->> 'total')::int = 1 and jsonb_array_length(a.detalhe -> 'ids') = 1
             and a.detalhe -> 'filtros' ->> 'cliente_id' = pg_temp.cliente('c1')::text), 1,
          'a própria leitura é registrada (acesso/consultar) com o cliente filtrado, o total e os ids');
select pg_temp.entrar('super');
select is((public.auditoria_consultar('{"categoria":"configuracao","de":"2026-09-02","ate":"2026-09-02"}', 10, 0) ->> 'total')::int, 1,
          'o Super também lê; filtro por categoria e período (dia inclusivo, fuso de São Paulo)');
select is((public.auditoria_consultar('{"de":"2025-01-01","ate":"2025-01-01"}', 10, 0) -> 'itens' -> 0 -> 'detalhe' ->> 'exemplo')::int, 2,
          'registro antigo encontrado pelo período');
select is(jsonb_array_length(public.auditoria_consultar('{}', 2, 0) -> 'itens'), 2, 'limite respeitado');
select ok((public.auditoria_consultar('{}', 1000, 0) -> 'itens') is not null
          and jsonb_array_length(public.auditoria_consultar('{}', 1000, 0) -> 'itens') <= 200, 'limite máximo 200');
select is((public.auditoria_consultar('{"acao":"acesso_negado","entidade":"auditoria"}', 50, 0) ->> 'total')::int, 4,
          'as negações de leitura da auditoria aparecem na consulta');
select is(pg_temp.erro($$select public.auditoria_consultar('{"categoria":"outra"}', 10, 0)$$) ->> 'mensagem', 'DADOS_INVALIDOS',
          'categoria inválida: DADOS_INVALIDOS');
select is(pg_temp.erro($$select public.auditoria_consultar('{"acao":"drop table"}', 10, 0)$$) ->> 'mensagem', 'DADOS_INVALIDOS',
          'ação fora do formato de código: DADOS_INVALIDOS');
select is(pg_temp.erro($$select public.auditoria_consultar('{"de":"2026-09-10","ate":"2026-09-01"}', 10, 0)$$) ->> 'mensagem',
          'DADOS_INVALIDOS', 'período invertido: DADOS_INVALIDOS');
select is(pg_temp.erro($$select public.auditoria_consultar('{"cliente_id":"x"}', 10, 0)$$) ->> 'mensagem', 'DADOS_INVALIDOS',
          'cliente_id que não é uuid: DADOS_INVALIDOS');
select lives_ok($$select public.auditoria_consultar('{"entidade_id":"Fulano de Tal"}', 10, 0)$$, 'entidade_id livre é aceito');
-- datas fora da faixa plausível: DADOS_INVALIDOS, nunca o erro cru do Postgres (WP6R-04)
select is(pg_temp.erro($$select public.auditoria_consultar('{"ate":"294276-12-31"}', 10, 0)$$),
          '{"sqlstate":"P0001","mensagem":"DADOS_INVALIDOS","detalhe":{"motivo":"filtros"}}'::jsonb,
          '"ate" no limite do tipo date: DADOS_INVALIDOS (antes: 22008 date out of range)');
select is(pg_temp.erro($$select public.auditoria_consultar('{"de":"infinity"}', 10, 0)$$) ->> 'mensagem', 'DADOS_INVALIDOS',
          '"de" infinito: DADOS_INVALIDOS');
select is(pg_temp.erro($$select public.auditoria_consultar('{"de":"1999-12-31"}', 10, 0)$$) ->> 'mensagem', 'DADOS_INVALIDOS',
          '"de" antes de 2000: DADOS_INVALIDOS');
select lives_ok($$select public.auditoria_consultar('{"de":"2000-01-01","ate":"2100-12-31"}', 10, 0)$$,
                'limites da faixa (2000-01-01 a 2100-12-31) aceitos');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.entidade = 'auditoria' and a.acao = 'consultar' and a.detalhe -> 'filtros' ->> 'entidade_id' = 'true'
             and a.detalhe::text not like '%Fulano%'), 1,
          'texto livre do filtro não vai para o registro (só "true")');
select pg_temp.entrar('admin');
create temp table t_pag2 on commit drop as select public.auditoria_consultar('{"entidade":"auditoria","acao":"consultar"}', 200, 0) as p;
select pg_temp.sair();
select is((select count(*)::int from t_pag2, jsonb_array_elements(p -> 'itens') e
            where (e ->> 'id')::bigint = (select max(a.id) from public.auditoria a)), 0,
          'o registro da leitura não aparece na própria página');
select throws_ok($$update public.auditoria set acao = 'x' where true$$, '42501', 'Auditoria é somente inclusão',
                 'auditoria continua imutável (nem o dono altera)');

-- ============ config_atualizar (só o Super) ============
select pg_temp.entrar('admin');
select throws_ok($$select public.config_atualizar('{"exclusividade_dias": 30}')$$, '42501', 'Sem acesso a este registro',
                 'admin não altera a configuração');
select pg_temp.entrar('ga1');
select throws_ok($$select public.config_atualizar('{"exclusividade_dias": 30}')$$, '42501', 'Sem acesso a este registro',
                 'parceiro não altera a configuração');
select pg_temp.entrar_anon();
select throws_ok($$select public.config_atualizar('{"exclusividade_dias": 30}')$$, '42501', null, 'anon não executa');
select pg_temp.entrar('super');
select is(pg_temp.erro($$select public.config_atualizar('{"imobiliaria_casa_id": null, "exclusividade_dias": 30}')$$) -> 'detalhe',
          '{"campos":["imobiliaria_casa_id"]}'::jsonb, 'chave fora da lista (ids da casa): DADOS_INVALIDOS {campos}');
select is(pg_temp.erro($$select public.config_atualizar('{"exclusividade_dias": 0, "retencao_acesso_meses": 3, "vendedora_cnpj": "11.222.333/0001-00"}')$$) -> 'detalhe',
          '{"campos":["exclusividade_dias","retencao_acesso_meses","vendedora_cnpj"]}'::jsonb,
          'valores fora das faixas e CNPJ com DV errado: DADOS_INVALIDOS com cada campo');
select is(pg_temp.erro($$select public.config_atualizar('{"documentos_basicos": ["CPF", "cpf"]}')$$) -> 'detalhe',
          '{"campos":["documentos_basicos"]}'::jsonb, 'documentos básicos repetidos: inválido');
select is(pg_temp.erro($$select public.config_atualizar('{"sessao_inatividade_horas": null}')$$) -> 'detalhe',
          '{"campos":["sessao_inatividade_horas"]}'::jsonb, 'nulo em campo obrigatório: inválido');
select is(pg_temp.erro($$select public.config_atualizar('[1]')$$) ->> 'mensagem', 'DADOS_INVALIDOS', 'formato inválido');
-- booleano só como booleano JSON: nunca o erro cru de conversão (WP6R-04)
select is(pg_temp.erro($$select public.config_atualizar('{"exigir_mfa_interno": "abc"}')$$),
          '{"sqlstate":"P0001","mensagem":"DADOS_INVALIDOS","detalhe":{"campos":["exigir_mfa_interno"]}}'::jsonb,
          'exigir_mfa_interno texto: DADOS_INVALIDOS {campos} (antes: 22P02 invalid input syntax for type boolean)');
select is(pg_temp.erro($$select public.config_atualizar('{"exigir_mfa_interno": "true", "exclusividade_dias": 0}')$$) -> 'detalhe',
          '{"campos":["exigir_mfa_interno","exclusividade_dias"]}'::jsonb,
          'string "true" também é recusada, junto com os demais campos inválidos');
select is(pg_temp.erro($$select public.config_atualizar('{"exigir_mfa_interno": 1}')$$) -> 'detalhe',
          '{"campos":["exigir_mfa_interno"]}'::jsonb, 'número no lugar de booleano: inválido');
select is(pg_temp.erro($$select public.config_atualizar('{"exigir_mfa_interno": null}')$$) -> 'detalhe',
          '{"campos":["exigir_mfa_interno"]}'::jsonb, 'nulo no booleano obrigatório: inválido');
select lives_ok($$select public.config_atualizar('{"exclusividade_dias": 120, "vendedora_cnpj": "11.222.333/0001-81", "vendedora_razao_social": "  Arken Incorporadora Ltda  ", "prazo_assinatura_dias": null, "documentos_basicos": [" CPF ", "RG"]}')$$,
                'Super altera vários campos de uma vez');
select pg_temp.sair();
select ok((select c.exclusividade_dias = 120 and c.vendedora_cnpj = '11222333000181'
                  and c.vendedora_razao_social = 'Arken Incorporadora Ltda' and c.documentos_basicos = array['CPF', 'RG']
                  and c.atualizado_por = pg_temp.usuario('super') and c.atualizado_em is not null
           from public.configuracao_geral c), 'valores gravados (CNPJ só dígitos, textos aparados) e carimbo do Super');
select is((select a.campos from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.categoria = 'configuracao' and a.acao = 'editar' and a.entidade = 'configuracao_geral' and a.campos is not null),
          array['documentos_basicos', 'exclusividade_dias', 'vendedora_cnpj', 'vendedora_razao_social'],
          'auditoria configuracao/editar só com os campos que mudaram');
select is((select a.antes || a.depois from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.categoria = 'configuracao' and a.entidade = 'configuracao_geral' and a.campos is not null) ? 'exclusividade_dias', true,
          'com antes e depois');
select ok((select (a.antes ->> 'exclusividade_dias')::int = 180 and (a.depois ->> 'exclusividade_dias')::int = 120
           from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.categoria = 'configuracao' and a.entidade = 'configuracao_geral' and a.campos is not null), 'antes 180 (decisão do dono), depois 120');
select pg_temp.entrar('super');
select lives_ok($$select public.config_atualizar('{"exclusividade_dias": 120}')$$, 'sem mudança real: não falha');
select lives_ok($$select public.config_atualizar('{}')$$, 'objeto vazio: nada muda');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.categoria = 'configuracao' and a.entidade = 'configuracao_geral' and a.campos is not null), 1, 'sem mudança real: sem novo registro');
-- H5: ligar a 2FA dos internos exige a sessão do próprio Super em aal2
select pg_temp.entrar('super');
select throws_ok($$select public.config_atualizar('{"exigir_mfa_interno": true}')$$, 'P0001', null,
                 'ligar a 2FA com a sessão em aal1: recusado (o Super se trancaria fora)');
select pg_temp.entrar('super', 'aal2');
select lives_ok($$select public.config_atualizar('{"exigir_mfa_interno": true}')$$, 'em aal2 o Super liga a 2FA dos internos');
select pg_temp.entrar('super');
select throws_ok($$select public.config_atualizar('{"exclusividade_dias": 60}')$$, '42501', null,
                 'com 2FA exigida, o Super em aal1 perde o acesso');
select pg_temp.entrar('super', 'aal2');
select lives_ok($$select public.config_atualizar('{"exigir_mfa_interno": false}')$$, 'e desliga em aal2');
select pg_temp.sair();

-- ============ equipe_definir_papel (só o Super, N2) ============
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('a0000000-0000-4000-8000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'colab@fixture.test', '{"nome":"Colaborador Um"}', now(), now()),
  ('a0000000-0000-4000-8000-000000000052', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'colab2@fixture.test', '{"nome":"Colaborador Dois"}', now(), now());
update public.profiles set papel = 'colaborador' where id in ('a0000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-000000000052');
update public.profiles set inativado_em = now() where id = 'a0000000-0000-4000-8000-000000000052';

select pg_temp.entrar('admin');
select throws_ok($$select public.equipe_definir_papel('a0000000-0000-4000-8000-000000000051', 'admin')$$, '42501',
                 'Sem acesso a este registro', 'admin não define papéis');
select throws_ok($$select public.equipe_definir_papel('a0000000-0000-4000-8000-000000000001', 'super')$$, '42501',
                 'Sem acesso a este registro', 'admin não se promove a Super');
select pg_temp.entrar('ia');
select throws_ok($$select public.equipe_definir_papel('a0000000-0000-4000-8000-000000000051', 'admin')$$, '42501',
                 'Sem acesso a este registro', 'parceiro não define papéis');
select pg_temp.entrar('super');
select throws_ok($$select public.equipe_definir_papel('a0000000-0000-4000-8000-0000000000ff', 'admin')$$, '42501',
                 'Sem acesso a este registro', 'perfil inexistente: 42501');
select throws_ok(format('select public.equipe_definir_papel(%L, %L)', pg_temp.usuario('ca1a'), 'admin'), 'P0001',
                 'Só é possível trocar entre Admin, Super e Colaborador.', 'corretor não vira interno por aqui');
select throws_ok(format('select public.equipe_definir_papel(%L, %L)', pg_temp.usuario('admin'), 'corretor'), 'P0001',
                 'Só é possível trocar entre Admin, Super e Colaborador.', 'interno não vira papel de parceiro por aqui');
select throws_ok(format('select public.equipe_definir_papel(%L, %L)', pg_temp.usuario('titular_c1'), 'colaborador'), 'P0001',
                 'Só é possível trocar entre Admin, Super e Colaborador.', 'cliente do portal não vira interno');
select throws_ok($$select public.equipe_definir_papel('a0000000-0000-4000-8000-000000000052', 'admin')$$, 'P0001',
                 'Perfil inativado não pode receber papel com acesso.', 'perfil inativado não recebe papel com acesso');
select lives_ok($$select public.equipe_definir_papel('a0000000-0000-4000-8000-000000000051', 'admin')$$,
                'Super promove colaborador a admin');
select lives_ok(format('select public.equipe_definir_papel(%L, %L)', pg_temp.usuario('admin'), 'super'),
                'Super promove admin a Super');
select pg_temp.sair();
select is((select array_agg(pr.papel::text order by pr.id) from public.profiles pr
            where pr.id in (pg_temp.usuario('admin'), 'a0000000-0000-4000-8000-000000000051')),
          array['super', 'admin'], 'papéis gravados');
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.categoria = 'seguranca' and a.acao = 'editar' and a.entidade = 'profiles'
             and a.entidade_id = pg_temp.usuario('admin')::text and a.campos = array['papel']
             and a.antes = '{"papel":"admin"}' and a.depois = '{"papel":"super"}' and a.ator_id = pg_temp.usuario('super')), 1,
          'troca de papel auditada (seguranca) com antes e depois');
select pg_temp.entrar('super');
select lives_ok(format('select public.equipe_definir_papel(%L, %L)', pg_temp.usuario('super'), 'admin'),
                'com outro Super ativo, o Super pode deixar de ser Super');
select pg_temp.entrar('admin');
select throws_ok(format('select public.equipe_definir_papel(%L, %L)', pg_temp.usuario('admin'), 'colaborador'), 'P0001',
                 'ULTIMO_SUPER', 'o último Super não deixa de ser Super (ULTIMO_SUPER)');
select lives_ok(format('select public.equipe_definir_papel(%L, %L)', pg_temp.usuario('admin'), 'super'),
                'mesmo papel: nada muda, sem erro');
select pg_temp.sair();
select is((select count(*)::int from public.profiles where papel = 'super' and inativado_em is null), 1, 'continua havendo um Super');

-- ============ painel_resumo (por papel e escopo, sem auditoria) ============
-- volta ao estado da fixture: 'admin' é admin e 'super' é Super
update public.profiles set papel = 'admin' where id = pg_temp.usuario('admin');
update public.profiles set papel = 'super' where id = pg_temp.usuario('super');
insert into public.cliente_tarefas (cliente_id, titulo, responsavel_id, prazo) values
  (pg_temp.cliente('c1'), 'Ligar', pg_temp.usuario('ca1a'), current_date - 3),
  (pg_temp.cliente('c2'), 'Ligar', pg_temp.usuario('ca2a'), current_date + 3);
insert into public.leads (nome, telefone) values ('Lead Site', '11999990000');
-- contratos, imóveis e propostas em escopos diferentes (WP6R-03). Cadeias da fixture: c1 CA1a/GA1/A, c2 CA2a/GA2/A,
-- c3 CB1a/GB1/B. Contratos: c1 rascunho e assinado (+ um inativado), c2 aguardando assinatura, c3 em análise.
insert into public.unidades (id, empreendimento_id, identificador, valor)
select u.id, (select e.id from public.empreendimentos e order by e.slug limit 1), u.ident, 400000
from (values ('f6200000-0000-4000-8000-000000000201'::uuid, 'PAINEL 01'), ('f6200000-0000-4000-8000-000000000202'::uuid, 'PAINEL 02'),
             ('f6200000-0000-4000-8000-000000000203'::uuid, 'PAINEL 03'), ('f6200000-0000-4000-8000-000000000204'::uuid, 'PAINEL 04'),
             ('f6200000-0000-4000-8000-000000000205'::uuid, 'PAINEL 05')) as u(id, ident);
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, pdf_assinado_path, assinado_em, enviado_assinatura_em, inativado_em)
select k.id, pg_temp.cliente(k.cli), public.modelo_vigente_id('parcelado'), 'parcelado', k.status::public.status_contrato,
       k.unidade, public.parametros_vigente_id(), 400000, 30, 120000, 20000, 100000, 280000, 60, 8.5, 1808.33, 108500,
       case when k.status = 'assinado' then k.id::text || '/assinado-0123abcd.pdf' end,
       case when k.status = 'assinado' then now() end,
       case when k.status in ('assinatura_pendente', 'assinado') then now() end,
       case when k.inativo then now() end
from (values
  ('f6200000-0000-4000-8000-000000000401'::uuid, 'c1', 'rascunho', 'f6200000-0000-4000-8000-000000000201'::uuid, false),
  ('f6200000-0000-4000-8000-000000000402'::uuid, 'c1', 'assinado', 'f6200000-0000-4000-8000-000000000202'::uuid, false),
  ('f6200000-0000-4000-8000-000000000403'::uuid, 'c2', 'assinatura_pendente', 'f6200000-0000-4000-8000-000000000203'::uuid, false),
  ('f6200000-0000-4000-8000-000000000404'::uuid, 'c3', 'em_analise', 'f6200000-0000-4000-8000-000000000204'::uuid, false),
  ('f6200000-0000-4000-8000-000000000405'::uuid, 'c1', 'rascunho', 'f6200000-0000-4000-8000-000000000205'::uuid, true)
) as k(id, cli, status, unidade, inativo);
-- imóveis (E4): rascunho do CA1a; dois rascunhos do CB1a (imobiliária B); aprovado do CB1a (visível a todo parceiro
-- aprovado); pendente criado pelo admin (só internos); aprovado do CA1a inativado (ninguém conta)
insert into public.imoveis (id, nome, tipo, status, cep, uf, cidade, logradouro, numero, valor, criado_por, inativado_em)
select v.id::uuid, v.nome, 'casa', v.status::public.status_imovel, '01310100', 'SP', 'São Paulo', 'Avenida Paulista', '1000',
       850000, pg_temp.usuario(v.quem), case when v.inativo then now() end
from (values
  ('f6200000-0000-4000-8000-000000000501', 'Painel rascunho CA1a', 'rascunho', 'ca1a', false),
  ('f6200000-0000-4000-8000-000000000502', 'Painel rascunho CB1a 1', 'rascunho', 'cb1a', false),
  ('f6200000-0000-4000-8000-000000000503', 'Painel rascunho CB1a 2', 'rascunho', 'cb1a', false),
  ('f6200000-0000-4000-8000-000000000504', 'Painel aprovado CB1a', 'aprovado', 'cb1a', false),
  ('f6200000-0000-4000-8000-000000000505', 'Painel pendente admin', 'pendente', 'admin', false),
  ('f6200000-0000-4000-8000-000000000506', 'Painel aprovado inativado', 'aprovado', 'ca1a', true)
) as v(id, nome, status, quem, inativo);
-- propostas: c1 pelo CA1a (enviada), sem cliente pelo CA1a (aprovada: cadeia do autor), c2 pelo CA2a (recusada),
-- c3 pelo CB1a (em análise)
insert into public.propostas (id, parceiro_id, empreendimento_id, cliente_id, texto, status)
select v.id::uuid, pg_temp.usuario(v.quem), (select e.id from public.empreendimentos e order by e.slug limit 1),
       case when v.cli is not null then pg_temp.cliente(v.cli) end, 'Proposta do painel', v.status::public.status_proposta
from (values
  ('f6200000-0000-4000-8000-000000000601', 'ca1a', 'c1', 'enviada'),
  ('f6200000-0000-4000-8000-000000000602', 'ca1a', null, 'aprovada'),
  ('f6200000-0000-4000-8000-000000000603', 'ca2a', 'c2', 'recusada'),
  ('f6200000-0000-4000-8000-000000000604', 'cb1a', 'c3', 'em_analise')
) as v(id, quem, cli, status);
create temp table t_pn on commit drop as select coalesce(max(id), 0) as auditoria from public.auditoria;
grant select on t_pn to authenticated;

select pg_temp.entrar('ca1a');
create temp table t_ca1a on commit drop as select public.painel_resumo() as r;
select pg_temp.entrar('ga1');
create temp table t_ga1 on commit drop as select public.painel_resumo() as r;
select pg_temp.entrar('ia');
create temp table t_ia on commit drop as select public.painel_resumo() as r;
select pg_temp.entrar('cb1a');
create temp table t_cb1a on commit drop as select public.painel_resumo() as r;
select pg_temp.entrar('admin');
create temp table t_adm on commit drop as select public.painel_resumo() as r;
select pg_temp.entrar('bloqueado');
create temp table t_bloq on commit drop as select public.painel_resumo() as r;
select pg_temp.entrar('titular_c1');
create temp table t_tit on commit drop as select public.painel_resumo() as r;
select pg_temp.sair();

select is((select array_agg(k order by k) from t_adm, jsonb_object_keys(r) k),
          array['contratos', 'crm', 'duplicidades_pendentes', 'empreendimentos', 'imoveis', 'leads', 'migracao_pendencias',
                'papel', 'propostas', 'rede'], 'formato PainelResumo');
select is((select (r -> 'crm' ->> 'total')::int from t_ca1a), 1, 'corretor: só o cliente dele (c1)');
select is((select (r -> 'crm' ->> 'tarefas_atrasadas')::int from t_ca1a), 1, 'corretor: tarefa atrasada do c1');
select is((select (r -> 'crm' -> 'por_etapa' ->> 'novo_contato')::int from t_ca1a), 1, 'contagem por etapa');
select ok((select r -> 'rede' = 'null'::jsonb and r -> 'leads' = 'null'::jsonb and r -> 'duplicidades_pendentes' = 'null'::jsonb
                  and r -> 'migracao_pendencias' = 'null'::jsonb and r ->> 'papel' = 'corretor' from t_ca1a),
          'corretor: sem rede, leads, duplicidades e migração (seções nulas)');
select ok((select r -> 'empreendimentos' ? 'publicados' and r -> 'propostas' -> 'por_status' ? 'enviada' from t_ca1a),
          'corretor: empreendimentos e propostas');
select is((select (r -> 'crm' ->> 'total')::int from t_ga1), 3, 'gerente GA1: c1, c4 e c5 (equipe e A1)');
select is((select r -> 'rede' from t_ga1), '{"imobiliarias":1,"gerentes":1,"corretores":2,"autocadastros_pendentes":null}'::jsonb,
          'gerente: os corretores ativos da equipe (sem o inativo)');
select is((select (r -> 'crm' ->> 'total')::int from t_ia), 4, 'imobiliária A: c1, c2, c4 e c5 (não o c3 da B)');
select is((select r -> 'rede' from t_ia), '{"imobiliarias":1,"gerentes":2,"corretores":3,"autocadastros_pendentes":null}'::jsonb,
          'imobiliária: gerentes e corretores dela');
select is((select (r -> 'crm' ->> 'total')::int from t_adm), (select count(*)::int from public.clientes where inativado_em is null),
          'admin: todos os clientes ativos');
select is((select (r -> 'rede' ->> 'autocadastros_pendentes')::int from t_adm), 1, 'admin: autocadastros pendentes');
select is((select (r -> 'leads' ->> 'novos')::int from t_adm), (select count(*)::int from public.leads where status = 'novo'),
          'admin: leads novos');
select ok((select r -> 'duplicidades_pendentes' <> 'null'::jsonb and r -> 'migracao_pendencias' <> 'null'::jsonb from t_adm),
          'admin: duplicidades e pendências da migração');
select ok((select r -> 'crm' = 'null'::jsonb and r -> 'empreendimentos' = 'null'::jsonb and r -> 'propostas' = 'null'::jsonb
                  and r -> 'imoveis' = 'null'::jsonb and r -> 'contratos' = 'null'::jsonb from t_bloq),
          'parceiro bloqueado: tudo nulo');
-- contratos, imóveis e propostas no escopo de cada papel (WP6R-03)
select is((select r -> 'contratos' -> 'por_status' from t_ca1a), '{"rascunho":1,"assinado":1}'::jsonb,
          'corretor: só os contratos ativos do cliente dele (nem os da equipe de outro gerente, nem os da imobiliária B)');
select is((select r -> 'contratos' -> 'por_status' from t_ga1), '{"rascunho":1,"assinado":1}'::jsonb,
          'gerente: contratos dos clientes da equipe');
select is((select r -> 'contratos' -> 'por_status' from t_ia), '{"rascunho":1,"assinado":1,"assinatura_pendente":1}'::jsonb,
          'imobiliária A: contratos dos clientes dela (não o da B)');
select is((select r -> 'contratos' -> 'por_status' from t_cb1a), '{"em_analise":1}'::jsonb,
          'corretor da imobiliária B: só o contrato do cliente dele');
select is((select r -> 'contratos' -> 'por_status' from t_adm),
          (select jsonb_object_agg(s.status, s.n) from (select k.status, count(*) as n from public.contratos k
                                                         where k.inativado_em is null group by k.status) s),
          'admin: todos os contratos ativos');
select is((select r -> 'imoveis' -> 'por_status' from t_ca1a), '{"rascunho":1,"aprovado":1}'::jsonb,
          'corretor: o próprio rascunho e o aprovado (E4); nem o rascunho de outro, nem o pendente interno, nem o inativado');
select is((select r -> 'imoveis' -> 'por_status' from t_ga1), '{"rascunho":1,"aprovado":1}'::jsonb,
          'gerente: o rascunho do corretor da equipe e o aprovado');
select is((select r -> 'imoveis' -> 'por_status' from t_ia), '{"rascunho":1,"aprovado":1}'::jsonb,
          'imobiliária A: os da imobiliária e o aprovado (não os rascunhos da B)');
select is((select r -> 'imoveis' -> 'por_status' from t_cb1a), '{"rascunho":2,"aprovado":1}'::jsonb,
          'corretor da B: os próprios rascunhos e o aprovado');
select is((select r -> 'imoveis' -> 'por_status' from t_adm),
          (select jsonb_object_agg(s.status, s.n) from (select i.status, count(*) as n from public.imoveis i
                                                         where i.inativado_em is null group by i.status) s),
          'admin: todos os imóveis ativos (inclusive o pendente interno)');
select is((select r -> 'propostas' -> 'por_status' from t_ca1a),
          '{"enviada":1,"em_analise":0,"aprovada":1,"recusada":0}'::jsonb,
          'corretor: a proposta do cliente dele e a própria sem cliente');
select is((select r -> 'propostas' -> 'por_status' from t_ga1),
          '{"enviada":1,"em_analise":0,"aprovada":1,"recusada":0}'::jsonb, 'gerente: propostas da equipe');
select is((select r -> 'propostas' -> 'por_status' from t_ia),
          '{"enviada":1,"em_analise":0,"aprovada":1,"recusada":1}'::jsonb, 'imobiliária A: propostas das duas equipes (não a da B)');
select is((select r -> 'propostas' -> 'por_status' from t_cb1a),
          '{"enviada":0,"em_analise":1,"aprovada":0,"recusada":0}'::jsonb, 'corretor da B: só a dele');
select is((select r -> 'propostas' -> 'por_status' from t_adm),
          (select jsonb_build_object('enviada', count(*) filter (where p.status = 'enviada'),
                                     'em_analise', count(*) filter (where p.status = 'em_analise'),
                                     'aprovada', count(*) filter (where p.status = 'aprovada'),
                                     'recusada', count(*) filter (where p.status = 'recusada')) from public.propostas p),
          'admin: todas as propostas');
select ok((select r -> 'crm' = 'null'::jsonb and r -> 'rede' = 'null'::jsonb and r ->> 'papel' = 'cliente' from t_tit),
          'titular do portal: tudo nulo');
select pg_temp.entrar_anon();
select throws_ok($$select public.painel_resumo()$$, '42501', null, 'anon não executa painel_resumo');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_pn)), 0,
          'painel_resumo não grava auditoria (só agregados)');

-- ============ tarefas do pg_cron: sem grant ============
select pg_temp.entrar('super');
select throws_ok($$select public.auditoria_purgar()$$, '42501', null, 'nem o Super executa auditoria_purgar');
select throws_ok($$select public.notificacoes_reenviar()$$, '42501', null, 'nem notificacoes_reenviar');
select throws_ok($$select public.limpar_temporarios()$$, '42501', null, 'nem limpar_temporarios');
select throws_ok($$select public._cron_d4sign_reconciliar()$$, '42501', null, 'nem _cron_d4sign_reconciliar');
select pg_temp.entrar_servico();
select throws_ok($$select public.auditoria_purgar()$$, '42501', null, 'nem a service_role executa auditoria_purgar');
select pg_temp.sair();
select is((select array_agg(jobname || ' ' || schedule order by jobname) from cron.job where jobname like 'arken-%'),
          array['arken-auditoria-purgar 30 3 1 * *', 'arken-cron-historico 30 4 1 * *', 'arken-d4sign-reconciliar 7 * * * *',
                'arken-limpar-temporarios 0 4 1 * *', 'arken-notificacoes-fila */10 * * * *'],
          'pg_cron: cinco tarefas nos horários previstos');
select is((select command from cron.job where jobname = 'arken-notificacoes-fila'), 'select public.notificacoes_reenviar()',
          'a fila chama notificacoes_reenviar');
select ok((select bool_and(username = 'postgres' and active) from cron.job where jobname like 'arken-%'),
          'as tarefas rodam como postgres e estão ativas');

-- ============ auditoria_purgar (H3 ⚑) ============
insert into public.auditoria (ocorrido_em, categoria, acao, entidade, detalhe) values
  (now() - interval '25 months', 'acesso', 'consultar', 'purga_teste', '{"n":1}'),
  (now() - interval '23 months', 'acesso', 'consultar', 'purga_teste', '{"n":2}'),
  (now() - interval '61 months', 'operacao', 'editar', 'purga_teste', '{"n":3}'),
  (now() - interval '59 months', 'lgpd', 'anonimizar', 'purga_teste', '{"n":4}');
insert into public.integracao_chamadas (provedor, operacao, criado_em) values
  ('d4sign', 'status', now() - interval '13 months'), ('d4sign', 'status', now() - interval '11 months');
insert into public.portal_acessos (cliente_id, sucesso, created_at) values
  (pg_temp.cliente('c1'), true, now() - interval '25 months'), (pg_temp.cliente('c1'), true, now() - interval '1 month');
insert into public.tentativas_publicas (rota, sucesso, criado_em) values
  ('pre-cadastro', false, now() - interval '91 days'), ('pre-cadastro', false, now() - interval '1 day');
insert into public.download_autorizacoes (profile_id, bucket, path, expira_em, criado_em) values
  (pg_temp.usuario('ca1a'), 'contratos', 'x/vencida.pdf', now() - interval '1 day', now() - interval '2 days'),
  (pg_temp.usuario('ca1a'), 'contratos', 'x/valida.pdf', now() + interval '1 minute', now());
select lives_ok($$select public.auditoria_purgar()$$, 'purga roda como postgres (pg_cron)');
select is((select array_agg((detalhe ->> 'n')::int order by (detalhe ->> 'n')::int) from public.auditoria where entidade = 'purga_teste'),
          array[2, 4], 'apaga acesso > 24 meses e demais > 60 meses; mantém o resto');
select is((select count(*)::int from public.integracao_chamadas where operacao = 'status'), 1, 'integracao_chamadas > 12 meses apagadas');
select is((select count(*)::int from public.portal_acessos where cliente_id = pg_temp.cliente('c1')), 1, 'portal_acessos > 24 meses apagados');
select is((select count(*)::int from public.tentativas_publicas where rota = 'pre-cadastro'), 1, 'tentativas > 90 dias apagadas');
select is((select array_agg(path) from public.download_autorizacoes where profile_id = pg_temp.usuario('ca1a')), array['x/valida.pdf'],
          'autorizações de download vencidas apagadas');
select ok((select (detalhe ->> 'auditoria_acesso')::int = 1 and (detalhe ->> 'auditoria_demais')::int = 1
                  and (detalhe ->> 'integracao_chamadas')::int = 1 and origem = 'cron' and categoria = 'operacao'
           from public.auditoria where acao = 'purgar' order by id desc limit 1),
          'a purga fica registrada (origem cron) com as contagens');
select throws_ok($$delete from public.auditoria where entidade = 'purga_teste'$$, '42501', 'Auditoria é somente inclusão',
                 'depois da purga a guarda volta a valer na mesma transação');
select throws_ok($$delete from public.integracao_chamadas$$, '42501', null, 'e a de integracao_chamadas também');
select pg_temp.entrar('super');
select throws_ok($$delete from public.auditoria$$, '42501', null,
                 'pela API ninguém apaga auditoria (sem grant)');
select pg_temp.sair();

-- limpar_temporarios
insert into public.download_autorizacoes (profile_id, bucket, path, expira_em, criado_em) values
  (pg_temp.usuario('ca1a'), 'contratos', 'x/vencida2.pdf', now() - interval '1 minute', now() - interval '2 minutes');
select lives_ok($$select public.limpar_temporarios()$$, 'limpar_temporarios roda como postgres');
select is((select count(*)::int from public.download_autorizacoes where path = 'x/vencida2.pdf'), 0, 'autorização vencida apagada');
select is((select count(*)::int from public.download_autorizacoes where path = 'x/valida.pdf'), 1, 'a vigente fica');

-- ============ fila de e-mails e D4Sign: sem segredos no Vault, nada sai ============
insert into public.notificacoes (tipo, destinatarios_ids, cliente_id, status, tentativas, criado_em, reservado_em) values
  ('crm.boas_vindas', '{}', pg_temp.cliente('c1'), 'pendente', 0, now() - interval '1 hour', null),
  ('crm.boas_vindas', '{}', pg_temp.cliente('c1'), 'erro', 2, now() - interval '1 hour', null),
  ('crm.boas_vindas', '{}', pg_temp.cliente('c1'), 'pendente', 0, now(), null),
  ('crm.boas_vindas', '{}', pg_temp.cliente('c1'), 'erro', 5, now() - interval '1 hour', null),
  ('crm.boas_vindas', '{}', pg_temp.cliente('c1'), 'pendente', 1, now() - interval '1 hour', now() - interval '1 minute'),
  ('crm.boas_vindas', '{}', pg_temp.cliente('c1'), 'pendente', 1, now() - interval '1 hour', now() - interval '20 minutes'),
  ('crm.boas_vindas', '{}', pg_temp.cliente('c1'), 'ignorado', 0, now() - interval '1 hour', null);
create temp table t_net on commit drop as select coalesce(max(id), 0) as id from net.http_request_queue;
select lives_ok($$select public.notificacoes_reenviar()$$, 'fila sem notificar_url no Vault: roda sem erro');
select lives_ok($$select public._cron_d4sign_reconciliar()$$, 'D4Sign sem d4sign_reconciliar_url no Vault: roda sem erro');
select is((select count(*)::int from net.http_request_queue where id > (select id from t_net)), 0,
          'sem os segredos do Vault nenhuma chamada sai');
-- com os segredos: a fila reenvia só pendente/erro, < 5 tentativas, criados há mais de 2 min e sem reserva recente
do $$ begin
  perform vault.create_secret('http://127.0.0.1:9/notificar', 'notificar_url');
  perform vault.create_secret('segredo-de-teste-1234567890', 'notificar_secret');
  perform vault.create_secret('http://127.0.0.1:9/d4sign-reconciliar', 'd4sign_reconciliar_url');
  perform vault.create_secret('segredo-cron-1234567890', 'cron_segredo');
end $$;
select lives_ok($$select public.notificacoes_reenviar()$$, 'fila com os segredos');
select is((select count(*)::int from net.http_request_queue where id > (select id from t_net) and url = 'http://127.0.0.1:9/notificar'), 3,
          'reenvia só as 3 elegíveis (pendente antigo, erro com 2 tentativas, reserva vencida)');
select ok((select bool_and(headers ->> 'x-webhook-secret' = 'segredo-de-teste-1234567890'
                           and convert_from(body, 'utf8')::jsonb ->> 'tabela' = 'notificacoes')
           from net.http_request_queue where id > (select id from t_net) and url = 'http://127.0.0.1:9/notificar'),
          'com o segredo do webhook e tabela = notificacoes');
select lives_ok($$select public._cron_d4sign_reconciliar()$$, 'reconciliação com os segredos');
select ok((select count(*) = 1 and bool_and(headers ->> 'x-cron-secret' = 'segredo-cron-1234567890')
           from net.http_request_queue where id > (select id from t_net) and url = 'http://127.0.0.1:9/d4sign-reconciliar'),
          'chama a Edge d4sign-reconciliar com o x-cron-secret');

select * from finish();
rollback;
