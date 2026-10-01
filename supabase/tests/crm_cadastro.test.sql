-- CRM: cadastro, ficha, lista, duplicidades, leads, propostas e pré-cadastro [WP2]
-- (docs/ARQUITETURA_EXPANSAO.md §1.1 A1/A2/N9/N12, §3.4, §3.5, §4.4, §4.5, §4.6, §5.4, §6.1, §8.5).
-- A2 dentro e depois do prazo (datas simuladas): 'indisponivel' sem dono (a regra por atividade e a transferência depois do prazo estão em exclusividade.test.sql); mesmo dono →
-- 'ja_na_sua_carteira'; limite por hora (conferido antes de olhar o documento); crm_ficha grava acesso/consultar com
-- cliente_id e a negação devolve nulo e grava acesso_negado; a lista grava os ids e não o texto da busca; pré-cadastro
-- cria NC, 4 documentos, consentimento e portal_liberado=false; conversão de lead. Cada RPC: negada fora do escopo
-- (42501) e auditada. Dados como postgres (fixture comum + o que está abaixo); só as RPCs deste pacote são chamadas.
-- Correções da revisão: trava do limite por usuário (chamadas simultâneas), limite por link no pré-cadastro, a mesma
-- fila de e-mail para criado e duplicado (§6.1), fila de duplicidades sem transferir dentro da exclusividade, listas
-- grandes recusadas pelo tamanho e termo desatualizado separado de termo sem revisão.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(237);

-- ============ AJUDANTES DESTE TESTE ============
-- CPF válido a partir de 9 dígitos (mesma regra de public.cpf_valido)
create function pg_temp.cpf(p_base bigint) returns text language plpgsql immutable as $$
declare
  b text := lpad(p_base::text, 9, '0');
  s int := 0;
  d1 int;
  d2 int;
  i int;
begin
  for i in 1 .. 9 loop s := s + substr(b, i, 1)::int * (11 - i); end loop;
  d1 := (s * 10) % 11;
  if d1 = 10 then d1 := 0; end if;
  s := 0;
  for i in 1 .. 9 loop s := s + substr(b, i, 1)::int * (12 - i); end loop;
  s := s + d1 * 2;
  d2 := (s * 10) % 11;
  if d2 = 10 then d2 := 0; end if;
  return b || d1 || d2;
end $$;

-- termo vigente de consentimento_cliente, lido como postgres (a função interna não tem grant) e trocado quando o teste
-- publica a versão revisada
create temp table t_termo as select public._termo_vigente_id('consentimento_cliente') as id;
grant select on t_termo to authenticated, anon, service_role;
create function pg_temp.termo() returns uuid language sql as $$ select id from t_termo $$;

create function pg_temp.pf(p_nome text, p_cpf text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('tipo_pessoa', 'fisica', 'nome', p_nome, 'cpf', p_cpf, 'telefone', '11988887777') || p_extra
$$;

-- cadastro com o termo vigente; devolve o jsonb do resultado
create function pg_temp.cadastrar(p_nome text, p_cpf text, p_corretor uuid default null) returns jsonb language sql as $$
  select public.crm_cadastrar_cliente(pg_temp.pf(p_nome, p_cpf), p_corretor, pg_temp.termo())
$$;

-- security definer: os ajudantes também são chamados na sessão do usuário (authenticated não lê clientes de parceiro)
create function pg_temp.cli_cpf(p_cpf text) returns uuid language sql security definer as $$
  select c.id from public.clientes c where c.cpf = p_cpf
$$;
create function pg_temp.cli_cnpj(p_cnpj text) returns uuid language sql security definer as $$
  select c.id from public.clientes c where c.cnpj = p_cnpj
$$;

create function pg_temp.aud(p_acao text, p_entidade text, p_cliente uuid, p_ator text) returns int language sql as $$
  select count(*)::int from public.auditoria a
  where a.acao = p_acao and a.entidade = p_entidade and a.cliente_id is not distinct from p_cliente
    and a.ator_id = pg_temp.usuario(p_ator)
$$;

create function pg_temp.dup(p_cliente uuid, p_resultado text) returns int language sql as $$
  select count(*)::int from public.cliente_duplicidades d where d.cliente_id = p_cliente and d.resultado = p_resultado
$$;

create function pg_temp.eventos(p_cliente uuid, p_tipo text) returns int language sql as $$
  select count(*)::int from public.cliente_eventos e where e.cliente_id = p_cliente and e.tipo = p_tipo
$$;

-- trava consultiva de duas chaves (int4, int4) segurada por esta sessão; pg_locks mostra as chaves como oid (sem sinal)
create function pg_temp.trava(p_espaco text, p_chave text) returns boolean language sql as $$
  select exists (select 1 from pg_catalog.pg_locks l
                 where l.locktype = 'advisory' and l.pid = pg_catalog.pg_backend_pid() and l.objsubid = 2 and l.granted
                   and l.classid = ((hashtext(p_espaco)::bigint + 4294967296) % 4294967296)::oid
                   and l.objid = ((hashtext(p_chave)::bigint + 4294967296) % 4294967296)::oid)
$$;

-- fila do pré-cadastro que sairia para o e-mail DIGITADO (sem destinatário de perfil, não ignorada) desde uma marca,
-- com o aviso resolvido; o id do aviso fica de fora (é o único dado que muda entre duas chamadas iguais)
create temp table t_fila (marca bigint);
insert into t_fila values (0);
create temp table t_relogio (inicio timestamptz);
insert into t_relogio values (clock_timestamp());
grant select, update on t_relogio to authenticated;
create function pg_temp.marcar_fila() returns void language sql as $$
  update t_fila set marca = (select coalesce(max(n.id), 0) from public.notificacoes n)
$$;
create function pg_temp.fila_visitante() returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('tipo', n.tipo, 'destinatarios', n.destinatarios_ids, 'cliente_id', n.cliente_id,
           'status', n.status, 'dados', n.dados - 'aviso_id', 'email', a.email, 'primeiro_nome', a.primeiro_nome,
           'parceiro_id', a.parceiro_id, 'portal', a.portal) order by n.tipo, n.id), '[]'::jsonb)
  from public.notificacoes n left join public.pre_cadastro_avisos a on a.id::text = n.dados ->> 'aviso_id'
  where n.id > (select marca from t_fila) and n.destinatarios_ids = '{}' and n.status <> 'ignorado'
$$;

-- ============ DADOS DESTE TESTE (como postgres) ============
-- c1 dentro da exclusividade; contrato em rascunho para c2; empreendimento publicado com duas unidades
update public.clientes set exclusividade_ate = now() + interval '30 days' where id = pg_temp.cliente('c1');
insert into public.empreendimentos (id, slug, nome, publicado) values
  ('e2000000-0000-4000-8000-000000000001', 'wp2-residencial', 'Residencial WP2', true),
  ('e2000000-0000-4000-8000-000000000002', 'wp2-rascunho', 'Rascunho WP2', false);
insert into public.unidades (id, empreendimento_id, identificador, valor, status) values
  ('e2000000-0000-4000-8000-000000000011', 'e2000000-0000-4000-8000-000000000001', 'APTO 11', 400000, 'disponivel'),
  ('e2000000-0000-4000-8000-000000000012', 'e2000000-0000-4000-8000-000000000001', 'APTO 12', 400000, 'vendida'),
  ('e2000000-0000-4000-8000-000000000013', 'e2000000-0000-4000-8000-000000000001', 'APTO 13', 500000, 'disponivel');
insert into public.contratos (cliente_id, modelo_id, forma_pagamento, status, parametros_id, valor_imovel, perc_aporte,
  valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte, valor_parcela, valor_total_parcelas,
  unidade_id)
select pg_temp.cliente('c2'), public.modelo_vigente_id('parcelado'), 'parcelado', 'rascunho', public.parametros_vigente_id(),
       500000, 30, 150000, 50000, 100000, 350000, 60, 8.5, 1808.33, 108500, 'e2000000-0000-4000-8000-000000000013';
-- cliente migrado sem CPF (origem que admite CPF nulo), na carteira do CA1a
insert into public.clientes (id, nome, cpf, corretor_id, origem, portal_liberado) values
  ('e2000000-0000-4000-8000-000000000021', 'Migrado Sem CPF', null, pg_temp.parceiro('ca1a'), 'migracao_parceiro_clientes', false);
-- leads do site
insert into public.leads (id, nome, email, telefone, mensagem, empreendimento_id) values
  ('e2000000-0000-4000-8000-000000000031', 'Lead Um', 'lead1@site.test', '(11) 97777-0001', 'quero saber', 'e2000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000032', 'Lead Dois', 'lead2@site.test', '11977770002', null, null),
  ('e2000000-0000-4000-8000-000000000033', 'Lead Spam', null, '11977770003', 'spam', null);

select ok(public.cpf_valido(pg_temp.cpf(900000001)) and public.cpf_valido(pg_temp.cpf(900000123)), 'ajudante: CPF gerado é válido');

-- ============ 1. CADASTRO (crm_cadastrar_cliente) ============
select pg_temp.entrar('ca1a');
select is(pg_temp.cadastrar('Novo Do CA1a', pg_temp.cpf(900000001)) ->> 'situacao', 'criado', 'corretor cadastra cliente novo');
select pg_temp.sair();
select ok((select c.corretor_id = pg_temp.parceiro('ca1a') and c.gerente_id = pg_temp.parceiro('ga1')
             and c.imobiliaria_id = pg_temp.imobiliaria('a') and c.etapa = 'novo_contato' and c.origem = 'cadastro_interno'
             and not c.portal_liberado and c.exclusividade_ate between now() + interval '179 days' and now() + interval '181 days'
           from public.clientes c where c.id = pg_temp.cli_cpf(pg_temp.cpf(900000001))),
          'cliente novo: corretor = quem cadastrou, cadeia derivada, NC, cadastro_interno, portal fechado, exclusividade 180 dias');
select ok(exists (select 1 from public.lgpd_consentimentos l where l.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000001))
                    and l.origem = 'declarado' and l.registrado_por = pg_temp.usuario('ca1a') and l.termo_id = pg_temp.termo()),
          'consentimento declarado (N12) com quem registrou e o termo vigente');
select ok(pg_temp.eventos(pg_temp.cli_cpf(pg_temp.cpf(900000001)), 'cadastro') = 1
          and pg_temp.eventos(pg_temp.cli_cpf(pg_temp.cpf(900000001)), 'consentimento') = 1,
          'timeline: cadastro e consentimento');
select ok(pg_temp.aud('criar', 'clientes', pg_temp.cli_cpf(pg_temp.cpf(900000001)), 'ca1a') = 1,
          'auditoria operacao/criar com cliente_id e ator');
select ok(not exists (select 1 from public.auditoria a where a.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000001))
                        and (a::text like '%' || pg_temp.cpf(900000001) || '%' or a::text like '%Novo Do CA1a%'
                             or a::text like '%11988887777%')),
          'auditoria sem valores pessoais (só nomes de campos)');
select ok((select a.campos @> array['cpf', 'nome', 'telefone'] from public.auditoria a
           where a.acao = 'criar' and a.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000001))),
          'auditoria guarda os nomes dos campos preenchidos');

select pg_temp.entrar('ca1a');
select is((pg_temp.erro($$select pg_temp.cadastrar('Forjado', pg_temp.cpf(900000002), pg_temp.parceiro('ca2a'))$$)) ->> 'sqlstate',
          '42501', '§4.5: corretor não cadastra para outro corretor');
select is((pg_temp.erro($$select pg_temp.cadastrar('Forjado', pg_temp.cpf(900000002), pg_temp.parceiro('cb1a'))$$)) ->> 'sqlstate',
          '42501', 'corretor não cadastra para corretor de outra imobiliária');
select is(public.crm_cadastrar_cliente(
            pg_temp.pf('Chaves Ignoradas', pg_temp.cpf(900000003),
                       jsonb_build_object('etapa', 'finalizado', 'portal_liberado', true, 'corretor_id', pg_temp.parceiro('cb1a'),
                                          'origem', 'importacao', 'gerente_id', pg_temp.parceiro('gb1'))),
            null, pg_temp.termo()) ->> 'situacao', 'criado', 'chaves fora da lista são ignoradas');
select pg_temp.sair();
select ok((select c.etapa = 'novo_contato' and not c.portal_liberado and c.corretor_id = pg_temp.parceiro('ca1a')
             and c.gerente_id = pg_temp.parceiro('ga1') and c.origem = 'cadastro_interno'
           from public.clientes c where c.cpf = pg_temp.cpf(900000003)),
          'etapa, portal, cadeia e origem nunca vêm do front');

-- gerente: para o seu corretor, para si (A1); nunca para outra equipe
select pg_temp.entrar('ga1');
select is(pg_temp.cadastrar('Do GA1 para CA1a', pg_temp.cpf(900000004), pg_temp.parceiro('ca1a')) ->> 'situacao', 'criado',
          'gerente cadastra para o seu corretor');
select is(pg_temp.cadastrar('Do GA1 para si', pg_temp.cpf(900000005)) ->> 'situacao', 'criado', 'gerente cadastra para si (A1)');
select is((pg_temp.erro($$select pg_temp.cadastrar('GA1 invade', pg_temp.cpf(900000006), pg_temp.parceiro('ca2a'))$$)) ->> 'sqlstate',
          '42501', 'gerente não cadastra para corretor de outra equipe');
select pg_temp.sair();
select ok((select c.corretor_id = pg_temp.parceiro('ca1a') from public.clientes c where c.cpf = pg_temp.cpf(900000004))
          and (select c.corretor_id = pg_temp.parceiro('ga1') and c.gerente_id = pg_temp.parceiro('ga1')
               from public.clientes c where c.cpf = pg_temp.cpf(900000005)),
          'A1: o gerente fica como responsável (corretor_id = gerente_id)');

-- imobiliária: escolhe o corretor da imobiliária
select pg_temp.entrar('ia');
select is((pg_temp.erro($$select pg_temp.cadastrar('IA sem corretor', pg_temp.cpf(900000007))$$)) -> 'detalhe',
          '{"campos":["corretor_id"]}'::jsonb, 'imobiliária precisa escolher o corretor');
select is(pg_temp.cadastrar('Da IA para CA2a', pg_temp.cpf(900000008), pg_temp.parceiro('ca2a')) ->> 'situacao', 'criado',
          'imobiliária cadastra para corretor dela');
select is((pg_temp.erro($$select pg_temp.cadastrar('IA invade', pg_temp.cpf(900000009), pg_temp.parceiro('cb1a'))$$)) ->> 'sqlstate',
          '42501', 'imobiliária não cadastra para corretor de outra imobiliária');

-- interno: padrão Carteira Arken; destino inativo ou bloqueado recusado
select pg_temp.entrar('admin');
select is(pg_temp.cadastrar('Do Admin', pg_temp.cpf(900000010)) ->> 'situacao', 'criado', 'interno cadastra (padrão: Carteira Arken)');
select is((pg_temp.erro($$select pg_temp.cadastrar('Para inativo', pg_temp.cpf(900000011), pg_temp.parceiro('inativo'))$$)) ->> 'mensagem',
          'DESTINO_INVALIDO', 'destino inativo recusado');
select is((pg_temp.erro($$select pg_temp.cadastrar('Para bloqueado', pg_temp.cpf(900000011), pg_temp.parceiro('bloqueado'))$$)) ->> 'mensagem',
          'DESTINO_INVALIDO', 'destino bloqueado recusado (mantém a carteira, não recebe cliente novo)');
select pg_temp.sair();
select is((select c.corretor_id from public.clientes c where c.cpf = pg_temp.cpf(900000010)),
          (select g.corretor_casa_id from public.configuracao_geral g), 'sem corretor escolhido, o interno cadastra na Carteira Arken');

-- sem vínculo: bloqueado, pendente, titular, anon
select pg_temp.entrar('bloqueado');
select is((pg_temp.erro($$select pg_temp.cadastrar('X', pg_temp.cpf(900000012))$$)) ->> 'sqlstate', '42501', 'bloqueado não cadastra');
select pg_temp.entrar('pendente');
select is((pg_temp.erro($$select pg_temp.cadastrar('X', pg_temp.cpf(900000012))$$)) ->> 'sqlstate', '42501', 'pendente não cadastra');
select pg_temp.entrar('titular_c1');
select is((pg_temp.erro($$select pg_temp.cadastrar('X', pg_temp.cpf(900000012))$$)) ->> 'sqlstate', '42501', 'titular do portal não cadastra');
select pg_temp.entrar_anon();
select is((pg_temp.erro($$select public.crm_cadastrar_cliente('{}'::jsonb, null, null)$$)) ->> 'sqlstate', '42501', 'anon não executa');

-- validações
select pg_temp.entrar('ca1a');
select is((pg_temp.erro($$select pg_temp.cadastrar('CPF errado', '12345678900')$$)) -> 'detalhe', '{"campos":["cpf"]}'::jsonb,
          'CPF com DV inválido: DADOS_INVALIDOS {campos:[cpf]}');
select is((pg_temp.erro($$select public.crm_cadastrar_cliente(
             pg_temp.pf('Xavier', pg_temp.cpf(900000013), '{"email":"sem-arroba","uf":"XX","cep":"123","interesses":["Iate"]}'),
             null, pg_temp.termo())$$)) -> 'detalhe' -> 'campos',
          '["email","cep","uf","interesses"]'::jsonb, 'todos os campos inválidos saem juntos');
select is((pg_temp.erro($$select public.crm_cadastrar_cliente(jsonb_build_object('tipo_pessoa', 'juridica', 'nome', 'Empresa',
             'cpf', pg_temp.cpf(900000014), 'cnpj', '11222335000170'), null, pg_temp.termo())$$)) -> 'detalhe',
          '{"campos":["cpf"]}'::jsonb, 'PJ não aceita CPF');
select is((pg_temp.erro($$select public.crm_cadastrar_cliente(pg_temp.pf('Xavier', pg_temp.cpf(900000015)), null, gen_random_uuid())$$)) ->> 'mensagem',
          'TERMO_DESATUALIZADO', 'termo diferente do vigente recusado');
-- listas e corpo grandes: recusados pelo tamanho, antes de percorrer os itens (a remoção de repetidos é quadrática)
select is((pg_temp.erro($$select public.crm_cadastrar_cliente(pg_temp.pf('Lista Grande', pg_temp.cpf(900000016),
             jsonb_build_object('emails_adicionais', (select jsonb_agg('e' || g || '@x.co') from generate_series(1, 11) g),
                                'telefones_adicionais', (select jsonb_agg((1100000000 + g)::text) from generate_series(1, 11) g))),
             null, pg_temp.termo())$$)) -> 'detalhe', '{"campos":["emails_adicionais","telefones_adicionais"]}'::jsonb,
          'mais de 10 e-mails ou telefones adicionais: recusado');
select is((pg_temp.erro($$select public.crm_cadastrar_cliente(pg_temp.pf('Lista Grande', pg_temp.cpf(900000016),
             jsonb_build_object('interesses', (select jsonb_agg('Casa'::text) from generate_series(1, 41) g))), null, pg_temp.termo())$$)) -> 'detalhe',
          '{"campos":["interesses"]}'::jsonb, 'mais de 40 interesses: recusado');
update t_relogio set inicio = clock_timestamp();
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cliente('c1'),
             jsonb_build_object('emails_adicionais', (select jsonb_agg('e' || g || '@x.co') from generate_series(1, 20000) g)))$$)) -> 'detalhe',
          '{"campos":["p_dados"]}'::jsonb, 'corpo acima de 64 KB: recusado');
select ok(clock_timestamp() - (select inicio from t_relogio) < interval '1 second',
          '20.000 e-mails recusados na hora (não prende a conexão até o statement_timeout)');
select is(public.crm_cadastrar_cliente(jsonb_build_object('tipo_pessoa', 'juridica', 'nome', 'Empresa WP2 Ltda',
            'cnpj', '11.222.335/0001-70', 'email', 'CONTATO@EMPRESA.TEST', 'interesses', jsonb_build_array('Terreno', 'Terreno')),
            null, pg_temp.termo()) ->> 'situacao', 'criado', 'PJ com CNPJ (máscara aceita) cadastrada');
select pg_temp.sair();
select ok((select c.tipo_pessoa = 'juridica' and c.cnpj = '11222335000170' and c.cpf is null and c.email = 'contato@empresa.test'
             and c.interesses = array['Terreno'] from public.clientes c where c.cnpj = '11222335000170'),
          'PJ: CNPJ só dígitos, e-mail minúsculo, interesses sem repetição');

-- ============ 2. A2: DUPLICIDADE ============
-- dentro do prazo (c1 com exclusividade até daqui a 30 dias)
select pg_temp.entrar('ca2a');
select is(pg_temp.cadastrar('Tentativa', '12345670916') - 'exclusividade_ate', '{"situacao":"indisponivel","id":null}'::jsonb,
          'A2 dentro do prazo: indisponível, sem dono (só a data da exclusividade, coberta em exclusividade.test.sql)');
select pg_temp.sair();
select ok(exists (select 1 from public.cliente_duplicidades d where d.cliente_id = pg_temp.cliente('c1')
                    and d.resultado = 'bloqueado_exclusividade' and d.tentado_por = pg_temp.usuario('ca2a')
                    and d.tentado_por_parceiro_id = pg_temp.parceiro('ca2a') and d.origem = 'cadastro_interno'),
          'tentativa registrada em cliente_duplicidades (bloqueado_exclusividade)');
select is((select e.dados from public.cliente_eventos e where e.cliente_id = pg_temp.cliente('c1') and e.tipo = 'tentativa_duplicada'),
          '{"resultado":"bloqueado_exclusividade"}'::jsonb, 'o dono vê a tentativa na timeline, sem dado de quem tentou');
select ok(pg_temp.aud('tentativa_duplicada', 'cliente_duplicidades', pg_temp.cliente('c1'), 'ca2a') = 1
          and not exists (select 1 from public.auditoria a where a.acao = 'tentativa_duplicada' and a::text like '%12345670916%'),
          'tentativa auditada, sem o CPF');
-- depois do prazo
update public.clientes set exclusividade_ate = now() - interval '1 day' where id = pg_temp.cliente('c1');
select pg_temp.entrar('ca2a');
select is(pg_temp.cadastrar('Tentativa 2', '12345670916'), '{"situacao":"indisponivel","id":null}'::jsonb,
          'depois do prazo, cliente do portal: continua indisponível (não é tomado, migration 23)');
select pg_temp.sair();
select is(pg_temp.dup(pg_temp.cliente('c1'), 'bloqueado_pos_prazo'), 1, 'depois do prazo: bloqueado_pos_prazo (vai para a fila)');
select is((select c.corretor_id from public.clientes c where c.id = pg_temp.cliente('c1')), pg_temp.parceiro('ca1a'),
          'cliente do portal nunca é tomado (a fila decide)');
-- contrato ativo
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('Tentativa 3', '12345671050') ->> 'situacao', 'indisponivel', 'cliente com contrato: indisponível');
select pg_temp.sair();
select is(pg_temp.dup(pg_temp.cliente('c2'), 'bloqueado_contrato'), 1, 'resultado bloqueado_contrato');
-- mesmo dono
select pg_temp.entrar('ca1a');
select is(pg_temp.cadastrar('Mesmo dono', '12345670916'),
          jsonb_build_object('situacao', 'ja_na_sua_carteira', 'id', pg_temp.cliente('c1')), 'mesmo dono: já na sua carteira (com id)');
select pg_temp.entrar('ga1');
select is(pg_temp.cadastrar('Gerente do dono', '12345670916') ->> 'situacao', 'ja_na_sua_carteira',
          'gerente com o cliente no escopo: já na sua carteira');
select pg_temp.entrar('admin');
select is(pg_temp.cadastrar('Interno', '12345671130') ->> 'id', pg_temp.cliente('c3')::text, 'interno vê tudo: já na sua carteira');
select pg_temp.sair();
select ok(pg_temp.dup(pg_temp.cliente('c1'), 'mesmo_dono') = 2 and pg_temp.eventos(pg_temp.cliente('c1'), 'tentativa_duplicada') = 2,
          'mesmo dono registrado, sem evento de tentativa na timeline');
select is((select count(*)::int from public.clientes c where c.cpf = '12345670916'), 1, 'uma pessoa = um registro');

-- limite por hora (datas simuladas): 3 bloqueios na hora; o 4º é recusado antes de olhar o documento
update public.configuracao_geral set duplicidade_bloqueios_hora = 3;
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('Bloqueio 2', '12345670916') ->> 'situacao', 'indisponivel', 'bloqueio 2 de 3');
select is(pg_temp.cadastrar('Bloqueio 3', '12345671211') ->> 'situacao', 'indisponivel', 'bloqueio 3 de 3');
select is((pg_temp.erro($$select pg_temp.cadastrar('Bloqueio 4', '12345671300')$$)) ->> 'mensagem', 'LIMITE_DUPLICIDADE',
          'acima do limite na hora: LIMITE_DUPLICIDADE');
select is((pg_temp.erro($$select pg_temp.cadastrar('CPF livre', pg_temp.cpf(900000020))$$)) ->> 'mensagem', 'LIMITE_DUPLICIDADE',
          'o limite vale também para CPF livre (não vira oráculo)');
select pg_temp.sair();
select is(pg_temp.cli_cpf(pg_temp.cpf(900000020)), null, 'nada foi criado acima do limite');
-- chamadas simultâneas do mesmo usuário não furam o limite: a contagem vem depois de uma trava consultiva por usuário
-- (segurada até o fim da transação) e enxerga a tentativa gravada pela chamada anterior
select ok(pg_temp.trava('arken.a2.limite.usuario', pg_temp.usuario('cb1a')::text),
          'A2: o limite por hora trava por usuário antes de contar (até o fim da transação)');
select is((select p.provolatile::text from pg_proc p where p.oid = 'public._crmcad_limite_excedido()'::regprocedure), 'v',
          'contagem do limite volatile (vê a tentativa confirmada por quem segurava a trava)');
update public.cliente_duplicidades set ocorrido_em = now() - interval '2 hours' where tentado_por = pg_temp.usuario('cb1a');
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('CPF livre', pg_temp.cpf(900000020)) ->> 'situacao', 'criado', 'bloqueios de mais de uma hora não contam');
select pg_temp.sair();
update public.configuracao_geral set duplicidade_bloqueios_hora = 10;

-- ============ 3. FICHA (crm_ficha) ============
select pg_temp.entrar('ca1a');
select is((public.crm_ficha(pg_temp.cliente('c1')) -> 'cliente' ->> 'cpf'), '12345670916', 'corretor lê a ficha do seu cliente');
select is(public.crm_ficha(pg_temp.cliente('c1')) -> 'cadeia',
          jsonb_build_object('corretor', jsonb_build_object('id', pg_temp.parceiro('ca1a'), 'nome', 'CA1a Corretor'),
                             'gerente', null, 'imobiliaria', null),
          'PAR-3: o corretor não vê gerente nem imobiliária');
select is((select jsonb_agg(d ->> 'para' order by d ->> 'para') from jsonb_array_elements(public.crm_ficha(pg_temp.cliente('c1')) -> 'destinos_etapa') d),
          '["contato_iniciado", "perdido"]'::jsonb, 'destinos de etapa a partir de NC para o papel de quem consulta');
select ok((select bool_and((d ->> 'exige_motivo')::boolean) from jsonb_array_elements(public.crm_ficha(pg_temp.cliente('c1')) -> 'destinos_etapa') d
           where d ->> 'para' = 'perdido'), 'perdido exige motivo');
select is(public.crm_ficha(pg_temp.cliente('c1')) -> 'permissoes' ->> 'ver_portal', 'false', 'parceiro não vê a aba Portal');
select is(public.crm_ficha(pg_temp.cliente('c1')) -> 'cliente' ->> 'tem_login_portal', 'false', 'parceiro não sabe se há login do portal');
select is(public.crm_ficha(pg_temp.cliente('c1')) -> 'permissoes' ->> 'editar_documento', 'false', 'parceiro não troca CPF já preenchido');
select is((public.crm_ficha(pg_temp.cliente('c1')) -> 'consentimentos' -> 0 -> 'registrado_por' ->> 'nome'), 'CA1a Corretor',
          'consentimento com quem registrou');
select pg_temp.sair();
select ok(pg_temp.aud('consultar', 'clientes', pg_temp.cliente('c1'), 'ca1a') >= 1, 'crm_ficha grava acesso/consultar com cliente_id');

select pg_temp.entrar('ca2a');
select is(public.crm_ficha(pg_temp.cliente('c1')), null, '§4.5: fora do escopo devolve nulo');
select is(public.crm_ficha('e2000000-0000-4000-8000-0000000000ff'), null, 'inexistente devolve nulo (mesma resposta)');
select pg_temp.sair();
select ok(pg_temp.aud('acesso_negado', 'clientes', pg_temp.cliente('c1'), 'ca2a') = 1
          and pg_temp.aud('acesso_negado', 'clientes', null, 'ca2a') = 1
          and (select a.entidade_id from public.auditoria a where a.acao = 'acesso_negado' and a.cliente_id is null
                 and a.ator_id = pg_temp.usuario('ca2a')) = 'e2000000-0000-4000-8000-0000000000ff',
          'negação grava acesso_negado com ator e cliente_id (WP7R1-06: id inexistente guarda só o id tentado, sem titular)');

select pg_temp.entrar('ga1');
select is(public.crm_ficha(pg_temp.cliente('c1')) -> 'cadeia' -> 'gerente' ->> 'id', pg_temp.parceiro('ga1')::text,
          'gerente vê a si mesmo na cadeia');
select is(public.crm_ficha(pg_temp.cliente('c1')) -> 'cadeia' -> 'imobiliaria', 'null'::jsonb, 'gerente não vê a imobiliária');
select pg_temp.entrar('ia');
select is(public.crm_ficha(pg_temp.cliente('c1')) -> 'cadeia' -> 'imobiliaria' ->> 'nome', 'Imobiliária A', 'imobiliária vê tudo');
select pg_temp.entrar('admin');
select ok((public.crm_ficha(pg_temp.cliente('c1')) -> 'permissoes' ->> 'ver_portal')::boolean
          and (public.crm_ficha(pg_temp.cliente('c1')) -> 'cliente' ->> 'tem_login_portal')::boolean,
          'interno vê o portal e o login do titular');
select is(jsonb_array_length(public.crm_ficha(pg_temp.cliente('c1')) -> 'historico_vinculos'), 1, 'histórico de vínculos na ficha');
select pg_temp.entrar('bloqueado');
select is(public.crm_ficha(pg_temp.cliente('c5')), null, 'bloqueado não lê nem o próprio cliente');
select pg_temp.entrar('titular_c1');
select is(public.crm_ficha(pg_temp.cliente('c1')), null, 'titular do portal não usa a ficha do CRM');

-- ============ 4. EDIÇÃO (crm_editar_cliente) ============
select pg_temp.entrar('ca1a');
select lives_ok($$select public.crm_editar_cliente(pg_temp.cliente('c1'),
                  '{"nome":"Cliente Um Editado","email":"NOVO@CLIENTE.TEST","corretor_id":"c0000000-0000-4000-8000-000000000015"}')$$,
                'corretor edita o seu cliente');
select pg_temp.sair();
select ok((select c.nome = 'Cliente Um Editado' and c.email = 'novo@cliente.test' and c.corretor_id = pg_temp.parceiro('ca1a')
             and c.telefone = '11900000001' from public.clientes c where c.id = pg_temp.cliente('c1')),
          'só as chaves enviadas mudam; corretor_id nunca por aqui');
select is((select a.campos from public.auditoria a where a.acao = 'editar' and a.cliente_id = pg_temp.cliente('c1')
             and a.ator_id = pg_temp.usuario('ca1a')), array['email', 'nome'], 'auditoria editar com os nomes dos campos');
select ok(not exists (select 1 from public.auditoria a where a.acao = 'editar' and a::text like '%novo@cliente.test%'),
          'auditoria da edição sem valores');
select pg_temp.entrar('ca2a');
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cliente('c1'), '{"nome":"Invasor"}')$$)) ->> 'sqlstate',
          '42501', 'fora do escopo não edita');
select pg_temp.entrar('ca1a');
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cliente('c1'), jsonb_build_object('cpf', pg_temp.cpf(900000030)))$$)) ->> 'mensagem',
          'Só a equipe Arken pode alterar o CPF/CNPJ de um cliente.', 'parceiro não troca CPF preenchido');
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cliente('c1'), '{"email":"invalido"}')$$)) -> 'detalhe',
          '{"campos":["email"]}'::jsonb, 'edição valida os dados');
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cliente('c1'), '{"nome":null}')$$)) -> 'detalhe',
          '{"campos":["nome"]}'::jsonb, 'nome não pode ser apagado');
-- CPF vazio (migrado): o parceiro preenche; com CPF de outro cliente, a tentativa fica registrada e o CPF não é gravado
select lives_ok($$select public.crm_editar_cliente('e2000000-0000-4000-8000-000000000021', '{"cpf":"12345671130"}')$$,
                'preencher CPF que já existe em outro cliente não revela nada');
select pg_temp.sair();
select ok((select c.cpf is null from public.clientes c where c.id = 'e2000000-0000-4000-8000-000000000021')
          and exists (select 1 from public.cliente_duplicidades d where d.cliente_id = pg_temp.cliente('c3')
                        and d.tentado_por = pg_temp.usuario('ca1a') and d.resultado = 'bloqueado_pos_prazo'),
          'CPF duplicado não gravado; tentativa registrada (A2, conta no limite)');
select pg_temp.entrar('ca1a');
select lives_ok($$select public.crm_editar_cliente('e2000000-0000-4000-8000-000000000021', jsonb_build_object('cpf', pg_temp.cpf(900000031)))$$,
                'parceiro preenche CPF livre');
select pg_temp.sair();
select is((select c.cpf from public.clientes c where c.id = 'e2000000-0000-4000-8000-000000000021'), pg_temp.cpf(900000031),
          'CPF vazio preenchido pelo parceiro');
select pg_temp.entrar('admin');
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cliente('c1'), '{"cpf":"12345671050"}')$$)) ->> 'mensagem',
          'DOCUMENTO_INDISPONIVEL', 'interno: CPF de outro cliente recusado');
select lives_ok($$select public.crm_editar_cliente(pg_temp.cliente('c1'), jsonb_build_object('cpf', pg_temp.cpf(900000032)))$$,
                'interno troca o CPF');
select pg_temp.sair();
select is((select c.cpf from public.clientes c where c.id = pg_temp.cliente('c1')), pg_temp.cpf(900000032), 'CPF trocado pelo interno');
-- documento na edição do parceiro: a trava do limite vem antes da trava da linha (gb1 ainda não cadastrou nada aqui)
select ok(not pg_temp.trava('arken.a2.limite.usuario', pg_temp.usuario('gb1')::text), 'gb1 ainda sem trava do limite');
select pg_temp.entrar('gb1');
select lives_ok($$select public.crm_editar_cliente(pg_temp.cliente('c3'), '{"cpf":"123.456.711-30","horario_contato":"manhã"}')$$,
                'parceiro manda o CPF igual ao atual (nada muda no documento)');
select pg_temp.sair();
select ok(pg_temp.trava('arken.a2.limite.usuario', pg_temp.usuario('gb1')::text),
          'edição com CPF/CNPJ pelo parceiro trava o limite do usuário (mesma ordem do cadastro: limite, linha, documento)');

-- ============ 5. LISTA E OPÇÕES ============
select pg_temp.entrar('ca1a');
select is((public.crm_listar('{"busca":"Zzqx Busca Secreta"}', 50, 0) ->> 'total')::int, 0, 'busca sem resultado');
select ok((select bool_and(not (i ? 'cpf') and not (i ? 'cnpj')) from jsonb_array_elements(public.crm_listar('{}', 200, 0) -> 'itens') i),
          'lista sem CPF/CNPJ (minimização)');
select is((select jsonb_agg(i ->> 'id') from jsonb_array_elements(public.crm_listar('{"busca":"Um Editado"}', 50, 0) -> 'itens') i),
          jsonb_build_array(pg_temp.cliente('c1')), 'busca por nome');
select pg_temp.sair();
select ok(exists (select 1 from public.auditoria a where a.acao = 'listar' and a.ator_id = pg_temp.usuario('ca1a')
                    and a.detalhe ->> 'rpc' = 'crm_listar' and a.detalhe -> 'ids' = jsonb_build_array(pg_temp.cliente('c1'))
                    and a.detalhe -> 'filtros' ->> 'busca' = 'true'),
          'a lista grava os ids devolvidos e {busca: true}');
select ok(not exists (select 1 from public.auditoria a where a::text like '%Zzqx%' or a::text like '%Um Editado%'),
          'a auditoria nunca guarda o texto da busca');
select pg_temp.entrar('ga1');
select ok((select array_agg(i ->> 'id') from jsonb_array_elements(public.crm_listar('{}', 200, 0) -> 'itens') i)
            @> array[pg_temp.cliente('c1')::text, pg_temp.cliente('c4')::text, pg_temp.cliente('c5')::text]
          and not (select array_agg(i ->> 'id') from jsonb_array_elements(public.crm_listar('{}', 200, 0) -> 'itens') i)
            && array[pg_temp.cliente('c2')::text, pg_temp.cliente('c3')::text],
          'gerente lista a equipe (c1, c4, c5), não outras');
select is((public.crm_listar(jsonb_build_object('corretor_id', pg_temp.parceiro('ca2a')), 50, 0) ->> 'total')::int, 0,
          'filtro por corretor é cruzado com o escopo');
select is((public.crm_listar('{"so_meus":true}', 50, 0) ->> 'total')::int, 2,
          'so_meus: só os clientes em que o gerente é o responsável (A1)');
select is((pg_temp.erro($$select public.crm_listar('{"etapas":["xyz"]}', 50, 0)$$)) -> 'detalhe', '{"campos":["etapas"]}'::jsonb,
          'filtro inválido recusado');
select pg_temp.entrar('bloqueado');
select is((pg_temp.erro($$select public.crm_listar('{}', 50, 0)$$)) ->> 'sqlstate', '42501', 'sem vínculo não lista');
select pg_temp.entrar('ca1a');
select is(public.crm_clientes_opcoes('Um Editado'), jsonb_build_array(jsonb_build_object('id', pg_temp.cliente('c1'),
          'nome', 'Cliente Um Editado', 'etapa', 'novo_contato', 'corretor_nome', 'CA1a Corretor')), 'opções por nome no escopo');
select pg_temp.entrar('ca2a');
select is(public.crm_clientes_opcoes('Um Editado'), '[]'::jsonb, 'opções não mostram cliente de outro');
select pg_temp.entrar('titular_c1');
select is((pg_temp.erro($$select public.crm_clientes_opcoes(null)$$)) ->> 'sqlstate', '42501', 'titular não lista opções');
select pg_temp.sair();
select ok(exists (select 1 from public.auditoria a where a.detalhe ->> 'rpc' = 'crm_clientes_opcoes'
                    and a.ator_id = pg_temp.usuario('ca1a') and a.detalhe -> 'filtros' ->> 'busca' = 'true'),
          'opções auditadas sem o texto');

-- ============ 6. INATIVAR E PORTAL (internos) ============
select pg_temp.entrar('ca1a');
select is((pg_temp.erro($$select public.crm_inativar_cliente(pg_temp.cliente('c1'), 'motivo qualquer')$$)) ->> 'sqlstate',
          '42501', 'parceiro não inativa');
select is((pg_temp.erro($$select public.crm_liberar_portal(pg_temp.cliente('c1'), true)$$)) ->> 'sqlstate',
          '42501', 'parceiro não libera portal');
select pg_temp.entrar('admin');
select is((pg_temp.erro($$select public.crm_inativar_cliente(pg_temp.cliente('c3'), '  abc  ')$$)) ->> 'mensagem',
          'MOTIVO_OBRIGATORIO', 'motivo com menos de 5 caracteres (sem espaços) recusado');
select is((pg_temp.erro($$select public.crm_inativar_cliente(pg_temp.cliente('c2'), 'desistiu da compra')$$)) ->> 'mensagem',
          'CONTRATO_ATIVO', 'cliente com contrato ativo não é inativado');
select lives_ok($$select public.crm_inativar_cliente(pg_temp.cliente('c3'), 'pedido do próprio cliente')$$, 'interno inativa');
select pg_temp.sair();
select ok((select c.inativado_em is not null and c.inativado_por = pg_temp.usuario('admin') from public.clientes c where c.id = pg_temp.cliente('c3'))
          and pg_temp.aud('inativar', 'clientes', pg_temp.cliente('c3'), 'admin') = 1, 'inativação gravada e auditada');
select pg_temp.entrar('cb1a');
select is(public.crm_ficha(pg_temp.cliente('c3')), null, 'cliente inativado some para o parceiro');
select pg_temp.entrar('admin');
select is(public.crm_ficha(pg_temp.cliente('c3')) -> 'permissoes' ->> 'editar', 'false', 'interno lê o inativado, sem editar');
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cliente('c3'), '{"nome":"Nada"}')$$)) ->> 'mensagem',
          'Cliente inativo não pode ser editado.', 'inativado não recebe edição');
select lives_ok($$select public.crm_liberar_portal(pg_temp.cliente('c2'), true)$$, 'interno libera o portal (PF com CPF)');
select is((pg_temp.erro($$select public.crm_liberar_portal(pg_temp.cli_cnpj('11222335000170'), true)$$)) ->> 'mensagem',
          'O portal é só para pessoa física com CPF.', 'PJ não ganha portal');
select pg_temp.sair();
select ok((select c.portal_liberado from public.clientes c where c.id = pg_temp.cliente('c2'))
          and exists (select 1 from public.auditoria a where a.categoria = 'seguranca' and a.acao = 'liberar_portal'
                        and a.cliente_id = pg_temp.cliente('c2') and a.depois = '{"portal_liberado": true}'),
          'portal liberado e auditado (segurança, antes e depois)');
select pg_temp.entrar('admin');
select lives_ok($$select public.crm_liberar_portal(pg_temp.cliente('c2'), false)$$, 'interno revoga o portal');
select pg_temp.sair();
select is((select c.portal_liberado from public.clientes c where c.id = pg_temp.cliente('c2')), false, 'portal revogado');

-- ============ 7. DUPLICIDADES (fila dos internos) ============
select pg_temp.entrar('ca1a');
select is((pg_temp.erro($$select public.crm_duplicidades_listar('{}')$$)) ->> 'sqlstate', '42501', 'parceiro não vê a fila');
select pg_temp.entrar('admin');
select ok((public.crm_duplicidades_listar('{"pendentes":true,"resultado":"bloqueado_pos_prazo"}') ->> 'total')::int >= 1,
          'interno lista as pendentes pós-prazo');
select is((select i -> 'tentado_por' ->> 'nome' from jsonb_array_elements(
             public.crm_duplicidades_listar('{"resultado":"bloqueado_exclusividade"}') -> 'itens') i limit 1),
          'CA2a Corretor', 'a fila mostra quem tentou');
select pg_temp.sair();
select ok(exists (select 1 from public.auditoria a where a.detalhe ->> 'rpc' = 'crm_duplicidades_listar'
                    and a.ator_id = pg_temp.usuario('admin') and jsonb_array_length(a.detalhe -> 'ids') >= 1),
          'fila auditada com os ids');
create temp table dups as
  select d.id, d.resultado, d.cliente_id, d.tentado_por_parceiro_id from public.cliente_duplicidades d;
grant select on dups to authenticated;

select pg_temp.entrar('ga1');
select is((pg_temp.erro($$select public.crm_duplicidade_resolver((select id from dups where resultado = 'bloqueado_exclusividade'), 'manter', 'motivo longo')$$)) ->> 'sqlstate',
          '42501', 'parceiro não resolve duplicidade');
select pg_temp.entrar('admin');
select is((pg_temp.erro($$select public.crm_duplicidade_resolver((select id from dups where resultado = 'bloqueado_exclusividade'), 'manter', 'ok')$$)) ->> 'mensagem',
          'MOTIVO_OBRIGATORIO', 'resolver exige motivo');
select lives_ok($$select public.crm_duplicidade_resolver((select id from dups where resultado = 'bloqueado_exclusividade'), 'manter', 'dono dentro da exclusividade')$$,
                'interno mantém o dono');
select is((pg_temp.erro($$select public.crm_duplicidade_resolver((select id from dups where resultado = 'bloqueado_exclusividade'), 'manter', 'de novo aqui')$$)) ->> 'mensagem',
          'Esta duplicidade já foi resolvida.', 'resolvida uma vez só');
select is((pg_temp.erro($$select public.crm_duplicidade_resolver((select id from dups where resultado = 'mesmo_dono' limit 1), 'transferir', 'nao faz sentido')$$)) ->> 'mensagem',
          'DESTINO_INVALIDO', 'mesmo dono não é transferido');
select pg_temp.sair();
-- A2: dentro da exclusividade a fila não transfere (só 'manter'); vale o prazo de agora, não o da tentativa
insert into public.clientes (id, nome, cpf, corretor_id, origem, portal_liberado, exclusividade_ate) values
  ('e2000000-0000-4000-8000-000000000022', 'Exclusivo Do CA1a', pg_temp.cpf(900000060), pg_temp.parceiro('ca1a'),
   'cadastro_interno', false, now() + interval '30 days');
select pg_temp.entrar('ca2a');
select is(pg_temp.cadastrar('Tenta Exclusivo', pg_temp.cpf(900000060)) ->> 'situacao', 'indisponivel',
          'tentativa dentro da exclusividade: indisponível');
select pg_temp.sair();
create temp table dup_exclusivo as
  select d.id from public.cliente_duplicidades d where d.cliente_id = 'e2000000-0000-4000-8000-000000000022';
grant select on dup_exclusivo to authenticated;
create function pg_temp.pode_transferir_exclusivo() returns text language sql as $$
  select i ->> 'pode_transferir' from jsonb_array_elements(public.crm_duplicidades_listar('{"pendentes":true}') -> 'itens') i
  where i ->> 'id' = (select id::text from dup_exclusivo)
$$;
select pg_temp.entrar('admin');
select is(pg_temp.pode_transferir_exclusivo(), 'false', 'dentro da exclusividade: a fila não oferece transferir');
select is((pg_temp.erro($$select public.crm_duplicidade_resolver((select id from dup_exclusivo), 'transferir', 'ainda dentro do prazo')$$)) ->> 'mensagem',
          'Cliente dentro do prazo de exclusividade: a fila de duplicidades só transfere depois do prazo.',
          'dentro da exclusividade: transferir recusado');
select pg_temp.sair();
select ok((select c.corretor_id = pg_temp.parceiro('ca1a') from public.clientes c where c.id = 'e2000000-0000-4000-8000-000000000022')
          and (select d.resolvido_em is null from public.cliente_duplicidades d where d.id = (select id from dup_exclusivo)),
          'nada mudou: o dono continua e o caso segue pendente');
update public.clientes set exclusividade_ate = now() - interval '1 minute' where id = 'e2000000-0000-4000-8000-000000000022';
select pg_temp.entrar('admin');
select is(pg_temp.pode_transferir_exclusivo(), 'true', 'depois do prazo a fila oferece transferir');
select lives_ok($$select public.crm_duplicidade_resolver((select id from dup_exclusivo), 'manter', 'dono segue atendendo')$$,
                'manter continua disponível');
-- transferir dentro da imobiliária: c1 (CA1a) → CA2a, quem tentou depois do prazo
select lives_ok($$select public.crm_duplicidade_resolver((select id from dups where resultado = 'bloqueado_pos_prazo'
                    and cliente_id = pg_temp.cliente('c1') and tentado_por_parceiro_id = pg_temp.parceiro('ca2a')),
                    'transferir', 'prazo vencido, atendimento do CA2a')$$,
                'interno transfere para quem tentou');
select pg_temp.sair();
select ok((select c.corretor_id = pg_temp.parceiro('ca2a') and c.gerente_id = pg_temp.parceiro('ga2') from public.clientes c
           where c.id = pg_temp.cliente('c1'))
          and exists (select 1 from public.cliente_vinculos_historico h where h.cliente_id = pg_temp.cliente('c1')
                        and h.vigente_ate is null and h.motivo = 'prazo vencido, atendimento do CA2a'),
          'transferência: cadeia nova e histórico com o motivo');
select ok(pg_temp.eventos(pg_temp.cliente('c1'), 'transferencia') = 1 and pg_temp.aud('transferir', 'clientes', pg_temp.cliente('c1'), 'admin') = 1
          and pg_temp.aud('resolver', 'cliente_duplicidades', pg_temp.cliente('c1'), 'admin') = 2,
          'timeline transferencia e auditoria (transferir e resolver)');
select ok(not exists (select 1 from public.auditoria a where a.acao in ('transferir', 'resolver') and a::text like '%atendimento do CA2a%'),
          'o motivo não vai para a auditoria');
-- entre imobiliárias: só o Super (c2 tentado pelo CB1a)
select pg_temp.entrar('admin');
select is((pg_temp.erro($$select public.crm_duplicidade_resolver((select id from dups where resultado = 'bloqueado_contrato'), 'transferir', 'outra imobiliária')$$)) ->> 'mensagem',
          'Transferência entre imobiliárias é exclusiva do Super.', 'admin não transfere entre imobiliárias');
select pg_temp.entrar('super');
select lives_ok($$select public.crm_duplicidade_resolver((select id from dups where resultado = 'bloqueado_contrato'), 'transferir', 'decisão do Super')$$,
                'Super transfere entre imobiliárias');
select pg_temp.sair();
select is((select c.imobiliaria_id from public.clientes c where c.id = pg_temp.cliente('c2')), pg_temp.imobiliaria('b'),
          'c2 foi para a imobiliária B');

-- ============ 8. LEADS DO SITE (internos) ============
select pg_temp.entrar('ga1');
select is((pg_temp.erro($$select public.leads_listar('{}')$$)) ->> 'sqlstate', '42501', 'parceiro não lista leads');
select is((pg_temp.erro($$select public.leads_exportar('{}')$$)) ->> 'sqlstate', '42501', 'parceiro não exporta leads');
select is((pg_temp.erro($$select public.leads_excluir('e2000000-0000-4000-8000-000000000033')$$)) ->> 'sqlstate', '42501', 'parceiro não exclui lead');
select pg_temp.entrar('admin');
select is((public.leads_listar('{"busca":"Lead"}') ->> 'total')::int, 3, 'interno lista leads');
select is((select i -> 'empreendimento' ->> 'nome' from jsonb_array_elements(public.leads_listar('{"busca":"97777-0001"}') -> 'itens') i),
          'Residencial WP2', 'busca por telefone; empreendimento no item');
select is(jsonb_array_length(public.leads_exportar('{"status":"novo"}')), 3, 'exportação com filtro');
select is((pg_temp.erro($$select public.leads_converter('e2000000-0000-4000-8000-000000000031', pg_temp.parceiro('ca1a'),
            pg_temp.pf('Lead Um', pg_temp.cpf(900000040)), pg_temp.termo())$$)), null, 'interno converte lead em cliente');
select pg_temp.sair();
select ok((select l.status = 'convertido' and l.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000040))
             and l.tratado_por = pg_temp.usuario('admin') and l.tratado_em is not null
           from public.leads l where l.id = 'e2000000-0000-4000-8000-000000000031')
          and (select c.origem = 'lead_site' and c.corretor_id = pg_temp.parceiro('ca1a') and c.etapa = 'novo_contato'
               from public.clientes c where c.cpf = pg_temp.cpf(900000040)),
          'lead convertido: cliente lead_site na carteira escolhida, lead ligado');
select ok(exists (select 1 from public.auditoria a where a.acao = 'converter' and a.entidade = 'leads'
                    and a.entidade_id = 'e2000000-0000-4000-8000-000000000031' and a.ator_id = pg_temp.usuario('admin'))
          and exists (select 1 from public.auditoria a where a.acao = 'exportar' and a.entidade = 'leads'
                        and (a.detalhe ->> 'total')::int = 3)
          and exists (select 1 from public.auditoria a where a.acao = 'listar' and a.entidade = 'leads'
                        and a.detalhe -> 'filtros' ->> 'busca' = 'true'),
          'leads: listar, exportar e converter auditados');
select pg_temp.entrar('admin');
select is((pg_temp.erro($$select public.leads_converter('e2000000-0000-4000-8000-000000000031', null,
            pg_temp.pf('Lead Um', pg_temp.cpf(900000041)), pg_temp.termo())$$)) ->> 'mensagem',
          'Este contato já foi tratado.', 'lead tratado não converte de novo');
select is(public.leads_converter('e2000000-0000-4000-8000-000000000032', null, pg_temp.pf('Lead Dois', '12345671211'), pg_temp.termo()),
          jsonb_build_object('situacao', 'ja_na_sua_carteira', 'id', pg_temp.cliente('c4')), 'A2 na conversão: documento já existente');
select is((pg_temp.erro($$select public.leads_descartar('e2000000-0000-4000-8000-000000000033', 'spam')$$)) ->> 'mensagem',
          'MOTIVO_OBRIGATORIO', 'descartar exige motivo');
select lives_ok($$select public.leads_descartar('e2000000-0000-4000-8000-000000000033', 'mensagem de spam')$$, 'interno descarta');
select is((pg_temp.erro($$select public.leads_excluir('e2000000-0000-4000-8000-000000000033')$$)) ->> 'mensagem',
          'Só é possível excluir contatos ainda não tratados.', 'lead tratado não é excluído');
select pg_temp.sair();
select ok((select l.cliente_id = pg_temp.cliente('c4') and l.status = 'convertido' from public.leads l
           where l.id = 'e2000000-0000-4000-8000-000000000032')
          and (select l.status = 'descartado' and l.motivo_descarte = 'mensagem de spam' from public.leads l
               where l.id = 'e2000000-0000-4000-8000-000000000033'),
          'lead ligado ao cliente existente; descarte com motivo');
insert into public.leads (id, nome, telefone) values ('e2000000-0000-4000-8000-000000000034', 'Lead Novo', '11977770004');
select pg_temp.entrar('admin');
select lives_ok($$select public.leads_excluir('e2000000-0000-4000-8000-000000000034')$$, 'interno exclui lead novo (spam)');
select pg_temp.sair();
select ok(not exists (select 1 from public.leads l where l.id = 'e2000000-0000-4000-8000-000000000034')
          and exists (select 1 from public.auditoria a where a.acao = 'excluir' and a.entidade = 'leads'
                        and a.entidade_id = 'e2000000-0000-4000-8000-000000000034'),
          'exclusão feita e auditada');

-- ============ 9. PROPOSTAS ============
select pg_temp.entrar('ca1a');
select isnt(public.propostas_criar('e2000000-0000-4000-8000-000000000001', pg_temp.cli_cpf(pg_temp.cpf(900000001)),
            'e2000000-0000-4000-8000-000000000011', 'Proposta para o apto 11 com entrada e FGTS'), null,
            'corretor cria proposta para o seu cliente');
select isnt(public.propostas_criar('e2000000-0000-4000-8000-000000000001', null, null, 'Proposta sem cliente definido'), null,
            'proposta sem cliente');
select is((pg_temp.erro($$select public.propostas_criar('e2000000-0000-4000-8000-000000000001', pg_temp.cliente('c3'), null, 'Proposta invasora aqui')$$)) ->> 'sqlstate',
          '42501', 'cliente fora do escopo: 42501');
select is((pg_temp.erro($$select public.propostas_criar('e2000000-0000-4000-8000-000000000001', null, null, 'curta')$$)) -> 'detalhe',
          '{"campos":["texto"]}'::jsonb, 'texto curto recusado');
select is((pg_temp.erro($$select public.propostas_criar('e2000000-0000-4000-8000-000000000001', null, 'e2000000-0000-4000-8000-000000000012', 'Unidade já vendida')$$)) -> 'detalhe',
          '{"campos":["unidade_id"]}'::jsonb, 'unidade vendida recusada');
select is((pg_temp.erro($$select public.propostas_criar('e2000000-0000-4000-8000-000000000002', null, null, 'Empreendimento sem publicação')$$)) -> 'detalhe',
          '{"campos":["empreendimento_id"]}'::jsonb, 'empreendimento não publicado recusado');
select pg_temp.entrar('admin');
select is((pg_temp.erro($$select public.propostas_criar('e2000000-0000-4000-8000-000000000001', null, null, 'Interno não cria proposta')$$)) ->> 'sqlstate',
          '42501', 'interno não cria proposta');
select pg_temp.entrar('bloqueado');
select is((pg_temp.erro($$select public.propostas_criar('e2000000-0000-4000-8000-000000000001', null, null, 'Bloqueado não cria nada')$$)) ->> 'sqlstate',
          '42501', 'bloqueado não cria proposta');
select pg_temp.entrar('ga1');
select isnt(public.propostas_criar('e2000000-0000-4000-8000-000000000001', pg_temp.cli_cpf(pg_temp.cpf(900000004)), null,
            'Proposta do gerente para cliente do CA1a'), null, 'gerente cria proposta para cliente da equipe');
select pg_temp.sair();
select ok((select p.corretor_id = pg_temp.parceiro('ca1a') and p.gerente_id = pg_temp.parceiro('ga1')
             and p.imobiliaria_id = pg_temp.imobiliaria('a') and p.status = 'enviada'
           from public.propostas p where p.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000001)))
          and pg_temp.eventos(pg_temp.cli_cpf(pg_temp.cpf(900000001)), 'proposta_enviada') = 1
          and pg_temp.aud('criar', 'propostas', pg_temp.cli_cpf(pg_temp.cpf(900000001)), 'ca1a') = 1,
          'proposta com a cadeia do cliente, timeline e auditoria');

select pg_temp.entrar('ca1a');
select is((public.propostas_listar('{}') ->> 'total')::int, 3, 'corretor lista as da sua cadeia e as próprias sem cliente');
select is((select i -> 'autor' ->> 'nome' from jsonb_array_elements(public.propostas_listar(
             jsonb_build_object('cliente_id', pg_temp.cli_cpf(pg_temp.cpf(900000004)))) -> 'itens') i),
          'Gerência', 'PAR-3: autor acima aparece genérico');
select is((select i -> 'cadeia' from jsonb_array_elements(public.propostas_listar('{"limite":1}') -> 'itens') i), null,
          'cadeia achatada no item (corretor, gerente, imobiliaria)');
select is((select i -> 'gerente' from jsonb_array_elements(public.propostas_listar('{"limite":1}') -> 'itens') i), 'null'::jsonb,
          'o corretor não vê o gerente na proposta');
select pg_temp.entrar('ca2a');
select is((public.propostas_listar('{}') ->> 'total')::int, 0, 'outro corretor não vê as propostas');
select pg_temp.entrar('titular_c1');
select is((pg_temp.erro($$select public.propostas_listar('{}')$$)) ->> 'sqlstate', '42501', 'titular não lista propostas');
select pg_temp.entrar('ca1a');
select is((pg_temp.erro($$select public.propostas_responder((select p.id from public.propostas p limit 1), 'aprovada', null)$$)) ->> 'sqlstate',
          '42501', 'parceiro não responde');
select pg_temp.sair();
create temp table prop as select p.id from public.propostas p where p.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000001));
grant select on prop to authenticated;
select pg_temp.entrar('admin');
select lives_ok($$select public.propostas_responder((select id from prop), 'aprovada', 'Aprovada com a entrada proposta')$$,
                'interno responde');
select is((select i ->> 'pode_responder' from jsonb_array_elements(public.propostas_listar(jsonb_build_object('cliente_id',
             pg_temp.cli_cpf(pg_temp.cpf(900000001)))) -> 'itens') i), 'true', 'interno pode responder');
select pg_temp.sair();
select ok((select p.status = 'aprovada' and p.resposta_admin = 'Aprovada com a entrada proposta' from public.propostas p
           where p.id = (select id from prop))
          and pg_temp.eventos(pg_temp.cli_cpf(pg_temp.cpf(900000001)), 'proposta_respondida') = 1
          and exists (select 1 from public.auditoria a where a.acao = 'responder' and a.entidade = 'propostas'
                        and a.antes = '{"status": "enviada"}' and a.depois = '{"status": "aprovada"}'),
          'resposta gravada, na timeline e auditada (antes e depois)');
select ok(exists (select 1 from public.auditoria a where a.acao = 'listar' and a.entidade = 'propostas'
                    and a.ator_id = pg_temp.usuario('ca1a')), 'lista de propostas auditada');

-- ============ 10. PRÉ-CADASTRO (crm_pre_cadastro, só service_role) ============
select ok(not has_function_privilege('authenticated', 'public.crm_pre_cadastro(text, jsonb, uuid, inet, text)', 'execute')
          and not has_function_privilege('anon', 'public.crm_pre_cadastro(text, jsonb, uuid, inet, text)', 'execute')
          and has_function_privilege('service_role', 'public.crm_pre_cadastro(text, jsonb, uuid, inet, text)', 'execute'),
          'crm_pre_cadastro só para a service role');
create function pg_temp.pre(p_codigo text, p_doc text, p_termo uuid default null, p_tipo text default 'fisica') returns jsonb language sql as $$
  select public.crm_pre_cadastro(p_codigo, jsonb_build_object('tipo_pessoa', p_tipo, 'nome', 'Visitante', 'sobrenome', 'Do Link',
           'documento', p_doc, 'email', 'visitante@link.test', 'telefone', '(11) 96666-5555'),
         coalesce(p_termo, pg_temp.termo()), '203.0.113.7', 'Navegador de Teste/1.0')
$$;
select pg_temp.entrar_servico();
select is(pg_temp.pre('linkcaumaa', pg_temp.cpf(900000050)), '{"situacao":"termo_invalido"}'::jsonb,
          'H4: sem termo revisado pelo jurídico, o pré-cadastro não cria nada');
select pg_temp.sair();
insert into public.lgpd_termos (tipo, versao, texto, revisado_juridico)
values ('consentimento_cliente', '1-revisada-teste', 'Texto revisado do consentimento para o teste do pré-cadastro.', true);
update t_termo set id = public._termo_vigente_id('consentimento_cliente');
create temp table termo_antigo as
  select t.id from public.lgpd_termos t where t.tipo = 'consentimento_cliente' and t.versao = '0-provisória';
grant select on termo_antigo to service_role;
select pg_temp.entrar_servico();
select is(pg_temp.pre('linkcaumaa', pg_temp.cpf(900000050), (select id from termo_antigo)), '{"situacao":"termo_desatualizado"}'::jsonb,
          'termo antigo (versão publicada com a página aberta): termo_desatualizado, a página relê o termo');
select is(pg_temp.pre('linkcaumaa', pg_temp.cpf(900000050), gen_random_uuid()), '{"situacao":"termo_desatualizado"}'::jsonb,
          'termo inexistente com termo revisado vigente: termo_desatualizado');
select is(pg_temp.pre('zzzzzzzzzz', pg_temp.cpf(900000050)), '{"situacao":"codigo_invalido"}'::jsonb, 'código inexistente');
select is(pg_temp.pre('<script>', pg_temp.cpf(900000050)), '{"situacao":"codigo_invalido"}'::jsonb, 'código fora do formato');
select is(pg_temp.pre('linkbloque', pg_temp.cpf(900000050)), '{"situacao":"codigo_invalido"}'::jsonb,
          'código de parceiro bloqueado não vale');
select pg_temp.sair();
select is((select count(*)::int from public.clientes c where c.cpf = pg_temp.cpf(900000050)), 0, 'nada criado sem termo vigente aceito');
select pg_temp.marcar_fila();
select pg_temp.entrar_servico();
select is(pg_temp.pre('LINKCAUMAA', pg_temp.cpf(900000050)), '{"situacao":"criado"}'::jsonb, 'pré-cadastro cria o cliente');
select pg_temp.sair();
create temp table fila_criado as select pg_temp.fila_visitante() as f;
select ok((select c.etapa = 'novo_contato' and c.origem = 'pre_cadastro_link' and not c.portal_liberado
             and c.corretor_id = pg_temp.parceiro('ca1a') and c.nome = 'Visitante' and c.sobrenome = 'Do Link'
             and c.telefone = '11966665555' and c.exclusividade_ate > now()
           from public.clientes c where c.cpf = pg_temp.cpf(900000050)),
          'cliente do pré-cadastro: NC, pre_cadastro_link, portal fechado (N9), na carteira do dono do link');
select is((select array_agg(d.nome order by d.nome collate "C") from public.cliente_documentos d where d.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000050))
             and d.basico and d.status = 'pendente'),
          array['CNH', 'CPF', 'Comprovante de renda', 'Comprovante de residência'], 'CRM-3: as 4 solicitações básicas');
select ok(exists (select 1 from public.lgpd_consentimentos l where l.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000050))
                    and l.origem = 'pre_cadastro_link' and l.ip = '203.0.113.7' and l.user_agent = 'Navegador de Teste/1.0'
                    and l.registrado_por is null and l.termo_id = pg_temp.termo()),
          'consentimento do titular com IP e navegador');
select ok(pg_temp.eventos(pg_temp.cli_cpf(pg_temp.cpf(900000050)), 'pre_cadastro') = 1
          and pg_temp.eventos(pg_temp.cli_cpf(pg_temp.cpf(900000050)), 'documento_solicitado') = 4
          and exists (select 1 from public.auditoria a where a.acao = 'criar' and a.origem = 'edge:pre-cadastro'
                        and a.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000050))),
          'timeline e auditoria (origem edge:pre-cadastro)');
select is((select f from fila_criado),
          jsonb_build_array(jsonb_build_object('tipo', 'crm.boas_vindas', 'destinatarios', '[]'::jsonb, 'cliente_id', null,
            'status', 'pendente', 'dados', '{}'::jsonb, 'email', 'visitante@link.test', 'primeiro_nome', 'Visitante',
            'parceiro_id', pg_temp.parceiro('ca1a'), 'portal', false)),
          'criado: a confirmação vai para o e-mail DIGITADO (aviso), sem cliente_id e só com o id do aviso na fila');
select ok(not exists (select 1 from public.notificacoes n where n.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000050)))
          and not exists (select 1 from public.notificacoes n where n.tipo = 'crm.novo_lead_corretor'),
          'criado: nada na fila aponta para o cliente novo; aviso ao corretor desligado por padrão');
-- duplicado: mesma resposta para quem chama (a Edge devolve 200 igual) E a mesma fila para o e-mail digitado
select pg_temp.marcar_fila();
select pg_temp.entrar_servico();
select is(pg_temp.pre('linkcaumaa', '12345671300'), '{"situacao":"duplicado"}'::jsonb, 'documento existente: duplicado');
select pg_temp.sair();
select is(pg_temp.fila_visitante(), (select f from fila_criado),
          '§6.1: duplicado põe na fila exatamente a mesma confirmação que o criado (nenhum e-mail revela se o CPF existe)');
select ok(not exists (select 1 from public.notificacoes n where n.cliente_id = pg_temp.cliente('c5')),
          'duplicado: nada vai para o dono nem para o titular existente');
select ok(not exists (select 1 from public.pre_cadastro_avisos a where a::text like '%12345671300%'
                        or a::text like '%' || pg_temp.cpf(900000050) || '%'),
          'o aviso não guarda o documento');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.pre_cadastro_avisos'::regclass)
          and not has_table_privilege('anon', 'public.pre_cadastro_avisos', 'select')
          and not has_table_privilege('authenticated', 'public.pre_cadastro_avisos', 'select')
          and has_table_privilege('service_role', 'public.pre_cadastro_avisos', 'select')
          and has_table_privilege('service_role', 'public.pre_cadastro_avisos', 'delete')
          and not has_table_privilege('service_role', 'public.pre_cadastro_avisos', 'insert')
          and not has_table_privilege('service_role', 'public.pre_cadastro_avisos', 'update'),
          'pre_cadastro_avisos: RLS, só a service role lê e apaga');
select ok(exists (select 1 from public.cliente_duplicidades d where d.cliente_id = pg_temp.cliente('c5')
                    and d.tentado_por is null and d.tentado_por_parceiro_id = pg_temp.parceiro('ca1a')
                    and d.origem = 'pre_cadastro_link' and d.resultado = 'bloqueado_pos_prazo')
          and (select c.corretor_id = pg_temp.parceiro('bloqueado') and c.nome = 'Cliente Cinco' from public.clientes c
               where c.id = pg_temp.cliente('c5')),
          'duplicado registrado para a fila; o cliente existente não muda');
select pg_temp.entrar_servico();
select is(pg_temp.pre('linkcaumaa', pg_temp.cpf(900000050)), '{"situacao":"duplicado"}'::jsonb, 'pelo link do próprio dono também');
select pg_temp.sair();
select is(pg_temp.dup(pg_temp.cli_cpf(pg_temp.cpf(900000050)), 'mesmo_dono'), 1, 'pelo link do dono: mesmo_dono');
-- A1 pelo link do gerente; portal conforme configuração (só PF); PJ; dados inválidos
update public.configuracao_geral set portal_libera_pre_cadastro = true;
select pg_temp.entrar_servico();
select is(pg_temp.pre('linkgaumaa', pg_temp.cpf(900000051)), '{"situacao":"criado"}'::jsonb, 'link do gerente (A1)');
select is(pg_temp.pre('linkcaumaa', '11222336000115', null, 'juridica'), '{"situacao":"criado"}'::jsonb, 'pré-cadastro de PJ');
select is((pg_temp.erro($$select pg_temp.pre('linkcaumaa', '12345678900')$$)) -> 'detalhe', '{"campos":["cpf"]}'::jsonb,
          'CPF inválido recusado');
select is((pg_temp.erro($$select public.crm_pre_cadastro('linkcaumaa', jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Sem Telefone',
             'documento', pg_temp.cpf(900000052)), pg_temp.termo(), null, null)$$)) -> 'detalhe', '{"campos":["telefone"]}'::jsonb,
          'telefone obrigatório');
select pg_temp.sair();
select ok((select c.corretor_id = pg_temp.parceiro('ga1') and c.gerente_id = pg_temp.parceiro('ga1') and c.portal_liberado
           from public.clientes c where c.cpf = pg_temp.cpf(900000051))
          and (select not c.portal_liberado and c.tipo_pessoa = 'juridica' and c.sobrenome is null from public.clientes c
               where c.cnpj = '11222336000115'),
          'portal_libera_pre_cadastro vale só para PF; A1 pelo link do gerente');

-- com todos os e-mails ligados: o aviso ao corretor vai para o dono do link; o e-mail de documentos da criação fica
-- ignorado; criado e duplicado continuam com a MESMA fila para o e-mail digitado (portal conforme a configuração)
update public.notificacoes_config set ativo = true where tipo in ('crm.novo_lead_corretor', 'crm.documento_solicitado');
select pg_temp.marcar_fila();
select pg_temp.entrar_servico();
select is(pg_temp.pre('linkcaumaa', pg_temp.cpf(900000053)), '{"situacao":"criado"}'::jsonb, 'criado com todos os e-mails ligados');
select pg_temp.sair();
create temp table fila_criado2 as select pg_temp.fila_visitante() as f;
select is((select jsonb_agg(jsonb_build_object('destinatarios', n.destinatarios_ids, 'dados', n.dados)) from public.notificacoes n
           where n.tipo = 'crm.novo_lead_corretor' and n.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000053))),
          jsonb_build_array(jsonb_build_object('destinatarios', jsonb_build_array(pg_temp.usuario('ca1a')),
            'dados', jsonb_build_object('cliente_id', pg_temp.cli_cpf(pg_temp.cpf(900000053)), 'origem', 'pre_cadastro_link'))),
          'crm.novo_lead_corretor ligado: vai para o perfil do dono do link, com o cliente e a origem');
select ok(exists (select 1 from public.notificacoes n where n.tipo = 'crm.documento_solicitado'
                    and n.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000053)) and n.status = 'ignorado')
          and not exists (select 1 from public.notificacoes n where n.tipo = 'crm.documento_solicitado'
                            and n.cliente_id = pg_temp.cli_cpf(pg_temp.cpf(900000053)) and n.status <> 'ignorado'),
          'e-mail de documentos da criação registrado como ignorado (só existiria no caminho criado)');
select is(jsonb_array_length((select f from fila_criado2)), 1, 'uma confirmação para o e-mail digitado');
select is((select f from fila_criado2) -> 0 ->> 'portal', 'true', 'o aviso leva o portal conforme a configuração');
select pg_temp.marcar_fila();
select pg_temp.entrar_servico();
select is(pg_temp.pre('linkcaumaa', '12345671211'), '{"situacao":"duplicado"}'::jsonb, 'duplicado com todos os e-mails ligados');
select pg_temp.sair();
select is(pg_temp.fila_visitante(), (select f from fila_criado2),
          'com todos os e-mails ligados, criado e duplicado continuam iguais para o e-mail digitado');
-- sem e-mail digitado: nenhum dos dois caminhos põe confirmação na fila
select pg_temp.marcar_fila();
select pg_temp.entrar_servico();
select is(public.crm_pre_cadastro('linkcaumaa', jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Sem Email',
            'documento', pg_temp.cpf(900000056), 'telefone', '11955554444'), pg_temp.termo(), null, null),
          '{"situacao":"criado"}'::jsonb, 'sem e-mail: criado');
select is(public.crm_pre_cadastro('linkcaumaa', jsonb_build_object('tipo_pessoa', 'fisica', 'nome', 'Sem Email',
            'documento', '12345671050', 'telefone', '11955554444'), pg_temp.termo(), null, null),
          '{"situacao":"duplicado"}'::jsonb, 'sem e-mail: duplicado');
select pg_temp.sair();
select is(pg_temp.fila_visitante(), '[]'::jsonb, 'sem e-mail digitado: nenhuma confirmação na fila, nos dois caminhos');

-- limite A2 por link (antes de olhar o documento), com trava própria; só conta bloqueio pelo próprio link
update public.configuracao_geral set duplicidade_bloqueios_hora = 2;
select pg_temp.entrar_servico();
select is(pg_temp.pre('linkcbumaa', pg_temp.cpf(900000032)), '{"situacao":"duplicado"}'::jsonb, 'link: bloqueio 1 de 2');
select is(pg_temp.pre('linkcbumaa', '12345671211'), '{"situacao":"duplicado"}'::jsonb, 'link: bloqueio 2 de 2');
select is(pg_temp.pre('linkcbumaa', pg_temp.cpf(900000054)), '{"situacao":"limite"}'::jsonb,
          'acima do limite do link: limite, também com CPF livre (não vira oráculo para o dono do link)');
select is(pg_temp.pre('linkgaumaa', pg_temp.cpf(900000054)), '{"situacao":"criado"}'::jsonb, 'o limite é de cada link');
select pg_temp.sair();
select ok((select c.corretor_id = pg_temp.parceiro('ga1') from public.clientes c where c.cpf = pg_temp.cpf(900000054))
          and (select count(*)::int from public.cliente_duplicidades d
               where d.origem = 'pre_cadastro_link' and d.tentado_por_parceiro_id = pg_temp.parceiro('cb1a')) = 2,
          'o link acima do limite não criou nem registrou nada; o outro link criou');
select ok(pg_temp.trava('arken.a2.limite.link', pg_temp.parceiro('cb1a')::text), 'trava consultiva do limite por link');
select pg_temp.entrar('cb1a');
select is(pg_temp.cadastrar('Livre Do CB1a', pg_temp.cpf(900000055)) ->> 'situacao', 'criado',
          'bloqueios pelo link não contam no limite do usuário dono do link');
select pg_temp.sair();
update public.configuracao_geral set duplicidade_bloqueios_hora = 10;

-- ============ 11. SEM ACESSO: RPCs de escrita dos internos negadas a parceiros, titular e anon ============
select pg_temp.entrar('titular_c1');
select is((pg_temp.erro($$select public.leads_converter('e2000000-0000-4000-8000-000000000032', null, '{}'::jsonb, null)$$)) ->> 'sqlstate',
          '42501', 'titular não converte lead');
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cliente('c1'), '{"nome":"Eu Mesmo"}')$$)) ->> 'sqlstate',
          '42501', 'titular não edita pelo CRM');
select pg_temp.entrar('gb1');
select is((pg_temp.erro($$select public.crm_editar_cliente(pg_temp.cli_cpf(pg_temp.cpf(900000001)), '{"nome":"De Fora"}')$$)) ->> 'sqlstate',
          '42501', 'gerente de outra imobiliária não edita');
select is((pg_temp.erro($$select public.crm_editar_cliente('e2000000-0000-4000-8000-0000000000ff', '{"nome":"Fantasma"}')$$)) ->> 'mensagem',
          'Sem acesso a este registro', 'inexistente: mesma mensagem de sem acesso');
select pg_temp.entrar('ga1');
select is((pg_temp.erro($$select public.leads_descartar('e2000000-0000-4000-8000-000000000032', 'motivo longo')$$)) ->> 'sqlstate',
          '42501', 'parceiro não descarta lead');
select is((pg_temp.erro($$select public.leads_converter('e2000000-0000-4000-8000-000000000032', null, '{}'::jsonb, null)$$)) ->> 'sqlstate',
          '42501', 'parceiro não converte lead');
select pg_temp.entrar_anon();
select is((pg_temp.erro($$select public.crm_ficha(null)$$)) ->> 'sqlstate', '42501', 'anon não lê ficha');
select is((pg_temp.erro($$select public.propostas_listar('{}')$$)) ->> 'sqlstate', '42501', 'anon não lista propostas');
select pg_temp.sair();

select * from finish();
rollback;
