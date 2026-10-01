# Arquitetura: expansão da Arken com o modelo de negócio Ocka (etapa 1, sem financeiro)

> **Fechamento, 29/09/2026:** o que a implementação mudou no desenho está na **§10.7** (numeração final das migrations, download por RPC + Edge, migração como foi feita, segurança do fechamento); o roteiro de publicação, em `docs/RUNBOOK_DEPLOY.md`.
> **Versão final, 28/09/2026.** Consolida as três propostas de arquitetura ("dados", que venceu, "segurança" e "produto") e corrige as falhas apontadas pelos juízes.
> **Base de leitura:** `CLAUDE.md`, `docs/PRD.md`, os 14 arquivos de `docs_new/`, as 7 migrations aplicadas (`20260921000001` a `20260923000001`), `src/lib/types.ts`, `src/lib/auth.tsx`, `src/App.tsx`, `src/components/Protegido.tsx`, as páginas de `admin/`, `parceiros/` e `cliente/`, as 4 Edge Functions, `supabase/config.toml`, `supabase/tests/*.sql` e `e2e/*`.
> **Nomenclatura:** onde a especificação diz "Ocka" (Equipe Ocka, Colaborador Ocka, imobiliária Ocka, Super padrão), este documento diz **Arken**. A Ocka deixa de existir: mesmo app, mesmo banco (projeto `xucwjsycawizrlouqkvh`), mesma marca.
> **Legenda:** **⚑** decisão provisória, que precisa ser sinalizada ao negócio · **[cfg: X]** valor editável pelo Super na tabela ou coluna X · **I** internos (`super`, `admin`) · **P** parceiros (`imobiliaria`, `gerente`, `corretor` e o legado `parceiro`) · **C** cliente do portal.

**Escopo desta etapa:**
1. autenticação, perfis, escopo no servidor, auditoria e LGPD;
2. Área de Parceiros;
3. CRM;
4. Contratos (simulação no servidor, PDF, D4Sign);
5. Imóveis.

**Fica para depois:**
- lançamentos e parcelas, inclusive a geração de parcelas ao assinar (CTR-4 parcial);
- Asaas, comissões, saldo, saques e painel financeiro;
- Capital Humano (o papel `colaborador` só fica previsto no enum);
- Frações (E1);
- Jurídico, Treinamento e Investimento;
- todas as seções "Ideias da documentação antiga".

---

## 0. O que mudou em relação às propostas (correções obrigatórias)

| Falha apontada | Correção neste documento | Onde |
|---|---|---|
| Convite por `type:recovery` para qualquer usuário existente permitia sequestrar uma conta | Link só para conta criada no próprio convite ou já vinculada **àquele** parceiro e que nunca entrou. E-mail já em uso resulta em `email_em_uso`, sem link. `rede_vincular_login` confere se o perfil é novo, foi convidado e nunca entrou. A página `definir-senha` só consome o token quando a pessoa clica. | §6.2 |
| `portal_liberado` com padrão `true` liberava o portal por CPF para leads migrados | O padrão passa a ser `false`. Só as linhas que já existem (compradores do portal) e o insert da tela antiga do admin (`origem='portal_admin'`) ficam `true`. `cliente-login` usa a RPC `portal_localizar_cliente`, que exige `portal_liberado`. | §3.4, §6.7 |
| A migração passava um comprador do portal para a carteira de um corretor | Clientes do portal **nunca trocam de dono** na migração. Conflito de CPF vira pendência para decisão interna (`migracao_decisoes`), revisada antes da janela com `scripts/migracao/previa.sql`. | §2.4 |
| Leitura de dado pessoal por admin (SELECT direto) não era auditada | A partir do corte, **ninguém** (parceiro, interno ou titular) tem grant em `clientes`, nas tabelas de CRM, em `contratos`, `leads` e `propostas`. Tudo passa por RPC auditada. A própria auditoria só é lida por `auditoria_consultar`, que também registra a leitura. | §4.2, §4.3 |
| `crm_verificar_documento` funcionava como oráculo de CPF | A RPC foi removida. A duplicidade só é checada dentro do cadastro, com resposta genérica `DOCUMENTO_INDISPONIVEL` (sem dono nem data), limite de bloqueios por hora [cfg] e trava consultiva contra corrida. | §4.4 |
| `db reset` quebrava: `is_admin` lia uma tabela criada depois; FKs apontavam para tabelas ainda inexistentes | Ordem nova (§8.1): `configuracao_geral` nasce em 02 e os helpers em 03; imóveis (05) vêm antes de contratos (07); as FKs `*.contrato_id` são criadas em 07. Regra: nenhuma referência a objeto de migration posterior. | §8.1 |
| Política de `propostas` por `parceiro_id = auth.uid()` sem conferir status | A leitura passa a exigir parceiro aprovado e segue a cadeia do cliente. A autoria só dá leitura quando não há `cliente_id`. Depois do corte, a leitura é só por RPC. | §4.2 |
| Contradição de grants (admin com SELECT × "sem grant") e Edge Functions que furavam o `aal2` | Grant zero nas tabelas de CRM para `authenticated`, inclusive admin. As Edge Functions nunca conferem papel com a service role: chamam RPC com o JWT do usuário (`is_admin`, `rede_pode_convidar`, `lgpd_anonimizar_cliente`), o que respeita o `aal2`. | §4.3, §6 |
| D5 dizia "imóvel NC ao assinar"; a tabela de transições fazia isso no envio | Escolha: **NC no envio para assinatura**, porque é quando o produto fica comprometido. Volta para AP se o contrato for recusado, expirar ou for cancelado. | §1.1 D5, §3.8 |
| Upload em `crm-documentos` sem helper `security definer` | Helper `pode_enviar_documento(name)` com `grant execute` para `authenticated`. | §4.3 |
| CPU da geração de PDF (pdfmake + html-to-pdfmake + deno-dom) | Modelo em **marcação restrita** (sem HTML), com analisador próprio e **pdf-lib**, sem DOM nem navegador headless. Prova de viabilidade no início do WP4. | §6.3 |
| Cascata da cadeia × trigger de imutabilidade do contrato (transferência falharia) | A cascata só atualiza contratos em `rascunho`, `documentacao_pendente` ou `em_analise`. A partir do envio, a cadeia fica congelada. | §3.6 |
| (produto) A2 "assumir", admin→super automático, big-bang, afiliados com nomes acima, portal para leads, valor do contrato vindo do front | Nada disso foi adotado. O valor do contrato vem sempre do produto. | §1, §3.6 |
| (segurança) `enable_signup=false` e remoção de `convidar-parceiros`; HMAC de CPF no log imutável; fixture `.sql` executada como teste | Nada disso foi adotado. Fluxos atuais mantidos; o log guarda só nomes de campos; fixture em `.psql` incluída por `\ir`. | §6.2, §5.1, §8.5 |

## Princípios que valem para o documento inteiro

1. **Expandir, cortar, contrair.** O site público, o painel atual, o portal por CPF, o `relatorio()` e as notificações não podem quebrar.
   - As migrations 01 a 16 são aditivas e podem ser aplicadas a qualquer momento com o front antigo no ar.
   - A migration de **corte** (17) é aplicada junto com o upload do `dist/` na Hostinger, que é manual e acontece em momento diferente do banco.
   - A de **contração** (18) vem semanas depois.
2. **Dado pessoal de cliente só por RPC, para todos, a partir do corte.** Leitura não dispara trigger. Por isso ficha, listas, kanban, documentos, contratos e exportações são funções `security definer` que aplicam o escopo e gravam auditoria. Tabelas sem dado pessoal de cliente (imóveis, configuração, `parceiros` sem CPF, `historico_status`) usam RLS direto.
3. **O escopo vem do banco, nunca do JWT nem do front.** Helpers escalares, envolvidos em `(select …)` nas políticas, são avaliados uma vez por consulta (initPlan) e conferem o status do parceiro a cada chamada.
4. **Dinheiro em `numeric(14,2)`, percentuais em `numeric(7,4)` na unidade "%"** (8.5000 = 8,5%). Nunca float nem texto (FIN-9).
5. **Inativar, nunca excluir.** Nenhuma tabela nova dá `DELETE` a `authenticated`. Logs, timeline, histórico, versões de configuração e consentimentos são somente inclusão.
6. **Pendente na doc não vira regra fixa.**
   - Com sugestão: vira padrão provisório configurável [cfg] e ⚑.
   - Sem sugestão: caminho mais conservador. Não construir, ou bloquear e mandar para decisão interna, sempre com ⚑.
7. **Migrations sem referência para frente.** Funções `language sql`, políticas, views e FKs só citam objetos já criados. As assinaturas de **todas** as RPCs nascem no WP0 (corpo provisório `raise 'nao_implementado'`), e cada pacote troca o corpo com `create or replace`, sem mudar nome, parâmetros nem retorno.

---

## 1. Decisões provisórias adotadas

### 1.1 Códigos da especificação (A1–I2)

| Código | Escolha adotada | Onde configura | Sinalização |
|---|---|---|---|
| **A1** Gerente cadastra cliente | Permitido. O gerente fica como corretor responsável (`clientes.corretor_id = gerente_id = id do gerente`). Não existe corretor virtual por gerente. | `permissoes_rede('gerente_como_corretor','gerente')` = true | ⚑ sugestão da doc |
| **A2** Duplicidade por CPF/CNPJ | Uma pessoa = um registro (`clientes.cpf` e `cnpj` únicos). O **primeiro cadastro é o dono**; a exclusividade é de 90 dias (`exclusividade_ate`). **Qualquer** tentativa com documento já existente é bloqueada, dentro ou fora do prazo, com resposta genérica e registro em `cliente_duplicidades`. Depois do prazo, o caso entra na fila "Duplicidades" do admin, que decide se transfere (pela RPC normal, com motivo). **Nunca há transferência automática.** Se for o mesmo dono, a resposta é "já está na sua carteira". | `configuracao_geral.exclusividade_dias` = 90; `duplicidade_bloqueios_hora` = 10 | ⚑ prazo e dono sugeridos; o pós-prazo é o caminho conservador |
| **A3** Níveis de gerência | Um nível só (corretor → `gerente_id`). `parceiro_vinculos_historico` já guarda a árvore com vigência; para crescer basta `gerentes_ids uuid[]` com índice GIN, sem refazer nada. | — | ⚑ |
| **A4** Corretor autônomo | **Imobiliária Arken (da casa)**, com gerente virtual "Gerência Arken" e corretor virtual "Carteira Arken", sem login. Parceiros legados, autocadastros aprovados sem imobiliária e cadastros sem indicador ficam nela. | `configuracao_geral.imobiliaria_casa_id / gerente_casa_id / corretor_casa_id` | ⚑ sugestão da doc |
| **A5** Super Agente | Não criado: nem papel, nem nível, nem modelo de contrato. | — | ⚑ decisão do negócio |
| **A6** Agente de Negócios | Vira só **Imobiliária**. Construtora e captador não entram. | — | ⚑ |
| **A7** Investidor | Não criado, nem o e-mail de investidor. | — | ⚑ |
| **A8** Perfil `C` | `colaborador` só existe no enum, sem acesso nenhum (tela "acesso ainda não liberado"). | — | ⚑ |
| B1–B5 Comissões | Fora desta etapa. O modelo fica preparado: cadeia congelada no contrato, histórico de vínculos com vigência, `eventos_dominio` (§3.11). | — | Bloqueia o financeiro |
| C1–C4 Saques | Fora desta etapa. | — | Bloqueia o financeiro |
| **D1** Status `R` | Dois valores: `rascunho` e `recusado`. Nenhum dado Ocka é importado (N6). | — | ⚑ |
| **D2** tipoContrato 2 | Só existe `tipo_contrato = 'aquisicao'`. Investimento, serviço, parceria e interno não são criados (acrescentar depois custa um `ADD VALUE`). | — | ⚑ |
| **D3** Signatários | Regras em `contrato_signatario_regras`. Semente: *cliente* e *representante Arken* ativo **sem e-mail**. O envio fica bloqueado até o Super preencher; nenhum e-mail no código. Testemunhas são opcionais (inativas na semente). | tabela `contrato_signatario_regras` | ⚑ bloqueia o primeiro envio, de propósito |
| **D4** Prazo e lembretes | Nenhum. `prazo_assinatura_dias` fica nulo e o status `expirado` só entra se o D4Sign informar. | `configuracao_geral.prazo_assinatura_dias` | ⚑ |
| **D5** Todos assinaram | Contrato vai a `assinado`, o PDF assinado é guardado, o cliente vai a `finalizado` (CTR-4, parte do funil) e é gravado `eventos_dominio('contrato.assinado')`. O imóvel **já estava** em `no_contrato` desde o envio. **As parcelas ficam para a etapa financeira**, que consumirá o evento, inclusive dos contratos assinados antes dela existir. Não se cria `cliente_negocios` automaticamente: o portal mostra o contrato pela RPC `portal_contratos`. | — | ⚑ CTR-4 parcial |
| **D6** Contrato de serviço de parceiro | Só pré-visualização (modelos `servico_corretor` e `servico_imobiliaria`), sem gravar e sem assinatura. | — | ⚑ |
| **E1** Frações | Não construído. | — | Bloqueado pela doc |
| **E2** Aprovação de imóvel | RA → PE (criador ou interno) → RE → AP (interno). RE → RA com observação obrigatória. AP → NC no envio do contrato; NC → AP se o contrato for recusado, expirar ou for cancelado. | `status_transicoes` | ⚑ proposta da doc |
| **E3** Tipos de imóvel | `imovel_tipos` com casa, apartamento, terreno. O Super acrescenta outros. | `imovel_tipos` | ⚑ |
| **E4** Quem cadastra, edita e vê | **Cadastram:** internos e parceiros aprovados; o cliente não. **Editam:** criador e internos em RA/PE; depois disso só internos; em NC o valor não muda (IMV-3). **Veem em RA/PE/RE:** o criador, a cadeia acima dele (gerente e imobiliária) e os internos. **Veem em AP/NC:** todos os parceiros aprovados e os internos. | `permissoes_rede('cadastrar_imovel', tipo)` | ⚑ hoje "todos veem todos" |
| **E5** Parâmetros sem significado e "Chip" | Não criados. | — | ⚑ |
| **F1** Perdido e reativar | NC, CI ou DO → `perdido` com motivo obrigatório; `perdido` → `novo_contato` (reativar). FI é final. | `status_transicoes` | ⚑ |
| **F2** Validações por etapa | Entrar em DO cria as 4 solicitações de documento básico (CRM-3), sem duplicar. FI exige contrato assinado e só acontece pelo sistema. Voltar de etapa não é permitido (o Super pode liberar em `status_transicoes`). | `status_transicoes`, `configuracao_geral.documentos_basicos` | ⚑ proposta da doc |
| **F3** Timeline automática | Lista mínima da doc: cadastro, etapa, nota, tarefa criada/concluída, documento solicitado/enviado/analisado, contrato gerado/enviado/assinado, transferência. Mais proposta enviada/respondida (recurso da Arken). Pagamento fica para o financeiro. | — | ⚑ |
| **F4** Quem analisa documento | Internos e parceiros com escopo sobre o cliente (a tabela de fluxos diz "Equipe/Corretor analisa"). | `permissoes_rede('analisar_documento', tipo)` | ⚑ |
| G1–G3 Capital Humano | Fora da etapa. | — | — |
| **H1** Inatividade | 8 h. Pelo Auth (`[auth.sessions] inactivity_timeout`) se o plano permitir; senão, um temporizador no front, que é controle fraco. | `configuracao_geral.sessao_inatividade_horas` | ⚑ depende do plano |
| **H2** Tentativas de login | Turnstile e limite por IP do Auth (já existem). O bloqueio por conta (5 tentativas / 15 min) exige o *Password Verification Hook*. | — | ⚑ atendido em parte, depende do plano |
| **H3** Retenção de logs | Categoria `acesso`: 24 meses. Demais: 60 meses. Purga mensal pelo pg_cron. | `configuracao_geral.retencao_*_meses` | ⚑ sugestão; 60 meses para o que a doc não classificou |
| **H4** Texto de consentimento | `lgpd_termos` versionado. A versão "0-provisória" usa o texto atual da política de privacidade, com `revisado_juridico=false`. O pré-cadastro público **não vai ao ar** sem uma versão revisada. | `lgpd_termos` | ⚑ bloqueia o go-live do pré-cadastro |
| **H5** 2FA para internos | TOTP do Supabase. `is_admin()`/`is_super()` exigem `aal2` quando a opção está ligada. Começa desligada; o runbook liga depois de os internos cadastrarem o TOTP. | `configuracao_geral.exigir_mfa_interno` | ⚑ |
| **I1 / I2** | Jurídico, Treinamento e Investimento não são construídos; nenhuma seção "Ideias" entra. | — | — |

**Como a sinalização aparece:**
- `src/lib/provisorias.ts` lista código, regra aplicada e onde configura;
- `/admin/configuracoes` mostra o painel "Regras provisórias" gerado dessa lista;
- cada campo configurável tem o selo "Provisório (código)";
- o WP7 acrescenta essas entradas no `docs/PRD.md §13`.

### 1.2 Pendências novas criadas pela junção com a Arken (N1–N20)

| # | Pergunta | Padrão provisório adotado |
|---|---|---|
| **N1** | O portal só por CPF passa a expor dados de CRM (documentos solicitados, contratos). Isso amplia o risco aceito em 21/09. | Decisão mantida, com mitigações: `portal_liberado` (padrão `false` fora do portal atual); o portal só **envia** documentos pessoais e não os baixa; contratos aparecem só a partir de `assinatura_pendente`; notas, tarefas e timeline ficam fora. PJ não entra (login por CPF). **Recomendação formal:** endurecer para CPF + código antes de ativar contratos no portal. |
| **N2** | Quais admins atuais viram Super? | **Nenhum automaticamente.** O dono roda um `update` documentado no runbook (§8.2). Depois disso, `equipe_definir_papel` (só o Super). |
| **N3** | Ao regularizar um corretor migrado (da casa para a imobiliária real), os clientes vão junto? | `rede_regularizar_legado` exige a escolha explícita `p_levar_clientes` (sem padrão), só para o Super e só para `migrado_legado`. É uma exceção declarada ao PAR-6. |
| **N4** | O contrato vale para unidades de empreendimentos Arken ou só para imóveis? | Os dois. O produto é exatamente um (`unidade_id` ou `imovel_id`). |
| **N5** | O status da unidade muda sozinho ao contratar? | Não; continua manual. Só se impede ter dois contratos ativos para a mesma unidade e contratar unidade `vendida`. |
| **N6** | Os dados legados da Ocka (clientes, contratos, parcelas no Asaas) serão importados? | Fora desta etapa. **Crítico para o financeiro.** |
| **N7** | Razão social, CNPJ e endereço da Arken como vendedora (já aberto no PRD §13). | `configuracao_geral.vendedora_*` nulos. O envio para assinatura fica bloqueado até preencher. |
| **N8** | O cadastro espontâneo de parceiro (`/parceiros/cadastro`) passa a exigir CPF e CRECI (PAR-4)? | Sim no formulário. A aprovação cria o corretor na cadeia escolhida (padrão: casa). |
| **N9** | Quem faz pré-cadastro por link ganha portal? | Não (`portal_libera_pre_cadastro = false`). Os documentos do CRM-3 são enviados pelo corretor ou pela equipe em nome do cliente, ou pelo portal depois de liberação manual por um interno. |
| **N10** | Quais e-mails opcionais ligar? | Só boas-vindas do pré-cadastro e documento rejeitado. [cfg: `notificacoes_config`] |
| **N11** | O importador do Notion (backlog 3 do PRD) grava no CRM? | Sim, em `clientes` com `origem='importacao'`, pela mesma regra A2. |
| **N12** | Qual a base legal do "consentimento declarado pelo parceiro ou pela equipe" no cadastro interno? | Registrado com `origem='declarado'` e `registrado_por`. Precisa do jurídico. |
| **N13** | Venda de unidade Arken sem contrato no sistema pode ir a FI manualmente? | Não por padrão. O Super pode liberar em `status_transicoes`. |
| **N14** | Os parâmetros de simulação (8,5%; 12 a 360 parcelas) são da Ocka. Valem para a Arken? | Semente provisória. `valor_minimo_flex` fica nulo, o que deixa o plano flexível bloqueado até configurar. |
| **N15** | Migração: etapa dos clientes atuais do portal e dono em conflitos de CPF. | Sem decisão registrada: cliente do portal fica na casa, em `finalizado` se tiver `cliente_negocios`, senão em `novo_contato`. Conflito entre parceiros: o cadastro mais antigo fica como dono provisório e o caso vai para a fila. Tudo pode ser sobrescrito por `migracao_decisoes` antes da janela. |
| **N16** | Preço negociado diferente do preço de tabela? | Não suportado. O valor do contrato é o do produto (`unidades.valor` ou `imoveis.valor`), lido no servidor. |
| **N17** | FIN-1: a base parcelada é `aporte − entrada` (fórmula do código legado), mas o módulo diz que "o restante" é financiado. | Segue a fórmula FIN-1. `valor_restante = valor − aporte` fica gravado só como informação. |
| **N18** | Autocadastro de parceiro pelo site continua (fluxos §1, "decidir se continua")? | Continua, porque já existe na Arken, sempre com aprovação interna. O autocadastro de corretor ou imobiliária **por link de indicação não é construído**. |
| **N19** | Parceiro `bloqueado` (recurso atual) × `inativo` (novo). | `bloqueado` é temporário: perde o acesso e mantém a carteira. `inativo` é desligamento e exige transferência. |
| **N20** | Quem lê a auditoria: só o Super ou também o Admin? | Admin e Super, pela RPC que registra a própria leitura. |

### 1.3 Conflitos com decisões já tomadas na Arken, e entre propostas

| Conflito | Resolução (e por quê, em uma linha) |
|---|---|
| Portal só por CPF (PRD §12) × SEG-1 (cliente com senha) | **Mantido.** O cliente não ganha senha e as funções novas do portal são limitadas (N1). Endurecer continua sendo "trocar só a `cliente-login`". |
| Parceiro "plano" aprovado pelo admin × hierarquia | O parceiro vira corretor. Legados e autocadastros aprovados entram na cadeia da casa (A4). O papel `parceiro` passa a significar "autocadastro aguardando aprovação" e é mantido no legado até a contração, porque o front no ar checa `'parceiro'`. |
| `/parceiros/cadastro` (Arken) × "imobiliária cadastrada pela Ocka" | O cadastro público continua, sempre com aprovação. Aprovar obriga escolher imobiliária e gerente (padrão: da casa). Não se adota `enable_signup=false` (proposta "segurança"): mudaria um fluxo em produção sem decisão do usuário. |
| `parceiro_clientes` × `clientes` (portal) × `leads` (site) × leads do CRM | **Uma entidade: `clientes`** (a tabela existente, estendida). O CPF único serve ao login do portal e à A2. `leads` continua como caixa de entrada anônima do site e é convertida em cliente. `parceiro_clientes` é migrada, fica só leitura e é renomeada na contração. |
| `empreendimentos`/`unidades` (site) × `imoveis` (Ocka) | Entidades separadas. O produto do contrato é exatamente um dos dois (`CHECK num_nonnulls = 1`), porque têm ciclos de vida diferentes (estoque de incorporação × aprovação de imóvel de terceiros). |
| `propostas` (Arken) × Ocka (sem propostas) | Mantidas. Ganham `cliente_id` e a cadeia, para ficarem visíveis na hierarquia. "Propostas com aprovação" continua fora (ideia antiga). |
| PRD §11 ("fora de escopo: CRM, assinatura, pagamentos") | CRM e assinatura entram por decisão do usuário; pagamentos continuam fora. O WP7 atualiza o PRD. |
| Telas atuais que excluem (leads, `cliente_negocios`, `cliente_arquivos`) × SEG-10 | Lead: exclusão só com `status='novo'` (spam). Negócios e arquivos do portal continuam como hoje: são conteúdo de exibição que a Arken gerencia, não histórico de CRM. ⚑ |
| `created_at`/`updated_at` atuais × `criado_em`/`criado_por` da doc | Tabelas atuais mantêm os nomes (renomear quebra o front no ar) e ganham `criado_por`/`atualizado_por`. Tabelas novas usam nomes em português. |
| MailerSend (Ocka) × Resend (Arken) | Fica o Resend, reaproveitando `notificar_evento()`, o Vault e a função `notificar`. |
| Imobiliária como organização ("dados") × autorreferência em `parceiros` ("produto") | **Organização** (`imobiliarias`): existe sem login (casa), pode ter vários usuários e o `imobiliaria_id` nos filhos é estável. |
| Admin → Super automático ("produto") × runbook ("dados") | **Runbook** (N2), para não dar configurações críticas, anonimização e auditoria a ninguém sem decisão. |
| Big-bang ("produto") × expandir/cortar/contrair ("dados") | **Expandir/cortar/contrair**, porque o front na Hostinger é publicado à mão e não sobe junto com o banco. |
| Simulação só em SQL ("segurança") × espelho em TS ("dados"/"produto") | **SQL é a única fonte de verdade.** Um espelho TS serve só para prévia instantânea rotulada "prévia". Os dois são testados contra o **mesmo arquivo de vetores**, e um teste falha se divergirem. |
| PDF com pdfmake + html-to-pdfmake + deno-dom × pdf-lib | **pdf-lib + marcação restrita própria**: a combinação mais leve para o limite de CPU das Edge Functions, sem DOM. |
| Dono das funções `arken_api` ("segurança") | Não adotado: no Supabase exige grants e políticas próprias e arrisca RPCs que "não veem nada". Fica o dono `postgres` com escopo explícito em cada RPC e o **teste de invariantes** da proposta "segurança". |
| HMAC de campos pessoais no log ("segurança") | Não adotado: o log guarda só os **nomes** dos campos. Nada a anonimizar no log imutável. |
| A2 "assumir" após o prazo ("produto") | Não adotado: bloqueia e manda para decisão interna. |
| Liberar portal ao entrar em DO ("segurança") | Não adotado: estenderia o login só por CPF a leads (N1, N9). |
| "Criar contrato exige etapa DO" ("produto") | Não adotado: não está na doc. |
| Reabrir contrato recusado ou cancelado ("produto") | Não adotado: cria-se um novo contrato e o antigo fica como histórico. |
| Aba Afiliados com nomes acima do usuário ("produto") | Não adotado: PAR-3 (quem está acima não é visível; matriz de area-parceiros §2). A aba mostra só os níveis iguais ou abaixo do usuário. |

---

## 2. Perfis e hierarquia

### 2.1 Enum `public.papel` final

Valores atuais `admin | parceiro | cliente`, mais os novos `super | imobiliaria | gerente | corretor | colaborador`. Os novos são criados na migration 01, **sozinha**: um valor acrescentado com `ALTER TYPE … ADD VALUE` só pode ser usado depois do commit, e o CLI aplica cada arquivo numa transação.

| Papel | Tipo | Escopo | Observação |
|---|---|---|---|
| `super` | Interno | Tudo, incluindo o que é crítico | "Crítico" ⚑: `configuracao_geral`, parâmetros, modelos, signatários, transições, permissões da rede, termos LGPD, notificações, papéis internos, anonimização, reatribuir cadeia entre imobiliárias, regularização de legado |
| `admin` | Interno | Toda a operação; lê a auditoria (N20) | `is_admin()` continua verdadeiro para `admin` e `super`, então as políticas atuais seguem valendo |
| `colaborador` | Interno | Nenhum | Previsto (A8/G1) |
| `imobiliaria` | Parceiro | Toda a imobiliária | Usuário que representa a organização (pode haver mais de um) |
| `gerente` | Parceiro | Seus corretores e os clientes deles; os próprios clientes pelo A1 | |
| `corretor` | Parceiro | Seus clientes | |
| `parceiro` | Parceiro (transição) | Legado: vira corretor da casa no corte, e o papel passa a `corretor` na contração. Depois disso, só autocadastro pendente, sem escopo. | O escopo **nunca** vem do papel: vem de `parceiros` |
| `cliente` | Cliente final | Próprios dados, pelo portal | Login só por CPF |

`status_parceiro` ganha **`inativo`** (desligamento, que exige transferência). Transições:
- `pendente → aprovado | bloqueado`;
- `aprovado ↔ bloqueado`;
- `aprovado | bloqueado → inativo` (só pela RPC de inativação);
- `inativo → aprovado` (só internos, pela RPC).

Só `aprovado` dá escopo.

### 2.2 Entidades da rede e cadeia de IDs

```
imobiliarias (organização, raiz: CNPJ + CRECI PJ)
 ├─ parceiros tipo 'imobiliaria'  (usuários da imobiliária; imobiliaria_id)
 └─ parceiros tipo 'gerente'      (imobiliaria_id)
      └─ parceiros tipo 'corretor' (imobiliaria_id, gerente_id)
           └─ clientes             (imobiliaria_id, gerente_id, corretor_id)
```

- **A verdade é o pai direto:** `parceiros.gerente_id` e `clientes.corretor_id`. As demais colunas da cadeia são **derivadas por trigger** (o que o cliente envia é ignorado) e **propagadas em cascata** quando o pai muda, na mesma transação (PAR-2, fluxos §5).
- `parceiros.profile_id` é opcional e único: o parceiro existe antes de aceitar o convite, e os virtuais da casa nunca têm login.
- **PAR-6** (corretor que muda de imobiliária não leva clientes): a RPC transfere a carteira antes e só depois move o corretor. A cascata não encontra cliente para mover.
- Um usuário tem um perfil (perfis §3.5). O gerente que vende usa o A1, não um segundo papel.

### 2.3 Cadeia da casa (semeada na migration 04)

| Registro | Valores |
|---|---|
| `imobiliarias` "Imobiliária Arken" | `da_casa=true`; CNPJ e CRECI nulos (⚑ N7); índice único parcial garante uma casa só |
| `parceiros` "Gerência Arken" | `tipo='gerente'`, `virtual=true`, sem login |
| `parceiros` "Carteira Arken" | `tipo='corretor'`, `virtual=true`, `gerente_id` = Gerência Arken; tem `codigo_indicacao` (link próprio da Arken, equivalente ao "Super padrão") |
| `configuracao_geral` | Guarda os três ids |

Os internos atendem a carteira da casa porque `is_admin()` vê tudo. Corretores reais da Arken podem ser criados dentro da Imobiliária Arken.

### 2.4 Mapeamento dos dados atuais

As regras valem na migration indicada. Antes da janela, `scripts/migracao/previa.sql` (somente leitura) lista para o negócio:
- conflitos de CPF (portal × parceiro, parceiro × parceiro);
- CPFs inválidos;
- parceiros sem CPF ou CRECI;
- clientes do portal com e sem `cliente_negocios`.

As respostas entram em `migracao_decisoes` (§3.9) antes de aplicar o corte.

| Origem hoje | Destino | Regra |
|---|---|---|
| `profiles` com papel `admin` | Continuam `admin` | Promoção a `super` manual (N2) |
| `profiles` com papel `parceiro`, status `aprovado` ou `bloqueado`, ou com linhas em `parceiro_clientes` | **Corte (17):** linha em `parceiros` tipo `corretor` na cadeia da casa, `migrado_legado=true`, `profile_id` = o perfil; `profiles.imobiliaria` → `imobiliaria_declarada`; CRECI copiado | O papel continua `parceiro` até a **contração (18)**, que o troca para `corretor`. CPF e CRECI pendentes: a tela "Meu cadastro" pede para completar (PAR-4 só é exigida em cadastros e edições novos). |
| `profiles` com papel `parceiro` e status `pendente` | Não mudam | Aprovação por `rede_aprovar_autocadastro` (escolhe a cadeia; padrão: casa) |
| `clientes` atuais (portal) | **Migration 06:** ficam em `clientes` com `corretor_id` = Carteira Arken (cadeia por trigger), `origem='portal_admin'`, `portal_liberado=true`. **Corte (17):** etapa = `finalizado` se houver `cliente_negocios`, senão `novo_contato`, gravada em `historico_status` com `origem='migracao'` (⚑ N15, sobrescrevível por `migracao_decisoes`) | **Nunca trocam de dono na migração** |
| `parceiro_clientes` | **Corte:** `clientes` com `origem='migracao_parceiro_clientes'`, `etapa='novo_contato'`, `corretor_id` = parceiro correspondente, `portal_liberado=false`, `exclusividade_ate = created_at + exclusividade_dias`. `interesses` copiado; `anotacoes` vira a primeira linha de `cliente_notas` (autor = o parceiro, `migrado_legado=true`); `rg` copiado. Mapa em `migracao_parceiro_clientes (parceiro_cliente_id, cliente_id, resultado)`. | **CPF nulo:** migra com `cpf=null` (permitido só nessa origem). **CPF inválido (DV):** migra com `cpf=null`, o valor digitado vira nota e abre pendência `cpf_invalido`. **Mesmo CPF no mesmo parceiro:** junta num registro e as anotações viram notas. **Mesmo CPF de um cliente do portal:** **não migra**; a linha fica em `parceiro_clientes` (só leitura para o dono) e abre pendência `cpf_conflito_portal`. **Mesmo CPF em parceiros diferentes:** o mais antigo vira dono provisório (A2), os demais não migram e abre pendência `cpf_conflito_parceiros`. Em todos os casos, `migracao_decisoes` prevalece. |
| `cliente_negocios`, `cliente_arquivos` | Inalterados | Ganham `contrato_id` e `imovel_id` opcionais (migration 07) |
| `leads` (site) | Continuam em `leads` com `status='novo'` | Conversão por `leads_converter` |
| `propostas` | Mesma tabela. **Corte:** `cliente_id` pelo mapa; cadeia do cliente, ou do autor se não houver cliente | `parceiro_cliente_id` só é removido na contração |
| `portal_acessos` | Inalterado | Retenção de 24 meses (H3) |

Durante o corte não disparam notificações. Os triggers de fila conferem `current_setting('arken.migracao', true) = 'on'`, que o corte liga localmente. O corte grava uma linha de auditoria `migracao` com os totais e a lista de pendências abertas.

---

## 3. Esquema do banco

### 3.1 Convenções

- **Colunas de auditoria das tabelas novas:** `criado_em timestamptz not null default now()`, `criado_por`, `atualizado_em`, `atualizado_por`, `inativado_em timestamptz`, `inativado_por`, `motivo_inativacao text`. Todas as `*_por` são `uuid references public.profiles(id) on delete set null`, para que a anonimização (que apaga o usuário Auth do portal) não esbarre em FK.
- **Trigger `public.carimbar()`** (BEFORE INSERT/UPDATE, plpgsql):
  - no insert grava `criado_*` com `auth.uid()`;
  - no update impede alterar `criado_*` e grava `atualizado_*`;
  - `auth.uid()` continua sendo o de quem chamou, mesmo dentro de `security definer`.
- **Tabelas existentes** ganham `criado_por`/`atualizado_por` onde faz sentido (`clientes`, `leads`, `propostas`), mais `profiles.inativado_em/_por`, e mantêm `touch_updated_at`.
- **Funções:**
  - `set search_path = ''`, nomes qualificados;
  - `revoke execute … from public, anon`, com grant explícito na mesma migration;
  - funções internas têm prefixo `_` e **nenhum** grant a `authenticated`;
  - como a migration `…000002_grants_e_ajustes` revogou os privilégios padrão, **toda** tabela nova precisa de `grant` explícito, inclusive para `service_role`.
- **Validadores imutáveis** (usáveis em `CHECK`): `public.cpf_valido(text)` e `public.cnpj_valido(text)`, `language sql immutable`, espelhados em `src/lib/format.ts` (`cpfValido` já existe; entra `cnpjValido`).

### 3.2 Enums novos (migration 02, exceto `papel`/`status_parceiro`, que ficam na 01)

```sql
create type public.tipo_parceiro       as enum ('imobiliaria','gerente','corretor');
create type public.tipo_pessoa         as enum ('fisica','juridica');
create type public.genero              as enum ('masculino','feminino','outros');
create type public.estado_civil        as enum ('solteiro','casado','divorciado','viuvo','uniao_estavel'); -- ⚑ 'divorciado' falta na doc
create type public.etapa_funil         as enum ('novo_contato','contato_iniciado','documentacao','finalizado','perdido'); -- NC CI DO FI PE
create type public.origem_cliente      as enum ('cadastro_interno','pre_cadastro_link','lead_site','portal_admin',
                                                'migracao_parceiro_clientes','importacao');
create type public.status_lead         as enum ('novo','convertido','descartado');
create type public.status_tarefa       as enum ('pendente','concluida');                    -- P F ("atrasada" é calculada)
create type public.tipo_documento      as enum ('cliente','contrato');                      -- U C
create type public.status_documento    as enum ('pendente','em_analise','aprovado','rejeitado'); -- P EA A R
create type public.tipo_contrato       as enum ('aquisicao');                               -- D2
create type public.forma_pagamento     as enum ('parcelado','flexivel');
create type public.modelo_chave        as enum ('parcelado','flexivel','servico_corretor','servico_imobiliaria'); -- D6: serviço só prévia
create type public.status_contrato     as enum ('rascunho','documentacao_pendente','em_analise','assinatura_pendente',
                                                'assinado','recusado','expirado','cancelado','arquivado'); -- D1: sem "R"
create type public.papel_signatario    as enum ('cliente','representante_arken','corretor','testemunha');
create type public.status_assinatura   as enum ('pendente','assinado','recusado');
create type public.status_imovel       as enum ('rascunho','pendente','em_revisao','aprovado','no_contrato'); -- RA PE RE AP NC
create type public.categoria_auditoria as enum ('acesso','operacao','configuracao','seguranca','integracao','lgpd');
create type public.status_notificacao  as enum ('pendente','enviado','erro','ignorado');
```

Os códigos da doc (NC, CI, AP, …) e os rótulos em pt-BR ficam em `src/lib/constants.ts`, só para exibição e de-para com o legado, como já é feito com `ESTAGIOS`.

### 3.3 Tabelas novas: rede (migration 04)

```sql
create table public.imobiliarias (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) >= 2),
  razao_social text,
  cnpj text unique check (cnpj ~ '^\d{14}$' and public.cnpj_valido(cnpj)),
  creci_pj text, email text, telefone text,
  cep text check (cep ~ '^\d{8}$'), logradouro text, numero text, complemento text, bairro text, cidade text, uf char(2),
  da_casa boolean not null default false,
  -- colunas de auditoria (3.1)
  check (da_casa or (cnpj is not null and creci_pj is not null))                 -- PAR-4
);
create unique index imobiliarias_uma_casa on public.imobiliarias ((true)) where da_casa;

create table public.parceiros (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  tipo public.tipo_parceiro not null,
  imobiliaria_id uuid not null references public.imobiliarias(id),
  gerente_id uuid references public.parceiros(id),
  nome text not null,
  cpf text unique check (cpf ~ '^\d{11}$' and public.cpf_valido(cpf)),
  creci text, email text, telefone text,
  codigo_indicacao text unique check (codigo_indicacao ~ '^[a-z2-7]{10}$'),      -- aleatório (50 bits), nunca o id
  virtual boolean not null default false,
  migrado_legado boolean not null default false,
  imobiliaria_declarada text,                                                     -- texto livre do cadastro antigo
  -- colunas de auditoria (3.1)
  check ((tipo = 'corretor') = (gerente_id is not null)),
  check (gerente_id is distinct from id),
  check (virtual or migrado_legado or tipo = 'imobiliaria' or cpf is not null),   -- PAR-4 (gerente e corretor: CPF)
  check (tipo <> 'corretor' or virtual or migrado_legado or creci is not null),   -- PAR-4 (corretor: CRECI PF)
  check (not virtual or profile_id is null)
);
create index parceiros_imob_idx on public.parceiros (imobiliaria_id, tipo) where inativado_em is null;
create index parceiros_ger_idx  on public.parceiros (gerente_id)           where inativado_em is null;

alter table public.configuracao_geral                                            -- criada na 02, sem FK
  add constraint cg_imob_casa  foreign key (imobiliaria_casa_id) references public.imobiliarias(id),
  add constraint cg_ger_casa   foreign key (gerente_casa_id)     references public.parceiros(id),
  add constraint cg_cor_casa   foreign key (corretor_casa_id)    references public.parceiros(id);
```

**Triggers de `parceiros`:**
- `parceiros_valida_cadeia` (BEFORE):
  - `gerente_id` aponta para um parceiro `gerente`, ativo e da **mesma** imobiliária;
  - `tipo` não muda depois de criado;
  - a imobiliária de um gerente não muda (⚑, não especificado; para trocar, cria-se outro gerente).
- `parceiros_cascata_cadeia` (AFTER UPDATE OF `gerente_id`, `imobiliaria_id`, `inativado_em`):
  - atualiza a cadeia de `clientes`, `propostas` e `imoveis` (criador) onde `corretor_id = new.id`;
  - atualiza a cadeia dos contratos em `rascunho`, `documentacao_pendente` ou `em_analise`;
  - fecha e abre `parceiro_vinculos_historico`.
- `parceiros_sincroniza_profile`: copia `nome` e `telefone` para `profiles` (a saudação do painel usa `profiles.nome`).

**Tabelas de histórico** (somente inclusão, fechadas por `vigente_ate`):
- `parceiro_vinculos_historico` (`id bigint identity`, `parceiro_id`, `imobiliaria_id`, `gerente_id`, `vigente_de`, `vigente_ate`, `motivo`, `alterado_por`), com índice único `(parceiro_id) where vigente_ate is null`;
- `cliente_vinculos_historico`: mesma forma, com `cliente_id` e `corretor_id`. **É a base da regra B5 no financeiro** (§3.11).

**`permissoes_rede`** (migration 02): `acao text`, `tipo tipo_parceiro`, `permitido boolean`, `primary key (acao, tipo)`. A chave é o **tipo do parceiro** e não o papel do perfil, para que os legados `parceiro` (tipo `corretor`) herdem as permissões sem uma segunda fonte. Semente conforme area-parceiros §4:

| acao | imobiliaria | gerente | corretor |
|---|---|---|---|
| cadastrar_gerente | ✅ | ❌ | ❌ |
| cadastrar_corretor | ✅ | ✅ (vinculado a ele) | ❌ |
| cadastrar_cliente | ✅ (escolhe o corretor) | ✅ (escolhe o corretor) | ✅ (vinculado a si) |
| editar_subordinado / inativar_subordinado | ✅ | ✅ (só os seus corretores) | ❌ |
| transferir_corretor | ✅ | ❌ | ❌ |
| transferir_cliente | ✅ | ✅ (dentro da sua equipe) | ❌ |
| gerente_como_corretor (A1) | — | ✅ | — |
| convite_por_link (WhatsApp/copiar) ⚑ | ❌ | ❌ | — |
| criar_contrato ⚑ | ✅ | ✅ | ✅ |
| analisar_documento (F4) ⚑ | ✅ | ✅ | ✅ |
| cadastrar_imovel (E4) ⚑ | ✅ | ✅ | ✅ |

- O que está entre parênteses é regra fixa dentro das RPCs; a tabela só liga ou desliga a ação.
- Internos podem tudo, menos as ações exclusivas do Super.
- `convite_por_link` começa desligado para parceiros: quem gera o link pode definir a senha do convidado. Por padrão, gerente e imobiliária convidam só por e-mail; o link pelo WhatsApp fica com os internos.

### 3.4 Tabelas alteradas

**`clientes`**, o núcleo do CRM (migration 06, alterações aditivas):

```sql
alter table public.clientes
  alter column cpf drop not null,                                   -- o unique continua; a tela antiga sempre envia
  add column tipo_pessoa public.tipo_pessoa not null default 'fisica',
  add column cnpj text unique check (cnpj ~ '^\d{14}$' and public.cnpj_valido(cnpj)),
  add column sobrenome text, add column rg text, add column data_nascimento date,
  add column genero public.genero, add column estado_civil public.estado_civil, add column nacionalidade text,
  add column emails_adicionais text[] not null default '{}', add column telefones_adicionais text[] not null default '{}',
  add column horario_contato text,
  add column cep text check (cep ~ '^\d{8}$'), add column logradouro text, add column numero text,
  add column complemento text, add column bairro text, add column cidade text, add column uf char(2),
  add column pais text not null default 'Brasil',
  add column interesses text[] not null default '{}',              -- mesmas opções de INTERESSES
  add column imobiliaria_id uuid references public.imobiliarias(id),
  add column gerente_id uuid references public.parceiros(id),
  add column corretor_id uuid references public.parceiros(id),     -- NOT NULL a partir do corte
  add column etapa public.etapa_funil not null default 'novo_contato',
  add column etapa_desde timestamptz not null default now(),
  add column motivo_perda text,
  add column origem public.origem_cliente not null default 'portal_admin', -- a tela antiga do admin não envia origem
  add column exclusividade_ate timestamptz,
  add column portal_liberado boolean not null default true,        -- preenche as linhas atuais (todas são do portal)…
  add column criado_por uuid references public.profiles(id) on delete set null,
  add column atualizado_por uuid references public.profiles(id) on delete set null,
  add column inativado_em timestamptz, add column inativado_por uuid references public.profiles(id) on delete set null,
  add column motivo_inativacao text, add column anonimizado_em timestamptz,
  add constraint clientes_doc_por_pessoa check ((tipo_pessoa = 'fisica' and cnpj is null) or (tipo_pessoa = 'juridica' and cpf is null)),
  add constraint clientes_doc_obrigatorio check (cpf is not null or cnpj is not null
       or origem = 'migracao_parceiro_clientes' or anonimizado_em is not null),
  add constraint clientes_perda_motivo check (etapa <> 'perdido' or motivo_perda is not null);
alter table public.clientes alter column portal_liberado set default false;   -- …e o padrão de agora em diante é FALSE
create index clientes_corretor_idx on public.clientes (corretor_id, etapa)    where inativado_em is null;
create index clientes_gerente_idx  on public.clientes (gerente_id, etapa)     where inativado_em is null;
create index clientes_imob_idx     on public.clientes (imobiliaria_id, etapa) where inativado_em is null;
-- backfill neutro: clientes atuais (portal) na Carteira Arken; a cadeia vem pelo trigger
update public.clientes set corretor_id = (select corretor_casa_id from public.configuracao_geral) where corretor_id is null;
```

**Triggers de `clientes`:**
- `clientes_padroes` (BEFORE INSERT): se `origem = 'portal_admin'` (só o insert da tela antiga do admin, até a contração), então `portal_liberado := true`. As RPCs sempre enviam `origem` explícita e `portal_liberado=false`.
- `clientes_cadeia` (BEFORE INSERT/UPDATE OF `corretor_id`):
  - se `corretor_id` vier nulo, usa a Carteira Arken, o que mantém funcionando o insert da tela antiga;
  - o corretor precisa ser `corretor`, ou `gerente` se `gerente_como_corretor` estiver ligado;
  - deriva `gerente_id` e `imobiliaria_id` e descarta o que foi enviado.
- `clientes_vinculo_historico` (AFTER): fecha e abre `cliente_vinculos_historico` e propaga a cadeia para `propostas` e para os contratos ainda editáveis (§3.6).
- `auditar_linha('cpf,cnpj,rg,email,telefone,nome,sobrenome,…')` (AFTER INSERT/UPDATE):
  - registra só quando `current_user <> 'postgres'`, ou seja, gravações diretas pela API (tela antiga) ou pela service role;
  - dentro de uma RPC `security definer` o `current_user` é `postgres` e a própria RPC audita;
  - guarda **só os nomes** das colunas pessoais alteradas.

**Grants de `clientes` na migration 06** (a tela antiga só usa essas colunas):

```sql
revoke insert, update, delete on public.clientes from authenticated;
grant insert (nome, cpf, email, telefone), update (nome, cpf, email, telefone) on public.clientes to authenticated;
```

`corretor_id` e a cadeia só mudam por RPC, auditada e com motivo. O `select` fica até o corte (§4.3).

**`leads`:** `+ status status_lead not null default 'novo'`, `+ cliente_id uuid references clientes`, `+ tratado_por`, `+ tratado_em`, `+ motivo_descarte`. A política de exclusão passa a exigir `status = 'novo'`.

**`propostas`:** `+ cliente_id uuid references clientes`, `+ imobiliaria_id`, `+ gerente_id`, `+ corretor_id` (anuláveis durante a transição), `+ atualizado_por`. O trigger `propostas_cadeia` (BEFORE INSERT/UPDATE OF `cliente_id`) usa a cadeia do cliente, ou do parceiro autor (`parceiros.profile_id = parceiro_id`) quando não há cliente, e confere que `cliente_id` está no escopo do autor.

**`cliente_negocios`:** `+ contrato_id uuid references contratos`, `+ imovel_id uuid references imoveis` (migration 07, depois que as duas tabelas existem).

**`profiles`:** `+ inativado_em`, `+ inativado_por`. O trigger `protege_campos_profile` v3 vale para quem chama pela API (`current_user in ('anon','authenticated')`):
- `papel` só muda se o chamador for Super **e** a troca for entre papéis internos (`admin`, `super`, `colaborador`);
- `status_parceiro` só muda se o chamador for admin, e nunca de ou para `inativo`;
- `inativado_*` nunca muda.

A reversão continua silenciosa, que é o que `rls.test.sql` espera. Dentro das RPCs (`current_user = postgres`) e na service role a regra não se aplica; as RPCs fazem a própria checagem.

**`handle_new_user` v2:**
- continua criando o perfil `parceiro`/`pendente`;
- **nunca** lê papel, tipo ou cadeia de `raw_user_meta_data`;
- lê só `termo_id` e grava o consentimento se ele for o termo vigente de `termos_parceiro`. Se faltar, marca pendência e o painel pede o aceite por `lgpd_aceitar_termo`.

### 3.5 Tabelas novas: CRM (migration 06)

| Tabela | Colunas principais | Integridade e índices |
|---|---|---|
| `cliente_notas` | `id uuid`, `cliente_id` FK, `texto text` (1 a 10.000 caracteres após `btrim`), `autor_id` FK profiles, `criado_em`, `migrado_legado bool`, `removido_lgpd bool` | Somente inclusão (sem editar nem excluir); índice `(cliente_id, criado_em desc)` |
| `cliente_tarefas` | `id`, `cliente_id`, `titulo` (até 200), `descricao` (até 2.000), `responsavel_id` FK profiles, `prazo date`, `status status_tarefa`, `concluida_em`, `concluida_por` + auditoria | `check ((status='concluida') = (concluida_em is not null))`; índices `(responsavel_id, status, prazo)` e `(cliente_id, status)` |
| `cliente_documentos` | `id`, `cliente_id`, `tipo tipo_documento`, `nome`, `formatos_aceitos text[]` (subconjunto de `{jpeg,png,pdf,doc,planilha}`), `status status_documento`, `arquivo_atual_id`, `basico bool`, `analisado_em`, `analisado_por`, `motivo_rejeicao` + auditoria. `contrato_id` entra na 07. | `check (status <> 'rejeitado' or motivo_rejeicao is not null)`; único `(cliente_id, nome) where basico and inativado_em is null` (CRM-3 idempotente) |
| `cliente_documento_arquivos` | `id`, `documento_id`, `storage_path` (único), `mime_type`, `tamanho_bytes` (≤ `documento_max_bytes`), `sha256`, `enviado_em`, `enviado_por`, `removido_em` | Somente inclusão (todas as versões, inclusive rejeitadas). A única atualização é `removido_em`, feita pela anonimização. |
| `cliente_eventos` (timeline) | `id bigint identity`, `cliente_id`, `tipo text` (check na lista do F3), `ocorrido_em`, `ator_id`, `titulo` (**sem dado pessoal**, por exemplo "Documento solicitado: CNH"), `dados jsonb` (ids, etapas, motivo) | Somente inclusão; índice `(cliente_id, ocorrido_em desc)` |
| `cliente_duplicidades` | `id`, `cliente_id` (o que já existe), `tentado_por` (profile), `tentado_por_parceiro_id`, `origem`, `resultado` ∈ {`bloqueado_exclusividade`, `bloqueado_contrato`, `bloqueado_pos_prazo`, `mesmo_dono`}, `ocorrido_em`, `resolvido_em`, `resolvido_por`, `decisao` | **Não guarda o CPF de novo.** Índice `(tentado_por, ocorrido_em)` para o limite por hora. |

Tipos da timeline (`cliente_eventos.tipo`): `cadastro`, `pre_cadastro`, `etapa`, `nota`, `tarefa_criada`, `tarefa_concluida`, `documento_solicitado`, `documento_enviado`, `documento_analisado`, `contrato_gerado`, `contrato_enviado`, `contrato_assinado`, `contrato_encerrado`, `transferencia`, `proposta_enviada`, `proposta_respondida`, `consentimento`, `migracao`, `tentativa_duplicada`.

### 3.6 Tabelas novas: contratos e configuração de contratos (migration 07)

```sql
create table public.parametros_simulacao (            -- versionada, somente inclusão; vigente = maior vigente_desde <= now()
  id uuid primary key default gen_random_uuid(),
  vigente_desde timestamptz not null default now(),
  taxa_aporte_proprio numeric(7,4) not null check (taxa_aporte_proprio >= 0),  -- semente 8.5 ⚑ N14
  taxa_financeiro numeric(7,4), juros_ao_mes numeric(7,4), igpm_atual numeric(7,4), -- só guardados; fora do cálculo
  parcela_minima int not null check (parcela_minima >= 1),                     -- 12 ⚑
  parcela_maxima int not null check (parcela_maxima >= parcela_minima),         -- 360 ⚑
  valor_minimo numeric(14,2), valor_minimo_flex numeric(14,2),                  -- nulos; flexível bloqueado até configurar
  criado_em timestamptz not null default now(), criado_por uuid references public.profiles(id) on delete set null
);

create table public.contrato_modelos (                 -- versionada, somente inclusão
  id uuid primary key default gen_random_uuid(),
  chave public.modelo_chave not null,
  versao int not null, titulo text not null,
  conteudo text not null,                               -- marcação restrita "marcacao_v1" (§6.3), nunca HTML
  variaveis text[] not null,                            -- extraídas e validadas contra a lista permitida ao publicar
  revisado_juridico boolean not null default false,
  liberado_para_envio boolean not null default false,   -- só o Super libera; sem isso não há envio
  liberado_por uuid references public.profiles(id) on delete set null, liberado_em timestamptz,
  publicado_em timestamptz not null default now(), publicado_por uuid references public.profiles(id) on delete set null,
  unique (chave, versao)
);  -- vigente = maior versão da chave; a semente é um esqueleto "MODELO PROVISÓRIO" (os textos da Ocka não estão no repositório)

create table public.contrato_signatario_regras (
  id uuid primary key default gen_random_uuid(),
  modelo_chave public.modelo_chave not null, ordem smallint not null,
  papel public.papel_signatario not null,
  fonte text not null check (fonte in ('cliente','corretor_do_cliente','fixo')),
  nome text, email text, ato text not null default 'assinar' check (ato in ('assinar','testemunhar')),
  ativo boolean not null default true,
  check (fonte <> 'fixo' or nome is not null)           -- e-mail nulo em regra ativa bloqueia o envio (D3)
);

create table public.contratos (
  id uuid primary key default gen_random_uuid(),
  codigo bigint generated always as identity unique,     -- {{codigo}}; exibido como #0000123
  cliente_id uuid not null references public.clientes(id),
  tipo public.tipo_contrato not null default 'aquisicao',
  modelo_id uuid not null references public.contrato_modelos(id),     -- versão exata usada
  forma_pagamento public.forma_pagamento not null,
  status public.status_contrato not null default 'rascunho',
  unidade_id uuid references public.unidades(id),
  imovel_id  uuid references public.imoveis(id),
  -- simulação: sempre gravada pelo servidor (FIN-1/FIN-2, SEG-4); valor_imovel = valor do produto (N16)
  parametros_id uuid not null references public.parametros_simulacao(id),
  valor_imovel numeric(14,2) not null check (valor_imovel > 0),
  perc_aporte numeric(7,4) not null check (perc_aporte > 0 and perc_aporte <= 100),
  valor_aporte numeric(14,2) not null,
  valor_entrada numeric(14,2) not null default 0 check (valor_entrada >= 0),
  base_parcelada numeric(14,2) not null,                 -- valor × %aporte − entrada (FIN-1, ⚑ N17)
  valor_restante numeric(14,2) not null,                 -- valor − aporte (informativo)
  n_parcelas int, taxa_aporte numeric(7,4), valor_parcela numeric(14,2), valor_total_parcelas numeric(14,2),
  valor_minimo_flex numeric(14,2),
  -- cadeia: acompanha o cliente até o envio e congela a partir dele (base do B5)
  imobiliaria_id uuid references public.imobiliarias(id),
  gerente_id uuid references public.parceiros(id), corretor_id uuid references public.parceiros(id),
  -- documento e assinatura
  texto_sha256 text, pdf_path text, pdf_sha256 text, pdf_versao int not null default 0,
  pdf_gerado_em timestamptz, pdf_desatualizado boolean not null default true,
  pdf_assinado_path text, pdf_assinado_sha256 text,
  d4sign_uuid text unique, webhook_token_hash text, envio_lock_em timestamptz,
  enviado_assinatura_em timestamptz, enviado_por uuid references public.profiles(id) on delete set null,
  assinado_em timestamptz, encerrado_em timestamptz, observacao text,
  -- colunas de auditoria (3.1)
  check (num_nonnulls(unidade_id, imovel_id) = 1),
  check (valor_entrada <= valor_aporte),
  check (forma_pagamento <> 'parcelado' or (n_parcelas > 0 and valor_parcela is not null and taxa_aporte is not null)),
  check (forma_pagamento <> 'flexivel'  or valor_minimo_flex is not null)
);
create unique index contratos_unidade_ativa on public.contratos (unidade_id)
  where unidade_id is not null and status not in ('recusado','expirado','cancelado','arquivado');
create unique index contratos_imovel_ativo on public.contratos (imovel_id)
  where imovel_id is not null and status not in ('recusado','expirado','cancelado','arquivado');
create index contratos_cliente_idx on public.contratos (cliente_id);
create index contratos_status_idx  on public.contratos (status);

alter table public.cliente_documentos add column contrato_id uuid references public.contratos(id);
alter table public.cliente_negocios   add column contrato_id uuid references public.contratos(id),
                                      add column imovel_id uuid references public.imoveis(id);
```

**Trigger `contratos_imutavel`:**
- valores, `modelo_id`, produto, `cliente_id` e `forma_pagamento` só mudam com `old.status = 'rascunho'`, e qualquer mudança marca `pdf_desatualizado = true`;
- a cadeia só muda com `old.status in ('rascunho','documentacao_pendente','em_analise')`;
- a partir de `assinatura_pendente` tudo fica congelado, menos status, campos de assinatura e `encerrado_em`.

Com isso a cascata da transferência (§3.3) nunca colide com o congelamento.

`contrato_signatarios`: `id`, `contrato_id`, `ordem`, `papel`, `nome`, `email`, `ato`, `d4sign_chave`, `status status_assinatura`, `assinado_em`, `recusado_em`, `motivo`, `atualizado_em`. Chave única `(contrato_id, email)`.

**Cálculo (função `public.calcular_simulacao(...)`, `immutable`, única fonte de verdade):**
- `valor_aporte = round(valor × perc/100, 2)`;
- `base = valor_aporte − entrada`;
- `valor_parcela = round(base / n × (1 + taxa/100), 2)`, com arredondamento `numeric` (metade para longe do zero);
- `valor_total_parcelas = round(base × (1 + taxa/100), 2)`;
- o resíduo `total − parcela × n` fica registrado e vai para a última parcela na etapa financeira ⚑.

Validações:
- `n` entre mínima e máxima;
- entrada ≤ aporte;
- `valor ≥ valor_minimo` quando configurado;
- flexível exige `valor_minimo_flex`.

### 3.7 Tabelas novas: imóveis (migration 05)

- **`imovel_tipos`** (`codigo text pk`, `rotulo`, `ativo`): semente casa, apartamento, terreno (E3).
- **`imoveis`:**
  - `id`, `codigo bigint identity` (#0000007), `nome`, `matricula`, `tipo` FK `imovel_tipos`, `descricao`;
  - `status status_imovel default 'rascunho'`;
  - endereço: CEP, país, UF, cidade, bairro, logradouro, número, complemento;
  - `valor numeric(14,2) check (valor is null or valor > 0)`, `area_total numeric(10,2)`, `area_construida numeric(10,2)`, `idade_anos smallint`, `andar text`, `quartos`, `banheiros`, `suites`, `vagas smallint`;
  - `adicionais text[]` (subconjunto de {churrasqueira, ar_condicionado, perto_metro, perto_parque, perto_onibus, piscina, aceita_pet}; "Chip" fica fora pelo E5);
  - `observacao_revisao`;
  - `criado_por uuid not null default auth.uid()`, `criado_por_parceiro_id`, `imobiliaria_id`, `gerente_id` (cadeia do criador, derivada pelo trigger `imoveis_cadeia`; é o que permite a regra E4 de visibilidade para cima);
  - colunas de auditoria;
  - índices `(status)`, `(criado_por)`, `(imobiliaria_id)`, `(gerente_id)`.
- **IMV-2** (nome, tipo, CEP, logradouro, número, cidade, UF, valor > 0) é validado na transição RA → PE, **não** no insert: o rascunho pode ficar incompleto. A proposta "segurança" usava um `CHECK` condicionado ao status, que também serve; aqui fica na validação `campos_obrigatorios_imovel` para devolver a lista de campos faltando.
- **IMV-3:** o trigger `imoveis_valor_bloqueado` impede mudar `valor` em `no_contrato`.
- **`imovel_fotos`:** `id`, `imovel_id`, `storage_path`, `miniatura_path`, `ordem`, `largura`, `altura`, `bytes`, `criado_por`, `criado_em`.

### 3.8 Tabela de transições permitidas (migration 08)

```sql
create table public.status_transicoes (
  entidade text not null check (entidade in ('cliente_etapa','documento','contrato','imovel')),
  de text not null, para text not null,
  papeis public.papel[] not null default '{}',   -- quem aciona manualmente ('{}' = ninguém)
  permite_criador boolean not null default false, -- imóvel: o criador conta como autorizado
  sistema boolean not null default false,         -- automações (webhook, efeitos) podem acionar
  exige_motivo boolean not null default false,
  validacoes text[] not null default '{}' check (validacoes <@ array['contrato_assinado','campos_obrigatorios_imovel',
               'pdf_gerado','signatarios_configurados','vendedora_configurada','modelo_liberado','email_cliente',
               'valor_produto_atual','arquivo_enviado']),
  efeitos text[] not null default '{}' check (efeitos <@ array['solicitar_documentos_basicos','limpar_motivo_perda',
               'notificar_documento_rejeitado','imovel_no_contrato','imovel_aprovado','cliente_finalizado',
               'evento_contrato_assinado']),
  ativa boolean not null default true,
  atualizado_em timestamptz not null default now(), atualizado_por uuid references public.profiles(id) on delete set null,
  primary key (entidade, de, para)
);
```

- Um trigger valida `de`/`para` contra o enum da entidade.
- Validações e efeitos são uma **lista fechada**, executada por `CASE` em `_transicionar()`. Nunca há SQL dinâmico.
- O Super edita papéis, motivo e `ativa`; não cria validações ou efeitos novos.
- `historico_status` (`id bigint identity`, `entidade`, `entidade_id uuid`, `de`, `para`, `motivo`, `origem` ∈ {`usuario`,`sistema`,`webhook`,`migracao`}, `ator_id`, `ocorrido_em`) é somente inclusão e sem dado pessoal.

Nas tabelas abaixo: **P** = `corretor, gerente, imobiliaria, parceiro`; **I** = `admin, super`; **C** = `cliente`. Além do papel, a RPC sempre exige escopo sobre o registro.

**Funil (`cliente_etapa`)**

| de | para | papéis | sistema | motivo | validações e efeitos |
|---|---|---|---|---|---|
| novo_contato | contato_iniciado | P+I | | | |
| contato_iniciado | documentacao | P+I | | | efeito `solicitar_documentos_basicos` (CRM-3, F2) |
| novo_contato, contato_iniciado, documentacao (3 linhas) | perdido | P+I | | ✅ | F1 |
| perdido | novo_contato | P+I | | | efeito `limpar_motivo_perda` (reativar, F1) |
| novo_contato, contato_iniciado, documentacao, perdido (4 linhas) | finalizado | ∅ | ✅ | | validação `contrato_assinado` (F2, CTR-4) |

**Documento**

| de | para | papéis | sistema | motivo | validações e efeitos |
|---|---|---|---|---|---|
| pendente | em_analise | C+P+I | | | `arquivo_enviado` |
| rejeitado | em_analise | C+P+I | | | `arquivo_enviado` (reenvio) |
| em_analise | aprovado | P+I (F4 ⚑, conforme `permissoes_rede`) | | | |
| em_analise | rejeitado | P+I (idem) | | ✅ | `notificar_documento_rejeitado` |

**Contrato**

| de | para | papéis | sistema | motivo | validações e efeitos |
|---|---|---|---|---|---|
| rascunho | documentacao_pendente | P+I | | | |
| rascunho, documentacao_pendente | em_analise | P+I | | | `pdf_gerado` |
| em_analise | rascunho | I | | ✅ | devolver com observação (permite recalcular) |
| em_analise | documentacao_pendente | I | | ✅ | |
| em_analise | assinatura_pendente | ∅ (só pela Edge `contrato-assinatura`, acionada por I) | ✅ | | `pdf_gerado`, `modelo_liberado`, `signatarios_configurados`, `vendedora_configurada`, `email_cliente`, `valor_produto_atual`; efeito `imovel_no_contrato` |
| assinatura_pendente | assinado | ∅ | ✅ | | `cliente_finalizado`, `evento_contrato_assinado` |
| assinatura_pendente | recusado, expirado | ∅ | ✅ | | `imovel_aprovado` |
| assinatura_pendente | cancelado | I | ✅ | ✅ | cancela no D4Sign antes; `imovel_aprovado` |
| rascunho, documentacao_pendente, em_analise, recusado, expirado, cancelado | arquivado | I | | ✅ | **`assinado` não se arquiva nesta etapa** (distrato é financeiro ⚑) |

**Imóvel**

| de | para | papéis | sistema | motivo | validações e efeitos |
|---|---|---|---|---|---|
| rascunho | pendente | I (+ criador: `permite_criador`) | | | `campos_obrigatorios_imovel` (IMV-2) |
| pendente | em_revisao | I | | | |
| em_revisao | aprovado | I (E2) | | | |
| em_revisao | rascunho | I | | ✅ | a observação fica em `observacao_revisao` |
| aprovado | no_contrato | ∅ | ✅ | | pelo envio do contrato |
| no_contrato | aprovado | ∅ | ✅ | | contrato recusado, expirado ou cancelado |

**Tarefa:** `pendente → concluida` pelo responsável, pelo criador, pela cadeia acima com escopo ou por I. Não usa a tabela, é regra fixa da RPC.

### 3.9 Configuração e governança (migration 02)

**`configuracao_geral`** (uma linha só: `id boolean primary key default true check (id)`):

| Grupo | Colunas (padrão) |
|---|---|
| Casa | `imobiliaria_casa_id`, `gerente_casa_id`, `corretor_casa_id` (preenchidas na 04) |
| CRM | `exclusividade_dias int = 90`, `duplicidade_bloqueios_hora int = 10`, `documentos_basicos text[] = {CPF, CNH, Comprovante de residência, Comprovante de renda}`, `documento_max_bytes int = 5242880`, `portal_libera_pre_cadastro bool = false` |
| Contratos | `vendedora_razao_social`, `vendedora_cnpj`, `vendedora_endereco` (nulos, N7), `prazo_assinatura_dias int` (nulo, D4) |
| Imóveis | `imovel_fotos_max int = 20` ⚑, `imovel_foto_max_bytes int = 5242880` |
| Segurança | `exigir_mfa_interno bool = false` (H5), `sessao_inatividade_horas int = 8` (H1), `retencao_acesso_meses int = 24`, `retencao_operacao_meses int = 60` (H3), `download_ttl_segundos int = 60` |

**Demais tabelas de configuração e governança:**
- `notificacoes_config (tipo text pk, ativo bool, descricao)`. Tipos: `crm.boas_vindas`✅, `crm.documento_rejeitado`✅, `crm.documento_solicitado`, `crm.novo_lead_corretor`, `contratos.enviado`, `contratos.assinado`, `rede.transferencia`. Só os dois marcados começam ligados (N10).
- `lgpd_termos (id, tipo ∈ {consentimento_cliente, termos_parceiro}, versao text, texto, vigente_desde, revisado_juridico bool, criado_por)`: somente inclusão (H4).
- `lgpd_consentimentos`: ver §5.4.
- `auditoria`: ver §5.1.
- `eventos_dominio (id bigint identity, tipo, entidade_id uuid, dados jsonb, ocorrido_em)` e `eventos_consumo (consumidor, evento_id, processado_em, resultado, primary key (consumidor, evento_id))`.
- `notificacoes` (fila de saída): `id bigint`, `tipo` FK `notificacoes_config`, `destinatarios_ids uuid[]` (ids, nunca e-mails), `cliente_id`, `dados jsonb` (só ids), `status status_notificacao`, `tentativas`, `ultimo_erro`, `criado_em`, `enviado_em`. Um trigger AFTER INSERT reaproveita o **`notificar_evento()`** que já existe (pg_net + Vault).
- `integracao_eventos`: `id bigint`, `provedor ∈ {d4sign, asaas}`, `chave_idempotencia text`, `tipo`, `documento_ref`, `payload jsonb` (sem tokens), `recebido_em`, `processado_em`, `resultado`, `erro`, `unique (provedor, chave_idempotencia)`.
- `integracao_chamadas`: `id bigint`, `provedor`, `operacao`, `entidade`, `entidade_id`, `http_status`, `duracao_ms`, `erro`, `criado_em`. **Nunca guarda a URL**, porque o D4Sign leva token e chave na query string.
- `tentativas_publicas (id bigint, rota, ip, sucesso, criado_em)`: limite por IP do pré-cadastro. `portal_acessos` não muda.
- `download_autorizacoes (id bigint, profile_id, bucket, path, expira_em, criado_em)`: ver §4.3.
- `migracao_decisoes (tipo ∈ {dono_cpf, etapa_cliente_portal}, chave text, valor text, decidido_por text, decidido_em, primary key (tipo, chave))`: preenchida pelo runbook antes do corte. Contém CPF, então só `postgres` e `service_role` têm acesso; é **esvaziada** na contração.
- `migracao_pendencias (id bigint, tipo, tabela, registro_id, relacionado_id, detalhe, resolvido_em, resolvido_por, criado_em)`: fila da tela "Pendências da migração" (internos).
- `migracao_parceiro_clientes (parceiro_cliente_id pk, cliente_id, resultado)`: criada no corte.

### 3.10 Storage

| Bucket | Público? | Limites | Caminho (sem dado pessoal no nome) |
|---|---|---|---|
| `crm-documentos` (novo, migration 06) | não | `file_size_limit` 5 MB; `allowed_mime_types` = jpeg, png, pdf, doc/docx, xls/xlsx/csv | `<cliente_id>/<documento_id>/<uuid>.<ext>` |
| `contratos` (novo, 07) | não | só PDF; só a service role grava | `<contrato_id>/minuta-v<n>-<sha8>.pdf`, `<contrato_id>/assinado-<sha8>.pdf` |
| `imoveis` (novo, 05) | não (URL assinada) | 5 MB; jpg, png, webp | `<imovel_id>/<uuid>.webp` + `<uuid>-min.webp` |
| `empreendimentos`, `cliente-arquivos` | como hoje | — | — |

### 3.11 Como o financeiro vai encaixar sem refazer nada

1. **O contrato já guarda tudo o que gera parcelas:** valores em `numeric`, `n_parcelas`, `valor_parcela`, a versão dos parâmetros usada e valores congelados a partir do envio.
2. **`eventos_dominio('contrato.assinado')`:** o consumidor `financeiro.gerar_parcelas` processa também os contratos assinados antes dele existir (`eventos_consumo` evita processar duas vezes).
3. **A cadeia fica gravada em dois lugares:** congelada no contrato (quem vendeu) e com vigência em `cliente_vinculos_historico` (quem era o dono em cada data). Qualquer resposta ao B5 é calculável sem migrar dados.
4. `integracao_eventos` já dá idempotência ao webhook do Asaas. `parametros_simulacao` versionado é o molde de `comissao_regras` (percentuais por tipo com vigência, B1–B3).
5. **Dados bancários e PIX** ficam de fora agora. Vão para `parceiro_dados_bancarios`, com RLS mais restrita, na etapa financeira.
6. **Saldo** será uma tabela de razão somente inclusão (crédito e débito), nunca uma coluna, para não repetir o problema do legado de dinheiro gravado como texto.

---

## 4. Controle de acesso

### 4.1 Funções auxiliares em SQL

Migration 03 (dependem só de `profiles` e `configuracao_geral`):

```sql
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select pr.papel in ('admin','super') from public.profiles pr where pr.id = (select auth.uid())), false)
     and (not coalesce((select c.exigir_mfa_interno from public.configuracao_geral c), false)
          or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2')          -- H5
$$;
-- is_super(): mesma regra com papel = 'super'

create or replace function public.is_parceiro_aprovado() returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce((select pr.papel in ('parceiro','corretor','gerente','imobiliaria')
         and pr.status_parceiro = 'aprovado' from public.profiles pr where pr.id = (select auth.uid())), false)
$$;   -- unidades, materiais e obra: legados e novos papéis continuam vendo
```

Migration 09 (dependem de `parceiros`, `clientes`, `cliente_documentos`, `download_autorizacoes`):

```sql
-- escopo escalar (nulo = não se aplica; comparação com nulo nunca é verdadeira)
create or replace function public.escopo_corretor() returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.parceiros p join public.profiles pr on pr.id = p.profile_id
  where p.profile_id = (select auth.uid()) and p.tipo = 'corretor' and p.inativado_em is null and pr.status_parceiro = 'aprovado'
$$;
-- escopo_gerente():     mesma consulta com tipo 'gerente'      -> p.id
-- escopo_imobiliaria(): mesma consulta com tipo 'imobiliaria'  -> p.imobiliaria_id
-- minha_imobiliaria_id(): qualquer tipo, ativo e aprovado      -> p.imobiliaria_id
-- meu_parceiro_id():    qualquer tipo, ativo e aprovado        -> p.id

create or replace function public.pode_ver_cliente(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clientes c where c.id = p_cliente_id and (
       public.is_admin()
    or (c.inativado_em is null and (c.corretor_id = public.escopo_corretor()
        or c.gerente_id = public.escopo_gerente() or c.imobiliaria_id = public.escopo_imobiliaria()))))
$$;  -- false para "não existe" e para "fora do escopo": não revela a existência. NÃO inclui o titular (portal).

create or replace function public.meu_cliente_id() returns uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.clientes c
  where c.user_id = (select auth.uid()) and c.portal_liberado and c.inativado_em is null and c.anonimizado_em is null
$$;  -- só o portal usa; nunca combinado com pode_ver_cliente

create or replace function public.tem_permissao(p_acao text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce((select r.permitido from public.permissoes_rede r
    join public.parceiros p on p.tipo = r.tipo join public.profiles pr on pr.id = p.profile_id
    where p.profile_id = (select auth.uid()) and p.inativado_em is null and pr.status_parceiro = 'aprovado'
      and r.acao = p_acao), false)
$$;

create or replace function public.pode_enviar_documento(p_objeto text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cliente_documentos d
    where d.cliente_id::text = (storage.foldername(p_objeto))[1] and d.id::text = (storage.foldername(p_objeto))[2]
      and d.status in ('pendente','rejeitado') and d.inativado_em is null
      and (public.pode_ver_cliente(d.cliente_id) or d.cliente_id = public.meu_cliente_id()))
$$;

create or replace function public.download_autorizado(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.download_autorizacoes a where a.profile_id = (select auth.uid())
    and a.bucket = p_bucket and a.path = p_path and a.expira_em > now())
$$;

-- pode_ver_imovel(id) / pode_editar_imovel(id): regra E4 (§1.1), usadas pelas políticas de storage do bucket imoveis
-- meu_escopo() returns jsonb:
--   { papel, interno, super, status, mfa_exigido,
--     parceiro:{id,tipo,nome,codigo_indicacao,virtual,migrado_legado}, imobiliaria:{id,nome,da_casa}, gerente_id,
--     pendencias:['cpf','creci','termo'], permissoes:['crm.ver','crm.cadastrar','rede.ver','rede.cadastrar_corretor',…] }
```

**Grants:**
- `is_admin`, `is_super`, `is_parceiro_aprovado`, `meu_papel`, `escopo_*`, `minha_imobiliaria_id`, `meu_parceiro_id`, `pode_ver_cliente`, `meu_cliente_id`, `pode_ver_imovel`, `pode_editar_imovel`, `tem_permissao`, `pode_enviar_documento` e `download_autorizado` recebem `grant execute … to authenticated, service_role`, porque são usadas em políticas de tabela e de Storage. `is_admin` também vai para `anon`, como hoje.
- `meu_escopo` recebe grant para `authenticated`.

**Funções internas (migration 09, reais, sem grant):**
- `_auditar(p_categoria, p_acao, p_entidade, p_entidade_id, p_cliente_id default null, p_campos default null, p_antes default null, p_depois default null, p_detalhe default '{}', p_origem default 'rpc')`;
- `_evento_cliente(p_cliente_id, p_tipo, p_titulo, p_dados)`;
- `_transicionar(p_entidade text, p_id uuid, p_para text, p_motivo text, p_origem text) returns text` (devolve o `de`):
  1. trava a linha com `for update`;
  2. procura a linha ativa em `status_transicoes`;
  3. confere papel ou criador (origem `usuario`) ou `sistema` (origens `sistema` e `webhook`), e o motivo;
  4. executa as validações por `CASE`;
  5. grava o novo status;
  6. aplica os efeitos por `CASE`;
  7. grava `historico_status`.
- `_crm_solicitar_documentos_basicos(cliente_id)`, `_notificar(p_tipo, p_destinatarios uuid[], p_cliente_id, p_dados)`, `_evento_dominio(p_tipo, p_entidade_id, p_dados)`, `_autorizar_download(p_bucket, p_path)`.
- `hook_token_acesso(event jsonb) returns jsonb`:
  - grant só para `supabase_auth_admin`;
  - registra o login quando `authentication_method <> 'token_refresh'`;
  - **recusa emitir token** para perfil com `status_parceiro = 'inativo'`. O acesso cai em até 1 h, mesmo com refresh token. `bloqueado` continua entrando para ver a tela informativa, mas sem escopo;
  - não coloca escopo em claims.

**Esqueletos:** todas as RPCs da §4.4 são criadas na 09 com a assinatura final, grants finais e corpo `raise exception 'nao_implementado' using errcode = '0A000'`. Cada pacote troca o corpo com `create or replace` (o que preserva dono e grants). É o que permite que os pacotes da onda 1 trabalhem e testem em paralelo.

### 4.2 RLS e grants por tabela e por papel

Legenda: S/I/U/D = select, insert, update, delete. "RPC" = sem grant direto, só pelas funções. As colunas "até o corte" valem enquanto o front antigo está no ar.

| Tabela | anon | cliente (portal) | corretor | gerente | imobiliária | admin | super |
|---|---|---|---|---|---|---|---|
| profiles | — | S/U o próprio | S/U o próprio | idem | idem | S todos; U `status_parceiro` (protegido por trigger) | S/U; papéis internos |
| imobiliarias | — | — | S a sua | S a sua | S a sua | S; escrita por RPC | idem |
| parceiros (sem a coluna `cpf`, por grant de coluna) | — | — | S o próprio | S o próprio e os seus corretores | S os da imobiliária | S | S; escrita só por RPC |
| clientes: **até o corte** | — | S o próprio (`user_id`) | — | — | — | S; I/U só `nome, cpf, email, telefone`; sem D | idem |
| clientes: **depois do corte** | — | RPC `portal_*` | RPC | RPC | RPC | **RPC** | **RPC** |
| cliente_notas, _tarefas, _documentos, _documento_arquivos, _eventos, _duplicidades, *_vinculos_historico | — | RPC `portal_*` (só documentos) | RPC | RPC | RPC | **RPC** | **RPC** |
| contratos, contrato_signatarios | — | RPC `portal_*` (a partir de `assinatura_pendente`) | RPC | RPC | RPC | **RPC** | **RPC** |
| cliente_negocios, cliente_arquivos | — | S os próprios (política reescrita com `meu_cliente_id()`) | — | — | — | como hoje | idem |
| propostas: **até o corte** | — | — | S por escopo, ou o próprio sem `cliente_id`; I o próprio (`status='enviada'`, `cliente_id` nulo) | S por escopo | S por escopo | S/U | idem |
| propostas: **depois do corte** | — | — | RPC | RPC | RPC | RPC | RPC |
| leads | só pela função `enviar-lead` | — | — | — | — | até o corte: S; D só `status='novo'`. Depois: **RPC** | idem |
| parceiro_clientes (legado) | — | — | até o corte, como hoje; depois S o próprio (só leitura) | — | — | S | S |
| imoveis | — | — | S pela regra E4; I (rascunho); U em colunas editáveis se criador e RA/PE | idem + S da cadeia abaixo | idem | S/I/U (sem `status`) | idem |
| imovel_fotos | — | — | S segue o imóvel; escrita por RPC | idem | idem | idem | idem |
| unidades, empreendimento_materiais, obra_atualizacoes | — | obra: como hoje (reescrita com helper) | S (helper v2) | S | S | como hoje | idem |
| parametros_simulacao, imovel_tipos, contrato_modelos (vigentes) | — | — | S | S | S | S | S; I/U por RPC ou política `is_super` |
| configuracao_geral | — | — | S pela view `configuracao_publica` (sem retenção nem MFA) | idem | idem | S | U por `config_atualizar` |
| status_transicoes, permissoes_rede, notificacoes_config, contrato_signatario_regras, lgpd_termos | — | — | S (transições e permissões: para o menu e o kanban) | idem | idem | S | S/U (`is_super`); versionadas só I |
| historico_status | — | — | — | — | — | S (sem dado pessoal) | S |
| auditoria | — | — | — | — | — | **RPC** `auditoria_consultar` | idem |
| eventos_*, notificacoes, integracao_*, tentativas_publicas, download_autorizacoes, migracao_decisoes | só `service_role` | | | | | | |
| migracao_pendencias | — | — | — | — | — | S; U resolver (RPC) | idem |

**Padrão das políticas:** comparação por coluna com o escopo em cache (initPlan).

```sql
-- parceiros (migration 09)
create policy "parceiros: escopo lê" on public.parceiros for select to authenticated using (
  (select public.is_admin()) or profile_id = (select auth.uid())
  or imobiliaria_id = (select public.escopo_imobiliaria())
  or (tipo = 'corretor' and gerente_id = (select public.escopo_gerente())));
grant select (id, profile_id, tipo, imobiliaria_id, gerente_id, nome, creci, email, telefone, codigo_indicacao,
              virtual, migrado_legado, imobiliaria_declarada, criado_em, inativado_em) on public.parceiros to authenticated;
-- sem cpf: o CPF de parceiro só sai por rede_parceiro_detalhe (auditada)

-- propostas (migration 09; vale até o corte, depois o grant de select é revogado)
drop policy "prop: dono lê" on public.propostas;
create policy "prop: escopo lê" on public.propostas for select to authenticated using (
  (select public.is_admin()) or ((select public.is_parceiro_aprovado()) and (
     corretor_id = (select public.escopo_corretor()) or gerente_id = (select public.escopo_gerente())
     or imobiliaria_id = (select public.escopo_imobiliaria())
     or (cliente_id is null and parceiro_id = (select auth.uid())))));
drop policy "prop: parceiro cria" on public.propostas;
create policy "prop: parceiro cria" on public.propostas for insert to authenticated
  with check (parceiro_id = (select auth.uid()) and (select public.is_parceiro_aprovado()) and status = 'enviada' and cliente_id is null);

-- imoveis (migration 09)
create policy "imoveis: leitura" on public.imoveis for select to authenticated using (
  (select public.is_admin()) or criado_por = (select auth.uid())
  or imobiliaria_id = (select public.escopo_imobiliaria()) or gerente_id = (select public.escopo_gerente())
  or (status in ('aprovado','no_contrato') and inativado_em is null and (select public.is_parceiro_aprovado())));
create policy "imoveis: cadastrar" on public.imoveis for insert to authenticated
  with check (criado_por = (select auth.uid()) and status = 'rascunho' and (select public.tem_permissao('cadastrar_imovel')));
create policy "imoveis: editar" on public.imoveis for update to authenticated
  using ((select public.is_admin()) or (criado_por = (select auth.uid()) and status in ('rascunho','pendente')
         and (select public.is_parceiro_aprovado())))
  with check ((select public.is_admin()) or (criado_por = (select auth.uid()) and status in ('rascunho','pendente')));
grant insert (nome, matricula, tipo, descricao, cep, pais, uf, cidade, bairro, logradouro, numero, complemento, valor,
              area_total, area_construida, idade_anos, andar, quartos, banheiros, suites, vagas, adicionais)
  on public.imoveis to authenticated;
grant update (/* mesma lista; sem status, codigo, criado_por nem cadeia */) on public.imoveis to authenticated;

-- políticas atuais reescritas (migration 09) para não dependerem de SELECT em clientes
drop policy "neg: próprio" on public.cliente_negocios;
create policy "neg: próprio" on public.cliente_negocios for select
  using ((select public.is_admin()) or cliente_id = (select public.meu_cliente_id()));
-- "arq: próprio" idem; "obra: leitura" passa a usar  n.cliente_id = (select public.meu_cliente_id())
drop policy "storage cli: dono lê" on storage.objects;
create policy "storage cli: dono lê" on storage.objects for select using (bucket_id = 'cliente-arquivos' and (
  (select public.is_admin()) or (storage.foldername(name))[1] = (select public.meu_cliente_id())::text));
```

### 4.3 Grants, Storage e download sempre auditado

- **Tabelas novas:** `grant select` a `authenticated` só onde a §4.2 diz S. `grant select, insert, update, delete` a `service_role`, menos em `auditoria` (só select e insert) e nas tabelas somente inclusão (select e insert). Tabelas de CRM e contratos: **nenhum grant** a `authenticated`.
- **No corte (17):**
  - `revoke all on public.clientes, public.leads from authenticated`;
  - `revoke select, insert, update on public.propostas from authenticated`;
  - `revoke insert, update, delete on public.parceiro_clientes from authenticated`.

  As políticas antigas ficam como defesa em profundidade. As que consultam `clientes` já foram reescritas com `meu_cliente_id()` na 09. `cliente-login` e as Edge Functions usam a service role e não são afetados.
- **Funções:**
  - RPCs de usuário: `grant execute … to authenticated`;
  - `rede_link_publico` e `lgpd_termo_vigente`: também `anon`;
  - RPCs de sistema (`crm_pre_cadastro`, `rede_vincular_login`, `rede_registrar_convite`, `contrato_registrar_*`, `contrato_falha_envio`, `portal_localizar_cliente`): **só `service_role`**;
  - tarefas do pg_cron: sem grant (rodam como `postgres`).
- **Download sempre registrado:**
  - buckets `crm-documentos` e `contratos` têm **uma única** política de SELECT: `bucket_id in ('crm-documentos','contratos') and public.download_autorizado(bucket_id, name)`;
  - a autorização (validade `download_ttl_segundos`) só é criada por `crm_documento_baixar`, `contrato_baixar` ou `portal_contrato_baixar`, que conferem o escopo e gravam auditoria;
  - chamar `createSignedUrl` sem passar pela RPC falha.
- **Upload em `crm-documentos`:**
  - política de INSERT `bucket_id = 'crm-documentos' and public.pode_enviar_documento(name)`;
  - sem UPDATE nem DELETE para `authenticated`;
  - `crm_documento_registrar_envio` lê o tamanho e o tipo **reais** em `storage.objects.metadata`, sem confiar no navegador.
- **Bucket `imoveis`:** SELECT por `pode_ver_imovel((storage.foldername(name))[1]::uuid)`; INSERT e DELETE por `pode_editar_imovel(...)`.

### 4.4 RPCs `security definer`

Regras comuns a todas as RPCs:
- conferem `auth.uid()` e o escopo **explicitamente** (definer ignora a RLS);
- mudam status só por `_transicionar`;
- gravam `_auditar` e, quando for o caso, `_evento_cliente`;
- são `volatile`, porque gravam auditoria, e chamadas por POST;
- dono do WP entre colchetes.

| Função [WP] | Quem pode | Validações | Auditoria / timeline |
|---|---|---|---|
| **Rede** | | | |
| `meu_escopo() → jsonb` [0] | todos logados | — | — |
| `rede_cadastrar_imobiliaria(p_dados jsonb) → uuid` / `rede_editar_imobiliaria(p_id uuid, p_dados jsonb)` [1] | I | CNPJ (DV, único), CRECI PJ | operacao/criar, editar |
| `rede_cadastrar_parceiro(p_tipo tipo_parceiro, p_dados jsonb, p_imobiliaria_id uuid, p_gerente_id uuid) → uuid` [1] | matriz §3.3 + escopo | CPF/CRECI (PAR-4); gerente da mesma imobiliária e dentro do escopo; CPF único | operacao/criar |
| `rede_editar_parceiro(p_id uuid, p_dados jsonb)` / `rede_atualizar_meu_cadastro(p_dados jsonb)` [1] | matriz / o próprio | CPF só se estiver vazio; **e-mail não muda se já houver login** (o e-mail do login é do Auth) | operacao/editar (nomes dos campos) |
| `rede_parceiro_detalhe(p_id uuid) → jsonb` [1] | escopo | inclui CPF | acesso/consultar |
| `rede_aprovar_autocadastro(p_profile_id uuid, p_gerente_id uuid, p_dados jsonb) → uuid` [1] | I | papel `parceiro` pendente, sem linha em `parceiros`; CPF e CRECI | operacao/aprovar; papel → `corretor` |
| `rede_recusar_autocadastro(p_profile_id uuid, p_motivo text)` [1] | I | pendente | operacao/recusar (status `bloqueado`) |
| `rede_bloquear_parceiro(p_id uuid, p_motivo text)` / `rede_desbloquear_parceiro(p_id uuid)` [1] | I | — | seguranca |
| `rede_pode_convidar(p_parceiro_id uuid) → jsonb {pode, situacao, email, nome, modo_link}` [1] | matriz + escopo, **com o JWT de quem chama** | `situacao`: `novo` (sem login e e-mail livre), `reenviar` (vinculado a este parceiro e nunca entrou), `email_em_uso`, `ja_ativo`; `modo_link` = `tem_permissao('convite_por_link')` | — |
| `rede_vincular_login(p_parceiro_id uuid, p_profile_id uuid)` [1] | service | perfil sem vínculo, papel `parceiro`, `invited_at` preenchido, `last_sign_in_at` nulo, criado há menos de 10 min e mesmo e-mail do parceiro | seguranca/convite; papel = tipo; status `aprovado` |
| `rede_registrar_convite(p_parceiro_id uuid, p_modo text, p_ator uuid)` [1] | service | — | seguranca/link_gerado (sem o link) |
| `rede_transferir_clientes(p_cliente_ids uuid[], p_novo_corretor_id uuid, p_motivo text) → int` [1] | imobiliária (dentro dela); gerente (origem e destino na sua equipe; A1); I (entre imobiliárias só o Super) | motivo ≥ 5 caracteres; destino ativo; clientes com contrato em `assinatura_pendente` não são transferidos (cadeia congelada ⚑) | operacao/transferir (de → para); timeline `transferencia` |
| `rede_transferir_corretor(p_corretor_id uuid, p_novo_gerente_id uuid, p_motivo text)` [1] | imobiliária (mesma), I | gerente da mesma imobiliária | operacao/transferir; a cascata move os clientes |
| `rede_mudar_imobiliaria_corretor(p_corretor_id uuid, p_novo_gerente_id uuid, p_destino_carteira_id uuid, p_motivo text)` [1] | I | PAR-6: transfere a carteira para `p_destino_carteira_id` (da origem) **antes** | operacao/transferir |
| `rede_regularizar_legado(p_corretor_id uuid, p_novo_gerente_id uuid, p_levar_clientes boolean)` [1] | Super | só `migrado_legado` na casa; uma vez só (N3) | operacao/regularizar |
| `rede_inativar_parceiro(p_id uuid, p_destino_id uuid, p_motivo text)` [1] | matriz + escopo | **corretor:** destino = corretor ativo da mesma imobiliária **e dentro do escopo de quem chama** (o gerente só na própria equipe; a imobiliária na imobiliária), ou o gerente dele. **Gerente:** destino = gerente da mesma imobiliária (move corretores e clientes diretos). Falha se sobrar qualquer descendente. | operacao/inativar; `status_parceiro='inativo'`; código de indicação apagado |
| `rede_reativar_parceiro(p_id uuid)` / `rede_inativar_imobiliaria(p_id uuid, p_motivo text)` [1] | I | imobiliária sem descendente ativo | operacao |
| `rede_gerar_codigo_indicacao() → text` [1] | corretor (ou gerente com A1) | invalida o código anterior | operacao |
| `rede_link_publico(p_codigo text) → jsonb {nome_corretor, nome_imobiliaria}` [1] | anon | código ativo; mesma resposta para inexistente e inativo | — |
| **CRM: cadastro, ficha, leads, propostas** | | | |
| `crm_cadastrar_cliente(p_dados jsonb, p_corretor_id uuid, p_termo_id uuid) → jsonb {situacao, id}` [2] | `cadastrar_cliente` + escopo (o corretor só para si) | CPF/CNPJ (DV). `pg_advisory_xact_lock(hashtext(doc))` contra corrida. Duplicidade A2 → `situacao='indisponivel'` (**sem dono nem data**) ou `ja_na_sua_carteira` (com id). Acima de `duplicidade_bloqueios_hora` bloqueios na hora → erro `LIMITE_DUPLICIDADE`. Termo vigente. `portal_liberado=false`. | operacao/criar; consentimento `declarado` (N12); timeline `cadastro`; tentativa em `cliente_duplicidades` |
| `crm_editar_cliente(p_id uuid, p_dados jsonb)` [2] | escopo | CPF/CNPJ só se estiver vazio (fora disso, só I); `corretor_id` nunca por aqui | operacao/editar (nomes dos campos) |
| `crm_listar(p_filtros jsonb, p_limite int, p_offset int) → jsonb` / `crm_clientes_opcoes(p_busca text) → jsonb` [2] | P+I | escopo por coluna | acesso/listar (ids devolvidos; a busca é gravada só como `{busca:true}`, nunca o texto) |
| `crm_ficha(p_id uuid) → jsonb` [2] | P+I | fora do escopo **devolve nulo** e registra `acesso_negado`. Devolve também destinos de etapa permitidos e permissões da tela. | acesso/consultar |
| `crm_inativar_cliente(p_id uuid, p_motivo text)` / `crm_liberar_portal(p_id uuid, p_liberar boolean)` [2] | I | sem contrato ativo / PF com CPF | operacao / seguranca |
| `crm_duplicidades_listar(p_filtros jsonb)` / `crm_duplicidade_resolver(p_id uuid, p_decisao text, p_motivo text)` [2] | I | a decisão "transferir" chama a mesma lógica de `rede_transferir_clientes` | operacao |
| `leads_listar(p_filtros jsonb)` / `leads_converter(p_lead_id uuid, p_corretor_id uuid, p_dados jsonb, p_termo_id uuid) → jsonb` / `leads_descartar(p_lead_id uuid, p_motivo text)` / `leads_excluir(p_lead_id uuid)` / `leads_exportar(p_filtros jsonb)` [2] | I | A2 na conversão; exclusão só de `novo` | acesso/listar, exportar; operacao |
| `propostas_listar(p_filtros jsonb)` / `propostas_criar(p_empreendimento_id uuid, p_cliente_id uuid, p_unidade_id uuid, p_texto text) → uuid` / `propostas_responder(p_id uuid, p_status status_proposta, p_resposta text)` [2] | escopo / P aprovado com o cliente no escopo / I | — | acesso/listar; timeline `proposta_*` (os triggers de e-mail atuais continuam) |
| `crm_pre_cadastro(p_codigo text, p_dados jsonb, p_termo_id uuid, p_ip inet, p_user_agent text) → jsonb` [2] | service | ver §6.1 | criar + consentimento + CRM-3 |
| **CRM: funil e atividades** | | | |
| `crm_kanban(p_filtros jsonb, p_limite_coluna int) → jsonb` / `crm_kanban_coluna(p_etapa etapa_funil, p_filtros jsonb, p_offset int) → jsonb` [3] | P+I | escopo; o filtro por corretor é cruzado com o escopo | acesso/listar |
| `crm_mudar_etapa(p_id uuid, p_para etapa_funil, p_motivo text) → jsonb` [3] | P+I | `_transicionar('cliente_etapa')` | operacao/mudar_status; timeline `etapa` |
| `crm_timeline(p_id uuid, p_antes timestamptz, p_limite int)` / `crm_notas(p_id uuid)` / `crm_tarefas(p_id uuid)` / `crm_documentos(p_id uuid)` [3] | P+I | escopo | acesso/consultar |
| `crm_nota_criar(p_cliente_id uuid, p_texto text) → uuid` [3] | P+I | texto não vazio; escapado na exibição | timeline `nota` |
| `crm_tarefa_criar(p_cliente_id uuid, p_titulo text, p_descricao text, p_responsavel_id uuid, p_prazo date) → uuid` / `crm_tarefa_editar(p_id uuid, p_dados jsonb)` / `crm_tarefa_concluir(p_id uuid)` / `crm_responsaveis(p_cliente_id uuid)` / `crm_minhas_tarefas(p_filtros jsonb)` [3] | P+I | o responsável precisa ter escopo sobre o cliente **na criação e em cada troca**. `crm_minhas_tarefas` só devolve tarefas cujo cliente ainda está no escopo, então quem perde o cliente numa transferência perde a tarefa. | timeline `tarefa_*` |
| `crm_documento_solicitar(p_cliente_id uuid, p_nome text, p_formatos text[], p_contrato_id uuid)` / `crm_documento_cancelar(p_id uuid, p_motivo text)` [3] | P+I | — | timeline; notificação opcional |
| `crm_documento_registrar_envio(p_documento_id uuid, p_path text)` [3] | P+I ou o titular (`meu_cliente_id`) | prefixo do caminho; objeto existe; tamanho e MIME reais; transição | timeline `documento_enviado` |
| `crm_documento_analisar(p_id uuid, p_aprovar boolean, p_motivo text)` [3] | `analisar_documento` + escopo (F4) | motivo se rejeitar | timeline; notificação `crm.documento_rejeitado` |
| `crm_documento_baixar(p_arquivo_id uuid) → jsonb {bucket, path, expira_em}` [3] | P+I (**o titular não baixa**) | escopo | acesso/baixar |
| **Contratos** | | | |
| `contrato_simular(p_forma forma_pagamento, p_produto jsonb, p_perc_aporte numeric, p_entrada numeric, p_n_parcelas int) → jsonb` [4] | P+I | valor lido do produto; FIN-1/FIN-2; limites | — (não grava) |
| `contrato_criar(p_cliente_id uuid, p_forma forma_pagamento, p_produto jsonb, p_perc_aporte numeric, p_entrada numeric, p_n_parcelas int) → uuid` [4] | `criar_contrato` + escopo | recalcula tudo no servidor; imóvel `aprovado`; unidade não `vendida` e com valor; um contrato ativo por produto; modelo vigente da forma | operacao/criar; timeline `contrato_gerado` |
| `contrato_atualizar_simulacao(p_id uuid, p_forma forma_pagamento, p_perc_aporte numeric, p_entrada numeric, p_n_parcelas int)` [4] | idem | só em `rascunho`; relê o valor do produto | operacao/editar |
| `contrato_mudar_status(p_id uuid, p_para status_contrato, p_motivo text)` [4] | tabela §3.8 | — | operacao/mudar_status; timeline |
| `contrato_dados_modelo(p_id uuid) → jsonb {modelo, variaveis, codigo}` [4] | escopo; status `rascunho`, `documentacao_pendente` ou `em_analise` | todas as variáveis, com valor ou nulo | operacao/gerar |
| `contrato_registrar_documento(p_id uuid, p_versao int, p_path text, p_sha256 text, p_texto_sha256 text)` [4] | service | `pdf_versao` esperada (concorrência) | operacao |
| `contrato_preparar_envio(p_id uuid) → jsonb` [4] | I (JWT) | transição e validações; trava `envio_lock_em` (15 min); resolve signatários | — |
| `contrato_registrar_d4sign_uuid(p_id uuid, p_uuid text)` / `contrato_registrar_envio(p_id uuid, p_signatarios jsonb, p_webhook_token_hash text)` / `contrato_falha_envio(p_id uuid, p_erro text)` [4] | service | idempotentes | operacao/enviar_assinatura; timeline |
| `contrato_registrar_retorno(p_d4sign_uuid text, p_status text, p_signatarios jsonb, p_pdf_assinado_path text, p_sha256 text)` [4] | service | idempotente: estado igual não faz nada; `assinado` seguido de `recusado` é ignorado | integracao; timeline; efeitos D5 |
| `contratos_listar(p_filtros jsonb)` / `contrato_detalhe(p_id uuid)` / `contrato_baixar(p_id uuid, p_tipo text, p_versao int)` [4] | escopo | — | acesso |
| `config_publicar_parametros(p jsonb)` / `config_publicar_modelo(p_chave modelo_chave, p_titulo text, p_conteudo text) → uuid` / `config_liberar_modelo(p_id uuid, p_revisado_juridico boolean)` [4] | Super | variáveis da lista permitida; marcação válida | configuracao |
| **Imóveis** | | | |
| `imovel_mudar_status(p_id uuid, p_para status_imovel, p_obs text)` [5] | tabela §3.8 | IMV-2 | operacao; `historico_status` |
| `imovel_foto_registrar(p_imovel_id uuid, p_path text, p_miniatura_path text) → uuid` / `imovel_foto_remover(p_id uuid)` / `imovel_fotos_ordenar(p_imovel_id uuid, p_ids uuid[])` [5] | `pode_editar_imovel` | quantidade máxima, tamanho real | operacao |
| `imovel_inativar(p_id uuid, p_motivo text)` [5] | I | sem contrato ativo | operacao |
| **Governança, portal, configuração** | | | |
| `auditoria_consultar(p_filtros jsonb, p_limite int, p_offset int) → jsonb` [6] | I | — | acesso/consultar (a leitura da auditoria também é registrada) |
| `config_atualizar(p jsonb)` [6] | Super | lista de colunas permitidas | configuracao (antes e depois) |
| `equipe_definir_papel(p_profile_id uuid, p_papel papel)` [6] | Super | só entre `admin`, `super`, `colaborador`; nunca remove o último Super | seguranca |
| `lgpd_termo_vigente(p_tipo text) → jsonb` (anon) / `lgpd_publicar_termo(p_tipo text, p_versao text, p_texto text, p_revisado_juridico boolean)` (Super) / `lgpd_aceitar_termo(p_termo_id uuid)` (logado) / `lgpd_revogar_consentimento(p_id uuid, p_motivo text)` (Super) [6] | | | lgpd |
| `lgpd_anonimizar_cliente(p_cliente_id uuid, p_protocolo text) → jsonb {paths, user_id}` [6] | **Super, com o JWT** (respeita `aal2`) | irreversível; sem contrato em `assinatura_pendente` | lgpd/anonimizar |
| `portal_meus_dados() → jsonb` / `portal_meu_corretor() → jsonb` / `portal_documentos() → jsonb` / `portal_contratos() → jsonb` / `portal_contrato_baixar(p_id uuid) → jsonb` [6] | C | `meu_cliente_id()`; contratos só `assinatura_pendente`/`assinado`; o download é só do PDF assinado | acesso (a baixa do contrato é registrada) |
| `portal_localizar_cliente(p_cpf text) → table(id uuid, nome text, user_id uuid)` [6] | service (`cliente-login`) | `portal_liberado`, não inativado, não anonimizado, PF | — (`portal_acessos` continua) |
| `painel_resumo() → jsonb` [6] | todos | cartões por papel e escopo | — |
| `migracao_pendencias_resolver(p_id bigint, p_decisao text)` [7] | I | — | operacao |
| `notificacoes_reenviar()`, `auditoria_purgar()`, `limpar_temporarios()` [6] | pg_cron (`postgres`) | — | — |

### 4.5 Como um corretor não consegue ver o cliente de outro, nem pela API

Cenário: o corretor A, com sessão válida, sabe o `id` do cliente X, que é do corretor B.

| Tentativa do corretor A | Resultado |
|---|---|
| `GET /rest/v1/clientes?id=eq.X` (até o corte) | `[]`: não há política de parceiro em `clientes` |
| `GET /rest/v1/clientes?id=eq.X` (depois do corte) | `42501 permission denied`: sem grant |
| `GET /rest/v1/cliente_documentos?cliente_id=eq.X` (e notas, tarefas, eventos, contratos) | `42501`: sem grant, sempre |
| `POST /rest/v1/rpc/crm_ficha {p_id: X}` | `null`, e a auditoria grava `acesso_negado` com `ator_id` = A e `cliente_id` = X |
| `POST /rest/v1/rpc/crm_mudar_etapa`, `crm_nota_criar`, `rede_transferir_clientes` | `42501 Sem acesso a este registro` (mesma mensagem para inexistente) |
| `POST /rest/v1/rpc/crm_kanban {"p_filtros":{"corretor_id":"<B>"}}` | Só voltam os clientes de A: o filtro é cruzado com o escopo |
| `storage.createSignedUrl('crm-documentos', 'X/...')` | Erro: não há `download_autorizacoes`, e `crm_documento_baixar` recusa pelo escopo |
| Upload em `crm-documentos/X/<doc>/…` | Negado por `pode_enviar_documento` |
| `crm_cadastrar_cliente(p_corretor_id := B)` | `42501`: o corretor só cadastra para si. A cadeia forjada é descartada e recalculada pelo trigger `clientes_cadeia`. |
| `crm_cadastrar_cliente` com o CPF de X | `{situacao:'indisponivel'}`, sem dono nem data. Depois de 10 bloqueios na hora: `LIMITE_DUPLICIDADE`. |
| Edge `contrato-gerar` com `contrato_id` de X | A Edge chama `contrato_dados_modelo` **com o JWT de A**: negado |
| Escopo guardado na sessão depois de ser inativado | Os helpers exigem `status_parceiro='aprovado'` a cada consulta, então o escopo some na hora. O hook de token recusa renovar a sessão. |

As linhas que dependem só de grants, políticas e helpers ficam em `supabase/tests/escopo.test.sql` (WP0). As que usam RPC ficam nos testes de cada pacote. `escopo_ponta_a_ponta.test.sql` (WP7) repete a tabela inteira depois que todos os corpos existem.

### 4.6 Armadilhas que o implementador precisa respeitar

- **Um `raise` desfaz o insert de auditoria feito antes dele, na mesma transação.** Por isso as RPCs de **leitura** devolvem nulo quando o acesso é negado, e o log fica gravado. As de escrita dão `raise` e não registram a negação; o log do PostgREST fica como rastro.
- `(select helper())` em toda política, para o helper ser avaliado uma vez só.
- Funções `security definer` ignoram a RLS: o escopo tem de estar **explícito** em cada uma. Os testes pgTAP e o teste de invariantes cobrem isso.
- Funções `language sql`, políticas, views e FKs são validadas na criação: **nunca** citam objeto de migration posterior. Os corpos plpgsql não são validados, mas a regra vale igual para manter o `db reset` previsível.
- `create or replace` não pode mudar nome de parâmetro nem tipo de retorno. As assinaturas da 09 são contrato entre pacotes.
- Trigger `security invoker` que chama helper precisa de `grant execute` para `authenticated`.
- Edge Functions **nunca** decidem papel lendo `profiles` com a service role. Sempre chamam uma RPC com o JWT do usuário, o que respeita `aal2` e o escopo.

---

## 5. Auditoria e LGPD

### 5.1 Tabela `auditoria` (somente inclusão, migration 02)

```sql
create table public.auditoria (
  id bigint generated always as identity primary key,
  ocorrido_em timestamptz not null default now(),
  categoria public.categoria_auditoria not null,
  acao text not null,          -- consultar, listar, baixar, exportar, criar, editar, inativar, reativar, transferir,
                               -- mudar_status, gerar, enviar_assinatura, assinar, anonimizar, login, acesso_negado,
                               -- link_gerado, migracao
  entidade text not null, entidade_id text,
  cliente_id uuid,             -- titular afetado (LGPD); sem FK, sobrevive à anonimização
  ator_id uuid, ator_papel public.papel, ator_parceiro_id uuid,
  origem text not null default 'rpc',   -- rpc | trigger | edge:<nome> | webhook:d4sign | cron | hook | migracao
  campos text[],                         -- NOMES das colunas alteradas
  antes jsonb, depois jsonb,             -- só campos NÃO pessoais: status, etapa, ids de vínculo, valores de contrato
  detalhe jsonb not null default '{}',   -- ids devolvidos, contagens, filtros sem texto livre
  ip inet, user_agent text               -- de current_setting('request.headers', true)
);
create index on public.auditoria (entidade, entidade_id, ocorrido_em desc);
create index on public.auditoria (cliente_id, ocorrido_em desc) where cliente_id is not null;
create index on public.auditoria (ator_id, ocorrido_em desc);
create index on public.auditoria (categoria, ocorrido_em);

create function public._auditoria_imutavel() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('arken.purga_auditoria', true) = 'on' then return old; end if;
  raise exception 'Auditoria é somente inclusão' using errcode = '42501';
end $$;
create trigger auditoria_imutavel before update or delete on public.auditoria
  for each row execute function public._auditoria_imutavel();
create trigger auditoria_sem_truncate before truncate on public.auditoria
  for each statement execute function public._auditoria_imutavel();
alter table public.auditoria enable row level security;          -- sem política para authenticated
revoke all on public.auditoria from anon, authenticated, service_role;
grant select, insert on public.auditoria to service_role;        -- Edge Functions registram eventos de integração
```

- **Não se guardam valores pessoais no log.** Ficam só os nomes dos campos: nem CPF, nem hash, nem HMAC (um hash de CPF seria reversível com cerca de 10⁹ tentativas). Assim a anonimização nunca precisa tocar no log e ele continua imutável.
- O dono do banco (`postgres`) é a fronteira de confiança: ele pode desligar triggers. É o limite aceito numa plataforma gerenciada.

### 5.2 O que dispara o registro

| Evento | Mecanismo |
|---|---|
| Criar, editar, transferir, inativar, mudar etapa ou status, contratos, configuração pelas RPCs | `_auditar()` dentro da RPC, na mesma transação |
| Consulta de ficha, listas, kanban, documentos, contratos, exportação, parceiro com CPF | RPC de leitura. Leitura não dispara trigger: por isso toda leitura de dado pessoal é por RPC, **inclusive dos internos** depois do corte. |
| Leitura da própria auditoria | `auditoria_consultar` registra `acesso/consultar` |
| Gravação direta pela API (tela antiga até o corte; tabelas de configuração do Super; `profiles.status_parceiro`) | trigger genérico `auditar_linha(<colunas>)`, só quando `current_user <> 'postgres'` |
| Webhook e chamadas ao D4Sign, envios de e-mail | `integracao_eventos`, `integracao_chamadas` + `_auditar('integracao', …)` |
| Login de parceiro ou interno | `hook_token_acesso`, registrado quando `authentication_method <> 'token_refresh'`. Falhas: Turnstile + limite do Auth (H2 ⚑). Portal: `portal_acessos` (sem mudança). |
| Link de convite gerado | `rede_registrar_convite` (quem gerou, para quem, modo; nunca o link) |
| Acesso negado em leitura | RPC devolve nulo e registra `acesso_negado` (§4.6) |

### 5.3 Retenção (H3 ⚑)

`auditoria_purgar()` roda todo mês pelo pg_cron como `postgres`, liga localmente `arken.purga_auditoria` e apaga:
- categoria `acesso` com mais de `retencao_acesso_meses` (24);
- as demais com mais de `retencao_operacao_meses` (60).

A mesma rotina limpa:
- `portal_acessos` (24 meses);
- `tentativas_publicas` (90 dias);
- `download_autorizacoes` vencidas;
- `integracao_chamadas` (12 meses) ⚑.

### 5.4 Consentimento

- `lgpd_termos` é versionado e somente inclusão; o vigente é o de maior `vigente_desde` por tipo. Sem versão com `revisado_juridico = true`, a Edge `pre-cadastro` responde 503 (H4).
- `lgpd_consentimentos`:
  - colunas: `id`, `titular ∈ {cliente, parceiro}`, `cliente_id`, `profile_id`, `termo_id` (FK), `aceito_em`, `origem ∈ {pre_cadastro_link, declarado, cadastro_parceiro, portal, migracao}`, `ip`, `user_agent`, `registrado_por`, `revogado_em`, `revogado_por`, `motivo_revogacao`;
  - revogar só preenche os campos `revogado_*` (única atualização, só por RPC);
  - com o consentimento revogado, o cliente continua existindo e as notificações para ele deixam de sair.
- O cadastro de parceiro passa a enviar `termo_id` nos metadados. `handle_new_user` v2 grava o consentimento (IP nulo nesse caminho ⚑). Hoje o aceite dos termos não é registrado.
- Migrados recebem consentimento `origem='migracao'`, sem termo aceito de fato. ⚑ O jurídico decide se é preciso colher o aceite (N12).

### 5.5 Anonimização (a pedido do titular)

A Edge `lgpd-anonimizar` recebe o JWT do Super e chama `lgpd_anonimizar_cliente(p_cliente_id, p_protocolo)` **com esse JWT**. A RPC confere `is_super()` (com `aal2` quando exigido) e:
1. troca o nome por "Titular anonimizado #<6 caracteres do hash do id>";
2. anula CPF, CNPJ, RG, e-mails, telefones, endereço, nascimento, gênero, estado civil, horário e interesses;
3. troca o texto das notas e as descrições das tarefas por "[removido — LGPD]" (`removido_lgpd=true`);
4. anonimiza o `lead` convertido ligado ao cliente e as linhas de `parceiro_clientes` (legado) do mapa de migração;
5. preenche `anonimizado_em`, `inativado_em` e `portal_liberado=false`;
6. **mantém** contratos (valores e datas), histórico de vínculos, timeline (sem dado pessoal), `historico_status` e auditoria;
7. marca `removido_em` em `cliente_documento_arquivos` e devolve os caminhos a apagar, mais o `user_id` do portal.

Em seguida, a Edge apaga os arquivos pela **API do Storage** (apagar `storage.objects` por SQL deixa o arquivo órfão) e remove o usuário Auth do portal.

⚑ O PDF do contrato assinado e o `texto_sha256` ficam guardados por obrigação legal; o jurídico precisa confirmar.

---

## 6. Edge Functions e integrações

**Módulo compartilhado `supabase/functions/_shared/`** (WP0, exceto onde indicado):
- `http.ts` (cors, json, erro);
- `chaves.ts` (o helper `chave()`, hoje repetido 4 vezes, e `clienteAdmin()` / `clienteDoUsuario(req)`);
- `turnstile.ts`: com `AMBIENTE=producao` e sem segredo, **recusa** em vez de liberar;
- `limite-ip.ts`;
- `modelo-contrato.ts` e `simulacao.ts` (WP4): **puros**, sem `Deno.*` nem `npm:`, testados no Vitest e importáveis pelo front via alias `@shared`;
- `pdf.ts` e `d4sign.ts` (WP4).

**Regras:**
- as operações de negócio chamam RPC com o **JWT do usuário**, e é o banco que aplica escopo e `aal2`;
- a service role serve só para Storage, Auth admin e as RPCs de sistema;
- toda função nova usa `verify_jwt = false` no `config.toml` e valida o JWT no código, como as atuais.

### 6.1 `pre-cadastro` (nova, pública) [WP2]

- **Entrada:** `POST { codigo, tipo_pessoa, nome, sobrenome?, documento, email?, telefone, termo_id, captcha }`.
- **Passos:**
  1. Limite por IP em `tentativas_publicas`: 10 erros ou 20 tentativas em 15 min → 429 (mesmo padrão do `cliente-login`).
  2. Turnstile.
  3. Formato: DV de CPF/CNPJ, telefone com pelo menos 10 dígitos, `termo_id` uuid.
  4. `rpc('crm_pre_cadastro', {…, p_ip, p_user_agent})` com a service role. A RPC:
     - resolve o código para um parceiro ativo e aprovado (corretor, ou gerente com A1; a Carteira Arken tem código próprio);
     - confere que `termo_id` é o vigente e revisado;
     - aplica a A2 com trava consultiva;
     - cria o cliente: `etapa novo_contato`, `origem pre_cadastro_link`, `portal_liberado` conforme `portal_libera_pre_cadastro` (padrão false), `exclusividade_ate`;
     - grava o consentimento (IP e navegador);
     - cria as 4 solicitações básicas (CRM-3);
     - grava timeline e auditoria (`origem='edge:pre-cadastro'`);
     - põe na fila `crm.boas_vindas` (sem link de portal quando não liberado) e `crm.novo_lead_corretor`.
- **Resposta:**
  - `200 {ok:true}` tanto para **criado quanto para duplicado**, para ninguém descobrir se um CPF está na base. O duplicado vai para `cliente_duplicidades`, e o dono vê na timeline "tentativa de cadastro duplicado" sem dizer por quem;
  - `404` para código inválido ou inativo;
  - `503` sem termo revisado;
  - toda tentativa é registrada.
- **Página** `/pre-cadastro/cliente/:codigo`: chama `rede_link_publico` e `lgpd_termo_vigente`; entrada em `src/content/seo.json` com `noindex` e fora do sitemap (o `spa.html` do `.htaccess` atende a rota).

### 6.2 Convite e definição de senha (`convidar-parceiros`, estendida, mesmo nome) [WP1]

**Corpo v2** `{ parceiro_ids: uuid[], modo: 'email' | 'link', origem }`. Para cada parceiro:
1. `userClient.rpc('rede_pode_convidar', {p_parceiro_id})` **com o JWT de quem chama**:
   - `modo='link'` só com `modo_link = true`;
   - `email_em_uso` ou `ja_ativo` → **nenhum link é gerado**. O resultado orienta: "este e-mail já tem conta; peça à equipe Arken para vincular" ou "use Esqueci a senha".
2. **`novo`:** `admin.auth.admin.generateLink({type:'invite', email, options:{data:{nome}, redirectTo}})` (modo link) ou `inviteUserByEmail` (modo e-mail).
   - os metadados **nunca** levam papel nem cadeia;
   - se o Auth responder "already registered" (corrida), para e devolve `email_em_uso`.
3. `admin.rpc('rede_vincular_login', {p_parceiro_id, p_profile_id})`, que só aceita o perfil recém-criado por aquele convite (§4.4) e define o papel pelo `parceiros.tipo`.
4. **`reenviar`** (já vinculado **a este parceiro** e nunca entrou): `generateLink({type:'recovery'})`. É o único caso de link para conta existente.
5. **O link não é o `action_link`.** A função monta `${origem}/parceiros/definir-senha?token_hash=<hashed_token>&type=invite|recovery`. A página só chama `verifyOtp` quando a pessoa clica em "Continuar", o que protege contra pré-visualização de link no WhatsApp e antivírus de e-mail que "clicam" antes. Os templates `convite.html` e `recuperar-senha.html` passam a usar `{{ .TokenHash }}` do mesmo jeito.
6. `admin.rpc('rede_registrar_convite', …)`: auditoria de quem gerou, para quem e o modo.

- **Token:** o do Supabase já é aleatório, de uso único e vale 24 h (`otp_expiry = 86400`), o que cumpre o SEG-7.
- **Corpo v1** (lista colada pelo admin): continua aceito **até o corte**, para a tela antiga seguir funcionando.
  - a checagem de papel passa a ser `userClient.rpc('is_admin')` (respeita `aal2`), em vez de ler `profiles` com a service role;
  - o fluxo v1 já não gera link para conta existente;
  - no corte, a tela nova só usa o v2; o v1 é removido no deploy da contração.
- **Aprovação de autocadastro** (`/parceiros/cadastro`, fluxo atual com confirmação de e-mail) não passa por aqui: é `rede_aprovar_autocadastro`.

### 6.3 `contrato-gerar` (nova, com JWT) [WP4]

1. `userClient.rpc('contrato_dados_modelo', {p_id})` (escopo e auditoria) devolve `{modelo:{id,versao,conteudo}, variaveis, codigo, pdf_versao}`.
2. `renderizarModelo(conteudo, variaveis)` em `_shared/modelo-contrato.ts`:
   - **marcação restrita `marcacao_v1`**, sem HTML: `#`, `##`, `###` (títulos), parágrafos, `**negrito**`, `*itálico*`, listas `-` e `1.`, `---` (quebra de página) e `{{variavel}}`;
   - o analisador próprio gera uma árvore neutra;
   - o **mesmo módulo** alimenta a prévia no front (React, sem `dangerouslySetInnerHTML`) e o PDF;
   - variáveis permitidas da doc: `{{codigo}} {{nome}} {{sobrenome}} {{cpf-cnpj}} {{logradouro}} {{numero}} {{bairro}} {{cidade}} {{estado}} {{cep}} {{valor-propriedade}} {{valor-parcela}}`;
   - acrescentadas ⚑: `{{data}} {{rg}} {{estado-civil}} {{nacionalidade}} {{complemento}} {{produto}} {{produto-matricula}} {{percentual-aporte}} {{valor-aporte}} {{valor-entrada}} {{base-parcelada}} {{numero-parcelas}} {{taxa-aporte}} {{valor-minimo-flex}} {{corretor-nome}} {{corretor-creci}} {{imobiliaria-nome}} {{vendedora-razao-social}} {{vendedora-cnpj}} {{vendedora-endereco}}`;
   - variável desconhecida ou **usada e vazia** → erro que lista os campos (nunca gera PDF incompleto);
   - todo valor é texto: não há como injetar marcação;
   - dinheiro sai como `R$ 1.808,33` (formatador com centavos em `_shared`; o `brl()` atual do front não mostra centavos). CPF e CNPJ saem mascarados.
3. **PDF com `npm:pdf-lib`** (JS puro, sem DOM nem navegador headless):
   - Helvetica padrão (WinAnsi cobre os acentos do português; caracteres fora dela são trocados por equivalentes);
   - quebra de linha por `widthOfTextAtSize`;
   - rodapé "Contrato nº X · página N de M";
   - a fonte Jost embutida (fontkit) é opcional ⚑.
   - **Prova de viabilidade no primeiro dia do WP4:** contrato de 15 páginas dentro do limite de CPU (cerca de 2 s). Plano B: gerar por partes.
4. `sha256` com `crypto.subtle` → upload para `contratos/<id>/minuta-v<n>-<sha8>.pdf` → `contrato_registrar_documento` (service role, com a versão esperada).

### 6.4 `contrato-assinatura` (nova, com JWT, só internos) e D4Sign [WP4]

1. `userClient.rpc('contrato_preparar_envio', {p_id})`:
   - valida a transição e as validações (PDF atualizado, modelo liberado, vendedora, signatários com e-mail, e-mail do cliente, valor igual ao atual do produto);
   - trava `envio_lock_em`;
   - devolve os signatários resolvidos.
2. Chamadas à API v1 do D4Sign (⚑ confirmar endpoints, campos e códigos no sandbox):
   - upload do PDF no cofre (`D4SIGN_COFRE_UUID`);
   - **grava na hora** `contrato_registrar_d4sign_uuid`, o que permite retomar sem duplicar;
   - lista de signatários;
   - webhook do documento em `…/d4sign-webhook?t=<token aleatório de 32 bytes>` (só o `sha256` do token é gravado);
   - disparo do envio.
3. `contrato_registrar_envio` (service role):
   - status `assinatura_pendente`;
   - linhas em `contrato_signatarios`;
   - efeito `imovel_no_contrato`;
   - cadeia congelada;
   - notificação `contratos.enviado`.
4. **Falha:**
   - `contrato_falha_envio` libera a trava;
   - o contrato fica em `em_analise`;
   - o erro vai para `integracao_chamadas`;
   - o reenvio reaproveita o `d4sign_uuid` já criado.
5. **Cancelar:** `{acao:'cancelar'}` → cancelamento no D4Sign → `userClient.rpc('contrato_mudar_status', {p_para:'cancelado', p_motivo})`.
6. O D4Sign exige token e chave na URL. Essas chamadas só acontecem entre servidores e **a URL nunca vai para log** (`integracao_chamadas` guarda só a operação).
7. **Credenciais:** sandbox em desenvolvimento e homologação (SEG-5); produção só no projeto de produção.

### 6.5 `d4sign-webhook` (nova, pública, validada por segredo) e `d4sign-reconciliar` (pg_cron) [WP4]

- **Validação:**
  - o `sha256` de `t` precisa bater com `contratos.webhook_token_hash` do `uuid` recebido, comparado em tempo constante;
  - se a conta enviar o cabeçalho HMAC (`Content-Hmac`), ele também é validado com `D4SIGN_HMAC_SECRET`;
  - **o conteúdo recebido nunca é aceito como verdade:** só dispara a reconsulta do documento e dos signatários na API.
- **Idempotência:** chave `sha256(uuid|type_post|email|sha256(corpo))` em `integracao_eventos` com `on conflict do nothing`. Evento repetido e já processado responde 200 sem refazer nada.
- **Todos assinaram:** baixa o PDF assinado, grava `contratos/<id>/assinado-<sha8>.pdf` e chama `contrato_registrar_retorno`, que atualiza o status por signatário e aplica os efeitos D5 (cliente → `finalizado`, `eventos_dominio`, notificação).
- **Recusa, cancelamento ou expiração:** `contrato_registrar_retorno` com o status → efeito `imovel_aprovado`.
- **Resposta:** 200 depois de gravar o evento. Se o processamento falhar, grava `erro` e responde 500; a reconciliação cobre.
- **`d4sign-reconciliar`:**
  - roda de hora em hora pelo pg_cron (pg_net com cabeçalho `x-cron-secret` do Vault);
  - consulta os contratos em `assinatura_pendente` sem atualização há mais de 1 h;
  - faz o mesmo processamento do webhook.

### 6.6 E-mails (Resend, reaproveitando `notificar`) [WP6]

- As RPCs só **inserem** na fila `notificacoes` (via `_notificar`, que respeita `notificacoes_config.ativo` e o consentimento revogado). O trigger chama o `notificar_evento()` que já existe. A função `notificar` trata `tabela='notificacoes'`:
  1. reserva a linha;
  2. resolve os destinatários pelos ids (service role);
  3. renderiza `notificar/modelos.ts`, com o mesmo layout retangular de hoje;
  4. envia e marca `status`.
- O pg_cron reenvia `pendente`/`erro` a cada 10 min, até 5 tentativas. Enquanto o **DNS do Resend não for verificado**, as mensagens ficam na fila e saem sozinhas depois.
- Os gatilhos atuais (novo parceiro, proposta, lead) não mudam.
- **Não entram**, por não estarem na lista da doc: e-mail de imóvel, de tarefa atribuída e de parceiro aprovado. O aviso fica só na tela.

### 6.7 Outras integrações

- **`cliente-login` (ajuste pequeno) [WP6]:** troca o `select … from clientes where cpf` pela RPC `portal_localizar_cliente(p_cpf)`, que só devolve cliente com `portal_liberado`, não inativado, não anonimizado e PF. A mensagem é a mesma de "não encontrado". A regra "só CPF", o limite por IP e o `portal_acessos` continuam.
- **`lgpd-anonimizar` [WP6]:** ver §5.5.
- **CEP [WP0]:** `src/lib/cep.ts` consulta o ViaCEP pelo navegador, com a BrasilAPI como alternativa, só para preencher o formulário (não há `Content-Security-Policy` no `.htaccess` que bloqueie). O servidor valida `cep ~ '^\d{8}$'` e a UF.

### 6.8 Segredos e configuração

- **Novos:** `D4SIGN_URL` (sandbox fora de produção), `D4SIGN_TOKEN`, `D4SIGN_CRYPT_KEY`, `D4SIGN_COFRE_UUID`, `D4SIGN_HMAC_SECRET` (se a conta tiver), `CRON_SEGREDO`, `AMBIENTE`.
- **Já existem:** `TURNSTILE_SECRET`, `RESEND_API_KEY`, `WEBHOOK_SECRET`, `SITE_URL`, `NOTIFICAR_PARA`.
- **Vault:** `d4sign_reconciliar_url`, `cron_segredo`.
- **`config.toml`** (WP0):
  - `[functions.*]` de todas as funções novas;
  - `[auth.hook.custom_access_token] enabled = true, uri = "pg-functions://postgres/public/hook_token_acesso"`;
  - `[auth.mfa.totp] enroll_enabled = true, verify_enabled = true`.
  - `enable_signup` continua `true`.

---

## 7. Front-end

### 7.1 Base compartilhada (WP0)

- **Permissões:**
  - `src/lib/escopo.tsx`: `useEscopo()` chama `meu_escopo()` pelo TanStack Query (chave `['escopo']`); o `AuthProvider` expõe `escopo`;
  - `src/lib/rpc.ts` + `src/lib/erros.ts`: `chamarRpc<T>(nome, args)` traduz erros para pt-BR (`42501` → "Você não tem acesso a este registro", igual para inexistente; `P0001` → a mensagem do servidor; `0A000` → "Em construção");
  - `src/lib/menu.ts`: registro de itens de menu, cada um com `requer: 'crm.ver'` etc. **O menu é derivado de `meu_escopo().permissoes`, mas nunca é a única barreira:** sem permissão, a RPC recusa;
  - `Protegido` aceita os papéis novos e `permissao?`;
  - redirecionamento no login: `admin`/`super` → `/admin`; `imobiliaria`/`gerente`/`corretor`/`parceiro` → `/parceiros/painel`; `cliente` → portal; `colaborador` → "acesso ainda não liberado".
- **Layouts:**
  - `src/pages/parceiros/PainelLayout.tsx` sai do `SiteLayout` e ganha barra lateral, como o `AdminLayout`;
  - telas de estado para `pendente`, `bloqueado`, `inativo` e "complete seu cadastro (CPF/CRECI/termo)";
  - `AdminLayout` redireciona para `/admin/seguranca` quando `mfa_exigido` e `aal1`;
  - o hook `useInatividade` (H1) é montado nos dois layouts.
- **Módulos em `src/modulos/<modulo>/`** (api, tipos, paginas, componentes):
  - a ficha, o kanban, as listas de contratos e de imóveis são **os mesmos componentes** no admin e no painel;
  - `useBase()` devolve o prefixo da rota (`/admin` ou `/parceiros/painel`);
  - o escopo é sempre decidido pelo servidor.
- **Kit de componentes** em `src/components/app/*`: `Modal`, `Abas`, `Etiqueta`, `ConfirmarModal`, `Paginacao`, `SeletorParceiro`, `SeletorCliente`, `CampoCep`, `CampoMoeda`, `SeloProvisorio`.
- **Estilo** conforme o `CLAUDE.md`:
  - **cantos retos** (nenhum `rounded-*`);
  - tokens `ink`, `ink-soft`, `sand`, `line`, `stone`, `muted`, `bronze`, `sage`; item ativo com `bg-stone text-ink`;
  - fonte Jost; lucide-react;
  - formulários com react-hook-form + zod + `Campo` + máscaras de `format.ts` + `toast`.

### 7.2 Rotas e telas por papel

| Rota | Papéis | Tela [WP] |
|---|---|---|
| `/pre-cadastro/cliente/:codigo` | público | Pré-cadastro de cliente: "Indicado por …", termo vigente com aceite obrigatório, Turnstile; mensagem de sucesso igual em todos os casos [2] |
| `/parceiros/cadastro` | público | Existente + CPF e CRECI obrigatórios (N8) + `termo_id` [1] |
| `/parceiros/definir-senha` | público | Consome `token_hash` só no clique e define a senha [1] |
| `/parceiros/painel` (índice) | parceiros aprovados | Empreendimentos (sem mudança) [0 move] |
| `/parceiros/painel/crm`, `crm/lista`, `crm/novo`, `crm/:id` | corretor, gerente, imobiliária | Kanban, lista, cadastro (A2 com resposta genérica), ficha [2, 3] |
| `/parceiros/painel/tarefas` | idem | Minhas tarefas / da equipe [3] |
| `/parceiros/painel/clientes` | — | Redireciona para `crm` [0] |
| `/parceiros/painel/equipe`, `equipe/:id` | gerente (seus corretores), imobiliária (gerentes e corretores) | Cadastrar e convidar (e-mail; link só com permissão), editar, transferir cliente ou corretor, inativar com destino obrigatório [1] |
| `/parceiros/painel/contratos`, `contratos/:id` | escopo | Lista, simulador, gerar PDF, enviar para análise, baixar, acompanhar assinaturas [4] |
| `/parceiros/painel/imoveis`, `imoveis/novo`, `imoveis/:id` | escopo E4 | Lista, editor, fotos, finalizar cadastro [5] |
| `/parceiros/painel/propostas` | como hoje | O cliente vem de `crm_clientes_opcoes()` e sai como `cliente_id` [2] |
| `/parceiros/painel/links` | corretor (e gerente com A1) | Link de indicação: copiar, WhatsApp, gerar novo [2] |
| `/parceiros/painel/meu-cadastro` | parceiros | Completar CPF e CRECI; aceitar o termo pendente [1] |
| `/admin` + `crm`, `crm/:id`, `tarefas`, `rede`, `rede/imobiliarias/:id`, `rede/parceiros/:id`, `rede/pendentes`, `duplicidades`, `contratos`, `contratos/:id`, `imoveis`, `imoveis/:id`, `auditoria`, `migracao`, `seguranca` | admin, super | Mesmos componentes com escopo total; aprovação de autocadastro e de imóveis; envio para assinatura; fila de duplicidades; pendências da migração; auditoria; 2FA [1–7] |
| `/admin/configuracoes/{geral,simulacao,modelos,signatarios,transicoes,permissoes,notificacoes,termos,equipe,anonimizacao}` | super (rota protegida **e** RPC só do Super) | Configurações com o painel "Regras provisórias" e o selo por campo [4, 6] |
| `/portal-do-cliente/meus-imoveis` | cliente | Existente + "Seu corretor", "Documentos solicitados" (envio, sem download dos pessoais), "Contratos" (status e PDF assinado) [6] |

### 7.3 Telas novas principais

**Kanban** (`src/modulos/crm/kanban/*`) [3]:
- **Filtros:** busca por nome; corretor, gerente ou imobiliária conforme o papel; "só os meus"; período.
- **Contadores do legado:** total ativo, finalizados e perdidos no período.
- **Colunas:** Novo contato, Contato iniciado, Documentação, Finalizado e **Perdidos** (recolhida, com contagem).
- **Cartão:** nome, WhatsApp (`whatsappBR`), corretor (para gestores), dias na etapa, documentos pendentes e tarefa atrasada. Clicar abre a ficha.
- **Arrastar** (HTML5 nativo, sem dependência nova):
  - as colunas proibidas (pela `status_transicoes` em cache e pelo papel) ficam esmaecidas, com dica ("Finaliza automaticamente quando o contrato é assinado");
  - soltar em Perdidos abre o modal de motivo;
  - soltar em Documentação pede confirmação ("serão solicitados: CPF, CNH…");
  - o cartão move na hora e volta se `crm_mudar_etapa` falhar (toast com a mensagem do servidor).
- **Acessibilidade:** menu "Mover para…" em cada cartão.
- **Paginação:** 50 por coluna, com "Ver mais".

**Ficha do cliente** (`src/modulos/crm/ficha/Ficha.tsx`, casca do WP0):
- **Carregamento:** por `crm_ficha` (auditada). A resposta traz os destinos de etapa e as permissões, para a tela bater com o servidor.
- **Abas:**
  - Timeline (padrão; agrupada por mês/ano) [3];
  - Dados (CEP automático) [2];
  - Notas (sem editar nem excluir) [3];
  - Tarefas ("atrasada" calculada) [3];
  - Documentos (solicitar, enviar em nome do cliente, analisar com motivo, baixar) [3];
  - Contratos [4];
  - Afiliados (cadeia **só nos níveis iguais ou abaixo** do usuário, histórico de transferências, botão Transferir) [2];
  - Portal (só internos: liberar, acessos, negócios e arquivos; é o antigo `/admin/clientes`) [2];
  - Propostas [2].

**Contrato** (aba e `contratos/:id`) [4]:
1. **Produto:** unidade de empreendimento (não vendida, valor de tabela) **ou** imóvel AP (busca por `#código` ou nome).
2. **Simulação:** forma, % de aporte, entrada, nº de parcelas.
   - a prévia é instantânea (`@shared/simulacao.ts`, rotulada "prévia");
   - "Salvar" envia **só as escolhas** e a tela passa a mostrar os valores oficiais devolvidos pelo servidor.
3. **Texto:** prévia do modelo com os dados; variáveis vazias viram a lista "complete na aba Dados".
4. **Gerar PDF:** versões guardadas; baixar é auditado.
5. **Enviar:** para análise (P) ou para assinatura (I). O modal mostra os signatários e explica cada bloqueio: e-mail do cliente, representante, modelo não liberado, razão social, valor do produto alterado.
6. **Painel de assinatura:** status por signatário, "Atualizar status", "Cancelar envio".
7. **Assinado:** PDF assinado e o aviso "Geração de parcelas: etapa financeira (pendente)".

**Editor de modelos (Super):**
- marcação restrita com paleta de variáveis;
- prévia com dados de exemplo;
- "Publicar nova versão";
- "Liberar para envio" (confirma a revisão jurídica).

**Imóvel** [5]:
- **Lista:** abas Todos, Rascunho, Pendentes, Revisão, Aprovados e No contrato; busca; 20 por página.
- **Editor:** seções Identificação, Endereço, Características, Adicionais e Fotos.
- **Fotos:** redimensionadas no navegador (canvas → WebP ≤ 1920 px + miniatura de 480 px), reordenáveis, limitadas por `imovel_fotos_max`.
- **Ações:** "Salvar rascunho" e "Finalizar cadastro" (IMV-2 validado no servidor, com a lista dos campos faltando).
- **Só internos:** Iniciar revisão, Aprovar, Devolver com observação. Histórico visível. Em NC, valor travado e link para o contrato.

### 7.4 O que muda nas telas existentes

| Tela | Mudança | WP |
|---|---|---|
| `parceiros/Login` | Redireciona pelo papel novo; mostra mensagem própria para inativo (token recusado) | 0 |
| `parceiros/Cadastro` | CPF e CRECI obrigatórios, termo versionado, texto "corretor autônomo, rede Arken" | 1 |
| `parceiros/NovaSenha` | Mantida para recuperação; o convite passa a usar `definir-senha` | 1 |
| `parceiros/Painel` | Vira `PainelLayout` (barra lateral, estados de acesso, menu pelo escopo) | 0 |
| `painel/Clientes` (`parceiro_clientes`) | Substituída pelo CRM (redirecionamento) | 2 |
| `painel/Propostas` e `admin/Propostas` | Pelas RPCs `propostas_*`; cliente do CRM; mostram a cadeia | 2 |
| `admin/Parceiros` | Substituída por `rede/*` (convite em lote pelo v2) | 1 |
| `admin/Clientes` (portal) | Lista do CRM com a aba Portal; "Novo cliente do portal" = cadastro + `crm_liberar_portal` | 2 |
| `admin/Leads` | Pelas RPCs `leads_*`: status, converter, descartar; excluir só `novo`; exportação auditada | 2 |
| `admin/Dashboard` | Pela `painel_resumo()` (sem `count` direto em `clientes`/`parceiro_clientes`); cartões do CRM | 6 |
| `admin/Relatorios` | Sem mudança na tela; `relatorio()` v2 conta todos os papéis de parceiro com as mesmas chaves JSON | 0 |
| `cliente/Portal` | Pelas RPCs `portal_*` (não usa mais `select('*')` em `clientes`); três seções novas | 6 |
| `Header`/`Footer`/SEO/`.htaccess` | Sem mudança | — |

### 7.5 Tipos

- `src/lib/types.ts` (WP0): tipos compartilhados — `Papel` com os 8 valores, `StatusParceiro` com `inativo`, `Escopo`, e reexportações.
- `src/modulos/<m>/tipos.ts`: criados **completos pelo WP0** a partir da §3. Os pacotes não os editam; tipos locais ficam no próprio `api-*.ts`.

---

## 8. Plano de implementação

### 8.1 Migrations em ordem

As existentes vão até `20260923000001` e **não são editadas**. Nenhum arquivo cita objeto de arquivo posterior.

| Arquivo | Dono | Conteúdo |
|---|---|---|
| `20260929000001_papeis_enum.sql` | WP0 | **Só** `alter type public.papel add value` (`super`, `imobiliaria`, `gerente`, `corretor`, `colaborador`) e `alter type public.status_parceiro add value 'inativo'` |
| `20260929000002_governanca_base.sql` | WP0 | Enums da §3.2; `configuracao_geral` (sem FKs) + linha única; `auditoria` + imutabilidade; `historico_status`; `eventos_dominio`/`eventos_consumo`; `notificacoes_config` + semente; `notificacoes` + trigger; `integracao_eventos`/`integracao_chamadas`; `tentativas_publicas`; `download_autorizacoes`; `lgpd_termos` + versão provisória; `lgpd_consentimentos`; `permissoes_rede` + semente; `migracao_decisoes`/`migracao_pendencias`; funções `carimbar()`, `auditar_linha()`, `cpf_valido`, `cnpj_valido`, `_auditar` |
| `20260929000003_papeis_helpers.sql` | WP0 | `is_admin`, `is_super`, `is_parceiro_aprovado` v2; `protege_campos_profile` v3; `handle_new_user` v2; `relatorio()` v2; `profiles.inativado_*` |
| `20260929000004_rede_esquema.sql` | WP0 | `imobiliarias`, `parceiros`, `parceiro_vinculos_historico`, triggers, semente da casa, FKs e ids em `configuracao_geral`, RLS ligada (políticas na 09) |
| `20260929000005_imoveis_esquema.sql` | WP0 | `imovel_tipos` + semente, `imoveis`, `imovel_fotos`, triggers (cadeia, IMV-3), bucket `imoveis` |
| `20260929000006_crm_esquema.sql` | WP0 | ALTER de `clientes` (com backfill da casa), `leads`, `propostas`; tabelas de CRM; `cliente_vinculos_historico`; triggers de cadeia, padrões e auditoria; grants por coluna em `clientes`; bucket `crm-documentos` |
| `20260929000007_contratos_esquema.sql` | WP0 | `parametros_simulacao` (semente ⚑), `contrato_modelos` (esqueletos), `contrato_signatario_regras` (semente D3), `contratos`, `contrato_signatarios`, `calcular_simulacao()`, `contratos_imutavel`; ALTER `cliente_documentos.contrato_id` e `cliente_negocios.contrato_id/imovel_id`; bucket `contratos` |
| `20260929000008_transicoes.sql` | WP0 | `status_transicoes` + semente completa da §3.8 + trigger de validação |
| `20260929000009_nucleo_funcoes_politicas.sql` | WP0 | Helpers de escopo (§4.1); funções internas **reais** (`_transicionar` e todos os efeitos, `_evento_cliente`, `_notificar`, `_evento_dominio`, `_autorizar_download`, `_crm_solicitar_documentos_basicos`); `hook_token_acesso`; **todas as políticas** das tabelas novas e dos buckets novos; políticas atuais reescritas (`neg`, `arq`, `obra`, `storage cli`, `prop`); view `configuracao_publica`; grants; **esqueletos de todas as RPCs da §4.4** com grants finais |
| `20260929000010_rede_rpc.sql` | WP1 | Corpos das RPCs `rede_*` |
| `20260929000011_crm_cadastro_rpc.sql` | WP2 | Corpos de cadastro, ficha, lista, duplicidades, `leads_*`, `propostas_*`, `crm_pre_cadastro` |
| `20260929000012_crm_funil_rpc.sql` | WP3 | Corpos de kanban, etapa, notas, tarefas, documentos |
| `20260929000013_contratos_rpc.sql` | WP4 | Corpos de `contrato_*` e `config_publicar_*` |
| `20260929000014_imoveis_rpc.sql` | WP5 | Corpos de `imovel_*` |
| `20260929000015_governanca_rpc.sql` | WP6 | Corpos de auditoria, LGPD, `config_atualizar`, `equipe_definir_papel`, `portal_*`, `painel_resumo`, `notificacoes_reenviar`, `auditoria_purgar` |
| `20260929000016_agendamentos.sql` | WP6 | `pg_cron` + tarefas: reconciliação D4Sign (hora em hora), fila de notificações (10 min), purga e limpezas (mensal). Todas sem efeito enquanto o Vault não tiver os segredos. |
| `<data>_corte_dados.sql` (ex.: `20261005000001`) | WP7 | Migração da §2.4 lendo `migracao_decisoes`; `clientes.corretor_id/gerente_id/imobiliaria_id` NOT NULL; revogações da §4.3; auditoria `migracao` |
| `<data>_contracao_legado.sql` (ex.: `20261102000001`) | WP7 | `papel 'parceiro'` → `'corretor'` para quem tem vínculo; `parceiro_clientes` → `legado_parceiro_clientes` (sem acesso); remove `propostas.parceiro_cliente_id`; `clientes.origem` padrão `cadastro_interno` e fim do ramo `portal_admin`; `protege_campos_profile` v4 (status só por RPC); esvazia `migracao_decisoes` |

As datas dos dois últimos arquivos são ilustrativas: o timestamp real é o do dia em que forem criados.

### 8.2 Sequência de deploy (sem quebrar o que está no ar)

1. **Expansão (01 a 16)** pode ser aplicada a qualquer momento com `supabase db push`, depois de `supabase db reset --local` e `npm run test:db` passarem. O front antigo continua funcionando porque:
   - tudo é aditivo;
   - o insert da tela antiga do admin cai na Carteira Arken pelo trigger, com `portal_liberado=true`;
   - o portal continua igual (políticas reescritas com a mesma semântica);
   - as colunas que a tela antiga grava continuam com grant.
2. **Funções:** publicar `cliente-login` (ajustada), `notificar`, `convidar-parceiros` (v1 e v2), e as novas `pre-cadastro`, `contrato-gerar`, `contrato-assinatura`, `d4sign-webhook`, `d4sign-reconciliar`, `lgpd-anonimizar`. Gravar segredos e o Vault (D4Sign **sandbox**).
3. **Antes da janela:**
   - rodar `scripts/migracao/previa.sql` e revisar com o negócio;
   - preencher `migracao_decisoes`;
   - fazer backup (`supabase db dump`);
   - definir o Super (N2): `update public.profiles set papel = 'super' where email = '<dono>';` pelo SQL editor;
   - o Super cadastra o TOTP.
4. **Janela avisada (cerca de 15 min):**
   - aplicar o corte (17);
   - rodar `npm run build` e enviar `dist/` para o `public_html` na hora.

   Durante a janela, telas antigas de parceiro e admin que leem `clientes`, `leads`, `propostas` ou `parceiro_clientes` falham, com aviso publicado. Site público, portal e relatórios não são afetados.
5. **Contração**, com o front novo estável (cerca de 4 semanas): aplicar a 18 e publicar `convidar-parceiros` sem o v1.
6. **Runbook pós-go-live:**
   - preencher vendedora (N7) e signatários (D3);
   - publicar os parâmetros da Arken (N14);
   - publicar e liberar os modelos revisados;
   - publicar o termo LGPD revisado (H4, libera o pré-cadastro);
   - ligar `exigir_mfa_interno` depois que todos os internos cadastrarem o TOTP;
   - trocar o D4Sign para produção;
   - trocar as chaves reais do Turnstile.

### 8.3 Pacotes de trabalho e posse de arquivos

**Onda 0: WP0 Fundação (um agente, sequencial; nada da onda 1 começa antes dele entrar)**
- **Migrations:** 01 a 09.
- **`supabase/`:**
  - `supabase/config.toml` (funções, hook, MFA);
  - `supabase/functions/_shared/{http,chaves,turnstile,limite-ip}.ts`;
  - `supabase/tests/_fixtures/rede.psql`, `nucleo.test.sql`, `invariantes.test.sql`, `escopo.test.sql`, e os ajustes em `rls.test.sql` e `relatorio.test.sql`.
- **`src/lib/`:**
  - `types.ts`, `escopo.tsx`, `rpc.ts`, `erros.ts`, `menu.ts`, `cep.ts`, `provisorias.ts`, `auth.tsx`;
  - `format.ts` (+ `cnpjValido`, `mascaraCnpj`, `mascaraCep`, `moedaParaNumero`, `brlCentavos`);
  - `constants.ts` (etapas, status e rótulos);
  - `src/lib/menu.test.ts`, `src/lib/format.test.ts`.
- **Componentes e páginas:**
  - `src/components/Protegido.tsx`, `src/components/app/*`;
  - `src/App.tsx` com **todas** as rotas, apontando para páginas e abas esqueleto em `src/modulos/**` que cada pacote preenche;
  - `src/modulos/<m>/tipos.ts` completos, `src/modulos/crm/ficha/Ficha.tsx` (casca);
  - `src/pages/admin/AdminLayout.tsx`, `src/pages/parceiros/PainelLayout.tsx` (novo), `src/pages/parceiros/Painel.tsx`, `src/pages/parceiros/Login.tsx`;
  - `src/hooks/useInatividade.ts`.
- **Configuração e testes E2E:**
  - `vite.config.ts` (`test.include` + `supabase/functions/_shared/**/*.test.ts`; alias `@shared` só para os módulos puros);
  - `tsconfig.app.json` (`paths` de `@shared`; **não** inclui a pasta `_shared` inteira, para o `tsc -b` não puxar código Deno);
  - `e2e/apoio.ts` (`simularRpc(page, nome, resposta)` e `meu_escopo` simulado).

**Onda 1: seis agentes em paralelo, cada um só nos seus arquivos**

| Pacote | Arquivos de posse exclusiva |
|---|---|
| **WP1 Rede** | `…000010_rede_rpc.sql`; `supabase/functions/convidar-parceiros/index.ts`; `supabase/templates/{convite,recuperar-senha}.html`; `src/modulos/rede/**`; `src/pages/admin/Parceiros.tsx`; `src/pages/parceiros/{Cadastro,NovaSenha,DefinirSenha}.tsx`; `src/lib/convites.ts` (+ teste); `supabase/tests/rede.test.sql`; `e2e/rede.spec.ts` |
| **WP2 CRM cadastro, ficha, leads, propostas, pré-cadastro** | `…000011_crm_cadastro_rpc.sql`; `supabase/functions/pre-cadastro/**`; `src/modulos/crm/{api-clientes.ts, paginas/{Lista,NovoCliente,Links,Duplicidades}.tsx, ficha/{AbaDados,AbaAfiliados,AbaPortal,AbaPropostas}.tsx, componentes/FormCliente.tsx}`; `src/pages/publicas/PreCadastro.tsx`; `src/pages/admin/{Leads,Clientes,Propostas}.tsx`; `src/pages/parceiros/painel/{Clientes,Propostas}.tsx`; `src/content/seo.json`; `scripts/gerar-seo.mjs` (só a exclusão de `/pre-cadastro` do sitemap, se necessário); `supabase/tests/crm_cadastro.test.sql`; `e2e/{crm-cadastro,pre-cadastro}.spec.ts` |
| **WP3 CRM funil e atividades** | `…000012_crm_funil_rpc.sql`; `src/modulos/crm/{api-funil.ts, paginas/{Funil,Tarefas}.tsx, kanban/**, ficha/{AbaTimeline,AbaNotas,AbaTarefas,AbaDocumentos}.tsx}`; `src/modulos/crm/funil.ts` (+ teste: destinos de arraste); `supabase/tests/crm_funil.test.sql`; `e2e/funil.spec.ts` |
| **WP4 Contratos e D4Sign** | `…000013_contratos_rpc.sql`; `supabase/functions/{contrato-gerar,contrato-assinatura,d4sign-webhook,d4sign-reconciliar}/**`; `supabase/functions/_shared/{simulacao,modelo-contrato,pdf,d4sign}.ts` e `simulacao.vetores.json`, com os `*.test.ts`; `src/modulos/contratos/**`; `src/modulos/crm/ficha/AbaContratos.tsx`; `src/modulos/config/{Simulacao,Modelos,Signatarios}.tsx`; `supabase/tests/contratos.test.sql`; `e2e/contratos.spec.ts` |
| **WP5 Imóveis** | `…000014_imoveis_rpc.sql`; `src/modulos/imoveis/**` (inclui a redução de imagem); `supabase/tests/imoveis.test.sql`; `e2e/imoveis.spec.ts` |
| **WP6 Governança, portal, notificações, configurações** | `…000015_governanca_rpc.sql`, `…000016_agendamentos.sql`; `supabase/functions/{notificar,cliente-login,lgpd-anonimizar}/**`; `src/modulos/{governanca,portal}/**`; `src/modulos/config/{Geral,Transicoes,Permissoes,Notificacoes,Termos,Equipe,Anonimizacao,RegrasProvisorias}.tsx`; `src/pages/cliente/Portal.tsx`; `src/pages/admin/{Dashboard,Auditoria,Seguranca}.tsx`; `supabase/tests/{auditoria,lgpd,portal}.test.sql`; `e2e/{portal,permissoes}.spec.ts` |

**Onda 2: WP7 Corte, contração e integração (um agente, sequencial)**
- As migrations de corte e contração; `scripts/migracao/previa.sql`.
- `src/modulos/governanca/paginas/Migracao.tsx` e `migracao_pendencias_resolver`: a assinatura já está na 09; o corpo entra no arquivo de corte.
- `supabase/tests/{migracao,escopo_ponta_a_ponta}.test.sql`.
- `e2e/fluxos.spec.ts` (atualiza os 5 fluxos atuais).
- Ajustes finais em `src/App.tsx` e `src/lib/menu.ts` (única exceção à posse do WP0).
- `docs/PRD.md` (§3, §4, §5, §11, §12, §13 e decisões N1–N20) e `CLAUDE.md` (regras novas: RPC primeiro para dado de cliente, helpers de escopo, migrations por pacote, assinaturas congeladas).
- Regressão completa.

### 8.4 Pontos de integração compartilhados

- **Só o WP0 edita**, e depois o WP7: `src/App.tsx`, `src/lib/menu.ts`, `src/lib/types.ts`, `src/modulos/*/tipos.ts`, `src/lib/{auth.tsx, escopo.tsx, rpc.ts, erros.ts, format.ts, constants.ts}`, os layouts, `config.toml`, `vite.config.ts`, `tsconfig.app.json`, `_shared/{http,chaves,turnstile,limite-ip}.ts` e as migrations 01–09. Um pacote que precise de algo novo anota no próprio PR e o WP7 aplica. Coluna ou função nova fora do contrato só em migration **aditiva** dentro do próprio arquivo do pacote.
- **Contrato entre pacotes:**
  - as assinaturas da §4.4, que já existem como esqueleto na 09;
  - as funções internas reais da 09 (`_transicionar` com todos os efeitos, `_evento_cliente`, `_notificar`, `_evento_dominio`);
  - nenhum pacote chama corpo de outro pacote em teste.
- **Tipos de notificação:** os valores semeados em `notificacoes_config`. Só o WP6 edita `notificar`; os outros só chamam `_notificar`.
- **Storage:** buckets e políticas nascem no WP0; os pacotes só gravam e leem pelos caminhos da §3.10.
- **Front:** as abas da ficha e as páginas nascem como esqueleto no WP0, com o nome de export final. Cada pacote preenche os seus arquivos, então o `tsc -b` passa em qualquer ordem.

### 8.5 Plano de testes

**Fixture comum:** `supabase/tests/_fixtures/rede.psql`.
- A extensão `.psql` não é coletada como teste; cada teste inclui com `\ir _fixtures/rede.psql`. O WP0 valida no `npm run test:db`. Se o CLI não aceitar `\ir`, a alternativa é uma função `testes_fixture_rede()` criada dentro de cada arquivo por um bloco copiado.
- Conteúdo:
  - Imob A: gerentes GA1 e GA2; corretores CA1a (sob GA1) e CA2a (sob GA2); usuário IA.
  - Imob B: gerente GB1; corretor CB1a; usuário IB.
  - Clientes c1 (CA1a), c2 (CA2a), c3 (CB1a), c4 (GA1, pelo A1).
  - Usuários admin, super, titular de c1 no portal, parceiro inativo e parceiro bloqueado.
  - Os dados são inseridos como `postgres`, **nunca** por RPC de outro pacote.

**pgTAP** (`npm run test:db`):

| Arquivo | Dono | Casos principais |
|---|---|---|
| `invariantes.test.sql` | WP0 | Toda função `security definer` de `public` tem `search_path` em `proconfig`; lista branca do que `anon` executa (`is_admin`, `lgpd_termo_vigente`, `rede_link_publico`); nenhuma RPC de sistema executável por `authenticated`; toda tabela de `public` com RLS; depois do corte, `has_table_privilege('authenticated', t, 'select') = false` para `clientes`, `leads`, `propostas`, CRM, contratos e `auditoria` |
| `nucleo.test.sql` | WP0 | `_transicionar`: transição inexistente, papel errado, motivo ausente, validação falha, efeitos aplicados uma vez; `auditoria` não aceita update, delete nem truncate (nem pela `service_role`); purga só com a variável ligada; `protege_campos_profile` v3 (admin não se promove a super; ninguém entra ou sai de `inativo` pela API); `is_admin` com `exigir_mfa_interno=true` e `aal1` → falso; hook recusa inativo |
| `escopo.test.sql` | WP0 | Linhas diretas da §4.5: `select` em `clientes` e CRM, storage sem autorização, `parceiros` por papel (GA1 vê CA1a e não CA2a; IA vê A inteira; IB não vê A), sem coluna `cpf`, imóveis E4, propostas por cadeia, inativo e bloqueado veem zero, políticas reescritas do portal |
| `rede.test.sql` | WP1 | Matriz de cadastro; PAR-4; transferir corretor move os clientes **na mesma transação** e grava histórico; GA1 não transfere c1 para CA2a (outra equipe); inativar sem destino ou com destino fora do escopo falha; PAR-6; regularização só uma vez e só Super; `rede_vincular_login` recusa perfil antigo, já logado ou de outro e-mail; `rede_pode_convidar` devolve `email_em_uso` |
| `crm_cadastro.test.sql` | WP2 | A2 dentro e depois do prazo (datas simuladas): `indisponivel` sem detalhe, nunca transfere; mesmo dono → `ja_na_sua_carteira`; limite por hora; `crm_ficha` grava `acesso/consultar` com `cliente_id`; negação devolve nulo e grava `acesso_negado`; lista grava os ids e não o texto da busca; pré-cadastro cria NC, 4 documentos, consentimento e `portal_liberado=false`; conversão de lead |
| `crm_funil.test.sql` | WP3 | Todos os pares de transição × papel; NC → DO falha; CI → DO cria 4 documentos sem duplicar se repetir; PE sem motivo falha; reativar limpa o motivo; FI manual falha; responsável de tarefa fora do escopo falha; tarefa some de `crm_minhas_tarefas` após a transferência; documento: tamanho e MIME reais, análise por `permissoes_rede`, titular não baixa |
| `contratos.test.sql` | WP4 | Vetores de simulação (bloco `-- VETORES:INICIO … FIM`, os mesmos do JSON); limites de 12 e 360; entrada maior que o aporte falha; flexível sem mínimo falha; **valor = valor do produto** (o front não manda valor); valores imutáveis fora de `rascunho`; cascata não mexe na cadeia depois do envio; `contrato_registrar_retorno` aplicado duas vezes gera 1 transição e 1 evento; `assinado` seguido de `recusado` é ignorado; assinado → cliente FI + `eventos_dominio`; imóvel NC no envio e volta a AP no cancelamento; um contrato ativo por produto; RPCs de sistema negadas a `authenticated` |
| `imoveis.test.sql` | WP5 | IMV-2 na saída do rascunho (lista de campos); IMV-3; corretor não altera `status` por update (grant de coluna); RE → RA sem observação falha; visibilidade E4 (cadeia acima vê o rascunho; outro parceiro só vê AP/NC); limite de fotos |
| `auditoria.test.sql`, `lgpd.test.sql`, `portal.test.sql` | WP6 | `auditoria_consultar` registra a própria leitura; o log não contém valores pessoais (conferência de chaves e de padrões de CPF e e-mail); anonimização zera os campos pessoais e **preserva** valores e datas de contratos, vínculos e eventos; depois dela `portal_localizar_cliente` não encontra; `portal_*` só do próprio titular; contrato em rascunho invisível ao titular; `portal_liberado=false` não é encontrado |
| `migracao.test.sql` | WP7 | Dados legados de exemplo → contagens esperadas; cliente do portal **nunca** muda de dono; conflitos viram pendência; `migracao_decisoes` prevalece; mapa das propostas; CPF inválido vira nota |
| `escopo_ponta_a_ponta.test.sql` | WP7 | A §4.5 inteira com todos os corpos implementados |

**Vitest** (`npm test`):
- `supabase/functions/_shared/simulacao.test.ts` [WP4]:
  - FIN-1/FIN-2 em centavos inteiros, com arredondamento igual ao `round()` do Postgres;
  - vetores de `simulacao.vetores.json`, por exemplo: valor 500.000, aporte 30%, entrada 50.000, 60×, taxa 8,5% → aporte 150.000,00; base 100.000,00; parcela 1.808,33; total 108.500,00; resíduo 0,20. E 300.000 × 30% − 10.000 = base 80.000; 60× → 1.446,67;
  - `simulacao.sincronia.test.ts` confere que o bloco de vetores do `contratos.test.sql` é igual ao JSON.
- `supabase/functions/_shared/modelo-contrato.test.ts` [WP4]: análise da marcação, variável desconhecida, variável vazia bloqueia, marcação dentro de valor vira texto, CPF e CNPJ mascarados, dinheiro com centavos.
- `supabase/functions/_shared/pdf.test.ts` [WP4]: quebra de linha e paginação determinísticas, troca de caracteres fora do WinAnsi.
- `supabase/functions/_shared/d4sign.test.ts` [WP4]: token em tempo constante, HMAC, chave de idempotência, mapeamento de status.
- `src/lib/format.test.ts` (CNPJ, CEP, moeda), `src/lib/menu.test.ts` (menu a partir das permissões) [WP0], `src/modulos/crm/funil.test.ts` (destinos de arraste a partir de `status_transicoes`) [WP3], `src/lib/convites.test.ts` [WP1].

**Playwright** (rede simulada, mesmo padrão de `e2e/apoio.ts`, com `**/rest/v1/rpc/<nome>`):
- pré-cadastro com Turnstile e termo; resposta idêntica para criado e duplicado;
- corretor cadastra cliente, move no kanban NC → CI (chama `rpc/crm_mudar_etapa`); Perdidos exige motivo; coluna FI desabilitada;
- gerente transfere cliente; imobiliária transfere corretor e inativa com destino;
- convite: a página `definir-senha` não consome o token antes do clique;
- menu por papel (corretor não vê Equipe; `/admin` digitado redireciona; colaborador vê "acesso ainda não liberado");
- contrato: o corpo de `contrato_criar` e `contrato_atualizar_simulacao` **não contém valores calculados nem `valor`** (SEG-4); envio simulado; status "Assinado" depois da reconciliação;
- imóvel RA → PE com campos faltando listados;
- Super publica parâmetros;
- portal mostra documentos solicitados e envia arquivo;
- os 5 fluxos atuais continuam passando.

**Antes de concluir cada pacote:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:db` (com `supabase db reset --local`), `npm run test:e2e` e `npm run build`.

---

## 9. Riscos, pendências e o que o negócio precisa responder

### 9.1 Riscos técnicos e operacionais

| Risco | Mitigação |
|---|---|
| Janela entre banco e front na Hostinger (deploy manual) | Expandir, cortar, contrair (§8.2). O corte é aplicado junto com o upload; o site público e o portal nunca são afetados. |
| Um único projeto Supabase (produção); SEG-5 pede sandbox | Desenvolvimento em `supabase start` com D4Sign sandbox em `supabase/.env`. ⚑ Projeto de homologação ou branching (custo). Backup antes do corte. |
| Valor novo de enum usado na mesma transação | Arquivo 01 isolado. Nenhuma função, política ou semente cita os papéis novos antes da 02. |
| Geração de PDF no limite de CPU das Edge Functions | pdf-lib + marcação restrita; prova de viabilidade no início do WP4; plano B: gerar por partes. Serviço externo exigiria decisão. |
| Detalhes da API e do webhook do D4Sign (códigos de `type_post`, recusa, HMAC, credencial fora da query string) | Nunca confiar no conteúdo recebido, sempre reconsultar; testes no sandbox; reconciliação de hora em hora |
| DNS do Resend não verificado (PRD §13) | A fila `notificacoes` guarda e reenvia. Nenhum fluxo depende do e-mail chegar, exceto o convite por e-mail de gerente e imobiliária (o link fica só com os internos até o DNS sair). |
| Desempenho da RLS e das RPCs com escopo | Helpers escalares em `(select …)`; índices `(corretor_id, etapa)`, `(gerente_id, etapa)`, `(imobiliaria_id, etapa)`; paginação por coluna do kanban |
| Front mais verboso sem embeds do PostgREST (tudo por RPC) | RPCs devolvem `jsonb` já montado; testes de escopo por RPC |
| Recursos que dependem do plano (inatividade de sessão, hook de verificação de senha, PITR) | ⚑ Confirmar o plano. O hook de token, o TOTP e o pg_cron funcionam no gratuito. Backup diário com teste de restauração a cada trimestre, num branch ou localmente (requisito da doc). |
| `cliente-login` concentra verificações de OTP no IP da Edge (limite `token_verifications`) | Risco já existente; monitorar. Se aparecer, subir o limite. |
| Portal por CPF com escopo ampliado (N1) | `portal_liberado` com padrão falso, envio sem download, contratos só a partir do envio, auditoria. **Recomendação formal:** endurecer o `cliente-login` antes de ativar contratos no portal. |
| Duas fontes de papel durante a transição (`profiles.papel` × `parceiros.tipo`) | O escopo e as permissões vêm só de `parceiros`; o `papel` serve para liberar áreas. A contração alinha os dois. |
| Sequestro de lead pelo link de indicação (CPF alheio cadastrado para ganhar exclusividade) | Auditoria com IP; resposta genérica; limite por IP; conflitos vão para a fila interna. A regra A2 precisa ser confirmada. |
| Link de senha visível para quem convida (fluxo por WhatsApp) | Só internos por padrão (`convite_por_link`); cada link gerado é auditado; token consumido só no clique |
| Um pacote atrasado bloqueia a integração | Esqueletos com assinatura congelada; testes de cada pacote não dependem de corpos de outros; o WP7 roda a regressão ponta a ponta |

### 9.2 Pendências que bloqueiam o go-live desta etapa

| # | Item | O que bloqueia |
|---|---|---|
| 1 | **H4:** texto de consentimento revisado | O pré-cadastro público |
| 2 | **N7:** razão social, CNPJ e endereço da Arken | O envio para assinatura; a Imobiliária Arken fica sem CNPJ |
| 3 | **Modelos de contrato da Arken** (textos Parcelado e Flexível; os da Ocka não estão no repositório) | O envio (sem `liberado_para_envio`) |
| 4 | **D3:** signatários e e-mail do representante Arken | O envio, de propósito |
| 5 | **N2:** quem é o Super | As configurações críticas |
| 6 | **N14:** parâmetros de simulação da Arken (e `valor_minimo_flex`) | O plano flexível; o parcelado roda com a semente provisória |
| 7 | **Conta D4Sign da Arken:** sandbox e produção, cofre, HMAC | A assinatura |
| 8 | **N1/N9:** reconfirmar o login só por CPF com o escopo ampliado | Ativar documentos e contratos no portal |
| 9 | **N15:** decisões de migração (conflitos de CPF, etapa dos clientes do portal), a partir do `previa.sql` | A janela de corte |
| 10 | DNS do Resend e chaves reais do Turnstile | E-mails e anti-spam real |

### 9.3 Decisões provisórias que precisam de confirmação (sem bloquear)

- **Parceiros:** A1–A8 (destaques: A2 com bloqueio pós-prazo; A4 e o enquadramento dos legados na casa; N3; N18 autocadastro pelo site; N19 bloqueado × inativo; `convite_por_link` só para internos).
- **CRM:** F1–F4 (voltar etapa; quem analisa documento; o corretor envia documento em nome do cliente; nota sem edição); estado civil "divorciado"; N12 base legal do consentimento declarado.
- **Contratos:** D1–D6; N16 preço de tabela; N17 base parcelada; N4/N5 unidade × imóvel e status da unidade; N13 FI manual; arquivar contrato assinado (proibido nesta etapa); quem envia para assinatura (hoje só internos).
- **Imóveis:** E2–E5; limite de 20 fotos de 5 MB.
- **Segurança:**
  - H1, H2 e H5 dependem do plano do Supabase;
  - H3: 60 meses para o que a doc não classificou;
  - N20: admin lê a auditoria.
- **Notificações:** N10.

### 9.4 Perguntas que precisam de resposta antes da etapa financeira

- **Comissões:**
  - **B1** percentuais (a `comissao_perfil` e a `cargo` dizem o inverso uma da outra);
  - **B2** comissão do gerente e de onde sai;
  - **B3** comissão de dentro dos 8,5% ou adicional;
  - **B4** quando fica disponível;
  - **B5** transferência e comissões futuras e passadas (os dados para qualquer resposta já existem: cadeia congelada no contrato e `cliente_vinculos_historico`);
  - quem recebe pelos clientes da **Carteira Arken** (virtual);
  - para onde vai o 0,5% do Super Agente, que não existe mais (A5).
- **Saques:** C1 mínimo, C2 aprovador (com 2FA, H5), C3 prazo e taxa, C4 limite por período; onde guardar dados bancários e PIX (tabela própria, LGPD).
- **CTR-4 completo:**
  - vencimento da 1ª parcela e dia de vencimento;
  - resíduo de arredondamento (proposta: última parcela);
  - correção (IGPM?) e juros (`juros_ao_mes`, hoje só exibido);
  - mínimo de R$ 250 por pagamento (hoje só no JavaScript) e a regra das "5 próximas parcelas";
  - o que `arquivado` ou distrato significam para as parcelas.
- **Status de pago único** (o legado mistura `C` e `F`).
- **Parâmetros:** `taFinanceiro`, `jurosAoMes`, `igpmAtual` entram no cálculo? E5 (`valorParaProntos`, `pontosParaValor`, `retorno01`).
- **Gateway:** continua o Asaas (conta da Arken)? Sandbox; validação do webhook; rotação da chave vazada no legado (integracoes §1); cadastro do cliente no primeiro pagamento; formas PIX, cartão e boleto.
- **N6:** importar clientes, contratos e parcelas ativas da Ocka, e a conciliação com o Asaas deles? É a maior incerteza do financeiro. Se sim, vira um pacote de migração próprio (S/AD → super/admin, AN → imobiliária, AI → corretor, CL → cliente, SA dependendo de A5).
- **D2:** contrato de Investimento; **D4:** prazo e lembretes (ativam `expirado`); **E1:** frações no contrato e no financeiro.

### 9.5 Sem prazo, mas registradas

- A3: vários níveis de gerência.
- A5, A6, A7: Super Agente, construtora e captador, Investidor.
- D6: assinar contratos de serviço.
- G1–G3: Capital Humano.
- I1, I2.
- Autocadastro de parceiro por link de indicação.
- Acesso de PJ ao portal.
- Fonte Jost embutida no PDF.

## 10. Ajustes da revisão antes da implementação (28/09/2026)

Estes ajustes **prevalecem** sobre o que está acima quando houver conflito.

### 10.1 Não há front novo no ar: corte e contração viram um passo só
Fatos: o deploy na Hostinger (backlog 10 do PRD) ainda não aconteceu e o banco remoto só tem dados de teste (3 perfis: admin de demonstração, parceiro de teste e 1 cliente do portal; 3 `parceiro_clientes`, 1 `clientes`, 5 propostas, 0 leads). Por isso:
- a migration de corte e a de contração viram **uma só**, `20260929000017_corte_contracao.sql` (WP7), aplicada junto com as demais; não há janela nem espera de semanas (§8.2 passos 4 e 5 deixam de existir);
- `convidar-parceiros` tem só a versão nova (sem v1);
- as telas atuais que leem `clientes`, `parceiro_clientes`, `leads` e `propostas` são **reescritas pelo pacote dono direto sobre as RPCs**; elas não precisam funcionar no meio do caminho. Ao final precisam funcionar: site público, portal por CPF, relatórios, notificações e os fluxos E2E (atualizados pelo WP7);
- a migração de dados da §2.4 e o `scripts/migracao/previa.sql` continuam (rodam sobre os dados de teste e ficam prontos para dados reais);
- as migrations 01–16 continuam sem referência para frente e não podem quebrar o `supabase/seed/seed_wordpress.sql` nem os testes;
- o banco remoto só recebe as migrations (`supabase db push`) e as funções depois de tudo passar localmente, no fim do WP7.
- **Exceção (28/09/2026, a pedido do usuário, para o painel abrir durante o desenvolvimento):** as migrations **01–09 (WP0) já foram aplicadas no remoto**, depois de backup e de ensaio sobre uma cópia dos dados reais. A partir daqui elas **não são editadas**: qualquer correção nelas entra em migration nova (WP7). As 10–16 e a 17 continuam só no fim.

### 10.2 Banco local isolado por pacote
Vários agentes em paralelo não podem dividir o mesmo `supabase db reset`. Cada pacote usa um banco próprio pelo script `testar-db.sh` (pasta de rascunho da sessão), com nome e porta exclusivos:
- aplica a base (migrations até `20260929000009`) + as migrations do próprio pacote e roda os testes do WP0 + os do pacote;
- ninguém roda `supabase db start`/`db reset`/`db push` na pasta do repositório durante a onda 1;
- a imagem do Postgres é a do remoto (`supabase/.temp/postgres-version` = 17.6.1.166). A imagem padrão da CLI 2.101 (17.6.1.106) derruba o servidor (segfault) quando `anon` chama uma função sem permissão.

### 10.3 E2E em paralelo
`playwright.config.ts` lê `E2E_PORTA` (padrão 5190). Cada pacote roda só os próprios specs, na própria porta.

### 10.4 WP0 dividido
- **Banco** (sequencial): 01–05; depois 06–09; depois a fixture e os testes do WP0 (que também corrigem o que acharem nas 01–09).
- **Front** e **Edge/config** em paralelo com o banco.
- Contrato entre eles: as assinaturas da §4.4 (nomes e tipos dos parâmetros) e `src/modulos/*/tipos.ts`, que define o formato do `jsonb` devolvido por cada RPC. Os corpos escritos na onda 1 devolvem exatamente esse formato.

### 10.5 Posse de arquivos
Nenhum agente faz commit. Quem precisar de mudança em arquivo de outro pacote não edita: registra no retorno, e o WP7 aplica.

### 10.6 Fechamento: limite por IP como reserva atômica (revisão dinâmica, FR1-01)
O limite por IP das rotas públicas (`cliente-login`, `enviar-lead`, `pre-cadastro`; §3.9, §6.1) não é mais "conferir no início e gravar no
fim": uma rajada de requisições simultâneas do mesmo IP via a contagem vazia e passava inteira (varredura de CPFs no portal, teto
global derrubado por um IP só, centenas de leads e e-mails de confirmação). A migration `20260929000019` cria as RPCs de sistema
`tentativas_reservar(jsonb)` e `tentativas_confirmar(bigint[])` (só `service_role`): a reserva confere a janela e grava a tentativa como
FALHA na mesma transação, sob trava consultiva por (rota, IP), com vários baldes na mesma chamada (o login do portal reserva o do IP
e o global, todos ou nenhum, travas em ordem crescente); a Edge confirma o sucesso no fim (`concluir(true)`). Quem cai no meio do
caminho fica contado como falha. Consequências aceitas: requisições em andamento contam como erro (10 simultâneas por IP; depois de
concluídas com sucesso, as vagas voltam) e o banco fora do ar, ou sem a migration, recusa com 503 (falha fechada). A tabela continua
só com select e insert para a `service_role`; o update acontece só dentro dessas funções.

### 10.7 Fechamento da implementação (29/09/2026): o que a construção mudou no desenho
Vale o que está aqui quando divergir das §1 a §9. O roteiro de publicação está em `docs/RUNBOOK_DEPLOY.md` (detalhe técnico do banco e das funções em `scripts/migracao/DEPLOY.md`); o resumo para o negócio, em `docs/PRD.md` §11 a §13.

**Numeração e estado das migrations (corrige §8.1 e §10.1).** O corte e a contração são **a 18**, não a 17; a 17 virou "ajustes de integração" e a 19 é nova.

| Arquivo | Estado | Conteúdo |
|---|---|---|
| `20260929000001` a `…09` | **No remoto, congeladas** (backup e ensaio antes; nunca mais editar) | WP0 |
| `…10` a `…16` | No repositório, ainda não no remoto | WP1 a WP6 (§8.1), com as correções da revisão feitas nos próprios arquivos |
| `…17_ajustes_integracao.sql` | Idem | Correções que caberiam nas 01–09 (por isso em migration nova): `revoke update on profiles` de `authenticated`; `auditar_linha_gravar` executável por `supabase_auth_admin` (o `deleteUser` do GoTrue dispara o gatilho de auditoria); aviso "novo parceiro" como gatilho de restrição adiado (avalia `invited_at` no commit) e que ignora só conta do portal marcada; `_auditar` v3 (teto de `acesso_negado` por ator: 30 em 10 min, depois um registro-resumo sem id nem titular); `pode_enviar_documento` v2 e `pode_enviar_foto_imovel` (tetos de Storage, em "Segurança do fechamento"); `_status_transicoes_valida` v2 |
| `…18_corte_contracao.sql` | Idem | Corte e contração num passo só (§10.1; detalhe em "Migração de dados" abaixo): legado e mapas, `_migracao_corte()`, `clientes` NOT NULL na cadeia, revogações da §4.3, `protege_campos_profile` v4, exceção controlada de guardas para a anonimização, `migracao_pendencias_resolver` |
| `…19_tentativas_reserva.sql` | Idem | `tentativas_reservar(jsonb)` e `tentativas_confirmar(bigint[])` (§10.6) |

Regra daqui em diante: enquanto o `db push` das 10–19 não acontecer, elas podem ser corrigidas no próprio arquivo; depois dele, ficam congeladas como as 01–09. Uma correção nas 01–09 vai sempre para migration nova (o próximo número livre, mesmo padrão).

**Download de `crm-documentos` e `contratos` (corrige §4.3, a linha `createSignedUrl` de §4.5, §6 e §8.2).** Os dois buckets **não têm política de SELECT** para `authenticated` (com SELECT, quem tem autorização vigente assinava URL com a validade que quisesse e a URL escapava da auditoria). O caminho é RPC mais Edge:
1. `crm_documento_baixar`, `contrato_baixar` ou `portal_contrato_baixar`, com o JWT do usuário, conferem o escopo, gravam a auditoria e a autorização em `download_autorizacoes` (validade `download_ttl_segundos`) e devolvem `{bucket, path, expira_em}`. O titular do portal não baixa pelo CRM; arquivo removido pela anonimização (`removido_em`) não baixa.
2. O front chama `urlDoDownload(autorizacao)` (`src/lib/rpc.ts`), que faz POST na Edge **`baixar-arquivo`** com o mesmo JWT (`{bucket, path}`; `verify_jwt = false`, o JWT é validado no código por `exigirUsuario`).
3. A Edge lê com a service role a `download_autorizacoes` vigente **daquele usuário** para o mesmo bucket e caminho, e assina a URL até o fim da autorização (teto de 3600 s, arredondando para baixo). Sem autorização vigente responde 403; arquivo inexistente, 404. A service role não decide permissão: quem decidiu foi a RPC.
4. Nunca usar `createSignedUrl` nem `download()` no navegador nesses buckets: sempre falha. Nos E2E, `simularDownload` (`e2e/apoio.ts`). O host da URL vem do `SUPABASE_URL` do runtime (público na nuvem, `kong:8000` na stack local), coberto por `supabase/functions/baixar-arquivo/host.test.ts`.
5. O upload em `crm-documentos` tem só a política de INSERT (nunca houve SELECT para quem envia); a conferência com a Storage API real (`INSERT … RETURNING`, metadata e dono) é item da stack real (§10.8).

**Migração de dados como foi implementada (detalha e corrige §2.4 e §5.4).**
- A lógica está em `public._migracao_corte()` (interna, sem grant, idempotente: só processa o que ainda não migrou); a 18 a chama uma vez e depois esvazia `migracao_decisoes`. O `migracao.test.sql` roda a mesma função sobre dados legados de exemplo.
- `parceiro_clientes` vira `legado_parceiro_clientes` **sem política e sem grant** (nem da service role); não fica "só leitura para o dono". O destino de cada linha está em `migracao_parceiro_clientes` (`cliente_id` NOT NULL e `resultado`), e o vínculo das propostas em `migracao_propostas`. Os mapas não têm grant; a anonimização os usa para limpar também o legado do titular.
- CPF que já pertence a um cliente existente (do portal **ou** do CRM): a linha **não migra** e o cliente existente nunca troca de dono, nem com decisão `dono_cpf`. Pendências `cpf_conflito_portal` e `cpf_conflito_cliente`; a transferência é decidida depois, pela ficha. `dono_cpf` só vale entre os parceiros que têm aquele CPF (senão vale o mais antigo, A2).
- Cadastros juntados (mesmo CPF, mesmo parceiro): telefones extras e interesses unidos; o RG divergente de cada cadastro juntado vira nota e, se nome ou RG divergirem, abre a pendência `juntada_divergente` (pode ser outra pessoa com o CPF digitado errado; separar é decisão humana pela ficha). RG longo demais, telefone com mais de 20 dígitos e nome diferente viram nota; notas acima de 10.000 caracteres são quebradas.
- Parceiro legado: CPF só é copiado se tiver DV válido e não for de outro parceiro (senão `cpf_parceiro_invalido`); o e-mail é sempre o de `auth.users`; **pendente com carteira** entra `bloqueado` (N19), com a pendência `parceiro_pendente_com_clientes`. Dono antigo sem vínculo ativo: o cliente vai para a Carteira Arken (`dono_sem_vinculo`); a carteira de parceiro bloqueado continua com ele.
- **Parceiro legado que nunca teve `aprovado` no histórico** só é desbloqueado por `rede_desbloquear_parceiro` com CPF e CRECI preenchidos (`_rede_faltam_cpf_creci_legado`, WP7RN-01). Quem já foi aprovado volta sem exigência; a reativação devolve o vínculo mas com o acesso bloqueado até completar o cadastro.
- O histórico de vínculo do cliente migrado abre na data do corte (o gatilho não aceita `vigente_de` retroativo); a data original fica em `clientes.created_at` e no mapa. `exclusividade_ate` = cadastro original + `exclusividade_dias`.
- **O corte não cria consentimento `migracao`** (contraria §5.4, de propósito: não fabricar aceite que não existiu). A ficha mostra "sem consentimento", o que não bloqueia e-mails (só param quando há revogação). A base legal dos dados antigos e das notas migradas com dado pessoal é decisão do jurídico (PRD §13.1, item 11).
- Proposta legada só recebe o cliente migrado se o autor é interno ou o próprio dono; nos outros casos fica sem cliente, com a cadeia do autor e a pendência `proposta_cliente_outro_parceiro`.
- `scripts/migracao/previa.sql` é um SELECT único (roda no SQL editor), lê o estado de antes do corte e mostra CPF completo só na seção de conflito entre parceiros; a saída tem dado pessoal e não se guarda. Tem 10 seções (a 10 são as juntadas divergentes) e falha de propósito depois do corte.

**Segurança do fechamento (revisão final).**
- **Portal** (`cliente-login`): a conta do Auth nasce com `app_metadata.portal_cliente_id`; conta que só tenha o e-mail interno nunca é adotada (403 e auditoria `seguranca/portal_conta_recusada`); a conta legada (confirmada na criação) recebe o marcador no primeiro login. Limite por IP: IPv6 pela /64, IP nulo em balde comum, mais teto global de 300 falhas ou 600 tentativas em 15 min (custo aceito: um ataque pode tirar o portal do ar por janelas de 15 min). Antes do banco ter a 15 o login cai na leitura direta só no erro `0A000`; depois da 19, sem a RPC de reserva o portal responde 503.
- **`enviar-lead`** foi para `criarRota`/`lerJson`/`validarCaptcha` (falha fechada em produção sem `TURNSTILE_SECRET`: 503), CORS só de `SITE_URL` e `REGRA_ENVIAR_LEAD` (10 erros ou 20 envios em 15 min por IP, pela reserva atômica). `pre-cadastro` e `cliente-login` também reservam antes de processar.
- **Storage:** teto de 20 objetos sem registro por usuário nos dois buckets, 10 por pasta de documento **e por usuário**, e `2 × imovel_fotos_max + 10` por pasta de imóvel (o objeto já registrado não conta). Não há rotina que apague órfãos pela API do Storage (Edge com service role); hoje a equipe limpa pelo painel.
- **LGPD:** `lgpd_anonimizar_cliente` também troca `cliente_arquivos.nome` e o caminho por marcador e `cliente_negocios.descricao` por `[removido — LGPD]`; devolve `paths_portal` (objetos do bucket `cliente-arquivos`, além de `paths`) e a Edge `lgpd-anonimizar` apaga por bucket.
- **Transições (WP7RN-04):** `_status_transicoes_valida` v2 não deixa desligar (`ativa = false`, 23514) nenhuma saída de `assinatura_pendente` (assinado, recusado, expirado, cancelado) nem a troca imóvel `aprovado` ↔ `no_contrato`; `em_analise → assinatura_pendente` continua desligável para suspender envios.
- **Config e Auth:** `otp_length = 10` (código do e-mail com 10^10 combinações; a validade de 24 h dos convites é mantida) — o `[auth]` remoto não foi lido antes, então o diff do `config push` é a conferência. Hook `custom_access_token`, TOTP habilitado e todas as funções com `verify_jwt = false` (a autenticação é no código). Versão exata do `supabase-js` para as funções em `_shared/supabase-js.ts` (2.116.0, a do `package-lock.json`); não há `deno.lock` (sem Deno na máquina de desenvolvimento).
- **Front e hospedagem:** `public/.htaccess` com HSTS (15552000 s, sem `includeSubDomains`) e CSP aplicada (fixa o endereço do projeto Supabase; qualquer serviço externo novo pede atualização); o zod roda em `jitless` (`src/lib/zod-config.ts`, primeiro import de `main.tsx`) para a CSP não bloquear a sonda de `eval`. `npm run conferir:dist` (`scripts/conferir-dist.mjs`) reprova o `dist/` com chave de TESTE do Turnstile, sem chave real (`0x4…`) ou com `sb_secret_`/JWT `service_role`; o build local usa a chave de teste do `.env` de propósito, então o guarda fica no `conferir:dist`, não no `build`.

**Regras de negócio que a implementação fechou.**
- **N13 (corrige §1.2):** Finalizado sem contrato assinado **não** é liberável pelo Super: a validação de `status_transicoes` é fixa (o Super edita só `papeis`, `exige_motivo` e `ativa`). Liberar exigiria mudança de sistema.
- `painel_resumo` conta contratos pela mesma regra de `contratos_listar` (cadeia do cliente ativo), inclusive depois de transferência de cliente (WP7RN-05).
- `contratos_listar` aceita `imovel_id` e `unidade_id` (cruzados com o escopo e registrados na auditoria); o front usa isso no link "Ver contrato" do imóvel (`contratoDoImovel`), no lugar da busca por nome.
- O portal encerra a sessão por inatividade (H1) como o painel: o `AuthProvider` passou a consultar `meu_escopo()` também para `cliente` (a função já devolvia `sessao_inatividade_horas` a qualquer perfil); sem o escopo vale o padrão de 8 h.
- A importação do espelho de vendas (front) **nunca apaga**: compara o CSV com o cadastro lido do servidor por nome normalizado, atualiza só campos que mudam, cria só as novas e confirma com resumo; nome repetido no arquivo recusa tudo; falha parcial é avisada (o arquivo é reenviado). Não há `unique (empreendimento_id, identificador)`, por isso não há upsert.
- Front: barreira de erro (`LimiteErro`, com recarga única por minuto para chunk antigo, `src/lib/modulos.ts`), consultas com erro tratado em vez de "vazio", exclusões com confirmação, tokens `whatsapp` e `perigo`, `/admin/migracao` implementada.

**Ordem de deploy (substitui §8.2; detalhe em `docs/RUNBOOK_DEPLOY.md`).** Backup → ensaio com dados reais → `previa.sql` e decisões → segredos e Vault → **`cliente-login` novo antes do banco** (a versão antiga abriria o portal aos clientes migrados do CRM; ela responde 503 até o passo seguinte) → `db push` das 10–19 → demais funções → `config push` → front (`build` + `conferir:dist`) → Super pelo SQL → TOTP → `exigir_mfa_interno` → pós-go-live (§8.2 passo 6 da versão original).

**Como testar (complementa §8.5 e §10.2, §10.3).**
- Banco isolado: `scripts/testar-db.sh <nome> <porta> "<extras>" "<testes>"` (no repositório desde 29/09; `BASE_ATE=20260929999999` para todas as migrations); nunca `supabase start`, `db start` ou `db reset` na pasta do repositório. pgTAP com a fixture `_fixtures/rede.psql` incluída por `\ir` (funcionou no CLI; a alternativa da §8.5 não foi necessária). Última rodada completa: 2.144 asserções, antes da 19 (que acrescenta `tentativas.test.sql` e altera `fechamento.test.sql` e `invariantes.test.sql`, ainda não rodados juntos porque o Docker parou).
- Vitest (`npm test`, ~600 testes) inclui `supabase/functions/**` e `scripts/**`; E2E com rede simulada (`npm run test:e2e`, `E2E_PORTA`; 140 fluxos contra o build de produção com a CSP); `e2e-real/` roda contra a stack Supabase local completa, sem simular rede. Os scripts que sobem a stack real (`verificar.sh` e simuladores de D4Sign e Resend) ficaram fora do repositório; decidir se viram `scripts/stack-real/`.

### 10.8 O que continua sem prova (a stack real)
- Upload pela Storage API em `crm-documentos` e `imoveis` com as políticas novas e tetos (a contagem depende de `owner_id`/`owner` preenchidos pelo Storage); `baixar-arquivo` e `lgpd-anonimizar` com o Storage real; `cliente-login` com `createUser(app_metadata)` e `verifyOtp` na conta marcada, na legada e com conta hostil; `hook_token_acesso` com o GoTrue real; as rajadas do limite por IP (o teste de 60 conexões foi em Postgres real com stubs, fora do Supabase).
- Formato real do webhook do D4Sign e do `Content-Hmac` (só o sandbox confirma); cabeçalhos de IP que chegam às Edge Functions no remoto (`cf-connecting-ip` × `x-forwarded-for`; se o proxy só acrescentar ao `x-forwarded-for`, o primeiro item é forjável e o limite por IP fica contornável).
- Adiados por exigirem GoTrue: recusar no banco o `signUp` com o domínio do portal (hoje a defesa é o marcador) e auditar login de papel `cliente` no hook (o `portal_acessos` já registra todo sucesso). Limpeza automática de objetos órfãos do Storage e limite por destinatário do e-mail de confirmação do pré-cadastro também ficaram fora.

### 10.9 Decisões do dono de 29/09/2026 (migrations 23 e 24)
Substituem a A2 provisória da §1.1 e a linha `crm_cadastrar_cliente` da §4.4/§4.5 no que divergirem.
- **Exclusividade por atividade (`20260929000023_exclusividade_atividade.sql`).** `exclusividade_dias` = 180. Gatilho `exclusividade_renovar` (AFTER INSERT em `cliente_eventos`, `_exclusividade_renovar`): nos tipos de atividade (`_exclusividade_tipos_atividade()`: cadastro, pré-cadastro, etapa, nota, tarefas, documentos, contratos, transferência, propostas), `exclusividade_ate` = agora + dias, nunca encurta; ator com papel `cliente` (ou o `user_id` do próprio titular) não renova; ator nulo (sistema/webhook) renova; `tentativa_duplicada`, `consentimento` e `migracao` não renovam. Recálculo único na migration: última atividade (ou o cadastro) + 180, sem encurtar.
- **Cadastro com documento de outro dono** (`_crmcad_cadastrar`, usado por `crm_cadastrar_cliente` e `leads_converter`, e `crm_pre_cadastro`, todos `create or replace` com a mesma assinatura): se quem cadastra não vê o cliente e `_exclusividade_livre` (prazo registrado e vencido; ativo; sem contrato de rascunho a assinado; origem ≠ `portal_admin`; sem portal liberado nem login do portal), `_exclusividade_transferir` trava a linha, confere de novo e move por `_rede_mover_clientes` (motivo "exclusividade vencida"), grava a tentativa já resolvida (`transferido_exclusividade`, novo valor do check), audita (`tentativa_duplicada` com de/para) e avisa o antigo dono (`crm.exclusividade_transferida`) e o novo (`crm.novo_lead_corretor`, se não foi ele). Resposta: `{situacao:'transferido', id}` (no pré-cadastro, `duplicado`, igual ao visitante). Dentro do prazo: `{situacao:'indisponivel', id:null, exclusividade_ate}` — a data só quando o motivo é o prazo; com contrato ou do portal, sem data. `crm_duplicidades_listar` aceita o filtro novo. Entre imobiliárias não precisa do Super (a regra é do dono, não uma decisão de pessoa).
- **Portal sem financeiro (`20260929000024_portal_solicitacoes.sql`).** Tabelas `negocio_marcos` (negócio × tipo: contrato_assinado, obra, vistoria, entrega_chaves; datas prevista/realizada, observação até 500) e `portal_solicitacoes` (tipo da lista fechada, negócio opcional do titular, mensagem até 2000, status aberta → em_atendimento → concluída, resposta obrigatória para concluir), ambas com RLS e **sem grant** a anon/authenticated. Titular: `portal_linha_do_tempo()`, `portal_solicitacoes()`, `portal_solicitar(p_tipo, p_negocio_id, p_mensagem)` (sempre por `_portal_cliente_id()`; 5 pedidos em 24 h e 10 em aberto). Equipe (`is_admin()`): `crm_portal_marcos(p_cliente_id)`, `crm_portal_marco_salvar(...)` (realizada nunca no futuro; tudo nulo apaga), `crm_portal_solicitacoes(p_filtros)`, `crm_portal_solicitacao_atualizar(p_id, p_status, p_resposta)`. "Contrato assinado" sem data registrada usa `assinado_em` do contrato do negócio. Aviso à equipe `portal.solicitacao` (internos ativos; só ids, tipo e número). Gatilho `portal_anonimizar_textos` limpa mensagem, resposta e observações quando `clientes.anonimizado_em` é preenchido. A Edge `notificar` ganhou os modelos dos dois tipos novos (precisa de redeploy).

### Arquivos críticos para a implementação

- `G:\arkenincorporadora\supabase\migrations\20260921000001_schema_inicial.sql`: helpers, `profiles`, `clientes`, `propostas` e as políticas reescritas na 09.
- `G:\arkenincorporadora\supabase\migrations\20260921000002_grants_e_ajustes.sql`: padrão de grants explícitos e `protege_campos_profile`.
- `G:\arkenincorporadora\supabase\migrations\20260921000005_notificacoes.sql`: `notificar_evento()`, reaproveitado pela fila.
- `G:\arkenincorporadora\supabase\functions\cliente-login\index.ts`: portal só por CPF; passa a usar `portal_localizar_cliente`.
- `G:\arkenincorporadora\supabase\functions\convidar-parceiros\index.ts`: convite v1 e v2.
- `G:\arkenincorporadora\src\App.tsx` e `G:\arkenincorporadora\src\lib\types.ts`: rotas e tipos fechados no WP0.
