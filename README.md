# Arken Incorporadora — arkenincorporadora.com.br

Migração do site WordPress da Bauenn para **Vite + React + TypeScript + Tailwind v4 + Supabase**.

## Módulos
| Área | Rota | Substitui (WordPress) |
|---|---|---|
| Site público | `/`, `/empreendimentos/:slug`, `/quem-somos`, `/portfolio` | Elementor + JetEngine (CPT empreendimentos) |
| Área do parceiro | `/parceiros` → `/parceiros/painel` (empreendimentos + tabela de unidades, meus clientes, propostas) | Ultimate Member + snippets `CardEmpreendimentos`, `FomularioParceirosClie`, `Tabela p Parceiro`, `Forms para propostas` (dados no Notion) |
| Portal do cliente | `/portal-do-cliente` (só CPF, com limite por IP e auditoria em `portal_acessos` — decisão do cliente, ver PRD 12) | snippets `LoginCliente` / `Pagina Cliente` (CPF na URL) |
| Admin | `/admin` | wp-admin + Notion |

## Rodar localmente
```bash
npm install
cp .env.example .env    # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev
```

## Banco (Supabase)
Projeto: `xucwjsycawizrlouqkvh` (https://xucwjsycawizrlouqkvh.supabase.co).

1. `supabase/migrations/` — `..._schema_inicial.sql` (tabelas, RLS, buckets) e `..._grants_e_ajustes.sql`
   (grants explícitos da Data API — nada é exposto automaticamente —, correção do trigger de papel, índices).
2. `supabase/seed/seed_wordpress.sql` — 18 empreendimentos do WordPress com galerias, lazer, ficha técnica e proximidades
   (gerado por `scripts/wp_to_supabase.py` a partir do dump).
3. Imagens: `npm run midias:upload` com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no `.env` (só local!).
4. Auth (e-mails em pt-BR em `supabase/templates/`, SMTP Resend, OTP de 6 dígitos): `supabase config push`,
   com `RESEND_API_KEY` em `supabase/.env`. Revise o diff antes de confirmar.
5. Edge function: `supabase functions deploy cliente-login`.
6. Primeiro admin: após criar a conta em `/parceiros/cadastro`, rodar no SQL editor
   `update profiles set papel='admin', status_parceiro='aprovado' where email='...';`

```bash
supabase login
supabase link --project-ref xucwjsycawizrlouqkvh
supabase db push --include-seed
supabase functions deploy cliente-login
supabase config push
```

Testar migrations localmente: `supabase db start` (aplica migrations + seed num Postgres em Docker).

## Pendências conhecidas
- Dados do Notion (clientes de parceiros, propostas, espelhos de vendas/unidades, obras) — exportar CSV do Notion para importar.
- Parceiros do WordPress: senhas não migram (hash phpass). Eles recebem convite / "esqueci a senha".
- Razão social e revisão jurídica dos textos legais (`src/content/legal.json` ainda cita a empresa antiga).
- Tour virtual 360° (`uploads/tour-virtual`) não está ligado a nenhum empreendimento no banco — definir qual.
- Redes sociais, e-mail comercial e logo definitivos da Arken (`src/lib/constants.ts`, `src/components/Logo.tsx`).
