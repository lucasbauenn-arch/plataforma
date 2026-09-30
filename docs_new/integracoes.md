# Integrações Externas

> **Atualizado em 28/09/2026** a partir do código do sistema legado.
> Descreve **o que cada integração faz no negócio** e o fluxo real de hoje, como referência para o novo sistema. **Nenhuma credencial deve constar em documentação ou código-fonte.**

## Resumo

| Serviço | Para quê | Situação hoje |
|---|---|---|
| **Asaas** | Cadastro de cliente e cobrança (PIX, cartão de crédito, boleto) | Funciona; confirmação por rotina agendada, **sem webhook** |
| **D4Sign** | Assinatura digital de contratos | Envio funciona; **sem retorno** (contrato nunca vira "assinado") |
| **MailerSend** | E-mails transacionais | Funciona; HTML montado pelo próprio sistema |
| **Gerador de PDF** | PDF do contrato a partir do modelo | Funciona |
| **Busca de CEP** | Preencher endereço | BrasilAberto (servidor) e ViaCEP (navegador) |

## 1. Asaas (pagamentos)

### Fluxo de hoje
1. No **primeiro pagamento** do cliente, o sistema o cadastra no Asaas (nome, CPF/CNPJ, e-mail, telefone, endereço; referência externa = ID do usuário) e guarda o ID retornado no cadastro do cliente.
2. O cliente escolhe as parcelas (ou o valor no plano flexível) e a forma: **PIX, cartão de crédito ou boleto**.
3. O sistema cria a cobrança com vencimento no próprio dia, guarda o ID da cobrança no lançamento (status `A`) e mostra o **link da fatura** ao cliente.
4. Uma **rotina agendada** consulta cada cobrança em aberto:
   - recebida/confirmada → lançamento pago (`F`) + comissão gerada;
   - vencida → `X`;
   - removida → `D`.

### Problemas conhecidos
- Envia o **estado** no campo de bairro (`province`) e não envia cidade.
- O valor da cobrança vem do navegador.
- A rotina imprime a resposta completa da API (vaza dados em log).
- Uma chave de API aparece em comentário no código-fonte e o ambiente aponta para **produção**. **A chave deve ser trocada (rotacionada).**

### Regra para o novo sistema
- **Webhook** do Asaas como gatilho principal (com validação do token de autenticação do webhook) + rotina de reconciliação.
- Processamento **idempotente**: o mesmo evento recebido duas vezes não gera comissão duplicada.
- Ambientes separados: sandbox para desenvolvimento/testes, produção só no servidor de produção.

## 2. D4Sign (assinatura digital)

### Fluxo de hoje
1. O sistema gera o PDF do contrato.
2. Envia o PDF para uma pasta de um cofre no D4Sign.
3. Cadastra a lista de signatários.
4. Dispara o envio para assinatura (o D4Sign manda o e-mail aos signatários).
5. O contrato fica com status `AP` (assinatura pendente) **para sempre**: não há webhook nem consulta de status.

Há dois pontos de entrada no sistema: a ficha do CRM e o perfil do cliente.

### Problemas conhecidos
- **Signatários fixos no código:** e-mail da empresa, o cliente e **dois e-mails pessoais do Gmail**.
- Token e chave de criptografia enviados na URL (ficam em logs de servidores intermediários).

### Regra para o novo sistema
- **Webhook** do D4Sign para atualizar o status: assinado por cada signatário, concluído, recusado, cancelado.
- Signatários definidos por regra de negócio ⚠️ (D3).
- Prazo e lembretes de assinatura ⚠️ (D4).
- Guardar o PDF assinado final e o ID do documento no D4Sign.

## 3. E-mail (MailerSend)

### E-mails que existem hoje
| E-mail | Quando |
|---|---|
| Pré-cadastro / boas-vindas: **cliente**, **corretor**, **imobiliária**, **investidor** | Cadastro pelo link de indicação ou pela equipe |
| Boas-vindas de colaborador | Cadastro no Capital Humano |
| Esqueci minha senha | Pedido na tela de login (link válido por 24 h) |
| Senha alterada | Após criar ou trocar a senha |

- Remetente fixo no código: `noreply@ocka.com.br`.
- O HTML é montado pelo sistema (não usa templates do MailerSend).
- O link de criação de senha do pré-cadastro é **previsível** (base64 de texto fixo + ID). Deve virar token aleatório de uso único.

Novos e-mails necessários: ver [fluxos-trabalho.md §8](./fluxos-trabalho.md).

## 4. PDF do contrato

- Gerado a partir do modelo de contrato da configuração (HTML com variáveis `{{...}}`, ver [modulo-crm.md §8](./modulo-crm.md)).
- **Hoje** o arquivo é salvo numa pasta pública com o nome do cliente no nome do arquivo.
- **Novo sistema:** armazenamento privado; download só com permissão; nome de arquivo sem dados pessoais.

## 5. Variáveis de configuração (nomes, sem valores)

| Serviço | Variáveis usadas hoje |
|---|---|
| Asaas | `ASAAS_LINK`, `ASAAS_KEY` |
| D4Sign | `D4SIGN_SERVER`, `D4SIGN_TOKEN`, `D4SIGN_KEY`, `D4SIGN_FOLDER`, `D4SIGN_UUI_SAFE` |
| E-mail | `EMAIL_SERVER`, `EMAIL_MAIL`, `EMAIL_PASS`, `EMAIL_KEY` |

No novo sistema, acrescentar os segredos de validação dos webhooks e separar as credenciais por ambiente.

## 6. Não existe hoje (citado na documentação antiga)

Webhooks de Asaas e D4Sign, tabela de log de integrações, alertas, health check, assinatura HMAC, criptografia de dados, rate limiting, cartão de débito e parcelado, PDF de relatórios, templates do MailerSend. Webhooks e log de integrações passam a ser **requisitos**; o resto, só se o negócio pedir.
