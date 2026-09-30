# Módulo CRM

> **Atualizado em 28/09/2026** a partir do código do sistema legado.
> Separação usada: **Como funciona hoje** (confirmado no código) × **Regra para o novo sistema**. Itens ⚠️ estão em [decisoes-pendentes.md](./decisoes-pendentes.md).
> A **visibilidade** de contatos segue [area-parceiros.md](./area-parceiros.md).

## 1. Captação de leads

### Como funciona hoje
- **Pré-cadastro público por link de indicação:** cada parceiro tem links do tipo `/pre-cadastro/cliente/{id}`, `/pre-cadastro/corretor/{id}` e `/pre-cadastro/imobiliaria/{id}`. Quem se cadastra pelo link fica **vinculado ao parceiro que indicou** (vira o "superior", e a cadeia acima é copiada automaticamente).
- **Sem indicador:** o cadastro é vinculado ao usuário "Super padrão" da Ocka.
- **Documentos solicitados automaticamente** no pré-cadastro: CPF, CNH, comprovante de residência e comprovante de renda.
- **E-mail de boas-vindas** diferente por tipo (cliente, corretor, imobiliária, investidor), com link para criar a senha.
- **Cadastro interno:** um parceiro ou a equipe cadastra o contato diretamente.
- **Duplicidade:** o pré-cadastro público bloqueia CPF e e-mail já usados por um usuário **ativo**. O cadastro interno **não verifica**.

### Regra para o novo sistema
- O vínculo do lead segue [area-parceiros.md](./area-parceiros.md): todo cliente pertence a um corretor.
- Checagem de duplicidade por CPF **em todos os caminhos de cadastro**, com regra de dono/exclusividade ⚠️ (A2).
- O link de criação de senha deve usar **token aleatório, de uso único e com validade**. Hoje o link é previsível (base64 de um texto fixo + id).
- Registrar o **consentimento LGPD** no cadastro.

## 2. Ficha do contato

### Dados
Nome, sobrenome, CPF/CNPJ, RG, data de nascimento, gênero (Masculino/Feminino/Outros), estado civil (Solteiro(a)/Casado(a)/Viúvo(a)/União estável), nacionalidade, e-mails, telefones, horário preferido de contato, endereço completo, interesse; para parceiros também CRECI e dados bancários/PIX.

### Abas da ficha (hoje)
| Aba | Conteúdo |
|---|---|
| Timeline | Eventos agrupados por mês/ano |
| Notas | Anotações livres |
| Tarefas | Tarefas com responsável e prazo |
| Documentos | Documentos solicitados e enviados |
| Contratos | Contratos de aquisição e de serviço |
| Afiliados | Links de indicação do contato e sua cadeia de parceiros (SA, AN, AI). Só o Super pode reatribuir a cadeia. |

O **cliente** logado é levado direto para a própria ficha.

## 3. Funil de vendas

### Etapas (campo `statusContato`)
| Código | Etapa | No kanban hoje |
|---|---|---|
| `NC` | Novo Contato | Coluna |
| `CI` | Contato Iniciado | Coluna |
| `DO` | Documentação | Coluna |
| `FI` | Finalizado | Coluna |
| `PE` | Perdido | **Só um contador**, sem coluna e sem como mover para lá |

### Como funciona hoje
- O kanban mostra 4 colunas; o contato é arrastado livremente entre elas.
- **Não há validação** de transição: qualquer etapa pode ir para qualquer outra.
- **Bug:** contatos novos são gravados **sem etapa** (vazio), então não aparecem em nenhuma coluna.
- Painel com 3 números: total de contatos, finalizados e perdidos (acumulados, não mensais).
- A lista mostra também **parceiros** (não só clientes) da cadeia do usuário.

### Regra para o novo sistema
- Todo contato novo começa em `NC`.
- Incluir a etapa **Perdido** no fluxo, com **motivo da perda** obrigatório e opção de **reativar** (volta para `NC`) ⚠️ (F1).
- Validações por etapa ⚠️ (F2). Proposta: `DO` exige os documentos básicos solicitados; `FI` exige contrato assinado.
- Registrar cada mudança de etapa na timeline (quem, quando, de → para).
- O kanban mostra **apenas clientes/leads**, filtrados pelo escopo do usuário.

## 4. Notas

- **Hoje:** texto, autor e data/hora. Sem título, sem tipo, sem limite de tamanho. O cliente não vê o botão de nova nota (bloqueio só na tela).
- **Novo sistema:** manter simples; o servidor valida o texto não vazio, aplica o escopo e **escapa o conteúdo** na exibição (hoje há risco de XSS: o texto é renderizado sem escape).

## 5. Tarefas

- **Hoje:** campos "o que deve ser feito", responsável, descrição, prazo, data de conclusão. Status `P` (pendente) e `F` (concluída). "Atrasada" é calculada (prazo vencido), não é um status. A lista de responsáveis mostra **todos os usuários do sistema**.
- **Novo sistema:** responsável limitado ao escopo de quem cria (a própria equipe); "atrasada" continua calculada.

## 6. Documentos

### Como funciona hoje
- A equipe cria uma **solicitação de documento** (nome + formatos aceitos); o cliente envia o arquivo depois.
- Formatos possíveis por solicitação: JPEG, PNG, PDF, DOC, planilha.
- Tamanho máximo: **5 MB** (a documentação antiga dizia 10 MB).
- Tipos: `U` (documento do usuário) e `C` (documento de contrato).
- Status: `P` (pendente), `EA` (em análise), `A` (aprovado), `R` (rejeitado). **Não existe tela para aprovar/rejeitar** ⚠️ (F4).

### Regra para o novo sistema
- Download de documento só para quem tem escopo sobre o cliente (o arquivo não pode ficar em URL pública adivinhável).
- Fluxo de análise: enviado → em análise → aprovado/rejeitado (com motivo), com notificação ao cliente.

## 7. Timeline

- **Hoje:** só exibe; **nenhuma parte do sistema grava eventos**, então aparece sempre vazia.
- **Novo sistema:** registrar automaticamente ⚠️ (F3), no mínimo: cadastro, mudança de etapa, nota, tarefa criada/concluída, documento enviado/analisado, contrato gerado/assinado, pagamento confirmado, transferência de corretor.

## 8. Contratos (a partir da ficha)

### Status do contrato de aquisição
| Código | Significado |
|---|---|
| `R` | ⚠️ "Rascunho" em uma tela, "Rejeitado" em outra (D1) |
| `P` | Documentação pendente |
| `EA` | Em análise |
| `AP` | Assinatura pendente |
| `A` | Assinado |
| `AQ` | Arquivado |

### Como funciona hoje
1. A equipe monta o contrato na ficha (simulação: valor do imóvel, % de aporte próprio, entrada, número de parcelas; ver [modulo-financeiro.md](./modulo-financeiro.md)).
2. O texto é gerado a partir de um **modelo** da configuração, substituindo variáveis como `{{codigo}}`, `{{nome}}`, `{{sobrenome}}`, `{{cpf-cnpj}}`, `{{logradouro}}`, `{{numero}}`, `{{bairro}}`, `{{cidade}}`, `{{estado}}`, `{{cep}}`, `{{valor-propriedade}}`, `{{valor-parcela}}`.
3. Modelos existentes: **Parcelado**, **Flexível**, **Corretor**, **Imobiliária**, **Super Agente**.
4. "Assinar" gera o PDF e envia para assinatura digital (ver [integracoes.md](./integracoes.md)); o status vira `AP`.
5. **Nunca vira `A`:** não há retorno do serviço de assinatura.
6. Contratos de serviço (corretor, imobiliária, super agente) só têm **pré-visualização**.
7. Existe ação de **arquivar** (o botão da lista está quebrado e abre a ficha).

### Regra para o novo sistema
- Status atualizado automaticamente pelo **webhook** do serviço de assinatura (assinado, recusado, expirado).
- Signatários definidos por regra de negócio ⚠️ (D3), nunca e-mails pessoais fixos no código.
- Ações que alteram o contrato (assinar, arquivar) são POST com permissão, nunca links GET.

## 9. Segurança (problemas do legado que o novo sistema não deve repetir)

- As rotas do CRM **não exigem login**: sem sessão foi possível abrir a ficha de um cliente. Mudar etapa, reatribuir afiliação, concluir tarefa e assinar contrato também funcionam sem sessão.
- `/admin/crm/{id}` não verifica se o contato pertence ao usuário: **um cliente consegue abrir a ficha de outro**.
- Consultas montadas por concatenação de texto (risco de SQL injection) e conteúdo exibido sem escape (risco de XSS).

## 10. Ideias da documentação antiga (não implementadas; fora do escopo inicial)

Score de qualificação de leads, distribuição automática de leads, criação automática de tarefas e follow-ups, merge de contatos duplicados, tipos e prioridades de tarefa, integração com WhatsApp e telefonia, relatórios do CRM, campos/status/workflows customizáveis, propostas com aprovação. Só implementar se o negócio confirmar.
