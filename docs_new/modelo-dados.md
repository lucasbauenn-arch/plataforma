# Modelo de Dados (sistema legado)

> Levantado do banco de produção (dump de 23/07/2025) e das migrações da pasta `database/`, em 28/09/2026.
> Serve como **referência para a migração de dados** e para entender as regras do negócio. **Não é o modelo recomendado para o novo sistema**: ver "Recomendações para o novo modelo" no fim.

## Visão geral

| Grupo | Tabelas |
|---|---|
| Pessoas (todos os perfis) | `usuario`, `dependente`, `pessoa` (legado, sem uso aparente) |
| Organização interna | `cargo`, `departamento`, `localtrabalho`, `permissao` (vazia), `statusfuncionario`, `ponto`, `comunicado` |
| CRM | `nota`, `tarefa`, `timeline`, `documento` |
| Imóveis | `imovel`, `fracoes` |
| Contratos | `contrato`, `contrato_servico`, `fracoes_contrato` |
| Financeiro | `lancamento`, `comissao`, `comissao_perfil`, `saque`, `configuracao` |
| **Sobras de outro sistema (descartar)** | `orcamento`, `orcamentoprocedimento`: têm colunas `paciente`, `dentista`, `procedimento`, `especialidade`; não fazem parte do negócio Ocka |

---

## Pessoas

### `usuario`
**Uma única tabela para todos:** funcionários internos, parceiros (super agente, agente de negócios, corretor) e clientes. O tipo é definido por `perfil`.

| Grupo | Campos |
|---|---|
| Identificação | `id`, `nome`, `sobrenome`, `email`, `cpf` (também usado para CNPJ), `rg`, `dataNascimento`, `genero`, `nacionalidade`, `estadoCivil`, `imagem`, `imagemPerfil`, `biografia`, `hobbies` |
| Acesso | `senha` (hash bcrypt), `status` (`A` = ativo), `perfil` (`S`, `AD`, `SA`, `AN`, `AI`, `CL`, `C`; padrão `C`), `superPadrao` (1 = usuário Super padrão) |
| Hierarquia | `superior` (pai direto), `S`, `AD`, `SA`, `AN`, `AI` (IDs dos ancestrais de cada nível; 0 = nenhum) |
| Contato | `telefone1`, `telefone2`, `celular`, `telefoneComercial`, `horarioContato` |
| Endereço | `cep`, `pais`, `estado`, `cidade`, `bairro`, `logradouro`, `numero`, `complemento` |
| CRM (quando é cliente/lead) | `statusContato` (etapa do funil: `NC`, `CI`, `DO`, `FI`, `PE`; padrão `NC`), `interesse`, `criadoEm` |
| Parceiro | `creci`, `banco`, `agencia`, `conta`, `chavePix` |
| Funcionário | `departamento`, `cargo`, `localTrabalho`, `tipoContrato`, `origemContrato`, `dataContratacao`, `salario`, `formatoPagamento`, `pis` |
| Integração | `asaasCustomer` (ID do cliente no gateway de pagamento) |

> O código de "esqueci minha senha" grava `token_expiracao` no usuário, mas essa coluna **não existe no dump** de produção. Conferir antes de migrar.

### `dependente`
Dependentes de funcionários: `nome`, `parentesco`, `dataNascimento`, `parent` (ID do usuário).

### `pessoa`
Cadastro de pessoas separado de `usuario` (`cpfCnpj`, `rgIe`, contatos, `interesse`). Parece ser uma versão antiga do cadastro de leads; conferir se tem dados antes de descartar.

---

## Organização interna

| Tabela | Campos | Observação |
|---|---|---|
| `cargo` | `nome`, `descricao`, `comissao` (%), `sigla` | A `sigla` liga o cargo ao perfil (`SA`, `AN`, `AI`, `CL`…). O campo `comissao` **diverge** de `comissao_perfil` (ver Financeiro). |
| `departamento` | `nome`, `diretor` (ID do usuário), `hierarquia` | |
| `localtrabalho` | `nome` | |
| `permissao` | `chave`, `descricao` | **Vazia**: não existe controle de permissão granular hoje. |
| `statusfuncionario` | `status` (número), `dataHora`, `observacao` | Histórico de status de funcionário. |
| `ponto` | `usuario`, `dataHora` | Uma linha por marcação. Não há tipo (entrada/saída) nem regra de tolerância no banco. |
| `comunicado` | `titulo`, `quemNotificar`, `selecionar`, `texto` | Comunicados internos. |

---

## CRM

Todas usam `parent` = ID do usuário (cliente/lead) a que pertencem.

| Tabela | Campos |
|---|---|
| `nota` | `descricao`, `usuario` (autor), `dataHora` |
| `tarefa` | `deveSerFeito`, `responsavel`, `descricao`, `dataCadastro`, `prazoConclusao`, `dataConclusao`, `status` (padrão `P`) |
| `timeline` | `tilulo` (sic, erro de digitação de "titulo"), `descricao`, `usuario`, `dataHora` |
| `documento` | `nome`, `dataUpload`, `mimeType`, `status`, `tamanho` (texto, ex.: "120 KB"), `url`, `tipo` (1 letra), `uuidSign` (ID do documento no serviço de assinatura), `tiposAceitaveis` |

---

## Imóveis

### `imovel`
| Grupo | Campos |
|---|---|
| Identificação | `nome`, `matricula`, `tipoImovel`, `descricao`, `status`, `criadoPor` (ID do usuário), `chip` |
| Endereço | `cep`, `pais`, `estado`, `cidade`, `bairro`, `logradouro`, `numero`, `complemento` |
| Características | `valor`, `areaTotal`, `areaConstruida`, `idadeImovel`, `andar`, `quarto`, `banheiro`, `suite`, `garagem`, `comodidades` |
| Atributos sim/não | `churrasqueira`, `arCondicionado`, `metro`, `proximoParque`, `proximoOnibus`, `piscina`, `aceitaPet` |

### `fracoes`
Divisão de um imóvel em frações: `id_imovel`, `valor_imovel` (inteiro), `active`, `created_at`.

---

## Contratos

### `contrato`
Contrato de aquisição (cliente comprando/aportando).
`codigo`, `data`, `tipoContrato`, `status`, `produto`, `cliente` (ID do usuário), `tipoPagamento` (padrão `P`), e os valores: `valorPropriedade`, `aporteProprio`, `valorFinanciado`, `valorEntrada`, `valorPagoAporte`, `valorSerFinanciado`, `quantoMeses`, `valorParcela`.

### `contrato_servico`
Contrato de prestação de serviço de parceiros (corretor, imobiliária, super agente):
`id_cliente`, `cargo`, `departamento`, `local`, `origem_contrato`, `forma_de_pagamento`, `salario_servico`, `pagamento_servico` (`variavel` ou fixo), `status_usuario`.

### `fracoes_contrato`
Liga contratos a frações: `id_fracao`, `id_contrato`, `valor_entrada`, `valor_aporte`.

### Modelos de texto dos contratos
Ficam na tabela `configuracao` (`contratoParcelado`, `contratoFlexivel`, `contratoCorretor`, `contratoImobiliaria`, `contratoSuperAgente`) em HTML, com variáveis no formato `{{nome}}`, `{{cpf-cnpj}}`, `{{valor-propriedade}}` etc.

---

## Financeiro

| Tabela | Campos | Observação |
|---|---|---|
| `lancamento` | `contrato`, `parcela`, `descricao`, `vencimento`, `dataPagamento`, `valor`, `status` (2 letras), `referencia`, `tipo`, `asaasPayId` (ID da cobrança no gateway) | Parcelas/cobranças de um contrato. |
| `comissao` | `id_lancamento`, `id_contrato`, `id_cliente`, `lancamento_valor`, `valor_sa`, `valor_an`, `valor_ai`, `valor_ocka`, `status` | Divisão de cada pagamento entre Super Agente, Agente de Negócios, Corretor e Ocka. **Valores gravados como texto.** Não há coluna para gerente. |
| `comissao_perfil` | `perfil`, `percentual_comissao` | Hoje: `AN` 2%, `AI` 0,5%, `SA` 0,5%, `OCKA` 8,5% (em texto: `0.02`, `0.005`…). |
| `saque` | `id_cliente` (quem pede), `id_cliente_aprovacao` (quem aprova), `status`, `valor_saque` (texto), `data_aprovacao` | Pedidos de saque de comissão. |
| `configuracao` | `taAporteProprio`, `taFinanceiro`, `jurosAoMes`, `igpmAtual`, `parcelaMinima`, `parcelaMaxima`, `valorMinimo`, `valorParaProntos`, `pontosParaValor`, `retorno01`, `valorMinimoFlex` + modelos de contrato | Parâmetros globais de simulação/financiamento. Uma linha só. |

> ⚠️ **Divergência de comissão:** a tabela `cargo` diz Corretor (AI) = 2% e Agente de Negócios (AN) = 0,5%; a `comissao_perfil` diz o contrário (AN = 2%, AI = 0,5%). Ver [decisoes-pendentes.md](./decisoes-pendentes.md).

---

## Recomendações para o novo modelo

1. **Separar entidades:** `parceiros` (imobiliária, gerente, corretor), `clientes`, `colaboradores_ocka` e `usuarios_acesso` (login). Hoje tudo está em `usuario`.
2. **Hierarquia de parceiros** com `imobiliaria_id`, `gerente_id`, `corretor_id` em cada registro (ver [area-parceiros.md](./area-parceiros.md)).
3. **Dinheiro sempre em decimal** (ou inteiro em centavos). Nunca `float` nem texto.
4. **Status como enumerações documentadas**, com tabela de transições permitidas.
5. **Chaves estrangeiras reais** (hoje os vínculos são inteiros soltos, sem integridade referencial; `0` significa "nenhum").
6. **Colunas de auditoria** em todas as tabelas (`criado_por`, `criado_em`, `atualizado_por`, `atualizado_em`, `inativado_em`) e uma tabela de log de eventos.
7. **Consentimento LGPD** em tabela própria (quem, quando, texto aceito, origem).
8. Descartar `orcamento`, `orcamentoprocedimento` e, após conferência, `pessoa`.
