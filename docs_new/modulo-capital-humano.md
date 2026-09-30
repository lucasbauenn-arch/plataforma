# Módulo Capital Humano (equipe interna)

> **Atualizado em 28/09/2026** a partir do código do sistema legado.
> Este módulo trata dos **colaboradores da Ocka**. Parceiros (imobiliárias, gerentes, corretores) estão em [area-parceiros.md](./area-parceiros.md).
> ⚠️ (G1–G3) Confirmar se o módulo entra no novo sistema e com qual escopo; ver [decisoes-pendentes.md](./decisoes-pendentes.md).

## 1. Colaboradores

### Como funciona hoje
- Os colaboradores ficam na mesma tabela de usuários que parceiros e clientes.
- Hoje o módulo lista **qualquer usuário** cujo perfil não seja `C`, então **clientes e parceiros também aparecem** na contagem de "funcionários". O perfil `C` recebe tratamento especial: é redirecionado para a própria ficha.
- Cada perfil vê os usuários da sua cadeia (quem tem o seu ID na coluna do seu nível).

### Campos
| Grupo | Campos |
|---|---|
| Pessoais | Nome, sobrenome, CPF, RG, data de nascimento, gênero, estado civil, nacionalidade, foto, hobbies, biografia |
| Contato | E-mail, telefones, celular, telefone comercial |
| Endereço | CEP, estado, cidade, bairro, logradouro, número, complemento |
| Trabalho | Departamento, cargo, local de trabalho, superior, tipo de contrato, origem do contrato, data de contratação, salário, forma de pagamento, PIS |
| Bancários | Banco, agência, conta, chave PIX |

### Tipos de contrato de trabalho (hoje)
| Código | Tipo |
|---|---|
| 1 | Tempo integral |
| 2 | Meio período |
| 3 | Temporário |

(A documentação antiga citava CLT, PJ e Estagiário; **não existem** no código.)

### Status
Só `A` (Ativo) e `I` (Inativo). Férias e licença **não existem** ⚠️ (G3).

### Cadastro
1. A equipe preenche o formulário (a tela exige nome, e-mail, CPF, departamento e cargo; **o servidor não valida nada**, nem CPF/e-mail únicos).
2. O sistema envia **e-mail de boas-vindas com link para o colaborador criar a senha** (não é senha temporária).
3. **Bug:** todo colaborador novo ganha um dependente vazio automaticamente, muitas vezes com data "31/12/1969".

## 2. Departamentos, cargos e local de trabalho

| Entidade | Campos | Observação |
|---|---|---|
| Departamento | Nome, diretor (um usuário), hierarquia (texto livre) | |
| Cargo | Nome, descrição, % de comissão, sigla (2 letras) | A **sigla** liga o cargo ao perfil: `AD` Diretoria, `DI` Admin, `FN` Financeiro, `JU` Jurídico, `SA`, `AN`, `AI`, `CL`, `IV` Investidor. Cargo não se liga a departamento. |
| Local de trabalho | Nome | Um registro: "OCKA Imobiliaria" |

> ⚠️ O `%` de comissão do cargo **diverge** do usado no cálculo (ver [modulo-financeiro.md](./modulo-financeiro.md)). No novo sistema, comissão deve ficar em um único lugar.

## 3. Dependentes

- **Hoje:** nome, parentesco (texto livre) e data de nascimento (texto). Exclusão definitiva, por link, sem checar dono.
- **Novo sistema:** parentesco como lista fixa; data como data; exclusão com permissão.

## 4. Hierarquia interna

- **Hoje:** existem dois vínculos que podem divergir: o campo **superior** (escolhido no formulário) e a **cadeia de ancestrais**, preenchida a partir de **quem fez o cadastro**, não do superior escolhido.
- **Novo sistema:** um único vínculo de gestor para colaboradores internos, separado da árvore de parceiros; impedir ciclos (A gestor de B, B gestor de A).

## 5. Funcionalidades que existem só no banco (sem tela, rotas desligadas)

| Funcionalidade | Situação |
|---|---|
| **Ponto eletrônico** | A tabela guarda só colaborador + data/hora (uma linha por marcação). Não há entrada/saída, tolerância, horas trabalhadas nem banco de horas ⚠️ (G1). |
| **Histórico de status do colaborador** | Tabela sem ligação com o usuário. |
| **Comunicados internos** | Tabela com título, destinatários e texto ⚠️ (G2). |
| **Permissões granulares** | Tabela vazia ⚠️ (G2). |
| **Aniversariantes** | O card existe, mas a função sempre responde "Nenhum aniversariante". |

## 6. Regras para o novo sistema

- Colaboradores internos em entidade própria (não misturar com clientes/parceiros).
- CPF e e-mail únicos; validação no servidor.
- Inativar em vez de excluir; ao inativar, **bloquear o acesso** imediatamente.
- Acesso ao módulo só para perfis internos autorizados, verificado no servidor. Hoje o menu some para Cliente e Corretor, mas a página abre pela URL.
- Link de criação de senha com token aleatório, de uso único e com validade.

## 7. Ideias da documentação antiga (não implementadas; fora do escopo inicial)

Férias e licenças, processo de demissão, ponto com justificativa de atraso e banco de horas, limite de dependentes, relatórios de turnover e gráficos de RH. Só implementar se o negócio confirmar.
