-- Contratos e D4Sign [WP4] (docs/ARQUITETURA_EXPANSAO.md §1.1 D1–D6, N4, N5, N16, N17, §3.6, §3.8, §3.10, §4.3–§4.6,
-- §6.3–§6.5, §8.5): vetores de simulação (bloco VETORES, o mesmo JSON de _shared/simulacao.vetores.json); limites de
-- 12 e 360; entrada maior que o aporte; flexível sem mínimo; valor = valor do produto (o front não manda valor);
-- valores imutáveis fora de rascunho; cascata não mexe na cadeia depois do envio; contrato_registrar_retorno duas
-- vezes = 1 transição e 1 evento; assinado seguido de recusado é ignorado; assinado → cliente FI + eventos_dominio;
-- imóvel NC no envio e AP no cancelamento; um contrato ativo por produto; RPCs de sistema negadas a authenticated.
-- Cada RPC: negada fora do escopo (42501, mesma mensagem para inexistente) e com auditoria gravada.
-- Dados como postgres (fixture comum + produtos e objetos do Storage abaixo); só as RPCs deste pacote são chamadas.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fixtures/rede.psql

-- VETORES:INICIO (mesmo conteúdo de supabase/functions/_shared/simulacao.vetores.json; simulacao.sincronia.test.ts confere)
create temp table vetores as
select v.ordinality::int as n, v.value as vetor from jsonb_array_elements($vetores$
[
  {
    "descricao": "doc §8.5: 500.000 × 30% − 50.000, 60×, 8,5%",
    "entrada": {"forma": "parcelado", "valor": 500000, "perc_aporte": 30, "entrada": 50000, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 500000, "perc_aporte": 30, "valor_aporte": 150000, "valor_entrada": 50000, "base_parcelada": 100000, "valor_restante": 350000, "n_parcelas": 60, "taxa_aporte": 8.5, "valor_parcela": 1808.33, "valor_total_parcelas": 108500, "residuo": 0.2, "valor_minimo_flex": null}
  },
  {
    "descricao": "doc §8.5: 300.000 × 30% − 10.000 = base 80.000; 60×",
    "entrada": {"forma": "parcelado", "valor": 300000, "perc_aporte": 30, "entrada": 10000, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 300000, "perc_aporte": 30, "valor_aporte": 90000, "valor_entrada": 10000, "base_parcelada": 80000, "valor_restante": 210000, "n_parcelas": 60, "taxa_aporte": 8.5, "valor_parcela": 1446.67, "valor_total_parcelas": 86800, "residuo": -0.2, "valor_minimo_flex": null}
  },
  {
    "descricao": "limite mínimo de parcelas (12) aceito",
    "entrada": {"forma": "parcelado", "valor": 250000, "perc_aporte": 20, "entrada": 0, "n_parcelas": 12, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 250000, "perc_aporte": 20, "valor_aporte": 50000, "valor_entrada": 0, "base_parcelada": 50000, "valor_restante": 200000, "n_parcelas": 12, "taxa_aporte": 8.5, "valor_parcela": 4520.83, "valor_total_parcelas": 54250, "residuo": 0.04, "valor_minimo_flex": null}
  },
  {
    "descricao": "limite máximo de parcelas (360) aceito",
    "entrada": {"forma": "parcelado", "valor": 1234567.89, "perc_aporte": 25.5, "entrada": 12345.67, "n_parcelas": 360, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 1234567.89, "perc_aporte": 25.5, "valor_aporte": 314814.81, "valor_entrada": 12345.67, "base_parcelada": 302469.14, "valor_restante": 919753.08, "n_parcelas": 360, "taxa_aporte": 8.5, "valor_parcela": 911.61, "valor_total_parcelas": 328179.02, "residuo": -0.58, "valor_minimo_flex": null}
  },
  {
    "descricao": "abaixo do mínimo de parcelas (11)",
    "entrada": {"forma": "parcelado", "valor": 250000, "perc_aporte": 20, "entrada": 0, "n_parcelas": 11, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["n_parcelas_fora_do_limite"]}
  },
  {
    "descricao": "acima do máximo de parcelas (361)",
    "entrada": {"forma": "parcelado", "valor": 250000, "perc_aporte": 20, "entrada": 0, "n_parcelas": 361, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["n_parcelas_fora_do_limite"]}
  },
  {
    "descricao": "parcelado sem número de parcelas",
    "entrada": {"forma": "parcelado", "valor": 250000, "perc_aporte": 20, "entrada": 0, "n_parcelas": null, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["n_parcelas_fora_do_limite"]}
  },
  {
    "descricao": "entrada maior que o aporte",
    "entrada": {"forma": "parcelado", "valor": 100000, "perc_aporte": 10, "entrada": 10000.01, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["entrada_maior_que_aporte"]}
  },
  {
    "descricao": "entrada igual ao aporte (base zero)",
    "entrada": {"forma": "parcelado", "valor": 100000, "perc_aporte": 10, "entrada": 10000, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 100000, "perc_aporte": 10, "valor_aporte": 10000, "valor_entrada": 10000, "base_parcelada": 0, "valor_restante": 90000, "n_parcelas": 60, "taxa_aporte": 8.5, "valor_parcela": 0, "valor_total_parcelas": 0, "residuo": 0, "valor_minimo_flex": null}
  },
  {
    "descricao": "flexível sem mínimo configurado",
    "entrada": {"forma": "flexivel", "valor": 400000, "perc_aporte": 35, "entrada": 20000, "n_parcelas": null, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["flexivel_sem_minimo"]}
  },
  {
    "descricao": "flexível com mínimo configurado",
    "entrada": {"forma": "flexivel", "valor": 400000, "perc_aporte": 35, "entrada": 20000, "n_parcelas": null, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": 2500},
    "esperado": {"valor_imovel": 400000, "perc_aporte": 35, "valor_aporte": 140000, "valor_entrada": 20000, "base_parcelada": 120000, "valor_restante": 260000, "n_parcelas": null, "taxa_aporte": null, "valor_parcela": null, "valor_total_parcelas": null, "residuo": null, "valor_minimo_flex": 2500}
  },
  {
    "descricao": "flexível ignora o número de parcelas",
    "entrada": {"forma": "flexivel", "valor": 400000, "perc_aporte": 35, "entrada": 20000, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": 2500},
    "esperado": {"valor_imovel": 400000, "perc_aporte": 35, "valor_aporte": 140000, "valor_entrada": 20000, "base_parcelada": 120000, "valor_restante": 260000, "n_parcelas": null, "taxa_aporte": null, "valor_parcela": null, "valor_total_parcelas": null, "residuo": null, "valor_minimo_flex": 2500}
  },
  {
    "descricao": "valor abaixo do mínimo configurado",
    "entrada": {"forma": "parcelado", "valor": 90000, "perc_aporte": 30, "entrada": 0, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": 100000, "valor_minimo_flex": null},
    "esperado": {"motivos": ["valor_abaixo_do_minimo"]}
  },
  {
    "descricao": "valor igual ao mínimo configurado",
    "entrada": {"forma": "parcelado", "valor": 100000, "perc_aporte": 30, "entrada": 0, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": 100000, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 100000, "perc_aporte": 30, "valor_aporte": 30000, "valor_entrada": 0, "base_parcelada": 30000, "valor_restante": 70000, "n_parcelas": 60, "taxa_aporte": 8.5, "valor_parcela": 542.5, "valor_total_parcelas": 32550, "residuo": 0, "valor_minimo_flex": null}
  },
  {
    "descricao": "percentual zero",
    "entrada": {"forma": "parcelado", "valor": 100000, "perc_aporte": 0, "entrada": 0, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["percentual_invalido"]}
  },
  {
    "descricao": "percentual acima de 100",
    "entrada": {"forma": "parcelado", "valor": 100000, "perc_aporte": 100.0001, "entrada": 0, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["percentual_invalido"]}
  },
  {
    "descricao": "percentual de 100",
    "entrada": {"forma": "parcelado", "valor": 100000, "perc_aporte": 100, "entrada": 0, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 100000, "perc_aporte": 100, "valor_aporte": 100000, "valor_entrada": 0, "base_parcelada": 100000, "valor_restante": 0, "n_parcelas": 60, "taxa_aporte": 8.5, "valor_parcela": 1808.33, "valor_total_parcelas": 108500, "residuo": 0.2, "valor_minimo_flex": null}
  },
  {
    "descricao": "entrada negativa",
    "entrada": {"forma": "parcelado", "valor": 100000, "perc_aporte": 30, "entrada": -1, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["entrada_invalida"]}
  },
  {
    "descricao": "produto sem valor",
    "entrada": {"forma": "parcelado", "valor": null, "perc_aporte": 30, "entrada": 0, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["produto_sem_valor"]}
  },
  {
    "descricao": "vários motivos juntos",
    "entrada": {"forma": "flexivel", "valor": null, "perc_aporte": 0, "entrada": -5, "n_parcelas": null, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["produto_sem_valor", "percentual_invalido", "entrada_invalida", "flexivel_sem_minimo"]}
  },
  {
    "descricao": "forma inválida",
    "entrada": {"forma": null, "valor": 100000, "perc_aporte": 30, "entrada": 0, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"motivos": ["forma_invalida"]}
  },
  {
    "descricao": "arredondamento: dízimas com 4 casas no percentual",
    "entrada": {"forma": "parcelado", "valor": 333333.33, "perc_aporte": 33.3333, "entrada": 1234.56, "n_parcelas": 37, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 333333.33, "perc_aporte": 33.3333, "valor_aporte": 111111, "valor_entrada": 1234.56, "base_parcelada": 109876.44, "valor_restante": 222222.33, "n_parcelas": 37, "taxa_aporte": 8.5, "valor_parcela": 3222.05, "valor_total_parcelas": 119215.94, "residuo": 0.09, "valor_minimo_flex": null}
  },
  {
    "descricao": "taxa zero",
    "entrada": {"forma": "parcelado", "valor": 250000, "perc_aporte": 50, "entrada": 0, "n_parcelas": 120, "taxa": 0, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 250000, "perc_aporte": 50, "valor_aporte": 125000, "valor_entrada": 0, "base_parcelada": 125000, "valor_restante": 125000, "n_parcelas": 120, "taxa_aporte": 0, "valor_parcela": 1041.67, "valor_total_parcelas": 125000, "residuo": -0.4, "valor_minimo_flex": null}
  },
  {
    "descricao": "taxa com 4 casas",
    "entrada": {"forma": "parcelado", "valor": 777777.77, "perc_aporte": 12.3456, "entrada": 5000.05, "n_parcelas": 97, "taxa": 8.1234, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 777777.77, "perc_aporte": 12.3456, "valor_aporte": 96021.33, "valor_entrada": 5000.05, "base_parcelada": 91021.28, "valor_restante": 681756.44, "n_parcelas": 97, "taxa_aporte": 8.1234, "valor_parcela": 1014.59, "valor_total_parcelas": 98415.3, "residuo": 0.07, "valor_minimo_flex": null}
  },
  {
    "descricao": "metade exata: 10,005 vira 10,01 (metade para longe do zero)",
    "entrada": {"forma": "parcelado", "valor": 1000, "perc_aporte": 20, "entrada": 79.94, "n_parcelas": 12, "taxa": 0, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 1000, "perc_aporte": 20, "valor_aporte": 200, "valor_entrada": 79.94, "base_parcelada": 120.06, "valor_restante": 800, "n_parcelas": 12, "taxa_aporte": 0, "valor_parcela": 10.01, "valor_total_parcelas": 120.06, "residuo": -0.06, "valor_minimo_flex": null}
  },
  {
    "descricao": "valores grandes",
    "entrada": {"forma": "parcelado", "valor": 99999999.99, "perc_aporte": 100, "entrada": 0, "n_parcelas": 360, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 99999999.99, "perc_aporte": 100, "valor_aporte": 99999999.99, "valor_entrada": 0, "base_parcelada": 99999999.99, "valor_restante": 0, "n_parcelas": 360, "taxa_aporte": 8.5, "valor_parcela": 301388.89, "valor_total_parcelas": 108499999.99, "residuo": -0.41, "valor_minimo_flex": null}
  },
  {
    "descricao": "percentual com 5 casas é arredondado a 4",
    "entrada": {"forma": "parcelado", "valor": 500000, "perc_aporte": 30.00005, "entrada": 0, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 500000, "perc_aporte": 30.0001, "valor_aporte": 150000.5, "valor_entrada": 0, "base_parcelada": 150000.5, "valor_restante": 349999.5, "n_parcelas": 60, "taxa_aporte": 8.5, "valor_parcela": 2712.51, "valor_total_parcelas": 162750.54, "residuo": -0.06, "valor_minimo_flex": null}
  },
  {
    "descricao": "entrada com 3 casas é arredondada a 2",
    "entrada": {"forma": "parcelado", "valor": 500000, "perc_aporte": 30, "entrada": 1000.005, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 500000, "perc_aporte": 30, "valor_aporte": 150000, "valor_entrada": 1000.01, "base_parcelada": 148999.99, "valor_restante": 350000, "n_parcelas": 60, "taxa_aporte": 8.5, "valor_parcela": 2694.42, "valor_total_parcelas": 161664.99, "residuo": -0.21, "valor_minimo_flex": null}
  },
  {
    "descricao": "aporte que arredonda para cima",
    "entrada": {"forma": "parcelado", "valor": 123456.78, "perc_aporte": 17.5, "entrada": 0, "n_parcelas": 48, "taxa": 9.75, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 123456.78, "perc_aporte": 17.5, "valor_aporte": 21604.94, "valor_entrada": 0, "base_parcelada": 21604.94, "valor_restante": 101851.84, "n_parcelas": 48, "taxa_aporte": 9.75, "valor_parcela": 493.99, "valor_total_parcelas": 23711.42, "residuo": -0.1, "valor_minimo_flex": null}
  },
  {
    "descricao": "resíduo negativo",
    "entrada": {"forma": "parcelado", "valor": 300000, "perc_aporte": 30, "entrada": 10000, "n_parcelas": 60, "taxa": 8.5, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 300000, "perc_aporte": 30, "valor_aporte": 90000, "valor_entrada": 10000, "base_parcelada": 80000, "valor_restante": 210000, "n_parcelas": 60, "taxa_aporte": 8.5, "valor_parcela": 1446.67, "valor_total_parcelas": 86800, "residuo": -0.2, "valor_minimo_flex": null}
  },
  {
    "descricao": "parcela mínima e máxima iguais",
    "entrada": {"forma": "parcelado", "valor": 180000, "perc_aporte": 40, "entrada": 12000, "n_parcelas": 24, "taxa": 8.5, "parcela_minima": 24, "parcela_maxima": 24, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 180000, "perc_aporte": 40, "valor_aporte": 72000, "valor_entrada": 12000, "base_parcelada": 60000, "valor_restante": 108000, "n_parcelas": 24, "taxa_aporte": 8.5, "valor_parcela": 2712.5, "valor_total_parcelas": 65100, "residuo": 0, "valor_minimo_flex": null}
  },
  {
    "descricao": "taxa alta e prazo curto",
    "entrada": {"forma": "parcelado", "valor": 87654.32, "perc_aporte": 55.5555, "entrada": 3333.33, "n_parcelas": 13, "taxa": 17.25, "parcela_minima": 12, "parcela_maxima": 360, "valor_minimo": null, "valor_minimo_flex": null},
    "esperado": {"valor_imovel": 87654.32, "perc_aporte": 55.5555, "valor_aporte": 48696.8, "valor_entrada": 3333.33, "base_parcelada": 45363.47, "valor_restante": 38957.52, "n_parcelas": 13, "taxa_aporte": 17.25, "valor_parcela": 4091.44, "valor_total_parcelas": 53188.67, "residuo": -0.05, "valor_minimo_flex": null}
  }
]
$vetores$::jsonb) with ordinality v;
-- VETORES:FIM

select plan(219 + (select count(*)::int from vetores));

-- ============ DADOS DESTE TESTE (como postgres) ============
-- produtos: empreendimento "Residencial Teste" com as unidades u11..u16; imóveis i21 (aprovado), i22 (rascunho),
-- i23 (no contrato, com K4 em assinatura). Contratos criados pelas RPCs ficam na tabela ids (K1, K2, K3...).
insert into public.empreendimentos (id, slug, nome) values ('f4000000-0000-4000-8000-000000000001', 'wp4-residencial-teste', 'Residencial Teste');
insert into public.unidades (id, empreendimento_id, identificador, valor, status) values
  ('f4000000-0000-4000-8000-000000000011', 'f4000000-0000-4000-8000-000000000001', 'APTO 11', 500000, 'disponivel'),
  ('f4000000-0000-4000-8000-000000000012', 'f4000000-0000-4000-8000-000000000001', 'APTO 12', 400000, 'vendida'),
  ('f4000000-0000-4000-8000-000000000013', 'f4000000-0000-4000-8000-000000000001', 'APTO 13', null,   'disponivel'),
  ('f4000000-0000-4000-8000-000000000014', 'f4000000-0000-4000-8000-000000000001', 'APTO 14', 300000, 'disponivel'),
  ('f4000000-0000-4000-8000-000000000015', 'f4000000-0000-4000-8000-000000000001', 'APTO 15', 250000, 'reservada'),
  ('f4000000-0000-4000-8000-000000000016', 'f4000000-0000-4000-8000-000000000001', 'APTO 16', 350000, 'disponivel'),
  ('f4000000-0000-4000-8000-000000000017', 'f4000000-0000-4000-8000-000000000001', 'APTO 17', 360000, 'disponivel'),
  ('f4000000-0000-4000-8000-000000000018', 'f4000000-0000-4000-8000-000000000001', 'APTO 18', 370000, 'disponivel');
insert into public.imoveis (id, nome, matricula, tipo, status, cep, uf, cidade, logradouro, numero, valor, criado_por) values
  ('f4000000-0000-4000-8000-000000000021', 'Casa Aprovada', '12.345', 'casa', 'aprovado', '01310100', 'SP', 'São Paulo', 'Av. Paulista', '1000', 850000, pg_temp.usuario('admin')),
  ('f4000000-0000-4000-8000-000000000022', 'Casa Rascunho', null, 'casa', 'rascunho', null, null, null, null, null, 700000, pg_temp.usuario('ca1a')),
  ('f4000000-0000-4000-8000-000000000023', 'Casa No Contrato', null, 'casa', 'no_contrato', '01310100', 'SP', 'São Paulo', 'Av. Paulista', '2000', 300000, pg_temp.usuario('admin'));

create temp table ids (nome text primary key, id uuid not null);
grant select, insert on ids to authenticated, service_role;
create function pg_temp.k(p text) returns uuid language sql as $$ select i.id from ids i where i.nome = p $$;
create function pg_temp.status(p text) returns text language sql as $$
  select k.status::text from public.contratos k where k.id = pg_temp.k(p)
$$;
create function pg_temp.auditorias(p_entidade text, p_id text, p_acao text) returns int language sql as $$
  select count(*)::int from public.auditoria a where a.entidade = p_entidade and a.entidade_id is not distinct from p_id and a.acao = p_acao
$$;
create function pg_temp.eventos(p_cliente text, p_tipo text) returns int language sql as $$
  select count(*)::int from public.cliente_eventos e where e.cliente_id = pg_temp.cliente(p_cliente) and e.tipo = p_tipo
$$;
create function pg_temp.sha(p text) returns text language sql immutable as $$ select rpad(p, 64, '0') $$;
-- os três contratos "já em assinatura" (K4 imóvel i23, K5 unidade u15, K6 unidade u17, K7 unidade u18), gravados
-- direto como postgres, com os valores do vetor da §8.5 (300.000 × 30% − 10.000, 60×)
create function pg_temp.contrato_em_assinatura(p_nome text, p_cliente text, p_unidade uuid, p_imovel uuid, p_doc text)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.contratos (cliente_id, modelo_id, forma_pagamento, status, unidade_id, imovel_id, parametros_id,
    valor_imovel, perc_aporte, valor_aporte, valor_entrada, base_parcelada, valor_restante, n_parcelas, taxa_aporte,
    valor_parcela, valor_total_parcelas, d4sign_uuid, enviado_assinatura_em, webhook_token_hash)
  values (pg_temp.cliente(p_cliente), public.modelo_vigente_id('parcelado'), 'parcelado', 'assinatura_pendente',
    p_unidade, p_imovel, public.parametros_vigente_id(), 300000, 30, 90000, 10000, 80000, 210000, 60, 8.5, 1446.67, 86800,
    p_doc, now(), pg_temp.sha('ab'))
  returning id into v;
  insert into public.contrato_signatarios (contrato_id, ordem, papel, nome, email) values
    (v, 1, 'cliente', 'Cliente Teste', 'cliente-' || p_nome || '@cliente.test'),
    (v, 2, 'representante_arken', 'Representante Arken', 'rep@arken.test');
  insert into ids values (p_nome, v);
  return v;
end $$;
select '' from (select pg_temp.contrato_em_assinatura('k4', 'c3', null, 'f4000000-0000-4000-8000-000000000023', 'doc-k4')) x;
select '' from (select pg_temp.contrato_em_assinatura('k5', 'c3', 'f4000000-0000-4000-8000-000000000015', null, 'doc-k5')) x;
select '' from (select pg_temp.contrato_em_assinatura('k6', 'c2', 'f4000000-0000-4000-8000-000000000017', null, 'doc-k6')) x;
select '' from (select pg_temp.contrato_em_assinatura('k7', 'c2', 'f4000000-0000-4000-8000-000000000018', null, 'doc-k7')) x;

-- ============ GRANTS ============
select ok(bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('anon', p.oid, 'execute')
                   and not has_function_privilege('service_role', p.oid, 'execute'))
          and count(*) = 12,
          'as 12 RPCs de contratos e configuração de contratos: só authenticated executa')
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('contrato_simular', 'contrato_criar', 'contrato_atualizar_simulacao', 'contrato_mudar_status',
                    'contrato_dados_modelo', 'contrato_preparar_envio', 'contratos_listar', 'contrato_detalhe',
                    'contrato_baixar', 'config_publicar_parametros', 'config_publicar_modelo', 'config_liberar_modelo');
select ok(bool_and(has_function_privilege('service_role', p.oid, 'execute')
                   and not has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('anon', p.oid, 'execute'))
          and count(*) = 6,
          'as 6 RPCs de sistema do D4Sign (com contrato_confirmar_envio): só service_role executa')
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('contrato_registrar_documento', 'contrato_registrar_d4sign_uuid', 'contrato_registrar_envio',
                    'contrato_falha_envio', 'contrato_registrar_retorno', 'contrato_confirmar_envio');
select is((select p.provolatile::text from pg_proc p where p.oid = 'public.contrato_confirmar_envio(uuid, text)'::regprocedure),
          'v', 'contrato_confirmar_envio é volatile (trava a linha)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_contrato\_%'
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute'))), 0,
          'funções internas _contrato_*: ninguém executa pela API');

-- ============ VETORES (calcular_simulacao, fonte de verdade) ============
create function pg_temp.simular_vetor(e jsonb) returns jsonb language plpgsql as $$
declare
  v_det text;
begin
  return public.calcular_simulacao((e ->> 'forma')::public.forma_pagamento, (e ->> 'valor')::numeric,
    (e ->> 'perc_aporte')::numeric, (e ->> 'entrada')::numeric, (e ->> 'n_parcelas')::int, (e ->> 'taxa')::numeric,
    (e ->> 'parcela_minima')::int, (e ->> 'parcela_maxima')::int, (e ->> 'valor_minimo')::numeric,
    (e ->> 'valor_minimo_flex')::numeric);
exception when others then
  get stacked diagnostics v_det = pg_exception_detail;
  if sqlerrm = 'SIMULACAO_INVALIDA' then
    return jsonb_build_object('motivos', v_det::jsonb -> 'motivos');
  end if;
  raise;
end $$;
select is(pg_temp.simular_vetor(v.vetor -> 'entrada'), v.vetor -> 'esperado', 'vetor: ' || (v.vetor ->> 'descricao'))
from vetores v order by v.n;

-- ============ contrato_simular (não grava; valor lido do produto) ============
create temp table auditoria_antes as select count(*)::int as n from public.auditoria;
grant select on auditoria_antes to authenticated;
select pg_temp.entrar('ca1a');
select is(public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 50000, 60)
            - 'parametros_id' - 'produto' - 'limites' - 'forma',
          '{"valor_imovel":500000,"perc_aporte":30,"valor_aporte":150000,"valor_entrada":50000,"base_parcelada":100000,
            "valor_restante":350000,"n_parcelas":60,"taxa_aporte":8.5,"valor_parcela":1808.33,"valor_total_parcelas":108500,
            "residuo":0.2,"valor_minimo_flex":null}'::jsonb,
          'simular: 500.000 (valor do produto) × 30% − 50.000, 60×, 8,5% → parcela 1.808,33 e resíduo 0,20');
select is(public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 50000, 60) -> 'produto',
          '{"tipo":"unidade","id":"f4000000-0000-4000-8000-000000000011","nome":"Residencial Teste · APTO 11","codigo":null,
            "empreendimento":{"id":"f4000000-0000-4000-8000-000000000001","nome":"Residencial Teste"},"valor":500000}'::jsonb,
          'simular: devolve o produto com o valor atual');
select is(public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 50000, 60) -> 'limites',
          '{"parcela_minima":12,"parcela_maxima":360,"valor_minimo":null,"valor_minimo_flex":null}'::jsonb,
          'simular: devolve os limites vigentes (semente ⚑ N14)');
select is((public.contrato_simular('parcelado', '{"imovel_id":"f4000000-0000-4000-8000-000000000021"}', 30, 0, 12) ->> 'valor_imovel')::numeric,
          850000::numeric, 'simular: imóvel aprovado, 12 parcelas (limite mínimo) aceito');
select is((public.contrato_simular('parcelado', '{"imovel_id":"f4000000-0000-4000-8000-000000000021"}', 30, 0, 360) ->> 'n_parcelas')::int,
          360, 'simular: 360 parcelas (limite máximo) aceito');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 0, 11)$$) -> 'detalhe',
          '{"motivos":["n_parcelas_fora_do_limite"]}'::jsonb, 'simular: 11 parcelas → fora do limite');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 0, 361)$$) -> 'detalhe',
          '{"motivos":["n_parcelas_fora_do_limite"]}'::jsonb, 'simular: 361 parcelas → fora do limite');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 150000.01, 60)$$) -> 'detalhe',
          '{"motivos":["entrada_maior_que_aporte"]}'::jsonb, 'simular: entrada maior que o aporte falha');
select is(pg_temp.erro($$select public.contrato_simular('flexivel', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 0, null)$$) -> 'detalhe',
          '{"motivos":["flexivel_sem_minimo"]}'::jsonb, 'simular: flexível sem mínimo configurado falha (N14)');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000013"}', 30, 0, 60)$$) -> 'detalhe',
          '{"motivos":["produto_sem_valor"]}'::jsonb, 'simular: unidade sem valor → produto_sem_valor');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011","valor":1}', 30, 0, 60)$$) ->> 'mensagem',
          'DADOS_INVALIDOS', 'simular: o produto não aceita valor vindo do front (SEG-4)');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011","imovel_id":"f4000000-0000-4000-8000-000000000021"}', 30, 0, 60)$$) ->> 'mensagem',
          'DADOS_INVALIDOS', 'simular: exatamente um produto (N4)');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000012"}', 30, 0, 60)$$) ->> 'mensagem',
          'PRODUTO_INDISPONIVEL', 'simular: unidade vendida não entra em contrato (N5)');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"imovel_id":"f4000000-0000-4000-8000-000000000022"}', 30, 0, 60)$$) ->> 'mensagem',
          'PRODUTO_INDISPONIVEL', 'simular: imóvel fora de aprovado não entra em contrato (E2)');
select pg_temp.entrar('pendente');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'simular: autocadastro pendente não simula');
select pg_temp.entrar('bloqueado');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'simular: parceiro bloqueado não simula');
select pg_temp.entrar('titular_c1');
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'simular: titular do portal não simula');
select pg_temp.entrar_anon();
select is(pg_temp.erro($$select public.contrato_simular('parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'simular: anon não executa');
select pg_temp.sair();
select is((select count(*)::int from public.auditoria), (select n from auditoria_antes), 'simular não grava auditoria');

-- ============ contrato_criar ============
select pg_temp.entrar('ca1a');
insert into ids select 'k1', public.contrato_criar(pg_temp.cliente('c1'), 'parcelado',
  '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 50000, 60);
insert into ids select 'k3', public.contrato_criar(pg_temp.cliente('c1'), 'parcelado',
  '{"unidade_id":"f4000000-0000-4000-8000-000000000014"}', 30, 10000, 60);
select pg_temp.entrar('ga1');
insert into ids select 'k2', public.contrato_criar(pg_temp.cliente('c4'), 'parcelado',
  '{"imovel_id":"f4000000-0000-4000-8000-000000000021"}', 20, 0, 120);
select pg_temp.sair();
select is((select jsonb_build_object('status', k.status, 'valor_imovel', k.valor_imovel, 'valor_aporte', k.valor_aporte,
                                     'base_parcelada', k.base_parcelada, 'valor_parcela', k.valor_parcela,
                                     'valor_total_parcelas', k.valor_total_parcelas, 'n_parcelas', k.n_parcelas)
           from public.contratos k where k.id = pg_temp.k('k1')),
          '{"status":"rascunho","valor_imovel":500000,"valor_aporte":150000,"base_parcelada":100000,"valor_parcela":1808.33,
            "valor_total_parcelas":108500,"n_parcelas":60}'::jsonb,
          'criar: valores recalculados no servidor com o valor do produto (N16, FIN-1/FIN-2)');
select ok((select k.modelo_id = public.modelo_vigente_id('parcelado') and k.parametros_id = public.parametros_vigente_id()
                  and k.criado_por = pg_temp.usuario('ca1a') and k.pdf_versao = 0 and k.pdf_desatualizado
           from public.contratos k where k.id = pg_temp.k('k1')),
          'criar: modelo e parâmetros vigentes, autor e PDF ainda não gerado');
select is((select array[k.corretor_id, k.gerente_id, k.imobiliaria_id] from public.contratos k where k.id = pg_temp.k('k1')),
          array[pg_temp.parceiro('ca1a'), pg_temp.parceiro('ga1'), pg_temp.imobiliaria('a')],
          'criar: a cadeia vem do cliente');
select is(pg_temp.auditorias('contratos', pg_temp.k('k1')::text, 'criar'), 1, 'criar: auditoria operacao/criar');
select is((select a.cliente_id from public.auditoria a where a.entidade = 'contratos' and a.entidade_id = pg_temp.k('k1')::text and a.acao = 'criar'),
          pg_temp.cliente('c1'), 'criar: a auditoria leva o cliente_id (titular)');
select is(pg_temp.eventos('c1', 'contrato_gerado'), 2, 'criar: timeline contrato_gerado (um por contrato)');
select is((select k.valor_imovel from public.contratos k where k.id = pg_temp.k('k2')), 850000::numeric,
          'criar: gerente como corretor (A1) cria para o próprio cliente com o valor do imóvel');

select pg_temp.entrar('ca1a');
select is(pg_temp.erro($$select public.contrato_criar(pg_temp.cliente('c2'), 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000016"}', 30, 0, 60)$$),
          '{"sqlstate":"42501","mensagem":"Sem acesso a este registro","detalhe":null}'::jsonb,
          'criar: CA1a não cria contrato para cliente de outro corretor');
select is(pg_temp.erro($$select public.contrato_criar('d0000000-0000-4000-8000-0000000000ff', 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000016"}', 30, 0, 60)$$) ->> 'mensagem',
          'Sem acesso a este registro', 'criar: cliente inexistente dá a mesma resposta');
select is(pg_temp.erro($$select public.contrato_criar(pg_temp.cliente('c1'), 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000011"}', 30, 0, 60)$$) ->> 'mensagem',
          'CONTRATO_ATIVO', 'criar: um contrato ativo por produto');
select is(pg_temp.erro($$select public.contrato_criar(pg_temp.cliente('c1'), 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000012"}', 30, 0, 60)$$) ->> 'mensagem',
          'PRODUTO_INDISPONIVEL', 'criar: unidade vendida recusada');
select is(pg_temp.erro($$select public.contrato_criar(pg_temp.cliente('c1'), 'flexivel', '{"unidade_id":"f4000000-0000-4000-8000-000000000016"}', 30, 0, null)$$) -> 'detalhe',
          '{"motivos":["flexivel_sem_minimo"]}'::jsonb, 'criar: flexível sem mínimo falha');
select pg_temp.entrar('ib');
select is(pg_temp.erro($$select public.contrato_criar(pg_temp.cliente('c1'), 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000016"}', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'criar: imobiliária B não cria para cliente da A');
select pg_temp.entrar('bloqueado');
select is(pg_temp.erro($$select public.contrato_criar(pg_temp.cliente('c5'), 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000016"}', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'criar: corretor bloqueado não cria nem para a própria carteira');
-- permissão desligada pelo Super (permissoes_rede criar_contrato)
select pg_temp.sair();
update public.permissoes_rede set permitido = false where acao = 'criar_contrato' and tipo = 'corretor';
select pg_temp.entrar('ca1a');
select is(pg_temp.erro($$select public.contrato_criar(pg_temp.cliente('c1'), 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000016"}', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'criar: corretor sem a permissão criar_contrato é recusado');
select pg_temp.sair();
update public.permissoes_rede set permitido = true where acao = 'criar_contrato' and tipo = 'corretor';
-- cliente inativo
update public.clientes set inativado_em = now(), motivo_inativacao = 'teste' where id = pg_temp.cliente('c3');
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.contrato_criar(pg_temp.cliente('c3'), 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000016"}', 30, 0, 60)$$) ->> 'mensagem',
          'Cliente inativo não recebe contrato.', 'criar: cliente inativo não recebe contrato (nem pelo interno)');
select pg_temp.sair();
update public.clientes set inativado_em = null, motivo_inativacao = null where id = pg_temp.cliente('c3');

create temp table codigos as select i.nome, k.codigo from ids i join public.contratos k on k.id = i.id;
grant select on codigos to authenticated;

-- ============ config_publicar_parametros (Super) ============
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.config_publicar_parametros('{"taxa_aporte_proprio":8.5,"parcela_minima":12,"parcela_maxima":360,"valor_minimo_flex":2000}')$$) ->> 'sqlstate',
          '42501', 'publicar parâmetros: admin (não Super) é recusado');
select pg_temp.entrar('super');
select is(pg_temp.erro($$select public.config_publicar_parametros('{"taxa_aporte_proprio":-1,"parcela_minima":12,"parcela_maxima":10,"valor_minimo_flex":2000.001,"extra":1}')$$) -> 'detalhe',
          '{"campos":["extra","taxa_aporte_proprio","valor_minimo_flex"]}'::jsonb,
          'publicar parâmetros: chave desconhecida e valores fora da faixa → DADOS_INVALIDOS com os campos');
select is(pg_temp.erro($$select public.config_publicar_parametros('{"taxa_aporte_proprio":8.5,"parcela_minima":24,"parcela_maxima":12}')$$) -> 'detalhe',
          '{"campos":["parcela_maxima"]}'::jsonb, 'publicar parâmetros: máxima menor que a mínima');
create temp table parametros_antes as select public.parametros_vigente_id() as id;
grant select on parametros_antes to authenticated;
select lives_ok($$select public.config_publicar_parametros('{"taxa_aporte_proprio":8.5,"taxa_financeiro":null,"juros_ao_mes":null,"igpm_atual":null,"parcela_minima":12,"parcela_maxima":360,"valor_minimo":null,"valor_minimo_flex":2500}')$$,
                'publicar parâmetros: o Super publica uma versão nova (mínimo do flexível configurado)');
select pg_temp.sair();
select ok(public.parametros_vigente_id() <> (select id from parametros_antes)
          and (select p.valor_minimo_flex from public.parametros_simulacao p where p.id = public.parametros_vigente_id()) = 2500,
          'publicar parâmetros: a versão nova é a vigente');
select is(pg_temp.auditorias('parametros_simulacao', public.parametros_vigente_id()::text, 'publicar'), 1,
          'publicar parâmetros: auditoria configuracao com antes e depois');
select is((select a.antes ->> 'id' from public.auditoria a where a.entidade = 'parametros_simulacao' and a.acao = 'publicar'),
          (select id::text from parametros_antes), 'publicar parâmetros: o "antes" é a versão que estava vigente');
select pg_temp.entrar('ca1a');
select is((public.contrato_simular('flexivel', '{"unidade_id":"f4000000-0000-4000-8000-000000000016"}', 30, 5000, null) ->> 'valor_minimo_flex')::numeric,
          2500::numeric, 'flexível com mínimo configurado passa a simular');
select pg_temp.sair();
select is((select k.parametros_id from public.contratos k where k.id = pg_temp.k('k1')), (select id from parametros_antes),
          'o contrato guarda a versão dos parâmetros usada (não muda com a publicação)');

-- ============ contrato_atualizar_simulacao ============
select pg_temp.sair();
update public.unidades set valor = 320000 where id = 'f4000000-0000-4000-8000-000000000014';   -- preço de tabela mudou
select pg_temp.entrar('ca1a');
select lives_ok($$select public.contrato_atualizar_simulacao(pg_temp.k('k3'), 'parcelado', 40, 0, 120)$$,
                'atualizar: o corretor refaz a simulação do rascunho');
select pg_temp.sair();
select is((select jsonb_build_object('valor_imovel', k.valor_imovel, 'perc_aporte', k.perc_aporte, 'valor_aporte', k.valor_aporte,
                                     'n_parcelas', k.n_parcelas, 'parametros', k.parametros_id = public.parametros_vigente_id())
           from public.contratos k where k.id = pg_temp.k('k3')),
          '{"valor_imovel":320000,"perc_aporte":40,"valor_aporte":128000,"n_parcelas":120,"parametros":true}'::jsonb,
          'atualizar: relê o valor atual do produto e os parâmetros vigentes');
select ok((select a.antes ->> 'valor_imovel' = '300000.00' and a.depois ->> 'valor_imovel' = '320000.00'
                  and a.campos @> array['valor_imovel', 'perc_aporte', 'n_parcelas']
           from public.auditoria a where a.entidade = 'contratos' and a.entidade_id = pg_temp.k('k3')::text and a.acao = 'editar'),
          'atualizar: auditoria operacao/editar com antes, depois e os nomes dos campos');
select is((select k.pdf_versao || '|' || k.pdf_desatualizado from public.contratos k where k.id = pg_temp.k('k3')), '1|true',
          'atualizar (WP4R-04): valores mudaram → a versão esperada do próximo PDF avança e o PDF fica desatualizado');
select pg_temp.entrar('ca2a');
select is(pg_temp.erro($$select public.contrato_atualizar_simulacao(pg_temp.k('k3'), 'parcelado', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'atualizar: corretor de outra equipe é recusado');
select pg_temp.entrar('gb1');
select is(pg_temp.erro($$select public.contrato_atualizar_simulacao(pg_temp.k('k3'), 'parcelado', 30, 0, 60)$$) ->> 'sqlstate',
          '42501', 'atualizar: gerente de outra imobiliária é recusado');

-- ============ contrato_detalhe e PAR-3 ============
select pg_temp.entrar('ca1a');
select ok((select d ->> 'status' = 'rascunho' and (d -> 'permissoes' ->> 'editar_simulacao')::boolean
                  and not (d -> 'permissoes' ->> 'enviar_assinatura')::boolean and (d -> 'permissoes' ->> 'gerar_pdf')::boolean
                  and not (d ->> 'valor_produto_alterado')::boolean
           from (select public.contrato_detalhe(pg_temp.k('k1')) as d) x),
          'detalhe: o corretor vê o contrato do cliente, com as permissões da tela');
select is(public.contrato_detalhe(pg_temp.k('k1')) -> 'bloqueios_envio',
          '["pdf_gerado","modelo_liberado","signatarios_configurados","vendedora_configurada"]'::jsonb,
          'detalhe: bloqueios do envio (ensaio das validações da §3.8)');
select is(public.contrato_detalhe(pg_temp.k('k1')) -> 'cadeia',
          jsonb_build_object('corretor', jsonb_build_object('id', pg_temp.parceiro('ca1a'), 'nome', 'CA1a Corretor'),
                             'gerente', null, 'imobiliaria', null),
          'detalhe PAR-3: o corretor não vê o gerente nem a imobiliária');
select is(public.contrato_detalhe(pg_temp.k('k1')) -> 'destinos_status',
          '[{"para":"documentacao_pendente","exige_motivo":false,"validacoes":[],"efeitos":[]},
            {"para":"em_analise","exige_motivo":false,"validacoes":["pdf_gerado"],"efeitos":[]}]'::jsonb,
          'detalhe: destinos de status do parceiro (sem os do sistema nem os dos internos)');
select pg_temp.sair();
select is(pg_temp.auditorias('contratos', pg_temp.k('k1')::text, 'consultar'), 4, 'detalhe: cada consulta grava acesso/consultar');
select pg_temp.entrar('ga1');
select is(public.contrato_detalhe(pg_temp.k('k1')) -> 'cadeia' -> 'gerente',
          jsonb_build_object('id', pg_temp.parceiro('ga1'), 'nome', 'GA1 Gerente'), 'detalhe PAR-3: o gerente vê a si mesmo');
select is(public.contrato_detalhe(pg_temp.k('k1')) -> 'cadeia' -> 'imobiliaria', 'null'::jsonb, 'detalhe PAR-3: o gerente não vê a imobiliária');
select pg_temp.entrar('ia');
select is(public.contrato_detalhe(pg_temp.k('k1')) -> 'cadeia' -> 'imobiliaria',
          jsonb_build_object('id', pg_temp.imobiliaria('a'), 'nome', 'Imobiliária A', 'da_casa', false), 'detalhe: a imobiliária vê a cadeia inteira');
select pg_temp.entrar('ca2a');
select is(public.contrato_detalhe(pg_temp.k('k1')), null, 'detalhe: fora do escopo devolve nulo');
select is(public.contrato_detalhe('f4000000-0000-4000-8000-0000000000ff'), null, 'detalhe: inexistente devolve nulo (mesma resposta)');
select pg_temp.sair();
select ok((select count(*) = 1 and bool_and(a.ator_id = pg_temp.usuario('ca2a') and a.cliente_id = pg_temp.cliente('c1'))
           from public.auditoria a where a.entidade = 'contratos' and a.entidade_id = pg_temp.k('k1')::text and a.acao = 'acesso_negado'),
          'detalhe: a negação grava acesso_negado com o ator e o cliente_id');
select pg_temp.entrar('admin');
select ok((public.contrato_detalhe(pg_temp.k('k1')) -> 'destinos_status') @> '[{"para":"arquivado"}]'
          and (public.contrato_detalhe(pg_temp.k('k1')) -> 'permissoes' ->> 'arquivar')::boolean,
          'detalhe: o interno pode arquivar o rascunho');

-- ============ contratos_listar ============
create function pg_temp.lista(p_filtros jsonb) returns text[] language sql as $$
  select coalesce(array_agg(i.nome order by i.nome), '{}') from ids i
  where i.id in (select (x ->> 'id')::uuid from jsonb_array_elements(public.contratos_listar(p_filtros) -> 'itens') x)
$$;
select pg_temp.entrar('ca1a');
select is(pg_temp.lista('{}'), array['k1', 'k3'], 'listar: CA1a vê só os contratos dos seus clientes');
select pg_temp.entrar('ga1');
select is(pg_temp.lista('{}'), array['k1', 'k2', 'k3'], 'listar: GA1 vê os da equipe e os do próprio cliente (A1)');
select pg_temp.entrar('ib');
select is(pg_temp.lista('{}'), array['k4', 'k5'], 'listar: IB vê só os da imobiliária B');
select pg_temp.entrar('ca2a');
select is(pg_temp.lista(jsonb_build_object('corretor_id', pg_temp.parceiro('ca1a'))), '{}'::text[],
          'listar: o filtro por corretor é cruzado com o escopo (§4.5)');
select pg_temp.entrar('admin');
select is(pg_temp.lista('{}'), array['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'], 'listar: o interno vê todos');
select is(pg_temp.lista('{"status":["assinatura_pendente"],"limite":2,"offset":0}'), array['k6', 'k7'],
          'listar: filtro por status e paginação (mais novos primeiro)');
select is((public.contratos_listar('{"status":["assinatura_pendente"],"limite":2}') ->> 'total')::int, 4, 'listar: total sem a paginação');
select is(pg_temp.lista('{"busca":"APTO 14"}'), array['k3'], 'listar: busca pelo nome do produto');
select is(pg_temp.lista(jsonb_build_object('busca', '#' || (select c.codigo from codigos c where c.nome = 'k2'))), array['k2'],
          'listar: busca pelo código (#0000123)');
-- filtro pelo produto (WP7: link "Ver contrato" do imóvel em NC, nota do WP5), cruzado com o escopo
select is(pg_temp.lista(jsonb_build_object('imovel_id', 'f4000000-0000-4000-8000-000000000023')), array['k4'],
          'listar {imovel_id}: o contrato do imóvel');
select is(pg_temp.lista(jsonb_build_object('unidade_id', 'f4000000-0000-4000-8000-000000000015')), array['k5'],
          'listar {unidade_id}: o contrato da unidade');
select pg_temp.entrar('ca1a');
select is(pg_temp.lista(jsonb_build_object('imovel_id', 'f4000000-0000-4000-8000-000000000023')), '{}'::text[],
          'listar {imovel_id}: imóvel com contrato de cliente fora do escopo não aparece');
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.contratos_listar('{"status":["xyz"],"cliente_id":"abc"}')$$) -> 'detalhe',
          '{"campos":["status","cliente_id"]}'::jsonb, 'listar: filtros inválidos → DADOS_INVALIDOS');
select is((select jsonb_build_object('total', (r ->> 'total')::int, 'itens', jsonb_array_length(r -> 'itens'))
           from (select public.contratos_listar('{"limite":1e20}') as r) x),
          '{"total":7,"itens":7}'::jsonb, 'listar (WP4R-08): limite enorme vira o máximo (200), sem estourar o int');
select is((select jsonb_build_object('total', (r ->> 'total')::int, 'itens', r -> 'itens')
           from (select public.contratos_listar('{"limite":-5,"offset":1e20}') as r) x),
          '{"total":7,"itens":[]}'::jsonb, 'listar (WP4R-08): offset enorme devolve página vazia; limite negativo vira 1');
select is((select jsonb_array_length(public.contratos_listar('{"limite":-5}') -> 'itens')), 1,
          'listar: limite abaixo de 1 vira 1');
select pg_temp.entrar('pendente');
select is(pg_temp.erro($$select public.contratos_listar('{}')$$) ->> 'sqlstate', '42501', 'listar: sem vínculo ativo é recusado');
select pg_temp.sair();
select ok((select bool_and(not (a.detalhe ? 'texto') and (a.detalhe ->> 'busca')::boolean and a.detalhe::text not like '%APTO 14%')
           from public.auditoria a where a.entidade = 'contratos' and a.acao = 'listar' and (a.detalhe ->> 'busca')::boolean),
          'listar: a busca é gravada só como {busca:true}, nunca o texto');
select ok((select a.detalhe -> 'ids' = to_jsonb(array[pg_temp.k('k1')]) or a.detalhe -> 'ids' = to_jsonb(array[pg_temp.k('k3'), pg_temp.k('k1')])
           from public.auditoria a where a.entidade = 'contratos' and a.acao = 'listar' and a.ator_id = pg_temp.usuario('ca1a')
           order by a.id limit 1),
          'listar: a auditoria acesso/listar guarda os ids devolvidos');

-- ============ contrato_dados_modelo (Edge contrato-gerar, com o JWT do usuário) ============
select pg_temp.entrar('ca1a');
create temp table dados_k1 as select public.contrato_dados_modelo(pg_temp.k('k1')) as d;
select is((select jsonb_build_object('chave', d -> 'modelo' ->> 'chave', 'versao', (d -> 'modelo' ->> 'versao')::int,
                                     'pdf_versao', (d ->> 'pdf_versao')::int, 'n', (select count(*) from jsonb_object_keys(d -> 'variaveis')))
           from dados_k1),
          '{"chave":"parcelado","versao":1,"pdf_versao":0,"n":32}'::jsonb,
          'dados do modelo: versão exata do contrato e as 32 variáveis permitidas');
select is((select jsonb_build_object('cpf', d -> 'variaveis' ->> 'cpf-cnpj', 'valor', (d -> 'variaveis' ->> 'valor-propriedade')::numeric,
                                     'parcela', (d -> 'variaveis' ->> 'valor-parcela')::numeric, 'corretor', d -> 'variaveis' ->> 'corretor-nome',
                                     'imobiliaria', d -> 'variaveis' ->> 'imobiliaria-nome', 'produto', d -> 'variaveis' ->> 'produto',
                                     'vendedora', d -> 'variaveis' -> 'vendedora-razao-social', 'codigo', (d ->> 'codigo')::bigint)
           from dados_k1),
          jsonb_build_object('cpf', '12345670916', 'valor', 500000, 'parcela', 1808.33, 'corretor', 'CA1a Corretor',
                             'imobiliaria', 'Imobiliária A', 'produto', 'Residencial Teste · APTO 11', 'vendedora', null,
                             'codigo', (select c.codigo from codigos c where c.nome = 'k1')),
          'dados do modelo: valores crus (CPF só dígitos, dinheiro como número; vendedora ainda nula, N7)');
select is((select d -> 'variaveis' ->> 'data' from dados_k1), to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
          'dados do modelo: data de hoje em São Paulo');
select pg_temp.entrar('ca2a');
select is(pg_temp.erro($$select public.contrato_dados_modelo(pg_temp.k('k1'))$$) ->> 'sqlstate', '42501',
          'dados do modelo: corretor de outra equipe é recusado (a Edge chama com o JWT dele, §4.5)');
select pg_temp.sair();
select is(pg_temp.auditorias('contratos', pg_temp.k('k1')::text, 'gerar'), 1, 'dados do modelo: auditoria operacao/gerar');

-- ============ contrato_registrar_documento (service, Edge contrato-gerar) ============
insert into storage.objects (bucket_id, name, metadata) values
  ('contratos', pg_temp.k('k1') || '/minuta-v1-aaaaaaaa.pdf', '{"size":120000,"mimetype":"application/pdf"}'),
  ('contratos', pg_temp.k('k1') || '/minuta-v2-bbbbbbbb.pdf', '{"size":121000,"mimetype":"application/pdf"}'),
  ('contratos', pg_temp.k('k2') || '/minuta-v1-cccccccc.pdf', '{"size":122000,"mimetype":"application/pdf"}');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_registrar_documento(%L, 1, %L, %L, %L)$$, pg_temp.k('k1'),
            pg_temp.k('k1') || '/minuta-v1-aaaaaaaa.pdf', pg_temp.sha('aaaaaaaa'), pg_temp.sha('11'))) ->> 'sqlstate',
          '42501', 'registrar documento: authenticated (nem admin) não executa RPC de sistema');
select pg_temp.entrar_servico();
select is(pg_temp.erro(format($$select public.contrato_registrar_documento(%L, 2, %L, %L, %L)$$, pg_temp.k('k1'),
            pg_temp.k('k1') || '/minuta-v2-bbbbbbbb.pdf', pg_temp.sha('bbbbbbbb'), pg_temp.sha('22'))) ->> 'mensagem',
          'CONFLITO_VERSAO', 'registrar documento: versão fora de ordem → CONFLITO_VERSAO');
select is(pg_temp.erro(format($$select public.contrato_registrar_documento(%L, 1, %L, %L, %L)$$, pg_temp.k('k1'),
            pg_temp.k('k1') || '/minuta-v1-ffffffff.pdf', pg_temp.sha('aaaaaaaa'), pg_temp.sha('11'))) ->> 'mensagem',
          'DADOS_INVALIDOS', 'registrar documento: o caminho precisa ter o sha do arquivo');
-- K3 já está com pdf_versao 1 (a simulação mudou em rascunho): a próxima minuta é a v2
select is(pg_temp.erro(format($$select public.contrato_registrar_documento(%L, 2, %L, %L, %L)$$, pg_temp.k('k3'),
            pg_temp.k('k3') || '/minuta-v2-dddddddd.pdf', pg_temp.sha('dddddddd'), pg_temp.sha('11'))) ->> 'mensagem',
          'O arquivo do PDF não foi encontrado no armazenamento.', 'registrar documento: o objeto precisa existir no bucket');
-- WP4R-04: PDF montado com a simulação antiga não é registrado como atual
select pg_temp.entrar('ca1a');
create temp table dados_k3 as select public.contrato_dados_modelo(pg_temp.k('k3')) as d;
grant select on dados_k3 to service_role;
select lives_ok($$select public.contrato_atualizar_simulacao(pg_temp.k('k3'), 'parcelado', 35, 0, 120)$$,
                'WP4R-04: a simulação muda enquanto a Edge contrato-gerar monta o PDF');
select pg_temp.entrar_servico();
select is(pg_temp.erro(format($$select public.contrato_registrar_documento(%L, %s, %L, %L, %L)$$, pg_temp.k('k3'),
            (select (d ->> 'pdf_versao')::int + 1 from dados_k3),
            pg_temp.k('k3') || '/minuta-v' || (select (d ->> 'pdf_versao')::int + 1 from dados_k3) || '-dddddddd.pdf',
            pg_temp.sha('dddddddd'), pg_temp.sha('11'))) ->> 'mensagem',
          'CONFLITO_VERSAO', 'WP4R-04: o PDF com os dados lidos antes da mudança cai em CONFLITO_VERSAO');
select pg_temp.entrar('ca1a');
select lives_ok($$select public.contrato_atualizar_simulacao(pg_temp.k('k3'), 'parcelado', 35, 0, 120)$$,
                'atualizar: salvar a mesma simulação de novo');
select pg_temp.sair();
select is((select k.pdf_versao || '|' || k.pdf_desatualizado || '|' || coalesce(k.pdf_path, '-') from public.contratos k where k.id = pg_temp.k('k3')),
          '2|true|-', 'WP4R-04: continua sem PDF e desatualizado; a mesma simulação salva de novo não avança a versão');
select lives_ok(format($$select public.contrato_registrar_documento(%L, 1, %L, %L, %L)$$, pg_temp.k('k1'),
            pg_temp.k('k1') || '/minuta-v1-aaaaaaaa.pdf', pg_temp.sha('aaaaaaaa'), pg_temp.sha('11')),
          'registrar documento: versão 1 do K1');
select lives_ok(format($$select public.contrato_registrar_documento(%L, 1, %L, %L, %L)$$, pg_temp.k('k2'),
            pg_temp.k('k2') || '/minuta-v1-cccccccc.pdf', pg_temp.sha('cccccccc'), pg_temp.sha('33')),
          'registrar documento: versão 1 do K2');
select pg_temp.sair();
select is((select jsonb_build_object('versao', k.pdf_versao, 'desatualizado', k.pdf_desatualizado, 'texto', k.texto_sha256 = pg_temp.sha('11'))
           from public.contratos k where k.id = pg_temp.k('k1')),
          '{"versao":1,"desatualizado":false,"texto":true}'::jsonb, 'registrar documento: PDF atual e não desatualizado');
select is((select a.origem from public.auditoria a where a.entidade = 'contratos' and a.entidade_id = pg_temp.k('k1')::text and a.acao = 'gerar' and a.origem <> 'rpc'),
          'edge:contrato-gerar', 'registrar documento: auditoria com origem da Edge');
select pg_temp.entrar('ca1a');
select is((public.contrato_detalhe(pg_temp.k('k1')) -> 'pdf') - 'gerado_em',
          '{"versao":1,"desatualizado":false,"disponivel":true,"versoes":[1]}'::jsonb,
          'detalhe: número do arquivo atual e as versões guardadas no bucket (a v2 órfã, acima da versão esperada, não entra)');
select pg_temp.sair();

-- ============ contrato_baixar ============
select pg_temp.entrar('ca1a');
select is(public.contrato_baixar(pg_temp.k('k1'), 'minuta', null) - 'expira_em',
          jsonb_build_object('bucket', 'contratos', 'path', pg_temp.k('k1') || '/minuta-v1-aaaaaaaa.pdf'),
          'baixar: autorização de curta duração para a minuta atual');
select is(pg_temp.erro(format($$select public.contrato_baixar(%L, 'assinado', null)$$, pg_temp.k('k1'))) ->> 'mensagem',
          'O PDF assinado ainda não está disponível.', 'baixar: sem PDF assinado ainda');
select is(pg_temp.erro(format($$select public.contrato_baixar(%L, 'outro', null)$$, pg_temp.k('k1'))) ->> 'mensagem',
          'DADOS_INVALIDOS', 'baixar: tipo inválido');
select pg_temp.entrar('ca2a');
select is(pg_temp.erro(format($$select public.contrato_baixar(%L, 'minuta', null)$$, pg_temp.k('k1'))) ->> 'sqlstate',
          '42501', 'baixar: fora do escopo é recusado');
select pg_temp.sair();
select ok((select count(*) = 1 from public.download_autorizacoes d where d.profile_id = pg_temp.usuario('ca1a') and d.bucket = 'contratos')
          and pg_temp.auditorias('contratos', pg_temp.k('k1')::text, 'baixar') = 1,
          'baixar: autorização só para quem pediu e auditoria acesso/baixar');

-- ============ contrato_mudar_status ============
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'em_analise', null)$$, pg_temp.k('k3'))) -> 'detalhe',
          '{"validacoes":["pdf_gerado"]}'::jsonb, 'status: em análise exige o PDF gerado');
select lives_ok(format($$select public.contrato_mudar_status(%L, 'documentacao_pendente', null)$$, pg_temp.k('k3')),
                'status: rascunho → documentação pendente pelo corretor');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'rascunho', null)$$, pg_temp.k('k3'))) ->> 'mensagem',
          'TRANSICAO_INVALIDA', 'status: voltar para rascunho não é do corretor');
select lives_ok(format($$select public.contrato_mudar_status(%L, 'em_analise', null)$$, pg_temp.k('k1')),
                'status: rascunho → em análise com o PDF gerado');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'assinatura_pendente', null)$$, pg_temp.k('k1'))) ->> 'mensagem',
          'TRANSICAO_INVALIDA', 'status: assinatura pendente só pela Edge (sistema)');
select is(pg_temp.erro(format($$select public.contrato_atualizar_simulacao(%L, 'parcelado', 30, 0, 60)$$, pg_temp.k('k1'))) ->> 'mensagem',
          'A simulação só pode ser alterada com o contrato em rascunho.', 'atualizar: fora de rascunho é recusado');
select pg_temp.entrar('ga1');
select lives_ok(format($$select public.contrato_mudar_status(%L, 'em_analise', null)$$, pg_temp.k('k2')),
                'status: K2 (imóvel) em análise pelo gerente');
select pg_temp.entrar('ca2a');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'arquivado', 'teste')$$, pg_temp.k('k3'))) ->> 'sqlstate',
          '42501', 'status: fora do escopo é recusado');
select pg_temp.sair();
select is((select k.status::text || '|' || (select count(*) from public.historico_status h where h.entidade = 'contrato' and h.entidade_id = k.id)
           from public.contratos k where k.id = pg_temp.k('k1')), 'em_analise|1', 'status: historico_status gravado');
select is(pg_temp.auditorias('contratos', pg_temp.k('k3')::text, 'mudar_status'), 1, 'status: auditoria operacao/mudar_status');
-- imutabilidade fora de rascunho (gatilho contratos_imutavel)
select is(pg_temp.erro(format($$update public.contratos set valor_imovel = 1 where id = %L$$, pg_temp.k('k1'))) ->> 'sqlstate',
          '23514', 'valores do contrato imutáveis fora de rascunho (nem como postgres)');
-- devolução pelo interno
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'rascunho', null)$$, pg_temp.k('k1'))) ->> 'mensagem',
          'MOTIVO_OBRIGATORIO', 'status: devolver para rascunho exige motivo');

-- ============ contrato_preparar_envio (I, com JWT) ============
select pg_temp.entrar('ca1a');
select is(pg_temp.erro(format($$select public.contrato_preparar_envio(%L)$$, pg_temp.k('k1'))) ->> 'sqlstate',
          '42501', 'preparar envio: parceiro não envia para assinatura');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_preparar_envio(%L)$$, pg_temp.k('k3'))) ->> 'mensagem',
          'TRANSICAO_INVALIDA', 'preparar envio: só em análise');
select is(pg_temp.erro(format($$select public.contrato_preparar_envio(%L)$$, pg_temp.k('k1'))) -> 'detalhe',
          '{"validacoes":["modelo_liberado","signatarios_configurados","vendedora_configurada"]}'::jsonb,
          'preparar envio: bloqueado até liberar o modelo, configurar os signatários (D3) e a vendedora (N7)');
-- configuração do envio: Super libera o modelo; signatários e vendedora gravados como postgres (telas do Super)
select pg_temp.entrar('super');
select is(pg_temp.erro($$select public.config_liberar_modelo(public.modelo_vigente_id('parcelado'), false)$$) ->> 'mensagem',
          'Confirme a revisão jurídica para liberar o modelo para envio.', 'liberar modelo: exige confirmar a revisão jurídica');
select is(pg_temp.erro($$select public.config_liberar_modelo(public.modelo_vigente_id('servico_corretor'), true)$$) ->> 'mensagem',
          'Modelos de prestação de serviço são só para pré-visualização e não são liberados para envio.', 'liberar modelo: serviço é só prévia (D6)');
select lives_ok($$select public.config_liberar_modelo(public.modelo_vigente_id('parcelado'), true)$$, 'liberar modelo: o Super libera a versão vigente');
select lives_ok($$select public.config_liberar_modelo(public.modelo_vigente_id('parcelado'), true)$$, 'liberar modelo: idempotente');
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.config_liberar_modelo(public.modelo_vigente_id('flexivel'), true)$$) ->> 'sqlstate',
          '42501', 'liberar modelo: admin (não Super) é recusado');
select pg_temp.sair();
select ok((select m.liberado_para_envio and m.revisado_juridico and m.liberado_por = pg_temp.usuario('super') and m.liberado_em is not null
           from public.contrato_modelos m where m.id = public.modelo_vigente_id('parcelado'))
          and pg_temp.auditorias('contrato_modelos', public.modelo_vigente_id('parcelado')::text, 'liberar') = 1,
          'liberar modelo: gravado com quem liberou e auditado uma vez');
update public.contrato_signatario_regras set email = 'representante@arken.test' where papel = 'representante_arken';
update public.configuracao_geral set vendedora_razao_social = 'ARKEN INCORPORADORA LTDA', vendedora_cnpj = '11222335000170',
  vendedora_endereco = 'Av. Exemplo, 1000, São Paulo/SP';
update public.unidades set valor = 510000 where id = 'f4000000-0000-4000-8000-000000000011';
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_preparar_envio(%L)$$, pg_temp.k('k1'))) -> 'detalhe',
          '{"validacoes":["valor_produto_atual"]}'::jsonb, 'preparar envio: valor do produto mudou depois da simulação → bloqueia (N16)');
select ok((public.contrato_detalhe(pg_temp.k('k1')) ->> 'valor_produto_alterado')::boolean, 'detalhe: avisa que o valor do produto mudou');
select pg_temp.sair();
update public.unidades set valor = 500000 where id = 'f4000000-0000-4000-8000-000000000011';
-- WP4R-05: a vendedora como testemunha (a tela do Super permitia) bloqueia o envio; comprador e vendedora assinam (D3)
update public.contrato_signatario_regras set ato = 'testemunhar' where papel = 'representante_arken';
select pg_temp.entrar('admin');
select is(public.contrato_detalhe(pg_temp.k('k1')) -> 'bloqueios_envio', '["signatarios_configurados"]'::jsonb,
          'WP4R-05: representante da Arken com ato testemunhar aparece como bloqueio do envio');
select is(pg_temp.erro(format($$select public.contrato_preparar_envio(%L)$$, pg_temp.k('k1'))) -> 'detalhe',
          '{"validacoes":["signatarios_configurados"]}'::jsonb, 'WP4R-05: preparar envio recusa a vendedora como testemunha');
select pg_temp.sair();
update public.contrato_signatario_regras set ato = 'assinar' where papel = 'representante_arken';
select pg_temp.entrar('admin');
create temp table preparo_k1 as select public.contrato_preparar_envio(pg_temp.k('k1')) as p;
select is((select p -> 'signatarios' from preparo_k1),
          '[{"ordem":1,"papel":"cliente","nome":"Cliente Um","email":"c1@cliente.test","ato":"assinar"},
            {"ordem":2,"papel":"representante_arken","nome":"Representante Arken","email":"representante@arken.test","ato":"assinar"}]'::jsonb,
          'preparar envio: signatários resolvidos pelas regras ativas (D3)');
select ok((select p ->> 'pdf_path' = pg_temp.k('k1') || '/minuta-v1-aaaaaaaa.pdf' and p ->> 'd4sign_uuid' is null
                  and p ->> 'texto_sha256' = pg_temp.sha('11') from preparo_k1),
          'preparar envio: devolve o PDF atual (e o hash do texto) para a Edge');
select is(pg_temp.erro(format($$select public.contrato_preparar_envio(%L)$$, pg_temp.k('k1'))) ->> 'mensagem',
          'ENVIO_EM_ANDAMENTO', 'preparar envio: trava de 15 minutos');
select ok((public.contrato_detalhe(pg_temp.k('k1')) ->> 'envio_em_andamento')::boolean, 'detalhe: mostra o envio em andamento');
-- WP4R-01: com a trava valendo, nada muda o contrato por fora da Edge contrato-assinatura
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'rascunho', 'ajuste de valor')$$, pg_temp.k('k1'))) ->> 'mensagem',
          'ENVIO_EM_ANDAMENTO', 'WP4R-01: devolver para rascunho durante o envio é recusado');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'arquivado', 'desistência')$$, pg_temp.k('k1'))) ->> 'mensagem',
          'ENVIO_EM_ANDAMENTO', 'WP4R-01: arquivar durante o envio é recusado (o produto não fica livre com o documento vivo)');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'documentacao_pendente', 'falta RG')$$, pg_temp.k('k1'))) ->> 'mensagem',
          'ENVIO_EM_ANDAMENTO', 'WP4R-01: documentação pendente durante o envio é recusada');
select ok((select d -> 'destinos_status' = '[]'::jsonb and not (d -> 'permissoes' ->> 'gerar_pdf')::boolean
                  and not (d -> 'permissoes' ->> 'arquivar')::boolean
           from (select public.contrato_detalhe(pg_temp.k('k1')) as d) x),
          'WP4R-01: durante o envio a tela não oferece mudar status, arquivar nem gerar PDF');
select pg_temp.entrar_servico();
select is(pg_temp.erro(format($$select public.contrato_registrar_documento(%L, 2, %L, %L, %L)$$, pg_temp.k('k1'),
            pg_temp.k('k1') || '/minuta-v2-bbbbbbbb.pdf', pg_temp.sha('bbbbbbbb'), pg_temp.sha('22'))) ->> 'mensagem',
          'ENVIO_EM_ANDAMENTO', 'WP4R-01: um PDF novo não é registrado durante o envio');
select is(pg_temp.erro(format($$select public.contrato_confirmar_envio(%L, 'doc-k1')$$, pg_temp.k('k1'))) ->> 'mensagem',
          'O contrato não está em envio para assinatura.', 'confirmar envio: o documento precisa ser o registrado');
select pg_temp.sair();
select is((select k.status::text || '|' || k.pdf_versao from public.contratos k where k.id = pg_temp.k('k1')), 'em_analise|1',
          'WP4R-01: o contrato continua em análise com a minuta v1');
select ok((select k.envio_lock_em is not null and k.enviado_por = pg_temp.usuario('admin') from public.contratos k where k.id = pg_temp.k('k1'))
          and pg_temp.auditorias('contratos', pg_temp.k('k1')::text, 'enviar_assinatura') = 1,
          'preparar envio: trava, quem enviou e auditoria');

-- ============ falha e envio (service, Edge contrato-assinatura) ============
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_falha_envio(%L, 'x')$$, pg_temp.k('k1'))) ->> 'sqlstate',
          '42501', 'falha de envio: authenticated não executa');
select is(pg_temp.erro(format($$select public.contrato_confirmar_envio(%L, 'doc-k1')$$, pg_temp.k('k1'))) ->> 'sqlstate',
          '42501', 'confirmar envio: authenticated (nem admin) não executa');
select pg_temp.entrar_servico();
select lives_ok(format($$select public.contrato_registrar_d4sign_uuid(%L, 'doc-k1')$$, pg_temp.k('k1')), 'd4sign uuid: gravado logo depois do upload');
select lives_ok(format($$select public.contrato_registrar_d4sign_uuid(%L, 'doc-k1')$$, pg_temp.k('k1')), 'd4sign uuid: idempotente');
-- contrato_confirmar_envio (WP4R-01): a Edge reconfere tudo logo antes do disparo no D4Sign
select lives_ok(format($$select public.contrato_confirmar_envio(%L, 'doc-k1')$$, pg_temp.k('k1')),
                'confirmar envio: em análise, trava valendo, documento registrado e validações em dia');
select is(pg_temp.erro(format($$select public.contrato_confirmar_envio(%L, 'doc-outro')$$, pg_temp.k('k1'))) ->> 'mensagem',
          'O contrato não está em envio para assinatura.', 'confirmar envio: outro documento é recusado');
select pg_temp.sair();
update public.unidades set valor = 510000 where id = 'f4000000-0000-4000-8000-000000000011';
select pg_temp.entrar_servico();
select is(pg_temp.erro(format($$select public.contrato_confirmar_envio(%L, 'doc-k1')$$, pg_temp.k('k1'))) -> 'detalhe',
          '{"validacoes":["valor_produto_atual"]}'::jsonb, 'confirmar envio: valor do produto mudou no meio do envio → não dispara');
select pg_temp.sair();
update public.unidades set valor = 500000 where id = 'f4000000-0000-4000-8000-000000000011';
update public.contrato_signatario_regras set ato = 'testemunhar' where papel = 'representante_arken';
select pg_temp.entrar_servico();
select is(pg_temp.erro(format($$select public.contrato_confirmar_envio(%L, 'doc-k1')$$, pg_temp.k('k1'))) -> 'detalhe',
          '{"validacoes":["signatarios_configurados"]}'::jsonb, 'confirmar envio: vendedora virou testemunha no meio do envio → não dispara');
select pg_temp.sair();
update public.contrato_signatario_regras set ato = 'assinar' where papel = 'representante_arken';
update public.contratos set envio_lock_em = now() - interval '16 minutes' where id = pg_temp.k('k1');
select pg_temp.entrar_servico();
select is(pg_temp.erro(format($$select public.contrato_confirmar_envio(%L, 'doc-k1')$$, pg_temp.k('k1'))) ->> 'mensagem',
          'O contrato não está em envio para assinatura.', 'confirmar envio: trava vencida (mais de 15 min) → não dispara');
select pg_temp.sair();
update public.contratos set envio_lock_em = now() where id = pg_temp.k('k1');
select pg_temp.entrar_servico();
select lives_ok(format($$select public.contrato_falha_envio(%L, 'HTTP 500 no createlist')$$, pg_temp.k('k1')), 'falha de envio: registrada');
select pg_temp.sair();
select ok((select k.status = 'em_analise' and k.envio_lock_em is null and k.d4sign_uuid = 'doc-k1' from public.contratos k where k.id = pg_temp.k('k1'))
          and exists (select 1 from public.integracao_chamadas c where c.entidade_id = pg_temp.k('k1') and c.operacao = 'enviar:falha'
                        and c.erro = 'HTTP 500 no createlist'),
          'falha de envio: libera a trava, mantém o uuid (o reenvio reaproveita) e o erro vai para integracao_chamadas');
select pg_temp.entrar('admin');
select is((public.contrato_preparar_envio(pg_temp.k('k1')) ->> 'd4sign_uuid'), 'doc-k1', 'reenvio: preparar devolve o uuid já criado');
select pg_temp.entrar_servico();
select is(pg_temp.erro(format($$select public.contrato_registrar_envio(%L, '[{"ordem":1,"papel":"representante_arken","nome":"Rep","email":"representante@arken.test","ato":"assinar"}]', %L)$$,
            pg_temp.k('k1'), pg_temp.sha('ee'))) -> 'detalhe',
          '{"validacoes":["signatarios_configurados"]}'::jsonb, 'registrar envio: exige o signatário comprador');
select is(pg_temp.erro(format($$select public.contrato_registrar_envio(%L, %L, %L)$$, pg_temp.k('k1'),
            '[{"ordem":1,"papel":"cliente","nome":"Cliente Um","email":"c1@cliente.test","ato":"assinar"},
              {"ordem":2,"papel":"representante_arken","nome":"Rep","email":"representante@arken.test","ato":"testemunhar"}]',
            pg_temp.sha('ee'))) -> 'detalhe',
          '{"validacoes":["signatarios_configurados"]}'::jsonb, 'registrar envio (WP4R-05): a vendedora como testemunha não conta');
select lives_ok(format($$select public.contrato_registrar_envio(%L, %L, %L)$$, pg_temp.k('k1'),
            '[{"ordem":1,"papel":"cliente","nome":"Cliente Um","email":"c1@cliente.test","ato":"assinar","d4sign_chave":"key-1"},
              {"ordem":2,"papel":"representante_arken","nome":"Representante Arken","email":"representante@arken.test","ato":"assinar","d4sign_chave":"key-2"}]',
            pg_temp.sha('ee')),
          'registrar envio: K1 enviado');
select lives_ok(format($$select public.contrato_registrar_envio(%L, %L, %L)$$, pg_temp.k('k1'),
            '[{"ordem":1,"papel":"cliente","nome":"Cliente Um","email":"c1@cliente.test","ato":"assinar","d4sign_chave":"key-1"},
              {"ordem":2,"papel":"representante_arken","nome":"Representante Arken","email":"representante@arken.test","ato":"assinar","d4sign_chave":"key-2"}]',
            pg_temp.sha('ee')),
          'registrar envio: idempotente');
select pg_temp.sair();
select is((select k.status::text || '|' || (k.enviado_assinatura_em is not null)::text || '|' || (k.envio_lock_em is null)::text
                  || '|' || (select count(*) from public.contrato_signatarios s where s.contrato_id = k.id)
                  || '|' || (select count(*) from public.historico_status h where h.entidade = 'contrato' and h.entidade_id = k.id and h.para = 'assinatura_pendente')
           from public.contratos k where k.id = pg_temp.k('k1')),
          'assinatura_pendente|true|true|2|1', 'registrar envio: status, data, trava liberada, 2 signatários e 1 transição');
select is(pg_temp.eventos('c1', 'contrato_enviado'), 1, 'registrar envio: timeline contrato_enviado');
select is((select array_agg(a.categoria || ':' || coalesce(a.detalhe ->> 'fase', a.detalhe ->> 'rpc') order by a.id) from public.auditoria a
            where a.entidade = 'contratos' and a.entidade_id = pg_temp.k('k1')::text and a.acao = 'enviar_assinatura'),
          array['operacao:preparar', 'integracao:documento', 'integracao:falha', 'operacao:preparar', 'operacao:contrato_registrar_envio'],
          'envio: auditoria de cada fase (preparar, documento no D4Sign, falha, reenvio e envio registrado)');
-- K2: imóvel vai a NC no envio (efeito imovel_no_contrato)
select pg_temp.entrar('admin');
select lives_ok(format($$select public.contrato_preparar_envio(%L)$$, pg_temp.k('k2')), 'K2: preparar envio');
select pg_temp.entrar_servico();
select lives_ok(format($$select public.contrato_registrar_d4sign_uuid(%L, 'doc-k2')$$, pg_temp.k('k2')), 'K2: uuid');
select lives_ok(format($$select public.contrato_registrar_envio(%L, %L, %L)$$, pg_temp.k('k2'),
            '[{"ordem":1,"papel":"cliente","nome":"Cliente Quatro","email":"c4@cliente.test","ato":"assinar"},
              {"ordem":2,"papel":"representante_arken","nome":"Representante Arken","email":"representante@arken.test","ato":"assinar"}]',
            pg_temp.sha('ff')), 'K2: enviado');
select pg_temp.sair();
select is((select i.status::text from public.imoveis i where i.id = 'f4000000-0000-4000-8000-000000000021'), 'no_contrato',
          'envio: o imóvel vai para no_contrato (D5/E2)');
-- cadeia congelada: transferir o cliente de K2 (c4, GA1) para CA2a não mexe no contrato já enviado
set local arken.motivo_vinculo = 'teste: transferência';
update public.clientes set corretor_id = pg_temp.parceiro('ca2a') where id = pg_temp.cliente('c4');
set local arken.motivo_vinculo = '';
select is((select array[k.corretor_id, k.gerente_id] from public.contratos k where k.id = pg_temp.k('k2')),
          array[pg_temp.parceiro('ga1'), pg_temp.parceiro('ga1')], 'cascata: a cadeia do contrato enviado fica congelada');
select pg_temp.entrar('ga1');
select is(pg_temp.lista('{}'), array['k1', 'k3'], 'listar: a visibilidade segue o cliente (GA1 deixou de ver K2)');
select pg_temp.entrar('ca2a');
select is(pg_temp.lista('{}'), array['k2', 'k6', 'k7'], 'listar: o novo corretor do cliente vê o contrato (e os que já eram dos clientes dele)');
select is((public.contratos_listar('{}') -> 'itens' -> 0 -> 'corretor'), 'null'::jsonb,
          'listar PAR-3: o corretor antigo (congelado no contrato) não aparece para quem está ao lado');

-- ============ cancelamento (D4Sign antes) ============
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'cancelado', 'Cliente desistiu')$$, pg_temp.k('k2'))) ->> 'mensagem',
          'O envio para assinatura é cancelado pelo painel de assinatura do contrato, que cancela antes no D4Sign.',
          'cancelar: sem o cancelamento no D4Sign registrado pela Edge, o banco recusa (R1-03)');
-- WP4R-03: o registro genérico das chamadas não é prova (nem o 'cancelar' sem erro, nem o 200 com erro), nem a prova com erro
select pg_temp.entrar_servico();
insert into public.integracao_chamadas (provedor, operacao, entidade, entidade_id, http_status, duracao_ms, erro) values
  ('d4sign', 'cancelar', 'contrato', pg_temp.k('k2'), 200, 150, null),
  ('d4sign', 'cancelar', 'contrato', pg_temp.k('k2'), 200, 120, 'Resposta do D4Sign não é JSON'),
  ('d4sign', 'cancelar_confirmado', 'contrato', pg_temp.k('k2'), 200, 120, 'falha qualquer');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'cancelado', 'Cliente desistiu')$$, pg_temp.k('k2'))) ->> 'mensagem',
          'O envio para assinatura é cancelado pelo painel de assinatura do contrato, que cancela antes no D4Sign.',
          'cancelar (WP4R-03): chamada ''cancelar'' (mesmo HTTP 200) ou prova com erro não bastam');
select pg_temp.entrar_servico();
insert into public.integracao_chamadas (provedor, operacao, entidade, entidade_id, http_status, duracao_ms)
values ('d4sign', 'cancelar_confirmado', 'contrato', pg_temp.k('k2'), 200, 150);
select pg_temp.entrar('ca2a');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'cancelado', 'Cliente desistiu')$$, pg_temp.k('k2'))) ->> 'mensagem',
          'TRANSICAO_INVALIDA', 'cancelar: parceiro não cancela o envio');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'cancelado', null)$$, pg_temp.k('k2'))) ->> 'mensagem',
          'MOTIVO_OBRIGATORIO', 'cancelar: exige motivo');
select lives_ok(format($$select public.contrato_mudar_status(%L, 'cancelado', 'Cliente desistiu')$$, pg_temp.k('k2')),
                'cancelar: com o cancelamento no D4Sign registrado, o interno cancela');
select pg_temp.sair();
select is((select i.status::text from public.imoveis i where i.id = 'f4000000-0000-4000-8000-000000000021'), 'aprovado',
          'cancelar: o imóvel volta para aprovado');
select ok((select k.status = 'cancelado' and k.encerrado_em is not null from public.contratos k where k.id = pg_temp.k('k2'))
          and pg_temp.eventos('c4', 'contrato_encerrado') = 1,
          'cancelar: contrato encerrado e timeline contrato_encerrado');

-- ============ contrato_registrar_retorno (webhook reconsultado / reconciliação) ============
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.contrato_registrar_retorno('doc-k1', 'assinado', null, null, null)$$) ->> 'sqlstate',
          '42501', 'retorno: authenticated não executa');
select pg_temp.entrar_servico();
select lives_ok($$select public.contrato_registrar_retorno('doc-k1', 'assinatura_pendente',
                  '[{"email":"C1@cliente.test","status":"assinado","assinado_em":"2026-09-28T12:00:00Z","recusado_em":null,"motivo":null}]', null, null)$$,
                'retorno: andamento por signatário');
select pg_temp.sair();
select is((select string_agg(s.papel || ':' || s.status, ',' order by s.ordem) from public.contrato_signatarios s where s.contrato_id = pg_temp.k('k1'))
            || '|' || pg_temp.status('k1'),
          'cliente:assinado,representante_arken:pendente|assinatura_pendente', 'retorno: só o signatário muda');
insert into storage.objects (bucket_id, name, metadata) values
  ('contratos', pg_temp.k('k1') || '/assinado-dddddddd.pdf', '{"size":130000,"mimetype":"application/pdf"}');
select pg_temp.entrar_servico();
select is(pg_temp.erro($$select public.contrato_registrar_retorno('doc-k1', 'assinado', null, 'x/assinado-dddddddd.pdf', rpad('dddddddd', 64, '0'))$$) ->> 'mensagem',
          'DADOS_INVALIDOS', 'retorno: o PDF assinado precisa estar no caminho do contrato');
select lives_ok(format($$select public.contrato_registrar_retorno('doc-k1', 'assinado', null, %L, %L)$$,
                  pg_temp.k('k1') || '/assinado-dddddddd.pdf', pg_temp.sha('dddddddd')), 'retorno: todos assinaram');
select lives_ok(format($$select public.contrato_registrar_retorno('doc-k1', 'assinado', null, %L, %L)$$,
                  pg_temp.k('k1') || '/assinado-dddddddd.pdf', pg_temp.sha('dddddddd')), 'retorno: o mesmo retorno de novo');
select lives_ok($$select public.contrato_registrar_retorno('doc-k1', 'recusado', null, null, null)$$, 'retorno: recusado depois de assinado');
select pg_temp.sair();
select is(pg_temp.status('k1'), 'assinado', 'retorno: assinado seguido de recusado é ignorado');
select is((select count(*)::int from public.historico_status h where h.entidade = 'contrato' and h.entidade_id = pg_temp.k('k1') and h.para = 'assinado'),
          1, 'retorno duas vezes: uma transição só');
select is((select count(*)::int from public.eventos_dominio e where e.tipo = 'contrato.assinado' and e.entidade_id = pg_temp.k('k1')),
          1, 'retorno duas vezes: um evento de domínio contrato.assinado só (§3.11)');
select is((select e.dados - 'contrato_id' from public.eventos_dominio e where e.tipo = 'contrato.assinado' and e.entidade_id = pg_temp.k('k1')),
          jsonb_build_object('cliente_id', pg_temp.cliente('c1'), 'forma_pagamento', 'parcelado', 'imobiliaria_id', pg_temp.imobiliaria('a'),
                             'gerente_id', pg_temp.parceiro('ga1'), 'corretor_id', pg_temp.parceiro('ca1a')),
          'evento contrato.assinado leva a cadeia congelada (base do B5)');
select is((select c.etapa::text from public.clientes c where c.id = pg_temp.cliente('c1')), 'finalizado', 'assinado: o cliente vai para finalizado (D5, CTR-4)');
select ok((select k.assinado_em is not null and k.pdf_assinado_path = k.id || '/assinado-dddddddd.pdf'
                  and (select bool_and(s.status = 'assinado') from public.contrato_signatarios s where s.contrato_id = k.id)
           from public.contratos k where k.id = pg_temp.k('k1')),
          'assinado: PDF assinado guardado e todos os signatários como assinado');
select is(pg_temp.eventos('c1', 'contrato_assinado'), 1, 'assinado: timeline contrato_assinado uma vez');
select is(pg_temp.auditorias('contratos', pg_temp.k('k1')::text, 'assinar'), 1, 'assinado: auditoria integracao/assinar uma vez');
select pg_temp.entrar('ca1a');
select is(public.contrato_baixar(pg_temp.k('k1'), 'assinado', null) ->> 'path', pg_temp.k('k1') || '/assinado-dddddddd.pdf',
          'baixar: o PDF assinado depois da assinatura');
select is(pg_temp.erro(format($$select public.contrato_dados_modelo(%L)$$, pg_temp.k('k1'))) ->> 'mensagem',
          'O texto do contrato só é gerado antes do envio para assinatura.', 'dados do modelo: não gera depois do envio');
select pg_temp.entrar('admin');
select is(pg_temp.erro(format($$select public.contrato_mudar_status(%L, 'arquivado', 'teste')$$, pg_temp.k('k1'))) ->> 'mensagem',
          'TRANSICAO_INVALIDA', 'status: assinado não se arquiva nesta etapa');
-- recusado (K4): imóvel volta para aprovado
select pg_temp.entrar_servico();
select lives_ok($$select public.contrato_registrar_retorno('doc-k4', 'recusado',
                  '[{"email":"cliente-k4@cliente.test","status":"recusado","assinado_em":null,"recusado_em":null,"motivo":"Não concordo"}]', null, null)$$,
                'retorno: recusado');
select pg_temp.sair();
select is(pg_temp.status('k4') || '|' || (select i.status::text from public.imoveis i where i.id = 'f4000000-0000-4000-8000-000000000023'),
          'recusado|aprovado', 'recusado: contrato recusado e imóvel de volta a aprovado');
select is((select s.motivo from public.contrato_signatarios s where s.contrato_id = pg_temp.k('k4') and s.papel = 'cliente'), 'Não concordo',
          'recusado: motivo do signatário guardado');
-- cancelado no D4Sign: sem pedido nosso → recusado; pedido há mais de 15 min → cancelado; pedido recente → nada.
-- K5 tem só uma chamada 'cancelar' que falhou (200 com resposta inválida): não é pedido confirmado (WP4R-03)
insert into public.integracao_chamadas (provedor, operacao, entidade, entidade_id, http_status, criado_em, erro) values
  ('d4sign', 'cancelar', 'contrato', pg_temp.k('k5'), 200, now() - interval '1 hour', 'Resposta do D4Sign não é JSON'),
  ('d4sign', 'cancelar_confirmado', 'contrato', pg_temp.k('k6'), 200, now() - interval '1 hour', null),
  ('d4sign', 'cancelar_confirmado', 'contrato', pg_temp.k('k7'), 200, now() - interval '1 minute', null);
select pg_temp.entrar_servico();
select lives_ok($$select public.contrato_registrar_retorno('doc-k5', 'cancelado', null, null, null)$$, 'retorno: K5 cancelado no D4Sign');
select lives_ok($$select public.contrato_registrar_retorno('doc-k6', 'cancelado', null, null, null)$$, 'retorno: K6 cancelado no D4Sign');
select lives_ok($$select public.contrato_registrar_retorno('doc-k7', 'cancelado', null, null, null)$$, 'retorno: K7 cancelado no D4Sign');
select is(pg_temp.erro($$select public.contrato_registrar_retorno('doc-inexistente', 'assinado', null, null, null)$$) ->> 'sqlstate',
          'P0002', 'retorno: documento desconhecido');
select pg_temp.sair();
select is(array[pg_temp.status('k5'), pg_temp.status('k6'), pg_temp.status('k7')], array['recusado', 'cancelado', 'assinatura_pendente'],
          'cancelado no D4Sign: sem pedido da plataforma = recusado ⚑; pedido antigo = cancelado; pedido recente = a Edge conclui');
select is((select h.motivo from public.historico_status h where h.entidade = 'contrato' and h.entidade_id = pg_temp.k('k5')),
          'Documento cancelado no D4Sign sem pedido da plataforma', 'cancelado no D4Sign: motivo do sistema no histórico');
select is((select count(*)::int from public.auditoria a where a.entidade = 'contratos' and a.origem = 'webhook:d4sign'
             and a.entidade_id in (pg_temp.k('k4')::text, pg_temp.k('k5')::text, pg_temp.k('k6')::text)), 3,
          'retorno: auditoria integracao com origem webhook:d4sign');

-- ============ produto de novo disponível depois do encerramento; arquivar ============
select pg_temp.entrar('admin');
select lives_ok(format($$select public.contrato_mudar_status(%L, 'arquivado', 'Refeito')$$, pg_temp.k('k3')), 'arquivar: o interno arquiva');
select pg_temp.sair();
select is(pg_temp.eventos('c1', 'contrato_encerrado'), 1, 'arquivar: timeline contrato_encerrado');
select pg_temp.entrar('ca1a');
select isnt(public.contrato_criar(pg_temp.cliente('c1'), 'parcelado', '{"unidade_id":"f4000000-0000-4000-8000-000000000014"}', 30, 0, 60), null,
            'um contrato ativo por produto: depois de arquivado, o produto aceita um contrato novo');
select pg_temp.entrar('ga2');
select isnt(public.contrato_criar(pg_temp.cliente('c2'), 'parcelado', '{"imovel_id":"f4000000-0000-4000-8000-000000000021"}', 30, 0, 60), null,
            'imóvel de volta a aprovado entra em contrato novo');

-- ============ config_publicar_modelo (Super) ============
select pg_temp.entrar('admin');
select is(pg_temp.erro($$select public.config_publicar_modelo('flexivel', 'Modelo novo', '# Título\n\nContrato {{codigo}} de {{nome}}.')$$) ->> 'sqlstate',
          '42501', 'publicar modelo: admin (não Super) é recusado');
select pg_temp.entrar('super');
select is(pg_temp.erro($$select public.config_publicar_modelo('flexivel', 'Modelo novo', 'Contrato {{codigo}} de {{nome}} e {{senha}} e {{xpto}}.')$$) -> 'detalhe',
          '{"variaveis_invalidas":["senha","xpto"]}'::jsonb, 'publicar modelo: variável fora da lista permitida → DADOS_INVALIDOS');
select is(pg_temp.erro($$select public.config_publicar_modelo('flexivel', 'Modelo novo', 'Contrato {{codigo} de {{nome}} ok ok ok.')$$) -> 'detalhe',
          '{"motivo":"chaves_sem_par"}'::jsonb, 'publicar modelo: chave sem par → DADOS_INVALIDOS');
select is(pg_temp.erro($$select public.config_publicar_modelo('flexivel', 'Modelo novo', '<p>Contrato {{codigo}} de {{nome}}</p>')$$) -> 'detalhe',
          '{"motivo":"html_nao_permitido"}'::jsonb, 'publicar modelo: HTML não é aceito (marcação restrita)');
select is(pg_temp.erro($$select public.config_publicar_modelo('flexivel', 'x', 'curto')$$) -> 'detalhe',
          '{"campos":["titulo","conteudo"]}'::jsonb, 'publicar modelo: título e conteúdo obrigatórios');
create temp table modelo_novo as
  select public.config_publicar_modelo('flexivel', 'Aquisição, plano flexível (v2)', E'# Contrato {{codigo}}\r\n\r\nComprador: **{{nome}}**, CPF {{cpf-cnpj}}.') as id;
select pg_temp.sair();
select is((select jsonb_build_object('versao', m.versao, 'variaveis', to_jsonb(m.variaveis), 'liberado', m.liberado_para_envio,
                                     'crlf', m.conteudo like E'%\r%', 'vigente', m.id = public.modelo_vigente_id('flexivel'))
           from public.contrato_modelos m where m.id = (select id from modelo_novo)),
          '{"versao":2,"variaveis":["codigo","cpf-cnpj","nome"],"liberado":false,"crlf":false,"vigente":true}'::jsonb,
          'publicar modelo: versão 2 vigente, variáveis extraídas, não liberada, quebras de linha normalizadas');
select is(pg_temp.auditorias('contrato_modelos', (select id::text from modelo_novo), 'publicar'), 1, 'publicar modelo: auditoria configuracao');
select pg_temp.entrar('super');
select is(pg_temp.erro(format($$select public.config_liberar_modelo(%L, true)$$,
            (select m.id from public.contrato_modelos m where m.chave = 'flexivel' and m.versao = 1))) ->> 'mensagem',
          'Só a versão vigente do modelo pode ser liberada.', 'liberar modelo: versão antiga não é liberada');

select * from finish();
rollback;
