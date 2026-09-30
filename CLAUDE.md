# CLAUDE.md — Arken Incorporadora

Leia `docs/PRD.md` antes de qualquer tarefa. Desenho da expansão (rede, CRM, contratos, imóveis, governança): `docs/ARQUITETURA_EXPANSAO.md` — a **§10 prevalece**. Deploy no remoto: `docs/RUNBOOK_DEPLOY.md`. Mapeamento do site antigo: `docs/MAPEAMENTO_BAUENN.md`.
A Ocka deixou de existir: tudo é Arken. Fora de escopo: financeiro, Capital Humano, Frações.

## Stack
Vite 8 · React 19 · TypeScript 6 · Tailwind v4 (`@theme` + `@utility` em `src/index.css`, sem tailwind.config) ·
React Router 7 · TanStack Query 5 · react-hook-form + zod 4 · Supabase (Auth, Postgres/RLS, Storage, Edge Functions Deno) · lucide-react · sonner.

## Comandos
- Testes: `npm test` (Vitest: `src/**`, `supabase/functions/**` e `scripts/**`) · `npm run test:e2e` (Playwright, `e2e/`, rede do Supabase simulada — não grava no banco; `E2E_PORTA`, padrão 5190, isola execuções em paralelo) · `npm run test:db` (pgTAP em `supabase/tests/`)
- **Banco isolado** (preferir a `supabase db start` na pasta do repositório): `bash scripts/testar-db.sh <nome> <porta> "<prefixos extras>" "<testes>" [so-aplicar|parar]` — base = migrations até `BASE_ATE` (padrão `20260929000009`); todas: `BASE_ATE=20260929999999 bash scripts/testar-db.sh x 54852 "" todos`. Um banco por vez; derrube ao final (`… parar` ou `PARAR_AO_FINAL=1`). Leia o cabeçalho do script.
- **Stack real** (GoTrue, Storage, Edge Functions de verdade, sem simular rede): `e2e-real/` (config própria, fora do `npm run test:e2e`): `npx playwright test -c e2e-real/playwright.config.ts`, exige a stack Supabase local completa e o `.env.stack.local` (a guarda aborta chamadas a `*.supabase.co`).
- `npm run dev` · `npm run build` (tsc -b + vite build + `scripts/gerar-seo.mjs`: HTML por página pública, imagens OG, sitemap — lê o Supabase com as chaves `VITE_*`) · `npm run typecheck` · `npm run lint` (oxlint)
- `npm run conferir:dist` — obrigatório antes de enviar `dist/`: reprova chave de TESTE do Turnstile, falta de chave real e segredo no bundle. Build de produção com `.env.production.local` (chave real); `.env.development.local` (atalhos `VITE_DEV_*`) vale só no `npm run dev`. Nenhum dos dois é versionado.
- SEO: página pública nova → entrada em `src/content/seo.json` (título/descrição) — vale para o `<head>` no SPA e para o HTML pré-renderizado.
- `npm run midias:upload` — converte para WebP (≤ 1920 px, q80, via `sharp`) e envia as imagens do `uploads.zip` ao Storage; o seed já aponta para `.webp` (precisa `SUPABASE_SERVICE_ROLE_KEY` = secret key `sb_secret_...` e **Node 22+**, uso local)
- `python3 scripts/wp_to_supabase.py` — regenera `supabase/seed/seed_wordpress.sql` (precisa do dump num MariaDB local, banco `wp`)
- **Disco:** o C: cheio derrubou o Docker Desktop. Antes de subir banco ou stack, confira o espaço livre; derrube tudo ao terminar (`supabase stop --no-backup`); não deixe `dist`, `test-results`, `playwright-report`, traces nem dumps crescendo. Se o Docker parar de responder, não apague nada às cegas: pare e avise.

## Estrutura
- `src/pages/` — públicas; `parceiros/` (+ `painel/`); `cliente/`; `admin/` · `src/modulos/` — `rede`, `crm`, `contratos`, `imoveis`, `governanca`, `portal`, `config` (cada um com `tipos.ts` = formato do `jsonb` das RPCs)
- `src/components/` — layout, cards, galeria, estados (Carregando/Vazio/Erro), Campo, Protegido (guarda por papel); `components/app/` — kit do painel (Tabela, Modal, Abas, Filtros, Paginacao…)
- `src/lib/` — `supabase.ts`, `auth.tsx` (AuthProvider/useAuth), `escopo.tsx` e `menu.ts` (o que o usuário vê, vindo de `meu_escopo()`), `rpc.ts` (chamada de RPC e `urlDoDownload`), `erros.ts`, `provisorias.ts` (regras ⚑), `types.ts`, `constants.ts`, `format.ts` (BRL, CPF, CNPJ, telefone, WhatsApp), `midia.ts`
- `src/hooks/queries.ts` — queries compartilhadas
- `supabase/migrations/`, `supabase/seed/`, `supabase/tests/` (+ `_fixtures/rede.psql`), `supabase/functions/` (`_shared/` + uma pasta por função) · `scripts/migracao/` (`previa.sql`, `DEPLOY.md`)

## Regras
- **Toda UI em pt-BR.** Nomes de variáveis/arquivos em português, como o código existente.
- **Segurança primeiro:** toda tabela nova com RLS + políticas; usar `is_admin()` / `is_super()` / `is_parceiro_aprovado()`; nunca service role no front; nunca expor `drive_url`/`unidades` a anon.
- **Dado pessoal de cliente só por RPC** (`security definer`, `search_path` fixo), para todos os papéis, inclusive admin: nada de `SELECT` direto em `clientes`, `leads`, `propostas`, CRM, contratos ou `auditoria` (sem grant). A RPC aplica o escopo, grava `_auditar` e devolve nulo (com `acesso_negado`) fora do escopo. Tela nova de dado de cliente = RPC nova, com `grant execute` a `authenticated` e teste de escopo.
- **Escopo por helpers do banco**, nunca pelo papel, JWT ou front: `meu_parceiro_id()`, `meu_cliente_id()`, `pode_ver_cliente()`, `pode_ver_imovel()`, `tem_permissao()`, `is_*()`. Nas políticas, dentro de `(select …)`. Edge Function nunca decide permissão com a service role: chama a RPC com o JWT do usuário (`exigirUsuario`).
- **Mudança de status/etapa só por `_transicionar`** (confere `status_transicoes`, papel, motivo e validações, aplica os efeitos); histórico em `historico_status`, timeline por `_evento_cliente`, log por `_auditar` (só **nomes** de campos, nunca valor pessoal). Nunca `UPDATE` direto de etapa ou status.
- **Migrations:** nova coluna/tabela → nova migration em `supabase/migrations/` + atualizar `src/lib/types.ts` (e `tipos.ts` do módulo). **`20260929000001`–`19` estão no remoto (deploy de 29/09/2026): nunca editar migration aplicada**; correção vai em migration nova (número livre seguinte, `20260929000020`+), testada no banco isolado e no ensaio do `docs/RUNBOOK_DEPLOY.md`. Sem referência a objeto de migration posterior; assinaturas de RPC não mudam (só o corpo, com `create or replace`).
- **Grants explícitos:** o schema public não concede nada automaticamente (ver `..._grants_e_ajustes.sql`). Tabela nova → `grant` para `authenticated`/`service_role` (e `anon` só se for conteúdo público) na mesma migration; função usada em política → `grant execute`. RPC de sistema (chamada só por Edge Function) → só `service_role`.
- **Testes pgTAP** (`supabase/tests/*.test.sql`): `begin;` → `create extension if not exists pgtap with schema extensions;` → `\ir _fixtures/rede.psql` → `select plan(N);` → … → `finish` e `rollback`. A fixture (imobiliárias A e B, gerentes, corretores, clientes c1–c5, admin, super, inativo, bloqueado, titular do portal) insere como `postgres`, nunca por RPC de outro pacote; use `pg_temp.entrar('ca1a')` / `entrar_anon()` / `entrar_servico()` / `sair()` / `como(...)` / `erro('<sql>')` e `pg_temp.usuario|parceiro|cliente|imobiliaria`. Teste novo cobre o bug e falha sem a correção; **não enfraquecer teste**.
- Testar migration antes de subir: `scripts/testar-db.sh` (todas as migrations) e, para o remoto, o ensaio do `docs/RUNBOOK_DEPLOY.md`. Nunca `db push`, `functions deploy`, `secrets set` nem `config push` fora da ordem do runbook.
- Mídias: salvar **caminho relativo** do bucket; exibir com `midiaUrl()` ou `<Imagem>`. `crm-documentos` e `contratos` não têm leitura direta: baixar = RPC auditada (`crm_documento_baixar`, `contrato_baixar`, `portal_contrato_baixar`) + `urlDoDownload` (Edge `baixar-arquivo`); nunca `createSignedUrl` no navegador.
- Formulários: react-hook-form + zod, componente `Campo`, máscaras de `format.ts`, feedback com `toast` (sonner). Consultas com erro tratado (`Carregando`/`ErroConsulta`), nunca "vazio" por falha; excluir pede confirmação e confere o erro.
- Estilo: **tema escuro**, fonte **Jost**. Usar tokens por papel — `ink` fundo, `ink-soft` superfície (cards/inputs/seções alternadas), `sand` preenchimento sutil, `line` borda, `stone` texto, `muted` texto secundário, `bronze` acento (texto `text-ink` sobre bronze), `sage` status ok, `whatsapp` e `perigo` para os casos que têm token próprio — e utilitários (`btn-*`, `input`, `card`, `eyebrow`, `display`, `container-x`). Nada de cores soltas nem `bg-white`; destaque/aba ativa = `bg-stone text-ink`.
- **Cantos retos:** design retangular — não usar `rounded-*`, `border-radius` nem `rx` em nada (botões, cards, inputs, imagens, badges, e-mails). Exceção: ícones de marca (Instagram, YouTube). Há guarda estática em `e2e/interface.spec.ts`.
- Regra de negócio pendente vira padrão provisório configurável e entra em `src/lib/provisorias.ts` (⚑); pergunta sem resposta → caminho conservador, registrado no PRD §13.
- Não versionar: dump `.sql`, `uploads.zip`, `.env*`, `dist/`, `test-results/`. Nunca ler nem imprimir segredos.
- Rodar `npm run build` antes de dar uma tarefa como concluída (mais `npm test`, `npm run lint` e o que a tarefa tocar: pgTAP no banco isolado, E2E).

## Próximas tarefas
1. Pós-deploy da expansão (feito em 29/09/2026): definir o Super, resolver a pendência de migração, e o pós-go-live do `docs/RUNBOOK_DEPLOY.md` quando as pendências de negócio do PRD §13.1 saírem (D4Sign, vendedora, termo LGPD, Turnstile real, publicação na Hostinger).
2. Depois, o que sobrou da seção **10. Backlog** do PRD (importador do Notion, tour 360°, DNS do Resend) e a etapa financeira (PRD §13.4).
