# CLAUDE.md — Arken Incorporadora

Leia `docs/PRD.md` antes de qualquer tarefa. Mapeamento do site antigo: `docs/MAPEAMENTO_BAUENN.md`.

## Stack
Vite 8 · React 19 · TypeScript 6 · Tailwind v4 (`@theme` + `@utility` em `src/index.css`, sem tailwind.config) ·
React Router 7 · TanStack Query 5 · react-hook-form + zod 4 · Supabase (Auth, Postgres/RLS, Storage, Edge Functions Deno) · lucide-react · sonner.

## Comandos
- Testes: `npm test` (Vitest, `src/**/*.test.ts`) · `npm run test:e2e` (Playwright, `e2e/`, rede do Supabase simulada — não grava no banco) · `npm run test:db` (pgTAP em `supabase/tests/`, com `supabase db start`)
- `npm run dev` · `npm run build` (tsc -b + vite build + `scripts/gerar-seo.mjs`: HTML por página pública, imagens OG, sitemap — lê o Supabase com as chaves `VITE_*`) · `npm run typecheck` · `npm run lint` (oxlint)
- SEO: página pública nova → entrada em `src/content/seo.json` (título/descrição) — vale para o `<head>` no SPA e para o HTML pré-renderizado.
- `npm run midias:upload` — converte para WebP (≤ 1920 px, q80, via `sharp`) e envia as imagens do `uploads.zip` ao Storage; o seed já aponta para `.webp` (precisa `SUPABASE_SERVICE_ROLE_KEY` = secret key `sb_secret_...` e **Node 22+**, uso local)
- `python3 scripts/wp_to_supabase.py` — regenera `supabase/seed/seed_wordpress.sql` (precisa do dump num MariaDB local, banco `wp`)

## Estrutura
- `src/pages/` — públicas; `parceiros/` (+ `painel/`); `cliente/`; `admin/`
- `src/components/` — layout, cards, galeria, estados (Carregando/Vazio/Erro), Campo, Protegido (guarda por papel)
- `src/lib/` — `supabase.ts`, `auth.tsx` (AuthProvider/useAuth), `types.ts`, `constants.ts` (estágios, interesses, dados da empresa), `format.ts` (BRL, CPF, telefone, WhatsApp), `midia.ts`
- `src/hooks/queries.ts` — queries compartilhadas
- `supabase/migrations/`, `supabase/seed/`, `supabase/functions/cliente-login/`

## Regras
- **Toda UI em pt-BR.** Nomes de variáveis/arquivos em português, como o código existente.
- **Segurança primeiro:** toda tabela nova com RLS + políticas; usar `is_admin()` / `is_parceiro_aprovado()`; nunca service role no front; nunca expor `drive_url`/`unidades` a anon.
- Nova coluna/tabela → nova migration em `supabase/migrations/` (não editar migrations já aplicadas) + atualizar `src/lib/types.ts`.
- **Grants explícitos:** o schema public não concede nada automaticamente (ver `..._grants_e_ajustes.sql`). Tabela nova → `grant` para `authenticated`/`service_role` (e `anon` só se for conteúdo público) na mesma migration; função usada em política → `grant execute`.
- Testar migration antes de subir: `supabase db start` / `supabase db reset --local`.
- Mídias: salvar **caminho relativo** do bucket; exibir com `midiaUrl()` ou `<Imagem>`.
- Formulários: react-hook-form + zod, componente `Campo`, máscaras de `format.ts`, feedback com `toast` (sonner).
- Estilo: **tema escuro**, fonte **Jost**. Usar tokens por papel — `ink` fundo, `ink-soft` superfície (cards/inputs/seções alternadas), `sand` preenchimento sutil, `line` borda, `stone` texto, `muted` texto secundário, `bronze` acento (texto `text-ink` sobre bronze), `sage` status ok — e utilitários (`btn-*`, `input`, `card`, `eyebrow`, `display`, `container-x`). Nada de cores soltas nem `bg-white`; destaque/aba ativa = `bg-stone text-ink`.
- **Cantos retos:** design retangular — não usar `rounded-*`, `border-radius` nem `rx` em nada (botões, cards, inputs, imagens, badges, e-mails). Exceção: ícones de marca (Instagram, YouTube).
- Não versionar: dump `.sql`, `uploads.zip`, `.env`.
- Rodar `npm run build` antes de dar uma tarefa como concluída.

## Próximas tarefas
Seguir a seção **10. Backlog** do PRD, na ordem.
