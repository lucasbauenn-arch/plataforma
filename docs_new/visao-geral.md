# Visão Geral do Sistema OCKA

> **Atualizado em 28/09/2026** a partir do código do sistema legado (PHP) para servir de base à reconstrução em um projeto **Vite**.
> Legenda usada em toda a documentação:
> - **Existe hoje**: comportamento confirmado no código atual.
> - **Requisito do novo sistema**: regra que o sistema novo deve ter, mesmo que o atual não tenha.
> - ⚠️ **Decisão pendente**: ver [decisoes-pendentes.md](./decisoes-pendentes.md).

## O que é o OCKA?

O **OCKA** é uma plataforma imobiliária que combina **CRM de vendas**, **rede de parceiros** (imobiliárias, gerentes e corretores) e um **modelo de aquisição de imóveis com aporte próprio + financiamento pela Ocka**, incluindo a venda de **frações de imóveis**. A Ocka Negócios Imobiliários Ltda. é a vendedora nos contratos de compra e venda.

## Objetivos

- Gestão de leads e clientes com funil de vendas
- Rede de parceiros hierárquica com visibilidade por vínculo ([area-parceiros.md](./area-parceiros.md))
- Contratos gerados a partir de modelos, com **assinatura digital**
- Cobrança de parcelas via **gateway de pagamento** e **divisão automática de comissões**
- Cadastro de imóveis e **frações**
- Gestão da equipe interna (capital humano)

## Módulos

| Módulo | Situação hoje | Documento |
|---|---|---|
| **Área de Parceiros** | Existe parcialmente (hierarquia S → AD → SA → AN → AI → Cliente); regra nova definida | [area-parceiros.md](./area-parceiros.md) |
| **CRM** | Existe | [modulo-crm.md](./modulo-crm.md) |
| **Imobiliário** (imóveis e frações) | Existe | [modulo-imobiliario.md](./modulo-imobiliario.md) |
| **Financeiro** (parcelas, comissões, saques) | Existe | [modulo-financeiro.md](./modulo-financeiro.md) |
| **Capital Humano** (equipe interna) | Existe | [modulo-capital-humano.md](./modulo-capital-humano.md) |
| **Configurações** (parâmetros e modelos de contrato) | Existe, só para o perfil Super | [modulo-financeiro.md](./modulo-financeiro.md) |
| Jurídico, Treinamento, Investimento | **Não existem**: são links de menu sem página. Não reconstruir sem definição. | ⚠️ |

## Fluxo principal do negócio

```
Lead cadastrado por um parceiro → Contato → Documentação → Simulação/Contrato
→ Assinatura digital → Cobrança das parcelas → Divisão da comissão → Saque pelo parceiro
```

### Etapas do funil (existe hoje, campo `statusContato` do cliente)
| Código | Etapa |
|---|---|
| `NC` | Novo Contato (padrão ao cadastrar) |
| `CI` | Contato Iniciado |
| `DO` | Documentação |
| `FI` | Finalizado (venda concluída) |
| `PE` | Perdido |

## Integrações externas (existem hoje)

| Serviço | Uso |
|---|---|
| **Asaas** | Cadastro do cliente e cobrança das parcelas |
| **D4Sign** | Assinatura digital de contratos e documentos |
| **MailerSend / SMTP** | E-mails transacionais (boas-vindas, senha, notificações) |
| Geração de PDF | Contratos em PDF a partir dos modelos |

Detalhes em [integracoes.md](./integracoes.md).

## Sistema legado (referência)

| Item | Situação |
|---|---|
| Back-end | PHP sem framework (MVC próprio), **PHP 7.2 em produção** (sem suporte desde 2020) |
| Banco | MySQL/MariaDB, 26 tabelas. Ver [modelo-dados.md](./modelo-dados.md) |
| Front-end | HTML renderizado no servidor + jQuery + Bootstrap 5.3 |
| Testes automatizados | **Nenhum** |
| Log de auditoria | **Não existe** |
| Controle de acesso | Login por CPF/CNPJ e senha. Restrições por perfil feitas **principalmente na tela**, não no servidor (ver [area-parceiros.md §8.3](./area-parceiros.md)) |

> A pasta `docs/` descreve o **negócio**. A tecnologia do sistema novo (Vite no front-end; back-end a definir) não deve copiar a arquitetura do legado.

## Requisitos não funcionais do novo sistema

Estes itens constavam na documentação antiga como se já existissem, mas **não existem no sistema atual**. Passam a ser requisitos do novo sistema:

- **Controle de acesso no back-end** em toda consulta e ação (regra de ouro, [area-parceiros.md §7](./area-parceiros.md))
- **Log de auditoria** de cadastro, edição, transferência e consulta de dados de cliente
- **LGPD:** consentimento, log de acesso, anonimização a pedido do titular
- **Sessão:** expiração por inatividade e limite de tentativas de login ⚠️ (definir valores)
- **Backup** diário com teste de restauração
- **Testes automatizados** das regras de permissão e de cálculo de comissão
- **Inativar em vez de excluir** registros com histórico

## Roadmap citado na documentação antiga (não iniciado)

App mobile, IA para qualificação de leads, integração com portais imobiliários, chat integrado, relatórios de BI.
