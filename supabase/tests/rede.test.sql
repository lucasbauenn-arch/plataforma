-- Rede [WP1] (docs/ARQUITETURA_EXPANSAO.md §1.1 A1–A8, N3, N8, N18, N19; §2; §3.3; §4.4 "Rede"; §4.5; §6.2; §8.5):
-- matriz de cadastro; PAR-4; transferir corretor move os clientes na mesma transação e grava histórico; GA1 não
-- transfere c1 para CA2a (outra equipe); inativar sem destino ou com destino fora do escopo falha; PAR-6;
-- regularização só uma vez e só Super; rede_vincular_login recusa perfil antigo, já logado ou de outro e-mail;
-- rede_pode_convidar devolve email_em_uso. Cada RPC: negada fora do escopo (42501, mesma mensagem para inexistente) e
-- com a auditoria gravada (sem CPF, e-mail nem texto livre).
-- Dados como postgres (fixture comum + o que está abaixo); só as RPCs deste pacote são chamadas. O arquivo é
-- sequencial: cada seção parte do estado deixado pela anterior (descrito no cabeçalho de cada uma).
-- Correções da revisão: WP1R-01 (seção 0: travas contra corrida, com uma segunda conexão por dblink), WP1R-03 (e-mail
-- do aprovado = o do login), WP1R-04 (CPF repetido e consultas de convite gravadas e com limite por hora; CPF de
-- outro parceiro só pelos internos).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql
select plan(277);

-- ============ AJUDANTES DESTE TESTE ============
-- CPF válido e livre: 98765 + n (4 dígitos) + dígitos verificadores
create function pg_temp.cpf(p_n int) returns text language plpgsql immutable as $$
declare
  b text := '98765' || lpad(p_n::text, 4, '0');
  s int := 0;
  d int;
  i int;
begin
  for i in 1..9 loop s := s + substr(b, i, 1)::int * (11 - i); end loop;
  d := (s * 10) % 11; if d = 10 then d := 0; end if;
  b := b || d; s := 0;
  for i in 1..10 loop s := s + substr(b, i, 1)::int * (12 - i); end loop;
  d := (s * 10) % 11; if d = 10 then d := 0; end if;
  return b || d;
end $$;

-- ids e códigos gerados pelas RPCs (lidos também com o papel da sessão simulada)
create temp table ids (nome text primary key, id uuid not null);
create temp table cods (nome text primary key, codigo text);
grant select, insert on ids, cods to authenticated, anon, service_role;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select i.id from ids i where i.nome = p $$;
create function pg_temp.cod(p text) returns text language sql stable as $$ select c.codigo from cods c where c.nome = p $$;

-- sessão de um usuário criado neste teste
create function pg_temp.entrar_id(p_id uuid) returns text language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
  return '';
end $$;

create function pg_temp.aud(p_acao text, p_entidade text, p_id text) returns int language sql as $$
  select count(*)::int from public.auditoria a where a.acao = p_acao and a.entidade = p_entidade and a.entidade_id = p_id
$$;

-- auth.users como o Auth grava (handle_new_user cria o perfil 'parceiro'/'pendente')
create function pg_temp.conta(p_id uuid, p_email text, p_criado timestamptz, p_convidado timestamptz,
                              p_ultimo timestamptz, p_senha text, p_nome text default '') returns void
language sql as $$
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at, invited_at,
                          last_sign_in_at, encrypted_password)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('nome', p_nome), p_criado, p_criado, p_convidado, p_ultimo, p_senha)
$$;

select ok(public.cpf_valido(pg_temp.cpf(1)) and public.cpf_valido(pg_temp.cpf(34)), 'ajudante: CPFs gerados são válidos');

-- ============ 0. CONCORRÊNCIA [WP1R-01]: o que sustenta a regra fica travado até o fim da chamada ============
-- Uma segunda conexão (dblink) tenta FOR NO KEY UPDATE (o que a inativação, o bloqueio e a inativação de imobiliária
-- fazem) nas linhas COMITADAS da cadeia da casa, enquanto a transação que chamou a RPC está aberta. Só a trava FOR
-- SHARE da RPC impede; a KEY SHARE da chave estrangeira não. Sem a trava, o destino era conferido "ativo" e podia ser
-- inativado antes do commit (cliente ativo sob corretor inativo). Cada chamada roda numa subtransação desfeita no fim
-- (sem efeito nem trava para o resto do arquivo). Sem a segunda conexão (psql por socket, senha local diferente da
-- padrão), os testes desta seção são pulados.
create extension if not exists dblink with schema extensions;

create function pg_temp.conectar_outra() returns boolean language plpgsql as $$
begin
  if inet_server_addr() is null then
    return false;
  end if;
  perform extensions.dblink_connect('wp1_outra', format('host=%s port=%s dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), inet_server_port(), current_database()));
  perform extensions.dblink_exec('wp1_outra', 'set lock_timeout = ''250ms''');
  return true;
exception when others then
  return false;
end $$;

-- 'livre': a outra conexão consegue FOR NO KEY UPDATE na linha agora; 'travada': esbarra numa trava desta transação
create function pg_temp.na_outra(p_tabela text, p_id uuid) returns text language plpgsql as $$
declare
  v text;
begin
  perform * from extensions.dblink('wp1_outra',
    format('select 1 from public.%I where id = %L for no key update', p_tabela, p_id), false) as t(x int);
  v := extensions.dblink_error_message('wp1_outra');
  return case when v = 'OK' then 'livre' when v ilike '%lock timeout%' then 'travada' else v end;
end $$;

-- p_preparo (como postgres) e p_sql (como p_usuario) numa subtransação; olha as linhas na outra conexão; desfaz tudo
create function pg_temp.travas(p_preparo text, p_usuario text, p_sql text, p_linhas text[]) returns text[]
language plpgsql as $$
declare
  v text[] := '{}';
  l text;
begin
  begin
    if p_preparo is not null then
      execute p_preparo;
    end if;
    perform pg_temp.entrar(p_usuario);
    execute p_sql;
    perform pg_temp.sair();
    foreach l in array p_linhas loop
      v := v || pg_temp.na_outra(split_part(l, ':', 1), split_part(l, ':', 2)::uuid);
    end loop;
    raise exception 'desfazer' using errcode = 'P9999';
  exception when sqlstate 'P9999' then
    null;
  end;
  return v;
exception when others then
  return array['erro: ' || sqlerrm];
end $$;

create function pg_temp.concorrencia() returns setof text language plpgsql as $$
declare
  c public.configuracao_geral%rowtype;
  ic text;
  gc text;
  cc text;
begin
  select * into c from public.configuracao_geral;
  ic := 'imobiliarias:' || c.imobiliaria_casa_id;
  gc := 'parceiros:' || c.gerente_casa_id;
  cc := 'parceiros:' || c.corretor_casa_id;
  if not pg_temp.conectar_outra() then
    return next skip('sem segunda conexão (dblink por TCP) neste ambiente', 11);
    return;
  end if;
  return next is(array[pg_temp.na_outra('imobiliarias', c.imobiliaria_casa_id), pg_temp.na_outra('parceiros', c.gerente_casa_id),
                       pg_temp.na_outra('parceiros', c.corretor_casa_id)],
    array['livre', 'livre', 'livre'], 'concorrência: sem chamada aberta, a cadeia da casa está livre para a outra conexão');
  return next is(pg_temp.travas(null, 'admin',
      format('select public.rede_cadastrar_parceiro(%L, %L, %L, null)', 'gerente',
             jsonb_build_object('nome', 'G Casa', 'cpf', pg_temp.cpf(90)), c.imobiliaria_casa_id), array[ic]),
    array['travada'], 'cadastro de gerente trava a imobiliária (contra rede_inativar_imobiliaria)');
  return next is(pg_temp.travas(null, 'admin',
      format('select public.rede_cadastrar_parceiro(%L, %L, null, %L)', 'corretor',
             jsonb_build_object('nome', 'C Casa', 'cpf', pg_temp.cpf(91), 'creci', 'C-91'), c.gerente_casa_id), array[ic, gc]),
    array['travada', 'travada'], 'cadastro de corretor trava a imobiliária e o gerente');
  return next is(pg_temp.travas(format('update auth.users set email_confirmed_at = now() where id = %L', pg_temp.usuario('pendente')), 'admin',
      format('select public.rede_aprovar_autocadastro(%L, null, %L)', pg_temp.usuario('pendente'),
             jsonb_build_object('cpf', pg_temp.cpf(92), 'creci', 'C-92')), array[ic, gc]),
    array['travada', 'travada'], 'aprovação de autocadastro trava a imobiliária e o gerente de destino');
  return next is(pg_temp.travas(null, 'super',
      format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c1')], c.corretor_casa_id, 'teste de concorrência'),
      array[cc]),
    array['travada'], 'transferência de clientes trava o corretor de destino');
  return next is(pg_temp.travas(
      format('insert into public.parceiros (id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci) values (%L, %L, %L, %L, %L, %L, %L)',
             'c0000000-0000-4000-8000-0000000000f1', 'corretor', c.imobiliaria_casa_id, c.gerente_casa_id, 'CX Casa', pg_temp.cpf(93), 'C-93'),
      'admin',
      format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000f1', c.corretor_casa_id, 'teste de concorrência'),
      array[cc]),
    array['travada'], 'inativação de corretor trava o destino');
  return next is(pg_temp.travas(
      format('insert into public.parceiros (id, tipo, imobiliaria_id, nome, cpf) values (%L, %L, %L, %L, %L)',
             'c0000000-0000-4000-8000-0000000000f2', 'gerente', c.imobiliaria_casa_id, 'GX Casa', pg_temp.cpf(94)),
      'admin',
      format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000f2', c.gerente_casa_id, 'teste de concorrência'),
      array[gc]),
    array['travada'], 'inativação de gerente trava o gerente de destino');
  return next is(pg_temp.travas(
      format('insert into public.parceiros (id, tipo, imobiliaria_id, nome, cpf) values (%L, %L, %L, %L, %L); '
             'insert into public.parceiros (id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci) values (%L, %L, %L, %L, %L, %L, %L)',
             'c0000000-0000-4000-8000-0000000000f2', 'gerente', c.imobiliaria_casa_id, 'GX Casa', pg_temp.cpf(94),
             'c0000000-0000-4000-8000-0000000000f1', 'corretor', c.imobiliaria_casa_id, 'c0000000-0000-4000-8000-0000000000f2', 'CX Casa',
             pg_temp.cpf(93), 'C-93'),
      'admin',
      format('select public.rede_transferir_corretor(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000f1', c.gerente_casa_id, 'teste de concorrência'),
      array[gc]),
    array['travada'], 'transferência de corretor trava o novo gerente');
  return next is(pg_temp.travas(
      format('insert into public.parceiros (id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci) values (%L, %L, %L, %L, %L, %L, %L)',
             'c0000000-0000-4000-8000-0000000000f3', 'corretor', pg_temp.imobiliaria('a'), pg_temp.parceiro('ga1'), 'CY A', pg_temp.cpf(95), 'C-95'),
      'super',
      format('select public.rede_mudar_imobiliaria_corretor(%L, %L, null, %L)', 'c0000000-0000-4000-8000-0000000000f3', c.gerente_casa_id,
             'teste de concorrência'),
      array[gc]),
    array['travada'], 'mudança de imobiliária trava o novo gerente');
  return next is(pg_temp.travas(
      format('insert into public.parceiros (id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci) values (%L, %L, %L, %L, %L, %L, %L); '
             'select set_config(''arken.motivo_vinculo'', ''fixture: desligamento'', true); '
             'update public.parceiros set inativado_em = now() where id = %L',
             'c0000000-0000-4000-8000-0000000000f4', 'corretor', c.imobiliaria_casa_id, c.gerente_casa_id, 'CZ Casa', pg_temp.cpf(96), 'C-96',
             'c0000000-0000-4000-8000-0000000000f4'),
      'admin',
      format('select public.rede_reativar_parceiro(%L)', 'c0000000-0000-4000-8000-0000000000f4'),
      array[ic, gc]),
    array['travada', 'travada'], 'reativação trava a imobiliária e o gerente (contra a inativação deles)');
  return next is(array[pg_temp.na_outra('imobiliarias', c.imobiliaria_casa_id), pg_temp.na_outra('parceiros', c.gerente_casa_id),
                       pg_temp.na_outra('parceiros', c.corretor_casa_id)],
    array['livre', 'livre', 'livre'], 'concorrência: desfeitas as chamadas, as travas saem junto');
  perform extensions.dblink_disconnect('wp1_outra');
end $$;
select * from pg_temp.concorrencia();

-- ============ 1. IMOBILIÁRIAS (só internos) ============
select pg_temp.entrar('ia');
select is(pg_temp.erro($$select public.rede_cadastrar_imobiliaria('{"nome":"Imob C","cnpj":"11222335000170","creci_pj":"J-3"}')$$) ->> 'sqlstate',
  '42501', 'imobiliária não cadastra imobiliária (só internos)');
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.rede_cadastrar_imobiliaria('{"nome":"Imob C"}')$$) -> 'detalhe' -> 'campos',
  '["cnpj","creci_pj"]'::jsonb, 'PAR-4: CNPJ e CRECI PJ obrigatórios');
select is(pg_temp.erro($$select public.rede_cadastrar_imobiliaria('{"nome":"Imob C","cnpj":"11222335000171","creci_pj":"J-3"}')$$) ->> 'mensagem',
  'CNPJ inválido.', 'PAR-4: CNPJ com DV inválido é recusado');
select is(pg_temp.erro($$select public.rede_cadastrar_imobiliaria('{"nome":"Imob C","cnpj":"11222333000181","creci_pj":"J-3"}')$$) ->> 'mensagem',
  'REGISTRO_DUPLICADO', 'CNPJ único');
select is(pg_temp.erro($$select public.rede_cadastrar_imobiliaria('{"nome":"Imob C","cnpj":"11222335000170","creci_pj":"J-3","site":"x"}')$$) -> 'detalhe' ->> 'motivo',
  'campos_desconhecidos', 'chave desconhecida em p_dados é recusada');
insert into ids select 'imob_c', public.rede_cadastrar_imobiliaria(
  '{"nome":"Imobiliária C","cnpj":"11.222.335/0001-70","creci_pj":"J-0003","uf":"sp","cep":"01310-100","telefone":"(11) 3333-4444"}');
select pg_temp.sair();
select is((select row(cnpj, uf, cep, telefone, da_casa)::text from public.imobiliarias where id = pg_temp.id('imob_c')),
  row('11222335000170', 'SP', '01310100', '1133334444', false)::text, 'cadastro normaliza CNPJ, UF, CEP e telefone');
select ok((select categoria = 'operacao' and ator_papel = 'admin' and 'cnpj' = any (campos) and antes is null
                  and position('11222335000170' in coalesce(depois::text, '') || detalhe::text) = 0
           from public.auditoria where acao = 'criar' and entidade = 'imobiliarias' and entidade_id = pg_temp.id('imob_c')::text),
  'auditoria operacao/criar da imobiliária: nome do campo, nunca o CNPJ');

select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_editar_imobiliaria(%L, %L)', pg_temp.imobiliaria('a'), '{"nome":"Nova A"}')) ->> 'sqlstate',
  '42501', 'parceiro não edita imobiliária');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_editar_imobiliaria(%L, %L)', pg_temp.id('imob_c'), '{"nome":"Imobiliária C Ltda","cidade":"Santos","uf":"SP"}')),
  null, 'interno edita a imobiliária');
select is(pg_temp.erro(format('select public.rede_editar_imobiliaria(%L, %L)', pg_temp.id('imob_c'), '{"cnpj":null}')) -> 'detalhe' -> 'campos',
  '["cnpj"]'::jsonb, 'CNPJ não fica vazio fora da casa');
select is(pg_temp.erro(format('select public.rede_editar_imobiliaria(%L, %L)', gen_random_uuid(), '{"nome":"Xis"}')) ->> 'sqlstate',
  '42501', 'imobiliária inexistente: 42501');
select pg_temp.sair();
select is((select campos from public.auditoria where acao = 'editar' and entidade = 'imobiliarias' and entidade_id = pg_temp.id('imob_c')::text),
  array['cidade', 'nome'], 'auditoria da edição: só os campos que mudaram');

select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_inativar_imobiliaria(%L, %L)', pg_temp.imobiliaria('a'), 'encerrou as atividades')) ->> 'mensagem',
  'DESCENDENTES_ATIVOS', 'imobiliária com parceiro ativo não é inativada');
select is(pg_temp.erro(format('select public.rede_inativar_imobiliaria(%L, %L)', (select c.imobiliaria_casa_id from public.configuracao_geral c), 'encerrou as atividades')) ->> 'mensagem',
  'A imobiliária da casa não pode ser inativada.', 'a casa nunca é inativada');
select is(pg_temp.erro(format('select public.rede_inativar_imobiliaria(%L, %L)', pg_temp.id('imob_c'), 'abc')) ->> 'mensagem',
  'MOTIVO_OBRIGATORIO', 'inativação exige motivo');
select is(pg_temp.erro(format('select public.rede_inativar_imobiliaria(%L, %L)', pg_temp.id('imob_c'), 'parceria encerrada')),
  null, 'imobiliária sem parceiro ativo é inativada');
select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_inativar_imobiliaria(%L, %L)', pg_temp.imobiliaria('b'), 'teste de acesso')) ->> 'sqlstate',
  '42501', 'parceiro não inativa imobiliária');
select pg_temp.sair();
select ok((select inativado_em is not null and motivo_inativacao = 'parceria encerrada' and inativado_por = pg_temp.usuario('admin')
           from public.imobiliarias where id = pg_temp.id('imob_c')), 'inativação grava data, motivo e quem');
select is(pg_temp.aud('inativar', 'imobiliarias', pg_temp.id('imob_c')::text), 1, 'auditoria operacao/inativar da imobiliária');

-- ============ 2. CADASTRO DE PARCEIROS (matriz §3.3 + PAR-4) ============
select pg_temp.entrar('ia');
insert into ids select 'ga3', public.rede_cadastrar_parceiro('gerente',
  jsonb_build_object('nome', 'GA3 Gerente', 'cpf', pg_temp.cpf(1), 'email', 'GA3.novo@fixture.test', 'telefone', '(11) 98888-0003'), null, null);
select pg_temp.sair();
select is((select row(tipo, imobiliaria_id, gerente_id, profile_id, codigo_indicacao, telefone, email)::text from public.parceiros where id = pg_temp.id('ga3')),
  row('gerente'::public.tipo_parceiro, pg_temp.imobiliaria('a'), null::uuid, null::uuid, null::text, '11988880003', 'ga3.novo@fixture.test')::text,
  'imobiliária cadastra gerente na própria imobiliária (sem login, sem código; telefone e e-mail normalizados)');
select is((select motivo from public.parceiro_vinculos_historico where parceiro_id = pg_temp.id('ga3') and vigente_ate is null),
  'cadastro', 'o histórico de vínculos abre no cadastro');
select ok((select categoria = 'operacao' and ator_papel = 'imobiliaria' and ator_parceiro_id = pg_temp.parceiro('ia')
                  and campos = array['cpf', 'email', 'nome', 'telefone'] and depois ->> 'tipo' = 'gerente'
           from public.auditoria where acao = 'criar' and entidade = 'parceiros' and entidade_id = pg_temp.id('ga3')::text),
  'auditoria operacao/criar do parceiro (nomes dos campos, tipo e cadeia)');

select pg_temp.entrar('ga1');
select is(pg_temp.erro($$select public.rede_cadastrar_parceiro('gerente', '{"nome":"X Gerente","cpf":"12345671483"}', null, null)$$) ->> 'sqlstate',
  '42501', 'matriz: gerente não cadastra gerente');
insert into ids select 'ca1b', public.rede_cadastrar_parceiro('corretor',
  jsonb_build_object('nome', 'CA1b Corretor', 'cpf', pg_temp.cpf(2), 'creci', 'CRECI-CA1B', 'email', 'ca1b@fixture.test'), null, null);
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, null, %L)', 'corretor',
    jsonb_build_object('nome', 'Y Corretor', 'cpf', pg_temp.cpf(3), 'creci', 'C-Y'), pg_temp.parceiro('ga2'))) ->> 'sqlstate',
  '42501', 'matriz: o gerente só cadastra corretor sob si');
select pg_temp.sair();
select ok((select gerente_id = pg_temp.parceiro('ga1') and imobiliaria_id = pg_temp.imobiliaria('a') and codigo_indicacao ~ '^[a-z2-7]{10}$'
           from public.parceiros where id = pg_temp.id('ca1b')), 'gerente cadastra corretor vinculado a ele (com código de indicação)');

select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, null, %L)', 'corretor',
    jsonb_build_object('nome', 'Y Corretor', 'cpf', pg_temp.cpf(3), 'creci', 'C-Y'), pg_temp.parceiro('ga1'))) ->> 'sqlstate',
  '42501', 'matriz: corretor não cadastra corretor');
select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, null, %L)', 'corretor',
    jsonb_build_object('nome', 'Y Corretor', 'cpf', pg_temp.cpf(3), 'creci', 'C-Y'), pg_temp.parceiro('gb1'))) ->> 'sqlstate',
  '42501', 'imobiliária não cadastra corretor sob gerente de outra');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, %L, null)', 'gerente', '{"nome":"Outra","cpf":"12345671483"}', pg_temp.imobiliaria('b'))) ->> 'sqlstate',
  '42501', 'imobiliária não cadastra gerente em outra imobiliária');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, %L, null)', 'imobiliaria', '{"nome":"IA2 Usuário"}', pg_temp.imobiliaria('a'))) ->> 'sqlstate',
  '42501', 'usuário de imobiliária: só internos cadastram');
select is(pg_temp.erro($$select public.rede_cadastrar_parceiro('gerente', '{"nome":"Sem CPF"}', null, null)$$) -> 'detalhe' -> 'campos',
  '["cpf"]'::jsonb, 'PAR-4: gerente exige CPF');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, null, %L)', 'corretor',
    jsonb_build_object('nome', 'Sem CRECI', 'cpf', pg_temp.cpf(4)), pg_temp.parceiro('ga1'))) -> 'detalhe' -> 'campos',
  '["creci"]'::jsonb, 'PAR-4: corretor exige CRECI');
select is(pg_temp.erro($$select public.rede_cadastrar_parceiro('gerente', '{"nome":"CPF errado","cpf":"123.456.789-00"}', null, null)$$) ->> 'mensagem',
  'CPF inválido.', 'PAR-4: CPF com DV inválido');
select is(public.rede_cadastrar_parceiro('gerente', '{"nome":"CPF de outro","cpf":"12345670169"}', null, null), null,
  '[WP1R-04] CPF único, sem dizer de quem é: para o parceiro, nada é criado e a resposta é nula (o front mostra DOCUMENTO_INDISPONIVEL)');
select is(pg_temp.erro($$select public.rede_cadastrar_parceiro('gerente', '{"cpf":"12345671483"}', null, null)$$) -> 'detalhe' -> 'campos',
  '["nome"]'::jsonb, 'nome obrigatório');
select is(pg_temp.erro($$select public.rede_cadastrar_parceiro('gerente', '{"nome":"Tel","cpf":"12345671483","telefone":"123"}', null, null)$$) ->> 'mensagem',
  'Telefone inválido: informe o DDD e o número.', 'telefone validado');
select pg_temp.sair();
-- [WP1R-04] a tentativa fica gravada (sem o CPF) e conta no limite por hora de quem tenta; internos recebem o erro
select ok((select count(*) = 1 and bool_and(categoria = 'seguranca' and ator_id = pg_temp.usuario('ia') and campos = '{cpf}'
                                            and detalhe ->> 'tipo' = 'gerente' and position('12345670169' in detalhe::text) = 0)
           from public.auditoria where acao = 'documento_indisponivel'),
  '[WP1R-04] CPF repetido por parceiro grava seguranca/documento_indisponivel, sem o CPF');
select is((select count(*)::int from public.parceiros where nome = 'CPF de outro'), 0, '[WP1R-04] nada foi criado');
update public.configuracao_geral set duplicidade_bloqueios_hora = 2;
select pg_temp.entrar('ia');
select is(public.rede_cadastrar_parceiro('gerente', '{"nome":"CPF de outro B","cpf":"12345670673"}', null, null), null,
  '[WP1R-04] CPF de outra imobiliária: a mesma resposta nula');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, null, null)', 'gerente',
    jsonb_build_object('nome', 'CPF livre', 'cpf', pg_temp.cpf(80)))) ->> 'mensagem',
  'LIMITE_DUPLICIDADE', '[WP1R-04] no limite por hora, nem CPF livre passa (a recusa vem antes de olhar o CPF)');
select pg_temp.entrar('ga1');
select is(public.rede_cadastrar_parceiro('corretor', jsonb_build_object('nome', 'CPF de outro C', 'cpf', '12345670169', 'creci', 'C-X'), null, null), null,
  '[WP1R-04] o limite é de cada um: o gerente ainda tenta');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, %L, null)', 'gerente', '{"nome":"CPF de outro","cpf":"12345670169"}',
    pg_temp.imobiliaria('a'))) ->> 'mensagem',
  'DOCUMENTO_INDISPONIVEL', 'interno: CPF único com o erro DOCUMENTO_INDISPONIVEL (sem limite)');
select pg_temp.sair();
update public.configuracao_geral set duplicidade_bloqueios_hora = 10;
update public.permissoes_rede set permitido = false where acao = 'cadastrar_corretor' and tipo = 'gerente';
select pg_temp.entrar('ga1');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, null, null)', 'corretor',
    jsonb_build_object('nome', 'Z Corretor', 'cpf', pg_temp.cpf(5), 'creci', 'C-Z'))) ->> 'sqlstate',
  '42501', 'permissoes_rede desliga o cadastro de corretor pelo gerente');
select pg_temp.sair();
update public.permissoes_rede set permitido = true where acao = 'cadastrar_corretor' and tipo = 'gerente';

select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, %L, null)', 'imobiliaria', '{"nome":"Usuário da casa"}',
    (select c.imobiliaria_casa_id from public.configuracao_geral c))) ->> 'mensagem',
  'A imobiliária da casa é administrada pela equipe Arken: cadastre gerentes e corretores nela.', 'usuário de imobiliária não é criado na casa');
insert into ids select 'ib2', public.rede_cadastrar_parceiro('imobiliaria', '{"nome":"IB2 Usuária","email":"ib2@fixture.test"}', pg_temp.imobiliaria('b'), null);
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, null, null)', 'corretor',
    jsonb_build_object('nome', 'W Corretor', 'cpf', pg_temp.cpf(6), 'creci', 'C-W'))) -> 'detalhe' -> 'campos',
  '["gerente"]'::jsonb, 'interno informa o gerente do corretor');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, %L, %L)', 'corretor',
    jsonb_build_object('nome', 'W Corretor', 'cpf', pg_temp.cpf(6), 'creci', 'C-W'), pg_temp.imobiliaria('b'), pg_temp.parceiro('ga1'))) ->> 'mensagem',
  'O gerente escolhido não é da imobiliária informada.', 'gerente e imobiliária precisam bater');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, null, %L)', 'corretor',
    jsonb_build_object('nome', 'W Corretor', 'cpf', pg_temp.cpf(6), 'creci', 'C-W'), pg_temp.parceiro('ca1a'))) ->> 'mensagem',
  'DESTINO_INVALIDO', 'o gerente informado precisa ser um gerente ativo');
select is(pg_temp.erro(format('select public.rede_cadastrar_parceiro(%L, %L, %L, null)', 'gerente',
    jsonb_build_object('nome', 'G Inativa', 'cpf', pg_temp.cpf(6)), pg_temp.id('imob_c'))) ->> 'mensagem',
  'A imobiliária está inativa.', 'não se cadastra em imobiliária inativa');
select pg_temp.sair();
select ok((select tipo = 'imobiliaria' and imobiliaria_id = pg_temp.imobiliaria('b') and cpf is null from public.parceiros where id = pg_temp.id('ib2')),
  'interno cadastra usuário de imobiliária (CPF opcional)');

-- ============ 3. EDIÇÃO E MEU CADASTRO ============
select pg_temp.entrar('ga1');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('ca1a'), '{"telefone":"(11) 97777-6666"}')),
  null, 'gerente edita o próprio corretor');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('ca2a'), '{"telefone":"11977776666"}')) ->> 'sqlstate',
  '42501', 'gerente não edita corretor de outra equipe');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('ga2'), '{"nome":"Outro"}')) ->> 'sqlstate',
  '42501', 'gerente não edita outro gerente');
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('ca1a'), '{"nome":"Eu Mesmo"}')) ->> 'sqlstate',
  '42501', 'corretor não edita por rede_editar_parceiro (usa Meu cadastro)');
select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('ca1a'), jsonb_build_object('cpf', pg_temp.cpf(7)))) ->> 'mensagem',
  'O CPF já cadastrado não pode ser alterado.', 'CPF só muda se estiver vazio');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('ca1a'), '{"email":"outro@fixture.test"}')) ->> 'mensagem',
  'O e-mail de quem já tem login não muda por aqui: é o e-mail de acesso.', 'e-mail não muda depois do login');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.id('ga3'), '{"email":"ga3@fixture.test"}')),
  null, 'sem login, o e-mail pode ser corrigido');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('inativo'), '{"telefone":"11966665555"}')) ->> 'mensagem',
  'Parceiro inativo não é editado: reative antes.', 'parceiro inativo não é editado');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('ca1a'), '{"creci":null}')) -> 'detalhe' -> 'campos',
  '["creci"]'::jsonb, 'corretor não fica sem CRECI');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', pg_temp.parceiro('ca1a'), '{"cpf":"12345670320","papel":"admin"}')) -> 'detalhe' ->> 'motivo',
  'campos_desconhecidos', 'só nome, CPF, CRECI, e-mail e telefone são editáveis');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', (select c.corretor_casa_id from public.configuracao_geral c), '{"nome":"Outra carteira"}')) ->> 'sqlstate',
  '42501', 'a cadeia virtual da casa não é editada');
select pg_temp.sair();
-- [WP1R-04] completar o CPF vazio de OUTRO parceiro é só dos internos (para parceiros seria um oráculo de CPF sem limite)
insert into public.parceiros (id, tipo, imobiliaria_id, gerente_id, nome, migrado_legado)
values ('c0000000-0000-4000-8000-0000000000a9', 'corretor', pg_temp.imobiliaria('a'), pg_temp.parceiro('ga2'), 'Sem CPF Corretor', true);
select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', 'c0000000-0000-4000-8000-0000000000a9', jsonb_build_object('cpf', pg_temp.cpf(81)))) ->> 'mensagem',
  'O CPF de outro parceiro só é completado pela equipe Arken.', '[WP1R-04] a imobiliária não completa o CPF de outro parceiro (CPF livre)');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', 'c0000000-0000-4000-8000-0000000000a9', '{"cpf":"12345670169"}')) ->> 'mensagem',
  'O CPF de outro parceiro só é completado pela equipe Arken.', '[WP1R-04] e a resposta é a mesma para CPF já usado (sem oráculo)');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', 'c0000000-0000-4000-8000-0000000000a9', '{"cpf":"12345670169"}')) ->> 'mensagem',
  'DOCUMENTO_INDISPONIVEL', 'interno: CPF já usado dá DOCUMENTO_INDISPONIVEL');
select is(pg_temp.erro(format('select public.rede_editar_parceiro(%L, %L)', 'c0000000-0000-4000-8000-0000000000a9', jsonb_build_object('cpf', pg_temp.cpf(81)))),
  null, 'interno completa o CPF vazio de um parceiro');
select pg_temp.sair();
select is((select row(p.telefone, pr.telefone)::text from public.parceiros p join public.profiles pr on pr.id = p.profile_id where p.id = pg_temp.parceiro('ca1a')),
  row('11977776666', '11977776666')::text, 'telefone só com dígitos, copiado para o perfil');
select is((select campos from public.auditoria where acao = 'editar' and entidade = 'parceiros' and entidade_id = pg_temp.parceiro('ca1a')::text),
  array['telefone'], 'auditoria da edição: só o nome do campo');

select pg_temp.entrar('cb1a');
select is(pg_temp.erro($$select public.rede_atualizar_meu_cadastro('{"nome":"CB1a Corretor Silva","telefone":"19 98888-7777"}')$$),
  null, 'o parceiro atualiza o próprio cadastro');
select is(pg_temp.erro($$select public.rede_atualizar_meu_cadastro('{"email":"novo@fixture.test"}')$$) ->> 'mensagem',
  'O e-mail é o do seu login e não muda por aqui. Fale com a equipe Arken.', 'o e-mail do login não muda');
select is(pg_temp.erro($$select public.rede_atualizar_meu_cadastro('{"cpf":"12345671483"}')$$) ->> 'mensagem',
  'O CPF já cadastrado não pode ser alterado. Fale com a equipe Arken.', 'CPF preenchido não muda');
select pg_temp.entrar('bloqueado');
select is(pg_temp.erro($$select public.rede_atualizar_meu_cadastro('{"telefone":"11900000000"}')$$) ->> 'sqlstate',
  '42501', 'bloqueado não edita (sem escopo)');
select pg_temp.entrar('pendente');
select is(pg_temp.erro($$select public.rede_atualizar_meu_cadastro('{"telefone":"11900000000"}')$$) ->> 'sqlstate',
  '42501', 'autocadastro pendente não tem cadastro na rede');
select pg_temp.sair();
select ok((select campos = array['nome', 'telefone'] and detalhe = '{"proprio":true}'::jsonb and ator_id = pg_temp.usuario('cb1a')
           from public.auditoria where acao = 'editar' and entidade = 'parceiros' and entidade_id = pg_temp.parceiro('cb1a')::text),
  'auditoria operacao/editar do próprio cadastro');

-- ============ 4. DETALHE (auditado: inclui CPF) ============
select pg_temp.entrar('ga1');
select ok((select d ->> 'cpf' = '12345670320' and d -> 'gerente' ->> 'id' = pg_temp.parceiro('ga1')::text and (d ->> 'tem_login')::boolean
                  and d ->> 'status_parceiro' = 'aprovado' and d -> 'status_historico' = 'null'::jsonb and (d ->> 'clientes_ativos')::int = 1
           from (select public.rede_parceiro_detalhe(pg_temp.parceiro('ca1a')) d) x),
  'gerente vê o corretor dele com CPF (o histórico de status é só de internos)');
select is(public.rede_parceiro_detalhe(pg_temp.parceiro('ca2a')), null, 'fora do escopo: nulo');
select is(public.rede_parceiro_detalhe(gen_random_uuid()), null, 'inexistente: nulo (mesma resposta)');
select pg_temp.entrar('ca1a');
select ok((select d -> 'gerente' = 'null'::jsonb and d -> 'historico' -> 0 -> 'gerente' = 'null'::jsonb
                  and d -> 'historico' -> 0 -> 'imobiliaria' ->> 'nome' = 'Imobiliária A'
           from (select public.rede_parceiro_detalhe(pg_temp.parceiro('ca1a')) d) x),
  'PAR-3: o corretor vê o próprio cadastro sem o nome do gerente acima dele');
select is(public.rede_parceiro_detalhe(pg_temp.parceiro('ga1')), null, 'corretor não vê o gerente');
select pg_temp.entrar('ib');
select is(public.rede_parceiro_detalhe(pg_temp.parceiro('ca1a')), null, 'outra imobiliária não vê');
select pg_temp.entrar('bloqueado');
select is(public.rede_parceiro_detalhe(pg_temp.parceiro('bloqueado')), null, 'bloqueado não vê nem o próprio vínculo');
select pg_temp.entrar('ia');
select ok((select (d ->> 'corretores_ativos')::int = 3 and (d ->> 'clientes_ativos')::int = 1
           from (select public.rede_parceiro_detalhe(pg_temp.parceiro('ga1')) d) x),
  'imobiliária vê o gerente com as contagens (corretores ativos e clientes pelo A1)');
select pg_temp.entrar('admin');
select ok((select jsonb_typeof(d -> 'status_historico') = 'array' and d -> 'imobiliaria' ->> 'nome' = 'Imobiliária A'
           from (select public.rede_parceiro_detalhe(pg_temp.parceiro('ca1a')) d) x), 'internos veem o histórico de status');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria where acao = 'consultar' and categoria = 'acesso' and entidade = 'parceiros'
             and entidade_id = pg_temp.parceiro('ca1a')::text), 3, 'cada leitura com CPF grava acesso/consultar');
select is((select count(*)::int from public.auditoria where acao = 'acesso_negado' and entidade = 'parceiros' and ator_id = pg_temp.usuario('ga1')),
  2, 'negação grava acesso/acesso_negado (fora do escopo e inexistente)');

-- ============ 5. AUTOCADASTRO (N8, N18) ============
select pg_temp.entrar('ga1');
select is(pg_temp.erro(format('select public.rede_aprovar_autocadastro(%L, null, %L)', pg_temp.usuario('pendente'), '{}')) ->> 'sqlstate',
  '42501', 'só internos aprovam autocadastro');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_aprovar_autocadastro(%L, null, %L)', pg_temp.usuario('pendente'), '{}')) ->> 'mensagem',
  'O parceiro ainda não confirmou o e-mail do cadastro.', 'e-mail não confirmado não é aprovado');
select pg_temp.sair();
update auth.users set email_confirmed_at = now(),
       raw_user_meta_data = raw_user_meta_data || jsonb_build_object('cpf', regexp_replace(pg_temp.cpf(10), '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4'))
 where id = pg_temp.usuario('pendente');
update public.profiles set creci = 'CRECI-PEND', telefone = '(11) 95555-4444' where id = pg_temp.usuario('pendente');
-- [WP1R-03] o autocadastro trocava o próprio profiles.email pela API antes da aprovação; a 17 tirou o UPDATE de
-- profiles de authenticated. Uma divergência antiga (gravada antes da 17) é simulada como postgres logo abaixo.
select pg_temp.entrar('pendente');
select throws_ok($$update public.profiles set email = 'vitima@outro.test' where id = 'a0000000-0000-4000-8000-000000000043'$$,
  '42501', null, '[WP1R-03] o perfil pendente não troca o próprio profiles.email pela API');
select pg_temp.sair();
update public.profiles set email = 'vitima@outro.test' where id = pg_temp.usuario('pendente');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_aprovar_autocadastro(%L, null, %L)', pg_temp.usuario('pendente'), '{"cpf":"12345670169"}')) ->> 'mensagem',
  'DOCUMENTO_INDISPONIVEL', 'CPF já de outro parceiro não é aprovado');
select is(pg_temp.erro(format('select public.rede_aprovar_autocadastro(%L, %L, %L)', pg_temp.usuario('pendente'), pg_temp.parceiro('ca1a'), '{}')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'a cadeia escolhida precisa ser um gerente ativo');
insert into ids select 'aprovado', public.rede_aprovar_autocadastro(pg_temp.usuario('pendente'), null, '{"cpf":""}');
select is(pg_temp.erro(format('select public.rede_aprovar_autocadastro(%L, null, %L)', pg_temp.usuario('pendente'), '{}')) ->> 'mensagem',
  'Este cadastro não está pendente de aprovação.', 'não se aprova duas vezes');
select pg_temp.sair();
select ok((select p.tipo = 'corretor' and p.gerente_id = c.gerente_casa_id and p.imobiliaria_id = c.imobiliaria_casa_id
                  and p.cpf = pg_temp.cpf(10) and p.creci = 'CRECI-PEND' and p.email = 'pendente@fixture.test' and p.telefone = '11955554444'
                  and p.codigo_indicacao ~ '^[a-z2-7]{10}$'
           from public.parceiros p cross join public.configuracao_geral c where p.id = pg_temp.id('aprovado')),
  'N8/A4: aprovado vira corretor na cadeia da casa, com o CPF e o CRECI do cadastro');
select is((select email from public.parceiros where id = pg_temp.id('aprovado')), 'pendente@fixture.test',
  '[WP1R-03] o e-mail do parceiro aprovado é o do login (auth.users), nunca o profiles.email adulterado');
select is((select row(papel, status_parceiro)::text from public.profiles where id = pg_temp.usuario('pendente')),
  row('corretor'::public.papel, 'aprovado'::public.status_parceiro)::text, 'papel corretor, acesso aprovado');
select ok((select not (raw_user_meta_data ? 'cpf') from auth.users where id = pg_temp.usuario('pendente')),
  'o CPF declarado sai dos metadados do Auth (fica só em parceiros)');
select ok((select a.categoria = 'operacao' and a.detalhe ->> 'profile_id' = pg_temp.usuario('pendente')::text
           from public.auditoria a where a.acao = 'aprovar' and a.entidade = 'parceiros' and a.entidade_id = pg_temp.id('aprovado')::text),
  'auditoria operacao/aprovar');
select is((select array[de::text, para::text] from public.parceiro_status_historico where parceiro_id = pg_temp.id('aprovado')),
  array['pendente', 'aprovado'], 'histórico de status: pendente → aprovado');

select pg_temp.conta('a0000000-0000-4000-8000-0000000000f1', 'pend2@fixture.test', now(), null, null, 'hash', 'Pendente Dois');
update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('cpf', pg_temp.cpf(11))
 where id = 'a0000000-0000-4000-8000-0000000000f1';
select pg_temp.entrar('ga1');
select is(pg_temp.erro($$select public.rede_recusar_autocadastro('a0000000-0000-4000-8000-0000000000f1', 'CRECI não confere')$$) ->> 'sqlstate',
  '42501', 'só internos recusam');
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.rede_recusar_autocadastro('a0000000-0000-4000-8000-0000000000f1', 'não')$$) ->> 'mensagem',
  'MOTIVO_OBRIGATORIO', 'recusa exige motivo');
select is(pg_temp.erro($$select public.rede_recusar_autocadastro('a0000000-0000-4000-8000-0000000000f1', 'CRECI não confere')$$),
  null, 'interno recusa o autocadastro');
select is(pg_temp.erro(format('select public.rede_recusar_autocadastro(%L, %L)', pg_temp.usuario('ca1a'), 'não é pendente')) ->> 'mensagem',
  'Este cadastro não está pendente de aprovação.', 'só autocadastro pendente é recusado');
select pg_temp.sair();
select is((select status_parceiro::text from public.profiles where id = 'a0000000-0000-4000-8000-0000000000f1'), 'bloqueado', 'recusado fica bloqueado');
select is((select motivo from public.parceiro_status_historico where profile_id = 'a0000000-0000-4000-8000-0000000000f1'),
  'CRECI não confere', 'o motivo da recusa fica no histórico de status');
select ok((select position('CRECI não confere' in coalesce(antes::text, '') || coalesce(depois::text, '') || detalhe::text) = 0
           from public.auditoria where acao = 'recusar' and entidade_id = 'a0000000-0000-4000-8000-0000000000f1'),
  'auditoria operacao/recusar sem o texto do motivo');
select ok((select not (raw_user_meta_data ? 'cpf') from auth.users where id = 'a0000000-0000-4000-8000-0000000000f1'),
  'o CPF declarado também sai na recusa');

-- ============ 6. BLOQUEIO (N19) ============
select pg_temp.entrar('ib');
select is(pg_temp.erro(format('select public.rede_bloquear_parceiro(%L, %L)', pg_temp.parceiro('cb1a'), 'conduta em análise')) ->> 'sqlstate',
  '42501', 'só internos bloqueiam');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_bloquear_parceiro(%L, %L)', pg_temp.parceiro('cb1a'), 'abc')) ->> 'mensagem',
  'MOTIVO_OBRIGATORIO', 'bloqueio exige motivo');
select is(pg_temp.erro(format('select public.rede_bloquear_parceiro(%L, %L)', pg_temp.parceiro('cb1a'), 'conduta em análise')),
  null, 'interno bloqueia o acesso');
select is(pg_temp.erro(format('select public.rede_bloquear_parceiro(%L, %L)', pg_temp.parceiro('cb1a'), 'de novo o bloqueio')) ->> 'mensagem',
  'O acesso deste parceiro já está bloqueado.', 'não bloqueia duas vezes');
select is(pg_temp.erro(format('select public.rede_bloquear_parceiro(%L, %L)', pg_temp.id('ga3'), 'sem login algum')) ->> 'mensagem',
  'Este parceiro não tem login para bloquear.', 'sem login, não há o que bloquear');
select pg_temp.entrar('cb1a');
select is(public.meu_parceiro_id(), null, 'bloqueado perde o escopo na hora');
select pg_temp.sair();
select ok((select corretor_id = pg_temp.parceiro('cb1a') from public.clientes where id = pg_temp.cliente('c3')), 'N19: a carteira fica com o bloqueado');
select ok((select categoria = 'seguranca' and position('conduta' in coalesce(antes::text, '') || coalesce(depois::text, '') || detalhe::text) = 0
           from public.auditoria where acao = 'bloquear' and entidade_id = pg_temp.parceiro('cb1a')::text),
  'auditoria seguranca/bloquear, sem o motivo');
select is((select motivo from public.parceiro_status_historico where parceiro_id = pg_temp.parceiro('cb1a') and para = 'bloqueado'),
  'conduta em análise', 'o motivo do bloqueio fica no histórico de status');
select pg_temp.entrar('ib');
select is(pg_temp.erro(format('select public.rede_desbloquear_parceiro(%L)', pg_temp.parceiro('cb1a'))) ->> 'sqlstate',
  '42501', 'só internos desbloqueiam');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_desbloquear_parceiro(%L)', pg_temp.parceiro('cb1a'))), null, 'interno desbloqueia');
select is(pg_temp.erro(format('select public.rede_desbloquear_parceiro(%L)', pg_temp.parceiro('cb1a'))) ->> 'mensagem',
  'O acesso deste parceiro não está bloqueado.', 'só desbloqueia quem está bloqueado');
select pg_temp.sair();
select is((select status_parceiro::text from public.profiles where id = pg_temp.usuario('cb1a')), 'aprovado', 'acesso aprovado de novo');
select is(pg_temp.aud('desbloquear', 'parceiros', pg_temp.parceiro('cb1a')::text), 1, 'auditoria seguranca/desbloquear');

-- ============ 7. CONVITE (§6.2): rede_pode_convidar, rede_vincular_login, rede_registrar_convite ============
select pg_temp.entrar('ia');
select is(public.rede_pode_convidar(pg_temp.id('ga3')),
  jsonb_build_object('pode', true, 'situacao', 'novo', 'email', 'ga3@fixture.test', 'nome', 'GA3 Gerente', 'modo_link', false, 'profile_id', null),
  'imobiliária convida o gerente sem login (só por e-mail: convite_por_link desligado)');
select pg_temp.entrar('ga1');
select is(pg_temp.erro(format('select public.rede_pode_convidar(%L)', pg_temp.id('ga3'))) ->> 'sqlstate', '42501', 'gerente não convida gerente');
select is(pg_temp.erro(format('select public.rede_pode_convidar(%L)', pg_temp.parceiro('ca2a'))) ->> 'sqlstate',
  '42501', 'gerente não convida corretor de outra equipe');
select is(public.rede_pode_convidar(pg_temp.id('ca1b')) ->> 'situacao', 'novo', 'gerente convida o próprio corretor');
select is(public.rede_pode_convidar(pg_temp.parceiro('ca1a')) ->> 'situacao', 'ja_ativo', 'já tem conta (não é convite pendente): ja_ativo');
insert into ids select 'ca1c', public.rede_cadastrar_parceiro('corretor',
  jsonb_build_object('nome', 'CA1c Corretor', 'cpf', pg_temp.cpf(12), 'creci', 'C-1C', 'email', 'GA2@fixture.test'), null, null);
insert into ids select 'ca1d', public.rede_cadastrar_parceiro('corretor',
  jsonb_build_object('nome', 'CA1d Corretor', 'cpf', pg_temp.cpf(13), 'creci', 'C-1D'), null, null);
insert into ids select 'ca1e', public.rede_cadastrar_parceiro('corretor',
  jsonb_build_object('nome', 'CA1e Corretor', 'cpf', pg_temp.cpf(14), 'creci', 'C-1E', 'email', 'ca1e@fixture.test'), null, null);
insert into ids select 'ca1f', public.rede_cadastrar_parceiro('corretor',
  jsonb_build_object('nome', 'CA1f Corretor', 'cpf', pg_temp.cpf(15), 'creci', 'C-1F', 'email', 'ca1f@fixture.test'), null, null);
select is(public.rede_pode_convidar(pg_temp.id('ca1c')) - 'profile_id' - 'nome',
  jsonb_build_object('pode', false, 'situacao', 'email_em_uso', 'email', 'ga2@fixture.test', 'modo_link', false),
  '§8.5: e-mail de outra conta → email_em_uso (nenhum link)');
select is(public.rede_pode_convidar(pg_temp.id('ca1d')) ->> 'situacao', 'sem_email', 'sem e-mail: sem_email');
select pg_temp.entrar('admin');
select ok((public.rede_pode_convidar(pg_temp.id('ga3')) ->> 'modo_link')::boolean, 'internos podem gerar o link (WhatsApp)');
select is(public.rede_pode_convidar(pg_temp.parceiro('inativo')) ->> 'situacao', 'indisponivel', 'inativo: indisponível');
select is(public.rede_pode_convidar((select c.corretor_casa_id from public.configuracao_geral c)) ->> 'situacao',
  'indisponivel', 'virtual da casa: indisponível');
select is(pg_temp.erro(format('select public.rede_pode_convidar(%L)', gen_random_uuid())) ->> 'sqlstate', '42501', 'inexistente: 42501');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria where entidade_id in (pg_temp.id('ga3')::text, pg_temp.id('ca1c')::text)
             and acao not in ('criar', 'editar', 'convite_consulta')),
  0, 'rede_pode_convidar não gera nada (só a consulta fica registrada)');
select ok((select count(*) = 3 and bool_and(categoria = 'seguranca' and detalhe ? 'situacao'
                                            and (select count(*) from jsonb_object_keys(detalhe)) = 1)
           from public.auditoria where acao = 'convite_consulta' and entidade_id in (pg_temp.id('ga3')::text, pg_temp.id('ca1c')::text)),
  '[WP1R-04] cada consulta de convite grava seguranca/convite_consulta com a situação, nunca o e-mail (a recusada, não)');
-- [WP1R-04] limite por hora de respostas email_em_uso: sem ele, quem cadastra um parceiro sem login trocava o e-mail
-- dele à vontade e perguntava ao Auth, sem rastro, se cada e-mail tem conta (inclusive de internos e titulares)
update public.configuracao_geral set duplicidade_bloqueios_hora = 2;
select pg_temp.entrar('ga1');
select is(public.rede_pode_convidar(pg_temp.id('ca1c')) ->> 'situacao', 'email_em_uso', '[WP1R-04] segunda resposta email_em_uso na hora');
select is(pg_temp.erro(format('select public.rede_pode_convidar(%L)', pg_temp.id('ca1b'))) ->> 'mensagem', 'LIMITE_CONVITES',
  '[WP1R-04] no limite, nenhuma consulta passa (nem a de e-mail livre)');
select pg_temp.entrar('ia');
select is(public.rede_pode_convidar(pg_temp.id('ca1c')) ->> 'situacao', 'email_em_uso', '[WP1R-04] o limite é de cada um');
select pg_temp.entrar('admin');
select is((select array_agg(public.rede_pode_convidar(pg_temp.id('ca1c')) ->> 'situacao') from generate_series(1, 3)),
  array['email_em_uso', 'email_em_uso', 'email_em_uso'], 'internos não têm limite de consultas');
select pg_temp.sair();
update public.configuracao_geral set duplicidade_bloqueios_hora = 10;

-- contas como o Auth cria no convite (convidada, sem senha, recém-criada) e casos de recusa
select pg_temp.conta('a0000000-0000-4000-8000-0000000000e1', 'ga3@fixture.test', now(), now(), null, '', 'GA3 Gerente');
select pg_temp.conta('a0000000-0000-4000-8000-0000000000e2', 'ca1b@fixture.test', now() - interval '1 hour', now() - interval '1 hour', null, '');
select pg_temp.conta('a0000000-0000-4000-8000-0000000000e3', 'ca1e@fixture.test', now(), now(), now(), '');
select pg_temp.conta('a0000000-0000-4000-8000-0000000000e4', 'ca1f@fixture.test', now(), now(), null, '$2a$10$hashdeumcadastroproprio');
select pg_temp.conta('a0000000-0000-4000-8000-0000000000e5', 'outro@fixture.test', now(), now(), null, '');
select pg_temp.conta('a0000000-0000-4000-8000-0000000000e6', 'semconvite@fixture.test', now(), null, null, '');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ga3'), 'a0000000-0000-4000-8000-0000000000e1')) ->> 'sqlstate',
  '42501', 'rede_vincular_login é só da service role');
select pg_temp.entrar_servico();
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ca1b'), 'a0000000-0000-4000-8000-0000000000e2')) -> 'detalhe' ->> 'motivo',
  'perfil_antigo', '§8.5: recusa perfil antigo (criado há mais de 10 min)');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ca1e'), 'a0000000-0000-4000-8000-0000000000e3')) -> 'detalhe' ->> 'motivo',
  'ja_entrou', '§8.5: recusa perfil que já entrou');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ca1f'), 'a0000000-0000-4000-8000-0000000000e4')) -> 'detalhe' ->> 'motivo',
  'com_senha', 'recusa conta com senha (não nasceu do convite)');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ca1f'), 'a0000000-0000-4000-8000-0000000000e5')) -> 'detalhe' ->> 'motivo',
  'email_diferente', '§8.5: recusa perfil de outro e-mail');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ca1f'), 'a0000000-0000-4000-8000-0000000000e6')) -> 'detalhe' ->> 'motivo',
  'nao_convidado', 'recusa conta que não foi convidada');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ca1c'), pg_temp.usuario('ga2'))) -> 'detalhe' ->> 'motivo',
  'perfil', 'recusa perfil que já tem papel na rede');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ga3'), 'a0000000-0000-4000-8000-0000000000e1')),
  null, 'aceita o perfil recém-criado pelo convite');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ga3'), 'a0000000-0000-4000-8000-0000000000e1')),
  null, 'repetir o mesmo par é idempotente');
select is(pg_temp.erro(format('select public.rede_vincular_login(%L, %L)', pg_temp.id('ga3'), 'a0000000-0000-4000-8000-0000000000e5')) -> 'detalhe' ->> 'motivo',
  'parceiro_ja_vinculado', 'parceiro já vinculado não troca de login');
select pg_temp.sair();
select ok((select p.profile_id = 'a0000000-0000-4000-8000-0000000000e1' and pr.papel = 'gerente' and pr.status_parceiro = 'aprovado'
           from public.parceiros p join public.profiles pr on pr.id = p.profile_id where p.id = pg_temp.id('ga3')),
  'papel = tipo do parceiro e acesso aprovado');
select is((select count(*)::int from public.auditoria where acao = 'convite' and categoria = 'seguranca' and origem = 'edge:convidar-parceiros'
             and entidade_id = pg_temp.id('ga3')::text), 1, 'auditoria seguranca/convite com a origem da Edge (uma vez)');
select pg_temp.entrar('ia');
select is(public.rede_pode_convidar(pg_temp.id('ga3')) - 'nome' - 'email' - 'modo_link',
  jsonb_build_object('pode', true, 'situacao', 'reenviar', 'profile_id', 'a0000000-0000-4000-8000-0000000000e1'),
  'vinculado a este parceiro e nunca entrou: reenviar (com o perfil, para a Edge conferir)');
select is(pg_temp.erro(format('select public.rede_registrar_convite(%L, %L, %L)', pg_temp.id('ga3'), 'email', pg_temp.usuario('ia'))) ->> 'sqlstate',
  '42501', 'rede_registrar_convite é só da service role');
select pg_temp.entrar_servico();
select is(pg_temp.erro(format('select public.rede_registrar_convite(%L, %L, %L)', pg_temp.id('ga3'), 'whatsapp', pg_temp.usuario('ia'))) -> 'detalhe' ->> 'motivo',
  'modo', 'modo fechado: email ou link');
select is(pg_temp.erro(format('select public.rede_registrar_convite(%L, %L, %L)', pg_temp.id('ga3'), 'email', pg_temp.usuario('ia'))),
  null, 'registra o convite');
select pg_temp.sair();
select is((select row(categoria, ator_id, ator_papel, ator_parceiro_id, origem, detalhe ->> 'modo')::text
           from public.auditoria where acao = 'link_gerado' and entidade_id = pg_temp.id('ga3')::text),
  row('seguranca'::public.categoria_auditoria, pg_temp.usuario('ia'), 'imobiliaria'::public.papel, pg_temp.parceiro('ia'),
      'edge:convidar-parceiros', 'email')::text,
  'auditoria seguranca/link_gerado: quem gerou, para quem e o modo (nunca o link)');

-- ============ 8. TRANSFERÊNCIA DE CLIENTES ============
-- estado: c1→CA1a (GA1), c2→CA2a (GA2), c3→CB1a (B), c4→GA1 (A1), c5→bloqueado; CA1b (GA1, sem login)
select pg_temp.entrar('ga1');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c1')], pg_temp.parceiro('ca2a'), 'mudança de equipe')) ->> 'sqlstate',
  '42501', '§8.5: GA1 não transfere c1 para CA2a (outra equipe)');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c2')], pg_temp.id('ca1b'), 'mudança de equipe')) ->> 'sqlstate',
  '42501', 'gerente não transfere cliente de outra equipe');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c1'), gen_random_uuid()], pg_temp.id('ca1b'), 'mudança de equipe')) ->> 'sqlstate',
  '42501', 'cliente inexistente no lote: 42501 (tudo ou nada)');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c1')], pg_temp.id('ca1b'), 'abc')) ->> 'mensagem',
  'MOTIVO_OBRIGATORIO', 'motivo com pelo menos 5 caracteres');
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c1')], pg_temp.id('ca1b'), 'mudança de equipe')) ->> 'sqlstate',
  '42501', 'matriz: corretor não transfere cliente');
select pg_temp.entrar('ga1');
select is(public.rede_transferir_clientes(array[pg_temp.cliente('c1'), pg_temp.cliente('c4')], pg_temp.id('ca1b'), 'redistribuição da carteira'),
  2, 'gerente transfere dentro da equipe, inclusive o cliente dele (A1)');
select pg_temp.sair();
select ok((select corretor_id = pg_temp.id('ca1b') and gerente_id = pg_temp.parceiro('ga1') and imobiliaria_id = pg_temp.imobiliaria('a')
           from public.clientes where id = pg_temp.cliente('c1')), 'cadeia do cliente recalculada');
select is((select dados from public.cliente_eventos where cliente_id = pg_temp.cliente('c1') and tipo = 'transferencia'),
  jsonb_build_object('de_corretor_id', pg_temp.parceiro('ca1a'), 'para_corretor_id', pg_temp.id('ca1b')), 'timeline transferencia (só ids)');
select is((select motivo from public.cliente_vinculos_historico where cliente_id = pg_temp.cliente('c1') and vigente_ate is null),
  'redistribuição da carteira', 'histórico de vínculos do cliente com o motivo');
select ok((select cliente_id = pg_temp.cliente('c1') and categoria = 'operacao' and antes ->> 'corretor_id' = pg_temp.parceiro('ca1a')::text
                  and depois ->> 'corretor_id' = pg_temp.id('ca1b')::text and ator_id = pg_temp.usuario('ga1')
           from public.auditoria where acao = 'transferir' and entidade = 'clientes' and entidade_id = pg_temp.cliente('c1')::text),
  'auditoria operacao/transferir (de → para) com o titular');

select pg_temp.entrar('ia');
select is(public.rede_transferir_clientes(array[pg_temp.cliente('c1')], pg_temp.parceiro('ca2a'), 'cliente pediu outro corretor'),
  1, 'imobiliária transfere entre equipes da própria imobiliária');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c3')], pg_temp.parceiro('ca1a'), 'mudança de equipe')) ->> 'sqlstate',
  '42501', 'imobiliária não transfere cliente de outra');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c2')], pg_temp.parceiro('cb1a'), 'mudança de equipe')) ->> 'sqlstate',
  '42501', 'imobiliária não transfere para corretor de outra');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c2')], pg_temp.parceiro('bloqueado'), 'mudança de equipe')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'destino bloqueado não recebe carteira');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c2')], pg_temp.parceiro('inativo'), 'mudança de equipe')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'destino inativo não recebe carteira');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c2')], pg_temp.parceiro('ia'), 'mudança de equipe')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'usuário de imobiliária não é responsável por cliente');
select pg_temp.sair();
update public.permissoes_rede set permitido = false where acao = 'gerente_como_corretor' and tipo = 'gerente';
select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c2')], pg_temp.parceiro('ga1'), 'mudança de equipe')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'A1 desligado: gerente não recebe cliente');
select pg_temp.sair();
update public.permissoes_rede set permitido = true where acao = 'gerente_como_corretor' and tipo = 'gerente';

-- c2 com contrato aguardando assinatura: a cadeia está congelada
insert into public.imoveis (id, nome, tipo, status, cep, uf, cidade, logradouro, numero, valor, criado_por)
values ('e1000000-0000-4000-8000-000000000001', 'Casa WP1', 'casa', 'aprovado', '01310100', 'SP', 'São Paulo', 'Avenida', '1', 500000, pg_temp.usuario('admin'));
insert into public.contratos (cliente_id, modelo_id, forma_pagamento, status, imovel_id, parametros_id, valor_imovel, perc_aporte,
                              valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte, valor_parcela, valor_total_parcelas)
values (pg_temp.cliente('c2'), public.modelo_vigente_id('parcelado'), 'parcelado', 'assinatura_pendente', 'e1000000-0000-4000-8000-000000000001',
        public.parametros_vigente_id(), 500000, 30, 150000, 0, 150000, 350000, 60, 8.5, 2712.50, 162750);
select pg_temp.entrar('ia');
select is(public.rede_transferir_clientes(array[pg_temp.cliente('c2')], pg_temp.parceiro('ca1a'), 'teste de congelamento'),
  0, 'cliente com contrato aguardando assinatura não é transferido (cadeia congelada ⚑)');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_transferir_clientes(%L, %L, %L)', array[pg_temp.cliente('c3')], pg_temp.parceiro('ca1a'), 'decisão comercial')) ->> 'mensagem',
  'Transferência de cliente entre imobiliárias só pelo Super.', 'admin não transfere entre imobiliárias');
select pg_temp.entrar('super');
select is(public.rede_transferir_clientes(array[pg_temp.cliente('c3')], pg_temp.parceiro('ca1a'), 'decisão da diretoria'),
  1, 'o Super transfere entre imobiliárias');
select pg_temp.sair();
select ok((select corretor_id = pg_temp.parceiro('ca2a') from public.clientes where id = pg_temp.cliente('c2')), 'c2 ficou com o corretor');
select ok((select imobiliaria_id = pg_temp.imobiliaria('a') and gerente_id = pg_temp.parceiro('ga1') from public.clientes where id = pg_temp.cliente('c3')),
  'c3 foi para a imobiliária A com a cadeia do novo corretor');

-- ============ 9. TRANSFERÊNCIA DE CORRETOR ============
-- estado: CA1a (GA1) com c3; CA2a (GA2) com c1 e c2 (congelado); CA1b (GA1) com c4
select pg_temp.entrar('ga1');
select is(pg_temp.erro(format('select public.rede_transferir_corretor(%L, %L, %L)', pg_temp.parceiro('ca1a'), pg_temp.parceiro('ga2'), 'reorganização')) ->> 'sqlstate',
  '42501', 'matriz: gerente não transfere corretor');
select pg_temp.entrar('ib');
select is(pg_temp.erro(format('select public.rede_transferir_corretor(%L, %L, %L)', pg_temp.parceiro('ca1a'), pg_temp.parceiro('gb1'), 'reorganização')) ->> 'sqlstate',
  '42501', 'outra imobiliária não mexe');
select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_transferir_corretor(%L, %L, %L)', pg_temp.parceiro('ca1a'), pg_temp.parceiro('gb1'), 'reorganização')) ->> 'sqlstate',
  '42501', 'gerente de outra imobiliária: fora do escopo');
select is(pg_temp.erro(format('select public.rede_transferir_corretor(%L, %L, %L)', pg_temp.parceiro('ca1a'), pg_temp.parceiro('ga1'), 'reorganização')) ->> 'mensagem',
  'O corretor já está com este gerente.', 'mesmo gerente: nada a fazer');
select is(pg_temp.erro(format('select public.rede_transferir_corretor(%L, %L, %L)', pg_temp.parceiro('ga1'), pg_temp.parceiro('ga2'), 'reorganização')) ->> 'mensagem',
  'Só corretores mudam de gerente.', 'só corretor muda de gerente');
select is(pg_temp.erro(format('select public.rede_transferir_corretor(%L, %L, %L)', pg_temp.parceiro('ca1a'), pg_temp.parceiro('ga2'), 'reorganização da equipe A')),
  null, 'imobiliária transfere o corretor para outro gerente da mesma imobiliária');
select pg_temp.sair();
select ok((select gerente_id = pg_temp.parceiro('ga2') and corretor_id = pg_temp.parceiro('ca1a') from public.clientes where id = pg_temp.cliente('c3')),
  '§8.5: a cascata leva os clientes na mesma transação');
select is((select motivo from public.parceiro_vinculos_historico where parceiro_id = pg_temp.parceiro('ca1a') and vigente_ate is null),
  'reorganização da equipe A', '§8.5: histórico de vínculos do corretor com o motivo');
select is((select count(*)::int from public.parceiro_vinculos_historico where parceiro_id = pg_temp.parceiro('ca1a') and vigente_ate is not null),
  1, 'o vínculo anterior foi fechado');
select is((select motivo from public.cliente_vinculos_historico where cliente_id = pg_temp.cliente('c3') and vigente_ate is null),
  'reorganização da equipe A', 'o histórico do cliente acompanha, com o mesmo motivo');
select ok((select antes ->> 'gerente_id' = pg_temp.parceiro('ga1')::text and depois ->> 'gerente_id' = pg_temp.parceiro('ga2')::text
                  and (detalhe ->> 'clientes')::int = 1
           from public.auditoria where acao = 'transferir' and entidade = 'parceiros' and entidade_id = pg_temp.parceiro('ca1a')::text),
  'auditoria operacao/transferir do corretor');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_transferir_corretor(%L, %L, %L)', pg_temp.parceiro('ca1a'), pg_temp.parceiro('gb1'), 'reorganização')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'mesmo para internos, o novo gerente é da mesma imobiliária (entre imobiliárias é outra RPC)');

-- ============ 10. MUDANÇA DE IMOBILIÁRIA (PAR-6, só o Super) ============
select pg_temp.sair();
insert into public.parceiros (id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci, email)
values ('c0000000-0000-4000-8000-0000000000b2', 'corretor', pg_temp.imobiliaria('a'), pg_temp.parceiro('ga2'), 'CA2b Corretor', pg_temp.cpf(21), 'C-2B', 'ca2b@fixture.test');
insert into public.clientes (id, nome, cpf, corretor_id, origem)
values ('d0000000-0000-4000-8000-000000000006', 'Cliente Seis', pg_temp.cpf(22), 'c0000000-0000-4000-8000-0000000000b2', 'cadastro_interno');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_mudar_imobiliaria_corretor(%L, %L, %L, %L)', 'c0000000-0000-4000-8000-0000000000b2',
    pg_temp.parceiro('gb1'), pg_temp.parceiro('ca2a'), 'foi para a imobiliária B')) ->> 'sqlstate',
  '42501', 'mudar corretor de imobiliária é do Super (§2.1 ⚑)');
select pg_temp.entrar('super');
select is(pg_temp.erro(format('select public.rede_mudar_imobiliaria_corretor(%L, %L, %L, %L)', 'c0000000-0000-4000-8000-0000000000b2',
    pg_temp.parceiro('ga1'), pg_temp.parceiro('ca2a'), 'foi para a imobiliária B')) ->> 'mensagem',
  'O gerente é da mesma imobiliária: use a transferência de corretor.', 'mesma imobiliária: é transferência de corretor');
select is(pg_temp.erro(format('select public.rede_mudar_imobiliaria_corretor(%L, %L, %L, %L)', 'c0000000-0000-4000-8000-0000000000b2',
    pg_temp.parceiro('gb1'), pg_temp.parceiro('cb1a'), 'foi para a imobiliária B')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'PAR-6: a carteira fica com alguém da imobiliária de origem');
select is(pg_temp.erro(format('select public.rede_mudar_imobiliaria_corretor(%L, %L, null, %L)', 'c0000000-0000-4000-8000-0000000000b2',
    pg_temp.parceiro('gb1'), 'foi para a imobiliária B')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'com carteira, o destino dela é obrigatório');
select is(pg_temp.erro(format('select public.rede_mudar_imobiliaria_corretor(%L, %L, %L, %L)', 'c0000000-0000-4000-8000-0000000000b2',
    pg_temp.parceiro('gb1'), pg_temp.parceiro('ca2a'), 'foi para a imobiliária B')),
  null, 'o Super muda o corretor de imobiliária');
select is(pg_temp.erro(format('select public.rede_mudar_imobiliaria_corretor(%L, %L, %L, %L)', pg_temp.parceiro('ca2a'),
    pg_temp.parceiro('gb1'), pg_temp.parceiro('ca1a'), 'foi para a imobiliária B')) ->> 'mensagem',
  'DESCENDENTES_ATIVOS', 'cliente com contrato aguardando assinatura impede a mudança (e nada é movido)');
select pg_temp.sair();
select ok((select imobiliaria_id = pg_temp.imobiliaria('b') and gerente_id = pg_temp.parceiro('gb1') from public.parceiros
           where id = 'c0000000-0000-4000-8000-0000000000b2'), 'o corretor está na imobiliária B');
select ok((select corretor_id = pg_temp.parceiro('ca2a') and imobiliaria_id = pg_temp.imobiliaria('a') from public.clientes
           where id = 'd0000000-0000-4000-8000-000000000006'), '§8.5 PAR-6: a carteira ficou na imobiliária de origem');
select is((select count(*)::int from public.clientes where corretor_id = 'c0000000-0000-4000-8000-0000000000b2'), 0, 'o corretor não levou clientes');
select ok((select depois ->> 'imobiliaria_id' = pg_temp.imobiliaria('b')::text and (detalhe ->> 'clientes_transferidos')::int = 1
           from public.auditoria where acao = 'transferir' and entidade = 'parceiros' and entidade_id = 'c0000000-0000-4000-8000-0000000000b2'),
  'auditoria operacao/transferir com a mudança de imobiliária');
select ok((select corretor_id = pg_temp.parceiro('ca2a') and imobiliaria_id = pg_temp.imobiliaria('a') from public.clientes where id = pg_temp.cliente('c1')),
  'a tentativa que falhou não moveu nada');

-- ============ 11. LEGADO (N3: só o Super, uma vez) ============
select pg_temp.conta('a0000000-0000-4000-8000-0000000000c1', 'legado@fixture.test', now() - interval '1 year', null, now() - interval '1 day', 'hash', 'Legado WordPress');
select pg_temp.conta('a0000000-0000-4000-8000-0000000000c2', 'legado2@fixture.test', now() - interval '1 year', null, now() - interval '1 day', 'hash', 'Legado Dois');
update public.profiles set status_parceiro = 'aprovado' where id in ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000c2');
insert into public.parceiros (id, profile_id, tipo, imobiliaria_id, gerente_id, nome, email, migrado_legado, imobiliaria_declarada, cpf, creci)
select v.id::uuid, v.perfil::uuid, 'corretor', c.imobiliaria_casa_id, c.gerente_casa_id, v.nome, v.email, true, 'Imobiliária antiga', v.cpf, v.creci
from public.configuracao_geral c
cross join (values ('c0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000c1', 'Legado WordPress', 'legado@fixture.test', null, null),
                   ('c0000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-0000000000c2', 'Legado Dois', 'legado2@fixture.test', pg_temp.cpf(25), 'CRECI-L2'))
  as v(id, perfil, nome, email, cpf, creci);
insert into public.clientes (id, nome, cpf, corretor_id, origem) values
  ('d0000000-0000-4000-8000-000000000007', 'Cliente Sete', pg_temp.cpf(23), 'c0000000-0000-4000-8000-0000000000c1', 'cadastro_interno'),
  ('d0000000-0000-4000-8000-000000000008', 'Cliente Oito', pg_temp.cpf(26), 'c0000000-0000-4000-8000-0000000000c2', 'cadastro_interno');
insert into public.lgpd_consentimentos (titular, profile_id, termo_id, origem)
select 'parceiro', x::uuid, public._termo_vigente_id('termos_parceiro'), 'cadastro_parceiro'
from unnest(array['a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000c2']) x;

select pg_temp.entrar_id('a0000000-0000-4000-8000-0000000000c1');
select is(public.meu_escopo() -> 'pendencias', '["cpf","creci"]'::jsonb, 'legado migrado: CPF e CRECI pendentes');
-- [WP1R-04] CPF de outro parceiro em Meu cadastro: termina sem erro para a tentativa ficar gravada, e nada muda
select is(pg_temp.erro($$select public.rede_atualizar_meu_cadastro('{"cpf":"12345670169","creci":"CRECI-LEG","telefone":"11955554444"}')$$),
  null, '[WP1R-04] Meu cadastro com CPF de outro parceiro não lança (o front confere e mostra DOCUMENTO_INDISPONIVEL)');
select pg_temp.sair();
select ok((select cpf is null and creci is null and telefone is null from public.parceiros where id = 'c0000000-0000-4000-8000-0000000000c1'),
  '[WP1R-04] e nada muda, nem os outros campos');
select ok((select count(*) = 1 and bool_and(categoria = 'seguranca' and campos = '{cpf}' and detalhe = '{"proprio":true}'::jsonb
                                            and ator_id = 'a0000000-0000-4000-8000-0000000000c1')
           from public.auditoria where acao = 'documento_indisponivel' and entidade_id = 'c0000000-0000-4000-8000-0000000000c1'),
  '[WP1R-04] a tentativa fica em seguranca/documento_indisponivel, sem o CPF');
update public.configuracao_geral set duplicidade_bloqueios_hora = 1;
select pg_temp.entrar_id('a0000000-0000-4000-8000-0000000000c1');
select is(pg_temp.erro(format('select public.rede_atualizar_meu_cadastro(%L)', jsonb_build_object('cpf', pg_temp.cpf(24)))) ->> 'mensagem',
  'LIMITE_DUPLICIDADE', '[WP1R-04] no limite por hora, Meu cadastro não aceita CPF nenhum');
select pg_temp.sair();
update public.configuracao_geral set duplicidade_bloqueios_hora = 10;
select pg_temp.entrar_id('a0000000-0000-4000-8000-0000000000c1');
select is(pg_temp.erro(format('select public.rede_atualizar_meu_cadastro(%L)', jsonb_build_object('cpf', pg_temp.cpf(24), 'creci', 'CRECI-LEG'))),
  null, 'o legado completa CPF e CRECI em Meu cadastro');
select is(public.meu_escopo() -> 'pendencias', '[]'::jsonb, 'sem pendências de cadastro');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_regularizar_legado(%L, %L, false)', 'c0000000-0000-4000-8000-0000000000c1', pg_temp.parceiro('ga1'))) ->> 'sqlstate',
  '42501', '§8.5 N3: só o Super regulariza');
select pg_temp.entrar('super');
select is(pg_temp.erro(format('select public.rede_regularizar_legado(%L, %L, null)', 'c0000000-0000-4000-8000-0000000000c1', pg_temp.parceiro('ga1'))) -> 'detalhe' ->> 'motivo',
  'levar_clientes', 'N3: levar os clientes é escolha explícita (sem padrão)');
select is(pg_temp.erro(format('select public.rede_regularizar_legado(%L, %L, false)', 'c0000000-0000-4000-8000-0000000000c1',
    (select c.gerente_casa_id from public.configuracao_geral c))) ->> 'mensagem',
  'DESTINO_INVALIDO', 'regulariza para uma imobiliária real');
select is(pg_temp.erro(format('select public.rede_regularizar_legado(%L, %L, false)', pg_temp.parceiro('ca1a'), pg_temp.parceiro('ga1'))) ->> 'mensagem',
  'Só um corretor migrado que ainda está na imobiliária da casa pode ser regularizado (uma vez).', 'só migrado_legado');
select is(pg_temp.erro(format('select public.rede_regularizar_legado(%L, %L, false)', 'c0000000-0000-4000-8000-0000000000c1', pg_temp.parceiro('ga1'))),
  null, 'o Super regulariza o legado sem levar os clientes');
select is(pg_temp.erro(format('select public.rede_regularizar_legado(%L, %L, true)', 'c0000000-0000-4000-8000-0000000000c2', pg_temp.parceiro('gb1'))),
  null, 'o Super regulariza o legado levando os clientes (exceção declarada ao PAR-6)');
select is(pg_temp.erro(format('select public.rede_regularizar_legado(%L, %L, true)', 'c0000000-0000-4000-8000-0000000000c1', pg_temp.parceiro('ga2'))) ->> 'mensagem',
  'Só um corretor migrado que ainda está na imobiliária da casa pode ser regularizado (uma vez).', '§8.5: regulariza uma vez só');
select pg_temp.sair();
select ok((select imobiliaria_id = pg_temp.imobiliaria('a') and gerente_id = pg_temp.parceiro('ga1') from public.parceiros
           where id = 'c0000000-0000-4000-8000-0000000000c1'), 'o legado foi para a imobiliária real');
select ok((select c.corretor_id = g.corretor_casa_id from public.clientes c cross join public.configuracao_geral g
           where c.id = 'd0000000-0000-4000-8000-000000000007'), 'sem levar, a carteira fica na casa (Carteira Arken)');
select ok((select corretor_id = 'c0000000-0000-4000-8000-0000000000c2' and imobiliaria_id = pg_temp.imobiliaria('b') and gerente_id = pg_temp.parceiro('gb1')
           from public.clientes where id = 'd0000000-0000-4000-8000-000000000008'), 'levando, o cliente acompanha o corretor');
select ok((select (detalhe ->> 'levar_clientes')::boolean = false and (detalhe ->> 'clientes')::int = 1 and categoria = 'operacao'
           from public.auditoria where acao = 'regularizar' and entidade_id = 'c0000000-0000-4000-8000-0000000000c1'),
  'auditoria operacao/regularizar com a escolha');
set local arken.motivo_vinculo = 'teste: volta para a casa';
update public.parceiros set gerente_id = (select c.gerente_casa_id from public.configuracao_geral c) where id = 'c0000000-0000-4000-8000-0000000000c1';
set local arken.motivo_vinculo = '';
select pg_temp.entrar('super');
select is(pg_temp.erro(format('select public.rede_regularizar_legado(%L, %L, true)', 'c0000000-0000-4000-8000-0000000000c1', pg_temp.parceiro('ga2'))) ->> 'mensagem',
  'Só um corretor migrado que ainda está na imobiliária da casa pode ser regularizado (uma vez).', 'mesmo de volta à casa, não regulariza de novo');

-- ============ 12. INATIVAÇÃO E REATIVAÇÃO ============
select pg_temp.sair();
select pg_temp.conta('a0000000-0000-4000-8000-0000000000d1', 'cy@fixture.test', now() - interval '30 days', null, now() - interval '1 day', 'hash', 'CY Corretor');
update public.profiles set papel = 'corretor', status_parceiro = 'aprovado' where id = 'a0000000-0000-4000-8000-0000000000d1';
insert into public.parceiros (id, profile_id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci, email, codigo_indicacao) values
  ('c0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-0000000000d1', 'corretor', pg_temp.imobiliaria('a'), pg_temp.parceiro('ga1'),
   'CY Corretor', pg_temp.cpf(30), 'C-CY', 'cy@fixture.test', 'linkcyumaa');
insert into public.parceiros (id, tipo, imobiliaria_id, nome, cpf) values
  ('c0000000-0000-4000-8000-0000000000e0', 'gerente', pg_temp.imobiliaria('a'), 'GX Gerente', pg_temp.cpf(31));
insert into public.parceiros (id, tipo, imobiliaria_id, gerente_id, nome, cpf, creci) values
  ('c0000000-0000-4000-8000-0000000000e1', 'corretor', pg_temp.imobiliaria('a'), 'c0000000-0000-4000-8000-0000000000e0', 'CX1 Corretor', pg_temp.cpf(32), 'C-X1'),
  ('c0000000-0000-4000-8000-0000000000e2', 'corretor', pg_temp.imobiliaria('a'), 'c0000000-0000-4000-8000-0000000000e0', 'CX2 Corretor', pg_temp.cpf(33), 'C-X2'),
  ('c0000000-0000-4000-8000-0000000000e3', 'corretor', pg_temp.imobiliaria('a'), 'c0000000-0000-4000-8000-0000000000e0', 'CZ Corretor', pg_temp.cpf(35), 'C-Z');
set local arken.motivo_vinculo = 'fixture: desligamento';
update public.parceiros set inativado_em = now() where id = 'c0000000-0000-4000-8000-0000000000e3';
set local arken.motivo_vinculo = '';
insert into public.clientes (id, nome, cpf, corretor_id, origem) values
  ('d0000000-0000-4000-8000-000000000009', 'Cliente Nove', pg_temp.cpf(34), 'c0000000-0000-4000-8000-0000000000d1', 'cadastro_interno'),
  ('d0000000-0000-4000-8000-000000000010', 'Cliente Dez', pg_temp.cpf(36), 'c0000000-0000-4000-8000-0000000000e1', 'cadastro_interno'),
  ('d0000000-0000-4000-8000-000000000011', 'Cliente Onze', pg_temp.cpf(37), 'c0000000-0000-4000-8000-0000000000e0', 'cadastro_interno');

select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, null, %L)', 'c0000000-0000-4000-8000-0000000000d1', 'desligado da equipe')) -> 'detalhe' ->> 'motivo',
  'destino_obrigatorio', '§8.5: inativar corretor com carteira sem destino falha');
select pg_temp.entrar('ga1');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000d1', pg_temp.parceiro('ca2a'), 'desligado da equipe')) ->> 'sqlstate',
  '42501', '§8.5: destino fora do escopo de quem chama (outra equipe) falha');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000d1', pg_temp.parceiro('cb1a'), 'desligado da equipe')) ->> 'sqlstate',
  '42501', 'destino de outra imobiliária falha');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000d1', pg_temp.parceiro('bloqueado'), 'desligado da equipe')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'destino bloqueado falha');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000d1', 'c0000000-0000-4000-8000-0000000000d1', 'desligado da equipe')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'o próprio parceiro não é destino');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', pg_temp.parceiro('ca2a'), pg_temp.parceiro('ga2'), 'desligado da equipe')) ->> 'sqlstate',
  '42501', 'gerente não inativa corretor de outra equipe');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', pg_temp.parceiro('ga2'), pg_temp.parceiro('ga1'), 'desligado da equipe')) ->> 'sqlstate',
  '42501', 'gerente não inativa gerente');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000d1', pg_temp.parceiro('ga1'), 'desligado da equipe')),
  null, 'gerente inativa o próprio corretor, com a carteira indo para ele (A1)');
select pg_temp.sair();
select ok((select inativado_em is not null and codigo_indicacao is null and motivo_inativacao = 'desligado da equipe'
           from public.parceiros where id = 'c0000000-0000-4000-8000-0000000000d1'), 'vínculo inativado e código de indicação apagado');
select is((select status_parceiro::text from public.profiles where id = 'a0000000-0000-4000-8000-0000000000d1'), 'inativo',
  'acesso inativo (o hook recusa novos tokens)');
select ok((select corretor_id = pg_temp.parceiro('ga1') from public.clientes where id = 'd0000000-0000-4000-8000-000000000009'),
  'nenhum cliente órfão: a carteira foi para o destino');
select ok((select (detalhe ->> 'clientes_transferidos')::int = 1 and depois ->> 'status_parceiro' = 'inativo'
           from public.auditoria where acao = 'inativar' and entidade = 'parceiros' and entidade_id = 'c0000000-0000-4000-8000-0000000000d1'),
  'auditoria operacao/inativar');
select is((select motivo from public.parceiro_status_historico where parceiro_id = 'c0000000-0000-4000-8000-0000000000d1' and para = 'inativo'),
  'desligado da equipe', 'o motivo fica no histórico de status');

select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, null, %L)', 'c0000000-0000-4000-8000-0000000000e0', 'saiu da empresa')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'gerente com equipe exige destino');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000e0', 'c0000000-0000-4000-8000-0000000000e1', 'saiu da empresa')) ->> 'mensagem',
  'DESTINO_INVALIDO', 'o destino de um gerente é outro gerente');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000e0', pg_temp.parceiro('gb1'), 'saiu da empresa')) ->> 'sqlstate',
  '42501', 'gerente de outra imobiliária: fora do escopo');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', 'c0000000-0000-4000-8000-0000000000e0', pg_temp.parceiro('ga1'), 'saiu da empresa')),
  null, 'imobiliária inativa o gerente: corretores e clientes diretos vão para o gerente de destino');
select pg_temp.sair();
select is((select count(*)::int from public.parceiros where gerente_id = pg_temp.parceiro('ga1')
             and id in ('c0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e2')), 2, 'os corretores foram para o gerente de destino');
select ok((select gerente_id = pg_temp.parceiro('ga1') and corretor_id = 'c0000000-0000-4000-8000-0000000000e1' from public.clientes
           where id = 'd0000000-0000-4000-8000-000000000010'), 'a cascata levou os clientes dos corretores');
select ok((select corretor_id = pg_temp.parceiro('ga1') from public.clientes where id = 'd0000000-0000-4000-8000-000000000011'),
  'os clientes diretos do gerente (A1) foram para o gerente de destino');
select ok((select inativado_em is not null from public.parceiros where id = 'c0000000-0000-4000-8000-0000000000e0'), 'gerente inativado');
select is((select count(*)::int from public.auditoria where acao = 'transferir' and entidade = 'parceiros' and detalhe ->> 'inativacao_de' = 'c0000000-0000-4000-8000-0000000000e0'),
  2, 'cada corretor movido na inativação tem a sua auditoria');

select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, %L, %L)', pg_temp.parceiro('ca2a'), pg_temp.parceiro('ca1a'), 'teste de sobra')) ->> 'mensagem',
  'DESCENDENTES_ATIVOS', 'falha se sobrar cliente (contrato aguardando assinatura)');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, null, %L)', pg_temp.parceiro('ia'), 'saiu da imobiliária')) ->> 'sqlstate',
  '42501', 'usuário de imobiliária: só internos inativam');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, null, %L)', (select c.corretor_casa_id from public.configuracao_geral c), 'teste da casa')) ->> 'mensagem',
  'A cadeia da casa não pode ser inativada.', 'a cadeia da casa não é inativada');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, null, %L)', pg_temp.id('ib2'), 'saiu da imobiliária')),
  null, 'interno inativa usuário de imobiliária (sem nada a mover, sem destino)');
select is(pg_temp.erro(format('select public.rede_inativar_parceiro(%L, null, %L)', pg_temp.id('ib2'), 'saiu da imobiliária')) ->> 'mensagem',
  'O parceiro já está inativo.', 'não inativa duas vezes');

select pg_temp.entrar('ia');
select is(pg_temp.erro(format('select public.rede_reativar_parceiro(%L)', 'c0000000-0000-4000-8000-0000000000d1')) ->> 'sqlstate',
  '42501', 'só internos reativam');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format('select public.rede_reativar_parceiro(%L)', 'c0000000-0000-4000-8000-0000000000d1')), null, 'interno reativa (inativo → aprovado)');
select is(pg_temp.erro(format('select public.rede_reativar_parceiro(%L)', 'c0000000-0000-4000-8000-0000000000d1')) ->> 'mensagem',
  'O parceiro já está ativo.', 'só reativa quem está inativo');
select is(pg_temp.erro(format('select public.rede_reativar_parceiro(%L)', 'c0000000-0000-4000-8000-0000000000e3')) ->> 'sqlstate',
  '23514', 'não reativa corretor de gerente inativo (gatilho da cadeia)');
select pg_temp.sair();
select ok((select inativado_em is null and inativado_por is null and motivo_inativacao is null and codigo_indicacao ~ '^[a-z2-7]{10}$'
           from public.parceiros where id = 'c0000000-0000-4000-8000-0000000000d1'), 'reativado com código de indicação novo');
select is((select status_parceiro::text from public.profiles where id = 'a0000000-0000-4000-8000-0000000000d1'), 'aprovado', 'acesso aprovado de novo');
select is(pg_temp.aud('reativar', 'parceiros', 'c0000000-0000-4000-8000-0000000000d1'), 1, 'auditoria operacao/reativar');
select is((select motivo from public.parceiro_vinculos_historico where parceiro_id = 'c0000000-0000-4000-8000-0000000000d1' and vigente_ate is null),
  'reativação', 'o vínculo reabre no histórico');

-- ============ 13. LINK DE INDICAÇÃO ============
select pg_temp.entrar('cb1a');
insert into cods select 'cb1a', public.rede_gerar_codigo_indicacao();
select pg_temp.entrar('ga1');
insert into cods select 'ga1', public.rede_gerar_codigo_indicacao();
select pg_temp.entrar('ia');
select is(pg_temp.erro('select public.rede_gerar_codigo_indicacao()') ->> 'sqlstate', '42501', 'usuário de imobiliária não tem link de indicação');
select pg_temp.entrar('bloqueado');
select is(pg_temp.erro('select public.rede_gerar_codigo_indicacao()') ->> 'sqlstate', '42501', 'bloqueado não gera código');
select pg_temp.sair();
insert into cods select 'casa', p.codigo_indicacao from public.parceiros p join public.configuracao_geral c on c.corretor_casa_id = p.id;
select ok((select pg_temp.cod('cb1a') ~ '^[a-z2-7]{10}$' and codigo_indicacao = pg_temp.cod('cb1a') from public.parceiros where id = pg_temp.parceiro('cb1a')),
  'o corretor gera um código novo');
select ok((select position(pg_temp.cod('cb1a') in coalesce(antes::text, '') || coalesce(depois::text, '') || detalhe::text) = 0
           from public.auditoria where acao = 'gerar' and entidade_id = pg_temp.parceiro('cb1a')::text), 'auditoria operacao/gerar sem o código');
select pg_temp.entrar_anon();
select is(public.rede_link_publico('linkcbumaa'), null, 'o código anterior deixa de valer');
select is(public.rede_link_publico(pg_temp.cod('cb1a')),
  jsonb_build_object('nome_corretor', 'CB1a Corretor Silva', 'nome_imobiliaria', 'Imobiliária B'), 'anon lê o nome do corretor e da imobiliária');
select is(public.rede_link_publico(' ' || upper(pg_temp.cod('ga1')) || ' '),
  jsonb_build_object('nome_corretor', 'GA1 Gerente', 'nome_imobiliaria', 'Imobiliária A'), 'gerente com A1 tem link; espaços e maiúsculas são ignorados');
select is(public.rede_link_publico('linkbloque'), null, 'corretor bloqueado: nulo (mesma resposta de inexistente)');
select is(public.rede_link_publico('xxxxxxxxxx'), null, 'inexistente: nulo');
select is(public.rede_link_publico('drop table'), null, 'fora do formato: nulo');
select is(public.rede_link_publico(pg_temp.cod('casa')),
  jsonb_build_object('nome_corretor', 'Arken Incorporadora', 'nome_imobiliaria', null), 'link da casa: Arken Incorporadora, sem imobiliária');
select is(pg_temp.erro(format('select public.rede_parceiro_detalhe(%L)', pg_temp.parceiro('ca1a'))) ->> 'sqlstate',
  '42501', 'anon não executa as RPCs de usuário da rede');
select pg_temp.sair();
update public.permissoes_rede set permitido = false where acao = 'gerente_como_corretor' and tipo = 'gerente';
select pg_temp.entrar_anon();
select is(public.rede_link_publico(pg_temp.cod('ga1')), null, 'A1 desligado: o link do gerente deixa de valer');
select pg_temp.sair();
update public.permissoes_rede set permitido = true where acao = 'gerente_como_corretor' and tipo = 'gerente';

-- ============ 14. HIGIENE DA AUDITORIA (§5.1) ============
select is((select count(*)::int from public.auditoria a
           where a.entidade in ('parceiros', 'imobiliarias', 'clientes', 'profiles')
             and (exists (select 1 from public.parceiros p where p.cpf is not null
                          and position(p.cpf in coalesce(a.antes::text, '') || coalesce(a.depois::text, '') || a.detalhe::text) > 0)
                  or (coalesce(a.antes::text, '') || coalesce(a.depois::text, '') || a.detalhe::text) ~ '@'
                  or exists (select 1 from public.parceiro_status_historico s where s.motivo is not null
                             and position(s.motivo in coalesce(a.antes::text, '') || coalesce(a.depois::text, '') || a.detalhe::text) > 0))),
  0, 'a auditoria da rede não guarda CPF, e-mail nem motivo');
select is((select count(*)::int from public.auditoria a where a.origem = 'rpc' and a.ator_id is null
             and a.entidade in ('parceiros', 'imobiliarias', 'clientes', 'profiles')), 0, 'toda auditoria das RPCs tem o ator');
select is((select count(*)::int from public.parceiro_status_historico), (select count(*)::int from public.parceiro_status_historico where ator_id is not null or origem <> 'rpc'),
  'o histórico de status guarda quem fez');

select * from finish();
rollback;
