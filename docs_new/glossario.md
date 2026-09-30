# Glossário

> **Atualizado em 28/09/2026.** Termos de negócio e códigos usados no sistema. Onde o código atual e a regra nova diferem, os dois aparecem.

## Termos de negócio

| Termo | Definição |
|---|---|
| **Aporte próprio** | Parte do valor do imóvel paga pelo cliente com recursos próprios (percentual escolhido na simulação). |
| **Aquisição** | Contrato em que o cliente compra um imóvel ou fração da Ocka, com aporte próprio + financiamento pela Ocka. |
| **Cadeia (de parceiros)** | Sequência de "pais" de um registro: cliente → corretor → gerente → imobiliária. Ver [area-parceiros.md](./area-parceiros.md). |
| **Carteira** | Conjunto de clientes vinculados a um corretor. |
| **Cliente / Lead** | Pessoa física ou jurídica interessada em adquirir; sempre vinculada a um corretor. "Lead" é o cliente antes do contrato. |
| **Colaborador Ocka** | Funcionário interno da Ocka (fora da árvore de parceiros). |
| **Comissão** | Parte de cada pagamento confirmado destinada à Ocka e aos parceiros da cadeia do cliente. Ver [modulo-financeiro.md](./modulo-financeiro.md). |
| **Conciliação** | Conferência automática do status das cobranças no gateway (pago, vencido, removido). |
| **Corretor** | Parceiro pessoa física com CRECI PF, vinculado a um gerente; atende clientes. No sistema atual: perfil `AI` (Agente Imobiliário). |
| **CRECI** | Registro no Conselho Regional de Corretores de Imóveis. PF para corretor, PJ para imobiliária. |
| **Entrada** | Valor pago no início do contrato, abatido da base financiada. |
| **Escopo** | Conjunto de dados que um usuário pode ver/alterar, definido pelo seu perfil e posição na cadeia. |
| **Fração** | Parte de um imóvel que pode ser adquirida separadamente. ⚠️ Regras em definição ([decisoes-pendentes.md](./decisoes-pendentes.md) E1). |
| **Gerente** | Parceiro vinculado a uma imobiliária que coordena corretores. **Nível novo** (não existe no sistema atual). |
| **Imobiliária** | Parceiro pessoa jurídica (CNPJ + CRECI PJ), raiz da árvore de parceiros. No sistema atual, o mais próximo é o perfil `AN` (Agente de Negócios). |
| **Inativação** | Desativar um registro mantendo o histórico. O novo sistema **não exclui** registros com histórico. |
| **Lançamento** | Registro financeiro de uma parcela ou pagamento de um contrato. |
| **Link de indicação** | Link de pré-cadastro de um parceiro; quem se cadastra por ele fica vinculado a esse parceiro. |
| **Matrícula** | Número de registro do imóvel no **Cartório de Registro de Imóveis** (campo opcional hoje). |
| **Modelo de contrato** | Texto base do contrato com variáveis `{{...}}` substituídas pelos dados do cliente e da simulação. |
| **Plano flexível** | Forma de pagamento sem parcelas fixas: o cliente paga valores livres acima de um mínimo. |
| **Plano parcelado** | Forma de pagamento em N parcelas mensais fixas. |
| **Saque** | Pedido do parceiro para receber o saldo de comissões disponível. |
| **Simulação** | Cálculo de entrada, base financiada e parcelas a partir do valor do imóvel e das escolhas do cliente. |
| **Super Agente** | Gestor regional acima das imobiliárias (perfil `SA`). ⚠️ Não aparece na nova regra (A5). |
| **Super padrão** | Usuário Super da Ocka que recebe os cadastros feitos sem link de indicação. |
| **Transferência** | Mudança do "pai" de um corretor ou cliente, com atualização da cadeia e registro em auditoria. |

## Códigos de perfil

| Código (legado) | Nome | Nova regra |
|---|---|---|
| `S` | Super | Super (Ocka) |
| `AD` | Administrador | Administrador (Ocka) |
| `SA` | Super Agente | ⚠️ A5 |
| `AN` | Agente de Negócios | Imobiliária ⚠️ A6 |
| — | — | Gerente (novo) |
| `AI` | Agente Imobiliário | Corretor |
| `CL` | Cliente | Cliente |
| `C` | (padrão, sem nome) | ⚠️ A8, provavelmente Colaborador |
| `IV` | Investidor (só sigla de cargo e e-mail) | ⚠️ A7 |

## Códigos de status

### Funil do cliente (`statusContato`)
`NC` Novo Contato · `CI` Contato Iniciado · `DO` Documentação · `FI` Finalizado · `PE` Perdido

### Contrato de aquisição
`R` Rascunho ⚠️ ou Rejeitado (D1) · `P` Documentação pendente · `EA` Em análise · `AP` Assinatura pendente · `A` Assinado · `AQ` Arquivado

### Tipo de contrato
`1` Aquisição · `2` Investimento ⚠️ (D2) · `3` Prestação de serviço · `4` Parceria · `5` Interno

### Lançamento (parcela/pagamento)
`P` Pendente · `A` Cobrança gerada · `F` Pago · `X` Atrasado · `D` Excluído no gateway · `C` Cancelado · `OK` Concluído (só em tela de detalhe)

### Tipo de lançamento
`0` Parcela · `1` Pagamento de parcelas · `2` Pagamento flexível

### Comissão
`P` Pendente · `B`/`X` Bloqueada · `F` Creditada

### Saque
`P` Solicitado · `F` Aprovado/pago · `C` Rejeitado · `A` "Atrasado" (sem uso claro)

### Documento
Status: `P` Pendente · `EA` Em análise · `A` Aprovado · `R` Rejeitado. Tipo: `U` do usuário · `C` de contrato

### Tarefa
`P` Pendente · `F` Concluída ("Atrasada" é calculada pelo prazo)

### Imóvel
Status: `RA` Rascunho · `PE` Pendente · `RE` Revisão · `AP` Aprovado · `NC` No contrato
Tipo: `1` Casa · `2` Apartamento · `3` Terreno

### Colaborador
Status: `A` Ativo · `I` Inativo. Tipo de contrato: `1` Tempo integral · `2` Meio período · `3` Temporário

## Valores de listas

| Campo | Valores hoje |
|---|---|
| Gênero | Masculino, Feminino, Outros |
| Estado civil | Solteiro(a), Casado(a), Viúvo(a), União estável (⚠️ falta Divorciado(a)) |
| Forma de pagamento da cobrança | PIX, cartão de crédito, boleto |

## Removido da versão anterior

Termos técnicos da implementação antiga (Autoloader, Composer, PSR-4, Controller, Entity, Router, Middleware, MVC, mPDF), termos sem uso no sistema (XML, YAML, Rate Limiting, Zap Imóveis, Horário de Trabalho, Justificativa de ponto) e limites que não existem (100 usuários simultâneos, sessão de 24 h, 10 MB por arquivo, 10 fotos por imóvel, saque mínimo de R$ 50).
