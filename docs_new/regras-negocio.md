# Regras de Negócio: Resumo Essencial

> **Atualizado em 28/09/2026.** Resumo das regras que o novo sistema **deve** seguir. O detalhe está em cada módulo; em caso de conflito, vale o documento do módulo e, para parceiros, [area-parceiros.md](./area-parceiros.md).
> ⚠️ = decisão pendente em [decisoes-pendentes.md](./decisoes-pendentes.md) (códigos como A2, B1, D3). **Não implementar suposições no lugar dessas decisões.**
> IDs das regras: SEG (segurança), PAR (parceiros), CRM, CTR (contratos), FIN (financeiro), IMV (imóveis), RH (equipe interna).

## 1. Acesso e segurança (valem para tudo)

| # | Regra |
|---|---|
| SEG-1 | **Toda rota exige login**, exceto login, recuperação de senha, pré-cadastro por link e webhooks (estes validados por segredo). |
| SEG-2 | **Todo acesso a dados aplica o escopo do usuário no servidor** (regra de ouro). Esconder na tela não é controle de acesso. |
| SEG-3 | Ações que alteram dados usam POST/PUT/PATCH/DELETE com proteção CSRF; **nunca links GET**. |
| SEG-4 | Valores financeiros (cobrança, parcelas, taxas, comissão, saldo) são **sempre calculados no servidor**. |
| SEG-5 | Nenhuma credencial em código-fonte ou documentação; ambientes de teste usam **sandbox**. |
| SEG-6 | Consultas ao banco sempre parametrizadas; conteúdo do usuário sempre escapado na exibição. |
| SEG-7 | Links de criação/redefinição de senha: token aleatório, uso único, validade de 24 h. |
| SEG-8 | Sessão com expiração por inatividade e limite de tentativas de login ⚠️ (H1, H2). |
| SEG-9 | **Log de auditoria** de cadastros, edições, transferências, contratos, pagamentos, saques, configurações e consultas a dados de cliente. |
| SEG-10 | **Inativar, nunca excluir** registros com histórico. Anonimização LGPD preserva valores e datas. |

## 2. Parceiros e visibilidade

| # | Regra |
|---|---|
| PAR-1 | Hierarquia **Imobiliária → Gerente → Corretor → Cliente**; cada registro tem um único pai. |
| PAR-2 | Cada registro grava `imobiliaria_id`, `gerente_id`, `corretor_id` da sua cadeia. |
| PAR-3 | Vê-se quem está **abaixo** na árvore; nunca ao lado ou acima. |
| PAR-4 | Imobiliária: CNPJ + CRECI PJ. Corretor: CPF + CRECI PF. |
| PAR-5 | Inativar corretor/gerente exige transferir a carteira/equipe antes. |
| PAR-6 | Corretor que muda de imobiliária não leva clientes. |
| PAR-7 | Duplicidade de cliente por CPF com regra de dono e prazo ⚠️ (A2). |

Matriz completa de ações: [area-parceiros.md §4](./area-parceiros.md).

## 3. CRM

| # | Regra |
|---|---|
| CRM-1 | Funil: `NC` → `CI` → `DO` → `FI`; `PE` (Perdido) a partir de qualquer etapa, com motivo; reativação volta a `NC` ⚠️ (F1). |
| CRM-2 | Lead novo sempre começa em `NC`. |
| CRM-3 | Pré-cadastro solicita automaticamente: CPF, CNH, comprovante de residência, comprovante de renda. |
| CRM-4 | Documento: pendente → em análise → aprovado/rejeitado (com motivo) ⚠️ (F4). Máx. 5 MB. |
| CRM-5 | Timeline registra automaticamente os eventos do cliente ⚠️ (F3). |

## 4. Contratos

| # | Regra |
|---|---|
| CTR-1 | Texto gerado a partir de modelo com variáveis `{{...}}`: Parcelado, Flexível, Corretor, Imobiliária, Super Agente. |
| CTR-2 | Status atualizado pelo **webhook** do serviço de assinatura; assinado → `A`. |
| CTR-3 | Signatários por regra de negócio ⚠️ (D3); nunca e-mails fixos no código. |
| CTR-4 | Contrato assinado dispara: lead → `FI`, geração das parcelas. |

## 5. Financeiro

| # | Regra |
|---|---|
| FIN-1 | Parcelado: `base = valor × %aporte − entrada`; `parcela = base ÷ n × (1 + taAporteProprio ÷ 100)`; n entre `parcelaMinima` e `parcelaMaxima`. |
| FIN-2 | Flexível: pagamento livre ≥ `valorMinimoFlex`. |
| FIN-3 | Cobrança via gateway (PIX, cartão, boleto); o valor é calculado no servidor a partir das parcelas escolhidas. |
| FIN-4 | Pagamento confirmado (webhook + conciliação) → lançamento `F` → comissão gerada. Processamento idempotente. |
| FIN-5 | Comissão por pagamento: hoje 8,5% do valor para a Ocka, dos quais saem AN 2%, AI 0,5%, SA 0,5% ⚠️ (B1–B3: percentuais, gerente, super agente). |
| FIN-6 | Comissão passa de Pendente para Creditada após prazo ⚠️ (B4). |
| FIN-7 | Saque: só do próprio usuário logado; servidor valida saldo e mínimo ⚠️ (C1); aprovação por perfil autorizado ⚠️ (C2), registrando quem e quando. |
| FIN-8 | Saldo disponível = comissões creditadas − saques pagos − saques pendentes. |
| FIN-9 | Dinheiro em decimal (nunca float/texto). |

## 6. Imóveis

| # | Regra |
|---|---|
| IMV-1 | Status: `RA` → `PE` → `RE` → `AP` → `NC` ⚠️ (E2: quem aprova). |
| IMV-2 | Obrigatórios: nome, tipo, CEP, logradouro, número, cidade, estado, valor > 0. |
| IMV-3 | Imóvel em contrato (`NC`) não pode ter valor alterado. |
| IMV-4 | Frações ⚠️ (E1): não implementar antes da definição. |

## 7. Equipe interna

| # | Regra |
|---|---|
| RH-1 | Colaboradores separados de parceiros e clientes. |
| RH-2 | CPF e e-mail únicos; status Ativo/Inativo; inativar bloqueia o acesso. |
| RH-3 | Ponto, comunicados e permissões granulares ⚠️ (G1, G2). |

## 8. Divergências entre a documentação antiga e o sistema real

A versão anterior deste documento tinha regras que **não correspondem ao sistema**. As principais correções:

| Documentação antiga | Realidade | Onde ficou |
|---|---|---|
| Saque mínimo R$ 50, 5 dias úteis | R$ 100 só na tela; sem prazo | ⚠️ C1, C3 |
| Status de saque P/A/R/F | P/F/C (+ A sem uso) | [modulo-financeiro.md](./modulo-financeiro.md) |
| Status de imóvel Disponível/Vendido/Reservado | RA/PE/RE/AP/NC | [modulo-imobiliario.md](./modulo-imobiliario.md) |
| Funcionário: Férias e Licença; CLT/PJ/Estagiário | Só Ativo/Inativo; Integral/Meio período/Temporário | [modulo-capital-humano.md](./modulo-capital-humano.md) |
| Ponto com tolerância de 10 min e banco de horas | Só uma tabela de marcações, sem tela | ⚠️ G1 |
| Upload máx. 10 MB, 20 documentos, 10 fotos | 5 MB, sem limites de quantidade | Módulos |
| Assinatura com prazo de 7 dias e lembretes | Sem prazo, sem retorno | ⚠️ D4, D5 |
| Sessão 24 h, 3 tentativas, bloqueio de IP, logs | Nada disso existe | SEG-8, SEG-9 |
| Notificações configuráveis por usuário | Só 4 e-mails fixos | [fluxos-trabalho.md §8](./fluxos-trabalho.md) |
| Limites de performance (100 usuários, 1000 consultas/min, uptime 99,5%) | Sem definição | Removido; definir no projeto novo se necessário |
