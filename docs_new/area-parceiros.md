# Área de Parceiros — Hierarquia, Visibilidade e Permissões

> **Status:** regra de negócio **alvo** para o novo sistema. Os itens marcados com ⚠️ ainda dependem de decisão (ver [decisoes-pendentes.md](./decisoes-pendentes.md)).
> Este documento substitui as seções de hierarquia de [perfis-usuario.md](./perfis-usuario.md) e [regras-negocio.md](./regras-negocio.md) no que diz respeito a parceiros (imobiliárias, gerentes, corretores e seus clientes).

---

## 1. Hierarquia

```
Imobiliária
 └── Gerente
      └── Corretor
           └── Cliente (lead)
```

- Cada cadastro tem **um único "pai"** (vínculo direto).
- A visibilidade é definida por esse vínculo: **quem está abaixo na árvore, você enxerga; quem está ao lado ou acima, não.**

## 2. Matriz de visibilidade

| Perfil | Vê gerentes | Vê corretores | Vê clientes |
|---|---|---|---|
| **Imobiliária** | Todos da sua imobiliária | Todos da sua imobiliária | Todos da sua imobiliária |
| **Gerente** | Só o próprio perfil | Apenas os vinculados a ele | Clientes dos seus corretores (e os cadastrados diretamente por ele, se permitido ⚠️) |
| **Corretor** | Só o próprio perfil | Só o próprio perfil | Somente os seus clientes |
| **Cliente** | — | Vê o nome/contato do seu corretor | Só os próprios dados |

## 3. Regras de vínculo

| Perfil | Pai obrigatório | Documentos obrigatórios |
|---|---|---|
| **Imobiliária** | Nenhum (cadastro raiz) | CNPJ e CRECI PJ |
| **Gerente** | Uma imobiliária | CPF |
| **Corretor** | Um gerente (e, por consequência, a imobiliária dele) | CPF e CRECI PF |
| **Cliente (lead)** | Um corretor (fica automaticamente na árvore do gerente e da imobiliária desse corretor) | CPF ou CNPJ |

### Modelo de dados recomendado
Gravar em **cada registro** os IDs de toda a cadeia acima dele:

| Campo | Imobiliária | Gerente | Corretor | Cliente |
|---|---|---|---|---|
| `imobiliaria_id` | — (é ele) | ✅ | ✅ | ✅ |
| `gerente_id` | — | — (é ele) | ✅ | ✅ |
| `corretor_id` | — | — | — (é ele) | ✅ |

Assim o filtro de permissão vira uma condição simples (ex.: `imobiliaria_id = X`, `gerente_id = Y`, `corretor_id = Z`) em vez de percorrer a árvore a cada consulta. Ao transferir alguém de "pai", **todos os descendentes** precisam ter esses IDs atualizados na mesma transação.

## 4. Regras de acesso (ações por perfil)

> Proposta inicial — validar com o negócio.

| Ação | Imobiliária | Gerente | Corretor |
|---|---|---|---|
| Cadastrar gerente | ✅ | ❌ | ❌ |
| Cadastrar corretor | ✅ | ✅ (vinculado a ele) | ❌ |
| Cadastrar cliente | ✅ (escolhe o corretor) | ✅ (escolhe o corretor) | ✅ (vinculado a si) |
| Editar/inativar subordinados | ✅ | ✅ (só seus corretores) | ❌ |
| Transferir corretor para outro gerente | ✅ | ❌ | ❌ |
| Transferir cliente para outro corretor | ✅ | ✅ (dentro da sua equipe) | ❌ |
| Ver relatórios/comissões | Toda a imobiliária | Sua equipe | Só os seus |

## 5. Regras críticas

| Tema | Regra proposta | Status |
|---|---|---|
| **Cliente duplicado** (mesmo CPF em dois corretores) | Vale o primeiro cadastro por CPF, com prazo de exclusividade (ex.: 90 dias) e bloqueio de novo cadastro por outro corretor nesse período. | ⚠️ definir dono e prazo |
| **Corretor desligado** | Ao inativar, o sistema **obriga** a transferir a carteira de clientes para outro corretor ou para o gerente. Nunca deixar clientes órfãos. | Proposta |
| **Gerente desligado** | Antes de inativar, transferir todos os corretores dele para outro gerente. | Proposta |
| **Mudança de imobiliária** | O corretor que migra **não leva** os clientes; eles permanecem na imobiliária de origem. | Proposta |
| **Gerente que também vende** | Se puder cadastrar clientes direto, é preciso um "corretor virtual" ou um campo de responsável. | ⚠️ definir |
| **Exclusão × inativação** | **Nunca apagar** registros; apenas inativar (mantém histórico de vendas e comissões). | Regra |
| **Log de auditoria** | Registrar quem cadastrou, editou, transferiu e **consultou** dados de cliente. | Regra |

## 6. LGPD

- Cada parceiro só acessa dados de clientes relacionados à sua atuação (o modelo de visibilidade acima cobre isso).
- Registro de **consentimento** no cadastro do cliente (data, texto aceito, origem).
- **Log de acesso** aos dados pessoais.
- Possibilidade de **exclusão/anonimização** a pedido do titular, **sem quebrar o histórico financeiro** (anonimizar dados pessoais, manter valores e datas).

## 7. Regra de ouro para implementar

> **Toda consulta ao banco deve aplicar o filtro de escopo do usuário logado no back-end, nunca só no front-end.**
> Se a restrição existir só na tela, um corretor consegue ver dados de outro alterando a URL ou a requisição.

Isso vale para listagens, detalhes, relatórios, exportações, downloads de documentos e endpoints de busca/autocomplete.

---

## 8. Como isso se relaciona com o sistema atual (legado PHP)

O sistema atual **já tem uma hierarquia parecida**, mas com outros níveis e nomes. Levantamento feito no código em 28/09/2026:

### 8.1 Perfis que existem hoje
Campo `usuario.perfil`. As descrições vêm da tabela `cargo`:

| Código atual | Nome no sistema | Descrição cadastrada | Equivalente provável na nova regra |
|---|---|---|---|
| `S` | Super | Administração da plataforma Ocka | **Ocka (plataforma)** — fora da árvore de parceiros |
| `AD` | Administrador | Diretoria | **Ocka (plataforma)** — nenhum usuário com esse perfil no banco |
| `SA` | Super Agente | "Gestor Regional de cidades ou estado" | ⚠️ **Não existe na nova regra** — nível acima da imobiliária |
| `AN` | Agente de Negócios | "Imobiliária, Construtora, Captador, Outros negócios" | **Imobiliária** (mas hoje também cobre construtora e captador ⚠️) |
| — | — | — | **Gerente — nível NOVO, não existe hoje** |
| `AI` | Agente Imobiliário / Corretor de Imóveis | "Corretores PF, PJ" | **Corretor** |
| `CL` | Cliente | "Pessoa física ou jurídica que só faz aporte" | **Cliente** |
| `C` | (sem nome) | Usado como funcionário interno no módulo Capital Humano; é o valor padrão do campo | ⚠️ definir — provavelmente "Colaborador Ocka" |

### 8.2 Como a hierarquia é gravada hoje
- É uma **cadeia linear**: `S → AD → SA → AN → AI → Cliente`.
- Cada usuário guarda o **pai direto** (`usuario.superior`) e os **IDs de todos os ancestrais** em colunas com o nome do perfil (`usuario.S`, `usuario.AD`, `usuario.SA`, `usuario.AN`, `usuario.AI`).
- Esse é o mesmo princípio da seção 3 ("gravar os IDs da cadeia"). A nova versão só precisa trocar os níveis: `imobiliaria_id`, `gerente_id`, `corretor_id`.

### 8.3 Problemas do sistema atual que a nova versão NÃO deve repetir
- **Permissão só na tela:** o menu esconde itens por perfil usando apenas CSS. Um usuário **Cliente** consegue abrir `/admin/configuracao` e `/admin/capital-humano` digitando a URL (testado: resposta 200, com os modelos de contrato visíveis). Viola a regra de ouro (seção 7).
- **Consultas SQL montadas por concatenação de texto** em cerca de 120 pontos do código, inclusive no login (risco de SQL injection).
- **Não existe log de auditoria** nem tabela de consentimento LGPD.
- **Não existe fluxo de transferência de carteira**; inativar um parceiro deixa os clientes vinculados a um usuário inativo.
- **Comissão calculada só para SA, AN, AI e Ocka** (tabela `comissao`): não há coluna para o gerente. Ver [decisoes-pendentes.md](./decisoes-pendentes.md).
