# Decisões Pendentes

> Pontos que **o negócio precisa decidir antes (ou durante) a construção** do novo sistema.
> Quem for implementar: **não invente a resposta**. Use a opção marcada como "sugestão" apenas como padrão provisório, deixe-a configurável quando possível, e sinalize.
> Atualizado em 28/09/2026.

## A. Área de Parceiros (bloqueiam o início)

| # | Pergunta | Contexto | Sugestão |
|---|---|---|---|
| A1 | O **gerente** pode cadastrar cliente direto, ou só o corretor? | Se puder, é preciso "corretor virtual" ou campo de responsável. | Permitir, gravando o gerente também como corretor responsável. |
| A2 | Em caso de **cliente duplicado** (mesmo CPF), quem é o dono e por quanto tempo vale a exclusividade? | Hoje só o pré-cadastro público bloqueia CPF/e-mail duplicado entre usuários ativos. | Primeiro cadastro por CPF, 90 dias de exclusividade. |
| A3 | Uma imobiliária pode ter **mais de um nível de gerência** (gerente geral → gerente de equipe)? | Afeta o modelo de dados (níveis fixos ou árvore livre). | Começar com um nível; modelar para permitir crescer. |
| A4 | **Corretor autônomo** (sem imobiliária) pode se cadastrar? | A regra atual exige imobiliária → gerente. | Criar uma "imobiliária Ocka" para autônomos. |
| A5 | O **Super Agente** (gestor regional acima das imobiliárias) continua existindo? | Existe hoje, com 4 usuários, e recebe 0,5% de comissão. Não aparece na nova regra. | — (decisão do negócio) |
| A6 | O perfil **Agente de Negócios** hoje cobre "imobiliária, construtora, captador e outros". Vira só **Imobiliária**? | Construtoras e captadores precisam de outro perfil? | — |
| A7 | Existe o perfil **Investidor**? | O código cita a sigla `IV` e há e-mail de pré-cadastro de investidor, mas não há regra. | — |
| A8 | O que é o perfil `C` do sistema atual? | Valor padrão do banco, tratado como funcionário interno. 2 usuários. | Colaborador Ocka (interno). |

## B. Comissões (bloqueiam o Financeiro)

| # | Pergunta | Contexto |
|---|---|---|
| B1 | Quais são os **percentuais corretos**? | O cálculo usa AN 2%, AI 0,5%, SA 0,5% (tabela `comissao_perfil`); a tabela `cargo` diz o **inverso** (AI 2%, AN 0,5%). |
| B2 | Qual é a comissão do **Gerente** e de onde ela sai? | Nível novo; hoje a divisão é só entre SA, AN, AI e Ocka. |
| B3 | As comissões saem **de dentro** dos 8,5% da Ocka (como hoje) ou são **adicionais**? | Hoje: total distribuído = 8,5% do valor pago. |
| B4 | **Quando a comissão fica disponível** para saque? | Hoje nada muda o status para "creditada"; depende de ajuste manual. Sugestão: X dias após o pagamento confirmado. |
| B5 | Se o cliente for **transferido** de corretor, as comissões futuras vão para o novo corretor? E as passadas? | Não existe transferência hoje. |

## C. Saques

| # | Pergunta | Hoje |
|---|---|---|
| C1 | Valor mínimo | R$ 100 (só na tela). A documentação antiga dizia R$ 50. |
| C2 | Quem pode aprovar/rejeitar | Qualquer um, até sem login. |
| C3 | Prazo de pagamento e taxa | Não definido; a tela cita "20 dias" e "48 horas" sem regra. |
| C4 | Limite de saques por período | Não existe. |

## D. Contratos

| # | Pergunta | Contexto |
|---|---|---|
| D1 | Status `R` é **Rascunho** ou **Rejeitado**? | O código usa os dois significados em telas diferentes. |
| D2 | `tipoContrato = 2` é **Investimento** ou **Serviço**? | A lista diz Investimento; o salvamento trata como Serviço. |
| D3 | Quem são os **signatários** do contrato? | Hoje: e-mail da empresa, o cliente e **dois e-mails pessoais do Gmail fixos no código**. |
| D4 | Prazo para assinatura e lembretes | Não existem hoje. |
| D5 | O que acontece quando todos assinam? | Hoje nada: o contrato fica "Assinatura pendente" para sempre (não há retorno do serviço de assinatura). |
| D6 | Contratos de **serviço de parceiro** (corretor, imobiliária, super agente) são assinados? | Hoje só têm pré-visualização. |

## E. Imóveis e frações

| # | Pergunta | Contexto |
|---|---|---|
| E1 | Como funcionam as **frações**? Quantas por imóvel, valor por fração, soma = valor do imóvel? | Hoje é só uma marcação "usar em contrato de fração" por imóvel. |
| E2 | Quem aprova um imóvel e qual é o fluxo **Rascunho → Pendente → Revisão → Aprovado → No contrato**? | Hoje nada leva o imóvel além de "Pendente". |
| E3 | Tipos de imóvel | Hoje: Casa, Apartamento, Terreno. Precisa de Comercial, Rural, Sala etc.? |
| E4 | Quem pode cadastrar imóvel? | Hoje qualquer usuário logado; só o criador edita. |
| E5 | Significado de `valorParaProntos`, `pontosParaValor`, `retorno01` (configuração) e do adicional **"Chip"** do imóvel | Não identificado no código. |

## F. CRM

| # | Pergunta | Contexto |
|---|---|---|
| F1 | Como um lead vai para **Perdido** e volta? | Hoje o kanban tem só NC, CI, DO, FI; "Perdido" é só um contador. |
| F2 | Há **validação** ao mudar de etapa? (ex.: exigir documentos para ir a "Documentação") | Hoje não há nenhuma. |
| F3 | A **timeline** deve registrar eventos automaticamente? Quais? | Hoje nada grava eventos nela. |
| F4 | **Aprovar/rejeitar documento** enviado pelo cliente: quem faz e como? | Os status existem (P, A, R, EA), mas não há tela. |

## G. Capital Humano

| # | Pergunta |
|---|---|
| G1 | O módulo continua no novo sistema? Com **ponto eletrônico** (entrada/saída, tolerância, banco de horas)? Hoje só existe a tabela, com uma marcação por linha e sem tela. |
| G2 | Comunicados internos e permissões granulares: manter? Hoje as tabelas existem, mas as rotas estão desligadas. |
| G3 | Status de funcionário: só Ativo/Inativo ou também Férias/Licença? |

## H. Segurança, sessão e LGPD

| # | Pergunta | Sugestão |
|---|---|---|
| H1 | Tempo de expiração da sessão por inatividade | 8 h |
| H2 | Limite de tentativas de login e tempo de bloqueio | 5 tentativas, 15 min |
| H3 | Retenção de logs de auditoria | 5 anos para eventos financeiros; 2 anos para acesso |
| H4 | Texto e versão do termo de consentimento LGPD | Jurídico define |
| H5 | 2FA para perfis internos e aprovadores de saque? | Sim |

## I. Escopo

| # | Pergunta |
|---|---|
| I1 | Jurídico, Treinamento e Investimento (links do menu atual sem página): entram no novo sistema? |
| I2 | Itens da documentação antiga nunca implementados (score de leads, distribuição automática, WhatsApp, relatórios, multa por atraso etc.): entram na primeira versão? Ver a seção "ideias" no fim de cada módulo. |
