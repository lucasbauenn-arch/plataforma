-- Portal do cliente do WP6 (docs/ARQUITETURA_EXPANSAO.md §4.4, §6.7, §8.5, N1, N9): portal_* só do próprio titular
-- (meu_cliente_id: portal liberado, não inativado, não anonimizado; PF com CPF); documentos só para ENVIO (sem
-- caminho); contratos só a partir de assinatura_pendente; download só do PDF assinado; portal_localizar_cliente só
-- para a service role e só para PF liberada, ativa e não anonimizada. Cada leitura auditada; negação registrada.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(65);

-- sessão de um usuário criado neste teste (a fixture só conhece os nomes dela)
create function pg_temp.entrar_uid(p_id uuid) returns text language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
  return '';
end $$;

-- ============ DADOS DESTE TESTE (como postgres) ============
-- usuários do portal: titular_pj (cliente PJ), titular_c6 (cliente PF da Carteira Arken), titular_c2 (c2, portal fechado)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, '{}', now(), now()
from (values
  ('a0000000-0000-4000-8000-000000000033'::uuid, 'cliente-pj@portal.arkenincorporadora.com.br'),
  ('a0000000-0000-4000-8000-000000000034'::uuid, 'cliente-c6@portal.arkenincorporadora.com.br'),
  ('a0000000-0000-4000-8000-000000000035'::uuid, 'cliente-c2@portal.arkenincorporadora.com.br')) as u(id, email);
update public.profiles set papel = 'cliente'
 where id in ('a0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000034',
              'a0000000-0000-4000-8000-000000000035');
insert into public.clientes (id, user_id, nome, tipo_pessoa, cpf, cnpj, corretor_id, origem, portal_liberado) values
  ('d6000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000033', 'Empresa Cliente', 'juridica', null,
   '11222335000170', pg_temp.parceiro('ca1a'), 'cadastro_interno', true),
  ('d6000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000034', 'Cliente Seis', 'fisica', '12345671483',
   null, null, 'cadastro_interno', true);
update public.clientes set user_id = 'a0000000-0000-4000-8000-000000000035' where id = pg_temp.cliente('c2');
-- c3: portal liberado mas cliente inativado
update public.clientes set portal_liberado = true, inativado_em = now(), motivo_inativacao = 'teste' where id = pg_temp.cliente('c3');

-- documentos: c1 (pendente, rejeitado, aprovado com arquivo, inativado) e c2 (pendente)
insert into public.cliente_documentos (id, cliente_id, nome, status, motivo_rejeicao, inativado_em) values
  ('f6100000-0000-4000-8000-000000000301', pg_temp.cliente('c1'), 'RG', 'pendente', null, null),
  ('f6100000-0000-4000-8000-000000000302', pg_temp.cliente('c1'), 'CNH', 'rejeitado', 'Foto ilegível', null),
  ('f6100000-0000-4000-8000-000000000303', pg_temp.cliente('c1'), 'Comprovante de renda', 'aprovado', null, null),
  ('f6100000-0000-4000-8000-000000000304', pg_temp.cliente('c1'), 'Certidão', 'pendente', null, now()),
  ('f6100000-0000-4000-8000-000000000305', pg_temp.cliente('c2'), 'RG', 'pendente', null, null);
insert into public.cliente_documento_arquivos (id, documento_id, storage_path, mime_type, tamanho_bytes, enviado_em) values
  ('f6100000-0000-4000-8000-000000000313', 'f6100000-0000-4000-8000-000000000303',
   'd0000000-0000-4000-8000-000000000001/f6100000-0000-4000-8000-000000000303/f6100000-0000-4000-8000-000000000323.pdf',
   'application/pdf', 1000, '2026-09-10 10:00:00-03');
update public.cliente_documentos set arquivo_atual_id = 'f6100000-0000-4000-8000-000000000313'
 where id = 'f6100000-0000-4000-8000-000000000303';

-- contratos do c1: rascunho (invisível), aguardando assinatura, assinado (com PDF); do c2: assinado
insert into public.unidades (id, empreendimento_id, identificador, valor)
select u.id, (select e.id from public.empreendimentos e order by e.slug limit 1), u.ident, 400000
from (values ('f6100000-0000-4000-8000-000000000201'::uuid, 'PORTAL 01'), ('f6100000-0000-4000-8000-000000000202'::uuid, 'PORTAL 02'),
             ('f6100000-0000-4000-8000-000000000203'::uuid, 'PORTAL 03'), ('f6100000-0000-4000-8000-000000000204'::uuid, 'PORTAL 04'),
             ('f6100000-0000-4000-8000-000000000205'::uuid, 'PORTAL 05'))
     as u(id, ident);
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, pdf_assinado_path, assinado_em, enviado_assinatura_em)
select k.id, k.cliente, public.modelo_vigente_id('parcelado'), 'parcelado', k.status::public.status_contrato, k.unidade,
       public.parametros_vigente_id(), 400000, 30, 120000, 20000, 100000, 280000, 60, 8.5, 1808.33, 108500,
       k.pdf, k.assinado, k.enviado
from (values
  ('f6100000-0000-4000-8000-000000000401'::uuid, pg_temp.cliente('c1'), 'rascunho', 'f6100000-0000-4000-8000-000000000201'::uuid,
   null, null::timestamptz, null::timestamptz),
  ('f6100000-0000-4000-8000-000000000402'::uuid, pg_temp.cliente('c1'), 'assinatura_pendente', 'f6100000-0000-4000-8000-000000000202'::uuid,
   null, null, '2026-09-18 10:00:00-03'),
  ('f6100000-0000-4000-8000-000000000403'::uuid, pg_temp.cliente('c1'), 'assinado', 'f6100000-0000-4000-8000-000000000203'::uuid,
   'f6100000-0000-4000-8000-000000000403/assinado-0123abcd.pdf', '2026-09-20 10:00:00-03', '2026-09-19 10:00:00-03'),
  ('f6100000-0000-4000-8000-000000000404'::uuid, pg_temp.cliente('c2'), 'assinado', 'f6100000-0000-4000-8000-000000000204'::uuid,
   'f6100000-0000-4000-8000-000000000404/assinado-0123abcd.pdf', '2026-09-20 10:00:00-03', '2026-09-19 10:00:00-03')
) as k(id, cliente, status, unidade, pdf, assinado, enviado);
-- c1: contrato assinado, com PDF, mas INATIVADO: some do portal (lista e download)
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, pdf_assinado_path, assinado_em, enviado_assinatura_em, inativado_em, motivo_inativacao)
values ('f6100000-0000-4000-8000-000000000405', pg_temp.cliente('c1'), public.modelo_vigente_id('parcelado'), 'parcelado',
  'assinado', 'f6100000-0000-4000-8000-000000000205', public.parametros_vigente_id(), 400000, 30, 120000, 20000, 100000,
  280000, 60, 8.5, 1808.33, 108500, 'f6100000-0000-4000-8000-000000000405/assinado-0123abcd.pdf', '2026-09-21 10:00:00-03',
  '2026-09-19 10:00:00-03', now(), 'lançado em duplicidade');
-- limite de envio configurado pelo Super (menor que o do bucket): o portal recebe para conferir antes de subir
update public.configuracao_geral set documento_max_bytes = 1048576;

create temp table t_ini on commit drop as select coalesce(max(id), 0) as auditoria from public.auditoria;
grant select on t_ini to authenticated;

-- ============ portal_meus_dados ============
select pg_temp.entrar('titular_c1');
select is(public.portal_meus_dados(),
          jsonb_build_object('id', pg_temp.cliente('c1'), 'nome', 'Cliente Um', 'sobrenome', null, 'cpf', '12345670916',
                             'email', 'c1@cliente.test', 'telefone', '11900000001', 'cep', null, 'logradouro', null,
                             'numero', null, 'complemento', null, 'bairro', null, 'cidade', null, 'uf', null),
          'o titular lê os próprios dados (formato PortalMeusDados)');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.categoria = 'acesso' and a.acao = 'consultar' and a.entidade = 'clientes'
             and a.cliente_id = pg_temp.cliente('c1') and a.ator_id = pg_temp.usuario('titular_c1')), 1,
          'leitura dos próprios dados auditada com o cliente titular');
select pg_temp.entrar('ca1a');
select is(public.portal_meus_dados(), null, 'o corretor do cliente não usa o portal: nulo');
select pg_temp.entrar('admin');
select is(public.portal_meus_dados(), null, 'admin também não: nulo (lê pelo CRM, auditado)');
select pg_temp.entrar_uid('a0000000-0000-4000-8000-000000000033');
select is(public.portal_meus_dados(), null, 'cliente PJ não entra no portal (login só por CPF)');
select pg_temp.entrar_uid('a0000000-0000-4000-8000-000000000035');
select is(public.portal_meus_dados(), null, 'portal_liberado = false: nulo (N9)');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'acesso_negado' and a.entidade = 'clientes'
             and a.ator_id in (pg_temp.usuario('ca1a'), pg_temp.usuario('admin'), 'a0000000-0000-4000-8000-000000000033',
                               'a0000000-0000-4000-8000-000000000035')), 4,
          'cada negação registrada (acesso_negado) com quem tentou');
select pg_temp.entrar_anon();
select throws_ok($$select public.portal_meus_dados()$$, '42501', null, 'anon não executa portal_meus_dados');

-- ============ portal_meu_corretor ============
select pg_temp.entrar('titular_c1');
select is(public.portal_meu_corretor(),
          '{"nome":"CA1a Corretor","telefone":null,"email":"ca1a@fixture.test","creci":"CRECI-CA1A","imobiliaria_nome":"Imobiliária A","virtual":false}'::jsonb,
          '"Seu corretor": o responsável atual e a imobiliária');
select pg_temp.entrar_uid('a0000000-0000-4000-8000-000000000034');
select is(public.portal_meu_corretor() ->> 'virtual', 'true', 'cliente da Carteira Arken: virtual (o front mostra a empresa)');
select is(public.portal_meu_corretor() ->> 'imobiliaria_nome', 'Imobiliária Arken', 'imobiliária da casa');
select pg_temp.entrar('ga1');
select is(public.portal_meu_corretor(), null, 'parceiro não usa portal_meu_corretor');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'consultar' and a.entidade = 'parceiros' and a.cliente_id = pg_temp.cliente('c1')), 1,
          'leitura do corretor auditada com o cliente');
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'acesso_negado' and a.entidade = 'parceiros' and a.ator_id = pg_temp.usuario('ga1')), 1,
          'negação do corretor registrada');

-- ============ portal_documentos ============
select pg_temp.entrar('titular_c1');
create temp table t_docs on commit drop as select public.portal_documentos() as d;
select pg_temp.sair();
select is((select jsonb_array_length(d) from t_docs), 3, 'o titular vê os 3 documentos ativos dele (nem os inativados, nem os do c2)');
select is((select array_agg(e ->> 'nome' order by o) from t_docs, jsonb_array_elements(d) with ordinality as x(e, o)),
          array['CNH', 'RG', 'Comprovante de renda'], 'primeiro os que pedem envio (depois por data e nome)');
select is((select array_agg((e ->> 'pode_enviar')::boolean order by o) from t_docs, jsonb_array_elements(d) with ordinality as x(e, o)),
          array[true, true, false], 'pode_enviar só em pendente e rejeitado');
select is((select e ->> 'motivo_rejeicao' from t_docs, jsonb_array_elements(d) e where e ->> 'nome' = 'CNH'),
          'Foto ilegível', 'o titular vê o motivo da rejeição');
select is((select (e ->> 'ultimo_envio_em')::timestamptz from t_docs, jsonb_array_elements(d) e where e ->> 'nome' = 'Comprovante de renda'),
          '2026-09-10 10:00:00-03'::timestamptz, 'data do último envio');
select is((select count(*)::int from t_docs, jsonb_array_elements(d) e
            where e ? 'storage_path' or e ? 'path' or e ? 'arquivo_atual_id' or e::text like '%.pdf%'), 0,
          'SEM caminho de arquivo: o portal só envia, não baixa documento pessoal');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(e) k from t_docs, jsonb_array_elements(d) e) x),
          array['formatos_aceitos', 'id', 'max_bytes', 'motivo_rejeicao', 'nome', 'pode_enviar', 'status', 'tipo', 'ultimo_envio_em'],
          'formato PortalDocumento');
select is((select array_agg(distinct (e ->> 'max_bytes')::int) from t_docs, jsonb_array_elements(d) e), array[1048576],
          'cada documento traz o limite de envio configurado (o portal não sobe o que o servidor recusaria, WP6R-02)');
select pg_temp.entrar_uid('a0000000-0000-4000-8000-000000000035');
select is(public.portal_documentos(), '[]'::jsonb, 'portal fechado: lista vazia');
select pg_temp.entrar('cb1a');
select is(public.portal_documentos(), '[]'::jsonb, 'parceiro: lista vazia');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'listar' and a.entidade = 'cliente_documentos' and a.cliente_id = pg_temp.cliente('c1')
             and (a.detalhe ->> 'quantidade')::int = 3), 1, 'lista de documentos auditada (com a quantidade)');
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'acesso_negado' and a.entidade = 'cliente_documentos'), 2, 'negações registradas');
-- envio pelo portal: o titular pode gravar no caminho do documento aberto (política de INSERT), mas não lê nada
select pg_temp.entrar('titular_c1');
select ok(public.pode_enviar_documento('d0000000-0000-4000-8000-000000000001/f6100000-0000-4000-8000-000000000301/f6100000-0000-4000-8000-000000000399.pdf'),
          'o titular pode enviar o documento pendente dele');
select ok(not public.pode_enviar_documento('d0000000-0000-4000-8000-000000000001/f6100000-0000-4000-8000-000000000303/f6100000-0000-4000-8000-000000000399.pdf'),
          'nem o documento já aprovado');
select ok(not public.pode_enviar_documento('d0000000-0000-4000-8000-000000000002/f6100000-0000-4000-8000-000000000305/f6100000-0000-4000-8000-000000000399.pdf'),
          'nem o documento de outro cliente');
select is((select count(*)::int from storage.objects o where o.bucket_id = 'crm-documentos'), 0,
          'o titular não lê objetos de crm-documentos');
select pg_temp.sair();

-- ============ portal_contratos ============
select pg_temp.entrar('titular_c1');
create temp table t_ctr on commit drop as select public.portal_contratos() as c;
select pg_temp.sair();
select is((select array_agg(e ->> 'status' order by o) from t_ctr, jsonb_array_elements(c) with ordinality as x(e, o)),
          array['assinado', 'assinatura_pendente'], 'só assinatura_pendente e assinado; o rascunho é invisível ao titular');
select is((select count(*)::int from t_ctr, jsonb_array_elements(c) e where e ->> 'id' = 'f6100000-0000-4000-8000-000000000401'), 0,
          'contrato em rascunho não aparece');
select is((select count(*)::int from t_ctr, jsonb_array_elements(c) e where e ->> 'id' = 'f6100000-0000-4000-8000-000000000405'), 0,
          'contrato assinado mas inativado não aparece');
select is((select array_agg((e ->> 'pdf_assinado_disponivel')::boolean order by o) from t_ctr, jsonb_array_elements(c) with ordinality as x(e, o)),
          array[true, false], 'PDF disponível só no assinado');
select ok((select (e -> 'produto' ->> 'tipo') = 'unidade' and (e -> 'produto' ->> 'nome') like '%PORTAL 03'
                  and (e ->> 'valor_imovel')::numeric = 400000 and (e ->> 'valor_parcela')::numeric = 1808.33
                  and (e ->> 'n_parcelas')::int = 60 and (e ->> 'codigo') ~ '^\d+$'
           from t_ctr, jsonb_array_elements(c) e where e ->> 'status' = 'assinado'),
          'produto, valores oficiais e código do contrato');
select is((select count(*)::int from t_ctr, jsonb_array_elements(c) e where e::text like '%.pdf%' or e ? 'pdf_assinado_path'), 0,
          'sem caminho do PDF na lista');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(e) k from t_ctr, jsonb_array_elements(c) e) x),
          array['assinado_em', 'codigo', 'enviado_assinatura_em', 'forma_pagamento', 'id', 'n_parcelas', 'pdf_assinado_disponivel',
                'produto', 'status', 'valor_imovel', 'valor_parcela'], 'formato PortalContrato');
select pg_temp.entrar_uid('a0000000-0000-4000-8000-000000000033');
select is(public.portal_contratos(), '[]'::jsonb, 'PJ: lista vazia');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'listar' and a.entidade = 'contratos' and a.cliente_id = pg_temp.cliente('c1')), 1,
          'lista de contratos auditada');

-- ============ portal_contrato_baixar: só o PDF assinado do próprio contrato ============
select pg_temp.entrar('titular_c1');
select is(public.portal_contrato_baixar('f6100000-0000-4000-8000-000000000403') - 'expira_em',
          '{"bucket":"contratos","path":"f6100000-0000-4000-8000-000000000403/assinado-0123abcd.pdf"}'::jsonb,
          'o titular baixa o PDF assinado do próprio contrato ({bucket, path, expira_em})');
select ok(public.download_autorizado('contratos', 'f6100000-0000-4000-8000-000000000403/assinado-0123abcd.pdf'),
          'autorização curta criada para o titular');
select is(public.portal_contrato_baixar('f6100000-0000-4000-8000-000000000402'), null, 'contrato ainda não assinado: nulo');
select is(public.portal_contrato_baixar('f6100000-0000-4000-8000-000000000401'), null, 'rascunho: nulo');
select is(public.portal_contrato_baixar('f6100000-0000-4000-8000-000000000404'), null, 'contrato de outro cliente: nulo');
select is(public.portal_contrato_baixar('f6100000-0000-4000-8000-000000000405'), null, 'contrato assinado mas inativado: nulo');
select ok(not public.download_autorizado('contratos', 'f6100000-0000-4000-8000-000000000405/assinado-0123abcd.pdf'),
          'nenhuma autorização para o PDF do contrato inativado');
select is(public.portal_contrato_baixar('f6100000-0000-4000-8000-0000000004ff'), null, 'inexistente: nulo (mesma resposta)');
select ok(not public.download_autorizado('contratos', 'f6100000-0000-4000-8000-000000000404/assinado-0123abcd.pdf'),
          'nenhuma autorização para o contrato de outro');
select pg_temp.entrar('ca1a');
select is(public.portal_contrato_baixar('f6100000-0000-4000-8000-000000000403'), null,
          'o corretor não baixa pelo portal (usa contrato_baixar, com escopo)');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'baixar' and a.entidade = 'contratos' and a.entidade_id = 'f6100000-0000-4000-8000-000000000403'
             and a.cliente_id = pg_temp.cliente('c1')), 1, 'a baixa do contrato é registrada');
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.acao = 'acesso_negado' and a.entidade = 'contratos'
             and a.entidade_id in ('f6100000-0000-4000-8000-000000000401', 'f6100000-0000-4000-8000-000000000402',
                                   'f6100000-0000-4000-8000-000000000403', 'f6100000-0000-4000-8000-000000000404',
                                   'f6100000-0000-4000-8000-000000000405', 'f6100000-0000-4000-8000-0000000004ff')), 6,
          'cada tentativa negada registrada');

-- ============ portal_localizar_cliente (só service_role; login só por CPF) ============
select pg_temp.entrar('admin');
select throws_ok($$select * from public.portal_localizar_cliente('12345670916')$$, '42501', null,
                 'authenticated (nem admin) não executa portal_localizar_cliente');
select pg_temp.entrar_anon();
select throws_ok($$select * from public.portal_localizar_cliente('12345670916')$$, '42501', null, 'anon também não');
select pg_temp.entrar_servico();
select results_eq($$select id, nome, user_id from public.portal_localizar_cliente('123.456.709-16')$$,
                  $$values ('d0000000-0000-4000-8000-000000000001'::uuid, 'Cliente Um'::text, 'a0000000-0000-4000-8000-000000000031'::uuid)$$,
                  'service role localiza o cliente liberado pelo CPF (com ou sem máscara)');
select results_eq($$select id, nome, user_id from public.portal_localizar_cliente('12345671483')$$,
                  $$values ('d6000000-0000-4000-8000-000000000012'::uuid, 'Cliente Seis'::text, 'a0000000-0000-4000-8000-000000000034'::uuid)$$,
                  'cliente da Carteira Arken liberado também');
select is((select count(*)::int from public.portal_localizar_cliente('12345671050')), 0, 'portal_liberado = false: não encontra');
select is((select count(*)::int from public.portal_localizar_cliente('12345671130')), 0, 'cliente inativado: não encontra');
select is((select count(*)::int from public.portal_localizar_cliente('11222335000170')), 0, 'CNPJ (PJ): não encontra');
select is((select count(*)::int from public.portal_localizar_cliente('12345670910')), 0, 'CPF com dígito errado: não encontra');
select is((select count(*)::int from public.portal_localizar_cliente(null)), 0, 'nulo: não encontra');
select is((select count(*)::int from public.portal_localizar_cliente('99999999999')), 0, 'CPF inexistente: não encontra');
select pg_temp.sair();
update public.clientes set anonimizado_em = now(), cpf = null, nome = 'Titular anonimizado #abcdef' where id = pg_temp.cliente('c4');
update public.clientes set portal_liberado = true where id = pg_temp.cliente('c5');
select pg_temp.entrar_servico();
select is((select count(*)::int from public.portal_localizar_cliente('12345671211')), 0, 'anonimizado: não encontra');
select is((select count(*)::int from public.portal_localizar_cliente('12345671300')), 1, 'liberado depois: passa a encontrar');
select pg_temp.sair();

-- ============ sem dado pessoal na auditoria do portal ============
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and (a::text like any (array['%12345670916%', '%@cliente.test%', '%Cliente Um%', '%Foto ilegível%',
                                          '%assinado-0123abcd%', '%fixture.test%']))), 0,
          'os registros do portal não guardam CPF, e-mail, nome, motivo nem caminho');
select is((select count(*)::int from public.auditoria a where a.id > (select auditoria from t_ini)
             and a.detalhe ->> 'portal' is distinct from 'true'), 0, 'todo registro do portal marcado detalhe.portal = true');

select * from finish();
rollback;
