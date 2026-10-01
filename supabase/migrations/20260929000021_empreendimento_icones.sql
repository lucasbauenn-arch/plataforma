-- Ícones do catálogo nos itens de lazer e nas proximidades do empreendimento (editor do admin, aba "Lazer, ficha e
-- proximidades"). A coluna guarda só a CHAVE do catálogo do front (src/components/app/catalogoIcones.ts, ex.:
-- 'piscina', 'mercado'); o desenho é o ícone do lucide-react correspondente. Nula = sem ícone do catálogo (itens antigos
-- continuam com a imagem de `empreendimento_lazer.icone`, vinda do WordPress, ou com o ícone padrão da página).
--
-- Por que uma coluna nova e não `empreendimento_lazer.icone`: essa já guarda o caminho da imagem do Storage
-- (ex.: 'wp/2025/09/10.webp'), usado pela página pública; misturar os dois formatos quebraria a exibição.
--
-- Sem dado pessoal: as tabelas já são públicas (leitura por anon, escrita só admin, migrations 20260921000001/02) e as
-- concessões são por tabela, então valem para a coluna nova sem grant adicional. Nenhum dado existente é alterado.

alter table public.empreendimento_lazer
  add column if not exists icone_catalogo text;

alter table public.empreendimento_lazer
  drop constraint if exists empreendimento_lazer_icone_catalogo_formato;
alter table public.empreendimento_lazer
  add constraint empreendimento_lazer_icone_catalogo_formato
  check (icone_catalogo is null or icone_catalogo ~ '^[a-z][a-z0-9_]{0,39}$');

comment on column public.empreendimento_lazer.icone_catalogo is
  'Chave do ícone no catálogo do front (src/components/app/catalogoIcones.ts). Nula = sem ícone do catálogo.';

alter table public.empreendimento_proximidades
  add column if not exists icone_catalogo text;

alter table public.empreendimento_proximidades
  drop constraint if exists empreendimento_proximidades_icone_catalogo_formato;
alter table public.empreendimento_proximidades
  add constraint empreendimento_proximidades_icone_catalogo_formato
  check (icone_catalogo is null or icone_catalogo ~ '^[a-z][a-z0-9_]{0,39}$');

comment on column public.empreendimento_proximidades.icone_catalogo is
  'Categoria da proximidade (chave do catálogo do front: mercado, escola, metro…). Nula = sem categoria.';
