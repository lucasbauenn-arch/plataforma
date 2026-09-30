# Módulo Imobiliário (Imóveis e Frações)

> **Atualizado em 28/09/2026** a partir do código do sistema legado.
> Separação usada: **Como funciona hoje** × **Regra para o novo sistema**. Itens ⚠️ estão em [decisoes-pendentes.md](./decisoes-pendentes.md).

## 1. Cadastro de imóvel

### Campos
| Grupo | Campos | Obrigatório hoje |
|---|---|---|
| Identificação | Nome, matrícula (registro no Cartório de Registro de Imóveis), tipo, descrição | Nenhum validado no servidor |
| Endereço | CEP (com busca automática), país, estado, cidade, bairro, logradouro, número, complemento | — |
| Características | Valor, área total, área construída, idade do imóvel, andar, quartos, banheiros, suítes, vagas de garagem | — |
| Adicionais (sim/não) | Churrasqueira, ar-condicionado, perto de metrô, perto de parque, perto de ponto de ônibus, piscina, aceita pet, "Chip" ⚠️ (E5) | — |
| Fotos | Upload de imagens | — |
| Fração | Marcação "usar no contrato de fração" | — |

Código de exibição: `#` + ID com 7 dígitos (ex.: `#0000007`).

### Tipos de imóvel
| Código | Tipo |
|---|---|
| 1 | Casa |
| 2 | Apartamento |
| 3 | Terreno |

⚠️ (E3) Avaliar se faltam tipos: comercial, sala, rural etc.

### Regra para o novo sistema
- Validação no servidor: nome, tipo, CEP, logradouro, número, cidade, estado e **valor > 0** obrigatórios.
- Valores em decimal (hoje o valor da fração é inteiro e perde os centavos).

## 2. Status do imóvel

| Código | Status | Hoje |
|---|---|---|
| `RA` | Rascunho | "Salvar como rascunho" |
| `PE` | Pendente | "Finalizar cadastro" em imóvel novo |
| `RE` | Revisão | Existe só como filtro; **nada leva o imóvel a esse status** |
| `AP` | Aprovado | Idem |
| `NC` | No contrato | Idem |

**Hoje:** um imóvel já existente, ao ser "finalizado", mantém o status que tinha, então um rascunho continua rascunho.

**Regra para o novo sistema** ⚠️ (E2):
```
RA (Rascunho) → PE (Pendente) → RE (Em revisão) → AP (Aprovado) → NC (No contrato)
                                    ↓
                             volta para RA com observação
```
Definir quem revisa e aprova (proposta: Equipe Ocka) e registrar cada mudança com autor e data.

## 3. Listagem

- **Hoje:** busca por nome, filtro por status (Todos, Rascunho, Pendentes, Revisão, Aprovados, No contrato), 20 itens por página.
- **Novo sistema:** manter; aplicar o escopo do usuário ⚠️ (E4: quem vê quais imóveis? Hoje todos veem todos).

## 4. Edição e permissões

- **Hoje:** só o **criador** consegue editar, porque a tela desabilita o formulário para os demais (nem o superior edita). O **salvamento no servidor não verifica nada**, e as rotas de atualização e de imagem não exigem login.
- **Novo sistema:** permissões no servidor ⚠️ (E4). Proposta: criador e Equipe Ocka editam enquanto `RA`/`PE`; após `AP`, só a Equipe Ocka; imóvel `NC` (em contrato) não pode ter valor alterado.

## 5. Fotos

- **Hoje:** o servidor aceita até 5 MB por arquivo; a tela limita a 2 MB. Aceita qualquer `image/*`. Sem limite de quantidade, sem redimensionamento.
- **Novo sistema:** definir limite de quantidade e tamanho; gerar miniaturas; aceitar JPG, PNG e WEBP.

## 6. Frações

### Como funciona hoje
- Existe **um único registro de fração por imóvel**, que funciona como marcação "este imóvel pode ser usado em contrato de fração" (`active` = 1 disponível, 0 já usado).
- O card "Total em Frações" do painel conta as marcações ativas e as usadas.
- A tabela que liga frações a contratos (`fracoes_contrato`: fração, contrato, entrada, aporte) **existe mas nenhum código a usa**.

### Regra para o novo sistema ⚠️ (E1)
A documentação antiga descrevia um modelo completo (vários pedaços por imóvel, soma igual ao valor do imóvel, venda individual), que **nunca foi implementado**. Antes de construir, o negócio precisa definir:
- Quantas frações por imóvel e como o valor é dividido (igual ou livre);
- Se uma fração pode ter vários compradores ou um só;
- O que acontece com as frações quando o imóvel é vendido inteiro;
- Como a fração aparece no contrato e no financeiro.

## 7. Ideias da documentação antiga (não implementadas; fora do escopo inicial)

Transferência e consolidação de frações, histórico de alterações do imóvel com notificação, marca d'água nas fotos, restrição de cadastro por perfil, dashboard e relatórios de portfólio, filtros avançados (faixa de preço, área, quartos). Só implementar se o negócio confirmar.
