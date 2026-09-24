# PRD — Plataforma Arken Incorporadora

**Domínio:** arkenincorporadora.com.br · **Cliente:** Arken Incorporadora (rebrand da Bauenn Construtora) · **Agência:** Bracav Tech
**Status:** v1 em construção · **Última atualização:** 21/09/2026

---

## 1. Contexto

O site atual (bauenn.com.br) roda em WordPress 6.8 + Elementor Pro + JetEngine + Ultimate Member + Formidable Forms + Code Snippets.
A lógica de negócio está espalhada em ~12 snippets PHP e **os dados operacionais ficam no Notion** (clientes de parceiros,
propostas, espelhos de vendas, obras), acessados via API com uma chave embutida no WordPress.

Problemas do sistema atual:
- **Segurança:** o portal do cliente autentica só com CPF e passa o CPF na URL (`/cliente/?cpf=...`) — qualquer pessoa vê dados de terceiros.
- **Dados fragmentados:** WordPress (conteúdo) + Notion (operação) + Google Drive (materiais) + Formidable (clientes).
- **Manutenção:** layout e regras presos a Elementor/snippets; 14 atualizações pendentes; 36 comentários de spam.
- **Parceiros sem retorno:** propostas vão para o Notion e o corretor não acompanha status.

## 2. Objetivo

Substituir o WordPress + Notion por uma plataforma única **Vite + React + TypeScript + Tailwind v4 + Supabase**, com
**layout novo e as mesmas funcionalidades**, mais segurança e um painel administrativo próprio.

### Métricas de sucesso
- 100% das funcionalidades atuais cobertas (checklist na seção 9).
- ~~Portal do cliente sem acesso por CPF isolado~~ — revisto: login só por CPF por decisão do cliente (ver 12). Meta passa a ser: 100% dos acessos registrados e tentativas limitadas por IP.
- Lighthouse mobile ≥ 90 (Performance, Acessibilidade, SEO) nas páginas públicas.
- Equipe comercial deixa de usar o Notion para parceiros/propostas em até 30 dias após o go-live.

## 3. Personas e papéis

| Papel | Quem | Acesso |
|---|---|---|
| Visitante | Comprador em potencial | Site público, formulário de contato, WhatsApp |
| Parceiro | Corretor / imobiliária | Área do parceiro após **aprovação do admin** |
| Cliente | Comprador com contrato | Portal do cliente (só CPF) |
| Admin | Equipe Arken | Painel `/admin` completo |

Papel fica em `profiles.papel` (`admin | parceiro | cliente`). Parceiro tem `status_parceiro` (`pendente | aprovado | bloqueado`).
**Nunca** permitir que o usuário altere o próprio papel/status (trigger `protege_campos_profile`).

## 4. Escopo funcional

### 4.1 Site público
| Rota | Conteúdo |
|---|---|
| `/` | Hero carrossel (empreendimentos `destaque_home`), Lançamentos, Sobre + serviços, Obras em andamento, Pronto para morar, Breve lançamento, CTA parceiro, formulário de lead |
| `/empreendimentos` | Grid com filtro por estágio |
| `/empreendimentos/:slug` | Hero (nome, chamada, dorms, vagas, metragem, unidades, entrega, FGTS), descrição, ficha técnica, lazer (ícone + descrição), galeria por abas (fachada / área comum / plantas / decorado / obra) com lightbox, tour 360° (iframe), vídeos YouTube, localização (mapa, Waze, tabela de proximidades: distância, a pé, carro, transporte, bike), formulário de lead + WhatsApp |
| `/quem-somos`, `/portfolio` | Institucional; portfólio = estágio `portfolio` ou `pronto_para_morar` |
| `/termos-de-uso`, `/politica-de-privacidade`, `/politica-de-cookies` | Textos de `src/content/legal.json` (placeholder `{{RAZAO_SOCIAL}}`) |
| Redirects | `/login-parceiros`, `/cadastro-parceiro`, `/portfolio-brasil`, `/empreendimento`, `/cliente` → rotas novas |

Estágios (`estagio_empreendimento`): futuro_lancamento, lancamento, obras_iniciadas, obras_aceleradas, em_construcao, pronto_para_morar, portfolio.

### 4.2 Área do parceiro (`/parceiros`)
- **Cadastro** (`/parceiros/cadastro`): nome, e-mail, telefone, CRECI, imobiliária, senha, aceite de termos → confirmação de e-mail → status `pendente`.
- **Login / recuperar senha / nova senha** (Supabase Auth, e-mail + senha).
- **Pendente/bloqueado:** tela informativa, sem acesso a dados.
- **Painel** (`/parceiros/painel`), 3 abas:
  1. **Empreendimentos** — cards (nome, endereço, estágio, categoria, construtora, unidades). Clique abre modal com **tabela de unidades** (unidade, m², valor, status; filtro "disponíveis") e botão **Baixar materiais** (link Drive de `empreendimento_materiais`).
  2. **Meus clientes** — cadastrar cliente (nome*, RG, CPF com validação, telefone*, anotações, **interesses** agrupados — ver `INTERESSES` em `src/lib/constants.ts`); tabela com busca e remoção. Parceiro só vê os próprios.
  3. **Propostas** — empreendimento*, cliente (opcional), texto*; lista das próprias propostas com status e resposta do admin.

### 4.3 Portal do cliente (`/portal-do-cliente`)
- Login **só com CPF** via Edge Function `cliente-login` (decisão do cliente em 21/09/2026, risco aceito — ver 12):
  `POST { cpf }` → cria/vincula usuário Auth próprio do cliente (e-mail interno `cliente-<id>@portal.arkenincorporadora.com.br`,
  nunca o e-mail real, para um CPF jamais abrir conta de admin/parceiro) → gera a sessão no servidor (link mágico gerado e
  consumido, sem envio de e-mail) → `supabase.auth.setSession`. Só emite sessão para papel `cliente`.
- Mitigações: limite por IP (10 erros ou 30 tentativas / 15 min) e registro de toda tentativa em `portal_acessos` (IP, navegador, sucesso).
  E-mail do cliente passa a ser opcional.
- `/portal-do-cliente/meus-imoveis`: boas-vindas, cards de negócios (empreendimento, unidade, valor), **andamento da obra** (barra % + timeline com fotos de `obra_atualizacoes`), **documentos** (bucket privado `cliente-arquivos`, download por signed URL de 60 s).

### 4.4 Painel admin (`/admin`)
| Tela | Funções |
|---|---|
| Visão geral | Contadores: empreendimentos, parceiros pendentes, propostas novas, leads, clientes, clientes de parceiros |
| Relatórios | Cartões (leads no período, com variação vs. período anterior; propostas; parceiros pendentes; acessos ao portal), leads por mês (12 meses), por empreendimento e por origem, status das propostas, ranking de parceiros, estoque (disponível/reservada/vendida + VGV) por empreendimento. Filtro 7/30/90 dias / 12 meses. Tudo calculado no banco (`public.relatorio()`, security invoker + checagem de admin) — uma chamada, sem paginar a Data API. |
| Empreendimentos | Lista; criar; editor com abas **Dados** (todos os campos + capa + flags publicado/destaque/FGTS/portfólio), **Galeria** (upload por tipo, remover), **Conteúdo** (lazer, ficha técnica, proximidades), **Unidades e materiais** (link Drive, CRUD de unidades, status inline, **importar espelho de vendas CSV** `unidade;metragem;valor;status`), **Andamento da obra** (título, descrição, %, data, fotos) |
| Parceiros | Aprovar / bloquear; ver clientes de cada parceiro |
| Propostas | Alterar status (enviada, em_analise, aprovada, recusada) + resposta ao parceiro |
| Clientes (portal) | Criar (nome, CPF, e-mail opcional, telefone); vincular negócios; upload/remoção de documentos |
| Leads | Lista, link WhatsApp, exportar CSV |

## 5. Modelo de dados (Supabase)

Migrations: `supabase/migrations/20260921000001_schema_inicial.sql` + `20260921000002_grants_e_ajustes.sql`
(grants explícitos — nada exposto automaticamente na Data API; `anon` só lê conteúdo público e insere lead).
Projeto Supabase: `xucwjsycawizrlouqkvh`.

- `profiles` (1:1 `auth.users`, criado por trigger `handle_new_user`)
- `empreendimentos` (+ `wp_id` para rastrear origem) → `empreendimento_midias`, `empreendimento_lazer`, `empreendimento_ficha`, `empreendimento_proximidades`, `empreendimento_materiais` (drive_url, **só parceiros**), `unidades` (**só parceiros**), `obra_atualizacoes`
- `parceiro_clientes`, `propostas`
- `clientes` → `cliente_negocios`, `cliente_arquivos`
- `leads` (insert público, leitura admin)
- Storage: `empreendimentos` (público; `wp/...` migrados, `emp/<id>/...` novos) e `cliente-arquivos` (privado; `<cliente_id>/<arquivo>`)

Helpers `security definer`: `is_admin()`, `is_parceiro_aprovado()`, `meu_papel()`.
Mídias guardam **caminho relativo** ao bucket; o front resolve com `midiaUrl()` (`src/lib/midia.ts`).

- `relatorio(desde, até)`: função agregada para a tela de relatórios do admin (só admin; `security invoker`).

## 6. Migração de dados

| Origem | Destino | Como | Status |
|---|---|---|---|
| WordPress `empreendimentos` + JetEngine meta (repeaters PHP serializados) | empreendimentos + filhas | `scripts/wp_to_supabase.py` → `supabase/seed/seed_wordpress.sql` (18 registros) | ✅ gerado e validado em Postgres local |
| `uploads.zip` (929 MB) | bucket `empreendimentos/wp/` | `npm run midias:upload` (só os 174 arquivos referenciados, convertidos para WebP ≤ 1920 px) | ✅ 174/174 enviados (175 MB → 15,5 MB), 0 faltando |
| Notion: Empreendimentos (Drive, MediaSite, Espelho de vendas CSV, Obras) | materiais, unidades, obra_atualizacoes | Export CSV do Notion → script de importação | ⏳ aguardando export |
| Notion: Clientes de parceiros (Name, Phone, RG, CPF, Contexto, IdParceiro, Interesses, Fase…) | parceiro_clientes | Export CSV; mapear `IdParceiro` (ID WP) → novo profile por e-mail | ⏳ |
| Notion: Propostas (Name, Negocio, IdParceiro, Detalhes) | propostas | Export CSV | ⏳ |
| `wp_users` parceiros | Auth + profiles | Convite por e-mail (senhas phpass não migram) | ⏳ |
| Formidable "Clientes" | clientes | Só 2 registros de teste — **não migrar** | ❌ |

## 7. Requisitos não funcionais
- **Segurança:** RLS em todas as tabelas; service role só em Edge Functions/scripts locais; nenhuma chave no front além da publishable; CPF armazenado só com dígitos; login do cliente só por CPF com limite por IP e auditoria em `portal_acessos`.
- **LGPD:** aceite de termos no cadastro do parceiro; aviso no formulário de lead; documentos de clientes em bucket privado.
- **Performance:** rotas com `lazy()`; imagens `loading="lazy"`; cache 1 ano no storage; alvo LCP < 2,5 s em 4G.
- **SEO:** títulos/meta por página, sitemap e redirects 301 das URLs antigas no `public/.htaccess` (Hostinger).
- **Acessibilidade:** WCAG 2.1 AA — contraste, foco visível, `aria-label` em botões de ícone, navegação por teclado no lightbox.
- **Responsivo:** mobile-first, gutter 16 px, sem scroll horizontal.
- **Idioma:** pt-BR em toda a UI e mensagens de erro.

## 8. Design
Layout novo, **tema escuro** (como o site de referência). Tokens em `src/index.css` (`@theme`), por papel: ink `#0f1318` (fundo),
ink-soft `#171c23` (superfícies), sand (preenchimento sutil), line (bordas), stone `#f3eee6` (texto), muted (texto secundário),
bronze `#c27e4a` (acento; texto escuro por cima), sage (status positivo).
Tipografia: **Jost** em toda a plataforma (títulos e texto). **Cantos retos** em todo o layout (sem bordas arredondadas). Componentes utilitários: `btn-primary`, `btn-accent`, `btn-ghost`, `input`, `label`, `card`, `eyebrow`, `display`, `container-x`.
Logo atual é placeholder (`src/components/Logo.tsx`) — substituir pelo definitivo.

## 9. Checklist de paridade com o site atual
- [x] Home com carrossel e seções por status
- [x] Página de empreendimento (lazer, galerias, vídeo, localização, proximidades, Waze)
- [x] Quem somos, Portfólio, Termos, Privacidade, Cookies
- [x] Login / cadastro de parceiro
- [x] Cards de empreendimentos com tabela de unidades + link de materiais
- [x] Cadastro de clientes pelo parceiro com interesses
- [x] Tabela "meus clientes" do parceiro
- [x] Envio de propostas
- [x] Portal do cliente (dados do empreendimento, andamento, galeria de obra)
- [x] WhatsApp / telefone / e-mail
- [x] CAPTCHA — Cloudflare Turnstile no lead, cadastro, login e recuperação de senha (chaves de TESTE até a Arken criar as reais)
- [ ] Tour virtual 360° — o único tour em `uploads/tour-virtual/scena` é da **REM Construtora** (Scena Vila Romana); não publicado

## 10. Backlog / próximas entregas (ordem sugerida)
1. **Infra:** criar projeto Supabase (sa-east-1), aplicar migration + seed, deploy `cliente-login`, configurar SMTP próprio (Resend) e template do OTP em pt-BR.
   ✅ projeto `xucwjsycawizrlouqkvh`, migrations + seed aplicados, `cliente-login` no ar · ✅ Auth: site_url, redirects, OTP 6 dígitos/10 min, senha ≥ 8 · ✅ SMTP do Resend + templates em pt-BR aplicados (`supabase config push`, 22/09/2026), `RESEND_API_KEY` salva em `supabase/.env` e como secret da função `notificar`. ⏳ Domínio `arkenincorporadora.com.br` cadastrado no Resend mas **ainda não verificado** — falta adicionar os registros DNS (ver 13). Até lá, o Resend recusa o envio (testado: 403 `domain is not verified`) e nenhum e-mail de parceiro (confirmação de cadastro, recuperação de senha, convite) chega.
2. **Mídias:** rodar `midias:upload`; conferir `scripts/midias-faltando.txt`. ✅ 174/174 no bucket em WebP (−91%), todos os caminhos do banco conferidos. Os PNG/JPG originais enviados antes da conversão continuam em `wp/` sem uso (podem ser apagados pelo dashboard).
3. **Importador Notion:** `scripts/import-notion.ts` lendo os CSVs exportados (clientes de parceiros, propostas, espelhos de vendas → unidades, obras).
4. **Convite de parceiros:** Edge Function `convidar-parceiros` (admin) que cria usuários a partir de lista e envia link de definição de senha; status `aprovado`.
   ✅ Admin → Parceiros → "Convidar parceiros": cola lista (nome; e-mail; telefone; CRECI; imobiliária), gera link de senha (24 h)
   com botões WhatsApp/Copiar, ou envia por e-mail (exige SMTP). Função valida JWT + papel admin no código. Testado ponta a ponta.
5. **SEO:** `react-helmet-async` (title/description/OG por empreendimento), `sitemap.xml` gerado no build, `robots.txt`, JSON-LD `RealEstateListing`.
   ✅ Sem helmet (React 19): `<SeoRotas>`/`<Seo>` (`src/components/Seo.tsx`) atualizam o head na navegação; textos em `src/content/seo.json`.
   `scripts/gerar-seo.mjs` (roda no `npm run build`) pré-renderiza `<rota>.html` por página pública e por empreendimento
   (title, description, canonical, OG, JSON-LD `RealEstateListing`/`Organization`), gera `og/<slug>.jpg` 1200×630, `sitemap.xml`
   e `spa.html` (fallback `noindex`). `public/.htaccess` (Hostinger): URL limpa, fallback, HTTPS sem www, 301 do WordPress,
   cache e cabeçalhos de segurança — validado num Apache 2.4 em Docker. ⚠ Empreendimento novo/editado só entra no HTML
   estático no próximo build + upload (item 10).
   Pendência de dados: `bairro` vazio em todos (título sai "em São Paulo") e cidade errada em Mogi das Cruzes/São José dos Campos.
6. **Anti-spam:** Turnstile no lead e no cadastro de parceiro (validar em Edge Function antes do insert).
   ✅ Lead só pela Edge Function `enviar-lead` (valida Turnstile; insert direto revogado — migration 4). Cadastro/login/recuperação
   de parceiro com captcha nativo do Supabase Auth. ⏳ Trocar chaves de teste: `VITE_TURNSTILE_SITE_KEY` (build),
   `TURNSTILE_SECRET` (secret da função) e o segredo em Auth → Attack Protection.
7. **Notificações:** e-mail ao admin em novo parceiro/proposta/lead (Database Webhook → Edge Function); e-mail ao parceiro quando a proposta mudar de status.
   ✅ Gatilhos (migration 5, pg_net + Vault) → Edge Function `notificar` → API do Resend. Testado ponta a ponta (sem envio
   real). `RESEND_API_KEY` já é secret da função. ⏳ Domínio verificado no Resend (ver 13) e definir `NOTIFICAR_PARA` (ver 13).
8. **Tour 360°:** hospedar `tour-virtual/` em `public/tour/` ou bucket e preencher `tour_virtual_url`.
   ⚠ Bloqueado: o tour existente é da REM Construtora (Scena Vila Romana). Suporte pronto (campo no admin + iframe);
   com um tour da Arken, basta copiar para `public/tour/<nome>/` (sem os `tour_testingserver*`) e preencher a URL `/tour/<nome>/index.html`.
9. **Testes:** Vitest (utils: CPF, máscaras, parser de CSV) + Playwright (fluxos: lead, cadastro parceiro, proposta, login cliente com OTP mockado) + testes de RLS via SQL.
   ✅ `npm test` (Vitest, 31: format, espelho de vendas, convites, SEO) · `npm run test:e2e` (Playwright com o Chrome da máquina,
   5 fluxos com rede simulada: lead+Turnstile, cadastro de parceiro, login do cliente por CPF, CPF inválido, proposta)
   · `npm run test:db` (pgTAP, 39: 27 regras de acesso por papel + 12 da função `relatorio()`; exige `supabase db start`).
   Corrigido no caminho: importação do espelho de vendas quebrava decimais com vírgula (`52,5`) — parser em `src/lib/espelho.ts`.
10. **Deploy:** **Hostinger** (decidido em 21/09/2026): `npm run build` e envio de `dist/` para o `public_html` do domínio
    arkenincorporadora.com.br; redirects 301 de bauenn.com.br; variáveis `VITE_*` no build.

## 11. Fora de escopo (v1)
Blog, CRM completo (funil/fases do Notion), assinatura eletrônica (campos `assinatura`/`lista_assinadores` existiam no WP mas vazios), empreendimentos na Espanha (taxonomia existe sem itens), pagamentos.

## 12. Decisões tomadas
- **21/09/2026 — Hospedagem na Hostinger** (Apache/LiteSpeed): site estático em `public_html`, regras em `public/.htaccess`.
- **21/09/2026 — Portal do cliente com login só por CPF.** Alternativas apresentadas (CPF + código do admin via WhatsApp,
  CPF + e-mail, CPF + data de nascimento); o cliente escolheu só CPF. **Risco aceito:** quem souber o CPF de um cliente vê
  imóvel, valores e documentos dele (CPF não é segredo; LGPD). Mitigado com limite por IP e auditoria. Para endurecer depois,
  basta trocar a Edge Function `cliente-login` (a tabela de auditoria continua valendo).

## 13. Decisões em aberto
- Razão social e revisão jurídica dos textos legais.
- Manter sincronização com o Notion durante a transição ou corte direto?
- **DNS do Resend pendente** (bloqueia todo e-mail de parceiro e as notificações do item 7): adicionar em qualquer
  editor de zona DNS do domínio (Hostinger, se for onde o domínio está registrado/apontado):

  | Tipo | Nome | Valor | Prioridade |
  |---|---|---|---|
  | TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDC4u/vSnv0aiwCUQayCgKT4zJxkeyg3b1hXiW8EienAD9xjCTC9zua5QcnTCco35+TyW6wLDFUAd+xJn/o95lRLwGnH5AxQeY5yx0Yt0MnbjTvrLBaHv6xRy86d9S9bqws9/dPQmjsw5vzhlUgRSGIWkn6kt1rg+mxcArD9RQ3EwIDAQAB` | — |
  | MX | `send` | `feedback-smtp.sa-east-1.amazonses.com` | 10 |
  | TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
  | CNAME | `rsend` | `send.forge.rmta.net` | — |

  Depois de adicionar, a verificação no Resend costuma sair em minutos a poucas horas (propagação de DNS). Aviso
  quando conferir que ficou verificado.
- **Caixa de e-mail para receber as notificações do item 7** (`NOTIFICAR_PARA`): o padrão no código é
  `vendas@arkenincorporadora.com.br`, mas o domínio não tem MX configurado hoje — esse endereço não recebe e-mail.
  Definir o destino real (pode ser `vendas@...` depois de configurado, ou outro e-mail já em uso).
