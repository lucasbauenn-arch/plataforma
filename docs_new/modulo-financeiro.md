# Módulo Financeiro

> **Atualizado em 28/09/2026** a partir do código do sistema legado.
> Cada seção separa **Como funciona hoje** (confirmado no código) de **Regra para o novo sistema**. Itens ⚠️ estão em [decisoes-pendentes.md](./decisoes-pendentes.md).

## 1. Visão geral

O cliente adquire um imóvel (ou fração) pagando um **aporte próprio** e financiando o restante com a Ocka. O restante é pago em **parcelas** (plano parcelado) ou em **pagamentos livres** (plano flexível). Cada pagamento confirmado gera uma **comissão**, dividida entre a Ocka e os parceiros da cadeia do cliente. O parceiro acumula saldo e pede **saque**.

```
Contrato → Lançamentos (parcelas) → Cobrança no gateway → Pagamento confirmado
→ Comissão dividida → Saldo do parceiro → Pedido de saque → Aprovação → Pago
```

## 2. Parâmetros globais (tabela `configuracao`)

Editados na tela **Configurações** (hoje só o perfil Super).

| Parâmetro | Uso | Valor no banco (jul/2025) |
|---|---|---|
| `taAporteProprio` | Taxa (%) aplicada sobre as parcelas do plano parcelado | 8,5 |
| `taFinanceiro` | Taxa (%) exibida no plano flexível (hoje só exibida, não calculada) | — |
| `jurosAoMes`, `igpmAtual` | Juros e índice de correção | — |
| `parcelaMinima` / `parcelaMaxima` | Limites de número de parcelas | 12 / 360 |
| `valorMinimo` | Valor mínimo de contrato | — |
| `valorMinimoFlex` | Valor mínimo de um pagamento no plano flexível | — |
| `valorParaProntos`, `pontosParaValor`, `retorno01` | ⚠️ significado não identificado no código; confirmar com o negócio | — |
| Modelos de contrato | Textos HTML com variáveis `{{...}}` (ver [modulo-crm.md](./modulo-crm.md)) | — |

## 3. Contratos (visão financeira)

### Tipos (`contrato.tipoContrato`)
| Código | Tipo |
|---|---|
| 1 | Aquisição |
| 2 | Investimento |
| 3 | Prestação de serviço |
| 4 | Parceria |
| 5 | Interno |

> ⚠️ Hoje, ao salvar, o código trata `tipoContrato = 2` como contrato de **serviço**, contradizendo a tabela acima. Confirmar o significado correto.

### Forma de pagamento (`contrato.tipoPagamento`)
- `1` = **Parcelado**: gera N parcelas mensais.
- Qualquer outro valor = **Flexível**: o cliente paga quando e quanto quiser, respeitando o mínimo.

### Cálculo do plano parcelado (hoje feito **só no navegador**)
```
base    = valor do imóvel × % de aporte próprio − entrada
parcela = (base ÷ número de parcelas) × (1 + taAporteProprio ÷ 100)
```
Ao salvar, são criados N lançamentos com vencimento mês a mês e status `P`.

**Regra para o novo sistema:** o cálculo de valores, parcelas e taxas deve ser feito **no servidor**. O navegador só envia as escolhas do cliente (valor, % de aporte, entrada, nº de parcelas), e o servidor valida contra os limites da configuração.

## 4. Lançamentos (tabela `lancamento`)

### Tipos
| Código | Tipo |
|---|---|
| 0 | Parcela |
| 1 | Pagamento de parcelas |
| 2 | Pagamento flexível |

### Status
| Código | Significado | Quem define |
|---|---|---|
| `P` | Pendente | Criação da parcela |
| `A` | Cobrança gerada no gateway | Ao gerar a cobrança |
| `F` | Pago (compensado) | Conciliação automática |
| `X` | Atrasado | Conciliação automática (vencida no gateway) |
| `D` | Excluído | Conciliação automática (removida no gateway) |
| `C` | Cancelado | — |
| `OK` | Concluído | Aparece só na tela de detalhe |

> ⚠️ **Inconsistência:** algumas partes do código consideram `C` como "pago" e outras usam `F`. No novo sistema, usar um único status para pago.

### Pagamento pelo cliente
- **Parcelado:** o cliente escolhe entre as **próximas 5 parcelas pendentes**. Mínimo de R$ 250 por pagamento, definido só no JavaScript.
- **Flexível:** valor livre, com mínimo `valorMinimoFlex`.
- Formas: **PIX, cartão de crédito ou boleto**, à escolha do cliente. Vencimento no próprio dia.
- O sistema cria a cobrança no gateway (Asaas) e mostra o link da fatura.
- O cadastro do cliente no gateway é feito no **primeiro pagamento**.

**Regra para o novo sistema:** o **valor cobrado nunca pode vir do navegador**; o servidor calcula a partir das parcelas selecionadas.

### Conciliação (tarefa agendada)
Uma rotina consulta no gateway todo lançamento que não está `F` nem `C`:

| Situação no gateway | Ação |
|---|---|
| Recebido / confirmado | Lançamento → `F`, grava a data de pagamento e **gera a comissão** |
| Vencido | Lançamento → `X` |
| Removido | Lançamento → `D` |

> O agendamento (frequência) não está no repositório. **Regra para o novo sistema:** usar **webhook do gateway** como gatilho principal e a rotina agendada só como reconciliação de segurança.

## 5. Comissões (tabelas `comissao` e `comissao_perfil`)

### Como funciona hoje
Sobre **cada pagamento confirmado**, a Ocka fica com **8,5% do valor pago**. Dessa parte saem as comissões dos parceiros da cadeia do cliente:

| Quem | % do valor pago | Condição |
|---|---|---|
| Agente de Negócios (AN) | 2% | Só se o cliente tiver AN na cadeia |
| Corretor (AI) | 0,5% | Só se o cliente tiver AI na cadeia |
| Super Agente (SA) | 0,5% | Só se o cliente tiver SA na cadeia |
| **Ocka** | 8,5% − parcelas pagas acima | Sempre |

Ou seja, o total distribuído é **8,5%** do valor pago, e não 8,5% mais as comissões.

> ⚠️ **Três decisões críticas:**
> 1. A tabela `cargo` diz Corretor = 2% e Agente de Negócios = 0,5% (o **inverso** do cálculo). Qual é o correto?
> 2. A nova hierarquia tem **Gerente**, que não existe hoje. Qual é a comissão dele e de quem sai?
> 3. O **Super Agente** continua existindo e recebendo?

### Status da comissão
| Código | Significado |
|---|---|
| `P` | Pendente (entra no card "Previsto") |
| `B` / `X` | Bloqueada (entra no card "Previsto") |
| `F` | Creditada (entra no card "Disponível") |

> Hoje a rotina **não grava status** ao criar a comissão, e **nada no código muda o status para `F`**. Portanto o saldo "Disponível" depende de ajuste manual no banco. **Regra para o novo sistema:** definir quando a comissão fica disponível ⚠️ (ex.: X dias após o pagamento confirmado, ou após o fim do prazo de estorno) e automatizar a transição.

### Bugs conhecidos que o novo sistema não deve herdar
- A comissão é atribuída ao ID do **lançamento** no lugar do ID do cliente, em um ponto da rotina.
- Filtros de comissão que consideram só o primeiro usuário de uma lista.
- Valores de dinheiro gravados como texto.

## 6. Painel financeiro (cards)

| Perfil | Cards |
|---|---|
| **Super** | Total em Frações, Aportes, Total de Comissões, Previsto, Saldo, Lucro |
| **Parceiros e Administrador** | Ganho, Previsto, Transferido, Saldo, Disponível para saque |
| **Cliente** | Nenhum card; vê suas parcelas e pagamentos |

Cada card mostra a variação percentual em relação ao mês anterior. Não há gráficos. Cada parceiro soma a coluna do seu próprio nível nos clientes da sua cadeia. O Administrador usa a coluna do Agente de Negócios ⚠️ (provavelmente um erro).

## 7. Saques (tabela `saque`)

### Como funciona hoje
1. O parceiro pede um saque informando o valor.
2. A equipe Ocka vê a lista de pedidos pendentes, com a chave PIX do parceiro.
3. Aprova (status `F`) ou rejeita (status `C`). O pagamento em si é feito **fora do sistema**.

| Código | Significado |
|---|---|
| `P` | Solicitado |
| `F` | Aprovado / pago |
| `C` | Rejeitado / cancelado |
| `A` | "Atrasado" (existe no código, sem uso claro) |

- Valor mínimo: **R$ 100**, verificado **só na tela**. A documentação antiga dizia R$ 50.
- Os textos "20 dias" e "48 horas" do modal não são aplicados em nenhuma regra.
- Quem aprovou não é registrado (`id_cliente_aprovacao` nunca é preenchido).

### Regra para o novo sistema
- O saque é sempre do **usuário logado** (hoje o ID vem da requisição e pode ser trocado).
- O servidor valida **saldo disponível** e **valor mínimo** ⚠️ (definir: R$ 100?).
- Aprovar e rejeitar exigem **perfil autorizado** ⚠️ (quem aprova?) e registram **quem** e **quando**.
- Definir prazo de pagamento e se há taxa ⚠️.
- Saldo disponível = comissões creditadas − saques pagos − saques pendentes.

## 8. Segurança (obrigatório no novo sistema)

Problemas confirmados no legado:
- As rotas financeiras **não exigem login**. Sem sessão, é possível ver a lista de saques com chaves PIX e **aprovar ou rejeitar saques por um simples link (GET)**.
- O valor da cobrança e os valores do contrato chegam do navegador sem recálculo.
- A tela de Configurações salva sem conferir o perfil.

No novo sistema: toda rota financeira exige login e perfil; ações que alteram dados usam POST/PUT com proteção CSRF; valores são sempre calculados no servidor; toda aprovação é auditada.

## 9. Ideias da documentação antiga (não implementadas; fora do escopo inicial)

Multa de 2% por atraso, limite de 2 saques por mês, saque por TED/DOC, taxa de saque, saldo bloqueado, relatórios financeiros, configuração de comissões pela tela, notificações financeiras. Só implementar se o negócio confirmar.
