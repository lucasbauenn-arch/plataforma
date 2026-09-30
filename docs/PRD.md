# PRD — Plataforma Arken Incorporadora

**Domínio:** arkenincorporadora.com.br · **Cliente:** Arken Incorporadora (rebrand da Bauenn Construtora) · **Agência:** Bracav Tech
**Status:** v1 (site, parceiros, portal, painel) mais a **expansão** (rede de parceiros, CRM, contratos com D4Sign, imóveis, governança e LGPD) construídas; falta o deploy da expansão no remoto (`docs/RUNBOOK_DEPLOY.md`) · **Última atualização:** 29/09/2026
**Documentos:** desenho da expansão em `docs/ARQUITETURA_EXPANSAO.md` (a §10 prevalece sobre o resto) · negócio de origem em `docs_new/*.md` · deploy em `docs/RUNBOOK_DEPLOY.md`. A Ocka deixou de existir: tudo é Arken, no mesmo app e no mesmo banco.

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

| Papel (`profiles.papel`) | Tipo | Quem | Acesso |
|---|---|---|---|
| Visitante | — | Comprador em potencial | Site público, formulário de contato, WhatsApp, pré-cadastro por link de indicação |
| `cliente` | Cliente final | Comprador com cadastro liberado | Portal do cliente (só CPF), só os próprios dados |
| `corretor` | Parceiro | Corretor da rede | Os próprios clientes, contratos e imóveis |
| `gerente` | Parceiro | Gerente de uma imobiliária | Os corretores da equipe e os clientes deles; os próprios clientes (A1) |
| `imobiliaria` | Parceiro | Usuário que representa a imobiliária | Toda a imobiliária |
| `parceiro` | Parceiro (transição) | Legado e autocadastro | Autocadastro aguardando aprovação, sem escopo. O legado aprovado vira `corretor` na cadeia da casa no corte |
| `admin` | Interno | Equipe Arken | Painel `/admin` com toda a operação; lê a auditoria (N20) |
| `super` | Interno | Dono da plataforma | Tudo do admin mais o que é crítico: configurações, parâmetros, modelos, signatários, transições, permissões, termos, notificações, papéis internos, anonimização, regularização de legado |
| `colaborador` | Interno | Previsto (A8/G1) | Nenhum acesso: tela "acesso ainda não liberado" |

Regras que valem para todos os papéis:
- **O escopo vem do banco, nunca do papel, do JWT ou do front.** A cadeia é imobiliária → gerente → corretor → cliente (tabela `parceiros`); só `status_parceiro = 'aprovado'` dá escopo. Quem está acima do usuário na cadeia não aparece para ele (PAR-3).
- `status_parceiro`: `pendente | aprovado | bloqueado | inativo`. `bloqueado` é temporário (perde o acesso e mantém a carteira); `inativo` é desligamento e exige transferir a carteira (N19).
- **Ninguém altera o próprio papel ou status.** A API não tem `UPDATE` em `profiles` (migration 17) e o trigger `protege_campos_profile` (v4) reverte papel, status, inativação, e-mail, CPF e id de qualquer chamada de `anon` ou `authenticated`. O papel só muda por `equipe_definir_papel` (Super); o status, só pelas RPCs da rede.
- **Cadeia da casa (A4):** Imobiliária Arken, Gerência Arken e Carteira Arken (virtuais, sem login). Parceiros legados, autocadastros aprovados sem imobiliária e clientes de origem interna ficam nela.
- **Super (N2):** nenhum admin vira Super automaticamente; o dono define o primeiro pelo SQL editor (runbook) e depois só o Super altera papéis internos.
- **2FA de internos (H5):** TOTP do Supabase; `is_admin()` e `is_super()` só exigem `aal2` quando `configuracao_geral.exigir_mfa_interno = true`, que começa desligado.

## 4. Escopo funcional

### 4.1 Site público
| Rota | Conteúdo |
|---|---|
| `/` | Hero carrossel (empreendimentos `destaque_home`), Lançamentos, Sobre + serviços, Obras em andamento, Pronto para morar, Breve lançamento, CTA parceiro, formulário de lead |
| `/empreendimentos` | Grid com filtro por estágio |
| `/empreendimentos/:slug` | Hero (nome, chamada, dorms, vagas, metragem, unidades, entrega, FGTS), descrição, ficha técnica, lazer (ícone + descrição), galeria por abas (fachada / área comum / plantas / decorado / obra) com lightbox, tour 360° (iframe), vídeos YouTube, localização (mapa, Waze, tabela de proximidades: distância, a pé, carro, transporte, bike), formulário de lead + WhatsApp |
| `/quem-somos`, `/portfolio` | Institucional; portfólio = estágio `portfolio` ou `pronto_para_morar` |
| `/termos-de-uso`, `/politica-de-privacidade`, `/politica-de-cookies` | Textos de `src/content/legal.json` (placeholder `{{RAZAO_SOCIAL}}`) |
| `/pre-cadastro/cliente/:codigo` | Pré-cadastro de cliente pelo link de indicação de um corretor: Turnstile, termo LGPD revisado (H4) e resposta idêntica para cadastro novo e duplicado. Fora do sitemap e `noindex` |
| Redirects | `/login-parceiros`, `/cadastro-parceiro`, `/portfolio-brasil`, `/empreendimento`, `/cliente` → rotas novas |

Estágios (`estagio_empreendimento`): futuro_lancamento, lancamento, obras_iniciadas, obras_aceleradas, em_construcao, pronto_para_morar, portfolio.

### 4.2 Área do parceiro (`/parceiros`)
- **Cadastro espontâneo** (`/parceiros/cadastro`, N18): nome, e-mail, telefone, **CPF e CRECI** (PAR-4, N8), imobiliária, senha, aceite de termos (o consentimento fica registrado) → confirmação de e-mail → `pendente`. A equipe aprova escolhendo imobiliária e gerente (padrão: a casa).
- **Convite** (`convidar-parceiros`): internos e, com a permissão da rede, imobiliária e gerente convidam por e-mail ou por link de senha de 24 h para WhatsApp (o link só aparece para internos por padrão; cada link gerado é auditado; a página `definir-senha` só consome o token no clique). E-mail já em uso resulta em `email_em_uso`, sem link.
- **Login / recuperar senha / nova senha / definir senha** (Supabase Auth, e-mail + senha, Turnstile).
- **Pendente, bloqueado ou inativo:** tela informativa, sem acesso a dados.
- **Painel** (`/parceiros/painel`): o menu sai das permissões do usuário (matriz `permissoes_rede`, editável pelo Super):
  1. **Empreendimentos** — cards; o modal traz a **tabela de unidades** (filtro "disponíveis") e **Baixar materiais** (link do Drive, só parceiros).
  2. **CRM** — funil (kanban), lista, novo cliente e ficha (§4.5).
  3. **Tarefas** — tarefas do CRM do usuário e da equipe, conforme o escopo.
  4. **Equipe** — imobiliária vê gerentes e corretores; gerente vê os corretores; cadastrar, editar, transferir clientes e corretores, inativar com destino, regularizar migrado.
  5. **Contratos** — os do escopo (§4.6). **Imóveis** — cadastro e acompanhamento (§4.7).
  6. **Propostas** — empreendimento*, cliente (opcional), texto*; as próprias propostas com status e resposta.
  7. **Links** — código de indicação e link de pré-cadastro. **Meu cadastro** — dados, CPF e CRECI (pedidos ao legado que ainda não tem).
- Corretor enxerga os próprios clientes; gerente, os da equipe e os dele (A1); imobiliária, toda a imobiliária. Duas pessoas não enxergam o cliente uma da outra, nem pela API.

### 4.3 Portal do cliente (`/portal-do-cliente`)
- Login **só com CPF** via Edge Function `cliente-login` (decisão do cliente em 21/09/2026, risco aceito — ver 12):
  `POST { cpf }` → `portal_localizar_cliente` (só cliente com `portal_liberado`, ativo e não anonimizado) → cria ou vincula a conta do Auth do cliente (e-mail interno `cliente-<id>@portal.arkenincorporadora.com.br`, nunca o e-mail real) → gera a sessão no servidor (link mágico gerado e consumido, sem e-mail) → `supabase.auth.setSession`.
- A conta do portal nasce com `app_metadata.portal_cliente_id`; uma conta do Auth que só tenha o e-mail interno (por exemplo, cadastrada por `signUp` público) nunca é adotada (403 mais auditoria `portal_conta_recusada`). A conta legada, criada pela versão antiga, é aceita e recebe o marcador no primeiro login.
- **Mitigações:** limite por IP como **reserva atômica** no banco (10 erros ou 30 tentativas em 15 min; IPv6 agrupado pela /64; sem IP conta no balde comum; teto global de 300 falhas ou 600 tentativas em 15 min), todo acesso em `portal_acessos` (IP, navegador, sucesso) e sessão encerrada após 8 h sem uso (H1, temporizador do front).
- `/portal-do-cliente/meus-imoveis`: boas-vindas, cards de negócios (empreendimento, unidade, valor), **andamento da obra** (barra % + timeline com fotos), **documentos** do cliente (bucket privado `cliente-arquivos`, download por URL assinada de 60 s), **documentos solicitados** do CRM (o titular só **envia**, não baixa; N1), **contratos** a partir de `assinatura_pendente` (`portal_contratos`, download por `portal_contrato_baixar` mais a Edge `baixar-arquivo`) e o corretor responsável. Notas, tarefas e timeline do CRM não aparecem.
- Quem faz pré-cadastro por link **não** ganha portal (N9); a liberação é manual, por um interno (`crm_liberar_portal`). PJ não entra (login por CPF).

### 4.4 Painel admin (`/admin`)
| Tela | Funções |
|---|---|
| Visão geral | Cartões de `painel_resumo` (empreendimentos, parceiros pendentes, propostas novas, leads, clientes, contratos e imóveis), respeitando o escopo de quem consulta |
| Relatórios | Cartões (leads no período, com variação vs. período anterior; propostas; parceiros pendentes; acessos ao portal), leads por mês (12 meses), por empreendimento e por origem, status das propostas, ranking de parceiros, estoque (disponível/reservada/vendida + VGV). Filtro 7/30/90 dias / 12 meses. Tudo em `public.relatorio()` (security invoker, checagem de admin) |
| Empreendimentos | Lista; criar; editor com abas **Dados**, **Galeria**, **Conteúdo** (lazer, ficha técnica, proximidades), **Unidades e materiais** (link Drive, CRUD de unidades, status inline, **importar espelho de vendas CSV** `unidade;metragem;valor;status`) e **Andamento da obra**. A importação **nunca apaga**: compara o arquivo com o cadastro pelo nome normalizado da unidade, atualiza só o que mudou, cria as novas, mantém as que não vieram no arquivo e pede confirmação com resumo; excluir unidade, mídia, item ou atualização também pede confirmação |
| Rede | Imobiliárias, parceiros, pendentes de aprovação, convites, transferência de carteira, inativação, regularização de legado |
| CRM | Funil, lista, novo cliente, ficha, tarefas e a fila de **Duplicidades** (§4.5) |
| Leads | Lista, converter em cliente, descartar, exportar CSV; só lead novo pode ser excluído (spam) |
| Propostas | Alterar status (enviada, em_analise, aprovada, recusada) + resposta ao parceiro |
| Clientes (portal) | Liberar o portal, vincular negócios, upload e remoção de documentos do portal |
| Contratos e Imóveis | Como no painel do parceiro, sem restrição de escopo (§4.6, §4.7) |
| Auditoria | Consulta filtrada; a própria leitura é registrada (`auditoria_consultar`) |
| Migração | Pendências do corte de dados, com decisão mínima de 5 caracteres para resolver (§6) |
| Segurança | Cadastro do TOTP (2FA) do próprio usuário |
| Configurações (Super) | Geral (`configuracao_geral`), Simulação, Modelos, Signatários, Transições, Permissões, Notificações, Termos LGPD, Equipe (papéis internos), Anonimização e o painel **Regras provisórias** (§13) |

### 4.5 CRM (`clientes`)
Uma pessoa é um registro (`clientes`, CPF ou CNPJ únicos). Todo acesso a dado pessoal é por RPC auditada: ninguém, inclusive admin, lê `clientes`, `leads`, `propostas`, CRM ou contratos por `SELECT`.
- **Funil:** Novo contato → Contato iniciado → Documentação → Finalizado, mais Perdido (motivo obrigatório; reativar volta a Novo contato). Transições, papéis e validações em `status_transicoes` (editável pelo Super). Voltar de etapa não é permitido por padrão. **Finalizado** exige contrato assinado e só acontece pelo sistema (N13). Entrar em Documentação cria as 4 solicitações de documento básico, sem duplicar.
- **Duplicidade (A2):** o primeiro cadastro é o dono, com exclusividade de 90 dias. Qualquer tentativa com documento existente é bloqueada com resposta genérica (`DOCUMENTO_INDISPONIVEL`), registrada e limitada por hora. Nunca há transferência automática; depois do prazo o caso entra na fila do admin.
- **Ficha:** dados, afiliados (só níveis iguais ou abaixo), portal, propostas, contratos, timeline automática, notas (somente inclusão), tarefas com responsável dentro do escopo e documentos (upload em bucket privado, tamanho e MIME lidos do Storage, análise por permissão da rede; download só por RPC auditada mais Edge).
- **Entradas:** cadastro interno (o gerente cadastra como corretor responsável, A1), pré-cadastro por link, conversão de lead do site e importação. **Transferir** exige motivo e mantém histórico de vínculos.
- **Consentimento:** `lgpd_termos` versionado e `lgpd_consentimentos`; sem versão revisada pelo jurídico, o pré-cadastro público responde 503 (H4).

### 4.6 Contratos e assinatura (D4Sign)
- Só existe **aquisição** (`tipo_contrato`), com **produto** exatamente igual a uma unidade de empreendimento Arken ou um imóvel. O **valor do contrato é o do produto, lido no servidor**: o front nunca envia valor calculado.
- **Simulação:** o SQL (`calcular_simulacao`) é a única fonte de verdade; o espelho em TS só faz a prévia e é testado contra os mesmos vetores. Planos parcelado e flexível; parâmetros (8,5%; 12 a 360 parcelas) e `valor_minimo_flex` configuráveis pelo Super (N14).
- **Modelo em marcação restrita** (sem HTML) → PDF com pdf-lib (`contrato-gerar`); modelos versionados, só liberados para envio depois de revisados pelo jurídico.
- **Ciclo:** rascunho → documentação pendente → em análise → assinatura pendente → assinado | recusado | expirado | cancelado. Cadeia (imobiliária, gerente, corretor) congelada no envio; valores imutáveis fora do rascunho. Um contrato ativo por produto; unidade `vendida` não contrata.
- **Assinatura:** `contrato-assinatura` (só internos, com `aal2` quando exigido) envia ao D4Sign; `d4sign-webhook` (público, validado por token e HMAC) só dispara a reconsulta; `d4sign-reconciliar` roda de hora em hora. O envio fica bloqueado até haver vendedora (N7), signatários (D3) e modelo liberado.
- **Ao assinar:** contrato `assinado`, PDF guardado, cliente vai a Finalizado e grava `eventos_dominio('contrato.assinado')`. As parcelas ficam para a etapa financeira. O imóvel vai a `no_contrato` no envio e volta a `aprovado` se o contrato for recusado, expirar ou for cancelado.

### 4.7 Imóveis (`imoveis`)
Imóveis de terceiros (casa, apartamento, terreno; o Super acrescenta tipos), separados dos empreendimentos Arken. Fluxo E2: rascunho → pendente → em revisão → aprovado (interno) → no contrato; em revisão volta a rascunho com observação obrigatória. Cadastram internos e parceiros aprovados; criador e internos editam em rascunho e pendente. Em rascunho, pendente e em revisão só veem o imóvel o criador, a cadeia acima dele e os internos; aprovado e no contrato, todos os parceiros aprovados e os internos. Fotos (até 20, redução no navegador) no bucket `imoveis`, com teto de objetos sem registro por usuário.

### 4.8 Governança, auditoria e LGPD
- **Auditoria** somente inclusão (`auditoria`): quem, o quê, quando, IP; só **nomes** de campos, nunca valor pessoal. Categorias: acesso, operação, configuração, segurança, integração e LGPD. Retenção de 24 meses para `acesso` e 60 para o resto (H3), purga mensal por pg_cron. Negações de acesso têm teto por ator (30 em 10 min, depois um registro-resumo).
- **Anonimização** a pedido do titular (`lgpd-anonimizar`, só Super): zera dados pessoais, troca o texto de notas, tarefas e descrições por marcador, apaga os arquivos do CRM e do portal no Storage e o usuário do portal; **mantém** contratos (valores e datas), vínculos, timeline e auditoria.
- **Notificações** (Resend): fila `notificacoes` com reenvio a cada 10 min; e-mails opcionais configuráveis (N10).
- **Downloads** de `crm-documentos` e `contratos` só por RPC que confere o escopo, grava a auditoria e a autorização; a Edge `baixar-arquivo` assina a URL só até o fim da autorização.

## 5. Modelo de dados (Supabase)

Migrations: as de 21/09 (`schema_inicial`, `grants_e_ajustes`, …, `20260923000001`) mais as da expansão (`20260929000001` a `…19`; ver `docs/ARQUITETURA_EXPANSAO.md` §8.1 e §10). Grants explícitos: nada é exposto automaticamente na Data API; `anon` só lê conteúdo público. As **01–09 já estão no remoto e nunca mais são editadas**; as **10–19** sobem no deploy (`docs/RUNBOOK_DEPLOY.md`).
Projeto Supabase: `xucwjsycawizrlouqkvh`.

| Grupo | Tabelas |
|---|---|
| Conteúdo e site | `profiles` (1:1 `auth.users`, criado por `handle_new_user`), `empreendimentos` (+ `wp_id`) → `empreendimento_midias`, `_lazer`, `_ficha`, `_proximidades`, `_materiais` (`drive_url`, só parceiros), `unidades` (só parceiros), `obra_atualizacoes`, `leads` |
| Rede | `imobiliarias`, `parceiros` (a cadeia; `profile_id` opcional), `parceiro_vinculos_historico`, `parceiro_status_historico` |
| CRM | `clientes` (estendida; CPF/CNPJ únicos), `cliente_negocios`, `cliente_arquivos` (portal), `cliente_notas`, `cliente_tarefas`, `cliente_eventos` (timeline), `cliente_documentos`, `cliente_documento_arquivos`, `cliente_vinculos_historico`, `cliente_duplicidades`, `propostas` |
| Contratos | `parametros_simulacao`, `contrato_modelos`, `contrato_signatario_regras`, `contratos`, `contrato_signatarios` |
| Imóveis | `imovel_tipos`, `imoveis`, `imovel_fotos` |
| Governança | `configuracao_geral` (linha única), `auditoria`, `historico_status`, `status_transicoes`, `permissoes_rede`, `eventos_dominio`/`eventos_consumo`, `notificacoes_config`/`notificacoes`, `integracao_eventos`/`integracao_chamadas`, `tentativas_publicas`, `download_autorizacoes`, `lgpd_termos`/`lgpd_consentimentos`, `portal_acessos` |
| Corte de dados | `migracao_decisoes`, `migracao_pendencias`, `migracao_parceiro_clientes`, `migracao_propostas` (mapas), `legado_parceiro_clientes` (arquivo sem acesso pela API) |

- **Storage:** `empreendimentos` (público; `wp/...` migrados, `emp/<id>/...` novos), `cliente-arquivos` (privado; `<cliente_id>/<arquivo>`), `crm-documentos` e `contratos` (privados, **sem política de leitura** para `authenticated`; download por RPC + Edge `baixar-arquivo`) e `imoveis`.
- **Helpers `security definer`:** `is_admin()`, `is_super()`, `is_parceiro_aprovado()`, `meu_papel()`, `meu_escopo()` e os de escopo (`meu_parceiro_id()`, `meu_cliente_id()`, `tem_permissao()`, …). Todos com `search_path` fixo; nas políticas, dentro de `(select …)`.
- **Dado pessoal de cliente só por RPC:** `authenticated` não tem grant em `clientes`, `leads`, `propostas`, CRM, contratos nem `auditoria`. Funções internas: `_transicionar` (única porta de mudança de status, com efeitos), `_auditar` e `_evento_cliente`. RPCs de sistema (`crm_pre_cadastro`, `portal_localizar_cliente`, `contrato_registrar_*`, `tentativas_reservar`, …) só para `service_role`.
- Dinheiro em `numeric(14,2)`, percentuais em `numeric(7,4)` (8.5000 = 8,5%). Inativar, nunca excluir; logs, timeline e consentimentos são somente inclusão.
- Mídias guardam **caminho relativo** ao bucket; o front resolve com `midiaUrl()` (`src/lib/midia.ts`).
- `relatorio(desde, até)`: função agregada da tela de relatórios (só admin; `security invoker`).
- `pg_cron` (migration 16): 5 tarefas `arken-*` (reconciliação D4Sign, fila de e-mails, purga da auditoria, limpeza de temporários, histórico do cron); dependem dos segredos no Vault.

## 6. Migração de dados

| Origem | Destino | Como | Status |
|---|---|---|---|
| WordPress `empreendimentos` + JetEngine meta (repeaters PHP serializados) | empreendimentos + filhas | `scripts/wp_to_supabase.py` → `supabase/seed/seed_wordpress.sql` (18 registros) | ✅ gerado e validado em Postgres local |
| `uploads.zip` (929 MB) | bucket `empreendimentos/wp/` | `npm run midias:upload` (só os 174 arquivos referenciados, convertidos para WebP ≤ 1920 px) | ✅ 174/174 enviados (175 MB → 15,5 MB), 0 faltando |
| Notion: Empreendimentos (Drive, MediaSite, Espelho de vendas CSV, Obras) | materiais, unidades, obra_atualizacoes | Export CSV do Notion → script de importação | ⏳ aguardando export |
| Notion: Clientes de parceiros (Name, Phone, RG, CPF, Contexto, IdParceiro, Interesses, Fase…) | `clientes` (CRM, `origem = 'importacao'`, mesma regra de duplicidade A2) | Export CSV; mapear `IdParceiro` (ID WP) → parceiro por e-mail | ⏳ |
| Notion: Propostas (Name, Negocio, IdParceiro, Detalhes) | propostas | Export CSV | ⏳ |
| `wp_users` parceiros | Auth + profiles | Convite por e-mail (senhas phpass não migram) | ⏳ |
| Formidable "Clientes" | clientes | Só 2 registros de teste — **não migrar** | ❌ |
| Parceiros do sistema atual (`profiles.papel = 'parceiro'` aprovados, bloqueados ou com clientes) | `parceiros` (corretor da casa, `migrado_legado`); papel passa a `corretor` | Migration 18 (`_migracao_corte`), lendo `migracao_decisoes`. Pendente com carteira entra `bloqueado`; CPF e CRECI faltantes viram pendência | ⏳ aplica no deploy, depois do `scripts/migracao/previa.sql` |
| `parceiro_clientes` (Supabase atual) | `clientes` (`origem = 'migracao_parceiro_clientes'`, etapa Novo contato, exclusividade de 90 dias a partir do cadastro original) | Migration 18; anotações viram notas; CPF que já existe (portal ou CRM) **não migra** e abre pendência; mesmo CPF no mesmo parceiro é juntado (divergência de nome ou RG abre `juntada_divergente`); a tabela vira `legado_parceiro_clientes`, sem acesso | ⏳ idem |
| Clientes do portal atuais e propostas | Ficam em `clientes` na Carteira Arken (nunca trocam de dono); propostas ganham `cliente_id` pelo mapa | Migration 18; etapa Finalizado se houver negócio, senão Novo contato; a fila de pendências fica em `/admin/migracao` | ⏳ idem |

## 7. Requisitos não funcionais
- **Segurança:** RLS em todas as tabelas; service role só em Edge Functions/scripts locais; nenhuma chave no front além da publishable; CPF armazenado só com dígitos; login do cliente só por CPF com limite por IP (reserva atômica) e auditoria em `portal_acessos`. Dado pessoal de cliente só por RPC auditada; escopo no servidor; `verify_jwt = false` nas Edge Functions com autenticação no próprio código; CSP e HSTS no `public/.htaccess`; `npm run conferir:dist` reprova o `dist/` com chave de teste ou segredo.
- **LGPD:** termos versionados e consentimento registrado (parceiro, pré-cadastro, cadastro declarado); aviso no formulário de lead; documentos de clientes em buckets privados com download auditado; auditoria sem valor pessoal e com retenção (24 e 60 meses); anonimização a pedido do titular; consentimentos dos clientes migrados em aberto (13.1, item 11).
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
   ✅ projeto `xucwjsycawizrlouqkvh`, migrations + seed aplicados, `cliente-login` no ar · ✅ Auth: site_url, redirects, OTP 6 dígitos/10 min em 22/09 (o `config.toml` da expansão passa a 10 dígitos e 24 h, aplicado no `config push` do deploy), senha ≥ 8 · ✅ SMTP do Resend + templates em pt-BR aplicados (`supabase config push`, 22/09/2026), `RESEND_API_KEY` salva em `supabase/.env` e como secret da função `notificar`. ⏳ Domínio `arkenincorporadora.com.br` cadastrado no Resend mas **ainda não verificado** — falta adicionar os registros DNS (ver 13). Até lá, o Resend recusa o envio (testado: 403 `domain is not verified`) e nenhum e-mail de parceiro (confirmação de cadastro, recuperação de senha, convite) chega.
2. **Mídias:** rodar `midias:upload`; conferir `scripts/midias-faltando.txt`. ✅ 174/174 no bucket em WebP (−91%), todos os caminhos do banco conferidos. Os PNG/JPG originais enviados antes da conversão continuam em `wp/` sem uso (podem ser apagados pelo dashboard).
3. **Importador Notion:** `scripts/import-notion.ts` lendo os CSVs exportados (clientes de parceiros, propostas, espelhos de vendas → unidades, obras).
4. **Convite de parceiros:** Edge Function `convidar-parceiros` (admin) que cria usuários a partir de lista e envia link de definição de senha; status `aprovado`.
   ✅ (hoje em Admin → Rede, e também para imobiliária e gerente com a permissão da rede) "Convidar parceiros": cola lista (nome; e-mail; telefone; CRECI; imobiliária), gera link de senha (24 h)
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
   ✅ `npm test` (Vitest: format, espelho de vendas, convites, SEO, simulação, contratos, Edge Functions; 599 testes na última rodada completa) · `npm run test:e2e` (Playwright com o Chrome da máquina,
   140 fluxos com rede simulada, dos 5 originais aos de CRM, contratos, imóveis, portal, permissões e migração; `E2E_PORTA` isola execuções paralelas)
   · `npm run test:db` (pgTAP, 18 arquivos em `supabase/tests/`, 2.144 asserções na última rodada completa, antes da migration 19; exige `supabase db start` ou o banco isolado de `scripts/testar-db.sh`, ver o cabeçalho de `scripts/testar-db.sh`).
   Corrigido no caminho: importação do espelho de vendas quebrava decimais com vírgula (`52,5`) — parser em `src/lib/espelho.ts`.
10. **Deploy:** roteiro completo, com a ordem segura e como reverter cada passo, em `docs/RUNBOOK_DEPLOY.md`. **Hostinger** (decidido em 21/09/2026): `npm run build` e envio de `dist/` para o `public_html` do domínio
    arkenincorporadora.com.br; redirects 301 de bauenn.com.br; variáveis `VITE_*` no build.

## 11. Escopo: o que entrou e o que ficou fora

**Entrou na expansão (WP0 a WP7), por decisão do usuário:**
- **Rede de parceiros:** imobiliária → gerente → corretor, cadeia da casa, convites, transferência, inativação, regularização de legado.
- **CRM:** clientes, funil, duplicidade, pré-cadastro por link, leads, propostas, documentos, notas, tarefas e timeline.
- **Contratos** de aquisição com simulação no servidor, PDF e assinatura pelo **D4Sign**.
- **Imóveis** de terceiros, com aprovação.
- **Governança e LGPD:** escopo no servidor, auditoria, consentimento, anonimização, 2FA de internos, configurações do Super, notificações e migração de dados.

**Continua fora:**
- **Financeiro:** lançamentos e parcelas (inclusive gerar parcelas ao assinar), Asaas, comissões, saldo, saques e painel financeiro. O modelo já deixa o gancho (cadeia congelada no contrato, `contrato.assinado` em `eventos_dominio`, histórico de vínculos).
- Capital Humano (o papel `colaborador` existe no enum, sem acesso), Frações (E1), Jurídico, Treinamento e Investimento.
- Super Agente, Agente de Negócios (construtora e captador) e Investidor (A5–A7); contrato de Investimento (D2) e assinatura de contrato de serviço de parceiro (D6, só há pré-visualização).
- Autocadastro de corretor ou imobiliária por link de indicação; acesso de PJ ao portal; portal do cliente com senha (o login segue só por CPF).
- Dados legados da Ocka: clientes, contratos e parcelas (N6, crítico para o financeiro).
- Blog, empreendimentos na Espanha (taxonomia sem itens), pagamentos.

## 12. Decisões tomadas
- **21/09/2026 — Hospedagem na Hostinger** (Apache/LiteSpeed): site estático em `public_html`, regras em `public/.htaccess`.
- **21/09/2026 — Portal do cliente com login só por CPF.** Alternativas apresentadas (CPF + código do admin via WhatsApp,
  CPF + e-mail, CPF + data de nascimento); o cliente escolheu só CPF. **Risco aceito:** quem souber o CPF de um cliente vê
  imóvel, valores e documentos dele (CPF não é segredo; LGPD). Mitigado com limite por IP e auditoria. Para endurecer depois,
  basta trocar a Edge Function `cliente-login` (a tabela de auditoria continua valendo). Com a expansão o portal passa a mostrar
  documentos solicitados e contratos (N1): **recomendação formal de endurecer (CPF + código) antes de ativar contratos no portal.**
- **28/09/2026 — A Ocka deixou de existir; tudo é Arken** (mesmo app, mesmo banco, mesma marca). O modelo de negócio dela entra no que está em `docs_new/`, sem o financeiro, Capital Humano e Frações.
- **28/09/2026 — Expandir, cortar e contrair num passo só.** Não há front novo no ar e o remoto só tem dados de teste; por isso a migração de dados e o fim do legado são uma migration (a 18). As **01–09 já estão no remoto** (backup e ensaio sobre uma cópia dos dados reais, feitos antes) e nunca mais são editadas; as 10–19 sobem no deploy.
- **Uma entidade de cliente** (`clientes`), no lugar de `parceiro_clientes`, cliente do portal, lead e cliente do CRM; o CPF único serve ao portal e à regra de duplicidade (A2).
- **Dado pessoal de cliente só por RPC auditada, para todos** (inclusive admin), a partir do corte. Leitura não dispara trigger; por isso o escopo e a auditoria ficam dentro da RPC.
- **O escopo vem do banco** (helpers escalares que conferem o status do parceiro a cada chamada), nunca do JWT nem do front; as Edge Functions nunca decidem permissão com a service role: chamam a RPC com o JWT do usuário.
- **Auditoria só com nomes de campos**, nunca valor pessoal, para a anonimização nunca precisar tocar no log imutável.
- **Download de documentos e contratos** por RPC auditada + Edge `baixar-arquivo`, que assina a URL só até o fim da autorização; os buckets não têm política de leitura para `authenticated`.
- **A simulação de contrato tem o SQL como única fonte de verdade**; o valor vem do produto, nunca do front. PDF por marcação restrita e pdf-lib (sem navegador nem DOM).
- **29/09/2026 — Limite por IP das rotas públicas como reserva atômica no banco** (`tentativas_reservar`, migration 19): a rajada simultânea do mesmo IP não passa mais pelo limite. Banco fora do ar ou sem a migration recusa com 503 (falha fechada).
- **29/09/2026 — Chave e secret do Turnstile de produção** são um par: o build de produção usa a chave real e `npm run conferir:dist` reprova o `dist/` com a chave de teste. A secret de teste nunca entra no ambiente de produção.
- **29/09/2026 — `otp_length = 10`** (código de e-mail do Auth, 10^10 combinações) e validade de 24 h mantida para os convites por WhatsApp. **CSP e HSTS** no `public/.htaccess`.
- **Regra provisória de aprovação de legado (WP7RN-01):** parceiro legado que nunca foi aprovado no histórico só é desbloqueado com CPF e CRECI preenchidos; parceiro `pendente` com carteira entra `bloqueado` (N19) e abre pendência.

## 13. Decisões em aberto

### 13.1 Pendências que bloqueiam o go-live desta etapa
Atualizado em 29/09/2026 (a numeração segue a §9.2 de `docs/ARQUITETURA_EXPANSAO.md`; como sair de cada uma está em `docs/RUNBOOK_DEPLOY.md`).

| # | Item | O que bloqueia | Situação |
|---|---|---|---|
| 1 | **H4:** texto de consentimento revisado pelo jurídico | Pré-cadastro público (a Edge responde 503) | Aberta. Existe a versão `0-provisória` com `revisado_juridico = false` |
| 2 | **N7:** razão social, CNPJ e endereço da Arken (vendedora) | Envio para assinatura; a Imobiliária Arken fica sem CNPJ | Aberta (a razão social também alimenta os textos legais, 13.5) |
| 3 | **Modelos de contrato** da Arken (Parcelado e Flexível) | Envio (sem `liberado_para_envio`) | Aberta. Os modelos semeados são provisórios |
| 4 | **D3:** signatários e e-mail do representante Arken | Envio, de propósito | Aberta |
| 5 | **N2:** quem é o Super | Configurações críticas | Definido pelo SQL editor no deploy (runbook); falta o nome do dono |
| 6 | **N14:** parâmetros de simulação da Arken e `valor_minimo_flex` | Plano flexível (o parcelado roda com a semente provisória) | Aberta |
| 7 | **Conta D4Sign** da Arken (sandbox e produção, cofre, token, chave, HMAC) | Assinatura | Aberta. O formato real do webhook e do `Content-Hmac` só se confirma no sandbox |
| 8 | **N1/N9:** reconfirmar o login só por CPF com o escopo ampliado | Liberar documentos e contratos no portal | Aberta (recomendação formal em 12) |
| 9 | **N15:** decisões da migração (conflitos de CPF, etapa dos clientes do portal, cadastros juntados com nome ou RG diferentes) a partir de `scripts/migracao/previa.sql` | O `db push` da 18 | Aberta. Estado do remoto na última conferência: 1 parceiro legado sem CPF e CRECI, 1 cliente do portal, 3 registros legados, 5 propostas, nenhum conflito |
| 10 | **DNS do Resend** e **chaves reais do Turnstile** (par chave de site + secret, hostnames restritos ao domínio) | E-mails e anti-spam de verdade | Aberta (ver 13.5) |
| 11 | **Base legal dos clientes migrados:** o corte não cria consentimento `migracao` (não fabrica aceite que não existiu) e as notas migradas podem ter dado pessoal digitado por parceiros | Uso dos dados antigos pelo CRM | Aberta, do jurídico (N12) |
| 12 | **Parceiro legado pendente com carteira** entra `bloqueado`; desbloquear exige CPF e CRECI (WP7RN-01) | Reativação desses parceiros | Confirmar com o negócio |
| 13 | **Plano do Supabase:** H1 (inatividade no Auth), H2 (bloqueio por conta) e backup diário com PITR dependem do plano; o `[auth]` remoto não foi lido antes do `config push` | Nada bloqueia; o diff do `config push` é a conferência | Confirmar |
| 14 | **Conferência na stack real** (Storage API, Edge Functions com GoTrue, hook de login, rajada do limite por IP, pgTAP completo com a 19) | Confiança do deploy, não o deploy em si | Aberta; foi interrompida por falta de espaço no disco C: (Docker) |
| 15 | **CSP e HSTS** do `public/.htaccess` no site real | Nada bloqueia; conferir o console depois do envio | Aberta |

### 13.2 Decisões provisórias (⚑) da expansão
Valem como padrão configurável até o negócio confirmar; o painel `/admin/configuracoes` mostra a lista ("Regras provisórias", `src/lib/provisorias.ts`) e cada campo editável leva o selo "Provisório (código)". Detalhe e onde configurar: `docs/ARQUITETURA_EXPANSAO.md` §1.1.

| Código | Padrão adotado |
|---|---|
| A1 | Gerente cadastra cliente e fica como corretor responsável |
| A2 | Uma pessoa, um registro; o primeiro cadastro é o dono, com exclusividade de 90 dias; qualquer duplicidade é bloqueada com resposta genérica; nunca há transferência automática |
| A3 | Um nível só de gerência |
| A4 | Corretor autônomo, legados e autocadastros ficam na Imobiliária Arken (da casa) |
| A5–A7 | Super Agente, Agente de Negócios (construtora e captador) e Investidor não são criados |
| A8 | `colaborador` só existe no enum, sem acesso |
| D1 | Status de contrato `rascunho` e `recusado`; nenhum dado da Ocka é importado |
| D2 | Só contrato de aquisição |
| D3 | Signatários pelo Super; representante Arken ativo sem e-mail (bloqueia o envio) |
| D4 | Sem prazo nem lembretes; `expirado` só se o D4Sign informar |
| D5 | Todos assinaram: contrato `assinado`, cliente Finalizado, evento gravado; parcelas ficam para o financeiro; imóvel vai a `no_contrato` no envio |
| D6 | Contrato de serviço de parceiro só em pré-visualização |
| E2 | Imóvel: rascunho → pendente → em revisão → aprovado (interno); em revisão volta a rascunho com observação; `no_contrato` no envio do contrato |
| E3 | Tipos de imóvel: casa, apartamento, terreno (o Super acrescenta) |
| E4 | Cadastram internos e parceiros aprovados; rascunho, pendente e em revisão só o criador, a cadeia acima e os internos veem; aprovado e no contrato, todos os parceiros |
| E5 | Sem os parâmetros sem significado nem "Chip" |
| F1 | Perdido com motivo; reativar volta a Novo contato; Finalizado é final |
| F2 | Entrar em Documentação cria 4 solicitações; Finalizado só por contrato assinado; voltar etapa só se o Super liberar |
| F3 | Timeline com a lista mínima da documentação mais propostas |
| F4 | Internos e parceiros com escopo analisam documento |
| H1 | Sessão encerra após 8 h sem uso (temporizador do front; no plano gratuito o Auth não faz) |
| H2 | Turnstile e limite por IP; bloqueio por conta exige plano pago |
| H3 | Retenção: acesso 24 meses, demais 60 |
| H4 | Termo `0-provisória` com `revisado_juridico = false`; o pré-cadastro só abre com versão revisada |
| H5 | TOTP para internos, começa desligado |

### 13.3 Pendências novas da junção com a Arken (N1–N20)
| # | Pergunta | Padrão provisório adotado |
|---|---|---|
| N1 | O portal só por CPF passa a expor dados de CRM | Mantido, com `portal_liberado`, envio sem download, contratos só a partir de `assinatura_pendente`, auditoria. **Recomendação: endurecer antes de ativar contratos** |
| N2 | Quais admins viram Super | Nenhum automático; SQL do runbook, depois `equipe_definir_papel` |
| N3 | Regularizar corretor migrado: os clientes vão junto? | `rede_regularizar_legado` exige escolher `p_levar_clientes`; só Super, só legado |
| N4 | Contrato vale para unidade Arken ou imóvel | Os dois; exatamente um produto |
| N5 | O status da unidade muda ao contratar | Não; só impede dois contratos ativos e contratar unidade `vendida` |
| N6 | Importar dados legados da Ocka | Fora desta etapa (crítico para o financeiro) |
| N7 | Razão social, CNPJ e endereço da Arken | Nulos; o envio fica bloqueado |
| N8 | Cadastro espontâneo de parceiro exige CPF e CRECI | Sim, no formulário |
| N9 | Pré-cadastro por link ganha portal | Não; liberação manual por interno |
| N10 | E-mails opcionais | Só boas-vindas do pré-cadastro e documento rejeitado |
| N11 | Importador do Notion grava no CRM | Sim, `origem = 'importacao'`, pela regra A2 |
| N12 | Base legal do consentimento declarado no cadastro interno | Registrado como `declarado` com quem registrou; precisa do jurídico |
| N13 | Finalizar cliente sem contrato no sistema | **Não.** Finalizado exige contrato assinado e não há tela para liberar (a validação é fixa; só se muda com alteração do sistema). Vale como caminho conservador |
| N14 | Parâmetros de simulação (8,5%; 12 a 360 parcelas) são da Ocka | Semente provisória; `valor_minimo_flex` nulo bloqueia o flexível |
| N15 | Migração: etapa dos clientes do portal e dono em conflito de CPF | Cliente do portal fica na casa (Finalizado se tiver negócio, senão Novo contato) e nunca troca de dono; CPF que já existe (portal ou CRM) não migra e abre pendência; entre parceiros o mais antigo é dono provisório; cadastros juntados com nome ou RG diferentes abrem `juntada_divergente`; tudo pode ser decidido em `migracao_decisoes` antes do corte |
| N16 | Preço negociado diferente do de tabela | Não suportado; o valor é o do produto |
| N17 | Base parcelada é `aporte − entrada` | Segue a fórmula FIN-1; `valor_restante` só informativo |
| N18 | Autocadastro de parceiro pelo site continua | Sim, sempre com aprovação |
| N19 | `bloqueado` × `inativo` | `bloqueado` temporário mantém a carteira; `inativo` exige transferência |
| N20 | Quem lê a auditoria | Admin e Super, por RPC que registra a leitura |

### 13.4 Perguntas para antes da etapa financeira
Comissões (B1–B5: percentuais, comissão do gerente, dentro ou além dos 8,5%, quando fica disponível, efeito da transferência; quem recebe pela Carteira Arken), saques (C1–C4, dados bancários e PIX), CTR-4 completo (vencimento, resíduo de arredondamento, correção, juros, mínimo por pagamento, distrato), status de pago único, parâmetros de juros, gateway (Asaas da Arken? rotação da chave vazada no legado) e N6 (importar clientes, contratos e parcelas da Ocka).

### 13.5 Outras pendências
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
