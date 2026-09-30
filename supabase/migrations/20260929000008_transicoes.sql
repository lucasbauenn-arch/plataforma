-- Transições de status permitidas (docs/ARQUITETURA_EXPANSAO.md §1.1 E2/F1/F2/D5, §3.8, §8.1).
-- Toda mudança de status (etapa do cliente, documento, contrato, imóvel) passa por _transicionar() (09), que lê esta
-- tabela. Validações e efeitos são uma LISTA FECHADA executada por CASE (nunca SQL dinâmico): o Super edita só
-- papéis, exigência de motivo e `ativa`; não cria linhas, validações nem efeitos.
-- Papéis: P = corretor, gerente, imobiliaria, parceiro (legado); I = admin, super; C = cliente.
-- Nenhuma referência a objeto de migration posterior.

create table public.status_transicoes (
  entidade text not null check (entidade in ('cliente_etapa', 'documento', 'contrato', 'imovel')),
  de text not null,
  para text not null,
  papeis public.papel[] not null default '{}',     -- quem aciona manualmente ('{}' = ninguém)
  permite_criador boolean not null default false,  -- imóvel: o criador conta como autorizado
  sistema boolean not null default false,          -- automações (webhook, efeitos) podem acionar
  exige_motivo boolean not null default false,
  validacoes text[] not null default '{}' check (validacoes <@ array['contrato_assinado', 'campos_obrigatorios_imovel',
               'pdf_gerado', 'signatarios_configurados', 'vendedora_configurada', 'modelo_liberado', 'email_cliente',
               'valor_produto_atual', 'arquivo_enviado']::text[]),
  efeitos text[] not null default '{}' check (efeitos <@ array['solicitar_documentos_basicos', 'limpar_motivo_perda',
               'notificar_documento_rejeitado', 'imovel_no_contrato', 'imovel_aprovado', 'cliente_finalizado',
               'evento_contrato_assinado']::text[]),
  ativa boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id) on delete set null,
  primary key (entidade, de, para),
  check (de <> para),
  check (not permite_criador or entidade = 'imovel')
);

-- Valida cada linha (inserção pela migration ou alteração pelo Super):
--  * de/para pertencem ao enum da entidade;
--  * cada validação e efeito só vale para a sua entidade;
--  * 'colaborador' nunca aciona; 'cliente' só aciona o envio de documento (→ em_analise, pelo portal): nunca analisa;
--  * destinos que dependem do D4Sign ou do envio (contrato → assinatura_pendente/assinado/recusado/expirado; imóvel
--    de ou para no_contrato) são só do sistema: nenhum papel pode ser acrescentado;
--  * toda saída de contrato em assinatura_pendente também depende do D4Sign (o cancelamento é feito lá antes, pela
--    Edge contrato-assinatura, §3.8/§6.4): no máximo admin e super; nenhum papel de parceiro pode ser acrescentado.
create function public._status_transicoes_valida() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_valores text[];
  v_x text;
begin
  v_valores := case new.entidade
    when 'cliente_etapa' then enum_range(null::public.etapa_funil)::text[]
    when 'documento' then enum_range(null::public.status_documento)::text[]
    when 'contrato' then enum_range(null::public.status_contrato)::text[]
    when 'imovel' then enum_range(null::public.status_imovel)::text[]
  end;
  if new.de <> all (v_valores) or new.para <> all (v_valores) then
    raise exception 'Status inválido para a entidade % (% → %)', new.entidade, new.de, new.para using errcode = '23514';
  end if;

  foreach v_x in array new.validacoes loop
    if not (case v_x
              when 'contrato_assinado' then new.entidade = 'cliente_etapa'
              when 'campos_obrigatorios_imovel' then new.entidade = 'imovel'
              when 'arquivo_enviado' then new.entidade = 'documento'
              else new.entidade = 'contrato'
            end) then
      raise exception 'A validação % não se aplica a %', v_x, new.entidade using errcode = '23514';
    end if;
  end loop;
  foreach v_x in array new.efeitos loop
    if not (case v_x
              when 'solicitar_documentos_basicos' then new.entidade = 'cliente_etapa'
              when 'limpar_motivo_perda' then new.entidade = 'cliente_etapa'
              when 'notificar_documento_rejeitado' then new.entidade = 'documento'
              else new.entidade = 'contrato'
            end) then
      raise exception 'O efeito % não se aplica a %', v_x, new.entidade using errcode = '23514';
    end if;
  end loop;

  if 'colaborador' = any (new.papeis)
     or ('cliente' = any (new.papeis) and not (new.entidade = 'documento' and new.para = 'em_analise')) then
    raise exception 'Papel não permitido nesta transição' using errcode = '23514';
  end if;
  if cardinality(new.papeis) > 0
     and ((new.entidade = 'contrato' and new.para in ('assinatura_pendente', 'assinado', 'recusado', 'expirado'))
          or (new.entidade = 'imovel' and 'no_contrato' in (new.de, new.para))) then
    raise exception 'Esta transição é só do sistema' using errcode = '23514';
  end if;
  if new.entidade = 'contrato' and new.de = 'assinatura_pendente'
     and not (new.papeis <@ array['admin', 'super']::public.papel[]) then
    raise exception 'A saída da assinatura pendente depende do D4Sign: só admin e super' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger carimbar before insert or update on public.status_transicoes
  for each row execute function public.carimbar();
create trigger status_transicoes_valida before insert or update on public.status_transicoes
  for each row execute function public._status_transicoes_valida();
create trigger auditar_linha after update on public.status_transicoes
  for each row execute function public.auditar_linha('papeis,exige_motivo,ativa', 'configuracao', 'valores', 'entidade,de,para');

-- ============ SEMENTE (§3.8) ============
insert into public.status_transicoes (entidade, de, para, papeis, permite_criador, sistema, exige_motivo, validacoes, efeitos, ativa)
values
  -- Funil (F1, F2)
  ('cliente_etapa', 'novo_contato',     'contato_iniciado', '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{}', '{}', true),
  ('cliente_etapa', 'contato_iniciado', 'documentacao',     '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{}', '{solicitar_documentos_basicos}', true),
  ('cliente_etapa', 'novo_contato',     'perdido',          '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, true,  '{}', '{}', true),
  ('cliente_etapa', 'contato_iniciado', 'perdido',          '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, true,  '{}', '{}', true),
  ('cliente_etapa', 'documentacao',     'perdido',          '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, true,  '{}', '{}', true),
  ('cliente_etapa', 'perdido',          'novo_contato',     '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{}', '{limpar_motivo_perda}', true),
  ('cliente_etapa', 'novo_contato',     'finalizado',       '{}', false, true, false, '{contrato_assinado}', '{}', true),
  ('cliente_etapa', 'contato_iniciado', 'finalizado',       '{}', false, true, false, '{contrato_assinado}', '{}', true),
  ('cliente_etapa', 'documentacao',     'finalizado',       '{}', false, true, false, '{contrato_assinado}', '{}', true),
  ('cliente_etapa', 'perdido',          'finalizado',       '{}', false, true, false, '{contrato_assinado}', '{}', true),
  -- voltar de etapa não é permitido (F2 ⚑): linhas inativas, que o Super pode ligar
  ('cliente_etapa', 'contato_iniciado', 'novo_contato',     '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{}', '{}', false),
  ('cliente_etapa', 'documentacao',     'contato_iniciado', '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{}', '{}', false),
  ('cliente_etapa', 'documentacao',     'novo_contato',     '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{}', '{}', false),

  -- Documento (F4 ⚑: a análise por parceiro também depende de permissoes_rede 'analisar_documento')
  ('documento', 'pendente',   'em_analise', '{cliente,corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{arquivo_enviado}', '{}', true),
  ('documento', 'rejeitado',  'em_analise', '{cliente,corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{arquivo_enviado}', '{}', true),
  ('documento', 'em_analise', 'aprovado',   '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{}', '{}', true),
  ('documento', 'em_analise', 'rejeitado',  '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, true,  '{}', '{notificar_documento_rejeitado}', true),

  -- Contrato (D1, D5; "assinado" não se arquiva nesta etapa: distrato é financeiro ⚑)
  ('contrato', 'rascunho',              'documentacao_pendente', '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{}', '{}', true),
  ('contrato', 'rascunho',              'em_analise',            '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{pdf_gerado}', '{}', true),
  ('contrato', 'documentacao_pendente', 'em_analise',            '{corretor,gerente,imobiliaria,parceiro,admin,super}', false, false, false, '{pdf_gerado}', '{}', true),
  ('contrato', 'em_analise',            'rascunho',              '{admin,super}', false, false, true, '{}', '{}', true),
  ('contrato', 'em_analise',            'documentacao_pendente', '{admin,super}', false, false, true, '{}', '{}', true),
  ('contrato', 'em_analise',            'assinatura_pendente',   '{}', false, true, false,
     '{pdf_gerado,modelo_liberado,signatarios_configurados,vendedora_configurada,email_cliente,valor_produto_atual}',
     '{imovel_no_contrato}', true),
  ('contrato', 'assinatura_pendente',   'assinado',              '{}', false, true, false, '{}', '{cliente_finalizado,evento_contrato_assinado}', true),
  ('contrato', 'assinatura_pendente',   'recusado',              '{}', false, true, false, '{}', '{imovel_aprovado}', true),
  ('contrato', 'assinatura_pendente',   'expirado',              '{}', false, true, false, '{}', '{imovel_aprovado}', true),
  ('contrato', 'assinatura_pendente',   'cancelado',             '{admin,super}', false, true, true, '{}', '{imovel_aprovado}', true),
  ('contrato', 'rascunho',              'arquivado',             '{admin,super}', false, false, true, '{}', '{}', true),
  ('contrato', 'documentacao_pendente', 'arquivado',             '{admin,super}', false, false, true, '{}', '{}', true),
  ('contrato', 'em_analise',            'arquivado',             '{admin,super}', false, false, true, '{}', '{}', true),
  ('contrato', 'recusado',              'arquivado',             '{admin,super}', false, false, true, '{}', '{}', true),
  ('contrato', 'expirado',              'arquivado',             '{admin,super}', false, false, true, '{}', '{}', true),
  ('contrato', 'cancelado',             'arquivado',             '{admin,super}', false, false, true, '{}', '{}', true),

  -- Imóvel (E2)
  ('imovel', 'rascunho',    'pendente',    '{admin,super}', true,  false, false, '{campos_obrigatorios_imovel}', '{}', true),
  ('imovel', 'pendente',    'em_revisao',  '{admin,super}', false, false, false, '{}', '{}', true),
  ('imovel', 'em_revisao',  'aprovado',    '{admin,super}', false, false, false, '{}', '{}', true),
  ('imovel', 'em_revisao',  'rascunho',    '{admin,super}', false, false, true,  '{}', '{}', true),
  ('imovel', 'aprovado',    'no_contrato', '{}', false, true, false, '{}', '{}', true),
  ('imovel', 'no_contrato', 'aprovado',    '{}', false, true, false, '{}', '{}', true);

-- ============ RLS (políticas na 20260929000009) ============
alter table public.status_transicoes enable row level security;

-- ============ GRANTS (§4.2) ============
revoke all on public.status_transicoes from anon, authenticated, service_role;
-- leitura (menu, kanban e destinos da ficha); o Super edita só papéis, motivo e ativa (política is_super na 09)
grant select on public.status_transicoes to authenticated;
grant update (papeis, exige_motivo, ativa) on public.status_transicoes to authenticated;
grant select, insert, update, delete on public.status_transicoes to service_role;

revoke execute on function public._status_transicoes_valida() from public, anon, authenticated, service_role;
