-- LGPD do WP6 (docs/ARQUITETURA_EXPANSAO.md §5.4, §5.5, §8.5, H4): termos versionados, aceite e revogação de
-- consentimento, anonimização a pedido do titular (zera o pessoal, PRESERVA valores e datas de contratos, vínculos e
-- eventos; depois dela o portal não encontra o CPF). Cada RPC: negação fora do escopo e auditoria gravada.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(100);

-- ============ DADOS DESTE TESTE (como postgres) ============
-- titular_c2: usuário do portal do c2 (liberado só aqui, para provar que a anonimização fecha o portal)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('a0000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cliente-d0000000-0000-4000-8000-000000000002@portal.arkenincorporadora.com.br', '{"nome":"Cliente Dois"}', now(), now());
update public.profiles set papel = 'cliente', nome = 'Cliente Dois', cpf = '12345671050', telefone = '11900000002'
 where id = 'a0000000-0000-4000-8000-000000000032';
update public.clientes
   set user_id = 'a0000000-0000-4000-8000-000000000032', portal_liberado = true, sobrenome = 'Silva', rg = '1234567',
       cep = '01001000', logradouro = 'Rua Um', numero = '10', cidade = 'São Paulo', uf = 'SP',
       data_nascimento = '1980-01-01', estado_civil = 'casado', interesses = array['Apartamento']
 where id = pg_temp.cliente('c2');

-- unidades para os contratos
insert into public.unidades (id, empreendimento_id, identificador, valor)
select u.id, (select e.id from public.empreendimentos e order by e.slug limit 1), u.ident, 400000
from (values ('f6000000-0000-4000-8000-000000000201'::uuid, 'LGPD 01'), ('f6000000-0000-4000-8000-000000000202'::uuid, 'LGPD 02')) as u(id, ident);

-- c2: contrato ASSINADO (valores e datas precisam sobreviver à anonimização) e os signatários
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, pdf_assinado_path, assinado_em, enviado_assinatura_em)
values ('f6000000-0000-4000-8000-000000000401', pg_temp.cliente('c2'), public.modelo_vigente_id('parcelado'), 'parcelado',
  'assinado', 'f6000000-0000-4000-8000-000000000201', public.parametros_vigente_id(),
  400000, 30, 120000, 20000, 100000, 280000, 60, 8.5, 1808.33, 108500,
  'f6000000-0000-4000-8000-000000000401/assinado-0123abcd.pdf', '2026-09-20 10:00:00-03', '2026-09-19 10:00:00-03');
insert into public.contrato_signatarios (contrato_id, ordem, papel, nome, email, status, assinado_em) values
  ('f6000000-0000-4000-8000-000000000401', 1, 'cliente', 'Cliente Dois', 'c2@cliente.test', 'assinado', '2026-09-20 10:00:00-03'),
  ('f6000000-0000-4000-8000-000000000401', 2, 'representante_arken', 'Representante Arken', 'rep@arken.test', 'assinado', '2026-09-20 10:00:00-03');
-- c3: contrato aguardando assinatura (a anonimização precisa recusar)
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, enviado_assinatura_em)
values ('f6000000-0000-4000-8000-000000000402', pg_temp.cliente('c3'), public.modelo_vigente_id('parcelado'), 'parcelado',
  'assinatura_pendente', 'f6000000-0000-4000-8000-000000000202', public.parametros_vigente_id(),
  400000, 30, 120000, 20000, 100000, 280000, 60, 8.5, 1808.33, 108500, now());

-- c2: notas, tarefa, documentos (um com arquivo, um rejeitado), timeline, histórico, lead, legado, proposta, fila
insert into public.cliente_notas (cliente_id, texto, autor_id) values
  (pg_temp.cliente('c2'), 'Cliente Dois ligou do 11900000002, mora na Rua Um', pg_temp.usuario('ca2a')),
  (pg_temp.cliente('c2'), 'Prefere contato à tarde', pg_temp.usuario('ca2a'));
insert into public.cliente_tarefas (cliente_id, titulo, descricao, responsavel_id) values
  (pg_temp.cliente('c2'), 'Ligar para a Cliente Dois', 'Confirmar RG 1234567', pg_temp.usuario('ca2a'));
insert into public.cliente_documentos (id, cliente_id, nome, status, motivo_rejeicao) values
  ('f6000000-0000-4000-8000-000000000301', pg_temp.cliente('c2'), 'CPF', 'em_analise', null),
  ('f6000000-0000-4000-8000-000000000302', pg_temp.cliente('c2'), 'CNH', 'rejeitado', 'Foto da CNH de Cliente Dois ilegível');
insert into public.cliente_documento_arquivos (id, documento_id, storage_path, mime_type, tamanho_bytes) values
  ('f6000000-0000-4000-8000-000000000311', 'f6000000-0000-4000-8000-000000000301',
   'd0000000-0000-4000-8000-000000000002/f6000000-0000-4000-8000-000000000301/f6000000-0000-4000-8000-000000000321.pdf',
   'application/pdf', 1000);
update public.cliente_documentos set arquivo_atual_id = 'f6000000-0000-4000-8000-000000000311'
 where id = 'f6000000-0000-4000-8000-000000000301';
-- objetos no bucket (WP6R-02): o registrado, dois SEM linha em cliente_documento_arquivos (upload feito, registro do
-- envio recusado depois — um deles com o prefixo em maiúsculas) e um de OUTRO cliente, que nunca pode ser devolvido
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('crm-documentos', 'd0000000-0000-4000-8000-000000000002/f6000000-0000-4000-8000-000000000301/f6000000-0000-4000-8000-000000000321.pdf',
   'a0000000-0000-4000-8000-000000000032', '{"size": 1000, "mimetype": "application/pdf"}'),
  ('crm-documentos', 'd0000000-0000-4000-8000-000000000002/f6000000-0000-4000-8000-000000000302/f6000000-0000-4000-8000-000000000399.pdf',
   'a0000000-0000-4000-8000-000000000032', '{"size": 4900000, "mimetype": "application/pdf"}'),
  ('crm-documentos', 'D0000000-0000-4000-8000-000000000002/F6000000-0000-4000-8000-000000000302/F6000000-0000-4000-8000-000000000398.png',
   'a0000000-0000-4000-8000-000000000032', '{"size": 900, "mimetype": "image/png"}'),
  ('crm-documentos', 'd0000000-0000-4000-8000-000000000001/f6000000-0000-4000-8000-000000000302/f6000000-0000-4000-8000-000000000397.pdf',
   pg_temp.usuario('titular_c1'), '{"size": 900, "mimetype": "application/pdf"}');
insert into public.cliente_eventos (cliente_id, tipo, titulo, dados) values
  (pg_temp.cliente('c2'), 'cadastro', 'Cliente cadastrado', '{}'),
  (pg_temp.cliente('c2'), 'contrato_assinado', 'Contrato assinado', '{"contrato_id":"f6000000-0000-4000-8000-000000000401"}');
insert into public.historico_status (entidade, entidade_id, de, para, origem) values
  ('contrato', 'f6000000-0000-4000-8000-000000000401', 'assinatura_pendente', 'assinado', 'webhook');
insert into public.leads (id, nome, email, telefone, mensagem, status, cliente_id) values
  ('f6000000-0000-4000-8000-000000000501', 'Cliente Dois', 'c2@cliente.test', '11900000002', 'Quero o apto', 'convertido',
   pg_temp.cliente('c2'));
insert into public.legado_parceiro_clientes (id, parceiro_id, nome, rg, cpf, telefone, anotacoes) values
  ('f6000000-0000-4000-8000-000000000601', pg_temp.usuario('ca2a'), 'Cliente Dois', '1234567', '123.456.710-50',
   '11900000002', 'mora na Rua Um'),
  -- linha legada SEM CPF, ligada ao c2 só pelo mapa do corte (migracao_parceiro_clientes)
  ('f6000000-0000-4000-8000-000000000602', pg_temp.usuario('ca2a'), 'Dois (sem CPF)', null, null,
   '11900000002', 'telefone do trabalho: 1133334444');
insert into public.migracao_parceiro_clientes (parceiro_cliente_id, cliente_id, resultado) values
  ('f6000000-0000-4000-8000-000000000602', pg_temp.cliente('c2'), 'juntado');
-- portal antigo (WP7R1-03): arquivos e negócios do c2 (o nome do arquivo traz o nome do titular) e os do c1, que nunca
-- podem ser tocados; no bucket cliente-arquivos: o objeto registrado do c2, um SEM linha em cliente_arquivos e um do c1
insert into public.cliente_negocios (id, cliente_id, descricao, status, valor) values
  ('f6000000-0000-4000-8000-000000000801', pg_temp.cliente('c2'), 'Apto 302 para Cliente Dois, financiado com o sogro', 'ativo', 400000),
  ('f6000000-0000-4000-8000-000000000802', pg_temp.cliente('c1'), 'Apto do Cliente Um', 'ativo', 300000);
insert into public.cliente_arquivos (id, cliente_id, negocio_id, nome, storage_path) values
  ('f6000000-0000-4000-8000-000000000811', pg_temp.cliente('c2'), 'f6000000-0000-4000-8000-000000000801',
   'Contrato Cliente Dois.pdf', 'd0000000-0000-4000-8000-000000000002/contrato-cliente-dois.pdf'),
  ('f6000000-0000-4000-8000-000000000812', pg_temp.cliente('c1'), 'f6000000-0000-4000-8000-000000000802',
   'Contrato Cliente Um.pdf', 'd0000000-0000-4000-8000-000000000001/contrato-cliente-um.pdf');
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('cliente-arquivos', 'd0000000-0000-4000-8000-000000000002/contrato-cliente-dois.pdf', pg_temp.usuario('admin'), '{"size": 1000}'),
  ('cliente-arquivos', 'd0000000-0000-4000-8000-000000000002/boleto-sem-registro.pdf', pg_temp.usuario('admin'), '{"size": 900}'),
  ('cliente-arquivos', 'd0000000-0000-4000-8000-000000000001/contrato-cliente-um.pdf', pg_temp.usuario('admin'), '{"size": 900}');
insert into public.propostas (id, parceiro_id, empreendimento_id, cliente_id, texto, resposta_admin) values
  ('f6000000-0000-4000-8000-000000000701', pg_temp.usuario('ca2a'),
   (select e.id from public.empreendimentos e order by e.slug limit 1), pg_temp.cliente('c2'),
   'Cliente Dois, CPF 123.456.710-50, quer o LGPD 01', 'Cliente Dois precisa de fiador: renda de 11900000002 não comprovada');
insert into public.notificacoes (tipo, destinatarios_ids, cliente_id, dados) values
  ('crm.documento_rejeitado', '{}', pg_temp.cliente('c2'), '{"documento_id":"f6000000-0000-4000-8000-000000000302"}'),
  ('crm.documento_rejeitado', '{}', pg_temp.cliente('c5'), '{"documento_id":"f6000000-0000-4000-8000-000000000302"}');

create temp table t_antes on commit drop as
select (select count(*) from public.cliente_vinculos_historico where cliente_id = pg_temp.cliente('c2')) as vinculos,
       (select count(*) from public.cliente_eventos where cliente_id = pg_temp.cliente('c2')) as eventos,
       (select count(*) from public.historico_status) as historico,
       (select coalesce(max(id), 0) from public.auditoria) as auditoria;
grant select on t_antes to authenticated, anon, service_role;

-- ============ lgpd_termo_vigente (anon) ============
select pg_temp.entrar_anon();
select is(public.lgpd_termo_vigente('consentimento_cliente') ->> 'versao', '0-provisória',
          'anon lê o termo vigente (versão provisória da semente)');
select is((public.lgpd_termo_vigente('termos_parceiro') ->> 'revisado_juridico')::boolean, false,
          'o termo vigente diz se foi revisado pelo jurídico (H4)');
select is(public.lgpd_termo_vigente('outro'), null, 'tipo desconhecido: nulo');
select throws_ok($$select public.lgpd_publicar_termo('termos_parceiro', '9', repeat('x', 30), true)$$, '42501', null,
                 'anon não publica termo (sem grant)');

-- ============ lgpd_publicar_termo (só o Super) ============
select pg_temp.entrar('ca1a');
select throws_ok($$select public.lgpd_publicar_termo('termos_parceiro', '1.0', repeat('Termo de parceiro. ', 5), true)$$,
                 '42501', 'Sem acesso a este registro', 'corretor não publica termo');
select pg_temp.entrar('admin');
select throws_ok($$select public.lgpd_publicar_termo('termos_parceiro', '1.0', repeat('Termo de parceiro. ', 5), true)$$,
                 '42501', 'Sem acesso a este registro', 'admin não publica termo (só o Super)');
select pg_temp.entrar('super');
select is(pg_temp.erro($$select public.lgpd_publicar_termo('outro', '1.0', repeat('Termo de parceiro. ', 5), true)$$) -> 'detalhe',
          '{"campos":["tipo"]}'::jsonb, 'tipo inválido: DADOS_INVALIDOS {campos:[tipo]}');
select is(pg_temp.erro($$select public.lgpd_publicar_termo('termos_parceiro', '1.0', 'curto', true)$$) -> 'detalhe',
          '{"campos":["texto"]}'::jsonb, 'texto curto: DADOS_INVALIDOS {campos:[texto]}');
select is(pg_temp.erro($$select public.lgpd_publicar_termo('termos_parceiro', '  ', repeat('Termo de parceiro. ', 5), true)$$) -> 'detalhe',
          '{"campos":["versao"]}'::jsonb, 'versão vazia: DADOS_INVALIDOS {campos:[versao]}');
select lives_ok($$select public.lgpd_publicar_termo('termos_parceiro', '1.0', repeat('Termo de parceiro. ', 5), true)$$,
                'Super publica a versão 1.0 dos termos de parceiro');
select throws_ok($$select public.lgpd_publicar_termo('termos_parceiro', '1.0', repeat('Outro texto de termo. ', 5), true)$$,
                 'P0001', 'Já existe uma versão com esse nome para este termo.', 'mesma versão de novo: recusada');
select pg_temp.sair();
select is((select t.versao from public.lgpd_termos t where t.id = public._termo_vigente_id('termos_parceiro')), '1.0',
          'a versão publicada passa a ser a vigente');
select is((select count(*)::int from public.auditoria a where a.categoria = 'lgpd' and a.acao = 'criar'
             and a.entidade = 'lgpd_termos' and a.ator_id = pg_temp.usuario('super')
             and a.depois = '{"tipo":"termos_parceiro","versao":"1.0","revisado_juridico":true}'::jsonb
             and not (a.depois ? 'texto')), 1,
          'publicação auditada (lgpd/criar) com tipo, versão e revisão, sem o texto');

-- ============ lgpd_aceitar_termo ============
select pg_temp.entrar('ca1a');
select ok(public.meu_escopo() -> 'pendencias' ? 'termo', 'termo novo: o corretor volta a ter a pendência "termo"');
select throws_ok(format('select public.lgpd_aceitar_termo(%L)',
                        (select t.id from public.lgpd_termos t where t.tipo = 'termos_parceiro' and t.versao = '0-provisória')),
                 'P0001', 'TERMO_DESATUALIZADO', 'aceitar versão antiga: TERMO_DESATUALIZADO');
select throws_ok($$select public.lgpd_aceitar_termo('f6000000-0000-4000-8000-0000000000ff')$$,
                 'P0001', 'TERMO_DESATUALIZADO', 'termo inexistente: TERMO_DESATUALIZADO');
select lives_ok(format('select public.lgpd_aceitar_termo(%L)', public.lgpd_termo_vigente('termos_parceiro') ->> 'id'),
                'o corretor aceita o termo vigente');
select lives_ok(format('select public.lgpd_aceitar_termo(%L)', public.lgpd_termo_vigente('termos_parceiro') ->> 'id'),
                'aceitar de novo não falha (idempotente)');
select ok(not (public.meu_escopo() -> 'pendencias' ? 'termo'), 'depois do aceite a pendência some');
select pg_temp.sair();
select is((select count(*)::int from public.lgpd_consentimentos c
            where c.profile_id = pg_temp.usuario('ca1a') and c.termo_id = public._termo_vigente_id('termos_parceiro')
              and c.titular = 'parceiro' and c.origem = 'cadastro_parceiro' and c.revogado_em is null), 1,
          'um único consentimento de parceiro gravado (origem cadastro_parceiro)');
select is((select count(*)::int from public.auditoria a where a.categoria = 'lgpd' and a.acao = 'aceitar'
             and a.ator_id = pg_temp.usuario('ca1a') and a.detalhe ->> 'versao' = '1.0'), 1,
          'aceite auditado uma vez (lgpd/aceitar) com a versão');
select pg_temp.entrar('admin');
select throws_ok(format('select public.lgpd_aceitar_termo(%L)', public.lgpd_termo_vigente('termos_parceiro') ->> 'id'),
                 '42501', 'Sem acesso a este registro', 'interno não aceita termo de parceiro');
select pg_temp.entrar('ca1a');
select throws_ok(format('select public.lgpd_aceitar_termo(%L)', public.lgpd_termo_vigente('consentimento_cliente') ->> 'id'),
                 '42501', 'Sem acesso a este registro', 'parceiro não aceita o consentimento de cliente');
select pg_temp.entrar('titular_c1');
select throws_ok(format('select public.lgpd_aceitar_termo(%L)', public.lgpd_termo_vigente('termos_parceiro') ->> 'id'),
                 '42501', 'Sem acesso a este registro', 'o titular não aceita termo de parceiro');
select lives_ok(format('select public.lgpd_aceitar_termo(%L)', public.lgpd_termo_vigente('consentimento_cliente') ->> 'id'),
                'o titular aceita o consentimento vigente pelo portal');
select pg_temp.sair();
select is((select count(*)::int from public.lgpd_consentimentos c
            where c.cliente_id = pg_temp.cliente('c1') and c.origem = 'portal' and c.titular = 'cliente'
              and c.profile_id = pg_temp.usuario('titular_c1')), 1,
          'consentimento do portal gravado com o cliente do titular');
select is((select count(*)::int from public.cliente_eventos e
            where e.cliente_id = pg_temp.cliente('c1') and e.tipo = 'consentimento'), 1,
          'aceite do portal entra na timeline do cliente');
select is((select count(*)::int from public.auditoria a where a.acao = 'aceitar' and a.cliente_id = pg_temp.cliente('c1')), 1,
          'aceite do portal auditado com o cliente titular');

-- ============ lgpd_revogar_consentimento (só o Super) ============
create temp table t_consent on commit drop as
select (select c.id from public.lgpd_consentimentos c where c.cliente_id = pg_temp.cliente('c5')) as c5,
       (select c.id from public.lgpd_consentimentos c
         where c.profile_id = pg_temp.usuario('ca1a') and c.termo_id = public._termo_vigente_id('termos_parceiro')) as ca1a;
grant select on t_consent to authenticated;
select pg_temp.entrar('admin');
select throws_ok(format('select public.lgpd_revogar_consentimento(%L, %L)', (select c5 from t_consent), 'pedido do titular'),
                 '42501', 'Sem acesso a este registro', 'admin não revoga consentimento');
select pg_temp.entrar('ga1');
select throws_ok(format('select public.lgpd_revogar_consentimento(%L, %L)', (select c5 from t_consent), 'pedido do titular'),
                 '42501', 'Sem acesso a este registro', 'gerente não revoga consentimento (nem do cliente da equipe)');
select pg_temp.entrar('super');
select throws_ok($$select public.lgpd_revogar_consentimento('f6000000-0000-4000-8000-0000000000ff', 'pedido do titular')$$,
                 '42501', 'Sem acesso a este registro', 'consentimento inexistente: 42501');
select throws_ok(format('select public.lgpd_revogar_consentimento(%L, %L)', (select c5 from t_consent), ' x '),
                 'P0001', 'MOTIVO_OBRIGATORIO', 'revogação sem motivo: MOTIVO_OBRIGATORIO');
select lives_ok(format('select public.lgpd_revogar_consentimento(%L, %L)', (select c5 from t_consent), 'Pedido do titular por e-mail'),
                'Super revoga o consentimento do c5');
select throws_ok(format('select public.lgpd_revogar_consentimento(%L, %L)', (select c5 from t_consent), 'de novo'),
                 'P0001', 'Este consentimento já foi revogado.', 'revogar duas vezes: recusado');
select lives_ok(format('select public.lgpd_revogar_consentimento(%L, %L)', (select ca1a from t_consent), 'Descredenciamento'),
                'Super revoga o aceite do termo do corretor');
select pg_temp.sair();
select ok((select c.revogado_em is not null and c.revogado_por = pg_temp.usuario('super')
             and c.motivo_revogacao = 'Pedido do titular por e-mail'
           from public.lgpd_consentimentos c where c.id = (select c5 from t_consent)),
          'revogação preenche revogado_em, revogado_por e o motivo');
select is((select n.status::text from public.notificacoes n where n.cliente_id = pg_temp.cliente('c5')), 'ignorado',
          'sem consentimento ativo, o e-mail pendente para o cliente é ignorado');
select pg_temp.como('ca1a');
create temp table t_fila_c5 on commit drop as
select public._notificar('crm.documento_rejeitado', '{}', pg_temp.cliente('c5'), '{}') as id;
select is((select n.status::text from public.notificacoes n where n.id = (select id from t_fila_c5)), 'ignorado',
          'e-mail novo para o cliente revogado já entra como ignorado');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.categoria = 'lgpd' and a.acao = 'revogar'
             and a.cliente_id = pg_temp.cliente('c5') and a.ator_id = pg_temp.usuario('super')
             and a.detalhe::text not like '%Pedido do titular%'), 1,
          'revogação auditada com o cliente, sem o texto livre do motivo');
select pg_temp.entrar('ca1a');
select ok(public.meu_escopo() -> 'pendencias' ? 'termo', 'parceiro com aceite revogado volta a ter a pendência "termo"');
select pg_temp.sair();
select is((select count(*)::int from public.clientes c where c.id = pg_temp.cliente('c5') and c.anonimizado_em is null
             and c.cpf is not null), 1, 'revogar não apaga o cliente');

-- ============ lgpd_anonimizar_cliente: quem pode ============
select pg_temp.entrar_anon();
select throws_ok(format('select public.lgpd_anonimizar_cliente(%L, %L)', pg_temp.cliente('c2'), 'LGPD-2026-001'), '42501', null,
                 'anon não executa a anonimização (sem grant)');
select pg_temp.entrar_servico();
select throws_ok(format('select public.lgpd_anonimizar_cliente(%L, %L)', pg_temp.cliente('c2'), 'LGPD-2026-001'), '42501', null,
                 'service_role também não (a Edge chama com o JWT do Super)');
select pg_temp.entrar('ca2a');
select throws_ok(format('select public.lgpd_anonimizar_cliente(%L, %L)', pg_temp.cliente('c2'), 'LGPD-2026-001'),
                 '42501', 'Sem acesso a este registro', 'o corretor do cliente não anonimiza');
select pg_temp.entrar('admin');
select throws_ok(format('select public.lgpd_anonimizar_cliente(%L, %L)', pg_temp.cliente('c2'), 'LGPD-2026-001'),
                 '42501', 'Sem acesso a este registro', 'admin não anonimiza (só o Super)');
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = true;
select pg_temp.entrar('super');
select throws_ok(format('select public.lgpd_anonimizar_cliente(%L, %L)', pg_temp.cliente('c2'), 'LGPD-2026-001'),
                 '42501', 'Sem acesso a este registro', 'com 2FA exigida, o Super em aal1 não anonimiza (H5)');
select pg_temp.entrar('super', 'aal2');
select is(pg_temp.erro(format('select public.lgpd_anonimizar_cliente(%L, %L)', pg_temp.cliente('c2'), 'a b')) -> 'detalhe',
          '{"campos":["protocolo"]}'::jsonb, 'protocolo inválido: DADOS_INVALIDOS {campos:[protocolo]}');
select throws_ok($$select public.lgpd_anonimizar_cliente('d0000000-0000-4000-8000-0000000000ff', 'LGPD-2026-001')$$,
                 '42501', 'Sem acesso a este registro', 'cliente inexistente: 42501');
select throws_ok(format('select public.lgpd_anonimizar_cliente(%L, %L)', pg_temp.cliente('c3'), 'LGPD-2026-002'),
                 'P0001', 'Há contrato aguardando assinatura. Cancele o envio ou aguarde a conclusão antes de anonimizar.',
                 'contrato em assinatura_pendente: recusa');

-- ============ lgpd_anonimizar_cliente: efeito ============
create temp table t_anon on commit drop as
select public.lgpd_anonimizar_cliente(pg_temp.cliente('c2'), 'LGPD-2026-001') as r;
select pg_temp.sair();
update public.configuracao_geral set exigir_mfa_interno = false;

select is((select r from t_anon),
          jsonb_build_object('paths', jsonb_build_array(
                               'D0000000-0000-4000-8000-000000000002/F6000000-0000-4000-8000-000000000302/F6000000-0000-4000-8000-000000000398.png',
                               'd0000000-0000-4000-8000-000000000002/f6000000-0000-4000-8000-000000000301/f6000000-0000-4000-8000-000000000321.pdf',
                               'd0000000-0000-4000-8000-000000000002/f6000000-0000-4000-8000-000000000302/f6000000-0000-4000-8000-000000000399.pdf'),
                             'paths_portal', jsonb_build_array(
                               'd0000000-0000-4000-8000-000000000002/boleto-sem-registro.pdf',
                               'd0000000-0000-4000-8000-000000000002/contrato-cliente-dois.pdf'),
                             'user_id', 'a0000000-0000-4000-8000-000000000032'),
          'devolve os caminhos a apagar no Storage (registrados E os objetos sem registro sob o prefixo do cliente, sem repetir; crm-documentos em paths e cliente-arquivos em paths_portal) e o usuário do portal');
select is((select count(*)::int from t_anon, jsonb_array_elements_text(r -> 'paths') p
            where lower(p) not like 'd0000000-0000-4000-8000-000000000002/%'), 0,
          'nenhum caminho de outro cliente (o objeto do c1 no mesmo bucket fica de fora)');
select ok((select c.nome ~ '^Titular anonimizado #[0-9a-f]{6}$' and c.sobrenome is null and c.cpf is null and c.cnpj is null
                  and c.rg is null and c.email is null and c.telefone is null and c.cep is null and c.logradouro is null
                  and c.numero is null and c.cidade is null and c.uf is null and c.data_nascimento is null
                  and c.estado_civil is null and c.interesses = '{}'
           from public.clientes c where c.id = pg_temp.cliente('c2')),
          'cadastro: nome trocado e documentos, contatos, endereço, nascimento e interesses anulados');
select ok((select c.anonimizado_em is not null and c.inativado_em is not null and not c.portal_liberado
                  and c.inativado_por = pg_temp.usuario('super')
           from public.clientes c where c.id = pg_temp.cliente('c2')),
          'anonimizado_em, inativado_em (pelo Super) e portal fechado');
select ok((select c.corretor_id = pg_temp.parceiro('ca2a') and c.etapa = 'novo_contato'
           from public.clientes c where c.id = pg_temp.cliente('c2')),
          'a cadeia e a etapa do cliente ficam');
select is((select count(*)::int from public.cliente_notas n where n.cliente_id = pg_temp.cliente('c2')
             and n.texto = '[removido — LGPD]' and n.removido_lgpd), 2, 'as notas viram "[removido — LGPD]"');
select ok((select t.titulo = '[removido — LGPD]' and t.descricao = '[removido — LGPD]' and t.removido_lgpd
           from public.cliente_tarefas t where t.cliente_id = pg_temp.cliente('c2')),
          'título e descrição da tarefa removidos');
select is((select d.motivo_rejeicao from public.cliente_documentos d where d.id = 'f6000000-0000-4000-8000-000000000302'),
          '[removido — LGPD]', 'motivo livre da rejeição removido');
select ok((select a.removido_em is not null from public.cliente_documento_arquivos a
            where a.id = 'f6000000-0000-4000-8000-000000000311'), 'arquivo do documento marcado como removido');
select ok((select a.nome = '[removido — LGPD]' and a.storage_path = 'removido-lgpd/' || a.id::text
           from public.cliente_arquivos a where a.id = 'f6000000-0000-4000-8000-000000000811'),
          'portal antigo: nome e caminho do arquivo do titular removidos (o nome trazia o nome dele)');
select ok((select n.descricao = '[removido — LGPD]' and n.valor = 400000 and n.status = 'ativo'
           from public.cliente_negocios n where n.id = 'f6000000-0000-4000-8000-000000000801'),
          'portal antigo: descrição livre do negócio removida; valor e status ficam');
select ok((select a.nome = 'Contrato Cliente Um.pdf' and a.storage_path like 'd0000000-0000-4000-8000-000000000001/%'
           from public.cliente_arquivos a where a.id = 'f6000000-0000-4000-8000-000000000812')
          and (select n.descricao = 'Apto do Cliente Um' from public.cliente_negocios n where n.id = 'f6000000-0000-4000-8000-000000000802'),
          'arquivo e negócio de outro cliente não são tocados');
select is((select (a.detalhe ->> 'arquivos_portal')::int * 100 + (a.detalhe ->> 'negocios')::int from public.auditoria a
            where a.acao = 'anonimizar' and a.cliente_id = pg_temp.cliente('c2') and a.detalhe ? 'negocios'), 201,
          'auditoria: 2 arquivos do portal e 1 negócio (contagens, sem nomes)');
select ok((select l.nome ~ '^Titular anonimizado' and l.email is null and l.telefone is null and l.mensagem is null
           from public.leads l where l.id = 'f6000000-0000-4000-8000-000000000501'), 'lead convertido anonimizado');
select ok((select p.nome ~ '^Titular anonimizado' and p.cpf is null and p.rg is null and p.telefone = '' and p.anotacoes is null
           from public.legado_parceiro_clientes p where p.id = 'f6000000-0000-4000-8000-000000000601'),
          'linha legada (legado_parceiro_clientes) com o mesmo CPF anonimizada');
select ok((select p.nome ~ '^Titular anonimizado' and p.cpf is null and p.telefone = '' and p.anotacoes is null
           from public.legado_parceiro_clientes p where p.id = 'f6000000-0000-4000-8000-000000000602'),
          'linha legada ligada só pelo mapa do corte (sem CPF) também anonimizada');
select is((select array[p.texto, p.resposta_admin] from public.propostas p where p.id = 'f6000000-0000-4000-8000-000000000701'),
          array['[removido — LGPD]', '[removido — LGPD]'], 'texto e resposta livres da proposta do cliente removidos');
select ok((select s.nome ~ '^Titular anonimizado' and s.email ~ '^titular-[0-9a-f]{6}-[0-9a-f]{8}@anonimizado\.invalid$'
           from public.contrato_signatarios s
           where s.contrato_id = 'f6000000-0000-4000-8000-000000000401' and s.papel = 'cliente'),
          'signatário titular anonimizado');
select is((select s.email from public.contrato_signatarios s
            where s.contrato_id = 'f6000000-0000-4000-8000-000000000401' and s.papel = 'representante_arken'),
          'rep@arken.test', 'o signatário da Arken fica');
select ok((select k.status = 'assinado' and k.valor_imovel = 400000 and k.valor_parcela = 1808.33 and k.n_parcelas = 60
                  and k.valor_total_parcelas = 108500 and k.assinado_em = '2026-09-20 10:00:00-03'
                  and k.pdf_assinado_path = 'f6000000-0000-4000-8000-000000000401/assinado-0123abcd.pdf'
           from public.contratos k where k.id = 'f6000000-0000-4000-8000-000000000401'),
          'PRESERVA status, valores, datas e o PDF assinado do contrato');
select is((select count(*) from public.cliente_vinculos_historico where cliente_id = pg_temp.cliente('c2')),
          (select vinculos from t_antes), 'PRESERVA o histórico de vínculos');
select is((select count(*) from public.cliente_eventos where cliente_id = pg_temp.cliente('c2')),
          (select eventos from t_antes), 'PRESERVA a timeline (sem dado pessoal)');
select is((select count(*) from public.historico_status), (select historico from t_antes), 'PRESERVA o historico_status');
select is((select count(*)::int from public.lgpd_consentimentos c
            where c.cliente_id = pg_temp.cliente('c2') and c.revogado_em is null), 0,
          'consentimentos do titular revogados');
select is((select n.status::text from public.notificacoes n where n.cliente_id = pg_temp.cliente('c2')), 'ignorado',
          'e-mail pendente para o titular ignorado');
select ok((select pr.nome ~ '^Titular anonimizado' and pr.cpf is null and pr.telefone is null
           from public.profiles pr where pr.id = 'a0000000-0000-4000-8000-000000000032'),
          'perfil do portal sem nome, CPF e telefone');
select pg_temp.entrar_servico();
select is((select count(*)::int from public.portal_localizar_cliente('12345671050')), 0,
          'depois da anonimização o portal não encontra o CPF antigo');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a
            where a.categoria = 'lgpd' and a.acao = 'anonimizar' and a.cliente_id = pg_temp.cliente('c2')
              and a.ator_id = pg_temp.usuario('super') and 'cpf' = any (a.campos)
              and a.detalhe ->> 'protocolo' = 'LGPD-2026-001' and (a.detalhe ->> 'arquivos')::int = 3
              and (a.detalhe ->> 'arquivos_marcados')::int = 1
              and a.antes is null and a.depois is null), 1,
          'anonimização auditada: nomes dos campos, contagens e protocolo (sem valores)');

-- repetição (a Edge tenta de novo depois de uma falha no Storage): nada muda, devolve de novo o que apagar
select pg_temp.entrar('super');
select is(public.lgpd_anonimizar_cliente(pg_temp.cliente('c2'), 'LGPD-2026-001'), (select r from t_anon),
          'repetição devolve os mesmos caminhos e usuário');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria a where a.acao = 'anonimizar' and a.cliente_id = pg_temp.cliente('c2')
             and (a.detalhe ->> 'repeticao')::boolean), 1, 'repetição também auditada');
select pg_temp.como('ca2a');
create temp table t_fila_c2 on commit drop as
select public._notificar('crm.documento_rejeitado', '{}', pg_temp.cliente('c2'), '{}') as id;
select is((select n.status::text from public.notificacoes n where n.id = (select id from t_fila_c2)), 'ignorado',
          'e-mail novo para o titular anonimizado entra como ignorado');
select pg_temp.sair();

-- user_id legado apontando para um perfil que não é de cliente: nunca é devolvido (a Edge apagaria a conta)
update public.clientes set user_id = pg_temp.usuario('ga1') where id = pg_temp.cliente('c4');
select pg_temp.entrar('super');
select is(public.lgpd_anonimizar_cliente(pg_temp.cliente('c4'), 'LGPD-2026-003') -> 'user_id', 'null'::jsonb,
          'user_id de perfil que não é de cliente não é devolvido');
select pg_temp.sair();
select is((select pr.nome from public.profiles pr where pr.id = pg_temp.usuario('ga1')), 'GA1 Gerente',
          'e o perfil do gerente fica intacto');

-- ============ texto livre copiado para os registros somente inclusão (WP6R-01) ============
-- c5, como as RPCs gravam: motivo da rejeição do documento, da perda e da devolução do contrato em historico_status
-- (_transicionar), dados.motivo na timeline (crm_mudar_etapa), motivo da transferência no vínculo (arken.motivo_vinculo)
-- e a observação da devolução no contrato — um em rascunho (editável) e um assinado (congelado). Outro cliente e um
-- imóvel com motivo: nunca são tocados.
insert into public.unidades (id, empreendimento_id, identificador, valor)
select u.id, (select e.id from public.empreendimentos e order by e.slug limit 1), u.ident, 400000
from (values ('f6000000-0000-4000-8000-000000000203'::uuid, 'LGPD 03'), ('f6000000-0000-4000-8000-000000000204'::uuid, 'LGPD 04')) as u(id, ident);
insert into public.contratos (id, cliente_id, modelo_id, forma_pagamento, status, unidade_id, parametros_id,
  valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
  valor_parcela, valor_total_parcelas, observacao, pdf_assinado_path, assinado_em, enviado_assinatura_em)
select k.id, pg_temp.cliente('c5'), public.modelo_vigente_id('parcelado'), 'parcelado', k.status::public.status_contrato,
       k.unidade, public.parametros_vigente_id(), 400000, 30, 120000, 20000, 100000, 280000, 60, 8.5, 1808.33, 108500,
       k.obs, k.pdf, k.assinado, k.enviado
from (values
  ('f6000000-0000-4000-8000-000000000403'::uuid, 'rascunho', 'f6000000-0000-4000-8000-000000000203'::uuid,
   'Devolvido: falta a certidão de casamento de Maria Souza', null, null::timestamptz, null::timestamptz),
  ('f6000000-0000-4000-8000-000000000404'::uuid, 'assinado', 'f6000000-0000-4000-8000-000000000204'::uuid,
   'Devolvido antes: CPF 123.456.710-50 de Maria Souza estava errado',
   'f6000000-0000-4000-8000-000000000404/assinado-0123abcd.pdf', '2026-09-20 10:00:00-03', '2026-09-19 10:00:00-03')
) as k(id, status, unidade, obs, pdf, assinado, enviado);
insert into public.cliente_documentos (id, cliente_id, nome, status, motivo_rejeicao) values
  ('f6000000-0000-4000-8000-000000000305', pg_temp.cliente('c5'), 'CNH', 'rejeitado',
   'Foto da CNH de Maria Souza ilegível, CPF 123.456.710-50');
insert into public.historico_status (entidade, entidade_id, de, para, motivo, origem) values
  ('documento', 'f6000000-0000-4000-8000-000000000305', 'em_analise', 'rejeitado',
   'Foto da CNH de Maria Souza ilegível, CPF 123.456.710-50', 'usuario'),
  ('cliente_etapa', pg_temp.cliente('c5'), 'novo_contato', 'perdido',
   'Maria Souza desistiu, marido (João Souza, tel 11 98888-7777) não aprovou', 'usuario'),
  ('contrato', 'f6000000-0000-4000-8000-000000000403', 'em_analise', 'rascunho',
   'Falta a certidão de casamento de Maria Souza', 'usuario'),
  ('cliente_etapa', pg_temp.cliente('c1'), 'novo_contato', 'perdido', 'Cliente sem interesse agora (outro titular)', 'usuario'),
  ('imovel', 'f6000000-0000-4000-8000-0000000009e1', 'em_revisao', 'rascunho', 'Fotos escuras (imóvel)', 'usuario');
insert into public.cliente_eventos (cliente_id, tipo, titulo, dados) values
  (pg_temp.cliente('c5'), 'etapa', 'Etapa: Perdidos',
   '{"de":"novo_contato","para":"perdido","motivo":"Maria Souza desistiu, marido (João Souza, tel 11 98888-7777) não aprovou"}'),
  (pg_temp.cliente('c5'), 'documento_analisado', 'Documento rejeitado: CNH',
   '{"documento_id":"f6000000-0000-4000-8000-000000000305","status":"rejeitado"}'),
  (pg_temp.cliente('c1'), 'etapa', 'Etapa: Perdidos',
   '{"de":"novo_contato","para":"perdido","motivo":"Cliente sem interesse agora (outro titular)"}');
insert into public.cliente_vinculos_historico (cliente_id, imobiliaria_id, gerente_id, corretor_id, vigente_de, vigente_ate, motivo)
values (pg_temp.cliente('c5'), pg_temp.imobiliaria('a'), pg_temp.parceiro('ga1'), pg_temp.parceiro('ca1a'),
        now() - interval '3 days', now() - interval '2 days', 'Transferido a pedido de Maria Souza (tel 11 98888-7777)');

-- A exceção das guardas (somente inclusão e contrato congelado) é do WP7, em migration nova (as 01–09 não mudam). Sonda
-- sem efeito, numa subtransação desfeita: as guardas já aceitam a troca controlada com arken.anonimizacao = 'on'?
create temp table t_guarda (relaxada boolean) on commit drop;
do $$
declare
  v_ok boolean := false;
begin
  begin
    perform set_config('arken.anonimizacao', 'on', true);
    update public.historico_status h set motivo = '[removido — LGPD]'
     where h.entidade = 'cliente_etapa' and h.entidade_id = 'd0000000-0000-4000-8000-000000000005' and h.motivo is not null;
    update public.cliente_eventos e set dados = e.dados || '{"motivo":"[removido — LGPD]"}'
     where e.cliente_id = 'd0000000-0000-4000-8000-000000000005' and e.dados ? 'motivo';
    update public.cliente_vinculos_historico v set motivo = '[removido — LGPD]'
     where v.cliente_id = 'd0000000-0000-4000-8000-000000000005' and v.motivo is not null;
    update public.contratos k set observacao = '[removido — LGPD]' where k.id = 'f6000000-0000-4000-8000-000000000404';
    v_ok := true;
    raise exception 'sonda desfeita';
  exception when others then
    null;
  end;
  insert into t_guarda values (v_ok);
end $$;

select pg_temp.entrar('super');
create temp table t_anon5 on commit drop as
select pg_temp.erro(format('select public.lgpd_anonimizar_cliente(%L, %L)', pg_temp.cliente('c5'), 'LGPD-2026-005')) as e;
select pg_temp.sair();

select ok((select relaxada from t_guarda) or to_regclass('public.migracao_parceiro_clientes') is null,
          'depois do corte (WP7), as guardas aceitam a limpeza controlada da anonimização (arken.anonimizacao)');
select is((select e is null from t_anon5), (select relaxada from t_guarda),
          'com a exceção das guardas a anonimização conclui; sem ela, é recusada');
select ok((select relaxada from t_guarda)
          or (select e ->> 'sqlstate' = 'P0001' and e -> 'detalhe' = '{"motivo":"historicos_somente_inclusao"}'
                     and e ->> 'mensagem' like 'Não foi possível remover o texto livre dos históricos do titular%'
              from t_anon5),
          'sem a exceção: recusa com mensagem própria (P0001), não com o erro cru da guarda');
select is((select c.anonimizado_em is not null and c.cpf is null from public.clientes c where c.id = pg_temp.cliente('c5')),
          (select relaxada from t_guarda),
          'recusada, nada muda no cadastro (nunca "anonimizado" com o texto ainda guardado)');
select is((select count(*)::int from public.historico_status h
            where h.motivo like any (array['%Maria Souza%', '%98888-7777%', '%123.456.710-50%'])),
          case when (select relaxada from t_guarda) then 0 else 3 end,
          'historico_status: o motivo livre das transições do cliente, dos documentos e dos contratos dele é removido');
select is((select count(*)::int from public.historico_status h
            where h.motivo = '[removido — LGPD]'
              and h.entidade_id in (pg_temp.cliente('c5'), 'f6000000-0000-4000-8000-000000000305', 'f6000000-0000-4000-8000-000000000403')),
          case when (select relaxada from t_guarda) then 3 else 0 end,
          'as três linhas continuam lá (só o motivo muda)');
select is((select count(*)::int from public.cliente_eventos e
            where e.cliente_id = pg_temp.cliente('c5') and e.dados::text like any (array['%Maria Souza%', '%98888-7777%'])),
          case when (select relaxada from t_guarda) then 0 else 1 end,
          'timeline: dados.motivo removido');
select ok(not (select relaxada from t_guarda)
          or (select e.dados = '{"de":"novo_contato","para":"perdido","motivo":"[removido — LGPD]"}'::jsonb
              from public.cliente_eventos e where e.cliente_id = pg_temp.cliente('c5') and e.tipo = 'etapa'),
          'timeline: só o motivo muda; de e para ficam');
select is((select count(*)::int from public.cliente_vinculos_historico v
            where v.cliente_id = pg_temp.cliente('c5') and v.motivo like '%Maria Souza%'),
          case when (select relaxada from t_guarda) then 0 else 1 end,
          'histórico de vínculos: motivo da transferência removido (a linha fica)');
select is((select v.motivo from public.cliente_vinculos_historico v where v.cliente_id = pg_temp.cliente('c5') and v.vigente_ate is null),
          'cadastro', 'o rótulo fixo do sistema no vínculo (sem texto digitado) fica');
select is((select count(*)::int from public.contratos k
            where k.cliente_id = pg_temp.cliente('c5') and k.observacao like '%Maria Souza%'),
          case when (select relaxada from t_guarda) then 0 else 2 end,
          'contratos (em rascunho e o assinado, congelado): observação livre removida');
select ok((select k.status = 'assinado' and k.valor_imovel = 400000 and k.assinado_em = '2026-09-20 10:00:00-03'
                  and k.pdf_assinado_path = 'f6000000-0000-4000-8000-000000000404/assinado-0123abcd.pdf'
           from public.contratos k where k.id = 'f6000000-0000-4000-8000-000000000404'),
          'o contrato assinado continua com status, valores, datas e PDF');
select is((select count(*)::int from public.historico_status h
            where h.motivo in ('Cliente sem interesse agora (outro titular)', 'Fotos escuras (imóvel)')), 2,
          'motivos de outro cliente e de imóvel ficam');
select is((select e.dados ->> 'motivo' from public.cliente_eventos e where e.cliente_id = pg_temp.cliente('c1') and e.tipo = 'etapa'),
          'Cliente sem interesse agora (outro titular)', 'timeline de outro cliente fica');
select ok(coalesce(current_setting('arken.anonimizacao', true), '') <> 'on',
          'a exceção não fica ligada depois da anonimização');
select throws_ok($$update public.historico_status set motivo = '[removido — LGPD]' where motivo = 'Cliente sem interesse agora (outro titular)'$$,
                 '42501', null, 'fora da anonimização a guarda de somente inclusão continua valendo');

-- ============ o log não guarda dado pessoal ============
select is((select count(*)::int from public.auditoria a
            where a.id > (select auditoria from t_antes)
              and (a::text ~ '\d{3}\.\d{3}\.\d{3}-\d{2}'
                   or a::text like any (array['%12345670916%', '%12345671050%', '%12345671130%', '%12345671211%',
                                              '%12345671300%', '%@cliente.test%', '%@fixture.test%', '%rep@arken%',
                                              '%Cliente Dois%', '%Cliente Um%', '%Cliente Cinco%', '%11900000002%',
                                              '%Rua Um%', '%1234567%', '%Pedido do titular%', '%Maria Souza%',
                                              '%98888-7777%', '%123.456.710-50%', '%Fotos escuras%']))), 0,
          'nenhum registro de auditoria deste teste contém CPF, e-mail, telefone, nome, endereço ou texto livre');
select is((select count(*)::int from public.auditoria a
             cross join lateral (select k from jsonb_object_keys(coalesce(a.detalhe, '{}')) k
                                 union all select k from jsonb_object_keys(coalesce(a.antes, '{}')) k
                                 union all select k from jsonb_object_keys(coalesce(a.depois, '{}')) k) ch
            where a.id > (select auditoria from t_antes)
              and ch.k in ('cpf', 'cnpj', 'rg', 'email', 'telefone', 'nome', 'sobrenome', 'texto', 'motivo', 'busca')), 0,
          'nenhuma chave de dado pessoal em detalhe/antes/depois');

select * from finish();
rollback;
