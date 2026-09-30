# Documentação do Sistema OCKA

Plataforma imobiliária com CRM, rede de parceiros (imobiliárias, gerentes, corretores), contratos com assinatura digital, cobrança de parcelas, comissões e saques.

> **Revisada em 28/09/2026** contra o código do sistema legado (PHP) para servir de **especificação de negócio** na reconstrução em um projeto **Vite**.
> A versão anterior (dez/2024) misturava funcionalidades existentes com ideias nunca implementadas; isso foi separado.

## Como usar esta pasta (para quem vai construir)

1. **Leia na ordem abaixo.** [area-parceiros.md](./area-parceiros.md) define a hierarquia e a visibilidade que atravessam todos os módulos.
2. Cada documento separa:
   - **Como funciona hoje**: comportamento confirmado no sistema atual (referência para migração e para não perder regras).
   - **Regra para o novo sistema**: o que deve ser construído.
   - ⚠️ **Decisão pendente**: está em [decisoes-pendentes.md](./decisoes-pendentes.md). **Não invente a resposta.** Use a sugestão, se houver, como padrão provisório e configurável, e sinalize.
3. Seções **"Ideias da documentação antiga"** no fim dos módulos **não fazem parte do escopo** até o negócio confirmar.
4. Seções sobre **problemas do legado** (segurança, bugs) existem para **não repetir** esses erros.
5. A tecnologia do novo sistema é livre; **não copie a arquitetura do legado**. As regras de [regras-negocio.md §1](./regras-negocio.md) (segurança) são obrigatórias.

## Índice (ordem de leitura)

| # | Documento | Conteúdo |
|---|---|---|
| 1 | [visao-geral.md](./visao-geral.md) | O que é o sistema, módulos, fluxo principal, requisitos não funcionais |
| 2 | [area-parceiros.md](./area-parceiros.md) | **Hierarquia, visibilidade e permissões dos parceiros** (regra nova) |
| 3 | [perfis-usuario.md](./perfis-usuario.md) | Perfis do novo sistema e mapeamento dos perfis atuais |
| 4 | [regras-negocio.md](./regras-negocio.md) | Resumo das regras essenciais (SEG, PAR, CRM, CTR, FIN, IMV, RH) |
| 5 | [fluxos-trabalho.md](./fluxos-trabalho.md) | Fluxos ponta a ponta com diagramas |
| 6 | [modulo-crm.md](./modulo-crm.md) | Captação, ficha, funil, notas, tarefas, documentos, contratos |
| 7 | [modulo-financeiro.md](./modulo-financeiro.md) | Parâmetros, parcelas, cobrança, comissões, saques |
| 8 | [modulo-imobiliario.md](./modulo-imobiliario.md) | Imóveis, status, frações |
| 9 | [modulo-capital-humano.md](./modulo-capital-humano.md) | Equipe interna |
| 10 | [integracoes.md](./integracoes.md) | Asaas, D4Sign, e-mail, PDF, CEP |
| 11 | [modelo-dados.md](./modelo-dados.md) | Tabelas do sistema atual (para migração) e recomendações |
| 12 | [glossario.md](./glossario.md) | Termos e todos os códigos de status |
| 13 | [decisoes-pendentes.md](./decisoes-pendentes.md) | **Perguntas que o negócio precisa responder** |

## Prioridade sugerida de construção

1. Autenticação, perfis e **escopo no servidor** + log de auditoria
2. Área de Parceiros (cadastros, vínculos, transferências)
3. CRM (leads, funil, documentos)
4. Contratos + assinatura digital (com webhook)
5. Financeiro (parcelas, cobrança com webhook, comissões, saques)
6. Imóveis
7. Capital Humano (se confirmado)

## Decisões que bloqueiam o início

Antes de modelar o banco do novo sistema, responder pelo menos: **A1–A6** (parceiros) e **B1–B3** (comissões). Ver [decisoes-pendentes.md](./decisoes-pendentes.md).
